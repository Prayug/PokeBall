// Rooms for online play. The server is the only writer of the game and the live play.
// A quick match is one room with one game in it. An online league is a room that holds the
// league (the same object createLeague saves) and a table for each game being played in it, so
// two pairs of friends can play their games in the same week at once. The league, who owns
// which team and each owner's seat token are written to disk, so a restart does not forget
// the standings or lock anyone out of their team.
import fs from 'node:fs';
import path from 'node:path';
import { DEF_PLAYS, OFF_PLAYS, addLog, aiDefenseCall, aiOffenseCall, callTimeout, createGame, runLivePlay, runPlay, simUntil, snapClock } from '../src/engine.js';
import { clipJson } from '../src/film.js';
import { CALL_FRONT, DT, PLAY_FORMATION, createLivePlay, hurry, playSeconds, snap, step } from '../src/live.js';
import { liveKick } from '../src/live/kicks.js';
import { audibles, cycleShade, flipRun, hotRoute, setDisguise, startMotion } from '../src/live/presnap.js';
import { advancePlayoffs, advanceWeek, aiChoosePick, available, blockReason, createLeague, currentPick, makePick, openSlots, quickRosters, recordResult, startLeagueGame, teamForGame } from '../src/league.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECONNECT_MS = Number(process.env.POKEBALL_RECONNECT_MS) || 60_000;
// The play clock once the offense is set: a person gets time to read the defense and adjust,
// the AI snaps about as quickly as it does offline.
const SNAP_MS = 25_000;
const AI_SNAP_MS = 1_600;
const PICK_MS = 60_000;
const SNAP_EVERY_MS = 45;
// A quick room nobody is in is closed after this long (a finished one sooner).
const EMPTY_ROOM_MS = 15 * 60_000;
const MAX_ROOMS = 400;
export const leagueDir = process.env.POKEBALL_LEAGUES || path.join(process.cwd(), 'data', 'leagues');

export const rooms = new Map();
let seq = 1;
const round = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const plain = (v) => JSON.parse(JSON.stringify(v));
const has = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
const LIVE = new Set(['between', 'pre', 'live']);

function code() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    if (!rooms.has(s) && !fs.existsSync(path.join(leagueDir, `${s}.json`))) return s;
  }
}
function token() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
export function roomCount() { return rooms.size; }
export function canOpenRoom() { return rooms.size < MAX_ROOMS; }

// ---------- tables ----------
// A quick room is its own table. A league room keeps one table per game being played.
export function tablesOf(room) { return room.mode === 'quick' ? [room] : [...room.tables.values()]; }
function tableFor(room, client) {
  if (!client) return null;
  if (room.mode === 'quick') return room;
  for (const t of room.tables.values()) if (t.seat[0] === client.id || t.seat[1] === client.id) return t;
  return null;
}
// Who hears a table's game: everyone in a quick room, the two seats at a league table.
function audience(t) {
  return t.parent ? t.clients.filter((c) => c.id === t.seat[0] || c.id === t.seat[1]) : t.clients;
}
export function broadcast(t, msg) {
  const text = JSON.stringify(msg);
  for (const c of audience(t)) if (c.online && c.send) c.send(text);
}
function send(c, msg) { if (c?.online && c.send) c.send(JSON.stringify(msg)); }

// A seat holds a person for the whole game, online or not. An empty seat is the AI.
function humanSide(t, side) { return !!t.g && t.seat[side] != null; }
function clientOnSide(t, side) {
  const id = t.seat[side];
  return id != null ? t.clients.find((c) => c.id === id) ?? null : null;
}
function sideOf(t, client) {
  if (!t || !client) return null;
  if (t.seat[0] === client.id) return 0;
  if (t.seat[1] === client.id) return 1;
  return null;
}
function gameFields(t) {
  Object.assign(t, {
    calls: {}, pad: {}, lp: null, paused: false, canForfeit: false, pauseAt: 0,
    film: [], evSent: 0, committed: false, snapWant: false, playMsg: null, acc: 0, lastStep: 0, lastSnapSent: 0,
  });
  return t;
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
  gameFields(room);
}
export function rematch(room) {
  const seed = Math.floor(Math.random() * 2 ** 31) || 1;
  room.seed = seed;
  for (const c of room.clients) c.ready = false;
  armQuick(room, seed);
  // The same two seats. They ready up again, then the new kickoff.
  publish(room);
}

