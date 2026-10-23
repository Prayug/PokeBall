// Online play. The page stays static; this socket is the only link to the game server.
// The address is baked in at build time (POKEBALL_SERVER), or overridden with ?server=
// for a local game. Rendering, the camera and the booth stay on this machine.
// A dropped connection reconnects on its own and takes back the same seat with the token the
// server gave it: kept for the tab in a quick match, and in this browser for an online league
// (so the team is still yours tomorrow).
import { S } from './state.js';

let ws = null, token = '', ui = { render() {}, setScreen() {} }, hooks = {};
let queue = [];
let seat = null; // { code, mode } of the room this page is in, once the server said hello
let wanted = null; // what to send when the socket opens: create, join or resume
let retry = 0, retryTimer = 0, pingTimer = 0, lastPhase = null, leaving = false, renderSoon = 0;

export function bindUI(api) { ui = { ...ui, ...api }; }
// A burst of updates (the AI drafting a round) redraws once, on the next frame.
function softRender() {
  if (renderSoon) return;
  const go = () => { renderSoon = 0; ui.render(); };
  renderSoon = typeof requestAnimationFrame === 'function' && !document.hidden ? requestAnimationFrame(go) : setTimeout(go, 50);
}
export function onNet(h) { Object.assign(hooks, h); }

