// Face: separate crisp decal layers on a thin patch conformed to the body's front.
//
// The patch is cut from the body geometry at runtime (front-facing triangles around the face),
// so it always matches the body exactly (and inherits its morph targets). Each layer is its own
// mesh + ShaderMaterial over that patch, pushed out a hair along the normal:
//   blush < eyes (+brows, lids) = mouth < highlights < extras (tear)
// Every feature is an analytic 2D signed-distance shape evaluated per pixel in face space
// (rest-pose object x/y), antialiased with screen-space derivatives: sharp at any zoom, and
// every parameter (blink, arc, lid, mouth curve, open, ...) morphs continuously.
import * as THREE from 'three';

// --- layout, measured from refs (units: body width = 2.0, ground y = 0) --------------------
export const LAYOUT = {
  eyeX: 0.262, eyeY: 0.745, eyeR: 0.07,
  hlX: -0.028, hlY: 0.027, hlR: 0.021,          // highlight offset (screen space, upper-left)
  mouthY: 0.652, mouthW: 0.135, stroke: 0.0105,
  blushX: 0.385, blushY: 0.6, blushW: 0.105, blushH: 0.083,
};

// --- expression parameters -----------------------------------------------------------------
// per-eye values are [left, right] (screen left/right); "outward" = away from the face centre
export const NEUTRAL = {
  open: [1, 1], arc: [0, 0], closed: [0, 0], heart: [0, 0], eyeScale: [1, 1],
  lid: [0, 0], lidAngle: [0, 0], brow: [0, 0], browAngle: [0, 0], browY: [0, 0],
  look: [0, 0],                         // gaze offset (x, y) in eye radii
  curve: 1.0, mouthW: 1.0, smirk: 0, wavy: 0, open_: 0, round: 0, mouthH: 1.0,
  blush: 1.0, tear: 0, zzz: 0,
};

export const EXPRESSIONS = {
  happy: {},
  veryHappy: { arc: [1, 1], open_: 1, curve: 0, mouthW: 1.45, mouthH: 1.45, blush: 1.15 },
  proud: { lid: [0.36, 0.42], lidAngle: [0.04, -0.3], eyeScale: [0.95, 0.95], curve: 0.7, smirk: 0.55, mouthW: 1.05 },
  sleepy: { closed: [1, 1], round: 1, open_: 1, mouthW: 0.52, mouthH: 0.9, curve: 0, zzz: 1, blush: 0.9 },
  sad: { curve: -0.85, mouthW: 0.8, tear: 1, blush: 0.75, look: [0, -0.06] },
  surprised: { eyeScale: [1.06, 1.06], round: 1, open_: 1, mouthW: 0.85, mouthH: 1.05, curve: 0, blush: 0.9 },
  love: { heart: [1, 1], eyeScale: [1.14, 1.14], open_: 1, curve: 0, mouthW: 1.3, mouthH: 1.45, blush: 1.2 },
  worried: { brow: [1, 1], browAngle: [-0.38, -0.38], browY: [0.1, 0.1], wavy: 1, curve: 0, mouthW: 0.85, blush: 0.85 },
  determined: { lid: [0.34, 0.34], lidAngle: [-0.42, -0.42], curve: 0.75, mouthW: 1.1 },
};

