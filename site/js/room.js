// The cloud's room: a soft cut-away diorama (floor + two walls) with a window to the sky,
// a bed, a rug, a streak board, and decorations that unlock as the streak grows.
// Everything is procedural (rounded boxes, lathe shapes, shaders, canvas textures): no downloads.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 13, D = 10, H = 6.2;            // room size (cloud is 2.0 wide)
const BACK = -D / 2 + 0.6, LEFT = -W / 2;

export const SPOTS = {
  bed: new THREE.Vector3(-4.1, 0, -3.1),
  window: new THREE.Vector3(1.9, 0, -2.6),
  rug: new THREE.Vector3(0.6, 0, 0.2),
  plant: new THREE.Vector3(3.6, 0, -2.4),
};
export const BED_HEIGHT = 0.3;
export const FLOOR_BOUNDS = { x0: -4.4, x1: 5.0, z0: -3.4, z1: 3.6 };   // keeps clear of the lamp corner

export const UNLOCKS = [
  { at: 3, id: 'plant', label: 'a little plant' },
  { at: 5, id: 'lamp', label: 'a cozy lamp' },
  { at: 7, id: 'trophy', label: 'a golden star trophy' },
  { at: 14, id: 'rainbow', label: 'a rainbow outside' },
];

const mat = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const rbox = (w, h, d, r, m) => {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#f3e4d4';
  g.fillRect(0, 0, 1024, 1024);
  // soft planks
  for (let i = 0; i < 9; i++) {
    const y = i * 1024 / 9;
    g.fillStyle = i % 2 ? 'rgba(232,210,190,0.35)' : 'rgba(255,245,235,0.25)';
    g.fillRect(0, y, 1024, 1024 / 9);
    g.fillStyle = 'rgba(205,180,160,0.35)';
    g.fillRect(0, y, 1024, 2);
    const off = (i * 377) % 1024;
    g.fillRect(off, y, 2, 1024 / 9);
    g.fillRect((off + 512) % 1024, y, 2, 1024 / 9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.4, 1.9);
  return t;
}

// Sky seen through the window: day/night gradient, soft clouds, stars, rain, rainbow.
const SKY_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime, uNight, uRain, uRainbow;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float blob(vec2 p, vec2 c, vec2 r) { return smoothstep(1.0, 0.6, length((p - c) / r)); }
void main() {
  vec2 p = vUv;
  vec3 dayTop = vec3(0.62, 0.80, 0.96), dayBot = vec3(0.99, 0.90, 0.84);
  vec3 nightTop = vec3(0.10, 0.11, 0.30), nightBot = vec3(0.33, 0.25, 0.50);
  vec3 rainTop = vec3(0.58, 0.62, 0.72), rainBot = vec3(0.78, 0.78, 0.84);
  vec3 top = mix(mix(dayTop, rainTop, uRain), nightTop, uNight);
  vec3 bot = mix(mix(dayBot, rainBot, uRain), nightBot, uNight);
  vec3 col = mix(bot, top, smoothstep(0.0, 1.0, p.y));
  // sun / moon
  vec2 sc = vec2(0.76, 0.74);
  float sd = length((p - sc) * vec2(1.33, 1.0));
  col += (1.0 - uNight) * (1.0 - uRain) * (vec3(1.0, 0.92, 0.7) * smoothstep(0.12, 0.08, sd) * 0.45 + vec3(1.0, 0.85, 0.6) * exp(-sd * 9.0) * 0.25);
  col = mix(col, vec3(0.98, 0.96, 0.88), uNight * smoothstep(0.09, 0.07, sd) * (1.0 - smoothstep(0.08, 0.06, length((p - sc - vec2(0.03, 0.02)) * vec2(1.33, 1.0)))));
  // stars
  vec2 gp = p * vec2(40.0, 30.0), g = floor(gp);
  vec2 off = vec2(hash(g + 7.0), hash(g + 13.0)) * 0.6 + 0.2;
  float st = step(0.955, hash(g)) * smoothstep(0.16, 0.04, length((fract(gp) - off) * vec2(1.0, 0.75)))
           * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 3.0) * 6.28));
  col += uNight * (1.0 - uRain) * st * smoothstep(0.35, 0.6, p.y) * 0.8;
  // drifting clouds
  float x = fract(p.x * 0.5 + uTime * 0.01);
  float cl = max(blob(vec2(x, p.y), vec2(0.3, 0.55), vec2(0.12, 0.06)), blob(vec2(x, p.y), vec2(0.38, 0.58), vec2(0.09, 0.07)));
  cl = max(cl, max(blob(vec2(x, p.y), vec2(0.8, 0.35), vec2(0.13, 0.05)), blob(vec2(x, p.y), vec2(0.87, 0.38), vec2(0.07, 0.06))));
  col = mix(col, mix(vec3(1.0), vec3(0.45, 0.42, 0.6), uNight) * mix(1.0, 0.85, uRain), cl * 0.85);
  // rainbow
  float rr = length((p - vec2(0.35, -0.25)) * vec2(1.0, 1.15));
  vec3 rb = 0.5 + 0.5 * cos(6.28 * (rr * 7.0 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, rb, uRainbow * (1.0 - uNight) * 0.35 * smoothstep(0.72, 0.76, rr) * smoothstep(0.92, 0.88, rr));
  // rain streaks
  vec2 rp = vec2(p.x * 60.0, p.y * 6.0 + uTime * 9.0);
  float rcol = step(0.85, hash(floor(rp))) * smoothstep(0.0, 0.3, fract(rp.y)) * smoothstep(1.0, 0.7, fract(rp.y));
  col = mix(col, vec3(0.85, 0.9, 1.0), uRain * rcol * 0.6 * step(0.5, fract(rp.x)) );
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Room {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Room';
    scene.add(this.group);
    this.items = {};
    this.build();
  }

  build() {
    const g = this.group;
    const wall = mat('#f9ece4', 0.95), wains = mat('#eed9e8', 0.9), trim = mat('#fffaf6', 0.7);

    // floor slab
    const floorMat = mat('#ffffff', 0.9, { map: floorTexture() });
    const floor = rbox(W, 0.5, D, 0.22, floorMat);
    floor.position.set(0, -0.25, 0);
    floor.name = 'Floor';
    g.add(floor);
    this.floor = floor;

    // walls (back + left), wainscot band, trims
    const back = rbox(W, H, 0.5, 0.2, wall);
    back.position.set(0, H / 2, -D / 2 + 0.25);
    const left = rbox(0.5, H, D, 0.2, wall);
    left.position.set(LEFT + 0.25, H / 2, 0);
    g.add(back, left);
    const wb = rbox(W - 0.6, 1.25, 0.08, 0.04, wains);
    wb.position.set(0.3, 0.65, -D / 2 + 0.54);
    const wl = rbox(0.08, 1.25, D - 0.6, 0.04, wains);
    wl.position.set(LEFT + 0.54, 0.65, 0.3);
    const tb = rbox(W - 0.6, 0.1, 0.16, 0.05, trim);
    tb.position.set(0.3, 1.3, -D / 2 + 0.56);
    const tl = rbox(0.16, 0.1, D - 0.6, 0.05, trim);
    tl.position.set(LEFT + 0.56, 1.3, 0.3);
    g.add(wb, wl, tb, tl);

    // window with sky
    const win = new THREE.Group();
    win.position.set(1.9, 3.35, -D / 2 + 0.5);
    this.sky = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uRain: { value: 0 }, uRainbow: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: SKY_FRAG,
    });
    const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), this.sky);
    skyPlane.position.z = 0.02;
    const frameM = trim;
    const fT = rbox(3.6, 0.22, 0.24, 0.1, frameM); fT.position.set(0, 1.3, 0.1);
    const fB = rbox(3.9, 0.22, 0.42, 0.1, frameM); fB.position.set(0, -1.3, 0.18);
    const fL = rbox(0.22, 2.8, 0.24, 0.1, frameM); fL.position.set(-1.7, 0, 0.1);
    const fR = rbox(0.22, 2.8, 0.24, 0.1, frameM); fR.position.set(1.7, 0, 0.1);
    const mV = rbox(0.1, 2.4, 0.1, 0.05, frameM); mV.position.set(0, 0, 0.08);
    const mH = rbox(3.2, 0.1, 0.1, 0.05, frameM); mH.position.set(0, 0.1, 0.08);
    win.add(skyPlane, fT, fB, fL, fR, mV, mH);
    // curtains
    const curtain = mat('#f3cfdc', 0.95);
    for (const sx of [-1, 1]) {
      const c = rbox(0.55, 3.1, 0.18, 0.09, curtain);
      c.position.set(sx * 2.05, 0.05, 0.3);
      win.add(c);
    }
    g.add(win);
    this.window = win;

    // rug
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.04, 64), mat('#ead8f2', 1));
    rug.position.set(SPOTS.rug.x, 0.02, SPOTS.rug.z);
    rug.receiveShadow = true;
    const rugRing = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.05, 8, 96), mat('#f6eafa', 1));
    rugRing.rotation.x = -Math.PI / 2;
    rugRing.position.set(SPOTS.rug.x, 0.045, SPOTS.rug.z);
    g.add(rug, rugRing);

    // bed: round cushion with a raised rim
    const bed = new THREE.Group();
    bed.position.copy(SPOTS.bed);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.85, 0.3, 64), mat('#f2c6d8', 0.95));
    base.position.y = 0.15;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.3, 24, 96), mat('#f7d5e3', 0.95));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.36;
    const pillow = rbox(1.0, 0.24, 0.6, 0.12, mat('#fff4f8', 0.95));
    pillow.position.set(-0.55, 0.42, -0.85);
    pillow.rotation.y = 0.35;
    for (const m of [base, rim]) { m.castShadow = true; m.receiveShadow = true; }
    bed.add(base, rim, pillow);
    g.add(bed);
    this.bed = bed;

    // shelf on the back wall (trophy lives here)
    const shelf = rbox(2.6, 0.14, 0.6, 0.06, trim);
    shelf.position.set(-3.3, 3.0, -D / 2 + 0.78);
    g.add(shelf);
    const bookCols = ['#c9b6e8', '#f2c6d8', '#bfe0d0'];
    bookCols.forEach((c, i) => {
      const b = rbox(0.22, 0.62 - i * 0.07, 0.45, 0.05, mat(c));
      b.position.set(-4.3 + i * 0.26, 3.07 + (0.62 - i * 0.07) / 2, -D / 2 + 0.8);
      g.add(b);
    });

    // streak board on the left wall
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 768; this.boardCanvas.height = 512;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 4;
    const board = rbox(0.12, 2.0, 3.0, 0.06, trim);
    board.position.set(LEFT + 0.56, 3.2, -1.0);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.8667), new THREE.MeshStandardMaterial({ map: this.boardTex, roughness: 0.9 }));
    boardFace.rotation.y = Math.PI / 2;
    boardFace.position.set(LEFT + 0.63, 3.2, -1.0);
    g.add(board, boardFace);

    // --- unlockables ---
    // plant
    const plant = new THREE.Group();
    plant.position.set(4.6, 0, -3.9);
    const pts = [[0, 0], [0.42, 0], [0.5, 0.08], [0.55, 0.7], [0.62, 0.78], [0.62, 0.84], [0, 0.84]].map(([x, y]) => new THREE.Vector2(x, y));
    const pot = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat('#f0bfa4', 0.9));
    pot.castShadow = pot.receiveShadow = true;
    plant.add(pot);
    const leafM = mat('#9fd2b0', 0.8);
    [[0, 1.35, 0, 0.42, 0.65], [-0.32, 1.15, 0.1, 0.3, 0.5], [0.33, 1.2, -0.05, 0.32, 0.52], [0.05, 1.1, 0.3, 0.28, 0.42]].forEach(([x, y, z, r, h]) => {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), leafM);
      leaf.scale.set(r, h, r * 0.85);
      leaf.position.set(x, y, z);
      leaf.castShadow = true;
      plant.add(leaf);
    });
    g.add(plant);
    this.items.plant = plant;

    // lamp
    const lamp = new THREE.Group();
    lamp.position.set(-5.3, 0, 1.4);
    const lbase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.12, 40), mat('#fffaf6', 0.6));
    lbase.position.y = 0.06;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 16), mat('#e8d9cf', 0.5));
    pole.position.y = 1.35;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 0.75, 48, 1, true),
      mat('#fff1d6', 0.9, { side: THREE.DoubleSide, emissive: new THREE.Color('#ffd89a'), emissiveIntensity: 0 }));
    shade.position.y = 2.85;
    for (const m of [lbase, pole, shade]) m.castShadow = true;
    lamp.add(lbase, pole, shade);
    this.lampLight = new THREE.PointLight(0xffc98a, 0, 9, 1.6);
    this.lampLight.position.set(0, 2.6, 0);
    lamp.add(this.lampLight);
    this.lampShade = shade;
    g.add(lamp);
    this.items.lamp = lamp;

    // trophy (golden star on the shelf)
    const trophy = new THREE.Group();
    trophy.position.set(-2.55, 3.07, -D / 2 + 0.8);
    const tb2 = rbox(0.5, 0.16, 0.36, 0.06, mat('#fffaf6', 0.6));
    tb2.position.y = 0.08;
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.16 : 0.36;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) starShape.lineTo(x, y); else starShape.moveTo(x, y);
    }
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 4 }),
      mat('#ffd36e', 0.35, { metalness: 0.3, emissive: new THREE.Color('#5a3a00'), emissiveIntensity: 0.15 }));
    star.position.set(0, 0.55, -0.06);
    star.castShadow = true;
    trophy.add(tb2, star);
    g.add(trophy);
    this.items.trophy = trophy;
    this.star = star;

    this.items.rainbow = { visible: false };   // drawn by the sky shader
    this.setUnlocked([]);
  }

  setUnlocked(ids) {
    for (const [id, obj] of Object.entries(this.items)) obj.visible = ids.includes(id);
    this.sky.uniforms.uRainbow.value = ids.includes('rainbow') ? 1 : 0;
  }

  // pop-in animation for a fresh unlock
  pop(id) {
    if (id === 'rainbow') { this.sky.uniforms.uRainbow.value = 1; return; }
    const o = this.items[id];
    if (!o || !o.scale) return;
    o.visible = true;
    o.scale.setScalar(0.001);
    o.userData.pop = 0;
  }

  drawBoard(state) {
    const c = this.boardCanvas, g = c.getContext('2d');
    const Wc = c.width, Hc = c.height;
    g.clearRect(0, 0, Wc, Hc);
    g.fillStyle = '#fbf3f8';
    g.fillRect(0, 0, Wc, Hc);
    g.fillStyle = '#efe2f3';
    g.fillRect(0, Hc - 150, Wc, 150);
    g.fillStyle = '#7d6a87';
    g.font = '600 40px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    g.fillText('STREAK', 60, 86);
    // flame
    const fx = 92, fy = 250;
    g.fillStyle = state.streak > 0 ? '#ffa45c' : '#d9cfe0';
    g.beginPath();
    g.moveTo(fx, fy - 95);
    g.bezierCurveTo(fx + 70, fy - 30, fx + 70, fy + 40, fx, fy + 52);
    g.bezierCurveTo(fx - 70, fy + 40, fx - 70, fy - 20, fx - 20, fy - 50);
    g.bezierCurveTo(fx - 10, fy - 10, fx + 10, fy - 30, fx, fy - 95);
    g.fill();
    g.fillStyle = state.streak > 0 ? '#ffd27a' : '#ece4f0';
    g.beginPath();
    g.ellipse(fx, fy + 18, 26, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4a3d4f';
    g.font = '700 170px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    g.fillText(String(state.streak), 190, 310);
    const numW = g.measureText(String(state.streak)).width;
    g.font = '500 34px ui-rounded, system-ui, sans-serif';
    g.fillStyle = '#9a8aa3';
    g.fillText(state.streak === 1 ? 'day' : 'days', 190 + numW + 18, 300);
    g.fillText(`best ${state.best}`, 560, 86);
    // last 7 days
    const hist = state.history.slice(-7);
    for (let i = 0; i < 7; i++) {
      const x = 92 + i * 96, y = Hc - 75;
      const v = hist[i - (7 - hist.length)];
      g.beginPath();
      g.arc(x, y, 30, 0, Math.PI * 2);
      g.fillStyle = v === true ? '#b79be0' : v === false ? '#f1c2cf' : '#ffffff';
      g.fill();
      if (v === true) {
        g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - 13, y + 1); g.lineTo(x - 3, y + 11); g.lineTo(x + 14, y - 10); g.stroke();
      }
    }
    this.boardTex.needsUpdate = true;
  }

  update(dt, time) {
    this.sky.uniforms.uTime.value = time;
    for (const o of Object.values(this.items)) {
      if (o.userData && o.userData.pop !== undefined) {
        o.userData.pop += dt;
        const t = Math.min(1, o.userData.pop / 0.7);
        const s = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.35 * (1 - t) - (1 - t) ** 3 : 1;
        o.scale.setScalar(Math.max(0.001, s));
        if (t >= 1) delete o.userData.pop;
      }
    }
    if (this.star && this.items.trophy.visible) this.star.rotation.y = Math.sin(time * 0.8) * 0.35;
  }
}
