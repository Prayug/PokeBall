// Collision audit: bodies should push, slide and shed off each other, never stand pinned.
//   - you at quarterback, from every formation: dropping back, dropping deep, drifting and
//     stepping up must not leave you stuck on your own back or linemen (time spent pressed into
//     a teammate while the stick says go, and how much of the stick's ground you actually make)
//   - receivers on autopilot: a receiver pressed into a defender while running his route and
//     going nowhere (pinned) for a long beat
//   - anyone: two free bodies (no block, no tackle between them) pressed together and both
//     standing still for half a second or more
// Prints each measure; --strict exits non-zero past the limits.
// Usage: node test/collisions.mjs [plays, default 300] [--strict] [--by]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step } from '../src/live.js';
import { OFF_FORMATIONS, formationsFor } from '../src/formations.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 300);
const STRICT = process.argv.includes('--strict');
const BY = process.argv.includes('--by');
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const len = Math.hypot;
const touching = (a, b, slack = 0.06) => len(a.x - b.x, a.y - b.y) < a.r + b.r + slack;
const pct = (x, n) => (100 * x / (n || 1)).toFixed(1) + '%';
const PASS = Object.keys(OFF_PLAYS).filter((k) => OFF_PLAYS[k].kind === 'pass' && !OFF_PLAYS[k].boot && formationsFor(k).length);
const DEFS = ['base', 'cover2', 'cover3', 'man_press', 'pass_blitz', 'cover0'];

// ---------- you at quarterback ----------
const SCRIPTS = {
  'drops back': (t) => (t < 1 ? { mx: -1, my: 0 } : {}),
  'drops deep': (t) => (t < 1.8 ? { mx: -1, my: 0 } : {}),
  'drops and drifts': (t) => (t < 0.8 ? { mx: -1, my: 0 } : t < 1.8 ? { mx: 0, my: 0.8 } : {}),
  'drops, steps up': (t) => (t < 0.9 ? { mx: -1, my: 0 } : t < 1.8 ? { mx: 1, my: 0 } : {}),
  'drops on an angle': (t) => (t < 1.4 ? { mx: -0.8, my: -0.6 } : {}),
};
const Q = {};
for (const form of process.env.NOQB ? [] : Object.keys(OFF_FORMATIONS)) for (const [name, f] of Object.entries(SCRIPTS)) {
  const u = Q[`${form} | ${name}`] = { plays: 0, stuck: 0, pressT: 0, made: 0, want: 0, examples: [] };
  for (let i = 0; i < Math.max(8, Math.round(N / 10)); i++) {
    const g = createGame({ home: teamForGame(L.teams[i % 8]), away: teamForGame(L.teams[(i + 3) % 8]), seed: 12000 + i, weather: 'clear' });
    g.poss = 0; g.spot = 25 + (i % 45); g.down = 1; g.toGo = 10;
    const off = PASS[i % PASS.length];
    if (!formationsFor(off).includes(form)) continue;
    const lp = createLivePlay(g, off, DEFS[i % DEFS.length], { userSide: 0, formation: form });
    snap(lp);
    u.plays++;
    const qb = lp.off.QB;
    let press = 0, run = 0, worst = 0;
    for (let s = 0; s < 60 * 2.2 && lp.phase === 'live' && !lp.thrown && !lp.tackle; s++) {
      const inp = { mx: 0, my: 0, ...f(lp.t) };
      const x0 = qb.x, y0 = qb.y;
      step(lp, inp);
      if (!(lp.ball.holder === qb && lp.ball.state === 'held')) continue;
      const m = len(inp.mx, inp.my);
      if (m < 0.1) { run = 0; continue; }
      const ux = inp.mx / m, uy = inp.my / m;
      const gain = (qb.x - x0) * ux + (qb.y - y0) * uy;
      // Ground he could make at his jogging pace, after the first step.
      if (lp.t > 0.35) { u.made += Math.max(0, gain); u.want += qb.top * 0.86 / 60; }
      const mate = lp.players.find((p) => p !== qb && p.side === 'off' && touching(p, qb));
      if (mate && lp.t > 0.35 && gain < qb.top * 0.35 / 60) { press++; run++; worst = Math.max(worst, run); if (run === 12 && u.examples.length < 3) u.examples.push(`${off} into ${mate.slot} (${mate.role}) at t=${lp.t.toFixed(2)}`); }
      else run = 0;
    }
    u.pressT += press / 60;
    if (worst >= 12) u.stuck++;
  }
}

