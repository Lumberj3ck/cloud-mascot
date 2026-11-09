// Cozy layer for the planet world: everything here is procedural three.js (geometry + shaders + lights),
// no extra assets.
//   surfaceSamples  vertex cloud of a model in some frame, used to place decor on its real surface
//   makeVines       hanging vines with wisteria-like blossom tips, draped over a planet's rim
//   makeFlowers     little five-petal flowers on a planet's top
//     both grow with a per-planet uniform (uGrow 0..1, shader-side) and sway with uTime
//   Garland         vine string with warm bulbs + hanging lanterns between two moving anchor points
//   makeWindow      glowing round window set into a planet's surface
//   makeWaterfall   shader water ribbon spilling off a rim
//   makeStones      floating glowing stepping stones along a path
//   makeFireflies   drifting warm motes (additive points, bloom picks them up)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ surface samples
// all (subsampled) vertices + normals of `root`, expressed in `frame`'s local space
export function surfaceSamples(root, frame, max = 24000) {
  root.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const P = [], N = [], v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    m.multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    const pa = g.attributes.position, na = g.attributes.normal, step = Math.max(1, Math.floor(pa.count / max));
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      if (n.dot(v) < 0) n.negate();   // generated meshes have mixed winding: make every normal face outward
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z);
    }
  });
  return { P, N, count: P.length / 3 };
}
function pick(S, count, test, r, minDist = 0) {
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 600; tries++) {
    const i = Math.floor(r() * S.count) * 3;
    const p = new THREE.Vector3(S.P[i], S.P[i + 1], S.P[i + 2]), n = new THREE.Vector3(S.N[i], S.N[i + 1], S.N[i + 2]);
    if (!test(p, n)) continue;
    if (minDist && out.some((o) => o.p.distanceToSquared(p) < minDist * minDist)) continue;
    out.push({ p, n });
  }
  return out;
}

