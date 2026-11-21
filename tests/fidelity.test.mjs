import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSimulation } from '../backend/simulation.mjs';
import { fixtureSources, input } from './helpers.mjs';

// Independent acceptance data: progression milestones extracted from the
// publisher binary's CUpgrades.InitLists, rather than copied from src tables.
const original = JSON.parse(readFileSync(new URL('./fixtures/original-progression.json', import.meta.url)));
const step = (sim, n, value = input()) => {
  for (let i = 0; i < n && !sim.completed; i++) sim.step(Array.from({ length: sim.snapshot().players.length }, () => value));
};

test('original binary progression: every milestone and all ten weapon unlocks', () => {
  const { upgrades, weapons, rooms } = createSimulation().rules();
  assert.equal(original.sha256, '34ff145d96891ddea20278700c8b1fb6fd6273ca0e71b73d8bdf0df183fdbece');
  assert.equal(upgrades.length, 58);
  assert.deepEqual(upgrades.map(({ name, ...rule }) => rule), original.upgrades);
  assert.deepEqual(weapons.map(w => [w.id, w.key, w.unlock]), [
    ['pistol', 1, 1], ['uzi', 2, 5], ['shotgun', 3, 10], ['barrel', 4, 15],
    ['grenade', 5, 20], ['fakewall', 6, 30], ['mine', 7, 40], ['rocket', 8, 50],
    ['chargepack', 9, 55], ['railgun', 0, 70],
  ]);
  assert.equal(rooms.length, 18);
  assert.deepEqual(rooms.map(r => r.id), Array.from({ length: 18 }, (_, i) => `ROOM_Single_${String(i + 1).padStart(4, '0')}`));
});

test('original normal speed: 30 server updates run exactly 25 logic ticks', () => {
  const sim = createSimulation();
  step(sim, 30);
  assert.equal(sim.snapshot().ticks, 25);
  assert.equal(sim.snapshot().players[0].max, 200);
  assert.deepEqual(sim.rules().difficulties.map(d => [d.level, d.multiplier]), [[1, 1], [10, 10], [20, 30], [35, 50]]);
});

test('original pistol requires a fresh press until the x3 fast-fire upgrade', t => {
  const sim = createSimulation({ sourceDir: fixtureSources(t, 'spawnZ = []; spawnD = [];') });
  step(sim, 60, input({ fire: true }));
  assert.equal(sim.snapshot().tracers.length, 0);
  step(sim, 60, input({ fire: true }));
  assert.equal(sim.snapshot().tracers.length, 0);
  step(sim, 2, input({ fire: false }));
  const fresh = new Set();
  for (let i = 0; i < 6; i++) { sim.step([input({ fire: true })]); for (const shot of sim.snapshot().tracers) fresh.add(shot.id); }
  assert.equal(fresh.size, 1);
  const rapid = createSimulation({ sourceDir: fixtureSources(t, 'spawnZ = []; spawnD = []; setMultiplier(3);') });
  // At least one tracer is produced after many consecutive held ticks.
  let shots = 0;
  for (let i = 0; i < 90; i++) { rapid.step([input({ fire: true })]); shots += rapid.snapshot().tracers.length; }
  assert.ok(shots > 10);
});

test('original kill gives +1 multiplier, awards points with new multiplier, retains unlock on decay', t => {
  const sim = createSimulation({ sourceDir: fixtureSources(t, `
spawnZ = []; spawnD = [];
for (let i = 0; i < 4; i++) {
  const z = makeZombie(players[0].x + 1, players[0].y, false);
  z.hp = 1; z.speed = 0; zombies.push(z);
  affect(z, { type: 'bullet', damage: 26, x: z.x - 1, y: z.y });
}
`) });
  step(sim, 30);
  const killed = sim.snapshot();
  assert.equal(killed.kills, 4);
  assert.equal(killed.combo.best, 5);
  assert.equal(killed.score, 100 * (2 + 3 + 4 + 5));
  assert.equal(killed.players[0].ammo[1], 100);
  step(sim, 120);
  const decayed = sim.snapshot();
  assert.ok(decayed.combo.level < 5);
  assert.equal(decayed.players[0].have[1], true);
  assert.equal(decayed.players[0].ammo[1], 100);
});

test('original continuous health regeneration restores one full bar per 30 seconds', t => {
  const sim = createSimulation({ sourceDir: fixtureSources(t, 'spawnZ = []; spawnD = []; players[0].hp = 100;') });
  step(sim, 30);
  assert.ok(Math.abs(sim.snapshot().players[0].hp - (100 + 200 / 30)) < 0.001);
});

test('server preserves original death delay rather than ending at lethal damage', t => {
  const sim = createSimulation({ sourceDir: fixtureSources(t, `
spawnZ = []; spawnD = []; players[0].inv = 0;
affect(players[0], { type: 'zombie', damage: 250, x: players[0].x - 1, y: players[0].y });
`) });
  step(sim, 6);
  assert.equal(sim.snapshot().players[0].down, true);
  assert.equal(sim.completed, false);
  assert.equal(sim.snapshot().game.state, 'playing');
  step(sim, 180);
  assert.equal(sim.completed, true);
  assert.ok(sim.snapshot().runTime > 3);
});

test('original co-op respawns a dead partner with a pistol and full health', t => {
  const sim = createSimulation({ mode: 'coop', sourceDir: fixtureSources(t, `
spawnZ = []; spawnD = []; players[0].inv = 0;
affect(players[0], { type: 'zombie', damage: 250, x: players[0].x - 1, y: players[0].y });
`) });
  step(sim, 6);
  assert.equal(sim.snapshot().players[0].down, true);
  step(sim, 240);
  const p = sim.snapshot().players[0];
  assert.equal(sim.completed, false);
  assert.equal(p.down, false);
  assert.equal(p.hp, 200);
  assert.equal(p.weapon, 0);
  assert.ok(p.ammo.slice(1).every(n => n === 0));
});

test('all original room collision cells and marker placements match independent conversion', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/original-room-digests.json', import.meta.url)));
  const rooms = createSimulation().rules().rooms;
  for (const room of rooms) {
    const data = [room.id, room.cols, room.rows, room.map, room.barrels, room.walls,
      room.zombieSpawns, room.devilSpawns,
      room.playerSpawns.map(p => [p.c, p.r, Math.round(p.angle * 180 / Math.PI), p.first]), room.pickups];
    assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'), expected.find(r => r.id === room.id).sha256, room.id);
  }
});