// ---------- league ----------
export function createOnlineLeague(setup = {}) {
  const seed = Math.floor(Math.random() * 2 ** 31) || 1;
  const L = createLeague({
    teamName: String(setup.name || 'Pallet Starters').slice(0, 30), abbr: String(setup.abbr || 'PAL').slice(0, 4), rounds: setup.rounds === 28 ? 28 : 24,
    legendaries: !!setup.legendaries, typeCap: setup.typeCap !== false, numTeams: 8, seed, scheme: setup.scheme || 'balanced',
  });
  L.online = { host: 0, claims: {}, tokens: {}, pickMs: setup.clock === false ? 24 * 60 * 60 * 1000 : PICK_MS };
  const room = blank(code(), 'league');
  room.league = L;
  room.seed = seed;
  rooms.set(room.code, room);
  // The commissioner's team waits for the first connection (index.js adds it right after).
  room.claims[0] = 'host';
  room.draftDeadline = Date.now() + L.online.pickMs;
  drainAiPicks(room);
  return room;
}
export function saveLeague(room) {
  if (room.mode !== 'league' || !room.league) return;
  try {
    fs.mkdirSync(leagueDir, { recursive: true });
    const file = path.join(leagueDir, `${room.code}.json`);
    // Write then rename, so a crash halfway through never leaves half a league on disk.
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(room.league));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error(`could not save league ${room.code}:`, err?.message || err);
  }
}
export function saveAll() { for (const room of rooms.values()) saveLeague(room); }
export function loadLeagues() {
  if (!fs.existsSync(leagueDir)) return;
  for (const name of fs.readdirSync(leagueDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const L = JSON.parse(fs.readFileSync(path.join(leagueDir, name), 'utf8'));
      if (!L?.teams || !L.online) continue;
      L.online.claims ??= {};
      L.online.tokens ??= {};
      L.online.pickMs ??= PICK_MS;
      const room = blank(name.replace(/\.json$/, ''), 'league');
      room.league = L;
      room.seed = L.seed;
      // Owned teams stay owned. The owner comes back with the token saved in their browser.
      for (const k of Object.keys(L.online.claims)) room.claims[k] = 'saved';
      room.claims[0] ??= 'saved';
      room.draftDeadline = Date.now() + L.online.pickMs;
      rooms.set(room.code, room);
    } catch (err) {
      console.error(`skipped league file ${name}:`, err?.message || err);
    }
  }
}

function blank(codeName, mode) {
  const room = { code: codeName, mode, clients: [], seat: {}, claims: {}, phase: 'lobby', tables: new Map(), emptyAt: Date.now() };
  return mode === 'quick' ? gameFields(room) : room;
}

export function addClient(room, name) {
  const online = room.clients.filter((c) => c.online);
  // A quick room has two seats. Someone who left without their token (another browser) can
  // take their empty seat back by joining with the code.
  const open = room.mode === 'quick' ? [0, 1].find((s) => room.seat[s] == null || !clientOnSide(room, s)?.online) : null;
  if (room.mode === 'quick' && open == null) return null;
  if (room.mode === 'league' && online.length >= 16) return null;
  const client = { id: seq++, name: String(name || 'Coach').slice(0, 22), token: token(), online: true, ready: false, team: null, seq: 0, send: null };
  if (room.mode === 'quick') {
    const old = clientOnSide(room, open);
    if (old) { old.token = null; old.ready = false; }
    room.seat[open] = client.id;
  } else if (room.league && !room.league.online.tokens[0]) {
    // The first connection to a new league is the commissioner, team 0.
    giveTeam(room, client, 0);
  }
  // Drop people who left and hold nothing, so the list does not grow forever. (In place: the
  // league's tables share this array.)
  const keep = room.clients.filter((c) => c.online || c.team != null || room.seat[0] === c.id || room.seat[1] === c.id);
  room.clients.splice(0, room.clients.length, ...keep, client);
  return client;
}
function giveTeam(room, client, teamId) {
  const L = room.league;
  room.claims[teamId] = client.id;
  client.team = teamId;
  L.teams[teamId].user = true;
  L.online.claims[teamId] = client.name;
  L.online.tokens[teamId] = client.token;
  saveLeague(room);
}
export function resumeClient(room, tok) {
  if (typeof tok !== 'string' || !tok) return null;
  let c = room.clients.find((x) => x.token && x.token === tok);
  if (!c && room.league) {
    // After a restart: the token saved with the league brings its owner back to the team.
    const team = Object.keys(room.league.online.tokens).find((k) => room.league.online.tokens[k] === tok);
    if (team == null) return null;
    c = { id: seq++, name: room.league.online.claims[team] || 'Coach', token: tok, online: true, ready: false, team: Number(team), seq: 0, send: null };
    room.clients.push(c);
    room.claims[team] = c.id;
  }
  if (!c) return null;
  c.online = true;
  c.seq = 0;
  return c;
}
export function dropClient(room, client) {
  if (!client) return;
  client.online = false;
  client.ready = false;
  client.send = null;
  for (const t of tablesOf(room)) checkPause(t);
  publish(room);
}
// A game in progress stops while a seat is empty, and the other side may take the forfeit
// once the reconnect window runs out.
function checkPause(t) {
  const playing = LIVE.has(t.phase) && t.g && !t.g.final;
  const gone = [0, 1].some((s) => t.seat[s] != null && !clientOnSide(t, s)?.online);
  if (playing && gone) {
    if (!t.paused) { t.paused = true; t.pauseAt = Date.now(); t.canForfeit = false; }
  } else {
    t.paused = false;
    t.canForfeit = false;
  }
}

