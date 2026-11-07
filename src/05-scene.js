// ─── Stage ──────────────────────────────────────────────────────────────────
const stage = $('stage'), ui = $('ui');
const UI_W = W * 2, UI_H = H * 2;                 // DOM overlay works in 1280 × 960
const PF = Math.sin(Math.PI / 4);                 // -CThing_Position.mPFactor: height to screen
let viewScale = 1;

function resize() {
  const scale = Math.min(innerWidth / W, innerHeight / H);
  viewScale = scale;
  pixel = scale * Math.min(window.devicePixelRatio || 1, 2);
  stage.style.width = `${W * scale}px`;
  stage.style.height = `${H * scale}px`;
  ui.style.transform = `scale(${scale / 2})`;
  const cw = Math.max(1, Math.round(W * pixel)), ch = Math.max(1, Math.round(H * pixel));
  if (canvas.width === cw && canvas.height === ch) return;
  canvas.width = cw; canvas.height = ch;
  labels.clear();
  // Decals are kept: they are redrawn at the new resolution as they come.
}

// World cells (x, y, height z) to world pixels, as CThing_Position.ConvertCellToScreen.
const sx = x => x * CELL;
const sy = (y, z = 0) => (y - z * PF) * CELL;

// ─── Camera (CWorld.Process_Tracking) ───────────────────────────────────────
// The view follows the players' mean position, easing at 0.16 cells a frame
// plus a fifth of any lag beyond that, and stops at the room's edges.
const cam = { tx: null, ty: null, x: 0, y: 0, pan: 0 };
function updateCamera(dt, jump) {
  const list = players.filter(p => !p.down && p.state !== 'respawn');
  const src = list.length ? list : players;
  if (!src.length || !room) return;
  const tx = src.reduce((s, p) => s + p.x, 0) / src.length, ty = src.reduce((s, p) => s + p.y, 0) / src.length;
  if (cam.tx === null || jump) { cam.tx = tx; cam.ty = ty; }
  else {
    const d = Math.hypot(tx - cam.tx, ty - cam.ty), base = 0.16;
    if (d <= base) { cam.tx = tx; cam.ty = ty; }
    else {
      const step = Math.min(d, base * ((d - base) / 5 + 1) * dt * 50);
      cam.tx += ((tx - cam.tx) / d) * step; cam.ty += ((ty - cam.ty) / d) * step;
    }
  }
  placeCamera(cam.tx, cam.ty);
}

function placeCamera(cx, cy) {
  const rw = room.cols * CELL, rh = room.rows * CELL;
  cam.x = rw <= W ? (rw - W) / 2 : clamp(cx * CELL - W / 2, 0, rw - W);
  cam.y = rh <= H ? (rh - H) / 2 : clamp(cy * CELL - H / 2, 0, rh - H);
}

// ─── Room layers ────────────────────────────────────────────────────────────
// CWorld keeps three room-sized bitmaps: bmFloor (the room art with every
// piece drawn in), bmCover (each piece's _Cover, drawn over everything that
// moves) and bmDecalMask (the pieces: blood and scorch marks never land on
// them). They come as 1x pictures; decals are painted into 256-pixel chunks
// as they happen.
const CHUNK = 256;
const decalChunks = new Map();
const chunkRes = () => Math.min(pixel, 2);

function renderFloor() {
  decalChunks.clear();
  if (art.ready && room) roomArt(room.index);
}

function decalChunk(cx, cy) {
  const key = cx + ',' + cy;
  let d = decalChunks.get(key);
  if (!d) {
    const res = chunkRes(), c = document.createElement('canvas');
    c.width = c.height = Math.ceil(CHUNK * res);
    const g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, -cx * CHUNK * res, -cy * CHUNK * res);
    d = { c, g };
    decalChunks.set(key, d);
  }
  return d;
}