export function serverUrl() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
  } catch { /* no location */ }
  const baked = globalThis.POKEBALL_SERVER || '';
  if (baked) return baked;
  try {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const host = location.hostname;
      if (host && host !== 'github.io' && !host.endsWith('.github.io')) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${location.host}`;
      }
    }
  } catch { /* file url */ }
  return '';
}

// Messages wait while the socket is down and go out in order once it is back. Live input is
// only worth sending now, so a stale stick or button is dropped rather than replayed.
export function send(msg) {
  const text = JSON.stringify(msg);
  if (ws && ws.readyState === 1) ws.send(text);
  else if (msg.t !== 'input' && msg.t !== 'ping' && msg.t !== 'snap') queue.push(text);
}
function flush() {
  if (!ws || ws.readyState !== 1) return;
  while (queue.length) ws.send(queue.shift());
}

// ---------- the seat token ----------
const store = (mode) => {
  try { return mode === 'league' ? localStorage : sessionStorage; } catch { return null; }
};
function savedSeat(code) {
  for (const mode of ['quick', 'league']) {
    try {
      const all = JSON.parse(store(mode)?.getItem('pokeball.net') || 'null');
      const hit = all && (all.code ? (all.code === code ? all : null) : all[code]);
      if (hit?.token) return hit;
    } catch { /* storage blocked */ }
  }
  return null;
}
function keepSeat(code, mode, tok) {
  const box = store(mode);
  if (!box || !code || !tok) return;
  try {
    let all = JSON.parse(box.getItem('pokeball.net') || 'null');
    if (!all || all.code) all = {};
    all[code] = { code, mode, token: tok, at: Date.now() };
    // Keep the newest few rooms.
    const keep = Object.values(all).sort((a, b) => b.at - a.at).slice(0, 8);
    box.setItem('pokeball.net', JSON.stringify(Object.fromEntries(keep.map((x) => [x.code, x]))));
  } catch { /* private mode */ }
}
function forgetSeat(code) {
  for (const mode of ['quick', 'league']) {
    try {
      const box = store(mode);
      const all = JSON.parse(box?.getItem('pokeball.net') || 'null');
      if (!all) continue;
      if (all.code === code) box.removeItem('pokeball.net');
      else if (all[code]) { delete all[code]; box.setItem('pokeball.net', JSON.stringify(all)); }
    } catch { /* storage blocked */ }
  }
}
// The most recent room this browser has a seat in (for "Rejoin" on the home screen).
export function lastSeat() {
  let best = null;
  for (const mode of ['quick', 'league']) {
    try {
      const all = JSON.parse(store(mode)?.getItem('pokeball.net') || 'null');
      for (const x of all?.code ? [all] : Object.values(all || {})) if (x?.token && (!best || (x.at || 0) > (best.at || 0))) best = { ...x, mode: x.mode || mode };
    } catch { /* storage blocked */ }
  }
  return best;
}

// ---------- the socket ----------
function connect() {
  const url = serverUrl();
  if (!url) {
    S.netMsg = 'No game server. Run node server/index.js and open it, or add ?server=ws://localhost:8787';
    ui.render();
    return;
  }
  clearTimeout(retryTimer);
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
    if (ws.readyState === 1) { sendWanted(); flush(); }
    return;
  }
  let sock;
  try { sock = new WebSocket(url); } catch { S.netMsg = 'That server address is not a websocket.'; ui.render(); return; }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    retry = 0;
    S.netDown = false;
    sendWanted();
    flush();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ t: 'ping', n: performance.now() }), 2000);
    send({ t: 'ping', n: performance.now() });
  };
  sock.onmessage = (ev) => { if (ws === sock) { try { handle(JSON.parse(ev.data)); } catch (err) { console.error('net', err); } } };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer);
    if (leaving || !wanted) return;
    // Try again, sooner at first: 0.5s, 1s, 2s, 4s, then every 8s.
    S.netDown = true;
    S.netMsg = 'Connection lost. Reconnecting…';
    const el = document.getElementById('net-ping');
    if (el) el.textContent = 'reconnecting…';
    if (S.screen !== 'game') ui.render();
    retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
function sendWanted() {
  if (!ws || ws.readyState !== 1 || !wanted) return;
  // Once in a room, every reconnect is a resume with the seat token.
  const msg = seat && token ? { t: 'resume', code: seat.code, token, name: wanted.name } : wanted;
  ws.send(JSON.stringify(msg));
}

export function create(mode, setup) {
  begin({ t: 'create', mode, name: setup?.name || 'Home', setup });
}
export function join(code, name) {
  code = String(code || '').trim().toUpperCase();
  if (!code) { S.netMsg = 'Type the room code your friend sent.'; ui.render(); return; }
  const saved = savedSeat(code);
  begin(saved ? { t: 'resume', code, token: saved.token, name } : { t: 'join', code, name: name || 'Away' });
}
function begin(msg) {
  // A new room: drop any old one first.
  if (seat && (msg.t === 'create' || msg.code !== seat.code)) leave({ keepScreen: true });
  leaving = false;
  wanted = msg;
  token = msg.t === 'resume' ? msg.token : '';
  seat = null;
  lastPhase = null;
  S.netMsg = 'Connecting…';
  ui.render();
  if (ws && ws.readyState === 1) sendWanted();
  else connect();
}

// Leave the room: close the socket and go back to playing on this machine. The seat token is
// kept, so the room's link (or Rejoin on the home screen) takes the seat back.
export function leave({ keepScreen = false } = {}) {
  if (!S.online && !ws && !wanted) return;
  leaving = true;
  wanted = null;
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' })); } catch { /* closing anyway */ }
  try { ws?.close(); } catch { /* already shut */ }
  ws = null;
  queue = [];
  seat = null;
  token = '';
  hooks.reset?.();
  const wasLeague = S.net?.mode === 'league';
  S.online = false;
  S.net = null;
  S.netMsg = '';
  S.netDown = false;
  if (S.gameMeta?.online) { S.game = null; S.gameMeta = null; }
  // The online league was the server's; the local slots are untouched.
  if (wasLeague) S.league = null;
  try { if (/#(play|online)=/.test(location.hash)) history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* no history */ }
  if (!keepScreen) ui.render();
}

function handle(msg) {
  if (msg.t === 'err') {
    S.netMsg = msg.text;
    // The room is gone (closed, or the server restarted and it was a quick match): stop trying.
    if (msg.code === 'noroom' || msg.code === 'full') {
      if (wanted?.code) forgetSeat(wanted.code);
      if (!seat || msg.code === 'noroom') {
        const keep = S.netMsg;
        leave({ keepScreen: true });
        S.netMsg = keep;
        if (S.screen !== 'home') ui.setScreen('home'); else ui.render();
        return;
      }
    }
    ui.render();
    return;
  }
  if (msg.t === 'pong') {
    if (S.net) S.net.ping = Math.max(0, Math.round(performance.now() - msg.n));
    const el = document.getElementById('net-ping');
    if (el) el.textContent = `${S.net?.ping ?? ''} ms`;
    return;
  }
  if (msg.t === 'hello' || msg.t === 'state') {
    if (msg.t === 'hello') {
      if (msg.token) token = msg.token;
      seat = { code: msg.code, mode: msg.mode };
      keepSeat(msg.code, msg.mode, token);
      // Back after a drop: a play that ended while we were away is over here too.
      if (!['pre', 'live'].includes(msg.phase)) hooks.reset?.();
    }
    const was = S.net || {};
    S.online = true;
    S.netDown = false;
    S.net = { ...was, ...msg, ping: was.ping ?? null };
    if (msg.t === 'hello' || S.netMsg === 'Connecting…' || S.netMsg?.startsWith('Connection lost')) S.netMsg = '';
    try {
      const tag = msg.mode === 'league' ? 'online' : 'play';
      if (msg.code && location.hash !== `#${tag}=${msg.code}`) history.replaceState(null, '', `${location.pathname}${location.search}#${tag}=${msg.code}`);
    } catch { /* no history */ }
    route(msg.phase, msg.t === 'hello' || was.paused !== msg.paused || was.canForfeit !== msg.canForfeit || was.yourTeam !== msg.yourTeam);
    return;
  }
  if (msg.t === 'league') {
    S.league = msg.league;
    S.online = true;
    if (!S.game || S.game.final || !S.gameMeta?.online) S.gameMeta = { ...(S.gameMeta || {}), online: true, quick: true, userTeamId: S.net?.yourTeam ?? 0 };
    if (S.draft) S.draft.clock = msg.clock ?? S.draft.clock;
    const el = document.getElementById('pick-clock');
    if (el && msg.clock != null) el.textContent = msg.clock;
    if (S.screen !== 'game') softRender();
    return;
  }
  if (msg.t === 'game') {
    S.game = msg.g;
    S.gameMeta = gameMeta(msg.g);
    if (msg.phase === 'between' || msg.phase === 'final') ui.setScreen('game');
    else ui.render();
    return;
  }
  if (msg.t === 'play') {
    S.game = msg.g;
    S.online = true;
    S.gameMeta = gameMeta(msg.g);
    hooks.play?.(msg);
    ui.setScreen('game');
    return;
  }
  if (msg.t === 'snap') { hooks.snap?.(msg); return; }
  if (msg.t === 'whistle') { hooks.whistle?.(msg); return; }
  if (msg.t === 'presnap') { hooks.presnap?.(msg); }
}
function gameMeta(g) {
  const side = S.net?.you ?? 0;
  return { online: true, quick: true, league: S.net?.mode === 'league', userTeamId: S.net?.mode === 'league' ? (S.net?.yourTeam ?? 0) : g?.teams?.[side]?.id ?? side };
}
// Follow the room to the screen its phase belongs on, but only when the phase changes, so a
// state update never pulls someone off the roster or standings they are reading.
function route(phase, force) {
  const changed = phase !== lastPhase;
  lastPhase = phase;
  if (!changed && !force) {
    if (S.screen !== 'game' || !['pre', 'live'].includes(phase)) softRender();
    return;
  }
  if ((phase === 'pre' || phase === 'live') && S.screen === 'game') return;
  // A friend who has not claimed a team stays in the lobby, where the open teams are.
  if (S.net?.mode === 'league' && (S.net.yourTeam == null || !S.league?.teams?.some((t) => t.user))) { ui.setScreen('lobby'); return; }
  // A rematch goes back to the lobby to ready up.
  if (phase === 'lobby') { ui.setScreen('lobby'); return; }
  // The final score stays up until they leave it.
  if (S.screen === 'game' && S.game?.final && phase !== 'between') { ui.render(); return; }
  if (phase === 'draft') ui.setScreen('draft');
  else if (phase === 'grades') ui.setScreen('grades');
  else if (phase === 'season' || phase === 'playoffs' || phase === 'done') { if (S.screen === 'game' || S.screen === 'lobby' || S.screen === 'home' || S.screen === 'draft' || S.screen === 'grades') ui.setScreen('season'); else ui.render(); }
  else if (phase === 'between' || phase === 'pre' || phase === 'live') ui.setScreen('game');
  else if (phase === 'final') ui.setScreen(S.game ? 'game' : 'lobby');
  else ui.setScreen('lobby');
}

// Follow a #play=CODE or #online=CODE already on the address.
export function joinFromHash() {
  try {
    const m = /#(play|online)=([A-Za-z0-9]+)/.exec(location.hash || '');
    if (m) join(m[2].toUpperCase());
  } catch { /* no location */ }
}
// Opening a #play= or #online= link in a tab that is already open on the game.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const m = /#(play|online)=([A-Za-z0-9]+)/.exec(location.hash || '');
    if (m && m[2].toUpperCase() !== seat?.code) join(m[2].toUpperCase());
  });
  // Back from a sleeping phone or a background tab: reconnect now rather than at the next retry.
  window.addEventListener('online', () => { if (wanted && !ws) { retry = 0; connect(); } });
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden && wanted && !ws) { retry = 0; connect(); } });
}
