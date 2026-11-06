// ─── HUD ────────────────────────────────────────────────────────────────────
function drawHud() {
  // Big score at the top, with the multiplier ring beside it.
  const text = pad(score, 9);
  const width = label(text, W / 2, 30, 44, '#fff', 'center', 7);
  const mx = W / 2 + width / 2 + 42, my = 30, pulse = 1 + Math.max(0, combo.pulse) * 0.35 - Math.max(0, -combo.pulse) * 0.15;
  ctx.save();
  ctx.translate(mx, my);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = 'rgba(10,10,10,0.72)';
  ctx.beginPath(); ctx.arc(0, 0, 25, 0, TAU); ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
  ctx.strokeStyle = combo.pulse < 0 ? '#ff6a4a' : '#fff';
  ctx.beginPath(); ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(combo.bar, 0, 1)); ctx.stroke();
  label(`x${combo.level}`, 0, 1, combo.level > 9 ? 19 : 23, '#fff', 'center', 4);
  ctx.restore();

  label(`LEVEL ${level}`, 22, 24, 26, '#fff', 'left', 6);
  label(`${toSpawn + zombies.length} zombies left`, 22, 52, 15, '#e8e0d0', 'left', 4);
  label(`BEST ${pad(Math.max(score, getBest(game.roomIndex, game.mode)), 9)}`, W - 22, 24, 18, '#e8e0d0', 'right', 5);
  const next = WEAPONS.find(w => w.unlock > combo.best);
  if (next) label(`Next: ${next.name} at x${next.unlock}`, W - 22, 50, 14, '#ffd08a', 'right', 4);

  if (players.length === 1) drawArsenal(players[0], 'left');
  else { drawArsenal(players[0], 'left'); drawArsenal(players[1], 'right'); }

  if (banner) {
    const a = clamp(Math.min(banner.t / 0.25, (banner.life - banner.t) / 0.5), 0, 1);
    ctx.globalAlpha = a;
    label(banner.title, W / 2, H * 0.36, 78, '#fff', 'center', 10);
    label(banner.sub, W / 2, H * 0.36 + 56, 24, '#ffe2b0', 'center', 6);
    ctx.globalAlpha = 1;
  }
  if (toast) {
    const a = clamp(Math.min(toast.t / 0.2, (toast.life - toast.t) / 0.4), 0, 1), y = 88 - (1 - Math.min(1, toast.t / 0.2)) * 12;
    ctx.globalAlpha = a;
    ctx.font = `22px ${FONT}`;
    const msg = `${toast.kind}  ·  ${toast.text}`, w = ctx.measureText(msg).width + 40;
    ctx.fillStyle = '#c7361a';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, y - 18, w, 36, 6); ctx.fill(); ctx.stroke();
    label(msg, W / 2, y + 1, 22, '#fff', 'center', 4);
    ctx.globalAlpha = 1;
  }
  // Red edges when someone is close to going down.
  const low = Math.min(...players.filter(p => !p.down).map(p => p.hp), 100);
  const hurt = Math.max(0, ...players.map(p => p.hurt));
  const k = Math.max(low < 35 ? (1 - low / 35) * (0.6 + 0.4 * Math.sin(clock * 6)) : 0, hurt * 1.6);
  if (k > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(180,0,0,0)');
    g.addColorStop(1, `rgba(180,0,0,${0.45 * clamp(k, 0, 1)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

// Unlocked weapons plus the next one to aim for, at the bottom edge.
function drawArsenal(p, align) {
  const list = WEAPONS.map((w, i) => i).filter(unlocked);
  const next = WEAPONS.findIndex(w => w.unlock > combo.best);
  if (next >= 0) list.push(next);
  const slot = players.length > 1 ? 60 : 66, gap = players.length > 1 ? 3 : 4, total = list.length * slot + (list.length - 1) * gap, y = H - 47;
  let x = align === 'left' ? 16 : W - 16 - total;
  for (const i of list) {
    const w = WEAPONS[i], locked = !unlocked(i), on = !locked && p.weapon === i, ammo = p.ammo[i];
    ctx.globalAlpha = locked ? 0.55 : 1;
    ctx.fillStyle = on ? '#f4f2ec' : 'rgba(14,14,14,0.78)';
    ctx.strokeStyle = on ? '#e2441a' : '#111';
    ctx.lineWidth = on ? 3 : 2;
    ctx.beginPath(); ctx.roundRect(x, y, slot, 38, 5); ctx.fill(); ctx.stroke();
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = on ? '#555' : '#9a9a9a';
    if (players.length === 1) ctx.fillText(String(i + 1), x + 5, y + 4);
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? '#111' : '#eee';
    ctx.fillText(w.short, x + slot / 2 + (players.length === 1 ? 3 : 0), y + 4);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = locked ? '#ffd08a' : on ? '#111' : ammo > 0 ? '#fff' : '#777';
    ctx.fillText(locked ? `x${w.unlock}` : ammo === Infinity ? '∞' : String(ammo), x + slot / 2, y + 18);
    ctx.globalAlpha = 1;
    x += slot + gap;
  }
}

// ─── Sound: everything is synthesized ───────────────────────────────────────
const sfx = (() => {
  let ac = null, master = null, noise = null;
  let enabled = (() => { try { return localStorage.getItem('deadrooms:sound') !== 'off'; } catch { return true; } })();
  const live = () => enabled && ac && ac.state === 'running' && !game.demo;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(comp);
    comp.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  function burst({ dur, freq, q = 1, type = 'bandpass', gain = 0.4, sweep = 0, delay = 0 }) {
    const t = ac.currentTime + delay, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  function tone({ freq, to = freq, dur, type = 'sine', gain = 0.2, delay = 0, attack = 0.005 }) {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const play = fn => (...args) => { if (live()) fn(...args); };
  return {
    init,
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('deadrooms:sound', enabled ? 'on' : 'off'); } catch {}
      return enabled;
    },
    shot: play(id => {
      if (id === 'pistol') { burst({ dur: 0.12, freq: 1700, q: 0.8, gain: 0.5 }); tone({ freq: 170, to: 60, dur: 0.1, type: 'triangle', gain: 0.35 }); }
      if (id === 'uzi') { burst({ dur: 0.06, freq: 2400, q: 0.9, gain: 0.3 }); tone({ freq: 130, to: 70, dur: 0.05, type: 'triangle', gain: 0.2 }); }
      if (id === 'shotgun') { burst({ dur: 0.34, freq: 1100, type: 'lowpass', gain: 0.75, sweep: 200 }); tone({ freq: 95, to: 40, dur: 0.22, gain: 0.6 }); }
      if (id === 'rocket') burst({ dur: 0.55, freq: 380, q: 1.5, gain: 0.4, sweep: 1800 });
      if (id === 'railgun') { tone({ freq: 2200, to: 160, dur: 0.38, type: 'sawtooth', gain: 0.12 }); burst({ dur: 0.25, freq: 4000, type: 'highpass', gain: 0.25 }); }
      if (id === 'throw') burst({ dur: 0.15, freq: 700, q: 2, gain: 0.18, sweep: 1400 });
    }),
    boom: play((size = 1) => { burst({ dur: 0.9 * size, freq: 1100, type: 'lowpass', gain: 0.9, sweep: 70 }); tone({ freq: 72, to: 28, dur: 0.6, gain: 0.8 }); }),
    splat: play(() => burst({ dur: 0.16, freq: 520, type: 'lowpass', gain: 0.32, sweep: 140 })),
    hurt: play(() => { tone({ freq: 220, to: 90, dur: 0.18, type: 'square', gain: 0.1 }); burst({ dur: 0.1, freq: 400, type: 'lowpass', gain: 0.3 }); }),
    down: play(() => tone({ freq: 300, to: 55, dur: 0.9, type: 'sawtooth', gain: 0.12 })),
    pickup: play(() => { tone({ freq: 660, dur: 0.09, type: 'square', gain: 0.07 }); tone({ freq: 990, dur: 0.14, type: 'square', gain: 0.07, delay: 0.07 }); }),
    unlock: play(() => [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, dur: 0.24, type: 'triangle', gain: 0.16, delay: i * 0.08 }))),
    level: play(() => [196, 247, 294].forEach((freq, i) => tone({ freq, dur: 0.7, type: 'sawtooth', gain: 0.05, delay: i * 0.12, attack: 0.05 }))),
    place: play(() => { tone({ freq: 180, to: 110, dur: 0.08, type: 'square', gain: 0.08 }); burst({ dur: 0.08, freq: 900, gain: 0.2 }); }),
    crumble: play(() => burst({ dur: 0.4, freq: 600, type: 'lowpass', gain: 0.5, sweep: 120 })),
    click: play(() => tone({ freq: 900, dur: 0.03, type: 'square', gain: 0.04 })),
    deny: play(() => tone({ freq: 140, dur: 0.12, type: 'square', gain: 0.07 })),
    tink: play(() => tone({ freq: 1800, dur: 0.04, type: 'square', gain: 0.03 })),
    fireball: play(() => burst({ dur: 0.45, freq: 300, q: 2, gain: 0.25, sweep: 900 })),
    groan: play(() => { const f = rand(70, 105); tone({ freq: f, to: f * 0.7, dur: rand(0.5, 0.9), type: 'sawtooth', gain: 0.045, attack: 0.15 }); }),
  };
})();