const GLSL_COMMON = /* glsl */`
varying vec2 vF[5];      // per-feature tangent-plane coords: 0 eyeL, 1 eyeR, 2 mouth, 3 blushL, 4 blushR
varying vec3 vN;
uniform vec3 uKeyDir;
uniform float uEyeX, uEyeY, uEyeR, uEyeAspect, uHlX, uHlY, uHlR, uMouthY, uMouthW, uStroke;
uniform float uBlushX, uBlushY, uBlushW, uBlushH;
uniform float uOpen[2], uArc[2], uClosed[2], uHeart[2], uEyeScale[2], uLid[2], uLidAngle[2];
uniform float uBrow[2], uBrowAngle[2], uBrowY[2];
uniform vec2 uLook;
uniform float uCurve, uMouthWk, uSmirk, uWavy, uMouthOpen, uRound, uMouthH, uBlush, uTear, uTime;
uniform vec3 uInk, uMouthIn, uTongue, uHighlight, uBlushCol, uTearCol;

float dot2(vec2 v) { return dot(v, v); }
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// exact distance to a quadratic Bezier (Inigo Quilez)
float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
  B += vec2(1e-5, 2e-5);
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b), kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
  float p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * p * p * p, res;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    res = dot2(d + (c + b * t) * t);
  } else {
    float z = sqrt(-p), v = acos(q / (p * z * 2.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    res = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
  }
  return sqrt(res);
}
// heart, tip at origin, top at y ~ 1 (Inigo Quilez)
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
float cover(float d) { float w = max(fwidth(d), 1e-5) * 0.75; return clamp(0.5 - d / w, 0.0, 1.0); }
float lightK() { return 0.80 + 0.28 * clamp(dot(normalize(vN), uKeyDir) * 0.5 + 0.5, 0.0, 1.0); }

// --- eye i in its local frame q (x mirrored so +x is outward) ---------------------------------
float eyeR(int i) { return uEyeR * uEyeScale[i]; }
float lidY(int i) { return eyeR(i) * uEyeAspect * (1.0 - 2.0 * uLid[i]); }
vec2 lidN(int i) { return vec2(sin(uLidAngle[i]), cos(uLidAngle[i])); }
float dEyeDark(int i, vec2 q) {
  float R = eyeR(i);
  float op = max(uOpen[i], 0.06);
  float sy = op * uEyeAspect;                                                       // tall oval, squashed by blinks
  float dRound = (length(vec2(q.x, q.y / sy)) - R) * min(1.0, sy);
  dRound = max(dRound, dot(q - vec2(0.0, lidY(i)), lidN(i)));                       // lid cut
  float t = uStroke * 1.15;
  float dArc = sdBezier(q, vec2(-R * 1.05, -R * 0.15), vec2(0.0, R * 1.7), vec2(R * 1.05, -R * 0.15)) - t;
  float dLine = sdBezier(q, vec2(-R * 1.05, R * 0.02), vec2(0.0, -R * 0.22), vec2(R * 1.05, R * 0.02)) - t;
  float closedAmt = max(uClosed[i], smoothstep(0.3, 0.08, uOpen[i]));
  float d = mix(dRound, dArc, uArc[i]);
  d = mix(d, dLine, closedAmt);
  // lid stroke along the cut, overhanging outward (proud / determined)
  if (uLid[i] > 0.001) {
    vec2 n = lidN(i), tng = vec2(n.y, -n.x);
    vec2 c = vec2(0.0, lidY(i)) + n * t * 0.6;
    float dl = sdSegment(q, c - tng * R * 0.9, c + tng * R * 1.15) - t * 0.78;
    d = min(d, mix(1.0, dl, smoothstep(0.0, 0.08, uLid[i])) );
  }
  // brows (worried)
  if (uBrow[i] > 0.001) {
    float a = uBrowAngle[i];
    vec2 c = vec2(0.0, R * (0.75 + uEyeAspect) + uBrowY[i] * R);
    vec2 tng = vec2(cos(a), sin(a));
    float db = sdBezier(q, c - tng * R * 0.75, c + vec2(0.0, R * 0.25), c + tng * R * 0.75) - t * 0.55;
    d = min(d, mix(1.0, db, uBrow[i]));
  }
  return d;
}
vec2 eyeLocal(int i) {
  float sx = i == 0 ? -1.0 : 1.0;
  vec2 q = vF[i] - uLook * uEyeR;
  q.x *= sx;          // mirror: +x outward for both eyes
  return q;
}

// --- mouth ------------------------------------------------------------------------------------
// returns signed distance; inside<0. 'fill' tells if the mouth is an open shape (interior shown)
float dMouth(vec2 p, out float fillAmt) {
  float w = uMouthW * uMouthWk;
  float t = uStroke;
  // curve stroke: a circular arc (smile >0, frown <0); smirk tilts it and lifts one end
  float ang = uSmirk * 0.32;
  vec2 pc = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * (p - vec2(uSmirk * w * 0.06, uSmirk * 0.004));
  float hw = w * 0.5, sag = abs(uCurve) * w * 0.26;
  float dCurve;
  if (sag < 1e-4) {
    dCurve = sdSegment(pc, vec2(-hw, 0.0), vec2(hw, 0.0)) - t;
  } else {
    float ra = (hw * hw + sag * sag) / (2.0 * sag);      // circle through (+-hw, 0) and (0, -sag)
    float sgn = uCurve >= 0.0 ? 1.0 : -1.0;
    float y = sgn * pc.y - sag * 0.5;                    // frown = mirrored smile; stroke centred on the mouth point
    vec2 q = vec2(abs(pc.x), (ra - sag) - y);            // centre above, bottom of the circle -> +y for sdArc
    vec2 sc = vec2(hw / ra, sqrt(max(1.0 - (hw / ra) * (hw / ra), 0.0)));
    dCurve = ((sc.y * q.x > sc.x * q.y) ? length(q - sc * ra) : abs(length(q) - ra)) - t;
  }
  // wavy 'w' (worried)
  float wv = min(sdBezier(p, vec2(-w * 0.5, 0.004), vec2(-w * 0.25, -w * 0.32), vec2(0.0, 0.0)),
                 sdBezier(p, vec2(0.0, 0.0), vec2(w * 0.25, -w * 0.32), vec2(w * 0.5, 0.004))) - t;
  dCurve = mix(dCurve, wv, uWavy);
  // open D (flat top, round bottom)
  float rD = w * 0.5;
  vec2 pd = p - vec2(0.0, w * 0.17);
  float dEll = (length(vec2(pd.x, pd.y / (0.92 * uMouthH))) - rD) * min(1.0, 0.92 * uMouthH);
  float dD = smax(dEll, pd.y, rD * 0.22);       // flat top, softly rounded corners
  // round O (surprised / sleepy)
  vec2 ro = vec2(w * 0.5, w * 0.62 * uMouthH);
  float dO = (length(p / ro) - 1.0) * min(ro.x, ro.y);
  float dFill = mix(dD, dO, uRound);
  fillAmt = uMouthOpen;
  return mix(dCurve, dFill, uMouthOpen);
}
`;

