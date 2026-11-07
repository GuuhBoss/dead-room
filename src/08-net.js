// ─── Online play ────────────────────────────────────────────────────────────
// The server owns the game (docs/online-contract.md). This client only sends
// its player's controls and draws the snapshots it receives: it never runs
// update() for an online game and never reports a score.
const NAME_RE = /^[\p{L}\p{N} ._'\-]+$/u;
const cleanName = s => s.normalize('NFKC').trim().replace(/ +/g, ' ');

const net = {
  ws: null, phase: 'idle', me: null, lobby: null, seq: 0, sendIn: 0, pingIn: 0, rtt: 0,
  snaps: [], lastAt: 0, lag: 0, edges: null, noteText: '', noteUntil: 0, bound: false, aborted: false, result: null,
  // 'shared': one camera for both players, split screen in death match, as on
  // one computer. 'own': the camera follows only this player. Display only.
  view: (() => { try { return localStorage.getItem('deadrooms:view') === 'own' ? 'own' : 'shared'; } catch { return 'shared'; } })(),
  rematchReady: [], rematchAsked: false, roomGone: '',

  setView(view) {
    this.view = view === 'own' ? 'own' : 'shared';
    try { localStorage.setItem('deadrooms:view', this.view); } catch {}
    document.querySelectorAll('input[name="net-view"]').forEach(r => { r.checked = r.value === this.view; });
    cam.tx = null;
  },

  openScreen() {
    if (!this.bound) this.bind();
    if (this.phase !== 'lobby') this.showEntry();
    $('net-name').value = $('net-name').value || (() => { try { return localStorage.getItem('deadrooms:name') || ''; } catch { return ''; } })();
    $('net-room').value = String(menu.room);
  },

  bind() {
    this.bound = true;
    $('net-create').onsubmit = e => {
      e.preventDefault();
      const name = this.name();
      if (!name) return;
      const picked = new FormData($('net-create')).get('net-mode'), mode = ['coop', 'deathmatch'].includes(picked) ? picked : 'solo';
      this.request({ type: 'create', name, roomIndex: +$('net-room').value, mode });
    };
    $('net-join').onsubmit = e => {
      e.preventDefault();
      const name = this.name(), code = $('net-code').value.trim().toUpperCase();
      if (!name) return;
      if (!/^[A-Z0-9]{8}$/.test(code)) { this.status('A room code is eight letters or digits.'); return; }
      this.request({ type: 'join', code, name });
    };
    $('net-code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); };
    document.querySelectorAll('input[name="net-view"]').forEach(r => { r.onchange = () => { if (r.checked) this.setView(r.value); }; });
    $('net-start').onclick = () => this.send({ type: 'start' });
    $('net-leave').onclick = () => { this.leave(); this.showEntry(); this.status('You left the room.'); };
    $('copy-code').onclick = async () => {
      try { await navigator.clipboard.writeText(this.me.code); this.status('Code copied.', true); } catch { this.status('Copy failed: select the code and copy it yourself.'); }
    };
  },

  name() {
    const name = cleanName($('net-name').value);
    if (!name || [...name].length > 24 || !NAME_RE.test(name)) {
      this.status('Names are 1 to 24 letters, numbers, spaces or . _ \' -');
      $('net-name').focus();
      return null;
    }
    try { localStorage.setItem('deadrooms:name', name); } catch {}
    return name;
  },

  status(text, ok) { const el = $('net-status'); el.textContent = text; el.classList.toggle('ok', !!ok); },
  note(text) { this.noteText = text; this.noteUntil = performance.now() + 2500; },

  showEntry() { $('net-entry').hidden = false; $('net-lobby').hidden = true; $('net-back-row').hidden = false; },

  // Opens the socket on demand, then sends the first request.
  request(first) {
    if (location.protocol === 'file:') { this.status('Online play needs the game served by its own server (pnpm start).'); return; }
    this.leave();
    this.status('Connecting…', true);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/online`);
    this.ws = ws;
    this.phase = 'connecting';
    this.aborted = false;
    ws.onopen = () => { if (this.ws === ws) { this.sendRaw(first); this.status('Connected. Waiting for the room…', true); } };
    ws.onmessage = e => { if (this.ws === ws) this.receive(e.data); };
    ws.onerror = () => {};
    ws.onclose = () => { if (this.ws === ws) this.closed('The connection to the server closed.'); };
  },

  sendRaw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  send(m) { this.sendRaw(m); },

  receive(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'welcome') { this.me = m; this.phase = 'lobby'; this.roomGone = ''; this.status(m.host ? 'Room created.' : 'Joined the room.', true); }
    else if (m.type === 'lobby') { this.lobby = m; this.drawLobby(); }
    else if (m.type === 'state') this.state(m);
    else if (m.type === 'result' && m.runId === this.me?.runId) this.result = m;
    else if (m.type === 'rematch') { this.rematchReady = m.ready; this.showRematch(); }
    else if (m.type === 'restart') {
      // Everyone accepted: the next state starts the new run in this room.
      this.me = { ...this.me, runId: m.runId };
      this.result = null; this.rematchReady = []; this.rematchAsked = false; this.roomGone = '';
      this.phase = 'lobby';
    }
    else if (m.type === 'pong') this.rtt = Math.max(0, performance.now() - m.at);
    else if (m.type === 'error') {
      if (this.phase === 'over') {
        // Late input racing the end of the game is ignored; a refused rematch is shown.
        // (an older server answers "Unsupported message type").
        if (this.rematchAsked && !/^(No active run|Stale input|Invalid input)/.test(m.message)) {
          this.rematchAsked = false; this.showRematch();
          $('rematch-status').textContent = /Unsupported/.test(m.message) ? 'This server cannot restart rooms yet; it needs the updated version.' : `${m.message}.`;
          $('rematch-status').hidden = false;
        }
        return;
      }
      if (this.phase === 'playing') this.note(m.message); else this.status(m.message);
      if (this.phase === 'connecting') this.leave();
    } else if (m.type === 'ended') this.closed(`The game ended: ${m.reason}.`);
  },

  drawLobby() {
    const l = this.lobby, me = this.me;
    if (!l || !me) return;
    $('net-entry').hidden = true; $('net-lobby').hidden = false; $('net-back-row').hidden = true;
    $('lobby-code').textContent = l.code;
    $('lobby-room').textContent = `${l.roomIndex + 1}. ${ROOMS[l.roomIndex].name}`;
    $('lobby-mode').textContent = { solo: 'Single play', coop: 'Cooperative, two players', deathmatch: 'Death match, two players, first to 10' }[l.mode] || l.mode;
    $('net-view').hidden = l.mode === 'solo';
    this.setView(this.view);
    // Each player picks their own character ({type:'character'}); the server
    // keeps the choice and the game uses it.
    $('lobby-players').innerHTML = l.players.map(p => `<li>${cardHTML(p.id, p.id === me.playerId, `${p.name}'s character`)}<div>${escapeHtml(p.name)} <span>player ${p.id + 1}${p.id === l.hostId ? ', host' : ''}${p.id === me.playerId ? ', you' : ''}</span></div></li>`).join('');
    l.players.forEach((p, i) => paintCard(document.querySelectorAll('#lobby-players .charcard')[i], Number.isInteger(p.character) ? p.character : 0));
    document.querySelectorAll('#lobby-players .arrow').forEach(b => {
      b.onclick = () => {
        const mine = this.lobby.players.find(p => p.id === this.me.playerId);
        if (!mine) return;
        const next = ((mine.character ?? 0) + +b.dataset.step + CHARACTERS.length) % CHARACTERS.length;
        sfx.ui('CLICK');
        this.send({ type: 'character', character: next });
      };
    });
    const ready = l.mode === 'solo' || l.players.length === 2;
    $('net-start').hidden = !me.host;
    $('net-start').disabled = !ready;
    $('lobby-hint').textContent = me.host
      ? (ready ? 'Start when you are ready.' : 'Waiting for a second player: share the room code.')
      : 'Waiting for the host to start.';
  },

  // ─── Snapshots ────────────────────────────────────────────────────────────
  state(m) {
    const s = m.snapshot, now = performance.now();
    this.lastAt = now;
    if (this.phase === 'lobby' || this.phase === 'connecting') this.enter(s);
    else if (this.phase !== 'playing' && this.phase !== 'over') return;
    this.snaps.push({ at: now, s });
    if (this.snaps.length > 4) this.snaps.shift();
  },

  enter(s) {
    this.phase = 'playing';
    sfx.init();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    game.online = true;
    game.demo = false;
    game.mode = s.game.mode;
    game.roomIndex = s.game.roomIndex;
    paused = false; overShown = false;
    loadRoom(s.game.roomIndex);
    this.snaps = [];
    this.hydrate(s, s, 1);
    beginView();
    hideScreens();
    keys.clear();
    $('touch').hidden = !touch.used;
    this.seq = 0; this.sendIn = 0; this.edges = null;
  },

  // Draw a moment just behind the newest snapshot so movement stays smooth.
  frame(dt) {
    clock += dt;
    const now = performance.now();
    this.lag = this.lastAt ? (now - this.lastAt) / 1000 : 0;
    if (this.phase === 'playing' && this.snaps.length) {
      const t = now - 60;
      let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
      for (let i = this.snaps.length - 1; i > 0; i--) {
        if (this.snaps[i - 1].at <= t) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
      }
      const k = b.at > a.at ? clamp((t - a.at) / (b.at - a.at), 0, 1) : 1;
      this.hydrate(a.s, b.s, k);
    }
    if (this.phase === 'playing' && game.state === 'playing') this.input(dt);
    if ((this.pingIn -= dt) <= 0 && this.ws && this.ws.readyState === 1) { this.pingIn = 2; this.sendRaw({ type: 'ping', at: performance.now() }); }
  },

  hydrate(a, b, k) {
    const ease = (list0, list1, fields) => {
      const old = new Map(list0.map(e => [e.id, e]));
      return list1.map(e => {
        const o = old.get(e.id), out = { ...e };
        if (o && k < 1) for (const f of fields) {
          if (f === 'angle') out.angle = o.angle + turn(o.angle, e.angle) * k;
          else out[f] = o[f] + (e[f] - o[f]) * k;
        }
        return out;
      });
    };
    players = ease(a.players, b.players, ['x', 'y', 'angle', 'walk']).map(p => ({ ...p, ammo: p.ammo.map(v => (v === null ? Infinity : v)) }));
    zombies = ease(a.zombies, b.zombies, ['x', 'y', 'angle', 'walk']);
    shots = ease(a.shots, b.shots, ['x', 'y', 'z']);
    corpses = b.corpses; barrels = b.barrels; blocks = b.blocks; mines = b.mines; pickups = b.pickups;
    tracers = b.tracers; blasts = b.blasts; texts = b.texts;
    score = b.score; kills = b.kills; level = b.level; toSpawn = b.toSpawn; runTime = b.runTime;
    combo = b.combo; upgrades = b.upgrades; shake = b.shake; flashLight = b.flashLight; ticks = b.ticks;
    if (b.game.options) game.options = b.game.options;
    if (b.game.characters) game.characters = b.game.characters;
    if (b.game.fragLimit) game.fragLimit = b.game.fragLimit;
    game.winner = b.game.winner ?? null;
    game.state = b.game.state;
  },

  // Held controls about 30 times a second; edges are kept until sent once.
  input(dt) {
    const now = readLocal(0), e = this.edges || (this.edges = { prev: false, next: false, select: -1, tap: false, fire: false });
    e.prev ||= now.prev; e.next ||= now.next; e.tap ||= now.tap;
    if (now.select >= 0) e.select = now.select;
    if ((this.sendIn -= dt) > 0) return;
    this.sendIn = 1 / 30;
    this.sendRaw({ type: 'input', seq: this.seq++, input: { dx: now.dx, dy: now.dy, fire: now.fire, prev: e.prev, next: e.next, select: e.select, tap: e.tap } });
    this.edges = null;
  },

  // ─── Play again ───────────────────────────────────────────────────────────
  // After a finished run each player may ask to play again; the server starts
  // a new run in the same room once everyone has.
  nameOf(id) { return this.lobby?.players.find(p => p.id === id)?.name || `Player ${id + 1}`; },

  requestRematch() {
    if (this.roomGone || this.phase !== 'over' || this.rematchAsked) return;
    this.rematchAsked = true;
    this.send({ type: 'rematch' });
    this.showRematch();
  },

  showRematch() {
    const el = $('rematch-status'), again = $('again');
    if (!el || !game.online) return;
    const others = (this.lobby?.players || []).filter(p => p.id !== this.me?.playerId);
    let text = '';
    if (this.roomGone) text = `${this.roomGone} Playing again is no longer possible.`;
    else if (this.rematchAsked) text = others.length ? `Waiting for ${others.map(p => p.name).join(' and ')} to accept…` : 'Starting…';
    else if (others.some(p => this.rematchReady.includes(p.id))) text = `${others.filter(p => this.rematchReady.includes(p.id)).map(p => p.name).join(' and ')} wants to play again.`;
    else if (others.length) text = `${again.textContent} asks everyone; the game restarts when all accept.`;
    el.textContent = text;
    el.hidden = !text;
    again.disabled = !!this.roomGone || this.rematchAsked;
  },

  // The authoritative final snapshot said the game is over.
  over() {
    this.rematchReady = []; this.rematchAsked = false;
    if (game.mode === 3) {
      // Death match has a winner and no survival ranking (result.recorded is false by design).
      showOver(`Decided by the server: first to ${game.fragLimit}. Death match games are not ranked.`);
      this.phase = 'over';
      this.showRematch();
      return;
    }
    const mode = game.mode === 1 ? 'solo' : 'coop';
    showOver('Scored by the server. Checking the global leaderboard…');
    const runId = this.me?.runId;
    if (this.result?.recorded === false) $('over-rank').textContent = 'Run completed, but leaderboard storage was unavailable. This run was not recorded.';
    else if (!this.result?.recorded) $('over-rank').textContent = 'Run completed. The server has not confirmed leaderboard recording.';
    else board.confirm(game.roomIndex, mode, runId).then(text => { if (overShown && this.me?.runId === runId) $('over-rank').textContent = text; });
    this.phase = 'over';
    this.showRematch();
  },

  closed(reason) {
    const wasPlaying = this.phase === 'playing';
    if (overShown && game.online && !wasPlaying) { this.roomGone = reason; this.showRematch(); }
    this.ws = null;
    this.phase = 'idle';
    if (wasPlaying && !overShown) {
      this.aborted = true;
      game.state = 'over';
      showOver(`${reason} This game was not ranked.`);
      this.roomGone = 'The room has closed.';
      this.showRematch();
    } else if (!$('online').hidden) {
      this.showEntry();
      this.status(reason);
    }
  },

  leave() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'leave' })); } catch {}
      try { ws.close(); } catch {}
    }
    this.result = null;
    this.phase = 'idle'; this.me = null; this.lobby = null; this.snaps = []; this.lastAt = 0; this.lag = 0;
  },
};

// ─── Global leaderboard ─────────────────────────────────────────────────────
const board = {
  room: 0, mode: 'solo', bound: false, mine: null,

  open(roomIndex, mode) {
    if (!this.bound) this.bind();
    this.room = roomIndex; this.mode = mode;
    document.querySelector(`input[name="board-mode"][value="${mode}"]`).checked = true;
    this.load();
  },

  bind() {
    this.bound = true;
    $('board-prev').onclick = () => { this.room = (this.room + ROOMS.length - 1) % ROOMS.length; this.load(); };
    $('board-next').onclick = () => { this.room = (this.room + 1) % ROOMS.length; this.load(); };
    document.querySelectorAll('input[name="board-mode"]').forEach(r => { r.onchange = () => { this.mode = r.value; this.load(); }; });
  },

  async fetch(roomIndex, mode) {
    if (location.protocol === 'file:') throw new Error('The leaderboard needs the game served by its own server (pnpm start).');
    const res = await fetch(`/api/leaderboard?roomIndex=${roomIndex}&mode=${mode}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : [];
  },

  async load() {
    const room = this.room, mode = this.mode;
    $('board-room').textContent = `${room + 1}. ${ROOMS[room].name}`;
    $('board-status').textContent = 'Loading…';
    $('board-body').innerHTML = '';
    try {
      const entries = await this.fetch(room, mode);
      if (room !== this.room || mode !== this.mode) return;
      const time = s => `${Math.floor(s / 60)}:${pad(s % 60, 2)}`;
      $('board-body').innerHTML = entries.map((e, i) => `<tr class="${e.id === this.mine ? 'mine' : ''}"><td>${i + 1}</td><td>${escapeHtml(e.names.join(' & '))}</td><td>${Number(e.score).toLocaleString()}</td><td>${e.kills}</td><td>${e.level}</td><td>x${e.bestMultiplier}</td><td>${time(e.duration)}</td><td>${escapeHtml(new Date(e.createdAt).toLocaleDateString())}</td></tr>`).join('');
      $('board-status').textContent = entries.length ? '' : 'No online games recorded for this room yet. Host one from Play online.';
      $('board-status').classList.toggle('ok', !entries.length);
    } catch (err) {
      if (room === this.room && mode === this.mode) $('board-status').textContent = err.message;
    }
  },

  // After an online game: find the server's own record of it, if any.
  async confirm(roomIndex, mode, runId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const entries = await this.fetch(roomIndex, mode);
        const at = entries.findIndex(e => e.id === runId);
        if (at >= 0) { this.mine = entries[at].id; return `Recorded by the server: #${at + 1} on the ${ROOMS[roomIndex].name} ${mode === 'coop' ? 'co-op' : 'solo'} leaderboard.`; }
      } catch (err) { return `Scored by the server, but the leaderboard could not be read: ${err.message}`; }
      await new Promise(r => setTimeout(r, 700));
    }
    return 'Scored by the server. It is not in this room\'s top 50.';
  },
};
