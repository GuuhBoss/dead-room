// ─── Canvas and cached layers ───────────────────────────────────────────────
const canvas = $('game');
let ctx = canvas.getContext('2d'); // reassigned briefly while sprites are rendered
const screenCtx = ctx;
const stage = $('stage'), ui = $('ui');
const layer = () => { const c = document.createElement('canvas'); return [c, c.getContext('2d')]; };
const [floorLayer, floorCtx] = layer(), [decalLayer, decalCtx] = layer();
// Shadows use an opaque sand-in-shade colour with the 'darken' blend, which
// keeps the darker of the two colours: overlapping shadows merge instead of
// stacking, with no extra layer to composite.
const SHADOW_COLOR = 'rgb(174,159,137)';
let pixel = 1;

function worldTransform(c, dx = 0, dy = 0) {
  c.setTransform(pixel, 0, 0, pixel, dx * pixel, (WALL_H + dy) * pixel);
}

function resize() {
  const scale = Math.min(innerWidth / W, innerHeight / H);
  pixel = scale * Math.min(window.devicePixelRatio || 1, 2);
  stage.style.width = `${W * scale}px`;
  stage.style.height = `${H * scale}px`;
  ui.style.transform = `scale(${scale})`;
  const cw = Math.max(1, Math.round(W * pixel)), ch = Math.max(1, Math.round(H * pixel));
  if (canvas.width === cw && canvas.height === ch) return;
  let keep = null;
  if (decalLayer.width > 1) {
    keep = document.createElement('canvas');
    keep.width = decalLayer.width; keep.height = decalLayer.height;
    keep.getContext('2d').drawImage(decalLayer, 0, 0);
  }
  for (const c of [canvas, floorLayer, decalLayer]) { c.width = cw; c.height = ch; }
  sprites.clear();
  labels.clear();
  if (keep) decalCtx.drawImage(keep, 0, 0, cw, ch);
  worldTransform(decalCtx);
  if (room) renderFloor();
}

function clearDecals() {
  decalCtx.setTransform(1, 0, 0, 1, 0, 0);
  decalCtx.clearRect(0, 0, decalLayer.width, decalLayer.height);
  worldTransform(decalCtx);
}

// ─── Rooms ──────────────────────────────────────────────────────────────────
function loadRoom(index) {
  const def = ROOMS[index];
  const tiles = def.map.map(row => row.split(''));
  const starts = [], barrelSpots = [], wallRows = [], pillars = [], gates = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = tiles[r][c], x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
      if (t === '1' || t === '2') { starts[+t - 1] = { x, y }; tiles[r][c] = '.'; }
      if (t === 'b') { barrelSpots.push({ x, y }); tiles[r][c] = '.'; }
    }
  }
  // Pillars are drawn as one block with a pyramid cap, so group touching P cells.
  const seen = new Set();
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      if (tiles[r][c] === '#') row.push(c);
      if (tiles[r][c] !== 'P' || seen.has(r * COLS + c)) continue;
      const g = { c0: c, c1: c, r0: r, r1: r }, stack = [[c, r]];
      seen.add(r * COLS + c);
      while (stack.length) {
        const [pc, pr] = stack.pop();
        g.c0 = Math.min(g.c0, pc); g.c1 = Math.max(g.c1, pc);
        g.r0 = Math.min(g.r0, pr); g.r1 = Math.max(g.r1, pr);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = pc + dc, nr = pr + dr;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          if (tiles[nr][nc] !== 'P' || seen.has(nr * COLS + nc)) continue;
          seen.add(nr * COLS + nc);
          stack.push([nc, nr]);
        }
      }
      pillars.push(g);
    }
    wallRows.push(row);
  }
  // Door cells along each edge form gates where the horde comes in.
  const edge = (side, open) => {
    let start = -1;
    open.forEach((isOpen, i) => {
      if (isOpen && start < 0) start = i;
      if (start >= 0 && (!isOpen || i === open.length - 1)) {
        gates.push(makeGate(side, start, isOpen ? i : i - 1));
        start = -1;
      }
    });
  };
  edge('n', tiles[0].map(t => t === 'D'));
  edge('s', tiles[ROWS - 1].map(t => t === 'D'));
  edge('w', tiles.map(row => row[0] === 'D'));
  edge('e', tiles.map(row => row[COLS - 1] === 'D'));
  room = { index, def, tiles, starts, barrelSpots, wallRows, pillars, gates };
  room.shadow = wallShadows();
  renderFloor();
}

