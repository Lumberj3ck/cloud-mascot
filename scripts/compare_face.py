"""Hero face check: measure eyes/mouth in the browser hero shot vs refs/front.png and write
renders/07_face_hero.png (full frames + matching close-up crops).
  .venv/bin/python scripts/compare_face.py [renders/browser/hero.png]"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import measure_face as M  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shot = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "renders", "browser", "hero.png")


def summary(m):
    e, mo = m["eyes"], m["mouth"]
    return {"eye_mid_x": (e[0]["x"] + e[1]["x"]) / 2, "eye_spacing": e[1]["x"] - e[0]["x"],
            "eye_y": (e[0]["y"] + e[1]["y"]) / 2, "eye_w": (e[0]["w"] + e[1]["w"]) / 2,
            "eye_h": (e[0]["h"] + e[1]["h"]) / 2, "mouth_x": mo["x"], "mouth_y": mo["y"],
            "mouth_w": mo["w"], "mouth_h": mo["h"]}


def bbox(im):
    a = np.asarray(im).astype(float)
    m = nd.binary_fill_holes(nd.binary_opening((a[..., 2] - a[..., 1]) > 10, iterations=2))
    ys, xs = np.nonzero(m)
    return xs.min(), xs.max(), ys.min(), ys.max()


ref_p = os.path.join(ROOT, "refs", "front.png")
r, o = summary(M.measure(ref_p)), summary(M.measure(shot))
print(f"{'':12s} {'ref':>8s} {'ours':>8s}")
for k in r:
    print(f"{k:12s} {r[k]:8.3f} {o[k]:8.3f}")
json.dump({"ref": r, "ours": o}, open(os.path.join(ROOT, "renders", "face_measure.json"), "w"), indent=1)

A, B = Image.open(ref_p).convert("RGB"), Image.open(shot).convert("RGB")
ra, rb = bbox(A), bbox(B)
box = (330, 480, 830, 700)
sx = (rb[1] - rb[0]) / (ra[1] - ra[0])
bb = tuple(int(v) for v in ((box[0] - ra[0]) * sx + rb[0], (box[1] - ra[3]) * sx + rb[3],
                            (box[2] - ra[0]) * sx + rb[0], (box[3] - ra[3]) * sx + rb[3]))
s = Image.new("RGB", (1520, 950), "white")
s.paste(A.resize((600, 600)), (0, 0))
s.paste(B.resize((600, 600)), (620, 0))
s.paste(A.crop(box).resize((750, 330), Image.LANCZOS), (0, 610))
s.paste(B.crop(bb).resize((750, 330), Image.LANCZOS), (765, 610))
s.save(os.path.join(ROOT, "renders", "07_face_hero.png"))
