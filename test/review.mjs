// Replay review and the film room's tape, through the same simulation the 3D game runs.
//   - the officials miss only close plays (spot, goal line, fumble), and not too often
//   - a reversed call leaves the game exactly as if the play had been ruled right the first time
//   - a lost challenge costs the challenge and a timeout; a won one keeps the timeout
//   - the booth takes the last two minutes and close scoring plays and turnovers, coaches the rest
//   - the tape plays a recording to the same end, a seek lands on the same step as playing
//     through, and a clip file round-trips to the same play
// Usage: node test/review.mjs [games]. Exits non-zero on any failure.
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runPlay, runLivePlay, snapClock, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, playSeconds } from '../src/live.js';
import { applyDeltas, boothReviews, canChallenge, decideReview, fieldRuling } from '../src/review.js';
import { CHECKPOINT, advance, clipFromJson, clipJson, makeTape, seekTape } from '../src/film.js';

const N = Number(process.argv[2] ?? 10);
const L = createLeague({ seed: 11, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

let checks = 0, failures = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.log(`FAIL ${what}`); } };
const endKey = (lp) => `${lp.end?.how ?? lp.phase}@${(lp.spotX ?? lp.ball.x).toFixed(4)},${lp.ball.y.toFixed(4)}`;
// The parts of a game a ruling can change.
const state = (g) => JSON.stringify({ score: g.score, poss: g.poss, spot: g.spot, down: g.down, toGo: g.toGo, phase: g.phase, clock: g.clock, q: g.quarter,
  stats: g.teams.map((t) => t.stats), team: g.teams.map((t) => ({ ...t.team, top: 0 })), drives: g.drives.length });

// A live play recorded the way the 3D game records it: a null input for each step of the walk
// to the line, the snap mark, then each step's input. The user steers (a little, now and then)
// so the recording carries real inputs.
function recordPlay(g, off, def, steer) {
  const rec = { log: [], off, def };
  const lp = createLivePlay(g, off, def, steer ? { userSide: g.poss, autoQB: true } : {});
  for (let i = 0; i < 900 && !lp.set; i++) { step(lp, null); rec.log.push(null); }
  rec.log.push({ snap: true, control: lp.control ? [lp.control.side, lp.control.slot] : null });
  rec.atSnap = structuredClone(lp);
  snap(lp);
  for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) {
    const inp = steer && i % 40 < 12 ? { mx: Math.sin(i / 7), my: 0.6, sprint: i % 80 < 30 } : null;
    step(lp, inp); rec.log.push(inp);
  }
  rec.end = endKey(lp);
  return { lp, rec };
}

