// Football IQ audit: plays many live snaps with all 22 players on autopilot and counts the
// things a player watching would call dumb. Each check is measured from the simulation's own
// state, frame by frame. Prints a rate for each; --strict exits non-zero past the limits.
// Usage: node test/iq.mjs [plays, default 600] [--strict]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, SIDE, DT } from '../src/live.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 600);
const STRICT = process.argv.includes('--strict');
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

const len = Math.hypot;
const C = {
  plays: 0, runs: 0, passes: 0, carries: 0, rushYds: 0, recYds: 0, catches: 0, att: 0, ints: 0, sacks: 0,
  // Offense
  carrierRetreat: 0,      // a carrier who gives up 3+ yards running backward/sideways after taking the ball
  dance: 0,               // a carrier behind the line still not going forward 1.2 s after the handoff
  unforcedOut: 0,         // a carrier who steps out with nobody within 4 yards, short of the sticks, game not late
  safety: 0,              // a carrier taken down in his own end zone after starting outside it
  wrongWayCatch: 0,       // a receiver running back toward the line of scrimmage after an open catch
  idleBlocker: 0,         // offensive player-seconds standing still with nobody to block while the ball is live
  qbIntoCovered: 0,       // throws to a man read as COVERED while another was OPEN
  qbHold: 0,              // the quarterback still holding it past 4 s
  chaseOwn: 0,            // player-steps chasing their own ball carrier (after an interception)
  slides: 0, scrambles: 0,
  // Defense
  idleDefender: 0,        // defender-seconds standing still while a carrier runs free
  wrongWayPursuit: 0,     // defender-seconds running away from the carrier (more than 90 degrees off) within 15 yards
  overrun: 0,             // a pursuer who comes within 2 yards ahead of the carrier and then ends up 3+ yards behind him without contact
  deepBeat: 0,            // a deep-zone or over-the-top defender who lets a receiver get 3+ yards behind him before the throw
  outOfBoundsDef: 0,      // defender-seconds outside the sideline
  circling: 0,            // a player whose path turns through a full loop (300+ degrees) inside two seconds
  qbDeepEscort: 0,        // a quarterback who runs 10+ yards downfield after handing off or throwing
  shortOf3rd: 0,          // 3rd/4th down throws caught or aimed short of the sticks with a man open past them
  // Physics
  overspeed: 0,           // player-steps faster than 1.12x top speed when not shoved or in a tackle
  overlapDeep: 0,         // pair-steps overlapping by more than half their radii, not blocking or tackling
  liveSecs: 0,
};
const seen = (k, v = 1) => { C[k] += v; };

