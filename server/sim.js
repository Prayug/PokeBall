// Rooms for online play. The server is the only writer of the game and the live play.
// Quick matches live in memory. A league is the same object createLeague saves, plus who
// claimed which team, and it is written to disk so a restart does not forget the standings.
import fs from 'node:fs';
import path from 'node:path';
import { DEF_PLAYS, OFF_PLAYS, addLog, aiDefenseCall, aiOffenseCall, callTimeout, createGame, runLivePlay, runPlay, simUntil, snapClock } from '../src/engine.js';
import { clipJson } from '../src/film.js';
import { CALL_FRONT, PLAY_FORMATION, createLivePlay, playSeconds, snap, step } from '../src/live.js';
import { liveKick } from '../src/live/kicks.js';
import { audibles, cycleShade, flipRun, hotRoute, setDisguise, startMotion } from '../src/live/presnap.js';
import { advanceWeek, aiChoosePick, createLeague, currentPick, makePick, quickRosters, recordResult, startLeagueGame, teamForGame } from '../src/league.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_MS = 60_000;
const SNAP_MS = 8_000;
export const leagueDir = process.env.POKEBALL_LEAGUES || path.join(process.cwd(), 'data', 'leagues');

export const rooms = new Map();
let seq = 1;
const round = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const plain = (v) => JSON.parse(JSON.stringify(v));

function code() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return rooms.has(s) ? code() : s;
}
function token() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const c of room.clients) if (c.online && c.send) c.send(text);
}
function send(c, msg) { if (c?.online && c.send) c.send(JSON.stringify(msg)); }

function humanSide(room, side) {
  if (!room.g) return false;
  return !!clientOnSide(room, side);
}
function clientOnSide(room, side) {
  const id = room.seat[side];
  return id ? room.clients.find((c) => c.id === id && c.online) : null;
}
function sideOf(room, client) {
  if (room.seat[0] === client.id) return 0;
  if (room.seat[1] === client.id) return 1;
  return null;
}

// ---------- quick match ----------
export function createQuick(hostName) {
  const seed = Math.floor(Math.random() * 2 ** 31) || 1;
  const room = blank(code(), 'quick');
  room.seed = seed;
  room.hostName = hostName || 'Home';
  armQuick(room, seed);
  rooms.set(room.code, room);
  return room;
}
function armQuick(room, seed) {
  const L = quickRosters(seed, false);
  const g = createGame({ home: teamForGame(L.teams[0]), away: teamForGame(L.teams[1]), seed, liveKicks: true });
  g.manual = [true, true];
  g.liveKicks = true;
  room.g = g;
  room.phase = 'lobby';
  room.calls = {};
  room.ready = {};
  room.film = [];
}
export function rematch(room) {
  const seed = Math.floor(Math.random() * 2 ** 31) || 1;
  room.seed = seed;
  room.lp = null;
  room.paused = false;
  room.canForfeit = false;
  room.committed = false;
  for (const c of room.clients) c.ready = false;
  armQuick(room, seed);
  // The same two seats. They ready up again, then the new kickoff.
  publish(room);
}

// ---------- league ----------
export function createOnlineLeague(setup = {}) {
  const seed = Math.floor(Math.random() * 2 ** 31) || 1;
  const L = createLeague({
    teamName: setup.name || 'Pallet Starters', abbr: setup.abbr || 'PAL', rounds: setup.rounds === 28 ? 28 : 24,
    legendaries: !!setup.legendaries, typeCap: setup.typeCap !== false, numTeams: 8, seed, scheme: setup.scheme || 'balanced',
  });
  L.online = { host: 0, claims: { 0: setup.name || 'Commissioner' } };
  const room = blank(code(), 'league');
  room.claims[0] = 0;
  room.league = L;
  room.seed = seed;
  room.phase = 'draft';
  room.draftDeadline = Date.now() + (setup.clock === false ? 24 * 60 * 60 * 1000 : 60_000);
  rooms.set(room.code, room);
  saveLeague(room);
  drainAiPicks(room);
  return room;
}
export function saveLeague(room) {
  if (room.mode !== 'league' || !room.league) return;
  fs.mkdirSync(leagueDir, { recursive: true });
  fs.writeFileSync(path.join(leagueDir, `${room.code}.json`), JSON.stringify(room.league));
}
export function loadLeagues() {
  if (!fs.existsSync(leagueDir)) return;
  for (const name of fs.readdirSync(leagueDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const L = JSON.parse(fs.readFileSync(path.join(leagueDir, name), 'utf8'));
      if (!L?.teams || !L.online) continue;
      const room = blank(name.replace(/\.json$/, ''), 'league');
      room.league = L;
      room.phase = L.phase === 'draft' ? 'draft' : L.phase === 'grades' ? 'grades' : 'season';
      room.seed = L.seed;
      rooms.set(room.code, room);
    } catch { /* a bad file does not take the server down */ }
  }
}

