// Nimbus's wardrobe: shop accessories built procedurally from three.js primitives (no extra model files),
// fitted to the cloud body by raycasting its rest shape, and carried by the squash group so they ride along
// with squash & stretch. Finishes tint the vinyl body.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const mat = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'),
  clearcoat: 0.25, clearcoatRoughness: 0.5, ...o });
const glow = (color, k = 1.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });

// rest-shape probe of the body: surface points by ray from outside
function makeProbe(body) {
  const ray = new THREE.Raycaster();
  const hit = (o, d) => { ray.set(o, d.normalize()); const h = ray.intersectObject(body, false)[0]; return h ? h.point : null; };
  return {
    top(x = 0, z = 0) { return hit(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0)) || new THREE.Vector3(x, 1.4, z); },
    front(x, y) { return hit(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1)) || new THREE.Vector3(x, y, 0.6); },
    ring(y, n = 32, out = 0) {   // horizontal cross-section of the body at height y
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const p = hit(new THREE.Vector3(0, y, 0).addScaledVector(d, 4), d.clone().negate());
        pts.push((p || new THREE.Vector3(d.x, y, d.z * 0.64)).addScaledVector(d, out));
      }
      return pts;
    },
  };
}

function star(r1, r2, n = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? r2 : r1;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: r1 * 0.35, bevelEnabled: true, bevelThickness: r1 * 0.18, bevelSize: r1 * 0.14, bevelSegments: 3 });
}
function flower(petal, heart, size = 0.06) {
  const g = new THREE.Group();
  const P = new THREE.SphereGeometry(size, 12, 8);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(P, mat(petal));
    const a = (i / 5) * Math.PI * 2;
    m.position.set(Math.cos(a) * size * 0.95, 0, Math.sin(a) * size * 0.95);
    m.scale.set(1, 0.45, 0.8);
    g.add(m);
  }
  const c = new THREE.Mesh(new THREE.SphereGeometry(size * 0.6, 12, 8), mat(heart));
  c.scale.y = 0.7; c.position.y = size * 0.15;
  g.add(c);
  return g;
}
const sit = (obj, p, n) => { obj.position.copy(p); obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize()); return obj; };

