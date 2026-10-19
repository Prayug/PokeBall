// Gameplay feel audit: plays live snaps with every Pokémon on autopilot and measures how the
// football looks and moves, frame by frame, from the simulation's own state:
//   - movement: bodies running one way while facing another (sliding), heading changes faster
//     than a body can turn at its speed, and how much speed a receiver carries through a cut
//   - spacing: bodies pressed together without a block or tackle between them at the line,
//     and the size of the biggest pile (bodies touching bodies) in the first second and a half
//   - blocking: engaged pairs standing still (no push, no hand fight)
//   - coverage: how long a man defender takes to answer his receiver's cut (instant is wrong,
//     never is wrong too)
//   - tackling: how far a tackled carrier slides from the hit to the turf
//   - possession: the ball's state machine never skips a step or changes after the whistle
// Prints each measure; --strict exits non-zero past the limits.
// Usage: node test/feel.mjs [plays, default 300] [--strict]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import * as Live from '../src/live.js';
const { createLivePlay, snap, step, DT } = Live;
const POSSESSION_FLOW = Live.POSSESSION_FLOW ?? null;

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 300);
const STRICT = process.argv.includes('--strict');
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

const len = Math.hypot;
const ang = (ax, ay, bx, by) => { const c = (ax * bx + ay * by) / ((len(ax, ay) * len(bx, by)) || 1); return Math.acos(Math.max(-1, Math.min(1, c))); };
const C = {
  plays: 0, moving: 0, slip: 0, turnFast: 0, cuts: 0, cutKeep: 0, crowd: 0, crowdSteps: 0, pile: 0, pileMax: 0,
  engT: 0, engStill: 0, manCuts: 0, manReact: [], manNever: 0, tackles: 0, slide: [], possBad: 0, deadMoves: 0,
};
const routeRoles = new Set(['route', 'carrier', 'pursue', 'escort', 'runner', 'stalk', 'lead']);
for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 5100 + i, weather: 'clear' });
  g.spot = 15 + ((i * 29) % 65); g.down = 1 + (i % 3); g.toGo = Math.min(10, 100 - g.spot); g.poss = i % 2;
  const off = aiOffenseCall(g), def = aiDefenseCall(g);
  const k = OFF_PLAYS[off].kind;
  if (k !== 'run' && k !== 'pass') continue;
  const lp = createLivePlay(g, off, def, {});
  snap(lp);
  C.plays++;
  const S = new Map(lp.players.map((p) => [p, { h: [], cut: null }]));
  let tackleAt = null, lastPoss = lp.possession;
  for (let s = 0; s < 60 * 16 && lp.phase === 'live'; s++) {
    step(lp, null);
    if (POSSESSION_FLOW && lp.possession !== lastPoss) {
      if (!(POSSESSION_FLOW[lastPoss] ?? []).includes(lp.possession)) { C.possBad++; if (C.possBad < 4) console.log(`   possession ${lastPoss} -> ${lp.possession} (${off} vs ${def})`); }
      lastPoss = lp.possession;
    }
    for (const p of lp.players) {
      const st = S.get(p), sp = len(p.vx, p.vy);
      const busy = p.eng || p.stun > 0 || (lp.tackle && (lp.tackle.c === p || lp.tackle.q === p)) || p.jump != null || p.dive != null;
      // Running one way, facing another: the roles that run forward (not a backpedal, a kick
      // slide or a quarterback's drop).
      if (!busy && sp > 3 && routeRoles.has(p.role)) {
        C.moving++;
        if (ang(p.fx, p.fy, p.vx, p.vy) > 0.9) C.slip++;
      }
      // Heading history for cuts and turn rate.
      if (!busy && sp > 1.5) {
        const h = Math.atan2(p.vy, p.vx);
        if (st.h.length) {
          let d = h - st.h[st.h.length - 1].h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          // A body at speed can't swing its path faster than it can plant: 90 degrees in a
          // tenth of a second at 7 yards a second is a teleport, not a cut.
          if (sp > 5 && Math.abs(d) / DT > 9) { C.turnFast++; if (process.env.WHY2 && p.role === "route" && (C.ex = (C.ex ?? 0) + 1) < 4) console.log(p.slot, lp.t.toFixed(3), d.toFixed(3), sp.toFixed(2), st.h[st.h.length - 1], p.act, p.wp, p.slow); if (process.env.WHY) { const key = `${p.role}/${p.act}/${p.juke > 0 ? "juke" : ""}${p.spin > 0 ? "spin" : ""}${p === lp.carrier ? "C" : ""}`; (C.why ??= {})[key] = (C.why[key] ?? 0) + 1; } }
        }
        st.h.push({ t: lp.t, h, sp });
        while (st.h.length && st.h[0].t < lp.t - 0.6) st.h.shift();
      } else st.h.length = 0;
      // Receiver route cuts: a change of heading of 50+ degrees within 0.4 s.
      if (p.role === 'route' && !lp.thrown && st.h.length > 4) {
        const h0 = st.h[0], h1 = st.h[st.h.length - 1];
        let d = h1.h - h0.h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) > 0.9 && (!st.cut || lp.t - st.cut.t > 0.8)) {
          st.cut = { t: lp.t, dir: h1.h };
          C.cuts++;
          const minSp = Math.min(...st.h.map((q) => q.sp)), maxSp = Math.max(...st.h.map((q) => q.sp));
          C.cutKeep += minSp / Math.max(1, maxSp);
          // His man: how long until the defender's path swings toward the new direction.
          const m = lp.players.find((q) => q.side === 'def' && q.man === p && !q.eng);
          if (m) S.get(m).watch = { t: lp.t, dir: h1.h, r: p };
        }
      }
      if (st.watch) {
        const w = st.watch, e = lp.t - w.t;
        if (sp > 1 && ang(Math.cos(w.dir), Math.sin(w.dir), p.vx, p.vy) < 0.6) { C.manCuts++; C.manReact.push(e); st.watch = null; }
        else if (e > 1.5 || lp.thrown || p.man !== w.r) { if (e > 1.5) { C.manCuts++; C.manNever++; } st.watch = null; }
      }
    }
    // Spacing: bodies pressed together with nothing between them (no block, no tackle).
    if (lp.t < 1.5) {
      C.crowdSteps++;
      const ps = lp.players, adj = new Map(ps.map((p) => [p, []]));
      for (let x = 0; x < ps.length; x++) for (let y = x + 1; y < ps.length; y++) {
        const A = ps[x], B = ps[y];
        const d = len(A.x - B.x, A.y - B.y);
        if (d < A.r + B.r + 0.2) { adj.get(A).push(B); adj.get(B).push(A); }
        if (A.eng === B || A.eng || B.eng) continue;
        if (d < (A.r + B.r) * 0.95) C.crowd++;
      }
      // The biggest pile: bodies connected by touching (blocks count; a line of five blockers
      // each on his own man is five piles of two, not one of ten).
      const seen = new Set();
      for (const p of ps) {
        if (seen.has(p)) continue;
        let n = 0; const q = [p]; seen.add(p);
        while (q.length) { const u = q.pop(); n++; for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); q.push(v); } }
        if (n > C.pileMax) C.pileMax = n;
        if (n >= 5) C.pile += DT;
      }
    }
    // Blocks: engaged pairs that stand still.
    for (const p of lp.players) if (p.eng && p.side === lp.carrierTeam && lp.phase === 'live') {
      C.engT += DT;
      const q = p.eng;
      if (len(p.x - p.px, p.y - p.py) / DT < 0.25 && len(q.x - q.px, q.y - q.py) / DT < 0.25) C.engStill += DT;
    }
    if (lp.tackle && !tackleAt) tackleAt = { x: lp.tackle.c.x, y: lp.tackle.c.y, c: lp.tackle.c };
  }
  if (tackleAt && lp.end && ['tackle', 'sack'].includes(lp.end.how)) { C.tackles++; C.slide.push(len(tackleAt.c.x - tackleAt.x, tackleAt.c.y - tackleAt.y)); }
  // After the whistle nobody keeps running the play: a second of dead-ball steps and the ball
  // stays dead, nobody in the tackle moves off the spot.
  if (lp.phase === 'dead') {
    const ball = lp.possession;
    for (let s = 0; s < 60; s++) step(lp, null);
    if (POSSESSION_FLOW && (lp.possession !== ball || lp.possession !== 'PLAY_DEAD')) C.possBad++;
    for (const p of lp.players) if (p.downed && len(p.vx, p.vy) > 0.5) C.deadMoves++;
  }
}
const pct = (a, b) => (b ? (100 * a) / b : 0);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const rows = [
  ['running one way, facing another (% of moving steps)', pct(C.slip, C.moving), 4, '%'],
  ['paths swinging faster than a plant (per play)', C.turnFast / C.plays, 0.5, ''],
  ['speed kept through a route cut (mean)', C.cuts ? C.cutKeep / C.cuts : 0, null, '', [0.35, 0.85]],
  ['bodies pressed together, no block (pair-steps/play)', C.crowd / C.plays, 3, ''],
  ['5+ body pile in the first 1.5 s (s/play)', C.pile / C.plays, 0.4, ''],
  ['biggest pile (bodies)', C.pileMax, 8, ''],
  ['blocks standing still (% of block time)', pct(C.engStill, C.engT), 35, '%'],
  ['man defender reacts to a cut (median s)', med(C.manReact), null, 's', [0.12, 0.6]],
  ['man defender never reacts (% of cuts)', pct(C.manNever, C.manCuts), 15, '%'],
  ['tackled carrier slides from the hit (median yd)', med(C.slide), 1.6, ' yd'],
  ['possession state machine breaks', C.possBad, 0, ''],
  ['downed players still moving after the whistle', C.deadMoves, 0, ''],
];
let bad = 0;
console.log(`${C.plays} live plays, ${C.cuts} route cuts, ${C.manCuts} man-coverage reactions, ${C.tackles} tackles`);
for (const [name, v, lim, unit, range] of rows) {
  const over = lim != null ? v > lim : range ? v < range[0] || v > range[1] : false;
  if (over) bad++;
  const limText = lim != null ? `limit ${lim}${unit}` : range ? `range ${range[0]}-${range[1]}${unit}` : '';
  console.log(`${over ? 'FAIL' : '  ok'}  ${name.padEnd(56)} ${v.toFixed(2).padStart(7)}${unit}  (${limText})`);
}
if (STRICT && bad) process.exit(1);
if (C.why) console.log(Object.entries(C.why).sort((a,b)=>b[1]-a[1]).slice(0,15));