function makeGate(side, a, b) {
  const lo = a * CELL, hi = (b + 1) * CELL, mid = (lo + hi) / 2;
  if (side === 'n') return { side, lo, hi, cx: mid, cy: 0, dx: 0, dy: 1 };
  if (side === 's') return { side, lo, hi, cx: mid, cy: FLOOR_H, dx: 0, dy: -1 };
  if (side === 'w') return { side, lo, hi, cx: 0, cy: mid, dx: 1, dy: 0 };
  return { side, lo, hi, cx: FLOOR_W, cy: mid, dx: -1, dy: 0 };
}

const tileAt = (c, r) => room.tiles[clamp(r, 0, ROWS - 1)][clamp(c, 0, COLS - 1)];
const blockAt = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? null : blockGrid[r * COLS + c]);
function isWall(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  const t = room.tiles[r][c];
  return t === '#' || t === 'P';
}

// Walls stop everyone. Doors let zombies in but keep players inside.
// Outside the map, a cell inherits the edge tile beside it, so each door
// continues outward as a corridor that the horde walks in along.
function solidCell(c, r, player) {
  const t = tileAt(c, r);
  if (t === '#' || t === 'P') return true;
  if (t === 'D') return player;
  return !!blockAt(c, r);
}

function blockedAt(x, y, r, player) {
  const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
  const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!solidCell(col, row, player)) continue;
      const nx = clamp(x, col * CELL, col * CELL + CELL), ny = clamp(y, row * CELL, row * CELL + CELL);
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
    }
  }
  for (const b of barrels) if ((x - b.x) ** 2 + (y - b.y) ** 2 < (r + BARREL_R) ** 2) return true;
  return false;
}

// Axis-separated movement slides along walls instead of sticking to them.
function move(e, dx, dy, player) {
  if (blockedAt(e.x, e.y, e.r, player)) {
    // Already overlapping something (a barrel dropped on top, say): let it walk out.
    const nx = e.x + dx, ny = e.y + dy;
    if (!solidCell(Math.floor(nx / CELL), Math.floor(ny / CELL), player)) { e.x = nx; e.y = ny; }
    return;
  }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx && !blockedAt(e.x + sx, e.y, e.r, player)) e.x += sx;
    if (sy && !blockedAt(e.x, e.y + sy, e.r, player)) e.y += sy;
  }
}

// A straight move blocked by a corner slips sideways around it.
function nudge(e, dx, dy, player) {
  const len = Math.hypot(dx, dy);
  for (let off = 2; off <= 16; off += 2) {
    for (const s of [1, -1]) {
      const ox = dy ? s * off : 0, oy = dx ? s * off : 0;
      if (blockedAt(e.x + ox, e.y + oy, e.r, player) || blockedAt(e.x + ox + dx, e.y + oy + dy, e.r, player)) continue;
      move(e, Math.sign(ox) * Math.min(len, Math.abs(ox)), Math.sign(oy) * Math.min(len, Math.abs(oy)), player);
      return;
    }
  }
}

// ─── Navigation: one flow field per player, rebuilt a few times a second ───
const N = COLS * ROWS;
const navCost = new Float32Array(N);
const fields = [new Float32Array(N).fill(Infinity), new Float32Array(N).fill(Infinity)];
const heap = { i: new Int32Array(N * 9), v: new Float32Array(N * 9), n: 0, top: 0 };
const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

