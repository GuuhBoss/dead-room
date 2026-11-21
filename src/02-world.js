// ─── Canvas ─────────────────────────────────────────────────────────────────
// Headless servers load this file with stub elements, so nothing here may
// depend on a real DOM beyond getElementById/createElement/getContext.
const canvas = $('game');
let ctx = canvas.getContext('2d'); // reassigned briefly while sprites are rendered
const screenCtx = ctx;
let pixel = 1, mapOrder = 0;
function trackMapwho(e) {
  if (!room || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
  const cell = Math.floor(e.y) * room.cols + Math.floor(e.x);
  if (e._mapCell !== cell) { e._mapCell = cell; e._mapOrder = ++mapOrder; }
}

// ─── Map cells ──────────────────────────────────────────────────────────────
// Collision flags use the original bit values (CMap_Cell.mCollide_*).
const C_SOLID = 1, C_CREATURE = 32, C_PLAYER = 64, C_OBJECT = 128;
const C_NONMOVABLE = C_SOLID | C_CREATURE | C_OBJECT | C_PLAYER;
const C_NOSPAWN = C_CREATURE | C_OBJECT;
let cellCreature = new Int16Array(1), cellPlayer = new Uint8Array(1), cellObject = [];

function loadRoom(index) {
  const def = ROOMS[index], cols = def.cols, rows = def.rows;
  mapOrder = 0;
  const solid = new Uint8Array(cols * rows);
  def.map.forEach((row, r) => { for (let c = 0; c < cols; c++) if (row[c] === '#') solid[r * cols + c] = 1; });
  room = { index, def, cols, rows, solid, nav: new Array(cols * rows), navSeen: new Int32Array(cols * rows).fill(-1), navStamp: new Float64Array(cols * rows).fill(-1), navigation: null };
  cellCreature = new Int16Array(cols * rows);
  cellPlayer = new Uint8Array(cols * rows);
  cellObject = new Array(cols * rows).fill(null);
  renderFloor();
}

const inMap = (c, r) => c >= 0 && r >= 0 && c < room.cols && r < room.rows;
const cellIndex = (c, r) => r * room.cols + c;
const isSolid = (c, r) => !inMap(c, r) || room.solid[r * room.cols + c] === 1;

function flagsAt(c, r) {
  if (!inMap(c, r)) return C_SOLID;
  const i = r * room.cols + c;
  return (room.solid[i] ? C_SOLID : 0) | (cellCreature[i] > 0 ? C_CREATURE : 0) | (cellPlayer[i] ? C_PLAYER : 0) | (cellObject[i] ? C_OBJECT : 0);
}

// CMap_Cell.NavReal_d: a diagonal step also needs both side cells.
function stepFlags(c, r, d) {
  const [dx, dy] = DIRS[d & 7];
  let f = flagsAt(c + dx, r + dy);
  if (dx && dy) f |= flagsAt(c + dx, r) | flagsAt(c, r + dy);
  return f;
}

function setObjectCell(c, r, obj) { if (inMap(c, r)) { cellObject[cellIndex(c, r)] = obj; } }
function clearObjectCell(c, r, obj) {
  if (inMap(c, r) && cellObject[cellIndex(c, r)] === obj) { cellObject[cellIndex(c, r)] = null; }
}

// Creatures reserve the cell they are walking into (SetCollideDirection).
function reserveCell(e, c, r) {
  releaseCell(e);
  if (!inMap(c, r)) return;
  cellCreature[cellIndex(c, r)]++;
  e.cell = cellIndex(c, r);
}
function releaseCell(e) {
  if (e.cell >= 0 && e.cell < cellCreature.length && cellCreature[e.cell] > 0) cellCreature[e.cell]--;
  e.cell = -1;
}

function markPlayers() {
  cellPlayer.fill(0);
  for (const p of players) {
    if (p.down) continue;
    const c = Math.floor(p.x), r = Math.floor(p.y);
    if (inMap(c, r)) cellPlayer[cellIndex(c, r)] = 1;
  }
}

// ─── Navigation ─────────────────────────────────────────────────────────────
// CMap_Cell.Nav_Update expands five distance rings per call. A partially
// processed ring resumes next tick if its five-cell work batches exceed 3 ms.
// Distances retain their old values while a new wave is in progress.
function refreshNav() {
  const started = Date.now(), size = room.cols * room.rows;
  let state = room.navigation;
  if (!state || state.phase === 'finished') {
    state = room.navigation = { phase: 'restart', session: (state?.session || 0) + 1, distance: 0, next: [], current: [], stamp: ticks * 1000 / fps() };
  }
  const visit = i => {
    if (i < 0 || i >= size || room.solid[i] || cellObject[i] || room.navSeen[i] === state.session) return;
    room.navSeen[i] = state.session;
    room.navStamp[i] = state.stamp;
    room.nav[i] = state.distance;
    state.next.push(i);
  };
  const spread = i => {
    const c = i % room.cols;
    if (c + 1 < room.cols) visit(i + 1);
    visit(i + room.cols);
    if (c > 0) visit(i - 1);
    visit(i - room.cols);
  };
  const beginRing = () => { state.current = state.next; state.next = []; };
  const finish = () => { state.phase = state.next.length ? 'resume' : 'finished'; };
  if (state.phase === 'restart') {
    // AS2 for..in visits players newest first, including a downed partner.
    for (let k = players.length - 1; k >= 0; k--) {
      const p = players[k], c = Math.floor(p.x), r = Math.floor(p.y);
      if (inMap(c, r)) visit(cellIndex(c, r));
    }
    for (let ring = 0; ring < 5 && state.next.length; ring++) {
      beginRing();
      for (let k = state.current.length - 1; k >= 0; k--) spread(state.current[k]);
      state.current = [];
      state.distance++;
    }
    finish();
  } else if (state.phase === 'resume') {
    for (let ring = 0; ring < 5 && state.next.length; ring++) {
      beginRing();
      while (state.current.length) {
        for (let batch = 0; batch < 5 && state.current.length; batch++) spread(state.current.pop());
        if (Date.now() - started > 3) { state.phase = 'continue'; return; }
      }
      state.distance++;
    }
    finish();
  } else if (state.phase === 'continue') {
    while (state.current.length) {
      for (let batch = 0; batch < 5 && state.current.length; batch++) spread(state.current.pop());
      if (Date.now() - started > 3) return;
    }
    state.distance++;
    finish();
  }
}

const navAt = (c, r) => (inMap(c, r) ? room.nav[cellIndex(c, r)] : undefined);

let navScans = 0;
function navDirection(c, r, cur, want, force) {
  const index = inMap(c, r) ? cellIndex(c, r) : -1;
  // The original accepts a distance from a wave less than two seconds old.
  if (index >= 0 && ticks * 1000 / fps() - room.navStamp[index] < 2000) {
    const here = navAt(c, r);
    const closer = d => navAt(c + DIRS[d][0], r + DIRS[d][1]) < here;
    if (closer(want) && !(stepFlags(c, r, want) & C_NONMOVABLE)) return want;
    if (closer(cur) && !(stepFlags(c, r, cur) & C_NONMOVABLE)) return cur;
    if (!force && ++navScans > 5) return -1;
    // sortOn(NUMERIC | DESCENDING | RETURNINDEXEDARRAY), then read backwards.
    const order = Array.from({ length: 8 }, (_, d) => d).sort((a, b) => navAt(c + DIRS[b][0], r + DIRS[b][1]) - navAt(c + DIRS[a][0], r + DIRS[a][1]));
    for (let k = order.length - 1; k >= 0; k--) if (!(stepFlags(c, r, order[k]) & C_NONMOVABLE)) return order[k];
    return -1;
  }
  const free = d => !(stepFlags(c, r, d & 7) & C_NONMOVABLE);
  if (free(want)) return want;
  let side;
  if (cur !== want) {
    if (free(cur)) return cur & 7;
    side = want <= cur ? (Math.abs(want - cur) <= 4 ? -1 : 1) : (Math.abs(want - cur) <= 4 ? 1 : -1);
  } else side = Math.random() < 0.5 ? -1 : 1;
  for (const k of want & 1 ? [1, 3] : [2]) {
    if (free(want + k * side)) return (want + k * side) & 7;
    if (free(want - k * side)) return (want - k * side) & 7;
  }
  return -1;
}

// ─── Collision ──────────────────────────────────────────────────────────────
// CMap_Collide.QCollide_Map: any solid cell under the square of half-size r.
function boxHitsSolid(x, y, r) {
  const c0 = Math.floor(x - r), c1 = Math.floor(x + r), r0 = Math.floor(y - r), r1 = Math.floor(y + r);
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) if (isSolid(col, row)) return true;
  return false;
}

