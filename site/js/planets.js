// Habit planets: Nimbus on its home planet, one planet per habit floating close around it, all strung together
// with vine garlands (cozy layer: site/js/cozy.js).
//   - Each planet grows with its own habit streak: seed -> sprout (3) -> bloom (7) -> radiant (14).
//   - Tap a planet to fly to it and decorate it: its themed items unlock by stage, tap the surface to place,
//     tap a placed item to remove it.
//   - "Next day": kept habits grow (+1), missed ones reset and their planet shrinks back.
// Models: site/assets/planets/<id>.glb (generated from assets_src/planets/*.png); if a model is missing
// a simple procedural stand-in is used so the demo always runs.
// Test mode: planets.html?shot=overview|focus&scene=start|grown|mixed[&planet=ocean][&t=sec]
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMascot } from './mascot.js';
import { Particles } from './fx.js';
import { makeSky, clayify, makeComposer, contactBlob } from './spacelook.js';
import { surfaceSamples, makeVines, makeFlowers, Garland, makeWindow, makeWaterfall, makeStones, makeFireflies } from './cozy.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const STORE = 'nimbus-planets-v1';

export const STAGES = [
  { name: 'seed', at: 0, scale: 0.74, glow: 0.0 },
  { name: 'sprout', at: 3, scale: 0.83, glow: 0.3 },
  { name: 'bloom', at: 7, scale: 0.92, glow: 0.6 },
  { name: 'radiant', at: 14, scale: 1.0, glow: 1.0 },
];
const PLANETS = [
  { id: 'ocean', habit: 'Drink water', model: 'planet_ocean', color: '#5fd0c9', glow: '#9ff0ea', pos: [-4.7, -3.3, 0.9],
    items: [{ id: 'item_fountain', stage: 1, h: 0.42 }, { id: 'item_boat', stage: 2, h: 0.34 }, { id: 'item_lighthouse', stage: 3, h: 0.55 }] },
  { id: 'book', habit: 'Read 10 pages', model: 'planet_book', color: '#e9b7c8', glow: '#ffd3e0', pos: [4.3, -3.0, 1.1],
    items: [{ id: 'item_lamp', stage: 1, h: 0.38 }, { id: 'item_armchair', stage: 2, h: 0.32 }, { id: 'item_booktower', stage: 3, h: 0.55 }] },
  { id: 'moon', habit: 'Sleep by 11pm', model: 'planet_moon', color: '#f6e7b8', glow: '#fff1c4', pos: [-2.3, 2.7, -3.4],
    items: [{ id: 'item_starlantern', stage: 1, h: 0.42 }, { id: 'item_bed', stage: 2, h: 0.26 }, { id: 'item_telescope', stage: 3, h: 0.45 }] },
  { id: 'meadow', habit: 'Move 20 min', model: 'planet_meadow', color: '#a9d79a', glow: '#d6f5c4', pos: [-5.0, 0.3, -1.0],
    items: [{ id: 'item_flowerpatch', stage: 1, h: 0.26 }, { id: 'item_swingtree', stage: 2, h: 0.55 }, { id: 'item_windmill', stage: 3, h: 0.55 }] },
  { id: 'lantern', habit: 'Meditate 5 min', model: 'planet_lantern', color: '#f6c3b0', glow: '#ffe0d2', pos: [5.2, 0.4, -1.3],
    items: [{ id: 'item_lanternpost', stage: 1, h: 0.45 }, { id: 'item_lotuspond', stage: 2, h: 0.2 }, { id: 'item_bench', stage: 3, h: 0.24 }] },
  { id: 'tea', habit: 'Journal 1 page', model: 'planet_tea', color: '#b9d9a6', glow: '#e3f3d2', pos: [2.3, 2.6, -3.1],
    items: [{ id: 'item_teapot', stage: 1, h: 0.3 }, { id: 'item_teahouse', stage: 2, h: 0.5 }, { id: 'item_mushrooms', stage: 3, h: 0.28 }] },
];
// items that fit on any planet, unlocked once a planet blooms
const SHARED_ITEMS = [{ id: 'item_mailbox', stage: 2, h: 0.32 }, { id: 'item_rocket', stage: 3, h: 0.45 }];
const itemsFor = (p) => [...p.items, ...SHARED_ITEMS];
const HOME_R = 1.95;
const PLANET_R = 1.45;   // a habit planet's radius when fully grown (x stage scale): ~55-75% of home
// vine garlands strung between neighbours ('home' = Nimbus's planet)
const GARLANDS = [['home', 'meadow'], ['home', 'lantern'], ['home', 'book'], ['home', 'tea'], ['meadow', 'moon'], ['moon', 'tea'],
  ['tea', 'lantern'], ['lantern', 'book']];