export function claimTeam(room, client, teamId) {
  const L = room.league;
  if (!L || client.team != null) return;
  teamId = Number(teamId);
  if (!Number.isInteger(teamId) || !L.teams[teamId]) return;
  const held = L.online.claims[teamId];
  if (room.claims[teamId] != null) {
    // A team whose owner lost their token (a new browser) goes back to them by name, while
    // nobody holds it right now.
    const holder = room.clients.find((c) => c.team === teamId && c.online);
    if (!held || held !== client.name || holder) return;
    for (const c of room.clients) if (c.team === teamId) c.team = null;
  }
  giveTeam(room, client, teamId);
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
    if (!c) break;
    makePick(L, c.id, c.slot);
  }
  room.draftDeadline = Date.now() + (L.online?.pickMs ?? PICK_MS);
  saveLeague(room);
}
function leaguePhase(room) {
  const p = room.league?.phase;
  return p === 'draft' || p === 'grades' || p === 'playoffs' || p === 'done' ? p : 'season';
}
function validPick(L, team, id, slot) {
  if (!Number.isInteger(id) || !available(L).includes(id) || blockReason(L, team, id)) return null;
  if (slot == null || slot === 'BENCH') return { id, slot: slot === 'BENCH' ? 'BENCH' : null };
  return openSlots(team).includes(slot) ? { id, slot } : { id, slot: null };
}

function played(L, gm, week, playoff) {
  return L.results.some((r) => r.home === gm.home && r.away === gm.away && (playoff ? r.playoff && r.round === L.playoffs.round : r.week === week && !r.playoff));
}
function pending(room) {
  const L = room.league;
  if (!L) return [];
  if (L.phase === 'season') return (L.schedule[L.week] ?? []).filter((gm) => !played(L, gm, L.week, false));
  if (L.phase === 'playoffs') return (L.playoffs?.games ?? []).filter((gm) => !played(L, gm, L.playoffs.round, true));
  return [];
}
const gameKey = (gm) => `${gm.home}-${gm.away}`;
function atTable(room, gm) { return room.mode === 'league' && room.tables.has(gameKey(gm)); }
function claimed(room, teamId) { return room.claims[teamId] != null; }
function onlineTeam(room, teamId) { return room.clients.some((c) => c.online && c.team === teamId); }
// A game with a person on it whose owner is not here: the commissioner may sim it.
function simmable(room) {
  return pending(room).filter((g) => !atTable(room, g) && [g.home, g.away].some((id) => claimed(room, id) && !onlineTeam(room, id)));
}

// AI against AI is decided here. A game with a claimed team waits for those players.
export function settleWeek(room) {
  const L = room.league;
  if (!L || (L.phase !== 'season' && L.phase !== 'playoffs')) return;
  const playoff = L.phase === 'playoffs';
  for (const gm of pending(room)) {
    if (claimed(room, gm.home) || claimed(room, gm.away) || atTable(room, gm)) continue;
    simGame(room, gm, playoff);
  }
  saveLeague(room);
  if (!pending(room).length) advanceOnline(room);
}
function simGame(room, gm, playoff) {
  const L = room.league;
  const g = startLeagueGame(L, gm.home, gm.away, playoff);
  simUntil(g, 'game');
  recordResult(L, g, playoff ? { playoff: true, round: L.playoffs.round } : { week: L.week });
}
// Every game this week or round is in: on to the next one, and settle its AI games.
function advanceOnline(room) {
  const L = room.league;
  if (pending(room).length || room.tables.size) return;
  if (L.phase === 'season') advanceWeek(L);
  else if (L.phase === 'playoffs') advancePlayoffs(L);
  else return;
  for (const c of room.clients) c.ready = false;
  saveLeague(room);
  if (L.phase === 'season' || L.phase === 'playoffs') settleWeek(room);
}
export function simWaiting(room, client) {
  if (!client || client.team !== 0 || !room.league) return;
  const gm = simmable(room)[0];
  if (!gm) return;
  simGame(room, gm, room.league.phase === 'playoffs');
  saveLeague(room);
  if (!pending(room).length) advanceOnline(room);
  publish(room);
}

