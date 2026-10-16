// Penalties: how each foul is enforced, the accept-or-decline choice (the AI's and the user's),
// fouls before the snap, and whole seeded AI-vs-AI games with the flag rates and the game state
// checked after every snap. Exits non-zero on any failure.
// Usage: node test/penalties.mjs [games, default 200]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import * as E from '../src/engine.js';
import { PENALTIES, RATES, enforce, sloppy } from '../src/penalties.js';

const GAMES = Number(process.argv[2] ?? 200);
const t0 = Date.now();
let failures = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; if (failures <= 40) console.log(`FAIL ${what}`); } };

const L = createLeague({ seed: 11, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const game = (seed) => E.createGame({ home: teamForGame(L.teams[seed % 8]), away: teamForGame(L.teams[(seed + 3) % 8]), seed, weather: 'clear' });
function situation(seed, s) {
  const g = game(seed);
  Object.assign(g, { phase: 'play', poss: s.poss ?? 0, spot: s.spot ?? 50, down: s.down ?? 1, toGo: s.toGo ?? 10, quarter: s.quarter ?? 1,
    clock: s.clock ?? 900, score: s.score ?? [0, 0], clockRunning: false, timeouts: [3, 3], warned: {} });
  g.manual = s.manual ?? [false, false];
  return g;
}
// Run fn with some foul rates forced (the rest zeroed), then put the real rates back.
function forced(rates, fn) {
  const saved = { ...RATES };
  for (const k of Object.keys(RATES)) RATES[k] = 0;
  Object.assign(RATES, rates);
  try { return fn(); } finally { Object.assign(RATES, saved); }
}

// ---------- enforcement ----------
{
  const b = (spot, down = 2, toGo = 7) => ({ poss: 0, spot, down, toGo });
  let a = enforce(b(40), { type: 'hold_off', x: -1 });
  check(a.spot === 30 && a.down === 2 && a.toGo === 17 && !a.first, 'offensive holding: back 10, repeat the down');
  a = enforce(b(8), { type: 'hold_off', x: -1 });
  check(a.spot === 4 && a.moved === -4, `holding at the 8 is half the distance (to ${a.spot})`);
  a = enforce(b(40, 3, 3), { type: 'offside', x: 0 });
  check(a.spot === 45 && a.first && a.down === 1, 'offside for 5 on 3rd and 3 is a first down');
  a = enforce(b(40, 3, 8), { type: 'offside', x: 0 });
  check(a.spot === 45 && a.down === 3 && a.toGo === 3, 'offside for 5 on 3rd and 8 leaves 3rd and 3');
  a = enforce(b(96, 3, 4), { type: 'offside', x: 0 });
  check(a.spot === 98 && a.moved === 2, 'offside at the 4 is half the distance');
  a = enforce(b(40, 3, 15), { type: 'hold_def', x: 6 });
  check(a.spot === 45 && a.first && a.toGo === 10, 'defensive holding is an automatic first down');
  a = enforce(b(30, 2, 10), { type: 'dpi', x: 27 });
  check(a.spot === 57 && a.first, `interference is a spot foul (to ${a.spot})`);
  a = enforce(b(85, 2, 10), { type: 'dpi', x: 20 });
  check(a.spot === 99 && a.toGo === 1, 'interference in the end zone puts the ball at the 1');
  a = enforce(b(40), { type: 'opi', x: 8 });
  check(a.spot === 30 && a.down === 2, 'offensive interference: back 10, repeat the down');
  a = enforce(b(40), { type: 'false_start', x: 0 });
  check(a.spot === 35 && a.toGo === 12, 'false start: back 5');
  for (const k of Object.keys(PENALTIES)) check(!!PENALTIES[k].name, `${k} has a name`);
  check(sloppy(40) > sloppy(70) && sloppy(70) > sloppy(100) && Math.abs(sloppy(70) - 1) < 1e-9, 'low awareness draws more flags');
}

// ---------- a foul before the snap ----------
{
  const g = situation(3, { spot: 40, down: 2, toGo: 6, clock: 500 });
  const before = JSON.stringify(g.teams.map((t) => t.stats));
  const e = forced({ falseStart: 1 }, () => E.runPlay(g, 'inside_run', 'base'));
  check(e?.kind === 'penalty' && e.foul?.type === 'false_start', 'a false start is flagged before the snap');
  check(g.spot === 35 && g.down === 2 && g.toGo === 11, `false start walks off 5 and repeats the down (${g.down} & ${g.toGo} at ${g.spot})`);
  check(g.clock === 500, 'no time comes off for a dead-ball foul');
  check(JSON.stringify(g.teams.map((t) => t.stats)) === before, 'no player stats for a play that never happened');
  check(g.teams[0].team.pen === 1 && g.teams[0].team.penYds === 5, 'the penalty counts in the team totals');
  const h = situation(3, { spot: 40, down: 3, toGo: 4 });
  forced({ offside: 1 }, () => E.runPlay(h, 'slant', 'base'));
  check(h.spot === 45 && h.down === 1 && h.toGo === 10, 'offside on 3rd and 4 moves the chains');
}

// ---------- delay of game (the play clock running out on the call sheet) ----------
{
  const g = situation(4, { spot: 40, down: 3, toGo: 2, clock: 600 });
  g.clockRunning = true;
  const e = E.delayOfGame(g);
  check(e?.foul?.type === 'delay_of_game' && g.spot === 35 && g.down === 3 && g.toGo === 7, `delay of game: back 5, repeat the down (${g.down} & ${g.toGo} at ${g.spot})`);
  check(600 - g.clock >= 38 && 600 - g.clock <= 40, `the full play clock ran off (${600 - g.clock} s)`);
  check(g.clockRunning, 'the clock starts again on the ready signal');
  check(/Delay of game/.test(e.text), 'the referee announces it');
  const late = situation(4, { quarter: 2, clock: 20, spot: 40 });
  late.clockRunning = true;
  check(E.delayOfGame(late) == null && late.quarter === 3, 'a delay with the clock running out ends the half instead');
  const stopped = situation(4, { clock: 300, spot: 6 });
  E.delayOfGame(stopped);
  check(stopped.clock === 300 && stopped.spot === 3, 'a stopped clock stays put; half the distance near the goal');
}

// ---------- accept or decline ----------
{
  // The user's defense was fouled: the game waits for the call, both outcomes described.
  const g = situation(5, { spot: 40, down: 2, toGo: 6, manual: [false, true] });
  const stats = JSON.stringify(g.teams.map((t) => t.stats));
  const e = forced({ holdBlock: 1 }, () => E.runPlay(g, 'inside_run', 'base'));
  check(g.phase === 'penalty' && g.pending?.offended === 1 && e?.pendingFlag, 'a foul against the user waits for accept or decline');
  check(!!g.pending?.acceptText && !!g.pending?.declineText, 'both choices are described');
  check(E.aiOffenseCall(g) === (g.pending.aiAccept ? 'accept' : 'decline'), 'the AI call in the penalty phase is its own choice');
  check(E.downText(g) === 'Flag', 'the down line reads Flag while the choice is open');
  const a = structuredClone(g), d = structuredClone(g);
  E.decidePenalty(a, true);
  check(a.phase === 'play' && a.spot === 30 && a.down === 2 && a.toGo === 16, `accepted: back 10, repeat 2nd down (${a.down} & ${a.toGo} at ${a.spot})`);
  const noPen = (t) => JSON.stringify(Object.fromEntries(Object.entries(t.stats).map(([id, x]) => [id, { ...x, pen: undefined }])));
  check(a.teams.map(noPen).join() === JSON.parse(stats).map((st) => noPen({ stats: st })).join(), 'accepted: the play\'s stats come off (only the flag is counted)');
  check(Object.values(a.teams[0].stats).some((x) => x.pen === 1), 'the flag is counted against the player');
  E.decidePenalty(d, false);
  check(d.phase === 'play' && d.pending == null && (d.spot !== 30 || d.down !== 2), 'declined: the play stands');
  check(E.decidePenalty(d, true) == null, 'no choice once the penalty is settled');
  // Through runPlay, the way the call sheet sends it.
  const r = structuredClone(g);
  E.runPlay(r, 'accept', 'base');
  check(r.phase === 'play' && r.spot === 30, 'the Accept call takes the penalty');

  // The user's offense was fouled (defensive holding on a pass): the offense gets the choice.
  let seen = 0;
  for (let s2 = 0; s2 < 40 && !seen; s2++) {
    const k = situation(300 + s2, { spot: 40, down: 3, toGo: 12, manual: [true, false] });
    forced({ holdCover: 1 }, () => E.runPlay(k, 'curl', 'cover3'));
    if (k.phase !== 'penalty') continue;
    seen++;
    check(k.pending.offended === 0 && k.pending.acceptText.includes('1st & 10'), 'the offense decides, with a first down on offer');
    E.runPlay(k, 'accept', 'base');
    check(k.spot === 45 && k.down === 1 && k.toGo === 10, `accepted defensive holding: 5 yards and a first down (${k.down} & ${k.toGo} at ${k.spot})`);
  }
  check(seen > 0, 'a defensive foul against the user\'s offense waits for the call');

  // The AI accepts a foul that helps it and declines one that does not.
  let acc = 0, dec = 0;
  for (let s = 0; s < 40; s++) {
    const k = situation(100 + s, { spot: 40, down: 1, toGo: 10 });
    const before = k.spot;
    forced({ holdBlock: 1 }, () => E.runPlay(k, 'inside_run', 'base'));
    const last = k.log[k.log.length - 1];
    if (last.head === 'Holding') { acc++; check(k.spot === before - 10 && k.down === 1, 'accepted holding repeats 1st down from 10 back'); }
    else if (last.head === 'Penalty declined') dec++;
  }
  check(acc > 0, `the AI accepts holding after a gain (${acc} of 40)`);
}

// ---------- whole games ----------
const count = {}, flags = { n: 0 };
let teamGames = 0, points = 0;
for (let s = 0; s < GAMES; s++) {
  const g = game(1000 + s);
  let n = 0;
  while (!g.final && n++ < 700) {
    const len = g.log.length;
    E.simPlay(g);
    check(g.phase !== 'penalty' && g.pending == null, 'AI-vs-AI games never wait on a penalty choice');
    if (g.phase === 'play' && !g.final) check(g.down >= 1 && g.down <= 4 && g.spot >= 1 && g.spot <= 99 && g.toGo >= 1, `sane down and spot after a flag (${g.down} & ${g.toGo} at ${g.spot})`);
    for (const e of g.log.slice(len)) if (e.foul && e.head !== 'Penalty declined') { count[e.foul.type] = (count[e.foul.type] ?? 0) + 1; flags.n++; }
  }
  check(g.final, `game ${s} finishes`);
  for (const t of g.teams) check((t.team.pen ?? 0) >= 0 && (t.team.penYds ?? 0) >= (t.team.pen ?? 0), 'penalty yards add up');
  teamGames += 2; points += g.score[0] + g.score[1];
}
const per = (k) => (count[k] ?? 0) / teamGames;
const all = flags.n / teamGames;
check(all > 1.5 && all < 6, `accepted or enforced flags per team-game in range (${all.toFixed(2)})`);
for (const k of Object.keys(PENALTIES).filter((x) => x !== 'delay_of_game')) check(per(k) > 0.02, `${k} is called (${per(k).toFixed(2)} per team-game)`);
check(per('hold_off') > per('opi'), 'holding is called more than offensive interference');
// Same seed, same game.
const r1 = game(77), r2 = game(77);
E.simUntil(r1, 'game'); E.simUntil(r2, 'game');
while (!r1.final) E.simPlay(r1);
while (!r2.final) E.simPlay(r2);
check(JSON.stringify(r1.score) === JSON.stringify(r2.score) && r1.log.length === r2.log.length, 'a seeded game plays out the same every time');

console.log(`flags per team-game: ${all.toFixed(2)} (${Object.keys(PENALTIES).map((k) => `${k} ${per(k).toFixed(2)}`).join(', ')}) · ${(points / teamGames).toFixed(1)} points per team`);
console.log(`${checks} checks, ${failures} failures, ${GAMES} games in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
