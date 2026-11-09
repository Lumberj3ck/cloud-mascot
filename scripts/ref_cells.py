"""Reference colour grid for the look tuner: mean sRGB of 16x12 cells over the body bbox of
refs/front.png, skipping cells that touch the face (eyes, mouth, blush, highlights) or the edge.
-> build/ref_cells.json"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NX, NY = 16, 12
rgb = np.asarray(Image.open(os.path.join(ROOT, "refs", "front.png")).convert("RGB")).astype(np.float32)
m = (rgb[..., 2] - rgb[..., 1]) > 10
m = nd.binary_opening(m, iterations=2)
lab, n = nd.label(m)
m = lab == (1 + int(np.argmax(nd.sum(m, lab, range(1, n + 1)))))
filled = nd.binary_fill_holes(m)
face = nd.binary_dilation(filled & ~m, iterations=6)
# blush: pinkish (r - b high) patches
face |= nd.binary_dilation(filled & ((rgb[..., 0] - rgb[..., 2]) > 6) & (rgb[..., 0] > 225), iterations=8)
good = filled & ~face
ys, xs = np.nonzero(filled)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
cells = []
for j in range(NY):
    for i in range(NX):
        cx0, cx1 = int(x0 + i / NX * (x1 - x0)), int(x0 + (i + 1) / NX * (x1 - x0))
        cy0, cy1 = int(y0 + j / NY * (y1 - y0)), int(y0 + (j + 1) / NY * (y1 - y0))
        g = good[cy0:cy1, cx0:cx1]
        f = face[cy0:cy1, cx0:cx1]
        if g.mean() > 0.8 and not f.any():
            cells.append(rgb[cy0:cy1, cx0:cx1][g].mean(0).round(2).tolist())
        else:
            cells.append(None)
json.dump({"nx": NX, "ny": NY, "cells": cells}, open(os.path.join(ROOT, "build", "ref_cells.json"), "w"))
print("ref cells:", sum(c is not None for c in cells), "of", NX * NY)
