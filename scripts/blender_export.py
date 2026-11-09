"""Blender (headless): bake per-vertex ambient occlusion from the SDF and export the GLB.

  blender -b model/cloud.blend --python scripts/blender_export.py

AO is evaluated analytically against the lobe SDF (classic SDF occlusion: step out along
the normal and measure how much closer the surface is than the step), so it is noise-free
and identical on every build. It only darkens the lobe valleys; ground contact darkening
is done live in the shader (it must fade when the cloud hops).
Output: site/assets/cloud.glb (+Y up, face toward +Z), COLOR_0 = AO.
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
OUT = os.path.join(ROOT, "site", "assets", "cloud.glb")


def sdf_ao(co, n):
    occ = np.zeros(len(co))
    w = 1.0
    for i in range(1, 7):
        h = 0.035 * i * i ** 0.5          # 0.035 .. 0.51
        d = C.sdf(co + n * h, P)
        occ += w * np.maximum(h - d, 0.0) / h
        w *= 0.72
    return np.clip(1.0 - 0.55 * occ, 0.0, 1.0)


def main():
    ob = bpy.data.objects["CloudBody"]
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    # analytic normals (same as the custom split normals)
    e = 1e-4
    g = np.stack([(C.sdf(co + d, P) - C.sdf(co - d, P)) / (2 * e) for d in np.eye(3) * e], 1)
    n = g / np.linalg.norm(g, axis=1, keepdims=True)
    ao = sdf_ao(co, n)
    print(f"[export] AO min {ao.min():.3f} mean {ao.mean():.3f}", flush=True)

    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
    rgba = np.repeat(ao[:, None], 4, 1)
    rgba[:, 3] = 1.0
    attr.data.foreach_set("color", rgba.reshape(-1))
    me.color_attributes.active_color = attr

    mat = bpy.data.materials.get("CloudVinyl") or bpy.data.materials.new("CloudVinyl")
    me.materials.clear()
    me.materials.append(mat)

    for o in bpy.data.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB", use_selection=True,
        export_yup=True, export_normals=True, export_texcoords=True,
        export_materials="EXPORT", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_morph=True, export_morph_normal=True,
        export_animations=True, export_apply=False,
    )
    bpy.ops.wm.save_mainfile()
    print(f"[export] wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KiB)", flush=True)


main()
