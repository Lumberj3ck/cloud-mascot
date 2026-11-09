// Headless screenshots of the demo's ?shot= test mode.
//   node scripts/shoot.mjs [outdir] [shot ...]
// Serves site/ on a local port, opens each ?shot=<name> in headless Chromium (SwiftShader WebGL),
// waits for document.title === "done", saves <outdir>/<name>.png. Fails on any page error.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'site');
const outdir = path.resolve(ROOT, process.argv[2] || 'renders/browser');
const shots = process.argv.slice(3).length ? process.argv.slice(3)
  : ['hero', 'front', 'side', 'back', 'top', 'threequarter'];
const SIZE = { width: Number(process.env.SHOT_W || 1254), height: Number(process.env.SHOT_H || 1254) };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.glb': 'model/gltf-binary', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--no-sandbox', '--hide-scrollbars'],
});
fs.mkdirSync(outdir, { recursive: true });
let failed = false;
try {
  for (const shot of shots) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewport({ ...SIZE, deviceScaleFactor: 1 });
    // shot may carry extra query params: "hero&az=10&tune={...}" (values already URL-safe)
    if (shot === 'ui') {
      // interactive page smoke test: normal load (animation loop, controls, panel)
      await page.goto(base + 'studio.html', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__mascot && window.__mascot.scene.getObjectByName('CloudBody'), { timeout: 120000 });
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(() => { document.title = 'done'; });
    } else {
      // "page.html:shot&..." picks another page (default studio.html)
      const m = shot.match(/^([\w-]+\.html):(.*)$/s);
      const [pg, sh] = m ? [m[1], m[2]] : ['studio.html', shot];
      await page.goto(`${base}${pg}?shot=${sh}`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.title === 'done' || document.title === 'error', { timeout: 120000 });
    }
    const title = await page.title();
    const file = path.join(outdir, `${shot.replace(/[^\w.-]+/g, '_')}.png`);
    await page.screenshot({ path: file });
    if (title !== 'done' || errors.length) {
      failed = true;
      console.error(`FAIL ${shot}: title=${title}`, errors);
    } else {
      console.log(`shot ${shot} -> ${path.relative(ROOT, file)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