// CMap_Collide.Collide_Map: try the move, then x alone, then y alone.
let collided = false;
function collideMap(x, y, dx, dy, r) {
  if (boxHitsSolid(x + dx, y + dy, r) === false) return [x + dx, y + dy];
  collided = true;
  if (!boxHitsSolid(x + dx, y, r)) return [x + dx, y];
  if (!boxHitsSolid(x, y + dy, r)) return [x, y + dy];
  return [x, y];
}

function collidables(self, x, y, radius) {
  const list=[];
  for(const p of players)if(p!==self && p._uid!==self?.ownerUid && !p.down && p.state!=='respawn')list.push(p);
  for(const z of zombies)if(z!==self && z._uid!==self?.ownerUid && z.solid)list.push(z);
  for(const b of barrels)if(b.solid)list.push(b);
  for(const b of blocks)if(b.solid)list.push(b);
  const bounds=x===undefined?null:mapAreaBounds(x-radius,y-radius,x+radius,y+radius);
  return list.filter(e=>!bounds || Math.floor(e.x)>=bounds[0] && Math.floor(e.y)>=bounds[1] && Math.floor(e.x)<=bounds[2] && Math.floor(e.y)<=bounds[3]).sort((a,b)=>{
    const cellA=Math.floor(a.y)*room.cols+Math.floor(a.x),cellB=Math.floor(b.y)*room.cols+Math.floor(b.x);
    return cellB-cellA || b._mapOrder-a._mapOrder;
  });
}

