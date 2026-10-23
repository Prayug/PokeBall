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
process.env.POKEBALL_AI_PICK_MS = '1';
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
  // Input in a new play counts even when its count is lower than the last play's (a page that
  // starts counting again): before, every move after the first play was thrown away.
  const qroom = rooms.get(hello.code);
  for (const seq of [500, 3]) {
    const plays = count(a, 'play');
    const deadline = Date.now() + 20000;
    while (count(a, 'play') === plays && Date.now() < deadline) { await Promise.all([answer(a), answer(b)]); await sleep(40); }
    const pg = a.latest('play').g;
    const off = pg.poss === 0 ? a : b;
    off.send({ t: 'input', mx: 1, my: 0, seq });
    await sleep(100);
    check(qroom.pad[pg.poss]?.mx === 1, `the offense's input reaches the play (count ${seq})`);
    off.send({ t: 'snap' });
    await a.wait((m) => m.t === 'whistle' && count(a, 'whistle') >= plays + 1, 25000);
  }
  const sn = a.latest('snap');
  check(sn && 'tackle' in sn && 'windup' in sn && sn.bodies.every((x) => 'a' in x), 'snapshots carry the tackle, the throw and each body\'s moves');
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

  // ---------- league: a lobby, a draft, games against the AI on each coach's machine ----------
  const host = client('host');
  await host.open();
  host.send({ t: 'create', mode: 'league', name: 'Host', setup: { name: 'Host Town', clock: false } });
  const lh = await host.wait((m) => m.t === 'hello');
  check(lh.yourTeam === 0, 'the commissioner has team 0');
  check(lh.phase === 'setup', `a new league waits in the lobby (${lh.phase})`);
  const room = rooms.get(lh.code);
  const L = room.league;
  const friend = client('friend');
  await friend.open();
  friend.send({ t: 'join', code: lh.code, name: 'Friend' });
  const fh = await friend.wait((m) => m.t === 'hello');
  check(fh.yourTeam == null, 'a friend arrives without a team');
  host.send({ t: 'pick', id: -5 });
  await sleep(200);
  check(!!rooms.get(lh.code) && L.pickIndex === 0, 'no pick before the draft starts, and no crash');
  friend.send({ t: 'startdraft' });
  await sleep(200);
  check(!L.online.started, 'only the commissioner starts the draft');
  const claimedTeam = 1;
  friend.send({ t: 'claim', team: claimedTeam });
  await friend.wait((m) => m.t === 'state' && m.yourTeam === claimedTeam);
  check(true, 'the friend took a team before the draft');
  host.send({ t: 'startdraft' });
  await host.wait((m) => m.t === 'state' && m.phase === 'draft');
  friend.send({ t: 'autodraft', on: true });
  const { currentPick } = await import('../src/league.js');
  for (let i = 0; i < 400 && currentPick(L)?.team !== 0; i++) await sleep(5);
  host.send({ t: 'pick', id: -5 });
  await host.wait((m) => m.t === 'err');
  check(!!rooms.get(lh.code), 'a bad pick is refused, not a crash');
  // Both coaches on auto-draft; the server makes every pick.
  host.send({ t: 'autodraft', on: true });
  const deadline = Date.now() + 60000;
  while (L.phase === 'draft' && Date.now() < deadline) await sleep(50);
  check(L.phase === 'grades', 'the draft finished');
  const mineOnly = (offer, team) => !offer || offer.send.every((id) => L.teams[team].roster.includes(id));
  const ho = (await host.wait((m) => m.t === 'league' && m.league.phase === 'grades')).league.trade;
  const fo = (await friend.wait((m) => m.t === 'league' && m.league.phase === 'grades')).league.trade;
  check(mineOnly(ho, 0) && mineOnly(fo, claimedTeam), `each coach's trade offer is for their own team (${!!ho}, ${!!fo})`);
  check(!ho || !fo || JSON.stringify(ho) !== JSON.stringify(fo), 'the two coaches do not get the same offer');
  // A depth chart: a bad one is ignored, a good one is kept.
  const t0 = L.teams[0];
  const before = JSON.stringify(t0.lineup);
  host.send({ t: 'lineup', lineup: { ...t0.lineup, QB: L.teams[1].roster[0] }, bench: t0.bench });
  const swapped = { ...t0.lineup };
  const [k1, k2] = Object.keys(swapped).filter((k) => swapped[k] != null).slice(0, 2);
  [swapped[k1], swapped[k2]] = [swapped[k2], swapped[k1]];
  await sleep(100);
  check(JSON.stringify(t0.lineup) === before, 'a depth chart with someone else\'s Pokémon is refused');
  host.send({ t: 'lineup', lineup: swapped, bench: t0.bench });
  await sleep(100);
  check(t0.lineup[k1] === swapped[k1], 'a depth chart change reaches the server');
  host.send({ t: 'startseason' });
  await host.wait((m) => m.t === 'state' && m.phase === 'season');

  // Games against the AI: the server hands the game over and takes the final back.
  async function playLocal(c) {
    const lg = await c.wait((m) => m.t === 'localgame');
    c.msgs.splice(c.msgs.indexOf(lg), 1);
    simUntil(lg.g, 'game');
    c.send({ t: 'result', key: lg.key, g: lg.g });
    return lg;
  }
  const vsAi = (w) => !(L.schedule[w] || []).some((g) => [g.home, g.away].includes(0) && [g.home, g.away].includes(claimedTeam));
  async function playWeek() {
    const w = L.week, ph = L.phase;
    if (ph === 'season' && !vsAi(w)) {
      host.send({ t: 'readygame' }); friend.send({ t: 'readygame' });
      const deadline2 = Date.now() + 5000;
      while (!room.tables.size && Date.now() < deadline2) await sleep(25);
      finishTables(room);
    } else {
      for (const c of [host, friend]) c.send({ t: 'readygame' });
      await Promise.all([host, friend].map((c) => {
        const team = c === host ? 0 : claimedTeam;
        const plays = pendingFor(team);
        return plays ? playLocal(c) : null;
      }));
    }
    const deadline3 = Date.now() + 10000;
    while (L.week === w && L.phase === ph && Date.now() < deadline3) await sleep(25);
  }
  const pendingFor = (team) => L.phase === 'season'
    ? L.schedule[L.week].some((g) => (g.home === team || g.away === team) && !L.results.some((r) => !r.playoff && r.week === L.week && r.home === g.home && r.away === g.away))
    : null;
  while (!vsAi(L.week)) await playWeek();
  const week = L.week;
  host.clear(); friend.clear();
  host.send({ t: 'readygame' });
  friend.send({ t: 'readygame' });
  const [hl, fl] = await Promise.all([host.wait((m) => m.t === 'localgame'), friend.wait((m) => m.t === 'localgame')]);
  check(room.local.size === 2 && room.tables.size === 0, `both games against the AI start at once, each on its coach's machine (${room.local.size})`);
  check(hl.g.teams.some((t) => t.id === 0) && fl.g.teams.some((t) => t.id === claimedTeam), 'each coach gets their own game');
  // A reload: asking again sends the same game back.
  host.send({ t: 'readygame' });
  const again = await host.wait((m) => m.t === 'localgame' && m !== hl);
  check(again.key === hl.key && room.local.size === 2, 'asking again resends the game in progress');
  host.clear();
  // A result that is not final, or for the wrong game, is ignored.
  friend.send({ t: 'result', key: fl.key, g: { ...fl.g, final: false } });
  friend.send({ t: 'result', key: hl.key, g: hl.g });
  await sleep(150);
  check(room.local.size === 2, 'a half-played or someone else\'s result is ignored');
  // The host sims to the end; the week waits for the friend, who is not held up by anybody.
  simUntil(hl.g, 'game');
  host.send({ t: 'result', key: hl.key, g: hl.g });
  await sleep(150);
  check(room.local.size === 1 && L.week === week, 'the host\'s final is recorded and the week waits for the friend');
  const hostRow = L.results.find((r) => r.week === week && (r.home === 0 || r.away === 0));
  check(!!hostRow && hostRow.score.join('-') === hl.g.score.join('-'), `a sim to the end counts (${hl.g.score.join('-')})`);
  friend.send({ t: 'simmine' });
  await host.wait((m) => m.t === 'state' && L.week === week + 1, 10000);
  check(L.week === week + 1, `the week advanced to ${L.week + 1}`);
  const recorded = L.results.filter((r) => r.week === week && !r.playoff).length;
  check(recorded === L.schedule[week].length, `every game of week ${week + 1} was recorded once (${recorded})`);
  // The week the two coaches meet, they play each other live on the server.
  let guard = 0;
  while (vsAi(L.week) && L.phase === 'season' && guard++ < 20) await playWeek();
  if (L.phase === 'season') {
    host.clear(); friend.clear();
    host.send({ t: 'readygame' }); friend.send({ t: 'readygame' });
    const hg = await host.wait((m) => m.t === 'game' && m.g);
    const fg = await friend.wait((m) => m.t === 'game' && m.g);
    check(room.tables.size === 1 && hg.g.seed === fg.g.seed, 'the two coaches play each other at one table');
    finishTables(room);
    await host.wait((m) => m.t === 'state' && room.tables.size === 0 && !vsAi(L.week) === false, 10000).catch(() => null);
  }
  guard = 0;
  while (L.phase === 'season' && guard++ < 40) await playWeek();
  // With neither coach in the playoffs the server plays them all out at once.
  check(L.phase === 'playoffs' || L.phase === 'done', `the regular season ended (${L.phase})`);
  const r0 = L.playoffs?.round;
  guard = 0;
  while (L.phase === 'playoffs' && L.playoffs.round === r0 && guard++ < 20) {
    host.send({ t: 'simmine' }); friend.send({ t: 'simmine' });
    host.send({ t: 'readygame' }); friend.send({ t: 'readygame' });
    await sleep(150);
    finishTables(room);
    for (const x of [...room.local.values()]) { const c = x.team === 0 ? host : friend; simUntil(x.g, 'game'); c.send({ t: 'result', key: x.key, g: x.g }); }
    host.send({ t: 'sim' });
    await sleep(150);
  }
  check(L.phase === 'done' || L.playoffs.round > r0, `the playoffs moved on (${L.phase} round ${L.playoffs?.round})`);
  const leagueView = host.latest('league').league;
  check(!leagueView.online?.tokens && !leagueView.online?.offers, 'seat tokens and other coaches\' offers never go to the page');
  console.log(`     league message ${Math.round(JSON.stringify(host.latest('league')).length / 1024)} KB`);

  // ---------- head to head: two coaches, two teams ----------
  const h1 = client('h2h host'), h2 = client('h2h friend');
  await h1.open(); await h2.open();
  h1.send({ t: 'create', mode: 'league', name: 'Ash', setup: { name: 'Pallet', clock: false, h2h: true } });
  const hh = await h1.wait((m) => m.t === 'hello');
  const hroom = rooms.get(hh.code);
  check(hh.h2h && hroom.league.teams.length === 2, `a head-to-head league has two teams (${hroom.league.teams.length})`);
  h1.send({ t: 'startdraft' });
  await sleep(150);
  check(!hroom.league.online.started, 'the head-to-head draft waits for the friend');
  h2.send({ t: 'join', code: hh.code, name: 'Gary' });
  const h2h = await h2.wait((m) => m.t === 'hello');
  check(h2h.yourTeam === 1, 'the friend gets the other team right away');
  h1.send({ t: 'startdraft' });
  h1.send({ t: 'autodraft', on: true }); h2.send({ t: 'autodraft', on: true });
  const d2 = Date.now() + 60000;
  while (hroom.league.phase === 'draft' && Date.now() < d2) await sleep(50);
  check(hroom.league.phase === 'grades', 'the head-to-head draft finished');
  h1.send({ t: 'readygame' }); h2.send({ t: 'readygame' });
  await h1.wait((m) => m.t === 'game' && m.g);
  check(hroom.tables.size === 1, 'the head-to-head game starts');
  finishTables(hroom);
  await h1.wait((m) => m.t === 'game' && m.phase === 'final');
  await sleep(100);
  check((hroom.league.online.h2hResults || []).length === 1 && hroom.league.phase === 'grades', 'the result is kept and they can play again');
  h1.close(); h2.close();

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
