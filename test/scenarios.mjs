// The fifteen gameplay scenarios a football game has to get right, each played from a fixed
// seed through the real simulation and checked frame by frame. A scenario searches seeds from
// its own fixed start in a fixed order, so every run finds and checks the same plays.
// Beyond what test/plays.mjs checks (formation, step size, overlaps, poses, play states), each
// frame here also checks:
//   - every player's action state and block contact state are ones the game defines
//   - the ball never jumps: held, it sits at the holder; in the air, it follows its arc
//   - facing turns at a body's rate (no flips from one frame to the next)
//   - a tackle is a sequence (contact, then down, never instant) with the pair kept apart
//   - sacks end behind the line, and every tackle is spotted at forward progress
// and the scenario's own football facts (the drop depth, the pocket's shape, where a catch
// happened, possession and downs afterward).
// Usage: node test/scenarios.mjs [--report path.json]   (SWEEP=n sets the sweep size, default 150)
import { writeFileSync } from 'node:fs';
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runLivePlay, DEF_PLAYS, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, playState, playSeconds, validateFormation, holdPoint, flightAt, ACTIONS, DT, SIDE } from '../src/live.js';

const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

const CONTACTS = [null, 'APPROACHING', 'ENGAGED', 'PUSHING', 'SHEDDING', 'DISENGAGED'];
const STEP_SLACK = 1.8, STEP_FLOOR = 0.3, OVERLAP_HARD = 0.5;
// Facing may turn at most this many radians in one step (a cut at full agility is ~0.25).
const TURN_STEP = 0.6;

function freshGame(seed, setup = {}) {
  const g = createGame({ home: teamForGame(L.teams[seed % 8]), away: teamForGame(L.teams[(seed + 3) % 8]), seed, weather: 'clear' });
  g.spot = setup.spot ?? 25 + (seed * 13) % 45;
  g.down = setup.down ?? 1;
  g.toGo = Math.min(setup.toGo ?? 10, 100 - g.spot);
  g.poss = seed % 2;
  return g;
}

