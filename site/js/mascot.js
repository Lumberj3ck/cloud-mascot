// The mascot as one reusable unit: body (GLB + vinyl), face layers, contact shadow, animator.
// Used by both the studio (studio.html) and the room (room.html) and the app (index.html, via world.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVinyl } from './vinyl.js';
import { Face } from './face.js';
import { Animator } from './anim.js';

const fetchJSON = async (url, fallback = {}) => {
  try { const r = await fetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; }
};

export async function createMascot({ base = 'assets/', layout = {} } = {}) {
  const [gltf, shadowTex, shadowMeta, look, faceLayout] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'cloud.glb'),
    new THREE.TextureLoader().loadAsync(base + 'contact_shadow.png'),
    fetchJSON(base + 'contact_shadow.json', { halfX: 1.8, halfZ: 1.5 }),
    fetchJSON(base + 'look.json'),
    fetchJSON(base + 'face_layout.json'),
  ]);

  const root = new THREE.Group();
  root.name = 'Mascot';
  const squash = new THREE.Group();          // scaled about the base for squash & stretch
  root.add(squash);
  const body = gltf.scene.getObjectByProperty('type', 'Mesh');
  const vinyl = createVinyl();
  body.material = vinyl;
  body.name = 'CloudBody';
  squash.add(gltf.scene);
  root.updateMatrixWorld(true);

  const face = new Face(body, { layout: { ...faceLayout, ...layout } });

  shadowTex.colorSpace = THREE.NoColorSpace;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(shadowMeta.halfX * 2, shadowMeta.halfZ * 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        map: { value: shadowTex },
        uOpacity: { value: 0.62 },
        uFade: { value: 1 },
        uTint: { value: new THREE.Color('#5d4652') },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform float uOpacity, uFade; uniform vec3 uTint; varying vec2 vUv;
        void main(){ float d = texture2D(map, vUv).r; gl_FragColor = vec4(uTint, d * d * (3.0 - 2.0 * d) * uOpacity * uFade);
        #include <colorspace_fragment>
        }`,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  shadow.renderOrder = -1;
  shadow.name = 'ContactShadow';

  const animator = new Animator({ root, squash, body, face, shadow });

  const mascot = {
    root, squash, body, face, vinyl, shadow, animator, look,
    applyLook(L) {
      vinyl.color.set(L.color ?? vinyl.color);
      if (L.roughness !== undefined) vinyl.roughness = L.roughness;
      if (L.sheen !== undefined) vinyl.sheen = L.sheen;
      if (L.env !== undefined) vinyl.envMapIntensity = L.env;
      const u = vinyl.userData.uniforms;
      if (L.wrap !== undefined) u.uWrap.value = L.wrap;
      if (L.wrapPow !== undefined) u.uWrapPow.value = L.wrapPow;
      if (L.edge !== undefined) u.uEdgeStrength.value = L.edge;
      if (L.contact !== undefined) u.uContact.value = L.contact;
      u.uAO.value = L.ao ?? 0.35;
      if (L.shadowOpacity !== undefined) shadow.material.uniforms.uOpacity.value = L.shadowOpacity;
    },
    setKeyDir(viewDir) {
      vinyl.userData.uniforms.uKeyDir.value.copy(viewDir);
      face.setKeyDir(viewDir);
    },
    update(dt, time, opts) {
      animator.update(dt);
      face.update(dt, time, opts);
    },
  };
  mascot.applyLook(look);
  return mascot;
}