// ---------- receivers and everyone else, all on autopilot ----------
const C = { plays: 0, routes: 0, pinnedR: 0, pinnedLong: 0, pinnedDB: 0, jamFrames: 0, jams: 0, releases: 0, recvContact: 0, recvFrames: 0, pairs: 0, pairBy: {}, examples: [] };
for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 13100 + i, weather: 'clear' });
  g.spot = 15 + ((i * 29) % 65); g.down = 1 + (i % 3); g.toGo = Math.min(10, 100 - g.spot); g.poss = i % 2;
  const off = aiOffenseCall(g), def = i % 3 === 0 ? 'man_press' : aiDefenseCall(g);
  const k = OFF_PLAYS[off].kind;
  if (k !== 'run' && k !== 'pass') continue;
  const forms = formationsFor(off);
  const lp = createLivePlay(g, off, def, { formation: forms[i % forms.length] });
  snap(lp);
  C.plays++;
  const pin = new Map(), pair = new Map(), routes = new Set();
  for (let s = 0; s < 60 * 10 && lp.phase === 'live'; s++) {
    step(lp, null);
    const free = (p) => !p.eng && !(p.stun > 0) && !(lp.tackle && (lp.tackle.c === p || lp.tackle.q === p)) && p.jump == null && p.dive == null && !p.downed;
    // Receivers running routes, before the throw.
    if (!lp.thrown && !lp.carrierSet) for (const p of lp.players) {
      if (p.side !== 'off' || p.role !== 'route' || !p.route || p.wp >= p.route.length || p.route[p.wp]?.block != null) continue;
      routes.add(p);
      C.recvFrames++;
      const d = lp.players.find((q) => q.side === 'def' && touching(p, q));
      if (d) C.recvContact++;
      // A jam at the line is a real hand fight, and it is over in under half a second.
      if (p.jam > 0) { C.jamFrames++; pin.set(p, 0); continue; }
      const slow = len(p.vx, p.vy) < p.top * 0.3;
      const n = d && slow ? (pin.get(p) ?? 0) + 1 : 0;
      pin.set(p, n);
      if (n === 36) C.pinnedLong++;
      if (n === 18 && ['CB1', 'CB2', 'CB3', 'SS', 'FS'].includes(d.slot)) C.pinnedDB++;
      if (n === 18) { C.pinnedR++; if (C.examples.length < (process.env.PAIRS ? 40 : 6)) C.examples.push(`${off} vs ${def}: ${p.slot} pinned on ${d.slot} (${d.role}) at t=${lp.t.toFixed(2)}` + (process.env.PAIRS ? ` r ${p.x.toFixed(1)},${p.y.toFixed(1)} want ${p.want?.vx.toFixed(1)},${p.want?.vy.toFixed(1)} wp ${p.wp}/${p.route.length} ${p.routeName} d ${d.x.toFixed(1)},${d.y.toFixed(1)} want ${d.want?.vx.toFixed(1)},${d.want?.vy.toFixed(1)} man ${d.man?.slot} zone ${!!d.zone} eng ${!!d.eng}` : "")); }
    }
    // Any two free bodies pressed together, both still.
    for (let x = 0; x < lp.players.length; x++) for (let y = x + 1; y < lp.players.length; y++) {
      const A = lp.players[x], B = lp.players[y];
      const key = x * 32 + y;
      const still = free(A) && free(B) && touching(A, B, 0.03) && len(A.vx, A.vy) < 0.8 && len(B.vx, B.vy) < 0.8 && (A.want || B.want) && (len(A.want?.vx ?? 0, A.want?.vy ?? 0) > 2 || len(B.want?.vx ?? 0, B.want?.vy ?? 0) > 2);
      const n = still ? (pair.get(key) ?? 0) + 1 : 0;
      pair.set(key, n);
      if (n === 30) { C.pairs++; const tag = [`${A.side}:${A.role}`, `${B.side}:${B.role}`].sort().join(" + "); C.pairBy[tag] = (C.pairBy[tag] ?? 0) + 1; if (process.env.PAIRS) console.log("  pair", off, lp.formation, A.slot, A.role, A.x.toFixed(1), A.y.toFixed(1), B.slot, B.role, B.x.toFixed(1), B.y.toFixed(1), "t", lp.t.toFixed(2), "aim", A.aim?.slot, B.aim?.slot); }
    }
  }
  C.routes += routes.size;
  for (const e of lp.events) { if (e.kind === 'jam') C.jams++; if (e.kind === 'release') C.releases++; }
}

