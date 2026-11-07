// ─── HUD (CHud) ─────────────────────────────────────────────────────────────
// Positions, scales and fonts are the original clips': Hud.ScoreTotal at the
// top centre (score, multiplier and its mcTimer ring), Hud_PlayerFrags in
// death match, HUD.Player over each player (weapon:ammo and the mcLife bar),
// Hud.Message lines rising from the bottom and Hud.Score points flying to
// the total.
function drawHud() {
  if (game.mode === 3) drawFrags();
  else drawScore();
  drawMessages();
}

// Hud_PlayerFrags: "Player N" and that player's deaths (PadFrags) above each
// view; the names swap with the views (mViewSide_DeathMatch).
function drawFrags() {
  const panels = [9.9, 513.65], rects = splitRects();
  players.forEach((p, i) => {
    const slot = i === 0 ? viewSide : 1 - viewSide;
    // On a phone the labels sit in each view's top left corner.
    const x = view.fluid ? rects[slot].x0 + 4 : panels[slot], y = view.fluid ? rects[slot].y0 + 16 : 78.1 - 27.25 + 0.5355 * 25;
    hudText(`Player ${i + 1}`, x + 1.05, y, 21.4, 'left');
    hudText(pad(p.deaths || 0, 2), x + 87.4, y, 21.4, 'left');
  });
}

// Hud.ScoreTotal: tfScore (40 px at 0.765), tfMultiple "xN" (24 px at 0.823)
// and mcTimer (101 frames at 0.68) showing mMultiplierTickRatio.
function drawScore() {
  const cx = view.w / 2;
  hudText(pad(score, 12), cx, -1.7 + 0.765 * 24, 30.6, 'center');
  const timer = art.sprites.hudTimer;
  if (timer) drawSprite('hudTimer', Math.min(100, Math.floor(clamp(combo.ratio, 0, 1) * 101)), cx + 62.05, 23.25, 1, 0, 0.68, 0.68);
  hudText(`x${combo.level}`, cx + 60.1 + 0.823 * 34.2, 29.35 + 0.823 * 14.4, 19.75, 'center');
  drawScoreFlights();
}

// CHud.AddScore: "+N" leaves the kill at 5 pixels a tick toward the total,
// 5 % faster every tick, fading over the last 140 pixels.
function drawScoreFlights() {
  for (const t of texts) {
    if (t.kind !== 'score') continue;
    const x0 = sx(t.x) - cam.x, y0 = sy(t.y) - cam.y, dx = view.w / 2 - x0, dy = -y0, d = Math.hypot(dx, dy) || 1;
    const run = 5 * (Math.pow(1.05, t.t) - 1) / 0.05, y = y0 + (dy / d) * run;
    if (y <= 0) continue;
    ctx.globalAlpha = y < 140 ? clamp((y - 40) / 100, 0, 1) : 1;
    hudText(t.text, x0 + (dx / d) * run, y, 14.2, 'center');
    ctx.globalAlpha = 1;
  }
}

// CHud.AddMessage: each line starts at the bottom centre and climbs a quarter
// of its remaining 100 pixels a tick; a new line pushes the others 19 higher.
// Lines last three seconds.
const hudMessages = [];
function addHudMessage(text, color) {
  for (const m of hudMessages) m.move += 19;
  hudMessages.push({ text, color, y: view.h, move: 100, at: performance.now() });
}
function tickHudMessages() {
  for (const m of hudMessages) { const step = m.move * 0.25; m.y -= step; m.move -= step; }
}
function drawMessages() {
  const now = performance.now();
  while (hudMessages.length && now - hudMessages[0].at >= 3000) hudMessages.shift();
  for (const m of hudMessages) hudText(m.text, view.w / 2, m.y + 1.45 + 0.72 * 14.4, 17.3, 'center', m.color);
  if (game.online && net.lag > 0.6 && game.state === 'playing') hudText('Waiting for the server…', view.w / 2, 92, 14.2, 'center', '#b0c4de');
  else if (net.noteText && performance.now() < net.noteUntil) hudText(net.noteText, view.w / 2, 92, 14.2, 'center', '#b0c4de');
}

