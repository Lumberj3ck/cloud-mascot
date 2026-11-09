// The cloud's room: a small habit-streak game loop around the mascot.
//   - Check off today's habits: each one sends a sun-drop to the cloud (joy up, a happy hop).
//   - All done: celebration spin + confetti. "End day" grows the streak (or breaks it: rain, sad cloud).
//   - Streak milestones unlock room decorations (plant, lamp, trophy, rainbow).
//   - Joy and energy drift; the cloud's mood (sleepy / sad / worried / determined / happy / love) follows.
//   - Sleep: it hops into bed, the room goes to night. Tap it to pet; tap the floor and it hops there.
// Headless test mode: index.html?shot=room&scene=day|celebrate|night|sad|unlocks[&t=sec][&cam=close]
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMascot } from './mascot.js';
import { Particles } from './fx.js';
import { Room, SPOTS, BED_HEIGHT, FLOOR_BOUNDS, UNLOCKS } from './room.js';
import { MOOD_NAMES, CLIP_NAMES } from './anim.js';
import { EXPRESSIONS } from './face.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const STORE = 'nimbus-room-v1';

const HABITS = [
  { id: 'water', label: 'Drink water', icon: 'drop' },
  { id: 'read', label: 'Read 10 pages', icon: 'book' },
  { id: 'stretch', label: 'Stretch 5 min', icon: 'leaf' },
  { id: 'phone', label: 'No phone in bed', icon: 'moon' },
];
const fresh = () => ({ name: 'Nimbus', day: 1, streak: 0, best: 0, history: [], joy: 0.62, energy: 0.85,
  asleep: false, slept: false, done: {}, unlocked: [], shields: 1 });

