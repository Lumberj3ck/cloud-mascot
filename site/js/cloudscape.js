// A painted cloud sea behind the live 3D world. Cover cropping preserves the
// artwork's proportions on phones; the procedural sky remains a load fallback.
import * as THREE from 'three';
import { makeSky } from './spacelook.js';

export function makeCloudscape(scene) {
  const fallback = makeSky(scene);
  const uniforms = {
    map: { value: null }, aspect: { value: 1 }, imageAspect: { value: 1.6 },
    gain: { value: 1 }, time: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: `uniform sampler2D map;
      uniform float aspect, imageAspect, gain, time;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv - .5;
        uv *= vec2(min(1.0, aspect / imageAspect), min(1.0, imageAspect / aspect));
        // Very slow breathing movement, with enough overscan to hide the edges.
        uv = uv * .96 + .5 + vec2(sin(time * .018) * .008, cos(time * .014) * .006);
        gl_FragColor = vec4(texture2D(map, uv).rgb * gain, 1.0);
      }`,
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  backdrop.name = 'Cloudscape';
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1000;
  backdrop.visible = false;
  scene.add(backdrop);
  const ready = new THREE.TextureLoader().loadAsync('assets/cloudscape-v1.jpg').then(texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    uniforms.map.value = texture;
    uniforms.imageAspect.value = texture.image.width / texture.image.height;
    scene.getObjectByName('Sky').visible = false;
    backdrop.visible = true;
  }).catch(error => console.warn('Cloudscape unavailable; using procedural sky.', error));
  const size = new THREE.Vector2();
  return {
    ready,
    update(t, renderer) {
      fallback.update(t, renderer);
      renderer.getSize(size);
      uniforms.aspect.value = size.x / size.y;
      uniforms.gain.value = 1 / Math.max(renderer.toneMappingExposure, .05);
      uniforms.time.value = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : t;
    },
  };
}