// Paints into every chunk the mark touches (pixel coordinates), then takes
// the pieces back out of it (copyPixels through bmDecalMask).
function paintDecal(x, y, r, paint) {
  const layers = room && roomArt(room.index);
  if (!layers || !layers.ready) return;
  const rw = room.cols * CELL, rh = room.rows * CELL;
  const x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r)), x1 = Math.min(rw, Math.ceil(x + r)), y1 = Math.min(rh, Math.ceil(y + r));
  if (x1 <= x0 || y1 <= y0) return;
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y1 - 1) / CHUNK); cy++) {
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor((x1 - 1) / CHUNK); cx++) {
      const { g } = decalChunk(cx, cy);
      paint(g);
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(layers.mask, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      g.restore();
    }
  }
}

// A room layer seen from (vx, vy): only the part inside the room.
function drawLayer(img, vx, vy, vw, vh) {
  const x0 = Math.max(0, vx), y0 = Math.max(0, vy), x1 = Math.min(img.width, vx + vw), y1 = Math.min(img.height, vy + vh);
  if (x1 > x0 && y1 > y0) ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
}

// CMap_Decal: Effect.BloodSplat and Effect.ScorchMark, each turned to one of
// three angles and squashed to 0.6 of its height (pGlobalScale).
// Like the original, each is buffered once per direction.
const DECAL_TURN = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
const decalBuffers = new Map();
function decalBuffer(key, dir) {
  const id = key + dir;
  let b = decalBuffers.get(id);
  if (!b) {
    const s = art.sprites[key], r = Math.ceil(Math.hypot(s.w, s.h) / 2) + 2, res = 2, c = document.createElement('canvas');
    c.width = c.height = r * 2 * res;
    const g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, r * res, r * res);
    drawSprite(key, 0, 0, 0, 1, DECAL_TURN[dir], 1, 0.6, g);
    b = { c, r };
    decalBuffers.set(id, b);
  }
  return b;
}
function decal(key, x, y) {
  if (!art.sprites[key]) return;
  const b = decalBuffer(key, Math.floor(Math.random() * 3));
  paintDecal(x, y, b.r, g => g.drawImage(b.c, x - b.r, y - b.r, b.r * 2, b.r * 2));
}
const bloodSplat = (x, y) => decal('bloodSplat', (x + rand(-0.25, 0.25)) * CELL, (y + rand(-0.25, 0.25)) * CELL);
const scorchMark = (x, y) => decal('scorch', x * CELL, y * CELL);

// ─── Effects from state ─────────────────────────────────────────────────────
// The simulation only changes state; sounds, decals and the original effect
// things (CThing_Effect_*) are worked out here by comparing what changed, one
// logic tick at a time. Online play renders server snapshots the same way.
const fx = { tracers: new Set(), blasts: new Set(), corpses: new Set(), shots: new Map(), mines: new Set(), objects: new Set(), msgs: new Set(), pickups: new Map(), hits: new Map(), down: new Map(), tick: 0 };
let effects = [];   // { key, x, y, z, f, speed, angle, dx, dy, ticks }

function primeEffects() {
  for (const set of [fx.tracers, fx.blasts, fx.corpses, fx.mines, fx.objects, fx.msgs]) set.clear();
  for (const map of [fx.shots, fx.pickups, fx.hits, fx.down]) map.clear();
  for (const t of tracers) fx.tracers.add(t.id);
  for (const b of blasts) fx.blasts.add(b.id);
  for (const c of corpses) fx.corpses.add(c.id);
  for (const s of shots) fx.shots.set(s.id, { z: s.z || 0, dz: 0 });
  for (const m of mines) fx.mines.add(m.id);
  for (const b of barrels) fx.objects.add(b.id);
  for (const b of blocks) fx.objects.add(b.id);
  for (const t of texts) fx.msgs.add(t.id);
  for (const k of pickups) fx.pickups.set(k.id, k.hidden);
  for (const z of zombies) fx.hits.set('z' + z.id, z.hits);
  for (const p of players) { fx.hits.set('p' + p.id, p.hits); fx.down.set(p.id, p.down); }
  fx.tick = ticks;
  effects = [];
  hudMessages.length = 0;
  hitSets.clear(); lastSets.clear();
  ambience.reset();
}

