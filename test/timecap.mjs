// The live play's time cap: a play still running at the cap is ruled over where it stands, and
// the result is one the engine can apply. A pass in the air at the cap is incomplete; a ball
// carrier is down where he is (not scored as a run or catch that never ended).
// Usage: node test/timecap.mjs
import { quickRosters, teamForGame } from '../src/league.js';
import { createGame, runLivePlay } from '../src/engine.js';
import { createLivePlay, snap, step, playSeconds } from '../src/live.js';

const problems = [];
let air = 0, held = 0;
for (let i = 0; i < 40; i++) {
  const Q = quickRosters(500 + i);
  const g = createGame({ home: teamForGame(Q.teams[0]), away: teamForGame(Q.teams[1]), seed: 900 + i, weather: 'clear' });
  g.phase = 'play'; g.kick = null; g.poss = 0; g.spot = 30; g.down = 1; g.toGo = 10;
  const call = i % 2 ? 'post' : 'inside_run';
  const lp = createLivePlay(g, call, 'cover3', {});
  snap(lp);
  // Run until the ball is in the air (a pass) or a back has it (a run), then jump the clock.
  for (let k = 0; k < 60 * 6 && lp.phase === 'live'; k++) {
    step(lp, null);
    if (call === 'post' ? lp.ball.state === 'air' : lp.carrierSet && lp.t > 0.8) break;
  }
  if (lp.phase !== 'live') continue;
  const inAir = lp.ball.state === 'air';
  lp.t = 14.05;
  step(lp, null);
  if (lp.phase === 'live') { problems.push(`${call} ${i}: still live past the cap`); continue; }
  const r = lp.result;
  if (inAir) {
    air++;
    if (r.kind !== 'pass' || r.yards !== 0 || !r.clockStop || !/incomplete/.test(r.text)) problems.push(`${call} ${i}: a ball in the air at the cap scored as ${r.kind} ${r.yards} "${r.text}"`);
  } else {
    held++;
    if (!/ruled down/.test(r.text)) problems.push(`${call} ${i}: a carrier at the cap is not ruled down: "${r.text}"`);
  }
  const e = runLivePlay(g, call, 'cover3', r, playSeconds(lp));
  if (!e?.text) problems.push(`${call} ${i}: no log entry`);
}
console.log(`time cap: ${air} passes in the air, ${held} carriers`);
if (!air || !held) problems.push('the cap was not exercised both ways');
for (const p of problems) console.log('  ' + p);
console.log(problems.length ? 'FAIL' : 'ok');
if (problems.length) process.exit(1);