// each builder returns a Group in mascot space (y up, face toward +z, base at y=0)
const BUILD = {
  head_sprout(P) {
    const g = new THREE.Group();
    const top = P.top(0.02, 0.05);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.02, 0.12, 0), new THREE.Vector3(0.07, 0.22, 0.02)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.022, 8), mat('#6fbf6a')));
    const L = new THREE.SphereGeometry(0.11, 20, 12);
    for (const [s, rz] of [[1, -0.9], [-1, 0.9]]) {
      const leaf = new THREE.Mesh(L, mat('#8fd47e'));
      leaf.scale.set(1, 0.22, 0.55);
      leaf.position.set(0.07 + s * 0.1, 0.25, 0.02);
      leaf.rotation.set(0, s * 0.2, rz * 0.45);
      g.add(leaf);
    }
    g.position.copy(top);
    return g;
  },
  head_party(P) {
    const g = new THREE.Group();
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#ff9fc2'; c.fillRect(0, 0, 64, 256);
    c.fillStyle = '#fff1a8'; for (let y = 16; y < 256; y += 56) c.fillRect(0, y, 64, 22);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 40, 1, true), mat('#ffffff', { map: tex, side: THREE.DoubleSide }));
    cone.position.y = 0.21;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), mat('#fff6d8', { sheen: 1 }));
    pom.position.y = 0.46;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.022, 10, 40), mat('#b89cf0'));
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.01;
    g.add(cone, pom, rim);
    const p = P.top(0.2, 0.02);
    g.position.copy(p).add(new THREE.Vector3(0, -0.03, 0));
    g.rotation.z = -0.28;
    return g;
  },
  head_beanie(P) {
    const g = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat('#8fb2f2', { roughness: 0.85, sheen: 1, sheenColor: new THREE.Color('#dfe9ff') }));
    cap.scale.set(1, 0.85, 0.95);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 14, 48), mat('#7ea2e6', { roughness: 0.9, sheen: 1 }));
    brim.rotation.x = Math.PI / 2; brim.scale.set(1, 0.95, 1.2);
    const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 3), mat('#ffffff', { roughness: 1, sheen: 1 }));
    pom.position.y = 0.33;
    g.add(cap, brim, pom);
    g.position.copy(P.top(-0.05, 0)).add(new THREE.Vector3(0, -0.13, 0));
    g.rotation.z = 0.12;
    return g;
  },
  head_flowers(P) {
    const g = new THREE.Group();
    const top = P.top(0, 0);
    const ring = P.ring(top.y - 0.16, 11, -0.01);
    const cols = [['#ffd1e3', '#ffd66e'], ['#ffffff', '#ffc65a'], ['#d9c7ff', '#fff0a6'], ['#ffc3a8', '#fff3c4']];
    ring.forEach((p, i) => {
      const n = p.clone().sub(new THREE.Vector3(0, top.y - 0.55, 0));
      const [pc, hc] = cols[i % cols.length];
      g.add(sit(flower(pc, hc, i % 2 ? 0.05 : 0.062), p, n));
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 6), mat('#8fd47e'));
      leaf.scale.set(1, 0.3, 0.5);
      const q = ring[(i + 1) % ring.length];
      leaf.position.copy(p).lerp(q, 0.5);
      leaf.lookAt(q);
      g.add(leaf);
    });
    return g;
  },
  head_halo(P) {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 16, 64), glow('#ffe7a0', 1.3));
    t.rotation.x = Math.PI / 2 - 0.25;
    g.add(t);
    g.position.copy(P.top(0, 0)).add(new THREE.Vector3(0, 0.2, 0));
    g.userData.bob = true;
    return g;
  },
  head_crown(P) {
    const g = new THREE.Group();
    const gold = mat('#ffcf5c', { metalness: 0.65, roughness: 0.28, clearcoat: 0.6, sheen: 0 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.11, 40, 1, true), gold);
    band.material.side = THREE.DoubleSide;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 12), gold);
      spike.position.set(Math.sin(a) * 0.18, 0.11, Math.cos(a) * 0.18);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), gold);
      ball.position.set(Math.sin(a) * 0.18, 0.18, Math.cos(a) * 0.18);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.028), mat(['#ff8fb5', '#8fd3ff', '#b79cff', '#7fe0b8', '#ff9f8f'][i], { roughness: 0.15, clearcoat: 1 }));
      gem.position.set(Math.sin(a) * 0.19, 0, Math.cos(a) * 0.19);
      g.add(spike, ball, gem);
    }
    g.position.copy(P.top(0.12, 0)).add(new THREE.Vector3(0, 0.02, 0));
    g.rotation.z = -0.22;
    return g;
  },
  neck_bowtie(P) {
    const g = new THREE.Group();
    const m = mat('#ef7fa0');
    for (const s of [1, -1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 4, 1), m);
      wing.rotation.z = s * Math.PI / 2;
      wing.rotation.x = Math.PI / 4;
      wing.scale.set(1, 1, 0.5);
      wing.position.x = s * 0.1;
      g.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), m);
    knot.scale.set(1, 1, 0.7);
    g.add(knot);
    const p = P.front(0, 0.52);
    g.position.copy(p).add(new THREE.Vector3(0, 0, 0.03));
    return g;
  },
  neck_scarf(P) {
    const g = new THREE.Group();
    const knit = mat('#f39a7b', { roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffe0d2') });
    const ring = P.ring(0.5, 48, 0.035);
    const loop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 96, 0.075, 12, true), knit);
    loop.scale.y = 1.35;
    loop.position.y = -0.5 * 0.35;
    g.add(loop);
    const knotAt = ring[Math.round(48 * 0.06)];   // a little right of centre-front
    const tail = new THREE.CatmullRomCurve3([knotAt.clone(), knotAt.clone().add(new THREE.Vector3(0.06, -0.16, 0.07)), knotAt.clone().add(new THREE.Vector3(0.1, -0.36, 0.05))]);
    const t = new THREE.Mesh(new THREE.TubeGeometry(tail, 20, 0.06, 10), knit);
    t.scale.set(1, 1, 1);
    g.add(t);
    const stripe = mat('#fff1e6', { roughness: 0.9, sheen: 1 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.018, 8, 20), stripe);
    band.position.copy(tail.getPoint(0.8)); band.lookAt(tail.getPoint(1));
    g.add(band);
    return g;
  },
  neck_star(P) {
    const g = new THREE.Group();
    const ring = P.ring(0.62, 48, 0.012).filter((p) => p.z > 0.18);
    ring.sort((a, b) => a.x - b.x);
    const mid = ring[Math.floor(ring.length / 2)];
    const sag = ring.map((p) => p.clone().add(new THREE.Vector3(0, -0.12 * (1 - (p.x / ring[0].x) ** 2), 0)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sag), 64, 0.012, 6), mat('#b79cff')));
    const pend = new THREE.Mesh(star(0.085, 0.04), glow('#ffd76b', 0.55));
    pend.geometry.center();
    const low = sag.reduce((a, b) => (b.y < a.y ? b : a), sag[0]);
    pend.position.copy(low).add(new THREE.Vector3(0, -0.075, 0.03));
    g.add(pend);
    void mid;
    return g;
  },
  cushion() {   // thumbnail only (supplies are not worn)
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 24), mat('#f6eefe', { roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#d9c8ff') }));
    c.scale.set(1, 0.42, 0.8);
    g.add(c);
    for (const [x, z, r] of [[-0.25, 0.1, 0.2], [0.18, 0.12, 0.24], [0.02, -0.12, 0.22]]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), c.material);
      puff.position.set(x, 0.14, z);
      puff.scale.y = 0.7;
      g.add(puff);
    }
    return g;
  },
};

