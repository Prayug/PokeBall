// Clock rules, timeouts, the try after a touchdown and kickoffs, checked through the real
// simulation: hand-built situations for each rule, then whole seeded games played by the AI on
// both sides with the rules checked after every snap. Exits non-zero on any failure.
// Usage: node test/clock.mjs [games, default 300]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { afterLines, createBooth } from '../src/commentary.js';
import * as E from '../src/engine.js';

const GAMES = Number(process.argv[2] ?? 300);
const t0 = Date.now();
let failures = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; if (failures <= 40) console.log(`FAIL ${what}`); } };

const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const game = (seed, opts = {}) => E.createGame({ home: teamForGame(L.teams[seed % 8]), away: teamForGame(L.teams[(seed + 3) % 8]), seed, weather: 'clear', ...opts });
// A game set to a situation: the offense (poss) has the ball at spot, down and distance, in
// the quarter with clock seconds left, and the score.
function situation(seed, s) {
  const g = game(seed);
  Object.assign(g, { phase: 'play', poss: s.poss ?? 0, spot: s.spot ?? 50, down: s.down ?? 1, toGo: s.toGo ?? 10, quarter: s.quarter ?? 1,
    clock: s.clock ?? 900, score: s.score ?? [0, 0], clockRunning: s.running ?? false, timeouts: s.timeouts ?? [3, 3], warned: {} });
  g.manual = s.manual ?? [false, false];
  return g;
}
const statsOf = (g) => JSON.stringify(g.teams.map((t) => [t.stats, t.team]));

// ---------- the clock between plays ----------
{
  // A running clock takes its runoff at the snap; a stopped one does not.
  const g = situation(1, { clock: 600, running: true });
  E.snapClock(g, 'normal', 'inside_run');
  check(g.clock <= 600 - 32 && g.clock >= 600 - 40 && !g.clockRunning, `huddle runoff 32-40 s (took ${600 - g.clock})`);
  const h = situation(1, { clock: 600, running: true });
  E.snapClock(h, 'hurry', 'slant');
  check(600 - h.clock >= 7 && 600 - h.clock <= 13, `no-huddle runoff 7-13 s (took ${600 - h.clock})`);
  const s = situation(1, { clock: 600, running: false });
  E.snapClock(s, 'normal', 'slant');
  check(s.clock === 600, 'a stopped clock takes no runoff');
  // A timeout before the snap saves the runoff.
  const t = situation(1, { clock: 300, running: true, quarter: 4 });
  check(E.callTimeout(t, 1) && t.timeouts[1] === 2 && !t.clockRunning, 'a timeout stops the clock and costs one');
  E.snapClock(t, 'normal', 'slant');
  check(t.clock === 300, 'no runoff after a timeout');
  const none = situation(1, { timeouts: [0, 0] });
  check(!E.callTimeout(none, 0), 'no timeout with none left');
  // The two-minute warning stops the runoff at 2:00, once.
  const w = situation(2, { quarter: 4, clock: 130, running: true });
  E.snapClock(w, 'normal', 'slant');
  check(w.clock === 120 && w.warned[4] && w.log.at(-1).head === 'Two-minute warning', 'two-minute warning at 2:00');
  // The quarter runs out before the snap when the runoff is longer than what is left.
  const x = situation(3, { quarter: 1, clock: 20, running: true });
  check(!E.snapClock(x, 'normal', 'slant') && x.quarter === 2 && x.clock === 900, 'the first quarter runs out on the runoff');
  const y = situation(3, { quarter: 2, clock: 20, running: true, spot: 10, score: [0, 7] });
  check(!E.snapClock(y, 'normal', 'slant') && y.quarter === 3 && y.timeouts.join() === '3,3', 'halftime on the runoff, timeouts back to three');
}

// ---------- what stops the clock ----------
{
  let inc = 0, incRun = 0, oobLate = 0, oobLateRun = 0, oobEarly = 0, oobEarlyRun = 0;
  for (let i = 0; i < 1500; i++) {
    const late = i % 2 === 1;
    const g = situation(100 + i, { quarter: late ? 4 : 1, clock: late ? 200 : 700, spot: 30, score: [10, 10], poss: i % 2 });
    const e = E.runPlay(g, ['out', 'flood', 'outside_run', 'toss'][i % 4], 'cover3');
    if (!e || g.poss !== e.team || e.kind !== 'play') continue;
    if (/incomplete/.test(e.text)) { inc++; if (g.clockRunning) incRun++; }
    if (e.oob) { if (late) { oobLate++; if (g.clockRunning) oobLateRun++; } else { oobEarly++; if (g.clockRunning) oobEarlyRun++; } }
  }
  check(inc > 20 && incRun === 0, `an incompletion stops the clock (${incRun} of ${inc} kept running)`);
  check(oobLate > 20 && oobLateRun === 0, `out of bounds in the last five minutes stops it (${oobLateRun} of ${oobLate} kept running)`);
  check(oobEarly > 20 && oobEarlyRun === oobEarly, `out of bounds earlier lets it run (${oobEarlyRun} of ${oobEarly})`);
}

