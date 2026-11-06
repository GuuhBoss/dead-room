// ─── Entities ───────────────────────────────────────────────────────────────
function makePlayer(id, x, y) {
  return {
    id, x, y, r: 13, angle: -Math.PI / 2, hp: 100, weapon: 0,
    ammo: WEAPONS.map(w => (w.start === Infinity ? Infinity : 0)),
    cooldown: 0, walk: 0, hurt: 0, invuln: 2, sinceHurt: 9, recoil: 0, muzzle: 0,
    down: false, revive: 0, look: id ? LOOKS.p2 : LOOKS.p1, ai: null,
  };
}

function makeZombie(x, y, devil) {
  return {
    x, y, devil, r: devil ? 15 : 13, look: devil ? LOOKS.devil : LOOKS.zombie,
    hp: devil ? 230 + level * 18 : 62 + level * 5,
    speed: devil ? 64 + Math.min(level * 1.4, 26) : rand(46, 60) + Math.min(level * 2.4, 34),
    heading: Math.PI / 2, dir: Math.PI / 2, walk: rand(0, TAU), flash: 0,
    attack: 0, attackCd: 0, attackBlock: null, kx: 0, ky: 0,
    los: false, losTimer: 0, stuck: 0, forceFlow: 0, fireCd: rand(2, 4), cast: 0, dead: false,
  };
}

// ─── Kill multiplier, unlocks and levels ────────────────────────────────────
const killsForLevel = n => 2 + Math.ceil(n * 0.45);
const unlocked = i => WEAPONS[i].unlock <= combo.best;

function addKill(z) {
  kills++;
  combo.bar += 1 / killsForLevel(combo.level);
  while (combo.bar >= 1) {
    combo.bar -= 1;
    combo.level++;
    combo.pulse = 1;
    if (combo.level > combo.best) { combo.best = combo.level; reward(combo.level); }
  }
  score += (z.devil ? 500 : 100) * combo.level;
}

function loseCombo(amount) {
  combo.bar -= amount;
  if (combo.bar >= 0) return;
  if (combo.level > 1) { combo.level--; combo.bar = 0.55; combo.pulse = -1; } else combo.bar = 0;
}

function reward(n) {
  const i = WEAPONS.findIndex(w => w.unlock === n);
  if (i >= 0) {
    const w = WEAPONS[i];
    for (const p of players) {
      p.ammo[i] = Math.max(p.ammo[i], w.start);
      if (!p.down && !['barrel', 'wall', 'mine'].includes(w.kind)) p.weapon = i;
    }
    showToast('NEW WEAPON', w.name);
    sfx.unlock();
    return;
  }
  const up = UPGRADES.find(u => u.level === n);
  if (up) { upgrades[up.key] = true; showToast('UPGRADE', up.text); sfx.unlock(); return; }
  if (n > 16) {
    for (let k = 0; k < 3; k++) dropPickup('ammo');
    showToast('SUPPLY DROP', `x${n} reached`);
    sfx.unlock();
  }
}

function showBanner(title, sub, life = 2.6) { banner = { title, sub, t: 0, life }; }
function showToast(kind, text) { toast = { kind, text, t: 0, life: 2.8 }; }

function nextLevel() {
  level++;
  toSpawn = Math.min(12 + (level - 1) * 7, 150);
  spawnGap = Math.max(0.2, 0.85 - level * 0.055);
  maxAlive = Math.min(36 + level * 5, 90);
  devilChance = level < 3 ? 0 : Math.min(0.05 + (level - 3) * 0.022, 0.28);
  spawnTimer = 1.2;
  for (const p of players) if (p.down) revivePlayer(p, 50);
  showBanner(`LEVEL ${level}`, level === 1 ? 'Kill fast to raise the multiplier and unlock weapons' : `${toSpawn} zombies incoming`, level === 1 ? 3.6 : 2.6);
  sfx.level();
}

function updateLevel(dt) {
  if (intermission > 0) {
    intermission -= dt;
    if (intermission <= 0) nextLevel();
  } else if (toSpawn > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && zombies.length < maxAlive) { spawnZombie(); spawnTimer = spawnGap * rand(0.5, 1.5); }
  } else if (!zombies.length) {
    const bonus = level * 1000;
    score += bonus;
    intermission = 3.5;
    showBanner('LEVEL CLEAR', `+${bonus.toLocaleString()} bonus`);
    if (players.some(p => !p.down && p.hp < 70)) dropPickup('health', FLOOR_W / 2, FLOOR_H / 2 + 70);
  }
  pickupTimer -= dt;
  if (pickupTimer <= 0) {
    pickupTimer = rand(7, 11);
    const hurt = players.some(p => !p.down && p.hp < 50);
    if (pickups.length < 3) dropPickup(hurt && Math.random() < 0.4 ? 'health' : 'ammo');
  }
  groanTimer -= dt;
  if (groanTimer <= 0) { groanTimer = rand(1.4, 3.6); if (zombies.length) sfx.groan(); }
}

function updateCombo(dt) {
  combo.pulse = Math.abs(combo.pulse) < 0.02 ? 0 : combo.pulse * Math.exp(-dt * 5);
  if (intermission > 0 || !zombies.length) return;
  combo.bar -= dt * (0.06 + combo.level * 0.008);
  if (combo.bar < 0) loseCombo(0);
}

