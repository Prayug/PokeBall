// The online server, end to end over real sockets:
//   - quick match: two clients join, snap a few plays, and both see the same score
//   - bad input never takes the server down: a broken URL, junk frames, a bad draft pick
//   - a dropped player pauses the game, comes back with their token on a new socket, and the
//     game goes on; a stale socket closing late does not drop the seat again
//   - a league: two pairs play their games in the same week at once without touching each
//     other's game, the week advances when both are in, and the playoffs advance too
//   - a restart: the league and who owns which team come back from disk, tokens included
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeball-leagues-'));
process.env.POKEBALL_LEAGUES = dir;
process.env.POKEBALL_RECONNECT_MS = '400';
const { listen } = await import('../server/index.js');
const { rooms, loadLeagues } = await import('../server/sim.js');
const { simUntil } = await import('../src/engine.js');

let server = await listen(0, '127.0.0.1');
let port = server.address().port;
let url = `ws://127.0.0.1:${port}`;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(url);
  const box = { msgs: [], closed: false };
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString();
    box.msgs.push(JSON.parse(raw));
  });
  ws.addEventListener('close', () => { box.closed = true; });
  return {
    name, ws,
    async open() { if (ws.readyState === 1) return; await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); }); },
    send(o) { ws.send(JSON.stringify(o)); },
    get msgs() { return box.msgs; },
    get closed() { return box.closed; },
    latest(t) { return [...box.msgs].reverse().find((m) => m.t === t); },
    clear() { box.msgs.length = 0; },
    async wait(pred, ms = 15000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const hit = [...box.msgs].reverse().find(pred);
        if (hit) return hit;
        await sleep(25);
      }
      throw new Error(`${name} timed out, last ${box.msgs.slice(-6).map((m) => m.t + (m.phase ? ':' + m.phase : '')).join(' ')}`);
    },
    close() { try { ws.close(); } catch { /* already shut */ } },
  };
}

async function answer(c) {
  const st = c.latest('state');
  const game = c.latest('game');
  if (!st || !game?.g || game.g.final) return;
  const side = st.you;
  if (side == null || !(st.need || []).includes(side) || (st.called || []).includes(side)) return;
  const g = game.g;
  let call = 'inside_run';
  if (g.phase === 'kickoff') call = 'kick_deep';
  else if (g.phase === 'pat') call = 'xp';
  else if (g.phase === 'penalty') call = 'accept';
  else if (g.poss !== side) call = 'base';
  else if (g.down === 4) call = 'punt';
  c.send({ t: 'call', call });
}

const count = (c, t) => c.msgs.filter((m) => m.t === t).length;
// Both sides call until a play is snapped and whistled dead. The offense snaps.
async function onePlay(a, b) {
  const before = count(a, 'whistle');
  const deadline = Date.now() + 25000;
  let snapped = 0;
  while (Date.now() < deadline && count(a, 'whistle') === before) {
    if (count(a, 'play') > snapped && count(a, 'play') > count(a, 'whistle')) {
      const play = a.latest('play');
      const off = play.g.poss;
      (off === (a.latest('state')?.you ?? 0) ? a : b).send({ t: 'snap' });
      snapped = count(a, 'play');
    } else await Promise.all([answer(a), answer(b)]);
    await sleep(40);
  }
  if (count(a, 'whistle') === before) throw new Error('no whistle, last ' + a.msgs.slice(-6).map((m) => m.t).join(' '));
  const w = a.latest('whistle');
  const bw = await b.wait((m) => m.t === 'whistle' && m.g && m.g.log.length === w.g.log.length, 8000);
  check(bw.g.score[0] === w.g.score[0] && bw.g.score[1] === w.g.score[1], `both see ${w.g.score.join('-')}`);
  return w.g.score;
}

// Play out every league game in progress on the server (a test shortcut for a whole game).
function finishTables(room) {
  for (const t of room.tables.values()) { t.lp = null; t.playMsg = null; t.phase = 'between'; simUntil(t.g, 'game'); }
}

async function http(p) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  await res.text();
  return res.status;
}

