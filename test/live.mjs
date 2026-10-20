// Live-play harness: full games where every run and pass is played out on the live field
// with all 22 players on autopilot. Prints the same league averages as balance.mjs.
// Usage: node test/live.mjs [games]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runPlay, runLivePlay, snapClock, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, autoPlay, playSeconds } from '../src/live.js';

const N = Number(process.argv[2] ?? 40);
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const tot = { games: 0, pts: 0, plays: 0, pa: 0, pc: 0, py: 0, pint: 0, sk: 0, ra: 0, ry: 0, fum: 0, to: 0, secs: 0, live: 0, tds: 0, drives: 0, third: [0, 0] };
const byCall = {};
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 5000 + i });
  let n = 0;
  while (!g.final && n++ < 400) {
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    const k = OFF_PLAYS[off].kind;
    if (k === 'run' || k === 'pass') {
      if (!snapClock(g, null, off)) continue;
      const lp = createLivePlay(g, off, def, {});
      const r = autoPlay(lp);
      const s = playSeconds(lp);
      tot.secs += s; tot.live++;
      const bc = byCall[off] ??= { n: 0, y: 0, c: 0, air: 0, yac: 0, brk: 0, sk: 0, t: 0 };
      bc.n++; bc.y += r.yards ?? 0; if ((r.yards ?? 0) >= 20) bc.b20 = (bc.b20 ?? 0) + 1; if ((r.yards ?? 0) >= 40) bc.b40 = (bc.b40 ?? 0) + 1; bc.brk += lp.events.filter((e) => e.kind === 'broken').length;
      if (lp.caught) { bc.c++; bc.air += lp.catchX; bc.yac += (r.yards ?? 0) - lp.catchX; }
      if (r.kind === 'sack') bc.sk++;
      bc.t += lp.thrown ? lp.thrown.t0 : 0;
      if (lp.sepAtArrival != null) { bc.sep = (bc.sep ?? 0) + Math.min(lp.sepAtArrival, 8); bc.ns = (bc.ns ?? 0) + 1; }
      runLivePlay(g, off, def, r, s);
    } else runPlay(g, off, def);
  }
  tot.games++;
  tot.pts += g.score[0] + g.score[1];
  for (const t of g.teams) {
    tot.plays += t.team.plays; tot.to += t.team.to; tot.third[0] += t.team.third[0]; tot.third[1] += t.team.third[1];
    for (const s of Object.values(t.stats)) { tot.pa += s.pa; tot.pc += s.pc; tot.py += s.py; tot.pint += s.pint; tot.sk += s.sk; tot.ra += s.ra; tot.ry += s.ry; tot.fum += s.fum; }
  }
  tot.drives += g.drives.length;
  for (const d of g.drives) if (d.result === 'Touchdown') tot.tds++;
}
const tg = tot.games * 2, f = (x, d = 1) => x.toFixed(d);
console.log(`${tot.games} games in ${Date.now() - t0} ms, ${f(tot.secs / tot.live, 2)} s per live play`);
console.log(`points/team ${f(tot.pts / tg)}  plays/team ${f(tot.plays / tg)}  drives/team ${f(tot.drives / tg)}  TD/team ${f(tot.tds / tg)}  TO/team ${f(tot.to / tg, 2)}  3rd down ${f(100 * tot.third[1] / tot.third[0])}%`);
console.log(`pass att ${f(tot.pa / tg)}  cmp% ${f(100 * tot.pc / tot.pa)}  Y/A ${f(tot.py / tot.pa, 2)}  INT% ${f(100 * tot.pint / tot.pa, 2)}  sack% ${f(100 * tot.sk / (tot.pa + tot.sk), 2)}`);
console.log(`rush att ${f(tot.ra / tg)}  Y/C ${f(tot.ry / tot.ra, 2)}  fumbles/team ${f(tot.fum / tg, 2)}`);
for (const [k, v] of Object.entries(byCall)) console.log(k.padEnd(12), 'n', String(v.n).padStart(4), 'yds', f(v.y / v.n).padStart(5), 'cmp', f(100 * v.c / v.n).padStart(5), 'air', f(v.air / (v.c || 1)).padStart(5), 'yac', f(v.yac / (v.c || 1)).padStart(5), 'brk/play', f(v.brk / v.n, 2), 'sack', f(100 * v.sk / v.n), 'tThrow', f(v.t / v.n, 2), 'sep', f((v.sep ?? 0) / (v.ns || 1)), '20+', f(100 * (v.b20 ?? 0) / v.n), '40+', f(100 * (v.b40 ?? 0) / v.n));