function spawnZombie() {
  const g = pick(room.gates), along = rand(g.lo + 16, g.hi - 16);
  const x = g.side === 'w' ? -50 : g.side === 'e' ? FLOOR_W + 50 : along;
  const y = g.side === 'n' ? -60 : g.side === 's' ? FLOOR_H + 50 : along;
  const z = makeZombie(x, y, Math.random() < devilChance);
  z.heading = z.dir = Math.atan2(g.dy, g.dx);
  zombies.push(z);
  toSpawn--;
}

// ─── Players ────────────────────────────────────────────────────────────────
function updatePlayer(p, input, dt) {
  p.cooldown -= dt; p.invuln -= dt; p.muzzle -= dt; p.sinceHurt += dt;
  p.hurt = Math.max(0, p.hurt - dt);
  p.recoil = Math.max(0, p.recoil - dt * 7);
  if (p.down) return;
  if (input.dx || input.dy) {
    p.angle = snap(Math.atan2(input.dy, input.dx));
    const step = 170 * dt, vx = Math.cos(p.angle) * step, vy = Math.sin(p.angle) * step;
    const ox = p.x, oy = p.y;
    move(p, vx, vy, true);
    const straight = Math.abs(vx) < 0.01 || Math.abs(vy) < 0.01;
    if (straight && Math.hypot(p.x - ox, p.y - oy) < step * 0.2) nudge(p, vx, vy, true);
    p.walk += dt * 12;
  } else {
    // Ease the stride back to a standing pose.
    const rest = Math.round(p.walk / Math.PI) * Math.PI;
    p.walk += clamp(rest - p.walk, -dt * 8, dt * 8);
  }
  if (input.prev) cycleWeapon(p, -1);
  if (input.next) cycleWeapon(p, 1);
  if (input.select >= 0) selectWeapon(p, input.select);
  if (input.fire) fire(p);
  if (p.sinceHurt > 4 && p.hp < 100) p.hp = Math.min(100, p.hp + dt * 3);
}

function updateRevives(dt) {
  for (const p of players) {
    if (!p.down) continue;
    const helper = players.find(o => o !== p && !o.down && dist(o, p) < 52);
    p.revive = helper ? p.revive + dt : Math.max(0, p.revive - dt);
    if (p.revive >= 2.2) revivePlayer(p, 40);
  }
}

function revivePlayer(p, hp) {
  p.down = false; p.hp = hp; p.revive = 0; p.invuln = 2; p.sinceHurt = 0;
  floatText(p.x, p.y, 'BACK UP!', '#9bff7a');
}

function hurtPlayer(p, damage, fromX, fromY) {
  if (p.down || p.invuln > 0 || game.demo) return;
  p.hp -= damage; p.hurt = 0.3; p.sinceHurt = 0; p.invuln = 0.3;
  const d = Math.hypot(p.x - fromX, p.y - fromY) || 1;
  move(p, ((p.x - fromX) / d) * 6, ((p.y - fromY) / d) * 6, true);
  shake = Math.min(18, shake + 4);
  bleed(p.x, p.y, (p.x - fromX) / d, (p.y - fromY) / d, 4);
  loseCombo(0.4);
  sfx.hurt();
  if (p.hp <= 0) {
    p.hp = 0; p.down = true; p.revive = 0;
    splat(p.x, p.y, 14);
    sfx.down();
    if (players.length > 1 && players.some(o => !o.down)) floatText(p.x, p.y, `P${p.id + 1} DOWN`, '#ff7a6a');
  }
}

const available = (p, i) => unlocked(i) && p.ammo[i] > 0;

function cycleWeapon(p, step) {
  for (let k = 1; k < WEAPONS.length; k++) {
    const i = (p.weapon + step * k + WEAPONS.length * 9) % WEAPONS.length;
    if (available(p, i)) { p.weapon = i; sfx.click(); return; }
  }
}

function selectWeapon(p, i) {
  if (i < WEAPONS.length && available(p, i) && p.weapon !== i) { p.weapon = i; sfx.click(); }
}

function gunStats(w) {
  let { rate, damage, pellets, spread } = w;
  if (w.id === 'pistol') { if (upgrades.pistolRapid) rate = 0.18; if (upgrades.pistolDamage) damage *= 2; }
  if (w.id === 'uzi') { if (upgrades.uziDamage) damage *= 1.5; if (upgrades.uziRapid) rate = 0.06; }
  if (w.id === 'shotgun' && upgrades.shotgunSpread) { pellets = 11; spread = 0.56; }
  return { rate, damage, pellets, spread };
}

function fire(p) {
  if (p.cooldown > 0) return;
  const w = WEAPONS[p.weapon];
  if (!(p.ammo[p.weapon] > 0)) { fallback(p); return; }
  let used = true;
  if (w.kind === 'gun') fireGun(p, w);
  else if (w.kind === 'rail') fireRail(p, w);
  else if (w.kind === 'rocket') fireRocket(p);
  else if (w.kind === 'grenade') throwGrenade(p);
  else if (w.kind === 'barrel') used = placeBarrel(p);
  else if (w.kind === 'wall') used = placeBlock(p);
  else if (w.kind === 'mine') used = placeMine(p);
  if (!used) { p.cooldown = 0.25; sfx.deny(); return; }
  p.cooldown = w.kind === 'gun' ? gunStats(w).rate : w.rate;
  if (p.ammo[p.weapon] !== Infinity && !game.demo) p.ammo[p.weapon]--;
  if (p.ammo[p.weapon] <= 0) fallback(p);
}

