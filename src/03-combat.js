// ─── Records ────────────────────────────────────────────────────────────────
// Live entities keep their working state; toJSON sends only what a client
// needs to draw, with fractions rounded, so snapshots stay small.
let nextId = 1, tickAcc = 0, ticks = 0, alive = 0, idCount = 0;
let hitscans = [], pending = [], levels = [], lv = null, upgradeIds = {}, spawnZ = [], spawnD = [], spawnP = [];

const round3 = v => Math.round(v * 1000) / 1000;
function record(keys) {
  return {
    toJSON() {
      const o = {};
      for (const k of keys) { const v = this[k]; o[k] = typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? round3(v) : v; }
      return o;
    },
  };
}
const REC = {
  player: record(['id', 'x', 'y', 'angle', 'dir', 'hp', 'max', 'weapon', 'ammo', 'have', 'state', 'down', 'inv', 'walk', 'moving', 'hits', 'look', 'deaths', 'frags', 'af', 'alpha', 'anim']),
  zombie: record(['id', 'x', 'y', 'angle', 'devil', 'state', 'af', 'walk', 'hits']),
  corpse: record(['id', 'x', 'y', 'angle', 'devil', 't', 'life', 'look']),
  barrel: record(['id', 'x', 'y', 'r', 'placed']),
  block: record(['id', 'x', 'y', 'hp', 'max', 'alpha']),
  mine: record(['id', 'kind', 'x', 'y', 'fuse', 'owner']),
  pickup: record(['id', 'x', 'y', 'drop', 'hidden', 'life']),
  shot: record(['id', 'kind', 'x', 'y', 'z', 'angle']),
  tracer: record(['id', 'x1', 'y1', 'z1', 'x2', 'y2', 'z2', 't', 'kind', 'owner']),
  blast: record(['id', 'x', 'y', 'range', 't']),
  text: record(['id', 'kind', 'text', 'color', 'x', 'y', 't']),
};
function make(kind, fields) {
  const uid = nextId++;
  const entity = Object.assign(Object.create(REC[kind]), { id: uid, _uid: uid, _kind: kind }, fields);
  trackMapwho(entity);
  return entity;
}

// ─── Players ────────────────────────────────────────────────────────────────
function makePlayer(id, x, y, angle) {
  const p = make('player', {
    id, x, y, r: RULES.player.radius, mass: RULES.player.mass, angle, dir: dirOf(angle), hp: RULES.player.life, max: RULES.player.life,
    weapon: 0, ammo: WEAPONS.map(w => (w.ammo === Infinity ? Infinity : 0)), cap: WEAPONS.map(w => w.ammo), have: WEAPONS.map((w, i) => i === 0),
    wid: WEAPONS.map(() => 0), cool: 0, detonate: false, state: 'play', count: 0, kx: 0, ky: 0, inv: RULES.player.spawnInvincible,
    down: false, walk: 0, moving: false, hits: 0, look: CHARACTERS[game.characters[id] ?? 0].key, deaths: 0, frags: 0, killer: null, af: 0, alpha: 1, retAngle: angle,
    input: { dx: 0, dy: 0, fire: false }, queue: { prev: false, next: false, select: -1, tap: false },
    fireDown: false, firePressed: false, fireReleased: false, pressTick: 0, releaseTick: 0, cell: -1,
    anim: { weapon: 'pistol', moving: false, frame: 0 },
  });
  p.id = id; // players are addressed by slot, not by the shared id counter
  return p;
}

// Input arrives once per update() call; edges are kept until a tick uses them.
function takeInput(p, input) {
  if (!input) return;
  p.input.dx = Math.sign(input.dx) | 0; p.input.dy = Math.sign(input.dy) | 0; p.input.fire = !!input.fire;
  if (input.prev) p.queue.prev = true;
  if (input.next) p.queue.next = true;
  if (input.select >= 0) p.queue.select = input.select;
  if (input.tap) p.queue.tap = true;
}

// CInput.UpdateKey for the fire key: presses and releases latch until read.
// A tap shorter than a tick still counts as one press and one release.
function readFire(p) {
  const held = p.input.fire;
  if ((held || p.queue.tap) && !p.fireDown) { p.fireDown = true; if (!p.firePressed) { p.firePressed = true; p.pressTick = ticks; } }
  if (!held && p.fireDown) { p.fireDown = false; p.fireReleased = true; p.releaseTick = ticks; }
  p.queue.tap = false;
}

function updatePlayer(p) {
  if (p.affects) processAffects(p);
  if (p.state === 'play') playerControl(p);
  else if (p.state === 'hit') hitState(p);
  else if (p.state === 'sleep') { if (--p.count <= 0) setPlayerControl(p); }
  else if (p.state === 'dying') { p.af += 0.34; if (p.af >= 5) { p.state = 'dead'; p.count = fps() * 4; } }
  else if (p.state === 'dead') {
    if (p.count < fps()) { p.alpha = Math.max(0, p.count / fps()); playerDead(); }
    if (--p.count < 0) { p.state = 'respawn'; p.count = 25; }
  } else if (p.state === 'respawn') respawnPlayer(p);
  if (p.inv > 0) p.inv--;
}

function setPlayerControl(p) { p.state = 'play'; p.count = 0; }

function playerControl(p) {
  const P = RULES.player;
  if (p.hp > 0 && p.hp < p.max) p.hp = Math.min(p.hp + p.max / (fps() * P.regenSeconds), p.max);
  let dx = p.input.dx * P.speed, dy = p.input.dy * P.speed;
  if (dx || dy) { p.angle = normAngle(Math.atan2(dy, dx)); p.dir = dirOf(p.angle); }
  // KeepDistance: co-op partners stay on one screen.
  for (const other of game.mode === 2 ? players.filter(o => o !== p && !o.down) : []) {
    if (Math.abs(other.x - (p.x + dx)) > Math.abs(other.x - p.x) && Math.abs(other.x - (p.x + dx)) > P.leash[0]) dx = 0;
    if (Math.abs(other.y - (p.y + dy)) > Math.abs(other.y - p.y) && Math.abs(other.y - (p.y + dy)) > P.leash[1]) dy = 0;
  }
  p.moving = (dx || dy) ? moveThing(p, dx, dy, game.options.collisions, 3) : false;
  if (p.moving) p.walk += P.speed * 2;
  // Original chooses this animation before selection, but changes/advances it
  // after weapon.Update. GetWeaponPosition therefore reads the previous pose.
  const poseWeapon = WEAPONS[p.weapon].id, poseMoving = !!p.moving;
  readFire(p);
  let choice = -1;
  if (game.mode === 1 && p.queue.select >= 0) choice = p.queue.select;
  if (p.queue.next) choice = cycleWeapon(p, 1);
  if (p.queue.prev) choice = cycleWeapon(p, -1);
  p.queue.prev = p.queue.next = false; p.queue.select = -1;
  if (choice >= 0) {
    // FIRE.Renew(): a held key counts as a fresh press after a switch.
    p.fireDown = p.firePressed = p.fireReleased = false;
    selectWeapon(p, choice);
  }
  updateWeapon(p);
  const group = ORIGINAL_ATTACHMENTS.weapons[poseWeapon];
  if (!p.anim || p.anim.moving !== poseMoving || ORIGINAL_ATTACHMENTS.weapons[p.anim.weapon] !== group) {
    p.anim = { weapon: poseWeapon, moving: poseMoving, frame: 0 };
  } else {
    p.anim.weapon = poseWeapon;
    const length = ORIGINAL_ATTACHMENTS.groups[group][poseMoving ? 'walk' : 'stand'].sequence.length;
    p.anim.frame = (p.anim.frame + P.speed * 2) % length;
  }
}

