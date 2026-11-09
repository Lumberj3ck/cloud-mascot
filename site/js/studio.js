// Studio: the mascot alone on the warm off-white background, for reviewing shape, material,
// face and animation against the references. Headless test mode:
//   ?shot=<view>[&expr=<face>][&mood=<mood>][&clip=<clip>][&t=<seconds>][&open=0..1]
//   [&az=&el=&dist=&fov=] [&tune={look json}] [&layout={face layout json}] [&noface]
// renders one deterministic frame and sets document.title = "done".
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMascot } from './mascot.js';
import { EXPRESSIONS } from './face.js';
import { MOOD_NAMES, CLIP_NAMES } from './anim.js';
import { Particles } from './fx.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const TARGET = new THREE.Vector3(0, 0.66, 0);

// azimuth (deg, 0 = facing the face, + = toward the viewer's right), elevation (deg), distance, fov
const VIEWS = {
  hero: { az: 15, el: 1, dist: 6.6, fov: 22 },    // yaw from face placement vs refs/front.png
  front: { az: 0, el: 0, dist: 14, fov: 12 },
  side: { az: 90, el: 0, dist: 14, fov: 12 },
  back: { az: 180, el: 0, dist: 14, fov: 12 },
  top: { az: 0, el: 89.9, dist: 14, fov: 12 },
  threequarter: { az: -35, el: 20, dist: 7.6, fov: 22 },
  face: { az: 0, el: 3, dist: 5.2, fov: 13 },
  portrait: { az: 0, el: 7, dist: 7.2, fov: 17 },
  anim: { az: 18, el: 8, dist: 8.4, fov: 22 },     // room above the head for hops and spins
};

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!SHOT });
renderer.setPixelRatio(SHOT ? 1 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.2;
controls.maxDistance = 16;
controls.maxPolarAngle = Math.PI * 0.53;
controls.enablePan = false;

// lights: soft key from upper-left-front, warm bounce, faint cool rim; values from assets/look.json
const hemi = new THREE.HemisphereLight(0xfff7f2, 0xd9c3e3, 1.0);
const key = new THREE.DirectionalLight(0xfff3ea, 2.0);
const rim = new THREE.DirectionalLight(0xf4ecff, 0.8);
rim.position.set(3.6, 2.6, -3.8);
scene.add(hemi, key, rim);

let mascot;
const fx = new Particles();
scene.add(fx.points);
let look = {
  exposure: 1.0, hemi: 1.0, hemiSky: '#fff7f2', hemiGround: '#d9c3e3', key: 2.0, keyColor: '#fff3ea',
  keyAz: -38, keyEl: 42, rim: 0.8,
};

function applyLook(L) {
  look = { ...look, ...L };
  renderer.toneMappingExposure = look.exposure;
  hemi.intensity = look.hemi;
  hemi.color.set(look.hemiSky);
  hemi.groundColor.set(look.hemiGround);
  key.intensity = look.key;
  key.color.set(look.keyColor);
  const az = THREE.MathUtils.degToRad(look.keyAz), el = THREE.MathUtils.degToRad(look.keyEl);
  key.position.set(6 * Math.cos(el) * Math.sin(az), 6 * Math.sin(el), 6 * Math.cos(el) * Math.cos(az));
  rim.intensity = look.rim;
  if (mascot) mascot.applyLook(look);
}

// mean colour of grid cells inside the body's bbox (look tuner support; body = fully opaque pixels)
function cells(nx, ny) {
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 252) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx0 = Math.floor(x0 + (i / nx) * (x1 - x0)), cx1 = Math.floor(x0 + ((i + 1) / nx) * (x1 - x0));
    const cyTop = Math.floor(y1 - (j / ny) * (y1 - y0)), cyBot = Math.floor(y1 - ((j + 1) / ny) * (y1 - y0));
    let r = 0, g = 0, b = 0, n = 0, tot = 0;
    for (let y = cyBot; y < cyTop; y++) for (let x = cx0; x < cx1; x++) {
      tot++;
      const k = (y * w + x) * 4;
      if (px[k + 3] > 252) { r += px[k]; g += px[k + 1]; b += px[k + 2]; n++; }
    }
    out.push(n > 0.8 * tot && n > 0 ? [r / n, g / n, b / n] : null);
  }
  return { cells: out, bbox: [x0, h - 1 - y1, x1, h - 1 - y0], size: [w, h] };
}

