// ─── Original resources ─────────────────────────────────────────────────────
// Everything drawn and played comes from boxhead2play.swf, exported once into
// assets/ (see docs/frontend-research.md, "Original resources"): room layers,
// object and effect clips, character textures, the XSI character data, the
// sounds and the embedded fonts. Publisher, developer and advertising art is
// not part of it. dist/dead-rooms.html carries the same files embedded in
// window.DEAD_ROOMS_ASSETS; otherwise they are fetched from assets/.
const ASSET_MIME = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', mp3: 'audio/mpeg', woff: 'font/woff', json: 'application/json' };
const art = { ready: false, error: null, loading: null, manifest: null, sprites: {}, tex: null, texIndex: null, xsi: null, previews: [], sounds: {}, rooms: new Map(), title: {} };

const embeddedAsset = path => (window.DEAD_ROOMS_ASSETS ? window.DEAD_ROOMS_ASSETS[path] : undefined);
function dataBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1)), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function assetBytes(path) {
  const e = embeddedAsset(path);
  if (e !== undefined) return e.startsWith('data:') ? dataBytes(e) : new TextEncoder().encode(e).buffer;
  const r = await fetch('assets/' + path);
  if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
  return r.arrayBuffer();
}
async function assetText(path) {
  const e = embeddedAsset(path);
  return e !== undefined && !e.startsWith('data:') ? e : new TextDecoder().decode(await assetBytes(path));
}
// Blob URLs keep the right type whatever the server sends.
async function assetURL(path) {
  return URL.createObjectURL(new Blob([await assetBytes(path)], { type: ASSET_MIME[path.split('.').pop()] }));
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode ' + url));
    img.src = url;
  });
}
const assetImage = async path => loadImage(await assetURL(path));

function loadArt() {
  if (art.loading) return art.loading;
  art.loading = (async () => {
    const m = art.manifest = JSON.parse(await assetText('manifest.json'));
    const fonts = Object.entries(m.fonts).map(async ([name, path]) => {
      const bold = / Bold$/.test(name) && name !== 'Arial Rounded MT Bold';
      const face = new FontFace(bold ? name.replace(/ Bold$/, '') : name, await assetBytes(path), { weight: bold ? '700' : '400' });
      document.fonts.add(await face.load());
    });
    const sprites = Object.entries(m.sprites).map(async ([key, s]) => { art.sprites[key] = { ...s, img: await assetImage(s.src) }; });
    const tex = assetImage(m.textures.src).then(img => {
      art.tex = img;
      art.texIndex = new Map(m.textures.names.map((n, i) => [n, i]));
    });
    const xsi = assetText(m.xsi).then(t => { art.xsi = JSON.parse(t); });
    const sounds = Object.entries(m.sounds).map(async ([key, path]) => { art.sounds[key] = await assetBytes(path); });
    const previews = Promise.all(m.previews.map(assetURL)).then(urls => { art.previews = urls; });
    const title = Promise.all(Object.entries(m.title).map(async ([key, path]) => { art.title[key] = await assetImage(path); }));
    await Promise.all([...fonts, ...sprites, tex, xsi, ...sounds, previews, title]);
    art.ready = true;
    labels.clear();
    sfx.decode();
  })().catch(err => { art.error = err; console.error(err); throw err; });
  return art.loading;
}

// Room layers: floor (room art, pieces moved only), cover (each piece's _Cover)
// and the decal mask (pieces only). Loaded once per room.
function roomArt(index) {
  let entry = art.rooms.get(index);
  if (!entry) {
    const r = art.manifest.rooms[index];
    entry = { ready: false, promise: null };
    entry.promise = Promise.all([assetImage(r.floor), assetImage(r.cover), assetImage(r.mask)]).then(([floor, cover, mask]) => {
      Object.assign(entry, { floor, cover, mask, ready: true });
      return entry;
    });
    art.rooms.set(index, entry);
  }
  return entry;
}