// One snap with every frame check. Returns what happened plus the trace the scenarios read.
function playOne(g, off, def) {
  const lp = createLivePlay(g, off, def, {});
  const issues = validateFormation(lp).map((s) => `formation: ${s}`);
  for (let i = 0; i < 60 * 15 && !lp.set; i++) step(lp, null);
  if (!lp.set) issues.push('never set at the line');
  const pre = { set: lp.set, states: [playState(lp)] };
  snap(lp);
  const tr = { set: pre.set, qbDeepest: 0, pocket: null, contactAt: null, tackleEnd: null, minPair: 99, ballJumps: 0, states: [...pre.states] };
  let prev = lp.players.map((p) => ({ x: p.x, y: p.y, fx: p.fx, fy: p.fy }));
  let pb = { x: lp.ball.x, y: lp.ball.y, z: lp.ball.z ?? 0 };
  for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) {
    step(lp, null);
    const st = playState(lp);
    if (st !== tr.states[tr.states.length - 1]) tr.states.push(st);
    lp.players.forEach((p, k) => {
      const q = prev[k], d = Math.hypot(p.x - q.x, p.y - q.y);
      const lim = Math.max(STEP_FLOOR, p.top * DT * STEP_SLACK);
      if (d > lim) issues.push(`${p.side}${p.slot} jumped ${d.toFixed(2)} yd at t=${lp.t.toFixed(2)}`);
      if (Math.abs(p.y) > SIDE + 3) issues.push(`${p.side}${p.slot} left the field`);
      if (!ACTIONS.includes(p.act)) issues.push(`${p.side}${p.slot} has unknown action ${p.act}`);
      if (!CONTACTS.includes(p.contact ?? null)) issues.push(`${p.side}${p.slot} has unknown contact state ${p.contact}`);
      const turn = Math.acos(Math.max(-1, Math.min(1, p.fx * q.fx + p.fy * q.fy)));
      if (turn > TURN_STEP) issues.push(`${p.side}${p.slot} turned ${turn.toFixed(2)} rad in one step at t=${lp.t.toFixed(2)}`);
    });
    // Overlaps (blockers locked together and the tackle pair are exempt).
    const P = lp.players;
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
      const A = P[a], B = P[b];
      if (A.eng === B) continue;
      const T = lp.tackle;
      const pair = T && ((A === T.c && B === T.q) || (A === T.q && B === T.c));
      const dd = Math.hypot(A.x - B.x, A.y - B.y);
      if (pair) { tr.minPair = Math.min(tr.minPair, dd / (A.r + B.r)); continue; }
      if (1 - dd / (A.r + B.r) > OVERLAP_HARD) issues.push(`${A.side}${A.slot} and ${B.side}${B.slot} overlap at t=${lp.t.toFixed(2)}`);
    }
    // The ball: at the holder's hands, on its arc, or rolling; never teleporting.
    const b = lp.ball;
    const bj = Math.hypot(b.x - pb.x, b.y - pb.y);
    if (bj > 0.6) { tr.ballJumps++; issues.push(`ball jumped ${bj.toFixed(2)} yd at t=${lp.t.toFixed(2)} (${b.state})`); }
    if (b.state === 'held' && b.holder && !b.xfer) {
      // Settling into a new hold takes a few frames; past that it sits in his hands.
      const h = holdPoint(lp, b.holder);
      b._off = Math.hypot(h.x - b.x, h.y - b.y) > 0.05 ? (b._off ?? 0) + 1 : 0;
      if (b._off > 8) issues.push(`ball ${Math.hypot(h.x - b.x, h.y - b.y).toFixed(2)} yd from its holder at t=${lp.t.toFixed(2)}`);
    }
    if (b.state === 'air' && lp.thrown) {
      const at = flightAt(lp.thrown, lp.t - lp.thrown.t0);
      if (Math.hypot(at.x - b.x, at.y - b.y) > 0.05) issues.push(`ball off its arc at t=${lp.t.toFixed(2)}`);
    }
    pb = { x: b.x, y: b.y, z: b.z ?? 0 };
    prev = lp.players.map((p) => ({ x: p.x, y: p.y, fx: p.fx, fy: p.fy }));
    // The quarterback's drop, and the pocket a beat after the snap on a pass.
    const qb = lp.off.QB;
    if (qb && b.holder === qb) tr.qbDeepest = Math.min(tr.qbDeepest, qb.x);
    if (!tr.pocket && lp.kind === 'pass' && lp.t >= 1.3 && b.holder === qb) {
      const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => lp.off[k]).filter(Boolean);
      const ys = ol.map((p) => p.y);
      let near = 99;
      for (const q of lp.players) if (q.side === 'def') near = Math.min(near, Math.hypot(q.x - qb.x, q.y - qb.y));
      tr.pocket = {
        width: Math.max(...ys) - Math.min(...ys),
        between: ol.filter((p) => p.x > qb.x && p.x < 1.5).length,
        rusherGap: near,
      };
    }
    if (lp.tackle && tr.contactAt == null) tr.contactAt = lp.t;
  }
  if (lp.phase !== 'dead') issues.push('play never ended');
  tr.tackleEnd = lp.deadAt;
  const want = ['PRE_SNAP', 'SNAP', 'PLAY_ACTIVE', 'PLAY_DEAD'];
  if (tr.states.join() !== want.join()) issues.push(`states ${tr.states.join(' > ')}`);
  // Tackles: a sequence with the pair apart, spotted at forward progress, sacks behind the line.
  if (['tackle', 'sack'].includes(lp.end?.how)) {
    if (tr.contactAt == null) issues.push('tackled with no contact sequence');
    else if (lp.deadAt - tr.contactAt < 0.25) issues.push(`tackle took ${(lp.deadAt - tr.contactAt).toFixed(2)} s (instant)`);
    if (tr.minPair < 0.75) issues.push(`tackle pair overlapped (${tr.minPair.toFixed(2)} of their radii)`);
    if (lp.spotX == null) issues.push('no forward-progress spot');
  }
  if (lp.end?.how === 'sack' && !(lp.spotX < 0)) issues.push(`sack spotted at ${lp.spotX?.toFixed(1)}, not behind the line`);
  for (const e of lp.possErrors ?? []) issues.push(`possession ${e}`);
  return { lp, r: lp.result, issues: [...new Set(issues)], tr };
}