// how lush a planet's vines + flowers are (0..1): some from day one, full at radiant
const lushOf = (streak) => 0.3 + 0.7 * Math.min(1, streak / 14);
const stageOf = (streak) => STAGES.reduce((s, st, i) => (streak >= st.at ? i : s), 0);
const fresh = () => ({ day: 1, planets: Object.fromEntries(PLANETS.map((p) => [p.id, { streak: 0, done: false, items: [] }])) });

// ------------------------------------------------------------------ renderer / scene
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!SHOT });
renderer.setPixelRatio(SHOT ? 1 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 32;
controls.maxPolarAngle = Math.PI * 0.62;

// backdrop: painted pastel cosmos + stars + a sea of clouds below (site/js/spacelook.js)
const skyFx = makeSky(scene);
const seaFx = { update() {} };   // the cloud sea is painted into the sky shader (no card edges)

// lights (studio-tuned values from assets/look.json are applied once the mascot loads)
// lights: lavender sky + warm cloud-sea bounce, warm key from the front-left, strong cool rim from behind
const hemi = new THREE.HemisphereLight(0xf3e3ff, 0xffcdb0, 1.0);
const key = new THREE.DirectionalLight(0xffe0bc, 2.0);           // golden-hour key
const rim = new THREE.DirectionalLight(0xc7c0ff, 1.0);
rim.position.set(3, 4, -9);
const rim2 = new THREE.DirectionalLight(0xffbe8c, 1.6);          // low warm sun behind-left: golden rims
rim2.position.set(-8, 5, -6);
scene.add(hemi, key, rim, rim2);

scene.fog = new THREE.Fog('#a58cd0', 20, 44);   // a little depth haze on the far planets
const cozyU = { time: { value: 0 }, px: { value: 1 } };
scene.add(makeFireflies(cozyU));
const homeGlow = new THREE.PointLight('#ffb370', 9, 7, 1.6);   // warm light from home's windows onto Nimbus + garlands
homeGlow.position.set(0.4, -0.9, 2.4);
scene.add(homeGlow);

const fx = new Particles(5);
scene.add(fx.points);
const post = makeComposer(renderer, scene, camera, { bloom: 0.34, radius: 0.45, threshold: 0.98 });

// ------------------------------------------------------------------ models
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const modelCache = {};
// per-model colour corrections (Pixal3D sometimes oversaturates a texture vs its reference)
const TUNE = { planet_lantern: { sat: 0.45, lift: 0.08 } };
const GLOWY = new Set(['item_lamp', 'item_starlantern', 'item_lighthouse', 'item_lanternpost', 'item_mushrooms', 'item_teahouse']);
// assets/planets/models.json lists the generated models (written by scripts/pixal3d_assets.py)
const available = fetch('assets/planets/models.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
async function loadModel(id) {
  if (modelCache[id] !== undefined) return modelCache[id];
  if (!(await available).includes(id)) { modelCache[id] = null; return null; }
  try {
    const g = await loader.loadAsync(`assets/planets/${id}.glb`);
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    clayify(g.scene, { emissive: GLOWY.has(id) ? 0.3 : 0, fill: id.startsWith('planet') ? 0.2 : 0.16, ...(TUNE[id] || {}) });
    modelCache[id] = g.scene;
  } catch { modelCache[id] = null; }
  return modelCache[id];
}

// normalised instance: planets -> fit a sphere of `radius`, centred; items -> `height` tall, origin at the base centre
function normalise(obj, { radius, height }) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);   // precise: the uprighted planets are rotated
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(obj);
  inner.position.copy(c).negate();
  if (height) inner.position.y += size.y / 2;
  const wrap = new THREE.Group();
  wrap.scale.setScalar(radius ? (2 * radius) / Math.max(size.x, size.y, size.z) : height / size.y);
  wrap.add(inner);
  return wrap;
}