function heapPush(i, v) {
  let k = heap.n++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heap.v[p] <= v) break;
    heap.i[k] = heap.i[p]; heap.v[k] = heap.v[p]; k = p;
  }
  heap.i[k] = i; heap.v[k] = v;
}

function heapPop() {
  const top = heap.i[0];
  heap.top = heap.v[0];
  const i = heap.i[--heap.n], v = heap.v[heap.n];
  let k = 0;
  for (;;) {
    let c = 2 * k + 1;
    if (c >= heap.n) break;
    if (c + 1 < heap.n && heap.v[c + 1] < heap.v[c]) c++;
    if (heap.v[c] >= v) break;
    heap.i[k] = heap.i[c]; heap.v[k] = heap.v[c]; k = c;
  }
  heap.i[k] = i; heap.v[k] = v;
  return top;
}

// 0 = impassable. Fake walls are passable at a price: the horde walks
// around them when it can and claws through them when it can't.
function updateNavCost() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) navCost[r * COLS + c] = isWall(c, r) ? 0 : 1;
  }
  for (const b of blocks) navCost[b.r * COLS + b.c] = 14;
  for (const b of barrels) {
    const c = Math.floor(b.x / CELL), r = Math.floor(b.y / CELL);
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) navCost[r * COLS + c] = 0;
  }
}

function buildField(field, x, y) {
  field.fill(Infinity);
  const sc = clamp(Math.floor(x / CELL), 0, COLS - 1), sr = clamp(Math.floor(y / CELL), 0, ROWS - 1), s = sr * COLS + sc;
  field[s] = 0;
  heap.n = 0;
  heapPush(s, 0);
  while (heap.n) {
    const i = heapPop(), d = heap.top;
    if (d > field[i]) continue;
    const ic = i % COLS, ir = (i - ic) / COLS;
    for (const [dc, dr, len] of STEPS) {
      const nc = ic + dc, nr = ir + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = nr * COLS + nc, cost = navCost[ni];
      if (!cost) continue;
      if (dc && dr && (!navCost[ir * COLS + nc] || !navCost[nr * COLS + ic])) continue;
      const nd = d + cost * len;
      if (nd < field[ni]) { field[ni] = nd; heapPush(ni, nd); }
    }
  }
}

function refreshNav() {
  if (navDirty) updateNavCost();
  navDirty = false;
  navTimer = 0.25;
  for (const p of players) if (!p.down) buildField(fields[p.id], p.x, p.y);
}

function toward(e, x, y) {
  const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d, d, block: null };
}

// Step to the neighbouring cell that is closest to the target along the field.
function flowStep(z, field) {
  const c = clamp(Math.floor(z.x / CELL), 0, COLS - 1), r = clamp(Math.floor(z.y / CELL), 0, ROWS - 1);
  if (z.x < 0 || z.y < 0 || z.x >= FLOOR_W || z.y >= FLOOR_H) return toward(z, c * CELL + CELL / 2, r * CELL + CELL / 2);
  let best = field[r * COLS + c], bc = -1, br = -1;
  for (const [dc, dr] of STEPS) {
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    if (dc && dr && (!navCost[r * COLS + nc] || !navCost[nr * COLS + c])) continue;
    const v = field[nr * COLS + nc];
    if (v < best) { best = v; bc = nc; br = nr; }
  }
  if (bc < 0) return null;
  const step = toward(z, bc * CELL + CELL / 2, br * CELL + CELL / 2);
  step.block = blockAt(bc, br);
  return step;
}

// Walls, barrels and fake walls all block sight; the corridors outside doors don't.
function clearLine(x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 12);
  for (let i = 1; i < n; i++) {
    const c = Math.floor((x0 + ((x1 - x0) * i) / n) / CELL), r = Math.floor((y0 + ((y1 - y0) * i) / n) / CELL);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
    if (navCost[r * COLS + c] !== 1) return false;
  }
  return true;
}
