// Nimbus game rules: pure state logic, no DOM and no three.js (tested in tests/rules.test.mjs).
//
// The loop
//   - Each planet is one area of life. You give it your own small daily tasks (every day or chosen weekdays).
//   - Tick a task: +5 stardust. Finish every task a planet has today and the planet is "tended": +5 more and
//     it grows a day. Finish everything scheduled today ("clear sky"): +10.
//   - Growth is cumulative tended days: seed -> sprout (3) -> bloom (7) -> radiant (14). Each first arrival at
//     a stage pays +25 and unlocks that planet's decor.
//   - Never miss twice: the first missed day only puts a planet at risk. A second miss in a row resets its
//     streak, and every further missed day wilts it by one growth day (it can shrink back a stage).
//   - Cloud cushions (start with 1, +1 for every 7-day planet streak, or buy them, hold up to 3) are used
//     automatically on a second miss in a row, so the streak survives and nothing wilts.
//   - Days without a scheduled task are rest days for that planet: nothing is gained or lost.
//   - A day runs until 03:00, so late-night tasks count for the evening they belong to.
//   - Stardust buys accessories and finishes for Nimbus in the shop.

export const VERSION = 2;
export const DAY_START_HOUR = 3;
export const MAX_TASKS = 5;
export const MAX_CUSHIONS = 3;
export const REWARD = { task: 5, tended: 5, clearSky: 10, stage: 25 };
export const WELCOME_GIFT = 50;

export const STAGES = [
  { id: 'seed', name: 'Seed', at: 0 },
  { id: 'sprout', name: 'Sprout', at: 3 },
  { id: 'bloom', name: 'Bloom', at: 7 },
  { id: 'radiant', name: 'Radiant', at: 14 },
];
export const stageOf = (growth) => STAGES.reduce((s, st, i) => (growth >= st.at ? i : s), 0);

// The six habit planets. `suggest` seeds the task picker; anything can be typed instead.
export const PLANETS = [
  { id: 'ocean', name: 'Tide', area: 'Water & nourishment', color: '#5fd0c9',
    blurb: 'Drinking enough, eating well, looking after your body.',
    suggest: ['Drink 8 glasses of water', 'Eat a piece of fruit', 'Take my vitamins', 'Cook a real meal'] },
  { id: 'book', name: 'Folio', area: 'Learning & reading', color: '#e9a8c0',
    blurb: 'Pages, lessons, practice. A little every day adds up.',
    suggest: ['Read 10 pages', 'Practice a language for 10 min', 'Watch one lecture', 'Learn one new word'] },
  { id: 'moon', name: 'Luna', area: 'Rest & sleep', color: '#efd98f',
    blurb: 'Winding down, sleeping on time, waking up rested.',
    suggest: ['Lights out by 23:00', 'No screens 30 min before bed', 'Make my bed', 'Wake up by 7:30'] },
  { id: 'meadow', name: 'Meadow', area: 'Movement', color: '#95cd84',
    blurb: 'Walks, stretches, workouts, anything that gets you moving.',
    suggest: ['Walk for 20 minutes', 'Stretch for 5 minutes', 'Do a short workout', 'Take the stairs'] },
  { id: 'lantern', name: 'Lantern', area: 'Calm mind', color: '#f2b29c',
    blurb: 'Breathing room: meditation, quiet, time outside.',
    suggest: ['Meditate for 5 minutes', 'Spend 10 min outside', 'Take 3 slow breaths before work', 'Tidy my desk'] },
  { id: 'tea', name: 'Teacup', area: 'Reflection & people', color: '#a9cf8f',
    blurb: 'Journaling, gratitude, and the people you love.',
    suggest: ['Write one journal page', 'Note 3 things I’m grateful for', 'Message a friend', 'Call my family'] },
];
export const planetDef = (id) => PLANETS.find((p) => p.id === id);