for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 9000 + i, weather: 'clear' });
  g.spot = 10 + ((i * 37) % 75); g.down = 1 + (i % 4); g.toGo = Math.min([10, 3, 7, 12, 1, 5, 15][i % 7], 100 - g.spot); g.poss = i % 2;
  const off = aiOffenseCall(g), def = aiDefenseCall(g);
  const k = OFF_PLAYS[off].kind;
  if (k !== 'run' && k !== 'pass') continue;
  const lp = createLivePlay(g, off, def, {});
  snap(lp);
  C.plays++; k === 'run' ? C.runs++ : C.passes++;
  const st = new Map(lp.players.map((p) => [p, { still: 0, wrong: 0, ahead: false, turns: [], looped: false }]));
  let carrier = null, cStart = null, cMinX = 0, cMaxX = -99, danced = false, wrongCatch = false, throwChecked = false, deepFlag = new Set();
  for (let s = 0; s < 60 * 16 && lp.phase === 'live'; s++) {
    // Before the step: what the quarterback is about to throw into.
    const wasThrown = !!lp.thrown;
    const opens = (lp.eligible ?? []).map((k2) => lp.off[k2]).filter((r) => r && r.openState);
    step(lp, null);
    C.liveSecs += DT;
    if (!wasThrown && lp.thrown && !lp.thrown.away && !throwChecked) {
      throwChecked = true; C.att++;
      const r = lp.thrown.target;
      if (r.openState === 'COVERED' && opens.some((o) => o !== r && o.openState === 'OPEN')) seen('qbIntoCovered');
      if (g.down >= 3 && g.toGo >= 4 && (r.lead?.x ?? r.x) < g.toGo - 1 && opens.some((o) => o !== r && o.openState === 'OPEN' && (o.lead?.x ?? o.x) >= g.toGo)) seen('shortOf3rd');
    }
    if (lp.kind === 'pass' && !lp.thrown && !lp.carrierSet && lp.t > 4 && lp.t - DT <= 4) seen('qbHold');
    // Deep coverage beaten before the throw.
    if (lp.kind === 'pass' && !lp.thrown && !lp.carrierSet) {
      for (const q of lp.players) {
        if (q.side !== 'def' || deepFlag.has(q)) continue;
        const deepRole = (q.zone && q.zone.x >= 15) || (q.role === 'cover' && !q.man && !q.zone && ['FS', 'SS'].includes(q.slot));
        if (!deepRole) continue;
        for (const k2 of lp.eligible ?? []) {
          const r = lp.off[k2];
          if (r && r.role === 'route' && r.x > q.x + 3 && Math.abs(r.y - q.y) < 8 && r.x > 12) { deepFlag.add(q); seen('deepBeat'); break; }
        }
      }
    }
    const c = lp.carrierSet ? lp.carrier : null;
    if (c && c !== carrier) { carrier = c; cStart = { x: c.x, t: lp.t }; cMinX = c.x * (c.side === 'off' ? 1 : -1); cMaxX = cMinX; }
    if (c) {
      const f = c.side === 'off' ? 1 : -1, fx = c.x * f;
      cMaxX = Math.max(cMaxX, fx); cMinX = Math.min(cMinX, fx);
      const e = lp.t - cStart.t;
      if (!danced && lp.kind === 'run' && c.side === 'off' && e > 1.2 && c.x < -0.5 && c.vx * f < 1 && !lp.tackle) { danced = true; seen('dance'); }
      if (!wrongCatch && lp.caught && c.side === 'off' && e > 0.4 && e < 2 && c.vx < -1.5 && !lp.tackle) { wrongCatch = true; seen('wrongWayCatch'); }
    }
    if (c) for (const p of lp.players) if (p !== c && p.side === c.side && p.aim === c && p.role !== 'rush') seen('chaseOwn');
    for (const p of lp.players) {
      const S = st.get(p), sp = len(p.vx, p.vy);
      const busy = p.eng || p.stun > 0 || lp.tackle || p.downed || p.jump != null;
      // Idle while the ball is live with a carrier past the first half second.
      if (c && lp.t - (lp.carrierAt ?? 0) > 0.6 && !busy && p !== c) {
        const d = len(p.x - c.x, p.y - c.y);
        if (p.side !== c.side && sp < 0.8 && d < 25) seen('idleDefender', DT);
        if (p.side === c.side && sp < 0.8 && d < 20 && p.slot !== 'QB') seen('idleBlocker', DT);
        if (p.side !== c.side && d < 15 && d > 2 && sp > 2 && !(p.react > 0)) {
          const cos = ((c.x - p.x) * p.vx + (c.y - p.y) * p.vy) / (d * sp);
          if (cos < 0) seen('wrongWayPursuit', DT);
        }
        // Overrun: ahead of the carrier, then far behind him.
        if (p.side !== c.side) {
          const f = c.side === 'off' ? 1 : -1, ahead = (p.x - c.x) * f;
          if (ahead > 0 && d < 2) S.ahead = true;
          if (p.cool > 0) S.tried = true;
          if (S.ahead && !S.tried && ahead < -3 && !S.counted) { S.counted = true; seen('overrun'); }
        }
      }
      if (p.side === 'def' && Math.abs(p.y) > SIDE + 0.5) seen('outOfBoundsDef', DT);
      // Loops: the heading's total turn over the last two seconds, while moving.
      if (sp > 1.5 && !busy) {
        const h = Math.atan2(p.vy, p.vx);
        if (S.h != null) { let d = h - S.h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; S.turns.push([lp.t, d]); }
        S.h = h;
        while (S.turns.length && S.turns[0][0] < lp.t - 2) S.turns.shift();
        const tot = S.turns.reduce((a, q) => a + q[1], 0);
        if (!S.looped && Math.abs(tot) > (300 * Math.PI) / 180) { S.looped = true; seen('circling'); }
      } else S.h = null;
      if (p.slot === 'QB' && p !== c && (lp.thrown || (lp.carrierSet && c && c !== p)) && p.x > 10 && !S.qbFar) { S.qbFar = true; seen('qbDeepEscort'); }
      if (!busy && !p.carrier && sp > p.top * 1.12 && !(p.slow > 0)) seen('overspeed');
    }
    for (let x = 0; x < lp.players.length; x++) for (let y = x + 1; y < lp.players.length; y++) {
      const A = lp.players[x], B = lp.players[y];
      if (A.eng === B || (lp.tackle && [A, B].every((q) => q === lp.tackle.c || q === lp.tackle.q))) continue;
      if (len(A.x - B.x, A.y - B.y) < (A.r + B.r) * 0.5) seen('overlapDeep');
    }
  }
  const r = lp.result;
  if (!r) continue;
  if (r.kind === 'sack') C.sacks++;
  if (lp.intercepted) C.ints++;
  if (lp.scramble) C.scrambles++;
  if (lp.end?.how === 'slide') C.slides++;
  if (carrier && carrier.side === 'off') {
    if (lp.kind === 'run' && !lp.scramble) { C.carries++; C.rushYds += r.yards ?? 0; }
    if (lp.caught) { C.catches++; C.recYds += r.yards ?? 0; }
    if (cMaxX - cMinX > 0 && cStart && (cStart.x - cMinX) >= 3 && !(lp.kind === 'pass' && !lp.caught)) seen('carrierRetreat');
    if (lp.end?.how === 'out') {
      let near = 99;
      for (const q of lp.players) if (q.side !== carrier.side) near = Math.min(near, len(q.x - carrier.x, q.y - carrier.y));
      const short = (r.yards ?? 0) < g.toGo;
      if (near > 4 && short) seen('unforcedOut');
    }
    if (lp.end?.how === 'tackle' && (lp.spotX ?? 0) <= lp.ownGoalX && cStart.x > lp.ownGoalX) seen('safety');
  }
}