function blank(codeName, mode) {
  return {
    code: codeName, mode, clients: [], seat: {}, claims: {}, phase: 'lobby',
    calls: {}, ready: {}, pad: {}, paused: false, canForfeit: false, pauseAt: 0,
    film: [], evSent: 0, committed: false, queue: [],
  };
}

export function addClient(room, name) {
  if (room.mode === 'quick' && room.seat[0] != null && room.seat[1] != null) return null;
  if (room.mode === 'league' && room.clients.filter((c) => c.online).length >= 8) return null;
  const client = { id: seq++, name: (name || 'Coach').slice(0, 22), token: token(), online: true, ready: false, team: null, seq: 0, send: null };
  room.clients.push(client);
  if (room.mode === 'quick') {
    if (room.seat[0] == null) room.seat[0] = client.id;
    else if (room.seat[1] == null) room.seat[1] = client.id;
  } else if (room.league) {
    // The commissioner is the first connection, team 0, unless that seat is already held.
    const host = room.clients.find((c) => c.team === 0 && c.online && c !== client);
    if (!host && !room.clients.some((c) => c !== client && c.team === 0)) {
      client.team = 0;
      room.claims[0] = client.id;
    }
  }
  return client;
}
export function resumeClient(room, tok) {
  const c = room.clients.find((x) => x.token === tok);
  if (!c) return null;
  c.online = true;
  room.paused = false;
  room.canForfeit = false;
  return c;
}
export function dropClient(room, client) {
  if (!client) return;
  client.online = false;
  client.ready = false;
  const playing = room.phase === 'live' || room.phase === 'between' || room.phase === 'pre';
  if (playing && (room.seat[0] === client.id || room.seat[1] === client.id)) {
    room.paused = true;
    room.pauseAt = Date.now();
    room.canForfeit = false;
  }
  publish(room);
}

export function claimTeam(room, client, teamId) {
  const L = room.league;
  if (!L || client.team != null) return;
  teamId = Number(teamId);
  const t = L.teams[teamId];
  if (!t || teamId === 0 || room.claims[teamId] != null) return;
  const held = L.online?.claims?.[teamId];
  if (held && held !== client.name) return;
  const taken = Object.keys(room.claims).length;
  if (taken >= 8) return;
  room.claims[teamId] = client.id;
  client.team = teamId;
  t.user = true;
  L.online.claims[teamId] = client.name;
  saveLeague(room);
  publish(room);
}

function drainAiPicks(room) {
  const L = room.league;
  if (!L || L.phase !== 'draft') return;
  let guard = 0;
  while (L.phase === 'draft' && guard++ < 400) {
    const pk = currentPick(L);
    if (!pk) break;
    if (room.claims[pk.team] != null) break;
    const c = aiChoosePick(L, pk.team);
    makePick(L, c.id, c.slot);
  }
  if (L.phase !== 'draft') room.phase = L.phase === 'grades' ? 'grades' : 'season';
  room.draftDeadline = Date.now() + 60_000;
  saveLeague(room);
}

function seatLeagueGame(room, homeId, awayId) {
  room.seat = {};
  const home = room.clients.find((c) => c.team === homeId);
  const away = room.clients.find((c) => c.team === awayId);
  if (home) room.seat[0] = home.id;
  if (away) room.seat[1] = away.id;
}

