// Art direction for the planet world: a dreamy pastel cosmos like the concept art.
//   sky       painted gradient (deep indigo -> lavender -> warm peach glow behind the scene) + soft nebula
//   stars     deterministic twinkling field + a few large soft bokeh orbs
//   cloudSea  soft cloud cards far below the planets: depth and a warm bounce colour
//   clayify   turns generated (Pixal3D) PBR materials into soft matte clay: no metal, rim light, lifted shadows,
//             optional emissive glow for items that are lights
//   atmosphere  fresnel shell = glowing limb around a planet
//   orbitRing   glowing dotted ellipse
//   composer    subtle bloom (lights, stars, halos) + tone mapping output
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ sky
export function makeSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 }, uGain: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform float uTime; uniform float uGain;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        // base gradient: deep indigo zenith -> soft lavender -> rosy horizon -> lavender below
        vec3 zen = vec3(0.05, 0.04, 0.16), mid = vec3(0.15, 0.10, 0.34), hor = vec3(0.40, 0.22, 0.48), low = vec3(0.13, 0.09, 0.30);
        vec3 col = mix(hor, mid, smoothstep(0.02, 0.35, y));
        col = mix(col, zen, smoothstep(0.35, 0.95, y));
        col = mix(col, low, smoothstep(0.0, -0.4, y));
        // warm glow behind the scene (the camera looks toward -Z)
        float back = max(dot(d, normalize(vec3(0.15, 0.05, -1.0))), 0.0);
        col += vec3(0.6, 0.28, 0.5) * pow(back, 3.0) * 0.22 * smoothstep(-0.35, 0.0, y) * smoothstep(0.35, 0.0, y);  // soft pink band at the horizon
        // nebula: soft pink/lavender veils
        float neb = fbm(d * 2.6 + vec3(0.0, 0.0, uTime * 0.004));
        float veil = smoothstep(0.55, 0.8, neb) * smoothstep(-0.1, 0.5, y);
        col = mix(col, col + vec3(0.22, 0.08, 0.26), veil * 0.4);
        float neb2 = fbm(d * 5.0 + 11.0);
        col += vec3(0.25, 0.22, 0.48) * smoothstep(0.55, 0.85, neb2) * 0.25;
        // a few soft clouds far below (bottom of the frame only); 3D noise on the direction = no seam
        if (y < -0.2) {
          float c = fbm(d * vec3(3.2, 9.0, 3.2) + vec3(uTime * 0.01, 0.0, 0.0));
          float edge = 0.57;
          float m = smoothstep(edge, edge + 0.04, c) * smoothstep(-0.2, -0.38, y);
          float top = smoothstep(edge + 0.02, edge + 0.09, c);
          vec3 cloud = mix(vec3(0.38, 0.26, 0.6), vec3(0.78, 0.56, 0.78), top);
          col = mix(col, cloud, m * 0.85);
        }
        gl_FragColor = vec4(col * uGain, 1.0);   // uGain = 1 / exposure: the sky is painted, not lit
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 64, 32), mat);
  sky.name = 'Sky';
  scene.add(sky);

  // stars: deterministic, varied size + twinkle; a few big soft bokeh orbs for depth
  const r = rng(42), N = 1400;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N), tint = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = r() * 1.6 - 0.45, a = r() * Math.PI * 2, R = 95;   // mostly above the horizon
    const s = Math.sqrt(1 - Math.min(1, u * u));
    pos.set([R * s * Math.cos(a), R * u, R * s * Math.sin(a)], i * 3);
    size[i] = r() < 0.06 ? 3.5 + r() * 3 : 0.8 + r() * 1.8;
    ph[i] = r() * 6.28;
    tint[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `attribute float aSize, aPh, aTint; uniform float uTime, uPx; varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        vA = 0.55 + 0.45 * sin(uTime * (0.8 + aTint) + aPh);
        vC = mix(vec3(1.0, 0.92, 0.85), vec3(0.85, 0.85, 1.0), aTint);
        gl_PointSize = aSize * 2.4 * uPx; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p);
        float core = smoothstep(0.5, 0.0, d); float cross = max(smoothstep(0.06, 0.0, abs(p.x)), smoothstep(0.06, 0.0, abs(p.y))) * smoothstep(0.5, 0.1, d);
        float a = (core * core + cross * 0.35) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC * a * 1.6, a); }`,
  });
  const stars = new THREE.Points(g, starMat);
  stars.name = 'Stars';
  stars.frustumCulled = false;
  scene.add(stars);

  const orbs = new THREE.Group();
  const orbTex = softDisc();
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTex, color: new THREE.Color().setHSL(0.75 + r() * 0.15, 0.6, 0.8),
      transparent: true, opacity: 0.08 + r() * 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
    const a = r() * Math.PI * 2, R = 30 + r() * 25;
    s.position.set(Math.cos(a) * R, -2 + r() * 18, -Math.abs(Math.sin(a) * R) - 10);
    s.scale.setScalar(4 + r() * 8);
    orbs.add(s);
  }
  scene.add(orbs);
  return {
    update(t, renderer) { mat.uniforms.uTime.value = t; mat.uniforms.uGain.value = 1 / Math.max(renderer.toneMappingExposure, 0.05); starMat.uniforms.uTime.value = t; starMat.uniforms.uPx.value = renderer.getPixelRatio(); },
  };
}