export class Wardrobe {
  constructor(mascot) {
    this.m = mascot;
    this.probe = makeProbe(mascot.body);
    this.slots = { head: null, neck: null };
    this.cache = {};
    this.base = mascot.vinyl.color.clone();
    this.finish = new THREE.Color('#ffffff');
    this.finishGoal = new THREE.Color('#ffffff');
  }
  build(id) {
    if (!this.cache[id]) {
      const g = BUILD[id](this.probe);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.wardrobe = true; } });
      g.userData.home = { p: g.position.clone(), r: g.rotation.clone() };
      this.cache[id] = g;
    }
    return this.cache[id];
  }
  // equipped: { head, neck, finish } with finish as a colour string
  wear({ head, neck, finishColor }) {
    for (const [slot, id] of [['head', head], ['neck', neck]]) {
      if (this.slots[slot]?.name === id) continue;
      if (this.slots[slot]) this.slots[slot].obj.removeFromParent();
      this.slots[slot] = id && BUILD[id] ? { name: id, obj: this.build(id), pop: 0 } : null;
      if (this.slots[slot]) this.m.squash.add(this.slots[slot].obj);
    }
    if (finishColor) this.finishGoal.set(finishColor);
  }
  update(dt, time) {
    this.finish.lerp(this.finishGoal, Math.min(1, dt * 4));
    this.m.vinyl.color.copy(this.base).multiply(this.finish);
    // follow the shape keys a little: dome rise lifts hats, leaning tilts them
    const dict = this.m.body.morphTargetDictionary, inf = this.m.body.morphTargetInfluences;
    const k = (n) => (dict[n] !== undefined ? inf[dict[n]] : 0);
    const lean = k('LeanX'), up = k('DomeUp'), droop = k('Droop'), breathe = k('Breathe');
    for (const slot of ['head', 'neck']) {
      const S = this.slots[slot];
      if (!S) continue;
      const o = S.obj, h = o.userData.home;
      S.pop = Math.min(1, S.pop + dt / 0.45);
      const e = S.pop < 1 ? 1 + Math.sin(S.pop * Math.PI) * 0.25 * (1 - S.pop) - (1 - S.pop) ** 3 : 1;
      o.scale.setScalar(Math.max(0.001, e));
      if (slot === 'head') {
        o.position.set(h.p.x + lean * 0.16, h.p.y + up * 0.1 - droop * 0.07 + breathe * 0.012, h.p.z);
        o.rotation.set(h.r.x, h.r.y, h.r.z - lean * 0.2);
        if (o.userData.bob) o.position.y += Math.sin(time * 2.1) * 0.025;
      } else {
        o.position.set(h.p.x + lean * 0.05, h.p.y - droop * 0.02, h.p.z);
      }
    }
  }
}

// ------------------------------------------------------------------ shop thumbnails (one small offscreen renderer)
let T = null;
export function thumbnail(id, size = 160) {
  if (!BUILD[id]) return null;
  if (!T) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const key = new THREE.DirectionalLight('#fff1e0', 2.2); key.position.set(-2, 3, 4);
    scene.add(key, new THREE.HemisphereLight('#f3e8ff', '#ffd9c4', 1.2));
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    // a plain stand-in body so neckwear has something to sit on in the thumbnail
    T = { renderer, scene, cam, cache: {} };
  }
  if (T.cache[id]) return T.cache[id];
  const probe = makeProbe(fakeBody());
  const obj = BUILD[id](probe);
  const pivot = new THREE.Group();
  pivot.add(obj);
  T.scene.add(pivot);
  const box = new THREE.Box3().setFromObject(pivot);
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  T.cam.position.copy(c).add(new THREE.Vector3(0.35, 0.45, 1).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.92));
  T.cam.lookAt(c);
  T.renderer.render(T.scene, T.cam);
  const url = T.renderer.domElement.toDataURL('image/png');
  T.scene.remove(pivot);
  T.cache[id] = url;
  return url;
}
// a rounded cloud-ish stand-in, only for fitting thumbnails
let _fake = null;
function fakeBody() {
  if (_fake) return _fake;
  const g = new THREE.SphereGeometry(1, 48, 32);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.scale.set(1, 0.71, 0.64); m.position.y = 0.71;
  m.updateMatrixWorld(true);
  _fake = m;
  return m;
}
