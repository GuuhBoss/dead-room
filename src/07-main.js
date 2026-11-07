// ─── Input ──────────────────────────────────────────────────────────────────
// Original defaults (CSaveData): player 1 on the arrows with / to shoot and
// , . to switch; player 2 on WASD with Space and Q / E. In single player
// Space also shoots and the number keys pick weapons. WASD and Q / E are
// extra single-player bindings here; they do not change play.
const keys = new Set(), pressed = new Set();
// CScreen_SelectWorld's Controls window: each player can rebind these seven.
const ACTIONS = [['fire', 'Shoot / use'], ['up', 'Move up'], ['down', 'Move down'], ['left', 'Move left'], ['right', 'Move right'], ['next', 'Next weapon'], ['prev', 'Previous weapon']];
const DEFAULT_KEYS = {
  p1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'Slash', next: 'Period', prev: 'Comma' },
  p2: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', fire: 'Space', next: 'KeyE', prev: 'KeyQ' },
};
const RESERVED = /^(Escape|KeyP|KeyM|Tab|Enter|F\d+|Digit\d|Numpad\d|Meta.*|OS.*)$/;
let keymap = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('deadrooms:keys'));
    if (saved && ['p1', 'p2'].every(p => ACTIONS.every(([a]) => typeof saved[p]?.[a] === 'string' && !RESERVED.test(saved[p][a])))) return saved;
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_KEYS));
})();
let BINDS = null;
// Single player uses player 1's keys plus Space and the number keys. With the
// default keys WASD and Q / E work too; they are extras and change no rules.
function rebuildBinds() {
  const one = map => Object.fromEntries(ACTIONS.map(([a]) => [a, [map[a]].concat(map[a] === 'Slash' ? ['NumpadDivide'] : [])]));
  const p1 = one(keymap.p1), p2 = one(keymap.p2), solo = one(keymap.p1);
  if (!solo.fire.includes('Space')) solo.fire.push('Space');
  if (JSON.stringify(keymap) === JSON.stringify(DEFAULT_KEYS)) {
    solo.up.push('KeyW'); solo.down.push('KeyS'); solo.left.push('KeyA'); solo.right.push('KeyD'); solo.prev.push('KeyQ'); solo.next.push('KeyE');
  }
  BINDS = { solo, p1, p2 };
}
rebuildBinds();
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'Tab', 'Comma', 'Period']);
// Touch screens show the on-screen controls from the start; elsewhere they
// appear after the first touch.
const touch = { on: false, used: matchMedia('(pointer: coarse)').matches, dx: 0, dy: 0, fire: false, swap: false, tap: false };
let releaseTouch = () => {};
const pads = { list: [], prev: new Map() };
const scripted = [null, null]; // test hook: fixed input per player
const DIGIT_WEAPON = code => { const m = /^(?:Digit|Numpad)(\d)$/.exec(code); return m ? (Number(m[1]) + 9) % 10 : -1; };

function bindsFor(id) { return game.mode === 1 || game.online ? BINDS.solo : id ? BINDS.p2 : BINDS.p1; }

// One local player's input; the same shape is sent to the server online.
function readLocal(id) {
  const b = bindsFor(id);
  const held = list => list.some(k => keys.has(k)), hit = list => list.some(k => pressed.has(k));
  const input = { dx: held(b.right) - held(b.left), dy: held(b.down) - held(b.up), fire: held(b.fire), prev: hit(b.prev), next: hit(b.next), select: -1, tap: hit(b.fire) };
  if (b === BINDS.solo) for (const code of pressed) { const w = DIGIT_WEAPON(code); if (w >= 0) input.select = w; }
  const pad = padFor(id);
  if (pad) {
    if (pad.dx || pad.dy) { input.dx = pad.dx; input.dy = pad.dy; }
    input.fire ||= pad.fire; input.tap ||= pad.tap; input.prev ||= pad.prev; input.next ||= pad.next;
  }
  if (id === 0 && touch.on) {
    if (touch.dx || touch.dy) { input.dx = touch.dx; input.dy = touch.dy; }
    input.fire ||= touch.fire; input.tap ||= touch.tap; input.next ||= touch.swap;
    touch.swap = touch.tap = false;
  }
  return input;
}

