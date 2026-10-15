// Defense in a live play: the defensive calls as data, the alignment and man or zone
// assignments at the line, and what each defender wants each step (rush, cover, pursue).
import { clamp, rep } from '../engine.js';
import { frontX } from '../formations.js';
import { DT, RECEIVERS, dist, len, seek, sgn, slowDown } from '../live.js';

// Defensive calls as data: who rushes (blitz), who drops from the line into coverage (drop),
// zone spots { slot: [depth, across, radius] } (across is toward the defender's own side for
// 'flat' entries), man matchups that differ from the default (receiver -> defender), pressed
// corners and walked-up alignments { slot: [depth, across] } (null keeps that coordinate).
const C2 = { CB1: [5, -19, 7], CB2: [5, 19, 7], CB3: [7, -9, 6], FS: [18, -12, 12], SS: [18, 12, 12], OLB: [6, 9, 6], MLB: [7, 0, 6] };
const C3 = { CB1: [17, -17, 10], CB2: [17, 17, 10], FS: [21, 0, 12], CB3: [6, -14, 7], SS: [6, 14, 7], OLB: [7, 6, 6], MLB: [7, -4, 6] };
export const DEF_SCHEMES = {
  base: {},
  cover1_robber: { zones: { SS: [9, 0, 7] }, man: { TE: 'OLB', RB: 'MLB' }, manUnder: true },
  cover2_man: { zones: { FS: [17, -12, 12], SS: [17, 12, 12] }, man: { TE: 'OLB', RB: 'MLB' }, manUnder: true, align: { FS: [14, -12], SS: [14, 12] } },
  man_press: { press: true },
  goal_line: {},
  cover2: { zones: C2, align: { FS: [14, -12], SS: [14, 12] } },
  tampa2: { zones: { ...C2, MLB: [14, 0, 8] }, align: { FS: [14, -12], SS: [14, 12] } },
  cover3: { zones: C3, align: { FS: [15, 0], CB1: [8, null], CB2: [8, null] } },
  cover4: { zones: { CB1: [16, -17, 9], CB2: [16, 17, 9], FS: [17, -6, 8], SS: [17, 6, 8], CB3: [6, -12, 7], OLB: [6, 8, 6], MLB: [6, -2, 6] },
    align: { FS: [11, -7], SS: [11, 7], CB1: [7, null], CB2: [7, null] } },
  prevent: { zones: { CB1: [20, -17, 12], CB2: [20, 17, 12], FS: [28, 0, 14], CB3: [13, -10, 9], SS: [13, 10, 9], OLB: [9, 5, 7], MLB: [9, -5, 7] }, deepen: 6 },
  run_blitz: { blitz: ['MLB'], align: { MLB: [3.2, null] } },
  pass_blitz: { blitz: ['OLB', 'MLB'] },
  mug: { blitz: ['OLB', 'MLB'], align: { MLB: [2.4, -1.4], OLB: [2.4, 1.4] } },
  nickel_blitz: { blitz: ['CB3'], man: { WR3: 'SS', TE: 'OLB', RB: 'MLB' }, align: { CB3: [2.5, null] } },
  fire_zone: { blitz: ['MLB', 'SS'], drop: ['DE'], zones: { CB1: [17, -17, 10], CB2: [17, 17, 10], FS: [21, 0, 12], DE: [5, 'flat', 7], CB3: [6, -13, 7], OLB: [7, 4, 6] } },
  cover0: { blitz: ['OLB', 'MLB', 'SS'], man: { TE: 'FS' }, press: true },
};
const LINE = ['LE', 'DE', 'DT1', 'DT2'];

