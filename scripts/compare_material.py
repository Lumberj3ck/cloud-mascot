"""Compare the browser hero shot with refs/front.png: colour per body region + side-by-side.

Regions are defined relative to each image's own body bounding box, so small framing
differences don't matter. Prints mean sRGB per region and the difference (ours - ref);
writes renders/04_material_hero.png (reference | browser | 3x crop of both).
  .venv/bin/python scripts/compare_material.py [renders/browser/hero.png]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shot = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "renders", "browser", "hero.png")

# (name, fx, fy, half-size) relative to the body bbox; chosen away from the face/blush
REGIONS = [
    ("dome top", 0.55, 0.10, 0.03), ("upper body", 0.50, 0.30, 0.03),
    ("left lobe", 0.10, 0.45, 0.025), ("right side", 0.93, 0.50, 0.025),
    ("belly", 0.50, 0.70, 0.04), ("lower body", 0.50, 0.88, 0.03),
    ("bottom edge", 0.50, 0.975, 0.012),
]


def body(rgb):
    m = (rgb[..., 2] - rgb[..., 1]) > 10
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    m = lab == (1 + int(np.argmax(nd.sum(m, lab, range(1, n + 1)))))
    return nd.binary_fill_holes(m)


def sample(rgb, m):
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    W, H = x1 - x0, y1 - y0
    out = {}
    for name, fx, fy, hs in REGIONS:
        cx, cy, r = int(x0 + fx * W), int(y0 + fy * H), max(int(hs * W), 2)
        out[name] = rgb[cy - r: cy + r, cx - r: cx + r].reshape(-1, 3).mean(0)
    out["bg (corner)"] = rgb[10:60, 10:60].reshape(-1, 3).mean(0)
    return out, (x0, y0, x1, y1)


def main():
    ref = np.asarray(Image.open(os.path.join(ROOT, "refs", "front.png")).convert("RGB")).astype(np.float32)
    ours = np.asarray(Image.open(shot).convert("RGB")).astype(np.float32)
    sr, br = sample(ref, body(ref))
    so, bo = sample(ours, body(ours))
    rows, err = [], []
    print(f"{'region':12s} {'reference':>16s} {'browser':>16s}  diff")
    for name in [r[0] for r in REGIONS] + ["bg (corner)"]:
        d = so[name] - sr[name]
        err.append(np.abs(d).mean())
        print(f"{name:12s} {str(sr[name].round().astype(int)):>16s} {str(so[name].round().astype(int)):>16s}  {d.round().astype(int)}")
        rows.append({"region": name, "ref": sr[name].round().tolist(), "ours": so[name].round().tolist()})
    print(f"mean abs channel error over regions: {np.mean(err):.1f}")
    print(f"body bbox aspect ref {(br[2]-br[0])/(br[3]-br[1]):.3f} ours {(bo[2]-bo[0])/(bo[3]-bo[1]):.3f}; "
          f"width frac ref {(br[2]-br[0])/ref.shape[1]:.3f} ours {(bo[2]-bo[0])/ours.shape[1]:.3f}")
    json.dump({"regions": rows, "mean_abs_err": float(np.mean(err))},
              open(os.path.join(ROOT, "renders", "material_colors.json"), "w"), indent=1)

    a = Image.fromarray(ref.astype(np.uint8)).resize((700, 700), Image.LANCZOS)
    b = Image.fromarray(ours.astype(np.uint8)).resize((700, 700), Image.LANCZOS)
    sheet = Image.new("RGB", (1420, 740), (255, 255, 255))
    sheet.paste(a, (0, 40))
    sheet.paste(b, (720, 40))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.load_default(size=22)
    d.text((10, 8), "refs/front.png", fill=(70, 70, 70), font=f)
    d.text((730, 8), f"three.js (browser, headless)   mean |Δ| {np.mean(err):.1f}/255", fill=(70, 70, 70), font=f)
    sheet.save(os.path.join(ROOT, "renders", "04_material_hero.png"))


if __name__ == "__main__":
    main()