function setView(name) {
  const v = { ...(VIEWS[name] || VIEWS.hero) };
  for (const k of ['az', 'el', 'dist', 'fov']) if (params.has(k)) v[k] = Number(params.get(k));
  const az = THREE.MathUtils.degToRad(v.az), el = THREE.MathUtils.degToRad(v.el);
  camera.fov = v.fov;
  camera.position.set(TARGET.x + v.dist * Math.cos(el) * Math.sin(az), TARGET.y + v.dist * Math.sin(el),
    TARGET.z + v.dist * Math.cos(el) * Math.cos(az));
  camera.up.set(0, 1, 0);
  if (v.el > 89) camera.up.set(0, 0, -1);
  camera.lookAt(TARGET);
  camera.updateProjectionMatrix();
  controls.target.copy(TARGET);
  controls.update();
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const _kd = new THREE.Vector3();
function render() {
  camera.updateMatrixWorld();
  _kd.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
  if (mascot) mascot.setKeyDir(_kd);
  fx.setViewport(renderer, camera);
  renderer.render(scene, camera);
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
const pretty = (n) => n.replace(/([A-Z])/g, ' $1').toLowerCase();

async function main() {
  resize();
  setView(SHOT || 'anim');   // interactive: wider view leaves room for the lab panel and hops
  let layout = {};
  if (params.get('layout')) layout = JSON.parse(params.get('layout'));
  mascot = await createMascot({ layout });
  scene.add(mascot.root, mascot.shadow);
  mascot.face.group.visible = !params.has('noface');
  applyLook(mascot.look);
  applyLook(params.get('tune') ? JSON.parse(params.get('tune')) : {});
  const anim = mascot.animator;
  anim.onEvent = (kind) => fx.emit(kind, mascot.root.position);

  if (SHOT) {
    controls.enabled = false;
    document.body.classList.add('shot');
    resize();
    setView(SHOT);
    const t = Number(params.get('t') || 0);
    if (params.get('mood')) anim.setMood(params.get('mood'), 0);
    if (params.get('clip')) anim.play(params.get('clip'));
    if (params.get('mood') || params.get('clip')) {
      for (let k = 0; k < Math.round(t * 60); k++) { anim.update(1 / 60); fx.update(1 / 60); }
    }
    if (params.get('expr')) mascot.face.set(params.get('expr'), 0);
    mascot.face.update(5, params.get('mood') || params.get('clip') ? t : Number(params.get('t') || 0.35), { autoBlink: false });
    if (params.has('open')) { mascot.face.extraOpen = Number(params.get('open')); mascot.face.apply(); }
    render();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    render();
    document.title = 'done';
    return;
  }

  window.addEventListener('resize', resize);
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  const bar = (id) => document.getElementById(id);
  for (const n of Object.keys(EXPRESSIONS)) bar('expressions').appendChild(button(pretty(n), () => mascot.face.set(n)));
  for (const n of MOOD_NAMES) bar('moods').appendChild(button(pretty(n), () => anim.setMood(n)));
  for (const n of CLIP_NAMES) bar('clips').appendChild(button(pretty(n), () => anim.play(n)));

  // tap the cloud -> tap reaction
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => { canvas._down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    const d = canvas._down;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return;   // it was an orbit drag
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(mascot.body, false).length) anim.play('tap');
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    mascot.update(dt, clock.elapsedTime);
    fx.update(dt);
    controls.update();
    render();
  });
}

// deterministic frame capture of a clip or mood (used by scripts/anim_capture.mjs)
async function capture(kind, name, seconds, fps = 20) {
  const anim = mascot.animator;
  mascot.root.position.set(0, 0, 0);
  anim.reset();
  fx.p = [];
  if (kind === 'mood') anim.setMood(name, 0); else anim.play(name);
  const frames = [];
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 120 / fps; k++) { anim.update(1 / 120); fx.update(1 / 120); }
    mascot.face.update(1 / fps, i / fps, { autoBlink: false });
    render();
    frames.push(canvas.toDataURL('image/png'));
  }
  return frames;
}

window.__mascot = { scene, camera, setView, applyLook, cells, render: () => render(), capture,
  face: () => mascot.face, anim: () => mascot.animator, look: () => look };
main().catch((e) => { console.error(e); document.title = 'error'; });