function gatherInput(p) { return readLocal(p.id); }
function autoInput(p) { return scripted[p.id] || { dx: 0, dy: 0, fire: false, prev: false, next: false, select: -1 }; }

function pollPads() {
  const raw = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(g => g && g.connected) : [];
  pads.list = raw.map(g => {
    const prev = pads.prev.get(g.index) || [];
    const held = g.buttons.map(b => b.pressed || b.value > 0.5);
    pads.prev.set(g.index, held);
    const edge = i => held[i] && !prev[i];
    let dx = g.axes[0] || 0, dy = g.axes[1] || 0;
    if (Math.hypot(dx, dy) < 0.4) dx = dy = 0;
    else { const a = Math.round(Math.atan2(dy, dx) / OCT) * OCT; dx = Math.round(Math.cos(a)); dy = Math.round(Math.sin(a)); }
    if (held[14]) dx = -1;
    if (held[15]) dx = 1;
    if (held[12]) dy = -1;
    if (held[13]) dy = 1;
    return { dx, dy, fire: held[0] || held[2] || held[7], tap: edge(0) || edge(2) || edge(7), prev: edge(4), next: edge(5) || edge(3), start: edge(9) };
  });
  for (const pad of pads.list) if (pad.start) togglePause();
}

// One pad drives player 1 in solo; in co-op a lone pad goes to player 2.
function padFor(id) {
  const l = pads.list;
  if (game.mode === 1 || game.online) return id === 0 ? l[0] || null : null;
  if (l.length >= 2) return l[id];
  return id === 1 ? l[0] || null : null;
}

// ─── Game flow ──────────────────────────────────────────────────────────────
// The backend loads this function on its own: keep it a plain top-level
// function that only uses the shared simulation (01-03).
function resetRun(mode, roomIndex) {
  game.mode = mode;
  game.roomIndex = roomIndex;
  startRun();
}

let paused = false, overShown = false;
// Offline games wait until the room's original layers are ready (Screen_LoadingWorld).
const roomReady = () => art.ready && room && roomArt(room.index).ready;
const MODE_NAMES = { 1: 'solo', 2: 'coop', 3: 'deathmatch' };

function screen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  const first = id && $(id) && $(id).querySelector('.mainnav button, .thumb, button, input');
  if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
}

function hideScreens() { for (const s of document.querySelectorAll('.screen')) s.hidden = true; }

// What the Options window edits for offline games (CSaveData); online games
// always use the defaults. The saved "Number of games" default is first to 10,
// and each mode remembers its own room (single play starts on room 9).
const saved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const local = (() => {
  const o = saved('deadrooms:options', {});
  const options = { ...DEFAULT_OPTIONS };
  for (const k of Object.keys(DEFAULT_OPTIONS)) if (typeof o[k] === typeof DEFAULT_OPTIONS[k]) options[k] = o[k];
  if (!DIFFICULTIES[options.difficulty]) options.difficulty = 0;
  if (!SPEEDS.includes(options.speed)) options.speed = 1;
  return { options, frags: FRAG_LIMITS.includes(o.frags) ? o.frags : FRAG_LIMITS[1] };
})();
menu.rooms = (() => { const r = saved('deadrooms:rooms', {}); return { 1: r[1] ?? 8, 2: r[2] ?? 0, 3: r[3] ?? 0 }; })();
const saveOptions = () => store('deadrooms:options', { ...local.options, frags: local.frags });

function startLocal() {
  sfx.init();
  sfx.ui('World.End'); // CScreen_SelectWorld: the level icon plays Click (World.End.wav)
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  closeWindows();
  game.options = { ...local.options };
  game.fragLimit = local.frags;
  game.online = false;
  game.demo = false;
  game.state = 'playing';
  paused = false; overShown = false;
  keys.clear();
  resetRun(menu.mode, menu.room);
  beginView();
  hideScreens();
  $('touch').hidden = !touch.used;
}

