import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { app, client, room, input, fixtureSources, defeatSetup } from './helpers.mjs';

async function deniedUpgrade(base, origin = base, path = '/online') {
  const ws = new WebSocket(base.replace('http:', 'ws:') + path, origin === null ? {} : { origin });
  ws.on('error', () => {});
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_request, response) => { response.resume(); ws.terminate(); resolve(response.statusCode); });
    ws.once('open', () => { ws.terminate(); reject(new Error('Upgrade unexpectedly allowed')); });
  });
}

test('same-origin JSON protocol supports solo and HEAD leaderboard', async t => {
  const service = await app(t);
  const a = await client(t, service.base);
  const welcome = await room(a);
  assert.match(welcome.code, /^[A-Z2-9]{8}$/);
  assert.equal(welcome.host, true);
  assert.match(welcome.runId, /^[a-f0-9-]{36}$/);
  a.send({ type: 'ping', at: 123 });
  assert.deepEqual(await a.next('pong'), { type: 'pong', at: 123 });
  a.send({ type: 'start' });
  const first = await a.next('state');
  assert.equal(first.tick, 0);
  assert.equal(first.snapshot.game.mode, 1);
  const later = await a.next('state', state => state.tick >= 3);
  assert.equal(later.snapshot.players[0].ammo[0], null);
  assert.equal(later.snapshot.score, 0);
  assert.deepEqual(await service.entries(), []);
  const head = await fetch(service.base + '/api/leaderboard', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
});

test('upgrade rejects other origins, missing Origin and other paths', async t => {
  const service = await app(t);
  assert.equal(await deniedUpgrade(service.base, 'https://evil.example'), 403);
  assert.equal(await deniedUpgrade(service.base, 'null'), 403);
  assert.equal(await deniedUpgrade(service.base, null), 403);
  assert.equal(await deniedUpgrade(service.base, service.base, '/online?room=x'), 404);
});

test('explicit origin policy works behind a TLS proxy and does not trust forwarded headers', async t => {
  const service = await app(t, { allowedOrigins: ['https://rooms.example'] });
  const a = await client(t, service.base, { origin: 'https://rooms.example' });
  await room(a);
  assert.equal(await deniedUpgrade(service.base), 403);
});

test('only members can start and input; coop waits for two', async t => {
  const service = await app(t);
  const host = await client(t, service.base), guest = await client(t, service.base), outsider = await client(t, service.base);
  const welcome = await room(host, 'coop');
  host.send({ type: 'start' });
  assert.match((await host.next('error')).message, /Waiting/);
  outsider.send({ type: 'start' });
  assert.match((await outsider.next('error')).message, /host/);
  outsider.send({ type: 'input', seq: 0, input: input({ fire: true }) });
  assert.match((await outsider.next('error')).message, /No active/);
  guest.send({ type: 'join', code: welcome.code, name: 'Bob' });
  assert.equal((await guest.next('welcome')).playerId, 1);
  assert.equal((await host.next('lobby', message => message.players.length === 2)).players[1].name, 'Bob');
  guest.send({ type: 'start' });
  assert.match((await guest.next('error')).message, /host/);
  host.send({ type: 'start' });
  assert.equal((await host.next('state')).snapshot.players.length, 2);
  assert.equal((await guest.next('state')).snapshot.game.mode, 2);
  outsider.send({ type: 'join', code: welcome.code, name: 'Eve' });
  assert.match((await outsider.next('error')).message, /unavailable/);
});

test('strict input bounds, sequence replay and score injection cannot mutate state', async t => {
  const service = await app(t);
  const a = await client(t, service.base);
  await room(a);
  a.send({ type: 'start' });
  const initial = await a.next('state');
  const bad = [
    { type: 'input', seq: 0, input: input({ dx: null }) },
    { type: 'input', seq: 0, input: input({ dy: 50 }) },
    { type: 'input', seq: 0, input: input({ select: 99 }) },
    { type: 'input', seq: 0, input: input({ fire: 'true' }) },
    { type: 'input', seq: 0, input: input(), score: 999999 },
    { type: 'input', seq: 0, input: input({ hp: 9999 }) },
    { type: 'input', seq: 0.5, input: input() },
    { type: 'input', seq: -1, input: input() },
  ];
  for (const message of bad) { a.send(message); assert.match((await a.next('error')).message, /Invalid input/); }
  a.ws.send('{"type":"input","seq":0,"input":{"dx":NaN}}');
  assert.match((await a.next('error')).message, /Invalid JSON/);
  a.send({ type: 'input', seq: 5, input: input() });
  for (const seq of [5, 4]) { a.send({ type: 'input', seq, input: input({ dx: 1 }) }); assert.match((await a.next('error')).message, /Stale/); }
  const later = await a.next('state', state => state.tick >= 4);
  assert.equal(later.snapshot.players[0].x, initial.snapshot.players[0].x);
  assert.equal(later.snapshot.players[0].hp, initial.snapshot.players[0].hp);
  assert.equal(later.snapshot.score, 0);
  assert.equal(later.snapshot.kills, 0);
  assert.ok(later.snapshot.players[0].ammo.slice(1).every(ammo => ammo === 0));
  assert.deepEqual(await service.entries(), []);
});

test('room isolation binds input to sender and stale movement stops', async t => {
  const service = await app(t, { limits: { staleInputMs: 100 } });
  const a = await client(t, service.base), b = await client(t, service.base);
  const ar = await room(a), br = await room(b);
  a.send({ type: 'start' }); b.send({ type: 'start' });
  const a0 = await a.next('state'), b0 = await b.next('state');
  a.send({ type: 'input', seq: 0, input: input({ dx: 1 }), code: br.code });
  assert.match((await a.next('error')).message, /Invalid/);
  a.send({ type: 'input', seq: 0, input: input({ dx: 1 }) });
  const moved = await a.next('state', state => state.tick >= 6);
  const stopped = await a.next('state', state => state.tick >= moved.tick + 4);
  const isolated = await b.next('state', state => state.tick >= stopped.tick);
  assert.ok(moved.snapshot.players[0].x > a0.snapshot.players[0].x);
  assert.ok(moved.snapshot.players[0].x - a0.snapshot.players[0].x < 30);
  assert.equal(stopped.snapshot.players[0].x, moved.snapshot.players[0].x);
  assert.equal(isolated.snapshot.players[0].x, b0.snapshot.players[0].x);
  assert.notEqual(ar.code, br.code);
});

test('coop input affects only the assigned player; disconnect aborts both and never ranks', async t => {
  const service = await app(t);
  const host = await client(t, service.base), guest = await client(t, service.base);
  const welcome = await room(host, 'coop');
  guest.send({ type: 'join', code: welcome.code, name: 'Bob' }); await guest.next('welcome');
  host.send({ type: 'start' });
  const initial = await host.next('state');
  guest.send({ type: 'input', seq: 0, input: input({ dx: 1 }) });
  const later = await host.next('state', state => state.tick >= 3);
  assert.equal(later.snapshot.players[0].x, initial.snapshot.players[0].x);
  assert.ok(later.snapshot.players[1].x > initial.snapshot.players[1].x);
  guest.ws.terminate();
  assert.match((await host.next('ended')).reason, /disconnected/);
  assert.deepEqual(await service.entries(), []);
  host.send({ type: 'start' }); assert.match((await host.next('error')).message, /host/);
});

test('genuine shared defeat ranks once; completed runs cannot restart or submit a score', async t => {
  const service = await app(t, { sourceDir: fixtureSources(t, defeatSetup) });
  const a = await client(t, service.base);
  await room(a);
  a.send({ type: 'start' });
  const over = await a.next('state', state => state.snapshot.game.state === 'over');
  const result = await a.next('result');
  assert.equal(result.recorded, true);
  const entries = await service.entries('?mode=solo&roomIndex=0');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, result.runId);
  assert.deepEqual(entries[0].names, ['Alice']);
  assert.equal(entries[0].score, over.snapshot.score);
  assert.equal(entries[0].kills, over.snapshot.kills);
  assert.equal(entries[0].bestMultiplier, over.snapshot.combo.best);
  assert.ok(entries[0].duration > 0);
  a.send({ type: 'start' }); assert.match((await a.next('error')).message, /already/);
  a.send({ type: 'submitScore', score: 999999 }); await a.next('error');
  assert.equal((await service.entries()).length, 1);
  assert.equal((await fetch(service.base + '/api/leaderboard', { method: 'POST', body: '{"score":999999}' })).status, 405);
  a.ws.terminate();
  assert.equal((await service.entries()).length, 1);
});

