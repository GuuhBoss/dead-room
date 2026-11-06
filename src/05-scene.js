// ─── Floor (cached per room and screen size) ────────────────────────────────
function renderFloor() {
  const c = floorCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, floorLayer.width, floorLayer.height);
  worldTransform(c);
  const rnd = seeded(room.index * 7919 + 17);
  c.fillStyle = '#e8d8bf';
  c.fillRect(-20, -WALL_H - 20, FLOOR_W + 40, H + 40);
  for (let i = 0; i < 1600; i++) {
    c.fillStyle = rnd() < 0.55 ? 'rgba(120,90,50,0.06)' : 'rgba(255,255,255,0.1)';
    const s = 1 + rnd() * 2.5;
    c.fillRect(rnd() * FLOOR_W, rnd() * (FLOOR_H + WALL_H) - WALL_H, s, s);
  }
  // Worn, pinkish-grey trails run from every door to the middle of the room.
  c.fillStyle = '#dad0cc';
  const cx = FLOOR_W / 2, cy = FLOOR_H / 2;
  for (const g of room.gates) wornStrip(c, rnd, g.cx - g.dx * 80, g.cy - g.dy * 80, cx, cy, g.dx ? 58 : 80);
  wornBlob(c, rnd, cx, cy, 120);
  // Darken the doorways so the exits read as openings.
  for (const g of room.gates) {
    const deep = 70;
    const x0 = g.side === 'w' ? 0 : g.side === 'e' ? FLOOR_W : 0, y0 = g.side === 'n' ? 0 : g.side === 's' ? FLOOR_H : 0;
    const grad = c.createLinearGradient(x0 + g.dx * deep, y0 + g.dy * deep, x0 - g.dx * 10, y0 - g.dy * 10);
    grad.addColorStop(0, 'rgba(60,45,30,0)');
    grad.addColorStop(1, 'rgba(60,45,30,0.32)');
    c.fillStyle = grad;
    if (g.dy) c.fillRect(g.lo, g.side === 'n' ? -WALL_H : FLOOR_H - deep, g.hi - g.lo, deep + WALL_H);
    else c.fillRect(g.side === 'w' ? 0 : FLOOR_W - deep, g.lo, deep, g.hi - g.lo);
  }
  c.globalCompositeOperation = 'darken';
  c.fillStyle = SHADOW_COLOR;
  c.fill(room.shadow);
  c.globalCompositeOperation = 'source-over';
  renderWalls();
}

// Walls never change, so each run of wall cells in a row (and each pillar) is
// drawn once into its own image and placed in depth order every frame.
function renderWalls() {
  const pieces = [];
  const bake = (x0, y0, x1, y1, sortY, paint) => {
    const img = document.createElement('canvas');
    img.width = Math.ceil((x1 - x0) * pixel) + 2;
    img.height = Math.ceil((y1 - y0) * pixel) + 2;
    const g = img.getContext('2d');
    g.setTransform(pixel, 0, 0, pixel, (1 - x0) * pixel, (1 - y0) * pixel);
    ctx = g;
    paint();
    ctx = screenCtx;
    pieces.push({ img, x: x0 - 1 / pixel, y: y0 - 1 / pixel, w: img.width / pixel, h: img.height / pixel, sortY });
  };
  room.wallRows.forEach((cols, r) => {
    for (let i = 0; i < cols.length;) {
      let j = i;
      while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
      const run = cols.slice(i, j + 1);
      bake(run[0] * CELL - 2, r * CELL - WALL_H - 2, (cols[j] + 1) * CELL + 2, (r + 1) * CELL + 2, (r + 1) * CELL - 0.5, () => run.forEach(c => drawWallCell(c, r)));
      i = j + 1;
    }
  });
  for (const g of room.pillars) {
    bake(g.c0 * CELL - 2, g.r0 * CELL - WALL_H - 2, (g.c1 + 1) * CELL + 2, (g.r1 + 1) * CELL + 2, (g.r1 + 1) * CELL - 0.4, () => drawPillar(g));
  }
  room.walls = pieces;
}

function wornStrip(c, rnd, x0, y0, x1, y1, half) {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(len / 14), nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const left = [], right = [];
  let wl = half, wr = half;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    wl = clamp(wl + (rnd() - 0.5) * 24, half * 0.55, half * 1.35);
    wr = clamp(wr + (rnd() - 0.5) * 24, half * 0.55, half * 1.35);
    const jl = wl + (rnd() - 0.5) * 12, jr = wr + (rnd() - 0.5) * 12;
    left.push([x + nx * jl, y + ny * jl]);
    right.push([x - nx * jr, y - ny * jr]);
  }
  c.beginPath();
  [...left, ...right.reverse()].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fill();
}

