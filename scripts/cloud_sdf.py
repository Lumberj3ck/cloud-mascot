"""Signed distance function of the cloud body: a few soft lobes blended with a
polynomial smooth-min, mirror-symmetric in X, flattened on the ground plane z=0.

Coordinates (Blender): X right, Y back (the face looks toward -Y), Z up.
Pure numpy so it runs both in the project venv and inside Blender.
"""
import json
import numpy as np

# Ordered parameter names (the optimiser works on a flat vector).
NAMES = [
    "rC", "yC", "zC", "sC", "eC",      # centre dome: radius, depth offset, height, depth scale, width scale
    "xS", "yS", "zS", "rS", "sS", "eS",  # side lobes (mirrored): x, depth off., height, radius, depth scale, height scale
    "aB", "bB", "cB", "yB", "zB",      # base ellipsoid radii (x, y, z) and centre (y, z)
    "k", "kB", "kb",                   # dome/side-lobe blend, lobes/base blend, ground edge rounding
]

DEFAULT = dict(
    rC=0.55, yC=0.03, zC=0.86, sC=1.05, eC=1.0,
    xS=0.56, yS=-0.08, zS=0.50, rS=0.45, sS=1.05, eS=1.0,
    aB=0.92, bB=0.58, cB=0.50, yB=0.0, zB=0.42,
    k=0.14, kB=0.2, kb=0.12,
)


def smin(a, b, k):
    """Cubic smooth-min: C2 continuous, so the blend has no curvature seam
    (keeps highlights and sheen gliding cleanly across lobe junctions)."""
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * h * k * (1.0 / 6.0)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sd_ellipsoid(px, py, pz, cx, cy, cz, rx, ry, rz):
    """Quilez's ellipsoid bound: exact at the surface, smooth everywhere."""
    qx, qy, qz = (px - cx) / rx, (py - cy) / ry, (pz - cz) / rz
    k0 = np.sqrt(qx * qx + qy * qy + qz * qz)
    k1 = np.sqrt((qx / rx) ** 2 + (qy / ry) ** 2 + (qz / rz) ** 2)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sdf(p, P):
    """p: (..., 3) array. P: dict of parameters. Returns signed distance (approx)."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    dC = sd_ellipsoid(x, y, z, 0.0, P["yC"], P["zC"], P["rC"] * P["eC"], P["rC"] * P["sC"], P["rC"])
    # left/right lobes evaluated separately and smooth-blended (abs(x) would leave a
    # min() crease in the field along x=0); still exactly mirror-symmetric.
    lobe = lambda sx: sd_ellipsoid(x, y, z, sx * P["xS"], P["yS"], P["zS"],
                                   P["rS"], P["rS"] * P["sS"], P["rS"] * P["eS"])
    dS = smin(lobe(-1.0), lobe(1.0), P["k"])
    dB = sd_ellipsoid(x, y, z, 0.0, P["yB"], P["zB"], P["aB"], P["bB"], P["cB"])
    d = smin(smin(dC, dS, P["k"]), dB, P["kB"])
    # flat-ish base: smooth intersection with the half-space z >= 0
    return smax(d, -z, P["kb"])


def to_vec(P):
    return np.array([P[n] for n in NAMES], dtype=np.float64)


def from_vec(v):
    return {n: float(x) for n, x in zip(NAMES, v)}


def load(path):
    with open(path) as f:
        data = json.load(f)
    data["params"] = {**DEFAULT, **data.get("params", {})}
    return data
