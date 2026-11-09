"""Upright correction for Pixal3D planet models.

Pixal3D reconstructs in the reference image's camera pose (pixel-aligned), so planets whose references were shot
from above come out tipped back. For each planet we find the direction of its "top" feature from texture colour
(moss for home/book, sand for the ocean island) and compute the rotation that turns it to +Y. Planets without a
a reliable top feature (book, moon) reuse the mean correction of the others (same reference camera).
-> site/assets/planets/orient.json  {id: [qx, qy, qz, qw]}  (glTF / three.js Y-up coordinates)
  .venv/bin/python scripts/model_orient.py
"""
import json
import os

import numpy as np
import trimesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURE = {  # which texels mark the top of each planet
    "planet_home": lambda r, g, b: (g > r + 15) & (g > b + 15),
    "planet_ocean": lambda r, g, b: (r > b + 25) & (r > 170) & (g > 140),
}
# planets whose top can't be told apart by colour (green all over, or no distinct top) share the correction
SHARED = ["planet_book", "planet_moon", "planet_meadow", "planet_lantern", "planet_tea"]


def feature_dir(path, test):
    g = list(trimesh.load(path).geometry.values())[0]
    v = g.vertices - g.vertices.mean(0)
    tex = np.asarray(g.visual.material.baseColorTexture.convert("RGB")).astype(float)
    uv = g.visual.uv
    px = (np.clip(uv[:, 0], 0, 1) * (tex.shape[1] - 1)).astype(int)
    py = ((1 - np.clip(uv[:, 1], 0, 1)) * (tex.shape[0] - 1)).astype(int)
    c = tex[py, px]
    m = test(c[:, 0], c[:, 1], c[:, 2])
    d = v[m].mean(0)
    return d / np.linalg.norm(d), float(m.mean())


def quat_to_y(d):
    y = np.array([0.0, 1.0, 0.0])
    axis = np.cross(d, y)
    s = np.linalg.norm(axis)
    if s < 1e-8:
        return [0, 0, 0, 1]
    axis /= s
    ang = np.arctan2(s, np.dot(d, y))
    return [*(axis * np.sin(ang / 2)), np.cos(ang / 2)]


out, dirs = {}, []
for pid, test in FEATURE.items():
    path = os.path.join(ROOT, "build/pixal3d", f"{pid}.glb")
    if not os.path.exists(path):
        print(f"{pid:14s} (no model yet)")
        continue
    d, frac = feature_dir(path, test)
    tilt = np.degrees(np.arccos(np.clip(d[1], -1, 1)))
    print(f"{pid:14s} top feature {frac * 100:4.1f}% of verts, dir {np.round(d, 3)}, tilt {tilt:.0f} deg")
    out[pid] = [round(float(x), 5) for x in quat_to_y(d)]
    dirs.append(d)
med = np.mean(np.array(dirs[:2]), axis=0)   # home + ocean: the cleanest top features
med /= np.linalg.norm(med)
for pid in SHARED:   # all planet references use the same camera, so they share the tilt
    out[pid] = [round(float(x), 5) for x in quat_to_y(med)]
print(f"shared correction for {', '.join(SHARED)}: {np.round(med, 3)}")
json.dump(out, open(os.path.join(ROOT, "site/assets/planets/orient.json"), "w"), indent=1)
print("-> site/assets/planets/orient.json")