function fresh(set, list) {
  const out = [], now = new Set();
  for (const e of list) { now.add(e.id); if (!set.has(e.id)) out.push(e); }
  set.clear();
  for (const id of now) set.add(id);
  return out;
}

const MUZZLE = { pistol: 'muzzlePistol', uzi: 'muzzleUzi', shotgun: 'muzzleShotgun', railgun: 'muzzleRailgun' };
const SHOT_SOUND = { pistol: 'Weapon.Pistol.Fire', uzi: 'Weapon.UZI.Fire', shotgun: 'Weapon.ShotGun.Fire', railgun: 'Weapon.Railgun.Fire' };
const addEffect = (key, x, y, z = 0, o = {}) => effects.push({ key, x, y, z, f: 0, speed: 1, angle: 0, dx: 0, dy: 0, ticks: 0, ...o });

function syncEffects() {
  if (ticks < fx.tick) fx.tick = ticks;
  const steps = Math.min(8, ticks - fx.tick);
  fx.tick = ticks;
  // Shots fired this tick: one flash and one sound per gun (shotguns fire six).
  const fired = new Set();
  for (const t of fresh(fx.tracers, tracers)) {
    const range = (WEAPONS.find(w => w.id === t.kind) || {}).range || 10;
    if (!fired.has(t.owner)) {
      fired.add(t.owner);
      if (SHOT_SOUND[t.kind]) sfx.play(SHOT_SOUND[t.kind]);
      if (MUZZLE[t.kind]) addEffect(MUZZLE[t.kind], t.x1, t.y1, t.z1 || 0, { angle: Math.atan2(t.y2 - t.y1, t.x2 - t.x1), life: 1 });
    }
    // CThing_Shot_Bullet: a collision before full range clicks off a wall
    // sound, and one time in three leaves Effect.BulletHit for a tick.
    if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) < range - 0.02) {
      sfx.play(`Shot.HitWall.${1 + Math.floor(Math.random() * 3)}`);
      if (Math.random() < 1 / 3) addEffect('bulletHit', t.x2, t.y2, t.z2 || 0, { life: 1 });
    }
  }
  for (const b of fresh(fx.blasts, blasts)) {
    addEffect('explosion', b.x, b.y, 0, { speed: 2.5 });
    scorchMark(b.x, b.y);
    sfx.play('Effect.Explosion');
  }
  for (const c of fresh(fx.corpses, corpses)) {
    bloodSplat(c.x, c.y);
    sfx.play(zombieSample(c));
  }
  // Shots: rockets announce themselves; grenades and cluster shells click
  // as they bounce (Shot.Grenade.Bounce).
  const seen = new Set();
  for (const s of shots) {
    seen.add(s.id);
    const prev = fx.shots.get(s.id), z = s.z || 0;
    if (!prev) {
      if (s.kind === 'rocket') sfx.play('Weapon.Rocket.Fire');
      fx.shots.set(s.id, { z, dz: 0 });
      continue;
    }
    const dz = z - prev.z;
    if ((s.kind === 'grenade' || s.kind === 'cluster') && prev.dz < -0.01 && dz >= 0 && z < 0.3) sfx.play('Shot.Grenade.Bounce');
    prev.dz = steps ? dz : prev.dz; prev.z = z;
  }
  for (const id of fx.shots.keys()) if (!seen.has(id)) fx.shots.delete(id);
  const minesBefore = new Set(fx.mines);
  if (fresh(fx.mines, mines).length) sfx.play('Weapon.Mine.Place');
  for (const id of minesBefore) if (!fx.mines.has(id)) sfx.play('Object.Mine.Detonate');
  const objectsBefore = new Set(fx.objects);
  if (fresh(fx.objects, [...barrels, ...blocks]).some(o => o.placed !== false)) sfx.play('Object.Barrel.Place');
  for (const id of objectsBefore) {
    if (fx.objects.has(id)) continue;
    const gone = lastBlocks.get(id);
    if (gone) addEffect('smokeCloud', gone.x, gone.y, 0, { life: 1 }); // a fake wall broke
  }
  lastBlocks = new Map(blocks.map(b => [b.id, { x: b.x, y: b.y }]));
  for (const t of fresh(fx.msgs, texts)) {
    if (t.kind !== 'msg') continue;
    addHudMessage(t.text, t.color);
    if (t.text.startsWith('-+-')) sfx.play('World.End');           // CUpgrades: a new level plays Click
    else if (t.text.startsWith('Picked up') || t.text === 'Life up!') sfx.play('Object.Pickup');
  }
  // Hits: blood on the floor and the creature's damage sound.
  for (const z of zombies) {
    const key = 'z' + z.id, before = fx.hits.get(key);
    if (before !== undefined && z.hits > before) {
      bloodSplat(z.x, z.y);
      const sample = zombieSample(z);
      if (sample) sfx.play(sample);
    }
    fx.hits.set(key, z.hits);
  }
  for (const p of players) {
    const key = 'p' + p.id, before = fx.hits.get(key);
    if (before !== undefined && p.hits > before) bloodSplat(p.x, p.y);
    fx.hits.set(key, p.hits);
    if (p.state === 'dying' && fx.down.get(p.id) !== 'dying') sfx.play('Creature.Player.Scream.1');
    if (p.state === 'dead' && fx.down.get(p.id) === 'dying') { sfx.play('Creature.HitFloor'); bloodSplat(p.x, p.y); }
    fx.down.set(p.id, p.state);
  }
  for (const id of [...fx.hits.keys()]) if (id[0] === 'z' && !zombies.some(z => 'z' + z.id === id)) fx.hits.delete(id);
  forgetCreatures();
  for (let i = 0; i < steps; i++) tickEffects();
}
let lastBlocks = new Map();

