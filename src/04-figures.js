// ─── Box figures ────────────────────────────────────────────────────────────
// A model is a list of boxes in character space: u = right, v = forward, z = up.
// Each box is turned to the facing angle (and tipped over when falling), then
// projected; face brightness comes from the face normal, so all eight
// directions are shaded consistently without hand-drawn sprites.

// Corner index bits: 1 = +u, 2 = +v, 4 = +z. Faces list corners top-left first.
const FACES = [
  { name: 'top', axis: 2, sign: 1, idx: [4, 5, 7, 6] },
  { name: 'front', axis: 1, sign: 1, idx: [7, 6, 2, 3] },
  { name: 'back', axis: 1, sign: -1, idx: [4, 5, 1, 0] },
  { name: 'right', axis: 0, sign: 1, idx: [5, 7, 3, 1] },
  { name: 'left', axis: 0, sign: -1, idx: [6, 4, 0, 2] },
  { name: 'bottom', axis: 2, sign: -1, idx: [2, 3, 1, 0] },
];

// Reusable scratch memory for projected corners (32 numbers per box).
const POOL = new Float32Array(1 << 18);
let poolAt = 0;

function pose(parts, x, y, angle, scale, opts = {}) {
  const pitch = opts.pitch || 0, lift = opts.lift || 0;
  const fx = Math.cos(angle), fy = Math.sin(angle), rx = -fy, ry = fx;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), raise = sp * 9;
  const out = [];
  for (const p of parts) {
    if (poolAt + 32 > POOL.length) poolAt = 0;
    const o = poolAt;
    poolAt += 32;
    for (let i = 0; i < 8; i++) {
      const u = p.u + ((i & 1 ? p.w : -p.w) / 2);
      const v0 = p.v + ((i & 2 ? p.d : -p.d) / 2), z0 = p.z + ((i & 4 ? p.h : -p.h) / 2);
      const v = v0 * cp - z0 * sp, z = v0 * sp + z0 * cp + raise; // tip backwards around the feet
      const X = (u * rx + v * fx) * scale, Y = (u * ry + v * fy) * scale * FY, Z = z * scale * FZ + lift;
      POOL[o + i * 2] = x + X;
      POOL[o + i * 2 + 1] = y + Y - Z;
      POOL[o + 16 + i * 2] = x + X + Z * SHADOW_X;
      POOL[o + 17 + i * 2] = y + Y + Z * SHADOW_Y;
    }
    const cv = p.v * cp - p.z * sp, cz = p.v * sp + p.z * cp + raise;
    out.push({ p, o, depth: (p.u * ry + cv * fy) * VIEW_Y + cz * VIEW_Z });
  }
  out.sort((a, b) => a.depth - b.depth);
  const axes = [[rx, ry, 0], [cp * fx, cp * fy, sp], [-sp * fx, -sp * fy, cp]];
  return { parts: out, axes, alpha: opts.alpha ?? 1, white: opts.white || 0, look: opts.look, shadow: opts.shadow ?? true };
}

function facePath(o, idx) {
  ctx.beginPath();
  ctx.moveTo(POOL[o + idx[0] * 2], POOL[o + idx[0] * 2 + 1]);
  ctx.lineTo(POOL[o + idx[1] * 2], POOL[o + idx[1] * 2 + 1]);
  ctx.lineTo(POOL[o + idx[2] * 2], POOL[o + idx[2] * 2 + 1]);
  ctx.lineTo(POOL[o + idx[3] * 2], POOL[o + idx[3] * 2 + 1]);
  ctx.closePath();
}

