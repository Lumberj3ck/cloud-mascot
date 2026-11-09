# Cloud mascot — handoff

## Status
- [x] (a) shape — procedural lobe body, fitted to the reference silhouettes (approved)
- [x] (b) material in the browser (three.js) (approved)
- [x] (c) face + expressions (decal layers) (approved, deployed)
- [x] (d) animations + the room (habit-streak game demo) — awaiting review
- [x] Vercel: https://cloud-mascot.vercel.app (project `cloud-mascot`, redeployed 2026-11-09 from `site/` at checkpoint c, face + expressions)

## Inputs
- `refs/front.png` hero (source of truth for shape/colour/face)
- `refs/turnaround.png` front/side/back/top
- `refs/emotions-expressions.png` the 9 face states (happy, very happy, proud, sleepy, sad, surprised, love, worried, determined)
- **Missing:** `refs/emotions.png` (body moods: squash/stretch/lean/droop/bounce) is referenced by the brief but not in `refs/`.

## Shape pipeline (checkpoint a)
`./build.sh` (or `SKIP_FIT=1 ./build.sh` to reuse `model/lobes.json`)

1. `scripts/trace_refs.py` traces silhouettes by colour threshold (lavender has B > G; cream bg, grey shadow,
   brown eyes, pink blush do not), fills face holes → `build/ref_masks.npz`, `renders/00_ref_masks.png`.
2. `scripts/fit_lobes.py` fits an SDF of soft lobes (`scripts/cloud_sdf.py`) to the silhouettes with Powell:
   - lobes: centre dome (ellipsoid), two mirrored side lobes (ellipsoids), a base ellipsoid;
   - blended with a **cubic (C2) smooth-min**: no crease and no curvature seam between lobes;
   - flat-ish base: smooth intersection with the ground plane z = 0;
   - exactly mirror-symmetric by construction;
   - the hero (`front.png`) is a slightly turned 3/4 shot, so its camera yaw/pitch/scale is fitted together with the
     shape; side/top/front turnaround views constrain depth and lobe layout.
3. `scripts/mesh_from_sdf.py` marching cubes → `build/body_raw.obj`.
4. `scripts/blender_body.py` (headless Blender): voxel remesh → QuadriFlow (~6k quads ≈ 12k tris) → Mirror-modifier
   bisect at x = 0 + seam weld → relax + project every vertex back onto the exact SDF → analytic custom normals → smart
   UVs → integrity checks (fail the build otherwise) → `model/cloud.blend`.
5. `scripts/render_shape.py` + `scripts/compare_shape.py`: Workbench silhouettes at reference pixel scale for IoU,
   Cycles CPU clay renders side by side with the references (`renders/02_shape_vs_refs.png`), and a chrome/stripe
   zebra render (`renders/03_zebra.png`): lumps or ripples would bend the stripes.

Coordinates: Blender, Z up, face toward −Y, ground z = 0, width ≈ 2.0 units.

### Current result (units: width 2.0)
| lobe | centre (x, y, z) | radii (x, depth, z) |
|---|---|---|
| dome | (0, +0.09, 0.86) | 0.57, 0.52, 0.56 |
| side lobes ×2 | (±0.54, −0.08, 0.49) | 0.46, 0.45, 0.50 |
| base | (0, 0, 0.42), cut flat at z = 0 | 0.73, 0.64, 0.59 |

Blends: dome↔lobes k = 0.18 (capped by design), lobes↔base 0.19, ground edge 0.12. Overall 2.0 × 1.28 × 1.42.
Mesh: 6066 verts / 12128 tris, closed, manifold, 1 component, genus 0, mirror error 0.
Silhouette IoU of the mesh: hero 0.967, front 0.979, side 0.982, back 0.981, top 0.964.
Known gaps: dome flanks a few px narrower and shoulders a little softer than the turnaround; top view's dome
protrudes front/back slightly less than the reference.

