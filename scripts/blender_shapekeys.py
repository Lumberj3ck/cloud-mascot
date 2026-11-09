"""Blender (headless): add the body's deformation shape keys to model/cloud.blend.

  blender -b model/cloud.blend --python scripts/blender_shapekeys.py

No humanoid rig: the cloud deforms through a handful of smooth, region-weighted shape keys.
Region weights (dome / left lobe / right lobe) come from the lobe SDF itself, so every key
fades out exactly across the C2 blends between lobes: no seams, no lumps. The animation code
(site/js/anim.js) mixes them, adds volume-preserving squash/stretch and spring jiggle.

Keys (Blender coords: X right, Y back, Z up; magnitudes at influence 1, body width 2.0):
  Breathe   inflate along the normal, base pinned            (idle breathing)
  Spread    base widens                                      (paired with squash)
  LeanX     curved shear toward +X (use negative for -X)     (lean / wobble)
  LeanY     curved shear toward the face (-Y)                (lean forward/back)
  DomeX     dome lobe sways toward +X                        (secondary jiggle)
  DomeY     dome lobe sways toward the face                  (secondary jiggle)
  DomeUp    dome stretches up                                (proud / surprised)
  LobeL     left lobe puffs out                              (secondary jiggle, wiggle)
  LobeR     right lobe puffs out
  Droop     top sinks and sags outward                       (sleepy / sad)
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cloud_sdf as C  # noqa: E402

ROOT = os.path.dirname(HERE)
P = C.load(os.path.join(ROOT, "model", "lobes.json"))["params"]


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def region_weights(co):
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    dC = C.sd_ellipsoid(x, y, z, 0.0, P["yC"], P["zC"], P["rC"] * P["eC"], P["rC"] * P["sC"], P["rC"])
    lobe = lambda sx: C.sd_ellipsoid(x, y, z, sx * P["xS"], P["yS"], P["zS"], P["rS"], P["rS"] * P["sS"], P["rS"] * P["eS"])
    dL, dR = lobe(-1.0), lobe(1.0)
    dB = C.sd_ellipsoid(x, y, z, 0.0, P["yB"], P["zB"], P["aB"], P["bB"], P["cB"])
    w = 0.16  # transition width ~ the blend radius
    wD = smoothstep(-w, w, np.minimum(np.minimum(dL, dR), dB) - dC)
    wL = smoothstep(-w, w, np.minimum(np.minimum(dC, dR), dB) - dL)
    wR = smoothstep(-w, w, np.minimum(np.minimum(dC, dL), dB) - dR)
    return wD, wL, wR


def normals(co):
    e = 1e-4
    g = np.stack([(C.sdf(co + d, P) - C.sdf(co - d, P)) / (2 * e) for d in np.eye(3) * e], 1)
    return g / np.linalg.norm(g, axis=1, keepdims=True)


def main():
    ob = bpy.data.objects["CloudBody"]
    me = ob.data
    if me.shape_keys:
        ob.shape_key_clear()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    H = z.max()
    h = np.clip(z / H, 0, 1)
    n = normals(co)
    wD, wL, wR = region_weights(co)
    pin = smoothstep(0.04, 0.45, h)                  # keeps the base planted on the floor
    zero = np.zeros_like(x)

    keys = {
        "Breathe": n * (0.028 * pin)[:, None],
        "Spread": np.stack([x * 0.11 * (1 - h) ** 2, y * 0.11 * (1 - h) ** 2, zero], 1),
        "LeanX": np.stack([0.34 * h ** 2, zero, -0.05 * h ** 2 * np.sign(x + 1e-9) * 0], 1),
        "LeanY": np.stack([zero, -0.34 * h ** 2, zero], 1),
        "DomeX": np.stack([0.15 * wD * h, zero, zero], 1),
        "DomeY": np.stack([zero, -0.15 * wD * h, zero], 1),
        "DomeUp": np.stack([x * 0.05 * wD, y * 0.03 * wD, 0.16 * wD * smoothstep(0.35, 1.0, h)], 1),
        "LobeL": n * (0.07 * wL * pin)[:, None],
        "LobeR": n * (0.07 * wR * pin)[:, None],
        "Droop": np.stack([x * 0.10 * smoothstep(0.25, 0.75, h), y * 0.08 * smoothstep(0.25, 0.75, h),
                           -0.17 * h ** 2], 1),
    }
    basis = ob.shape_key_add(name="Basis", from_mix=False)
    for name, d in keys.items():
        k = ob.shape_key_add(name=name, from_mix=False)
        k.slider_min, k.slider_max = -1.0, 1.0
        k.value = 0.0
        k.data.foreach_set("co", (co + d).reshape(-1))
        print(f"[shapekeys] {name:8s} max |d| = {np.linalg.norm(d, axis=1).max():.3f}", flush=True)
    me.update()
    bpy.ops.wm.save_mainfile()
    print("[shapekeys] saved", len(keys), "keys", flush=True)


main()