// Decor unlocks by stage (index into STAGES); shared items fit any planet.
export const DECOR = {
  ocean: [{ id: 'item_fountain', stage: 1, name: 'Fountain' }, { id: 'item_boat', stage: 2, name: 'Sailboat' }, { id: 'item_lighthouse', stage: 3, name: 'Lighthouse' }],
  book: [{ id: 'item_lamp', stage: 1, name: 'Reading lamp' }, { id: 'item_armchair', stage: 2, name: 'Armchair' }, { id: 'item_booktower', stage: 3, name: 'Book tower' }],
  moon: [{ id: 'item_starlantern', stage: 1, name: 'Star lantern' }, { id: 'item_bed', stage: 2, name: 'Cloud bed' }, { id: 'item_telescope', stage: 3, name: 'Telescope' }],
  meadow: [{ id: 'item_flowerpatch', stage: 1, name: 'Flower patch' }, { id: 'item_swingtree', stage: 2, name: 'Swing tree' }, { id: 'item_windmill', stage: 3, name: 'Windmill' }],
  lantern: [{ id: 'item_lanternpost', stage: 1, name: 'Lantern post' }, { id: 'item_lotuspond', stage: 2, name: 'Lotus pond' }, { id: 'item_bench', stage: 3, name: 'Bench' }],
  tea: [{ id: 'item_teapot', stage: 1, name: 'Teapot' }, { id: 'item_teahouse', stage: 2, name: 'Tea house' }, { id: 'item_mushrooms', stage: 3, name: 'Mushrooms' }],
};
export const SHARED_DECOR = [{ id: 'item_mailbox', stage: 2, name: 'Mailbox' }, { id: 'item_rocket', stage: 3, name: 'Rocket' }];
export const decorFor = (pid) => [...DECOR[pid], ...SHARED_DECOR];

// Shop. `req` gates an item behind progress so the shop is also a map of what's ahead.
export const SHOP = [
  { id: 'head_sprout', slot: 'head', name: 'Leaf sprout', price: 40, note: 'A tiny green start.' },
  { id: 'head_party', slot: 'head', name: 'Party hat', price: 60, note: 'For clear-sky days.' },
  { id: 'head_beanie', slot: 'head', name: 'Knit beanie', price: 90, note: 'Warm and a little slouchy.' },
  { id: 'head_flowers', slot: 'head', name: 'Flower crown', price: 120, note: 'Picked from the meadow.' },
  { id: 'head_halo', slot: 'head', name: 'Halo', price: 160, note: 'Glows softly.', req: { stage: 2 } },
  { id: 'head_crown', slot: 'head', name: 'Little crown', price: 240, note: 'For a radiant planet keeper.', req: { stage: 3 } },
  { id: 'neck_bowtie', slot: 'neck', name: 'Bow tie', price: 50, note: 'Dapper.' },
  { id: 'neck_scarf', slot: 'neck', name: 'Cozy scarf', price: 80, note: 'Hand-knit, very long.' },
  { id: 'neck_star', slot: 'neck', name: 'Star pendant', price: 110, note: 'A wish on a ribbon.', req: { stage: 1 } },
  { id: 'finish_classic', slot: 'finish', name: 'Classic', price: 0, color: '#ffffff', note: 'Nimbus as you met it.' },
  { id: 'finish_peach', slot: 'finish', name: 'Peach', price: 100, color: '#ffd9c4', note: 'Sunrise warm.' },
  { id: 'finish_mint', slot: 'finish', name: 'Mint', price: 100, color: '#c9f0dc', note: 'Fresh as rain.' },
  { id: 'finish_lilac', slot: 'finish', name: 'Lilac', price: 100, color: '#e2d4ff', note: 'Twilight soft.' },
  { id: 'finish_sky', slot: 'finish', name: 'Sky', price: 120, color: '#c8e4ff', note: 'Clear blue afternoon.' },
  { id: 'finish_gold', slot: 'finish', name: 'Golden hour', price: 300, color: '#ffe3a3', note: 'Lit from within.', req: { stage: 3 } },
  { id: 'cushion', slot: 'supply', name: 'Cloud cushion', price: 40, note: 'Saves a streak from a second missed day. Used automatically.' },
];
export const shopItem = (id) => SHOP.find((s) => s.id === id);

