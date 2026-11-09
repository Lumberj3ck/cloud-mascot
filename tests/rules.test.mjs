// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../site/js/rules.js';

const MON = '2026-11-09';   // a Monday
const start = () => {
  const s = R.freshState(MON);
  R.setup(s, { ocean: [{ title: 'Drink water' }, { title: 'Eat fruit' }], moon: [{ title: 'Lights out', days: [1, 3, 5] }] });
  return s;
};
const tick = (s, pid, i) => R.toggleTask(s, pid, s.planets[pid].tasks[i].id);

test('day keys roll over at 03:00 local', () => {
  assert.equal(R.dayKey(new Date(2026, 10, 10, 2, 30)), '2026-11-09');
  assert.equal(R.dayKey(new Date(2026, 10, 10, 3, 1)), '2026-11-10');
  assert.equal(R.weekday(MON), 1);
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.daysBetween('2026-11-09', '2026-11-12'), 3);
});

test('setup wakes picked planets only', () => {
  const s = start();
  assert.ok(s.onboarded);
  assert.ok(s.planets.ocean.awake && s.planets.moon.awake);
  assert.ok(!s.planets.book.awake);
  assert.equal(R.today(s).scheduled, 3);   // Monday: moon task is scheduled on Mon/Wed/Fri
});

test('stardust: task, tended planet, clear sky, refunds on untick', () => {
  const s = start(), base = s.stardust;
  tick(s, 'ocean', 0);
  assert.equal(s.stardust, base + 5);
  const ev = tick(s, 'ocean', 1);
  assert.equal(s.stardust, base + 5 + 5 + 5);
  assert.ok(ev.some((e) => e.type === 'tended' && e.planet === 'ocean'));
  const ev2 = tick(s, 'moon', 0);
  assert.ok(ev2.some((e) => e.type === 'clearSky'));
  assert.equal(s.stardust, base + 15 + 10 + 10);
  tick(s, 'moon', 0);
  assert.equal(s.stardust, base + 15);
  tick(s, 'ocean', 1);
  assert.equal(s.stardust, base + 5);
});

test('growth commits at rollover, stage reward pays once', () => {
  const s = start();
  let stageEvents = 0;
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 2; i++) for (const e of tick(s, 'ocean', i)) if (e.type === 'stage') stageEvents++;
    R.rollover(s, R.addDays(s.today, 1));
  }
  assert.equal(s.planets.ocean.growth, 3);
  assert.equal(R.stageNow(s, 'ocean'), 1);
  assert.equal(stageEvents, 1);
  assert.equal(s.planets.ocean.streak, 3);
});

test('never miss twice: risk, then streak loss and wilting; cushions cover misses', () => {
  const s = start();
  R.setAwake(s, 'moon', false);   // a sleeping planet is paused: it never misses
  s.cushions = 0;
  for (let d = 0; d < 8; d++) { tick(s, 'ocean', 0); tick(s, 'ocean', 1); R.rollover(s, R.addDays(s.today, 1)); }
  assert.equal(s.planets.ocean.growth, 8);
  assert.equal(s.cushions, 1, 'a 7-day streak earns a cushion');
  // first miss: at risk, streak kept, no cushion spent
  let r = R.rollover(s, R.addDays(s.today, 1));
  assert.ok(r.events.some((e) => e.type === 'atRisk' && e.planet === 'ocean'));
  assert.equal(s.cushions, 1);
  assert.equal(s.planets.ocean.streak, 8);
  // second miss: the cushion takes it, still at risk
  r = R.rollover(s, R.addDays(s.today, 1));
  assert.ok(r.events.some((e) => e.type === 'cushionUsed' && e.planet === 'ocean'));
  assert.equal(s.cushions, 0);
  assert.equal(s.planets.ocean.streak, 8);
  assert.equal(s.planets.ocean.growth, 8);
  // another miss with no cushion: streak lost, growth wilts by one and the planet shrinks back to sprout
  r = R.rollover(s, R.addDays(s.today, 1));
  assert.ok(r.events.some((e) => e.type === 'streakLost'));
  assert.equal(s.planets.ocean.streak, 0);
  assert.equal(s.planets.ocean.growth, 7);
  R.rollover(s, R.addDays(s.today, 1));
  assert.equal(R.stageOf(s.planets.ocean.growth), 1);
});

test('weekday tasks: unscheduled days are rest days', () => {
  const s = start();
  s.cushions = 0;
  R.rollover(s, R.addDays(s.today, 1));          // Mon closed: moon missed -> at risk
  assert.equal(s.planets.moon.misses, 1);
  const r = R.rollover(s, R.addDays(s.today, 1)); // Tue: moon has nothing scheduled -> no change
  assert.equal(s.planets.moon.misses, 1);
  assert.ok(!r.events.some((e) => e.planet === 'moon'));
  assert.equal(R.history(s, 'moon', 3).map((h) => h.v).join(), 'missed,rest,today');
});

test('long absence closes at most 30 days', () => {
  const s = start();
  const r = R.rollover(s, R.addDays(s.today, 400));
  assert.equal(r.days, 400);
  assert.equal(s.planets.ocean.growth, 0);
  assert.equal(s.today, R.addDays(MON, 400));
});

test('tasks: validation, limits, removal refunds', () => {
  const s = start();
  assert.ok(R.addTask(s, 'ocean', '   ').error);
  assert.ok(R.addTask(s, 'ocean', 'drink WATER').error);
  for (let i = 0; i < 3; i++) R.addTask(s, 'ocean', `Task ${i}`);
  assert.ok(R.addTask(s, 'ocean', 'one too many').error);
  const before = s.stardust;
  tick(s, 'ocean', 0);
  R.removeTask(s, 'ocean', s.planets.ocean.tasks[0].id);
  assert.equal(s.stardust, before);
});

test('shop: price, requirements, equip', () => {
  const s = start();
  assert.equal(s.stardust, R.WELCOME_GIFT);
  assert.ok(R.buy(s, 'head_sprout').ok);
  assert.equal(s.equipped.head, 'head_sprout');
  assert.ok(!R.canBuy(s, 'head_sprout').ok);
  assert.ok(R.canBuy(s, 'head_crown').locked);
  assert.ok(R.canBuy(s, 'head_beanie').short > 0);
  R.equip(s, 'head_sprout');
  assert.equal(s.equipped.head, null);
  s.stardust = 100;
  assert.ok(R.buy(s, 'cushion').ok);
  assert.equal(s.cushions, 2);
});
