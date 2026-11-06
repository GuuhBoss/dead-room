// ─── Input ──────────────────────────────────────────────────────────────────
const keys = new Set(), pressed = new Set();
const BINDS = {
  solo: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], fire: ['Space', 'KeyJ'], prev: ['KeyQ', 'KeyZ'], next: ['KeyE', 'KeyX'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], fire: ['Space', 'KeyG'], prev: ['KeyQ'], next: ['KeyE'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], fire: ['Enter', 'NumpadEnter', 'Slash', 'Numpad0'], prev: ['Comma'], next: ['Period'] },
};
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'Slash', 'Quote', 'Tab']);
const touch = { on: false, dx: 0, dy: 0, fire: false, swap: false };
const pads = { list: [], prev: new Map() };

function gatherInput(p) {
  const b = BINDS[game.mode === 1 ? 'solo' : p.id ? 'p2' : 'p1'];
  const held = list => list.some(k => keys.has(k)), hit = list => list.some(k => pressed.has(k));
  const input = { dx: held(b.right) - held(b.left), dy: held(b.down) - held(b.up), fire: held(b.fire), prev: hit(b.prev), next: hit(b.next), select: -1 };
  if (p.id === 0) for (let i = 0; i < 9; i++) if (pressed.has(`Digit${i + 1}`)) input.select = i;
  const pad = padFor(p.id);
  if (pad) {
    if (pad.dx || pad.dy) { input.dx = pad.dx; input.dy = pad.dy; }
    input.fire ||= pad.fire; input.prev ||= pad.prev; input.next ||= pad.next;
  }
  if (p.id === 0 && touch.on) {
    if (touch.dx || touch.dy) { input.dx = touch.dx; input.dy = touch.dy; }
    input.fire ||= touch.fire;
    input.next ||= touch.swap;
    touch.swap = false;
  }
  return input;
}

function pollPads() {
  const raw = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(g => g && g.connected) : [];
  pads.list = raw.map(g => {
    const prev = pads.prev.get(g.index) || [];
    const held = g.buttons.map(b => b.pressed || b.value > 0.5);
    pads.prev.set(g.index, held);
    const edge = i => held[i] && !prev[i];
    let dx = g.axes[0] || 0, dy = g.axes[1] || 0;
    if (Math.hypot(dx, dy) < 0.4) dx = dy = 0;
    if (held[14]) dx = -1;
    if (held[15]) dx = 1;
    if (held[12]) dy = -1;
    if (held[13]) dy = 1;
    return { dx, dy, fire: held[0] || held[2] || held[7], prev: edge(4), next: edge(5) || edge(3), start: edge(9), a: edge(0), left: edge(14), right: edge(15) };
  });
  for (const pad of pads.list) {
    if (pad.start) { if (game.state === 'playing') setPaused(true); else if (game.state === 'paused') setPaused(false); }
    if (pad.a && (game.state === 'menu' || (game.state === 'over' && performance.now() - game.overAt > 800))) startGame();
    if (game.state === 'menu' && (pad.left || pad.right)) chooseRoom(menu.room + (pad.left ? -1 : 1));
  }
}

// One pad drives player 1 in solo; in co-op a lone pad goes to player 2.
function padFor(id) {
  const l = pads.list;
  if (game.mode === 1) return id === 0 ? l[0] || null : null;
  if (l.length >= 2) return l[id];
  return id === 1 ? l[0] || null : null;
}

// The attract-mode survivors turn toward the nearest zombie and fire.
function aiInput(p, dt) {
  const input = { dx: 0, dy: 0, fire: false, prev: false, next: false, select: -1 };
  p.ai = p.ai || { swap: rand(2, 4) };
  if ((p.ai.swap -= dt) <= 0) { p.ai.swap = rand(3, 6); input.select = pick([0, 1, 2, 6, 8].filter(i => available(p, i))); }
  let target = null, best = Infinity;
  for (const z of zombies) {
    if (z.dead || z.x < 0 || z.y < 0 || z.x > FLOOR_W || z.y > FLOOR_H) continue;
    const d = dist(p, z);
    if (d < best) { best = d; target = z; }
  }
  const home = room.starts[p.id] || room.starts[0];
  const goHome = dist(p, home) > (target ? 150 : 24);
  const want = target ? snap(Math.atan2(target.y - p.y, target.x - p.x)) : snap(Math.atan2(home.y - p.y, home.x - p.x));
  if (!target || Math.abs(turn(p.angle, want)) > 0.1 || (goHome && best > 140)) {
    const a = target && !goHome ? want : snap(Math.atan2(home.y - p.y, home.x - p.x));
    if (target || goHome) { input.dx = Math.round(Math.cos(a)); input.dy = Math.round(Math.sin(a)); }
  } else input.fire = true;
  return input;
}