function startLeagueLive(room, gm) {
  const L = room.league;
  const playoff = L.phase === 'playoffs';
  const g = startLeagueGame(L, gm.home, gm.away, playoff, true);
  const t = gameFields({
    parent: room, code: room.code, mode: 'league', league: L, clients: room.clients, key: gameKey(gm), gm,
    seat: {}, phase: 'between', g,
  });
  const home = room.clients.find((c) => c.team === gm.home && c.online);
  const away = room.clients.find((c) => c.team === gm.away && c.online);
  if (home) t.seat[0] = home.id;
  if (away) t.seat[1] = away.id;
  g.manual = [!!home, !!away];
  g.liveKicks = true;
  t.meta = { playoff, week: L.week, round: playoff ? L.playoffs.round : null, home: gm.home, away: gm.away };
  for (const c of [home, away]) if (c) c.ready = false;
  room.tables.set(t.key, t);
  publish(room);
}

export function readyGame(room, client) {
  if (room.mode === 'quick') {
    if (sideOf(room, client) == null) return;
    client.ready = true;
    const a = clientOnSide(room, 0), b = clientOnSide(room, 1);
    if (a?.ready && a.online && b?.ready && b.online && room.phase === 'lobby') {
      room.phase = 'between';
      a.ready = false; b.ready = false;
    }
    publish(room);
    return;
  }
  const L = room.league;
  if (!L || client.team == null || tableFor(room, client)) { publish(room); return; }
  const gm = pending(room).find((g) => (g.home === client.team || g.away === client.team) && !atTable(room, g));
  if (!gm) { publish(room); return; }
  client.ready = true;
  const sideReady = (id) => !claimed(room, id) || room.clients.some((c) => c.team === id && c.ready && c.online);
  if (sideReady(gm.home) && sideReady(gm.away)) startLeagueLive(room, gm);
  else publish(room);
}

// ---------- the live game ----------
function need(t) {
  const g = t.g;
  if (!g || g.final) return [];
  if (g.phase === 'penalty') return g.pending?.offended != null && humanSide(t, g.pending.offended) ? [g.pending.offended] : [];
  if (g.phase === 'kickoff' || g.phase === 'pat') return humanSide(t, g.poss) ? [g.poss] : [];
  const out = [];
  if (humanSide(t, g.poss)) out.push(g.poss);
  if (humanSide(t, 1 - g.poss)) out.push(1 - g.poss);
  return out;
}
function callsReady(t) {
  const g = t.g;
  if (!g || g.final || t.lp || t.phase !== 'between') return null;
  const want = need(t);
  for (const s of want) if (!t.calls[s]) return null;
  const offSide = g.poss, defSide = 1 - offSide;
  let off, def, formation, flip, front;
  if (g.phase === 'penalty') {
    const s = g.pending.offended;
    off = humanSide(t, s) ? t.calls[s].call : (g.pending.aiAccept ? 'accept' : 'decline');
    def = 'base';
  } else if (g.phase === 'kickoff' || g.phase === 'pat') {
    off = humanSide(t, offSide) ? t.calls[offSide].call : aiOffenseCall(g);
    def = aiDefenseCall(g);
    formation = t.calls[offSide]?.formation;
  } else {
    off = humanSide(t, offSide) ? t.calls[offSide].call : aiOffenseCall(g);
    def = humanSide(t, defSide) ? t.calls[defSide].call : aiDefenseCall(g);
    formation = t.calls[offSide]?.formation;
    flip = !!t.calls[offSide]?.flip;
    front = t.calls[defSide]?.front;
  }
  if (!has(OFF_PLAYS, off) || !has(DEF_PLAYS, def)) { t.calls = {}; return null; }
  return { off, def, formation: formation || PLAY_FORMATION[off] || 'gun_spread', flip, front: front || CALL_FRONT[def] || '43' };
}

