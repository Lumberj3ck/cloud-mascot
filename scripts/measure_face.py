"""Measure face features in an image, in body-bbox units (x: -1..1 across the body width,
y: 0 at the body bottom, up, same scale as x).
  .venv/bin/python scripts/measure_face.py img.png [img2.png ...]   (prints JSON per image)"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd


def measure(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = (b - g) > 10
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    m = lab == (1 + int(np.argmax(nd.sum(m, lab, range(1, n + 1)))))
    filled = nd.binary_fill_holes(m)
    ys, xs = np.nonzero(filled)
    x0, x1, y1 = xs.min(), xs.max(), ys.max()
    W = x1 - x0
    U = lambda px: (px - (x0 + x1) / 2) / W * 2
    V = lambda py: (y1 - py) / W * 2
    dark = (r < 120) & (g < 100) & filled
    blobs = []
    lab, n = nd.label(dark)
    for i in range(1, n + 1):
        yy, xx = np.nonzero(lab == i)
        if len(xx) < 30:
            continue
        blobs.append(dict(x=U(xx.mean()), y=V(yy.mean()), w=(np.ptp(xx) + 1) / W * 2, h=(np.ptp(yy) + 1) / W * 2, n=len(xx)))
    blobs.sort(key=lambda d: -d["n"])
    eyes = sorted(blobs[:2], key=lambda d: d["x"])
    mouth = blobs[2] if len(blobs) > 2 else None
    bl = ((r - b) > 6) & (r > 225) & filled & ~nd.binary_dilation(dark, iterations=4)
    bl = nd.binary_opening(bl, iterations=2)
    lab, n = nd.label(bl)
    blush = []
    for i in range(1, n + 1):
        yy, xx = np.nonzero(lab == i)
        if len(xx) > 80:
            blush.append(dict(x=U(xx.mean()), y=V(yy.mean())))
    blush.sort(key=lambda d: d["x"])
    out = {"eyes": eyes, "mouth": mouth, "blush": blush[:1] + blush[-1:] if len(blush) >= 2 else blush}
    return json.loads(json.dumps(out, default=float), parse_float=lambda s: round(float(s), 4))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(p, json.dumps(measure(p)))