// ─── Game flow ──────────────────────────────────────────────────────────────
function resetRun(mode, roomIndex) {
  game.mode = mode;
  game.roomIndex = roomIndex;
  loadRoom(roomIndex);
  clearDecals();
  players = [];
  for (let i = 0; i < mode; i++) players.push(makePlayer(i, room.starts[i].x, room.starts[i].y));
  zombies = []; corpses = []; blocks = []; mines = []; pickups = []; shots = [];
  particles = []; tracers = []; blasts = []; texts = [];
  barrels = room.barrelSpots.map(({ x, y }) => ({ x, y, hp: 30, lit: false, fuse: 0, flash: 0, drop: 0 }));
  blockGrid = new Array(COLS * ROWS).fill(null);
  score = 0; kills = 0; level = 0; intermission = 0; pickupTimer = 8; runTime = 0; shake = 0; flashLight = 0;
  combo = { level: 1, bar: 0, best: 1, pulse: 0 };
  upgrades = {};
  banner = null; toast = null;
  navDirty = true;
  refreshNav();
  nextLevel();
}

function startDemo() {
  game.demo = true;
  resetRun(2, menu.room);
  combo.best = 4;
  for (const p of players) { p.ammo = p.ammo.map(() => Infinity); p.invuln = 0; }
}

function startGame() {
  sfx.init();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  for (const id of ['menu', 'pause', 'over']) $(id).hidden = true;
  game.demo = false;
  game.state = 'playing';
  keys.clear();
  resetRun(menu.mode, menu.room);
  $('touch').hidden = !touch.used;
}