export function setupDefense(lp) {
  const D = lp.def, call = lp.defCall, S = DEF_SCHEMES[call] ?? {};
  const cap = (x) => Math.min(x, lp.goalX + 8);
  if (S.press) for (const k of ['CB1', 'CB2', lp.defFormation === 'nickel' ? 'CB3' : null]) if (D[k]) D[k].x = frontX(D[k]) + 0.6;
  for (const [k, [x, y]] of Object.entries(S.align ?? {})) if (D[k]) { if (x != null) D[k].x = x; if (y != null) D[k].y = y; }
  if (S.deepen) for (const p of Object.values(D)) if (!LINE.includes(p.slot)) p.x += S.deepen;
  for (const p of Object.values(D)) p.x = Math.max(frontX(p), cap(p.x));

  const O = lp.off;
  const covR = (r, c) => {
    const route = lp.depth === 'deep' ? r.a.spd * 0.6 + r.a.hnd * 0.25 + r.a.acc * 0.15 : r.a.spd * 0.35 + r.a.hnd * 0.3 + r.a.acc * 0.35;
    const R = rep(r.id, route, c.id, c.a.cov);
    return clamp(0.12 + R.diff * 0.011, 0.02, 0.5);
  };
  const blitz = new Set(lp.blitz), drop = new Set(S.drop ?? []), zoned = new Set(Object.keys(S.zones ?? {}));
  for (const p of Object.values(D)) {
    if ((LINE.includes(p.slot) && !drop.has(p.slot)) || blitz.has(p.slot)) p.role = 'rush';
    else p.role = 'cover';
  }
  // Man coverage underneath: the default matchups, then the call's own; a defender who rushes
  // or plays a zone hands his man to the next free linebacker or safety.
  if (!lp.zone) {
    const man = { WR1: 'CB1', WR2: 'CB2', WR3: 'CB3', TE: 'SS', RB: 'OLB', ...(S.man ?? {}) };
    const taken = new Set();
    const spare = ['OLB', 'MLB', 'SS', 'FS', 'CB3'];
    for (const rk of ['WR1', 'WR2', 'WR3', 'TE', 'RB']) {
      const r = O[rk];
      if (!r) continue;
      let ck = man[rk];
      const free = (k) => D[k] && D[k].role === 'cover' && !zoned.has(k) && !taken.has(k);
      if (!free(ck)) ck = spare.find(free) ?? null;
      // Leave the free safety deep unless the call puts him on a man.
      if (ck === 'FS' && !Object.values(S.man ?? {}).includes('FS') && rk !== 'TE') ck = null;
      if (!ck) continue;
      taken.add(ck);
      D[ck].man = r; D[ck].lag = covR(r, D[ck]) - (S.press ? 0.05 : 0);
    }
  }
  if (S.zones) {
    const g = lp.goalX;
    for (const [k, [x, y, r]] of Object.entries(S.zones)) {
      const p = D[k];
      if (!p || p.role !== 'cover' || p.man) continue;
      const across = y === 'flat' ? sgn(p.y || 1) * 13 : y;
      p.zone = { x: Math.min(x, g + 7), y: across, r };
      p.lag = clamp(0.32 - (p.a.cov - 60) * 0.007, 0.06, 0.5);
    }
  }
}

export function rushWant(lp, p) {
  if (p.eng) return;
  const c = lp.carrierSet ? lp.carrier : lp.off.QB;
  if (!c) return;
  // The unblocked end on a read: he either crashes down on the back or stays home for the
  // quarterback, and the quarterback reads which.
  if (p === lp.readEnd && !lp.carrierSet) return p.crash ? seek(p, { x: -2.5, y: lp.holeY * 0.5 }, 0.9) : seek(p, { x: 0.3, y: p.home.y * 1.05 }, 0.4);
  // Draws and play-action freeze the front for a beat.
  const fooled = ((lp.play.dir === 'draw' && !lp.carrierSet) || lp.play.pa) && lp.t < (lp.play.dir === 'draw' ? 0.9 : 0.5);
  // Against a run each lineman fills his own gap until the ball declares itself: he plays his
  // gap a yard into the backfield and only chases once the carrier is in his lane or past the
  // line. That is what keeps the cutback lanes closed.
  if (lp.kind === 'run' && lp.play.dir !== 'draw' && p.gapY != null && c.x < 0.5 && Math.abs(c.y - p.gapY) > 2.2 && lp.t < 2.2) {
    return seek(p, { x: Math.max(0.3, c.x + 2), y: p.gapY + (c.y - p.gapY) * 0.2 }, 0.7, 0.5);
  }
  // Pass rush: keep outside leverage on the edge so the quarterback cannot escape that way.
  if (lp.kind === 'pass' && !lp.carrierSet && p.edge && lp.t < 1.6 && Math.abs(p.y) > Math.abs(c.y) + 1.2) {
    return seek(p, { x: c.x + 1.5, y: c.y + p.edge * 2.4 }, 1, 0.3);
  }
  // A rusher whose way to the quarterback is walled off by the pile at the line picks the
  // nearest open lane through it instead of pressing into bodies.
  if (lp.kind === 'pass' && !lp.carrierSet && p.x > c.x + 2) {
    const lane = rushLane(lp, p, c);
    if (lane) return seek(p, lane, fooled ? 0.7 : 1, 0.05);
  }
  intercept(p, c, fooled ? 0.7 : 1);
}
// The point to aim for to get through the line, or null if the straight path is open.
function rushLane(lp, p, c) {
  // Room along the path from him to (x, y): the closest any body comes to that segment.
  const clear = (x, y) => {
    const sx = x - p.x, sy = y - p.y, L2 = sx * sx + sy * sy || 1;
    let m = 99;
    for (const q of lp.players) {
      if (q === p) continue;
      const u = clamp(((q.x - p.x) * sx + (q.y - p.y) * sy) / L2, 0, 1);
      m = Math.min(m, Math.hypot(q.x - (p.x + sx * u), q.y - (p.y + sy * u)) - q.r);
    }
    return m - p.r;
  };
  // Is anybody on the straight line within the next three yards?
  const dx = c.x - p.x, dy = c.y - p.y, d = len(dx, dy) || 1;
  let blocked = false;
  for (const q of lp.players) {
    if (q === p) continue;
    const rx = q.x - p.x, ry = q.y - p.y, along = (rx * dx + ry * dy) / d;
    if (along <= 0 || along > 3) continue;
    if (Math.abs(rx * dy - ry * dx) / d < q.r + p.r * 0.8) { blocked = true; break; }
  }
  if (!blocked) return null;
  // Candidate lanes a yard or two ahead, from his own y outward; the closest one with room.
  const ax = p.x - 1.6;
  let best = null;
  for (let k = 0; k <= 16; k++) {
    for (const s of k ? [-1, 1] : [1]) {
      const y = p.y + s * k * 0.6, room = clear(ax, y);
      if (room > 0.1) { const cost = k * 0.6 + Math.abs(y - c.y) * 0.15; if (!best || cost < best.cost) best = { x: ax, y, cost }; }
    }
    if (best) break;
  }
  if (best) return best;
  // No lane at all: loop around the end of the line.
  let wide = 0;
  for (const q of lp.players) if (q.side !== p.side && Math.abs(q.x) < 3) wide = Math.max(wide, Math.abs(q.y) + q.r);
  return { x: p.x, y: sgn(p.y || 0.01) * (wide + p.r + 0.6) };
}

