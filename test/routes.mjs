// Route and throw audit: plays live pass snaps with everyone on autopilot and measures
//   - route fidelity: how far each receiver strays from the route drawn on the play art (the
//     polyline from where he lined up through his waypoints) while he is still running it,
//     before the ball is thrown and before the quarterback breaks the pocket
//   - the same with you at quarterback: standing in, dropping back (even deep) and drifting in
//     the pocket keep every route on the play art (the arrow carries on past the last break, up
//     the sideline when it gets there); scrambling out wide sends them into the scramble drill
//   - wayward throws: passes aimed at a receiver that come down out of bounds or past the end
//     line (throwaways do not count)
// Prints each measure; --strict exits non-zero past the limits.
//   With --powers every Pokémon's power is switched on (a hot quarterback, a sped-up receiver),
//   so the same limits hold for them.
// Usage: node test/routes.mjs [plays, default 400] [--strict] [--powers]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, SIDE } from '../src/live.js';
import { scrambling, scrambleDrill } from '../src/live/passing.js';
import { POWER_OF, initPowers } from '../src/powers.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 400);
const STRICT = process.argv.includes('--strict');
const POWERS = process.argv.includes('--powers');
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
  if (POWERS) { const pw = initPowers(g); g.teams.forEach((t, ti) => { for (const id of Object.keys(t.stats)) if (POWER_OF[id]) pw.s[ti][id] = { ...(pw.s[ti][id] ?? {}), on: true }; }); }
  const off = aiOffenseCall(g), def = aiDefenseCall(g);
  if (OFF_PLAYS[off].kind !== 'pass') continue;
  const lp = createLivePlay(g, off, def, {});
  snap(lp);
  C.plays++;
  C.powered = (C.powered ?? 0) + lp.players.filter((p) => p.power).length;
  const R = new Map();
  for (let s = 0; s < 60 * 12 && lp.phase === 'live'; s++) {
    step(lp, null);
    if (scrambling(lp)) C.scrambleDrill++;
    if (lp.thrown || lp.windup || lp.carrierSet) continue;
    for (const p of lp.players) {
      if (p.side !== 'off' || p.role !== 'route' || !p.route || p.jam > 0 || R.get(p)?.drill) continue;
      // Once he breaks off into the scramble drill he is off the route by design.
      if (scrambleDrill(lp, p)) { if (R.has(p)) R.get(p).drill = true; continue; }
      if (p.route[p.wp]?.block != null) continue;
      // Past the end of the route: the art's arrow says he keeps going that way (a bar says he
      // sits down there), so that is what he is measured against until the ball is thrown.
      if (p.wp >= p.route.length) {
        const r = R.get(p);
        if (!r) continue;
        if (!r.ext) {
          const pts = r.pts, b = pts[pts.length - 1], a = pts[pts.length - 2] ?? b, l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          r.ext = p.route[p.route.length - 1]?.stop ? [b, b] : [b, { x: b.x + (b.x - a.x) / l * 30, y: b.y + (b.y - a.y) / l * 30 }];
        }
        r.after = Math.max(r.after ?? 0, offPath(r.ext, p.x, p.y));
        continue;
      }
      // Measured against the route as drawn, from where he lined up (or, for a back who checks
      // the blitz first, from where he released).
      if (!R.has(p)) R.set(p, { pts: [p.legFrom ?? p.route.from ?? p.home, ...p.route.slice(p.wp).filter((w) => w.x != null)], max: 0, name: p.routeName });
      const r = R.get(p);
      r.max = Math.max(r.max, offPath(r.pts, p.x, p.y));
    }
  }
  for (const r of R.values()) {
    if (r.after != null) { C.afters = (C.afters ?? 0) + 1; if (r.after > 3) { C.afterStray = (C.afterStray ?? 0) + 1; (C.afterBy ??= {})[r.name] = (C.afterBy[r.name] ?? 0) + 1; } }
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
// You at quarterback: the stick scripts a player uses.
const SCRIPTS = {
  'stands in': () => ({}),
  'drops back': (t) => (t < 0.8 ? { mx: -1, my: 0 } : {}),
  'drops and drifts': (t) => (t < 0.8 ? { mx: -1, my: 0 } : t < 1.6 ? { mx: 0, my: 0.8 } : {}),
  'drops deep': (t) => (t < 1.4 ? { mx: -1, my: 0 } : {}),
  'scrambles wide': (t) => (t < 0.5 ? { mx: -1, my: 0 } : t < 2.4 ? { mx: 0, my: 1 } : {}),
};
const U = {};
const SIDE_IN = SIDE - 2.5;
for (const [name, f] of Object.entries(SCRIPTS)) {
  const u = U[name] = { n: 0, bad: 0, plays: 0, drill: 0 };
  for (let i = 0; i < Math.round(N / 3); i++) {
    const g = createGame({ home: teamForGame(L.teams[i % 8]), away: teamForGame(L.teams[(i + 3) % 8]), seed: 9000 + i, weather: 'clear' });
    g.poss = 0; g.spot = 30 + (i % 40); g.down = 1; g.toGo = 10;
    if (POWERS) { const pw = initPowers(g); g.teams.forEach((t, ti) => { for (const id of Object.keys(t.stats)) if (POWER_OF[id]) pw.s[ti][id] = { ...(pw.s[ti][id] ?? {}), on: true }; }); }
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    if (OFF_PLAYS[off].kind !== 'pass' || OFF_PLAYS[off].boot) continue;
    const lp = createLivePlay(g, off, def, { userSide: 0 });
    for (let k = 0; k < 900 && !lp.set; k++) step(lp, null);
    snap(lp);
    u.plays++;
    // The play art, with the arrow carried on: along the last leg, then up the sideline.
    const R = new Map();
    for (const p of lp.players) {
      if (p.side !== 'off' || p.role !== 'route' || !p.route || p.route[0].block != null) continue;
      const pts = [p.home, ...p.route.filter((w) => w.x != null)];
      if (!p.route[p.route.length - 1].stop) {
        const b = pts[pts.length - 1], a = pts[pts.length - 2], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
        let k = 25;
        if (uy && Math.abs(b.y + uy * k) > SIDE_IN) k = Math.max(0, (SIDE_IN * Math.sign(uy) - b.y) / uy);
        const e = { x: b.x + ux * k, y: b.y + uy * k };
        pts.push(e);
        if (k < 25) pts.push({ x: e.x + 20, y: e.y });
      }
      R.set(p, { pts, max: 0 });
    }
    let drill = false;
    for (let s = 0; s < 60 * 3.2 && lp.phase === 'live' && !lp.thrown; s++) {
      step(lp, { mx: 0, my: 0, ...f(lp.t, lp) });
      for (const [p, r] of R) {
        if (p.jam > 0) continue;
        if (scrambleDrill(lp, p)) { drill = true; r.drill = true; }
        if (!r.drill) r.max = Math.max(r.max, offPath(r.pts, p.x, p.y));
      }
    }
    if (drill) u.drill++;
    for (const r of R.values()) { u.n++; if (r.max > 3) u.bad++; }
  }
}
const pct = (x, n) => (100 * x / (n || 1)).toFixed(1) + '%';
C.maxDev.sort((x, y) => x - y);
const q = (u) => (C.maxDev[Math.floor(u * (C.maxDev.length - 1))] ?? 0).toFixed(2);
const live = C.powered ?? 0;
console.log(`${C.plays} pass plays, ${C.routes} routes${POWERS ? `, ${live} Pokémon with a power on the field` : ''}`);
console.log(`route deviation (yd): median ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${q(1)}  strayed >2yd ${pct(C.strays, C.routes)}`);
const byName = {};
for (const e of C.all ?? []) { const b = byName[e[0]] ??= [0, 0, 0]; b[0]++; b[1] += e[1]; if (e[1] > 2) b[2]++; }
if (process.argv.includes("--by")) for (const [k, b] of Object.entries(byName)) console.log("   ", k.padEnd(9), "n", String(b[0]).padStart(4), "mean", (b[1] / b[0]).toFixed(2), "stray", (100 * b[2] / b[0]).toFixed(0) + "%");
for (const e of C.examples) console.log('   ', e);
console.log(`after the route, off the art's arrow (or the bar) by 3+ yd: ${pct(C.afterStray ?? 0, C.afters)} of ${C.afters ?? 0}`, JSON.stringify(C.afterBy ?? {}));
console.log(`throws ${C.throws}: aimed out of bounds ${pct(C.oob, C.throws)}  past the end line ${pct(C.deep, C.throws)}`);
console.log(`scramble-drill frames per play ${(C.scrambleDrill / C.plays).toFixed(1)}`);
for (const [k, u] of Object.entries(U)) console.log(`you at QB, ${k.padEnd(17)} routes off the play art by 3+ yd ${pct(u.bad, u.n)}  plays in the scramble drill ${pct(u.drill, u.plays)}`);
const bad = [];
for (const [k, u] of Object.entries(U)) {
  if (u.bad / u.n > 0.03) bad.push(`receivers leave the play art when you ${k}`);
  if (k === 'scrambles wide' ? u.drill / u.plays < 0.5 : u.drill / u.plays > 0.05) bad.push(`scramble drill ${k === 'scrambles wide' ? 'missing when you scramble' : `on when you ${k}`}`);
}
if (C.strays / C.routes > 0.02) bad.push('receivers stray from their routes');
if ((C.oob + C.deep) / C.throws > 0.02) bad.push('too many throws land out of bounds');
if (STRICT && bad.length) { console.log('FAIL:', bad.join('; ')); process.exit(1); }
