"""Polygonise the fitted lobe SDF with marching cubes -> build/body_raw.obj.
Only a starting mesh: Blender then voxel-remeshes, retopologises and projects it
back onto the exact SDF surface (scripts/blender_body.py).
"""
import os
import sys

import numpy as np
from skimage.measure import marching_cubes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloud_sdf as C  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = C.load(os.path.join(ROOT, "model", "lobes.json"))["params"]

h = 0.008
lo = np.array([-1.25, -0.95, -0.05])
hi = np.array([1.25, 0.95, 1.65])
axes = [np.arange(a, b + h, h) for a, b in zip(lo, hi)]
X, Y, Z = np.meshgrid(*axes, indexing="ij")
vol = C.sdf(np.stack([X, Y, Z], -1), P)
assert vol[0].min() > 0 and vol[-1].min() > 0 and vol[:, 0].min() > 0 and vol[:, -1].min() > 0 \
    and vol[:, :, -1].min() > 0, "grid does not enclose the body"
verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(h, h, h))
verts += lo
os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
out = os.path.join(ROOT, "build", "body_raw.obj")
with open(out, "w") as f:
    f.write("".join(f"v {x:.6f} {y:.6f} {z:.6f}\n" for x, y, z in verts))
    # skimage winding -> outward normals need reversed order for OBJ convention
    f.write("".join(f"f {a + 1} {c + 1} {b + 1}\n" for a, b, c in faces))
print(f"marching cubes: {len(verts)} verts, {len(faces)} tris -> {out}")