// Shared by local and online games once the first state is in place.
function beginView() {
  primeEffects();
  particles = [];
  if (art.ready) {
    roomArt(room.index);
    warmStyles([...new Set(players.map(p => styleOf(p.look)))].concat(game.mode === 3 ? [] : ['zombie', 'devil']));
  }
  cam.tx = null;
  updateCamera(0, true);
}

function togglePause() {
  if (game.state !== 'playing' || overShown) return;
  if (game.online) { net.note('Online games keep running: the server does not pause.'); return; }
  paused = !paused;
  if (paused) { keys.clear(); releaseTouch(); sfx.stopAmbience(); fillPause(); screen('pause'); $('touch').hidden = true; }
  else { hideScreens(); $('touch').hidden = !touch.used; }
}

function toMenu() {
  net.leave();
  releaseTouch();
  sfx.stopAmbience();
  game.online = false;
  game.state = 'menu';
  game.demo = true;
  paused = false; overShown = false;
  players = []; zombies = []; corpses = []; shots = []; tracers = []; blasts = []; texts = []; mines = []; pickups = []; particles = [];
  barrels = []; blocks = [];
  closeWindows();
  screen('menu');
  $('touch').hidden = true;
}

// CScreen_Debrief (score, an end line) and CScreen_Debrief_Winner.
const END_TEXT = ['YOU WERE EATEN!', 'BLED TO DEATH', 'DRAINED OF BLOOD', 'YOUR HEAD WAS RIPPED OFF!', 'DEATH!', 'GAME OVER!', 'WIMPISH!', 'LOSER!'];
function showOver(rank) {
  overShown = true;
  releaseTouch();
  sfx.ui('World.End'); // CScreen_Debrief
  game.overAt = performance.now();
  const dm = game.mode === 3, time = `${Math.floor(runTime / 60)}:${pad(runTime % 60, 2)}`;
  $('over-status').textContent = pick(END_TEXT);
  $('over-title').classList.toggle('winner', dm);
  $('over-title').textContent = dm ? (game.winner === null ? 'No winner' : `Player ${game.winner + 1} wins`) : pad(score, 12);
  const room = `${game.roomIndex + 1}. ${ROOMS[game.roomIndex].name}`;
  const rows = dm
    ? [['Player 1 frags', players[1] ? players[1].deaths : 0], ['Player 2 frags', players[0] ? players[0].deaths : 0], ['First to', game.fragLimit], ['Room', room], ['Time', time]]
    : [['Level', level], ['Kills', kills], ['Best multiplier', `x${combo.best}`], ['Room', room], ['Time', time]];
  $('stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');
  $('over-rank').textContent = rank;
  $('again').hidden = game.online;
  $('again').textContent = dm ? 'Replay' : 'Retry';
  $('over-board').hidden = dm;
  screen('over');
  $('touch').hidden = true;
}

function localOver() {
  if (game.mode === 3) { showOver('Offline death match: not ranked.'); return; }
  const best = getBest(game.roomIndex, game.mode), fair = isDefaultOptions(game.options);
  if (fair && score > best) setBest(game.roomIndex, game.mode, score);
  const note = !fair ? ' Options were changed, so no local best either.' : score > best ? ' A new best on this device.' : best ? ` Best on this device: ${best.toLocaleString()}.` : '';
  showOver(`Offline game: not ranked.${note}`);
}

const bestKey = (r, m) => `deadrooms:best:${ROOMS[r].id}:${m}`;
function getBest(r, m) { try { return +localStorage.getItem(bestKey(r, m)) || 0; } catch { return 0; } }
function setBest(r, m, v) { try { localStorage.setItem(bestKey(r, m), String(v)); } catch {} }
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ─── Menus ──────────────────────────────────────────────────────────────────
// SubScreen_Single / _Coop / _DeathMatch headline and line beneath, verbatim.
const OBJECTIVES = {
  1: ['Kill zombies', 'REWARDS: Earn upto 10 new weapons and 90+ upgrades via multiple Zombies kills!'],
  2: ['Kill zombies', 'REWARDS: Earn upto 10 new weapons and 90+ upgrades via multiple Zombies kills!'],
  3: ['Kill each other', 'Access to all weapons at the start and pickup boxes to activate the weapon!'],
};

