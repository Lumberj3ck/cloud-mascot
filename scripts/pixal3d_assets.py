"""Generate the planet-world models with Pixal3D on the Nebius GPU VM, end to end.

  .venv/bin/python scripts/pixal3d_assets.py --host lumberj3ck@<ip> [--only planet_ocean,item_lamp] [--fetch-only]

1. uploads assets_src/planets/<id>.png (those without a model yet) and scripts/pixal3d_batch.py to the VM
2. runs the batch there (models loaded once; GLB export at web scale), waiting for it to finish
3. downloads the GLBs to build/pixal3d/<id>.glb
4. optimises them (gltf-transform: meshopt geometry, WebP textures <= 1024 px) -> site/assets/planets/<id>.glb
5. writes site/assets/planets/models.json (the list the demo loads)
VM setup: scripts/pixal3d_vm_setup.sh.
"""
import argparse
import glob
import json
import os
import subprocess
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SSH = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20",
       "-o", "ServerAliveInterval=30", "-o", "LogLevel=ERROR"]
RUN = ("source ~/miniforge3/etc/profile.d/conda.sh && conda activate trellis2 && "
       "export CUDA_HOME=$CONDA_PREFIX PATH=$CONDA_PREFIX/bin:$PATH && "
       "python ~/pixal3d_batch.py --in ~/jobs/in --out ~/jobs/out --faces {faces} --texture {texture}")


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--faces", type=int, default=80000)
    ap.add_argument("--texture", type=int, default=2048)
    ap.add_argument("--fetch-only", action="store_true", help="skip generation; download + optimise what exists")
    a = ap.parse_args()
    out_dir = os.path.join(ROOT, "site/assets/planets")
    raw_dir = os.path.join(ROOT, "build/pixal3d")
    os.makedirs(raw_dir, exist_ok=True)
    ids = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(ROOT, "assets_src/planets/*.png")))
    if a.only:
        ids = [i for i in ids if i in a.only.split(",")]
    todo = [i for i in ids if not os.path.exists(os.path.join(out_dir, f"{i}.glb"))]
    print(f"{len(todo)} to generate: {todo}", flush=True)

    if todo and not a.fetch_only:
        sh(["ssh", *SSH, a.host, "mkdir -p ~/jobs/in ~/jobs/out"])
        sh(["scp", *SSH, os.path.join(ROOT, "scripts/pixal3d_batch.py"), f"{a.host}:"])
        sh(["scp", *SSH, *[os.path.join(ROOT, f"assets_src/planets/{i}.png") for i in todo], f"{a.host}:jobs/in/"])
        t0 = time.time()
        sh(["ssh", *SSH, a.host, RUN.format(faces=a.faces, texture=a.texture) + " 2>&1 | grep '\\[batch\\]'"])
        print(f"batch finished in {time.time() - t0:.0f}s", flush=True)

    for i in todo:
        raw = os.path.join(raw_dir, f"{i}.glb")
        if not os.path.exists(raw):
            r = subprocess.run(["scp", *SSH, f"{a.host}:jobs/out/{i}.glb", raw], text=True, capture_output=True)
            if r.returncode:
                print(f"  {i}: not generated ({r.stderr.strip()[:80]})")
                continue
        dst = os.path.join(out_dir, f"{i}.glb")
        sh([os.path.join(ROOT, "node_modules/.bin/gltf-transform"), "optimize", raw, dst,
            "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024"],
           stdout=subprocess.DEVNULL)
        print(f"  {i}: {os.path.getsize(raw) / 1e6:.1f} MB -> {os.path.getsize(dst) / 1e6:.2f} MB", flush=True)

    models = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(out_dir, "*.glb")))
    json.dump(models, open(os.path.join(out_dir, "models.json"), "w"))
    print("models.json:", models)


if __name__ == "__main__":
    main()