const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');
console.log(`${C.plays} live plays (${C.runs} runs, ${C.passes} passes), ${C.liveSecs.toFixed(0)} s live`);
console.log(`scrambles ${C.scrambles}  slides ${C.slides}`);
console.log(`rush Y/C ${(C.rushYds / Math.max(1, C.carries)).toFixed(2)}  rec Y/C ${(C.recYds / Math.max(1, C.catches)).toFixed(2)}  cmp ${pct(C.catches, C.att)}  INT ${pct(C.ints, C.att)}  sacks ${pct(C.sacks, C.passes)}`);
const rows = [
  ['carrier retreats 3+ yds', C.carrierRetreat, C.carries + C.catches, 0.06],
  ['back dancing behind line', C.dance, C.runs, 0.05],
  ['unforced step out of bounds', C.unforcedOut, C.carries + C.catches, 0.02],
  ['safety', C.safety, C.plays, 0.005],
  ['catch then runs backward', C.wrongWayCatch, C.catches, 0.04],
  ['throws into coverage w/ open man', C.qbIntoCovered, C.att, 0.08],
  ['QB holds past 4 s', C.qbHold, C.passes, 0.05],
  ['pursuer overruns carrier', C.overrun, C.plays, 0.25],
  ['deep defender beaten over the top', C.deepBeat, C.passes, 0.2],
  ['QB runs 10+ yds downfield to block', C.qbDeepEscort, C.plays, 0.03],
  ['3rd down: short of sticks w/ man open past', C.shortOf3rd, C.att, 0.04],
  ['players looping in circles (per play)', C.circling, C.plays, 0.3],
];
const perPlay = [
  ['idle blocker s/play', C.idleBlocker, 1.5],
  ['chasing own carrier steps/play', C.chaseOwn, 0.5],
  ['idle defender s/play', C.idleDefender, 1.0],
  ['wrong-way pursuit s/play', C.wrongWayPursuit, 0.6],
  ['defender out of bounds s/play', C.outOfBoundsDef, 0.05],
  ['overspeed steps/play', C.overspeed, 1],
  ['deep overlaps steps/play', C.overlapDeep, 2],
];
let bad = 0;
for (const [name, n, d, lim] of rows) { const r = n / Math.max(1, d), over = r > lim; bad += over; console.log(`${over ? '!!' : '  '} ${name.padEnd(36)} ${String(n).padStart(5)} / ${String(d).padEnd(5)} ${pct(n, d).padStart(7)}  (limit ${(lim * 100).toFixed(1)}%)`); }
for (const [name, n, lim] of perPlay) { const r = n / C.plays, over = r > lim; bad += over; console.log(`${over ? '!!' : '  '} ${name.padEnd(36)} ${r.toFixed(2).padStart(7)}  (limit ${lim})`); }
if (STRICT && bad) { console.log(`${bad} checks over the limit`); process.exit(1); }