// Out of ammo: fall back to the strongest gun that still has some.
function fallback(p) {
  for (const i of [8, 6, 2, 1, 0]) if (available(p, i)) { p.weapon = i; return; }
}

// World position of the gun's muzzle, plus its height above the floor.
function muzzle(p) {
  const g = (GUNS[WEAPONS[p.weapon].id] || [{ u: 19, v: -3, z: 34, d: 6 }])[0], s = p.look.scale;
  const u = g.u, v = g.v + g.d / 2, fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  const X = (-u * fy + v * fx) * s, Y = (u * fx + v * fy) * s, h = g.z * s * FZ;
  return { x: p.x + X, y: p.y + Y * FY - h, h };
}

function fireGun(p, w) {
  const st = gunStats(w), m = muzzle(p);
  for (let i = 0; i < st.pellets; i++) {
    const offset = st.pellets > 1 ? (i / (st.pellets - 1) - 0.5) * st.spread + rand(-0.03, 0.03) : rand(-st.spread, st.spread);
    const range = w.range * (st.pellets > 1 ? rand(0.8, 1) : 1);
    const end = hitscan(p, p.angle + offset, range, st.damage, w.knock, 0);
    tracers.push({ x1: m.x, y1: m.y, x2: end.x, y2: end.y - m.h, t: 0, life: w.id === 'uzi' ? 0.05 : 0.08, width: w.id === 'shotgun' ? 1.5 : 2.2, color: '255,236,170' });
  }
  p.muzzle = 0.05; p.recoil = 1;
  const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  emit({ kind: 'shell', x: p.x + fx * 10 - fy * 12, y: p.y + fy * 10 + fx * 12, z: m.h, vx: -fy * rand(40, 90) + rand(-20, 20), vy: fx * rand(40, 90) + rand(-20, 20), vz: rand(90, 160), life: 0.9, max: 0.9, size: 2.5, color: w.id === 'shotgun' ? '#b8402e' : '#d9b44a' });
  sfx.shot(w.id);
}

function fireRail(p, w) {
  const m = muzzle(p), end = hitscan(p, p.angle, 1500, w.damage, 220, Infinity);
  tracers.push({ x1: m.x, y1: m.y, x2: end.x, y2: end.y - m.h, t: 0, life: 0.4, width: 7, color: '140,240,255', rail: true });
  const n = Math.floor(Math.hypot(end.x - m.x, end.y - m.h - m.y) / 26);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    emit({ kind: 'spark', x: m.x + (end.x - m.x) * k, y: m.y + m.h + (end.y - m.y - m.h) * k, z: m.h, vx: rand(-40, 40), vy: rand(-40, 40), vz: rand(10, 60), life: rand(0.2, 0.45), max: 0.45, size: 2, color: '#bff8ff' });
  }
  p.muzzle = 0.08; p.recoil = 1.6; shake = Math.min(18, shake + 5);
  sfx.shot('railgun');
}

function fireRocket(p) {
  const m = muzzle(p), fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  shots.push({ kind: 'rocket', x: p.x + fx * 22, y: p.y + fy * 22, z: m.h, vx: fx * 600, vy: fy * 600, angle: p.angle, life: 2.2 });
  p.muzzle = 0.06; p.recoil = 1.4;
  sfx.shot('rocket');
}

function throwGrenade(p) {
  const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  shots.push({ kind: 'grenade', x: p.x + fx * 16, y: p.y + fy * 16, z: 48, vx: fx * 360, vy: fy * 360, vz: 220, fuse: 1.15, spin: 0 });
  sfx.shot('throw');
}

function spotFree(x, y, r) {
  if (x < r || y < r || x > FLOOR_W - r || y > FLOOR_H - r) return false;
  if (blockedAt(x, y, r, true)) return false;
  for (const e of players) if (Math.hypot(e.x - x, e.y - y) < r + e.r - 2) return false;
  for (const e of zombies) if (!e.dead && Math.hypot(e.x - x, e.y - y) < r + e.r - 2) return false;
  return true;
}

function placeBarrel(p) {
  const x = p.x + Math.cos(p.angle) * 36, y = p.y + Math.sin(p.angle) * 36;
  if (!spotFree(x, y, BARREL_R)) return false;
  barrels.push({ x, y, hp: 30, lit: false, fuse: 0, flash: 0, drop: 24 });
  navDirty = true;
  sfx.place();
  return true;
}

