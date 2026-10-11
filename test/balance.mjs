// Balance harness: simulate many games between AI-drafted teams and print league averages.
// Usage: node test/balance.mjs [games]
import { createLeague, aiChoosePick, makePick, teamForGame, draftGrades } from '../src/league.js';
import { createGame, simUntil } from '../src/engine.js';

const N = Number(process.argv[2] ?? 2000);
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const tot = { games: 0, pts: 0, plays: 0, pa: 0, pc: 0, py: 0, pint: 0, sk: 0, ra: 0, ry: 0, fum: 0, to: 0, ot: 0, ties: 0,
  fd: 0, third: [0, 0], drives: 0, punts: 0, fga: 0, tds: 0, homeW: 0, maxPts: 0, marg: 0 };
const t0 = Date.now();
const wins = L.teams.map(() => 0);
for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 1000 + i });
  simUntil(g, 'game');
  if (!g.final) { console.log('did not finish', i); continue; }
  tot.games++;
  tot.pts += g.score[0] + g.score[1];
  tot.maxPts = Math.max(tot.maxPts, ...g.score);
  tot.marg += Math.abs(g.score[0] - g.score[1]);
  if (g.quarter >= 5) tot.ot++;
  if (g.winner == null) tot.ties++;
  if (g.winner === 0) tot.homeW++;
  if (g.winner != null) wins[g.teams[g.winner].id]++;
  for (const t of g.teams) {
    tot.plays += t.team.plays; tot.fd += t.team.fd; tot.to += t.team.to;
    tot.third[0] += t.team.third[0]; tot.third[1] += t.team.third[1];
    for (const s of Object.values(t.stats)) {
      tot.pa += s.pa; tot.pc += s.pc; tot.py += s.py; tot.pint += s.pint; tot.sk += s.sk; tot.ra += s.ra; tot.ry += s.ry; tot.fum += s.fum;
    }
  }
  tot.drives += g.drives.length;
  for (const d of g.drives) { if (d.result === 'Punt') tot.punts++; if (/Field goal|Missed/.test(d.result)) tot.fga++; if (d.result === 'Touchdown') tot.tds++; }
}
const tg = tot.games * 2;
const f = (x, d = 1) => x.toFixed(d);
console.log(`${tot.games} games in ${Date.now() - t0} ms`);
console.log(`points/team ${f(tot.pts / tg)}  max ${tot.maxPts}  avg margin ${f(tot.marg / tot.games)}  OT ${f(100 * tot.ot / tot.games)}%  ties ${tot.ties}  home win ${f(100 * tot.homeW / tot.games)}%`);
console.log(`plays/team ${f(tot.plays / tg)}  drives/team ${f(tot.drives / tg)}  TD/team ${f(tot.tds / tg)}  FGA/team ${f(tot.fga / tg)}  punts/team ${f(tot.punts / tg)}`);
console.log(`pass att ${f(tot.pa / tg)}  cmp% ${f(100 * tot.pc / tot.pa)}  Y/A ${f(tot.py / tot.pa, 2)}  INT% ${f(100 * tot.pint / tot.pa, 2)}  sack% ${f(100 * tot.sk / (tot.pa + tot.sk), 2)}`);
console.log(`rush att ${f(tot.ra / tg)}  Y/C ${f(tot.ry / tot.ra, 2)}  fumbles/team ${f(tot.fum / tg, 2)}  TO/team ${f(tot.to / tg, 2)}  3rd down ${f(100 * tot.third[1] / tot.third[0])}%`);
const grades = draftGrades(L);
L.teams.forEach((t, i) => console.log(t.name.padEnd(18), 'win%', (100 * wins[i] / (tot.games / 4)).toFixed(1), Object.entries(grades[i]).map(([k, v]) => `${k} ${v.grade}`).join('  ')));
