// Pre-snap adjustments, difficulty and the call sheet's scouting hint, headless.
//   - audibles: only calls the formation on the field can run, never the one lined up
//   - a hot route changes that receiver's route and he runs it
//   - motion: the man moves across before the snap and starts the play moving; a man-coverage
//     defender follows him, a zone defense does not
//   - shading the coverage moves the zones and alignment; show blitz walks the second level up
//     and makes the AI offense keep its back in; back out drops the blitzers to normal depth
//   - every adjusted play still runs to a result
//   - Pro is exactly the game without a difficulty; Rookie and Legend change the read speed,
//     the catch radius and the luck, in that order
//   - the "Fits" hint follows the other team's tendencies
// Exits non-zero on any failure.
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, simUntil, eff } from '../src/engine.js';
import { createLivePlay, step, snap, autoPlay, DT } from '../src/live.js';
import { formationsFor } from '../src/formations.js';
import { audibles, hotRoute, motionCandidates, startMotion, setShade, setDisguise, canBackOut } from '../src/live/presnap.js';
import { applyDifficulty, DIFFICULTY } from '../src/difficulty.js';
import { tendencyFit, typeEdges } from '../src/scout.js';

let failures = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) { failures++; console.log(`FAIL ${what}`); } }
const t0 = Date.now();

const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
function game(seed, poss = 0) {
  const g = createGame({ home: teamForGame(L.teams[0]), away: teamForGame(L.teams[3]), seed, weather: 'clear' });
  g.spot = 35; g.down = 1; g.toGo = 10; g.poss = poss;
  return g;
}
function lineUp(g, off, def, opts) {
  const lp = createLivePlay(g, off, def, opts);
  for (let i = 0; i < 60 * 10 && !lp.set; i++) step(lp, null);
  return lp;
}
const pre = (lp, s) => { for (let i = 0; i < Math.round(s / DT); i++) step(lp, null); };
const run = (lp) => { snap(lp); for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) step(lp, null); return lp.result; };

// ---------- audibles ----------
{
  const g = game(11);
  const lp = lineUp(g, 'slant', 'cover3', { userSide: 0, formation: 'gun_spread' });
  const list = audibles(lp, 'smash');
  check(list.length >= 4, `audibles offered (${list.join(' ')})`);
  check(list[0] === 'smash', 'the scouting fit is offered first');
  check(!list.includes('slant'), 'the call already lined up is not an audible');
  check(list.every((c) => formationsFor(c).includes('gun_spread')), 'every audible runs from the formation on the field');
  const lpUC = lineUp(game(11), 'inside_run', 'base', { userSide: 0, formation: 'iform' });
  check(audibles(lpUC).every((c) => formationsFor(c).includes('iform')), 'under-center audibles fit the I-form');
  const lpD = lineUp(game(11, 1), 'slant', 'base', { userSide: 0 });
  check(audibles(lpD).length === 0, 'no audibles for the side on defense');
}

// ---------- hot route ----------
{
  const g = game(12);
  const lp = lineUp(g, 'slant', 'cover3', { userSide: 0, autoQB: true });
  const wr = lp.off.WR1, x0 = wr.x;
  check(hotRoute(lp, 'WR1', 'go'), 'hot route accepted');
  check(wr.routeName === 'go' && wr.route.at(-1).x > x0 + 20, 'WR1 now runs a go route');
  check(hotRoute(lp, 'RB', 'block') && lp.off.RB.role === 'passblock' && !lp.eligible.includes('RB'), 'a back kept in to block leaves the reads');
  snap(lp);
  for (let i = 0; i < 60 * 2.2 && lp.phase === 'live'; i++) step(lp, null);
  check(lp.phase !== 'live' || wr.x > x0 + 10 || lp.thrown?.target === wr, `WR1 went deep on the go route (${(wr.x - x0).toFixed(1)} yards)`);
  check(!hotRoute(lineUp(game(12), 'inside_run', 'base', { userSide: 0 }), 'WR1', 'go'), 'no hot routes on a run');
}