let bad = [];
const agg = {};
for (const [k, u] of Object.entries(Q)) {
  const [form] = k.split(' | ');
  const A = agg[form] ??= { plays: 0, stuck: 0, pressT: 0, made: 0, want: 0 };
  A.plays += u.plays; A.stuck += u.stuck; A.pressT += u.pressT; A.made += u.made; A.want += u.want;
  if (BY || u.stuck) console.log(`you at QB, ${k.padEnd(34)} stuck on a teammate ${pct(u.stuck, u.plays)}  pressed ${(u.pressT / (u.plays || 1)).toFixed(2)}s/play  ground made ${pct(u.made, u.want)}`, u.examples.join('; '));
}
for (const [form, A] of Object.entries(agg)) {
  console.log(`you at QB from ${form.padEnd(11)} ${A.plays} snaps: stuck on a teammate ${pct(A.stuck, A.plays)}  pressed into one ${(A.pressT / (A.plays || 1)).toFixed(2)}s/play  ground made ${pct(A.made, A.want)}`);
  if (A.stuck / (A.plays || 1) > 0.02) bad.push(`the quarterback gets stuck on a teammate from ${form}`);
  if (A.made / (A.want || 1) < 0.7) bad.push(`the quarterback can't make his drop from ${form}`);
}
console.log(`${C.plays} plays, ${C.routes} routes: receivers touching a defender ${pct(C.recvContact, C.recvFrames)} of route frames, pinned 0.3s+ on one ${pct(C.pinnedR, C.routes)} (on a defensive back ${pct(C.pinnedDB, C.routes)}), 0.6s+ ${pct(C.pinnedLong, C.routes)}`);
for (const e of C.examples) console.log('   ', e);
console.log(`jams at the line ${C.jams}, clean releases ${C.releases}, held up ${(C.jamFrames / 60 / (C.jams || 1)).toFixed(2)}s per jam`);
console.log(`free bodies pressed together and standing still 0.5s+: ${(C.pairs / C.plays).toFixed(3)} per play`, JSON.stringify(C.pairBy));
// (A tight end or slot crossing through the trash at the line can still be caught in it for a
// beat; a receiver held up by a defensive back, or anyone held for long, is the bug.)
if (C.pinnedR / (C.routes || 1) > 0.02) bad.push('receivers get pinned on defenders');
if (C.pinnedDB / (C.routes || 1) > 0.005) bad.push('receivers get pinned on defensive backs');
if (C.pinnedLong / (C.routes || 1) > 0.008) bad.push('receivers stay pinned on defenders');
if (C.pairs / C.plays > 0.1) bad.push('free bodies stand pinned against each other');
if (bad.length) console.log('FAIL:', bad.join('; '));
if (STRICT && bad.length) process.exit(1);