// One frame of an exported clip, placed by its registration point. The clips
// are stored at twice their size; rotation happens before the scale, as
// CDrawPrimitive_MovieClip_Directional renders them.
function drawSprite(key, frame, x, y, alpha = 1, angle = 0, sx = 1, sy = 1, g = ctx) {
  const s = art.sprites[key];
  if (!s || alpha <= 0) return;
  const f = clamp(Math.floor(frame), 0, s.frames - 1), fw = s.img.width / s.frames, fh = s.img.height;
  g.globalAlpha = alpha;
  if (angle || sx !== 1 || sy !== 1) {
    g.save();
    g.translate(x, y);
    g.scale(sx, sy);
    g.rotate(angle);
    g.drawImage(s.img, f * fw, 0, fw, fh, -s.ox, -s.oy, s.w, s.h);
    g.restore();
  } else g.drawImage(s.img, f * fw, 0, fw, fh, Math.round(x - s.ox), Math.round(y - s.oy), s.w, s.h);
  g.globalAlpha = 1;
}

// ─── XSI characters (CDrawPrimitive_XSI_DI) ─────────────────────────────────
// Every character frame is a list of models of flat, already projected
// polygons with a material each, a brightness for the shading pass, a
// profile edge and shadow polygons. A style sheet (CDrawPrimitive_XSI_Style-
// Sheet) hides models, takes some from another group (helmets, zombie and
// devil heads) and swaps materials; frames are then drawn once to a bitmap
// with their shadow and a black glow, as the original caches them
// (CDrawPrimitive_XSI_Animation.RenderToBitmap), and copied to the screen.
const HIDE_PLAYER = ['GunPosition_Right', 'Body_Front', 'Body_Back'];
const HIDE_CREATURE = ['Weapon_Right', ...HIDE_PLAYER];
const bodyTex = who => ({ Body_Back: `${who}_Body_Back`, Body_Front: `${who}_Body_Front`, Body_Side: `${who}_Body_Side`, Body_Top: `${who}_Body_Top`, Head_Back: `${who}_Head_Back`, Head_Front: `${who}_Head_Front`, Head_Side: `${who}_Head_Side` });
const STYLES = {
  bambo: { scale: 0.35, hide: HIDE_PLAYER, tex: bodyTex('Bambo'), color: { Bandana: 0xff0000, LowerArm: 0xffcc99, UpperArm: 0xffcc99, Hand: 0, Hair: 0 } },
  agent: { scale: 0.35, hide: HIDE_PLAYER, tex: bodyTex('Bond'), color: { Bandana: 0x000033, Cloth: 0x000033, LowerArm: 0x000033, UpperArm: 0x000033, Hand: 0, Hair: 0 } },
  soldier: { scale: 0.35, hide: HIDE_PLAYER, remap: 'Player_Alternate1', remapModels: ['Head', 'Foot_Right', 'Foot_Left'], tex: bodyTex('GIJOE'), color: { Hair: 0, Bandana: 14601386, Cloth: 14601386, LowerArm: 14601386, UpperArm: 14601386, Hand: 0xffcc99 } },
  swat: { scale: 0.35, hide: HIDE_PLAYER, remap: 'Player_Alternate1', remapModels: ['Head', 'Foot_Right', 'Foot_Left'], tex: bodyTex('Swat'), color: { Bandana: 0x000033, Cloth: 0x000033, LowerArm: 0x000033, UpperArm: 0x000033, Hand: 0 } },
  zombie: { scale: 0.35, hide: HIDE_CREATURE, remap: 'Zombie', remapModels: ['Head'], tex: bodyTex('Zombie'), color: { Bandana: 11584734, LowerArm: 11584734, UpperArm: 0xffffff, Hand: 11584734 } },
  devil: { scale: 0.42, hide: HIDE_CREATURE, remap: 'Devil', remapModels: ['Head'], tex: bodyTex('Devil'), color: { Bandana: 0xff0000, LowerArm: 0xff0000, UpperArm: 0xff0000, Hand: 0, Foot: 0 } },
};
const SHADER_CONTRAST = 0.5; // CDrawPrimitive_XSI_DI.mShader_Contrast
const hex = c => '#' + c.toString(16).padStart(6, '0');