// ------------------------------------------------------------------ renderer / scene / camera
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!SHOT });
renderer.setPixelRatio(SHOT ? 1 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f6e9e4');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 7;
controls.maxDistance = 24;
controls.minPolarAngle = 0.55;
controls.maxPolarAngle = 1.32;
controls.minAzimuthAngle = -0.35;
controls.maxAzimuthAngle = 1.15;
const CAMS = {
  room: { pos: [7.9, 7.4, 14.6], target: [-0.3, 1.5, -1.4] },
  close: { pos: [3.6, 3.4, 8.2], target: [0.2, 1.0, 0.0] },
};
function setCam(name) {
  const c = CAMS[name] || CAMS.room;
  camera.position.set(...c.pos);
  controls.target.set(...c.target);
  controls.update();
}

// lights (studio-tuned values from assets/look.json, plus a lamp and a night mood)
const hemi = new THREE.HemisphereLight(0xfff7f2, 0xd9c3e3, 1.0);
const key = new THREE.DirectionalLight(0xfff3ea, 2.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
key.shadow.radius = 6;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
const rim = new THREE.DirectionalLight(0xf4ecff, 0.8);
rim.position.set(3.6, 5, -8);
const fill = new THREE.DirectionalLight(0xffeef4, 0.55);   // soft fill from the right: keeps the left wall warm
fill.position.set(9, 4, 5);
const moon = new THREE.DirectionalLight(0xb9b4ff, 0);       // night: cool light through the window
moon.position.set(2, 6, -9);
scene.add(hemi, key, key.target, rim, fill, moon);
let base = { hemi: 1, key: 2, rim: 0.8, ground: '#d9c3e3' };

const room = new Room(scene);
const fx = new Particles(11);
scene.add(fx.points);
let mascot, anim;
let state = fresh();
let nightK = 0, rainK = 0, rainUntil = -1, tempMood = null, now = 0, nextWander = 6, petCount = 0;

// ------------------------------------------------------------------ state persistence
function load() {
  if (SHOT) return;
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.history) state = { ...fresh(), ...s }; } catch { /* fresh */ }
}
function save() {
  if (SHOT) return;
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------------ mood logic
const doneCount = () => HABITS.filter((h) => state.done[h.id]).length;
function moodFor() {
  if (state.asleep) return 'sleepy';
  if (tempMood && now < tempMood.until) return tempMood.name;
  if (state.energy < 0.18) return 'sleepy';
  if (state.joy < 0.28) return 'sad';
  if (state.joy < 0.42) return 'worried';
  if (HABITS.length - doneCount() === 1) return 'determined';
  if (state.joy > 0.9) return 'love';
  return 'happy';
}
const MOOD_TEXT = { happy: 'feeling cozy', veryHappy: 'over the moon', proud: 'so proud of you', sleepy: 'sleepy…',
  sad: 'a little rainy inside', surprised: 'oh!', love: 'full of love', worried: 'a bit worried', determined: 'one more to go!' };

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const ICONS = {
  drop: '<path d="M12 3c3.5 4.2 6 7.4 6 10.4A6 6 0 0 1 6 13.4C6 10.4 8.5 7.2 12 3Z"/>',
  book: '<path d="M4 5.5C6.5 4.5 9.5 4.7 12 6.2c2.5-1.5 5.5-1.7 8-.7V18c-2.5-1-5.5-.8-8 .7-2.5-1.5-5.5-1.7-8-.7Z"/><path d="M12 6.2v12.5"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19 13 11"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
};
function renderUI() {
  $('name').textContent = state.name;
  $('day').textContent = `Day ${state.day}`;
  $('streak').textContent = state.streak;
  $('best').textContent = state.best;
  $('shields').textContent = state.shields;
  $('joyBar').style.width = `${Math.round(state.joy * 100)}%`;
  $('energyBar').style.width = `${Math.round(state.energy * 100)}%`;
  $('moodLabel').textContent = MOOD_TEXT[anim ? anim.mood : 'happy'] || '';
  $('progress').textContent = `${doneCount()}/${HABITS.length}`;
  $('ring').style.setProperty('--p', doneCount() / HABITS.length);
  const list = $('habitList');
  if (!list.children.length) {            // build once; later renders only update state (no lost clicks)
    for (const h of HABITS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'habit';
      b.dataset.id = h.id;
      b.innerHTML = `<span class="ico"><svg viewBox="0 0 24 24">${ICONS[h.icon]}</svg></span><span class="lbl">${h.label}</span>
        <span class="chk"><svg viewBox="0 0 24 24"><path d="M6 12.5 10.2 16.5 18 8"/></svg></span>`;
      b.addEventListener('click', () => toggleHabit(h.id));
      li.appendChild(b);
      list.appendChild(li);
    }
  }
  for (const b of list.querySelectorAll('.habit')) {
    const on = !!state.done[b.dataset.id];
    b.classList.toggle('done', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('sleepBtn').textContent = state.asleep ? 'Wake up' : 'Sleep';
  room.drawBoard(state);
}
function toast(text, kind = '') {
  if (SHOT) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

// ------------------------------------------------------------------ mechanics
const later = [];   // scheduled callbacks on game time (deterministic in shots)
const after = (sec, fn) => later.push({ at: now + sec, fn });

function toggleHabit(id) {
  if (state.asleep) { toast('Shh… wake Nimbus first'); return; }
  state.done[id] = !state.done[id];
  if (state.done[id]) {
    state.joy = Math.min(1, state.joy + 0.14);
    fx.emit('sun', mascot.root.position);
    after(1.0, () => {
      fx.emit('sparkle', mascot.root.position);
      if (doneCount() === HABITS.length) {
        anim.play('celebrateSpin');
        tempMood = { name: 'veryHappy', until: now + 5 };
        toast('All done today! ☀', 'big');
      } else anim.play(doneCount() % 2 ? 'hop' : 'happyWiggle');
    });
  } else {
    state.joy = Math.max(0, state.joy - 0.1);
    anim.play('worriedShiver');
  }
  save(); renderUI();
}

function pet() {
  petCount++;
  state.joy = Math.min(1, state.joy + 0.05);
  anim.play(state.joy > 0.85 && petCount % 3 === 0 ? 'loveSway' : 'tap');
  save(); renderUI();
}

function goTo(x, z) {
  if (state.asleep) return;
  x = THREE.MathUtils.clamp(x, FLOOR_BOUNDS.x0, FLOOR_BOUNDS.x1);
  z = THREE.MathUtils.clamp(z, FLOOR_BOUNDS.z0, FLOOR_BOUNDS.z1);
  if (Math.hypot(x - SPOTS.bed.x, z - SPOTS.bed.z) < 2.1) { sleep(); return; }
  anim.moveTo(x, z, { onArrive: () => anim.faceTo(faceCam()) });
}
const faceCam = () => Math.atan2(camera.position.x - mascot.root.position.x, camera.position.z - mascot.root.position.z) * 0.6;

let targetBaseY = 0;
function sleep() {
  if (state.asleep) return wake();
  anim.moveTo(SPOTS.bed.x + 0.15, SPOTS.bed.z + 0.25, {
    onArrive: () => {
      targetBaseY = BED_HEIGHT;
      anim.play('hop');
      state.asleep = true; state.slept = true;
      anim.faceTo(0.5);
      toast('Good night, Nimbus 🌙');
      save(); renderUI();
    },
  });
}
function wake() {
  state.asleep = false;
  targetBaseY = 0;
  tempMood = { name: 'surprised', until: now + 1.6 };
  anim.play('surprised');
  after(1.4, () => anim.moveTo(SPOTS.rug.x - 0.6, SPOTS.rug.z + 0.4, { onArrive: () => anim.faceTo(faceCam()) }));
  save(); renderUI();
}

function endDay() {
  if (state.asleep) wake();
  const ok = doneCount() === HABITS.length;
  if (ok) {
    state.streak++;
    state.best = Math.max(state.best, state.streak);
    state.history.push(true);
    tempMood = { name: 'proud', until: now + 6 };
    anim.play('proudPuff');
    toast(`Streak ${state.streak}! Nimbus is proud of you`, 'big');
    for (const u of UNLOCKS) {
      if (state.streak >= u.at && !state.unlocked.includes(u.id)) {
        state.unlocked.push(u.id);
        after(1.2, () => { room.pop(u.id); fx.emit('sparkle', new THREE.Vector3(0, 1.5, 0)); toast(`Unlocked ${u.label}!`, 'unlock'); });
      }
    }
  } else {
    state.history.push(false);
    if (state.streak > 0 && state.shields > 0) {
      state.shields--;
      toast('Missed a day: a streak shield saved your streak', 'warn');
      tempMood = { name: 'worried', until: now + 5 };
      anim.play('worriedShiver');
    } else {
      if (state.streak > 0) toast(`Streak lost… it rains on Nimbus today`, 'warn');
      state.streak = 0;
      state.joy = Math.max(0.1, state.joy - 0.3);
      rainUntil = now + 14;
      tempMood = { name: 'sad', until: now + 8 };
      anim.play('sadSigh');
    }
  }
  if (state.streak > 0 && state.streak % 7 === 0) state.shields++;
  state.day++;
  state.done = {};
  state.energy = state.slept ? Math.max(state.energy, 0.9) : Math.max(0.05, state.energy - 0.2);
  state.slept = false;
  save(); renderUI();
}

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => { canvas._down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  const d = canvas._down;
  if (!mascot || !d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return;   // orbit drag
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.intersectObject(mascot.body, false).length) { pet(); return; }
  if (ray.intersectObject(room.bed, true).length) { sleep(); return; }
  if (room.items.lamp.visible && ray.intersectObject(room.items.lamp, true).length) { room.lampManual = !room.lampManual; return; }
  const hit = ray.intersectObject(room.floor, false)[0];
  if (hit) goTo(hit.point.x, hit.point.z);
});

function buildButtons() {
  $('petBtn').addEventListener('click', pet);
  $('sleepBtn').addEventListener('click', sleep);
  $('dayBtn').addEventListener('click', endDay);
  $('labBtn').addEventListener('click', () => $('lab').classList.toggle('open'));
  $('resetBtn').addEventListener('click', () => {
    state = fresh(); room.setUnlocked([]); targetBaseY = 0; anim.baseY = 0;
    mascot.root.position.set(SPOTS.rug.x, 0, SPOTS.rug.z); save(); renderUI();
  });
  const pretty = (n) => n.replace(/([A-Z])/g, ' $1').toLowerCase();
  const add = (id, names, fn) => { for (const n of names) { const b = document.createElement('button'); b.textContent = pretty(n); b.onclick = () => fn(n); $(id).appendChild(b); } };
  add('labMoods', MOOD_NAMES, (n) => { tempMood = { name: n, until: now + 8 }; });
  add('labClips', CLIP_NAMES, (n) => anim.play(n));
  add('labFaces', Object.keys(EXPRESSIONS), (n) => mascot.face.set(n));
  $('labUnlock').addEventListener('click', () => {
    for (const u of UNLOCKS) if (!state.unlocked.includes(u.id)) { state.unlocked.push(u.id); room.pop(u.id); }
    room.setUnlocked(state.unlocked); save(); renderUI();
  });
  $('labStreak').addEventListener('click', () => { for (const h of HABITS) state.done[h.id] = true; endDay(); });
}

// ------------------------------------------------------------------ frame
const _kd = new THREE.Vector3(), _c = new THREE.Color();
function applyEnvironment(dt) {
  nightK += ((state.asleep ? 1 : 0) - nightK) * Math.min(1, dt * 1.5);
  rainK += ((now < rainUntil ? 1 : 0) - rainK) * Math.min(1, dt * 0.8);
  hemi.intensity = base.hemi * (1 - 0.5 * nightK) * (1 - 0.15 * rainK);
  hemi.color.copy(_c.set('#fff7f2').lerp(new THREE.Color('#a89ce8'), nightK));
  hemi.groundColor.copy(_c.set(base.ground).lerp(new THREE.Color('#5d4a7a'), nightK));
  key.intensity = base.key * (1 - 0.92 * nightK) * (1 - 0.3 * rainK);
  key.color.copy(_c.set('#fff3ea').lerp(new THREE.Color('#aab6ff'), nightK));
  rim.intensity = base.rim * (1 - 0.5 * nightK);
  fill.intensity = 0.55 * (1 - 0.7 * nightK);
  moon.intensity = 1.5 * nightK;
  scene.background.copy(_c.set('#f6e9e4').lerp(new THREE.Color('#25223d'), nightK));
  room.sky.uniforms.uNight.value = nightK;
  room.sky.uniforms.uRain.value = rainK;
  const lampOn = room.items.lamp.visible && (nightK > 0.3 || room.lampManual) ? 1 : 0;
  room.lampLight.intensity += (lampOn * 7 - room.lampLight.intensity) * Math.min(1, dt * 3);
  room.lampShade.material.emissiveIntensity = room.lampLight.intensity / 7 * 0.9;
}

function step(dt) {
  now += dt;
  for (let i = later.length - 1; i >= 0; i--) if (later[i].at <= now) { const f = later[i].fn; later.splice(i, 1); f(); }
  if (!SHOT) {
    state.joy = Math.max(0, state.joy - dt * 0.0025 * (state.asleep ? 0 : 1));
    state.energy = THREE.MathUtils.clamp(state.energy + dt * (state.asleep ? 0.03 : -0.0018), 0, 1);
    // wander when idle
    nextWander -= dt;
    if (nextWander <= 0 && !anim.busy && !state.asleep) {
      nextWander = 6 + Math.random() * 7;
      const r = Math.random();
      if (r < 0.45) goTo(SPOTS.rug.x + (Math.random() - 0.5) * 3.5, SPOTS.rug.z + (Math.random() - 0.5) * 2.5);
      else if (r < 0.65) anim.moveTo(SPOTS.window.x, SPOTS.window.z, { onArrive: () => anim.faceTo(Math.PI) });
      else if (r < 0.8 && state.unlocked.includes('plant')) anim.moveTo(SPOTS.plant.x, SPOTS.plant.z, { onArrive: () => anim.faceTo(2.4) });
      else if (state.joy > 0.55) anim.play('happyWiggle');
    }
  }
  anim.baseY += (targetBaseY - anim.baseY) * Math.min(1, dt * 6);
  mascot.vinyl.userData.uniforms.uGroundY.value = anim.baseY;
  const m = moodFor();
  if (m !== anim.mood) { anim.setMood(m); if (!SHOT) renderUI(); }
  mascot.update(dt, now, { autoBlink: !SHOT && !state.asleep });
  fx.update(dt);
  room.update(dt, now);
  applyEnvironment(dt);
}

function render() {
  camera.updateMatrixWorld();
  _kd.copy(key.position).sub(key.target.position).normalize().transformDirection(camera.matrixWorldInverse);
  mascot.setKeyDir(_kd);
  fx.setViewport(renderer, camera);
  renderer.render(scene, camera);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the room framed on narrow / portrait screens
  camera.fov = w / h < 0.8 ? 44 : w / h < 1.2 ? 36 : 30;
  camera.updateProjectionMatrix();
}

// deterministic preset scenes for screenshots
function scenePreset(name) {
  state = fresh();
  Object.assign(state, { day: 9, streak: 4, best: 6, history: [true, true, false, true, true, true, true], unlocked: ['plant'] });
  if (name === 'day') { state.done = { water: true, read: true }; state.joy = 0.7; }
  if (name === 'celebrate') { state.done = { water: true, read: true, stretch: true, phone: true }; state.joy = 0.95; }
  if (name === 'night') { state.asleep = true; state.joy = 0.7; }
  if (name === 'sad') { state.streak = 0; state.history.push(false); state.joy = 0.2; rainUntil = 1e9; }
  if (name === 'unlocks') { state.streak = 14; state.best = 14; state.unlocked = UNLOCKS.map((u) => u.id); state.history = Array(7).fill(true); state.joy = 0.8; }
  if (name === 'determined') { state.done = { water: true, read: true, stretch: true }; state.joy = 0.75; }
}

async function main() {
  load();
  resize();
  setCam(SHOT ? params.get('cam') || 'room' : 'room');
  mascot = await createMascot();
  anim = mascot.animator;
  mascot.body.castShadow = true;
  scene.add(mascot.root, mascot.shadow);
  anim.onEvent = (kind) => fx.emit(kind, mascot.root.position);
  const L = mascot.look;
  renderer.toneMappingExposure = L.exposure ?? 1;
  base = { hemi: L.hemi ?? 1, key: L.key ?? 2, rim: L.rim ?? 0.8, ground: L.hemiGround ?? '#d9c3e3' };
  hemi.groundColor.set(L.hemiGround ?? '#d9c3e3');
  const az = THREE.MathUtils.degToRad(L.keyAz ?? -40), el = THREE.MathUtils.degToRad(Math.max(L.keyEl ?? 40, 38));
  key.position.set(14 * Math.cos(el) * Math.sin(az), 14 * Math.sin(el), 14 * Math.cos(el) * Math.cos(az));

  if (SHOT) scenePreset(params.get('scene') || 'day');
  room.setUnlocked(state.unlocked);
  if (state.asleep) {
    mascot.root.position.set(SPOTS.bed.x + 0.15, 0, SPOTS.bed.z + 0.25);
    anim.baseY = targetBaseY = BED_HEIGHT;
    anim.heading = 0.5;
  } else {
    mascot.root.position.set(SPOTS.rug.x - 0.6, 0, SPOTS.rug.z + 0.4);
    anim.heading = 0.3;
  }
  anim.reset();
  anim.faceTo(anim.heading);
  nightK = state.asleep ? 1 : 0;
  renderUI();
  window.addEventListener('resize', resize);

  if (SHOT) {
    controls.enabled = false;
    document.body.classList.add('shot');
    if (params.has('ui')) document.body.classList.add('ui');
    resize();
    setCam(params.get('cam') || 'room');
    const scn = params.get('scene') || 'day';
    if (scn === 'celebrate') { anim.play('celebrateSpin'); tempMood = { name: 'veryHappy', until: 1e9 }; }
    if (scn === 'unlocks') { tempMood = { name: 'proud', until: 1e9 }; }
    const t = Number(params.get('t') || (scn === 'celebrate' ? 1.25 : 2.0));
    for (let k = 0; k < Math.round(t * 60); k++) step(1 / 60);
    mascot.face.update(5, now, { autoBlink: false });
    renderUI();
    render();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    render();
    document.title = 'done';
    return;
  }
  buildButtons();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    step(dt);
    controls.update();
    render();
  });
}

// test hook: advance game time deterministically (headless software GL renders at a few fps)
function advance(seconds) { for (let k = 0; k < Math.round(seconds * 60); k++) step(1 / 60); render(); }
window.__room = { scene, camera, state: () => state, anim: () => anim, endDay, toggleHabit, sleep, pet, advance };
main().catch((e) => { console.error(e); document.title = 'error'; });