const toon = (c, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
function standInPlanet(p) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), toon(p.color, 0.75));
  s.scale.y = 0.94;
  g.add(s);
  if (p.id === 'ocean') { const isl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, 0, 0.5), toon('#f3dfb8')); isl.position.y = 0.6; g.add(isl); }
  if (p.id === 'book') for (let i = -2; i <= 2; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(Math.sqrt(1 - (i * 0.3) ** 2) * 1.01, 0.05, 8, 64), toon(['#c9b6e8', '#fff3e0', '#bfe0d0', '#f7c6a8', '#fff3e0'][i + 2])); band.rotation.x = Math.PI / 2; band.position.y = i * 0.3 * 0.94; g.add(band); }
  if (p.id === 'moon') for (let i = 0; i < 6; i++) { const cr = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i % 3) * 0.05, 16, 12), toon('#eedca4')); const a = i * 1.7, b = 0.4 + (i % 3) * 0.5; cr.position.set(Math.cos(a) * Math.sin(b), Math.cos(b) * 0.94, Math.sin(a) * Math.sin(b)).multiplyScalar(0.97); g.add(cr); }
  g.userData.standIn = true;
  return g;
}
function standInItem(id) {
  const g = new THREE.Group();
  const add = (geo, c, y, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, toon(c)); m.position.y = y; m.scale.set(sx, sy, sz); g.add(m); return m; };
  const C = new THREE.CylinderGeometry(0.5, 0.5, 1, 24), S = new THREE.SphereGeometry(0.5, 24, 16), K = new THREE.ConeGeometry(0.5, 1, 24);
  switch (id) {
    case 'item_fountain': add(C, '#f3e6d6', 0.15, 1, 0.3, 1); add(C, '#7fd9d0', 0.32, 0.8, 0.06, 0.8); add(C, '#f3e6d6', 0.55, 0.3, 0.5, 0.3); break;
    case 'item_boat': add(S, '#f7b38a', 0.15, 0.9, 0.35, 0.5); add(C, '#e8d9cf', 0.6, 0.04, 0.8, 0.04); add(K, '#fff3e0', 0.6, 0.45, 0.7, 0.05); break;
    case 'item_lighthouse': add(C, '#fff3e0', 0.5, 0.42, 1, 0.42); add(C, '#c9b6e8', 0.35, 0.44, 0.15, 0.44); add(S, '#ffe2a0', 1.05, 0.4, 0.3, 0.4); break;
    case 'item_lamp': add(C, '#d9a06a', 0.05, 0.5, 0.1, 0.5); add(C, '#c99a55', 0.5, 0.06, 0.9, 0.06); add(S, '#fff1d6', 0.95, 0.5, 0.35, 0.5); break;
    case 'item_armchair': add(S, '#c9b6e8', 0.4, 1, 0.6, 0.9); add(S, '#d9c8f0', 0.75, 0.9, 0.6, 0.35).position.z = -0.25; break;
    case 'item_booktower': ['#c9b6e8', '#bfe0d0', '#f7c6a8', '#fff3e0', '#c9b6e8'].forEach((c, i) => add(new THREE.BoxGeometry(0.8, 0.18, 0.6), c, 0.1 + i * 0.2).rotation.y = i * 0.2); break;
    case 'item_starlantern': add(C, '#d9a06a', 0.3, 0.08, 0.6, 0.08); add(new THREE.OctahedronGeometry(0.4), '#fff1c4', 0.85); break;
    case 'item_bed': add(S, '#c9b6e8', 0.2, 1.2, 0.35, 1); add(S, '#fff6ee', 0.32, 0.9, 0.18, 0.7); break;
    case 'item_telescope': add(C, '#d9a06a', 0.3, 0.05, 0.6, 0.05); const t = add(C, '#d6a64a', 0.75, 0.16, 0.9, 0.16); t.rotation.z = 0.9; break;
    default: add(S, '#ffffff', 0.5);
  }
  return g;
}