test('coop defeat ranks team together in a separate survival mode', async t => {
  const service = await app(t, { sourceDir: fixtureSources(t, defeatSetup) });
  const host = await client(t, service.base), guest = await client(t, service.base);
  const welcome = await room(host, 'coop');
  guest.send({ type: 'join', code: welcome.code, name: 'Bob' }); await guest.next('welcome');
  host.send({ type: 'start' });
  await host.next('state', state => state.snapshot.game.state === 'over');
  assert.deepEqual(await service.entries('?mode=solo'), []);
  assert.deepEqual((await service.entries('?mode=coop'))[0].names, ['Alice', 'Bob']);
});

test('leave, idle timeout, lobby TTL and run TTL never rank', async t => {
  for (const action of ['leave', 'idle', 'lobby', 'run']) await t.test(action, async t => {
    const limits = action === 'idle' ? { idleMs: 100 } : action === 'lobby' ? { lobbyMs: 70 } : action === 'run' ? { runMs: 70 } : {};
    const service = await app(t, { limits });
    const a = await client(t, service.base);
    await room(a);
    if (action !== 'lobby') { a.send({ type: 'start' }); await a.next('state'); }
    if (action === 'leave') a.send({ type: 'leave' });
    await a.next('ended');
    assert.deepEqual(await service.entries(), []);
  });
});

