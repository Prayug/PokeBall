// Complete plays through the live game loop: the ten cases a football game has to get right,
// each found by playing real plays (AI calls on both sides, seeded) and then checked frame by
// frame. Exits non-zero on any failure.
// Usage: node test/plays.mjs [sweep plays, default 160]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runLivePlay, OFF_PLAYS, DEF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, playState, playSeconds, validateFormation, DT, SIDE } from '../src/live.js';
import { Animator } from '../src/anim3d.js';

const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

// Limits. A body may move at most this far in one 1/60 s step (its top speed plus a shove from
// a collision), and two bodies may overlap by at most this share of their summed radii (the
// solver eases deep contact apart over a few steps, so a pair may sit past OVERLAP for a few
// frames but never past OVERLAP_HARD; blockers locked together are exempt).
const STEP_SLACK = 1.8, STEP_FLOOR = 0.3;
const OVERLAP = 0.3, OVERLAP_FRAMES = 6, OVERLAP_HARD = 0.5;

const CASES = {
  'inside run':      { off: ['inside_run'], ok: (lp, r) => r.kind === 'run' && lp.play.dir === 'inside' && lp.carrier !== lp.off.QB },
  'outside run':     { off: ['outside_run'], ok: (lp, r) => r.kind === 'run' && lp.play.dir === 'outside' && lp.carrier !== lp.off.QB },
  'short completion':{ off: ['slant', 'out', 'curl', 'screen'], ok: (lp) => lp.caught && !lp.intercepted && lp.catchX < 10 },
  'deep pass':       { off: ['post', 'pa_deep', 'te_seam'], ok: (lp) => lp.caught && !lp.intercepted && lp.catchX >= 15 },
  'incomplete':      { off: ['post', 'out', 'slant', 'curl'], ok: (lp) => lp.end.how === 'incomplete' },
  'sack':            { off: ['post', 'pa_deep', 'curl'], def: ['pass_blitz', 'run_blitz'], ok: (lp, r) => r.kind === 'sack' },
  'tackle':          { off: ['inside_run', 'slant', 'outside_run'], ok: (lp) => lp.end.how === 'tackle' && !!lp.end.tackler },
  'touchdown':       { off: ['slant', 'inside_run', 'te_seam'], spot: 92, ok: (lp) => lp.end.how === 'td' },
  'turnover':        { off: ['post', 'out', 'inside_run', 'slant'], def: ['man_press', 'cover2', 'run_blitz'], ok: (lp, r) => !!r.turnover },
  'next down':       { off: ['inside_run', 'curl'], ok: (lp, r) => !r.turnover && lp.end.how === 'tackle' && r.yards > 0 && r.yards < 10 },
};

let failed = 0;
const fail = (name, msg) => { failed++; console.log(`  FAIL ${name}: ${msg}`); };

function freshGame(seed, spot) {
  const g = createGame({ home: teamForGame(L.teams[seed % 8]), away: teamForGame(L.teams[(seed + 3) % 8]), seed, weather: 'clear' });
  g.spot = spot; g.down = 1; g.toGo = Math.min(10, 100 - spot); g.poss = seed % 2;
  return g;
}

// Play one snap with every check running; returns the trace and any problems found.
function playOne(g, off, def) {
  const lp = createLivePlay(g, off, def, {});
  const issues = [...validateFormation(lp)].map((s) => `formation: ${s}`);
  const states = [playState(lp)];
  // Walk up to the line (bounded), then snap.
  for (let i = 0; i < 60 * 15 && !lp.set; i++) step(lp, null);
  if (!lp.set) issues.push('never set at the line');
  const anim = new Map(lp.players.map((p, i) => [p, new Animator({}, (i + 1) / 23)]));
  snap(lp);
  let prev = new Map(lp.players.map((p) => [p, { x: p.x, y: p.y }]));
  const deep = new Map();
  let maxStep = 0, worstOverlap = 0, idleBlock = 0, engagedFrames = 0;
  for (let i = 0; i < 60 * 20 && lp.phase === 'live'; i++) {
    step(lp, null);
    const st = playState(lp);
    if (st !== states[states.length - 1]) states.push(st);
    for (const p of lp.players) {
      const q = prev.get(p), d = Math.hypot(p.x - q.x, p.y - q.y);
      const lim = Math.max(STEP_FLOOR, p.top * DT * STEP_SLACK);
      maxStep = Math.max(maxStep, d / lim);
      if (d > lim) issues.push(`${p.slot} jumped ${d.toFixed(2)} yd in one step at t=${lp.t.toFixed(2)}`);
      if (Math.abs(p.y) > SIDE + 3) issues.push(`${p.slot} left the field at y=${p.y.toFixed(1)}`);
      // The pose the renderer would draw for him this frame.
      const a = anim.get(p);
      a.update(DT, { speed: Math.hypot(p.vx, p.vy), top: p.top, mode: lp.phase, set: true, height: 1.5,
        engaged: !!p.eng, carrier: lp.ball.state === 'held' && lp.ball.holder === p });
      if (p.eng && (p.engT ?? 1) > 0) {
        p._engN = (p._engN ?? 0) + 1;
        if (p._engN > 20) { engagedFrames++; if (a.fb.crouch < 0.3 || a.fb.armsFwd < 0.5) idleBlock++; }
      } else p._engN = 0;
    }
    if (lp.phase === 'live') {
      const P = lp.players;
      for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
        const A = P[a], B = P[b];
        if (A.eng === B || B.eng === A) continue;
        const d = Math.hypot(A.x - B.x, A.y - B.y), over = 1 - d / (A.r + B.r);
        worstOverlap = Math.max(worstOverlap, over);
        const key = a * 32 + b, n = over > OVERLAP ? (deep.get(key) ?? 0) + 1 : 0;
        deep.set(key, n);
        if (over > OVERLAP_HARD || n > OVERLAP_FRAMES) issues.push(`${A.side}${A.slot} and ${B.side}${B.slot} overlap ${(over * 100).toFixed(0)}% at t=${lp.t.toFixed(2)}`);
      }
    }
    prev = new Map(lp.players.map((p) => [p, { x: p.x, y: p.y }]));
  }
  if (lp.phase !== 'dead') issues.push('play never ended');
  if (idleBlock > engagedFrames * 0.05) issues.push(`blockers drawn idle in ${idleBlock} of ${engagedFrames} engaged frames`);
  const want = ['PRE_SNAP', 'SNAP', 'PLAY_ACTIVE', 'PLAY_DEAD'];
  if (states.join() !== want.join()) issues.push(`states ${states.join(' > ')}`);
  return { lp, r: lp.result, issues: [...new Set(issues)], maxStep, worstOverlap, engagedFrames };
}

