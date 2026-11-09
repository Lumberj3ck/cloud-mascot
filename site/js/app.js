// Nimbus app: the game UI around the 3D world. Rules live in rules.js, the scene in world.js.
// Test hooks: window.__app; ?offset=N shifts "today" by N days (demo), ?fresh starts from a clean slate in memory.
import * as R from './rules.js';
import { icon, MARK } from './icons.js';
import { createWorld } from './world.js';
import { thumbnail } from './wardrobe.js';

const params = new URLSearchParams(location.search);
const STORE = 'nimbus-app-v2', OFFSET = 'nimbus-day-offset';
const MEMORY_ONLY = params.has('fresh');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const def = R.planetDef;
const color = (pid) => def(pid).color;
const orb = (pid, cls = '') => `<span class="orb ${cls}" style="--c:${color(pid)}"></span>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mobile = () => matchMedia('(max-width: 760px)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ state + clock
let offset = 0;
try { offset = Number(params.get('offset') ?? (MEMORY_ONLY ? 0 : localStorage.getItem(OFFSET)) ?? 0) || 0; } catch { /* storage blocked */ }
const clock = () => R.dayKey(new Date(Date.now() + offset * 864e5));
function load() {
  if (MEMORY_ONLY) return R.freshState(clock());
  try { return R.migrate(JSON.parse(localStorage.getItem(STORE))) || R.freshState(clock()); } catch { return R.freshState(clock()); }
}
function save() { if (MEMORY_ONLY) return; try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* storage full or blocked */ } }
let S = load();
let world = null;
const ui = { sheet: null, planet: null, tab: 'tasks', placing: null, shopTab: 'head', tryOn: null, expanded: false, adding: false, editing: null, shownDust: S.stardust };
const ob = { step: 0, picks: [], idx: 0, tasks: {} };

const scheduleText = (days) => {
  const d = [...days].sort().join();
  if (days.length === 7) return 'Every day';
  if (d === '1,2,3,4,5') return 'Weekdays';
  if (d === '0,6') return 'Weekends';
  return WEEK.filter((x) => days.includes(x)).map((x) => DAY_ABBR[x]).join(', ');
};
const stageLine = (pid) => {
  const g = R.growthNow(S, pid), st = R.stageOf(g), next = R.STAGES[st + 1];
  return next ? `${R.STAGES[st].name} · ${plural(next.at - g, 'day')} to ${next.name}` : `${R.STAGES[st].name} · fully grown`;
};
const dateLine = (key) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(R.keyToDate(key));

// ------------------------------------------------------------------ world view
function worldView() {
  const planets = {};
  for (const p of R.PLANETS) {
    const P = S.planets[p.id];
    const preview = !S.onboarded && ob.picks.includes(p.id);
    planets[p.id] = { awake: P.awake || preview, growth: R.growthNow(S, p.id), stage: R.stageNow(S, p.id),
      tended: R.planetDay(S, p.id).tended, status: R.planetStatus(S, p.id), items: P.items };
  }
  const e = { ...S.equipped };
  if (ui.tryOn) { const it = R.shopItem(ui.tryOn); if (it.slot !== 'supply') e[it.slot] = ui.tryOn; }
  return { planets, equipped: { head: e.head, neck: e.neck, finishColor: R.shopItem(e.finish)?.color || '#ffffff' } };
}
function sync() { if (world) world.sync(worldView()); }
function camera() {
  if (!world) return;
  if (!S.onboarded) {
    const v = [['mascot'], ['overview'], ['planet', ob.picks[ob.idx]], ['mascot']][ob.step];
    world.view(...v);
  } else if (ui.sheet === 'planet') world.view('planet', ui.planet);
  else if (ui.sheet === 'shop') world.view('mascot');
  else world.view('overview');
  requestAnimationFrame(insets);
}
function insets() {
  if (!world) return;
  const W = innerWidth, H = innerHeight;
  const out = { left: 0, right: 0, top: mobile() ? 56 : 60, bottom: 0 };
  const today = $('today'), side = ui.sheet === 'planet' ? $('planetSheet') : ui.sheet === 'shop' ? $('shopSheet') : null, onb = $('onboard');
  if (mobile()) {
    const el = !onb.hidden ? onb : side || (S.onboarded ? today : null);
    if (el) out.bottom = Math.max(0, H - el.getBoundingClientRect().top);
  } else {
    if (!onb.hidden) out.left = onb.getBoundingClientRect().right;
    else if (S.onboarded && !(ui.sheet && W <= 1180)) out.left = today.getBoundingClientRect().right;
    if (side) out.right = W - side.getBoundingClientRect().left;
  }
  world.setInsets(out);
}

// ------------------------------------------------------------------ Nimbus: mood + speech
function baseMood() {
  if (!S.onboarded) return 'happy';
  const t = R.today(S), h = new Date().getHours();
  if (t.clearSky) return 'happy';
  if (h >= 23 || h < 5) return 'sleepy';
  if (t.done === 0 && R.PLANETS.some((p) => R.planetStatus(S, p.id) === 'risk')) return 'worried';
  return 'happy';
}
function mood() { world?.anim.setMood(baseMood()); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function line() {
  if (!S.onboarded) return 'Hi! I’m Nimbus.';
  const t = R.today(S);
  if (!t.planets.length) return 'Wake a planet and give it one small task. I’ll help it grow.';
  if (!t.scheduled) return 'Nothing scheduled today. A rest day for all of us.';
  if (t.clearSky) return pick(['Clear skies! Every planet is tended.', 'All done for today. I’m so proud of you.', 'Look how they glow. See you tomorrow!']);
  const risk = t.planets.find((p) => !p.tended && R.planetStatus(S, p.id) === 'risk');
  if (risk) return `${def(risk.id).name} missed yesterday. Tend it today so it doesn’t start to wilt.`;
  const close = t.planets.find((p) => !p.tended && p.scheduled - p.done === 1);
  if (t.done === 0) {
    const first = t.planets.find((p) => p.scheduled)?.tasks[0];
    return `${plural(t.scheduled, 'small thing')} today. How about “${first.title}” first?`;
  }
  if (close) return `One more and ${def(close.id).name} is tended.`;
  return `${t.done} done, ${t.scheduled - t.done} to go. Nice and steady.`;
}
let bubbleT = 0;
function say(text, ms = 4200) {
  const b = $('bubble');
  b.textContent = text;
  b.classList.add('on');
  clearTimeout(bubbleT);
  bubbleT = setTimeout(() => b.classList.remove('on'), ms);
}

// ------------------------------------------------------------------ top bar
function renderTop() {
  $('brand').innerHTML = `${MARK}<b>Nimbus</b>`;
  $('wardrobeBtn').innerHTML = icon('hanger');
  $('menuBtn').innerHTML = icon('more');
  renderDust(false);
  const n = S.streak.count + (R.today(S).done > 0 ? 1 : 0);
  $('streakPill').className = `pill streak${n ? '' : ' cold'}`;
  $('streakPill').innerHTML = `${icon('sun')}<span class="num">${n}</span><small>day streak</small>`;
  $('streakPill').title = n ? `${plural(n, 'day')} in a row with at least one task done. Best: ${Math.max(S.streak.best, n)}.` : 'Finish any task today to start a streak.';
}
let dustAnim = 0;
function renderDust(animate = true) {
  const el = $('dustBtn'), from = ui.shownDust, to = S.stardust;
  ui.shownDust = to;
  const paint = (v) => { el.innerHTML = `${icon('dust')}<span class="num">${Math.round(v)}</span><span class="sr">stardust</span>`; };
  cancelAnimationFrame(dustAnim);
  if (!animate || from === to || reduced) { paint(to); return; }
  const t0 = performance.now();
  const f = (t) => { const k = Math.min(1, (t - t0) / 450); paint(from + (to - from) * (1 - (1 - k) ** 3)); if (k < 1) dustAnim = requestAnimationFrame(f); };
  dustAnim = requestAnimationFrame(f);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
// a little star flies from where you earned it to the stardust counter
function fly(fromEl, n = 1) {
  if (reduced || !fromEl) { renderDust(); return; }
  const a = fromEl.getBoundingClientRect(), b = $('dustBtn').getBoundingClientRect();
  const x0 = a.left + a.width / 2 - 9, y0 = a.top + a.height / 2 - 9, x1 = b.left + 22, y1 = b.top + b.height / 2 - 9;
  let landed = 0;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'fly'; s.innerHTML = icon('dust');
    document.body.appendChild(s);
    const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * 120, my = Math.min(y0, y1) - 60 - Math.random() * 60;
    const anim = s.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 14}px) scale(1.25)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x1}px, ${y1}px) scale(.7)`, opacity: 0.9 },
    ], { duration: 820 + i * 90, easing: 'cubic-bezier(.45,0,.25,1)', delay: i * 70 });
    anim.onfinish = () => { s.remove(); if (++landed === n) renderDust(); };
  }
}