function placeBlock(p) {
  const c = Math.floor((p.x + Math.cos(p.angle) * 44) / CELL), r = Math.floor((p.y + Math.sin(p.angle) * 44) / CELL);
  if (c < 1 || r < 1 || c >= COLS - 1 || r >= ROWS - 1 || room.tiles[r][c] !== '.' || blockAt(c, r)) return false;
  const x0 = c * CELL, y0 = r * CELL;
  const overlaps = e => Math.hypot(e.x - clamp(e.x, x0, x0 + CELL), e.y - clamp(e.y, y0, y0 + CELL)) < e.r;
  if (players.some(overlaps) || zombies.some(z => !z.dead && overlaps(z))) return false;
  if (barrels.some(b => b.x > x0 - BARREL_R && b.x < x0 + CELL + BARREL_R && b.y > y0 - BARREL_R && b.y < y0 + CELL + BARREL_R)) return false;
  const block = { c, r, hp: 320, max: 320, flash: 0, rise: 0 };
  blocks.push(block);
  blockGrid[r * COLS + c] = block;
  navDirty = true;
  sfx.place();
  return true;
}

function placeMine(p) {
  if (mines.some(m => Math.hypot(m.x - p.x, m.y - p.y) < 22)) return false;
  mines.push({ x: p.x, y: p.y, arm: 0.9, lit: false, fuse: 0 });
  sfx.place();
  return true;
}

// ─── Damage ─────────────────────────────────────────────────────────────────
function rayWall(x, y, dx, dy, max) {
  for (let t = 0; t <= max; t += 4) {
    const tl = tileAt(Math.floor((x + dx * t) / CELL), Math.floor((y + dy * t) / CELL));
    if (tl === '#' || tl === 'P') return t;
  }
  return max;
}

// Instant shots: find everything along the ray, nearest first.
function hitscan(p, angle, range, damage, knock, pierce) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const ox = p.x + dx * 10, oy = p.y + dy * 10;
  const wall = rayWall(ox, oy, dx, dy, range);
  const hits = [];
  for (const z of zombies) {
    if (z.dead) continue;
    const rx = z.x - ox, ry = z.y - oy, t = rx * dx + ry * dy;
    if (t < -8 || t > wall + z.r) continue;
    if (Math.abs(rx * dy - ry * dx) < z.r + 4) hits.push({ t, z });
  }
  for (const b of barrels) {
    const rx = b.x - ox, ry = b.y - oy, t = rx * dx + ry * dy;
    if (t < 0 || t > wall) continue;
    if (Math.abs(rx * dy - ry * dx) < BARREL_R) hits.push({ t, b });
  }
  hits.sort((a, b) => a.t - b.t);
  let end = wall, solid = true;
  for (const h of hits) {
    if (h.b) {
      damageBarrel(h.b, damage);
      if (pierce !== Infinity) { end = h.t; solid = false; break; }
      continue;
    }
    hurtZombie(h.z, damage * (1 - (Math.max(0, h.t) / range) * 0.35), dx, dy, knock, 'shot');
    if (pierce-- <= 0) { end = Math.max(0, h.t); solid = false; break; }
  }
  const x = ox + dx * end, y = oy + dy * end;
  if (solid && end < range - 1) sparks(x, y, dx, dy);
  return { x, y };
}

function hurtZombie(z, damage, dx, dy, knock, cause) {
  if (z.dead) return;
  z.hp -= damage;
  z.flash = 0.09;
  const mass = z.devil ? 0.45 : 1;
  z.kx += dx * knock * mass; z.ky += dy * knock * mass;
  bleed(z.x, z.y, dx, dy, z.devil ? 2 : 3);
  if (z.hp <= 0) killZombie(z, dx, dy, cause);
  else if (Math.random() < 0.3) splat(z.x + rand(-6, 6), z.y + rand(-4, 6), rand(3, 6));
}

function killZombie(z, dx, dy, cause) {
  z.dead = true;
  addKill(z);
  splat(z.x, z.y, z.devil ? 18 : 13);
  if (cause === 'blast') gibs(z, dx, dy);
  else corpses.push({ x: z.x, y: z.y, angle: snap(Math.atan2(-dy, -dx)), look: z.look, devil: z.devil, walk: z.walk, t: 0 });
  if (corpses.length > 50) corpses.shift();
  if (Math.random() < (z.devil ? 0.5 : 0.035)) dropPickup('ammo', z.x, z.y);
  sfx.splat();
}

function damageBarrel(b, damage) {
  b.hp -= damage;
  b.flash = 0.08;
  if (b.hp <= 0 && !b.lit) { b.lit = true; b.fuse = 0.04; }
}

function damageBlock(block, damage) {
  block.hp -= damage;
  block.flash = 0.08;
  if (block.hp > 0) return;
  blocks = blocks.filter(b => b !== block);
  blockGrid[block.r * COLS + block.c] = null;
  navDirty = true;
  const x = block.c * CELL + CELL / 2, y = block.r * CELL + CELL / 2;
  for (let i = 0; i < 12; i++) emit({ kind: 'gib', x: x + rand(-14, 14), y: y + rand(-14, 14), z: rand(10, 34), vx: rand(-120, 120), vy: rand(-120, 120), vz: rand(80, 240), life: rand(1, 1.8), max: 1.8, size: rand(4, 8), color: pick(['#e6dfcf', '#a79f8c', '#c9c1ad']) });
  sfx.crumble();
}