function played(L, gm, week, playoff) {
  return L.results.some((r) => r.home === gm.home && r.away === gm.away && (playoff ? r.playoff : r.week === week && !r.playoff));
}
function pending(room) {
  const L = room.league;
  if (!L) return [];
  if (L.phase === 'season') return (L.schedule[L.week] ?? []).filter((gm) => !played(L, gm, L.week, false));
  if (L.phase === 'playoffs') return (L.playoffs?.games ?? []).filter((gm) => !played(L, gm, L.playoffs.round, true));
  return [];
}
function claimed(room, teamId) { return room.claims[teamId] != null || teamId === 0 && room.mode === 'league'; }
function onlineTeam(room, teamId) {
  return room.clients.some((c) => c.online && c.team === teamId);
}

// AI against AI is decided here. A game with a claimed team waits for those players.
export function settleWeek(room) {
  const L = room.league;
  if (!L || (L.phase !== 'season' && L.phase !== 'playoffs')) return;
  const playoff = L.phase === 'playoffs';
  for (const gm of pending(room)) {
    if (claimed(room, gm.home) || claimed(room, gm.away)) continue;
    const g = startLeagueGame(L, gm.home, gm.away, playoff);
    simUntil(g, 'game');
    recordResult(L, g, playoff ? { playoff: true, round: L.playoffs.round } : { week: L.week });
  }
  saveLeague(room);
  if (!pending(room).length) advanceOnline(room);
}
function advanceOnline(room) {
  const L = room.league;
  if (L.phase === 'season') {
    advanceWeek(L);
    saveLeague(room);
    if (L.phase === 'season' || L.phase === 'playoffs') settleWeek(room);
  }
}
export function simWaiting(room, client) {
  if (!client || client.team !== 0) return;
  const L = room.league;
  const playoff = L?.phase === 'playoffs';
  const gm = pending(room).find((g) => {
    const humans = [g.home, g.away].filter((id) => claimed(room, id));
    return humans.length && humans.some((id) => !onlineTeam(room, id));
  });
  if (!gm) return;
  const g = startLeagueGame(L, gm.home, gm.away, playoff);
  simUntil(g, 'game');
  recordResult(L, g, playoff ? { playoff: true, round: L.playoffs.round } : { week: L.week });
  saveLeague(room);
  publish(room);
  if (!pending(room).length) advanceOnline(room);
  else publish(room);
}

function startLeagueLive(room, gm) {
  const L = room.league;
  const playoff = L.phase === 'playoffs';
  const g = startLeagueGame(L, gm.home, gm.away, playoff, true);
  const homeHuman = claimed(room, gm.home);
  const awayHuman = claimed(room, gm.away);
  g.manual = [homeHuman, awayHuman];
  g.liveKicks = true;
  room.g = g;
  room.meta = { playoff, week: L.week, home: gm.home, away: gm.away, userTeamId: gm.home };
  seatLeagueGame(room, gm.home, gm.away);
  room.calls = {};
  room.phase = 'between';
  room.lp = null;
  publish(room);
}

export function readyGame(room, client) {
  if (room.mode === 'quick') {
    client.ready = true;
    const a = clientOnSide(room, 0), b = clientOnSide(room, 1);
    if (a?.ready && b?.ready && room.phase === 'lobby') room.phase = 'between';
    publish(room);
    return;
  }
  const L = room.league;
  if (!L || client.team == null) return;
  const gm = pending(room).find((g) => g.home === client.team || g.away === client.team);
  if (!gm) { publish(room); return; }
  client.ready = true;
  const homeOn = !claimed(room, gm.home) || onlineTeam(room, gm.home);
  const awayOn = !claimed(room, gm.away) || onlineTeam(room, gm.away);
  const homeReady = !claimed(room, gm.home) || room.clients.some((c) => c.team === gm.home && c.ready && c.online);
  const awayReady = !claimed(room, gm.away) || room.clients.some((c) => c.team === gm.away && c.ready && c.online);
  if (homeOn && awayOn && homeReady && awayReady) startLeagueLive(room, gm);
  else publish(room);
}