function beginPlay(t, spec, clock = true) {
  const g = t.g;
  if (clock && !snapClock(g, null, spec.off)) {
    t.calls = {};
    if (g.final) finishTable(t);
    else publish(rootOf(t));
    return;
  }
  const kind = OFF_PLAYS[spec.off].kind;
  if (clock && !(kind === 'run' || kind === 'pass' || liveKick(OFF_PLAYS[spec.off]))) {
    const entry = runPlay(g, spec.off, spec.def);
    t.calls = {};
    broadcast(t, { t: 'whistle', g: plain(g), entry, clip: null });
    if (g.final) finishTable(t);
    else { t.phase = 'between'; publish(rootOf(t)); }
    return;
  }
  if (clock) t.g = plain(t.g);
  const snapG = plain(t.g);
  const both = humanSide(t, 0) && humanSide(t, 1);
  const only = humanSide(t, 0) ? 0 : humanSide(t, 1) ? 1 : null;
  const opts = { userSide: both ? 0 : only, user2: both ? 1 : undefined, formation: spec.formation, defFormation: spec.front, flip: spec.flip, flags: true };
  const lp = createLivePlay(t.g, spec.off, spec.def, opts);
  Object.assign(t, {
    lp, off: spec.off, def: spec.def, opts, phase: 'pre', evSent: 0, committed: false, pad: {}, snapWant: false,
    setAt: 0, acc: 0, lastStep: Date.now(), lastSnapSent: 0,
    rec: { off: spec.off, def: spec.def, log: [], atSnap: null, end: null },
  });
  t.playMsg = { t: 'play', g: snapG, off: spec.off, def: spec.def, opts };
  broadcast(t, t.playMsg);
  publish(rootOf(t));
}

function packWho(p) {
  if (!p || p.id == null) return null;
  return { id: p.id, slot: p.slot, side: p.side, ti: p.ti, x: round(p.x), y: round(p.y), power: p.power || null };
}
function packSnap(t, all = false) {
  const lp = t.lp;
  if (!lp) return null;
  const from = all ? 0 : t.evSent;
  const events = lp.events.slice(from).map((e) => ({ kind: e.kind, text: e.text || '', fx: e.fx || null, who: packWho(e.who), other: packWho(e.other) }));
  if (!all) t.evSent = lp.events.length;
  const holder = lp.ball?.holder;
  return {
    t: 'snap', n: lp.events.length, phase: lp.phase, set: !!lp.set, simT: lp.t,
    ball: { state: lp.ball.state, x: round(lp.ball.x), y: round(lp.ball.y), z: round(lp.ball.z ?? 0), vx: round(lp.ball.vx), vy: round(lp.ball.vy), vz: round(lp.ball.vz), holder: holder ? `${holder.side}:${holder.slot}` : null },
    bodies: lp.players.map((p) => ({ side: p.side, slot: p.slot, x: round(p.x), y: round(p.y), vx: round(p.vx), vy: round(p.vy), fx: round(p.fx), fy: round(p.fy), act: p.act })),
    kick: lp.kick?.F ? { stage: lp.kick.stage, onside: !!lp.kick.onside, ko: !!lp.kick.ko, punt: !!lp.kick.punt, F: { tx: round(lp.kick.F.tx), ty: round(lp.kick.F.ty), T: lp.kick.F.T, t0: lp.kick.F.t0, sx: round(lp.kick.F.sx), sy: round(lp.kick.F.sy), z0: lp.kick.F.z0, zc: lp.kick.F.zc, vz: lp.kick.F.vz } } : (lp.kick ? { stage: lp.kick.stage, onside: !!lp.kick.onside, ko: !!lp.kick.ko, punt: !!lp.kick.punt } : null),
    thrown: lp.thrown ? { tx: round(lp.thrown.tx), ty: round(lp.thrown.ty), T: lp.thrown.T, t0: lp.thrown.t0, sx: round(lp.thrown.sx), sy: round(lp.thrown.sy), slot: lp.thrown.target?.slot ?? null } : null,
    ctrl: [lp.control ? `${lp.control.side}:${lp.control.slot}` : null, lp.p2?.control ? `${lp.p2.control.side}:${lp.p2.control.slot}` : null],
    events,
  };
}

// The offense snaps once everyone is set. A press while the line is still walking up hurries it
// and snaps the moment it is set.
function doSnap(t) {
  const lp = t.lp;
  if (!lp || lp.phase !== 'pre') return;
  if (!lp.set) { hurry(lp); t.snapWant = true; return; }
  t.snapWant = false;
  const control = lp.control ? [lp.control.side, lp.control.slot] : null;
  t.rec?.log.push({ snap: true, control });
  if (t.rec) {
    try {
      t.rec.atSnap = structuredClone(lp);
      t.rec.atSnap.g.log = [];
      t.rec.atSnap.g.drives = [];
    } catch { t.rec.atSnap = null; }
  }
  snap(lp);
  t.phase = 'live';
}