// CMap_Collide.Collide_Mapwho enumerates cells and their registered objects
// backwards, pushing the point successively out of each intersecting circle.
function pushOut(x,y,r,self) {
  for(const t of collidables(self,x,y,r)) {
    const dx=x-t.x,dy=y-t.y,min=r+t.r,d2=dx*dx+dy*dy;
    if(d2>=min*min)continue;
    collided=true;
    // Keep a coincident-centre calculation finite on the authoritative server.
    if(d2<1e-12)continue;
    const d=Math.sqrt(d2),f=(min-d)/d;
    x+=dx*f;y+=dy*f;
  }
  return [x,y];
}

// CMap_Collide.PlayerCollide (with the "Object collision" option) and
// CreatureCollide for knock-backs.
function moveThing(e, dx, dy, things, passes) {
  if (isSolid(Math.floor(e.x), Math.floor(e.y))) return false;
  let out = [e.x, e.y];
  for (let i = 0; i < passes; i++) {
    collided = false;
    if (things) {
      const [px, py] = pushOut(e.x + dx, e.y + dy, e.r, e);
      dx = px - e.x; dy = py - e.y;
    }
    out = collideMap(e.x, e.y, dx, dy, e.r * (players.includes(e) ? 0.85 : 1));
    if (!collided) break;
  }
  const moved = out[0] !== e.x || out[1] !== e.y;
  e.x = out[0]; e.y = out[1];
  trackMapwho(e);
  return moved;
}

// ─── Original cell-stepped line queries ─────────────────────────────────────
// CMap.GetCellBounds (default expanded area), unlike its separate _Min path.
function mapAreaBounds(x0, y0, x1, y1) {
  return [Math.max(0, Math.round(x0) - 1), Math.max(0, Math.round(y0) - 1),
    Math.min(room.cols - 1, Math.round(x1)), Math.min(room.rows - 1, Math.round(y1))];
}

// Collide_Line / Affect_Line advance their rectangle by _StepSize = 1 cell.
// The .04 supplied by bullet callers is the area radius, not the step size.
// AVM1 enumerates the collected cell array in reverse insertion order.
function* lineCellBatches(x0, y0, x1, y1, radius) {
  const length = Math.hypot(x1 - x0, y1 - y0), dx = length ? (x1 - x0) / length : 0, dy = length ? (y1 - y0) / length : 0;
  const seen = new Set();
  const scan = (x, y) => {
    const [c0, r0, c1, r1] = mapAreaBounds(x, y, x + radius * 2, y + radius * 2), cells = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = cellIndex(c, r);
      if (!seen.has(i)) { seen.add(i); cells.push(i); }
    }
    return cells.reverse();
  };
  for (let n = 0; n < length; n++) yield scan(x0 - radius + dx * n, y0 - radius + dy * n);
  // The original final rectangle is anchored at p2, without subtracting radius.
  yield scan(x1, y1);
}

