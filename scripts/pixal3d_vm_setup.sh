#!/usr/bin/env bash
# One-time setup of TencentARC/Pixal3D (on top of microsoft/TRELLIS.2) on a Nebius GPU VM.
# Run on the VM:  nohup bash pixal3d_vm_setup.sh > ~/setup.log 2>&1 &
# The system CUDA may be 13.x; TRELLIS.2 builds its extensions against torch 2.6 + CUDA 12.4, so the matching
# CUDA 12.4 toolkit is installed inside the conda env and used as CUDA_HOME.
# Ends with a smoke test on Pixal3D's example image -> ~/smoke.glb, then prints "SETUP OK".
set -eo pipefail
echo "== $(date +%T) GPU"
nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader
ARCH=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1)   # 9.0 on H100, 8.9 on L40S

echo "== $(date +%T) system packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git wget build-essential libgl1 libglib2.0-0 \
  libjpeg-dev zlib1g-dev > /dev/null

echo "== $(date +%T) miniforge"
if [ ! -d ~/miniforge3 ]; then
  wget -q https://github.com/conda-forge/miniforge/releases/download/24.11.3-2/Miniforge3-24.11.3-2-Linux-x86_64.sh -O /tmp/mf.sh
  bash /tmp/mf.sh -b -p ~/miniforge3
fi
source ~/miniforge3/etc/profile.d/conda.sh

echo "== $(date +%T) env trellis2: python 3.10 + CUDA 12.4 toolkit + torch 2.6 cu124"
conda env list | grep -q '^trellis2 ' || conda create -y -q -n trellis2 python=3.10
conda activate trellis2
[ -x "$CONDA_PREFIX/bin/nvcc" ] || conda install -y -q -c "nvidia/label/cuda-12.4.1" cuda-toolkit
export CUDA_HOME=$CONDA_PREFIX PATH=$CONDA_PREFIX/bin:$PATH
export TORCH_CUDA_ARCH_LIST="$ARCH" MAX_JOBS=$(nproc)
nvcc --version | tail -1
python -c "import torch" 2>/dev/null || pip install -q torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -c "import torch; print('torch', torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
pip install -q packaging wheel ninja psutil
python -c "import flash_attn" 2>/dev/null || pip install -q flash-attn==2.7.3 --no-build-isolation

echo "== $(date +%T) TRELLIS.2 dependencies + CUDA extensions"
cd ~
[ -d TRELLIS.2 ] || git clone -q -b main --recursive https://github.com/microsoft/TRELLIS.2.git
cd TRELLIS.2
set +u
. ./setup.sh --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm
python -c "import nvdiffrast.torch, cumesh, flex_gemm, o_voxel; print('extensions OK')"

echo "== $(date +%T) Pixal3D"
cd ~
[ -d Pixal3D ] || git clone -q https://github.com/TencentARC/Pixal3D.git
cd Pixal3D
# MoGe's latest deps clash with the trimesh pin: install it without deps
grep -v MoGe requirements.txt > /tmp/req.txt && pip install -q -r /tmp/req.txt
pip install -q --no-deps git+https://github.com/microsoft/MoGe.git
# MoGe 3 imports utils3d_moge (its own copy, distinct from the utils3d that Pixal3D/TRELLIS use)
pip install -q --no-deps "utils3d_moge @ git+https://github.com/EasternJournalist/utils3d-moge.git@62f09d58509485564e24d5d9f6aac9ee9ebc0c37"
NATTEN_CUDA_ARCH="$ARCH" NATTEN_N_WORKERS=$(nproc) pip install -q natten==0.21.0 --no-build-isolation
pip install -q https://github.com/LDYang694/Storages/releases/download/20260430/utils3d-0.0.2-py3-none-any.whl

echo "== $(date +%T) weights + open background remover"
# pipeline.json points the BiRefNet background remover at the gated briaai/RMBG-2.0; use the open
# ZhengPeng7/BiRefNet (MIT, same architecture) instead. (RGBA inputs with real alpha skip it anyway.)
python -c "from huggingface_hub import snapshot_download; snapshot_download('TencentARC/Pixal3D', allow_patterns=['pipeline*.json'])"
for f in ~/.cache/huggingface/hub/models--TencentARC--Pixal3D/snapshots/*/pipeline*.json; do
  sed -i "s#briaai/RMBG-2.0#ZhengPeng7/BiRefNet#" "$(readlink -f "$f")"
done

echo "== $(date +%T) smoke test"
IMG=$(ls assets/images/* 2>/dev/null | head -1)
python inference.py --image "$IMG" --output ~/smoke.glb
ls -la ~/smoke.glb
echo "== $(date +%T) SETUP OK"