// ---------- the live game ----------
function need(room) {
  const g = room.g;
  if (!g || g.final) return [];
  if (g.phase === 'penalty') return g.pending?.offended != null ? [g.pending.offended] : [];
  if (g.phase === 'kickoff' || g.phase === 'pat') return humanSide(room, g.poss) ? [g.poss] : [];
  const out = [];
  if (humanSide(room, g.poss)) out.push(g.poss);
  if (humanSide(room, 1 - g.poss)) out.push(1 - g.poss);
  return out;
}
function callsReady(room) {
  const g = room.g;
  if (!g || g.final || room.lp) return null;
  if (room.phase !== 'between' && room.phase !== 'lobby') return null;
  if (room.mode === 'quick' && room.phase === 'lobby') return null;
  const want = need(room);
  for (const s of want) if (!room.calls[s]) return null;
  const offSide = g.poss, defSide = 1 - offSide;
  let off, def, formation, flip, front;
  if (g.phase === 'penalty') {
    const s = g.pending.offended;
    off = humanSide(room, s) ? room.calls[s].call : (g.pending.aiAccept ? 'accept' : 'decline');
    def = 'base';
  } else if (g.phase === 'kickoff' || g.phase === 'pat') {
    off = humanSide(room, offSide) ? room.calls[offSide].call : aiOffenseCall(g);
    def = aiDefenseCall(g);
    formation = room.calls[offSide]?.formation;
  } else {
    off = humanSide(room, offSide) ? room.calls[offSide].call : aiOffenseCall(g);
    def = humanSide(room, defSide) ? room.calls[defSide].call : aiDefenseCall(g);
    formation = room.calls[offSide]?.formation;
    flip = !!room.calls[offSide]?.flip;
    front = room.calls[defSide]?.front;
  }
  if (!OFF_PLAYS[off] || !off) return null;
  return { off, def, formation: formation || PLAY_FORMATION[off] || 'gun_spread', flip, front: front || CALL_FRONT[def] || '43' };
}

function beginPlay(room, spec, clock = true) {
  const g = room.g;
  if (clock && !snapClock(g, null, spec.off)) {
    room.calls = {};
    publish(room);
    if (g.final) finishRoom(room);
    return;
  }
  const kind = OFF_PLAYS[spec.off].kind;
  if (clock && !(kind === 'run' || kind === 'pass' || liveKick(OFF_PLAYS[spec.off]))) {
    const entry = runPlay(g, spec.off, spec.def);
    room.calls = {};
    broadcast(room, { t: 'whistle', g: plain(g), entry, clip: null });
    if (g.final) finishRoom(room);
    else { room.phase = 'between'; publish(room); }
    return;
  }
  if (clock) room.g = plain(room.g);
  const snapG = plain(room.g);
  const both = humanSide(room, 0) && humanSide(room, 1);
  const only = humanSide(room, 0) ? 0 : humanSide(room, 1) ? 1 : null;
  const opts = {
    userSide: both ? 0 : only,
    user2: both ? 1 : undefined,
    formation: spec.formation,
    defFormation: spec.front,
    flip: spec.flip,
    flags: true,
  };
  const lp = createLivePlay(room.g, spec.off, spec.def, opts);
  room.lp = lp;
  room.off = spec.off;
  room.def = spec.def;
  room.opts = opts;
  room.phase = 'pre';
  room.evSent = 0;
  room.committed = false;
  room.pad = {};
  room.snapBy = Date.now() + SNAP_MS;
  room.rec = { off: spec.off, def: spec.def, log: [], atSnap: null, end: null };
  broadcast(room, { t: 'play', g: snapG, off: spec.off, def: spec.def, opts });
}