function softDisc(stops = [[0, 1], [0.4, 0.45], [1, 0]]) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ cloud sea below the planets
function cloudTexture(seed) {
  const r = rng(seed), c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {          // a heap of soft puffs, denser and brighter toward the top
    const x = 70 + r() * 372, y = 150 + r() * 70 - Math.sin(((x - 70) / 372) * Math.PI) * 70, R = 35 + r() * 55;
    const gr = g.createRadialGradient(x, y - R * 0.3, R * 0.1, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function makeCloudSea(scene) {
  const group = new THREE.Group();
  group.name = 'CloudSea';
  const r = rng(7), texs = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
  const cards = [];
  for (let i = 0; i < 22; i++) {
    const a = Math.PI + (r() - 0.5) * Math.PI * 1.25, R = 16 + r() * 34;   // the back half of the world (camera is at +z)
    const far = (R - 16) / 34;
    const m = new THREE.SpriteMaterial({ map: texs[i % 3], transparent: true, depthWrite: false, fog: false,
      color: new THREE.Color().lerpColors(new THREE.Color('#fff0f6'), new THREE.Color('#d9c6ff'), far * 0.7 + r() * 0.3),
      opacity: 0.38 + (1 - far) * 0.3 });
    const s = new THREE.Sprite(m);
    s.position.set(Math.cos(a) * R, -9 - far * 4 + r() * 1.5, Math.sin(a) * R);
    const w = 10 + r() * 8 + far * 14;
    s.scale.set(w, w * 0.5, 1);
    s.userData = { a, R, y: s.position.y, sp: 0.004 + r() * 0.006 };
    cards.push(s);
    group.add(s);
  }
  scene.add(group);
  return { update(t) { for (const s of cards) { const a = s.userData.a + t * s.userData.sp; s.position.x = Math.cos(a) * s.userData.R; s.position.z = Math.sin(a) * s.userData.R; } } };
}

// ------------------------------------------------------------------ clay finish for generated models
export function clayify(root, { rim = '#e8dcff', rimStrength = 0.45, fill = 0.22, emissive = 0, sat = 1, lift = 0 } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const out = src.map((m0) => {
      const m = m0.clone();
      m.metalness = 0;
      m.metalnessMap = null;
      m.roughness = Math.max(m.roughness ?? 1, 0.72);
      m.envMapIntensity = 0.55;
      if (emissive > 0 && m.map) { m.emissive = new THREE.Color('#ffffff'); m.emissiveMap = m.map; m.emissiveIntensity = emissive; }
      const u = { uRim: { value: new THREE.Color(rim) }, uRimK: { value: rimStrength }, uFill: { value: fill },
        uSat: { value: sat }, uLift: { value: lift } };
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimK; uniform float uFill; uniform float uSat; uniform float uLift;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            { float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));        // per-model colour correction
              diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, uSat) + uLift; }`)
          .replace('#include <opaque_fragment>', `
            {
              float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
              float fres = pow(1.0 - ndv, 3.0);
              outgoingLight += diffuseColor.rgb * uFill;              // lift the shadow side (no dead grey)
              outgoingLight += uRim * fres * uRimK;                   // soft lavender rim like the concepts
            }
            #include <opaque_fragment>`);
      };
      m.customProgramCacheKey = () => `clay-${emissive > 0}`;
      m.userData.clay = u;
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  return root;
}

// ------------------------------------------------------------------ atmosphere shell (glowing limb)
export function atmosphere(radius, color, strength = 0.8) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: strength } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = pow(f, 4.0) * uK;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), m);
  s.renderOrder = 2;
  return s;
}

// ------------------------------------------------------------------ soft contact shadow under a placed item
let _shadowTex;
export function contactBlob(size = 1) {
  _shadowTex ||= softDisc([[0, 0.55], [0.5, 0.25], [1, 0]]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: _shadowTex, color: '#2a1a3a', transparent: true, depthWrite: false, opacity: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.renderOrder = 1;
  return m;
}

// ------------------------------------------------------------------ glowing dotted orbit
export function orbitRing(points, color = '#fff0d2') {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.PointsMaterial({ color, size: 0.16, map: softDisc([[0, 1], [0.3, 0.6], [1, 0]]), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9, sizeAttenuation: true });
  const p = new THREE.Points(g, m);
  p.name = 'Orbit';
  return p;
}

// ------------------------------------------------------------------ post-processing
export function makeComposer(renderer, scene, camera, { bloom = 0.55, radius = 0.55, threshold = 0.78 } = {}) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const size = renderer.getSize(new THREE.Vector2());
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), bloom, radius, threshold);
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass({         // soft vignette: pulls the eye to the centre like the concept renders
    uniforms: { tDiffuse: { value: null }, uK: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uK; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 p = vUv - 0.5; float v = 1.0 - uK * smoothstep(0.25, 0.85, length(p * vec2(1.25, 1.0)));
        gl_FragColor = vec4(c.rgb * v, c.a); }`,
  }));
  composer.addPass(new OutputPass());
  return { composer, bloomPass, setSize(w, h) { composer.setSize(w, h); bloomPass.resolution.set(w / 2, h / 2); } };
}