function buildMenus() {
  $('net-room').innerHTML = ROOMS.map((r, i) => `<option value="${i}">${i + 1}. ${escapeHtml(r.name)}</option>`).join('');
  document.querySelectorAll('[data-help]').forEach(b => { b.onclick = () => showHelp(b.dataset.help); });
  document.querySelectorAll('[data-go]').forEach(btn => { btn.onclick = () => go(btn.dataset.go); });
  $('room-prev').onclick = () => chooseRoom(menu.room - 1);
  $('room-next').onclick = () => chooseRoom(menu.room + 1);
  $('view-highscores').onclick = () => { board.open(menu.room, menu.mode === 2 ? 'coop' : 'solo'); screen('board'); };
  $('open-options').onclick = () => openWindow('win-options');
  $('open-controls').onclick = () => { buildKeys(); $('keys-status').textContent = ''; openWindow('win-controls'); };
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeWindows; });
  document.querySelectorAll('#win-options .choices button').forEach(b => {
    b.onclick = () => {
      const field = b.closest('.opt').dataset.field, v = Number(b.dataset.value);
      if (field === 'frags') local.frags = v;
      else if (field === 'difficulty' || field === 'speed') local.options[field] = v;
      else local.options[field] = v === 1;
      saveOptions(); syncOptions(); refreshBest();
    };
  });
  $('options-reset').onclick = () => { local.options = { ...DEFAULT_OPTIONS }; local.frags = FRAG_LIMITS[1]; saveOptions(); syncOptions(); refreshBest(); };
}

function go(where) {
  sfx.init();
  sfx.ui(where === 'menu' ? 'CLICK' : 'World.End'); // CScreen_Main state buttons play Click (World.End.wav)
  const modes = { single: 1, coop: 2, deathmatch: 3 };
  if (modes[where]) {
    menu.mode = modes[where];
    menu.room = menu.rooms[menu.mode];
    const [headline, line] = OBJECTIVES[menu.mode];
    $('objective-text').textContent = headline;
    $('objective-sub').textContent = line;
    buildChars();
    showRoom();
    refreshBest();
    syncOptions();
    screen('setup');
    fitHeadline();
  } else if (where === 'online') { net.openScreen(); screen('online'); }
  else if (where === 'board') { board.open(menu.room, 'solo'); screen('board'); }
  else if (where === 'help') screen('help');
  else toMenu();
}

