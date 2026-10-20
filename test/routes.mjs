// Route and throw audit: plays live pass snaps with everyone on autopilot and measures
//   - route fidelity: how far each receiver strays from the route drawn on the play art (the
//     polyline from where he lined up through his waypoints) while he is still running it,
//     before the ball is thrown and before the quarterback breaks the pocket
//   - wayward throws: passes aimed at a receiver that come down out of bounds or past the end
//     line (throwaways do not count)
// Prints each measure; --strict exits non-zero past the limits.
// Usage: node test/routes.mjs [plays, default 400] [--strict]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, SIDE } from '../src/live.js';
import { scrambling, scrambleDrill } from '../src/live/passing.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 400);
const STRICT = process.argv.includes('--strict');
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

// Distance from a point to a polyline.
function offPath(pts, x, y) {
  let best = 99;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * u - x, a.y + dy * u - y));
  }
  return best;
}
const C = { plays: 0, routes: 0, strays: 0, maxDev: [], legs: 0, scrambleDrill: 0, throws: 0, oob: 0, deep: 0, oobCaught: 0, examples: [] };
for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 1 + (Math.floor(i / 8) % 7)) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 7100 + i, weather: 'clear' });
  g.spot = 15 + ((i * 29) % 80); g.down = 1 + (i % 3); g.toGo = Math.min(10, 100 - g.spot); g.poss = i % 2;
  const off = aiOffenseCall(g), def = aiDefenseCall(g);
  if (OFF_PLAYS[off].kind !== 'pass') continue;
  const lp = createLivePlay(g, off, def, {});
  snap(lp);
  C.plays++;
  const R = new Map();
  for (let s = 0; s < 60 * 12 && lp.phase === 'live'; s++) {
    // Every third play the quarterback slides a few yards wide in the pocket for a moment (a
    // user dodging a rusher): the routes should keep running as called through it.
    if (i % 3 === 0 && lp.t > 1.25 && lp.t < 1.55 && lp.ball.holder === lp.off.QB && !lp.windup) lp.off.QB.y += 18 * (1 / 60) * (lp.off.QB.y >= 0 ? 1 : -1);
    step(lp, null);
    if (scrambling(lp)) C.scrambleDrill++;
    if (lp.thrown || lp.windup || lp.carrierSet) continue;
    for (const p of lp.players) {
      if (p.side !== 'off' || p.role !== 'route' || !p.route || p.jam > 0 || scrambleDrill(lp, p)) continue;
      if (p.wp >= p.route.length || p.route[p.wp]?.block != null) continue;
      // Measured against the route as drawn, from where he lined up (or, for a back who checks
      // the blitz first, from where he released).
      if (!R.has(p)) R.set(p, { pts: [p.legFrom ?? p.route.from ?? p.home, ...p.route.slice(p.wp).filter((w) => w.x != null)], max: 0, name: p.routeName });
      const r = R.get(p);
      r.max = Math.max(r.max, offPath(r.pts, p.x, p.y));
    }
  }
  for (const r of R.values()) {
    C.routes++; C.maxDev.push(r.max); (C.all ??= []).push([r.name, r.max]);
    if (r.max > 2) { C.strays++; if (C.examples.length < 8) C.examples.push(`${off} ${r.name} strayed ${r.max.toFixed(1)}`); }
  }
  const F = lp.thrown;
  if (F && F.target && !F.away) {
    C.throws++;
    const out = Math.abs(F.ty) > SIDE, back = F.tx > lp.goalX + 10;
    if (out) C.oob++;
    if (back) C.deep++;
  }
}
const pct = (x, n) => (100 * x / (n || 1)).toFixed(1) + '%';
C.maxDev.sort((x, y) => x - y);
const q = (u) => (C.maxDev[Math.floor(u * (C.maxDev.length - 1))] ?? 0).toFixed(2);
console.log(`${C.plays} pass plays, ${C.routes} routes`);
console.log(`route deviation (yd): median ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${q(1)}  strayed >2yd ${pct(C.strays, C.routes)}`);
const byName = {};
for (const e of C.all ?? []) { const b = byName[e[0]] ??= [0, 0, 0]; b[0]++; b[1] += e[1]; if (e[1] > 2) b[2]++; }
if (process.argv.includes("--by")) for (const [k, b] of Object.entries(byName)) console.log("   ", k.padEnd(9), "n", String(b[0]).padStart(4), "mean", (b[1] / b[0]).toFixed(2), "stray", (100 * b[2] / b[0]).toFixed(0) + "%");
for (const e of C.examples) console.log('   ', e);
console.log(`throws ${C.throws}: aimed out of bounds ${pct(C.oob, C.throws)}  past the end line ${pct(C.deep, C.throws)}`);
console.log(`scramble-drill frames per play ${(C.scrambleDrill / C.plays).toFixed(1)}`);
const bad = [];
if (C.strays / C.routes > 0.02) bad.push('receivers stray from their routes');
if ((C.oob + C.deep) / C.throws > 0.02) bad.push('too many throws land out of bounds');
if (STRICT && bad.length) { console.log('FAIL:', bad.join('; ')); process.exit(1); }