function setPaused(on) {
  if (on && game.state === 'playing') {
    game.state = 'paused';
    keys.clear();
    $('pause').hidden = false;
    $('touch').hidden = true;
  } else if (!on && game.state === 'paused') {
    game.state = 'playing';
    $('pause').hidden = true;
    $('touch').hidden = !touch.used;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
}

function toMenu() {
  for (const id of ['pause', 'over', 'touch']) $(id).hidden = true;
  $('menu').hidden = false;
  game.state = 'menu';
  refreshBests();
  startDemo();
}

function endGame() {
  game.state = 'over';
  game.overAt = performance.now();
  const previous = getBest(game.roomIndex, game.mode), record = score > previous;
  if (record) setBest(game.roomIndex, game.mode, score);
  $('overtitle').textContent = record && score > 0 ? 'New best!' : 'Overrun';
  const time = `${Math.floor(runTime / 60)}:${pad(runTime % 60, 2)}`;
  $('stats').innerHTML = [['Score', score.toLocaleString()], ['Level', level], ['Kills', kills], ['Best multiplier', `x${combo.best}`], ['Room', ROOMS[game.roomIndex].name], ['Time', time]]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('over').hidden = false;
  $('touch').hidden = true;
}

const bestKey = (r, m) => `deadrooms:best:${r}:${m}`;
function getBest(r, m) { try { return +localStorage.getItem(bestKey(r, m)) || 0; } catch { return 0; } }
function setBest(r, m, v) { try { localStorage.setItem(bestKey(r, m), String(v)); } catch {} }

// ─── Menu ───────────────────────────────────────────────────────────────────
function buildMenu() {
  $('rooms').innerHTML = ROOMS.map((r, i) => `<button class="room" data-room="${i}"><canvas width="240" height="153"></canvas><b>${r.name}</b><small>${r.note}</small><em id="best-${i}"></em></button>`).join('');
  document.querySelectorAll('.room').forEach(btn => {
    drawPreview(btn.querySelector('canvas'), ROOMS[+btn.dataset.room]);
    btn.onclick = e => { chooseRoom(+btn.dataset.room); if (e.detail) btn.blur(); };
  });
  document.querySelectorAll('#modes button').forEach(btn => {
    btn.onclick = e => { chooseMode(+btn.dataset.mode); if (e.detail) btn.blur(); };
  });
  chooseMode(menu.mode);
  chooseRoom(menu.room, true);
}

function chooseMode(m) {
  menu.mode = m;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', +b.dataset.mode === m));
  const k = s => `<kbd>${s}</kbd>`;
  const html = m === 1
    ? `<span>${k('W')}${k('A')}${k('S')}${k('D')} or ${k('↑')}${k('←')}${k('↓')}${k('→')} move</span><span>${k('Space')} shoot</span><span>${k('Q')} ${k('E')} or ${k('1')}–${k('9')} weapons</span><span>${k('Esc')} pause</span>`
    : `<span><b>P1</b> ${k('W')}${k('A')}${k('S')}${k('D')} move · ${k('Space')} shoot · ${k('Q')} ${k('E')} weapons</span><span><b>P2</b> ${k('↑')}${k('←')}${k('↓')}${k('→')} move · ${k('Enter')} shoot · ${k(',')} ${k('.')} weapons</span>`;
  $('keys').innerHTML = html + '<span class="pads">Gamepads work too</span>';
  $('pausekeys').innerHTML = html;
  refreshBests();
}

function chooseRoom(i, quiet) {
  menu.room = (i + ROOMS.length) % ROOMS.length;
  document.querySelectorAll('.room').forEach(b => b.classList.toggle('on', +b.dataset.room === menu.room));
  if (!quiet && game.state === 'menu') startDemo();
}

function refreshBests() {
  ROOMS.forEach((r, i) => { const el = $(`best-${i}`); if (el) el.textContent = `Best ${getBest(i, menu.mode).toLocaleString()}`; });
}

function drawPreview(cv, def) {
  const c = cv.getContext('2d'), s = cv.width / W;
  c.setTransform(s, 0, 0, s, 0, 0);
  c.fillStyle = '#e8d8bf';
  c.fillRect(0, 0, W, H);
  c.translate(0, WALL_H);
  const solid = (r, col) => r >= 0 && r < ROWS && '#P'.includes(def.map[r][col]);
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      const t = def.map[r][col], x = col * CELL, y = r * CELL;
      if (t === 'D') { c.fillStyle = '#c9b89c'; c.fillRect(x, y, CELL, CELL); }
      if (t === 'b') {
        c.fillStyle = '#86888a'; c.fillRect(x + 6, y - 14, 28, 34);
        c.fillStyle = '#c2410c'; c.fillRect(x + 6, y + 2, 28, 8);
      }
      if (t === '1' || t === '2') { c.fillStyle = t === '1' ? LOOKS.p1.suit : LOOKS.p2.suit; c.fillRect(x + 8, y - 30, 24, 46); }
      if (solid(r, col)) {
        if (!solid(r + 1, col)) { c.fillStyle = '#8c8c8c'; c.fillRect(x, y + CELL - WALL_H, CELL, WALL_H); }
        c.fillStyle = t === 'P' ? '#d2d2cf' : '#f6f6f3';
        c.fillRect(x, y - WALL_H, CELL, CELL);
      }
    }
  }
}

// ─── Events ─────────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
  sfx.init();
  const code = e.code, inGame = game.state === 'playing' || game.state === 'dying';
  const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
  if (inGame && (GAME_KEYS.has(code) || code.startsWith('Digit'))) e.preventDefault();
  if (!keys.has(code)) pressed.add(code);
  keys.add(code);
  if (e.repeat) return;
  if (code === 'Escape' || (code === 'KeyP' && inGame)) {
    if (game.state === 'playing') setPaused(true);
    else if (game.state === 'paused') setPaused(false);
    else if (game.state === 'over') toMenu();
    return;
  }
  if (code === 'KeyM') toggleSound();
  if (onButton && (code === 'Enter' || code === 'Space')) return;
  if (game.state === 'menu') {
    if (code === 'Enter' || code === 'Space') { e.preventDefault(); startGame(); }
    if (code === 'ArrowLeft' || code === 'ArrowRight') { e.preventDefault(); chooseRoom(menu.room + (code === 'ArrowLeft' ? -1 : 1)); }
    if (code === 'Digit1' || code === 'Digit2') chooseMode(+code.slice(-1));
  } else if (game.state === 'over' && (code === 'Enter' || code === 'Space')) {
    e.preventDefault();
    if (performance.now() - game.overAt > 800) startGame();
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
addEventListener('resize', resize);
addEventListener('pointerdown', () => sfx.init());

function toggleSound() {
  const on = sfx.toggle();
  $('sound').textContent = `Sound: ${on ? 'on' : 'off'}`;
}

$('play').onclick = startGame;
$('resume').onclick = () => setPaused(false);
$('restart').onclick = startGame;
$('quit').onclick = toMenu;
$('again').onclick = startGame;
$('tomenu').onclick = toMenu;
$('sound').onclick = toggleSound;
$('sound').textContent = `Sound: ${sfx.enabled ? 'on' : 'off'}`;
for (const id of ['fullscreen', 'fullscreen2']) {
  $(id).onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {}
  };
}