function packWho(p) {
  if (!p || p.id == null) return null;
  return { id: p.id, slot: p.slot, side: p.side, ti: p.ti, x: round(p.x), y: round(p.y), power: p.power || null };
}
function packSnap(room) {
  const lp = room.lp;
  if (!lp) return null;
  const events = lp.events.slice(room.evSent).map((e) => ({ kind: e.kind, text: e.text || '', fx: e.fx || null, who: packWho(e.who), other: packWho(e.other) }));
  room.evSent = lp.events.length;
  const holder = lp.ball?.holder;
  return {
    t: 'snap', n: room.evSent, phase: lp.phase, set: !!lp.set, simT: lp.t,
    ball: { state: lp.ball.state, x: round(lp.ball.x), y: round(lp.ball.y), z: round(lp.ball.z ?? 0), vx: round(lp.ball.vx), vy: round(lp.ball.vy), vz: round(lp.ball.vz), holder: holder ? `${holder.side}:${holder.slot}` : null },
    bodies: lp.players.map((p) => ({ side: p.side, slot: p.slot, x: round(p.x), y: round(p.y), vx: round(p.vx), vy: round(p.vy), fx: round(p.fx), fy: round(p.fy), act: p.act })),
    kick: lp.kick?.F ? { stage: lp.kick.stage, onside: !!lp.kick.onside, ko: !!lp.kick.ko, punt: !!lp.kick.punt, F: { tx: round(lp.kick.F.tx), ty: round(lp.kick.F.ty), T: lp.kick.F.T, t0: lp.kick.F.t0, sx: round(lp.kick.F.sx), sy: round(lp.kick.F.sy), z0: lp.kick.F.z0, zc: lp.kick.F.zc, vz: lp.kick.F.vz } } : (lp.kick ? { stage: lp.kick.stage, onside: !!lp.kick.onside, ko: !!lp.kick.ko, punt: !!lp.kick.punt } : null),
    thrown: lp.thrown ? { tx: round(lp.thrown.tx), ty: round(lp.thrown.ty), T: lp.thrown.T, t0: lp.thrown.t0, sx: round(lp.thrown.sx), sy: round(lp.thrown.sy), slot: lp.thrown.target?.slot ?? null } : null,
    ctrl: [room.lp.control ? `${room.lp.control.side}:${room.lp.control.slot}` : null, room.lp.p2?.control ? `${room.lp.p2.control.side}:${room.lp.p2.control.slot}` : null],
    events,
  };
}

function doSnap(room) {
  const lp = room.lp;
  if (!lp || lp.phase !== 'pre') return;
  const control = lp.control ? [lp.control.side, lp.control.slot] : null;
  room.rec?.log.push({ snap: true, control });
  if (room.rec) {
    try {
      room.rec.atSnap = structuredClone(lp);
      room.rec.atSnap.g.log = [];
      room.rec.atSnap.g.drives = [];
    } catch { room.rec.atSnap = null; }
  }
  snap(lp);
  room.phase = 'live';
}

function commit(room) {
  if (room.committed || !room.lp) return;
  room.committed = true;
  const lp = room.lp, g = room.g;
  const entry = runLivePlay(g, room.off, room.def, lp.result, playSeconds(lp));
  let clip = null;
  if (room.rec?.atSnap) {
    try { clip = clipJson(room.rec, { label: 'Online', text: entry?.text ?? '' }); room.film.push(clip); } catch { clip = null; }
  }
  broadcast(room, { t: 'whistle', g: plain(g), entry, clip });
  room.lp = null;
  room.calls = {};
  room.pad = {};
  if (g.final) finishRoom(room);
  else { room.phase = 'between'; publish(room); }
}
function finishRoom(room) {
  room.phase = 'final';
  if (room.mode === 'league' && room.league && room.g) {
    const L = room.league;
    const playoff = L.phase === 'playoffs';
    recordResult(L, room.g, playoff ? { playoff: true, round: L.playoffs.round } : { week: L.week });
    for (const c of room.clients) c.ready = false;
    saveLeague(room);
    if (!pending(room).length) advanceOnline(room);
  }
  publish(room);
}
function forfeit(room, client) {
  if (!room.canForfeit || !room.g || room.g.final) return;
  const side = sideOf(room, client);
  if (side == null) return;
  const g = room.g;
  if (g.score[side] <= g.score[1 - side]) g.score[side] = g.score[1 - side] + 1;
  addLog(g, { kind: 'final', text: `Forfeit. ${g.teams[side].name} take the win.` });
  g.final = true; g.phase = 'final'; g.winner = side;
  room.lp = null;
  room.paused = false;
  broadcast(room, { t: 'whistle', g: plain(g), entry: g.log[g.log.length - 1], clip: null });
  finishRoom(room);
}