// The zombie's own damage and death sample (CThing_Creature_Zombie picks one
// of the four Creature.Zombie.Ambience clips when it is made).
const zombieSample = z => `Creature.Zombie.Ambience.${1 + (Math.abs(z.id * 7) % 4)}`;

// One logic tick of the effect things and the per-tick decals.
function tickEffects() {
  for (const e of effects) {
    e.ticks++;
    e.f += e.speed;
    e.x += e.dx; e.y += e.dy;
  }
  effects = effects.filter(e => {
    if (e.life !== undefined) return e.ticks < e.life;
    const s = art.sprites[e.key];
    return s && e.f < s.frames;
  });
  // CThing_Shot_Rocket leaves Effect.RocketSmoke behind every tick.
  for (const s of shots) {
    if (s.kind !== 'rocket') continue;
    const a = s.angle || 0;
    addEffect('rocketSmoke', s.x, s.y, s.z || 0, { dx: -Math.cos(a) * 0.6, dy: -Math.sin(a) * 0.6 });
  }
  // State_BulletHit (not from explosions) and State_Dying bleed every tick.
  for (const z of zombies) if (z.state === 'hit') bloodSplat(z.x, z.y);
  for (const c of corpses) {
    if (c.t * 0.34 < 5) bloodSplat(c.x, c.y);
    else if ((c.t - 1) * 0.34 < 5) sfx.play('Creature.HitFloor');
  }
  for (const p of players) if (p.state === 'hit' || p.state === 'dying') bloodSplat(p.x, p.y);
  ambience.tick();
  tickHudMessages();
}

