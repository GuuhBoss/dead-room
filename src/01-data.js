'use strict';
/*
 * Dead Rooms: an unofficial tribute to Sean Cooper's Boxhead: 2Play Rooms.
 * Canvas 2D graphics and Web Audio sound; no image or audio files.
 *
 * The camera is fixed and oblique: the floor is seen from above, heights rise
 * straight up the screen, and characters are lit boxes facing eight directions.
 */

// ─── Geometry and look ──────────────────────────────────────────────────────
const CELL = 40, COLS = 32, ROWS = 19, WALL_H = 56;
const FLOOR_W = COLS * CELL, FLOOR_H = ROWS * CELL;
const W = FLOOR_W, H = FLOOR_H + WALL_H;          // 1280 × 816 logical pixels
const FY = 0.66, FZ = 0.75;                       // how character depth and height reach the screen
const VIEW_Y = 0.75, VIEW_Z = 0.66;               // direction toward the camera
const SHADOW_X = -0.6, SHADOW_Y = 0.22;           // shadow offset per pixel of height
const LIGHT = [0.49, 0.36, 0.79];
const TAU = Math.PI * 2, OCT = Math.PI / 4;
const BARREL_R = 15, BARREL_TALL = 34, BLOCK_TALL = 34;
const ATTACK_TIME = 0.42, ATTACK_HIT = 0.2;
const OUTLINE = 'rgba(16,17,19,0.9)';
const FONT = '"Lilita One", "Arial Black", Impact, sans-serif';

// Map legend: # wall, P pillar, D door (zombies only), b barrel, 1/2 player starts.
const ROOMS = [
  {
    name: 'The Gates',
    note: 'Two doors, two barrel lanes',
    map: [
      '############PPDDDDPP############',
      '#...........PP....PP...........#',
      '#............b....b............#',
      '#............b....b............#',
      '#............b....b............#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#.............1..2.............#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#............b....b............#',
      '#............b....b............#',
      '#............b....b............#',
      '#..............................#',
      '#...........PP....PP...........#',
      '############PPDDDDPP############',
    ],
  },
  {
    name: 'Crossroads',
    note: 'Four doors, four corners',
    map: [
      '############PPDDDDPP############',
      '#...........PP....PP...........#',
      '#..............................#',
      '#..............................#',
      '#....######..........######....#',
      '#....#..b..............b..#....#',
      '#....#....................#....#',
      '#..............................#',
      'D..............................D',
      'D..........b..1..2..b..........D',
      'D..............................D',
      '#..............................#',
      '#....#..b..............b..#....#',
      '#....#....................#....#',
      '#....######..........######....#',
      '#..............................#',
      '#..............................#',
      '#...........PP....PP...........#',
      '############PPDDDDPP############',
    ],
  },
  {
    name: 'The Bunker',
    note: 'A room inside the room',
    map: [
      '###DDDD#########################',
      '#..............................#',
      '#..............................#',
      '#.....b.....................b..D',
      '#..............................D',
      '#..............................D',
      '#.........#####..#####.........#',
      '#.........#..........#.........#',
      '#.........#..........#.........#',
      '#..b..........1..2..........b..#',
      '#.........#..........#.........#',
      '#.........#..........#.........#',
      '#.........#####..#####.........#',
      'D..............................#',
      'D..............................#',
      'D...b.......................b..#',
      '#..............................#',
      '#..............................#',
      '#########################DDDD###',
    ],
  },
  {
    name: 'Pillar Hall',
    note: 'Cover everywhere, doors too',
    map: [
      '############PPDDDDPP############',
      '#...........PP....PP...........#',
      '#..............................#',
      '#..............................#',
      '#.....PP................PP.....#',
      '#.....PP................PP.....#',
      '#..........b........b..........#',
      '#..............................#',
      'D..............................D',
      'D.........PP..1..2..PP.........D',
      'D.........PP........PP.........D',
      '#..............................#',
      '#..........b........b..........#',
      '#.....PP................PP.....#',
      '#.....PP................PP.....#',
      '#..............................#',
      '#..............................#',
      '#...........PP....PP...........#',
      '############PPDDDDPP############',
    ],
  },
];