export function stepRoom(room) {
  if (room.paused && room.pauseAt && Date.now() - room.pauseAt > RECONNECT_MS) room.canForfeit = true;
  if (room.mode === 'league' && room.league?.phase === 'draft') {
    const pk = currentPick(room.league);
    if (pk && room.claims[pk.team] != null && Date.now() > (room.draftDeadline || 0)) {
      const c = aiChoosePick(room.league, pk.team);
      makePick(room.league, c.id, c.slot);
      drainAiPicks(room);
      publish(room);
    }
  }
  const spec = callsReady(room);
  if (spec) beginPlay(room, spec);
  const lp = room.lp;
  if (!lp || room.paused) return;
  if (lp.phase === 'pre' && lp.set && Date.now() > (room.snapBy || 0)) doSnap(room);
  if (lp.phase === 'dead') { commit(room); return; }
  if (room.phase === 'pre' || lp.phase === 'pre') { step(lp, null); return; }
  const both = humanSide(room, 0) && humanSide(room, 1);
  const pad0 = room.pad[0] || null, pad1 = room.pad[1] || null;
  const inp = both ? { ...(pad0 || {}), p2: pad1 } : (humanSide(room, 0) ? pad0 : pad1);
  step(lp, inp);
  if (room.rec && lp.phase === 'live') room.rec.log.push(inp ?? null);
  if (lp.phase === 'dead') commit(room);
}
export function snapRoom(room) {
  if (!room.lp || room.paused) return null;
  if (room._tick == null) room._tick = 0;
  room._tick++;
  if (room._tick % 3 !== 0 && room.lp.phase !== 'dead') return null;
  return packSnap(room);
}

function publish(room) {
  const clock = Math.max(0, Math.ceil(((room.draftDeadline || 0) - Date.now()) / 1000));
  for (const c of room.clients) if (c.online) {
    send(c, { t: 'state', ...publicState(room, c) });
    if (room.league) send(c, { t: 'league', league: viewLeague(room, c), clock });
  }
  if (room.g && room.phase !== 'live' && room.phase !== 'pre') broadcast(room, { t: 'game', g: plain(room.g), meta: room.meta ?? null, phase: room.phase });
}
function viewLeague(room, client) {
  const L = plain(room.league);
  for (const t of L.teams) t.user = t.id === client.team;
  return L;
}
export function publicState(room, client) {
  const you = client ? sideOf(room, client) : null;
  return {
    code: room.code, mode: room.mode, phase: room.phase, you, yourTeam: client?.team ?? null,
    players: room.clients.filter((c) => c.online || room.seat[0] === c.id || room.seat[1] === c.id).map((c) => ({
      id: c.id, name: c.name, side: sideOf(room, c), team: c.team, ready: !!c.ready, online: !!c.online,
    })),
    seats: { ...room.seat },
    claims: room.league?.online?.claims ?? {},
    need: room.g ? need(room) : [],
    paused: !!room.paused,
    canForfeit: !!room.canForfeit && !!client && sideOf(room, client) != null,
    canSim: !!client && client.team === 0 && !!pending(room).some((g) => [g.home, g.away].filter((id) => claimed(room, id)).some((id) => !onlineTeam(room, id))),
    reconnectMs: room.paused ? Math.max(0, RECONNECT_MS - (Date.now() - room.pauseAt)) : 0,
    seed: room.seed,
    waiting: room.mode === 'league' && pending(room).some((g) => (g.home === client?.team || g.away === client?.team) && [g.home, g.away].filter((id) => claimed(room, id)).some((id) => !onlineTeam(room, id))),
  };
}

