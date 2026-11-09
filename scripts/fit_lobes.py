"""Fit the lobe SDF to the traced reference silhouettes.

Loss = weighted (1 - soft IoU) over:
  hero    refs/front.png   (weight 1.0; camera yaw/pitch/scale/offset fitted too: the hero is a
                            slightly turned, slightly top-down 3/4 shot of a symmetric toy)
  t_side  turnaround side  (depth profile)
  t_top   turnaround top   (lobe layout in plan)
  t_front turnaround front (low weight, keeps proportions honest)
Writes model/lobes.json and renders/01_fit_silhouettes.png.
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy.optimize import minimize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloud_sdf as C  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
os.makedirs(os.path.join(ROOT, "model"), exist_ok=True)

masks = np.load(os.path.join(BUILD, "ref_masks.npz"))
D = 44  # samples along each ray
WEIGHTS = {"hero": 1.0, "t_side": 0.7, "t_top": 0.45, "t_front": 0.5}
CAM_NAMES = ["yaw", "pitch", "hs", "hu", "hv"]


def bbox(m):
    ys, xs = np.nonzero(m)
    return xs.min(), xs.max(), ys.min(), ys.max()


def down(m, f, pad):
    x0, x1, y0, y1 = bbox(m)
    x0, y0 = max(x0 - pad, 0), max(y0 - pad, 0)
    x1, y1 = min(x1 + pad, m.shape[1] - 1), min(y1 + pad, m.shape[0] - 1)
    sub = m[y0: y1 + 1, x0: x1 + 1].astype(np.float32)
    H, W = sub.shape[0] // f, sub.shape[1] // f
    sub = sub[: H * f, : W * f].reshape(H, f, W, f).mean((1, 3))
    rows = y0 + (np.arange(H) + 0.5) * f
    cols = x0 + (np.arange(W) + 0.5) * f
    return sub, rows, cols


class View:
    def __init__(self, name, f):
        m = masks[name]
        self.name = name
        self.target, rows, cols = down(m, f, 40)
        x0, x1, y0, y1 = bbox(m)
        self.cx, self.cy = (x0 + x1 + 1) / 2.0, (y0 + y1 + 1) / 2.0
        self.ground = y1 + 1.0
        self.width = x1 - x0 + 1.0
        self.cols, self.rows = np.meshgrid(cols, rows)
        self.f = f


SF = masks["t_front"]
_, _, _, _ = bbox(SF)
S_TURN = (bbox(SF)[1] - bbox(SF)[0] + 1) / 2.0  # px per unit (turnaround front width := 2.0)


def rays_ortho(view, P_cam=None):
    """Return points (H, W, D, 3) in model space."""
    t = np.linspace(-1.5, 1.5, D)
    if view.name in ("t_front", "t_back"):
        x = (view.cols - view.cx) / S_TURN
        z = (view.ground - view.rows) / S_TURN
        X = np.broadcast_to(x[..., None], x.shape + (D,))
        Z = np.broadcast_to(z[..., None], z.shape + (D,))
        Y = np.broadcast_to(t, x.shape + (D,))
        return np.stack([X, Y, Z], -1)
    if view.name == "t_side":
        y = (view.cols - view.cx) / S_TURN  # face (-Y) is on the left of the side view
        z = (view.ground - view.rows) / S_TURN
        Y = np.broadcast_to(y[..., None], y.shape + (D,))
        Z = np.broadcast_to(z[..., None], z.shape + (D,))
        X = np.broadcast_to(t, y.shape + (D,))
        return np.stack([X, Y, Z], -1)
    if view.name == "t_top":
        s = view.width / 2.0
        x = (view.cols - view.cx) / s
        y = -(view.rows - view.cy) / s  # front (-Y) at the bottom of the top view
        X = np.broadcast_to(x[..., None], x.shape + (D,))
        Y = np.broadcast_to(y[..., None], y.shape + (D,))
        Z = np.broadcast_to(np.linspace(0.0, 1.8, D), x.shape + (D,))
        return np.stack([X, Y, Z], -1)
    # hero: rotated orthographic camera
    yaw, pitch, hs, hu, hv = P_cam
    s = view.width / 2.0 * hs
    u = (view.cols - view.cx) / s + hu
    v = (view.ground - view.rows) / s + hv
    U = np.broadcast_to(u[..., None], u.shape + (D,))
    V = np.broadcast_to(v[..., None], v.shape + (D,))
    T = np.broadcast_to(t, u.shape + (D,))
    pr = np.stack([U, T, V], -1)  # rotated space (x, depth, up)
    return hero_inverse(pr, yaw, pitch)


def hero_inverse(pr, yaw, pitch):
    # forward: p_r = Rx(pitch) Rz(yaw) p   ->   p = Rz(-yaw) Rx(-pitch) p_r
    cp, sp = np.cos(-pitch), np.sin(-pitch)
    x, y, z = pr[..., 0], pr[..., 1], pr[..., 2]
    y1, z1 = cp * y - sp * z, sp * y + cp * z
    cy, sy = np.cos(-yaw), np.sin(-yaw)
    x2, y2 = cy * x - sy * y1, sy * x + cy * y1
    return np.stack([x2, y2, z1], -1)


def silhouette(view, P, P_cam=None, eps=None):
    pts = rays_ortho(view, P_cam)
    d = C.sdf(pts, P).min(-1)
    if eps is None:
        eps = 0.5 * view.f / S_TURN
    return 1.0 / (1.0 + np.exp(np.clip(d / eps, -40, 40)))


def soft_iou(a, b):
    inter = (a * b).sum()
    return inter / (a.sum() + b.sum() - inter + 1e-9)


def penalty(P):
    pen = 0.0
    # k capped (design choice): silhouettes barely constrain it (0.26 -> 0.15 moves IoU < 0.002),
    # but a bigger blend fills the dome/side-lobe shoulders and the toy stops reading as a cloud.
    lim = {"k": (0.10, 0.18), "eC": (0.8, 1.3), "eS": (0.8, 1.3), "kB": (0.12, 0.45), "kb": (0.04, 0.25), "rC": (0.2, 1.2), "rS": (0.2, 1.0),
           "sC": (0.6, 1.6), "sS": (0.6, 1.6), "cB": (0.2, 0.9)}
    for n, (lo, hi) in lim.items():
        pen += max(0.0, lo - P[n]) ** 2 + max(0.0, P[n] - hi) ** 2
    return 50.0 * pen


def make_loss(views):
    def loss(v, report=False):
        P = C.from_vec(v[: len(C.NAMES)])
        cam = v[len(C.NAMES):]
        total, parts = 0.0, {}
        for view in views:
            sil = silhouette(view, P, cam if view.name == "hero" else None)
            iou = soft_iou(sil, view.target)
            parts[view.name] = iou
            total += WEIGHTS[view.name] * (1.0 - iou)
        if report:
            return parts
        return total + penalty(P)
    return loss


def run(views, x0, iters):
    loss = make_loss(views)
    t0 = time.time()
    res = minimize(loss, x0, method="Powell", options={"maxiter": iters, "xtol": 1e-3, "ftol": 1e-5})
    print(f"  {res.nfev} evals, {time.time() - t0:.0f}s, loss {res.fun:.4f}", flush=True)
    return res.x, loss


def main():
    x0 = np.concatenate([C.to_vec(C.DEFAULT), [np.radians(-14), np.radians(10), 1.0, 0.0, 0.0]])
    warm = os.path.join(ROOT, "model", "lobes.json")
    if os.path.exists(warm) and "--cold" not in sys.argv:
        prev = C.load(warm)
        P0 = {**C.DEFAULT, **prev["params"]}
        x0 = np.concatenate([C.to_vec(P0), [prev["hero_camera"][n] for n in CAM_NAMES]])
        print("warm start from", warm)
    names = list(WEIGHTS)
    coarse = [View(n, 12 if n == "hero" else 7) for n in names]
    print("coarse fit", flush=True)
    x, _ = run(coarse, x0, 6)
    fine = [View(n, 6 if n == "hero" else 4) for n in names]
    print("fine fit", flush=True)
    x, loss = run(fine, x, 4)
    P = C.from_vec(x[: len(C.NAMES)])
    cam = dict(zip(CAM_NAMES, map(float, x[len(C.NAMES):])))
    parts = make_loss(fine)(x, report=True)
    # hard IoU at full-ish resolution for the record
    hard = {}
    final = [View(n, 3) for n in names]
    for view in final:
        sil = silhouette(view, P, x[len(C.NAMES):] if view.name == "hero" else None) > 0.5
        tgt = view.target > 0.5
        hard[view.name] = float((sil & tgt).sum() / (sil | tgt).sum())
    print("soft IoU", {k: round(float(v), 4) for k, v in parts.items()})
    print("hard IoU", {k: round(v, 4) for k, v in hard.items()})
    out = {"params": P, "hero_camera": cam, "iou": hard,
           "units": "turnaround front width = 2.0; Z up, face toward -Y, ground z=0"}
    with open(os.path.join(ROOT, "model", "lobes.json"), "w") as f:
        json.dump(out, f, indent=2)

    # comparison image: target (grey) vs model outline (magenta) / overlap
    tiles = []
    for view in final:
        sil = silhouette(view, P, x[len(C.NAMES):] if view.name == "hero" else None) > 0.5
        tgt = view.target > 0.5
        img = np.full(tgt.shape + (3,), 255, np.uint8)
        img[tgt & sil] = [200, 180, 225]
        img[tgt & ~sil] = [60, 160, 255]   # missing from model (blue)
        img[~tgt & sil] = [255, 60, 120]   # extra in model (red)
        im = Image.fromarray(img)
        im = im.resize((int(im.width * 260 / im.height), 260))
        tiles.append(im)
    W = sum(t.width for t in tiles) + 20 * (len(tiles) + 1)
    canvas = Image.new("RGB", (W, 300), "white")
    xo = 20
    for t in tiles:
        canvas.paste(t, (xo, 20))
        xo += t.width + 20
    canvas.save(os.path.join(ROOT, "renders", "01_fit_silhouettes.png"))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