// ---------- motion ----------
for (const [def, man] of [['base', true], ['cover3', false]]) {
  const g = game(13);
  const lp = lineUp(g, 'slant', def, { userSide: 0, autoQB: true, formation: 'gun_spread' });
  const cands = motionCandidates(lp);
  check(cands.includes('WR3') && !cands.includes('LT'), `motion candidates (${cands.join(' ')})`);
  const r = lp.off.WR3, y0 = r.y;
  const cov = Object.values(lp.def).find((q) => q.man === r);
  const cy0 = cov?.y;
  check(startMotion(lp, 'WR3'), 'motion started');
  check(!startMotion(lp, 'TE'), 'only one man in motion');
  pre(lp, 0.8);
  check(Math.abs(r.y - y0) > 2.5, `WR3 moved across before the snap (${(r.y - y0).toFixed(1)})`);
  check(r.x < 0, 'the man in motion stays behind the line');
  if (man) check(cov && Math.sign(cov.y - cy0) === Math.sign(r.y - y0) && Math.abs(cov.y - cy0) > 1.5, `his man defender followed him across (${cov ? (cov.y - cy0).toFixed(1) : 'none'})`);
  else check(!cov && Object.values(lp.def).every((q) => Math.hypot(q.x - q.home.x, q.y - q.home.y) < 0.3), 'nobody follows him in zone');
  const moving = Math.hypot(r.vx, r.vy);
  snap(lp);
  check(moving > 1.5, `he is moving at the snap (${moving.toFixed(1)} yd/s)`);
  check(Math.abs(r.route[0].y - r.y) < 8, 'his route starts from where he is');
  for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) step(lp, null);
  check(lp.result != null, `a play with motion vs ${def} finishes`);
}

// ---------- the defense's look ----------
{
  const g = game(14, 1);
  const lp = lineUp(g, 'out', 'cover3', { userSide: 0 });
  const fs = lp.def.FS, z0 = fs.zone.x;
  check(setShade(lp, 'deep') && fs.zone.x > z0 + 2, 'shading over the top deepens the deep zone');
  check(setShade(lp, 'under') && fs.zone.x < z0, 'shading underneath brings it up');
  check(setShade(lp, null) && fs.zone.x === z0, 'normal puts it back');
  check(!canBackOut(lp), 'back out needs a blitz on the call');
  const mlb = lp.def.MLB, x0 = mlb.home.x;
  check(setDisguise(lp, 'show') && mlb.home.x < x0 - 1, 'show blitz walks the linebacker up');
  pre(lp, 1.2);
  check(mlb.x < x0 - 1, `the linebacker walked up before the snap (x ${x0.toFixed(1)} to ${mlb.x.toFixed(1)})`);
  check(lp.off.RB.role === 'route', 'the back is out on his route before the snap');
  snap(lp);
  check(lp.off.RB.role === 'passblock', 'a shown blitz keeps the AI back in to block');
  for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) step(lp, null);
  check(lp.result != null, 'a show-blitz play finishes');
}
{
  const g = game(15, 1);
  const lp = lineUp(g, 'curl', 'mug', { userSide: 0 });
  const mlb = lp.def.MLB, x0 = mlb.home.x;
  check(setDisguise(lp, 'back') && mlb.home.x > x0 + 1.5, 'back out drops the blitzers to normal depth');
  pre(lp, 1.2);
  check(mlb.x > x0 + 1.5, `the linebacker backed out (x ${x0.toFixed(1)} to ${mlb.x.toFixed(1)})`);
  check(run(lp) != null, 'a backed-out blitz finishes');
  const lpU = lineUp(game(15), 'curl', 'mug', { userSide: 0 });
  check(!setDisguise(lpU, 'show') && !setShade(lpU, 'deep'), 'the offense cannot change the defense');
}

