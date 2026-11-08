import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { neutralInput, validInput } from './protocol.mjs';

const defaultSources = fileURLToPath(new URL('../src/', import.meta.url));
export const STEP = 1 / 30;
const bootstrap = `
const noop = () => {};
const graphics = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' || key === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop });
const element = () => ({ getContext: () => graphics, style: {}, width: 1, height: 1 });
const document = { getElementById: element, createElement: element };
const sfx = new Proxy({}, { get: () => noop });
function wallShadows() { return null; }
function renderFloor() {}
function gatherInput(p) { return __inputs[p.id]; }
`;
const snapshotCode = `JSON.stringify({
  game: { state: game.state === 'over' ? 'over' : 'playing', mode: game.mode, roomIndex: game.roomIndex, playerCount: players.length, demo: false, options: game.options, characters: game.characters, winner: game.winner ?? null, fragLimit: game.fragLimit ?? 10 },
  ticks,
  players, zombies, corpses, barrels, blocks, mines, pickups, shots, tracers, blasts, texts,
  score, kills, level, toSpawn, intermission, runTime, combo, upgrades, banner, toast, clock, shake, flashLight
})`;
const snapshotScript = new vm.Script(snapshotCode);
const stepScript = new vm.Script(`
if (game.state === 'playing') {
  update(1 / 30);
  // Shared playerDead() owns the original death delay and cooperative respawn.
  // Never replace its lifecycle with an early server-only game-over rule.
}
game.state === 'over';
`);

export function createSimulation({ mode = 'solo', roomIndex = 0, playerCount = mode === 'solo' ? 1 : 2, sourceDir = defaultSources, seed = randomBytes(4).readUInt32LE() } = {}) {
  if (!['solo', 'coop', 'deathmatch'].includes(mode)) throw new RangeError('Unsupported mode');
  if (!Number.isInteger(playerCount) || playerCount < (mode === 'solo' ? 1 : 2) || playerCount > (mode === 'solo' ? 1 : 6)) throw new RangeError('Invalid player count');
  // Read together for every new room; no stale process-wide Script cache when
  // the shared simulation changes during development. Existing rooms stay pinned.
  const files = ['01-data.js', '02-world.js', '03-combat.js', '07-main.js'];
  const sources = files.map(name => readFileSync(join(sourceDir, name), 'utf8'));
  const reset = sources[3].match(/^function resetRun\([^]*?^}/m)?.[0];
  if (!reset) throw new Error('Shared resetRun is unavailable');
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  new vm.Script([bootstrap, ...sources.slice(0, 3), reset].join('\n')).runInContext(context, { timeout: 1000 });
  const metadata = JSON.parse(vm.runInContext('JSON.stringify({roomCount: ROOMS.length, weaponCount: WEAPONS.length})', context, { timeout: 100 }));
  if (!Number.isInteger(roomIndex) || roomIndex < 0 || roomIndex >= metadata.roomCount) throw new RangeError('Invalid room');
  context.__seed = seed;
  context.__mode = mode === 'solo' ? 1 : mode === 'coop' ? 2 : 3;
  context.__playerCount = playerCount;
  context.__roomIndex = roomIndex;
  context.__inputs = Array.from({ length: context.__playerCount }, neutralInput);
  vm.runInContext('Math.random = seeded(__seed); game.demo = false; game.state = "playing"; game.playerCount = __playerCount; game.characters = Array.from({length:Math.max(2,__playerCount)}, (_,i)=>i===0?3:(i-1)%4); resetRun(__mode, __roomIndex);', context, { timeout: 1000 });
  let tick = 0, completed = false;
  return Object.freeze({
    ...metadata,
    playerCount,
    sourceHash: createHash('sha256').update(sources.join('\n')).digest('hex'),
    // Local audit hook for the integrating developer; never exposed over WS.
    rules() {
      return JSON.parse(vm.runInContext('JSON.stringify({ rooms: ROOMS, weapons: WEAPONS, upgrades: UPGRADES, rules: RULES, defaults: DEFAULT_OPTIONS, difficulties: DIFFICULTIES, levels: buildLevels(true).slice(1) })', context, { timeout: 100 }));
    },
    setCharacter(playerId, character) {
      if (tick !== 0 || !Number.isInteger(playerId) || playerId < 0 || playerId >= context.__playerCount || !Number.isInteger(character) || character < 0 || character > 3) throw new RangeError('Invalid lobby character');
      context.__slot = playerId; context.__character = character;
      vm.runInContext('game.characters[__slot] = __character; players[__slot].look = CHARACTERS[__character].key;', context, { timeout: 100 });
    },
    get tick() { return tick; },
    get completed() { return completed; },
    step(inputs) {
      if (completed) return true;
      if (!Array.isArray(inputs) || inputs.length !== context.__playerCount || !inputs.every(input => validInput(input, metadata.weaponCount))) throw new TypeError('Invalid simulation input');
      context.__inputs = inputs.map(input => ({ ...input }));
      completed = stepScript.runInContext(context, { timeout: 100 });
      tick++;
      return completed;
    },
    snapshot() { return JSON.parse(snapshotScript.runInContext(context, { timeout: 100 })); },
  });
}