try {
  // ---------- bad input ----------
  check(await http('/%E0%A4%A') === 404, 'a broken URL is a 404');
  check(await http('/../package.json') === 404, 'no path out of dist');
  check(await http('/healthz') === 200, 'health check answers');
  const junk = client('junk');
  await junk.open();
  junk.ws.send('not json');
  junk.send({ t: 'pick', id: 'abc' });
  junk.send({ t: 'join', code: { x: 1 } });
  await junk.wait((m) => m.t === 'err');
  junk.close();
  check(await http('/healthz') === 200, 'server still up after junk');

  // ---------- quick match ----------
  const a = client('home'), b = client('away');
  await a.open(); await b.open();
  a.send({ t: 'create', mode: 'quick', name: 'Home' });
  const hello = await a.wait((m) => m.t === 'hello');
  check(!!hello.code, 'home got a room code');
  b.send({ t: 'join', code: hello.code, name: 'Away' });
  const joined = await b.wait((m) => m.t === 'hello');
  check(joined.code === hello.code, 'away joined the same room');
  check(hello.you === 0 && joined.you === 1, `seats home ${hello.you} away ${joined.you}`);
  const third = client('third');
  await third.open();
  third.send({ t: 'join', code: hello.code, name: 'Third' });
  check((await third.wait((m) => m.t === 'err')).code === 'full', 'a third client is turned away');
  third.close();
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  await a.wait((m) => m.t === 'game' && m.g);
  await b.wait((m) => m.t === 'game' && m.g);
  for (let n = 0; n < 3; n++) {
    const s = await onePlay(a, b);
    console.log('     play', n + 1, s.join('-'), a.latest('whistle').clip ? 'film' : 'no film');
  }
  a.send({ t: 'ping', n: 1 });
  check((await a.wait((m) => m.t === 'pong')).n === 1, 'ping came back');

  // ---------- drop and resume ----------
  b.close();
  const paused = await a.wait((m) => m.t === 'state' && m.paused, 4000);
  check(paused.paused, 'the game pauses when away drops');
  const forfeitable = await a.wait((m) => m.t === 'state' && m.canForfeit, 4000);
  check(forfeitable.canForfeit, 'home may take the forfeit once the window runs out');
  const b2 = client('away again');
  await b2.open();
  b2.send({ t: 'resume', code: hello.code, token: joined.token, name: 'Away' });
  const back = await b2.wait((m) => m.t === 'hello');
  check(back.you === 1 && !back.paused, 'away is back in seat 1 and the game runs');
  await a.wait((m) => m.t === 'state' && !m.paused);
  b2.send({ t: 'resume', code: hello.code, token: joined.token, name: 'Away' });
  // The same seat on a third socket: the second one is closed, and its close drops nothing.
  const b3 = client('away third socket');
  await b3.open();
  b3.send({ t: 'resume', code: hello.code, token: joined.token, name: 'Away' });
  await b3.wait((m) => m.t === 'hello');
  await sleep(300);
  check(b2.closed, 'the stale socket was closed');
  check(!a.latest('state').paused, 'a stale socket closing does not pause the game');
  a.send({ t: 'game?' });
  await onePlay(a, b3);
  check(true, 'a play runs after the resume');
  a.close(); b3.close();

  // ---------- league: two games at once ----------
  const host = client('host');
  await host.open();
  host.send({ t: 'create', mode: 'league', name: 'Host', setup: { name: 'Host Town', clock: false } });
  const lh = await host.wait((m) => m.t === 'hello');
  check(lh.yourTeam === 0, 'the commissioner has team 0');
  const room = rooms.get(lh.code);
  const L = room.league;
  // The friend takes a team that does not play team 0 in week 1, so both games run at once.
  const friend = client('friend');
  await friend.open();
  friend.send({ t: 'join', code: lh.code, name: 'Friend' });
  const fh = await friend.wait((m) => m.t === 'hello');
  check(fh.yourTeam == null, 'a friend arrives without a team');
  host.send({ t: 'pick', id: -5 });
  await host.wait((m) => m.t === 'err');
  check(!!rooms.get(lh.code), 'a bad pick is refused, not a crash');
  // Draft: both humans autopick when on the clock.
  let claimedTeam = null;
  const deadline = Date.now() + 60000;
  while (L.phase === 'draft' && Date.now() < deadline) {
    if (claimedTeam == null && L.pickIndex > 0) {
      claimedTeam = 1;
      friend.send({ t: 'claim', team: claimedTeam });
      await friend.wait((m) => m.t === 'state' && m.yourTeam === claimedTeam);
    }
    host.send({ t: 'autopick' });
    if (claimedTeam != null) friend.send({ t: 'autopick' });
    await sleep(15);
  }
  check(L.phase === 'grades', 'the draft finished');
  host.send({ t: 'startseason' });
  await host.wait((m) => m.t === 'state' && m.phase === 'season');
  // Week 1: if the two humans play each other, sim to a week where they do not.
  const apart = (w) => !L.schedule[w].some((g) => [g.home, g.away].includes(0) && [g.home, g.away].includes(claimedTeam));
  check(apart(L.week) || true, `week ${L.week + 1}`);
  while (!apart(L.week)) {
    host.send({ t: 'readygame' }); friend.send({ t: 'readygame' });
    await sleep(200);
    finishTables(room);
    await host.wait((m) => m.t === 'state' && m.phase === 'season' && room.tables.size === 0, 10000);
  }
  const week = L.week;
  host.clear(); friend.clear();
  host.send({ t: 'readygame' });
  friend.send({ t: 'readygame' });
  await host.wait((m) => m.t === 'state' && m.phase === 'between');
  await friend.wait((m) => m.t === 'state' && m.phase === 'between');
  check(room.tables.size === 2, `two league games at once (${room.tables.size})`);
  const hg = await host.wait((m) => m.t === 'game' && m.g);
  const fg = await friend.wait((m) => m.t === 'game' && m.g);
  check(hg.g.teams.some((t) => t.id === 0) && !hg.g.teams.some((t) => t.id === claimedTeam), 'the host only hears their own game');
  check(fg.g.teams.some((t) => t.id === claimedTeam) && !fg.g.teams.some((t) => t.id === 0), 'the friend only hears their own game');
  // Finish both games; the week advances once both are in.
  finishTables(room);
  await host.wait((m) => m.t === 'game' && m.phase === 'final');
  await friend.wait((m) => m.t === 'game' && m.phase === 'final');
  await host.wait((m) => m.t === 'state' && room.tables.size === 0 && L.week === week + 1, 10000);
  check(L.week === week + 1, `the week advanced to ${L.week + 1}`);
  const recorded = L.results.filter((r) => r.week === week && !r.playoff).length;
  check(recorded === L.schedule[week].length, `every game of week ${week + 1} was recorded once (${recorded})`);
  // Play out the season fast, then the playoffs must advance too.
  let guard = 0;
  while (L.phase === 'season' && guard++ < 40) {
    host.send({ t: 'readygame' }); friend.send({ t: 'readygame' });
    await sleep(150);
    finishTables(room);
    await sleep(150);
    if (process.env.DEBUG) console.log('week', L.week, 'tables', room.tables.size, [...room.tables.values()].map((t) => `${t.phase}/${t.lp?.phase}/${t.lp?.set}/${t.g.final}/${t.paused}/${JSON.stringify(t.seat)}`).join(), 'pending', L.schedule[L.week]?.filter((g) => !L.results.some((r) => !r.playoff && r.week === L.week && r.home === g.home && r.away === g.away)).map((g) => `${g.home}-${g.away}`).join(' '), host.latest('state')?.phase);
  }
  check(L.phase === 'playoffs', `the regular season ended (${L.phase})`);
  const r0 = L.playoffs?.round;
  guard = 0;
  while (L.phase === 'playoffs' && L.playoffs.round === r0 && guard++ < 20) {
    host.send({ t: 'readygame' }); friend.send({ t: 'readygame' });
    host.send({ t: 'sim' });
    await sleep(150);
    finishTables(room);
    await sleep(150);
  }
  check(L.phase === 'done' || L.playoffs.round > r0, `the playoffs moved on (${L.phase} round ${L.playoffs?.round})`);
  const leagueView = host.latest('league').league;
  check(!leagueView.online?.tokens, 'seat tokens never go to the page');

  // ---------- restart ----------
  const code = lh.code;
  host.close(); friend.close();
  await sleep(100);
  server.closeAll();
  rooms.clear();
  server = await listen(0, '127.0.0.1');
  port = server.address().port;
  url = `ws://127.0.0.1:${port}`;
  check(rooms.has(code), 'the league is back after a restart');
  const f2 = client('friend after restart');
  await f2.open();
  f2.send({ t: 'resume', code, token: fh.token, name: 'Friend' });
  const fr = await f2.wait((m) => m.t === 'hello');
  check(fr.yourTeam === claimedTeam, `the friend's token still holds team ${claimedTeam} (${fr.yourTeam})`);
  const stranger = client('stranger');
  await stranger.open();
  stranger.send({ t: 'join', code, name: 'Stranger' });
  const sh = await stranger.wait((m) => m.t === 'hello');
  check(sh.yourTeam == null, 'a stranger does not get the commissioner team after a restart');
  f2.close(); stranger.close();
  void loadLeagues;
} catch (err) {
  failed++;
  console.log('FAIL', err?.stack || err);
}

server.closeAll();
fs.rmSync(dir, { recursive: true, force: true });
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('ok');
process.exit(0);