// ---------- difficulty ----------
{
  // Pro is the game as it was: same play, same result.
  const a = game(21), b = game(21);
  applyDifficulty(b, 'pro', b.teams[0].id);
  const ra = autoPlay(createLivePlay(a, 'curl', 'cover3', { userSide: 0 })), rb = autoPlay(createLivePlay(b, 'curl', 'cover3', { userSide: 0 }));
  check(JSON.stringify(ra) === JSON.stringify(rb), 'Pro plays exactly like no difficulty');
  const id = Object.values(a.teams[0].lineup)[0];
  check(eff(a, 0, id, 'spd') === eff(b, 0, id, 'spd'), 'Pro leaves the ratings alone');
  const r = game(21); applyDifficulty(r, 'rookie', r.teams[0].id);
  const l = game(21); applyDifficulty(l, 'legend', l.teams[0].id);
  check(eff(r, 0, id, 'spd') > eff(a, 0, id, 'spd') && eff(l, 0, id, 'spd') < eff(a, 0, id, 'spd'), 'Rookie lifts the user side, Legend lowers it');
  const opp = Object.values(a.teams[1].lineup)[0];
  check(eff(r, 1, opp, 'spd') !== eff(a, 1, opp, 'spd') || a.form[1] === 0, 'the form swing is scaled for the AI side too');
  const lr = createLivePlay(r, 'curl', 'cover3', { userSide: 0 }), ll = createLivePlay(l, 'curl', 'cover3', { userSide: 0 }), lpro = createLivePlay(a, 'curl', 'cover3', { userSide: 0 });
  check(lr.userReach === DIFFICULTY.rookie.catchReach && ll.userReach === DIFFICULTY.legend.catchReach && lpro.userReach === 0, 'catch radius by level');
  const lag = (lp) => Object.values(lp.def).filter((p) => p.lag != null).reduce((s, p) => s + p.lag, 0);
  check(lag(lr) > lag(lpro) && lag(ll) < lag(lpro), 'AI defenders read slower on Rookie, faster on Legend');
  // Over many simulated games the user's side wins most on Rookie, least on Legend.
  const N = Number(process.env.DIFF_GAMES ?? 160);
  const wins = {};
  for (const lvl of ['rookie', 'pro', 'legend']) {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const home = i % 2 === 0, A = L.teams[i % 8], B = L.teams[(i + 1 + (i >> 3) % 7) % 8];
      const g = createGame({ home: teamForGame(home ? A : B), away: teamForGame(home ? B : A), seed: 5000 + i });
      applyDifficulty(g, lvl, A.id);
      simUntil(g, 'game');
      const us = home ? 0 : 1;
      w += g.score[us] > g.score[1 - us] ? 1 : g.score[us] === g.score[1 - us] ? 0.5 : 0;
    }
    wins[lvl] = w / N;
  }
  console.log(`user win rate over ${N} games: rookie ${(wins.rookie * 100).toFixed(0)}%  pro ${(wins.pro * 100).toFixed(0)}%  legend ${(wins.legend * 100).toFixed(0)}%`);
  check(wins.rookie > wins.pro + 0.05 && wins.pro > wins.legend + 0.05, 'win rate falls from Rookie to Pro to Legend');
}

// ---------- scouting ----------
{
  const g = game(31);
  const us = 0;
  check(tendencyFit(g, us) === null, 'no Fits hint before there is anything to go on');
  // Their defense blitzed every 3rd and long so far.
  for (let i = 0; i < 5; i++) g.log.push({ kind: 'play', off: 'curl', def: 'pass_blitz', down: 3, toGo: 8, team: us });
  g.poss = us; g.down = 3; g.toGo = 9;
  const f = tendencyFit(g, us);
  check(f?.call === 'screen' && /blitz/.test(f.why), `blitzing defense: ${f?.call} (${f?.why})`);
  // Their offense ran on early downs.
  for (let i = 0; i < 6; i++) g.log.push({ kind: 'play', off: 'inside_run', def: 'base', down: 1, toGo: 10, team: 1 });
  g.poss = 1; g.down = 1; g.toGo = 10;
  const f2 = tendencyFit(g, us);
  check(f2?.call === 'run_blitz' && /run/.test(f2.why), `running offense: ${f2?.call} (${f2?.why})`);
  const e = typeEdges(g, us);
  check(e.rows.length > 0 && e.good + e.bad <= e.rows.length, 'type edges counted');
}

console.log(`${checks - failures} of ${checks} checks passed in ${Date.now() - t0} ms`);
if (failures) process.exit(1);
