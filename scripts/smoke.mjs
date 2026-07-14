/**
 * Dev smoke test — drive the built MCP server over stdio like a real client.
 *
 *   PICOBERRY_API_KEY=pb_live_... [PICOBERRY_API_BASE=…] \
 *     node scripts/smoke.mjs <tool> ['<json-args>']
 *
 * Examples:
 *   node scripts/smoke.mjs get_credits
 *   node scripts/smoke.mjs list_models '{"category":"3d"}'
 *   node scripts/smoke.mjs generate_3d_from_text '{"prompt":"a stylized treasure chest, game ready"}'
 *   node scripts/smoke.mjs wait_for_asset '{"asset_id":"<id>"}'
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const tool = process.argv[2] || 'get_credits';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

if (!process.env.PICOBERRY_API_KEY) {
  console.error('Set PICOBERRY_API_KEY (pb_live_...) in the environment.');
  process.exit(1);
}

const p = spawn('node', [entry], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

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
    if (m.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: args } });
    }
    if (m.id === 3) {
      console.log(`\ntools/call ${tool}  (isError=${m.result?.isError ?? false})`);
      console.log(m.result?.content?.[0]?.text);
      p.kill();
      process.exit(m.result?.isError ? 1 : 0);
    }
  }
});

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
setTimeout(() => { console.error('TIMEOUT'); p.kill(); process.exit(2); }, 640000);
