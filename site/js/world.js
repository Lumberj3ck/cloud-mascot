// The 3D world: Nimbus on its home planet, the six habit planets floating around it, strung with vine garlands
// (cozy layer: cozy.js), painted cloudscape behind (cloudscape.js).
// No game rules and no DOM UI here: app.js feeds it a view of the game state and listens to taps.
//
//   const world = await createWorld({ canvas, onProgress });
//   world.sync({ planets: { ocean: { awake, growth, stage, tended, status, items } }, equipped })
//   world.view('overview' | 'planet' | 'mascot', planetId)
//   world.setInsets({ left, right, top, bottom })   // UI panels: the camera frames the free area
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMascot } from './mascot.js';
import { Particles } from './fx.js';
import { clayify, makeComposer, contactBlob } from './spacelook.js';
import { makeCloudscape } from './cloudscape.js';
import { surfaceSamples, makeVines, makeFlowers, Garland, makeWindow, makeWaterfall, makeStones, makeFireflies } from './cozy.js';
import { Wardrobe } from './wardrobe.js';

const VISUAL = {
  ocean: { model: 'planet_ocean', glow: '#9ff0ea', pos: [-4.7, -3.3, 0.9] },
  book: { model: 'planet_book', glow: '#ffd3e0', pos: [4.3, -3.0, 1.1] },
  moon: { model: 'planet_moon', glow: '#fff1c4', pos: [-2.3, 2.7, -3.4] },
  meadow: { model: 'planet_meadow', glow: '#d6f5c4', pos: [-5.0, 0.3, -1.0] },
  lantern: { model: 'planet_lantern', glow: '#ffe0d2', pos: [5.2, 0.4, -1.3] },
  tea: { model: 'planet_tea', glow: '#e3f3d2', pos: [2.3, 2.6, -3.1] },
};
const IDS = Object.keys(VISUAL);
const STAGE_SCALE = [0.74, 0.83, 0.92, 1.0];
const ASLEEP_SCALE = 0.6;
const ITEM_H = { item_fountain: 0.42, item_boat: 0.34, item_lighthouse: 0.55, item_lamp: 0.38, item_armchair: 0.32, item_booktower: 0.55,
  item_starlantern: 0.42, item_bed: 0.26, item_telescope: 0.45, item_flowerpatch: 0.26, item_swingtree: 0.55, item_windmill: 0.55,
  item_lanternpost: 0.45, item_lotuspond: 0.2, item_bench: 0.24, item_teapot: 0.3, item_teahouse: 0.5, item_mushrooms: 0.28,
  item_mailbox: 0.32, item_rocket: 0.45 };
const HOME_R = 1.95;
const PLANET_R = 1.45;
const GARLANDS = [['home', 'meadow'], ['home', 'lantern'], ['home', 'book'], ['home', 'tea'], ['meadow', 'moon'], ['moon', 'tea'],
  ['tea', 'lantern'], ['lantern', 'book']];
const lushOf = (growth) => 0.3 + 0.7 * Math.min(1, growth / 14);
const TUNE = { planet_lantern: { sat: 0.45, lift: 0.08 } };
const GLOWY = new Set(['item_lamp', 'item_starlantern', 'item_lighthouse', 'item_lanternpost', 'item_mushrooms', 'item_teahouse']);
const CLUSTER = { center: new THREE.Vector3(0, -0.3, -0.6), halfW: 6.7, halfH: 4.6 };