// CWorld.ProcessAmbience: the more zombies on screen, the more of the four
// ambience clips overlap and the sooner the next one starts.
const ambience = {
  ticker: 0, index: 0, onScreen: 0,
  reset() { this.ticker = 0; this.index = 0; sfx.stopAmbience(); },
  tick() {
    const n = this.onScreen;
    this.ticker++;
    if (!n) { sfx.stopAmbience(); return; }
    const [channels, every] = n <= 2 ? [1, 150] : n <= 4 ? [2, 150] : n <= 8 ? [3, 60] : [3, 1];
    if (this.ticker % every === 0 && sfx.ambienceCount() < channels) {
      sfx.ambience(`Creature.Zombie.Ambience.${this.index + 1}`);
      this.index = (this.index + 1) % 4;
    }
  },
};

// ─── Things ─────────────────────────────────────────────────────────────────
function drawItem(it) {
  if (it.sprite) {
    const s = it.sprite;
    ctx.globalAlpha = it.alpha;
    ctx.drawImage(s.img, Math.round(it.x + s.x), Math.round(it.y + s.y), s.w, s.h); // copyPixels lands on whole pixels
    ctx.globalAlpha = 1;
  } else if (it.key) drawSprite(it.key, it.frame || 0, it.x, it.y, it.alpha ?? 1, it.angle || 0);
}

// Everything in view, in the order CWorld draws it: dead creatures on the
// floor first, then the rest by depth.
function worldItems(vx, vy, vw, vh) {
  const floor = [], items = [];
  const visible = (x, y) => x > vx - 96 && x < vx + vw + 96 && y > vy - 96 && y < vy + vh + 160;
  for (const m of mines) {
    const x = sx(m.x), y = sy(m.y);
    if (!visible(x, y)) continue;
    // Animate_Cycle(1 / mFPS) while armed, a frame a tick once triggered.
    const frame = m.fuse >= 0 ? ticks % 2 : Math.floor(ticks / fps()) % 2;
    floor.push({ key: m.kind === 'charge' ? 'chargepack' : 'mine', frame, x, y, d: y });
  }
  for (const c of corpses) {
    const x = sx(c.x), y = sy(c.y);
    if (!visible(x, y)) continue;
    const pose = corpsePose(c), dead = pose[0] === 'Player/Dead';
    const alpha = dead ? clamp((c.life - c.t) / fps(), 0, 1) : 1;
    const it = creatureSprite(c.devil ? 'devil' : 'zombie', pose, x, y, c.angle, alpha);
    if (it) (dead ? floor : items).push({ ...it, d: y });
  }
  for (const b of barrels) {
    const x = sx(b.x), y = sy(b.y);
    if (visible(x, y) && b.r > 0.01) items.push({ key: 'barrel', x, y, d: y });
  }
  for (const b of blocks) {
    const x = sx(b.x), y = sy(b.y), s = art.sprites.wall;
    if (visible(x, y)) items.push({ key: 'wall', frame: s ? Math.floor((1 - b.hp / b.max) * s.frames) : 0, x, y, alpha: b.alpha ?? 1, d: y });
  }
  for (const k of pickups) {
    const x = sx(k.x), y = sy(k.y);
    if (!k.hidden && visible(x, y)) items.push({ key: 'pickup', x, y, alpha: k.drop && k.life < fps() ? clamp(k.life / fps(), 0, 1) : 1, d: y });
  }
  let onScreen = 0;
  for (const z of zombies) {
    const x = sx(z.x), y = sy(z.y);
    if (!visible(x, y)) continue;
    if (x > vx && x < vx + vw && y > vy && y < vy + vh) onScreen++;
    const it = creatureSprite(z.devil ? 'devil' : 'zombie', zombiePose(z), x, y, z.angle);
    if (it) items.push({ ...it, d: y });
  }
  for (const p of players) {
    if (p.state === 'respawn') continue;
    if (p.inv > 0 && p.inv % 2 && !p.down) continue; // invincible players flicker
    const x = sx(p.x), y = sy(p.y);
    if (!visible(x, y)) continue;
    const it = creatureSprite(styleOf(p.look), playerPose(p), x, y, p.angle, p.alpha ?? 1);
    if (it) ((p.state === 'dead') ? floor : items).push({ ...it, d: y });
  }
  for (const s of shots) {
    const z = s.z ?? (s.kind === 'fireball' ? RULES.fireball?.z ?? 0.84 : 0), x = sx(s.x), y = sy(s.y, z);
    if (!visible(x, y)) continue;
    const key = s.kind === 'rocket' ? 'rocket' : s.kind === 'fireball' ? 'fireball' : s.kind === 'cluster' ? 'cluster' : 'grenade';
    items.push({ key, x, y, d: sy(s.y) });
  }
  for (const e of effects) {
    const x = sx(e.x), y = sy(e.y, e.z);
    if (!visible(x, y)) continue;
    const rotated = e.key.startsWith('muzzle');
    items.push({ key: e.key, frame: e.f, x, y, angle: rotated ? e.angle : 0, d: sy(e.y) + (e.key === 'explosion' ? 16 : 0) });
  }
  items.sort((a, b) => a.d - b.d);
  return { floor, items, onScreen };
}