// The instructions' four pages (Movement and Controls, How to Play,
// Characters, Tips and Tricks).
function showHelp(page) {
  sfx.ui('CLICK');
  document.querySelectorAll('[data-help]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.help === page)));
  document.querySelectorAll('.help-page').forEach(p => { p.hidden = p.dataset.page !== page; });
}

// Pictures for the Characters page: the portrait cards and, for the zombie
// and the devil, their own standing frames.
function paintHelp() {
  document.querySelectorAll('.help-characters .card-art').forEach(el => paintCard({ querySelector: () => el }, +el.dataset.card));
  document.querySelectorAll('.help-characters canvas').forEach(cv => {
    const style = cv.dataset.creature, keep = pixel;
    pixel = 3;
    const s = xsiFrame(style, style === 'devil' ? 'Player/Stand' : 'Zombie/Zombie_Stand', Math.PI / 2, 0);
    pixel = keep;
    const g = cv.getContext('2d'), k = 2.6;
    g.clearRect(0, 0, cv.width, cv.height);
    if (s) g.drawImage(s.img, cv.width / 2 + s.x * k, cv.height * 0.8 + s.y * k, s.w * k, s.h * k);
  });
}

// The headline stays on one line, shrinking for "Kill each other".
function fitHeadline() {
  const h = $('objective');
  h.style.fontSize = '';
  if (view.fluid) return; // phones wrap it instead
  const range = document.createRange();
  range.selectNodeContents(h);
  const room = h.getBoundingClientRect().width * 0.97;
  for (let size = 98; size > 50 && range.getBoundingClientRect().width > room; size -= 4) h.style.fontSize = `${size}px`;
}

function chooseRoom(i) {
  sfx.ui('CLICK');
  menu.room = (i + ROOMS.length) % ROOMS.length;
  menu.rooms[menu.mode] = menu.room;
  store('deadrooms:rooms', menu.rooms);
  showRoom();
  refreshBest();
}

function showRoom() {
  $('room-count').textContent = `${menu.room + 1}/${ROOMS.length}`;
  $('room-name').textContent = ROOMS[menu.room].name;
  $('view-highscores').hidden = menu.mode === 3; // as the original, none for death match
  showPreview();
}

// LevelIcons_Single: the original 350 × 182 picture of each room.
function showPreview() {
  const img = $('room-thumb'), url = art.previews[menu.room];
  if (url && img.getAttribute('src') !== url) img.src = url;
  img.alt = `${ROOMS[menu.room].name}, room ${menu.room + 1}`;
}

function refreshBest() {
  const best = menu.mode === 3 ? 0 : getBest(menu.room, menu.mode);
  $('local-best').textContent = menu.mode === 3 ? `First to ${local.frags} frags. Offline games are not ranked.`
    : !isDefaultOptions(local.options) ? 'Options changed: no local best for this game.'
      : best ? `Best on this device: ${best.toLocaleString()}` : 'Offline games are not ranked.';
}

// Character cards with arrows (mcPlayer1_Character, mcPlayer2_Character): the
// original mcCharacter frames, BON, BIND, BERT and BAMBO (Swat, Bond, G.I. Joe
// and Bambo style sheets, CHARACTERS order).
function cardHTML(id, step, label = `Player ${id + 1} character`) {
  const arrows = step ? [`<button class="arrow" type="button" data-player="${id}" data-step="-1" aria-label="Previous character"></button>`, `<button class="arrow next" type="button" data-player="${id}" data-step="1" aria-label="Next character"></button>`] : ['<span></span>', '<span></span>'];
  return `<div class="charpick" role="group" aria-label="${label}">${arrows[0]}<div class="charcard"><div class="card-art" role="img"></div><b>${id + 1}</b></div>${arrows[1]}</div>`;
}

function paintCard(card, index) {
  const art0 = card && card.querySelector('.card-art');
  if (!art0) return;
  const s = art.sprites.cards;
  if (s) art0.style.backgroundImage = `url("${s.img.src}")`;
  art0.style.backgroundPosition = `${(index / 3) * 100}% 0`;
  art0.setAttribute('aria-label', CHARACTERS[index].name);
}

function buildChars() {
  const ids = menu.mode === 1 ? [0] : [0, 1];
  $('chars').classList.toggle('two', ids.length === 2);
  $('chars').innerHTML = ids.map(id => cardHTML(id, true)).join('');
  document.querySelectorAll('#chars .charpick .arrow').forEach(b => {
    b.onclick = () => {
      const id = +b.dataset.player;
      game.characters[id] = (game.characters[id] + +b.dataset.step + CHARACTERS.length) % CHARACTERS.length;
      sfx.ui('CLICK');
      drawChar(id);
    };
  });
  ids.forEach(drawChar);
}

function drawChar(id) {
  paintCard(document.querySelectorAll('#chars .charcard')[id], game.characters[id]);
}

// mcWindow_Options and mcWindow_Controls open over the room screen.
function openWindow(id) {
  closeWindows();
  if (id === 'win-options') syncOptions();
  $(id).hidden = false;
  const first = $(id).querySelector('button');
  if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
}
function closeWindows() { $('win-options').hidden = $('win-controls').hidden = true; rebinding = null; }
const windowOpen = () => !$('win-options').hidden || !$('win-controls').hidden;

function syncOptions() {
  document.querySelectorAll('#win-options .opt').forEach(row => {
    const f = row.dataset.field;
    const value = f === 'frags' ? local.frags : f === 'difficulty' || f === 'speed' ? local.options[f] : local.options[f] ? 1 : 0;
    row.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === value)));
  });
}

