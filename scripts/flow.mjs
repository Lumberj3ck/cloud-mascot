// Drive the app like a person and screenshot each step (headless Chromium, SwiftShader WebGL).
//   node scripts/flow.mjs [outdir] [desktop|tablet|mobile|both|all]
// Starts from a clean in-memory state (?fresh): splash -> welcome -> pick planets -> tasks -> rules ->
// today -> tick tasks -> planet sheet -> decorate -> wardrobe -> next day recap. Fails on any page error.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'site');
const outdir = path.resolve(ROOT, process.argv[2] || 'renders/app');
const which = process.argv[3] || 'both';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(SITE, decodeURIComponent(u.pathname)));
  if (!p.startsWith(SITE)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
});
fs.mkdirSync(outdir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;

async function run(name, viewport) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  let n = 0;
  // SwiftShader runs at a few fps; fast-forward the simulation so each shot shows the settled state
  const settle = (s = 3) => page.evaluate((t) => window.__app?.world?.advance(t), s);
  const shot = async (label, wait = 0) => {
    if (wait) await sleep(Math.min(wait, 900));
    if (label !== 'splash') await settle();
    const f = path.join(outdir, `${name}_${String(++n).padStart(2, '0')}_${label}.png`);
    await page.screenshot({ path: f });
    console.log(`${name}: ${path.relative(ROOT, f)}`);
  };
  const click = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 20000 }); await page.click(sel); };
  const step = async (label, fn, wait = 1800) => { try { await fn(); await shot(label, wait); } catch (e) { errors.push(`${label}: ${e.message}`); await shot(`${label}_FAILED`); } };

  await page.goto(`${base}index.html?fresh`, { waitUntil: 'domcontentloaded' });
  await shot('splash', 600);
  await page.waitForFunction(() => window.__app?.ready || document.title === 'error', { timeout: 180000 });
  await shot('welcome', 3500);
  await step('pick', () => click('[data-ob="next"]'));
  await step('picked', async () => { await click('[data-pick="ocean"]'); await click('[data-pick="moon"]'); await click('[data-pick="book"]'); });
  await step('tasks_ocean', async () => { await click('[data-ob="next"]'); await sleep(400); await click('[data-obs="Drink 8 glasses of water"]'); await click('[data-obs="Eat a piece of fruit"]'); });
  await step('tasks_custom', async () => { await page.type('[data-obform] .field', 'Refill my bottle at lunch'); await page.keyboard.press('Enter'); }, 600);
  await step('tasks_moon', async () => { await click('[data-ob="next"]'); await sleep(400); await click('[data-obs="Lights out by 23:00"]'); }, 2200);
  await step('tasks_book', async () => { await click('[data-ob="next"]'); await sleep(400); await click('[data-obs="Read 10 pages"]'); }, 2200);
  await step('rules', () => click('[data-ob="next"]'));
  await step('today', () => click('[data-ob="finish"]'), 3500);
  if (viewport.width < 600) await step('today_expanded', () => click('#today .grab'), 1200);
  const tasks = await page.$$eval('#today .task[data-planet="ocean"]', (b) => b.map((x) => x.dataset.task));
  await step('ticked', () => click(`[data-task="${tasks[0]}"]`), 500);
  await step('tended', async () => { await click(`[data-task="${tasks[1]}"]`); await sleep(300); await click(`[data-task="${tasks[2]}"]`); }, 1200);
  await step('planet', () => (viewport.width < 600 ? page.evaluate(() => document.querySelector('[data-open="ocean"]').click()) : click('[data-group="ocean"] .group-head')), 3000);
  await step('add_task_form', () => click('[data-add]'), 600);
  await step('decorate', () => click('[data-tab="decor"]'), 800);
  await step('close_planet', () => click('#planetSheet [data-close]'), 2500);
  await step('asleep_planet', () => page.evaluate(() => document.querySelector('.plabel.asleep')?.click()), 3000);
  await page.evaluate(() => document.querySelector('#planetSheet [data-close]')?.click());
  await step('wardrobe', () => click('#wardrobeBtn'), 3500);
  await step('tryon', () => click('[data-try="head_sprout"]'), 1500);
  await step('bought', () => click('[data-buy="head_sprout"]'), 1500);
  await step('finish_tab', async () => { await click('[data-stab="finish"]'); await click('[data-try="finish_mint"]'); }, 1500);
  await page.evaluate(() => document.querySelector('#shopSheet [data-close]')?.click());
  await step('menu', () => click('#menuBtn'), 500);
  await step('recap', () => click('[data-m="skip"]'), 1500);
  await step('after_recap', () => click('#dialog .btn.primary'), 2500);
  await step('rules_dialog', async () => { await click('#menuBtn'); await click('[data-m="rules"]'); }, 800);
  await page.keyboard.press('Escape');
  // a few kept days: every task done, then the day closes -> planets reach Sprout
  await step('grown', async () => {
    await page.evaluate(() => {
      const { R, state: S } = window.__app;
      for (let d = 0; d < 3; d++) {
        for (const p of R.today(S).planets) for (const t of p.tasks) if (!R.isDone(S, t.id)) document.querySelector(`[data-task="${t.id}"]`)?.click();
        window.__app.skipDay();
        document.querySelector('#dialog')?.close();
      }
    });
  }, 4000);
  await step('decor_pick', async () => {
    await page.evaluate(() => document.querySelector('[data-open="ocean"]').click());
    await sleep(800);
    await click('[data-tab="decor"]');
    await click('[data-item="item_fountain"]');
  }, 3500);
  await step('decor_placed', async () => {
    const c = await page.evaluate(() => window.__app.world.anchor('ocean', { center: true }));
    await page.mouse.click(c.x, c.y);
  }, 2500);
  console.log(`${name}: decor on Tide after tap: ${await page.evaluate(() => window.__app.state.planets.ocean.items.map((i) => i.id).join() || 'none')}`);
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  console.log(`${name}: ~${fps} fps (SwiftShader)`);
  if (errors.length) { failed = true; console.error(`FAIL ${name}`, errors); }
  await page.close();
}
try {
  const sizes = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 768 }, mobile: { width: 390, height: 844 } };
  const pick = which === 'both' ? ['desktop', 'mobile'] : which === 'all' ? Object.keys(sizes) : [which];
  for (const k of pick) await run(k, sizes[k]);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