const weaponEmpty = (p, i) => (WEAPONS[i].kind === 'charge' ? !mines.some(m => m.kind === 'charge' && m.owner === p.id) && p.ammo[i] <= 0 : p.ammo[i] <= 0);

function cycleWeapon(p, step) {
  for (let k = 1; k < WEAPONS.length; k++) {
    const i = (p.weapon + step * k + WEAPONS.length * 2) % WEAPONS.length;
    if (p.have[i] && !weaponEmpty(p, i)) return i;
  }
  return -1;
}

function selectWeapon(p, i) {
  if (i < 0 || i >= WEAPONS.length || !p.have[i] || weaponEmpty(p, i)) return;
  if (p.weapon !== i && game.mode === 1) message(`${WEAPONS[i].name} selected!`, 'info');
  p.weapon = i;
  if (WEAPONS[i].kind === 'charge') p.detonate = mines.some(m => m.kind === 'charge' && m.owner === p.id) && p.ammo[i] <= 0;
}

// ─── Weapons ────────────────────────────────────────────────────────────────
// CUpgrades.ApplyUpgrade_Weapon, reduced to the numbers a shot needs.
function weaponStats(i) {
  const w = WEAPONS[i], has = prop => !!upgrades[`${w.id}.${prop}`];
  return {
    damage: w.damage * (has('QuadDamage') ? 4 : has('DoubleDamage') ? 2 : 1),
    rate: has('RapidFire') ? Math.round(Math.max(w.rate / 4, 2)) : w.rate,
    auto: w.auto || has('RapidFire') || has('FastFire'),
    ammoMul: has('QuadAmmo') ? 4 : has('DoubleAmmo') ? 2 : 1,
    range: has('InfinateRange') ? 100 : has('LongShot') ? w.range * 1.5 : w.range,
    wide: has('WiderShot') ? 2 : has('WideShot') ? 1 : 0,
    bang: has('BiggerBang') ? 2 : has('BigBang') ? 1 : 0,
    cluster: has('ClusterExplode') ? 1 : 0,
  };
}

// A weapon takes new upgrades when it is next used or given (lazily, as in
// the original); an ammo upgrade refills it to the new capacity.
function applyWeaponUpgrades(p, i) {
  const id = upgradeIds[WEAPONS[i].id] || 0;
  if (p.wid[i] === id) return;
  p.wid[i] = id;
  const st = weaponStats(i);
  if (WEAPONS[i].ammo !== Infinity && st.ammoMul !== 1) p.cap[i] = p.ammo[i] = WEAPONS[i].ammo * st.ammoMul;
  if (upgrades[`${WEAPONS[i].id}.RapidFire`]) p.cool = 0;
}

// CThing_Creature_Player.AddWeapon: a fresh, full weapon.
function giveWeapon(p, i) {
  const w = WEAPONS[i];
  p.ammo[i] = p.cap[i] = w.ammo;
  p.wid[i] = 0;
  applyWeaponUpgrades(p, i);
  if (p.weapon === i) p.cool = 0;
  if (w.kind === 'charge') p.detonate = false;
}

function updateWeapon(p) {
  const i = p.weapon, w = WEAPONS[i];
  applyWeaponUpgrades(p, i);
  if (weaponEmpty(p, i)) {
    message(`${w.name} is out of ammo!`, 'critical');
    selectWeapon(p, 0);
    return;
  }
  if (--p.cool > 0) return;
  p.cool = 0;
  const st = weaponStats(i);
  let go = false, held = 0;
  if (st.auto) go = p.fireDown;
  else if (w.onRelease) { if (p.fireReleased) { go = true; held = (p.releaseTick - p.pressTick) / fps(); p.fireReleased = p.firePressed = false; } }
  else if (p.firePressed) { go = true; p.firePressed = false; }
  if (go) fireWeapon(p, i, st, held);
}

const spend = (p, i, st) => { if (p.ammo[i] !== Infinity) p.ammo[i]--; p.cool = st.rate; };

// CThing_Angle quantizes to 256 before selecting the XSI direction.
function attachmentDirection(angle, count) {
  const angle256 = Math.floor(normAngle(angle) * 256 / TAU) & 255;
  return Math.round(angle256 / (256 / count)) % count;
}

// XSI GunPosition_Right, including the original origin fallback for an empty
// model. Shared by authoritative shots and placeable objects, in cell units.
function gunPoint(p) {
  const pose = p.anim;
  const group = pose && ORIGINAL_ATTACHMENTS.groups[ORIGINAL_ATTACHMENTS.weapons[pose.weapon]];
  const table = group?.[pose.moving ? 'walk' : 'stand'];
  const frame = table && table.sequence[Math.floor(pose.frame) % table.sequence.length];
  const offset = table?.frames[attachmentDirection(p.angle, table.frames.length)][frame];
  return { x: p.x + (offset?.[0] || 0), y: p.y + (offset?.[1] || 0), z: offset?.[2] || 0 };
}

function fireWeapon(p, i, st, held) {
  const w = WEAPONS[i], g = gunPoint(p);
  if (w.kind === 'bullet') { spend(p, i, st); bullet(p, g, p.angle, st.damage, st.range, w.id); }
  else if (w.kind === 'shotgun') {
    spend(p, i, st);
    bullet(p, g, p.angle, st.damage, st.range, w.id);
    const step = 1.25 * (st.wide + 1);
    for (let k = 0, a = step; k <= (st.wide ? 1 : 0); k++, a += step) {
      bullet(p, g, p.angle - (a * Math.PI) / 180, st.damage, st.range, w.id);
      bullet(p, g, p.angle + (a * Math.PI) / 180, st.damage, st.range, w.id);
    }
  } else if (w.kind === 'rail') { spend(p, i, st); railgun(p, g, st.damage, st.range); }
  else if (w.kind === 'rocket') {
    spend(p, i, st);
    shots.push(make('shot', { kind: 'rocket', x: g.x, y: g.y, z: g.z, angle: p.angle, vx: Math.cos(p.angle) * 0.5, vy: Math.sin(p.angle) * 0.5, owner: p.id, ownerUid:p._uid, damage: st.damage, bang: st.bang, cluster: st.cluster }));
  } else if (w.kind === 'grenade') {
    const power = clamp(held, 0.25, 0.75);
    shots.push(make('shot', { kind: 'grenade', x: g.x, y: g.y, z: 40 / CELL, angle: p.angle, vx: Math.cos(p.angle) * power, vy: Math.sin(p.angle) * power, vz: 0.5 * power, r: 0.1, life: 60, owner: p.id, ownerUid:p._uid, damage: st.damage, bang: st.bang, cluster: st.cluster }));
    spend(p, i, st);
  } else if (w.kind === 'charge' && p.detonate) {
    for (const m of mines) if (m.kind === 'charge' && m.owner === p.id && m.fuse < 0) m.fuse = fps() / 10;
    p.detonate = false;
  } else {
    const c = Math.floor(g.x), r = Math.floor(g.y);
    if (!inMap(c, r) || thingsInCell(c, r) > 1) return;
    const x = c + 0.5, y = r + 0.5, onPlayer = players.some(o => !o.down && Math.floor(o.x) === c && Math.floor(o.y) === r);
    if (w.kind === 'barrel') addBarrel(x, y, st.damage, true, onPlayer,p._uid);
    else if (w.kind === 'wall') addBlock(x, y, onPlayer);
    else if (w.kind === 'mine') mines.push(make('mine', { kind: 'mine', x, y, fuse: -1, owner: p.id, ownerUid:p._uid, damage: st.damage }));
    else if (w.kind === 'charge') { mines.push(make('mine', { kind: 'charge', x, y, fuse: -1, owner: p.id, ownerUid:p._uid, damage: st.damage })); p.detonate = true; }
    spend(p, i, st);
  }
}

