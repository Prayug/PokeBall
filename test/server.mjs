// Two fake clients join a quick room, snap a few plays, and both see the same score.
import { listen } from '../server/index.js';
import { rooms } from '../server/sim.js';

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

if (rooms.size) { /* rooms stay until the process exits */ }
server.closeAll();
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('ok');