function commit(t) {
  if (t.committed || !t.lp) return;
  t.committed = true;
  const lp = t.lp, g = t.g;
  const entry = runLivePlay(g, t.off, t.def, lp.result, playSeconds(lp));
  let clip = null;
  if (t.rec?.atSnap) {
    try { clip = clipJson(t.rec, { label: 'Online', text: entry?.text ?? '' }); t.film.push(clip); if (t.film.length > 40) t.film.shift(); } catch { clip = null; }
  }
  const last = packSnap(t);
  if (last) broadcast(t, last);
  broadcast(t, { t: 'whistle', g: plain(g), entry, clip });
  t.lp = null;
  t.playMsg = null;
  t.calls = {};
  t.pad = {};
  if (g.final) finishTable(t);
  else { t.phase = 'between'; publish(rootOf(t)); }
}
const rootOf = (t) => t.parent || t;
function finishTable(t) {
  t.phase = 'final';
  t.lp = null;
  t.playMsg = null;
  t.paused = false;
  t.canForfeit = false;
  const room = rootOf(t);
  if (t.parent) {
    const L = room.league;
    const m = t.meta;
    recordResult(L, t.g, m.playoff ? { playoff: true, round: m.round } : { week: m.week });
    // The final goes to the two seats; then the table closes and they are back in the league.
    broadcast(t, { t: 'game', g: plain(t.g), meta: m, phase: 'final' });
    room.tables.delete(t.key);
    saveLeague(room);
    if (!pending(room).length) advanceOnline(room);
  }
  publish(room);
}
function forfeit(t, client) {
  if (!t.canForfeit || !t.g || t.g.final) return;
  const side = sideOf(t, client);
  if (side == null || !client.online) return;
  const g = t.g;
  if (g.score[side] <= g.score[1 - side]) g.score[side] = g.score[1 - side] + 1;
  addLog(g, { kind: 'final', text: `Forfeit. ${g.teams[side].name} take the win.` });
  g.final = true; g.phase = 'final'; g.winner = side;
  t.lp = null;
  broadcast(t, { t: 'whistle', g: plain(g), entry: g.log[g.log.length - 1], clip: null });
  finishTable(t);
}

function stepTable(t, now) {
  if (t.paused) {
    if (!t.canForfeit && now - t.pauseAt > RECONNECT_MS) { t.canForfeit = true; publish(rootOf(t)); }
    t.lastStep = now;
    return;
  }
  // A game that ended some other way (a sim, a forfeit) closes once.
  if (t.g?.final && LIVE.has(t.phase) && !t.lp) { finishTable(t); return; }
  const spec = callsReady(t);
  if (spec) beginPlay(t, spec);
  const lp = t.lp;
  if (!lp) return;
  // Step the play on the wall clock, so it runs at the same speed however the timer fires.
  t.acc = Math.min(t.acc + (now - (t.lastStep || now)) / 1000, DT * 6);
  t.lastStep = now;
  while (t.acc >= DT && t.lp === lp && !t.committed) {
    t.acc -= DT;
    if (lp.phase === 'pre') {
      if (lp.set && !t.setAt) t.setAt = now;
      if (lp.set && (t.snapWant || now - t.setAt > (humanSide(t, lp.o) ? SNAP_MS : AI_SNAP_MS))) { doSnap(t); continue; }
      step(lp, null);
      continue;
    }
    if (lp.phase === 'dead') { commit(t); break; }
    const both = humanSide(t, 0) && humanSide(t, 1);
    const pad0 = t.pad[0] || null, pad1 = t.pad[1] || null;
    const inp = both ? { ...(pad0 || {}), p2: pad1 } : (humanSide(t, 0) ? pad0 : pad1);
    step(lp, inp);
    if (t.rec && lp.phase === 'live') t.rec.log.push(inp ?? null);
    // One-shot buttons count once.
    for (const p of [pad0, pad1]) if (p) { p.juke = p.dive = p.truck = p.spin = p.throwAway = false; p.throwTo = p.throwType = p.switchTo = null; }
    if (lp.phase === 'dead') { commit(t); break; }
  }
  if (t.lp === lp && !t.committed && now - t.lastSnapSent >= SNAP_EVERY_MS) {
    t.lastSnapSent = now;
    const s = packSnap(t);
    if (s) broadcast(t, s);
  }
}

