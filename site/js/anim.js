// Code-driven body animation for the limbless cloud. No rig: the body moves through
//   - the root (position, facing, hop height, spin),
//   - a squash group scaled about the base with volume-preserving squash/stretch (y = s, xz = 1/sqrt(s)),
//   - the shape keys from scripts/blender_shapekeys.py (lean, dome sway, lobe puff, droop, breathe, spread),
//   - damped springs for secondary jiggle (dome + lobes lag behind accelerations, squash rebounds).
// Layers: mood (looping idle per emotion) + one action clip at a time (hop, wiggle, spin, ...).
// Deterministic: fixed 120 Hz substeps, no randomness inside clips, so ?clip=&t= frames reproduce.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)));

// tunables (springs + amplitudes) — exposed on the animator for live tweaking
export const TUNING = {
  domeK: 150, domeC: 7.5, domeGain: 0.035,     // dome lags behind horizontal/vertical accelerations
  lobeK: 190, lobeC: 9, lobeGain: 0.02,        // lobes puff on vertical acceleration (landing)
  sqK: 260, sqC: 13, sqGain: 0.0016,           // squash rebound on landing
  breatheAmp: 0.55, breatheHz: 0.3,
};

// ---------------------------------------------------------------------------------------------
// Moods: looping idle layers. Each returns channel values at time t (seconds since mood start).
// Face expression per mood is applied by the animator.
const MOODS = {
  happy: { face: 'happy', f: (t) => ({ breathe: 1, sway: 0.03 * Math.sin(t * 0.9), lookX: 0.12 * Math.sin(t * 0.37) }) },
  veryHappy: {
    face: 'veryHappy',
    f: (t) => {
      const p = (t % 0.72) / 0.72;                        // little bounces
      const air = bump(p, 0.18, 0.78);
      return { breathe: 0.6, hop: 0.16 * air, squash: -0.08 * bump(p, 0.0, 0.2) + 0.05 * air - 0.07 * bump(p, 0.78, 1.0),
        sway: 0.07 * Math.sin(t * TAU / 1.44) };
    },
  },
  proud: { face: 'proud', f: (t) => ({ breathe: 0.8, domeUp: 0.55, leanY: -0.16, squash: 0.03, sway: 0.02 * Math.sin(t * 0.7) }) },
  sleepy: {
    face: 'sleepy',
    f: (t) => ({ breathe: 1.6, breatheHz: 0.18, droop: 0.55 + 0.08 * Math.sin(t * TAU * 0.18), squash: -0.05,
      sway: 0.06 * Math.sin(t * TAU * 0.09), leanY: 0.06 }),
  },
  sad: { face: 'sad', f: (t) => ({ breathe: 0.7, breatheHz: 0.2, droop: 0.38, leanY: 0.16, squash: -0.04, sway: 0.015 * Math.sin(t * 0.5) }) },
  surprised: { face: 'surprised', f: (t) => ({ breathe: 0.5, domeUp: 0.45, squash: 0.07, lookY: 0.05 }) },
  love: {
    face: 'love',
    f: (t) => ({ breathe: 1, sway: 0.16 * Math.sin(t * TAU * 0.45), lobes: 0.35 * Math.sin(t * TAU * 0.9),
      domeUp: 0.15, emit: (t % 0.9) < 1 / 120 ? 'hearts' : null }),
  },
  worried: { face: 'worried', f: (t) => ({ breathe: 0.6, breatheHz: 0.5, squash: -0.04, shiver: 0.012 * Math.sin(t * TAU * 9),
    leanY: 0.05, lookX: 0.25 * Math.sin(t * 1.7) }) },
  determined: {
    face: 'determined',
    f: (t) => { const p = (t % 1.1) / 1.1; return { breathe: 0.7, leanY: 0.2, squash: -0.06 + 0.04 * bump(p, 0, 0.35), domeUp: 0.2 }; },
  },
};

// ---------------------------------------------------------------------------------------------
// Action clips: one-shots layered on top of the mood. f(t) returns additive channels;
// 'face' optionally overrides the expression while the clip runs.
const hopCurve = (t, t0, t1, height) => {
  // anticipation squash -> stretch on take-off -> parabola -> landing squash (springs add the rest)
  const air = clamp((t - t0) / (t1 - t0), 0, 1);
  const inAir = t > t0 && t < t1;
  return {
    hop: inAir ? height * 4 * air * (1 - air) : 0,
    squash: -0.16 * bump(t, t0 - 0.22, t0 + 0.02) + (inAir ? 0.085 * (1 - Math.abs(2 * air - 1)) ** 0.5 * (air < 0.5 ? 1 : 0.4) : 0)
      - 0.14 * bump(t, t1 - 0.02, t1 + 0.16),
    spread: 0.5 * bump(t, t0 - 0.22, t0 + 0.02) + 0.6 * bump(t, t1 - 0.02, t1 + 0.18),
  };
};