function wornBlob(c, rnd, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU, k = r * (0.7 + rnd() * 0.45);
    const px = x + Math.cos(a) * k * 1.3, py = y + Math.sin(a) * k * 0.9;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath();
  c.fill();
}

// ─── Shadows ────────────────────────────────────────────────────────────────
// Every shadow is added to one path and filled once; hulls share a winding,
// so overlapping shadows merge instead of stacking darker.
function addHull(path, pts) {
  const n = pts.length / 2, idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const lower = [], upper = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.forEach((i, k) => (k ? path.lineTo(pts[i * 2], pts[i * 2 + 1]) : path.moveTo(pts[i * 2], pts[i * 2 + 1])));
  path.closePath();
}

function boxShadow(path, x, y, w, d, h) {
  const ox = h * SHADOW_X, oy = h * SHADOW_Y;
  addHull(path, [x, y, x + w, y, x + w, y + d, x, y + d, x + ox, y + oy, x + w + ox, y + oy, x + w + ox, y + d + oy, x + ox, y + d + oy]);
}

function wallShadows() {
  const path = new Path2D();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isWall(c, r)) boxShadow(path, c * CELL, r * CELL, CELL, CELL, WALL_H);
  return path;
}

function roundShadow(path, x, y, rx, ry, h) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU, px = x + Math.cos(a) * rx, py = y + Math.sin(a) * ry;
    pts.push(px, py, px + h * SHADOW_X, py + h * SHADOW_Y);
  }
  addHull(path, pts);
}

