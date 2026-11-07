import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Leaderboard } from '../backend/leaderboard.mjs';

function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'deadrooms-board-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const entry = changes => ({ id: randomUUID(), names: ['Alice'], score: 100, kills: 1, level: 1, bestMultiplier: 2, duration: 10, roomIndex: 0, mode: 'solo', createdAt: '2026-11-06T12:00:00.000Z', ...changes });

test('atomic persistence survives a new store and deduplicates completed run ids', t => {
  const dir = directory(t), store = new Leaderboard(dir), run = entry();
  assert.equal(store.record(run), true);
  assert.equal(store.record(run), false);
  const restarted = new Leaderboard(dir);
  assert.deepEqual(restarted.list(), [run]);
  assert.equal(restarted.record(run), false);
  assert.deepEqual(readdirSync(dir), ['leaderboard.json']);
  const copy = restarted.list(); copy[0].names.push('Eve');
  assert.deepEqual(restarted.list()[0].names, ['Alice']);
});

test('bounded board retains the best 50 per category and returns global top 50', t => {
  const store = new Leaderboard(directory(t));
  for (let i = 0; i < 55; i++) store.record(entry({ score: i }));
  assert.equal(store.list().length, 50);
  assert.equal(store.list()[0].score, 54);
  assert.equal(store.list()[49].score, 5);
  store.record(entry({ score: 1000, roomIndex: 1 }));
  store.record(entry({ score: 999, names: ['Alice', 'Bob'], mode: 'coop' }));
  assert.equal(store.list()[0].score, 1000);
  assert.equal(store.list({ roomIndex: 0, mode: 'solo' }).length, 50);
  assert.equal(store.list({ mode: 'coop' }).length, 1);
  assert.equal(JSON.parse(readFileSync(store.file)).entries.length, 52);
});

test('corruption, oversized files and invalid persisted rows cannot become scores', t => {
  const dir = directory(t), file = join(dir, 'leaderboard.json');
  for (const contents of ['{broken', 'null', 'x'.repeat(1024 * 1024 + 1)]) {
    writeFileSync(file, contents);
    assert.deepEqual(new Leaderboard(dir).list(), []);
    assert.ok(readdirSync(dir).includes('leaderboard.corrupt.json'));
  }
  const valid = entry();
  writeFileSync(file, JSON.stringify({ version: 1, entries: [valid, valid, entry({ score: 1e30 }), entry({ names: ['<script>'] }), entry({ duration: -1 }), entry({ mode: 'deathmatch' }), entry({ createdAt: 'oops' })] }));
  assert.deepEqual(new Leaderboard(dir).list(), [valid]);
});

test('invalid completion rows are rejected before any file is written', t => {
  const dir = directory(t), store = new Leaderboard(dir);
  for (const changes of [{ score: NaN }, { kills: Infinity }, { level: 0 }, { names: ['Alice', 'Bob'] }, { mode: 'deathmatch' }, { duration: 0 }, { roomIndex: -1 }]) {
    assert.throws(() => store.record(entry(changes)), TypeError);
  }
  assert.deepEqual(readdirSync(dir), []);
});
