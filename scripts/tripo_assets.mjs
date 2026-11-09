// Image -> 3D for the planet world via the Tripo API.
//   node scripts/tripo_assets.mjs [--only id,id] [--dry-run] [--balance]
// Reads assets_src/planets/manifest.json ([{id, image}]), for each asset without a model yet:
//   upload the reference image -> image_to_model task -> poll -> download GLB to build/tripo/<id>.glb
//   -> optimise (gltf-transform: meshopt geometry, 1024px WebP textures) -> site/assets/planets/<id>.glb
// Task ids are recorded in assets_src/planets/tasks.json, so an interrupted run resumes without paying twice.
// The token comes from TRIPO_TOKEN in .env and is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = 'https://api.tripo3d.ai/v2/openapi';
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const dry = args.includes('--dry-run');

function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const TOKEN = process.env.TRIPO_TOKEN;
if (!TOKEN) { console.error('TRIPO_TOKEN missing (.env)'); process.exit(1); }
const auth = { Authorization: `Bearer ${TOKEN}` };

async function api(method, url, body, headers = {}) {
  const r = await fetch(url.startsWith('http') ? url : API + url, { method, headers: { ...auth, ...headers }, body });
  const j = await r.json().catch(() => ({ code: -1, message: `HTTP ${r.status}` }));
  if (j.code !== 0) throw new Error(`${method} ${url}: ${j.code} ${j.message || ''} ${j.suggestion || ''}`.trim());
  return j.data;
}

const balance = () => api('GET', '/user/balance');

async function upload(file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
  const d = await api('POST', '/upload', fd);
  return d.image_token || d.file_token;
}

async function createTask(token, opts = {}) {
  const body = {
    type: 'image_to_model',
    file: { type: 'png', file_token: token },
    texture: true, pbr: true,
    face_limit: opts.faceLimit || 20000,
    ...(opts.modelVersion ? { model_version: opts.modelVersion } : {}),
  };
  const d = await api('POST', '/task', JSON.stringify(body), { 'Content-Type': 'application/json' });
  return d.task_id;
}

async function poll(taskId) {
  for (let i = 0; i < 180; i++) {
    const d = await api('GET', `/task/${taskId}`);
    if (d.status === 'success') return d;
    if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(d.status)) throw new Error(`task ${taskId} ${d.status}`);
    process.stdout.write(`\r  ${taskId.slice(0, 8)} ${d.status} ${d.progress ?? ''}%   `);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`task ${taskId} timed out`);
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}

function optimise(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const bin = path.join(ROOT, 'node_modules', '.bin', 'gltf-transform');
  execFileSync(bin, ['optimize', src, dst, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024'],
    { stdio: 'inherit' });
}

async function main() {
  if (args.includes('--balance')) { console.log(await balance()); return; }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets_src/planets/manifest.json'), 'utf8'));
  const tasksFile = path.join(ROOT, 'assets_src/planets/tasks.json');
  const tasks = fs.existsSync(tasksFile) ? JSON.parse(fs.readFileSync(tasksFile, 'utf8')) : {};
  const todo = manifest.filter((a) => (!only.length || only.includes(a.id)));
  const b = await balance();
  console.log(`balance ${b.balance} (frozen ${b.frozen}); ${todo.length} assets`);
  for (const a of todo) {
    const raw = path.join(ROOT, 'build/tripo', `${a.id}.glb`);
    const out = path.join(ROOT, 'site/assets/planets', `${a.id}.glb`);
    if (fs.existsSync(out)) { console.log(`= ${a.id}: done`); continue; }
    if (dry) { console.log(`would generate ${a.id} from ${a.image}`); continue; }
    if (!fs.existsSync(raw)) {
      let taskId = tasks[a.id];
      if (!taskId) {
        const tok = await upload(path.join(ROOT, a.image));
        taskId = await createTask(tok, a);
        tasks[a.id] = taskId;
        fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 1));
      }
      console.log(`> ${a.id}: task ${taskId}`);
      const d = await poll(taskId);
      const url = d.output.pbr_model || d.output.model || d.output.base_model;
      await download(url, raw);
      console.log(`\n  downloaded ${(fs.statSync(raw).size / 1e6).toFixed(1)} MB`);
    }
    optimise(raw, out);
    console.log(`  -> ${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
  }
}
main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
