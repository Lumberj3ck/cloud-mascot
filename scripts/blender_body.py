"""Blender (headless): build the clean body mesh from build/body_raw.obj.

  blender -b --factory-startup --python scripts/blender_body.py

Steps: import marching-cubes mesh -> voxel remesh (watertight, uniform) ->
QuadriFlow retopology (~6k quads ~= 12k tris) -> bisect at x=0 + mirror (exact symmetry)
-> project every vertex back onto the analytic SDF surface (smooth by construction, no
lumps) -> analytic custom normals -> UVs -> integrity checks -> model/cloud.blend
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cloud_sdf as C  # noqa: E402

ROOT = os.path.dirname(HERE)
P = C.load(os.path.join(ROOT, "model", "lobes.json"))["params"]
TARGET_QUADS = 6000


def log(*a):
    print("[body]", *a, flush=True)


def sdf_grad(p, e=1e-4):
    g = np.zeros_like(p)
    for i in range(3):
        d = np.zeros(3)
        d[i] = e
        g[:, i] = (C.sdf(p + d, P) - C.sdf(p - d, P)) / (2 * e)
    return g


def project(p, iters=8):
    for _ in range(iters):
        d = C.sdf(p, P)
        g = sdf_grad(p)
        p = p - (d / np.maximum((g * g).sum(1), 1e-12))[:, None] * g
    return p, np.abs(C.sdf(p, P)).max()


def get_co(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def set_co(me, co):
    me.vertices.foreach_set("co", co.reshape(-1).astype(np.float64))
    me.update()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=os.path.join(ROOT, "build", "body_raw.obj"),
                          forward_axis="Y", up_axis="Z")
    ob = bpy.context.selected_objects[0]
    ob.name = ob.data.name = "CloudBody"
    bpy.context.view_layer.objects.active = ob
    log("raw", len(ob.data.vertices), "verts")

    # 1. voxel remesh: guarantees one closed manifold surface
    ob.data.remesh_voxel_size = 0.012
    ob.data.use_remesh_fix_poles = True
    bpy.ops.object.voxel_remesh()
    log("voxel remesh", len(ob.data.polygons), "faces")

    # 2. snap the voxel surface onto the exact SDF before retopology
    co, err = project(get_co(ob.data))
    set_co(ob.data, co)

    # 3. retopology to an even quad mesh of the target density
    bpy.ops.object.quadriflow_remesh(mode="FACES", target_faces=TARGET_QUADS, seed=7,
                                     use_mesh_symmetry=False, use_preserve_sharp=False,
                                     use_preserve_boundary=False, smooth_normals=False)
    log("quadriflow", len(ob.data.polygons), "faces")

    # 4. exact mirror symmetry: the Mirror modifier bisects at x=0, keeps -X, mirrors it
    mod = ob.modifiers.new("Mirror", "MIRROR")
    mod.use_axis = (True, False, False)
    mod.use_bisect_axis = (True, False, False)
    mod.use_bisect_flip_axis = (True, False, False)   # keep the -X half
    mod.use_clip = True
    mod.use_mirror_merge = True
    mod.merge_threshold = 1e-4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    seam = [v for v in bm.verts if abs(v.co.x) < 1e-3]
    for v in seam:
        v.co.x = 0.0
    bmesh.ops.remove_doubles(bm, verts=seam, dist=1e-4)
    # tiny slivers along the cut
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=0.002)
    bm.to_mesh(ob.data)
    bm.free()

    # 5. relax + project, a few rounds: even edge flow, exactly on the smooth surface
    for _ in range(3):
        sm = ob.modifiers.new("Relax", "SMOOTH")
        sm.factor, sm.iterations = 0.5, 2
        bpy.ops.object.modifier_apply(modifier=sm.name)
        co = get_co(ob.data)
        seam = np.abs(co[:, 0]) < 1e-6
        co, err = project(co)
        co[seam, 0] = 0.0
        set_co(ob.data, co)
    log(f"projected onto SDF, max |sdf| = {err:.2e}")

    # 6. shading: smooth + analytic normals from the SDF gradient
    me = ob.data
    me.shade_smooth()
    g = sdf_grad(get_co(me))
    n = g / np.linalg.norm(g, axis=1, keepdims=True)
    me.normals_split_custom_set_from_vertices([tuple(v) for v in n])

    # 7. UVs (smart project; only the body sheen/AO uses them, the face is decals)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

    report = check(ob)
    with open(os.path.join(ROOT, "build", "mesh_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    log(json.dumps(report))
    bad = [k for k in ("closed", "manifold", "single_component", "genus0") if not report[k]]
    if bad or not (10000 <= report["triangles"] <= 15000):
        log("MESH CHECK FAILED:", bad, report["triangles"])
        sys.exit(1)

    os.makedirs(os.path.join(ROOT, "model"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "model", "cloud.blend"))
    log("saved model/cloud.blend")


def check(ob):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    # connected components
    seen, comps = set(), 0
    for v in bm.verts:
        if v.index in seen:
            continue
        comps += 1
        stack = [v]
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
    V, E, F = len(bm.verts), len(bm.edges), len(bm.faces)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    vol = bm.calc_volume(signed=True)
    bm.free()
    co = get_co(me)
    kd = KDTree(len(co))
    for i, c in enumerate(co):
        kd.insert(c, i)
    kd.balance()
    sym = max(kd.find((-c[0], c[1], c[2]))[2] for c in co)
    el = [(me.vertices[e.vertices[0]].co - me.vertices[e.vertices[1]].co).length for e in me.edges]
    return {
        "verts": V, "edges": E, "faces": F, "triangles": tris,
        "boundary_edges": boundary, "non_manifold_edges": nonman,
        "closed": boundary == 0, "manifold": nonman == 0,
        "components": comps, "single_component": comps == 1,
        "euler": V - E + F, "genus0": V - E + F == 2,
        "volume": round(vol, 5), "outward_normals": vol > 0,
        "mirror_error_max": float(sym),
        "edge_len_min": round(min(el), 5), "edge_len_max": round(max(el), 5),
        "bbox_min": co.min(0).round(4).tolist(), "bbox_max": co.max(0).round(4).tolist(),
    }


main()