const VERT = /* glsl */`
attribute vec3 aRest;
uniform float uOffset;
uniform vec3 uFO[5], uFT[5], uFB[5];   // feature frames: origin, tangent (+x), bitangent (+y)
varying vec2 vF[5];
varying vec3 vN;
#include <common>
#include <morphtarget_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  for (int i = 0; i < 5; i++) {
    vec3 d = aRest - uFO[i];
    vF[i] = vec2(dot(d, uFT[i]), dot(d, uFB[i]));
  }
  vN = normalize(normalMatrix * objectNormal);
  transformed += normalize(objectNormal) * uOffset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}`;

const FRAG = {
  blush: /* glsl */`
void main() {
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 d = vF[3 + i] / vec2(uBlushW, uBlushH);
    a = max(a, smoothstep(1.0, 0.1, length(d)));
  }
  a *= 0.7 * uBlush;
  gl_FragColor = vec4(uBlushCol * lightK(), a);
  #include <colorspace_fragment>
}`,
  eyes: /* glsl */`
void main() {
  float a = 0.0, white = 0.0, glow = 0.0, rim = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 q = eyeLocal(i);
    float d = dEyeDark(i, q);
    a = max(a, cover(d));
    // raised-print rim: faint light halo just outside the ink
    rim = max(rim, cover(d - uStroke * 0.55) - cover(d));
    // glossy depth: warm glow low in the eye, away from the highlight
    float R = eyeR(i);
    vec2 g = vec2(q.x * (i == 0 ? -1.0 : 1.0), q.y) - vec2(R * 0.25, -R * uEyeAspect * 0.55);
    glow = max(glow, cover(d) * smoothstep(R * 1.1, 0.0, length(g / vec2(1.0, 0.7))) * (1.0 - uArc[i]) * (1.0 - uClosed[i]));
    if (uHeart[i] > 0.001) {
      float R = eyeR(i), s = R * 1.42;
      vec2 hq = vec2(q.x, q.y + s * 0.5) / s * 1.6;
      float dh = sdHeart(vec2(hq.x, hq.y + 0.25)) * s / 1.6 - R * 0.02;
      white = max(white, cover(dh) * uHeart[i]);
    }
  }
  vec3 ink = mix(uInk, uInk * 2.1 + vec3(0.03, 0.0, 0.0), glow * 0.55);
  vec3 col = mix(ink * lightK(), uHighlight, white);
  col = mix(col, vec3(1.0, 0.97, 1.0), rim * (1.0 - a) );
  gl_FragColor = vec4(col, max(a, rim * 0.22));
  #include <colorspace_fragment>
}`,
  highlight: /* glsl */`
void main() {
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float R = eyeR(i), sx = i == 0 ? -1.0 : 1.0;
    float roundness = (1.0 - uArc[i]) * (1.0 - uClosed[i]) * (1.0 - uHeart[i]) * smoothstep(0.45, 0.85, uOpen[i]);
    if (roundness < 0.001) continue;
    vec2 q = eyeLocal(i);
    // highlight sits upper-left in screen space; slides below a lid
    vec2 off = vec2(uHlX * sx, min(uHlY * uEyeAspect, lidY(i) - uHlR * 1.4)) * uEyeScale[i];
    vec2 h = q - off;
    h.x *= sx;                                        // back to screen orientation
    h = mat2(0.866, 0.5, -0.5, 0.866) * h;            // tilt ~30 deg
    float d = (length(h / vec2(0.85, 1.18)) - uHlR * uEyeScale[i]) * 0.85;
    float inside = cover(dot(q - vec2(0.0, lidY(i)), lidN(i)) + uHlR * 0.2);
    a = max(a, cover(d) * roundness * inside);
  }
  gl_FragColor = vec4(uHighlight, a);
  #include <colorspace_fragment>
}`,
  mouth: /* glsl */`
void main() {
  vec2 p = vF[2];
  float fillAmt;
  float d = dMouth(p, fillAmt);
  float a = cover(d);
  float rim = cover(d - uStroke * 0.55) - a;
  if (a + rim <= 0.0) discard;
  // open mouth: ink outline, dark interior, tongue at the bottom
  float t = uStroke * mix(0.85, 0.5, uRound);
  float inner = cover(d + t) * smoothstep(0.35, 0.9, fillAmt);
  float w = uMouthW * uMouthWk;
  vec2 tc = p - vec2(0.0, mix(-w * 0.33, -w * 0.5 * uMouthH, uRound));
  float tongue = cover(length(tc / vec2(w * 0.42, w * 0.3)) - 1.0);
  vec3 interior = mix(uMouthIn, uTongue, tongue);
  vec3 col = mix(uInk, interior, inner) * lightK();
  col = mix(col, vec3(1.0, 0.97, 1.0), rim * (1.0 - a));
  gl_FragColor = vec4(col, max(a, rim * 0.28));
  #include <colorspace_fragment>
}`,
  extras: /* glsl */`
void main() {
  // teardrop under the right eye, sliding down
  float a = 0.0; vec3 col = uTearCol;
  if (uTear > 0.001) {
    float R = uEyeR;
    float slide = fract(uTime * 0.28);
    vec2 c = vec2(R * 0.6, -R * uEyeAspect * 1.75 - slide * R * 1.4);
    vec2 p = (vF[1] - c) / (R * 1.35);
    // drop: circle bottom + pointed top
    float dc = length(p) - 0.62;
    float dt = max(abs(p.x) - (0.62 - (p.y) * 0.55), p.y - 1.15);
    float d = min(dc, max(dt, -p.y + 0.0)) * R * 1.35;
    float fade = uTear * smoothstep(1.0, 0.82, slide) * smoothstep(0.0, 0.08, slide);
    a = cover(d) * fade;
    float shade = 0.82 + 0.25 * smoothstep(0.6, -0.4, p.x + p.y * 0.3);
    float spec = smoothstep(0.2, 0.05, length(p - vec2(-0.22, 0.12)));
    col = mix(uTearCol * shade, vec3(1.0), spec * 0.9);
  }
  if (a <= 0.0) discard;
  gl_FragColor = vec4(col, a * 0.92);
  #include <colorspace_fragment>
}`,
};