export function coverWant(lp, p) {
  const g = lp.g;
  const c = lp.carrierSet ? lp.carrier : null;
  if (c) { pursueWant(lp, p, c); return; }
  if (lp.thrown) {
    const T = lp.thrown;
    if (p.react == null || p.react <= -1) p.react = 0.1 + (100 - (p.a.cov * 0.6 + p.a.awr * 0.4)) * 0.005;
    if (p.react > 0) { p.react -= DT; }
    else if (dist(p, { x: T.tx, y: T.ty }) < 16) return seek(p, { x: T.tx + 0.3, y: T.ty }, 1, 0.2);
  }
  // Run reads: linebackers and safeties fill once the ball is handed off (handled by pursuit).
  if (lp.kind === 'run' && !lp.carrierSet && ['MLB', 'OLB', 'SS'].includes(p.slot)) {
    // A counter's jab step pulls them the wrong way for a beat.
    const fooled = lp.play.dir === 'counter' && lp.t < 0.55 ? -1 : 1;
    // A draw shows pass: they drop to their coverage depth until the handoff.
    if (lp.play.dir === 'draw' || lp.play.dir === 'qbdraw') return seek(p, { x: p.home.x + 2.5, y: p.home.y }, 0.55);
    return seek(p, { x: Math.max(1.5, p.x - 1), y: lp.holeY * 0.5 * fooled }, 0.5);
  }
  if (lp.play.pa && lp.t < 0.6 && ['MLB', 'OLB', 'SS'].includes(p.slot)) return seek(p, { x: 1.5, y: p.y }, 0.6);
  if (p.zone) return zoneWant(lp, p);
  if (p.man) {
    const r = p.man;
    if (r.role !== 'route' && r.role !== 'carrier') { // receiver stayed in to block: rob the middle
      return seek(p, { x: 6, y: p.y * 0.7 }, 0.6);
    }
    // A worse cover man reacts later to the receiver's cuts (lag), and a slower one simply
    // falls behind; on straight lines downfield he only gives up a little ground.
    p.aim = r;
    const lag = p.lag ?? 0.2;
    const px = r.x - r.vx * lag * 0.45, py = r.y - r.vy * lag;
    // Keep a cushion over the top that closes as the route develops.
    p.gap0 ??= Math.max(1, p.x - r.x);
    const cushion = Math.max(r.x > 12 ? 1.4 : 0.4, p.gap0 - lp.t * 5);
    const tx = px + cushion, ty = py + (r.y > 0 ? -0.4 : 0.4);
    let vx = (tx - p.x) * 3 + r.vx, vy = (ty - p.y) * 3 + r.vy;
    const l = len(vx, vy), cap = p.top;
    if (l > cap) { vx *= cap / l; vy *= cap / l; }
    p.want = { vx, vy };
    void g;
    return;
  }
  // Free safety in man schemes: shade the deepest threat from over the top.
  let deep = null;
  for (const k of RECEIVERS) { const r = lp.off[k]; if (r && r.role === 'route' && (!deep || r.x > deep.x)) deep = r; }
  if (deep && deep.x > 4) return seek(p, { x: Math.max(p.x, deep.x + 5), y: deep.y * 0.6 + p.y * 0.4 }, 0.9, 1);
  seek(p, { x: p.x, y: p.y }, 0.2);
}