test('capacity and message limits bound resource use', async t => {
  const service = await app(t, { limits: { rooms: 1, connectionsPerIp: 2, messagesPerSecond: 0, messageBurst: 4 } });
  const a = await client(t, service.base), b = await client(t, service.base);
  await room(a);
  b.send({ type: 'create', mode: 'solo', roomIndex: 0, name: 'Bob' });
  assert.match((await b.next('error')).message, /capacity/);
  assert.equal(await deniedUpgrade(service.base), 429);
  a.send({ type: 'start' }); await a.next('state');
  const closed = once(a.ws, 'close');
  for (let seq = 0; seq < 8; seq++) a.send({ type: 'input', seq, input: input() });
  assert.equal((await closed)[0], 1008);
  assert.deepEqual(await service.entries(), []);
});

test('oversized and binary messages terminate only that connection and never rank', async t => {
  for (const type of ['oversized', 'binary']) await t.test(type, async t => {
    const service = await app(t);
    const a = await client(t, service.base);
    await room(a); a.send({ type: 'start' }); await a.next('state');
    const closed = once(a.ws, 'close');
    if (type === 'oversized') a.ws.send('x'.repeat(2049)); else a.ws.send(Buffer.from('{}'));
    assert.equal((await closed)[0], type === 'oversized' ? 1009 : 1003);
    assert.deepEqual(await service.entries(), []);
    assert.equal((await fetch(service.base + '/api/leaderboard')).status, 200);
  });
});

test('leaderboard filters reject malformed or unsupported queries', async t => {
  const service = await app(t);
  for (const query of ['mode=deathmatch', 'roomIndex=NaN', 'roomIndex=-1', 'roomIndex=256', 'roomIndex=0&roomIndex=1', 'score=999', 'mode=solo&mode=coop']) {
    assert.equal((await fetch(service.base + '/api/leaderboard?' + query)).status, 400, query);
  }
});

test('disconnect before an otherwise lethal step cannot rank the room', async t => {
  const service = await app(t, { sourceDir: fixtureSources(t, defeatSetup.replace('z.attack = 0.21', 'z.attack = 0.7')) });
  const host = await client(t, service.base), guest = await client(t, service.base);
  const welcome = await room(host, 'coop');
  guest.send({ type: 'join', code: welcome.code, name: 'Bob' }); await guest.next('welcome');
  host.send({ type: 'start' });
  await host.next('state');
  // Disconnect while playing, before the real zombie attack lands. The survivor
  // cannot recover the abandoned room's pending lethal result.
  const closed = once(guest.ws, 'close');
  guest.ws.terminate(); await closed;
  await host.next('ended');
  host.send({ type: 'start' });
  assert.match((await host.next('error')).message, /host/);
  assert.deepEqual(await service.entries(), []);
});

test('names, create shape and room index reject unsafe lobby data', async t => {
  const service = await app(t, { limits: { controlBurst: 20 } });
  const a = await client(t, service.base);
  for (const changes of [{ name: '<script>' }, { name: 'x'.repeat(25) }, { name: '\u202Eevil' }, { roomIndex: -1 }, { roomIndex: 0.5 }, { roomIndex: 1000 }, { mode: 'zombie-wars' }, { score: 999 }]) {
    a.send({ type: 'create', name: 'Alice', mode: 'solo', roomIndex: 0, ...changes });
    await a.next('error');
  }
  a.send({ type: 'create', name: '  Alice  ', mode: 'solo', roomIndex: 0 });
  await a.next('welcome');
  assert.deepEqual((await a.next('lobby')).players, [{ id: 0, name: 'Alice', character: 3 }]);
});

