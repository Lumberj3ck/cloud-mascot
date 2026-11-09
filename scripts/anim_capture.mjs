// Capture every animation clip and mood as frames (deterministic, in-page stepping).
//   node scripts/anim_capture.mjs [outdir] [fps]
// -> <outdir>/<kind>_<name>/f000.png ...; scripts/anim_sheets.py turns them into GIFs + filmstrips.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'site');
const out = path.resolve(ROOT, process.argv[2] || 'build/frames');
const fps = Number(process.argv[3] || 20);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = path.normalize(path.join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(SITE) || !fs.existsSync(p)) { res.writeHead(404).end(); return; }
  if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 520, height: 520, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/studio.html?shot=anim`);
await page.waitForFunction(() => document.title === 'done' || document.title === 'error', { timeout: 120000 });
const { clips, moods } = await page.evaluate(async () => {
  const m = await import('./js/anim.js');
  return { clips: m.CLIP_NAMES.filter((c) => c !== 'blink'), moods: m.MOOD_NAMES };
});
const durs = await page.evaluate(async () => Object.fromEntries(Object.entries((await import('./js/anim.js')).CLIPS).map(([k, v]) => [k, v.dur])));
const jobs = [...clips.map((c) => ['clip', c, durs[c] + 0.4]), ...moods.map((m) => ['mood', m, 3.0])];
for (const [kind, name, secs] of jobs) {
  const frames = await page.evaluate((k, n, s, f) => window.__mascot.capture(k, n, s, f), kind, name, secs, fps);
  const dir = path.join(out, `${kind}_${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  frames.forEach((d, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(d.split(',')[1], 'base64')));
  console.log(`${kind} ${name}: ${frames.length} frames`);
}
await browser.close();
server.close();
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