// One server tick for a room: the draft clock, then every game in it. A game that throws is
// stopped and sent back to the call sheet, so one bad play never takes the server down.
export function tick(room, now = Date.now()) {
  if (room.mode === 'league' && room.league?.phase === 'draft') {
    const pk = currentPick(room.league);
    if (pk && room.claims[pk.team] != null && now > (room.draftDeadline || 0)) {
      const c = aiChoosePick(room.league, pk.team);
      if (c) makePick(room.league, c.id, c.slot);
      drainAiPicks(room);
      publish(room);
    }
  }
  for (const t of tablesOf(room)) {
    try { stepTable(t, now); } catch (err) {
      console.error(`room ${room.code}: play stopped:`, err?.stack || err);
      t.lp = null; t.playMsg = null; t.calls = {}; t.pad = {};
      if (LIVE.has(t.phase)) t.phase = 'between';
      broadcast(t, { t: 'err', text: 'That play hit a server error and was called back. Pick a play again.' });
      publish(room);
    }
  }
}
// A quick room nobody has been in for a while is closed. Leagues stay; they live on disk.
export function sweep(now = Date.now()) {
  for (const [k, room] of rooms) {
    if (room.clients.some((c) => c.online)) { room.emptyAt = 0; continue; }
    room.emptyAt ||= now;
    if (room.mode === 'quick' && now - room.emptyAt > (room.phase === 'final' ? EMPTY_ROOM_MS / 3 : EMPTY_ROOM_MS)) rooms.delete(k);
  }
}

export function publish(room) {
  if (room.parent) room = room.parent;
  const clock = Math.max(0, Math.ceil(((room.draftDeadline || 0) - Date.now()) / 1000));
  // The league first: the page routes on the state, and the screen it routes to reads the league.
  for (const c of room.clients) if (c.online) {
    if (room.league) send(c, { t: 'league', league: viewLeague(room, c), clock });
    send(c, { t: 'state', ...publicState(room, c) });
  }
  for (const t of tablesOf(room)) {
    if (t.g && t.phase !== 'live' && t.phase !== 'pre' && (t.parent || t.phase !== 'lobby')) broadcast(t, { t: 'game', g: plain(t.g), meta: t.meta ?? null, phase: t.phase });
  }
}
function viewLeague(room, client) {
  const L = plain(room.league);
  // Seat tokens never leave the server.
  if (L.online) delete L.online.tokens;
  for (const tm of L.teams) tm.user = tm.id === client.team;
  return L;
}
export function publicState(room, client) {
  const t = tableFor(room, client);
  const you = sideOf(t, client);
  const league = room.mode === 'league';
  const now = Date.now();
  return {
    code: room.code, mode: room.mode, phase: league ? (t ? t.phase : leaguePhase(room)) : room.phase, you, yourTeam: client?.team ?? null,
    players: room.clients.filter((c) => c.online || c.team != null || room.seat[0] === c.id || room.seat[1] === c.id).map((c) => ({
      id: c.id, name: c.name, side: sideOf(t || (league ? null : room), c), team: c.team, ready: !!c.ready, online: !!c.online,
    })),
    seats: t ? { ...t.seat } : {},
    claims: room.league?.online?.claims ?? {},
    need: t?.g ? need(t) : [],
    called: t ? Object.keys(t.calls).map(Number) : [],
    paused: !!t?.paused,
    canForfeit: !!t?.canForfeit && you != null,
    canSim: !!client && client.team === 0 && simmable(room).length > 0,
    reconnectMs: t?.paused ? Math.max(0, RECONNECT_MS - (now - t.pauseAt)) : 0,
    seed: room.seed,
    games: league ? [...room.tables.values()].map((x) => ({ home: x.gm.home, away: x.gm.away, score: x.g?.score ?? [0, 0], quarter: x.g?.quarter ?? 1 })) : [],
    waiting: league && pending(room).some((g) => (g.home === client?.team || g.away === client?.team) && !atTable(room, g) && [g.home, g.away].some((id) => id !== client?.team && claimed(room, id) && !onlineTeam(room, id))),
  };
}