export const CLIPS = {
  blink: { dur: 0.2, f: () => ({}), start: (a) => a.face.blink() },
  hop: { dur: 1.25, f: (t) => hopCurve(t, 0.3, 0.86, 0.55) },
  happyWiggle: {
    dur: 1.7, face: 'veryHappy',
    f: (t) => {
      const env = smooth(t / 0.2) * smooth((1.7 - t) / 0.35);
      return { leanX: 0.42 * env * Math.sin(t * TAU * 2.2), lobes: 0.6 * env * Math.sin(t * TAU * 2.2 + 1.2),
        squash: 0.04 * env * Math.sin(t * TAU * 4.4), hop: 0.05 * env * Math.abs(Math.sin(t * TAU * 2.2)) };
    },
  },
  celebrateSpin: {
    dur: 2.1, face: 'veryHappy',
    f: (t) => {
      const h = hopCurve(t, 0.35, 1.25, 0.82);
      const air = clamp((t - 0.35) / 0.9, 0, 1);
      return { ...h, spin: TAU * easeOut(air * 1.05), domeUp: 0.4 * bump(t, 0.3, 1.4),
        emit: Math.abs(t - 0.82) < 1 / 240 ? 'confetti' : null };
    },
  },
  tap: {
    dur: 1.0, face: 'veryHappy',
    f: (t) => ({ squash: -0.2 * bump(t, 0.0, 0.16) + 0.06 * bump(t, 0.16, 0.36), spread: 0.9 * bump(t, 0.0, 0.18),
      shiver: 0.02 * Math.sin(t * TAU * 7) * smooth((1 - t) / 0.6) * smooth(t / 0.2),
      emit: t < 1 / 120 ? 'sparkle' : null }),
  },
  surprised: {
    dur: 1.3, face: 'surprised',
    f: (t) => ({ ...hopCurve(t, 0.08, 0.42, 0.28), domeUp: 0.6 * bump(t, 0.05, 1.2), squash: 0.12 * bump(t, 0.05, 0.6) }),
  },
  sadSigh: {
    dur: 2.2, face: 'sad',
    f: (t) => ({ droop: 0.45 * bump(t, 0.2, 2.1), leanY: 0.18 * bump(t, 0.2, 2.1), squash: -0.08 * bump(t, 0.3, 1.9) }),
  },
  sleepyNod: {
    dur: 2.6, face: 'sleepy',
    f: (t) => ({ droop: 0.7 * bump(t, 0.1, 2.4), leanY: 0.25 * bump(t, 0.6, 1.6) - 0.08 * bump(t, 1.6, 2.2) }),
  },
  proudPuff: {
    dur: 1.8, face: 'proud',
    f: (t) => ({ domeUp: 0.9 * bump(t, 0.1, 1.7), leanY: -0.22 * bump(t, 0.1, 1.7), squash: 0.08 * bump(t, 0.1, 1.7),
      lobes: 0.4 * bump(t, 0.2, 1.6) }),
  },
  loveSway: {
    dur: 2.4, face: 'love',
    f: (t) => ({ sway: 0.24 * Math.sin(t * TAU * 0.83) * bump(t, 0, 2.4), lobes: 0.5 * Math.sin(t * TAU * 1.66) * bump(t, 0, 2.4),
      emit: (t % 0.6) < 1 / 120 ? 'hearts' : null }),
  },
  worriedShiver: {
    dur: 1.6, face: 'worried',
    f: (t) => ({ shiver: 0.025 * Math.sin(t * TAU * 11) * bump(t, 0, 1.6), squash: -0.08 * bump(t, 0, 1.6), leanY: 0.08 * bump(t, 0, 1.6) }),
  },
  determinedBounce: {
    dur: 1.6, face: 'determined',
    f: (t) => ({ ...hopCurve(t, 0.45, 0.75, 0.18), leanY: 0.25 * bump(t, 0, 1.6), domeUp: 0.3 * bump(t, 0, 1.6) }),
  },
};

// channels summed from mood + action (all default 0 except breathe gain)
const CH = ['hop', 'squash', 'spread', 'leanX', 'leanY', 'sway', 'domeUp', 'lobes', 'droop', 'shiver', 'spin', 'lookX', 'lookY'];

class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  step(dt, force) { this.v += (-this.k * this.x - this.c * this.v + force) * dt; this.x += this.v * dt; return this.x; }
}