function explode(x, y, radius, damage) {
  blasts.push({ x, y, r: radius, t: 0 });
  shake = Math.min(20, shake + 9);
  flashLight = Math.min(0.6, flashLight + 0.3);
  scorch(x, y, radius * 0.55);
  sfx.boom(radius / 100);
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), s = rand(20, 90);
    emit({ kind: 'smoke', x: x + Math.cos(a) * rand(0, radius * 0.4), y: y + Math.sin(a) * rand(0, radius * 0.3), z: rand(10, 50), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rand(20, 60), life: rand(0.8, 1.6), max: 1.6, size: rand(14, 26), grow: rand(18, 36), color: '60,56,52' });
  }
  for (let i = 0; i < 18; i++) {
    const a = rand(0, TAU), s = rand(120, 380);
    emit({ kind: 'spark', x, y, z: rand(10, 40), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, vz: rand(40, 220), life: rand(0.25, 0.6), max: 0.6, size: 2.5, color: pick(['#ffd36b', '#ff8a3d', '#fff2c4']) });
  }
  for (const z of zombies) {
    if (z.dead) continue;
    const d = Math.hypot(z.x - x, z.y - y);
    if (d > radius + z.r) continue;
    const f = 1 - clamp(d / (radius + z.r), 0, 1), n = d || 1;
    hurtZombie(z, damage * (0.3 + 0.7 * f), (z.x - x) / n, (z.y - y) / n, 140 + 320 * f, 'blast');
  }
  for (const p of players) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < radius * 0.7) hurtPlayer(p, Math.round(6 + 14 * (1 - d / (radius * 0.7))), x, y);
  }
  // Nearby explosives go off a moment later, so chains ripple outward.
  for (const b of barrels) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (!b.lit && d < radius + BARREL_R) { b.lit = true; b.fuse = 0.07 + (d / radius) * 0.18; }
  }
  for (const m of mines) if (!m.lit && Math.hypot(m.x - x, m.y - y) < radius) { m.lit = true; m.fuse = rand(0.08, 0.2); }
  for (const b of blocks.slice()) {
    const d = Math.hypot(b.c * CELL + CELL / 2 - x, b.r * CELL + CELL / 2 - y);
    if (d < radius + 20) damageBlock(b, 150 * (1 - d / (radius + 20)) + 30);
  }
}

function updateExplosives(dt) {
  for (const b of barrels) {
    b.flash = Math.max(0, b.flash - dt);
    b.drop = Math.max(0, b.drop - dt * 160);
    if (b.lit) b.fuse -= dt;
  }
  const boom = barrels.filter(b => b.lit && b.fuse <= 0);
  if (boom.length) {
    barrels = barrels.filter(b => !boom.includes(b));
    navDirty = true;
    for (const b of boom) {
      explode(b.x, b.y, upgrades.barrelBlast ? 130 : 100, 230);
      for (let i = 0; i < 8; i++) emit({ kind: 'gib', x: b.x, y: b.y, z: rand(10, 30), vx: rand(-200, 200), vy: rand(-200, 200), vz: rand(150, 330), life: rand(1, 1.6), max: 1.6, size: rand(4, 7), color: pick(['#8a8c8e', '#c2410c', '#5d5f61']) });
    }
  }
  for (const m of mines) {
    m.arm -= dt;
    if (m.lit) m.fuse -= dt;
    else if (m.arm <= 0 && zombies.some(z => !z.dead && Math.hypot(z.x - m.x, z.y - m.y) < z.r + 12)) { m.lit = true; m.fuse = 0.05; }
  }
  const tripped = mines.filter(m => m.lit && m.fuse <= 0);
  if (tripped.length) {
    mines = mines.filter(m => !tripped.includes(m));
    for (const m of tripped) explode(m.x, m.y, 95, 240);
  }
  for (const b of blocks) { b.flash = Math.max(0, b.flash - dt); b.rise = Math.min(1, b.rise + dt * 7); }
}

