import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSimulation, STEP } from '../backend/simulation.mjs';
import { neutralInput, validInput } from '../backend/protocol.mjs';
import { input, fixtureSources, defeatSetup } from './helpers.mjs';

test('actual shared simulation runs all rooms and all original modes headlessly', () => {
  const count = createSimulation().roomCount;
  for (let roomIndex = 0; roomIndex < count; roomIndex++) for (const mode of ['solo', 'coop', 'deathmatch']) {
    const simulation = createSimulation({ mode, roomIndex, seed: 123 });
    const inputs = Array.from({ length: mode === 'solo' ? 1 : 2 }, neutralInput);
    for (let i = 0; i < 90; i++) simulation.step(inputs);
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.game.roomIndex, roomIndex);
    assert.equal(snapshot.game.demo, false);
    assert.equal(snapshot.players.length, inputs.length);
    if (mode === 'deathmatch') {
      assert.equal(snapshot.game.mode, 3);
      assert.equal(snapshot.zombies.length, 0);
      assert.ok(snapshot.players.every(player => player.have.every(Boolean)));
      assert.ok(snapshot.players.every(player => player.ammo.slice(1).every(ammo => ammo === 0)));
    } else assert.ok(snapshot.zombies.length > 0);
    assert.ok(Math.abs(snapshot.runTime - 90 * STEP) < 1e-8);
    assert.equal(snapshot.players[0].ammo[0], null);
    for (const excluded of ['particles', 'room', 'fields', 'navCost', 'blockGrid', 'ctx']) assert.equal(Object.hasOwn(snapshot, excluded), false);
    assert.ok(snapshot.players[0].look);
  }
});

test('fixed step and server seed reproduce combat without client time or randomness', () => {
  const a = createSimulation({ seed: 1 }), b = createSimulation({ seed: 1 }), c = createSimulation({ seed: 2 });
  for (let i = 0; i < 300; i++) for (const simulation of [a, b, c]) simulation.step([input({ fire: true })]);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.snapshot().zombies, c.snapshot().zombies);
  assert.equal(a.tick, 300);
  assert.match(a.sourceHash, /^[a-f0-9]{64}$/);
});

test('movement speed is fixed and weapon selection cannot grant locked ammo', () => {
  const simulation = createSimulation({ seed: 1 });
  const start = simulation.snapshot().players[0];
  for (let i = 0; i < 6; i++) simulation.step([input({ dx: 1, dy: 1, select: simulation.weaponCount - 1, fire: true })]);
  const player = simulation.snapshot().players[0];
  // 6 server steps = 5 original logic ticks. Original diagonal axes each
  // advance .16 cells/tick; diagonal speed is deliberately not normalized.
  assert.equal(simulation.snapshot().ticks, 5);
  assert.ok(Math.abs(player.x - start.x - 0.8) < 0.001);
  assert.ok(Math.abs(player.y - start.y - 0.8) < 0.001);
  assert.equal(player.weapon, 0);
  assert.ok(player.ammo.slice(1).every(ammo => ammo === 0));
  const clone = simulation.snapshot(); clone.players[0].hp = 999999;
  assert.equal(simulation.snapshot().players[0].hp, start.hp);
});

test('invalid numeric inputs, extra state and invalid selectors never enter simulation', () => {
  const simulation = createSimulation();
  for (const invalid of [input({ dx: NaN }), input({ dy: Infinity }), input({ dx: 0.1 }), input({ dy: 2 }), input({ fire: 1 }), input({ tap: 1 }), input({ select: 999 }), input({ select: -2 }), input({ select: 0.5 }), input({ score: 999 }), { __proto__: input() }, null, []]) {
    assert.equal(validInput(invalid, simulation.weaponCount), false);
    assert.throws(() => simulation.step([invalid]), TypeError);
  }
  assert.equal(simulation.tick, 0);
});

test('real damage completes defeat once and stops simulation after completion', t => {
  const sourceDir = fixtureSources(t, defeatSetup);
  for (const mode of ['solo', 'coop']) {
    const simulation = createSimulation({ mode, sourceDir });
    const inputs = Array.from({ length: mode === 'solo' ? 1 : 2 }, neutralInput);
    assert.equal(simulation.completed, false);
    for (let i = 0; i < 6 && !simulation.completed; i++) simulation.step(inputs);
    assert.equal(simulation.completed, true);
    const snapshot = simulation.snapshot();
    assert.ok(snapshot.players.every(player => player.hp === 0 && player.down));
    assert.equal(snapshot.game.state, 'over');
    assert.equal(simulation.step(inputs), true);
    assert.equal(simulation.tick, 2);
    assert.deepEqual(simulation.snapshot(), snapshot);
  }
});

test('actual kills award shared progression and unlocks, without a score API', t => {
  const sourceDir = fixtureSources(t, `
spawnZ = []; spawnD = [];
for (let i = 0; i < 10; i++) {
  const z = makeZombie(players[0].x + 1, players[0].y, false);
  z.hp = 1; z.speed = 0; z.shootable = true; zombies.push(z);
  affect(z, { type: 'bullet', damage: 50, x: z.x - 1, y: z.y });
}
`);
  const simulation = createSimulation({ sourceDir, seed: 20 });
  for (let i = 0; i < 300; i++) simulation.step([input({ fire: true })]);
  const snapshot = simulation.snapshot();
  assert.ok(snapshot.kills >= 3);
  assert.ok(snapshot.combo.best > 1);
  assert.ok(snapshot.players[0].ammo[1] > 0);
  assert.ok(snapshot.score > 0);
  assert.equal(Object.hasOwn(simulation, 'setScore'), false);
});

test('new rooms reload source while existing rooms remain pinned', t => {
  const sourceDir = fixtureSources(t, '');
  const old = createSimulation({ sourceDir, seed: 3 });
  const file = join(sourceDir, '01-data.js');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// a new shared build\n');
  const next = createSimulation({ sourceDir, seed: 3 });
  assert.notEqual(old.sourceHash, next.sourceHash);
  for (let i = 0; i < 10; i++) { old.step([input()]); next.step([input()]); }
  assert.deepEqual(old.snapshot(), next.snapshot());
});


test('local fidelity inspection returns actual shared tables without mutation access', () => {
  const simulation = createSimulation();
  const rules = simulation.rules();
  assert.equal(rules.rooms.length, simulation.roomCount);
  assert.equal(rules.weapons.length, simulation.weaponCount);
  assert.ok(rules.weapons.every(weapon => Number.isFinite(weapon.unlock)));
  assert.ok(rules.rooms.every(room => Array.isArray(room.map)));
  rules.weapons[0].damage = 999999;
  assert.notEqual(simulation.rules().weapons[0].damage, 999999);
});
