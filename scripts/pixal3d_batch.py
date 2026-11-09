"""Batch image -> GLB with Pixal3D, loading the models once. Runs ON the GPU VM, inside ~/Pixal3D:

  python ~/pixal3d_batch.py --in ~/jobs/in --out ~/jobs/out [--faces 80000] [--texture 2048]

Wraps Pixal3D's own inference.run_inference without editing it:
  - init_pipeline is cached, so the ~1-2 min model load happens once for the whole batch;
  - the GLB export (o_voxel.postprocess.to_glb) is called with web-scale decimation/texture settings
    instead of the default 1M faces / 4096 px.
Skips images whose output already exists; prints one line per asset with timing.
"""
import argparse
import functools
import glob
import os
import sys
import time

sys.path.insert(0, os.path.expanduser("~/Pixal3D"))
os.chdir(os.path.expanduser("~/Pixal3D"))
import inference as P  # noqa: E402
import o_voxel  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="inp", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--faces", type=int, default=80000)
ap.add_argument("--texture", type=int, default=2048)
ap.add_argument("--seed", type=int, default=42)
a = ap.parse_args()

P.init_pipeline = functools.lru_cache(maxsize=1)(P.init_pipeline)
_to_glb = o_voxel.postprocess.to_glb


def to_glb_web(*args, **kw):
    kw["decimation_target"] = a.faces
    kw["texture_size"] = a.texture
    return _to_glb(*args, **kw)


o_voxel.postprocess.to_glb = to_glb_web

os.makedirs(a.out, exist_ok=True)
images = sorted(glob.glob(os.path.join(a.inp, "*.png")))
print(f"[batch] {len(images)} images, faces={a.faces}, texture={a.texture}", flush=True)
for img in images:
    name = os.path.splitext(os.path.basename(img))[0]
    out = os.path.join(a.out, f"{name}.glb")
    if os.path.exists(out):
        print(f"[batch] = {name} (exists)", flush=True)
        continue
    t0 = time.time()
    try:
        P.run_inference(image_path=img, output_path=out, seed=a.seed)
        print(f"[batch] OK {name} {os.path.getsize(out) / 1e6:.1f} MB {time.time() - t0:.0f}s", flush=True)
    except Exception as e:  # keep going: one bad asset should not stop the batch
        print(f"[batch] FAIL {name}: {type(e).__name__}: {e}", flush=True)
print("[batch] DONE", flush=True)
