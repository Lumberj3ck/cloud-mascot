"""Blender (headless): shape-only check renders of model/cloud.blend.

  blender -b model/cloud.blend --python scripts/render_shape.py

Writes to build/shape/:
  mask_<view>.png   Workbench flat silhouettes at the reference pixel scale (for IoU)
  clay_<view>.png   Cycles (CPU) clay renders, transparent film + shadow catcher
  zebra.png         glossy stripe-reflection render: any lump/ripple bends the stripes
  cams.json         camera <-> reference pixel mapping
Views: front / side / back / top match refs/turnaround.png; hero matches refs/front.png
using the camera yaw/pitch fitted in model/lobes.json.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "build", "shape")
os.makedirs(OUT, exist_ok=True)
FIT = json.load(open(os.path.join(ROOT, "model", "lobes.json")))
META = json.load(open(os.path.join(ROOT, "build", "ref_masks.json")))

S_TURN = META["t_front"]["w"] / 2.0                      # px per unit, turnaround
S_TOP = META["t_top"]["w"] / 2.0
S_HERO = META["hero"]["w"] / 2.0 * FIT["hero_camera"]["hs"]
ZC = 0.72                                                  # camera centre height
LAV = (0.74, 0.60, 0.82)                                   # linear clay tint (shape check only)

VIEWS = {
    # name: (location, rotation_deg, px/unit, W, H)
    "front": ((0, -10, ZC), (90, 0, 0), S_TURN, 720, 520),
    "side": ((10, 0, ZC), (90, 0, 90), S_TURN, 720, 520),
    "back": ((0, 10, ZC), (90, 0, 180), S_TURN, 720, 520),
    "top": ((0, 0, 10), (0, 0, 0), S_TOP, 720, 520),
    "hero": ((0, -10, ZC), (90, 0, 0), S_HERO, 1300, 1000),
}

scene = bpy.context.scene
body = bpy.data.objects["CloudBody"]

# pivot so the hero view can turn the toy exactly like the fitted reference camera
pivot = bpy.data.objects.new("HeroPivot", None)
scene.collection.objects.link(pivot)
pivot.rotation_mode = "ZYX"  # Z first, then X:  p_r = Rx(pitch) Rz(yaw) p
body.parent = pivot

cam_data = bpy.data.cameras.new("Cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def set_view(name):
    loc, rot, s, W, H = VIEWS[name]
    cam.location = loc
    cam.rotation_euler = [math.radians(a) for a in rot]
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    cam_data.ortho_scale = max(W, H) / s
    if name == "hero":
        pivot.rotation_euler = (FIT["hero_camera"]["pitch"], 0.0, FIT["hero_camera"]["yaw"])
    else:
        pivot.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    return {"W": W, "H": H, "s": s, "zc": loc[2] if name != "top" else 0.0}


def masks():
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (1, 1, 1)
    scene.render.film_transparent = True
    scene.display.render_aa = "8"
    cams = {}
    for name in VIEWS:
        cams[name] = set_view(name)
        scene.render.filepath = os.path.join(OUT, f"mask_{name}.png")
        bpy.ops.render.render(write_still=True)
    json.dump(cams, open(os.path.join(OUT, "cams.json"), "w"), indent=1)


def clay_material():
    m = bpy.data.materials.new("Clay")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*LAV, 1)
    b.inputs["Roughness"].default_value = 0.62
    b.inputs["Specular IOR Level"].default_value = 0.35
    return m


def zebra_material():
    m = bpy.data.materials.new("Chrome")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.9, 0.9, 0.9, 1)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.04
    return m


def world_soft():
    w = bpy.data.worlds.new("Soft")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.95, 0.92, 0.9, 1)
    bg.inputs["Strength"].default_value = 0.30
    scene.world = w


def world_stripes():
    w = bpy.data.worlds.new("Stripes")
    w.use_nodes = True
    nt = w.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    math_n = nt.nodes.new("ShaderNodeMath")
    math_n.operation = "MULTIPLY"
    math_n.inputs[1].default_value = 9.0
    sine = nt.nodes.new("ShaderNodeMath")
    sine.operation = "SINE"
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 0.0
    bg = nt.nodes["Background"]
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], math_n.inputs[0])
    nt.links.new(math_n.outputs[0], sine.inputs[0])
    nt.links.new(sine.outputs[0], gt.inputs[0])
    nt.links.new(gt.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    scene.world = w


def lights():
    key = bpy.data.lights.new("Key", "AREA")
    key.energy, key.size = 320, 4.0
    k = bpy.data.objects.new("Key", key)
    k.location = (-3.2, -4.0, 4.6)
    k.rotation_euler = (math.radians(48), 0, math.radians(-38))
    scene.collection.objects.link(k)
    rim = bpy.data.lights.new("Rim", "AREA")
    rim.energy, rim.size = 110, 3.0
    r = bpy.data.objects.new("Rim", rim)
    r.location = (3.5, 4.0, 3.0)
    r.rotation_euler = (math.radians(-55), 0, math.radians(140))
    scene.collection.objects.link(r)


def ground():
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "Ground"
    g.is_shadow_catcher = True
    g.parent = pivot
    return g


def cycles_setup(samples):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"


def clay():
    body.data.materials.clear()
    body.data.materials.append(clay_material())
    world_soft()
    lights()
    g = ground()
    cycles_setup(96)
    for name in VIEWS:
        set_view(name)
        # the hero turns the toy (pivot), so a parented ground would tilt into view;
        # the top view would just show the cast shadow sprawling around it.
        g.hide_render = name in ("hero", "top")
        scene.render.filepath = os.path.join(OUT, f"clay_{name}.png")
        bpy.ops.render.render(write_still=True)


def zebra():
    body.data.materials.clear()
    body.data.materials.append(zebra_material())
    bpy.data.objects["Ground"].hide_render = True
    for n in ("Key", "Rim"):
        bpy.data.objects[n].hide_render = True
    world_stripes()
    cycles_setup(48)
    scene.render.film_transparent = False
    pivot.rotation_euler = (0, 0, 0)
    cam_data.type = "PERSP"
    cam_data.lens = 70
    cam.location = (-3.4, -5.6, 2.4)
    cam.rotation_euler = (math.radians(74), 0, math.radians(-31))
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.filepath = os.path.join(OUT, "zebra.png")
    bpy.ops.render.render(write_still=True)


masks()
if "--masks-only" not in sys.argv:
    clay()
    zebra()
print("[render_shape] done", flush=True)