// upright corrections for pixel-aligned Pixal3D planets (scripts/model_orient.py)
const orient = fetch('assets/planets/orient.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
async function upright(id, obj) {
  const q = (await orient)[id];
  if (q) obj.quaternion.premultiply(new THREE.Quaternion(...q));
  return obj;
}
async function makePlanetMesh(p) {
  const m = await loadModel(p.model);
  return m ? normalise(await upright(p.model, m.clone(true)), { radius: 1 }) : standInPlanet(p);
}
async function makeItemMesh(it) {
  const m = await loadModel(it.id);
  return m ? normalise(m.clone(true), { height: it.h }) : (() => { const g = standInItem(it.id); g.scale.setScalar(it.h); return g; })();
}

// ------------------------------------------------------------------ world
let state = fresh();
const world = { planets: {}, home: null, garlands: [], stones: null };
let mascot, anim;
let focus = null;                 // planet id in focus (decorate mode)
let placing = null;               // item id armed for placement
let orbitT = 0;

async function buildWorld() {
  // home planet: soft moss planetoid (stand-in until its model exists)
  const homeModel = await loadModel('planet_home');
  const home = homeModel ? normalise(await upright('planet_home', homeModel.clone(true)), { radius: HOME_R }) : (() => {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.SphereGeometry(1.7, 64, 48), toon('#b9a6cf', 0.9));
    const moss = new THREE.Mesh(new THREE.SphereGeometry(1.72, 64, 32, 0, Math.PI * 2, 0, 1.05), toon('#a9cf9a', 1));
    g.add(rock, moss);
    return g;
  })();
  home.position.set(0, -HOME_R + 0.02, 0);   // stand-in: surface top at y = 0.02, under Nimbus's base
  if (homeModel) {                           // model: raycast its top so Nimbus sits on the clearing
    home.position.set(0, 0, 0);
    home.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObject(home, true)[0];
    home.position.y = -(hit ? hit.point.y : HOME_R) + 0.01;
  }
  world.homeIsModel = !!homeModel;
  home.name = 'HomePlanet';
  scene.add(home);
  world.home = home;
  await decorateHome(home);

  for (const [i, p] of PLANETS.entries()) {
    const holder = new THREE.Group();          // position on the orbit
    const grow = new THREE.Group();            // stage scale
    const spin = new THREE.Group();            // slow self-rotation
    const body = await makePlanetMesh(p);
    spin.add(body);
    grow.add(spin);
    holder.add(grow);
    // cozy layer on the planet's real surface (in spin space: radius 1), lusher as the habit streak grows
    const lush = { grow: { value: lushOf(0) }, time: cozyU.time };
    const S = surfaceSamples(body, spin);
    const seed = i * 101 + 7;
    spin.add(makeVines(S, lush, { strands: 20, seed, blossom: [p.glow, '#d9b8f5', '#f6b8d6'] }));
    spin.add(makeFlowers(S, lush, { count: 34, seed: seed + 1 }));
    if (p.id === 'ocean') addWaterfall(grow, new THREE.Vector3(-0.45, 0, 1), { width: 0.22, drop: 1.25, out: 0.16 });
    const glow = { rims: [] };   // planet glow = the clay rim light, brighter as the planet grows / when done today
    body.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.userData.clay) glow.rims.push(m); });
    holder.userData = { id: p.id, base: new THREE.Vector3(...p.pos), phase: i * 1.37 };
    holder.position.copy(holder.userData.base);
    spin.rotation.y = i * 1.1;
    holder.name = `Planet_${p.id}`;
    scene.add(holder);
    world.planets[p.id] = { def: p, holder, grow, spin, body, glow, lush, items: new THREE.Group(), scaleNow: STAGES[0].scale };
    spin.add(world.planets[p.id].items);
  }

  for (const [a, b] of GARLANDS) {
    const g = new Garland({ seed: world.garlands.length * 13 + 5, bulbs: 8 + (world.garlands.length % 3), lanterns: 1 + (world.garlands.length % 2) });
    g.ends = [a, b];
    scene.add(g.group);
    world.garlands.push(g);
  }
  // glowing stepping stones from home's rim down to the ocean planet
  const from = new THREE.Vector3(-0.78, 0.2, 0.55).normalize().multiplyScalar(HOME_R).add(home.position);
  const to = new THREE.Vector3(...PLANETS.find((q) => q.id === 'ocean').pos).add(new THREE.Vector3(0.5, PLANET_R * 0.95, 0.3));
  const pts = [0.2, 0.4, 0.6, 0.8].map((t) => from.clone().lerp(to, t).add(new THREE.Vector3(0, Math.sin(t * Math.PI) * 0.45, 0)));
  world.stones = makeStones(pts);
  scene.add(world.stones);
}
function addWaterfall(parent, dir, opts) {
  // on the non-spinning group, so it always pours toward the viewer's side (the ocean planet is round enough)
  dir.normalize();
  const wf = makeWaterfall(cozyU, opts);
  wf.position.copy(dir).multiplyScalar(0.84).setY(0.42);
  wf.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  parent.add(wf);
}
// Nimbus's own planet: lush from the start, windows lit, a reading lamp and a book stack beside Nimbus
async function decorateHome(home) {
  const deco = new THREE.Group();
  deco.name = 'HomeDecor';
  deco.position.copy(home.position);
  scene.add(deco);
  const S = surfaceSamples(home, deco);
  const lush = { grow: { value: 1 }, time: cozyU.time };
  deco.add(makeVines(S, lush, { unit: HOME_R, strands: 34, seed: 3, hang: [0.2, 0.7], band: [-0.05, 0.6] }));
  // flowers on the moss, but keep Nimbus's spot clear
  const S2 = { ...S, count: S.count };
  const keep = []; for (let i = 0; i < S.count; i++) if (Math.hypot(S.P[i * 3], S.P[i * 3 + 2]) > 1.05) keep.push(i);
  S2.P = keep.flatMap((i) => [S.P[i * 3], S.P[i * 3 + 1], S.P[i * 3 + 2]]); S2.N = keep.flatMap((i) => [S.N[i * 3], S.N[i * 3 + 1], S.N[i * 3 + 2]]); S2.count = keep.length;
  deco.add(makeFlowers(S2, lush, { unit: HOME_R, count: 46, seed: 4, minY: 0.2 }));
  // two round windows on the front face, below the moss line
  const front = [];
  for (let i = 0; i < S.count; i++) {
    const y = S.P[i * 3 + 1] / HOME_R, nz = S.N[i * 3 + 2];
    if (nz > 0.8 && y > -0.45 && y < -0.12) front.push(i);
  }
  const win = (x, size) => {
    let bi = -1, bd = 1e9;
    for (const i of front) { const d = Math.abs(S.P[i * 3] - x) + Math.abs(S.P[i * 3 + 1] / HOME_R + 0.28) * 2; if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return;
    const w = makeWindow(size);
    const n = new THREE.Vector3(S.N[bi * 3], S.N[bi * 3 + 1], S.N[bi * 3 + 2]);
    w.position.set(S.P[bi * 3], S.P[bi * 3 + 1], S.P[bi * 3 + 2]).addScaledVector(n, 0.01);
    w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    deco.add(w);
  };
  win(-0.55, 0.24); win(0.6, 0.17);
  // reading lamp + books on the clearing (existing item models), with a real warm light under the lamp shade
  const down = new THREE.Raycaster();
  for (const [id, x, z, h, ry] of [['item_lamp', -1.25, 0.15, 0.95, 0.5], ['item_booktower', 1.2, 0.35, 0.55, -0.4]]) {
    down.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const hit = down.intersectObject(home, true)[0];
    if (!hit) continue;
    const m = await makeItemMesh({ id, h });
    const it = new THREE.Group();
    it.add(m, contactBlob(h * 0.9));
    it.position.copy(hit.point);
    it.rotation.y = ry;
    scene.add(it);
    if (id === 'item_lamp') { const L = new THREE.PointLight('#ffc27a', 5, 3.2, 1.5); L.position.copy(hit.point).add(new THREE.Vector3(0.35, h * 0.75, 0.2)); scene.add(L); }
  }
  world.homeDeco = deco;
}
const _ga = new THREE.Vector3(), _gb = new THREE.Vector3();
function endPoint(id, toward, out) {
  // where a garland ties onto a planet: up on its shoulder, facing the other end
  const c = id === 'home' ? world.home.position : world.planets[id].holder.position;
  const r = id === 'home' ? HOME_R : world.planets[id].scaleNow * PLANET_R;
  const d = new THREE.Vector3(toward.x - c.x, 0, toward.z - c.z).normalize().multiplyScalar(0.8);
  d.y = 0.58 + (id === 'home' ? 0.08 : 0);
  return out.copy(c).addScaledVector(d.normalize(), r * 0.9);
}
const centerOf = (id) => (id === 'home' ? world.home.position : world.planets[id].holder.position);

// place a decor item on a planet: local surface point + normal (in the planet's spin space)
async function placeItem(pid, itemId, local, normal, save = true) {
  const W = world.planets[pid];
  const def = itemsFor(W.def).find((x) => x.id === itemId);
  const mesh = await makeItemMesh(def);
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.add(contactBlob(def.h * 1.5));   // grounds the item on the surface
  holder.position.copy(local);
  holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  holder.userData = { itemId, pid };
  holder.scale.setScalar(0.001);
  holder.userData.pop = 0;
  W.items.add(holder);
  if (save) {
    state.planets[pid].items.push({ id: itemId, p: local.toArray().map((v) => +v.toFixed(4)), n: normal.toArray().map((v) => +v.toFixed(4)) });
    persist();
  }
  return holder;
}
function removeItem(holder) {
  const { pid } = holder.userData;
  const idx = world.planets[pid].items.children.indexOf(holder);
  state.planets[pid].items.splice(idx, 1);
  holder.removeFromParent();
  persist();
}
async function restoreItems() {
  for (const p of PLANETS) {
    const W = world.planets[p.id];
    W.items.clear();
    for (const it of state.planets[p.id].items) {
      const h = await placeItem(p.id, it.id, new THREE.Vector3(...it.p), new THREE.Vector3(...it.n), false);
      h.scale.setScalar(1); delete h.userData.pop;
    }
  }
}

// ------------------------------------------------------------------ persistence + UI
function load() { if (SHOT) return; try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.planets) state = s; } catch { /* fresh */ } }
function persist() { if (SHOT) return; try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* unavailable */ } }
const $ = (id) => document.getElementById(id);