export function onMessage(room, client, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'ping') { send(client, { t: 'pong', n: Number(msg.n) || 0 }); return; }
  if (msg.t === 'ready' || msg.t === 'readygame') { readyGame(room, client); return; }
  if (msg.t === 'claim') { claimTeam(room, client, msg.team); return; }
  if (msg.t === 'rematch') {
    if (room.mode === 'quick' && room.phase === 'final' && sideOf(room, client) != null) rematch(room);
    return;
  }
  if (msg.t === 'sim') { simWaiting(room, client); return; }
  if (msg.t === 'leave') { dropClient(room, client); return; }
  if (msg.t === 'startseason') {
    if (room.league?.phase === 'grades' && client.team === 0) {
      room.league.phase = 'season';
      settleWeek(room);
      saveLeague(room);
      publish(room);
    }
    return;
  }
  if (msg.t === 'pick' || msg.t === 'autopick') {
    const L = room.league;
    const pk = L?.phase === 'draft' && currentPick(L);
    if (!pk || pk.team !== client.team) return;
    const team = L.teams[pk.team];
    const choice = msg.t === 'autopick' ? aiChoosePick(L, pk.team) : validPick(L, team, Number(msg.id), msg.slot == null ? null : String(msg.slot));
    if (!choice) { send(client, { t: 'err', text: 'That Pokémon cannot be drafted.' }); publish(room); return; }
    makePick(L, choice.id, choice.slot && choice.slot !== 'BENCH' ? choice.slot : null);
    drainAiPicks(room);
    publish(room);
    return;
  }
  // The rest is the game at this client's table.
  const t = tableFor(room, client);
  const s = sideOf(t, client);
  if (!t || s == null) return;
  if (msg.t === 'forfeit') { forfeit(t, client); return; }
  if (msg.t === 'timeout') {
    if (t.g && !t.lp && t.phase === 'between') callTimeout(t.g, s);
    publish(room);
    return;
  }
  if (msg.t === 'call') {
    const g = t.g;
    if (!g || t.lp || t.phase !== 'between' || !need(t).includes(s)) return;
    const offense = g.phase === 'penalty' ? g.pending?.offended === s : g.poss === s;
    if (offense ? !has(OFF_PLAYS, msg.call) : !has(DEF_PLAYS, msg.call)) return;
    if ((g.phase === 'penalty') !== (OFF_PLAYS[msg.call]?.kind === 'penalty') && offense) return;
    const str = (v) => (typeof v === 'string' ? v.slice(0, 40) : null);
    t.calls[s] = { call: msg.call, formation: str(msg.formation), flip: !!msg.flip, front: str(msg.front) };
    publish(room);
    return;
  }
  if (msg.t === 'snap') {
    if (t.lp && t.lp.phase === 'pre' && s === t.lp.o) doSnap(t);
    return;
  }
  if (msg.t === 'presnap') { applyPresnap(t, s, msg); return; }
  if (msg.t === 'input') {
    const n = Number(msg.seq);
    if (Number.isFinite(n)) { if (n < client.seq) return; client.seq = n; }
    const prev = t.pad[s];
    const str = (v) => (typeof v === 'string' ? v.slice(0, 40) : null);
    const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0; };
    // A button press stays down until a step has seen it, even if newer input arrives first.
    t.pad[s] = {
      mx: num(msg.mx), my: num(msg.my), sprint: !!msg.sprint,
      juke: !!msg.juke || !!prev?.juke, dive: !!msg.dive || !!prev?.dive, truck: !!msg.truck || !!prev?.truck, spin: !!msg.spin || !!prev?.spin,
      throwTo: str(msg.throwTo) || prev?.throwTo || null, throwType: str(msg.throwTo) ? str(msg.throwType) : prev?.throwType ?? null, throwAway: !!msg.throwAway || !!prev?.throwAway,
      switchTo: str(msg.switchTo) || prev?.switchTo || null,
    };
  }
}
function applyPresnap(t, s, msg) {
  const lp = t.lp;
  if (!lp || lp.phase !== 'pre') return;
  const mine = s === lp.o;
  if (msg.act === 'aud' && mine && has(OFF_PLAYS, msg.arg) && audibles(lp, msg.arg).includes(msg.arg)) {
    beginPlay(t, { off: msg.arg, def: t.def, formation: lp.formation, front: lp.defFormation, flip: false }, false);
    return;
  }
  if (msg.act === 'hot' && mine) hotRoute(lp, msg.slot, msg.arg);
  else if (msg.act === 'motion' && mine) startMotion(lp, msg.arg);
  else if (msg.act === 'flip' && mine) flipRun(lp);
  else if (msg.act === 'shade' && !mine) cycleShade(lp);
  else if (msg.act === 'show' && !mine) setDisguise(lp, 'show');
  else if (msg.act === 'back' && !mine) setDisguise(lp, 'back');
  else return;
  broadcast(t, { t: 'presnap', act: msg.act, arg: msg.arg, slot: msg.slot, side: s });
}

export function hello(room, client) {
  for (const t of tablesOf(room)) checkPause(t);
  if (room.league) send(client, { t: 'league', league: viewLeague(room, client), clock: Math.max(0, Math.ceil(((room.draftDeadline || 0) - Date.now()) / 1000)) });
  send(client, { t: 'hello', token: client.token, code: room.code, mode: room.mode, ...publicState(room, client) });
  publish(room);
  // Back in the middle of a play: the play as it was snapped, then where everyone is now.
  const t = tableFor(room, client);
  if (t?.lp && t.playMsg) {
    send(client, t.playMsg);
    const s = packSnap(t, true);
    if (s) send(client, s);
  }
}