export async function createWorld({ canvas, onProgress = () => {}, still = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: still, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);

  const skyFx = makeCloudscape(scene);
  const hemi = new THREE.HemisphereLight(0xf3e3ff, 0xffcdb0, 1.0);
  const key = new THREE.DirectionalLight(0xffe0bc, 2.0);
  const rim = new THREE.DirectionalLight(0xc7c0ff, 1.0); rim.position.set(3, 4, -9);
  const rim2 = new THREE.DirectionalLight(0xffbe8c, 1.6); rim2.position.set(-8, 5, -6);
  scene.add(hemi, key, rim, rim2);
  const cozyU = { time: { value: 0 }, px: { value: 1 } };
  scene.add(makeFireflies(cozyU));
  const homeGlow = new THREE.PointLight('#ffb370', 9, 7, 1.6); homeGlow.position.set(0.4, -0.9, 2.4);
  scene.add(homeGlow);
  const fx = new Particles(5);
  scene.add(fx.points);
  const post = makeComposer(renderer, scene, camera, { bloom: 0.34, radius: 0.45, threshold: 0.98 });

  // ---------------------------------------------------------------- loading (parallel, with real progress)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const fetchJSON = (u, f) => fetch(u).then((r) => (r.ok ? r.json() : f)).catch(() => f);
  const [available, orient] = await Promise.all([fetchJSON('assets/planets/models.json', []), fetchJSON('assets/planets/orient.json', {})]);
  const models = {};
  const loadModel = (id) => (models[id] ||= (available.includes(id) ? loader.loadAsync(`assets/planets/${id}.glb`).then((g) => {
    clayify(g.scene, { emissive: GLOWY.has(id) ? 0.3 : 0, fill: id.startsWith('planet') ? 0.2 : 0.16, ...(TUNE[id] || {}) });
    return g.scene;
  }).catch(() => null) : Promise.resolve(null)));
  const critical = ['planet_home', ...IDS.map((id) => VISUAL[id].model), 'item_lamp', 'item_booktower'];
  let done = 0;
  const total = critical.length + 3;            // + mascot + sky + shader compile
  const tick = (label) => { done++; onProgress(done / total, label); };
  onProgress(0, 'sky');
  const mascotP = createMascot().then((m) => { tick('nimbus'); return m; });
  skyFx.ready.then(() => tick('sky'));
  await Promise.all(critical.map((id) => loadModel(id).then(() => tick(id.startsWith('planet') ? 'planets' : 'home'))));

  function normalise(obj, { radius, height }) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj, true);
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
  const upright = (id, obj) => { const q = orient[id]; if (q) obj.quaternion.premultiply(new THREE.Quaternion(...q)); return obj; };
  const toon = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  async function planetMesh(id) {
    const m = await loadModel(VISUAL[id].model);
    if (m) return normalise(upright(VISUAL[id].model, m.clone(true)), { radius: 1 });
    const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), toon(VISUAL[id].glow))); return g;
  }
  async function itemMesh(id, h = ITEM_H[id] || 0.4) {
    const m = await loadModel(id);
    if (m) return normalise(m.clone(true), { height: h });
    const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), toon('#ffffff')); s.position.y = 0.5; g.add(s); g.scale.setScalar(h); return g;
  }

  // ---------------------------------------------------------------- world
  const W = { planets: {}, garlands: [], home: null };
  const homeModel = await loadModel('planet_home');
  const home = homeModel ? normalise(upright('planet_home', homeModel.clone(true)), { radius: HOME_R }) : (() => {
    const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 48, 32), toon('#b9a6cf'))); return g; })();
  home.updateMatrixWorld(true);
  const hit0 = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObject(home, true)[0];
  home.position.y = -(hit0 ? hit0.point.y : HOME_R) + 0.01;
  home.name = 'HomePlanet';
  scene.add(home);
  W.home = home;
  await decorateHome(home);

  for (const [i, id] of IDS.entries()) {
    const holder = new THREE.Group(), grow = new THREE.Group(), spin = new THREE.Group();
    const body = await planetMesh(id);
    spin.add(body); grow.add(spin); holder.add(grow);
    const lush = { grow: { value: lushOf(0) }, time: cozyU.time };
    const S = surfaceSamples(body, spin);
    const seed = i * 101 + 7;
    spin.add(makeVines(S, lush, { strands: 20, seed, blossom: [VISUAL[id].glow, '#d9b8f5', '#f6b8d6'] }));
    spin.add(makeFlowers(S, lush, { count: 34, seed: seed + 1 }));
    if (id === 'ocean') {
      const wf = makeWaterfall(cozyU, { width: 0.22, drop: 1.25, out: 0.16 });
      const dir = new THREE.Vector3(-0.45, 0, 1).normalize();
      wf.position.copy(dir).multiplyScalar(0.84).setY(0.42);
      wf.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      grow.add(wf);
    }
    const clay = [];
    body.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.userData.clay) clay.push(m.userData.clay); });
    const sat0 = clay.map((u) => u.uSat.value), lift0 = clay.map((u) => u.uLift.value);
    holder.userData = { id, base: new THREE.Vector3(...VISUAL[id].pos), phase: i * 1.37 };
    holder.position.copy(holder.userData.base);
    spin.rotation.y = i * 1.1;
    holder.name = `Planet_${id}`;
    scene.add(holder);
    const items = new THREE.Group();
    spin.add(items);
    W.planets[id] = { id, holder, grow, spin, body, clay, sat0, lift0, lush, items, scaleNow: ASLEEP_SCALE, sleepK: 1,
      view: { awake: false, growth: 0, stage: 0, tended: false, status: 'asleep', items: [] }, itemKey: '' };
  }
  for (const [a, b] of GARLANDS) {
    const g = new Garland({ seed: W.garlands.length * 13 + 5, bulbs: 8 + (W.garlands.length % 3), lanterns: 1 + (W.garlands.length % 2) });
    g.ends = [a, b];
    scene.add(g.group);
    W.garlands.push(g);
  }
  const from = new THREE.Vector3(-0.78, 0.2, 0.55).normalize().multiplyScalar(HOME_R).add(home.position);
  const to = new THREE.Vector3(...VISUAL.ocean.pos).add(new THREE.Vector3(0.5, PLANET_R * 0.95, 0.3));
  const stones = makeStones([0.2, 0.4, 0.6, 0.8].map((t) => from.clone().lerp(to, t).add(new THREE.Vector3(0, Math.sin(t * Math.PI) * 0.45, 0))));
  scene.add(stones);

  async function decorateHome(h) {
    const deco = new THREE.Group();
    deco.position.copy(h.position);
    scene.add(deco);
    const S = surfaceSamples(h, deco);
    const lush = { grow: { value: 1 }, time: cozyU.time };
    deco.add(makeVines(S, lush, { unit: HOME_R, strands: 34, seed: 3, hang: [0.2, 0.7], band: [-0.05, 0.6] }));
    const keep = []; for (let i = 0; i < S.count; i++) if (Math.hypot(S.P[i * 3], S.P[i * 3 + 2]) > 1.05) keep.push(i);
    const S2 = { ...S, P: keep.flatMap((i) => [S.P[i * 3], S.P[i * 3 + 1], S.P[i * 3 + 2]]), N: keep.flatMap((i) => [S.N[i * 3], S.N[i * 3 + 1], S.N[i * 3 + 2]]), count: keep.length };
    deco.add(makeFlowers(S2, lush, { unit: HOME_R, count: 46, seed: 4, minY: 0.2 }));
    const front = [];
    for (let i = 0; i < S.count; i++) { const y = S.P[i * 3 + 1] / HOME_R, nz = S.N[i * 3 + 2]; if (nz > 0.8 && y > -0.45 && y < -0.12) front.push(i); }
    const win = (x, size) => {
      let bi = -1, bd = 1e9;
      for (const i of front) { const d = Math.abs(S.P[i * 3] - x) + Math.abs(S.P[i * 3 + 1] / HOME_R + 0.28) * 2; if (d < bd) { bd = d; bi = i; } }
      if (bi < 0) return;
      const w = makeWindow(size), n = new THREE.Vector3(S.N[bi * 3], S.N[bi * 3 + 1], S.N[bi * 3 + 2]);
      w.position.set(S.P[bi * 3], S.P[bi * 3 + 1], S.P[bi * 3 + 2]).addScaledVector(n, 0.01);
      w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      deco.add(w);
    };
    win(-0.55, 0.24); win(0.6, 0.17);
    const down = new THREE.Raycaster();
    for (const [id, x, z, hh, ry] of [['item_lamp', -1.25, 0.15, 0.95, 0.5], ['item_booktower', 1.2, 0.35, 0.55, -0.4]]) {
      down.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
      const hit = down.intersectObject(h, true)[0];
      if (!hit) continue;
      const it = new THREE.Group();
      it.add(await itemMesh(id, hh), contactBlob(hh * 0.9));
      it.position.copy(hit.point); it.rotation.y = ry;
      scene.add(it);
      if (id === 'item_lamp') { const L = new THREE.PointLight('#ffc27a', 5, 3.2, 1.5); L.position.copy(hit.point).add(new THREE.Vector3(0.35, hh * 0.75, 0.2)); scene.add(L); }
    }
  }

  // ---------------------------------------------------------------- Nimbus
  const mascot = await mascotP;
  const anim = mascot.animator;
  const wardrobe = new Wardrobe(mascot);
  scene.add(mascot.root, mascot.shadow);
  anim.onEvent = (kind) => fx.emit(kind, mascot.root.position);
  const L = mascot.look;
  renderer.toneMappingExposure = (L.exposure ?? 1) * 0.95;
  hemi.intensity = (L.hemi ?? 1) * 0.95;
  key.intensity = L.key ?? 2;
  const az = THREE.MathUtils.degToRad(L.keyAz ?? -40), el = THREE.MathUtils.degToRad(L.keyEl ?? 40);
  key.position.set(8 * Math.cos(el) * Math.sin(az), 8 * Math.sin(el), 8 * Math.cos(el) * Math.cos(az));

  // ---------------------------------------------------------------- items on planets
  async function placeItemMesh(pid, it) {
    const P = W.planets[pid];
    const holder = new THREE.Group();
    holder.add(await itemMesh(it.id), contactBlob((ITEM_H[it.id] || 0.4) * 1.5));
    holder.position.fromArray(it.p);
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().fromArray(it.n).normalize());
    holder.userData = { pid, itemId: it.id };
    P.items.add(holder);
    return holder;
  }
  async function syncItems(pid, list) {
    const P = W.planets[pid];
    const k = JSON.stringify(list);
    if (k === P.itemKey) return;
    const prev = P.itemKey ? JSON.parse(P.itemKey) : [];
    P.itemKey = k;
    // added at the end -> pop in; anything else -> rebuild
    if (list.length === prev.length + 1 && JSON.stringify(list.slice(0, -1)) === JSON.stringify(prev)) {
      const h = await placeItemMesh(pid, list[list.length - 1]);
      h.scale.setScalar(0.001); h.userData.pop = 0;
      return;
    }
    P.items.clear();
    for (const it of list) await placeItemMesh(pid, it);
  }

  // ---------------------------------------------------------------- state from the app
  function sync(view) {
    for (const id of IDS) {
      const v = view.planets[id];
      if (!v) continue;
      W.planets[id].view = v;
      syncItems(id, v.items || []);
    }
    if (view.equipped) wardrobe.wear(view.equipped);
  }

  // ---------------------------------------------------------------- camera
  const insets = { left: 0, right: 0, top: 0, bottom: 0 }, insetGoal = { ...insets };
  let mode = 'overview', focusId = null, camT = 1, introT = still ? 1 : 0;
  const camGoal = new THREE.Vector3(), tgtGoal = new THREE.Vector3(), tgt = new THREE.Vector3().copy(CLUSTER.center);
  let size = { w: 1, h: 1 };
  function freeBox() {
    const w = Math.max(80, size.w - insets.left - insets.right), h = Math.max(80, size.h - insets.top - insets.bottom);
    return { w, h };
  }
  function goals(out, target) {
    const f = freeBox(), tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitDist = (halfW, halfH, margin = 0.9) => Math.max(halfW * size.h / (f.w * margin * tanV), halfH * size.h / (f.h * margin * tanV));
    if (mode === 'planet' && focusId) {
      const P = W.planets[focusId], r = P.scaleNow * PLANET_R;
      target.copy(P.holder.position);
      const dir = new THREE.Vector3(P.holder.position.x * 0.12, 0.42, 1).normalize();
      out.copy(target).addScaledVector(dir, Math.max(fitDist(r * 1.35, r * 1.35, 0.8), 3.2));
    } else if (mode === 'mascot') {
      target.set(0, 0.62, 0);
      out.copy(target).addScaledVector(new THREE.Vector3(0, 0.22, 1).normalize(), Math.max(fitDist(1.45, 1.25, 0.85), 3.4));
    } else {
      target.copy(CLUSTER.center);
      const d = fitDist(CLUSTER.halfW, CLUSTER.halfH, 0.9);
      out.copy(target).addScaledVector(new THREE.Vector3(0, 0.2, 1).normalize(), d * (1 + (1 - easeOut(introT)) * 0.55));
      out.y += (1 - easeOut(introT)) * 4;
    }
  }
  const easeOut = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
  // gentle user orbit: drag to look around the current target, springs back
  const drag = { yaw: 0, pitch: 0, vy: 0, vp: 0, active: false, last: null, zoom: 0 };
  function view(m, id = null) { mode = m; focusId = id; camT = 0; }
  function setInsets(v) { Object.assign(insetGoal, v); }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    size = { w, h };
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 46 : 34;
    applyOffset();
  }
  function applyOffset() {
    camera.setViewOffset(size.w, size.h, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, size.w, size.h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  goals(camGoal, tgtGoal);
  camera.position.copy(camGoal); tgt.copy(tgtGoal);

  // ---------------------------------------------------------------- input
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const handlers = { planet: () => {}, empty: () => {}, mascot: () => {}, surface: null, item: null };
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; drag.active = true; drag.last = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag.active || !drag.last) return;
    const dx = e.clientX - drag.last[0], dy = e.clientY - drag.last[1];
    drag.last = [e.clientX, e.clientY];
    drag.yaw = Math.max(-0.9, Math.min(0.9, drag.yaw - dx * 0.004));
    drag.pitch = Math.max(-0.35, Math.min(0.5, drag.pitch + dy * 0.003));
  });
  const end = () => { drag.active = false; drag.last = null; };
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); drag.zoom = Math.max(-0.35, Math.min(0.5, drag.zoom + e.deltaY * 0.0008)); }, { passive: false });
  canvas.addEventListener('pointerup', (e) => {
    end();
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(mascot.body, false).length) { handlers.mascot(); return; }
    if (mode === 'planet' && focusId) {
      const P = W.planets[focusId];
      if (handlers.item) {
        const ih = ray.intersectObject(P.items, true)[0];
        if (ih) { let h = ih.object; while (h.parent !== P.items) h = h.parent; handlers.item(focusId, P.items.children.indexOf(h)); return; }
      }
      const hit = ray.intersectObject(P.body, true)[0];
      if (hit && handlers.surface) {
        P.spin.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(P.spin.matrixWorld).invert();
        const local = hit.point.clone().applyMatrix4(inv);
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : hit.point.clone().sub(P.holder.position).normalize();
        const nLocal = n.transformDirection(inv).normalize();
        handlers.surface(focusId, { p: local.toArray().map((v) => +v.toFixed(4)), n: nLocal.toArray().map((v) => +v.toFixed(4)) });
        fx.emit('sparkle', hit.point.clone().add(new THREE.Vector3(0, -0.85, 0)), { scale: 0.4 });
        return;
      }
    }
    for (const id of IDS) if (ray.intersectObject(W.planets[id].holder, true).length) { handlers.planet(id); return; }
    handlers.empty();
  });

  // ---------------------------------------------------------------- frame
  const _ga = new THREE.Vector3(), _gb = new THREE.Vector3(), _kd = new THREE.Vector3();
  const centerOf = (id) => (id === 'home' ? home.position : W.planets[id].holder.position);
  function endPoint(id, toward, out) {
    const c = centerOf(id), r = id === 'home' ? HOME_R : W.planets[id].scaleNow * PLANET_R;
    const d = new THREE.Vector3(toward.x - c.x, 0, toward.z - c.z).normalize().multiplyScalar(0.8);
    d.y = 0.58 + (id === 'home' ? 0.08 : 0);
    return out.copy(c).addScaledVector(d.normalize(), r * 0.9);
  }
  let time = 0;
  function step(dt) {
    time += dt;
    cozyU.time.value = time;
    if (introT < 1) introT = Math.min(1, introT + dt / 2.6);
    for (const k of ['left', 'right', 'top', 'bottom']) insets[k] += (insetGoal[k] - insets[k]) * Math.min(1, dt * 7);
    applyOffset();
    for (const id of IDS) {
      const P = W.planets[id], v = P.view, ph = P.holder.userData.phase;
      P.holder.position.copy(P.holder.userData.base).add(new THREE.Vector3(Math.sin(time * 0.21 + ph) * 0.06, Math.sin(time * 0.6 + ph) * 0.12, 0));
      const goal = v.awake ? STAGE_SCALE[v.stage] : ASLEEP_SCALE;
      P.scaleNow += (goal - P.scaleNow) * Math.min(1, dt * 2.5);
      P.grow.scale.setScalar(P.scaleNow * PLANET_R);
      P.lush.grow.value += ((v.awake ? lushOf(v.growth) : 0.04) - P.lush.grow.value) * Math.min(1, dt * 1.2);
      P.sleepK += ((v.awake ? 0 : 1) - P.sleepK) * Math.min(1, dt * 2);
      P.spin.rotation.y += dt * (focusId === id && mode === 'planet' ? 0.03 : v.awake ? 0.05 : 0.015);
      const gl = v.awake ? (0.35 + [0, 0.3, 0.6, 1][v.stage] * 0.55) * (v.tended ? 1.5 : 1) : 0.3;
      P.clay.forEach((u, i) => {
        u.uRimK.value += (gl - u.uRimK.value) * Math.min(1, dt * 3);
        u.uSat.value = P.sat0[i] * (1 - 0.62 * P.sleepK);   // asleep: faded pastel, not muddy
        u.uLift.value = P.lift0[i] + 0.05 * P.sleepK;
      });
      for (const it of P.items.children) if (it.userData.pop !== undefined) {
        it.userData.pop += dt;
        const k = Math.min(1, it.userData.pop / 0.5);
        it.scale.setScalar(Math.max(0.001, 1 + Math.sin(k * Math.PI) * 0.3 * (1 - k) - (1 - k) ** 3));
        if (k >= 1) delete it.userData.pop;
      }
    }
    for (const g of W.garlands) {
      const [a, b] = g.ends, ca = centerOf(a), cb = centerOf(b);
      endPoint(a, cb, _ga); endPoint(b, ca, _gb);
      const lit = (id) => (id === 'home' ? 1 : W.planets[id].lush.grow.value);
      g.update(_ga, _gb, 0.35 + _ga.distanceTo(_gb) * 0.09, (lit(a) + lit(b)) / 2 - 0.3, time);
    }
    stones.userData.update(time);
    // camera
    goals(camGoal, tgtGoal);
    if (!drag.active) { drag.yaw *= 1 - Math.min(1, dt * 0.6); drag.pitch *= 1 - Math.min(1, dt * 0.6); }
    camT = Math.min(1, camT + dt * 0.9);
    const k = still ? 1 : Math.min(1, dt * (1.6 + camT * 2));
    tgt.lerp(tgtGoal, k);
    const off = camGoal.clone().sub(tgtGoal);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += drag.yaw; sph.phi = Math.max(0.35, Math.min(2.0, sph.phi - drag.pitch)); sph.radius *= 1 + drag.zoom;
    const want = new THREE.Vector3().setFromSpherical(sph).add(tgtGoal);
    camera.position.lerp(want, k);
    camera.lookAt(tgt);
    drag.zoom *= 1 - Math.min(1, dt * 0.25);
    if (mode === 'planet' && focusId) anim.faceTo(Math.atan2(W.planets[focusId].holder.position.x, W.planets[focusId].holder.position.z) * 0.8);
    else anim.faceTo(0);
    mascot.update(dt, time, { autoBlink: !still });
    wardrobe.update(dt, time);
    fx.update(dt);
    skyFx.update(time, renderer);
    cozyU.px.value = renderer.getPixelRatio();
  }
  function render() {
    camera.updateMatrixWorld();
    _kd.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
    mascot.setKeyDir(_kd);
    fx.setViewport(renderer, camera);
    post.composer.render();
  }

  // screen position of a planet's label anchor (px, CSS), for HTML labels
  const _p = new THREE.Vector3();
  function anchor(id, { center = false } = {}) {
    const P = id === 'nimbus' ? null : W.planets[id];
    if (P) _p.copy(P.holder.position).add(new THREE.Vector3(0, center ? 0 : P.scaleNow * PLANET_R * 1.08, 0));
    else _p.set(0, 1.75, 0);
    _p.project(camera);
    return { x: (_p.x * 0.5 + 0.5) * size.w, y: (-_p.y * 0.5 + 0.5) * size.h, on: _p.z < 1 };
  }
  function celebrate(kind, id) {
    const at = id ? W.planets[id].holder.position.clone().add(new THREE.Vector3(0, -0.6, 0)) : mascot.root.position.clone();
    fx.emit(kind, at, { scale: id ? 0.7 : 1 });
  }

  // compile shaders before the first visible frame so the reveal doesn't stutter
  await skyFx.ready;
  try { await renderer.compileAsync(scene, camera); } catch { /* older drivers: compile on first frame */ }
  step(1 / 60); render();
  tick('ready');

  let running = false;
  function start() {
    if (running) return;
    running = true;
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => { step(Math.min(clock.getDelta(), 0.05)); render(); });
  }
  // deterministic frames (tests / screenshots)
  function advance(seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) step(1 / 60); render(); }

  return { scene, camera, renderer, mascot, anim, wardrobe, handlers, sync, view, setInsets, anchor, celebrate, start, advance,
    get mode() { return mode; }, get focus() { return focusId; }, preload: (ids) => Promise.all(ids.map(loadModel)) };
}