export function onMessage(room, client, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'ping') { send(client, { t: 'pong', n: msg.n }); return; }
  if (msg.t === 'ready' || msg.t === 'readygame') { readyGame(room, client); return; }
  if (msg.t === 'claim') { claimTeam(room, client, msg.team); return; }
  if (msg.t === 'rematch' && room.mode === 'quick' && room.phase === 'final') { rematch(room); return; }
  if (msg.t === 'forfeit') { forfeit(room, client); return; }
  if (msg.t === 'sim') { simWaiting(room, client); return; }
  if (msg.t === 'startseason' && room.league?.phase === 'grades' && client.team === 0) {
    room.league.phase = 'season';
    room.phase = 'season';
    settleWeek(room);
    saveLeague(room);
    publish(room);
    return;
  }
  if (msg.t === 'pick' || msg.t === 'autopick') {
    const L = room.league;
    const pk = L && currentPick(L);
    if (!pk || pk.team !== client.team) return;
    const choice = msg.t === 'autopick' ? aiChoosePick(L, pk.team) : { id: Number(msg.id), slot: msg.slot || null };
    if (choice?.id == null) return;
    makePick(L, choice.id, choice.slot && choice.slot !== 'BENCH' ? choice.slot : null);
    drainAiPicks(room);
    publish(room);
    return;
  }
  if (msg.t === 'timeout') {
    const s = sideOf(room, client);
    if (s != null && room.g && !room.lp) callTimeout(room.g, s);
    publish(room);
    return;
  }
  if (msg.t === 'call') {
    const s = sideOf(room, client);
    if (s == null || !room.g || room.lp) return;
    if (!need(room).includes(s)) return;
    const g = room.g;
    const offense = g.phase === 'penalty' ? g.pending?.offended === s : g.poss === s;
    if (offense ? !OFF_PLAYS[msg.call] : !DEF_PLAYS[msg.call]) return;
    if (g.phase === 'penalty' && OFF_PLAYS[msg.call]?.kind !== 'penalty') return;
    room.calls[s] = { call: msg.call, formation: msg.formation || null, flip: !!msg.flip, front: msg.front || null };
    publish(room);
    return;
  }
  if (msg.t === 'snap') { doSnap(room); return; }
  if (msg.t === 'presnap') { applyPresnap(room, client, msg); return; }
  if (msg.t === 'input') {
    const s = sideOf(room, client);
    if (s == null) return;
    if (msg.seq != null && msg.seq < client.seq) return;
    client.seq = msg.seq ?? client.seq;
    room.pad[s] = {
      mx: Number(msg.mx) || 0, my: Number(msg.my) || 0, sprint: !!msg.sprint,
      juke: !!msg.juke, dive: !!msg.dive, truck: !!msg.truck, spin: !!msg.spin,
      throwTo: msg.throwTo || null, throwType: msg.throwType || null, throwAway: !!msg.throwAway,
      switchTo: msg.switchTo || null,
    };
  }
}
function applyPresnap(room, client, msg) {
  const lp = room.lp;
  const s = sideOf(room, client);
  if (!lp || lp.phase !== 'pre' || s == null) return;
  const mine = s === lp.o;
  if (msg.act === 'aud' && mine && audibles(lp, msg.arg).includes(msg.arg)) {
    beginPlay(room, { off: msg.arg, def: room.def, formation: lp.formation, front: lp.defFormation, flip: false }, false);
    return;
  }
  if (msg.act === 'hot' && mine) hotRoute(lp, msg.slot, msg.arg);
  else if (msg.act === 'motion' && mine) startMotion(lp, msg.arg);
  else if (msg.act === 'flip' && mine) flipRun(lp);
  else if (msg.act === 'shade' && !mine) cycleShade(lp);
  else if (msg.act === 'show' && !mine) setDisguise(lp, 'show');
  else if (msg.act === 'back' && !mine) setDisguise(lp, 'back');
  broadcast(room, { t: 'presnap', act: msg.act, arg: msg.arg, slot: msg.slot, side: s });
}

export function hello(room, client) {
  send(client, { t: 'hello', token: client.token, code: room.code, mode: room.mode, ...publicState(room, client) });
  publish(room);
}