// Materials share one bitmap per name in the original, and a style's texture
// is drawn over whatever that bitmap held; the head textures named for Bond,
// G.I. Joe and Swat do not exist, so they keep the default (Bambo's) face.
const styleTextures = new Map();
function styleTexture(styleKey, mat) {
  const key = styleKey + '/' + mat;
  if (styleTextures.has(key)) return styleTextures.get(key);
  const master = art.xsi.materials[mat], style = STYLES[styleKey], size = art.manifest.textures.size, cols = art.manifest.textures.cols;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  for (const name of [master, style.tex[mat]]) {
    const i = art.texIndex.get(name);
    if (i !== undefined) g.drawImage(art.tex, (i % cols) * size, Math.floor(i / cols) * size, size, size, 0, 0, size, size);
  }
  styleTextures.set(key, c);
  return c;
}

const xsiCache = new Map();
const modelOf = (frame, name) => frame && frame.find(m => m[0] === name);
// CThing_Angle.mAngle256: radians × RadsTo256, truncated, & 255 (the same
// quantisation as the shared attachmentDirection, on the normalised angle).
const angle256 = a => Math.floor(normAngle(a) * 256 / TAU) & 255;
// CThing_Angle.mLookup256[n]: the nearest of n directions, 0 = east, clockwise.
const dirOfAngle = (a, n) => Math.round(angle256(a) / (256 / n)) % n;

function xsiFrame(styleKey, itemKey, angle, frame) {
  const item = art.xsi.items[itemKey];
  if (!item) return null;
  const dir = dirOfAngle(angle, item.dirs.length), frames = item.dirs[dir];
  const seq = item.seq, n = seq ? seq.length : frames.length;
  const fi = seq ? seq[((Math.floor(frame) % n) + n) % n] : clamp(Math.floor(frame), 0, frames.length - 1);
  const res = Math.min(3, Math.max(1, pixel)), key = `${styleKey}|${itemKey}|${dir}|${fi}|${res}`;
  let s = xsiCache.get(key);
  if (s) { xsiCache.delete(key); xsiCache.set(key, s); return s; }
  s = renderXSI(styleKey, itemKey, item, dir, fi, res);
  xsiCache.set(key, s);
  if (xsiCache.size > 2400) xsiCache.delete(xsiCache.keys().next().value);
  return s;
}