// ------------------------------------------------------------------ today
let todaySig = '';
function renderToday() {
  const el = $('today'), t = R.today(S);
  const sig = JSON.stringify([S.today, t.planets.map((p) => [p.id, p.tasks.map((x) => x.id)]), R.PLANETS.filter((p) => !S.planets[p.id].awake).map((p) => p.id)]);
  const all = t.planets.flatMap((p) => p.tasks.map((task) => ({ pid: p.id, task })));
  if (sig !== todaySig) {
    todaySig = sig;
    const asleep = R.PLANETS.filter((p) => !S.planets[p.id].awake);
    el.innerHTML = `<button class="grab" aria-label="Expand today"></button>
      <div class="sheet-head">
        <div class="title-row"><div><h2>Today</h2><p class="sub">${dateLine(S.today)}</p></div>
          <div class="today-count" aria-live="polite"><span class="num" data-count></span><small>done</small></div></div>
        <div class="strip" aria-hidden="true">${all.map((a) => `<i data-seg="${a.task.id}" style="--c:${color(a.pid)}"></i>`).join('')}</div>
      </div>
      <div class="sheet-body">
        ${t.planets.length ? t.planets.map((p) => `<section class="group" style="--c:${color(p.id)}" data-group="${p.id}">
          <button class="group-head" data-open="${p.id}">${orb(p.id)}<span class="group-name"><b>${def(p.id).name}</b><small data-stage></small></span><span data-chip></span></button>
          ${p.tasks.length ? `<ul class="tasks">${p.tasks.map((task) => `<li><button class="task" data-task="${task.id}" data-planet="${p.id}" aria-pressed="false">
            <span class="box">${icon('check')}</span><span class="t">${esc(task.title)}</span><span class="rw">+${R.REWARD.task}${icon('dust')}</span></button></li>`).join('')}</ul>` : ''}
        </section>`).join('') : `<div class="empty"><h3>No planets awake</h3><p>Wake a planet and give it one small daily task to begin.</p>
          <button class="btn primary" data-open="${asleep[0]?.id || 'ocean'}">${icon('plus')}Wake a planet</button></div>`}
        ${t.planets.length && !t.scheduled ? '<div class="empty"><h3>A quiet day</h3><p>Nothing is scheduled today. Your planets rest without losing anything.</p></div>' : ''}
        ${asleep.length && t.planets.length ? `<button class="sleepers" data-open="${asleep[0].id}"><span class="stack">${asleep.slice(0, 4).map((p) => orb(p.id, 'sm asleep')).join('')}</span>
          <span>${plural(asleep.length, 'planet')} still asleep. Wake one</span></button>` : ''}
      </div>`;
  }
  // patch state in place so checkbox and strip transitions run
  el.querySelector('[data-count]').textContent = `${t.done}/${t.scheduled}`;
  for (const b of el.querySelectorAll('.task')) {
    const on = R.isDone(S, b.dataset.task);
    b.classList.toggle('done', on); b.setAttribute('aria-pressed', on);
    el.querySelector(`[data-seg="${b.dataset.task}"]`)?.classList.toggle('on', on);
  }
  for (const g of el.querySelectorAll('[data-group]')) {
    const pid = g.dataset.group, st = R.planetStatus(S, pid), d = R.planetDay(S, pid);
    g.querySelector('[data-stage]').textContent = stageLine(pid);
    g.querySelector('[data-chip]').outerHTML = `<span data-chip class="chip ${st === 'tended' ? 'ok' : st === 'risk' ? 'risk' : st === 'rest' ? 'rest' : ''}">${
      st === 'tended' ? `${icon('check')}Tended` : st === 'risk' ? `${icon('alert')}At risk` : st === 'rest' ? 'Rest day' : `${d.done}/${d.scheduled}`}</span>`;
  }
  el.classList.toggle('expanded', ui.expanded);
}
function onTask(btn) {
  const pid = btn.dataset.planet, tid = btn.dataset.task, was = R.isDone(S, tid);
  const events = R.toggleTask(S, pid, tid);
  save();
  renderToday(); renderTopQuiet(); sync(); mood();
  if (ui.sheet === 'planet' && ui.planet === pid) renderPlanet();
  if (was) { renderDust(); return; }
  fly(btn.querySelector('.box'), 1);
  const seg = $('today').querySelector(`[data-seg="${tid}"]`);
  seg?.classList.add('pop'); setTimeout(() => seg?.classList.remove('pop'), 300);
  react(events, pid);
}
function renderTopQuiet() { const d = ui.shownDust; renderTop(); ui.shownDust = d; $('dustBtn').innerHTML = `${icon('dust')}<span class="num">${d}</span><span class="sr">stardust</span>`; }
function react(events, pid) {
  const A = world?.anim;
  let big = false;
  for (const e of events) {
    if (e.type === 'stage') {
      big = true;
      toast({ pid: e.planet, text: `${def(e.planet).name} grew to ${R.STAGES[e.stage].name}! New decor unlocked`, amount: e.amount, big: true });
      world?.celebrate('confetti', e.planet);
    }
  }
  for (const e of events) {
    if (e.type === 'tended') {
      toast({ pid: e.planet, text: `${def(e.planet).name} is tended`, amount: R.REWARD.tended });
      world?.celebrate('sparkle', e.planet);
    }
    if (e.type === 'clearSky') {
      big = true;
      setTimeout(() => { toast({ ic: 'sun', text: 'Clear skies! Everything done today', amount: R.REWARD.clearSky, big: true }); say(line()); }, 500);
    }
  }
  if (big) A?.play('celebrateSpin');
  else if (events.some((e) => e.type === 'tended')) A?.play('happyWiggle');
  else A?.play('hop');
  if (events.some((e) => e.type === 'stardust')) setTimeout(() => world && !big && Math.random() < 0.35 && say(line(), 3000), 900);
  void pid;
}