const t0 = Date.now();
for (const [name, C] of Object.entries(CASES)) {
  let hit = null, tries = 0;
  const offs = C.off, defs = C.def ?? Object.keys(DEF_PLAYS);
  for (let seed = 1; seed < 400 && !hit; seed++) {
    const off = offs[seed % offs.length], def = defs[(seed * 7) % defs.length];
    const g = freshGame(seed, C.spot ?? 20 + (seed * 13) % 55);
    tries++;
    const res = playOne(g, off, def);
    if (res.issues.length) { fail(name, `seed ${seed} ${off} vs ${def}: ${res.issues.slice(0, 4).join('; ')}`); continue; }
    if (!C.ok(res.lp, res.r)) continue;
    hit = { ...res, g, off, def, seed };
  }
  if (!hit) { fail(name, `no play produced it in ${tries} tries`); continue; }
  // Hand the result to the game rules and check the next snap is set up right.
  const { g, lp, r, off, def } = hit;
  const before = { poss: g.poss, down: g.down, toGo: g.toGo, spot: g.spot, score: [...g.score], clock: g.clock };
  runLivePlay(g, off, def, r, playSeconds(lp));
  const o = before.poss;
  if (g.clock >= before.clock) fail(name, 'game clock did not run');
  if (r.turnover && g.poss === o) fail(name, 'turnover did not change possession');
  if (lp.end.how === 'td' && g.score[o] < before.score[o] + 6) fail(name, 'touchdown not scored');
  if (!r.turnover && lp.end.how !== 'td') {
    const gained = r.yards;
    const expectFirst = gained >= before.toGo;
    if (g.poss !== o) fail(name, 'possession changed without a turnover');
    else if (expectFirst && g.down !== 1) fail(name, `gained ${gained} on ${before.toGo} to go but down is ${g.down}`);
    else if (!expectFirst && before.down < 4 && g.down !== before.down + 1) fail(name, `down went ${before.down} to ${g.down}`);
    else if (g.spot !== Math.max(1, Math.min(99, before.spot + gained)) && !expectFirst) fail(name, `spot ${before.spot}+${gained} became ${g.spot}`);
  }
  // The next play lines up legally from wherever this one left the ball.
  if (!g.final) {
    const nx = createLivePlay(g, 'inside_run', 'base', {});
    const v = validateFormation(nx);
    if (v.length) fail(name, `next snap formation: ${v.join('; ')}`);
  }
  console.log(`ok   ${name.padEnd(17)} seed ${String(hit.seed).padStart(3)} ${off.padEnd(11)} vs ${def.padEnd(10)} ` +
    `${(r.text ?? lp.end.text ?? '').slice(0, 70)}  [step ${(hit.maxStep * 100).toFixed(0)}% of limit, overlap ${(hit.worstOverlap * 100).toFixed(0)}%, ${hit.engagedFrames} block frames]`);
}
// Then the same frame checks over a wider sweep: every run and pass call against every defense.
const offs = Object.keys(OFF_PLAYS).filter((k) => ['run', 'pass'].includes(OFF_PLAYS[k].kind));
let swept = 0, bad = 0;
for (let seed = 500; seed < 500 + Number(process.argv[2] ?? 160); seed++) {
  const off = offs[seed % offs.length], def = Object.keys(DEF_PLAYS)[Math.floor(seed / offs.length) % 8];
  const res = playOne(freshGame(seed, 5 + (seed * 17) % 90), off, def);
  swept++;
  if (res.issues.length) { bad++; fail('sweep', `seed ${seed} ${off} vs ${def}: ${res.issues.slice(0, 3).join('; ')}`); }
}
console.log(`sweep: ${swept - bad} of ${swept} plays clean (formation, steps, overlaps, poses, states)`);
console.log(`${failed ? 'FAILED' : 'passed'} in ${Date.now() - t0} ms`);
process.exit(failed ? 1 : 0);