// ─── Zombies ────────────────────────────────────────────────────────────────
function nearestPlayer(z) {
  let best = null, bestD = Infinity;
  for (const p of players) {
    if (p.down) continue;
    const d = (p.x - z.x) ** 2 + (p.y - z.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function updateZombie(z, dt) {
  z.flash = Math.max(0, z.flash - dt);
  z.cast = Math.max(0, z.cast - dt);
  z.attackCd -= dt; z.losTimer -= dt; z.forceFlow -= dt;
  if (Math.abs(z.kx) + Math.abs(z.ky) > 2) {
    move(z, z.kx * dt, z.ky * dt, false);
    const k = Math.exp(-dt * 10);
    z.kx *= k; z.ky *= k;
  } else z.kx = z.ky = 0;
  const target = nearestPlayer(z);
  if (!target) { z.walk += dt * 3; return; }
  const dx = target.x - z.x, dy = target.y - z.y, d = Math.hypot(dx, dy) || 1;
  if (z.losTimer <= 0) {
    z.los = d < (z.devil ? 600 : 300) && clearLine(z.x, z.y, target.x, target.y);
    z.losTimer = rand(0.12, 0.28);
  }
  if (z.attack > 0) {
    const before = z.attack;
    z.attack -= dt;
    if (before > ATTACK_HIT && z.attack <= ATTACK_HIT) {
      if (z.attackBlock) { if (z.attackBlock.hp > 0) damageBlock(z.attackBlock, z.devil ? 45 : 28); }
      else if (d < z.r + target.r + 18) hurtPlayer(target, z.devil ? 16 : 10, z.x, z.y);
    }
    if (!z.attackBlock) z.heading = Math.atan2(dy, dx);
    z.dir = snap(z.heading);
    return;
  }
  if (d < z.r + target.r + 8 && z.attackCd <= 0) {
    z.attack = ATTACK_TIME; z.attackCd = rand(0.75, 1.05); z.attackBlock = null;
    z.heading = Math.atan2(dy, dx); z.dir = snap(z.heading);
    return;
  }
  let mx = dx / d, my = dy / d;
  if (d > 50 && (!z.los || z.forceFlow > 0)) {
    const step = flowStep(z, fields[target.id]);
    if (step) {
      if (step.block && step.d < 38) {
        // A fake wall is in the way: claw through it.
        if (z.attackCd <= 0) {
          z.attack = ATTACK_TIME; z.attackCd = rand(0.8, 1.1); z.attackBlock = step.block;
          z.heading = Math.atan2(step.y, step.x); z.dir = snap(z.heading);
        }
        return;
      }
      mx = step.x; my = step.y;
    }
  }
  const speed = z.speed * (z.cast > 0 ? 0.2 : 1), ox = z.x, oy = z.y;
  move(z, mx * speed * dt, my * speed * dt, false);
  // Walking straight at a target can wedge a zombie on a corner; fall back to the field.
  const moved = Math.hypot(z.x - ox, z.y - oy);
  z.stuck = moved < speed * dt * 0.3 ? z.stuck + dt : 0;
  if (z.stuck > 0.4) { z.forceFlow = 1.2; z.stuck = 0; }
  z.heading += turn(z.heading, Math.atan2(my, mx)) * Math.min(1, dt * 10);
  if (Math.abs(turn(z.dir, z.heading)) > OCT * 0.62) z.dir = snap(z.heading);
  z.walk += dt * speed * 0.11;
  if (z.devil) {
    z.fireCd -= dt;
    if (z.fireCd <= 0) {
      if (z.los && d > 90 && d < 600) {
        const a = Math.atan2(dy, dx);
        shots.push({ kind: 'fireball', x: z.x + Math.cos(a) * 18, y: z.y + Math.sin(a) * 18, z: 50, vx: Math.cos(a) * 250, vy: Math.sin(a) * 250, life: 3.5 });
        z.fireCd = rand(2.6, 4.2);
        z.cast = 0.35;
        sfx.fireball();
      } else z.fireCd = 0.4;
    }
  }
}

// Soft separation lets a crowd bunch up the way it does in Boxhead.
function separate() {
  for (let i = 0; i < zombies.length; i++) {
    const a = zombies[i];
    for (let j = i + 1; j < zombies.length; j++) {
      const b = zombies[j], dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r - 5, d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2), ux = d ? dx / d : 1, uy = d ? dy / d : 0, push = (min - d) * 0.25;
      move(a, -ux * push, -uy * push, false);
      move(b, ux * push, uy * push, false);
    }
    for (const p of players) {
      if (p.down) continue;
      const dx = p.x - a.x, dy = p.y - a.y, min = a.r + p.r - 2, d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.01, push = (min - d) * 0.5;
      move(a, (-dx / d) * push * 0.7, (-dy / d) * push * 0.7, false);
      move(p, (dx / d) * push * 0.3, (dy / d) * push * 0.3, true);
    }
  }
}

// ─── Projectiles ────────────────────────────────────────────────────────────
function projectileHit(s, r) {
  const t = tileAt(Math.floor(s.x / CELL), Math.floor(s.y / CELL));
  if (t === '#' || t === 'P' || s.x < -80 || s.y < -80 || s.x > FLOOR_W + 80 || s.y > FLOOR_H + 80) return true;
  for (const z of zombies) if (!z.dead && (z.x - s.x) ** 2 + (z.y - s.y) ** 2 < (z.r + r) ** 2) return true;
  for (const b of barrels) if ((b.x - s.x) ** 2 + (b.y - s.y) ** 2 < (BARREL_R + r) ** 2) return true;
  return false;
}

function grenadeBlocked(x, y, z) {
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (isWall(c, r)) return true;
  if (z < BLOCK_TALL && blockAt(c, r)) return true;
  if (x < -40 || y < -40 || x > FLOOR_W + 40 || y > FLOOR_H + 40) return true;
  return z < BARREL_TALL && barrels.some(b => (b.x - x) ** 2 + (b.y - y) ** 2 < (BARREL_R + 4) ** 2);
}

function updateShots(dt) {
  for (const s of shots) {
    if (s.kind === 'rocket') {
      const steps = Math.ceil((600 * dt) / 8);
      for (let i = 0; i < steps && !s.done; i++) {
        s.x += (s.vx * dt) / steps; s.y += (s.vy * dt) / steps;
        if (projectileHit(s, 6)) {
          s.x -= (s.vx * dt) / steps; s.y -= (s.vy * dt) / steps;
          explode(s.x, s.y, upgrades.rocketBlast ? 140 : 105, 260);
          s.done = true;
        }
      }
      emit({ kind: 'smoke', x: s.x - s.vx * 0.03, y: s.y - s.vy * 0.03, z: s.z, vx: rand(-10, 10), vy: rand(-10, 10), vz: rand(5, 20), life: 0.6, max: 0.6, size: rand(4, 7), grow: 14, color: '200,196,190' });
      s.life -= dt;
      if (s.life <= 0 && !s.done) s.done = true;
    } else if (s.kind === 'grenade') {
      s.vz -= 950 * dt;
      s.z += s.vz * dt;
      s.spin += dt * (Math.abs(s.vx) + Math.abs(s.vy)) * 0.03;
      if (s.z <= 3) {
        s.z = 3;
        if (s.vz < -60) { s.vz = -s.vz * 0.42; s.vx *= 0.6; s.vy *= 0.6; sfx.tink(); } else { s.vz = 0; s.vx *= Math.exp(-dt * 6); s.vy *= Math.exp(-dt * 6); }
      }
      if (grenadeBlocked(s.x + s.vx * dt, s.y, s.z)) s.vx *= -0.5; else s.x += s.vx * dt;
      if (grenadeBlocked(s.x, s.y + s.vy * dt, s.z)) s.vy *= -0.5; else s.y += s.vy * dt;
      s.fuse -= dt;
      if (s.fuse <= 0) { explode(s.x, s.y, 105, 230); s.done = true; }
    } else if (s.kind === 'fireball') {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (Math.random() < 0.6) emit({ kind: 'fire', x: s.x, y: s.y, z: s.z + rand(-4, 4), vx: rand(-20, 20), vy: rand(-20, 20), vz: rand(0, 30), life: 0.35, max: 0.35, size: rand(4, 8), color: '255,140,40' });
      for (const p of players) {
        if (!p.down && Math.hypot(p.x - s.x, p.y - s.y) < p.r + 9) { hurtPlayer(p, 14, s.x - s.vx, s.y - s.vy); s.done = true; }
      }
      if (isWall(Math.floor(s.x / CELL), Math.floor(s.y / CELL)) || s.life <= 0) s.done = true;
      if (s.done) for (let i = 0; i < 8; i++) emit({ kind: 'fire', x: s.x, y: s.y, z: s.z, vx: rand(-90, 90), vy: rand(-90, 90), vz: rand(-20, 60), life: 0.4, max: 0.4, size: rand(5, 9), color: '255,120,30' });
    }
  }
  shots = shots.filter(s => !s.done);
}

// ─── Pickups ────────────────────────────────────────────────────────────────
function dropPickup(kind, x, y) {
  if (x === undefined || !spotFree(x, y, 14)) {
    let found = false;
    for (let tries = 0; tries < 40 && !found; tries++) {
      x = (Math.floor(rand(1, COLS - 1)) + 0.5) * CELL;
      y = (Math.floor(rand(1, ROWS - 1)) + 0.5) * CELL;
      found = room.tiles[Math.floor(y / CELL)][Math.floor(x / CELL)] === '.' && spotFree(x, y, 14) && players.every(p => dist(p, { x, y }) > 110);
    }
    if (!found) return;
  }
  pickups.push({ kind, x, y, z: 240, vz: 0, life: 25 });
}

function updatePickups(dt) {
  for (const k of pickups) {
    k.life -= dt;
    if (k.z > 0 || k.vz > 0) {
      k.vz -= 1400 * dt;
      k.z += k.vz * dt;
      if (k.z <= 0) { k.z = 0; k.vz = k.vz < -220 ? -k.vz * 0.28 : 0; }
    }
    if (k.z > 12) continue;
    const p = players.find(o => !o.down && Math.hypot(o.x - k.x, o.y - k.y) < o.r + 16);
    if (p) { collect(p, k); k.life = 0; }
  }
  pickups = pickups.filter(k => k.life > 0);
}

function collect(p, k) {
  sfx.pickup();
  if (k.kind === 'health') {
    p.hp = Math.min(100, p.hp + 40);
    floatText(k.x, k.y, '+40 HEALTH', '#8dff7a');
    return;
  }
  const options = WEAPONS.map((w, i) => i).filter(i => i > 0 && unlocked(i));
  if (!options.length) {
    score += 250 * combo.level;
    floatText(k.x, k.y, `+${250 * combo.level}`, '#ffe08a');
    return;
  }
  // Usually top up whatever is running lowest.
  const lowest = options.reduce((a, b) => (p.ammo[a] / WEAPONS[a].refill <= p.ammo[b] / WEAPONS[b].refill ? a : b));
  const i = Math.random() < 0.65 ? lowest : pick(options);
  p.ammo[i] += WEAPONS[i].refill;
  floatText(k.x, k.y, `${WEAPONS[i].name} +${WEAPONS[i].refill}`, '#fff');
}

// ─── Particles and decals ───────────────────────────────────────────────────
function emit(o) { if (particles.length < 1100) particles.push(o); }

function floatText(x, y, text, color) { texts.push({ x, y, text, color, t: 0, life: 1.2 }); }

function bleed(x, y, dx, dy, n) {
  for (let i = 0; i < n; i++) {
    emit({ kind: 'blood', x, y, z: rand(30, 58), vx: dx * rand(40, 170) + rand(-50, 50), vy: dy * rand(40, 170) + rand(-50, 50), vz: rand(20, 150), life: 1.4, max: 1.4, size: rand(2, 4.5), color: pick(['#a3191b', '#8c1215', '#c0262a']) });
  }
}

function sparks(x, y, dx, dy) {
  for (let i = 0; i < 4; i++) {
    emit({ kind: 'spark', x, y, z: 46, vx: -dx * rand(60, 200) + rand(-90, 90), vy: -dy * rand(60, 200) + rand(-90, 90), vz: rand(-20, 90), life: rand(0.08, 0.2), max: 0.2, size: 2, color: '#ffe9a8' });
  }
}

function gibs(z, dx, dy) {
  const L = z.look;
  for (let i = 0; i < 10; i++) {
    emit({ kind: 'gib', x: z.x, y: z.y, z: rand(20, 70), vx: dx * rand(60, 220) + rand(-130, 130), vy: dy * rand(60, 220) + rand(-130, 130), vz: rand(120, 340), life: rand(1.6, 2.4), max: 2.4, size: rand(4, 8), color: pick([L.shirt, L.head, L.skin, L.pants, '#9e1b1b']) });
  }
  bleed(z.x, z.y, dx, dy, 10);
}

function splat(x, y, size) {
  const c = decalCtx;
  c.fillStyle = 'rgba(132,16,18,0.5)';
  for (let i = 0; i < 5; i++) {
    const a = rand(0, TAU), r = rand(0, size * 0.6);
    c.beginPath();
    c.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, size * rand(0.35, 0.7), size * rand(0.25, 0.5), rand(0, 3), 0, TAU);
    c.fill();
  }
  c.fillStyle = 'rgba(120,12,14,0.6)';
  for (let i = 0; i < 6; i++) {
    const a = rand(0, TAU), r = size * rand(0.8, 1.6);
    c.beginPath();
    c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, rand(1, 2.6), 0, TAU);
    c.fill();
  }
}