// ------------------------------------------------------------------ toasts
function toast({ pid, ic, text, amount, big }) {
  const t = document.createElement('div');
  t.className = `toast${big ? ' big' : ''}`;
  t.innerHTML = `${pid ? orb(pid) : `<span class="ti">${icon(ic || 'check')}</span>`}<span>${esc(text)}</span>${amount ? `<span class="amt">+${amount}${icon('dust')}</span>` : ''}`;
  $('toasts').appendChild(t);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => t.classList.add('out'), big ? 3800 : 2600);
  setTimeout(() => t.remove(), big ? 4300 : 3100);
}

// ------------------------------------------------------------------ planet sheet
function openPlanet(pid) {
  if (ui.sheet === 'planet' && ui.planet === pid) return;
  ui.sheet = 'planet'; ui.planet = pid; ui.tab = 'tasks'; ui.placing = null; ui.adding = !S.planets[pid].tasks.length; ui.editing = null; ui.tryOn = null;
  $('shopSheet').hidden = true;
  $('planetSheet').hidden = false;
  document.body.classList.add('sheet-open');
  renderPlanet(); sync(); camera(); setHandlers();
  $('planetSheet').querySelector('.close')?.focus({ preventScroll: true });
}
function closeSheet() {
  if (!ui.sheet) return;
  ui.sheet = null; ui.placing = null; ui.tryOn = null;
  $('planetSheet').hidden = true; $('shopSheet').hidden = true;
  document.body.classList.remove('sheet-open');
  sync(); camera(); setHandlers(); mood();
}
function dayPicker(days, name) {
  return `<div class="days" role="group" aria-label="Repeat on">${WEEK.map((d) => `<button type="button" data-day="${d}" data-for="${name}" aria-pressed="${days.includes(d)}" aria-label="${DAY_NAME[d]}">${DAY_SHORT[d]}</button>`).join('')}</div>`;
}
function taskForm(pid, { id = 'new', title = '', days = R.EVERY_DAY, submit = 'Add task' } = {}) {
  return `<form class="form" data-form="${id}" data-planet="${pid}">
    <input class="field" name="task" maxlength="60" placeholder="A small, specific task" value="${esc(title)}" autocomplete="off" aria-label="Task name" required>
    ${dayPicker(days, id)}
    <p class="err" role="alert"></p>
    <div class="form-row"><span class="sub" style="margin:0;font-size:13px" data-sched>${scheduleText(days)}</span>
      <span style="display:flex;gap:6px">${id !== 'new' || S.planets[pid].tasks.length ? '<button type="button" class="btn ghost" data-cancel>Cancel</button>' : ''}<button class="btn primary" type="submit">${submit}</button></span></div>
  </form>`;
}
function renderPlanet() {
  const pid = ui.planet, P = S.planets[pid], D = def(pid), el = $('planetSheet');
  const st = R.planetStatus(S, pid), g = R.growthNow(S, pid), stage = R.stageOf(g), d = R.planetDay(S, pid);
  const head = `<button class="grab" aria-hidden="true" tabindex="-1"></button><div class="sheet-head" style="--c:${D.color}">
    <div class="title-row"><div class="planet-head">${orb(pid, `lg${P.awake ? '' : ' asleep'}`)}<div class="grow"><h2>${D.name}</h2><p class="sub">${D.area}</p></div></div>
      <button class="close" data-close aria-label="Close">${icon('close')}</button></div>`;
  if (!P.awake) {
    const used = P.tasks.map((x) => x.title.toLowerCase());
    el.innerHTML = `${head}<p class="sub" style="margin:0">${D.blurb}</p></div>
      <div class="sheet-body" style="--c:${D.color}"><div class="section">
        ${P.tasks.length ? `<div class="note">${icon('moon')}<span>${D.name} is asleep with ${plural(P.tasks.length, 'task')} paused. It kept its growth: ${stageLine(pid)}.</span></div>
          <button class="btn primary wide" data-wake>Wake ${D.name}</button>` : `<h3>Give it a first task to wake it</h3>
          <div class="suggest">${D.suggest.map((s) => `<button type="button" data-suggest="${esc(s)}" class="${used.includes(s.toLowerCase()) ? 'added' : ''}">${icon('plus')}${esc(s)}</button>`).join('')}</div>
          ${taskForm(pid, { submit: `Wake ${D.name}` })}
          <div class="ob-tip">${icon('leaf')}<span>Pick something you can do even on a bad day. You can add more later, up to ${R.MAX_TASKS}.</span></div>`}
      </div></div>`;
    return;
  }
  const hist = R.history(S, pid, 7);
  const next = R.STAGES[stage + 1];
  const note = st === 'tended' ? `<div class="note ok">${icon('check')}<span>Tended today. This day counts toward its growth.</span></div>`
    : st === 'risk' ? `<div class="note risk">${icon('alert')}<span>Missed yesterday. Tend it today to keep its streak. A second miss in a row starts to wilt it.</span></div>`
    : st === 'rest' ? `<div class="note">${icon('moon')}<span>No tasks scheduled today. ${D.name} is resting and won’t lose anything.</span></div>`
    : `<div class="note">${icon('leaf')}<span>${d.done} of ${d.scheduled} done today. Finish them all to tend ${D.name}.</span></div>`;
  const decor = R.decorFor(pid);
  el.innerHTML = `${head}
      <div class="stages" aria-label="Growth: ${stageLine(pid)}">${R.STAGES.map((s, i) => {
        const nx = R.STAGES[i + 1], f = i < stage ? 100 : i > stage ? 0 : nx ? ((g - s.at) / (nx.at - s.at)) * 100 : 100;
        return `<div class="stage${i === stage ? ' now' : ''}"><i style="--f:${f}%"></i>${s.name}</div>`; }).join('')}</div>
    </div>
    <div class="sheet-body" style="--c:${D.color}">
      <div class="section" style="padding-top:2px">
        <div class="facts"><div class="fact"><span class="num">${R.streakNow(S, pid)}</span><small>day streak</small></div>
          <div class="fact"><span class="num">${g}</span><small>days grown</small></div>
          <div class="fact"><span class="num">${next ? next.at - g : '–'}</span><small>${next ? `to ${next.name}` : 'fully grown'}</small></div></div>
        ${note}
        <div class="week" aria-label="Last 7 days">${hist.map((h) => `<span class="h-${h.v}${h.today ? ' is-today' : ''}"><i title="${h.v}">${h.v === 'tended' ? icon('check') : h.v === 'cushion' ? icon('cloud') : ''}</i>${DAY_SHORT[R.weekday(h.key)]}</span>`).join('')}</div>
        <div class="tabs" role="tablist">${[['tasks', 'Tasks'], ['decor', 'Decorate']].map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${n}</button>`).join('')}</div>
      </div>
      ${ui.tab === 'tasks' ? `<div class="section">
        <ul class="rowlist">${P.tasks.map((x) => ui.editing === x.id ? `<li>${taskForm(pid, { id: x.id, title: x.title, days: x.days, submit: 'Save' })}</li>` : `<li class="trow">
          <div class="grow"><b>${esc(x.title)}</b><small>${scheduleText(x.days)}${R.isScheduled(x, S.today) ? (R.isDone(S, x.id) ? ' · done today' : '') : ' · not today'}</small></div>
          <button class="mini" data-edit="${x.id}" aria-label="Edit ${esc(x.title)}">${icon('edit')}</button>
          <button class="mini danger" data-del="${x.id}" aria-label="Delete ${esc(x.title)}">${icon('trash')}</button></li>`).join('')}</ul>
        ${P.tasks.length >= R.MAX_TASKS ? `<p class="sub">${D.name} holds ${R.MAX_TASKS} tasks, the most a planet can. Small and steady wins.</p>`
          : ui.adding ? taskForm(pid) : `<button class="btn soft wide" data-add>${icon('plus')}Add a task</button>`}
        <button class="btn ghost" data-sleep style="justify-self:start;margin-top:6px">${icon('moon')}Put ${D.name} to sleep</button>
      </div>` : `<div class="section">
        ${ui.placing ? `<div class="hint">${icon('leaf')}Tap ${D.name} to place the ${R.decorFor(pid).find((x) => x.id === ui.placing).name.toLowerCase()}</div>`
          : `<p class="sub" style="margin:0 4px">Decor unlocks as ${D.name} grows. Tap a placed piece to remove it.</p>`}
        <div class="decor">${decor.map((it) => { const locked = stage < it.stage; return `<button class="ditem" data-item="${it.id}" aria-pressed="${ui.placing === it.id}" ${locked ? 'disabled' : ''}>
          <img src="assets/planets/thumbs/${it.id}.jpg" alt="" loading="lazy">${it.name}${locked ? `<span class="lockb">${icon('lock')}${R.STAGES[it.stage].name}</span>` : ''}</button>`; }).join('')}</div>
      </div>`}
    </div>`;
}
function setHandlers() {
  if (!world) return;
  const placing = ui.sheet === 'planet' && ui.tab === 'decor';
  world.handlers.surface = placing && ui.placing ? (pid, pos) => {
    S.planets[pid].items.push({ id: ui.placing, ...pos });
    if (S.planets[pid].items.length > 8) S.planets[pid].items.shift();
    ui.placing = null; save(); sync(); renderPlanet(); setHandlers(); world.anim.play('happyWiggle');
  } : null;
  world.handlers.item = placing ? (pid, idx) => {
    if (ui.placing) return;
    const [it] = S.planets[pid].items.splice(idx, 1);
    save(); sync();
    toast({ ic: 'trash', text: `${R.decorFor(pid).find((x) => x.id === it.id)?.name || 'Decor'} removed` });
  } : null;
}
function submitForm(form) {
  const pid = form.dataset.planet, id = form.dataset.form;
  const title = form.elements.task.value;
  const days = [...form.querySelectorAll('[data-day][aria-pressed="true"]')].map((b) => Number(b.dataset.day));
  if (!days.length) { form.querySelector('.err').textContent = 'Pick at least one day.'; return; }
  const wasAwake = S.planets[pid].awake;
  const r = id === 'new' ? R.addTask(S, pid, title, days) : R.editTask(S, pid, id, { title, days });
  if (r.error) { form.querySelector('.err').textContent = r.error; form.elements.task.focus(); return; }
  ui.adding = false; ui.editing = null;
  save(); renderAll(); sync(); mood();
  if (!wasAwake) {
    toast({ pid, text: `${def(pid).name} is awake` });
    world?.celebrate('sparkle', pid); world?.anim.play('happyWiggle');
  }
  react(r.events || [], pid);
}

// ------------------------------------------------------------------ wardrobe
const SHOP_TABS = [['head', 'Hats'], ['neck', 'Neckwear'], ['finish', 'Finish'], ['supply', 'Supplies']];
function openShop() {
  ui.sheet = 'shop'; ui.tryOn = null; ui.placing = null;
  $('planetSheet').hidden = true; $('shopSheet').hidden = false;
  document.body.classList.add('sheet-open');
  renderShop(); camera(); setHandlers(); sync();
  world?.anim.setMood('happy');
  $('shopSheet').querySelector('.close')?.focus({ preventScroll: true });
}
function priceTag(it) {
  const c = R.canBuy(S, it.id);
  if (it.slot !== 'supply' && S.owned.includes(it.id)) return `<span class="price owned">${icon('check')}${Object.values(S.equipped).includes(it.id) ? 'Wearing' : 'Owned'}</span>`;
  if (c.locked) return `<span class="price locked">${icon('lock')}${c.why}</span>`;
  return `<span class="price">${icon('dust')}${it.price}</span>`;
}
function renderShop() {
  const el = $('shopSheet');
  const items = R.SHOP.filter((s) => s.slot === ui.shopTab);
  const sel = ui.tryOn && R.shopItem(ui.tryOn);
  let action = '';
  if (sel) {
    const c = R.canBuy(S, sel.id), owned = sel.slot !== 'supply' && S.owned.includes(sel.id), wearing = Object.values(S.equipped).includes(sel.id);
    const btn = owned ? (sel.slot === 'finish' ? (wearing ? '<button class="btn primary wide" disabled>Wearing</button>' : `<button class="btn primary wide" data-equip="${sel.id}">Wear ${sel.name}</button>`)
      : `<button class="btn ${wearing ? 'soft' : 'primary'} wide" data-equip="${sel.id}">${wearing ? 'Take off' : `Wear ${sel.name}`}</button>`)
      : c.ok ? `<button class="btn primary wide" data-buy="${sel.id}">Buy for ${sel.price}${icon('dust')}</button>`
      : `<button class="btn primary wide" disabled>${c.locked ? `${icon('lock')}${c.why}` : c.short ? `Need ${c.short} more stardust` : c.why}</button>`;
    action = `<div class="sheet-foot detail"><div class="title-row"><b>${sel.name}</b>${priceTag(sel)}</div><p>${sel.note}</p>${btn}</div>`;
  } else {
    action = `<div class="sheet-foot detail"><p>${ui.shopTab === 'supply' ? `You hold ${S.cushions} of ${R.MAX_CUSHIONS} cloud cushions. Each one saves a streak from a second missed day.`
      : 'Tap anything to try it on. Earn stardust by finishing tasks.'}</p></div>`;
  }
  el.innerHTML = `<button class="grab" aria-hidden="true" tabindex="-1"></button><div class="sheet-head">
      <div class="title-row"><div><h2>Wardrobe</h2><p class="sub">Dress Nimbus up with what you’ve earned.</p></div><button class="close" data-close aria-label="Close">${icon('close')}</button></div>
      <div class="balance">${icon('dust')}<span class="num">${S.stardust}</span><small>${plural(S.cushions, 'cushion')} held</small></div>
      <div class="tabs" role="tablist">${SHOP_TABS.map(([k, n]) => `<button role="tab" data-stab="${k}" aria-selected="${ui.shopTab === k}">${n}</button>`).join('')}</div>
    </div>
    <div class="sheet-body"><div class="shop-grid" style="padding-top:0">${items.map((it) => `<button class="sitem" data-try="${it.id}" aria-pressed="${ui.tryOn === it.id}">
      <span class="thumb">${it.slot === 'finish' ? `<span class="swatch" style="--c:${it.color}"></span>` : `<img alt="" data-thumb="${it.id}">`}</span>
      <b>${it.name}</b>${priceTag(it)}</button>`).join('')}</div></div>${action}`;
  // render thumbnails after paint (offscreen WebGL)
  requestAnimationFrame(() => { for (const img of el.querySelectorAll('[data-thumb]')) { try { img.src = thumbnail(img.dataset.thumb); } catch { /* no thumbnail */ } } });
}

// ------------------------------------------------------------------ dialogs: recap, rules, confirm
function dialog(html, onClose) {
  const d = $('dialog');
  d.innerHTML = html;
  d.onclose = () => onClose?.(d.returnValue);
  if (!d.open) d.showModal();
  d.querySelector('[autofocus]')?.focus();
}
const RULES = [
  ['gold', 'dust', 'Tick a task, earn stardust', `+${R.REWARD.task} for each task. Finish all of a planet’s tasks for +${R.REWARD.tended}, and everything for the day for +${R.REWARD.clearSky}.`],
  ['violet', 'leaf', 'Tended planets grow', `Each tended day counts. Planets grow from Seed to Sprout (3 days), Bloom (7) and Radiant (14), unlocking decor on the way.`],
  ['coral', 'alert', 'Never miss twice', 'One missed day only puts a planet at risk. Two in a row resets its streak and it starts to wilt.'],
  ['', 'cloud', 'Cloud cushions', `If a planet is about to miss twice, a cushion takes the hit. You start with one and earn another for every 7-day streak.`],
  ['', 'calendar', 'Your day ends at 3am', 'Late-night tasks count for the evening they belong to. Days with nothing scheduled are rest days.'],
];
const rulesList = () => `<ul class="rules">${RULES.map(([c, ic, t, p]) => `<li><span class="ri ${c}">${icon(ic)}</span><div><b>${t}</b><p>${p}</p></div></li>`).join('')}</ul>`;
function showRules() {
  dialog(`<form method="dialog" class="dlg"><div class="title-row"><h2>How Nimbus works</h2><button class="close" value="x" aria-label="Close">${icon('close')}</button></div>
    ${rulesList()}<div class="dlg-actions"><button class="btn primary" value="ok" autofocus>Got it</button></div></form>`);
}
const EVENT_TEXT = {
  atRisk: (e) => [`${def(e.planet).name} missed a day and is at risk. Tend it today.`, 'bad'],
  streakLost: (e) => [`${def(e.planet).name} lost its ${e.streak}-day streak.`, 'bad'],
  wilt: (e, n) => [e.shrank ? `${def(e.planet).name} wilted back to ${R.STAGES[e.stage].name}.` : `${def(e.planet).name} wilted a little${n > 1 ? ` (${n} days)` : ''}.`, 'bad'],
  cushionUsed: (e, n) => [`${n > 1 ? `${n} cloud cushions` : 'A cloud cushion'} covered ${def(e.planet).name}.`, 'good'],
  cushionEarned: (e) => [`${def(e.planet).name} kept a ${e.streak}-day streak. You earned a cloud cushion.`, 'good'],
  milestone: (e) => [`${def(e.planet).name}: ${e.streak} days in a row!`, 'good'],
};
function showRecap(r) {
  const groups = new Map();
  for (const e of r.events) { const k = `${e.type}:${e.planet}`; const g = groups.get(k); if (g) { g.n++; g.e = e; } else groups.set(k, { e, n: 1 }); }
  const items = [...groups.values()].map(({ e, n }) => { const [txt, cls] = EVENT_TEXT[e.type](e, n); return `<li class="${cls}">${orb(e.planet)}<span>${esc(txt)}</span></li>`; });
  const bad = r.events.some((e) => ['streakLost', 'wilt', 'atRisk'].includes(e.type));
  const lead = r.days > 1 ? `You were away for ${plural(r.days, 'day')}. Here’s what changed.` : r.clearSky ? 'Clear skies yesterday: every task done.' : r.scheduled ? 'Here’s how yesterday went.' : 'Yesterday was a rest day.';
  dialog(`<form method="dialog" class="dlg"><div><h2>${r.days > 1 ? 'Welcome back' : 'Good morning'}</h2><p class="lead">${lead}</p></div>
    <div class="facts recap-stats"><div class="fact"><span class="num">${r.done}/${r.scheduled}</span><small>tasks done</small></div>
      <div class="fact"><span class="num">+${r.earned}</span><small>stardust</small></div>
      <div class="fact"><span class="num">${S.streak.count}</span><small>day streak</small></div></div>
    ${items.length ? `<ul class="events">${items.join('')}</ul>` : ''}
    <div class="dlg-actions"><button class="btn primary wide" value="ok" autofocus>Start today</button></div></form>`, () => {
    S.recap = null; save();
    world?.anim.play(bad ? 'sadSigh' : 'happyWiggle');
    setTimeout(() => say(line()), 1200);
  });
}
function confirmReset() {
  dialog(`<form method="dialog" class="dlg"><div><h2>Start over?</h2><p class="lead">This clears every planet, task, stardust and outfit. It can’t be undone.</p></div>
    <div class="dlg-actions"><button class="btn ghost" value="no" autofocus>Keep my world</button><button class="btn primary" value="yes" style="background:var(--coral)">Reset everything</button></div></form>`, (v) => {
    if (v !== 'yes') return;
    try { localStorage.removeItem(STORE); localStorage.removeItem(OFFSET); } catch { /* ignore */ }
    location.href = location.pathname;
  });
}

// ------------------------------------------------------------------ menu
function renderMenu() {
  $('menu').innerHTML = `
    <button role="menuitem" data-m="rules">${icon('book')}How Nimbus works</button>
    <button role="menuitem" data-m="wardrobe">${icon('hanger')}Wardrobe</button>
    <button role="menuitem" data-m="intro">${icon('replay')}Replay the welcome</button>
    <hr><div class="label">Try it out</div>
    <button role="menuitem" data-m="skip">${icon('forward')}Skip to tomorrow</button>
    <button role="menuitem" data-m="reset" class="danger">${icon('trash')}Reset everything</button>`;
}
function toggleMenu(open = $('menu').hidden) {
  $('menu').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', open);
  if (open) $('menu').querySelector('button').focus();
}
function skipDay() {
  offset++;
  if (!MEMORY_ONLY) try { localStorage.setItem(OFFSET, offset); } catch { /* ignore */ }
  checkDay();
}
function checkDay() {
  const k = clock();
  if (k === S.today || !S.onboarded) { if (!S.onboarded) S.today = k; return; }
  const r = R.rollover(S, k);
  save(); todaySig = ''; renderAll(); sync(); mood();
  if (r) showRecap(r);
}

// ------------------------------------------------------------------ onboarding
function startOnboarding(replay = false) {
  closeSheet();
  ob.step = 0; ob.idx = 0; ob.picks = replay ? R.PLANETS.filter((p) => S.planets[p.id].awake).map((p) => p.id) : []; ob.tasks = {};
  if (replay) { S._replay = true; }
  document.body.classList.add('onboarding');
  $('onboard').hidden = false;
  renderOnboarding();
}
function obGo(step) {
  ob.step = step;
  renderOnboarding();
}
function renderOnboarding() {
  const el = $('onboard');
  const dots = (n) => `<div class="dots" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>`;
  const back = `<button class="btn ghost" data-ob="back">${icon('back')}Back</button>`;
  el.classList.toggle('tall', ob.step === 1 || ob.step === 2);
  const replay = S._replay;
  if (ob.step === 0) {
    el.innerHTML = `<div class="ob-step"><div class="ob-head"><h2>Hi, I’m Nimbus</h2>
      <p>Every planet out here is one part of your life. Give each a few small daily tasks, and it grows as you keep them.</p></div>
      <div class="ob-body"><div class="ob-tip">${icon('leaf')}<span>Setting up takes about a minute: pick a few planets, then give each one a task or two.</span></div></div>
      <div class="ob-foot">${replay ? `<button class="btn ghost" data-ob="close">Close</button>` : `<button class="btn ghost" data-ob="examples">Use examples</button>`}<button class="btn primary" data-ob="next" autofocus>Let’s begin${icon('next')}</button></div></div>`;
  } else if (ob.step === 1) {
    el.innerHTML = `<div class="ob-step"><div class="ob-head">${dots(1)}<h2>What do you want to tend?</h2>
      <p>Pick the planets you’ll look after. Two or three is a great start; the rest can wait, asleep.</p></div>
      <div class="ob-body"><div class="pick">${R.PLANETS.map((p) => `<button class="pcard" data-pick="${p.id}" style="--c:${p.color}" aria-pressed="${ob.picks.includes(p.id)}">
        ${orb(p.id)}<span><b>${p.name}</b><small>${p.area}</small></span><span class="tick">${icon('check')}</span></button>`).join('')}</div></div>
      <div class="ob-foot">${back}<button class="btn primary" data-ob="next" ${ob.picks.length ? '' : 'disabled'}>${ob.picks.length ? `Continue with ${plural(ob.picks.length, 'planet')}` : 'Pick at least one'}</button></div></div>`;
  } else if (ob.step === 2) {
    const pid = ob.picks[ob.idx], D = def(pid), list = ob.tasks[pid] ||= [];
    const existing = S.planets[pid].tasks;
    const titles = [...existing, ...list].map((t) => t.title.toLowerCase());
    el.innerHTML = `<div class="ob-step"><div class="ob-head">${dots(2)}
      <div class="ob-planet">${orb(pid, 'lg')}<div><h2>${D.name}</h2><small>${D.area} · planet ${ob.idx + 1} of ${ob.picks.length}</small></div></div>
      <p>What small thing will you do for it each day? Tap a suggestion or write your own.</p></div>
      <div class="ob-body" style="--c:${D.color}"><div class="section" style="padding-top:0">
        <div class="suggest">${D.suggest.map((s) => `<button type="button" data-obs="${esc(s)}" class="${titles.includes(s.toLowerCase()) ? 'added' : ''}" aria-pressed="${titles.includes(s.toLowerCase())}">${icon(titles.includes(s.toLowerCase()) ? 'check' : 'plus')}${esc(s)}</button>`).join('')}</div>
        <form class="form" data-obform style="grid-template-columns:1fr auto;align-items:center">
          <input class="field" name="task" maxlength="60" placeholder="Or write your own" autocomplete="off" aria-label="Your own task">
          <button class="btn soft" type="submit">${icon('plus')}Add</button><p class="err" role="alert" style="grid-column:1/-1"></p></form>
        ${[...existing, ...list].length ? `<ul class="added">${existing.map((t) => `<li class="trow"><div class="grow"><b>${esc(t.title)}</b><small>${scheduleText(t.days)}</small></div></li>`).join('')}${list.map((t, i) => `<li class="trow"><div class="grow"><b>${esc(t.title)}</b><small>Every day</small></div>
          <button class="mini danger" data-obdel="${i}" aria-label="Remove ${esc(t.title)}">${icon('close')}</button></li>`).join('')}</ul>` : ''}
        <p class="sub" style="margin:2px 4px 0;font-size:13px">Tasks repeat every day. You can pick weekdays later from the planet.</p>
      </div></div>
      <div class="ob-foot">${back}<button class="btn primary" data-ob="next" ${[...existing, ...list].length ? '' : 'disabled'}>${ob.idx < ob.picks.length - 1 ? `Next: ${def(ob.picks[ob.idx + 1]).name}` : 'Continue'}${icon('next')}</button></div></div>`;
  } else {
    el.innerHTML = `<div class="ob-step"><div class="ob-head">${dots(3)}<h2>How your planets grow</h2></div>
      <div class="ob-body">${rulesList()}
        ${replay ? '' : `<div class="gift">${icon('dust')}<div><b>${R.WELCOME_GIFT} stardust</b><small>A welcome gift. Spend it on Nimbus in the wardrobe.</small></div></div>`}</div>
      <div class="ob-foot">${back}<button class="btn primary" data-ob="finish" autofocus>${replay ? 'Back to my planets' : 'Start my first day'}</button></div></div>`;
  }
  sync(); camera();
  requestAnimationFrame(insets);
  if (world && ob.step === 0) setTimeout(() => { world.anim.play('happyWiggle'); say('Hi! I’m Nimbus.', 3000); }, 700);
}
function obAction(a) {
  if (a === 'back') {
    if (ob.step === 2 && ob.idx > 0) { ob.idx--; renderOnboarding(); return; }
    if (ob.step === 3) { ob.idx = Math.max(0, ob.picks.length - 1); obGo(S._replay ? 0 : 2); return; }
    obGo(ob.step - 1); return;
  }
  if (a === 'close') { finishOnboarding(); return; }
  if (a === 'examples') {
    ob.picks = ['ocean', 'moon', 'meadow'];
    ob.tasks = { ocean: [{ title: 'Drink 8 glasses of water' }], moon: [{ title: 'Lights out by 23:00' }], meadow: [{ title: 'Walk for 20 minutes' }] };
    obGo(3); return;
  }
  if (a === 'next') {
    if (S._replay && ob.step === 0) { obGo(3); return; }
    if (ob.step === 2 && ob.idx < ob.picks.length - 1) { ob.idx++; renderOnboarding(); return; }
    if (ob.step === 1) ob.idx = 0;
    obGo(ob.step + 1); return;
  }
  if (a === 'finish') finishOnboarding();
}
function finishOnboarding() {
  const first = !S.onboarded;
  if (first) { R.setup(S, Object.fromEntries(ob.picks.map((p) => [p, ob.tasks[p] || []]))); S.today = clock(); }
  delete S._replay;
  save();
  $('onboard').hidden = true;
  document.body.classList.remove('onboarding');
  todaySig = ''; renderAll(); sync(); camera(); mood();
  if (first && world) {
    setTimeout(() => { world.anim.play('celebrateSpin'); }, 400);
    setTimeout(() => say(line(), 5200), 1600);
  }
}

// ------------------------------------------------------------------ planet labels (follow the 3D planets)
function buildLabels() {
  $('labels').innerHTML = R.PLANETS.map((p) => `<button class="plabel" data-open="${p.id}" data-label="${p.id}"></button>`).join('');
}
function renderLabels() {
  for (const b of $('labels').children) {
    const pid = b.dataset.label, P = S.planets[pid], st = R.planetStatus(S, pid), d = R.planetDay(S, pid);
    b.className = `plabel${P.awake ? '' : ' asleep'}`;
    b.innerHTML = `${orb(pid)}${def(pid).name}${!P.awake ? '<span class="prog">asleep</span>' : st === 'tended' ? `<span class="ok">${icon('check')}</span>`
      : st === 'risk' ? `<span class="riskc">${icon('alert')}</span>` : st === 'rest' ? '<span class="prog">rest</span>' : `<span class="prog">${d.done}/${d.scheduled}</span>`}`;
    b.setAttribute('aria-label', `${def(pid).name}: ${P.awake ? st : 'asleep'}`);
  }
}
function frame() {
  if (world) {
    const L = $('labels');
    L.classList.toggle('hide', world.mode !== 'overview' || !S.onboarded && ob.step !== 1);
    for (const b of L.children) {
      const a = world.anchor(b.dataset.label);
      b.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    const n = world.anchor('nimbus');
    $('bubble').style.left = `${n.x}px`; $('bubble').style.top = `${n.y}px`;
  }
  requestAnimationFrame(frame);
}

function renderAll() {
  renderTop(); renderToday(); renderLabels();
  if (ui.sheet === 'planet') renderPlanet();
  if (ui.sheet === 'shop') renderShop();
}

// ------------------------------------------------------------------ events
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-open]');
  if (!t) { if (!$('menu').hidden && !e.target.closest('#menu')) toggleMenu(false); return; }
  if (!$('menu').hidden && !t.closest('#menu') && t.id !== 'menuBtn') toggleMenu(false);
  const d = t.dataset;
  if (t.classList.contains('task')) return onTask(t);
  if (d.open) { if (!S.onboarded) return; openPlanet(d.open); return; }
  if (d.close !== undefined) return closeSheet();
  if (t.classList.contains('grab') && t.closest('#today')) { ui.expanded = !ui.expanded; renderToday(); setTimeout(insets, 460); return; }
  if (t.id === 'menuBtn') return toggleMenu();
  if (t.id === 'wardrobeBtn' || t.id === 'dustBtn') return ui.sheet === 'shop' ? closeSheet() : openShop();
  if (d.m) {
    toggleMenu(false);
    if (d.m === 'rules') showRules();
    if (d.m === 'wardrobe') openShop();
    if (d.m === 'intro') startOnboarding(true);
    if (d.m === 'skip') skipDay();
    if (d.m === 'reset') confirmReset();
    return;
  }
  // planet sheet
  if (d.tab) { ui.tab = d.tab; ui.placing = null; renderPlanet(); setHandlers(); return; }
  if (d.add !== undefined) { ui.adding = true; renderPlanet(); $('planetSheet').querySelector('[data-form="new"] .field')?.focus(); return; }
  if (d.cancel !== undefined) { ui.adding = false; ui.editing = null; renderPlanet(); return; }
  if (d.edit) { ui.editing = d.edit; ui.adding = false; renderPlanet(); $('planetSheet').querySelector(`[data-form="${d.edit}"] .field`)?.focus(); return; }
  if (d.del) {
    const P = S.planets[ui.planet], task = P.tasks.find((x) => x.id === d.del);
    if (t.dataset.armed) {
      R.removeTask(S, ui.planet, d.del); save(); todaySig = ''; renderAll(); sync(); renderDust();
      if (!P.tasks.length) toast({ pid: ui.planet, text: `${def(ui.planet).name} has no tasks left. Add one or put it to sleep.` });
      return;
    }
    t.dataset.armed = '1'; t.innerHTML = icon('check'); t.setAttribute('aria-label', `Confirm delete ${task.title}`); t.style.color = 'var(--coral)';
    setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.innerHTML = icon('trash'); t.style.color = ''; } }, 2500);
    return;
  }
  if (d.day !== undefined) {
    t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true');
    const f = t.closest('form'), days = [...f.querySelectorAll('[data-day][aria-pressed="true"]')].map((b) => Number(b.dataset.day));
    f.querySelector('[data-sched]').textContent = days.length ? scheduleText(days) : 'No days picked';
    return;
  }
  if (d.suggest) { const f = $('planetSheet').querySelector('[data-form="new"]'); f.elements.task.value = d.suggest; f.elements.task.focus(); return; }
  if (d.wake !== undefined) { R.setAwake(S, ui.planet, true); save(); todaySig = ''; renderAll(); sync(); world?.celebrate('sparkle', ui.planet); world?.anim.play('happyWiggle'); toast({ pid: ui.planet, text: `${def(ui.planet).name} is awake` }); return; }
  if (d.sleep !== undefined) {
    if (!t.dataset.armed) { t.dataset.armed = '1'; t.innerHTML = `${icon('moon')}Tap again: tasks pause, growth is kept`; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.innerHTML = `${icon('moon')}Put ${def(ui.planet).name} to sleep`; } }, 3000); return; }
    R.setAwake(S, ui.planet, false); save(); todaySig = ''; renderAll(); sync(); world?.anim.play('sleepyNod'); return;
  }
  if (d.item) { ui.placing = ui.placing === d.item ? null : d.item; renderPlanet(); setHandlers(); if (ui.placing && mobile()) say(`Tap ${def(ui.planet).name} to place it.`, 2500); return; }
  // wardrobe
  if (d.stab) { ui.shopTab = d.stab; ui.tryOn = null; renderShop(); sync(); return; }
  if (d.try) {
    ui.tryOn = ui.tryOn === d.try ? null : d.try; renderShop(); sync();
    if (ui.tryOn && R.shopItem(ui.tryOn).slot !== 'supply') world?.anim.play('happyWiggle');
    return;
  }
  if (d.buy) {
    const r = R.buy(S, d.buy);
    if (!r.ok) return;
    save(); renderDust(); renderShop(); sync();
    world?.anim.play('loveSway'); world?.celebrate('hearts');
    toast({ ic: d.buy === 'cushion' ? 'cloud' : 'hanger', text: d.buy === 'cushion' ? `Cloud cushion added. You hold ${S.cushions}.` : `${R.shopItem(d.buy).name} is yours` });
    return;
  }
  if (d.equip) { R.equip(S, d.equip); save(); renderShop(); sync(); world?.anim.play('hop'); return; }
  // onboarding
  if (d.ob) return obAction(d.ob);
  if (d.pick) {
    const i = ob.picks.indexOf(d.pick);
    if (i >= 0) ob.picks.splice(i, 1); else { ob.picks.push(d.pick); world?.celebrate('sparkle', d.pick); }
    renderOnboarding(); return;
  }
  if (d.obs) {
    const pid = ob.picks[ob.idx], list = ob.tasks[pid] ||= [];
    const i = list.findIndex((x) => x.title.toLowerCase() === d.obs.toLowerCase());
    if (i >= 0) list.splice(i, 1);
    else if (list.length + S.planets[pid].tasks.length < R.MAX_TASKS && !S.planets[pid].tasks.some((x) => x.title.toLowerCase() === d.obs.toLowerCase())) list.push({ title: d.obs });
    renderOnboarding(); return;
  }
  if (d.obdel !== undefined) { ob.tasks[ob.picks[ob.idx]].splice(Number(d.obdel), 1); renderOnboarding(); return; }
});
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.method === 'dialog') return;
  e.preventDefault();
  if (f.dataset.obform !== undefined) {
    const pid = ob.picks[ob.idx], list = ob.tasks[pid] ||= [], v = f.elements.task.value.replace(/\s+/g, ' ').trim();
    const err = !v ? 'Write a task first.' : list.length + S.planets[pid].tasks.length >= R.MAX_TASKS ? `Up to ${R.MAX_TASKS} tasks per planet.`
      : [...list, ...S.planets[pid].tasks].some((x) => x.title.toLowerCase() === v.toLowerCase()) ? 'Already added.' : '';
    if (err) { f.querySelector('.err').textContent = err; return; }
    list.push({ title: v.slice(0, 60) });
    renderOnboarding();
    $('onboard').querySelector('[data-obform] .field')?.focus();
    return;
  }
  if (f.dataset.form) submitForm(f);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('dialog').open) return;
  if (!$('menu').hidden) { toggleMenu(false); $('menuBtn').focus(); return; }
  if (ui.placing) { ui.placing = null; renderPlanet(); setHandlers(); return; }
  if (ui.sheet) closeSheet();
});
// mobile: drag the today sheet's handle up/down
{
  let y0 = null;
  $('today').addEventListener('pointerdown', (e) => { if (e.target.closest('.grab, .sheet-head')) y0 = e.clientY; });
  addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null;
    if (Math.abs(dy) < 24) return;
    ui.expanded = dy < 0; renderToday(); setTimeout(insets, 460);
  });
}
addEventListener('resize', () => requestAnimationFrame(insets));
setInterval(checkDay, 30e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

// ------------------------------------------------------------------ boot
const LOADING = { sky: 'Painting the sky', planets: 'Waking the planets', home: 'Tidying Nimbus’s home', nimbus: 'Fluffing up Nimbus', ready: 'Almost there' };
async function boot() {
  renderTop(); renderMenu(); buildLabels();
  if (!S.onboarded) S.today = clock();
  const fill = $('splashFill'), text = $('splashText');
  try {
    world = await createWorld({ canvas: $('scene'), onProgress: (k, what) => { fill.style.width = `${Math.round(k * 100)}%`; if (LOADING[what]) text.textContent = LOADING[what]; } });
  } catch (err) {
    console.error(err);
    const gl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
    text.textContent = gl ? 'Something went wrong while loading the planets.' : 'Nimbus needs WebGL to draw its planets. Try turning on hardware acceleration, or another browser.';
    fill.parentElement.hidden = true;
    const b = document.createElement('button'); b.className = 'btn light'; b.textContent = 'Try again'; b.onclick = () => location.reload();
    text.after(b);
    document.title = 'error';
    return;
  }
  world.handlers.planet = (pid) => { if (S.onboarded) openPlanet(pid); };
  world.handlers.empty = () => { if (ui.placing) { ui.placing = null; renderPlanet(); setHandlers(); } else if (ui.sheet) closeSheet(); };
  world.handlers.mascot = () => { world.anim.play('tap'); say(line()); };
  if (S.onboarded) { const r = R.rollover(S, clock()); if (r) save(); }
  renderAll(); sync(); mood();
  world.start();
  $('splash').classList.add('done');
  document.body.classList.remove('booting');
  if (!S.onboarded) startOnboarding();
  else {
    camera();
    if (S.recap) setTimeout(() => showRecap(S.recap), 1400);
    else setTimeout(() => say(line()), 2200);
  }
  setTimeout(insets, 50); setTimeout(insets, 800);
  requestAnimationFrame(frame);
  // warm the cache for decor models in the background
  setTimeout(() => world.preload(Object.values(R.DECOR).flat().concat(R.SHARED_DECOR).map((x) => x.id)), 4000);
  window.__app.ready = true;
}
window.__app = { get state() { return S; }, get world() { return world; }, R, ui, ob, checkDay, skipDay, ready: false };
boot();
