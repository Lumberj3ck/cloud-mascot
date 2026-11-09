#!/usr/bin/env bash
# Rebuild everything from refs/.
#   ./build.sh            full rebuild (includes the ~10 min lobe fit)
#   SKIP_FIT=1 ./build.sh reuse model/lobes.json
#   FAST=1 ./build.sh     skip the slow Cycles check renders
#   SKIP_TUNE=1 ./build.sh reuse site/assets/look.json
set -euo pipefail
cd "$(dirname "$0")"
BLENDER=${BLENDER:-blender}
PY=.venv/bin/python

if [ ! -x "$PY" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r scripts/requirements.txt
fi

echo "== 1. trace reference silhouettes"
$PY scripts/trace_refs.py > /dev/null

if [ "${SKIP_FIT:-0}" != "1" ] || [ ! -f model/lobes.json ]; then
  echo "== 2. fit lobes to silhouettes (hero + side + top + front)"
  $PY scripts/fit_lobes.py --cold | tail -3
fi

echo "== 3. marching cubes -> Blender remesh/retopo/mirror/project -> model/cloud.blend"
$PY scripts/mesh_from_sdf.py
$BLENDER -b --factory-startup --python scripts/blender_body.py 2>&1 | grep '\[body\]'
test "${PIPESTATUS[0]}" -eq 0

if [ "${FAST:-0}" != "1" ]; then
  echo "== 4. shape check renders (Cycles CPU) + IoU vs references"
  $BLENDER -b model/cloud.blend --python scripts/render_shape.py 2>&1 | grep -E '^\[render_shape\]|Error'
  $PY scripts/compare_shape.py
fi
echo "== 4b. shape keys (lean, dome sway, lobe puff, droop, breathe, spread) from the SDF regions"
$BLENDER -b model/cloud.blend --python scripts/blender_shapekeys.py 2>&1 | grep -E '^\[shapekeys\] saved'

echo "== 5. GLB export (+ SDF ambient occlusion as vertex colour, morph targets) and contact shadow bake"
$BLENDER -b model/cloud.blend --python scripts/blender_export.py 2>&1 | grep '\[export\]'
$PY scripts/bake_shadow.py

echo "== 6. site: vendor pinned three.js"
[ -d node_modules/three ] || npm ci
mkdir -p site/vendor/three/build site/vendor/three/examples/jsm/{loaders,controls,utils,environments,geometries,libs,postprocessing,shaders}
cp node_modules/three/build/three.module.min.js site/vendor/three/build/
cp node_modules/three/LICENSE site/vendor/three/
for f in loaders/GLTFLoader.js controls/OrbitControls.js utils/BufferGeometryUtils.js environments/RoomEnvironment.js geometries/RoundedBoxGeometry.js libs/meshopt_decoder.module.js \
         postprocessing/EffectComposer.js postprocessing/RenderPass.js postprocessing/UnrealBloomPass.js postprocessing/OutputPass.js \
         postprocessing/ShaderPass.js postprocessing/MaskPass.js postprocessing/Pass.js shaders/CopyShader.js \
         shaders/LuminosityHighPassShader.js shaders/OutputShader.js; do
  cp "node_modules/three/examples/jsm/$f" "site/vendor/three/examples/jsm/$f"
done

if [ "${SKIP_TUNE:-0}" != "1" ] || [ ! -f site/assets/look.json ]; then
  echo "== 7. fit lighting/material to refs/front.png colours (headless Chromium)"
  $PY scripts/ref_cells.py
  echo '{}' > site/assets/look.json
  node scripts/tune_look.mjs 1500 | grep -E '_fit'
fi

echo "== 8. browser screenshots (?shot=) + colour comparison"
node scripts/shoot.mjs renders/browser hero front side back top threequarter ui
$PY scripts/compare_material.py | tail -2
$PY scripts/contact_sheet.py renders/browser renders/05_material_views.png

echo "== 9. face: hero placement check + all expressions vs refs/emotions-expressions.png"
$PY scripts/compare_face.py renders/browser/hero.png
EXPR=(happy veryHappy proud sleepy sad surprised love worried determined)
node scripts/shoot.mjs build/expr $(printf 'portrait&expr=%s ' "${EXPR[@]}") > /dev/null
node scripts/shoot.mjs renders/face $(printf 'face&expr=%s ' "${EXPR[@]}") 'face&expr=happy&open=0.35' > /dev/null
$PY scripts/expression_sheet.py build/expr renders/08_expressions.png

echo "== 10. animation: capture every clip + mood (deterministic), GIFs + filmstrips"
node scripts/anim_capture.mjs build/frames 20 | tail -1
$PY scripts/anim_sheets.py build/frames renders/anim

echo "== 11. the room: preset scenes at 1440x900"
SHOT_W=1440 SHOT_H=900 node scripts/shoot.mjs renders/room 'index.html:room&scene=day&ui' \
  'index.html:room&scene=celebrate&t=0.95' 'index.html:room&scene=night' 'index.html:room&scene=sad' \
  'index.html:room&scene=unlocks' 'index.html:room&scene=determined&ui'
echo "== done"