function scorch(x, y, r) {
  const g = decalCtx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(30,24,20,0.55)');
  g.addColorStop(0.6, 'rgba(40,32,26,0.25)');
  g.addColorStop(1, 'rgba(40,32,26,0)');
  decalCtx.fillStyle = g;
  decalCtx.beginPath();
  decalCtx.ellipse(x, y, r, r * 0.75, 0, 0, TAU);
  decalCtx.fill();
}

function updateParticles(dt) {
  for (const q of particles) {
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.kind === 'smoke' || q.kind === 'fire') {
      q.z += q.vz * dt;
      q.size += dt * (q.grow || -8);
      q.vx *= Math.exp(-dt * 2); q.vy *= Math.exp(-dt * 2);
      continue;
    }
    if (q.kind === 'spark') { q.z += q.vz * dt; q.vz -= 300 * dt; continue; }
    q.vz -= 900 * dt;
    q.z += q.vz * dt;
    if (q.z > 0) continue;
    q.z = 0;
    if (q.kind === 'blood') {
      decalCtx.fillStyle = 'rgba(130,14,16,0.55)';
      decalCtx.beginPath();
      decalCtx.arc(q.x, q.y, q.size * 0.8, 0, TAU);
      decalCtx.fill();
      q.life = 0;
    } else {
      q.vz = q.vz < -80 ? -q.vz * 0.3 : 0;
      q.vx *= 0.5; q.vy *= 0.5;
    }
  }
  particles = particles.filter(q => q.life > 0);
}