function renderUI() {
  $('day').textContent = `Day ${state.day}`;
  const list = $('planetList');
  if (!list.children.length) {
    for (const p of PLANETS) {
      const li = document.createElement('li');
      li.dataset.id = p.id;
      li.innerHTML = `<button class="pl" data-act="focus"><i style="background:${p.color}"></i>
          <span class="nm"><b>${p.habit}</b><small class="st"></small></span><span class="streak"></span></button>
        <div class="bar"><i></i></div>
        <button class="done" data-act="done">Done today</button>`;
      li.querySelector('[data-act=focus]').onclick = () => setFocus(p.id);
      li.querySelector('[data-act=done]').onclick = () => toggleDone(p.id);
      list.appendChild(li);
    }
  }
  for (const li of list.children) {
    const id = li.dataset.id, s = state.planets[id], st = stageOf(s.streak), next = STAGES[st + 1];
    li.querySelector('.st').textContent = `${STAGES[st].name}${next ? ` · ${next.at - s.streak} to ${next.name}` : ' · fully grown'}`;
    li.querySelector('.streak').textContent = `${s.streak}`;
    const prev = STAGES[st].at, span = next ? next.at - prev : 1;
    li.querySelector('.bar i').style.width = `${next ? ((s.streak - prev) / span) * 100 : 100}%`;
    const b = li.querySelector('.done');
    b.classList.toggle('on', s.done);
    b.textContent = s.done ? 'Done ✓' : 'Done today';
    li.classList.toggle('focused', focus === id);
  }
  // decorate panel
  const panel = $('decorate');
  panel.classList.toggle('open', !!focus);
  if (focus) {
    const p = world.planets[focus].def, st = stageOf(state.planets[focus].streak);
    $('decTitle').textContent = `Decorate · ${p.habit}`;
    const grid = $('itemGrid');
    grid.innerHTML = '';
    for (const it of itemsFor(p)) {
      const b = document.createElement('button');
      const locked = st < it.stage;
      b.className = 'item' + (locked ? ' locked' : '') + (placing === it.id ? ' armed' : '');
      b.innerHTML = `<img src="assets/planets/thumbs/${it.id}.jpg" alt="" onerror="this.style.visibility='hidden'"><span>${it.id.replace('item_', '')}</span>
        ${locked ? `<small>unlocks at ${STAGES[it.stage].name}</small>` : ''}`;
      b.disabled = locked;
      b.onclick = () => { placing = placing === it.id ? null : it.id; renderUI(); };
      grid.appendChild(b);
    }
    $('decHint').textContent = placing ? 'Tap the planet to place it' : 'Pick an item · tap a placed item to remove it';
  }
}