// ------------------------------------------------------------------ dates (local "YYYY-MM-DD" keys)
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(date = new Date(), startHour = DAY_START_HOUR) {
  const d = new Date(date.getTime() - startHour * 3600e3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const keyToDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const weekday = (key) => keyToDate(key).getDay();
export function addDays(key, n) { const d = keyToDate(key); d.setDate(d.getDate() + n); return dayKey(d, 0); }
export function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 864e5); }

// ------------------------------------------------------------------ state
let uid = 0;
export const newId = () => `t${Date.now().toString(36)}${(uid++).toString(36)}`;

export function freshState(today = dayKey()) {
  return {
    v: VERSION, today, onboarded: false,
    stardust: WELCOME_GIFT, earned: 0, cushions: 1,
    streak: { count: 0, best: 0 },
    planets: Object.fromEntries(PLANETS.map((p) => [p.id, {
      awake: false, growth: 0, streak: 0, best: 0, misses: 0, peak: 0, tasks: [], items: [],
    }])),
    log: {},
    owned: ['finish_classic'], equipped: { head: null, neck: null, finish: 'finish_classic' },
    recap: null,
  };
}

export function migrate(s) {
  if (!s || s.v !== VERSION || !s.planets) return null;
  for (const p of PLANETS) if (!s.planets[p.id]) s.planets[p.id] = freshState().planets[p.id];
  return s;
}

const dayLog = (s, key) => (s.log[key] ||= { done: [] });
export const isScheduled = (task, key) => task.days.includes(weekday(key));
export const isDone = (s, taskId, key = s.today) => !!s.log[key]?.done.includes(taskId);

// one planet on one day
export function planetDay(s, pid, key = s.today) {
  const P = s.planets[pid];
  const tasks = P.awake ? P.tasks.filter((t) => isScheduled(t, key)) : [];
  const done = tasks.filter((t) => isDone(s, t.id, key)).length;
  return { tasks, scheduled: tasks.length, done, tended: tasks.length > 0 && done === tasks.length, rest: P.awake && tasks.length === 0 };
}
export function today(s, key = s.today) {
  const planets = PLANETS.filter((p) => s.planets[p.id].awake).map((p) => ({ id: p.id, ...planetDay(s, p.id, key) }));
  const scheduled = planets.reduce((a, p) => a + p.scheduled, 0), done = planets.reduce((a, p) => a + p.done, 0);
  return { planets, scheduled, done, clearSky: scheduled > 0 && done === scheduled };
}
// growth and streak including today's tending (committed at the day's close)
export function growthNow(s, pid) { return s.planets[pid].growth + (planetDay(s, pid).tended ? 1 : 0); }
export function streakNow(s, pid) { return s.planets[pid].streak + (planetDay(s, pid).tended ? 1 : 0); }
export function stageNow(s, pid) { return stageOf(growthNow(s, pid)); }
export const bestStage = (s) => Math.max(0, ...PLANETS.map((p) => (s.planets[p.id].awake ? stageNow(s, p.id) : 0)));

// stardust a day is worth, from what was done on it (so un-ticking refunds exactly)
function dayValue(s, key) {
  const t = today(s, key);
  return t.done * REWARD.task + t.planets.filter((p) => p.tended).length * REWARD.tended + (t.clearSky ? REWARD.clearSky : 0);
}
// apply a change to today and settle stardust; returns events for the UI
function settle(s, fn) {
  const before = dayValue(s, s.today);
  const was = Object.fromEntries(PLANETS.map((p) => [p.id, planetDay(s, p.id).tended]));
  const wasClear = today(s).clearSky;
  fn();
  const after = dayValue(s, s.today), delta = after - before;
  s.stardust += delta; s.earned += delta;
  dayLog(s, s.today).earned = after;
  const events = [];
  if (delta) events.push({ type: 'stardust', amount: delta });
  for (const p of PLANETS) {
    const now = planetDay(s, p.id).tended;
    if (now && !was[p.id]) events.push({ type: 'tended', planet: p.id });
    if (!now && was[p.id]) events.push({ type: 'untended', planet: p.id });
    const st = stageNow(s, p.id), P = s.planets[p.id];
    if (st > P.peak) {               // first arrival at a stage pays once and is never taken back
      P.peak = st; s.stardust += REWARD.stage; s.earned += REWARD.stage;
      events.push({ type: 'stage', planet: p.id, stage: st, amount: REWARD.stage });
    }
  }
  const clear = today(s).clearSky;
  if (clear && !wasClear) events.push({ type: 'clearSky' });
  return events;
}