// zzz: camera-facing card above the dome's right shoulder, three rounded Z glyphs drifting up
const ZZZ_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uZzz, uTime;
uniform vec3 uCol;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float zGlyph(vec2 p, float s) {
  p /= s;
  float d = min(min(sdSeg(p, vec2(-0.5, 0.5), vec2(0.5, 0.5)), sdSeg(p, vec2(0.5, 0.5), vec2(-0.5, -0.5))),
                sdSeg(p, vec2(-0.5, -0.5), vec2(0.5, -0.5)));
  return (d - 0.2) * s;
}
void main() {
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ph = fract(uTime * 0.22 + fi / 3.0);
    vec2 c = vec2(0.22 + fi * 0.2 + ph * 0.08, 0.2 + fi * 0.24 + ph * 0.12);
    float s = 0.085 + fi * 0.035;
    float d = zGlyph(vUv - c, s);
    float w = max(fwidth(d), 1e-5) * 0.75;
    a = max(a, clamp(0.5 - d / w, 0.0, 1.0) * smoothstep(0.0, 0.15, ph) * smoothstep(1.0, 0.7, ph));
  }
  a *= uZzz;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}`;

const LAYERS = [
  { name: 'FaceBlush', frag: 'blush', offset: 0.0012, order: 1 },
  { name: 'FaceEyes', frag: 'eyes', offset: 0.0024, order: 2 },
  { name: 'FaceMouth', frag: 'mouth', offset: 0.0024, order: 2 },
  { name: 'FaceHighlights', frag: 'highlight', offset: 0.0036, order: 3 },
  { name: 'FaceExtras', frag: 'extras', offset: 0.0048, order: 4 },
];

// Cut the face patch out of the body geometry (rest pose), keeping morph targets.
function facePatch(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const idx = geo.index ? geo.index.array : [...Array(pos.count).keys()];
  const keep = (i) => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    return z > 0.05 && nrm.getZ(i) > 0.2 && Math.abs(x) < 0.82 && y > 0.3 && y < 1.12;
  };
  const map = new Map(), tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(keep(a) && keep(b) && keep(c))) continue;
    for (const v of [a, b, c]) {
      if (!map.has(v)) map.set(v, map.size);
      tris.push(map.get(v));
    }
  }
  const src = [...map.keys()];
  const out = new THREE.BufferGeometry();
  const copy = (attr) => {
    const arr = new Float32Array(src.length * attr.itemSize);
    src.forEach((v, j) => { for (let k = 0; k < attr.itemSize; k++) arr[j * attr.itemSize + k] = attr.array[v * attr.itemSize + k]; });
    return new THREE.BufferAttribute(arr, attr.itemSize);
  };
  out.setAttribute('position', copy(pos));
  out.setAttribute('normal', copy(nrm));
  out.setAttribute('aRest', copy(pos));     // rest pose: features stick to the surface under morphs
  for (const [k, list] of Object.entries(geo.morphAttributes || {})) out.morphAttributes[k] = list.map(copy);
  out.morphTargetsRelative = geo.morphTargetsRelative;
  out.setIndex(tris);
  return out;
}

// Decal frame for a feature placed at front-projected (x, y): surface point + tangent plane.
function featureFrame(body, x, y) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObject(body, false)[0];
  if (!hit) throw new Error(`face feature at (${x}, ${y}) misses the body`);
  const n = hit.normal ? hit.normal.clone() : hit.face.normal.clone();
  // smooth (interpolated) normal from the hit triangle
  const nrm = body.geometry.attributes.normal, f = hit.face, bc = hit.barycoord;
  if (bc) {
    const na = new THREE.Vector3().fromBufferAttribute(nrm, f.a), nb = new THREE.Vector3().fromBufferAttribute(nrm, f.b);
    const nc = new THREE.Vector3().fromBufferAttribute(nrm, f.c);
    n.copy(na.multiplyScalar(bc.x)).addScaledVector(nb, bc.y).addScaledVector(nc, bc.z);
  }
  n.normalize();
  // decal axis mostly toward the surface normal and the face direction: no stretch on the
  // curve, but features stay nearly upright like printed artwork
  n.lerp(new THREE.Vector3(0, 0, 1), 0.65).normalize();
  const t = new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const b = new THREE.Vector3().crossVectors(n, t).normalize();
  return { o: body.worldToLocal(hit.point.clone()), t, b };
}

const lerp = (a, b, t) => a + (b - a) * t;
function blendState(a, b, t) {
  const o = {};
  for (const k of Object.keys(NEUTRAL)) {
    o[k] = Array.isArray(NEUTRAL[k]) ? [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)] : lerp(a[k], b[k], t);
  }
  return o;
}
export function expressionState(name) {
  return { ...structuredClone(NEUTRAL), ...structuredClone(EXPRESSIONS[name] || {}) };
}

export class Face {
  constructor(body, { layout = LAYOUT } = {}) {
    this.body = body;
    const geo = facePatch(body.geometry);
    const L = { ...LAYOUT, ...layout };
    this.uniforms = {
      uKeyDir: { value: new THREE.Vector3(-0.5, 0.6, 0.6).normalize() },
      uEyeX: { value: L.eyeX }, uEyeY: { value: L.eyeY }, uEyeR: { value: L.eyeR }, uEyeAspect: { value: L.eyeAspect ?? 1.25 },
      uHlX: { value: L.hlX }, uHlY: { value: L.hlY }, uHlR: { value: L.hlR },
      uMouthY: { value: L.mouthY }, uMouthW: { value: L.mouthW }, uStroke: { value: L.stroke },
      uBlushX: { value: L.blushX }, uBlushY: { value: L.blushY }, uBlushW: { value: L.blushW }, uBlushH: { value: L.blushH },
      uOpen: { value: [1, 1] }, uArc: { value: [0, 0] }, uClosed: { value: [0, 0] }, uHeart: { value: [0, 0] },
      uEyeScale: { value: [1, 1] }, uLid: { value: [0, 0] }, uLidAngle: { value: [0, 0] },
      uBrow: { value: [0, 0] }, uBrowAngle: { value: [0, 0] }, uBrowY: { value: [0, 0] },
      uLook: { value: new THREE.Vector2() },
      uCurve: { value: 0.8 }, uMouthWk: { value: 1 }, uSmirk: { value: 0 }, uWavy: { value: 0 },
      uMouthOpen: { value: 0 }, uRound: { value: 0 }, uMouthH: { value: 1 }, uBlush: { value: 1 },
      uTear: { value: 0 }, uTime: { value: 0 },
      uInk: { value: new THREE.Color('#40261d') }, uMouthIn: { value: new THREE.Color('#7a2a38') },
      uTongue: { value: new THREE.Color('#f28ca0') }, uHighlight: { value: new THREE.Color('#fffaf7') },
      uBlushCol: { value: new THREE.Color('#ffb2ae') }, uTearCol: { value: new THREE.Color('#a8d3f4') },
    };
    this.layout = L;
    const pts = [[-L.eyeX, L.eyeY], [L.eyeX, L.eyeY], [0, L.mouthY], [-L.blushX, L.blushY], [L.blushX, L.blushY]];
    body.updateMatrixWorld(true);
    const frames = pts.map(([x, y]) => featureFrame(body, x, y));
    this.uniforms.uFO = { value: frames.map((f) => f.o) };
    this.uniforms.uFT = { value: frames.map((f) => f.t) };
    this.uniforms.uFB = { value: frames.map((f) => f.b) };
    this.group = new THREE.Group();
    this.group.name = 'Face';
    this.layers = {};
    for (const spec of LAYERS) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uOffset: { value: spec.offset } },
        vertexShader: VERT,
        fragmentShader: GLSL_COMMON + FRAG[spec.frag],
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1 - spec.order,
        polygonOffsetUnits: -4 - 4 * spec.order,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = spec.name;
      mesh.renderOrder = spec.order;
      mesh.frustumCulled = false;
      // share the body's morph weights: the face deforms with every shape key
      if (body.morphTargetInfluences) {
        mesh.morphTargetInfluences = body.morphTargetInfluences;
        mesh.morphTargetDictionary = body.morphTargetDictionary;
      }
      this.layers[spec.frag] = mesh;
      this.group.add(mesh);
    }
    // zzz card
    const zzz = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.ShaderMaterial({
      uniforms: { uZzz: { value: 0 }, uTime: this.uniforms.uTime, uCol: { value: new THREE.Color('#8e8794') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: ZZZ_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    }));
    zzz.name = 'FaceZzz';
    zzz.position.set(0.5, 1.42, 0.12);
    zzz.renderOrder = 5;
    zzz.onBeforeRender = (r, sc, cam) => {      // billboard (parent rotations are small)
      zzz.quaternion.copy(cam.quaternion);
      if (zzz.parent) zzz.quaternion.premultiply(zzz.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    };
    this.zzz = zzz;
    this.group.add(zzz);
    body.add(this.group);  // follows every body transform
    this.state = expressionState('happy');
    this.from = this.state;
    this.target = this.state;
    this.t = 1;
    this.dur = 0.2;
    this.blinkT = -1;
    this.nextBlink = 2.5;
    this.extraOpen = 1;    // multiplier driven by animation (sleepy droop etc.)
    this.apply();
  }

  set(name, dur = 0.22) {
    this.from = this.state;
    this.target = expressionState(name);
    this.name = name;
    this.t = dur > 0 ? 0 : 1;
    this.dur = dur;
    if (dur === 0) this.state = this.target;
    this.apply();
  }

  blink() { this.blinkT = 0; }

  update(dt, time, { autoBlink = true } = {}) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = this.t * this.t * (3 - 2 * this.t);
      this.state = blendState(this.from, this.target, e);
    }
    if (autoBlink) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) { this.blink(); this.nextBlink = 2.2 + Math.random() * 3.4; }
    }
    this.uniforms.uTime.value = time;
    this.apply(dt);
  }

  apply(dt = 0) {
    const s = this.state, u = this.uniforms;
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / 0.17;                       // 170 ms blink: fast close, softer open
      blink = k < 0.4 ? 1 - k / 0.4 : Math.min(1, (k - 0.4) / 0.6);
      if (k >= 1) this.blinkT = -1;
    }
    u.uOpen.value = s.open.map((v) => v * blink * this.extraOpen);
    u.uArc.value = s.arc; u.uClosed.value = s.closed; u.uHeart.value = s.heart;
    u.uEyeScale.value = s.eyeScale; u.uLid.value = s.lid; u.uLidAngle.value = s.lidAngle;
    u.uBrow.value = s.brow; u.uBrowAngle.value = s.browAngle; u.uBrowY.value = s.browY;
    const lo = this.lookOffset || [0, 0];
    u.uLook.value.set(s.look[0] + lo[0], s.look[1] + lo[1]);
    u.uCurve.value = s.curve; u.uMouthWk.value = s.mouthW; u.uSmirk.value = s.smirk; u.uWavy.value = s.wavy;
    u.uMouthOpen.value = s.open_; u.uRound.value = s.round; u.uMouthH.value = s.mouthH;
    u.uBlush.value = s.blush; u.uTear.value = s.tear;
    this.zzz.material.uniforms.uZzz.value = s.zzz;
  }

  setKeyDir(v) { this.uniforms.uKeyDir.value.copy(v); }
}