function updateEffects(dt) {
  for (const t of tracers) t.t += dt;
  tracers = tracers.filter(t => t.t < t.life);
  for (const b of blasts) b.t += dt;
  blasts = blasts.filter(b => b.t < 0.55);
  for (const t of texts) t.t += dt;
  texts = texts.filter(t => t.t < t.life);
  for (const c of corpses) c.t += dt;
  corpses = corpses.filter(c => c.t < 6);
  if (banner && (banner.t += dt) > banner.life) banner = null;
  if (toast && (toast.t += dt) > toast.life) toast = null;
  shake = Math.max(0, shake - dt * 40);
  flashLight = Math.max(0, flashLight - dt * 2.5);
}

// ─── One simulation step ────────────────────────────────────────────────────
function update(dt) {
  clock += dt;
  if (!game.demo) runTime += dt;
  updateLevel(dt);
  navTimer -= dt;
  if (navDirty || navTimer <= 0) refreshNav();
  for (const p of players) updatePlayer(p, game.demo || game.autopilot ? aiInput(p, dt) : gatherInput(p), dt);
  updateRevives(dt);
  for (const z of zombies) updateZombie(z, dt);
  separate();
  updateShots(dt);
  updateExplosives(dt);
  updatePickups(dt);
  updateCombo(dt);
  zombies = zombies.filter(z => !z.dead);
  updateParticles(dt);
  updateEffects(dt);
  if (game.demo && level > 4) startDemo();
  if (!game.demo && game.state === 'playing' && players.every(p => p.down)) { game.state = 'dying'; game.dying = 2.2; }
}