const seen = { plays: 0, close: 0, wrong: 0, kinds: {}, reversed: 0, stands: 0, booth: 0, coach: 0, taped: 0 };
for (let gi = 0; gi < N; gi++) {
  const a = gi % 8, b = (a + 1 + (gi % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 900 + gi });
  let n = 0;
  while (!g.final && n++ < 400) {
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    const k = OFF_PLAYS[off].kind;
    if (!(k === 'run' || k === 'pass') || g.phase !== 'play') { runPlay(g, off, def); continue; }
    if (!snapClock(g, null, off)) continue;
    // Some plays are steered by a user (a little, now and then) so their tapes carry real
    // inputs; the rest are all autopilot, like the AI's plays.
    const taped = seen.taped < 40 && n % 3 === 0;
    const { lp, rec } = recordPlay(g, off, def, taped);
    seen.plays++;
    const R = fieldRuling(lp);
    // The tape: plays to the recorded end, seeks, and round-trips through a clip file.
    if (taped) {
      seen.taped++;
      const tape = makeTape(rec);
      const run = seekTape(tape, 0);
      for (let j = 0; j < tape.n; j++) advance(tape, run, j);
      check(endKey(run) === rec.end, `the tape plays to the recorded end (${endKey(run)} vs ${rec.end})`);
      const mid = Math.min(tape.n, CHECKPOINT * 2 + 7);
      const lin = seekTape(tape, 0);
      for (let j = 0; j < mid; j++) step(lin, tape.inputs[j]);
      const sk = seekTape(tape, mid);
      check(JSON.stringify(sk.players.map((p) => [p.x, p.y])) === JSON.stringify(lin.players.map((p) => [p.x, p.y])), `a seek to step ${mid} matches playing through`);
      const back = seekTape(tape, 5);
      check(back.t < sk.t && back.phase === 'live', 'a seek back lands earlier in the play');
      const clip = clipFromJson(clipJson(rec, { label: 'test' }));
      const ct = makeTape(clip.rec);
      const cr = seekTape(ct, ct.n);
      check(endKey(cr) === rec.end, `a clip file plays to the same end (${endKey(cr)} vs ${rec.end})`);
      check(clip.meta.label === 'test', 'a clip keeps its label');
    }
    const secs = playSeconds(lp);
    if (!R) { runLivePlay(g, off, def, lp.result, secs); continue; }
    seen.close++; seen.kinds[R.kind] = (seen.kinds[R.kind] ?? 0) + 1;
    check(R.truth === lp.result, 'the truth is the play as it happened');
    check(R.wrong ? R.call !== R.truth : R.call === R.truth, 'a right call is the truth itself');
    if (R.kind === 'spot' && R.wrong) check((R.call.yards >= g.toGo) !== (R.truth.yards >= g.toGo), `a missed spot flips the first down (${R.call.yards} vs ${R.truth.yards}, ${g.toGo} to go)`);
    if (R.kind === 'goal' && R.wrong) check((R.call.yards >= lp.goalX) !== (R.truth.yards >= lp.goalX), 'a missed goal-line call flips the touchdown');
    if (R.kind === 'fumble' && R.wrong) check(!R.call.turnover && R.truth.turnover === 'fumble', 'a missed fumble is ruled down by contact');
    // As the 3D game does it: the call goes on the books, with a copy of the game before it.
    const preG = structuredClone(g);
    if (R.wrong) { seen.wrong++; applyDeltas(g, R.deltas, 1); }
    const pre = structuredClone(g);
    runLivePlay(g, off, def, R.call, secs);
    const rv = { ruling: R, pre, playNo: g.playNo, booth: boothReviews(R, pre), done: false };
    if (rv.booth) seen.booth++; else seen.coach++;
    if (rv.booth) check(!canChallenge(g, rv, R.against), 'no coach challenges what the booth reviews');
    const by = rv.booth ? null : R.against;
    if (by != null && !canChallenge(g, rv, by)) { continue; }
    const before = { ch: [...g.challenges], to: [...g.timeouts] };
    const out = decideReview(g, rv, by, (gg, r) => runLivePlay(gg, off, def, r, secs));
    check(!canChallenge(g, rv, 1 - (by ?? 0)) && !canChallenge(g, rv, by ?? 0), 'a play is reviewed only once');
    if (R.wrong) {
      seen.reversed++;
      check(out.verdict === 'reversed', 'a wrong call is reversed');
      // The same game as if the officials had seen it right.
      const ref = structuredClone(preG);
      runLivePlay(ref, off, def, R.truth, secs);
      const want = { ...JSON.parse(state(ref)) }, got = JSON.parse(state(g));
      check(JSON.stringify(got) === JSON.stringify(want), `a reversal leaves the game as if ruled right (${R.kind})`);
      if (by != null) check(g.challenges[by] === before.ch[by] - 1 && g.timeouts[by] === before.to[by], 'a won challenge keeps the timeout');
    } else {
      seen.stands++;
      check(out.verdict === (by == null ? 'confirmed' : 'stands'), 'a right call stands');
      if (by != null) check(g.challenges[by] === before.ch[by] - 1 && g.timeouts[by] === before.to[by] - 1, 'a lost challenge costs the challenge and a timeout');
    }
  }
}

// Each side gets its challenge back at halftime.
{
  const g = createGame({ home: teamForGame(L.teams[0]), away: teamForGame(L.teams[1]), seed: 77 });
  check(JSON.stringify(g.challenges) === '[1,1]', 'a game starts with a challenge each');
  g.challenges = [0, 0];
  for (let i = 0; i < 400 && g.quarter < 3 && !g.final; i++) runPlay(g, aiOffenseCall(g), aiDefenseCall(g));
  check(g.quarter === 3 && JSON.stringify(g.challenges) === '[1,1]', `the challenges come back at halftime (${JSON.stringify(g.challenges)})`);
}

const pct = (x) => (100 * x / seen.plays).toFixed(2);
console.log(`${seen.plays} live plays: ${seen.close} close (${pct(seen.close)}%), ${seen.wrong} missed (${pct(seen.wrong)}%) · ${JSON.stringify(seen.kinds)}`);
console.log(`reviews: ${seen.booth} by the booth, ${seen.coach} open to a coach · ${seen.reversed} reversed, ${seen.stands} stood · ${seen.taped} tapes checked`);
check(seen.close > 0 && seen.wrong > 0, 'some plays are close and some calls are missed');
check(seen.wrong / seen.plays < 0.04, `the officials miss under 4% of plays (${pct(seen.wrong)}%)`);
check(seen.wrong / seen.plays > 0.003, `but they do miss some (${pct(seen.wrong)}%)`);
check(seen.kinds.spot > 0 && seen.kinds.goal > 0, 'spots and goal-line calls both come up');
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