// CHud.UpdatePlayer: mcAmmo "Short:ammo" (just the name when ammo is
// unlimited) and mcLife at frame life × 101 + 1, over the player's feet.
function drawPlayerTags() {
  for (const p of players) {
    if (p.down || p.state === 'respawn' || p.state === 'dying' || p.state === 'dead') continue;
    if (p.inv > 0 && p.inv % 2) continue;
    const w = WEAPONS[p.weapon] || WEAPONS[0], ammo = p.ammo[p.weapon];
    const x = sx(p.x), y = sy(p.y);
    hudText(w.short + (ammo === Infinity || ammo === null ? '' : `:${ammo}`), x, y - 65.9 - 7.95 + 0.593 * 15.2, 13, 'center', '#fff', true, true, -0.6);
    const frame = Math.floor(Math.min(Math.max(1, 101 * clamp(p.hp / p.max, 0, 1) + 1), 101)) - 1;
    drawSprite('hudLife', frame, x + 1, y - 57.4, 1, 0, 0.6667, 0.75);
  }
}

// ─── Sound (CSound) ─────────────────────────────────────────────────────────
// The original samples. Each registered sound is one voice: playing it again
// restarts it. Positional sounds are always played centred at full volume
// (CThing.PlaySound passes the origin), times the registered volume.
const sfx = (() => {
  let ac = null, master = null, decoding = null;
  let enabled = (() => { try { return localStorage.getItem('deadrooms:sound') !== 'off'; } catch { return true; } })();
  const buffers = {}, voices = new Map(), ambient = new Set();
  const VOLUME = { 'Creature.Player.Scream.1': 0.7, 'Creature.Player.Scream.2': 0.7, 'Creature.Zombie.Hit': 0.3, 'Shot.Grenade.Bounce': 0.4 };
  const volumeOf = key => VOLUME[key] ?? (key.startsWith('Creature.Zombie.Ambience') ? 0.4 : 1);
  const live = () => enabled && ac && ac.state === 'running';

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(ac.destination);
    decode();
  }
  function decode() {
    if (!ac || !art.ready || decoding) return decoding;
    decoding = Promise.all(Object.entries(art.sounds).map(async ([key, bytes]) => {
      try { buffers[key] = await ac.decodeAudioData(bytes.slice(0)); } catch (err) { console.warn('sound', key, err); }
    }));
    return decoding;
  }
  function start(key, voice, onEnd) {
    const buf = buffers[key];
    if (!buf) return null;
    const old = voices.get(voice);
    if (old) { try { old.src.stop(); } catch {} }
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf;
    g.gain.value = volumeOf(key);
    src.connect(g); g.connect(master);
    const v = { src };
    src.onended = () => { if (voices.get(voice) === v) voices.delete(voice); if (onEnd) onEnd(v); };
    voices.set(voice, v);
    src.start();
    return v;
  }
  return {
    init,
    decode,
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('deadrooms:sound', enabled ? 'on' : 'off'); } catch {}
      if (!enabled) for (const v of voices.values()) { try { v.src.stop(); } catch {} }
      return enabled;
    },
    // In-game sounds; menus use ui() (Click and Click2).
    play(key, voice = key) { if (live() && game.state !== 'menu') start(key, voice); },
    ui(key) { if (live()) start(key, 'ui:' + key); },
    ambience(key) {
      if (!live()) return;
      const v = start(key, 'amb:' + key, done => ambient.delete(done));
      if (v) ambient.add(v);
    },
    ambienceCount: () => ambient.size,
    stopAmbience() { for (const v of ambient) { try { v.src.stop(); } catch {} } ambient.clear(); },
  };
})();