const anyDef = Object.keys(DEF_PLAYS);
const S = [
  // The formation is validated when the play is created (11 on 11, 7 on the line, nobody
  // offside or overlapping) and the players must walk up and set before the snap.
  { name: 'pre-snap formation', off: ['inside_run', 'slant', 'post'], ok: () => true,
    check: ({ tr }) => (tr.set ? [] : ['never set']) },
  { name: 'quarterback dropback', off: ['post', 'curl', 'te_seam'], ok: ({ lp }) => !!lp.thrown,
    check: ({ lp, tr }) => (tr.qbDeepest > -5 ? [`QB only dropped to ${tr.qbDeepest.toFixed(1)}`] : []) },
  { name: 'pocket protection', off: ['post', 'curl'], def: ['base', 'cover2', 'cover3'], ok: ({ tr }) => !!tr.pocket,
    check: ({ tr }) => {
      const out = [];
      if (tr.pocket.width < 3.5) out.push(`pocket only ${tr.pocket.width.toFixed(1)} yd wide`);
      if (tr.pocket.between < 4) out.push(`only ${tr.pocket.between} linemen in front of the QB`);
      if (tr.pocket.rusherGap < 1.5) out.push(`a rusher already on the QB at 1.3 s`);
      return out;
    } },
  { name: 'short pass', off: ['slant', 'out', 'curl'], ok: ({ lp }) => lp.caught && !lp.intercepted && lp.catchX < 10,
    check: ({ lp }) => (lp.thrown.target !== lp.carrier ? ['caught by someone other than the target'] : []) },
  { name: 'deep completion', off: ['post', 'pa_deep', 'te_seam'], ok: ({ lp }) => lp.caught && !lp.intercepted && lp.catchX >= 15,
    check: ({ lp }) => (lp.thrown.vz <= 0 ? ['deep ball never rose'] : []) },
  { name: 'incomplete pass', off: ['post', 'out', 'slant', 'curl'], ok: ({ lp }) => lp.end.how === 'incomplete',
    check: ({ lp, r }) => (r.yards !== 0 ? [`incomplete gained ${r.yards}`] : []) },
  { name: 'interception', off: ['post', 'te_seam', 'curl'], def: ['cover2', 'cover3', 'man_press'], ok: ({ lp }) => !!lp.intercepted,
    check: ({ r }) => (r.turnover !== 'int' ? ['interception not a turnover'] : []) },
  { name: 'inside run', off: ['inside_run'], ok: ({ lp, r }) => r.kind === 'run' && lp.carrier === lp.off.RB && r.yards > 0,
    check: ({ lp }) => (lp.events.find((e) => e.kind === 'handoff') ? [] : ['no handoff']) },
  { name: 'outside run', off: ['outside_run'], ok: ({ lp, r }) => r.kind === 'run' && lp.carrier === lp.off.RB && Math.abs(lp.carrier.y) > 5,
    check: () => [] },
  { name: 'sack', off: ['post', 'pa_deep', 'curl'], def: ['pass_blitz', 'run_blitz'], ok: ({ r }) => r.kind === 'sack',
    check: ({ r }) => (r.yards >= 0 ? [`sack for ${r.yards}`] : []) },
  { name: 'open-field tackle', off: ['slant', 'inside_run', 'out', 'screen'], ok: ({ lp, r }) => lp.end.how === 'tackle' && !r.turnover && lp.spotX > 6,
    check: ({ lp, r }) => (Math.abs(r.yards - Math.round(lp.spotX)) > 1 ? [`gain ${r.yards} does not match the spot ${lp.spotX.toFixed(1)}`] : []) },
  { name: 'touchdown', off: ['slant', 'inside_run', 'te_seam'], setup: { spot: 93 }, ok: ({ lp }) => lp.end.how === 'td',
    check: () => [] },
  { name: 'first-down conversion', off: ['inside_run', 'curl', 'slant'], setup: { down: 3, toGo: 4 }, ok: ({ lp, r }) => !r.turnover && lp.end.how === 'tackle' && r.yards >= 4,
    check: () => [] },
  { name: 'turnover on downs', off: ['inside_run', 'curl'], setup: { down: 4, toGo: 9 }, ok: ({ lp, r }) => !r.turnover && lp.end.how !== 'td' && r.yards < 9,
    check: () => [] },
  { name: 'transition to next play', off: ['inside_run', 'slant'], ok: ({ lp }) => lp.end.how === 'tackle',
    check: () => [] },
];