## Material + browser demo (checkpoint b)
Run locally: `python3 -m http.server -d site 8000` → http://localhost:8000 (orbit/zoom, view buttons).
Test mode: `?shot=hero|front|side|back|top|threequarter` renders one deterministic frame, then sets
`document.title = "done"`. Extra overrides for tooling: `&az=&el=&dist=&fov=` and `&tune={json look}`.
`node scripts/shoot.mjs <outdir> [shots…]` screenshots them with headless Chromium (SwiftShader); `ui` = normal page.

- three.js **0.170.0** pinned exactly (`package.json`), vendored into `site/vendor/three/` by `build.sh`.
- `scripts/blender_export.py`: GLB (+Y up, face +Z) with analytic normals and SDF ambient occlusion in COLOR_0.
- `scripts/bake_shadow.py`: contact shadow from the SDF (cone-traced hemisphere visibility, local range) → PNG.
- `site/js/vinyl.js`: MeshPhysicalMaterial (roughness ≈ 0.6, low specular, sheen for soft-touch) + shader
  additions: fake-subsurface edge glow, half-Lambert wrap from the key direction (soft-box falloff), live ground
  contact darkening (fades when it hops), AO mix. No normal map, no textures on the body.
- Lighting: hemisphere (warm sky / pink-lavender bounce), soft key from upper-left-front, faint cool rim, RoomEnvironment
  at low intensity, Neutral tone mapping, transparent canvas over the warm off-white page (#fdf6f1).
- `site/assets/look.json` is **fitted**: `scripts/tune_look.mjs` (Nelder-Mead, ~75 s) matches a 16×12 grid of body
  colours from `refs/front.png` (face cells excluded, `scripts/ref_cells.py`) in the hero view.
- Hero camera: az 34°, el 1° — chosen by silhouette IoU grid search against `front.png`.
- `scripts/compare_material.py` → `renders/04_material_hero.png` + per-region colour table; mean |Δ| ≈ 6/255.
  Remaining: reference left lobe is brighter/warmer (−7..−14), our lower body slightly darker (−12).
- AO deliberately mixed at 35%: full SDF AO smudged the lobe/base valleys (looked lumpy); real soft-touch vinyl
  scatters light into them.

## Face (checkpoint c)
`site/js/face.js`, layout in `site/assets/face_layout.json`, presets in `EXPRESSIONS`.
- Thin patch cut from the body's front triangles at runtime (keeps morph targets → follows body deformation).
- Separate layer meshes on that patch, each nudged out along the normal + polygon offset:
  `FaceBlush` < `FaceEyes` (eyes, lids, brows, hearts) = `FaceMouth` < `FaceHighlights` < `FaceExtras` (tear),
  plus `FaceZzz` (camera-facing card, floating Z glyphs).
- Every feature is an analytic 2D SDF evaluated per pixel (circles, arcs, quadratic Béziers, heart, drop, Z glyphs),
  antialiased with `fwidth`: crisp at any zoom, no textures.
- Each feature has its own decal frame (raycast onto the body; axis 65 % toward the face direction, 35 % surface
  normal) so nothing stretches on the curved surface yet stays upright like printed artwork.
- Continuous parameters (per eye: open/blink, arc, closed, heart, lid + angle, brow + angle, scale; mouth: curve,
  width, smirk, wavy, open D, round O, height; blush, tear, zzz). `face.set(name, dur)` blends between presets;
  auto-blink every 2.2–5.6 s (170 ms).
- Finish: warm brown ink with a soft inner glow, tilted oval highlight, faint light rim around ink (raised print),
  peach blush discs, glossy tear.
- Layout fitted to `refs/front.png` with `scripts/measure_face.py` / `scripts/compare_face.py` (eye midpoint,
  spacing, height, size, mouth): all within ~0.01 of the reference → `renders/07_face_hero.png`.
  This also fixed the hero camera yaw (15°, from the face position; the silhouette-only search had said 34°).
- All nine states vs `refs/emotions-expressions.png`: `renders/08_expressions.png`; close-ups in `renders/face/`.
- Note: the expression sheet draws the face larger relative to the body than the hero; we follow the hero.
- Test mode: `?shot=face|portrait&expr=<name>[&open=0.35][&t=seconds]`.

## Animation (checkpoint d)
No humanoid rig, no VRM. Three layers, all code-driven and deterministic (fixed 120 Hz steps):
- **Shape keys** (`scripts/blender_shapekeys.py` → glTF morph targets): Breathe, Spread, LeanX, LeanY, DomeX, DomeY,
  DomeUp, LobeL, LobeR, Droop. Region weights (dome / left lobe / right lobe) come from the lobe SDF, so each key
  fades out across the C2 blends: no seams. The face patch shares the body's morph weights, so it deforms too.
- **Volume-preserving squash & stretch** on a group scaled about the base (y = s, xz = 1/√s) + Spread key.
- **Secondary jiggle**: damped springs (dome sway, lobe puff, squash rebound) driven by the root's accelerations;
  gains/stiffness in `TUNING` (`site/js/anim.js`).
- **Moods** (looping idle per emotion): happy, veryHappy, proud, sleepy, sad, surprised, love, worried, determined.
- **Clips** (one-shots over the mood): blink, hop, happyWiggle, celebrateSpin, tap, surprised, sadSigh, sleepyNod,
  proudPuff, loveSway, worriedShiver, determinedBounce. Hop locomotion: `animator.moveTo(x, z)`.
- Particles (`site/js/fx.js`): hearts, sparkles, confetti, rain, sun-drops: SDF point sprites, seeded RNG.
- Review: `studio.html` (buttons for every mood/clip/face; tap the cloud) and `?shot=anim&clip=hop&t=0.6`.
  `scripts/anim_capture.mjs` + `scripts/anim_sheets.py` → `renders/anim/*.gif`, `renders/09_clips.png`, `renders/10_moods.png`.
- `refs/emotions.png` (body moods) was never provided; body poses per emotion are my interpretation.

## The room (index.html)
`site/js/room.js` (procedural diorama: floor, walls, window with a day/night/rain/rainbow sky shader, bed, rug,
shelf, streak board as a canvas texture, unlockables) + `site/js/game.js` (state, mechanics, UI).
- Habits (4): checking one sends a sun-drop to Nimbus (+joy, hop/wiggle); all done → celebrate spin + confetti.
- End day: all done → streak +1, proud; milestones unlock plant (3), lamp (5), trophy (7), rainbow (14).
  Missed → a streak shield (1 to start, +1 every 7 days) saves it, otherwise streak 0, rain outside, sad cloud.
- Joy and energy drift; mood follows (sleepy / sad / worried / determined when 1 habit is left / love / happy).
- Sleep (button or tap the bed): hops into bed, night lighting, lamp on; wake: surprised hop back to the rug.
- Tap Nimbus to pet; tap the floor and it hops there; it wanders when idle. Progress saved in localStorage.
- Lab drawer: every mood, clip and face + "Perfect day", "Unlock all", "Reset".
- Test mode: `index.html?shot=room&scene=day|celebrate|night|sad|unlocks|determined[&t=][&ui]`;
  `window.__room.advance(sec)` steps game time for tests (headless software GL only renders a few fps).
- Verified by a scripted headless playthrough (habits → 3 perfect days → shield → streak break → sleep → wake →
  pet → floor tap): states and moods as expected, no console errors → `renders/11_room_playthrough.png`,
  scenes → `renders/12_room_scenes.png`.

## Deploy (Vercel)
- `cd site && vercel deploy --yes` (project linked in `site/.vercel`; CLI 65 made the first deploy a **production** deploy).
- `vercel link` writes a Vercel OIDC token to `site/.env.local`. `site/.vercelignore` excludes `.env*` (and `*.blend`);
  verified on the live site: `/.env.local`, `/.env`, `/.vercel/project.json` → 404. Never remove that ignore line.
- The per-deployment URL is behind Vercel's login (default deployment protection); the public link is the alias above.

## Decisions
- Shape from an analytic SDF, not sculpting or image-to-3D: smooth by construction, reproducible, tunable.
- The mesh's vertices sit exactly on the SDF surface and its normals are the SDF gradient, so smoothness comes from
  geometry (no normal map).