export function toggleTask(s, pid, taskId) {
  return settle(s, () => {
    const L = dayLog(s, s.today);
    const i = L.done.indexOf(taskId);
    if (i >= 0) L.done.splice(i, 1); else L.done.push(taskId);
  });
}

const cleanTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const cleanDays = (d) => { const days = [...new Set((d || []).filter((x) => x >= 0 && x <= 6))].sort(); return days.length ? days : [0, 1, 2, 3, 4, 5, 6]; };
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export function addTask(s, pid, title, days = EVERY_DAY) {
  const P = s.planets[pid];
  title = cleanTitle(title);
  if (!title) return { error: 'Give the task a name.' };
  if (P.tasks.length >= MAX_TASKS) return { error: `A planet holds up to ${MAX_TASKS} tasks. Small and steady wins.` };
  if (P.tasks.some((t) => t.title.toLowerCase() === title.toLowerCase())) return { error: 'That task is already here.' };
  const task = { id: newId(), title, days: cleanDays(days) };
  const events = settle(s, () => { P.tasks.push(task); P.awake = true; });
  return { task, events };
}
export function editTask(s, pid, taskId, { title, days }) {
  const t = s.planets[pid].tasks.find((x) => x.id === taskId);
  if (!t) return { error: 'Task not found.' };
  if (title !== undefined) { const c = cleanTitle(title); if (!c) return { error: 'Give the task a name.' }; t.title = c; }
  return { events: settle(s, () => { if (days !== undefined) t.days = cleanDays(days); }) };
}
export function removeTask(s, pid, taskId) {
  const P = s.planets[pid];
  return settle(s, () => {
    P.tasks = P.tasks.filter((t) => t.id !== taskId);
    const L = dayLog(s, s.today);
    L.done = L.done.filter((id) => id !== taskId);
  });
}
// a sleeping planet keeps its growth and decor but its tasks are paused (no misses)
export function setAwake(s, pid, awake) {
  return settle(s, () => { s.planets[pid].awake = awake; if (awake) s.planets[pid].misses = 0; });
}

// first-run setup: { planetId: [{title, days}] }
export function setup(s, picks) {
  for (const [pid, tasks] of Object.entries(picks)) for (const t of tasks) addTask(s, pid, t.title, t.days);
  s.onboarded = true;
}

// ------------------------------------------------------------------ the day closing
// Close every day from s.today up to (not including) `key`; returns a recap of what happened.
export function rollover(s, key = dayKey()) {
  const gap = daysBetween(s.today, key);
  if (gap <= 0) return null;
  const recap = { day: s.today, days: gap, done: 0, scheduled: 0, earned: 0, events: [] };
  let d = s.today;
  // more than a month away: close only the last 30 days (the rest would just be misses)
  if (gap > 30) d = addDays(key, -30);
  const first = s.today;
  while (d < key) {
    closeDay(s, d, recap, d === first);
    d = addDays(d, 1);
  }
  s.today = key;
  s.recap = recap.scheduled || recap.events.length ? recap : null;
  return s.recap;
}