// CMap_Cell.mChildCount: things registered in a cell.
function thingsInCell(c, r) {
  const at = e => Math.floor(e.x) === c && Math.floor(e.y) === r;
  let n = 0;
  for (const list of [players, zombies, barrels, blocks, mines]) for (const e of list) if (at(e) && !(list === players && e.down)) n++;
  for (const k of pickups) if (!k.hidden && at(k)) n++;
  return n;
}

// Things a bullet can stop on: entered creatures, players, barrels, walls.
function shootables(except) {
  const list = [];
  for (const z of zombies) if (z.shootable) list.push(z);
  for (const p of players) if (p !== except && !p.down && p.state !== 'respawn') list.push(p);
  for (const b of barrels) list.push(b);
  for (const b of blocks) if (b.hp > 0) list.push(b);
  return list;
}

// CThing_Shot_Bullet: an instant line to the first thing or wall in range.
function bullet(p, g, angle, damage, range, kind) {
  hitscans.push(make('shot', { _kind: 'hitscan', x:g.x, y:g.y, z:g.z, angle, damage, range, kind, owner:p.id, rail:false }));
}

function railgun(p, g, damage, range) {
  hitscans.push(make('shot', { _kind: 'hitscan', x:g.x, y:g.y, z:g.z, angle:p.angle, damage, range, kind:'railgun', owner:p.id, rail:true }));
}

// New shots join CThing_Collection after its Enumerate snapshot, so their
// Process_Init runs on the following logic tick, before older creatures.
function updateHitscan(s) {
  const p = players.find(p=>p.id===s.owner), x2=s.x+Math.cos(s.angle)*s.range, y2=s.y+Math.sin(s.angle)*s.range;
  const hit=lineHit(s.x,s.y,x2,y2,.04,s.rail?[]:shootables(p));
  const targets=s.rail?lineAll(s.x,s.y,hit.x,hit.y,.04,shootables(p)):(hit.thing?[hit.thing]:[]);
  for(const target of targets)affect(target,{type:'bullet',damage:s.damage,x:s.x,y:s.y,owner:s.owner});
  tracers.push(make('tracer',{x1:s.x,y1:s.y,z1:s.z||0,x2:hit.x,y2:hit.y,z2:s.z||0,t:2,kind:s.kind,owner:s.owner}));
  s.gone=true;
}

// ─── Damage ─────────────────────────────────────────────────────────────────
function affect(t, a) {
  if (t.barrel) { (t.affects || (t.affects = [])).push(a); return; }
  if (t.block) { damageBlock(t, a); return; }
  (t.affects || (t.affects = [])).push(a);
}

// CThing_Creature.ProcessAffects
function processAffects(e) {
  const list = e.affects;
  e.affects = null;
  if (e.inv > 0 || e.state === 'dying' || e.state === 'dead' || e.state === 'respawn') return;
  const isPlayer = players.includes(e);
  const ff = game.mode === 3 || game.options.friendlyFire; // deathmatch: always on
  e.retAngle = e.angle;
  for (const a of list.slice().reverse()) {
    if (!isPlayer && a.type === 'zombie') continue;
    if (isPlayer && !ff && (a.type === 'bullet' || a.type === 'explosion')) continue;
    let dmg = a.damage;
    if (a.type === 'explosion') {
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d > a.range) continue;
      const k = d / a.range;
      dmg = k > 0.5 ? (k > 0.75 ? a.damage * 0.5 : a.damage * 0.75) : a.damage;
    }
    const before = e.hp;
    e.hp -= dmg;
    if (isPlayer && game.mode === 3 && players.length > 2 && before > 0 && e.hp <= 0) {
      const attacker = a.ownerUid !== undefined ? players.find(p=>p._uid===a.ownerUid) : players.find(p=>p.id===a.owner);
      e.killer = attacker && attacker !== e ? attacker.id : null;
    }
    e.hits++;
    const len = a.type === 'explosion' ? Math.min((dmg / 5) * 2 / CELL / e.mass, 0.3)
      : a.type === 'zombie' ? Math.max(dmg / 5 / CELL / e.mass, 0.3)
        : Math.max((dmg / 5) * 2 / CELL, 0.3) / e.mass;
    let vx = e.x - a.x, vy = e.y - a.y;
    const n = Math.hypot(vx, vy) || 1;
    vx = (vx / n) * len; vy = (vy / n) * len;
    e.kx = vx; e.ky = vy;
    e.angle = normAngle(Math.atan2(vy, vx) + Math.PI);
    enterHit(e);
  }
}

// CThing_Creature.State_BulletHit: slide back, slowing by 0.65 a tick.
function enterHit(e) {
  e.state = 'hit';
  if (players.includes(e)) e.anim = null;
  e.count = 0;
  for (let v = Math.hypot(e.kx, e.ky); v >= 0.01; v *= 0.65) e.count++;
  if (!players.includes(e)) releaseCell(e);
  if (isSolid(Math.floor(e.x), Math.floor(e.y))) e.kx = e.ky = 0;
}

function hitState(e) {
  moveThing(e, e.kx, e.ky, true, 1);
  e.kx *= 0.65; e.ky *= 0.65;
  if (e.hp <= 0 && !players.includes(e)) e.shootable = false;
  if (players.includes(e) && e.hp <= 0) { e.hp = 0; e.down = true; }
  if (--e.count < 0) {
    if (e.hp <= 0) { startDying(e); return; }
    e.angle = e.retAngle; e.dir = dirOf(e.angle);
    e.state = 'sleep'; e.count = 3; e.ret = e.base;
  }
}

function startDying(e) {
  if (players.includes(e)) {
    e.hp = 0; e.down = true; e.state = 'dying'; e.af = 0; e.kx = e.ky = 0;
    alive--; e.deaths++;
    if (game.mode === 3 && players.length > 2 && e.killer !== null) {
      const killer = players.find(p=>p.id===e.killer);
      if (killer && ++killer.frags >= game.fragLimit && game.winner === null) game.winner = killer.id;
    }
    if (game.mode === 3) dropPickup(e.x, e.y); // CWorld.LogKill: a fallen deathmatch player leaves a box
    return;
  }
  releaseCell(e);
  zombies = zombies.filter(z => z !== e);
  // State_Dying (five frames at 0.34 a tick), then State_Dead for two seconds.
  corpses.push(make('corpse', { x: e.x, y: e.y, angle: e.angle, devil: e.devil, t: 0, life: Math.ceil(5 / 0.34) + fps() * 2, look: e.look }));
  logKill(e);
}

// CWorld.PlayerDead: survival ends when nobody is left standing; deathmatch
// ends when a player has died fragLimit times, and the other player wins.
function playerDead() {
  if (game.state !== 'playing') return;
  if (game.mode === 3) {
    if (players.length === 2) {
      if (players[0].deaths === game.fragLimit) game.winner = 1;
      if (players[1].deaths === game.fragLimit) game.winner = 0;
    }
    if (game.winner !== null) game.state = 'over';
  } else if (alive <= 0) game.state = 'over';
}

