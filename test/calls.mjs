// Fast-sim yards by call: every offensive run against every defense, and every pass family
// against every defense, from the same spot between AI-drafted teams. Shows that each call in
// the playbook resolves as itself (an aliased call reads the same as the play it borrows).
// Usage: node test/calls.mjs [plays per pairing]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runPlay, OFF_PLAYS, DEF_PLAYS } from '../src/engine.js';

const N = Number(process.argv[2] ?? 3000);
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
function sample(off, def) {
  let y = 0, sk = 0, big = 0, loss = 0, cmp = 0, att = 0, to = 0;
  for (let i = 0; i < N; i++) {
    const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
    const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 900 + i });
    g.poss = 0; g.spot = 30; g.down = 1; g.toGo = 10; g.quarter = 1; g.clock = 900;
    const e = runPlay(g, off, def);
    const yd = e.kind === 'turnover' && !/Turnover on downs/.test(e.text) ? 0 : e.yards ?? 0;
    if (e.kind === 'turnover') to++;
    y += yd; if (yd >= 15) big++; if (yd < 0) loss++;
    if (/sacks/.test(e.text)) sk++;
    if (OFF_PLAYS[off].kind === 'pass' && !/sacks|scrambles/.test(e.text)) { att++; if (/ finds /.test(e.text)) cmp++; }
  }
  return { y: y / N, sk: sk / N, big: big / N, loss: loss / N, cmp: att ? cmp / att : 0, to: to / N };
}
const f = (x, d = 1) => x.toFixed(d).padStart(5);
const runs = Object.keys(OFF_PLAYS).filter((k) => OFF_PLAYS[k].kind === 'run' && !OFF_PLAYS[k].qb);
const passes = ['screen', 'slant', 'curl', 'te_seam', 'post', 'pa_deep'];
const defs = Object.keys(DEF_PLAYS);
console.log('yards per play, fast sim'.padEnd(14), defs.map((d) => d.slice(0, 7).padStart(8)).join(''));
for (const o of [...runs, ...passes]) console.log(o.padEnd(14), defs.map((d) => f(sample(o, d).y).padStart(8)).join(''));
console.log('\nrun detail vs all defenses: yds  loss%  15+%');
for (const o of runs) {
  let y = 0, l = 0, b = 0;
  for (const d of defs) { const r = sample(o, d); y += r.y; l += r.loss; b += r.big; }
  console.log(o.padEnd(14), f(y / defs.length), f(100 * l / defs.length), f(100 * b / defs.length));
}
console.log('\ndefense detail vs all passes: yds  sack%  cmp%');
for (const d of defs) {
  let y = 0, s = 0, c = 0;
  for (const o of passes) { const r = sample(o, d); y += r.y; s += r.sk; c += r.cmp; }
  console.log(d.padEnd(14), f(y / passes.length), f(100 * s / passes.length), f(100 * c / passes.length));
}
