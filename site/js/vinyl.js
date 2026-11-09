// Soft-touch matte lavender vinyl.
// MeshPhysicalMaterial (broad soft specular + sheen for the velvety soft-touch falloff) with
// three small shader additions:
//   - edge glow: a gentle light lavender-pink lift at grazing angles (fake subsurface)
//   - wrap key: half-Lambert soft-box falloff from the key direction, so light wraps
//     smoothly round the body instead of stopping hard at the terminator
//   - ground contact: darkens the base where it meets the floor; fades when the cloud hops
// AO from the lobe valleys arrives as vertex colour (baked from the SDF in Blender).
import * as THREE from 'three';

export const VINYL_DEFAULTS = {
  color: '#d7bfe4',
  roughness: 0.58,
  specularIntensity: 0.32,
  sheen: 0.55,
  sheenRoughness: 0.72,
  sheenColor: '#fbe9ff',
  edgeColor: '#f7e6ff',
  edgeStrength: 0.22,
  edgePower: 2.6,
  wrapColor: '#fff4ec',
  wrap: 0.16,
  contact: 0.32,
  envMapIntensity: 0.35,
};

export function createVinyl(opts = {}) {
  const o = { ...VINYL_DEFAULTS, ...opts };
  const mat = new THREE.MeshPhysicalMaterial({
    color: o.color,
    roughness: o.roughness,
    metalness: 0,
    specularIntensity: o.specularIntensity,
    sheen: o.sheen,
    sheenRoughness: o.sheenRoughness,
    sheenColor: new THREE.Color(o.sheenColor),
    envMapIntensity: o.envMapIntensity,
    vertexColors: true,
  });
  const uniforms = {
    uEdgeColor: { value: new THREE.Color(o.edgeColor) },
    uEdgeStrength: { value: o.edgeStrength },
    uEdgePower: { value: o.edgePower },
    uWrapColor: { value: new THREE.Color(o.wrapColor) },
    uWrap: { value: o.wrap },
    uKeyDir: { value: new THREE.Vector3(-0.5, 0.6, 0.6).normalize() }, // view space, set per frame
    uWrapPow: { value: 2.0 },
    uContact: { value: o.contact },
    uGroundY: { value: 0 },
    uAO: { value: 1 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vWorldY;
uniform vec3 uEdgeColor; uniform float uEdgeStrength; uniform float uEdgePower;
uniform vec3 uWrapColor; uniform float uWrap; uniform vec3 uKeyDir; uniform float uWrapPow; uniform float uContact; uniform float uGroundY; uniform float uAO;`)
      .replace('#include <color_fragment>', `
#if defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, uAO);
#elif defined( USE_COLOR )
  diffuseColor.rgb *= mix(vec3(1.0), vColor, uAO);
#endif`)
      .replace('#include <opaque_fragment>', `
{
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(dot(normal, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, uEdgePower);
  // fake subsurface: light seems to bleed through the thin silhouette
  outgoingLight += uEdgeColor * fres * uEdgeStrength;
  // wrap key: broad soft-box gradient across the whole body
  float wrapT = pow(clamp(dot(normal, uKeyDir) * 0.5 + 0.5, 0.0, 1.0), uWrapPow);
  outgoingLight += uWrapColor * diffuseColor.rgb * uWrap * wrapT;
  // contact darkening near the floor
  float h = max(vWorldY - uGroundY, 0.0);
  outgoingLight *= 1.0 - uContact * (1.0 - smoothstep(0.0, 0.16, h));
}
#include <opaque_fragment>`);
  };
  return mat;
}
