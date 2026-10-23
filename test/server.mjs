// Two fake clients join a quick room, snap a few plays, and both see the same score.
// A league room drafts, claims the week-1 opponent, and snaps one live play.
import net from 'node:net';
import { listen } from '../server/index.js';
import { rooms } from '../server/sim.js';
import { simUntil } from '../src/engine.js';
import { recordResult } from '../src/league.js';

const server = await listen(0, '127.0.0.1');
const port = server.address().port;
const url = `ws://127.0.0.1:${port}`;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', msg); } };

function client(name) {
  const ws = new WebSocket(url);
  const box = { msgs: [] };
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString();
    box.msgs.push(JSON.parse(raw));
  });
  return {
    name,
    async open() { if (ws.readyState === 1) return; await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); }); },
    send(o) { ws.send(JSON.stringify(o)); },
    get msgs() { return box.msgs; },
    latest(t) { return [...box.msgs].reverse().find((m) => m.t === t); },
    async wait(pred, ms = 15000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const hit = box.msgs.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 25));
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
  if (side == null || !(st.need || []).includes(side)) return;
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
async function onePlay(a, b) {
  const before = count(a, 'whistle');
  const deadline = Date.now() + 20000;
  let snapped = false;
  while (Date.now() < deadline && count(a, 'whistle') === before) {
    const play = [...a.msgs].reverse().find((m) => m.t === 'play');
    const live = play && a.msgs.indexOf(play) > a.msgs.findIndex((m) => m.t === 'whistle' && a.msgs.indexOf(m) === before - 1);
    if ([...a.msgs].slice().reverse().find((m) => m.t === 'play') && count(a, 'play') > count(a, 'whistle')) {
      if (!snapped) {
        const poss = a.latest('game')?.g?.poss ?? a.latest('state')?.need?.[0] ?? 0;
        (poss === 0 ? a : b).send({ t: 'snap' });
        snapped = true;
      }
    } else await Promise.all([answer(a), answer(b)]);
    await new Promise((r) => setTimeout(r, 40));
    void live;
  }
  if (count(a, 'whistle') === before) throw new Error('no whistle, last ' + a.msgs.slice(-6).map((m) => m.t).join(' '));
  const w = a.latest('whistle');
  const bw = await b.wait((m) => m.t === 'whistle' && m.g && m.g.score[0] === w.g.score[0] && m.g.score[1] === w.g.score[1] && (m.g.playNo ?? 0) >= (w.g.playNo ?? 0), 8000);
  check(bw.g.score[0] === w.g.score[0] && bw.g.score[1] === w.g.score[1], `score ${w.g.score} vs ${bw.g.score}`);
  return w.g.score;
}

try {
  const a = client('home'), b = client('away');
  await a.open(); await b.open();
  a.send({ t: 'create', mode: 'quick', name: 'Home' });
  const hello = await a.wait((m) => m.t === 'hello');
  check(!!hello.code, 'home got a room code');
  b.send({ t: 'join', code: hello.code, name: 'Away' });
  const joined = await b.wait((m) => m.t === 'hello');
  check(joined.code === hello.code, 'away joined the same room');
  check(hello.you === 0 && joined.you === 1, `seats home ${hello.you} away ${joined.you}`);
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  await a.wait((m) => m.t === 'game' && m.g);
  await b.wait((m) => m.t === 'game' && m.g);
  const scores = [];
  for (let n = 0; n < 3; n++) {
    scores.push(await onePlay(a, b));
    console.log('play', n + 1, scores[n].join('-'), a.latest('whistle').clip ? 'film' : 'no film');
  }
  const as = a.latest('whistle').g.score, bs = b.latest('whistle').g.score;
  check(as[0] === bs[0] && as[1] === bs[1], `same score ${as} vs ${bs}`);
  check(scores.length === 3, 'snapped three plays');
  a.send({ t: 'ping', n: 1 });
  const pong = await a.wait((m) => m.t === 'pong');
  check(pong.n === 1, 'ping came back');
  a.close(); b.close();
} catch (err) {
  failed++;
  console.log('FAIL', err?.stack || err);
}

function rawGet(path) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => {
      s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    const chunks = [];
    s.on('data', (d) => chunks.push(d));
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    s.on('error', reject);
  });
}

let leagueCode = null;
try {
  const bad = await rawGet('/%');
  check(/^HTTP\/1\.1 (400|404)/.test(bad), 'malformed url stayed up: ' + bad.slice(0, 24));
  const index = await rawGet('/booth/index.json');
  check(index.startsWith('HTTP/1.1 200'), 'booth index ' + index.slice(0, 24));
  const home = client('commish'), away = client('friend');
  await home.open(); await away.open();
  home.send({ t: 'create', mode: 'league', name: 'Pallet Starters', setup: { name: 'Pallet Starters', abbr: 'PAL', rounds: 24, typeCap: true, clock: true, scheme: 'balanced' } });
  const hello = await home.wait((m) => m.t === 'hello');
  leagueCode = hello.code;
  check(hello.mode === 'league' && hello.yourTeam === 0, `league host team ${hello.yourTeam}`);
  away.send({ t: 'join', code: hello.code, name: 'Friend' });
  await away.wait((m) => m.t === 'hello');
  let guard = 0;
  while (guard++ < 300) {
    const L = home.latest('league')?.league;
    if (!L) { await new Promise((r) => setTimeout(r, 20)); continue; }
    if (L.phase !== 'draft') break;
    const pk = L.picks[L.pickIndex];
    if (pk?.team !== 0) { await new Promise((r) => setTimeout(r, 20)); continue; }
    const idx = L.pickIndex;
    home.send({ t: 'autopick' });
    await home.wait((m) => m.t === 'league' && (m.league.phase !== 'draft' || m.league.pickIndex > idx), 8000);
  }
  const drafted = home.latest('league')?.league;
  check(drafted?.phase === 'grades', 'draft reached grades ' + drafted?.phase);
  const gm = drafted.schedule[0].find((g) => g.home === 0 || g.away === 0);
  const opp = gm.home === 0 ? gm.away : gm.home;
  away.send({ t: 'claim', team: opp });
  const claimed = await away.wait((m) => m.t === 'state' && m.yourTeam === opp);
  check(claimed.yourTeam === opp, `friend claimed week-1 opponent ${opp}`);
  home.send({ t: 'startseason' });
  await home.wait((m) => m.t === 'league' && m.league.phase === 'season', 20000);
  home.send({ t: 'readygame' });
  away.send({ t: 'readygame' });
  await home.wait((m) => m.t === 'game' && m.g);
  await away.wait((m) => m.t === 'game' && m.g);
  const score = await onePlay(home, away);
  const names = home.latest('whistle').g.teams.map((t) => t.abbr).join(' vs ');
  console.log('league play', score.join('-'), names);
  check(home.latest('whistle').g.teams.some((t) => t.id === opp), 'head-to-head was the week-1 opponent');
  home.close(); away.close();
} catch (err) {
  failed++;
  console.log('FAIL', err?.stack || err);
}

server.closeAll();
try {
  const room = [...rooms.values()].find((r) => r.mode === 'league' && r.code === leagueCode);
  if (room?.g && !room.g.final) {
    simUntil(room.g, 'game');
    recordResult(room.league, room.g, { week: room.league.week });
    check(room.g.final && room.league.results.length > 0, 'a live league game can be booked');
  }
} catch (err) {
  failed++;
  console.log('FAIL', err?.stack || err);
}
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('ok');
