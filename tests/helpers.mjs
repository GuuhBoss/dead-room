import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createApp } from '../server.mjs';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
// Trusted fixture setup is executed by the real shared resetRun. These hooks
// exist only in temporary test source files, never in the wire protocol.
export function fixtureSources(t, setup) {
  const directory = mkdtempSync(join(tmpdir(), 'deadrooms-source-'));
  for (const name of ['01-data.js', '02-world.js', '03-combat.js', '07-main.js']) {
    let source = readFileSync(join(sourceRoot, name), 'utf8');
    if (name === '07-main.js') {
      source = source.replace(/^function resetRun\([^]*?^}/m, reset => `${reset.slice(0, -1)}\n${setup.split('\n').map(line => '  ' + line).join('\n')}\n}`);
    }
    writeFileSync(join(directory, name), source);
  }
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
export const input = changes => ({ dx: 0, dy: 0, fire: false, prev: false, next: false, select: -1, ...changes });
// Exercise actual damage/death, then skip only the cosmetic wait in this
// fixture so network lifecycle checks need not wait several seconds per case.
export const defeatSetup = `
spawnZ = []; spawnD = [];
for (const p of players) {
  p.inv = 0;
  affect(p, { type: 'zombie', damage: p.max + 1, x: p.x - 1, y: p.y });
  processAffects(p);
  p.count = 0;
  hitState(p);
  p.state = 'dead'; p.count = 0;
}
`;
export async function app(t, online = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'deadrooms-data-'));
  const server = createApp({ dataDir, online });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { server, base, dataDir, async entries(query = '') { return (await (await fetch(base + '/api/leaderboard' + query)).json()).entries; } };
}
export async function client(t, base, options = {}) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/online', { origin: base, ...options });
  const queue = [], waiters = [];
  ws.on('error', () => {});
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const at = waiters.findIndex(waiter => waiter.predicate(message));
    if (at < 0) { queue.push(message); return; }
    const [waiter] = waiters.splice(at, 1);
    clearTimeout(waiter.timer); waiter.resolve(message);
  });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  return {
    ws, queue,
    send(message) { ws.send(JSON.stringify(message)); },
    next(type, predicate = () => true) {
      const matches = message => message.type === type && predicate(message);
      const at = queue.findIndex(matches);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate: matches, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${type}; messages: ${JSON.stringify(queue).slice(0, 500)}`));
        }, 4000) };
        waiters.push(waiter);
      });
    },
  };
}
export async function room(client, mode = 'solo', roomIndex = 0, name = 'Alice') {
  client.send({ type: 'create', mode, roomIndex, name });
  const welcome = await client.next('welcome');
  await client.next('lobby');
  return welcome;
}