// CThing_Shot_Bullet and CThing_Shot_Railgun draw into mcScratch: a 0.5
// pixel 0xCCCCCC line at 75 %, the railgun a 2 pixel 0x9966FF one at 56 %.
function drawShotLines() {
  ctx.lineCap = 'round';
  for (const t of tracers) {
    const rail = t.kind === 'railgun';
    ctx.strokeStyle = rail ? 'rgba(153,102,255,0.5625)' : 'rgba(204,204,204,0.75)';
    ctx.lineWidth = rail ? 2 : 0.5;
    ctx.beginPath();
    ctx.moveTo(sx(t.x1), sy(t.y1, t.z1 || 0));
    ctx.lineTo(sx(t.x2), sy(t.y2, t.z2 || 0));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// ─── Text ───────────────────────────────────────────────────────────────────
// HUD text is Calibri Bold, white, with GlowFilter(black, 2, 2, strength 10):
// a hard two-pixel black outline. Rendered once per string and size.
const HUD_FONT = 'Calibri, "Open Sans", Arial, sans-serif';
const labels = new Map();
function hudText(text, x, y, size, align = 'center', fill = '#fff', bold = true, outline = true, spacing = 0) {
  const key = `${text}|${size}|${fill}|${bold}|${outline}|${spacing}`;
  let t = labels.get(key);
  if (t) labels.delete(key);
  else {
    const res = Math.min(pixel, 3), font = `${bold ? 700 : 400} ${size}px ${HUD_FONT}`, pad = outline ? 4 : 1;
    ctx.font = font;
    if (spacing) ctx.letterSpacing = `${spacing}px`;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.25) + pad * 2;
    if (spacing) ctx.letterSpacing = '0px';
    const img = document.createElement('canvas');
    img.width = Math.ceil(w * res);
    img.height = Math.ceil(h * res);
    const g = img.getContext('2d');
    g.scale(res, res);
    g.font = font;
    if (spacing) g.letterSpacing = `${spacing}px`;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    if (outline) {
      g.lineWidth = 4;
      g.strokeStyle = '#000';
      g.strokeText(text, pad, h / 2);
    }
    g.fillStyle = fill;
    g.fillText(text, pad, h / 2);
    t = { img, w, h, pad };
    if (labels.size > 400) labels.delete(labels.keys().next().value);
  }
  labels.set(key, t);
  const left = align === 'center' ? x - t.w / 2 : align === 'right' ? x - t.w + t.pad : x - t.pad;
  ctx.drawImage(t.img, left, y - t.h / 2, t.w, t.h);
  return t.w - t.pad * 2;
}
const label = (text, x, y, size, fill = '#fff', align = 'center') => hudText(text, x, y, size, align, fill);

// ─── Frame ──────────────────────────────────────────────────────────────────
// Deathmatch is split screen (CWorld.mSplitScreen): each player gets a
// 480 × 480 view shrunk to 320 × 320 and centred vertically. With the saved
// default view side, player 1 (arrow keys) is on the right.
const SPLIT = { size: 480, scale: 320 / 480, top: 80 };
let viewSide = (() => { try { return localStorage.getItem('deadrooms:viewSide') === '0' ? 0 : 1; } catch { return 1; } })();
const splitCams = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const splitMode = () => game.mode === 3 && game.state !== 'menu' && players.length === 2;

function swapViews() {
  viewSide = 1 - viewSide;
  try { localStorage.setItem('deadrooms:viewSide', String(viewSide)); } catch {}
}

// Each view follows its own player directly, held while that player is down.
function trackSplit() {
  const rw = room.cols * CELL, rh = room.rows * CELL, v = SPLIT.size;
  players.forEach((p, i) => {
    if (p.down || p.state === 'respawn') return;
    splitCams[i].x = rw <= v ? (rw - v) / 2 : clamp(p.x * CELL - v / 2, 0, rw - v);
    splitCams[i].y = rh <= v ? (rh - v) / 2 : clamp(p.y * CELL - v / 2, 0, rh - v);
  });
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = game.state === 'menu' ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!room || game.state === 'menu') return;
  if (!art.ready || !roomArt(room.index).ready) { drawLoading(); return; }
  const sh = shake * 6, ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
  let seen = 0;
  if (splitMode()) {
    trackSplit();
    players.forEach((p, i) => {
      const slot = i === 0 ? viewSide : 1 - viewSide, c = splitCams[i];
      seen = Math.max(seen, drawWorld(Math.round(c.x - ox), Math.round(c.y - oy), SPLIT.size, SPLIT.size, slot * (W / 2), SPLIT.top, SPLIT.scale));
    });
  } else seen = drawWorld(Math.round(cam.x - ox), Math.round(cam.y - oy), W, H, 0, 0, 1);
  ambience.onScreen = seen;
  ctx.setTransform(pixel, 0, 0, pixel, 0, 0);
  if (flashLight > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashLight * 0.3})`;
    ctx.fillRect(0, 0, W, H);
  }
  drawHud();
}

// Screen_LoadingWorld while the room's layers are still being prepared.
function drawLoading() {
  ctx.setTransform(pixel, 0, 0, pixel, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (art.title.loading) ctx.drawImage(art.title.loading, 0, 0, W, H);
  else if (art.error) hudText('The game files could not be loaded.', W / 2, H / 2, 24, 'center', '#ff0000', true, false);
}

// The world seen from (vx, vy), vw × vh pixels, drawn at (x0, y0) scaled by k.
// Returns how many zombies were on screen (for the ambience).
function drawWorld(vx, vy, vw, vh, x0, y0, k) {
  ctx.save();
  ctx.setTransform(pixel, 0, 0, pixel, 0, 0);
  ctx.beginPath();
  ctx.rect(x0, y0, vw * k, vh * k);
  ctx.clip();
  ctx.setTransform(pixel * k, 0, 0, pixel * k, (x0 - vx * k) * pixel, (y0 - vy * k) * pixel);
  const layers = roomArt(room.index);
  drawLayer(layers.floor, vx, vy, vw, vh);
  const cx0 = Math.max(0, Math.floor(vx / CHUNK)), cx1 = Math.floor((vx + vw) / CHUNK), cy0 = Math.max(0, Math.floor(vy / CHUNK)), cy1 = Math.floor((vy + vh) / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const d = decalChunks.get(cx + ',' + cy);
      if (d) ctx.drawImage(d.c, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
    }
  }
  const { floor, items, onScreen } = worldItems(vx, vy, vw, vh);
  for (const it of floor) drawItem(it);
  for (const it of items) drawItem(it);
  drawShotLines();
  drawLayer(layers.cover, vx, vy, vw, vh);
  drawPlayerTags();
  ctx.restore();
  return onScreen;
}