// Key names as the Controls window shows them.
const keyName = code => ({ ArrowUp: 'Cursor up', ArrowDown: 'Cursor down', ArrowLeft: 'Cursor left', ArrowRight: 'Cursor right', Space: 'Space', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', ShiftLeft: 'Left shift', ShiftRight: 'Right shift', ControlLeft: 'Left ctrl', ControlRight: 'Right ctrl', AltLeft: 'Left alt', AltRight: 'Right alt' })[code] || code.replace(/^Key/, '').replace(/^Numpad/, 'Numpad ');

// In single play player 2's column is covered, as in the original.
function buildKeys() {
  $('keys').innerHTML = ['p1', 'p2'].map((p, n) => {
    const cover = p === 'p2' && menu.mode === 1;
    return `<div class="${cover ? 'cover' : ''}"><h4>Player ${n + 1} controls</h4>${ACTIONS.map(([a, text]) => `<button type="button" class="keybind" data-player="${p}" data-action="${a}" ${cover ? 'disabled' : ''}><span>${text}:</span><kbd>${escapeHtml(keyName(keymap[p][a]))}</kbd></button>`).join('')}</div>`;
  }).join('');
  document.querySelectorAll('.keybind').forEach(b => {
    b.onclick = () => {
      rebinding = { player: b.dataset.player, action: b.dataset.action };
      b.querySelector('kbd').textContent = 'Press a key';
      $('keys-status').textContent = 'Press the new key, or Escape to keep the old one.';
    };
  });
}

function finishRebind(code) {
  const { player, action } = rebinding;
  rebinding = null;
  if (code === 'Escape') $('keys-status').textContent = '';
  else if (RESERVED.test(code)) $('keys-status').textContent = `Invalid key: ${keyName(code)} is kept for pausing, sound, menus or weapon numbers.`;
  else {
    // A key moved here is taken from wherever it was before.
    for (const p of ['p1', 'p2']) for (const [a] of ACTIONS) if (keymap[p][a] === code) keymap[p][a] = keymap[player][action];
    keymap[player][action] = code;
    try { localStorage.setItem('deadrooms:keys', JSON.stringify(keymap)); } catch {}
    rebuildBinds();
    $('keys-status').textContent = `${ACTIONS.find(([a]) => a === action)[1]} for player ${player === 'p1' ? 1 : 2}: ${keyName(code)}.`;
  }
  buildKeys();
}

function resetKeys() {
  keymap = JSON.parse(JSON.stringify(DEFAULT_KEYS));
  try { localStorage.removeItem('deadrooms:keys'); } catch {}
  rebuildBinds();
  buildKeys();
  $('keys-status').textContent = 'Keys are back to the original defaults.';
}

// HUD.Paused: every reward boxed with its multiplier, at 25 % until reached;
// new weapons in green (txtUpgrade.textColor 0x00FF00).
function fillPause() {
  $('pause-note').textContent = game.mode === 3
    ? `${ROOMS[game.roomIndex].name}, death match, first to ${game.fragLimit}.`
    : `${ROOMS[game.roomIndex].name}, level ${level}, multiplier x${combo.level}, best x${combo.best}.`;
  $('upgrade-list').innerHTML = UPGRADES.map(u => {
    const on = !!upgrades[upgradeKey(u)];
    return `<li class="${on ? 'on' : ''} ${u.name.startsWith('New') ? 'weapon' : ''}"><b>x${u.at}</b><span>${escapeHtml(u.name)}</span></li>`;
  }).join('');
  $('sound').textContent = `Sound: ${sfx.enabled ? 'on' : 'off'}`;
}

// ─── Events ─────────────────────────────────────────────────────────────────
let rebinding = null;
addEventListener('keydown', e => {
  sfx.init();
  if (rebinding) { e.preventDefault(); finishRebind(e.code); return; }
  const code = e.code, inGame = game.state === 'playing' && !paused && !overShown;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (inGame && (GAME_KEYS.has(code) || DIGIT_WEAPON(code) >= 0)) e.preventDefault();
  if (!typing || inGame) { if (!keys.has(code)) pressed.add(code); keys.add(code); }
  if (e.repeat || typing) return;
  if (windowOpen()) { if (code === 'Escape') closeWindows(); return; }
  if (code === 'Escape' || (code === 'KeyP' && game.state === 'playing')) {
    if (game.state === 'playing' && !overShown) togglePause();
    else if (overShown || game.state === 'menu') go('menu');
    return;
  }
  if (code === 'KeyM') { sfx.toggle(); $('sound').textContent = `Sound: ${sfx.enabled ? 'on' : 'off'}`; }
  const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
  if (onButton && (code === 'Enter' || code === 'Space')) return;
  if (!$('setup').hidden && code === 'Enter') { e.preventDefault(); startLocal(); }
  if (!$('setup').hidden && (code === 'ArrowLeft' || code === 'ArrowRight')) chooseRoom(menu.room + (code === 'ArrowLeft' ? -1 : 1));
  if (overShown && !game.online && code === 'Enter' && performance.now() - game.overAt > 800) startLocal();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (!game.online && game.state === 'playing' && !paused && !overShown) togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !game.online && game.state === 'playing' && !paused && !overShown) togglePause(); });
addEventListener('resize', resize);
addEventListener('pointerdown', () => sfx.init());

$('play').onclick = startLocal;
$('keys-reset').onclick = resetKeys;
$('resume').onclick = togglePause;
$('quit').onclick = toMenu;
$('again').onclick = startLocal;
$('tomenu').onclick = toMenu;
$('swap-views').onclick = () => { swapViews(); if (document.activeElement) document.activeElement.blur(); };
$('over-board').onclick = () => { const r = game.roomIndex, m = game.mode === 2 ? 'coop' : 'solo'; toMenu(); board.open(r, m); screen('board'); };
$('over-select').onclick = () => {
  const online = game.online, mode = game.mode;
  toMenu();
  if (online) go('online'); else go(MODE_NAMES[mode] === 'solo' ? 'single' : MODE_NAMES[mode]);
};
$('sound').onclick = () => { sfx.toggle(); $('sound').textContent = `Sound: ${sfx.enabled ? 'on' : 'off'}`; };

// Touch: a floating stick on the left, fire and swap on the right. Every
// way a touch can end (lifting, cancelling, losing capture, the page losing
// focus or turning) lets go of the controls, so nothing stays held.
(function setupTouch() {
  const zone = $('stickzone'), stick = $('stick'), knob = $('knob'), fireBtn = $('t-fire'), swapBtn = $('t-swap');
  let id = null, ox = 0, oy = 0;
  // Knob travel and dead zone in the zone's own pixels (UI pixels when scaled).
  const reach = () => (view.fluid ? { max: 46, dead: 12 } : { max: 70, dead: 18 });
  const scaleOf = () => zone.getBoundingClientRect().width / (zone.offsetWidth || 1);
  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (!touch.used) { touch.used = true; resize(); }
    if (game.state === 'playing' && !paused && !overShown) $('touch').hidden = false;
  }, true);
  function releaseStick() {
    id = null; touch.dx = touch.dy = 0;
    stick.hidden = true;
    knob.style.transform = '';
    zone.classList.remove('active');
  }
  function releaseFire() { touch.fire = false; fireBtn.classList.remove('held'); }
  releaseTouch = () => { releaseStick(); releaseFire(); touch.swap = touch.tap = false; };
  zone.addEventListener('pointerdown', e => {
    e.preventDefault();
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    try { zone.setPointerCapture(id); } catch {}
    const r = zone.getBoundingClientRect(), k = scaleOf();
    stick.style.left = `${(ox - r.left) / k}px`;
    stick.style.top = `${(oy - r.top) / k}px`;
    stick.hidden = false;
    zone.classList.add('active');
    touch.on = true;
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const k = scaleOf(), { max, dead } = reach();
    let dx = (e.clientX - ox) / k, dy = (e.clientY - oy) / k;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (d < dead) { touch.dx = touch.dy = 0; return; }
    const a = Math.round(Math.atan2(dy, dx) / OCT) * OCT;
    touch.dx = Math.round(Math.cos(a)); touch.dy = Math.round(Math.sin(a));
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, e => { if (e.pointerId === id) releaseStick(); });
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    touch.on = true; touch.fire = true; touch.tap = true;
    fireBtn.classList.add('held');
    try { fireBtn.setPointerCapture(e.pointerId); } catch {}
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fireBtn.addEventListener(ev, releaseFire);
  swapBtn.addEventListener('pointerdown', e => { e.preventDefault(); touch.on = true; touch.swap = true; });
  $('t-pause').addEventListener('click', togglePause);
  // No long-press menus or text selection on the controls.
  $('touch').addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', releaseTouch);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseTouch(); });
  const turned = () => { releaseTouch(); resize(); };
  addEventListener('orientationchange', turned);
  if (screen.orientation) screen.orientation.addEventListener('change', turned);
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
})();

