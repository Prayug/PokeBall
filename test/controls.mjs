// Two people in one live play (the two-player game): player one steers a Pokémon on one team
// and player two one on the other, through the same simulation the 3D game runs.
//   - each player starts on their own side (the quarterback on offense, the middle linebacker
//     on defense) and both can steer at once
//   - player two on offense throws: the ball goes out and they take over the receiver
//   - a carrier change (a catch, a handoff) hands that team's player the carrier
//   - a punt: the receiving player gets the returner, the kicking player a cover man
//   - the recorded inputs replay the play to exactly the same end (the instant replay)
// Exits non-zero on any failure.
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame } from '../src/engine.js';
import { createLivePlay, snap, step } from '../src/live.js';

const L = createLeague({ seed: 5, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

let checks = 0, failures = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.log(`FAIL ${what}`); } };

function game(seed, poss) {
  const g = createGame({ home: teamForGame(L.teams[seed % 8]), away: teamForGame(L.teams[(seed + 3) % 8]), seed, weather: 'clear' });
  g.poss = poss; g.spot = 35; g.down = 1; g.toGo = 10;
  return g;
}
const none = { mx: 0, my: 0 };
// Runs a play with an input script for each player: f(t, lp) returns that player's input.
function run(g, off, def, p1, p2, opts = {}) {
  const lp = createLivePlay(g, off, def, { userSide: 0, user2: 1, ...opts });
  for (let i = 0; i < 900 && !lp.set; i++) step(lp, null);
  const start = { c1: lp.control?.side, c2: lp.p2?.control?.side, s1: lp.control?.slot, s2: lp.p2?.control?.slot };
  snap(lp);
  const log = [], seen = { m1: false, m2: false, both: false, handover: null, carrier2: false };
  for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) {
    const inp = { ...none, ...p1(lp.t, lp) };
    inp.p2 = { ...none, ...p2(lp.t, lp) };
    step(lp, inp);
    log.push(inp);
    seen.m1 ||= lp.manual; seen.m2 ||= !!lp.p2.manual;
    seen.both ||= lp.manual && lp.p2.manual && lp.control !== lp.p2.control;
    if (lp.thrown && !seen.handover) seen.handover = { p1: lp.control?.slot, p2: lp.p2.control?.slot };
    if (lp.carrierSet && lp.carrier.ti === 1) seen.carrier2 ||= lp.p2.control === lp.carrier;
  }
  return { lp, start, log, seen };
}
const endKey = (lp) => `${lp.end?.how ?? lp.phase}@${(lp.spotX ?? lp.ball.x).toFixed(3)},${lp.ball.y.toFixed(3)}`;

// Player one on offense (home has the ball), player two on defense.
{
  const g = game(3, 0);
  const R = run(g, 'slant', 'cover3',
    (t) => (t < 0.6 ? { mx: -1, my: 0 } : t < 0.7 ? {} : t < 0.72 ? { throwTo: 'WR1', throwType: 'touch' } : {}),
    (t) => (t < 1.5 ? { mx: 1, my: 0.4, sprint: true } : {}));
  check(R.start.c1 === 'off' && R.start.s1 === 'QB', `P1 on offense starts at quarterback (${R.start.s1})`);
  check(R.start.c2 === 'def' && R.start.s2 === 'MLB', `P2 on defense starts at middle linebacker (${R.start.s2})`);
  check(R.seen.both, 'both players steer their own Pokémon at the same time');
  check(R.seen.handover?.p1 === 'WR1' && R.seen.handover?.p2 !== 'WR1', `P1's throw hands them the receiver (${JSON.stringify(R.seen.handover)})`);
}

// Player two on offense (away has the ball): their throw, their receiver.
{
  const g = game(8, 1);
  const R = run(g, 'curl', 'cover2',
    (t) => (t < 1.2 ? { mx: -1, my: 0.2 } : {}),
    (t) => (t < 0.5 ? { mx: -1 } : t < 0.8 ? {} : t < 0.82 ? { throwTo: 'TE', throwType: 'bullet' } : {}));
  check(R.start.c2 === 'off' && R.start.s2 === 'QB' && R.start.c1 === 'def', 'P2 on offense starts at quarterback, P1 on defense');
  check(R.seen.m1 && R.seen.m2, 'both players steer');
  check(R.seen.handover?.p2 === 'TE', `P2's throw hands them the receiver (${JSON.stringify(R.seen.handover)})`);
  // The instant replay: the same start and the recorded inputs end the play at the same spot.
  const again = createLivePlay(game(8, 1), 'curl', 'cover2', { userSide: 0, user2: 1 });
  for (let i = 0; i < 900 && !again.set; i++) step(again, null);
  snap(again);
  for (const inp of R.log) step(again, inp);
  check(endKey(again) === endKey(R.lp), `the recorded inputs replay the play exactly (${endKey(again)} vs ${endKey(R.lp)})`);
}

// A run by player two's team: the handoff gives player two the carrier.
{
  const g = game(4, 1);
  const R = run(g, 'inside_run', 'base', () => ({}), (t) => (t > 1.2 ? { mx: 1, my: 0 } : {}));
  check(R.seen.carrier2, 'a handoff gives player two the ball carrier');
}

// A punt: the receiving side's player has the returner; the kicking side's player takes a cover man.
{
  const g = game(6, 0);
  g.down = 4;
  const lp = createLivePlay(g, 'punt', 'base', { userSide: 0, user2: 1 });
  check(lp.p2.control && lp.p2.control === lp.kick?.returner, 'P2 receiving a punt starts as the returner');
  for (let i = 0; i < 900 && !lp.set; i++) step(lp, null);
  snap(lp);
  for (let i = 0; i < 60 * 12 && lp.phase === 'live' && !(lp.control && lp.control.side === 'off'); i++) step(lp, { ...none, p2: { ...none } });
  check(lp.control?.side === 'off', `P1 on the kicking team takes a cover man once it is away (${lp.control?.slot ?? 'none'})`);
}

console.log(`${checks - failures} of ${checks} checks passed`);
if (failures) process.exit(1);