function drawShadows(items) {
  const path = new Path2D();
  ctx.globalCompositeOperation = 'darken';
  for (const it of items) {
    if (it.kind === 'figure') {
      if (it.sprite) { if (it.shadow) { const sh = it.sprite.shadow; ctx.drawImage(sh.img, it.x + sh.x, it.y + sh.y, sh.w, sh.h); } }
      else if (it.fig.shadow) for (const { o } of it.fig.parts) addHull(path, POOL.subarray(o + 16, o + 32));
    } else if (it.kind === 'barrel') roundShadow(path, it.b.x, it.b.y, BARREL_R, 7, BARREL_TALL + it.b.drop);
    else if (it.kind === 'block') boxShadow(path, it.b.c * CELL + 2, it.b.r * CELL + 2, CELL - 4, CELL - 4, BLOCK_TALL * it.b.rise);
    else if (it.kind === 'shot') roundShadow(path, it.s.x + it.s.z * SHADOW_X, it.s.y + it.s.z * SHADOW_Y, 5, 3, 0);
  }
  ctx.fillStyle = SHADOW_COLOR;
  ctx.fill(path);
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Walls, pillars, fake walls, barrels, mines ─────────────────────────────
function drawWallCell(c, r) {
  const x = c * CELL, y = r * CELL, top = y - WALL_H, open = !isWall(c, r + 1);
  ctx.fillStyle = '#f6f6f3';
  ctx.fillRect(x, top, CELL, CELL);
  if (open) {
    ctx.fillStyle = '#8f8f8f';
    ctx.fillRect(x, top + CELL, CELL, WALL_H);
    ctx.fillStyle = '#9c9c9c';
    ctx.fillRect(x, top + CELL, CELL, 4);
    ctx.fillStyle = '#7d7d7d';
    ctx.fillRect(x, y + CELL - 7, CELL, 7);
  }
  ctx.beginPath();
  if (!isWall(c, r - 1)) { ctx.moveTo(x, top); ctx.lineTo(x + CELL, top); }
  for (const [side, nx] of [[-1, x], [1, x + CELL]]) {
    if (!isWall(c + side, r)) { ctx.moveTo(nx, top); ctx.lineTo(nx, top + CELL); }
    if (open && !(isWall(c + side, r) && !isWall(c + side, r + 1))) { ctx.moveTo(nx, top + CELL); ctx.lineTo(nx, y + CELL); }
  }
  if (open) { ctx.moveTo(x, top + CELL); ctx.lineTo(x + CELL, top + CELL); ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
  ctx.strokeStyle = '#3e3e3e';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Pillars wear a shallow pyramid cap: four facets lit from the upper right.
function drawPillar(g) {
  const x0 = g.c0 * CELL, x1 = (g.c1 + 1) * CELL, y0 = g.r0 * CELL - WALL_H, y1 = (g.r1 + 1) * CELL - WALL_H;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const facet = (pts, color) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  facet([[x0, y0], [x1, y0], [cx, cy]], '#fafaf8');
  facet([[x1, y0], [x1, y1], [cx, cy]], '#e6e6e3');
  facet([[x1, y1], [x0, y1], [cx, cy]], '#b4b4b1');
  facet([[x0, y1], [x0, y0], [cx, cy]], '#d3d3d0');
  ctx.strokeStyle = 'rgba(60,60,60,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x1, y0); ctx.lineTo(x0, y1);
  ctx.stroke();
  const open = g.r1 + 1 >= ROWS || !isWall(g.c0, g.r1 + 1);
  if (open) {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(x0, y1, x1 - x0, WALL_H);
    ctx.fillStyle = '#787878';
    ctx.fillRect(x0, y1 + WALL_H - 7, x1 - x0, 7);
  }
  ctx.strokeStyle = '#3e3e3e';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  if (open) ctx.strokeRect(x0, y1, x1 - x0, WALL_H);
}

function drawBlock(b) {
  const x = b.c * CELL + 2, y = b.r * CELL + 2, s = CELL - 4, h = BLOCK_TALL * b.rise, w = b.flash > 0 ? 0.5 : 0;
  ctx.fillStyle = tint('#a49b88', 1, w);
  ctx.fillRect(x, y + s - h, s, h);
  ctx.fillStyle = tint('#e4dccb', 1, w);
  ctx.fillRect(x, y - h, s, s);
  ctx.strokeStyle = '#3b3a37';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y - h, s, s);
  ctx.strokeRect(x, y + s - h, s, h);
  // Cracks spread as the horde claws at it.
  const damage = 1 - b.hp / b.max;
  if (damage > 0.3) {
    ctx.strokeStyle = 'rgba(60,50,40,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y - h + 8); ctx.lineTo(x + 15, y - h + 17); ctx.lineTo(x + 12, y - h + 27);
    if (damage > 0.6) { ctx.moveTo(x + s - 5, y - h + 6); ctx.lineTo(x + s - 14, y - h + 15); ctx.lineTo(x + s - 9, y + s - h + 12); }
    ctx.stroke();
  }
}

function drawBarrel(b) {
  const x = b.x, y = b.y - b.drop, r = BARREL_R, h = BARREL_TALL, ry = 7;
  const body = ctx.createLinearGradient(x - r, 0, x + r, 0);
  body.addColorStop(0, '#5d5f61'); body.addColorStop(0.45, '#a3a5a7'); body.addColorStop(0.7, '#b9bbbd'); body.addColorStop(1, '#727476');
  ctx.beginPath();
  ctx.moveTo(x - r, y - h);
  ctx.lineTo(x - r, y);
  ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, y - h);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = '#2b2c2d';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const b1 = y - h * 0.45, b2 = y - h * 0.22;
  const band = ctx.createLinearGradient(x - r, 0, x + r, 0);
  band.addColorStop(0, '#8e2c06'); band.addColorStop(0.55, '#e0541a'); band.addColorStop(1, '#a5380a');
  ctx.beginPath();
  ctx.moveTo(x - r, b1);
  ctx.ellipse(x, b1, r, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, b2);
  ctx.ellipse(x, b2, r, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = band;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y - h, r, ry, 0, 0, TAU);
  ctx.fillStyle = '#58595b';
  ctx.fill();
  ctx.strokeStyle = '#2b2c2d';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y - h, r * 0.66, ry * 0.6, 0, 0, TAU);
  ctx.strokeStyle = '#424345';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (b.flash > 0 || b.lit) {
    ctx.globalAlpha = b.lit ? 0.6 : 0.5;
    ctx.fillStyle = b.lit ? '#ffcf6b' : '#fff';
    ctx.fillRect(x - r, y - h - ry, r * 2, h + ry * 2);
    ctx.globalAlpha = 1;
  }
}

function drawMines() {
  for (const m of mines) {
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, 12, 7, 0, 0, TAU);
    ctx.fillStyle = '#353a2a';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(m.x, m.y - 3, 9, 5, 0, 0, TAU);
    ctx.fillStyle = '#5b6347';
    ctx.fill();
    const armed = m.arm <= 0, on = armed && Math.floor(clock * 4) % 2 === 0;
    ctx.beginPath();
    ctx.arc(m.x, m.y - 4, 2.4, 0, TAU);
    ctx.fillStyle = m.lit || on ? '#ff3b2f' : armed ? '#7a1d17' : '#888';
    ctx.fill();
  }
}