function renderXSI(styleKey, itemKey, item, dir, fi, res) {
  const style = STYLES[styleKey], names = art.xsi.names, mats = art.xsi.materials, anim = itemKey.slice(itemKey.indexOf('/') + 1);
  const partner = item.partner ? art.xsi.items[`${item.partner}/${anim}`] : null;
  const remap = style.remap ? art.xsi.items[`${style.remap}/${anim}`] : null;
  const own = item.dirs[dir][fi], pf = partner && partner.dirs[dir][fi], rf = remap && remap.dirs[dir] && remap.dirs[dir][fi];
  const models = [];
  for (const m0 of own) {
    const name = names[m0[0]];
    let m = m0;
    if (m.length === 1 && pf) m = modelOf(pf, m0[0]) || m;
    if (style.hide.includes(name)) continue;
    if (rf && style.remapModels.includes(name)) m = modelOf(rf, m0[0]) || m;
    if (m.length > 1) models.push(m);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of models) for (const list of [m[3], m[5]]) for (const p of list) for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  if (!models.length) return null;
  const sc = style.scale, pad = 6, ox = x0 * sc - pad, oy = y0 * sc - pad;
  const w = Math.ceil(((x1 - x0) * sc + pad * 2) * res), h = Math.ceil(((y1 - y0) * sc + pad * 2) * res);
  const body = document.createElement('canvas'), shade = document.createElement('canvas');
  body.width = shade.width = w; body.height = shade.height = h;
  const g = body.getContext('2d', { willReadFrequently: true }), sg = shade.getContext('2d', { willReadFrequently: true });
  for (const c of [g, sg]) { c.setTransform(sc * res, 0, 0, sc * res, -ox * res, -oy * res); c.lineJoin = c.lineCap = 'round'; }
  const poly = (c, p) => { c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); };
  const edge = mats.PEdge;
  sg.fillStyle = '#000';
  // Planes stack with the first model on top (depth 10000 - n): paint in reverse.
  for (const [, mi, mx, verts, bright, shadows, pedge] of models.slice().reverse()) {
    // The profile edge goes down first; the faces then cover its inner half.
    g.lineWidth = edge[2];
    g.strokeStyle = hex(edge[0]);
    g.beginPath();
    for (const p of pedge) poly(g, p);
    g.stroke();
    // Polygons are painted in their listed order.
    for (let i = 0; i < verts.length; i++) {
      const mat = names[mi[i]], master = mats[mat];
      g.beginPath();
      poly(g, verts[i]);
      g.closePath();
      if (mx[i] && typeof master === 'string') {
        const pat = g.createPattern(styleTexture(styleKey, mat), 'repeat'), t = mx[i], k = 64 / art.manifest.textures.size;
        pat.setTransform(new DOMMatrix([t[0] * k, t[1] * k, t[2] * k, t[3] * k, t[4], t[5]]));
        g.fillStyle = pat;
        g.globalAlpha = 1;
      } else {
        const color = style.color[mat] ?? (Array.isArray(master) ? master[0] : 0);
        g.fillStyle = hex(color);
        g.globalAlpha = Array.isArray(master) ? master[1] / 100 : 1;
      }
      g.fill('evenodd');
      const b = bright[i];
      if (b) {
        g.globalAlpha = Math.abs(b) * SHADER_CONTRAST;
        g.fillStyle = b >= 0 ? '#fff' : '#000';
        g.fill('evenodd');
      }
      g.globalAlpha = 1;
    }
    // Each shadow polygon is its own fill (beginFill / endFill), so the
    // opposite faces of a box add up instead of cancelling out.
    for (const p of shadows) { sg.beginPath(); poly(sg, p); sg.closePath(); sg.fill('evenodd'); }
  }
  // The shadow clip carries DropShadowFilter(0, 0, black, 1, 4, 4, 0.25,
  // hideObject), but the reference player draws it as the plain black
  // polygons (the filter is not applied inside BitmapData.draw), so the
  // shadows here are solid too. The body goes over them, then
  // GlowFilter(black, 1, 4, 4, strength 2) on everything.
  const img = g.getImageData(0, 0, w, h), sh = sg.getImageData(0, 0, w, h).data, d = img.data, n = w * h;
  const r = Math.max(1, Math.round(2 * res));
  const ca = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255, s = sh[i * 4 + 3] / 255, out = a + s * (1 - a);
    if (out > 0) {
      const k = a / out;
      d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k;
    }
    ca[i] = out;
  }
  const gb = boxBlur(ca, w, h, r);
  for (let i = 0; i < n; i++) {
    const a = ca[i], gl = Math.min(1, gb[i] * 2), out = a + gl * (1 - a);
    if (out > 0) {
      const k = a / out;
      d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k;
    }
    d[i * 4 + 3] = Math.round(out * 255);
  }
  g.putImageData(img, 0, 0);
  // A plain canvas copy: read-back canvases are slow to draw every frame.
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(body, 0, 0);
  return { img: out, x: ox, y: oy, w: w / res, h: h / res };
}

// Two-pass box blur of an alpha plane (Flash blur at quality 1).
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += x >= 0 && x < w ? src[row + x] : 0;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      const add = x + r + 1, sub = x - r;
      if (add < w) acc += src[row + add];
      if (sub >= 0) acc -= src[row + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += y >= 0 && y < h ? tmp[y * w + x] : 0;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const add = y + r + 1, sub = y - r;
      if (add < h) acc += tmp[add * w + x];
      if (sub >= 0) acc -= tmp[sub * w + x];
    }
  }
  return out;
}

// CDrawPrimitive_XSI_DI renders frames from a stack a few milliseconds at a
// time; this does the same for the sets a game will need, so frames are
// ready before they are first seen.
const xsiWarm = [];
function warmStyles(styles) {
  if (!art.xsi) return;
  xsiWarm.length = 0;
  for (const style of styles) {
    const keys = Object.keys(art.xsi.items).filter(k => {
      const [group, anim] = k.split('/');
      if (style === 'zombie') return group === 'Zombie' ? anim !== 'HitFront' && anim !== 'HitRear' && anim !== 'Dying' && anim !== 'Dead' : group === 'Player' && /^(Hit|Dying|Dead)/.test(anim);
      if (style === 'devil') return group === 'Devil' ? anim === 'Devil_Attack' : group === 'Player' && /^(Stand|Walk|Hit|Dying|Dead)/.test(anim);
      return (group === 'Player' || WEAPON_SET_GROUPS.has(group)) && /^(Stand|Walk|Hit|Dying|Dead)/.test(anim);
    });
    for (const key of keys) {
      const item = art.xsi.items[key], n = item.dirs.length, frames = item.seq ? item.seq.length : item.dirs[0].length;
      for (let d = 0; d < n; d++) for (let f = 0; f < frames; f++) xsiWarm.push([style, key, (d / n) * TAU, f]);
    }
  }
}
function warmStep(budget = 4) {
  const end = performance.now() + budget;
  while (xsiWarm.length && performance.now() < end) xsiFrame(...xsiWarm.pop());
}