let failed = 0;
const report = [];
const t0 = Date.now();
for (const [i, C] of S.entries()) {
  const defs = C.def ?? anyDef;
  let hit = null, tries = 0, bad = [];
  // Each scenario's seeds start at its own fixed point.
  for (let seed = 1000 + i * 100; seed < 1000 + i * 100 + 400 && !hit; seed++) {
    const off = C.off[seed % C.off.length], def = defs[(seed * 7) % defs.length];
    const g = freshGame(seed, C.setup);
    tries++;
    const res = playOne(g, off, def);
    if (res.issues.length) { bad.push(`seed ${seed} ${off} vs ${def}: ${res.issues.slice(0, 3).join('; ')}`); continue; }
    if (!C.ok(res)) continue;
    hit = { ...res, g, off, def, seed };
  }
  const problems = [...bad];
  if (!hit) problems.push(`no play produced it in ${tries} tries`);
  else {
    problems.push(...C.check(hit));
    // Hand it to the game rules: clock, possession, downs, score, and a legal next snap.
    const { g, lp, r, off, def } = hit;
    const b = { poss: g.poss, down: g.down, toGo: g.toGo, spot: g.spot, score: [...g.score], clock: g.clock };
    runLivePlay(g, off, def, r, playSeconds(lp));
    const o = b.poss;
    if (g.clock >= b.clock) problems.push('game clock did not run');
    // A defensive touchdown (a pick-six) scores for the defense, which then kicks off back to
    // the offense, so possession ends up where it started.
    const defTD = lp.end.how === 'td' && lp.carrier?.side === 'def';
    const scorer = defTD ? 1 - o : o;
    if (r.turnover && !defTD && g.poss === o) problems.push('turnover did not change possession');
    if (lp.end.how === 'td' && g.score[scorer] < b.score[scorer] + 6) problems.push('touchdown not scored');
    if (!r.turnover && lp.end.how !== 'td') {
      const first = r.yards >= b.toGo;
      if (first && (g.poss !== o || g.down !== 1)) problems.push(`gained ${r.yards} on ${b.toGo} to go but it is ${g.down} down for team ${g.poss}`);
      if (!first && b.down < 4 && (g.poss !== o || g.down !== b.down + 1)) problems.push(`down went ${b.down} to ${g.down}`);
      if (!first && b.down === 4 && g.poss === o) problems.push('no turnover on downs');
    }
    if (C.name === 'transition to next play' || !g.final) {
      const nx = createLivePlay(g, 'inside_run', 'base', {});
      const v = validateFormation(nx);
      if (v.length) problems.push(`next snap: ${v.join('; ')}`);
      for (let k = 0; k < 60 * 15 && !nx.set; k++) step(nx, null);
      if (!nx.set) problems.push('next play never set');
    }
  }
  // A scenario fails only on its own found play; issues in other seeds it tried are listed.
  const own = hit ? problems.slice(bad.length) : problems;
  const ok = own.length === 0 && bad.length === 0;
  if (!ok) failed++;
  const line = hit ? `seed ${String(hit.seed).padStart(4)} ${hit.off.padEnd(11)} vs ${hit.def.padEnd(10)} ${(hit.r.text ?? '').slice(0, 64)}` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${C.name.padEnd(24)} ${line}`);
  for (const p of problems.slice(0, 4)) console.log(`       ${p}`);
  report.push({ scenario: C.name, ok, seed: hit?.seed ?? null, off: hit?.off ?? null, def: hit?.def ?? null, text: hit?.r.text ?? null, problems });
}
// The same frame checks over a sweep of every run and pass call against every defense.
const offs = Object.keys(OFF_PLAYS).filter((k) => ['run', 'pass'].includes(OFF_PLAYS[k].kind));
const sweepN = Number(process.env.SWEEP ?? 150);
let sweepBad = 0;
for (let seed = 5000; seed < 5000 + sweepN; seed++) {
  const off = offs[seed % offs.length], def = anyDef[Math.floor(seed / offs.length) % anyDef.length];
  const res = playOne(freshGame(seed, { spot: 5 + (seed * 17) % 90 }), off, def);
  if (res.issues.length) { sweepBad++; console.log(`FAIL sweep seed ${seed} ${off} vs ${def}: ${res.issues.slice(0, 3).join('; ')}`); }
}
if (sweepBad) failed++;
console.log(`sweep: ${sweepN - sweepBad} of ${sweepN} plays clean`);
report.push({ scenario: 'sweep', ok: !sweepBad, plays: sweepN, bad: sweepBad });
console.log(`${S.length - (failed - (sweepBad ? 1 : 0))} of ${S.length} scenarios passed in ${Date.now() - t0} ms`);
const ri = process.argv.indexOf('--report');
if (ri > 0) writeFileSync(process.argv[ri + 1], JSON.stringify({ when: new Date().toISOString(), passed: S.length - failed, total: S.length, scenarios: report }, null, 2));
process.exit(failed ? 1 : 0);