// CThing_Creature_Player.State_Respawn: back next to the partner, empty-handed.
// In deathmatch it is the free spawn point farthest from the opponent.
function respawnPlayer(p) {
  if (--p.count >= 0) return;
  const partners = players.filter(o=>o!==p && !o.down && o.state!=='respawn');
  if (players.length > 2 && game.mode === 2 && !partners.length) return;
  const other = players.length > 2 ? partners.sort((a,b)=>dist(a,p)-dist(b,p))[0] : players.find(o => o !== p);
  const spot = players.length > 2 ? partySpawn(other, game.mode === 3) : other ? (game.mode === 3 ? spawnFar(other) : spawnNear(other)) : null;
  if (!spot) return;
  Object.assign(p, { x: spot.c + 0.5, y: spot.r + 0.5, angle: spot.angle, dir: dirOf(spot.angle), hp: p.max, down: false, alpha: 1, af: 0, kx: 0, ky: 0, killer: null });
  p.inv = game.mode === 3 ? RULES.deathmatch.respawnInvincible : RULES.player.respawnInvincible;
  for (let i = 1; i < WEAPONS.length; i++) p.ammo[i] = 0;
  p.weapon = 0; p.cool = 0; p.detonate = false;
  p.fireDown = p.firePressed = p.fireReleased = false;
  setPlayerControl(p);
  alive++;
}

// CWorld.Spawn_ValidPosition_Far: the farthest free spawn point that is still
// inside one screen of the other player (the original keeps that limit here too).
function spawnFar(o) {
  let best = null, bestD = 0;
  const start = Math.floor(Math.random() * spawnP.length);
  for (let n = 0; n < spawnP.length; n++) {
    const s = spawnP[(start + n) % spawnP.length];
    if (flagsAt(s.c, s.r) & (C_NOSPAWN | C_PLAYER)) continue;
    const d = (s.c + 0.5 - o.x) ** 2 + (s.r + 0.5 - o.y) ** 2;
    if (d >= bestD && Math.abs(o.x - (s.c + 0.5)) <= 19 && Math.abs(o.y - (s.r + 0.5)) <= 13) { bestD = d; best = s; }
  }
  return best;
}

// CWorld.Spawn_ValidPosition_Close: nearest free spawn point at least two
// cells from the partner and inside one screen of them.
function spawnNear(o) {
  let best = null, bestD = Infinity;
  const start = Math.floor(Math.random() * spawnP.length);
  for (let n = 0; n < spawnP.length; n++) {
    const s = spawnP[(start + n) % spawnP.length];
    if (flagsAt(s.c, s.r) & (C_NOSPAWN | C_PLAYER)) continue;
    const d = (s.c + 0.5 - o.x) ** 2 + (s.r + 0.5 - o.y) ** 2;
    if (d < bestD && d >= 4 && Math.abs(o.x - (s.c + 0.5)) <= 19 && Math.abs(o.y - (s.r + 0.5)) <= 13) { bestD = d; best = s; }
  }
  return best;
}

// Online parties need more than the original two spawn points on some rooms.
// Prefer original markers; fall back to free floor cells, never occupied solids.
function partySpawn(anchor, far) {
  const living = players.filter(p=>!p.down && p.state!=='respawn');
  const choose = candidates => {
    let best=null, score=far?-Infinity:Infinity;
    for(const s of candidates) {
      const x=s.c+.5,y=s.r+.5;
      if(isSolid(s.c,s.r) || flagsAt(s.c,s.r)&(C_NOSPAWN|C_PLAYER))continue;
      if(living.some(p=>(p.x-x)**2+(p.y-y)**2<1) || zombies.some(z=>z.solid&&(z.x-x)**2+(z.y-y)**2<1))continue;
      if(!far && anchor && living.some(p=>Math.abs(p.x-x)>RULES.player.leash[0]||Math.abs(p.y-y)>RULES.player.leash[1]))continue;
      const d=far ? (living.length?Math.min(...living.map(p=>(p.x-x)**2+(p.y-y)**2)):0) : anchor?(anchor.x-x)**2+(anchor.y-y)**2:0;
      if(best===null || (far?d>score:d<score)){best=s;score=d;}
    }
    return best;
  };
  let best=choose(spawnP);
  if(!best) {
    const cells=[];
    for(let r=0;r<room.rows;r++)for(let c=0;c<room.cols;c++)cells.push({c,r,angle:anchor?.angle||0});
    best=choose(cells);
  }
  return best;
}

// ─── Zombies and devils ─────────────────────────────────────────────────────
function makeZombie(x, y, devil) {
  const R = devil ? RULES.devil : RULES.zombie;
  return make('zombie', {
    x, y, devil: !!devil, r: R.radius, mass: R.mass, hp: R.life, max: R.life, speed: R.speed, dir: 0, angle: 0,
    state: 'init', count: 0, ret: '', base: 'enter', kx: 0, ky: 0, tx: 0, ty: 0, cell: -1, solid: false, shootable: false,
    af: 0, walk: 0, hits: 0, look: devil ? 'devil' : 'zombie', fireCount: devil ? RULES.devil.firstShot : 0, canAttack: false,
    objects: false, attackAngle: 0, targetAngle: 0, turnStep: 0, next: null, affects: null, retAngle: 0,
  });
}

function setState(z, state) {
  z.ret = z.state; z.state = state; z.count = 0;
  if (state === 'enter') enterInit(z);
  else if (state === 'cell') cellInit(z);
  else if (state === 'turn') turnInit(z);
  else if (state === 'attack') z.af = 0;
  else if (state === 'wait') z.count = fps();
}

// SetState_WithDirection(_Wait): face the new way first.
function withDirection(z, state, d, wait) {
  if (d === z.dir) { setState(z, state); return; }
  if (wait && z.ret === 'turn') { setState(z, 'sleep'); z.count = fps() / 3; return; }
  z.targetAngle = dirAngle(d);
  setState(z, 'turn');
}

function enterInit(z) {
  reserveCell(z, Math.floor(z.x), Math.floor(z.y));
  z.solid = false;
  z.base = 'enter';
  const c = Math.floor(z.x), r = Math.floor(z.y);
  for (let d = 0; d < 8; d += 2) {
    if (!isSolid(c + DIRS[d][0], r + DIRS[d][1])) { z.dir = d; z.angle = dirAngle(d); z.next = [c + DIRS[d][0], r + DIRS[d][1]]; return; }
  }
  z.next = null;
}

function cellInit(z) {
  const [dx, dy] = DIRS[z.dir];
  reserveCell(z, Math.floor(z.x + dx), Math.floor(z.y + dy));
  z.count = dx && dy ? Math.SQRT2 / z.speed : 1 / z.speed;
  z.tx = (dx + Math.floor(z.x) + 0.5 - z.x) / z.count;
  z.ty = (dy + Math.floor(z.y) + 0.5 - z.y) / z.count;
}

function turnInit(z) {
  const diff = turn(z.angle, z.targetAngle);
  const sign = Math.abs(z.targetAngle - z.angle) <= Math.PI ? 1 : -1;
  z.turnStep = z.speed * 10 * (z.targetAngle <= z.angle ? -sign : sign);
  z.count = z.turnStep ? Math.abs(diff / z.turnStep) : 0;
}