function closeDay(s, key, recap, isFirst) {
  const t = today(s, key);
  if (isFirst) { recap.done = t.done; recap.scheduled = t.scheduled; recap.earned = s.log[key]?.earned || 0; recap.clearSky = t.clearSky; }
  if (t.scheduled > 0) {
    if (t.done > 0) { s.streak.count++; s.streak.best = Math.max(s.streak.best, s.streak.count); } else s.streak.count = 0;
  }
  const L = dayLog(s, key);
  L.planets = {};
  for (const p of t.planets) {
    const P = s.planets[p.id];
    if (p.rest) { L.planets[p.id] = 'rest'; continue; }
    if (p.tended) {
      L.planets[p.id] = 'tended';
      P.growth++; P.streak++; P.best = Math.max(P.best, P.streak); P.misses = 0;
      if (P.streak % 7 === 0) {
        if (s.cushions < MAX_CUSHIONS) { s.cushions++; recap.events.push({ type: 'cushionEarned', planet: p.id, streak: P.streak }); }
        else recap.events.push({ type: 'milestone', planet: p.id, streak: P.streak });
      }
      continue;
    }
    L.planets[p.id] = 'missed';
    P.misses++;
    if (P.misses === 1) { recap.events.push({ type: 'atRisk', planet: p.id }); continue; }
    // a second miss in a row would cost the streak: a cushion takes the hit instead
    if (s.cushions > 0) { s.cushions--; P.misses = 1; L.planets[p.id] = 'cushion'; recap.events.push({ type: 'cushionUsed', planet: p.id, day: key }); continue; }
    if (P.streak > 0) { recap.events.push({ type: 'streakLost', planet: p.id, streak: P.streak }); P.streak = 0; }
    if (P.growth > 0) {
      const before = stageOf(P.growth);
      P.growth--;
      recap.events.push({ type: 'wilt', planet: p.id, shrank: stageOf(P.growth) < before, stage: stageOf(P.growth) });
    }
  }
  // keep two months of history
  for (const k of Object.keys(s.log)) if (daysBetween(k, key) > 62) delete s.log[k];
}
// health of a planet for display
export function planetStatus(s, pid) {
  const P = s.planets[pid];
  if (!P.awake) return 'asleep';
  const d = planetDay(s, pid);
  if (d.tended) return 'tended';
  if (d.rest) return 'rest';
  if (P.misses >= 1) return 'risk';
  return 'open';
}
// last n days for a planet: 'tended' | 'missed' | 'cushion' | 'rest' | 'none', today: 'tended' | 'today' | 'rest'
export function history(s, pid, n = 7) {
  const out = [];
  for (let i = n - 1; i >= 1; i--) { const key = addDays(s.today, -i); out.push({ key, v: s.log[key]?.planets?.[pid] || 'none' }); }
  const d = planetDay(s, pid);
  out.push({ key: s.today, v: d.tended ? 'tended' : d.rest ? 'rest' : 'today', today: true });
  return out;
}

// ------------------------------------------------------------------ shop
export function canBuy(s, id) {
  const it = shopItem(id);
  if (!it) return { ok: false, why: 'Unknown item.' };
  if (it.slot !== 'supply' && s.owned.includes(id)) return { ok: false, why: 'Owned' };
  if (it.slot === 'supply' && s.cushions >= MAX_CUSHIONS) return { ok: false, why: `You can hold ${MAX_CUSHIONS} cushions.` };
  if (it.req && bestStage(s) < it.req.stage) return { ok: false, locked: true, why: `Grow any planet to ${STAGES[it.req.stage].name}` };
  if (s.stardust < it.price) return { ok: false, short: it.price - s.stardust, why: `${it.price - s.stardust} more stardust` };
  return { ok: true };
}
export function buy(s, id) {
  const c = canBuy(s, id);
  if (!c.ok) return c;
  const it = shopItem(id);
  s.stardust -= it.price;
  if (it.slot === 'supply') s.cushions++;
  else { s.owned.push(id); s.equipped[it.slot] = id; }
  return { ok: true };
}
export function equip(s, id) {
  const it = shopItem(id);
  if (!it || !s.owned.includes(id)) return false;
  s.equipped[it.slot] = s.equipped[it.slot] === id && it.slot !== 'finish' ? null : id;
  return true;
}
