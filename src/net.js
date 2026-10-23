// Online play. The page stays static; this socket is the only link to the game server.
// The address is baked in at build time (POKEBALL_SERVER), or overridden with ?server=
// for a local game. Rendering, the camera and the booth stay on this machine.
import { S } from './state.js';

let ws = null, token = '', ui = { render() {}, setScreen() {} }, hooks = {};
const queue = [];

export function bindUI(api) { ui = { ...ui, ...api }; }
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

export function send(msg) {
  const text = JSON.stringify(msg);
  if (ws && ws.readyState === 1) ws.send(text);
  else queue.push(text);
}
function flush() {
  if (!ws || ws.readyState !== 1) return;
  while (queue.length) ws.send(queue.shift());
}

function open(url, first) {
  if (!url) {
    S.netMsg = 'No game server. Run node server/index.js and open it, or add ?server=ws://localhost:8787';
    ui.render();
    return;
  }
  if (ws && ws.readyState === 1) { first(); flush(); return; }
  try { ws = new WebSocket(url); } catch { S.netMsg = 'That server address is not a websocket.'; ui.render(); return; }
  ws.onopen = () => { S.online = true; first(); flush(); ping(); };
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { if (S.net) S.net.paused = true; };
}
function ping() {
  if (!ws || ws.readyState !== 1) return;
  send({ t: 'ping', n: performance.now() });
  setTimeout(ping, 2000);
}

export function create(mode, setup) {
  open(serverUrl(), () => send({ t: 'create', mode, name: setup?.name || 'Home', setup }));
}
export function join(code, name) {
  const saved = savedSeat();
  open(serverUrl(), () => send(saved && saved.code === code && saved.token ? { t: 'resume', code, token: saved.token, name } : { t: 'join', code, name: name || 'Away' }));
}
function savedSeat() {
  try { return JSON.parse(sessionStorage.getItem('pokeball.net') || 'null'); } catch { return null; }
}

function paintPing() {
  const text = `${S.net?.ping ?? ''} ms`;
  for (const el of document.querySelectorAll('.net-ping')) el.textContent = text;
}
function metaFor(side, g) {
  // A quick match is one game. A league stays a league, so the season hub and the final card
  // do not treat it as a local quick game.
  const quick = S.net?.mode !== 'league';
  const team = S.net?.yourTeam;
  const userTeamId = team != null ? team : (g?.teams?.[side]?.id ?? side ?? 0);
  return { online: true, quick, userTeamId };
}
function maybeAutoPick(league) {
  if (!S.draft?.autoAll || league?.phase !== 'draft') return;
  const pk = league.picks?.[league.pickIndex];
  if (pk && pk.player == null && pk.team === S.net?.yourTeam) send({ t: 'autopick' });
}
function handle(msg) {
  if (msg.t === 'err') { S.netMsg = msg.text; ui.render(); return; }
  if (msg.t === 'pong') {
    if (S.net) S.net.ping = Math.max(0, Math.round(performance.now() - msg.n));
    paintPing();
    return;
  }
  if (msg.t === 'hello' || msg.t === 'state') {
    if (msg.token) token = msg.token;
    S.online = true;
    S.net = { ...(S.net || {}), ...msg, ping: S.net?.ping ?? null };
    S.netMsg = '';
    try { sessionStorage.setItem('pokeball.net', JSON.stringify({ code: msg.code, token, url: serverUrl() })); } catch { /* private mode */ }
    try {
      const tag = msg.mode === 'league' ? 'online' : 'play';
      if (msg.code && location.hash !== `#${tag}=${msg.code}`) history.replaceState(null, '', `${location.pathname}${location.search}#${tag}=${msg.code}`);
    } catch { /* no history */ }
    route(msg.phase);
    return;
  }
  if (msg.t === 'league') {
    S.league = msg.league;
    S.online = true;
    S.gameMeta = { ...(S.gameMeta || {}), ...metaFor(S.net?.you ?? 0) };
    if (S.draft) S.draft.clock = msg.clock ?? S.draft.clock;
    const el = document.getElementById('pick-clock');
    if (el && msg.clock != null) el.textContent = msg.clock;
    if (S.screen !== 'game') ui.render();
    maybeAutoPick(msg.league);
    return;
  }
  if (msg.t === 'game') {
    S.game = msg.g;
    const side = S.net?.you ?? 0;
    S.gameMeta = metaFor(side, msg.g);
    if (msg.phase === 'between' || msg.phase === 'final') ui.setScreen('game');
    else ui.render();
    return;
  }
  if (msg.t === 'play') {
    S.game = msg.g;
    S.online = true;
    const side = S.net?.you ?? 0;
    S.gameMeta = metaFor(side, msg.g);
    hooks.play?.(msg);
    ui.setScreen('game');
    return;
  }
  if (msg.t === 'snap') { hooks.snap?.(msg); return; }
  if (msg.t === 'whistle') { hooks.whistle?.(msg); return; }
  if (msg.t === 'presnap') { hooks.presnap?.(msg); return; }
  if (msg.t === 'recall') { hooks.recall?.(); return; }
}
function screenFor(phase) {
  // A friend who has not claimed a team stays in the lobby, where the open teams are.
  if (S.net?.mode === 'league' && S.net.yourTeam == null) return 'lobby';
  if (phase === 'draft') return 'draft';
  if (phase === 'grades') return 'grades';
  if (phase === 'season' || phase === 'playoffs' || phase === 'done' || phase === 'offseason') return 'season';
  if (phase === 'between' || phase === 'pre' || phase === 'live' || phase === 'final') return 'game';
  return 'lobby';
}
function route(phase) {
  if ((phase === 'pre' || phase === 'live') && S.screen === 'game') return;
  const next = screenFor(phase);
  if (S.screen !== next) {
    if (next === 'season' && S.game?.final) S.game = null;
    ui.setScreen(next);
  } else if (!(S.screen === 'game' && (phase === 'pre' || phase === 'live' || phase === 'between'))) ui.render();
}

// Follow a #play=CODE or #online=CODE already on the address.
export function joinFromHash() {
  try {
    const m = /#(play|online)=([A-Za-z0-9]+)/.exec(location.hash || '');
    if (m) join(m[2].toUpperCase());
  } catch { /* no location */ }
}