// Touch: a floating stick on the left half, fire and swap on the right.
(function setupTouch() {
  const zone = $('stickzone'), stick = $('stick'), knob = $('knob');
  let id = null, ox = 0, oy = 0;
  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    touch.used = true;
    if (game.state === 'playing') $('touch').hidden = false;
  }, true);
  zone.addEventListener('pointerdown', e => {
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    zone.setPointerCapture(id);
    const r = zone.getBoundingClientRect(), k = r.width / zone.offsetWidth;
    stick.style.left = `${(ox - r.left) / k}px`;
    stick.style.top = `${(oy - r.top) / k}px`;
    stick.hidden = false;
    touch.on = true;
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const k = zone.getBoundingClientRect().width / zone.offsetWidth;
    let dx = (e.clientX - ox) / k, dy = (e.clientY - oy) / k;
    const d = Math.hypot(dx, dy), max = 56;
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (d < 14) { touch.dx = touch.dy = 0; return; }
    const a = snap(Math.atan2(dy, dx));
    touch.dx = Math.round(Math.cos(a)); touch.dy = Math.round(Math.sin(a));
  });
  const release = e => {
    if (e.pointerId !== id) return;
    id = null; touch.dx = touch.dy = 0; stick.hidden = true;
    knob.style.transform = '';
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  const fireBtn = $('t-fire');
  fireBtn.addEventListener('pointerdown', e => { e.preventDefault(); touch.on = true; touch.fire = true; fireBtn.setPointerCapture(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fireBtn.addEventListener(ev, () => { touch.fire = false; });
  $('t-swap').addEventListener('pointerdown', e => { e.preventDefault(); touch.on = true; touch.swap = true; });
  $('t-pause').addEventListener('click', () => setPaused(true));
})();

// ─── Main loop ──────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollPads();
  const running = game.state === 'playing' || game.state === 'dying' || game.state === 'menu';
  if (running && !game.frozen) {
    let dt = Math.min(real, 1 / 30);
    if (game.state === 'dying') {
      dt *= 0.35;
      game.dying -= real;
    }
    update(dt);
    if (game.state === 'dying' && game.dying <= 0) endGame();
  }
  pressed.clear();
  draw();
  requestAnimationFrame(frame);
}

// Debug and test hooks.
window.__update = update;
window.__draw = draw;
window.deadRooms = {
  snapshot: () => ({
    state: game.state, mode: game.mode, room: game.roomIndex, level, score, kills, combo: { ...combo }, toSpawn,
    zombies: zombies.length, barrels: barrels.length, blocks: blocks.length, mines: mines.length, shots: shots.length, pickups: pickups.length,
    players: players.map(p => ({ x: p.x, y: p.y, hp: p.hp, weapon: WEAPONS[p.weapon].id, ammo: p.ammo.slice(), down: p.down })),
  }),
  freeze: on => { game.frozen = on; },
  step: (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) update(dt); draw(); },
  get world() { return { players, zombies, barrels, blocks, mines, pickups, shots, corpses, combo, room }; },
  spawn: (x, y, devil = false) => { const z = makeZombie(x, y, devil); zombies.push(z); return z; },
  unlockAll: () => { combo.best = 16; for (const p of players) p.ammo = WEAPONS.map(w => (w.start === Infinity ? Infinity : w.start)); },
  start: (mode = 1, roomIndex = 0) => { menu.mode = mode; menu.room = roomIndex; startGame(); },
  setWeapon: (i, w) => { players[i].weapon = WEAPONS.findIndex(x => x.id === w); },
  fire: i => { players[i].cooldown = 0; fire(players[i]); },
  face: (i, angle) => { players[i].angle = angle; },
  autopilot: on => { game.autopilot = on; },
};

resize();
buildMenu();
startDemo();
// Labels drawn before the web font arrives are redrawn once it does.
if (document.fonts) document.fonts.addEventListener('loadingdone', () => labels.clear());
requestAnimationFrame(frame);