// Weapons unlock as the kill multiplier reaches new highs, as in Boxhead.
const WEAPONS = [
  { id: 'pistol', name: 'Pistol', short: 'PISTOL', kind: 'gun', unlock: 1, rate: 0.3, damage: 40, range: 470, pellets: 1, spread: 0, knock: 70, start: Infinity, refill: 0 },
  { id: 'uzi', name: 'Uzi', short: 'UZI', kind: 'gun', unlock: 2, rate: 0.085, damage: 19, range: 440, pellets: 1, spread: 0.07, knock: 40, start: 150, refill: 120 },
  { id: 'shotgun', name: 'Shotgun', short: 'SHOTGUN', kind: 'gun', unlock: 4, rate: 0.75, damage: 26, range: 290, pellets: 7, spread: 0.4, knock: 120, start: 24, refill: 18 },
  { id: 'barrel', name: 'Barrels', short: 'BARRELS', kind: 'barrel', unlock: 6, rate: 0.35, start: 6, refill: 5 },
  { id: 'grenade', name: 'Grenades', short: 'GRENADE', kind: 'grenade', unlock: 8, rate: 0.6, start: 8, refill: 6 },
  { id: 'wall', name: 'Fake Walls', short: 'WALLS', kind: 'wall', unlock: 10, rate: 0.3, start: 8, refill: 6 },
  { id: 'rocket', name: 'Rockets', short: 'ROCKETS', kind: 'rocket', unlock: 12, rate: 0.85, start: 12, refill: 8 },
  { id: 'mine', name: 'Mines', short: 'MINES', kind: 'mine', unlock: 14, rate: 0.4, start: 6, refill: 5 },
  { id: 'railgun', name: 'Railgun', short: 'RAILGUN', kind: 'rail', unlock: 16, rate: 1.0, damage: 260, start: 10, refill: 6 },
];
const UPGRADES = [
  { level: 3, key: 'pistolRapid', text: 'Pistol: rapid fire' },
  { level: 5, key: 'uziDamage', text: 'Uzi: hollow points' },
  { level: 7, key: 'shotgunSpread', text: 'Shotgun: wide spread' },
  { level: 9, key: 'pistolDamage', text: 'Pistol: double damage' },
  { level: 11, key: 'barrelBlast', text: 'Barrels: bigger blast' },
  { level: 13, key: 'uziRapid', text: 'Uzi: rapid fire' },
  { level: 15, key: 'rocketBlast', text: 'Rockets: bigger blast' },
];
// Gun models sit in the right hand; the first box's front face is the muzzle.
const GUNS = {
  pistol: [{ u: 17, v: 33, z: 59, w: 5, d: 14, h: 7, color: '#3a3d42' }],
  uzi: [{ u: 17, v: 36, z: 59, w: 6, d: 20, h: 8, color: '#2b2d31' }, { u: 17, v: 31, z: 51, w: 4, d: 5, h: 9, color: '#1d1e21' }],
  shotgun: [{ u: 17, v: 42, z: 60, w: 5, d: 30, h: 5, color: '#2f3135' }, { u: 17, v: 24, z: 57, w: 6, d: 12, h: 8, color: '#6f4a2a' }],
  rocket: [{ u: 15, v: 20, z: 70, w: 10, d: 44, h: 10, color: '#56662d' }],
  railgun: [{ u: 17, v: 38, z: 59, w: 7, d: 26, h: 8, color: '#3d4e5e', top: '#8ff4ff' }],
};
const LOOKS = {
  zombie: { shirt: '#eef2f3', vest: '#8c98a1', sleeve: '#c9d2d8', skin: '#9fadb8', pants: '#5d6468', shoe: '#3d4245', head: '#2a2c2e', scale: 1.2 },
  devil: { shirt: '#c6372c', vest: '#8f241d', sleeve: '#b8322a', skin: '#5f1813', pants: '#5c1714', shoe: '#2b0d0b', head: '#3b1310', horn: '#e2d2b0', scale: 1.38 },
  p1: { suit: '#1d2357', pants: '#151a40', shoe: '#1a1a1c', skin: '#e2b994', hair: '#1c1a19', shirt: '#f2f2f2', tie: '#b3261e', scale: 1.2, tag: '#4f7bff' },
  p2: { suit: '#4b5c2c', pants: '#3a3a2a', shoe: '#2a1d14', skin: '#c99671', hair: '#5a3418', shirt: '#e9e3cf', tie: '#2b2b2b', scale: 1.2, tag: '#9bd13d' },
};

// ─── Small helpers ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const snap = a => Math.round(a / OCT) * OCT;
const turn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const pad = (n, len) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shaded and whitened variants of a base colour, cached as CSS strings.
const tints = new Map();
function tint(hex, light, white = 0) {
  const l = Math.round(light * 40), w = Math.round(white * 10), key = hex + l + '/' + w;
  let css = tints.get(key);
  if (!css) {
    const n = parseInt(hex.slice(1), 16);
    const ch = v => Math.round(Math.min(255, (v * l) / 40) * (1 - w / 10) + 25.5 * w);
    css = `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    tints.set(key, css);
  }
  return css;
}

// ─── Run state ──────────────────────────────────────────────────────────────
const game = { state: 'menu', mode: 1, roomIndex: 0, demo: true, frozen: false, dying: 0, overAt: 0 };
const menu = { mode: 1, room: 0 };
let room = null;
let players = [], zombies = [], corpses = [], barrels = [], blocks = [], mines = [], pickups = [], shots = [];
let particles = [], tracers = [], blasts = [], texts = [];
let blockGrid = new Array(COLS * ROWS).fill(null);
let score = 0, kills = 0, level = 0, toSpawn = 0, spawnTimer = 0, spawnGap = 1, maxAlive = 40, devilChance = 0;
let intermission = 0, pickupTimer = 8, groanTimer = 3, navTimer = 0, navDirty = true, runTime = 0;
let shake = 0, flashLight = 0, clock = 0;
let combo = { level: 1, bar: 0, best: 1, pulse: 0 }, upgrades = {};
let banner = null, toast = null;