// ---------- spike and kneel ----------
{
  const g = situation(4, { quarter: 4, clock: 40, running: true, timeouts: [0, 3], spot: 60, down: 1, score: [17, 20] });
  check(E.aiOffenseCall(g) === 'spike', 'trailing with a running clock and no timeouts: spike');
  const before = g.down;
  E.snapClock(g, 'hurry', 'spike');
  const e = E.runPlay(g, 'spike', 'base');
  check(e && g.down === before + 1 && !g.clockRunning && 40 - g.clock <= 7, `the spike costs a down and a few seconds, then stops the clock (${40 - g.clock} s)`);
  // A lead and no way for the defense to stop the clock: kneel it out.
  const k = situation(5, { quarter: 4, clock: 90, running: true, timeouts: [3, 0], spot: 40, down: 1, score: [24, 20] });
  let n = 0;
  while (!k.final && n++ < 10) { check(E.aiOffenseCall(k) === 'kneel', `kneel with ${k.clock} s left`); E.simPlay(k); }
  check(k.final && k.winner === 0 && k.score.join() === '24,20', `kneeling runs out the clock (${k.score} final ${k.final})`);
  const nok = situation(5, { quarter: 4, clock: 200, running: false, timeouts: [3, 3], spot: 40, down: 1, score: [24, 20] });
  check(!E.canKneelOut(nok), 'too much time to kneel against three timeouts');
}

// ---------- the try ----------
{
  check(E.convertLean(situation(6, { quarter: 4, score: [18, 20] })) === 'two', 'down 2 late: go for two');
  check(E.convertLean(situation(6, { quarter: 2, score: [18, 20] })) === 'xp', 'in the first half: kick it');
  // A side whose choices wait: the touchdown stops at the try, with the score at six more.
  let made = 0, tries = 0, xps = 0;
  for (let i = 0; i < 400; i++) {
    const g = situation(200 + i, { poss: i % 2, spot: 97, down: 1, toGo: 3, manual: [true, true] });
    let guard = 0;
    while (g.phase === 'play' && guard++ < 6 && g.score.every((v) => v === 0)) E.simPlay(g);
    if (g.phase !== 'pat') continue;
    const o = g.poss;
    check(g.score[o] === 6 && g.spot === 98, 'the try waits after a touchdown, from the 2');
    const stats = statsOf(g);
    const two = i % 2 === 0;
    const e = E.runPlay(g, two ? 'slant' : 'xp', 'goal_line');
    check(statsOf(g) === stats || !two, 'a two-point play leaves the stats as they were');
    check(g.phase === 'kickoff' && g.poss === o, `after the try, the scoring side kicks off (${g.phase})`);
    if (two) { tries++; if (g.score[o] === 8) made++; check(g.score[o] === 6 || g.score[o] === 8, 'two points or none'); }
    else { if (g.score[o] === 7) xps++; check(g.score[o] === 6 || g.score[o] === 7, 'one point or none'); }
    check(!!e && e.conversion, 'the try is logged');
    E.runPlay(g, 'kick_deep', 'base');
    check((g.phase === 'play' || g.phase === 'pat') && g.poss === 1 - o, 'the kickoff gives the other side the ball (or a return touchdown)');
  }
  check(tries > 50 && made / tries > 0.3 && made / tries < 0.75, `two-point tries succeed about half the time (${made}/${tries})`);
  check(xps > 50, `extra points get kicked (${xps})`);
  // A spot that rounds to the goal line is still a miss. The booth must not call it good.
  const short = situation(9, { poss: 0, spot: 98, score: [6, 0], manual: [true, true] });
  short.phase = 'pat';
  const beforeShort = { score: [6, 0], poss: 0, down: 1 };
  const miss = E.runLivePlay(short, 'inside_run', 'goal_line', { kind: 'run', yards: 2, td: false, text: 'He is stopped a yard short for 2 yards.', carrier: short.teams[0].lineup.RB }, 4);
  check(short.score.join() === '6,0', `a two-point try stopped short adds nothing (${short.score})`);
  check(miss?.head === 'Two-point try fails' && !/GOOD!/.test(miss.text ?? ''), `a miss is called a miss (${miss?.head} ${miss?.text})`);
  const missSaid = afterLines(createBooth(3), short, miss, beforeShort).map((l) => l.text).join(' ');
  check(/short|No good/i.test(missSaid) && !/try is good|In for two|They get it/i.test(missSaid), `the booth calls the miss (${missSaid})`);
  const madeTry = situation(10, { poss: 0, spot: 98, score: [6, 0], manual: [true, true] });
  madeTry.phase = 'pat';
  const beforeMade = { score: [6, 0], poss: 0, down: 1 };
  const make = E.runLivePlay(madeTry, 'inside_run', 'goal_line', { kind: 'run', yards: 2, td: true, text: 'He walks in. TOUCHDOWN!', carrier: madeTry.teams[0].lineup.RB }, 4);
  check(madeTry.score.join() === '8,0', `a made two-point try adds two once (${madeTry.score})`);
  check(make?.head === 'Two-point conversion', `a make is a conversion (${make?.head})`);
  const makeSaid = afterLines(createBooth(4), madeTry, make, beforeMade).map((l) => l.text).join(' ');
  check(/good|In for two|They get it/i.test(makeSaid) && !/no good|come up short/i.test(makeSaid), `the booth calls the make (${makeSaid})`);
}

