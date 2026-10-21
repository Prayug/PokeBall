// Run game audit: plays each designed run live, with every Pokémon on autopilot, called to the
// left and to the right in turn, and measures where the ball carrier actually goes: the side of
// the ball he crosses the line on (the called side, or a cutback he read), how wide, how soon,
// and how far he gets. Then checks the concepts are really different runs, that the flip at the
// line mirrors a run, and that the AI offense runs to both sides.
// Prints each measure; --strict exits non-zero past the limits.
// Usage: node test/runs.mjs [plays per call, default 40] [--strict] [--only=power,counter]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step } from '../src/live.js';
import { flipRun } from '../src/live/presnap.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 40);
const STRICT = process.argv.includes('--strict');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const DEFS = ['base', 'cover2', 'cover3', 'run_blitz', 'man_press', 'tampa2', 'cover4', 'mug'];
const runs = Object.keys(OFF_PLAYS).filter((k) => OFF_PLAYS[k].kind === 'run' && k !== 'qb_sneak' && (!ONLY || ONLY.includes(k)));
const game = (i, seed) => {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed, weather: 'clear' });
  g.spot = 25 + ((i * 13) % 45); g.down = 1; g.toGo = 10; g.poss = i % 2;
  return g;
};
const fails = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'BAD'} ${what}`); if (!ok) fails.push(what); };

const rows = [];
for (const call of runs) {
  const R = { call, n: 0, called: 0, cut: 0, cross: [], when: [], yds: [], flip: [0, 0], reads: {} };
  for (let i = 0; i < N; i++) {
    const g = game(i, 9100 + i * 7);
    const side = i % 2 ? 1 : -1;
    const lp = createLivePlay(g, call, DEFS[i % DEFS.length], { runSide: side });
    if (globalThis.TRACE) globalThis.TRACE(lp, i);
    R.flip[lp.runSide > 0 ? 1 : 0]++;
    const hole0 = lp.holeY;
    snap(lp);
    let crossed = null;
    for (let s = 0; s < 60 * 12 && lp.phase === 'live'; s++) {
      step(lp, null);
      const c = lp.carrierSet ? lp.carrier : null;
      if (c && c.side === 'off' && crossed == null && c.x >= 0) crossed = { y: c.y, t: lp.t };
    }
    R.n++;
    if (lp.cut) R.reads[lp.cut] = (R.reads[lp.cut] ?? 0) + 1;
    R.yds.push(lp.result?.yards ?? 0);
    // A read option kept by the quarterback goes the other way by design.
    const want = lp.kept ? -side : side;
    if (crossed) {
      R.cross.push(crossed.y * want); R.when.push(crossed.t);
      // Through its hole (an A-gap run hits right next to the center), on its side, or a cutback it read.
      if (crossed.y * want > 0.3 || Math.abs(crossed.y - hole0) < 1.5 || lp.cut === 'back') R.called++;
      if (lp.cut === 'back') R.cut++;
    }
  }
  rows.push(R);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
console.log('call           plays  as designed  cutback  crosses at (yd to the called side)  reaches LOS  yds   left/right  reads');
for (const R of rows) {
  console.log(`${R.call.padEnd(14)} ${String(R.n).padStart(5)}  ${(100 * R.called / R.n).toFixed(0).padStart(10)}%  ${(100 * R.cut / R.n).toFixed(0).padStart(6)}%  ${med(R.cross).toFixed(1).padStart(18)}  ${mean(R.when).toFixed(2).padStart(26)}s  ${mean(R.yds).toFixed(1).padStart(4)}  ${R.flip.join('/').padStart(9)}   ${JSON.stringify(R.reads)}`);
}

console.log('checks');
for (const R of rows) {
  check(R.flip[0] === R.flip[1], `${R.call} runs to the side it is called to (${R.flip.join(' left / ')} right)`);
  // The QB draw and the read keep are reads by the quarterback; everything else goes where it was drawn.
  const floor = ['qb_draw', 'read_option'].includes(R.call) ? 0.35 : 0.55;
  check(R.called / R.n >= floor, `${R.call} hits its own side (or its cutback) on ${(100 * R.called / R.n).toFixed(0)}% of snaps (limit ${Math.round(floor * 100)}%)`);
  check(mean(R.yds) >= 1.5, `${R.call} gains ${mean(R.yds).toFixed(1)} yd a carry (limit 1.5)`);
}
if (!ONLY) {
  // Different concepts hit different lanes: inside runs inside, edge runs outside.
  const lane = (c) => med(rows.find((r) => r.call === c)?.cross ?? [0]);
  check(lane('outside_run') > lane('inside_run') + 3, `outside zone (${lane('outside_run').toFixed(1)}) crosses wider than inside zone (${lane('inside_run').toFixed(1)})`);
  check(lane('toss') > lane('power') + 2, `the toss (${lane('toss').toFixed(1)}) crosses wider than power (${lane('power').toFixed(1)})`);
  check(Math.abs(lane('dive')) < 3.5 && Math.abs(lane('trap')) < 3.5, `the dive (${lane('dive').toFixed(1)}) and the trap (${lane('trap').toFixed(1)}) hit inside`);
  const zone = rows.find((r) => r.call === 'inside_run');
  check(zone.cut > 0 && zone.cut < zone.n * 0.5, `inside zone cuts back on some snaps, not most (${zone.cut} of ${zone.n})`);
  const all = rows.filter((r) => r.call !== 'qb_draw' && r.call !== 'read_option').flatMap((r) => r.yds);
  check(mean(all) > 3 && mean(all) < 7, `designed runs average ${mean(all).toFixed(1)} yd (3 to 7)`);
}

// The flip at the line mirrors the run: the side, the track and the pullers.
{
  let ok = 0, n = 0;
  for (const call of runs.filter((c) => OFF_PLAYS[c].dir !== 'sneak')) {
    const g = game(n, 777 + n);
    const lp = createLivePlay(g, call, 'base', { userSide: g.poss });
    lp.set = true;
    const s0 = lp.runSide, t0 = (lp.carrier?.track ?? []).at(-1), pulls0 = Object.values(lp.off).filter((p) => p.pull).length;
    const flipped = flipRun(lp);
    const t1 = (lp.carrier?.track ?? []).at(-1), pulls1 = Object.values(lp.off).filter((p) => p.pull).length;
    n++;
    if (flipped && lp.runSide === -s0 && t0 && t1 && Math.sign(t0.y) === -Math.sign(t1.y) && pulls0 === pulls1) ok++;
    else console.log(`   flip failed on ${call}: side ${s0}->${lp.runSide}, track end ${t0?.y?.toFixed(1)} -> ${t1?.y?.toFixed(1)}, pullers ${pulls0} -> ${pulls1}`);
  }
  check(ok === n, `flipping at the line mirrors the run (${ok} of ${n})`);
}
// The AI offense picks its side from the box: both ways, over a season's worth of calls.
if (!ONLY) {
  const side = [0, 0];
  for (let i = 0; i < 400 && side[0] + side[1] < 160; i++) {
    const g = game(i, 4400 + i);
    g.toGo = 1 + (i % 10); g.down = 1 + (i % 3);
    const off = aiOffenseCall(g);
    if (OFF_PLAYS[off].kind !== 'run' || OFF_PLAYS[off].dir === 'sneak') continue;
    const lp = createLivePlay(g, off, aiDefenseCall(g), {});
    side[lp.runSide > 0 ? 1 : 0]++;
  }
  const lo = Math.min(...side) / (side[0] + side[1]);
  check(lo > 0.3, `the AI runs both ways (${side[0]} left, ${side[1]} right)`);
}
console.log(fails.length ? `${fails.length} checks failed` : 'all checks passed');
if (STRICT && fails.length) process.exit(1);
export { rows };