// ------------------------------------------------------------------ growth material
// instanced decor: aGrow = (threshold, sway amount, phase). An instance pops in as uGrow passes its threshold,
// and sways in the planet's horizontal plane (more toward a vine's tip).
function growMaterial(params, U) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, ...params });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrow = U.grow;
    sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGrow; uniform float uGrow; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float gk = smoothstep(aGrow.x, aGrow.x + 0.12, uGrow);
        transformed *= gk * (1.0 + 0.25 * sin(gk * 3.14159));`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        mvPosition.xz += vec2(sin(uTime * 1.1 + aGrow.z), cos(uTime * 0.83 + aGrow.z * 1.7)) * aGrow.y;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  return m;
}
function instanced(geo, mat, list) {
  const g = geo.clone();
  const a = new Float32Array(list.length * 3);
  list.forEach((it, i) => a.set(it.grow, i * 3));
  g.setAttribute('aGrow', new THREE.InstancedBufferAttribute(a, 3));
  const mesh = new THREE.InstancedMesh(g, mat, list.length);
  list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
  mesh.frustumCulled = false;   // shader moves instances; bounds are approximate anyway
  return mesh;
}
const leafGeo = (() => { const g = new THREE.SphereGeometry(1, 7, 5); g.scale(0.5, 0.12, 1); g.translate(0, 0, 0.7); return g; })();
const blobGeo = new THREE.IcosahedronGeometry(1, 1);
const petalGeo = (() => {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const p = new THREE.SphereGeometry(1, 8, 5); p.scale(0.42, 0.16, 0.62); p.translate(0, 0, 0.55); p.rotateY((k / 5) * Math.PI * 2);
    parts.push(p);
  }
  return mergeGeometries(parts);
})();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const mat4 = (p, q, s) => new THREE.Matrix4().compose(p, q, _s.setScalar(s));

const GREENS = ['#8fcf7a', '#a6dc8a', '#79bb6a', '#b9e59c', '#6faa62'].map((c) => new THREE.Color(c));

// ------------------------------------------------------------------ hanging vines
// `unit` = planet radius in this frame; the planet centre is the frame origin.
export function makeVines(S, U, { unit = 1, strands = 22, seed = 1, hang = [0.25, 0.9], band = [-0.12, 0.5], blossom = ['#c9a2ee', '#e2c4fa', '#f6b8d6'], flowerRate = 0.1 } = {}) {
  const r = rng(seed), leaves = [], blooms = [];
  const anchors = pick(S, strands, (p, n) => {
    const rxz = Math.hypot(p.x, p.z), y = p.y / unit;
    return y > band[0] && y < band[1] && rxz > 0.78 * unit && (n.x * p.x + n.z * p.z) / rxz > 0.3;
  }, r, 0.12 * unit);
  const bc = blossom.map((c) => new THREE.Color(c));
  for (const { p: a } of anchors) {
    const R0 = a.length(), ra = Math.hypot(a.x, a.z), th = Math.atan2(a.z, a.x);
    const L = (hang[0] + Math.pow(r(), 1.4) * (hang[1] - hang[0])) * unit, ts = r() * 0.55, ph = r() * 6.28;
    const step = 0.04 * unit, pal = bc[Math.floor(r() * bc.length)];
    let pos = new THREE.Vector3();
    for (let s = 0, k = 0; s < L; s += step, k++) {
      const y = a.y - s, rad = Math.max(ra, Math.sqrt(Math.max(0, R0 * R0 - y * y))) + 0.03 * unit;
      const t = th + Math.sin(s / unit * 7 + ph) * 0.03;
      pos = new THREE.Vector3(Math.cos(t) * rad, y, Math.sin(t) * rad);
      const f = s / L, thr = Math.min(0.92, ts * 0.45 + f * 0.5), sway = f * f * 0.035 * unit;
      _e.set(r() * 0.8 - 0.4, (k % 2 ? 1 : -1) * 1.4 + r() * 0.6 + t, -0.9 + r() * 0.5);
      leaves.push({ m: mat4(pos, _q.setFromEuler(_e).clone(), (0.05 + r() * 0.025) * unit * (1 - f * 0.35)),
        c: GREENS[Math.floor(r() * GREENS.length)], grow: [thr, sway, ph] });
      if (r() < flowerRate) blooms.push({ m: mat4(pos.clone().add(new THREE.Vector3(0, 0, 0)), _q.identity().clone(), 0.022 * unit), c: pal, grow: [thr + 0.04, sway, ph] });
    }
    // wisteria tip: a tapering cluster of blossoms
    const n = 4 + Math.floor(r() * 5), thrTip = Math.min(0.95, ts * 0.45 + 0.52);
    for (let k = 0; k < n; k++) {
      const q = pos.clone().add(new THREE.Vector3((r() - 0.5) * 0.035 * unit, -(k + 0.5) * 0.028 * unit, (r() - 0.5) * 0.035 * unit));
      blooms.push({ m: mat4(q, _q.identity().clone(), (0.03 - k * 0.0025) * unit), c: pal.clone().lerp(new THREE.Color('#ffffff'), r() * 0.3), grow: [thrTip, 0.035 * unit, ph] });
    }
  }
  const g = new THREE.Group();
  g.name = 'Vines';
  g.add(instanced(leafGeo, growMaterial({}, U), leaves));
  g.add(instanced(blobGeo, growMaterial({ emissive: '#5a3a70', emissiveIntensity: 0.15 }, U), blooms));
  return g;
}

// ------------------------------------------------------------------ flowers on top
export function makeFlowers(S, U, { unit = 1, count = 40, seed = 2, minY = 0.25, palette = ['#f7a8c8', '#fff4f8', '#c9a7f0', '#ffc79e', '#ffe58a'] } = {}) {
  const r = rng(seed), petals = [], centers = [];
  const spots = pick(S, count, (p, n) => n.y > 0.55 && p.y > minY * unit && p.length() > 0.75 * unit, r, 0.07 * unit);
  const pc = palette.map((c) => new THREE.Color(c)), yellow = new THREE.Color('#ffd76a');
  for (const { p, n } of spots) {
    const q = new THREE.Quaternion().setFromUnitVectors(UP, n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r() * 6.28));
    const s = (0.035 + r() * 0.03) * unit, at = p.clone().addScaledVector(n, 0.012 * unit), thr = r() * 0.85, ph = r() * 6.28;
    petals.push({ m: mat4(at, q, s), c: pc[Math.floor(r() * pc.length)], grow: [thr, 0.004 * unit, ph] });
    centers.push({ m: mat4(at.clone().addScaledVector(n, 0.012 * unit), q, s * 0.3), c: yellow, grow: [thr, 0.004 * unit, ph] });
  }
  const g = new THREE.Group();
  g.name = 'Flowers';
  g.add(instanced(petalGeo, growMaterial({ emissive: '#6b4060', emissiveIntensity: 0.12 }, U), petals));
  g.add(instanced(blobGeo, growMaterial({ emissive: '#ffb84a', emissiveIntensity: 0.25 }, U), centers));
  return g;
}

// ------------------------------------------------------------------ garland: vine + bulbs + lanterns
const bulbGeo = new THREE.SphereGeometry(1, 12, 8);
export class Garland {
  constructor({ seg = 40, radial = 5, thick = 0.022, bulbs = 9, lanterns = 2, seed = 3 } = {}) {
    this.seg = seg; this.radial = radial; this.thick = thick;
    const r = rng(seed);
    this.group = new THREE.Group();
    this.group.name = 'Garland';
    // string: a tube we rewrite every frame
    const nv = (seg + 1) * radial, idx = [];
    for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setIndex(idx);
    this.tube = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#6f9a55', roughness: 0.9 }));
    this.tube.frustumCulled = false;
    this.group.add(this.tube);
    // leaves wound around the string
    this.leafT = Array.from({ length: Math.round(seg * 1.1) }, (_, i) => ({ t: (i + r()) / (seg * 1.1), a: r() * 6.28, s: 0.045 + r() * 0.03, c: GREENS[Math.floor(r() * 5)], tw: r() * 6.28 }));
    this.leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), this.leafT.length);
    this.leafT.forEach((l, i) => this.leaves.setColorAt(i, l.c));
    this.leaves.frustumCulled = false;
    this.group.add(this.leaves);
    // bulbs: HDR warm colour so the bloom pass turns them into soft glows
    this.bulbT = Array.from({ length: bulbs }, (_, i) => (i + 1) / (bulbs + 1));
    this.bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.42) });
    this.bulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, bulbs);
    this.bulbs.frustumCulled = false;
    this.group.add(this.bulbs);
    // little hanging lanterns
    this.lanterns = [];
    const capMat = new THREE.MeshStandardMaterial({ color: '#8a5a3c', roughness: 0.7 });
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5) });
    for (let k = 0; k < lanterns; k++) {
      const L = new THREE.Group();
      const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 4), capMat); thread.position.y = -0.08;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.07, 4, 10), this.lampMat); body.position.y = -0.24;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.07, 10), capMat); cap.position.y = -0.155;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 10), capMat); base.position.y = -0.33;
      L.add(thread, body, cap, base);
      L.userData.t = (k + 1) / (lanterns + 1) + (r() - 0.5) * 0.08;
      L.userData.ph = r() * 6.28;
      this.lanterns.push(L);
      this.group.add(L);
    }
    this.glow = 1;
  }
  at(t, out) {
    out.lerpVectors(this.A, this.B, t);
    out.y -= this.sag * 4 * t * (1 - t);
    return out;
  }
  update(A, B, sag, glow, time) {
    this.A = A; this.B = B; this.sag = sag;
    const pos = this.tube.geometry.attributes.position, nrm = this.tube.geometry.attributes.normal;
    const p = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), nn = new THREE.Vector3(), d = new THREE.Vector3();
    const frame = (t) => {
      this.at(t, p);
      T.subVectors(B, A); T.y -= sag * 4 * (1 - 2 * t); T.normalize();
      side.crossVectors(T, UP).normalize(); nn.crossVectors(side, T).normalize();
    };
    for (let i = 0; i <= this.seg; i++) {
      frame(i / this.seg);
      for (let j = 0; j < this.radial; j++) {
        const a = (j / this.radial) * Math.PI * 2;
        d.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(nn, Math.sin(a));
        const k = i * this.radial + j;
        pos.setXYZ(k, p.x + d.x * this.thick, p.y + d.y * this.thick, p.z + d.z * this.thick);
        nrm.setXYZ(k, d.x, d.y, d.z);
      }
    }
    pos.needsUpdate = nrm.needsUpdate = true;
    this.leafT.forEach((l, i) => {
      frame(l.t);
      d.copy(side).multiplyScalar(Math.cos(l.a)).addScaledVector(nn, Math.sin(l.a));
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), l.tw + Math.sin(time + l.tw) * 0.15));
      _m.compose(p.clone().addScaledVector(d, this.thick * 0.6), _q, _s.setScalar(l.s));
      this.leaves.setMatrixAt(i, _m);
    });
    this.leaves.instanceMatrix.needsUpdate = true;
    this.bulbT.forEach((t, i) => {
      this.at(t, p); p.y -= 0.045;
      _m.compose(p, _q.identity(), _s.setScalar(0.042 + 0.006 * Math.sin(time * 2 + i * 1.7)));
      this.bulbs.setMatrixAt(i, _m);
    });
    this.bulbs.instanceMatrix.needsUpdate = true;
    this.bulbMat.color.setRGB(1, 0.72, 0.4).multiplyScalar(1.2 + 4.2 * glow);
    this.lampMat.color.setRGB(1, 0.78, 0.5).multiplyScalar(1.0 + 3.0 * glow);
    for (const L of this.lanterns) {
      this.at(L.userData.t, L.position);
      L.rotation.z = Math.sin(time * 1.3 + L.userData.ph) * 0.08;
      L.rotation.x = Math.cos(time * 1.1 + L.userData.ph) * 0.06;
    }
  }
}

// ------------------------------------------------------------------ glowing round window
export function makeWindow(size = 0.16) {
  const g = new THREE.Group();
  g.name = 'Window';
  const glass = new THREE.Mesh(new THREE.CircleGeometry(size, 32), new THREE.ShaderMaterial({
    uniforms: { uK: { value: 1 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vP; uniform float uK;
      void main(){
        float r = length(vP) / ${size.toFixed(4)};
        vec3 c = mix(vec3(7.0, 4.4, 2.0), vec3(3.2, 1.6, 0.7), smoothstep(0.0, 1.0, r));   // warm room light, HDR
        float bars = max(smoothstep(0.07, 0.04, abs(vP.x) / ${size.toFixed(4)}), smoothstep(0.07, 0.04, abs(vP.y) / ${size.toFixed(4)}));
        c = mix(c, vec3(0.35, 0.18, 0.1), bars);
        gl_FragColor = vec4(c * uK, 1.0);
      }`,
  }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = size * 0.14;   // proud of the curved surface
  // a short plug sunk into the surface so the curved planet never shows a gap behind the flat glass
  const wood = new THREE.MeshStandardMaterial({ color: '#c08a5e', roughness: 0.75 });
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.02, size * 1.02, size * 0.9, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#3a2238', side: THREE.DoubleSide }));
  plug.position.y = -size * 0.3;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(size * 1.08, size * 0.16, 10, 32), wood);
  frame.rotation.x = -Math.PI / 2;
  frame.position.y = size * 0.14;
  g.add(plug, glass, frame);
  return g;
}

