"""Trace silhouettes from the reference images (background/colour threshold).

Outputs build/ref_masks.npz with:
  hero        : bool mask of refs/front.png body (face holes filled, shadow excluded)
  t_front, t_side, t_back, t_top : masks cropped from refs/turnaround.png
and renders/00_ref_masks.png for a visual check.
Run with the project venv:  .venv/bin/python scripts/trace_refs.py
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFS = os.path.join(ROOT, "refs")
BUILD = os.path.join(ROOT, "build")
RENDERS = os.path.join(ROOT, "renders")
os.makedirs(BUILD, exist_ok=True)
os.makedirs(RENDERS, exist_ok=True)


def body_mask(rgb, thresh):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # lavender has blue noticeably above green; cream background, grey shadow,
    # brown eyes and pink blush do not -> fill those holes afterwards.
    m = (b - g) > thresh
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    if n > 1:
        sizes = nd.sum(m, lab, range(1, n + 1))
        m = lab == (1 + int(np.argmax(sizes)))
    return nd.binary_fill_holes(m)


def crop(m):
    ys, xs = np.nonzero(m)
    return m[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1], (int(xs.min()), int(ys.min()))


def main():
    hero_rgb = np.asarray(Image.open(os.path.join(REFS, "front.png")).convert("RGB")).astype(np.float32)
    hero = body_mask(hero_rgb, 14)

    turn = np.asarray(Image.open(os.path.join(REFS, "turnaround.png")).convert("RGB")).astype(np.float32)
    tm = (turn[..., 2] - turn[..., 1]) > 12
    tm[541:, :] = False  # ground line + labels
    cols = np.nonzero(tm.any(0))[0]
    segs, s, p = [], cols[0], cols[0]
    for c in cols[1:]:
        if c > p + 8:
            segs.append((s, p))
            s = c
        p = c
    segs.append((s, p))
    assert len(segs) == 4, segs
    views = {}
    for name, (a, b) in zip(["t_front", "t_side", "t_back", "t_top"], segs):
        sub = np.zeros_like(tm)
        sub[:, a - 2: b + 3] = True
        m = body_mask(np.where(sub[..., None], turn, 255.0), 12)
        views[name] = m

    out = {"hero": hero, **views}
    meta = {}
    for k, m in out.items():
        c, (x0, y0) = crop(m)
        meta[k] = {"x0": x0, "y0": y0, "w": int(c.shape[1]), "h": int(c.shape[0])}
    np.savez_compressed(os.path.join(BUILD, "ref_masks.npz"), **out)
    with open(os.path.join(BUILD, "ref_masks.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta, indent=1))

    # visual check: overlay mask outline on each reference
    def outline(rgb, m):
        edge = m ^ nd.binary_erosion(m, iterations=2)
        o = rgb.copy()
        o[edge] = [255, 0, 90]
        return o.astype(np.uint8)

    a = Image.fromarray(outline(hero_rgb, hero)).resize((600, 600))
    t = turn.copy()
    for k in views:
        t = outline(t, views[k]).astype(np.float32)
    b = Image.fromarray(t.astype(np.uint8))
    b = b.resize((int(b.width * 600 / b.height * 0.5), 300))
    canvas = Image.new("RGB", (600 + b.width, 600), "white")
    canvas.paste(a, (0, 0))
    canvas.paste(b, (600, 150))
    canvas.save(os.path.join(RENDERS, "00_ref_masks.png"))


if __name__ == "__main__":
    main()
