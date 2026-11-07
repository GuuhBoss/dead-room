import { WebSocketServer, WebSocket } from 'ws';
import { randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createSimulation, STEP } from './simulation.mjs';
import { exact, neutralInput, validInput, playerName, bucket, consume } from './protocol.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  connections: 128, connectionsPerIp: 8, rooms: 32, roomsPerIp: 3,
  payload: 2048, buffered: 256 * 1024, staleInputMs: 250, idleMs: 30000,
  lobbyMs: 120000, runMs: 2 * 60 * 60 * 1000, finishedMs: 60000,
  messagesPerSecond: 60, messageBurst: 90, controlsPerSecond: 2, controlBurst: 8,
  // These also bound repeated VM compilation and room-code guessing.
  createsPerSecond: 0.1, createBurst: 2, upgradeBurst: 20, upgradesPerSecond: 2,
});
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code() { return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
function allowedOrigin(request, allowed) {
  try {
    const raw = request.headers.origin;
    if (!raw || raw.length > 512) return false;
    const origin = new URL(raw);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== raw) return false;
    if (allowed.length) return allowed.includes(raw);
    const expected = new URL(`${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`);
    return origin.origin === expected.origin;
  } catch { return false; }
}
function refuse(socket, status) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function attachOnline(server, leaderboard, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const allowed = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.payload, perMessageDeflate: false, closeTimeout: 1000, maxFragments: 32, maxBufferedChunks: 64 });
  const rooms = new Map(), connections = new Set(), ips = new Map();
  let stopped = false;
  function send(client, message) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.ws.bufferedAmount > limits.buffered) { client.ws.terminate(); return; }
    client.ws.send(JSON.stringify(message));
  }
  const error = (client, message) => send(client, { type: 'error', message });
  function lobby(room) {
    const message = { type: 'lobby', code: room.code, mode: room.mode, roomIndex: room.roomIndex, players: room.members.map(member => ({ id: member.playerId, name: member.name, character: member.character })), hostId: 0 };
    for (const member of room.members) send(member, message);
  }
  function state(room) {
    const message = { type: 'state', tick: room.simulation.tick, snapshot: room.simulation.snapshot() };
    for (const member of room.members) send(member, message);
  }
  function remove(room, reason) {
    if (!rooms.delete(room.code)) return;
    room.status = 'removed';
    for (const member of room.members) {
      member.room = null;
      member.input = neutralInput();
      send(member, { type: 'ended', reason });
    }
    room.members = [];
    room.simulation = null;
  }
  function leave(client, reason) {
    if (client.room) remove(client.room, reason);
  }
  function welcome(client, room, playerId, name) {
    client.room = room; client.playerId = playerId; client.name = name;
    client.character = playerId === 0 ? 3 : 0; client.rematch = false;
    client.seq = -1; client.input = neutralInput(); client.inputAt = 0;
    room.members.push(client);
    send(client, { type: 'welcome', code: room.code, playerId, host: playerId === 0, runId: room.id, mode: room.mode, roomIndex: room.roomIndex });
    lobby(room);
  }
  function handle(client, message, now) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return error(client, 'Invalid message');
    if (message.type !== 'input' && !consume(client.controls, now)) { error(client, 'Control rate limit exceeded'); return; }
    switch (message.type) {
      case 'create': {
        if (!exact(message, ['type', 'name', 'roomIndex', 'mode'])) return error(client, 'Invalid create message');
        const name = playerName(message.name);
        if (!name || !['solo', 'coop', 'deathmatch'].includes(message.mode) || !Number.isInteger(message.roomIndex) || message.roomIndex < 0 || message.roomIndex > 255) return error(client, 'Invalid room settings or player name');
        if (client.room) return error(client, 'Leave your current room first');
        if (!consume(client.ip.creates, now)) return error(client, 'Room creation rate limit exceeded');
        if (rooms.size >= limits.rooms || [...rooms.values()].filter(room => room.ip === client.ipAddress).length >= limits.roomsPerIp) return error(client, 'Room capacity reached');
        let simulation;
        try { simulation = createSimulation({ mode: message.mode, roomIndex: message.roomIndex, sourceDir: options.sourceDir }); }
        catch (cause) { return error(client, cause instanceof RangeError ? 'Invalid room settings' : 'Simulation is unavailable'); }
        let roomCode;
        do { roomCode = code(); } while (rooms.has(roomCode));
        const room = { code: roomCode, id: randomUUID(), mode: message.mode, roomIndex: message.roomIndex, ip: client.ipAddress, members: [], simulation, status: 'lobby', createdAt: now, startedAt: 0, finishedAt: 0 };
        rooms.set(roomCode, room);
        welcome(client, room, 0, name);
        break;
      }
      case 'join': {
        if (!exact(message, ['type', 'code', 'name']) || typeof message.code !== 'string' || !/^[A-Z2-9]{8}$/.test(message.code) || !playerName(message.name)) return error(client, 'Invalid room code or player name');
        if (client.room) return error(client, 'Leave your current room first');
        const room = rooms.get(message.code);
        if (!room || room.mode === 'solo' || room.status !== 'lobby' || room.members.length !== 1 || room.members[0].ws.readyState !== WebSocket.OPEN) return error(client, 'Room is unavailable');
        welcome(client, room, 1, playerName(message.name));
        break;
      }
      case 'character': {
        if (!exact(message, ['type', 'character']) || !Number.isInteger(message.character) || message.character < 0 || message.character > 3) return error(client, 'Invalid character selection');
        const room = client.room;
        if (!room || room.status !== 'lobby') return error(client, 'Character changes require a lobby');
        room.simulation.setCharacter(client.playerId, message.character);
        client.character = message.character;
        lobby(room);
        break;
      }
      case 'start': {
        if (!exact(message, ['type'])) return error(client, 'Invalid start message');
        const room = client.room;
        if (!room || client.playerId !== 0) return error(client, 'Only the room host may start');
        if (room.status !== 'lobby') return error(client, 'Run has already started or ended');
        if (room.members.length !== (room.mode === 'solo' ? 1 : 2) || room.members.some(member => member.ws.readyState !== WebSocket.OPEN)) return error(client, 'Waiting for both players');
        room.status = 'playing'; room.startedAt = now;
        for (const member of room.members) { member.input = neutralInput(); member.seq = -1; member.inputAt = 0; }
        state(room);
        break;
      }
      case 'rematch': {
        // After a finished run every member may ask to play again; when all
        // have, the same room starts a fresh run (new id, same mode, room and
        // characters). Votes last until the finished room expires or someone
        // leaves, which removes the room as before.
        if (!exact(message, ['type'])) return error(client, 'Invalid rematch message');
        const room = client.room;
        if (!room || room.status !== 'complete') return error(client, 'Rematch requires a finished run');
        client.rematch = true;
        const ready = room.members.filter(member => member.rematch).map(member => member.playerId);
        if (ready.length < room.members.length || room.members.some(member => member.ws.readyState !== WebSocket.OPEN)) {
          for (const member of room.members) send(member, { type: 'rematch', ready });
          break;
        }
        // A rematch compiles a new simulation, so it spends the creator's budget.
        const owner = ips.get(room.ip);
        if (owner && !consume(owner.creates, now)) {
          for (const member of room.members) error(member, 'Rematch rate limit exceeded; try again shortly');
          break;
        }
        let simulation;
        try {
          simulation = createSimulation({ mode: room.mode, roomIndex: room.roomIndex, sourceDir: options.sourceDir });
          for (const member of room.members) simulation.setCharacter(member.playerId, member.character);
        } catch { remove(room, 'Simulation is unavailable'); break; }
        room.simulation = simulation; room.id = randomUUID();
        room.status = 'playing'; room.startedAt = now; room.finishedAt = 0;
        for (const member of room.members) {
          member.rematch = false; member.input = neutralInput(); member.seq = -1; member.inputAt = 0;
          send(member, { type: 'restart', runId: room.id });
        }
        state(room);
        break;
      }
      case 'input': {
        const room = client.room;
        if (!room || room.status !== 'playing') return error(client, 'No active run');
        if (!exact(message, ['type', 'seq', 'input']) || !Number.isSafeInteger(message.seq) || message.seq < 0 || !validInput(message.input, room.simulation.weaponCount)) return error(client, 'Invalid input');
        if (message.seq <= client.seq) return error(client, 'Stale input sequence');
        client.seq = message.seq;
        // Retain an edge until the next tick even if a newer held-state packet
        // arrives first, then consume it exactly once. Never queue unlimited edges.
        client.input = { ...message.input, tap: client.input.tap || !!message.input.tap, prev: client.input.prev || message.input.prev, next: client.input.next || message.input.next, select: message.input.select >= 0 ? message.input.select : client.input.select };
        client.inputAt = now;
        break;
      }
      case 'leave':
        if (!exact(message, ['type'])) return error(client, 'Invalid leave message');
        leave(client, 'A player left the room; run aborted');
        break;
      case 'ping':
        if (!exact(message, ['type', 'at']) || !Number.isFinite(message.at) || message.at < 0 || message.at > Number.MAX_SAFE_INTEGER) return error(client, 'Invalid ping');
        send(client, { type: 'pong', at: message.at });
        break;
      default: return error(client, 'Unsupported message type');
    }
  }
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {});
    if (stopped || request.url !== '/online' || request.method !== 'GET') return refuse(socket, '404 Not Found');
    if (!allowedOrigin(request, allowed)) return refuse(socket, '403 Forbidden');
    const now = performance.now(), ipAddress = request.socket.remoteAddress;
    let ip = ips.get(ipAddress);
    if (!ip) {
      if (ips.size >= 1024) return refuse(socket, '503 Service Unavailable');
      ip = { connections: 0, seen: now, upgrades: bucket(limits.upgradeBurst, limits.upgradesPerSecond, now), creates: bucket(limits.createBurst, limits.createsPerSecond, now) };
      ips.set(ipAddress, ip);
    }
    ip.seen = now;
    if (!consume(ip.upgrades, now) || ip.connections >= limits.connectionsPerIp || connections.size >= limits.connections) return refuse(socket, '429 Too Many Requests');
    wss.handleUpgrade(request, socket, head, ws => {
      ip.connections++;
      const client = { ws, ip, ipAddress, room: null, lastMessage: now, aliveAt: now, strikes: 0, input: neutralInput(), messages: bucket(limits.messageBurst, limits.messagesPerSecond, now), controls: bucket(limits.controlBurst, limits.controlsPerSecond, now) };
      connections.add(client);
      ws.on('error', () => { leave(client, 'Connection error; run aborted'); });
      ws.on('close', () => {
        connections.delete(client); ip.connections--; ip.seen = performance.now();
        leave(client, 'A player disconnected; run aborted');
      });
      ws.on('pong', () => { client.aliveAt = performance.now(); });
      ws.on('ping', () => { if (!consume(client.messages, performance.now())) ws.terminate(); });
      ws.on('message', (data, binary) => {
        const at = performance.now();
        if (!consume(client.messages, at)) { leave(client, 'Message rate limit exceeded; run aborted'); ws.close(1008, 'Message rate limit exceeded'); return; }
        if (binary) { leave(client, 'Unsupported binary input; run aborted'); ws.close(1003, 'JSON text required'); return; }
        let message;
        try { message = JSON.parse(data.toString()); } catch { error(client, 'Invalid JSON'); if (++client.strikes >= 3) ws.close(1008, 'Invalid JSON'); return; }
        client.lastMessage = at;
        try { handle(client, message, at); }
        catch { leave(client, 'Server could not continue this run'); error(client, 'Server could not process the message'); }
      });
    });
  });

  function finish(room, now) {
    if (room.status !== 'playing') return;
    // A TCP close may be pending delivery when the simulation step completes.
    // Only connected members with a live input/heartbeat lease may rank.
    if (room.members.some(member => member.ws.readyState !== WebSocket.OPEN || member.ws._socket?.destroyed || member.ws.bufferedAmount > limits.buffered || now - member.lastMessage > limits.idleMs || now - member.aliveAt > limits.idleMs)) return remove(room, 'Connection lost; run aborted');
    const snapshot = room.simulation.snapshot();
    if (!room.simulation.completed || snapshot.players.length !== room.members.length || (room.mode === 'deathmatch' ? ![0, 1].includes(snapshot.game.winner) || !Number.isInteger(snapshot.game.fragLimit) || !snapshot.players.some(player => player.id !== snapshot.game.winner && player.deaths >= snapshot.game.fragLimit) : !snapshot.players.every(player => player.down && player.hp <= 0))) return remove(room, 'Invalid completion; run aborted');
    room.status = 'complete'; room.finishedAt = now;
    let recorded = false;
    try {
      if (room.mode !== 'deathmatch') { leaderboard.record({ id: room.id, names: room.members.map(member => member.name), score: snapshot.score, kills: snapshot.kills, level: snapshot.level, bestMultiplier: snapshot.combo.best, duration: snapshot.runTime, roomIndex: room.roomIndex, mode: room.mode, createdAt: new Date().toISOString() }); recorded = true; }
    } catch {
      for (const member of room.members) error(member, 'Run completed but leaderboard storage is unavailable');
    }
    for (const member of room.members) send(member, { type: 'result', runId: room.id, mode: room.mode, recorded });
    state(room);
  }
  let last = performance.now(), accumulator = 0;
  const simulationTimer = setInterval(() => {
    const now = performance.now(), elapsed = now - last;
    last = now;
    if (elapsed > 1000) {
      for (const room of rooms.values()) if (room.status === 'playing') remove(room, 'Server timing interrupted; run aborted');
      accumulator = 0;
      return;
    }
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= STEP * 1000 && steps++ < 5) {
      accumulator -= STEP * 1000;
      for (const room of rooms.values()) {
        if (room.status !== 'playing') continue;
        if (now - room.startedAt >= limits.runMs || room.members.some(member => now - member.lastMessage >= limits.idleMs || now - member.aliveAt >= limits.idleMs || member.ws.readyState !== WebSocket.OPEN)) { remove(room, 'Run timed out; aborted'); continue; }
        const inputs = room.members.map(member => {
          const input = now - member.inputAt <= limits.staleInputMs ? member.input : neutralInput();
          member.input = { ...member.input, prev: false, next: false, select: -1, tap: false };
          return input;
        });
        try { if (room.simulation.step(inputs)) finish(room, now); }
        catch { remove(room, 'Simulation could not continue; run aborted'); }
      }
    }
    if (steps > 5) accumulator = 0;
  }, 8);
  simulationTimer.unref();
  const snapshotTimer = setInterval(() => {
    for (const room of rooms.values()) if (room.status === 'playing') {
      try { state(room); } catch { remove(room, 'Snapshot unavailable; run aborted'); }
    }
  }, 50);
  snapshotTimer.unref();
  let lastPing = performance.now();
  const cleanupTimer = setInterval(() => {
    const now = performance.now();
    for (const client of connections) {
      if (now - client.lastMessage >= limits.idleMs || now - client.aliveAt >= limits.idleMs) { leave(client, 'Connection timed out; run aborted'); client.ws.terminate(); }
      else if (now - lastPing >= limits.idleMs / 3) client.ws.ping();
    }
    if (now - lastPing >= limits.idleMs / 3) lastPing = now;
    for (const room of rooms.values()) {
      if (room.status === 'lobby' && now - room.createdAt >= limits.lobbyMs) remove(room, 'Lobby expired');
      else if (room.status === 'complete' && now - room.finishedAt >= limits.finishedMs) remove(room, 'Completed room expired');
    }
    for (const [address, ip] of ips) if (!ip.connections && now - ip.seen > 60000 && ![...rooms.values()].some(room => room.ip === address)) ips.delete(address);
  }, Math.min(1000, Math.max(20, Math.min(limits.idleMs, limits.lobbyMs, limits.finishedMs) / 3)));
  cleanupTimer.unref();
  return {
    close() {
      if (stopped) return;
      stopped = true;
      clearInterval(simulationTimer); clearInterval(snapshotTimer); clearInterval(cleanupTimer);
      for (const room of rooms.values()) remove(room, 'Server shutting down; run aborted');
      for (const client of connections) client.ws.terminate();
      wss.close();
    },
  };
}