test('completed board survives an HTTP server restart', async t => {
  const service = await app(t, { sourceDir: fixtureSources(t, defeatSetup) });
  const a = await client(t, service.base);
  await room(a); a.send({ type: 'start' });
  await a.next('state', state => state.snapshot.game.state === 'over');
  const entries = await service.entries();
  await new Promise(resolve => service.server.close(resolve));
  const { createApp } = await import('../server.mjs');
  const restarted = createApp({ dataDir: service.dataDir });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => restarted.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/leaderboard`);
  assert.deepEqual((await response.json()).entries, entries);
});


test('persistence failure reports a safe error and cannot retry a completed result', async t => {
  const service = await app(t, { sourceDir: fixtureSources(t, defeatSetup) });
  // Force atomic rename to fail without relying on root/read-only permissions.
  mkdirSync(join(service.dataDir, 'leaderboard.json'));
  const a = await client(t, service.base);
  await room(a); a.send({ type: 'start' });
  assert.equal((await a.next('error')).message, 'Run completed but leaderboard storage is unavailable');
  await a.next('state', state => state.snapshot.game.state === 'over');
  a.send({ type: 'start' }); assert.match((await a.next('error')).message, /already/);
  assert.deepEqual(await service.entries(), []);
  assert.deepEqual(readdirSync(service.dataDir), ['leaderboard.json']);
});

// This fixture starts just before the final genuine lethal hit; only the
// cosmetic death wait is skipped, not the shared win/frag logic.
test('deathmatch requires two members, sends authoritative winner, never enters survival ranking', async t => {
  const sourceDir = fixtureSources(t, `
if (game.mode === 3) {
  const p = players[1]; p.deaths = game.fragLimit - 1; p.inv = 0;
  affect(p, { type: 'bullet', damage: p.max + 1, x: p.x - 1, y: p.y, owner: 0 });
  processAffects(p); p.count = 0; hitState(p);
  p.state = 'dead'; p.count = 0;
}
`);
  const service = await app(t, { sourceDir });
  const host = await client(t, service.base), guest = await client(t, service.base);
  const welcome = await room(host, 'deathmatch');
  host.send({ type: 'start' });
  assert.match((await host.next('error')).message, /Waiting/);
  guest.send({ type: 'join', code: welcome.code, name: 'Bob' });
  const joined = await guest.next('welcome');
  assert.equal(joined.mode, 'deathmatch');
  assert.equal(joined.runId, welcome.runId);
  host.send({ type: 'start' });
  const final = await host.next('state', state => state.snapshot.game.state === 'over');
  assert.equal(final.snapshot.game.mode, 3);
  assert.equal(final.snapshot.game.winner, 0);
  assert.equal(final.snapshot.game.fragLimit, 10);
  assert.equal(final.snapshot.players[0].down, false);
  assert.equal(final.snapshot.players[1].deaths, 10);
  const result = await guest.next('result');
  assert.deepEqual(result, { type: 'result', runId: welcome.runId, mode: 'deathmatch', recorded: false });
  assert.deepEqual(await service.entries(), []);
  assert.equal((await fetch(service.base + '/api/leaderboard?mode=deathmatch')).status, 400);
  host.send({ type: 'start' });
  assert.match((await host.next('error')).message, /already/);
});

test('lobby character selection is cosmetic, slot-bound and locked once play starts', async t => {
  const service=await app(t);
  const host=await client(t,service.base),guest=await client(t,service.base);
  const welcome=await room(host,'coop');
  host.send({type:'character',character:1,playerId:1});
  assert.match((await host.next('error')).message,/Invalid character/);
  host.send({type:'character',character:1});
  const selected=await host.next('lobby',m=>m.players[0].character===1);
  assert.equal(selected.players[0].character,1);
  guest.send({type:'join',code:welcome.code,name:'Bob'});await guest.next('welcome');
  guest.send({type:'character',character:2});
  await host.next('lobby',m=>m.players[1]?.character===2);
  host.send({type:'start'});
  const state=(await host.next('state')).snapshot;
  assert.deepEqual(state.game.characters,[1,2]);
  assert.deepEqual(state.players.map(p=>p.look),['agent','soldier']);
  assert.ok(state.players.every(p=>p.hp===200 && p.weapon===0));
  guest.send({type:'character',character:0});
  assert.match((await guest.next('error')).message,/lobby/);
});
