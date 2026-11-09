// Tiny particle effects (hearts, sparkles, confetti, rain, sun drops) as one THREE.Points system.
// Shapes are SDFs in the fragment shader (crisp at any size). Seeded RNG: shots stay deterministic.
import * as THREE from 'three';

export const FX = { heart: 0, sparkle: 1, confetti: 2, rain: 3, sun: 4 };
const MAX = 400;

function rng(seed) {   // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERT = /* glsl */`
attribute float aSize, aType, aAlpha, aRot;
attribute vec3 aColor;
uniform float uScale;
varying float vType, vAlpha, vRot;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
  vType = aType; vAlpha = aAlpha; vRot = aRot; vColor = aColor;
}`;
const FRAG = /* glsl */`
varying float vType, vAlpha, vRot;
varying vec3 vColor;
float dot2(vec2 v) { return dot(v, v); }
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, -s, s, c) * p;
  float d; vec3 col = vColor; float glow = 0.0;
  int t = int(vType + 0.5);
  if (t == 0) { d = sdHeart(p * 1.25 + vec2(0.0, 0.6)) / 1.25; }
  else if (t == 1) { vec2 a = abs(p); d = pow(a.x, 0.5) + pow(a.y, 0.5) - 0.85; d *= 0.5; }
  else if (t == 2) { vec2 a = abs(p) - vec2(0.55, 0.3); d = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0) - 0.08; }
  else if (t == 3) { d = length(vec2(p.x * 3.2, max(abs(p.y) - 0.55, 0.0))) - 0.35; }
  else { d = length(p) - 0.45; glow = exp(-dot(p, p) * 3.0); }
  float w = fwidth(d) * 0.75 + 1e-4;
  float a = clamp(0.5 - d / w, 0.0, 1.0);
  if (t == 4) { col = mix(col, vec3(1.0, 1.0, 0.92), a * 0.5); a = max(a, glow * 0.6); }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(seed = 7) {
    this.rand = rng(seed);
    this.n = 0;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.attr = {
      position: new THREE.BufferAttribute(new Float32Array(MAX * 3), 3),
      aSize: new THREE.BufferAttribute(new Float32Array(MAX), 1),
      aType: new THREE.BufferAttribute(new Float32Array(MAX), 1),
      aAlpha: new THREE.BufferAttribute(new Float32Array(MAX), 1),
      aRot: new THREE.BufferAttribute(new Float32Array(MAX), 1),
      aColor: new THREE.BufferAttribute(new Float32Array(MAX * 3), 3),
    };
    for (const [k, a] of Object.entries(this.attr)) { a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); }
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.name = 'FX';
  }

  setViewport(renderer, camera) {
    const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.material.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  spawn(type, pos, vel, { life = 1.6, size = 0.14, color = '#ff8fab', spin = 0, gravity = 0, drag = 0.8, rot = 0 } = {}) {
    if (this.p.length >= MAX) this.p.shift();
    this.p.push({ type, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, life, age: 0, size,
      color: new THREE.Color(color), spin, gravity, drag, rot });
  }

  // high-level effects around a world position (the mascot's root)
  emit(kind, at, { scale = 1 } = {}) {
    const r = this.rand;
    const P = (x, y, z) => new THREE.Vector3(at.x + x * scale, at.y + y * scale, at.z + z * scale);
    if (kind === 'hearts') {
      for (let i = 0; i < 2; i++) {
        this.spawn(FX.heart, P((r() - 0.5) * 1.2, 1.25 + r() * 0.2, 0.2 + r() * 0.3),
          new THREE.Vector3((r() - 0.5) * 0.15, 0.45 + r() * 0.2, 0), { life: 2.2, size: 0.16 + r() * 0.08,
            color: ['#ff7aa2', '#ff9fbf', '#f56d97'][i % 3], spin: (r() - 0.5) * 0.6, drag: 0.2 });
      }
    } else if (kind === 'sparkle') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + r() * 0.4;
        this.spawn(FX.sparkle, P(Math.cos(a) * 0.55, 0.85 + Math.sin(a) * 0.45, 0.5),
          new THREE.Vector3(Math.cos(a) * 0.6, Math.sin(a) * 0.6 + 0.3, 0), { life: 0.8, size: 0.14 + r() * 0.06,
            color: ['#fff2a8', '#ffd1e8', '#e8dcff'][i % 3], drag: 2.5 });
      }
    } else if (kind === 'confetti') {
      const cols = ['#ff8fab', '#ffd166', '#8fd3ff', '#b8f2c9', '#c7a8ff', '#ffb38a'];
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2, sp = 1.6 + r() * 1.8;
        this.spawn(FX.confetti, P(0, 1.4, 0), new THREE.Vector3(Math.cos(a) * sp * 0.6, 2.2 + r() * 2.4, Math.sin(a) * sp * 0.6),
          { life: 2.6 + r() * 0.8, size: 0.09 + r() * 0.05, color: cols[i % cols.length], spin: (r() - 0.5) * 14,
            gravity: 3.2, drag: 1.1, rot: r() * 6 });
      }
    } else if (kind === 'sun') {
      this.spawn(FX.sun, P(0, 2.6, 0.2), new THREE.Vector3(0, -1.1, 0), { life: 1.15, size: 0.34, color: '#ffd76a', drag: 0 });
    }
  }

  rain(at, width, height, rate, dt) {   // drizzle in a box (window weather, sad clouds...)
    const r = this.rand;
    this.rainAcc = (this.rainAcc || 0) + rate * dt;
    while (this.rainAcc >= 1) {
      this.rainAcc -= 1;
      this.spawn(FX.rain, new THREE.Vector3(at.x + (r() - 0.5) * width, at.y + height, at.z + (r() - 0.5) * 0.3),
        new THREE.Vector3(0, -3.2, 0), { life: height / 3.2, size: 0.09, color: '#9fc9ee', drag: 0 });
    }
  }

  update(dt) {
    const keep = [];
    for (const q of this.p) {
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vy -= q.gravity * dt;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy *= q.gravity ? 1 : k; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      keep.push(q);
    }
    this.p = keep;
    const A = this.attr;
    keep.forEach((q, i) => {
      A.position.setXYZ(i, q.x, q.y, q.z);
      const fadeIn = Math.min(1, q.age / 0.12), fadeOut = Math.min(1, (q.life - q.age) / 0.4);
      A.aAlpha.setX(i, fadeIn * fadeOut);
      A.aSize.setX(i, q.size * (q.type === FX.heart ? 0.7 + 0.3 * fadeIn : 1));
      A.aType.setX(i, q.type);
      A.aRot.setX(i, q.rot);
      A.aColor.setXYZ(i, q.color.r, q.color.g, q.color.b);
    });
    for (const a of Object.values(A)) a.needsUpdate = true;
    this.points.geometry.setDrawRange(0, keep.length);
  }
}