function zoneWant(lp, p) {
  const z = p.zone;
  let threat = null, tv = -99;
  for (const k of RECEIVERS) {
    const r = lp.off[k];
    if (!r || r.role !== 'route') continue;
    const dz = Math.hypot(r.x - z.x, r.y - z.y);
    if (dz > z.r + 2) continue;
    const v = -dz + r.x * 0.15;
    if (v > tv) { tv = v; threat = r; }
  }
  if (!threat) { seek(p, z, 0.75, 2); return; }
  const lag = p.lag ?? 0.25;
  const px = threat.x - threat.vx * lag * 0.45, py = threat.y - threat.vy * lag;
  let tx = (px + 1.2) * 0.75 + z.x * 0.25;
  const ty = py * 0.75 + z.y * 0.25;
  // Deep zones never let a receiver get behind them.
  if (z.x >= 15) tx = Math.max(tx, px + 2.5);
  seek(p, { x: tx, y: ty }, 1, 0.6);
}

// Pursuit with leverage. The defender with the outside position on the carrier keeps it
// (contain: he aims a step outside so the carrier is turned back inside); the others come
// inside-out so there is no cutback; the deep men stay over the top, between the carrier and
// the end zone, until he is close enough to take on.
export function pursueWant(lp, p, c) {
  if (!c || p.eng) return;
  if (p.react > 0) { p.react -= DT; slowDown(p, DT); return; }
  const fwd = c.side === 'off' ? 1 : -1;
  const d = dist(p, c);
  if (d > 3.2 && c.side === 'off') {
    const out = sgn(c.y || 0.01);
    // Contain: the pursuer outside the carrier and level with or ahead of him.
    const outside = (p.y - c.y) * out > 0.5 && (p.x - c.x) * fwd > -1;
    // Deep help: well downfield of the carrier.
    const deep = (p.x - c.x) * fwd > 8 && d > 7;
    if (deep) {
      // Shuffle to stay square over the top and close the gap at an angle.
      const T = Math.min(1.2, d / p.top);
      const tx = c.x + c.vx * T + fwd * Math.min(2.5, d * 0.2), ty = c.y + c.vy * T;
      return seek(p, { x: tx, y: ty }, 1, 0.05);
    }
    intercept(p, c, 1);
    if (p.want) {
      const sh = outside ? out * 0.6 : -out * 0.25;
      const tl = Math.max(1, d);
      p.want.vy += sh * p.top / tl;
      const l = len(p.want.vx, p.want.vy) || 1, cap = p.top;
      if (l > cap) { p.want.vx *= cap / l; p.want.vy *= cap / l; }
    }
    return;
  }
  intercept(p, c, 1);
}

// Aim at where the target will be, not where it is.
function intercept(p, c, frac) {
  p.aim = c;
  // Solve |c + v t - p| = speed * t for the earliest t.
  const sp = Math.max(3, p.top * frac);
  const rx = c.x - p.x, ry = c.y - p.y;
  const a = c.vx * c.vx + c.vy * c.vy - sp * sp, b = 2 * (rx * c.vx + ry * c.vy), cc = rx * rx + ry * ry;
  let T = len(rx, ry) / sp;
  if (Math.abs(a) > 1e-6) {
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const t1 = (-b - Math.sqrt(disc)) / (2 * a), t2 = (-b + Math.sqrt(disc)) / (2 * a);
      const ts = [t1, t2].filter((t) => t > 0);
      if (ts.length) T = Math.min(...ts);
    }
  }
  T = Math.min(T, 2.5);
  // Up close, take him on directly instead of racing to a spot downfield.
  const d = len(rx, ry);
  if (d < 5) T = Math.min(T, 0.08 + d * 0.05);
  seek(p, { x: c.x + c.vx * T, y: c.y + c.vy * T }, frac, 0.05);
}