// ─── Which animation each creature shows ────────────────────────────────────
// Players (CThing_Creature_Player.GetCollection): the weapon's own stand and
// walk sets for the five guns, the plain ones for everything else; shot hits
// play shothit_1 or _2 at random. The simulation reports the current set in
// p.anim ({ weapon, moving, frame }), null while a hit plays.
const WEAPON_SET = { pistol: 'Player_Handgun', uzi: 'Player_UZI', shotgun: 'Player_Shotgun', rocket: 'Player_Rocket', railgun: 'Player_Railgun' };
const WEAPON_SET_GROUPS = new Set(Object.values(WEAPON_SET));
const hitSets = new Map();   // id → 'HitRear' | 'HitFront', chosen when a hit starts
const lastSets = new Map();  // zombie id → last set its state chose (states keep it)

function hitSet(key) {
  if (!hitSets.has(key)) hitSets.set(key, Math.random() < 0.5 ? 'HitRear' : 'HitFront');
  return hitSets.get(key);
}

function playerPose(p) {
  const key = 'p' + p.id;
  if (p.state === 'dying') return ['Player/Dying', p.af];
  if (p.state === 'dead' || p.down) return ['Player/Dead', 0];
  const a = p.anim !== undefined ? p.anim : { weapon: (WEAPONS[p.weapon] || WEAPONS[0]).id, moving: p.moving, frame: p.walk };
  if (!a || p.state === 'hit') return [`Player/${hitSet(key)}`, 0];
  hitSets.delete(key);
  const set = WEAPON_SET[a.weapon] || 'Player';
  return a.moving ? [`${set}/Walk`, a.frame] : [`${set}/Stand`, 0];
}

// Zombies (Zombie_* sets with Player hits, dying and dead) and the devil
// (Player sets, Devil_Attack). A state only changes the set when it starts.
function zombiePose(z) {
  const id = 'z' + z.id, devil = z.devil;
  if (z.state === 'hit') return [`Player/${hitSet(id)}`, 0];
  hitSets.delete(id);
  if (z.state === 'dying') return ['Player/Dying', z.af];
  if (z.state === 'attack') return [devil ? 'Devil/Devil_Attack' : 'Zombie/Zombie_Attack', z.af];
  let set = lastSets.get(z.id) || 'walk';
  if (z.state === 'cell') set = 'walk';
  else if (z.state === 'turn' || z.state === 'sleep' || z.state === 'wait') set = 'stand';
  lastSets.set(z.id, set);
  if (set === 'walk') return [devil ? 'Player/Walk' : 'Zombie/Zombie_Walk', z.walk];
  return [devil ? 'Player/Stand' : 'Zombie/Zombie_Stand', 0];
}

// State_Dying plays five frames at 0.34 a tick, then State_Dead lies on the
// floor and fades over the last second.
function corpsePose(c) {
  const f = c.t * 0.34;
  return f < 5 ? ['Player/Dying', f] : ['Player/Dead', 0];
}

function forgetCreatures() {
  const live = new Set(zombies.map(z => z.id));
  for (const id of lastSets.keys()) if (!live.has(id)) lastSets.delete(id);
  for (const k of hitSets.keys()) if (k[0] === 'z' && !live.has(Number(k.slice(1)))) hitSets.delete(k);
}

// A creature sprite ready for the draw list (screen position is its feet).
function creatureSprite(styleKey, [itemKey, frame], x, y, angle, alpha = 1) {
  const s = art.xsi && xsiFrame(styleKey, itemKey, angle, frame);
  return s ? { sprite: s, x, y, alpha } : null;
}

// Player characters by look key (CHARACTERS order: Swat, Agent, Soldier, Bambo).
const styleOf = look => (STYLES[look] ? look : 'zombie');