// On a phone the soft keyboard can cover a field: bring the focused one back
// into view once the keyboard has opened.
document.addEventListener('focusin', e => {
  if (!view.fluid || !e.target.matches('input, select')) return;
  setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
});

// Full screen, offered on phones when the browser allows it.
(function setupFullscreen() {
  const btn = $('fullscreen');
  const can = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  const sync = () => { btn.hidden = !can || !!document.fullscreenElement; }; // CSS shows it on phones only
  btn.onclick = () => {
    sfx.ui('CLICK');
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => { sync(); resize(); });
  addEventListener('resize', sync);
  sync();
})();

// ─── Main loop ──────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  pollPads();
  if (game.state === 'menu') { /* white menu pages, nothing to animate */ }
  else if (game.online) { net.frame(real); updateCamera(real); }
  else if (game.state === 'playing' && !paused && !game.frozen && roomReady()) { update(real); updateCamera(real); }
  if (game.state !== 'menu' && !paused) syncEffects();
  if (game.state !== 'menu') warmStep(game.state === 'playing' && roomReady() ? 3 : 12);
  if (game.state === 'over' && !overShown) {
    if (game.online) net.over(); else localOver();
  }
  const swap = !(game.mode === 3 && game.state === 'playing' && !paused && !overShown);
  if ($('swap-views').hidden !== swap) $('swap-views').hidden = swap;
  pressed.clear();
  draw();
  requestAnimationFrame(frame);
}