function toast(text, kind = '') {
  if (SHOT) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

function toggleDone(id) {
  const s = state.planets[id];
  s.done = !s.done;
  if (s.done) {
    anim.play('hop');
    const W = world.planets[id];
    fx.emit('sparkle', W.holder.position.clone().add(new THREE.Vector3(0, -0.6, 0)));
  }
  persist(); renderUI();
}

function nextDay() {
  let grew = 0, lost = 0;
  for (const p of PLANETS) {
    const s = state.planets[p.id], before = stageOf(s.streak);
    if (s.done) {
      s.streak++;
      const after = stageOf(s.streak);
      if (after > before) { grew++; toast(`${p.habit}: your planet reached ${STAGES[after].name}!`, 'big'); fx.emit('confetti', world.planets[p.id].holder.position.clone().add(new THREE.Vector3(0, -1.2, 0)), { scale: 0.7 }); }
    } else if (s.streak > 0) { s.streak = 0; lost++; toast(`${p.habit}: streak reset, the planet shrinks back`, 'warn'); }
    s.done = false;
  }
  state.day++;
  if (grew) anim.play('celebrateSpin'); else if (lost) anim.play('sadSigh'); else anim.play('happyWiggle');
  persist(); renderUI();
}

function setFocus(id) {
  focus = focus === id ? null : id;
  placing = null;
  camHold = 3;            // fly the camera (to the planet, or back to the overview)
  renderUI();
}

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => { canvas._down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', async (e) => {
  const d = canvas._down;
  if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (mascot && ray.intersectObject(mascot.body, false).length) { anim.play('tap'); return; }
  if (focus) {
    const W = world.planets[focus];
    const itemHit = ray.intersectObject(W.items, true)[0];
    if (itemHit && !placing) {
      let h = itemHit.object; while (h.parent !== W.items) h = h.parent;
      removeItem(h); renderUI(); return;
    }
    const hit = ray.intersectObject(W.body, true)[0];
    if (hit && placing) {
      W.spin.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(W.spin.matrixWorld).invert();
      const local = hit.point.clone().applyMatrix4(inv);
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : hit.point.clone().sub(W.holder.position).normalize();
      const nLocal = n.transformDirection(inv).normalize();
      const id = placing;
      await placeItem(focus, id, local, nLocal);
      fx.emit('sparkle', hit.point.clone().add(new THREE.Vector3(0, -0.85, 0)), { scale: 0.4 });
      placing = null; renderUI();
      return;
    }
  }
  for (const p of PLANETS) if (ray.intersectObject(world.planets[p.id].holder, true).length) { setFocus(p.id); return; }
  if (focus) setFocus(focus);   // tap empty space: back to overview
});

