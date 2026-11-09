import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const vertexShader = `varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Integrate continuous fog through world space, stopping at the visible surface.
// No billboard clouds: empty space and the planets share the same fog volume.
export class ThickFogPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.time = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
    this.fogTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    // Repeating scalar noise gives gentle variations in thickness, not cloud silhouettes.
    let seed = 716;
    const data = new Uint8Array(32 ** 3);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed >>> 24;
    }
    this.noise = new THREE.Data3DTexture(data, 32, 32, 32);
    this.noise.format = THREE.RedFormat;
    this.noise.minFilter = this.noise.magFilter = THREE.LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = THREE.RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;
    this.fogMaterial = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, vertexShader,
      uniforms: {
        sceneDepth: { value: this.sceneTarget.depthTexture }, noiseMap: { value: this.noise },
        projectionInverse: { value: camera.projectionMatrixInverse }, cameraWorld: { value: camera.matrixWorld },
        cameraPositionWorld: { value: new THREE.Vector3() }, time: { value: 0 }, gain: { value: 1 },
        shadowColor: { value: new THREE.Color('#795a9e') },
        lightColor: { value: new THREE.Color('#c9a2cd') },
      },
      fragmentShader: `precision highp sampler3D;
        varying vec2 vUv;
        uniform sampler2D sceneDepth;
        uniform sampler3D noiseMap;
        uniform mat4 projectionInverse, cameraWorld;
        uniform vec3 cameraPositionWorld, shadowColor, lightColor;
        uniform float time, gain;
        void main() {
          float depth = texture2D(sceneDepth, vUv).x;
          vec4 view = projectionInverse * vec4(vUv * 2. - 1., depth * 2. - 1., 1.);
          vec3 endpoint = (cameraWorld * vec4(view.xyz / view.w, 1.)).xyz;
          vec3 ray = normalize(endpoint - cameraPositionWorld);
          float surface = length(endpoint - cameraPositionWorld);
          // An unbounded atmosphere has no box edges to reveal while orbiting.
          // Cap integration distance only; by then the dense layer is opaque.
          float end = min(surface, 80.);
          float stepSize = end / 40.;
          float transmission = 1.;
          vec3 scattered = vec3(0.);
          for (int i = 0; i < 40; i++) {
            float distanceAlongRay = (float(i) + .5) * stepSize;
            vec3 p = cameraPositionWorld + ray * distanceAlongRay;
            vec3 wind = vec3(time * .008, 0., time * .004);
            float n = texture(noiseMap, p * .038 + wind).r;
            float detail = texture(noiseMap, p * .095 - wind * .4).r;
            // Smooth exponential falloff has no fixed ceiling that can show
            // as a horizontal band when looking upward through the atmosphere.
            float altitude = p.y + (n - .5) * 2.;
            float softAltitude = .5 * (altitude + sqrt(altitude * altitude + 16.));
            float height = .035 + .965 * exp(-softAltitude * .25);
            // Leave nearby surfaces readable from any camera position, using
            // distance rather than the former boundary on the front Z axis.
            float nearbyFade = smoothstep(5., 10., distanceAlongRay);
            float clearing = mix(.10, 1., smoothstep(1.4, 3.5, length((p - vec3(0., .65, 0.)) * vec3(1., 1.5, 1.))));
            float density = .22 * height * (.35 + n * .9 + detail * .25) * nearbyFade * clearing;
            float alpha = 1. - exp(-density * stepSize);
            float light = clamp(.48 + p.y * .065 + (n - .5) * .25, .15, .85);
            vec3 color = mix(shadowColor, lightColor, light) * gain;
            scattered += transmission * alpha * color;
            transmission *= 1. - alpha;
          }
          gl_FragColor = vec4(scattered, 1. - transmission);
        }`,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, vertexShader,
      uniforms: {
        sceneColor: { value: this.sceneTarget.texture }, fogMap: { value: this.fogTarget.texture },
        sceneDepth: { value: this.sceneTarget.depthTexture }, fogSize: { value: new THREE.Vector2(1,1) },
        near: { value: camera.near }, far: { value: camera.far },
        surfaceFogStrength: { value: .10 },
      },
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D sceneColor, fogMap, sceneDepth;
        uniform vec2 fogSize;
        uniform float near, far, surfaceFogStrength;
        float viewDepth(vec2 uv) {
          float d = texture2D(sceneDepth, uv).r;
          return near * far / (far - d * (far - near));
        }
        void main() {
          float centerDepth = viewDepth(vUv);
          vec2 base = floor(vUv * fogSize - .5);
          vec2 blend = fract(vUv * fogSize - .5);
          vec4 fog = vec4(0.); float total = 0.;
          // Depth-aware upsampling keeps dense fog from leaking over island edges.
          for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
            vec2 offset = vec2(float(x),float(y));
            vec2 uv = (base + offset + .5) / fogSize;
            vec2 weight = mix(1. - blend, blend, offset);
            float w = weight.x * weight.y / (1. + abs(viewDepth(uv) - centerDepth) * 12.);
            fog += texture2D(fogMap, uv) * w; total += w;
          }
          fog /= max(total, .00001);
          // Art-directed layering: retain the full atmosphere in the gaps,
          // but only a light veil on opaque planets, Nimbus and decorations.
          // Scale both terms because fog.rgb is premultiplied by opacity.
          float surface = 1. - step(.999999, texture2D(sceneDepth, vUv).r);
          fog *= mix(1., surfaceFogStrength, surface);
          vec3 color = texture2D(sceneColor, vUv).rgb;
          gl_FragColor = vec4(color * (1. - fog.a) + fog.rgb, 1.);
        }`,
    });
    this.quad = new FullScreenQuad(this.fogMaterial);
  }
  setSize(width, height) {
    this.sceneTarget.setSize(width, height);
    const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2));
    this.fogTarget.setSize(w, h);
    this.compositeMaterial.uniforms.fogSize.value.set(w, h);
  }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    const u = this.fogMaterial.uniforms;
    this.camera.getWorldPosition(u.cameraPositionWorld.value);
    u.time.value = this.reducedMotion.matches ? 0 : this.time;
    u.gain.value = 1 / Math.max(renderer.toneMappingExposure, .05);
    this.quad.material = this.fogMaterial;
    renderer.setRenderTarget(this.fogTarget);
    this.quad.render(renderer);
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.sceneTarget.dispose(); this.fogTarget.dispose(); this.noise.dispose();
    this.fogMaterial.dispose(); this.compositeMaterial.dispose(); this.quad.dispose();
  }
}