export class Animator {
  constructor({ root, squash, body, face, shadow }) {
    this.root = root; this.squashGroup = squash; this.body = body; this.face = face; this.shadow = shadow;
    this.dict = body.morphTargetDictionary;
    this.infl = body.morphTargetInfluences;
    this.tuning = { ...TUNING };
    this.onEvent = () => {};
    this.reset();
  }

  reset() {
    const T = this.tuning;
    this.time = 0;
    this.baseY = this.baseY || 0;            // floor height under the cloud (e.g. on the bed)
    this.moodName = 'happy'; this.moodT = 0;
    this.prevMood = null; this.moodBlend = 1;
    this.action = null; this.queue = [];
    this.breathePhase = 0;
    this.spr = { domeX: new Spring(T.domeK, T.domeC), domeY: new Spring(T.domeK, T.domeC),
      lobes: new Spring(T.lobeK, T.lobeC), squash: new Spring(T.sqK, T.sqC) };
    this.prev = { hop: 0, hopV: 0, x: this.root.position.x, z: this.root.position.z, vx: 0, vz: 0 };
    this.travel = null;
    this.heading = this.root.rotation.y;
    this.out = { ...Object.fromEntries(CH.map((c) => [c, 0])), breatheV: 0 };
    this.face.set(MOODS.happy.face, 0);
  }

  get mood() { return this.moodName; }

  setMood(name, blend = 0.6) {
    if (!MOODS[name] || name === this.moodName) return;
    this.prevMood = { name: this.moodName, t: this.moodT };
    this.moodName = name; this.moodT = 0; this.moodBlend = blend > 0 ? 0 : 1; this.moodBlendDur = blend;
    if (!this.action || !CLIPS[this.action.name].face) this.face.set(MOODS[name].face);
  }

  play(name) {
    const clip = CLIPS[name];
    if (!clip) return;
    if (name === 'blink') { clip.start(this); return; }
    this.action = { name, t: 0 };
    if (clip.face) this.face.set(clip.face, 0.12);
    if (clip.start) clip.start(this);
  }

  // hop-travel to (x, z) on the floor in a series of small hops, turning to face the way
  faceTo(angle) { this.wantHeading = angle; }

  moveTo(x, z, { onArrive } = {}) {
    this.travel = { x, z, onArrive, hopT: 0, from: null };
  }

  get busy() { return !!this.action || !!this.travel; }

  update(dt) {
    // fixed substeps for determinism + stable springs
    this.acc = (this.acc || 0) + Math.min(dt, 0.1);
    const h = 1 / 120;
    while (this.acc >= h) { this.step(h); this.acc -= h; }
    this.apply();
  }

  simulate(seconds) { // for deterministic shots
    for (let t = 0; t < seconds - 1e-9; t += 1 / 120) this.step(1 / 120);
    this.apply();
  }