function cellLineWall(c, r, x0, y0, dx, dy) {
  if (!room.solid[cellIndex(c, r)]) return null;
  let a = null, b = null;
  if (dx) {
    const x = dx > 0 ? c : c + 1, y = y0 + (x - x0) * dy / dx;
    if (y >= r && y <= r + 1) a = { x, y };
  }
  if (dy) {
    const y = dy > 0 ? r : r + 1, x = x0 + (y - y0) * dx / dy;
    if (x >= c && x <= c + 1) b = { x, y };
  }
  if (!a) return b;
  if (!b) return a;
  return (a.x - x0) ** 2 + (a.y - y0) ** 2 < (b.x - x0) ** 2 + (b.y - y0) ** 2 ? a : b;
}

function lineBuckets(things) {
  const buckets = new Map();
  for (const thing of things) {
    const c = Math.floor(thing.x), r = Math.floor(thing.y);
    if (!inMap(c, r)) continue;
    const i = cellIndex(c, r);
    if (!buckets.has(i)) buckets.set(i, []);
    buckets.get(i).push(thing);
  }
  for (const list of buckets.values()) list.sort((a, b) => (b._mapOrder ?? b._uid ?? b.id) - (a._mapOrder ?? a._uid ?? a.id));
  return buckets;
}

// CLine.QDistance_PointToLine_SQR uses the infinite line (no endpoint clamp).
// A thing is eligible only through cells reached by the scan, with its actual
// radius; the bullet area radius does not make targets bigger.
function pointOnLine(thing, x0, y0, dx, dy) {
  const d2 = dx * dx + dy * dy;
  if (!d2) return false;
  const f = ((thing.x - x0) * dx + (thing.y - y0) * dy) / d2;
  return (thing.x - x0 - dx * f) ** 2 + (thing.y - y0 - dy * f) ** 2 < thing.r ** 2;
}

function lineHit(x0, y0, x1, y1, radius, things) {
  const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy), buckets = lineBuckets(things);
  if (!length) return { t: 0, x: x1, y: y1, thing: null, wall: false };
  for (const cells of lineCellBatches(x0, y0, x1, y1, radius)) {
    let best = null, distance = Infinity;
    for (const i of cells) {
      const c = i % room.cols, r = Math.floor(i / room.cols);
      const wall = cellLineWall(c, r, x0, y0, dx, dy);
      let candidate = wall ? { ...wall, thing: null, wall: true } : null;
      if (!candidate) for (const thing of buckets.get(i) || []) {
        if (pointOnLine(thing, x0, y0, dx, dy)) { candidate = { x: thing.x, y: thing.y, thing, wall: false }; break; }
      }
      if (!candidate) continue;
      const d = (candidate.x - x0) ** 2 + (candidate.y - y0) ** 2;
      if (d < distance) { distance = d; best = candidate; }
    }
    if (best) {
      const d = Math.sqrt(distance);
      // Original hit position moves toward p1 along the target-centre vector,
      // not to the analytic ray/circle intersection on the bullet's ray.
      if (best.thing && d) {
        const f = (d - best.thing.r) / d;
        best.x = x0 + (best.x - x0) * f; best.y = y0 + (best.y - y0) * f;
      }
      return { t: Math.hypot(best.x - x0, best.y - y0), ...best };
    }
  }
  return { t: length, x: x1, y: y1, thing: null, wall: false };
}

function lineAll(x0, y0, x1, y1, radius, things) {
  const dx = x1 - x0, dy = y1 - y0, buckets = lineBuckets(things), found = [];
  for (const cells of lineCellBatches(x0, y0, x1, y1, radius)) for (const i of cells) {
    for (const thing of buckets.get(i) || []) if (pointOnLine(thing, x0, y0, dx, dy)) found.push(thing);
  }
  // Affect_Line enumerates its concatenated list backwards as well.
  return found.reverse();
}

// CMap_Affect.AffectArea uses expanded GetCellBounds, not GetCellBounds_Min.
function thingsInArea(x0, y0, x1, y1, list) {
  const [c0, r0, c1, r1] = mapAreaBounds(x0, y0, x1, y1);
  return list.filter(t => { const c = Math.floor(t.x), r = Math.floor(t.y); return c >= c0 && c <= c1 && r >= r0 && r <= r1; });
}