function drawShot(s) {
  if (s.kind === 'fireball') {
    const y = s.y - s.z;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(s.x, y, 0, s.x, y, 16);
    g.addColorStop(0, 'rgba(255,245,200,1)'); g.addColorStop(0.4, 'rgba(255,140,40,0.9)'); g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, y, 16, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  if (s.kind === 'rocket') {
    drawFigure(pose([{ u: 0, v: 0, z: 0, w: 5, d: 16, h: 5, color: '#56662d' }, { u: 0, v: 9.5, z: 0, w: 3, d: 3, h: 3, color: '#d0d0d0' }], s.x, s.y, s.angle, 1, { lift: s.z }));
    const tx = s.x - Math.cos(s.angle) * 10, ty = s.y - Math.sin(s.angle) * 10 * FY - s.z;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,190,80,0.9)';
    ctx.beginPath();
    ctx.arc(tx, ty, 4 + Math.random() * 3, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  const blink = s.fuse < 0.4 && Math.floor(s.fuse * 20) % 2 === 0;
  drawFigure(pose([{ u: 0, v: 0, z: 0, w: 7, d: 7, h: 7, color: blink ? '#e2441a' : '#46552a' }], s.x, s.y, s.spin, 1, { lift: s.z }));
}

// ─── Effects ────────────────────────────────────────────────────────────────
function drawParticles(resting) {
  for (const q of particles) {
    if ((q.z <= 0.5 && q.kind !== 'smoke' && q.kind !== 'fire') !== resting) continue;
    const k = clamp(q.life / q.max, 0, 1), x = q.x, y = q.y - q.z;
    if (q.kind === 'smoke') {
      ctx.fillStyle = `rgba(${q.color},${0.35 * k})`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, q.size), 0, TAU); ctx.fill();
    } else if (q.kind === 'fire') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${q.color},${0.8 * k})`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, q.size * k), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (q.kind === 'spark') {
      ctx.strokeStyle = q.color;
      ctx.globalAlpha = k;
      ctx.lineWidth = q.size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - q.vx * 0.02, y - q.vy * 0.02 + q.vz * 0.02); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (q.kind === 'gib') {
      ctx.globalAlpha = Math.min(1, q.life * 2);
      const s = q.size;
      ctx.fillStyle = tint(q.color, 1);
      ctx.fillRect(x - s / 2, y - s, s, s * 0.6);
      ctx.fillStyle = tint(q.color, 0.7);
      ctx.fillRect(x - s / 2, y - s * 0.4, s, s * 0.6);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x - s / 2, y - s, s, s);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = q.kind === 'shell' ? Math.min(1, q.life * 3) : 1;
      ctx.fillStyle = q.color;
      ctx.fillRect(x - q.size / 2, y - q.size / 2, q.size, q.size * (q.kind === 'shell' ? 0.6 : 1));
      ctx.globalAlpha = 1;
    }
  }
}

function drawEffects() {
  ctx.lineCap = 'round';
  for (const t of tracers) {
    const k = 1 - t.t / t.life;
    if (t.rail) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${t.color},${0.35 * k})`;
      ctx.lineWidth = t.width * 2.6 * k + 2;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = t.rail ? `rgba(240,255,255,${k})` : `rgba(${t.color},${k})`;
    ctx.lineWidth = t.rail ? t.width * k + 1 : t.width;
    ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
  }
  ctx.lineCap = 'butt';
  for (const p of players) {
    if (p.muzzle <= 0 || p.down) continue;
    const m = muzzle(p), a = p.angle;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,220,120,0.95)';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 3 : 9 + Math.random() * 4, ang = a + (i / 10) * TAU;
      const px = m.x + Math.cos(ang) * r + Math.cos(a) * 5, py = m.y + Math.sin(ang) * r * 0.7 + Math.sin(a) * 4;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const b of blasts) {
    const k = b.t / 0.55, r = b.r * (0.45 + 0.65 * k);
    ctx.strokeStyle = `rgba(255,230,170,${0.8 * (1 - k)})`;
    ctx.lineWidth = 5 * (1 - k) + 1;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, r, r * 0.7, 0, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const fy = b.y - 22 - k * 20, fr = b.r * (0.42 + 0.35 * k);
    const g = ctx.createRadialGradient(b.x, fy, 0, b.x, fy, fr);
    g.addColorStop(0, `rgba(255,250,220,${1 - k})`);
    g.addColorStop(0.35, `rgba(255,190,80,${0.9 * (1 - k)})`);
    g.addColorStop(0.75, `rgba(230,80,20,${0.5 * (1 - k)})`);
    g.addColorStop(1, 'rgba(120,30,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, fy, fr, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  drawParticles(false);
  for (const t of texts) {
    const k = t.t / t.life;
    ctx.globalAlpha = clamp((1 - k) * 2.5, 0, 1);
    label(t.text, t.x, t.y - 90 - k * 34, 17, t.color, 'center', 4);
    ctx.globalAlpha = 1;
  }
}

const labels = new Map();
function label(text, x, y, size, fill = '#fff', align = 'center', stroke = 5) {
  const key = `${text}|${size}|${fill}|${stroke}`;
  let t = labels.get(key);
  if (t) labels.delete(key);
  else {
    const res = Math.min(pixel, 3), font = `${size}px ${FONT}`, pad = stroke + 2;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.35) + pad * 2;
    const img = document.createElement('canvas');
    img.width = Math.ceil(w * res);
    img.height = Math.ceil(h * res);
    const g = img.getContext('2d');
    g.scale(res, res);
    g.font = font;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = stroke;
    g.strokeStyle = '#111';
    g.strokeText(text, pad, h / 2);
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

// Weapon name and health above each player, like the original.
function drawPlayerTags() {
  for (const p of players) {
    if (p.down) {
      if (players.length > 1) {
        const k = p.revive / 2.2;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.arc(p.x, p.y - 40, 20, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#8dff7a';
        ctx.beginPath(); ctx.arc(p.x, p.y - 40, 20, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
        label(k > 0 ? 'REVIVING' : 'STAND CLOSE', p.x, p.y - 72, 14, '#fff', 'center', 4);
      }
      continue;
    }
    const w = WEAPONS[p.weapon], ammo = p.ammo[p.weapon], top = p.y - 98;
    const text = w.name + (ammo === Infinity ? '' : ` ${ammo}`);
    const width = label(text, p.x, top, 16);
    if (players.length > 1) {
      const tx = p.x - width / 2 - 13;
      ctx.fillStyle = p.look.tag;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx, top, 6, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#111';
    ctx.fillRect(p.x - 25, top + 10, 50, 9);
    ctx.fillStyle = p.hp > 35 ? '#27e41d' : Math.floor(clock * 6) % 2 ? '#ff3b2f' : '#b51f17';
    ctx.fillRect(p.x - 23, top + 12, 46 * Math.max(0, p.hp) / 100, 5);
  }
}

// ─── Frame ──────────────────────────────────────────────────────────────────
function draw() {
  poolAt = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!room) return;
  const sx = shake ? rand(-shake, shake) * 0.5 : 0, sy = shake ? rand(-shake, shake) * 0.5 : 0;
  ctx.drawImage(floorLayer, Math.round(sx * pixel), Math.round(sy * pixel));
  ctx.drawImage(decalLayer, Math.round(sx * pixel), Math.round(sy * pixel));
  worldTransform(ctx, sx, sy);

  const items = [];
  for (const w of room.walls) items.push({ y: w.sortY, kind: 'wall', w });
  for (const b of blocks) items.push({ y: (b.r + 1) * CELL - 0.3, kind: 'block', b });
  for (const b of barrels) items.push({ y: b.y, kind: 'barrel', b });
  for (const k of pickups) items.push({ y: k.y, kind: 'figure', fig: posePickup(k) });
  for (const c of corpses) items.push({ y: c.y - 12, kind: 'figure', ...corpseFigure(c) });
  for (const z of zombies) items.push({ y: z.y, kind: 'figure', ...zombieFigure(z) });
  for (const p of players) items.push({ y: p.down ? p.y - 12 : p.y, kind: 'figure', fig: posePlayer(p) });
  for (const s of shots) items.push({ y: s.y, kind: 'shot', s });

  drawShadows(items);
  drawMines();
  drawParticles(true);
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.kind === 'wall') ctx.drawImage(it.w.img, it.w.x, it.w.y, it.w.w, it.w.h);
    else if (it.kind === 'block') drawBlock(it.b);
    else if (it.kind === 'barrel') drawBarrel(it.b);
    else if (it.kind === 'figure' && it.sprite) {
      ctx.globalAlpha = it.alpha;
      ctx.drawImage(it.sprite.img, it.x + it.sprite.x, it.y + it.sprite.y, it.sprite.w, it.sprite.h);
      ctx.globalAlpha = 1;
    } else if (it.kind === 'figure') drawFigure(it.fig);
    else drawShot(it.s);
  }
  drawEffects();
  if (!game.demo) drawPlayerTags();

  ctx.setTransform(pixel, 0, 0, pixel, 0, 0);
  if (flashLight > 0) {
    ctx.fillStyle = `rgba(255,236,200,${flashLight * 0.3})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (!game.demo) drawHud();
}