// ------------------------------------------------------------------ waterfall ribbon
// local frame: starts at the origin, flows out along +z and falls along -y
export function makeWaterfall(U, { width = 0.3, drop = 1.9, out = 0.32, rows = 40 } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1, 6, rows);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = 1 - uv.getY(i), x = pos.getX(i);
    const fan = 1 + u * 0.7;
    pos.setXYZ(i, x * width * fan, -drop * Math.pow(u, 1.5), out * Math.sqrt(Math.min(1, u * 2.5)) + u * 0.12);
  }
  geo.computeVertexNormals();
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: U.time },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */`varying vec2 vUv; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float u = 1.0 - vUv.y, x = vUv.x;
        float s = n(vec2(x * 16.0, u * 5.0 - uTime * 2.4)) * 0.6 + n(vec2(x * 34.0, u * 11.0 - uTime * 3.6)) * 0.4;
        vec3 c = mix(vec3(0.55, 0.86, 0.96), vec3(1.0, 1.0, 1.0), smoothstep(0.45, 0.8, s));
        c += vec3(0.25) * smoothstep(0.08, 0.0, u);                         // white lip at the top
        float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
        float a = edge * smoothstep(1.0, 0.6, u) * (0.75 + 0.25 * s);
        gl_FragColor = vec4(c * 1.4, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'Waterfall';
  mesh.renderOrder = 3;
  return mesh;
}

// ------------------------------------------------------------------ stepping stones
export function makeStones(points, { size = 0.32 } = {}) {
  const prof = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; prof.push(new THREE.Vector2(Math.sin(a) * size * (0.8 + 0.2 * Math.sin(a)), -Math.cos(a) * size * (a < Math.PI / 2 ? 0.5 : 0.18))); }
  const geo = new THREE.LatheGeometry(prof, 28);
  geo.scale(1, 1, 0.85);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffe9d2', roughness: 0.75, emissive: '#ffb871', emissiveIntensity: 0.06 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.42).multiplyScalar(5) });
  const g = new THREE.Group();
  g.name = 'Stones';
  points.forEach((p, i) => {
    const s = new THREE.Group();
    const top = new THREE.Mesh(geo, mat);
    const under = new THREE.Mesh(new THREE.CircleGeometry(size * 0.55, 24), glowMat);
    under.rotation.x = Math.PI / 2; under.position.y = -size * 0.51;
    s.add(top, under);
    s.position.copy(p);
    s.rotation.y = i * 0.9;
    s.userData = { y: p.y, ph: i * 1.3 };
    g.add(s);
  });
  g.userData.update = (t) => g.children.forEach((s) => { s.position.y = s.userData.y + Math.sin(t * 0.9 + s.userData.ph) * 0.06; s.rotation.z = Math.sin(t * 0.7 + s.userData.ph) * 0.04; });
  return g;
}

// ------------------------------------------------------------------ fireflies
export function makeFireflies(U, { count = 220, box = [16, 9, 9], center = [0, 0, -1], seed = 9 } = {}) {
  const r = rng(seed), pos = new Float32Array(count * 3), ph = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos.set([(r() - 0.5) * box[0] + center[0], (r() - 0.5) * box[1] + center[1], (r() - 0.5) * box[2] + center[2]], i * 3);
    ph.set([r() * 6.28, 0.3 + r() * 0.7, r(), 0.6 + r() * 1.4], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: U.time, uPx: U.px },
    vertexShader: `attribute vec4 aPh; uniform float uTime, uPx; varying float vA; varying float vT;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.31 * aPh.y + aPh.x), sin(uTime * 0.23 * aPh.y + aPh.x * 1.9) * 0.6, cos(uTime * 0.27 * aPh.y + aPh.x * 1.3)) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        vA = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * aPh.w + aPh.x * 3.0), 3.0);
        vT = aPh.z;
        gl_PointSize = uPx * (22.0 + 18.0 * aPh.z) / -mv.z * 7.0; }`,
    fragmentShader: `varying float vA; varying float vT;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a * vA;
        vec3 c = mix(vec3(1.0, 0.82, 0.48), vec3(1.0, 0.7, 0.85), step(0.8, vT));
        gl_FragColor = vec4(c * a * 4.0, a); }`,
  });
  const p = new THREE.Points(g, m);
  p.name = 'Fireflies';
  p.frustumCulled = false;
  return p;
}