// ─── Test hooks ─────────────────────────────────────────────────────────────
// For automated checks of the running page. rules() returns the live tables.
window.deadRooms = {
  source: { swf: 'boxhead2play.swf', sha256: '34ff145d96891ddea20278700c8b1fb6fd6273ca0e71b73d8bdf0df183fdbece' },
  rules: () => JSON.parse(JSON.stringify({ rooms: ROOMS, weapons: WEAPONS, upgrades: UPGRADES, rules: RULES, difficulties: DIFFICULTIES, levels: buildLevels(true).slice(1) })),
  snapshot: () => JSON.parse(JSON.stringify({ state: game.state, online: game.online, mode: game.mode, winner: game.winner, fragLimit: game.fragLimit, room: game.roomIndex, level, score, kills, combo, toSpawn, upgrades, players, zombies: zombies.length, corpses: corpses.length, barrels: barrels.length, blocks: blocks.length, mines: mines.length, shots: shots.length, pickups: pickups.length, ticks })),
  start: (mode = 1, roomIndex = 0, options = {}) => {
    const { fragLimit, ...rest } = options;
    menu.mode = mode; menu.room = roomIndex;
    const keepOptions = local.options, keepFrags = local.frags;
    local.options = { ...DEFAULT_OPTIONS, ...rest };
    if (fragLimit) local.frags = fragLimit;
    startLocal();
    local.options = keepOptions; local.frags = keepFrags;
  },
  freeze: on => { game.frozen = on; },
  ticks: n => { for (let i = 0; i < n && game.state === 'playing'; i++) { for (const p of players) takeInput(p, game.autopilot ? autoInput(p) : gatherInput(p)); simTick(); } syncEffects(0); draw(); },
  input: (i, value) => { scripted[i] = value ? { dx: 0, dy: 0, fire: false, prev: false, next: false, select: -1, ...value } : null; game.autopilot = scripted.some(Boolean); },
  get world() { return { players, zombies, corpses, barrels, blocks, mines, pickups, shots, combo, room, level, lv }; },
  spawn: (x, y, devil = false) => { const z = makeZombie(x, y, devil); zombies.push(z); return z; },
  multiplier: n => setMultiplier(n),
};