function nearestPlayer(x, y) {
  let best = null, bestD = Infinity;
  for (const p of players) {
    if (p.down) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function updateZombie(z) {
  if (z.devil) z.fireCount--;
  if (z.affects) processAffects(z);
  switch (z.state) {
    case 'init': {
      const R = z.devil ? RULES.devil : RULES.zombie;
      z.x = Math.floor(z.x) + 0.5; z.y = Math.floor(z.y) + 0.5;
      z.speed = R.speed * (z.devil ? (lv.devilSpeedUp || 1) : lv.speedUp);
      setState(z, 'enter');
      break;
    }
    case 'enter':
      if (!z.next || flagsAt(z.next[0], z.next[1]) & C_CREATURE) { z.base = 'enter'; setState(z, 'wait'); break; }
      z.shootable = true; z.solid = true; z.base = 'goto';
      setState(z, z.devil ? 'remove' : 'cell');
      break;
    case 'cell':
      if (--z.count <= 0) {
        z.x = Math.floor(z.x) + 0.5; z.y = Math.floor(z.y) + 0.5;
        setState(z, z.base);
      } else { z.x += z.tx; z.y += z.ty; z.walk += 0.34; }
      break;
    case 'goto': gotoPlayer(z); break;
    case 'turn':
      if (--z.count <= 0) { z.angle = normAngle(z.targetAngle); z.dir = dirOf(z.angle); setState(z, z.base); }
      else z.angle = normAngle(z.angle + z.turnStep);
      break;
    case 'attack': z.devil ? devilAttack(z) : zombieAttack(z); break;
    case 'remove': {
      const [dx, dy] = DIRS[z.dir], c = Math.floor(z.x) + dx, r = Math.floor(z.y) + dy;
      if (inMap(c, r) && cellObject[cellIndex(c, r)]) devilSmash(cellObject[cellIndex(c, r)]);
      else setState(z, 'goto');
      break;
    }
    case 'hit': hitState(z); break;
    case 'sleep': if (--z.count <= 0) { const back = z.ret; setState(z, back); } break;
    case 'wait': if (--z.count <= 0) setState(z, z.base); break;
  }
}

function gotoPlayer(z) {
  const target = nearestPlayer(z.x, z.y);
  if (!target) { setState(z, 'wait'); return; }
  if (z.devil && devilBrain(z, target)) return;
  const c = Math.floor(z.x), r = Math.floor(z.y);
  const want = dirOf(normAngle(Math.atan2(Math.floor(target.y) + 0.5 - z.y, Math.floor(target.x) + 0.5 - z.x)));
  const f = stepFlags(c, r, want);
  if (!z.devil && f & C_PLAYER) { withDirection(z, 'attack', want, false); return; }
  if (z.devil && !(f & C_PLAYER) && f & C_OBJECT) {
    z.attackAngle = dirAngle(want); z.objects = true;
    withDirection(z, 'attack', want, false);
    return;
  }
  const d = navDirection(c, r, z.dir, want, z.devil);
  if (d < 0) { setState(z, 'wait'); return; }
  withDirection(z, 'cell', d, true);
}

// The swing lands when its four frames finish, on whatever stands in front.
function zombieAttack(z) {
  z.af += Math.min(0.3 * (z.speed * 25 * 1.5), 1);
  if (z.af < RULES.zombie.attackFrames) return;
  const [dx, dy] = DIRS[z.dir], c = Math.floor(z.x) + dx, r = Math.floor(z.y) + dy;
  for (const p of players) if (!p.down && Math.floor(p.x) === c && Math.floor(p.y) === r) affect(p, { type: 'zombie', damage: RULES.zombie.damage, x: z.x, y: z.y });
  for (const b of blocks) if (b.hp > 0 && Math.floor(b.x) === c && Math.floor(b.y) === r) damageBlock(b, { damage: RULES.zombie.damage });
  const back = z.ret;
  setState(z, 'sleep');
  z.count = RULES.zombie.attackSleep;
  z.ret = back;
  z.af = 0;
}

// CThing_Creature_Devil.State_Attack_Decision
function devilBrain(z, target) {
  const can = z.canAttack && z.fireCount <= 0 && target.hp > 0
    && dirOf(normAngle(Math.atan2(target.y - z.y, target.x - z.x))) === z.dir
    && (target.x - z.x) ** 2 + (target.y - z.y) ** 2 <= RULES.devil.range ** 2
    && players.includes(lineHit(z.x, z.y, target.x, target.y, 0.1, players.filter(p => !p.down)).thing);
  if (can) {
    z.objects = false;
    z.attackAngle = normAngle(Math.atan2(target.y - z.y, target.x - z.x));
    setState(z, 'attack');
    return true;
  }
  z.canAttack = true;
  return false;
}

function devilAttack(z) {
  const before = z.af;
  z.af += Math.min(0.2 * (z.speed * 25 * 1.5), 1);
  if (Math.floor(before) !== Math.floor(z.af) && Math.floor(z.af) % RULES.devil.attackFrames === RULES.devil.fireFrame) {
    // Both original Devil hand models are Empty. State_Attack takes its NaN
    // fallback: radius * 1.5 ahead at height .84, not the unused partner hands.
    const a = z.attackAngle, F = RULES.fireball;
    const origin = ORIGINAL_ATTACHMENTS.devil;
    shots.push(make('shot', {
      kind: 'fireball', x: z.x + Math.cos(a) * origin.distance, y: z.y + Math.sin(a) * origin.distance, z: origin.z, angle: a,
      vx: Math.cos(a) * F.speed, vy: Math.sin(a) * F.speed, r: z.objects ? F.objectRadius : F.radius,
      owner: z.id, ownerUid:z._uid, damage: RULES.devil.damage, objects: z.objects,
    }));
    z.fireCount = 0;
  }
  if (z.af >= RULES.devil.attackFrames) { z.af = 0; const back = z.ret; setState(z, back === 'attack' ? 'goto' : back); }
}

function devilSmash(obj) {
  if (obj.barrel) affect(obj,{type:'devil',damage:100000});
  else if (obj.block) damageBlock(obj, { damage: 100000 });
}

// ─── Objects ────────────────────────────────────────────────────────────────
function addBarrel(x, y, damage, placed, onPlayer,ownerUid) {
  const b = make('barrel', { x, y, r: onPlayer ? 0 : RULES.barrel.radius, damage, placed, ownerUid, solid: !onPlayer, grow: onPlayer, barrel: true });
  barrels.push(b);
  setObjectCell(Math.floor(x), Math.floor(y), b);
  return b;
}

function addBlock(x, y, onPlayer) {
  const b = make('block', { x, y, r: onPlayer ? 0 : RULES.wall.radius, hp: RULES.wall.life, max: RULES.wall.life, alpha: 1, solid: !onPlayer, grow: onPlayer, block: true });
  blocks.push(b);
  setObjectCell(Math.floor(x), Math.floor(y), b);
  return b;
}

// Placed on the player's own cell, an object waits for them to step off and
// then grows to full size (Process_PlayerOnCell, GrowRadius).
function growObject(b, full) {
  if (!b.grow) return;
  const c = Math.floor(b.x), r = Math.floor(b.y);
  if (players.some(p => !p.down && Math.floor(p.x) === c && Math.floor(p.y) === r)) return;
  b.solid = true;
  b.r = Math.min(full, b.r + 0.1);
  if (b.r >= full) b.grow = false;
}

function explodeBarrel(b) {
  if (b.gone) return;
  b.gone = true;

  const has = prop => !!upgrades[`barrelObject.${prop}`];
  explosion(b.x, b.y, b.damage, has('BiggerBang') ? 2 : has('BigBang') ? 1 : 0, has('ClusterExplode') ? 1 : 0, 0,b.ownerUid);
}

function damageBlock(b, a) { if (b.hp > 0) (b.affects || (b.affects=[])).push(a); }

function applyBlockDamage(b, a) {
  if (b.hp <= 0) return;
  let dmg = a.damage;
  if (a.type === 'explosion') {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > a.range) return;
    const k = d / a.range;
    dmg = k > 0.5 ? (k > 0.75 ? dmg * 0.5 : dmg * 0.75) : dmg;
  }
  b.hp -= dmg;
  if (b.hp <= 0) { b.hp = 0; b.solid = false; }
}

function updateBarrel(b) {
  growObject(b, RULES.barrel.radius);
  if (!b.grow && b.affects?.length) {
    if(game.mode===3 && players.length>2 && b.ownerUid===undefined) {
      const a=b.affects[b.affects.length-1];b.ownerUid=a.ownerUid??players.find(p=>p.id===a.owner)?._uid;
    }
    b.affects=null; explodeBarrel(b);
  }
}

function updateBlock(b) {
  if (!b.grow && b.affects?.length) {
    const effects=b.affects; b.affects=null;
    for(const a of effects.slice().reverse()) applyBlockDamage(b,a);
  }
  if (b.hp > 0) growObject(b, RULES.wall.radius);
  else if ((b.alpha -= 0.2) < 0.1) b.gone = true;
}

function updateMine(m) {
  if (m.kind === 'mine' && m.fuse < 0) {
    const c = Math.floor(m.x), r = Math.floor(m.y), i = inMap(c, r) ? cellIndex(c, r) : -1;
    const busy = i >= 0 && (cellCreature[i] > 0 || (game.mode === 3 && cellPlayer[i] > 0));
    if (game.mode === 3 && !m.armed) { if (!busy) m.armed = true; }
    else if (busy) m.fuse = fps() * 2;
  } else if (m.fuse >= 0 && --m.fuse < 0) {
    m.gone = true;
    const key = m.kind === 'mine' ? 'mineObject' : 'chargeObject', has = prop => !!upgrades[`${key}.${prop}`];
    explosion(m.x, m.y, m.damage, has('BiggerBang') ? 2 : has('BigBang') ? 1 : 0, has('ClusterExplode') ? 1 : 0, 0,m.ownerUid);
  }
}

function updatePickup(k) {
  if (k.hidden > 0) { if (--k.hidden <= 0) k.hidden = 0; return; }
  if (k.drop && --k.life < 0) { k.gone = true; return; }
  // Per-cell AVM1 registration order gives the most recently moved player first.
  const p = players.filter(o => Math.floor(o.x) === Math.floor(k.x) && Math.floor(o.y) === Math.floor(k.y) && !o.down).sort((a,b)=>b._mapOrder-a._mapOrder)[0];
  if (p) {
    randomPickup(p);
    if (k.drop) k.gone = true;
    else k.hidden = fps() * (game.mode === 3 ? RULES.pickup.deathmatchRespawnSeconds : RULES.pickup.respawnSeconds);
  }
}

function updateObjects() {
  for (const b of barrels) updateBarrel(b);
  for (const b of blocks) updateBlock(b);
  for (const m of mines) updateMine(m);
  for (const k of pickups) updatePickup(k);
  blocks = blocks.filter(b => !b.gone); mines = mines.filter(m => !m.gone); pickups = pickups.filter(k => !k.gone);
}

// CThing_Creature_Player.RandomPickup: emptier weapons and missing health
// are likelier; the chosen weapon is replaced with a full one.
function randomPickup(p) {
  const options = [];
  let sum = 0;
  WEAPONS.forEach((w, i) => {
    if (i === 0 || !p.have[i]) return;
    const chance = (1 - p.ammo[i] / p.cap[i]) * 0.75 + 0.25;
    sum += chance; options.push({ i, at: sum });
  });
  if (p.hp < p.max) { sum += (1 - p.hp / p.max) * sum; options.push({ i: -1, at: sum }); }
  const roll = Math.random() * sum;
  const got = options.find(o => roll < o.at);
  if (!got) return;
  if (got.i < 0) { p.hp = p.max; message('Life up!', 'info'); }
  else { giveWeapon(p, got.i); message(`Picked up ${WEAPONS[got.i].name}`, 'info'); }
}

// ─── Explosions and projectiles ─────────────────────────────────────────────
// CThing_Effect_Explosion: radius 2 cells plus a little for heavy charges.
function explosion(x,y,damage,bang,cluster,delay,ownerUid) {
  pending.push(make('blast',{_kind:'explosion',x,y,damage,bang,cluster,delay,ownerUid,initialized:false}));
}

function updateExplosion(e) {
  // CThing_Effect_Explosion.Process_Init creates clusters/delayed outer blasts
  // when this collection member first processes, not when it is constructed.
  if(!e.initialized) {
    e.initialized=true;
    if(e.cluster)for(let a=0,q=TAU/4;a<TAU-1e-9;a+=q){
      const ang=a+Math.random()*(q/2)-q/4,sp=.05+Math.random()*.05;
      shots.push(make('shot',{kind:'cluster',x:e.x,y:e.y,z:0,angle:ang,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,vz:.5,r:.1,life:16+Math.floor(Math.random()*8),damage:e.damage,ownerUid:e.ownerUid}));
    }
    if(e.bang)for(let a=0,q=TAU/(e.bang*1.5);a<TAU-1e-9;a+=q){
      const ang=a+Math.random()*(q/4)-q/8;
      explosion(e.x+Math.cos(ang),e.y+Math.sin(ang),e.damage,0,0,2+Math.floor(Math.random()*4),e.ownerUid);
    }
  }
  if(--e.delay<0){e.gone=true;detonate(e);}
}

function detonate(e) {
  const range = 2 + Math.max(e.damage - 100, 0) * 0.005;
  blasts.push(make('blast', { x: e.x, y: e.y, range, t: 0 }));
  shake = Math.min(1, shake + 0.5);
  flashLight = Math.min(0.6, flashLight + 0.3);
  const a = { type: 'explosion', damage: e.damage, x: e.x, y: e.y, range, ownerUid: e.ownerUid };
  const inArea = list => thingsInArea(e.x - range, e.y - range, e.x + range, e.y + range, list);
  for (const p of inArea(players)) if (!p.down) affect(p, a);
  for (const z of inArea(zombies)) if (z.shootable) affect(z, a);
  for (const b of inArea(blocks)) damageBlock(b, a);
  for (const b of inArea(barrels)) affect(b,a); // barrels go off anywhere in the square
}

function bounce(s) {
  let hitFloor = false;
  s.vz -= 0.06;
  if (s.z + s.vz < 0) {
    if ((s.vz = Math.abs(s.vz)) <= 0.06) s.vz = 0;
    s.vx *= 0.5; s.vy *= 0.5; s.vz *= 0.5;
    s.z = 0; hitFloor = true;
  }
  // CMap_Collide.BounceCollide: reflect off walls and solid things.
  // Collide_Mapwho_Height: it only meets things taller than its height.
  collided = false;
  let px = s.x + s.vx, py = s.y + s.vy;
  for (const t of collidables(s,px,py,s.r)) {
    if (s.z >= (t.barrel || t.block ? 1 : t.devil ? 1.8 : 1.5)) continue;
    const dx = px - t.x, dy = py - t.y, d = Math.hypot(dx, dy), min = s.r + t.r;
    if (d >= min || d < 1e-6) continue;
    collided = true; px += (dx * (min - d)) / d; py += (dy * (min - d)) / d;
  }
  const [nx, ny] = collideMap(s.x, s.y, px - s.x, py - s.y, s.r);
  if (collided) {
    let ux = nx - (s.x + s.vx), uy = ny - (s.y + s.vy);
    const n = Math.hypot(ux, uy);
    if (n > 1e-9) { ux /= n; uy /= n; const k = 2 * (s.vx * ux + s.vy * uy); s.vx -= ux * k; s.vy -= uy * k; }
    s.vx *= 0.25; s.vy *= 0.25;
  }
  s.x += s.vx; s.y += s.vy; s.z += s.vz;
  return hitFloor || collided;
}

function updateShot(s) {
    if (s.kind === 'rocket') {
      s.vx *= 1.1; s.vy *= 1.1;
      const hit = lineHit(s.x, s.y, s.x + s.vx, s.y + s.vy, 0.04, shootables(players.find(p => p.id === s.owner)));
      if (hit.thing || hit.wall || isSolid(Math.floor(s.x + s.vx), Math.floor(s.y + s.vy))) {
        s.gone = true;
        explosion(s.x, s.y, s.damage, s.bang, s.cluster, 0,s.ownerUid);
      } else { s.x += s.vx; s.y += s.vy; }
    } else if (s.kind === 'grenade' || s.kind === 'cluster') {
      bounce(s);
      if (--s.life === 0) { s.gone = true; explosion(s.x, s.y, s.damage, s.bang || 0, s.cluster || 0, 0,s.ownerUid); }
    } else if (s.kind === 'fireball') {
      s.vx *= RULES.fireball.accel; s.vy *= RULES.fireball.accel;
      collided = false;
      const [px, py] = pushOut(s.x + s.vx, s.y + s.vy, s.r, s);
      collideMap(s.x, s.y, px - s.x, py - s.y, s.r);
      if (collided) {
        s.gone = true;
        const area = (list) => thingsInArea(s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r, list);
        if (s.objects) {
          for (const b of area(barrels)) affect(b,{type:'fireball',damage:s.damage,x:s.x,y:s.y});
          for (const b of area(blocks)) damageBlock(b, { damage: 10000 });
        } else {
          const a = { type: 'fireball', damage: s.damage, x: s.x, y: s.y };
          for (const p of area(players)) if (!p.down) affect(p, a);
          for (const z of area(zombies)) if (z.shootable) affect(z, a);
          for (const b of area(barrels)) affect(b,{type:'fireball',damage:s.damage,x:s.x,y:s.y});
          for (const b of area(blocks)) damageBlock(b, a);
        }
      } else { s.x += s.vx; s.y += s.vy; }
    }
}

function updateShots() { for (const s of shots.slice()) updateShot(s); shots=shots.filter(s=>!s.gone); }

// ─── Kills, multiplier and levels ───────────────────────────────────────────
// CUpgrades.GetTicks: how long the multiplier holds before dropping by one.
function holdTicks(index) {
  const n = 100 - (Math.min(index, 100) - 1);
  return (Math.pow(n, 2.5) / 100000.00000000003) * (fps() * 3 - 3) + 3;
}

const upgradeKey = u => (u.target === 'player' ? `player.${u.unlock}` : `${u.target}.${u.prop}`);

function setMultiplier(value, silent) {
  combo.level = clamp(value, 1, 999);
  combo.tick = combo.total = holdTicks(combo.level);
  if (value > 1) for (const u of UPGRADES) if (u.at === combo.level && !upgrades[upgradeKey(u)]) activate(u, silent);
  combo.best = Math.max(combo.best, combo.level);
}

function setMultiKill(value) {
  combo.multi = Math.max(0, value);
  combo.multiTick = combo.multi ? holdTicks(combo.multi) / 6 : 100000;
}

// CUpgrades.AddUpgrade
function activate(u, silent) {
  upgrades[upgradeKey(u)] = true;
  const id = ++idCount;
  if (u.target === 'player') {
    const i = weaponIndex(u.unlock);
    for (const p of players) { p.have[i] = true; giveWeapon(p, i); }
  } else upgradeIds[u.target] = id;
  if (!silent) message(u.name, 'upgrade');
}

// CWorld.LogKill
function logKill(e) {
  kills++;
  if (e.devil) { lv.devilAlive--; lv.devilTotal--; if (lv.devilTotal < lv.devilCount) lv.devilCount = lv.devilTotal; }
  else { lv.alive--; lv.total--; if (lv.total < lv.count) lv.count = lv.total; }
  setMultiKill(combo.multi + 1);
  setMultiplier(combo.level + 1);
  combo.pulse = 1;
  if (e.devil || combo.multi % 5 === 0) dropPickup(e.x, e.y);
  const points = (e.devil ? RULES.devil.score : RULES.zombie.score) * combo.level;
  score += points;
  texts.push(make('text', { kind: 'score', text: `+${points}`, color: '#ffffff', x: e.x, y: e.y, t: 0 }));
}

function dropPickup(x, y) {
  if (isSolid(Math.floor(x), Math.floor(y))) return;
  pickups.push(make('pickup', { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, drop: true, hidden: 0, life: fps() * RULES.pickup.dropSeconds }));
}

// CUpgrades.mLevel setter
function setLevel(n) {
  level = n;
  const row = levels[Math.min(n, 100)];
  lv = { ...row, devilCount: row.devilCount || 0, devilTotal: row.devilTotal || 0, alive: 0, devilAlive: 0, spawnIn: row.spawnRate, devilIn: row.devilRate || 0 };
  message(`-+-+-+- LEVEL ${n <= 100 ? n : n + ' (FOREVER)'} -+-+-+-`, 'level');
}

function updateLevel() {
  if (game.mode === 3) return; // CUpgrades.Process does nothing in deathmatch
  const clear = lv.count <= 0 && lv.devilCount <= 0 && !zombies.length && !corpses.some(c => c.t < c.life);
  if (clear) setLevel(level + 1);
  else {
    if (lv.alive < Math.min(lv.count, RULES.maxAlive) && lv.spawnIn-- <= 0 && spawnCreature(false)) lv.spawnIn = lv.spawnRate;
    if (lv.devilAlive < lv.devilCount && (lv.devilIn -= lv.count !== 0 ? 1 : 10) <= 0 && spawnCreature(true)) lv.devilIn = lv.devilRate;
  }
  toSpawn = Math.max(0, lv.total) + Math.max(0, lv.devilTotal);
  if (combo.multiTick-- < 0) setMultiKill(0);
  if (combo.tick-- < 0) setMultiplier(combo.level - 1);
  combo.ratio = combo.level !== 1 ? clamp(combo.tick / combo.total, 0, 1) : 0;
}

// CWorld.Spawn_Zombie / Spawn_Devil: a random entrance that is clear.
function spawnCreature(devil) {
  const list = devil ? spawnD : spawnZ;
  if (!list.length) return false;
  const mask = devil ? C_CREATURE : C_NOSPAWN;
  let k = Math.floor(Math.random() * list.length);
  for (let n = list.length; n; n--, k = (k + 1) % list.length) {
    const s = list[k];
    if ((flagsAt(s.c, s.r) | flagsAt(s.next[0], s.next[1])) & mask) continue;
    zombies.push(makeZombie(s.c + 0.5, s.r + 0.5, devil));
    if (devil) lv.devilAlive++; else lv.alive++;
    return true;
  }
  return false;
}

// ─── Messages and effects ───────────────────────────────────────────────────
// CHud.AddMessage: a stack at the bottom of the screen, three seconds each.
const MESSAGE_COLORS = { info: '#ffffff', level: '#ffffff', upgrade: '#00ff00', critical: '#ff0000' };
let silentMessages = false;
function message(text, kind) {
  if (silentMessages) return;
  texts.push(make('text', { kind: 'msg', text, color: MESSAGE_COLORS[kind], x: 0, y: 0, t: 0 }));
  const list = texts.filter(t => t.kind === 'msg');
  if (list.length > 8) texts = texts.filter(t => t !== list[0]);
}

function updateEffects() {
  for (const t of tracers) t.t--;
  tracers = tracers.filter(t => t.t > 0);
  for (const b of blasts) b.t++;
  blasts = blasts.filter(b => b.t < 14);
  const life = fps() * 3;
  for (const t of texts) t.t++;
  texts = texts.filter(t => t.t < (t.kind === 'msg' ? life : fps() * 1.2));
  for (const c of corpses) c.t++;
  corpses = corpses.filter(c => c.t < c.life + 2);
  shake = Math.max(0, shake - 0.08);
  flashLight = Math.max(0, flashLight - 0.1);
  combo.pulse = combo.pulse > 0.02 ? combo.pulse * 0.8 : 0;
}

// ─── One logic tick (CWorld.Process) ────────────────────────────────────────
function simTick() {
  ticks++;
  // CThing_Collection disposes the previous frame's delete list first.
  for (const e of [...barrels,...blocks]) if(e.gone) clearObjectCell(Math.floor(e.x),Math.floor(e.y),e);
  barrels=barrels.filter(e=>!e.gone); blocks=blocks.filter(e=>!e.gone); mines=mines.filter(e=>!e.gone); pickups=pickups.filter(e=>!e.gone);
  shots=shots.filter(e=>!e.gone); hitscans=hitscans.filter(e=>!e.gone); pending=pending.filter(e=>!e.gone);
  navScans = 0;
  markPlayers();
  // AVM1 Object properties enumerate newest insertion first. Take the list
  // once: entities created by an update enter processing on the next tick.
  const collection = [...players, ...zombies, ...barrels, ...blocks, ...mines, ...pickups, ...shots, ...hitscans, ...pending].sort((a,b)=>b._uid-a._uid);
  for (const entity of collection) {
    if (entity.gone) continue;
    switch (entity._kind) {
      case 'player': updatePlayer(entity); markPlayers(); break;
      case 'zombie': updateZombie(entity); break;
      case 'barrel': updateBarrel(entity); break;
      case 'block': updateBlock(entity); break;
      case 'mine': updateMine(entity); break;
      case 'pickup': updatePickup(entity); break;
      case 'shot': updateShot(entity); break;
      case 'hitscan': updateHitscan(entity); break;
      case 'explosion': updateExplosion(entity); break;
    }
    trackMapwho(entity);
  }
  refreshNav();
  updateLevel();
  updateEffects();
}

function update(dt) {
  clock += dt;
  if (!game.demo) runTime += dt;
  for (const p of players) takeInput(p, game.autopilot ? autoInput(p) : gatherInput(p));
  tickAcc += dt * fps();
  let n = 0;
  while (tickAcc >= 1 - 1e-9 && game.state === 'playing') {
    tickAcc -= 1;
    simTick();
    if (++n >= 8) { tickAcc = 0; break; }
  }
}

// ─── A new run (CWorld.InitThings, CUpgrades.InitLists / SetDifficulty) ─────
// Spawn points whose first open side is blocked are dropped (Spawn_ValidateAll).
function spawnPoints(list) {
  const out = [];
  for (const [c, r] of list) {
    for (let d = 0; d < 8; d += 2) {
      const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
      if (!isSolid(nc, nr)) { out.push({ c, r, next: [nc, nr] }); break; }
    }
  }
  return out;
}

function startRun() {
  loadRoom(game.roomIndex);
  nextId = 1; tickAcc = 0; ticks = 0; idCount = 0; navScans = 0;
  players = []; zombies = []; corpses = []; barrels = []; blocks = []; mines = []; pickups = []; shots = [];
  particles = []; tracers = []; blasts = []; texts = []; pending = []; hitscans = [];
  score = 0; kills = 0; level = 0; toSpawn = 0; intermission = 0; runTime = 0; shake = 0; flashLight = 0; clock = 0;
  combo = { level: 1, best: 1, ratio: 0, multi: 0, pulse: 0, tick: 0, total: 0, multiTick: 0 };
  upgrades = {}; upgradeIds = {}; banner = null; toast = null; silentMessages = false;
  levels = buildLevels(game.options.devils);
  const def = room.def;
  game.winner = null;
  // Deathmatch rooms have their entrances but nothing comes through them.
  spawnZ = game.mode === 3 ? [] : spawnPoints(def.zombieSpawns);
  spawnD = game.mode === 3 || !game.options.devils ? [] : spawnPoints(def.devilSpawns);
  spawnP = def.playerSpawns;
  for (const [c, r] of def.barrels) addBarrel(c + 0.5, r + 0.5, RULES.barrel.mapDamage, false, false);
  for (const [c, r] of def.walls) addBlock(c + 0.5, r + 0.5, false);
  for (const [c, r] of def.pickups) pickups.push(make('pickup', { x: c + 0.5, y: r + 0.5, drop: false, hidden: 0, life: 0 }));
  const partySize = game.mode === 1 ? 1 : clamp(Number.isInteger(game.playerCount) ? game.playerCount : 2, 2, 6);
  const s = def.start;
  players.push(makePlayer(0, s.c + 0.5, s.r + 0.5, s.angle));
  if (game.mode >= 2) {
    if(partySize>2)markPlayers();
    const spot = partySize>2 ? partySpawn(players[0],game.mode===3) : (game.mode === 3 ? spawnFar(players[0]) : spawnNear(players[0])) || s;
    if(!spot)throw new Error('Room has no free party spawn');
    players.push(makePlayer(1, spot.c + 0.5, spot.r + 0.5, spot.angle));
  }
  for(let id=2;id<partySize;id++) {
    markPlayers();
    const spot=partySpawn(players[0], game.mode===3);
    if(!spot)throw new Error('Room has no free party spawn');
    players.push(makePlayer(id,spot.c+.5,spot.r+.5,spot.angle));
  }
  game.playerCount=players.length;
  alive = players.length;
  markPlayers();
  setMultiplier(0, true);
  setMultiKill(0);
  setLevel(1);
  // SetDifficulty runs after the first level is announced, silently.
  silentMessages = true;
  if (game.mode === 3) {
    // Every reward at x200, then ResetWeapons: owned but empty except the pistol.
    for (let n = 1; n < RULES.deathmatch.multiplier; n++) setMultiplier(combo.level + 1, true);
    for (const p of players) { for (let i = 1; i < WEAPONS.length; i++) p.ammo[i] = 0; p.weapon = 0; }
  } else {
    const diff = DIFFICULTIES[game.options.difficulty] || DIFFICULTIES[0];
    for (let n = 1; n < diff.level; n++) setLevel(level + 1);
    for (let n = 1; n < diff.multiplier; n++) setMultiplier(combo.level + 1, true);
  }
  silentMessages = false;
}
