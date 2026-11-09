// Fit the lighting + vinyl parameters so the browser hero shot matches refs/front.png colours.
//   node scripts/tune_look.mjs [evals]
// One headless page at ?shot=hero; each evaluation calls __mascot.applyLook(), renders,
// and reads back a 16x12 grid of mean body colours (face cells excluded, see ref_cells.py).
// Loss = mean |Δ| over channels and cells (sRGB 0-255) + a small pull toward defaults.
// Nelder-Mead on bounded params; result -> site/assets/look.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'site');
const MAX_EVALS = Number(process.argv[2] || 260);
const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'ref_cells.json')));

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  .toString(16).padStart(2, '0')).join('');
const unhex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// [name, lo, hi, start]
const SPEC = [
  ['exposure', 0.4, 1.6, 1.0], ['hemi', 0.0, 2.5, 0.6], ['key', 0.0, 5.0, 1.2],
  ['keyAz', -85, 10, -40], ['keyEl', 5, 80, 40], ['rim', 0.0, 2.5, 0.6],
  ['cR', 0.55, 1.0, 0.84], ['cG', 0.5, 1.0, 0.75], ['cB', 0.55, 1.0, 0.89],
  ['gR', 0.4, 1.0, 0.85], ['gG', 0.4, 1.0, 0.76], ['gB', 0.4, 1.0, 0.82],
  ['wrap', 0.0, 2.5, 0.8], ['wrapPow', 0.8, 4.0, 2.0], ['edge', 0.0, 0.6, 0.2], ['env', 0.0, 1.5, 0.35],
  ['roughness', 0.35, 0.9, 0.6], ['sheen', 0.0, 1.0, 0.5], ['contact', 0.0, 0.6, 0.3],
];
const clampv = (v) => v.map((x, i) => Math.min(SPEC[i][2], Math.max(SPEC[i][1], x)));
function toLook(v) {
  const o = Object.fromEntries(SPEC.map(([n], i) => [n, v[i]]));
  return {
    exposure: o.exposure, hemi: o.hemi, key: o.key, keyAz: o.keyAz, keyEl: o.keyEl, rim: o.rim,
    color: hex(o.cR, o.cG, o.cB), hemiGround: hex(o.gR, o.gG, o.gB), wrap: o.wrap, wrapPow: o.wrapPow, edge: o.edge,
    env: o.env, roughness: o.roughness, sheen: o.sheen, contact: o.contact,
  };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(SITE, decodeURIComponent(u.pathname)));
  if (!p.startsWith(SITE) || !fs.existsSync(p)) { res.writeHead(404).end(); return; }
  if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  const t = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(p)];
  res.writeHead(200, t ? { 'content-type': t } : {});
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 627, height: 627, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/studio.html?shot=hero&noface`);
await page.waitForFunction(() => document.title === 'done', { timeout: 120000 });

const start = SPEC.map((s) => s[3]);
let evals = 0, best = { f: Infinity };
async function loss(v) {
  v = clampv(v);
  const L = toLook(v);
  const got = await page.evaluate((L, nx, ny) => {
    window.__mascot.applyLook(L);
    window.__mascot.render();
    return window.__mascot.cells(nx, ny).cells;
  }, L, ref.nx, ref.ny);
  let err = 0, n = 0;
  ref.cells.forEach((c, i) => {
    if (!c || !got[i]) return;
    // weight hue-ish error a bit more than brightness: purple vs pink is what reads wrong
    const d = c.map((x, k) => got[i][k] - x);
    const mean = (d[0] + d[1] + d[2]) / 3;
    err += Math.abs(mean) + 1.5 * (Math.abs(d[0] - mean) + Math.abs(d[1] - mean) + Math.abs(d[2] - mean)) / 3;
    n++;
  });
  const reg = v.reduce((a, x, i) => a + ((x - start[i]) / (SPEC[i][2] - SPEC[i][1])) ** 2, 0) * 2.0;
  const f = err / Math.max(n, 1) + reg + (n < 60 ? 50 : 0);
  evals++;
  if (f < best.f) best = { f, v, L, n, err: err / Math.max(n, 1) };
  if (evals % 25 === 0) console.log(`eval ${evals}: best ${best.f.toFixed(2)} (colour err ${best.err.toFixed(2)}, cells ${best.n})`);
  return f;
}

// Nelder-Mead
const dim = start.length;
let simplex = [start];
for (let i = 0; i < dim; i++) {
  const p = start.slice();
  p[i] += (SPEC[i][2] - SPEC[i][1]) * 0.15;
  simplex.push(clampv(p));
}
let fs_ = [];
for (const p of simplex) fs_.push(await loss(p));
while (evals < MAX_EVALS) {
  const idx = fs_.map((f, i) => i).sort((a, b) => fs_[a] - fs_[b]);
  simplex = idx.map((i) => simplex[i]);
  fs_ = idx.map((i) => fs_[i]);
  const c = Array(dim).fill(0);
  for (let i = 0; i < dim; i++) for (let k = 0; k < dim; k++) c[k] += simplex[i][k] / dim;
  const w = simplex[dim];
  const xr = clampv(c.map((ck, k) => ck + (ck - w[k])));
  const fr = await loss(xr);
  if (fr < fs_[0]) {
    const xe = clampv(c.map((ck, k) => ck + 2 * (ck - w[k])));
    const fe = await loss(xe);
    if (fe < fr) { simplex[dim] = xe; fs_[dim] = fe; } else { simplex[dim] = xr; fs_[dim] = fr; }
  } else if (fr < fs_[dim - 1]) {
    simplex[dim] = xr; fs_[dim] = fr;
  } else {
    const xc = clampv(c.map((ck, k) => ck + 0.5 * (w[k] - ck)));
    const fc = await loss(xc);
    if (fc < fs_[dim]) { simplex[dim] = xc; fs_[dim] = fc; } else {
      for (let i = 1; i <= dim; i++) {
        simplex[i] = clampv(simplex[i].map((x, k) => simplex[0][k] + 0.5 * (x - simplex[0][k])));
        fs_[i] = await loss(simplex[i]);
      }
    }
  }
}
await browser.close();
server.close();
const out = { ...best.L, _fit: { colourErr: +best.err.toFixed(2), cells: best.n, evals } };
fs.writeFileSync(path.join(SITE, 'assets', 'look.json'), JSON.stringify(out, null, 1));
console.log('best look', out);