// ------------------------------------------------------------------ frame
const _kd = new THREE.Vector3(), _camGoal = new THREE.Vector3(), _tgtGoal = new THREE.Vector3();
let camHold = 0;
const OVERVIEW = { target: new THREE.Vector3(), cam: new THREE.Vector3() };
function setOverview(portrait) {   // landscape: shifted for the habit cards on the left; portrait: cards cover the bottom
  if (portrait) { OVERVIEW.target.set(0, -3.6, -0.6); OVERVIEW.cam.set(0, 1.0, 31); }
  else { OVERVIEW.target.set(-1.4, -0.3, -0.6); OVERVIEW.cam.set(-1.4, 3.0, 16.5); }
}
function step(dt, time) {
  if (!focus) orbitT += dt;
  cozyU.time.value = time;
  for (const p of PLANETS) {
    const W = world.planets[p.id], ph = W.holder.userData.phase;
    W.holder.position.copy(W.holder.userData.base).add(new THREE.Vector3(Math.sin(time * 0.21 + ph) * 0.06, Math.sin(time * 0.6 + ph) * 0.12, 0));
    const st = STAGES[stageOf(state.planets[p.id].streak)];
    W.scaleNow += (st.scale - W.scaleNow) * Math.min(1, dt * 2.5);
    W.grow.scale.setScalar(W.scaleNow * PLANET_R);
    W.lush.grow.value += (lushOf(state.planets[p.id].streak) - W.lush.grow.value) * Math.min(1, dt * 1.2);
    W.spin.rotation.y += dt * (focus === p.id ? 0.03 : 0.05);
    const gl = (0.35 + st.glow * 0.55) * (state.planets[p.id].done ? 1.5 : 1);
    for (const m of W.glow.rims) { const u = m.userData.clay.uRimK; u.value += (gl - u.value) * Math.min(1, dt * 3); }
    for (const it of W.items.children) if (it.userData.pop !== undefined) {
      it.userData.pop += dt;
      const k = Math.min(1, it.userData.pop / 0.5);
      it.scale.setScalar(Math.max(0.001, 1 + Math.sin(k * Math.PI) * 0.3 * (1 - k) - (1 - k) ** 3));
      if (k >= 1) delete it.userData.pop;
    }
  }
  for (const g of world.garlands) {
    const [a, b] = g.ends, ca = centerOf(a), cb = centerOf(b);
    endPoint(a, cb, _ga); endPoint(b, ca, _gb);
    const lit = (id) => (id === 'home' ? 1 : world.planets[id].lush.grow.value);
    g.update(_ga, _gb, 0.35 + _ga.distanceTo(_gb) * 0.09, (lit(a) + lit(b)) / 2 - 0.3, time);
  }
  world.stones.userData.update(time);
  // camera: overview or close-up on the focused planet
  if (focus) {
    // close-up from the viewer's side: planets cluster around home, so coming from the front keeps the
    // neighbours out of the way
    const P = world.planets[focus].holder.position, k = world.planets[focus].scaleNow * PLANET_R;
    const out = new THREE.Vector3(P.x * 0.12, 0.42, 1).normalize();
    _camGoal.copy(P).addScaledVector(out, 5.6 * k + 3.0);
    _tgtGoal.copy(P);   // the free space between the habit + decorate panels is centred
  } else { _tgtGoal.copy(OVERVIEW.target); _camGoal.copy(OVERVIEW.cam); }   // shifted: the habit cards sit on the left
  if (camHold > 0 || SHOT) {
    const k = SHOT ? 1 : Math.min(1, dt * 2.2);
    controls.target.lerp(_tgtGoal, k);
    camera.position.lerp(_camGoal, k);
    camera.lookAt(controls.target);
  }
  camHold = Math.max(0, camHold - dt);
  if (!SHOT && anim) {
    // Nimbus looks toward the focused planet
    const look = focus ? Math.atan2(world.planets[focus].holder.position.x, world.planets[focus].holder.position.z) * 0.8 : 0;
    anim.faceTo(look);
  }
  mascot.update(dt, time, { autoBlink: !SHOT });
  fx.update(dt);
  skyFx.update(time, renderer);
  cozyU.px.value = renderer.getPixelRatio();
  seaFx.update(time);
}

function render() {
  camera.updateMatrixWorld();
  _kd.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
  mascot.setKeyDir(_kd);
  fx.setViewport(renderer, camera);
  if (params.has('nopost')) renderer.render(scene, camera); else post.composer.render();
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 52 : 34;
  setOverview(w / h < 0.8);
  camera.updateProjectionMatrix();
}