  step(dt) {
    const T = this.tuning;
    this.time += dt; this.moodT += dt;
    if (this.moodBlend < 1) this.moodBlend = Math.min(1, this.moodBlend + dt / this.moodBlendDur);

    // ---- mood layer (cross-faded) ----
    const sum = Object.fromEntries(CH.map((c) => [c, 0]));
    let breathe = 0, breatheHz = 0;
    const addMood = (name, t, w) => {
      const v = MOODS[name].f(t);
      for (const c of CH) sum[c] += (v[c] || 0) * w;
      breathe += (v.breathe ?? 1) * w; breatheHz += (v.breatheHz ?? T.breatheHz) * w;
      if (v.emit && w > 0.5) this.onEvent(v.emit, this);
    };
    const wb = smooth(this.moodBlend);
    addMood(this.moodName, this.moodT, wb);
    if (wb < 1 && this.prevMood) { this.prevMood.t += dt; addMood(this.prevMood.name, this.prevMood.t, 1 - wb); }

    // ---- action layer ----
    if (this.action) {
      const clip = CLIPS[this.action.name];
      this.action.t += dt;
      const v = clip.f(this.action.t);
      for (const c of CH) sum[c] += v[c] || 0;
      if (v.emit) this.onEvent(v.emit, this);
      if (this.action.t >= clip.dur) {
        const ended = this.action.name;
        this.action = null;
        if (clip.face) this.face.set(MOODS[this.moodName].face, 0.25);
        if (ended === 'celebrateSpin') this.root.rotation.y = this.heading; // spin is a full turn
      }
    }

    // ---- travel (hop locomotion) ----
    if (this.travel) {
      const tr = this.travel;
      const dx = tr.x - this.root.position.x, dz = tr.z - this.root.position.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      let dh = ((want - this.heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.heading += dh * Math.min(1, dt * 7);
      if (Math.abs(dh) < 0.6) {
        tr.hopT += dt;
        const p = tr.hopT / 0.5;                      // one hop every 0.5 s
        if (!tr.from) {                               // direction + length fixed at take-off
          tr.from = { x: this.root.position.x, z: this.root.position.z, d: Math.min(dist, 0.75),
            ux: dist > 1e-4 ? dx / dist : 0, uz: dist > 1e-4 ? dz / dist : 0 };
        }
        const k = smooth(clamp((p - 0.25) / 0.7, 0, 1));
        const hc = hopCurve(p, 0.25, 0.95, 0.42);
        sum.hop += hc.hop; sum.squash += hc.squash * 0.8; sum.spread += hc.spread * 0.6;
        this.root.position.x = tr.from.x + tr.from.ux * tr.from.d * k;
        this.root.position.z = tr.from.z + tr.from.uz * tr.from.d * k;
        if (p >= 1.12) {
          tr.hopT = 0; tr.from = null;
          if (Math.hypot(tr.x - this.root.position.x, tr.z - this.root.position.z) < 0.05) {
            this.travel = null;
            if (tr.onArrive) tr.onArrive();
          }
        }
      }
    }
    else if (this.wantHeading !== undefined) {          // idle: turn smoothly toward a wanted facing
      const dh = ((this.wantHeading - this.heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.heading += dh * Math.min(1, dt * 3.5);
    }
    this.root.rotation.y = this.heading + sum.spin;

    // ---- secondary motion from accelerations ----
    const hopV = (sum.hop - this.prev.hop) / dt;
    const hopA = (hopV - this.prev.hopV) / dt;
    this.prev.hop = sum.hop; this.prev.hopV = hopV;
    const px = this.root.position.x, pz = this.root.position.z;
    const vx = (px - this.prev.x) / dt, vz = (pz - this.prev.z) / dt;
    const ax = (vx - this.prev.vx) / dt, az = (vz - this.prev.vz) / dt;
    this.prev.x = px; this.prev.z = pz; this.prev.vx = vx; this.prev.vz = vz;
    // into body-local frame (heading)
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const lax = c * ax + s * az, laz = -s * ax + c * az;
    const leanDrive = sum.leanX + sum.sway;                     // swaying the body throws the dome too
    this.spr.domeX.step(dt, -lax * T.domeGain * T.domeK - leanDrive * 40);
    this.spr.domeY.step(dt, laz * T.domeGain * T.domeK - hopA * 0.0006 * T.domeK);
    this.spr.lobes.step(dt, -clamp(hopA, -400, 400) * T.lobeGain);
    this.spr.squash.step(dt, -clamp(hopA, -600, 600) * T.sqGain * T.sqK * 0.02);

    // breathing
    this.breathePhase += dt * TAU * breatheHz;
    sum.breatheV = T.breatheAmp * breathe * (0.5 + 0.5 * Math.sin(this.breathePhase));
    this.out = sum;
  }

  apply() {
    const o = this.out, sp = this.spr;
    const set = (name, v) => { const i = this.dict[name]; if (i !== undefined) this.infl[i] = v; };
    // volume-preserving squash & stretch about the base
    const sq = clamp(1 + o.squash + sp.squash.x, 0.6, 1.5);
    this.squashGroup.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.squashGroup.position.set(o.shiver, 0, 0);
    this.root.position.y = this.baseY + Math.max(0, o.hop);
    set('Breathe', o.breatheV);
    set('Spread', clamp(o.spread + Math.max(0, -(o.squash + sp.squash.x)) * 1.5, 0, 1.5));
    set('LeanX', clamp(o.leanX + o.sway, -1, 1));
    set('LeanY', clamp(o.leanY, -1, 1));
    set('DomeX', clamp(sp.domeX.x, -1, 1));
    set('DomeY', clamp(sp.domeY.x, -1, 1));
    set('DomeUp', clamp(o.domeUp, -0.5, 1.2));
    const lobeBase = sp.lobes.x;
    set('LobeL', clamp(lobeBase + o.lobes, -0.6, 1));
    set('LobeR', clamp(lobeBase - o.lobes, -0.6, 1));
    set('Droop', clamp(o.droop, 0, 1));
    this.face.lookOffset = [o.lookX, o.lookY];   // gaze drift, applied by Face.apply()
    // contact shadow follows the root, fades/spreads with height
    if (this.shadow) {
      const y = Math.max(0, o.hop);
      this.shadow.position.set(this.root.position.x, this.baseY + 0.002, this.root.position.z);
      const k = 1 + y * 0.35;
      this.shadow.scale.set(k / Math.sqrt(sq), k / Math.sqrt(sq), 1);
      this.shadow.material.uniforms.uFade.value = 1 / (1 + y * 2.2);
    }
  }
}

export const MOOD_NAMES = Object.keys(MOODS);
export const CLIP_NAMES = Object.keys(CLIPS);