function drawFigure(fig) {
  ctx.globalAlpha = fig.alpha;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  for (const { p, o } of fig.parts) {
    for (const f of FACES) {
      const a = fig.axes[f.axis], nx = a[0] * f.sign, ny = a[1] * f.sign, nz = a[2] * f.sign;
      if (ny * VIEW_Y + nz * VIEW_Z < 0.03) continue;
      const light = 0.68 + 0.4 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      facePath(o, f.idx);
      ctx.fillStyle = tint(f.name === 'top' && p.top ? p.top : p.color, light, fig.white);
      ctx.fill();
      const paint = p.paint && p.paint[f.name];
      if (paint) {
        const q = f.idx.flatMap(i => [POOL[o + i * 2], POOL[o + i * 2 + 1]]);
        paint(q, light, fig.white, fig.look);
        facePath(o, f.idx);
      }
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// Painters add flat detail onto a face, addressed in face coordinates 0..1.
function uv(q, u, v) {
  const tx = q[0] + (q[2] - q[0]) * u, ty = q[1] + (q[3] - q[1]) * u;
  const bx = q[6] + (q[4] - q[6]) * u, by = q[7] + (q[5] - q[7]) * u;
  return [tx + (bx - tx) * v, ty + (by - ty) * v];
}
function fillUV(q, points, color) {
  ctx.beginPath();
  points.forEach(([u, v], i) => { const [x, y] = uv(q, u, v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
const rectUV = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

const PAINT = {
  vest: {
    front: (q, l, w, L) => fillUV(q, [[0.16, 0], [0.36, 0], [0.5, 0.3], [0.64, 0], [0.84, 0], [0.84, 1], [0.16, 1]], tint(L.vest, l, w)),
    back: (q, l, w, L) => fillUV(q, rectUV(0.16, 0, 0.84, 1), tint(L.vest, l, w)),
  },
  suit: {
    front: (q, l, w, L) => {
      fillUV(q, [[0.3, 0], [0.7, 0], [0.5, 0.45]], tint(L.shirt, l, w));
      fillUV(q, [[0.46, 0.05], [0.54, 0.05], [0.57, 0.5], [0.5, 0.62], [0.43, 0.5]], tint(L.tie, l, w));
    },
  },
  head: {
    front: (q, l, w, L) => {
      fillUV(q, rectUV(0, 0, 1, 0.3), tint(L.hair, l, w));
      fillUV(q, rectUV(0.16, 0.44, 0.4, 0.58), tint('#141414', 1, w));
      fillUV(q, rectUV(0.6, 0.44, 0.84, 0.58), tint('#141414', 1, w));
    },
    back: (q, l, w, L) => fillUV(q, rectUV(0, 0, 1, 0.78), tint(L.hair, l, w)),
    right: (q, l, w, L) => fillUV(q, [[0, 0], [1, 0], [1, 0.3], [0.55, 0.3], [0.55, 0.74], [0, 0.74]], tint(L.hair, l, w)),
    left: (q, l, w, L) => fillUV(q, [[0, 0], [1, 0], [1, 0.74], [0.45, 0.74], [0.45, 0.3], [0, 0.3]], tint(L.hair, l, w)),
  },
  devilFace: {
    front: (q, l, w) => {
      fillUV(q, rectUV(0.14, 0.4, 0.4, 0.54), tint('#ffd23a', 1, w));
      fillUV(q, rectUV(0.6, 0.4, 0.86, 0.54), tint('#ffd23a', 1, w));
    },
  },
  cross: Object.fromEntries(['top', 'front', 'right', 'left'].map(face => [face, (q, l, w) => {
    fillUV(q, rectUV(0.38, 0.18, 0.62, 0.82), tint('#2fa84f', l, w));
    fillUV(q, rectUV(0.18, 0.38, 0.82, 0.62), tint('#2fa84f', l, w));
  }])),
  crate: Object.fromEntries(['front', 'right', 'left'].map(face => [face, (q, l, w) => {
    fillUV(q, rectUV(0, 0.4, 1, 0.6), tint('#8f2208', l, w));
  }])),
};

// ─── Models ─────────────────────────────────────────────────────────────────
function legs(L, walk) {
  const sw = Math.sin(walk), step = sw * 6;
  return [
    { u: -7, v: 2 + step, z: 3 + Math.max(0, sw) * 2, w: 10, d: 15, h: 6, color: L.shoe },
    { u: 7, v: 2 - step, z: 3 + Math.max(0, -sw) * 2, w: 10, d: 15, h: 6, color: L.shoe },
    { u: -7, v: step * 0.7, z: 15, w: 10, d: 11, h: 18, color: L.pants },
    { u: 7, v: -step * 0.7, z: 15, w: 10, d: 11, h: 18, color: L.pants },
  ];
}

function zombieParts(L, walk, attack, devil, glow) {
  const bob = Math.abs(Math.sin(walk)) * 1.5, reach = attack * 10, raise = attack * 8, sway = Math.sin(walk + 1) * 1.5;
  const hand = glow ? '#ffbe4a' : L.skin;
  const parts = legs(L, walk);
  parts.push(
    { u: 0, v: 0, z: 44 + bob, w: 30, d: 18, h: 40, color: L.shirt, paint: PAINT.vest },
    { u: -19, v: 9 + reach, z: 57 + bob + raise + sway, w: 9, d: 20, h: 9, color: L.sleeve },
    { u: 19, v: 9 + reach, z: 57 + bob + raise - sway, w: 9, d: 20, h: 9, color: L.sleeve },
    { u: -19, v: 24 + reach * 1.3, z: 57 + bob + raise + sway, w: 8, d: 10, h: 8, color: hand },
    { u: 19, v: 24 + reach * 1.3, z: 57 + bob + raise - sway, w: 8, d: 10, h: 8, color: hand },
    { u: 0, v: 2 + attack * 3, z: 76 + bob, w: 24, d: 22, h: 24, color: L.head, paint: devil ? PAINT.devilFace : null },
  );
  if (devil) {
    parts.push(
      { u: -7, v: 1, z: 92 + bob, w: 5, d: 5, h: 9, color: L.horn },
      { u: 7, v: 1, z: 92 + bob, w: 5, d: 5, h: 9, color: L.horn },
    );
  }
  return parts;
}

function playerParts(p) {
  const L = p.look, w = WEAPONS[p.weapon], sw = Math.sin(p.walk), step = sw * 6, bob = Math.abs(sw) * 1.4, kick = p.recoil * 4;
  const parts = legs(L, p.walk);
  parts.push(
    { u: 0, v: 0, z: 44 + bob, w: 30, d: 18, h: 40, color: L.suit, paint: PAINT.suit },
    { u: -19, v: -step * 0.8, z: 47 + bob, w: 8, d: 9, h: 26, color: L.suit },
    { u: -19, v: -step * 0.8, z: 31 + bob, w: 8, d: 8, h: 7, color: L.skin },
    { u: 0, v: 1, z: 76 + bob, w: 24, d: 22, h: 24, color: L.skin, top: L.hair, paint: PAINT.head },
  );
  const gun = GUNS[w.id];
  if (w.id === 'rocket') {
    parts.push({ u: 17, v: 6, z: 60 + bob, w: 9, d: 16, h: 9, color: L.suit }, { u: 17, v: 15, z: 63 + bob, w: 8, d: 7, h: 8, color: L.skin });
  } else if (gun) {
    parts.push({ u: 17, v: 10 - kick, z: 57 + bob, w: 9, d: 24, h: 9, color: L.suit }, { u: 17, v: 25 - kick, z: 57 + bob, w: 8, d: 7, h: 8, color: L.skin });
  } else {
    parts.push({ u: 19, v: step * 0.8, z: 47 + bob, w: 8, d: 9, h: 26, color: L.suit }, { u: 19, v: step * 0.8, z: 31 + bob, w: 8, d: 8, h: 7, color: L.skin });
    if (w.id === 'grenade') parts.push({ u: 19, v: step * 0.8 + 3, z: 27 + bob, w: 7, d: 7, h: 7, color: '#4a5a2c' });
  }
  if (gun) for (const g of gun) parts.push({ ...g, v: g.v - kick * (w.id === 'rocket' ? 0.5 : 1), z: g.z + bob });
  return parts;
}

function posePlayer(p) {
  const blink = p.invuln > 0.35 && Math.floor(clock * 14) % 2 === 0;
  return pose(playerParts(p), p.x, p.y, p.angle, p.look.scale, {
    pitch: p.down ? Math.PI / 2 : 0, white: p.hurt > 0 ? 0.55 : 0, alpha: p.down ? 0.85 : blink ? 0.45 : 1, look: p.look,
  });
}

// ─── Sprite cache ───────────────────────────────────────────────────────────
// Zombies come in a limited set of poses (type, eight directions, walk and
// attack frames), so each pose is drawn once to a small canvas with its
// shadow and reused. Hit flashes and falling corpses are drawn live.
const sprites = new Map();
const WALK_FRAMES = 12, ATTACK_FRAMES = 4;
const dirIndex = a => ((Math.round(a / OCT) % 8) + 8) % 8;

function renderSprite(fig, shadow) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { o } of fig.parts) {
    for (let i = 0; i < 8; i++) {
      const x = POOL[o + (shadow ? 16 : 0) + i * 2], y = POOL[o + (shadow ? 17 : 1) + i * 2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
  const res = Math.min(pixel, 2), img = document.createElement('canvas');
  img.width = Math.ceil((x1 - x0) * res);
  img.height = Math.ceil((y1 - y0) * res);
  const g = img.getContext('2d');
  g.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
  if (shadow) {
    const path = new Path2D();
    for (const { o } of fig.parts) addHull(path, POOL.subarray(o + 16, o + 32));
    g.fillStyle = SHADOW_COLOR;
    g.fill(path);
  } else {
    ctx = g;
    drawFigure(fig);
    ctx = screenCtx;
  }
  return { img, x: x0, y: y0, w: img.width / res, h: img.height / res };
}

function cachedFigure(key, x, y, makePose, alpha = 1, shadow = true) {
  let sprite = sprites.get(key);
  if (sprite) {
    sprites.delete(key);
  } else {
    const fig = makePose();
    sprite = renderSprite(fig, false);
    sprite.shadow = renderSprite(fig, true);
    if (sprites.size > 700) sprites.delete(sprites.keys().next().value);
  }
  sprites.set(key, sprite);
  return { sprite, x, y, alpha, shadow };
}

function zombieFigure(z) {
  const glow = z.devil && (z.cast > 0 || (z.los && z.fireCd < 0.45));
  const attack = z.attack > 0 ? Math.sin((1 - z.attack / ATTACK_TIME) * Math.PI) : 0;
  if (z.flash > 0) {
    return { fig: pose(zombieParts(z.look, z.walk, attack, z.devil, glow), z.x, z.y, z.dir, z.look.scale, { white: 0.65, look: z.look }) };
  }
  // Legs settle to a neutral stance while swinging, which keeps the pose count down.
  const af = Math.round(attack * ATTACK_FRAMES), wf = af ? 0 : ((Math.round((z.walk / TAU) * WALK_FRAMES) % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
  const di = dirIndex(z.dir), key = `z${z.devil ? 1 : 0}${glow ? 1 : 0}/${di}/${wf}/${af}`;
  return cachedFigure(key, z.x, z.y, () => pose(zombieParts(z.look, (wf / WALK_FRAMES) * TAU, af / ATTACK_FRAMES, z.devil, glow), 0, 0, di * OCT, z.look.scale, { look: z.look }));
}

function corpseFigure(c) {
  const fall = Math.min(1, c.t / 0.35), parts = () => zombieParts(c.look, 0, 0, c.devil, false);
  if (fall < 1) return { fig: pose(parts(), c.x, c.y, c.angle, c.look.scale, { pitch: fall * fall * (Math.PI / 2), look: c.look }) };
  const di = dirIndex(c.angle);
  return cachedFigure(`c${c.devil ? 1 : 0}/${di}`, c.x, c.y, () => pose(parts(), 0, 0, di * OCT, c.look.scale, { pitch: Math.PI / 2, look: c.look }), c.t > 5 ? Math.max(0, 6 - c.t) : 1, c.t < 5);
}

function posePickup(k) {
  const health = k.kind === 'health';
  const blink = k.life < 4 && Math.floor(k.life * 8) % 2 === 0;
  const parts = [{ u: 0, v: 0, z: 9, w: 19, d: 19, h: 18, color: health ? '#f1f1ec' : '#e2441a', paint: health ? PAINT.cross : PAINT.crate }];
  return pose(parts, k.x, k.y, 0.5, 1.15, { lift: k.z, alpha: blink ? 0.4 : 1 });
}