function preset(name) {
  state = fresh();
  if (name === 'grown') { state.day = 20; for (const p of PLANETS) state.planets[p.id].streak = 15; }
  if (name === 'mixed') { state.day = 9; state.planets.ocean.streak = 15; state.planets.book.streak = 4; state.planets.moon.streak = 8; state.planets.moon.done = true;
    state.planets.meadow.streak = 5; state.planets.lantern.streak = 1; state.planets.tea.streak = 11; }
}
async function decoratePreset() {
  // a few items placed at fixed spots on each grown planet (for screenshots)
  const spots = [[0.1, 1, 0.3], [-0.45, 0.85, 0.35], [0.45, 0.85, 0.1]];
  for (const p of PLANETS) {
    const st = stageOf(state.planets[p.id].streak);
    for (const [k, it] of p.items.entries()) {
      if (st < it.stage) continue;
      const W = world.planets[p.id];
      const dir = new THREE.Vector3(...spots[k]).normalize();
      W.spin.updateWorldMatrix(true, true);
      const start = dir.clone().multiplyScalar(3).applyMatrix4(W.spin.matrixWorld);
      const hit = new THREE.Raycaster(start, W.holder.position.clone().sub(start).normalize()).intersectObject(W.body, true)[0];
      const inv = new THREE.Matrix4().copy(W.spin.matrixWorld).invert();
      const local = hit ? hit.point.clone().applyMatrix4(inv) : dir.clone();
      const h = await placeItem(p.id, it.id, local, dir, false);
      h.scale.setScalar(1); delete h.userData.pop;
    }
  }
}

async function main() {
  load();
  resize();
  camera.position.copy(OVERVIEW.cam);
  controls.target.copy(OVERVIEW.target);
  controls.update();
  await buildWorld();
  mascot = await createMascot();
  anim = mascot.animator;
  scene.add(mascot.root, mascot.shadow);
  anim.onEvent = (kind) => fx.emit(kind, mascot.root.position);
  // wrap the flat contact shadow onto the curved stand-in home planet (plane local z -> world y after its -90deg tilt)
  if (!world.homeIsModel) {
    const pos = mascot.shadow.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), r2 = x * x + y * y;
      pos.setZ(i, r2 < HOME_R * HOME_R ? -(HOME_R - Math.sqrt(HOME_R * HOME_R - r2)) + 0.02 : -1);
    }
    pos.needsUpdate = true;
  }
  const L = mascot.look;
  renderer.toneMappingExposure = (L.exposure ?? 1) * 0.95;
  hemi.intensity = (L.hemi ?? 1) * 0.95;
  key.intensity = L.key ?? 2;
  const az = THREE.MathUtils.degToRad(L.keyAz ?? -40), el = THREE.MathUtils.degToRad(L.keyEl ?? 40);
  key.position.set(8 * Math.cos(el) * Math.sin(az), 8 * Math.sin(el), 8 * Math.cos(el) * Math.cos(az));
  if (SHOT) preset(params.get('scene') || 'mixed');
  await restoreItems();
  if (SHOT) await decoratePreset();
  renderUI();
  window.addEventListener('resize', resize);
  controls.addEventListener('start', () => { camHold = 0; });

  if (SHOT) {
    controls.enabled = false;
    document.body.classList.add('shot');
    if (params.has('ui')) document.body.classList.add('ui');
    if (SHOT === 'focus') focus = params.get('planet') || 'ocean';
    resize();
    const t = Number(params.get('t') || 1.5);
    orbitT = Number(params.get('orbit') || 6);
    for (let k = 0; k < Math.round(t * 60); k++) step(1 / 60, k / 60);
    mascot.face.update(5, t, { autoBlink: false });
    renderUI();
    render();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    render();
    document.title = 'done';
    return;
  }
  $('nextDay').onclick = nextDay;
  $('overview').onclick = () => { focus = null; placing = null; camHold = 3; renderUI(); };
  $('reset').onclick = async () => { state = fresh(); focus = null; await restoreItems(); persist(); renderUI(); };
  $('demoGrow').onclick = () => { for (const p of PLANETS) state.planets[p.id].streak += 3; persist(); renderUI(); anim.play('celebrateSpin'); };
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    step(dt, clock.elapsedTime);
    if (focus) camHold = Math.max(camHold, 0.1);
    controls.update();
    render();
  });
}

window.__planets = { scene, camera, world, state: () => state, anim: () => anim, nextDay, toggleDone, setFocus: (id) => setFocus(id),
  advance: (s) => { for (let k = 0; k < Math.round(s * 60); k++) step(1 / 60, k / 60); render(); } };
main().catch((e) => { console.error(e); document.title = 'error'; });
