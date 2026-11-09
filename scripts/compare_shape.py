"""Compare Blender shape renders with the references.

Places each render into its reference's pixel frame (same scale, ground line and
centre conventions as fit_lobes.py), measures silhouette IoU of the actual mesh, and
writes side-by-side sheets:
  renders/02_shape_vs_refs.png   reference | clay render | silhouette diff, per view
  renders/03_zebra.png           stripe-reflection smoothness check
  renders/shape_iou.json
"""
import json
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(ROOT, "build", "shape")
META = json.load(open(os.path.join(ROOT, "build", "ref_masks.json")))
CAMS = json.load(open(os.path.join(SH, "cams.json")))
FIT = json.load(open(os.path.join(ROOT, "model", "lobes.json")))
masks = np.load(os.path.join(ROOT, "build", "ref_masks.npz"))
REF_IMG = {
    "hero": np.asarray(Image.open(os.path.join(ROOT, "refs", "front.png")).convert("RGB")),
    "turn": np.asarray(Image.open(os.path.join(ROOT, "refs", "turnaround.png")).convert("RGB")),
}
VIEW_REF = {"hero": "hero", "front": "t_front", "side": "t_side", "back": "t_back", "top": "t_top"}


def offset(view):
    c, m = CAMS[view], META[VIEW_REF[view]]
    W, H, s, zc = c["W"], c["H"], c["s"], c["zc"]
    cx, ground, cy = m["x0"] + m["w"] / 2.0, m["y0"] + m["h"], m["y0"] + m["h"] / 2.0
    if view == "top":
        return cx - W / 2, cy - H / 2
    if view == "hero":
        hu, hv = FIT["hero_camera"]["hu"], FIT["hero_camera"]["hv"]
        return cx - hu * s - W / 2, ground + hv * s - zc * s - H / 2
    return cx - W / 2, ground - zc * s - H / 2


def place(arr, view, shape, fill):
    """Shift a render (H, W[, C]) into the reference frame of the given shape."""
    dx, dy = (int(round(v)) for v in offset(view))
    out = np.full(shape + arr.shape[2:], fill, dtype=arr.dtype)
    H, W = arr.shape[:2]
    y0, x0 = max(dy, 0), max(dx, 0)
    y1, x1 = min(dy + H, shape[0]), min(dx + W, shape[1])
    out[y0:y1, x0:x1] = arr[y0 - dy: y1 - dy, x0 - dx: x1 - dx]
    return out


def crop_box(view, pad):
    m = META[VIEW_REF[view]]
    return m["x0"] - pad, m["y0"] - pad, m["x0"] + m["w"] + pad, m["y0"] + m["h"] + pad


def main():
    font = ImageFont.load_default(size=22)
    results, rows = {}, []
    for view in ["hero", "front", "side", "back", "top"]:
        ref_rgb = REF_IMG["hero" if view == "hero" else "turn"]
        tgt = masks[VIEW_REF[view]]
        mask = np.asarray(Image.open(os.path.join(SH, f"mask_{view}.png")).convert("RGBA"))[..., 3] > 127
        sil = place(mask, view, tgt.shape, False)
        iou = float((sil & tgt).sum() / (sil | tgt).sum())
        results[view] = round(iou, 4)

        bg = ref_rgb[5, 5].astype(np.float32)
        clay = np.asarray(Image.open(os.path.join(SH, f"clay_{view}.png")).convert("RGBA")).astype(np.float32)
        a = clay[..., 3:] / 255.0
        comp = clay[..., :3] * a + bg * (1 - a)  # straight alpha over the reference background
        comp = place(comp.astype(np.uint8), view, tgt.shape, bg.astype(np.uint8))

        diff = np.full(tgt.shape + (3,), 255, np.uint8)
        diff[tgt & sil] = [205, 188, 228]
        diff[tgt & ~sil] = [40, 140, 255]
        diff[~tgt & sil] = [255, 50, 110]

        pad = 60 if view == "hero" else 30
        box = crop_box(view, pad)
        tiles = [Image.fromarray(x).crop(box) for x in (ref_rgb, comp, diff)]
        h = 340
        tiles = [t.resize((int(t.width * h / t.height), h), Image.LANCZOS) for t in tiles]
        row = Image.new("RGB", (sum(t.width for t in tiles) + 40, h + 34), "white")
        x = 0
        for t in tiles:
            row.paste(t, (x, 34))
            x += t.width + 20
        d = ImageDraw.Draw(row)
        d.text((6, 4), f"{view}: reference | Blender shape (Cycles clay) | silhouette diff  "
                       f"IoU {iou:.3f}  (blue = missing, red = extra)", fill=(60, 60, 60), font=font)
        rows.append(row)

    W = max(r.width for r in rows)
    sheet = Image.new("RGB", (W, sum(r.height + 16 for r in rows)), "white")
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 16
    sheet.save(os.path.join(ROOT, "renders", "02_shape_vs_refs.png"))
    shutil.copy(os.path.join(SH, "zebra.png"), os.path.join(ROOT, "renders", "03_zebra.png"))
    json.dump(results, open(os.path.join(ROOT, "renders", "shape_iou.json"), "w"), indent=1)
    print("mesh silhouette IoU:", results)


if __name__ == "__main__":
    main()