// ---------- onside kicks ----------
{
  let exp = 0, expRec = 0, sur = 0, surRec = 0;
  for (let i = 0; i < 600; i++) {
    const late = i % 2 === 0;
    const g = situation(400 + i, { quarter: late ? 4 : 1, clock: late ? 100 : 800, score: late ? [10, 17] : [0, 0], manual: [true, true] });
    g.phase = 'kickoff'; g.kick = { kicker: 0, free: false }; g.poss = 0;
    check(E.onsideLean(g, 0) === late, 'the onside lean is late and behind');
    E.runPlay(g, 'onside', 'base');
    if (late) { exp++; if (g.poss === 0) expRec++; } else { sur++; if (g.poss === 0) surRec++; }
    check(g.phase === 'play' && g.down === 1, 'play goes on after the onside kick');
  }
  check(expRec / exp > 0.03 && expRec / exp < 0.25, `an expected onside kick is recovered now and then (${expRec}/${exp})`);
  check(surRec / sur > 0.3, `a surprise onside kick works far more often (${surRec}/${sur})`);
}

// ---------- whole games ----------
const tally = { to: 0, warn: 0, spikes: 0, kneels: 0, twoTries: 0, onside: 0 };
const fingerprint = [];
for (let i = 0; i < GAMES; i++) {
  const g = game(1000 + i, { playoff: i % 5 === 0 });
  let n = 0, prevQ = 1;
  while (!g.final && n++ < 600) {
    E.simPlay(g);
    check(g.timeouts.every((v) => v >= 0 && v <= 3), `game ${i}: timeouts stay 0 to 3`);
    check(g.phase === 'play' || g.phase === 'final', `game ${i}: AI tries and kickoffs never wait (${g.phase})`);
    check(g.clock >= 0 && g.clock <= 900, `game ${i}: the clock stays in range`);
    if (g.quarter === 3 && prevQ === 2) check(g.timeouts.join() === '3,3', `game ${i}: three timeouts each after halftime`);
    prevQ = g.quarter;
  }
  check(g.final, `game ${i} finishes`);
  for (const ti of [0, 1]) check(g.qs[ti].reduce((a, b) => a + (b ?? 0), 0) === g.score[ti], `game ${i}: the quarter scores add up`);
  const warns = g.log.filter((e) => e.head === 'Two-minute warning');
  check(warns.length <= 2 && new Set(warns.map((e) => e.q)).size === warns.length, `game ${i}: at most one two-minute warning a half`);
  for (const e of g.log) {
    if (e.kind === 'timeout') tally.to++;
    if (e.head === 'Two-minute warning') tally.warn++;
    if (e.head === 'Spike') tally.spikes++;
    if (e.head === 'Kneel') tally.kneels++;
    if (/Two-point try/.test(e.text)) tally.twoTries++;
    if (/onside/i.test(e.text)) tally.onside++;
  }
  if (i < 20) fingerprint.push(`${g.score}:${g.log.length}`);
}
check(tally.warn > GAMES * 1.5, `two-minute warnings in most halves (${tally.warn} in ${GAMES} games)`);
check(tally.to > GAMES && tally.to < GAMES * 9, `timeouts get used (${(tally.to / GAMES).toFixed(1)} a game)`);
check(tally.spikes > 0 && tally.kneels > 0 && tally.twoTries > 0 && tally.onside > 0, `spikes, kneels, two-point tries and onside kicks all happen (${JSON.stringify(tally)})`);
// The same seed plays the same game.
const again = [];
for (let i = 0; i < 20; i++) { const g = game(1000 + i, { playoff: i % 5 === 0 }); E.simUntil(g, 'game'); again.push(`${g.score}:${g.log.length}`); }
check(again.join() === fingerprint.join(), 'seeded games replay exactly');

console.log(`${checks - failures} of ${checks} checks passed in ${Date.now() - t0} ms`, JSON.stringify(tally));
process.exit(failures ? 1 : 0);
