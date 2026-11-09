"""Bake the soft contact shadow under the cloud from the SDF -> site/assets/contact_shadow.png

For every point on the ground plane: cosine-weighted hemisphere visibility, each direction
cone-traced against the SDF (soft-shadow trick: min of k*d/t along the ray), no key-light
term (the reference shadow is symmetric). The PNG stores shadow darkness (white = darkest). The shader scales/fades it
live when the cloud hops or squashes. Extents are written to site/assets/contact_shadow.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloud_sdf as C  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = C.load(os.path.join(ROOT, "model", "lobes.json"))["params"]
EXT_X, EXT_Y = 1.8, 1.5          # half extents (Blender x, y)
RES_X, RES_Y = 288, 240


def trace(o, d, k, tmax):
    """Soft visibility of rays o + t d (o: (N,3), d: (3,)), only occluders within tmax count
    (a contact shadow is local; the far sky blocked by a tall body is the key light's job)."""
    res = np.ones(len(o))
    t = np.full(len(o), 0.015)
    for _ in range(40):
        h = C.sdf(o + t[:, None] * d, P)
        res = np.where(t < tmax, np.minimum(res, k * h / t), res)
        t += np.clip(h, 0.01, 0.12)
    return np.clip(res, 0.0, 1.0)


def main():
    xs = (np.arange(RES_X) + 0.5) / RES_X * 2 * EXT_X - EXT_X
    ys = (np.arange(RES_Y) + 0.5) / RES_Y * 2 * EXT_Y - EXT_Y
    X, Y = np.meshgrid(xs, -ys)          # image row 0 = back (+Y)... flipped so row 0 = +Y
    o = np.stack([X.ravel(), Y.ravel(), np.full(X.size, 0.004)], 1)

    # cosine-weighted hemisphere (deterministic spiral)
    n = 40
    i = np.arange(n) + 0.5
    r = np.sqrt(i / n)
    phi = i * np.pi * (3 - np.sqrt(5))
    dirs = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - r * r)], 1)
    vis = np.zeros(len(o))
    for d in dirs:
        vis += trace(o, d, 5.0, 0.30)
    amb = vis / n

    inside = C.sdf(o, P) < 0
    a = np.clip((1 - amb - 0.04) / 0.9, 0, 1) ** 1.25
    dark = a  # ambient contact only: the reference shadow is a symmetric soft ellipse
    dark[inside] = 1.0
    dark = dark.reshape(RES_Y, RES_X)
    # fade to exactly zero at the borders of the plane
    fx = np.clip((EXT_X - np.abs(X)) / 0.25, 0, 1)
    fy = np.clip((EXT_Y - np.abs(Y)) / 0.25, 0, 1)
    dark *= fx * fy
    os.makedirs(os.path.join(ROOT, "site", "assets"), exist_ok=True)
    Image.fromarray((np.clip(dark, 0, 1) * 255).round().astype(np.uint8), "L").save(
        os.path.join(ROOT, "site", "assets", "contact_shadow.png"))
    json.dump({"halfX": EXT_X, "halfZ": EXT_Y}, open(os.path.join(ROOT, "site", "assets", "contact_shadow.json"), "w"))
    print(f"contact shadow baked: max {dark.max():.2f}, mean {dark.mean():.3f}")


if __name__ == "__main__":
    main()
