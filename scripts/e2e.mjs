/**
 * One-shot happy-path proof — drives the built MCP server over stdio through a
 * full generation: generate_3d_from_text → wait_for_asset → download_asset.
 *
 *   PICOBERRY_API_KEY=pb_live_... [PICOBERRY_API_BASE=…] \
 *     node scripts/e2e.mjs ["a prompt"] [engine]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const prompt = process.argv[2] || 'a stylized treasure chest, game ready';
const engine = process.argv[3];
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

if (!process.env.PICOBERRY_API_KEY) {
  console.error('Set PICOBERRY_API_KEY (pb_live_...) in the environment.');
  process.exit(1);
}

const p = spawn('node', [entry], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

const pending = new Map();
let idc = 100;
const call = (name, args) =>
  new Promise((resolve) => {
    const id = ++idc;
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  });
const parse = (m) => {
  const txt = m.result?.content?.[0]?.text;
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { isError: m.result?.isError, data, txt };
};
const done = (err, code) => { if (err) console.error(`\n❌ ${err}`); p.kill(); process.exit(code); };

let buf = '';
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); flow(); }
    else if (pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(parse(m)); }
  }
});

async function flow() {
  console.log(`\n[1/3] generate_3d_from_text: "${prompt}"${engine ? ` (engine=${engine})` : ''}`);
  const gen = await call('generate_3d_from_text', { prompt, ...(engine ? { engine } : {}) });
  if (gen.isError) return done(gen.txt, 1);
  const id = gen.data?.id;
  console.log(`      → asset id: ${id}  (taskStatus ${gen.data?.taskStatus})`);
  if (!id) return done('no asset id returned', 1);

  console.log('[2/3] wait_for_asset (up to 10 min)…');
  const w = await call('wait_for_asset', { asset_id: id, timeout_seconds: 600 });
  if (w.isError) return done(w.txt, 1);
  console.log(`      → taskStatus ${w.data?.taskStatus}`);
  if (w.data?.taskStatus !== 2) {
    return done(`generation not succeeded: ${JSON.stringify(w.data?.errorDetail ?? w.data)}`, 1);
  }
  console.log(`      → files.model: ${w.data?.files?.model}`);

  console.log('[3/3] download_asset (glb)…');
  const dl = await call('download_asset', { asset_id: id, format: 'glb' });
  if (dl.isError) return done(dl.txt, 1);
  console.log(`      → download URL: ${dl.data?.url}`);
  console.log('\n✅ MCP happy-path OK — generated + downloaded a real GLB through the MCP server.');
  done(null, 0);
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } });
setTimeout(() => done('timeout', 2), 700000);
