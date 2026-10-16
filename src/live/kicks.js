// Punts and field goals played out on the live field: the long snap, the protection, the
// kick itself (from the punter's or kicker's own ratings), the coverage and the return.
// The ball's flight is ballistic like a pass; what happens when it comes down (a catch and a
// return, a fair catch, a bounce downed by the coverage, a touchback, out of bounds) is decided
// on the field, and engine.js turns the outcome into the next possession.
import { chance, clamp, eff, fgOdds, randn, specialist } from '../engine.js';
import { GRAVITY, SIDE, dist, event, finish, len, seek, setCarrier, sgn, unengage } from '../live.js';
import { flightAt } from './passing.js';

// A punt or field goal the live field plays (fakes are still resolved by the engine).
export const liveKick = (play) => !!play && (play.kind === 'punt' || play.kind === 'fg') && !play.fake;

const CATCH_R = 1.6;     // how far a returner reaches for a punt
const POST_H = 3.33;     // the crossbar, in yards
const POST_W = 3.08;     // half the distance between the uprights

// Line both teams up for the kick. `make` builds a player (live.js makePlayer).
export function setupKick(lp, make) {
  const g = lp.g, O = lp.off, D = lp.def, punt = lp.kind === 'punt';
  const K = (lp.kick = { punt, stage: 'pre', aim: lp.play.aim ?? null });
  const slot = punt ? 'P' : 'K';
  const id = specialist(g, lp.o, slot);
  // The specialist comes on for the quarterback (punt) or the third receiver (field goal),
  // unless he is already on the field at another spot.
  let kp = lp.players.find((p) => p.side === 'off' && p.id === id);
  if (!kp && id != null) {
    const out = (punt ? O.QB : O.WR3) ?? O.WR3 ?? O.RB;
    kp = make(g, lp.o, 'off', slot, id, lp);
    lp.players[lp.players.indexOf(out)] = kp;
    delete O[out.slot];
    O[slot] = kp;
  }
  kp ??= O.QB ?? O.RB;
  lp.kicker = kp;
  const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => O[k]).filter(Boolean);
  const lineX = ol.length ? Math.max(...ol.map((p) => p.x)) : -0.6;
  const lt = O.LT ?? ol[0], rt = O.RT ?? ol[ol.length - 1];
  const edge = (s) => (s < 0 ? lt?.y ?? -3 : rt?.y ?? 3);
  for (const p of ol) p.role = 'kblock';
  const rest = lp.players.filter((p) => p.side === 'off' && !ol.includes(p) && p !== kp);
  const put = (p, x, y, role) => { p.x = x; p.y = y; p.role = role; p.fx = 1; p.fy = 0; };
  if (punt) {
    put(kp, -14, 0, 'kicker');
    lp.snapTo = kp;
    // Two gunners split wide, two wings off the tackles, a personal protector in front of the punter.
    const fast = [...rest].sort((a, b) => b.a.spd - a.a.spd);
    const [g1, g2] = fast;
    const others = rest.filter((p) => p !== g1 && p !== g2);
    if (g1) { put(g1, lineX, SIDE - 6, 'gunner'); }
    if (g2) { put(g2, lineX, -(SIDE - 6), 'gunner'); }
    others.forEach((p, i) => {
      if (i === 0) put(p, lineX - 1.0, edge(1) + 1.5, 'kblock');
      else if (i === 1) put(p, lineX - 1.0, edge(-1) - 1.5, 'kblock');
      else put(p, -5 - (i - 2) * 1.2, (i % 2 ? -1 : 1) * 0.9, 'kblock');
    });
  } else {
    // The holder seven yards back, the kicker a step and a half behind and to the side.
    const holder = O.QB && O.QB !== kp ? O.QB : rest.find((p) => p !== kp);
    lp.holder = holder;
    lp.snapTo = holder;
    put(holder, -7, 0, 'holder');
    put(kp, -9.3, 1.6, 'kicker');
    const others = rest.filter((p) => p !== holder);
    others.forEach((p, i) => {
      const s = i % 2 ? -1 : 1, outer = i >= 2;
      put(p, outer ? lineX - 1.0 : lineX, edge(s) + s * (outer ? 2.4 : 1.1), 'kblock');
    });
  }
  // The receiving side: the fastest sure-handed defender back deep to return a punt (safeties
  // at the goal line on a field goal), a man on each gunner, everyone else at the line.
  const defs = lp.players.filter((p) => p.side === 'def');
  const pw = eff(g, lp.o, kp.id, 'kpw');
  if (punt) {
    const backs = ['FS', 'SS', 'CB1', 'CB2', 'CB3'].map((k) => D[k]).filter(Boolean);
    const ret = [...backs].sort((a, b) => (b.a.spd + b.a.hnd) - (a.a.spd + a.a.hnd))[0] ?? defs[defs.length - 1];
    K.returner = ret;
    const deep = clamp(42 + (pw - 60) * 0.2, 30, lp.goalX - 1);
    put(ret, deep, 0, 'returner'); ret.fx = -1;
    const gun = lp.players.filter((p) => p.role === 'gunner');
    const jam = backs.filter((p) => p !== ret).sort((a, b) => a.x - b.x);
    gun.forEach((gp, i) => { const j = jam[i]; if (j) { put(j, lineX + 1.4, gp.y, 'kjam'); j.fx = -1; j.man = gp; } });
    for (const p of defs) if (!['returner', 'kjam'].includes(p.role)) { p.role = ['LE', 'DE', 'DT1', 'DT2', 'OLB'].includes(p.slot) ? 'krush' : 'kwall'; p.x = Math.min(p.x, p.role === 'krush' ? p.x : 4.5); }
  } else {
    for (const p of defs) {
      if (['FS', 'SS'].includes(p.slot)) { put(p, Math.min(lp.goalX - 1, 22), p.y * 0.5, 'kwall'); p.fx = -1; }
      else p.role = 'krush';
    }
  }
  for (const p of lp.players) p.home = { x: p.x, y: p.y };
}

// The play's stages: the snap, the kick (on a timer after the catch), the flight, then the
// ball coming down. Run once per step after everyone has moved.
export function kickStep(lp) {
  const K = lp.kick, b = lp.ball;
  if (!K || lp.phase !== 'live') return;
  if (K.stage === 'pre') K.stage = 'snap';
  if (K.stage === 'snap' && b.state === 'held' && b.holder === lp.snapTo) { K.stage = 'set'; K.caughtAt = lp.t; }
  if (K.stage === 'set' && lp.t - K.caughtAt >= (K.punt ? 1.05 : 0.8)) kickIt(lp);
  if (K.stage === 'air') {
    const F = K.F, e = lp.t - F.t0;
    const at = flightAt(F, Math.min(e, F.T));
    b.x = at.x; b.y = at.y; b.z = at.z;
    if (e >= F.T) (K.punt ? puntDown(lp) : throughPosts(lp));
  } else if (K.stage === 'blocked') {
    if (lp.t - K.blockedAt > 1.3) { lp.spotX = clamp(b.x, lp.ownGoalX + 1, lp.goalX); finish(lp, { how: 'blocked' }); }
  } else if (K.stage === 'loose') bouncing(lp);
}

function kickIt(lp) {
  const K = lp.kick, g = lp.g, kp = lp.kicker, b = lp.ball;
  K.kickedAt = lp.t;
  const from = K.punt ? kp : lp.holder;
  // A rusher on top of the kick when the foot meets the ball can get a hand on it.
  const rusher = lp.players.find((q) => q.side === 'def' && !q.eng && q.stun <= 0 && dist(q, from) < (K.punt ? 1.9 : 1.6) && q.x < from.x + 2.2);
  if (rusher && chance(g, K.punt ? 0.45 : 0.35)) {
    K.stage = 'blocked'; K.blockedAt = lp.t; K.blocker = rusher;
    // It caroms back toward the kicking team's goal.
    lp.ball = { state: 'loose', holder: null, x: from.x + 0.6, y: from.y, z: 0.9, vx: -4, vy: (from.y - rusher.y) * 1.5, vz: 2.5 };
    event(lp, 'block', '', rusher, kp);
    return;
  }
  const pw = eff(g, lp.o, kp.id, 'kpw'), ac = eff(g, lp.o, kp.id, 'kac');
  const sx = from.x + 0.5, sy = from.y, z0 = 0.6;
  let tx, ty, zc, T;
  if (K.punt) {
    // Gross distance from the line of scrimmage from leg power, spread from accuracy. A coffin
    // corner gives up distance to angle it out of bounds short of the goal line.
    const room = lp.goalX;
    if (K.aim === 'coffin' && room < 55) {
      tx = clamp(room - 6 + (6 - (ac - 60) * 0.12) * randn(g) * 0.8, 15, room + 6);
      ty = (sgn(sy || 1) * -1 || 1) * (SIDE + 0.6);
    } else if (room < 52) {
      // Short of midfield-plus: a pooch, dropped inside the ten for the coverage to down.
      tx = clamp(room - 8 + (4.5 - (ac - 60) * 0.05) * randn(g), 15, room + 8);
      ty = clamp(sy + 6 * randn(g), -SIDE + 4, SIDE - 4);
    } else {
      tx = clamp(44 + (pw - 60) * 0.2 + (5.5 - (ac - 60) * 0.03) * randn(g), 18, 75);
      ty = clamp(sy + (5 - (ac - 60) * 0.05) * randn(g), -SIDE + 2, SIDE - 2);
    }
    T = clamp(3.7 + (pw - 60) * 0.018 + 0.25 * randn(g), 3.0, 4.9);
    zc = 1.5;
  } else {
    // Through the uprights or not: the same odds the engine gives this kicker from this spot.
    const good = chance(g, fgOdds(g));
    K.good = good;
    tx = lp.goalX + 10;
    const wide = !good && !(tx - sx > 50 && chance(g, 0.45));
    ty = good ? clamp(randn(g) * 1.1, -POST_W + 0.4, POST_W - 0.4) : wide ? sgn(randn(g) || 1) * (POST_W + 0.6 + Math.abs(randn(g)) * 1.5) : randn(g) * 1.5;
    zc = good || wide ? POST_H + 1.6 + clamp((pw - 60) * 0.04, -0.8, 1.6) : POST_H - 1.2;
    T = Math.hypot(tx - sx, ty - sy) / (22 + (pw - 60) * 0.08);
  }
  const vz = (zc - z0 + 0.5 * GRAVITY * T * T) / T;
  K.F = { sx, sy, z0, tx, ty, zc, T, vz, t0: lp.t };
  K.landX = tx;
  K.stage = 'air';
  lp.ball = { state: 'air', holder: null, x: sx, y: sy, z: z0 };
  event(lp, K.punt ? 'punt' : 'fgkick', '', kp);
  // Everyone goes: the kicking team releases from its blocks to cover, the receiving team sets up the return.
  for (const p of lp.players) {
    if (K.punt && p.eng) unengage(p);
    if (p.side === 'off' && p !== kp && (p.role === 'kblock' || p.role === 'gunner' || p.role === 'holder')) p.role = K.punt ? 'kcover' : 'kidle';
    if (p === kp) p.role = K.punt ? 'ksafety' : 'kidle';
    if (p.side === 'def' && p.role === 'krush') p.role = K.punt ? 'kwall' : 'kidle';
  }
  // The user on the kicking team takes the cover man nearest where it comes down.
  if (K.punt && lp.user === lp.o) {
    let best = null;
    for (const p of lp.players) if (p.side === 'off' && p.role === 'kcover' && (!best || dist(p, { x: tx, y: ty }) < dist(best, { x: tx, y: ty }))) best = p;
    if (best) { lp.control = best; lp.manual = false; }
  }
}

// The punt comes down: caught (returned, or a fair catch), or it hits the turf.
function puntDown(lp) {
  const K = lp.kick, F = K.F, r = K.returner, g = lp.g;
  const spot = { x: F.tx, y: F.ty };
  if (Math.abs(F.ty) > SIDE) { lp.spotX = clamp(F.tx, lp.ownGoalX + 1, lp.goalX); K.stage = 'done'; finish(lp, { how: 'out' }); return; }
  if (F.tx >= lp.goalX && !(r && dist(r, spot) < CATCH_R && F.tx < lp.goalX + 3)) { K.stage = 'done'; finish(lp, { how: 'touchback' }); return; }
  if (r && dist(r, spot) < CATCH_R && chance(g, clamp(0.93 + (r.a.hnd - 60) * 0.003, 0.85, 0.995))) {
    K.catchX = r.x;
    if (K.fair) { lp.spotX = r.x; K.stage = 'done'; lp.ball = { state: 'held', holder: r, x: r.x, y: r.y, z: 1 }; event(lp, 'fair', '', r); finish(lp, { how: 'fair' }); return; }
    K.stage = 'return';
    setCarrier(lp, r);
    event(lp, 'catch', '', r);
    return;
  }
  // It hits the turf and takes a bounce (or the returner can't hold it).
  K.stage = 'loose'; K.looseAt = lp.t;
  const l = Math.hypot(F.tx - F.sx, F.ty - F.sy) || 1;
  lp.ball = { state: 'loose', holder: null, x: F.tx, y: F.ty, z: 0.3, vx: ((F.tx - F.sx) / l) * (4 + 4 * Math.abs(randn(g))), vy: ((F.ty - F.sy) / l) * 3 + randn(g) * 2, vz: 2.5 };
  event(lp, 'bounce', '', r);
}

// A bouncing punt: the coverage downs it, the returner scoops it, or it rolls into the end
// zone or out of bounds.
function bouncing(lp) {
  const K = lp.kick, b = lp.ball, r = K.returner;
  if (b.x >= lp.goalX) { K.stage = 'done'; finish(lp, { how: 'touchback' }); return; }
  if (Math.abs(b.y) > SIDE) { lp.spotX = b.x; K.stage = 'done'; finish(lp, { how: 'out' }); return; }
  const e = lp.t - K.looseAt;
  if (r && e > 0.25 && b.z < 1.2 && dist(r, b) < 0.9 && !lp.players.some((q) => q.side === 'off' && dist(q, b) < 1.4)) {
    K.catchX = r.x; K.stage = 'return'; setCarrier(lp, r); event(lp, 'scoop', '', r); return;
  }
  const cov = lp.players.find((q) => q.side === 'off' && q !== lp.kicker && dist(q, b) < 1.0);
  const still = Math.hypot(b.vx ?? 0, b.vy ?? 0) < 0.6 && b.z < 0.2;
  if (cov || (still && e > 2.5)) { lp.spotX = b.x; K.stage = 'done'; if (cov) event(lp, 'downed', '', cov); finish(lp, { how: 'downed', by: cov }); }
}

function throughPosts(lp) {
  const K = lp.kick, F = K.F;
  K.stage = 'done';
  // The ball carries on past the posts as the whistle goes.
  const e = F.T, vx = (F.tx - F.sx) / F.T, vy = (F.ty - F.sy) / F.T;
  lp.ball = { state: 'loose', holder: null, x: F.tx, y: F.ty, z: F.zc, vx: vx * 0.9, vy: vy * 0.9, vz: F.vz - GRAVITY * e };
  const good = K.good && F.zc > POST_H && Math.abs(F.ty) < POST_W;
  event(lp, good ? 'fg_good' : 'fg_miss', '', lp.kicker);
  finish(lp, { how: good ? 'fg_good' : 'fg_miss' });
}

// What each player on a kick wants to do (null when the role is not a kicking role).
export function kickWant(lp, p) {
  const K = lp.kick, kp = lp.kicker;
  const land = K.F ? { x: K.F.tx, y: clamp(K.F.ty, -SIDE + 1, SIDE - 1) } : { x: K.returner?.x ?? 40, y: 0 };
  switch (p.role) {
    case 'kicker': {
      if (K.punt) return K.stage === 'set' ? seek(p, { x: p.home.x + 1.6, y: p.home.y }, 0.25, 0.4) : seek(p, p.home, 0.3, 0.4);
      // The kicker's approach: a couple of steps in to the hold.
      const h = lp.holder;
      if (K.stage === 'set' && h) return seek(p, { x: h.x - 0.7, y: h.y + 0.5 }, 0.45, 0.2);
      return seek(p, p.home, 0.3, 0.4);
    }
    case 'holder': return seek(p, p.home, 0.2, 0.4);
    case 'kidle': return seek(p, { x: p.x + 0.4, y: p.y }, 0.2, 0.6);
    case 'ksafety': return seek(p, { x: Math.max(p.x, Math.min(land.x - 18, p.x + 10)), y: land.y * 0.4 }, 0.6, 1);
    case 'kblock': {
      // Protect the spot the ball is kicked from: square up on the nearest free rusher.
      const from = K.punt ? { x: kp.x + 1.5, y: kp.y } : lp.holder ?? kp;
      let m = null, md = 4;
      for (const q of lp.players) if (q.side === 'def' && q.role === 'krush' && !q.eng && dist(q, p) < md) { md = dist(q, p); m = q; }
      if (!m) return seek(p, { x: p.home.x - 0.5, y: p.home.y }, 0.4, 0.5);
      p.aim = m;
      const ax = from.x - m.x, ay = from.y - m.y, l = len(ax, ay) || 1, k = m.r + p.r + 0.15;
      return seek(p, { x: m.x + (ax / l) * k, y: m.y + (ay / l) * k }, 1, 0.3);
    }
    case 'gunner': return seek(p, { x: Math.min(land.x, p.x + 30), y: p.home.y * 0.55 }, 1, 0.1);
    case 'kcover': {
      // Fan out in lanes and close on where it comes down (or on the bouncing ball).
      if (K.stage === 'loose') return seek(p, lp.ball, 1, 0.2);
      const d = Math.max(0, land.x - p.x);
      const lane = clamp(p.home.y * 0.35, -9, 9) * clamp(d / 25, 0, 1);
      return seek(p, { x: land.x - 2, y: land.y + lane }, 1, 0.5);
    }
    case 'krush': {
      const from = K.punt ? { x: kp.x + 1.8, y: kp.y } : lp.holder ?? kp;
      return seek(p, from, 1, 0.1);
    }
    case 'kjam': {
      // Ride the gunner: stay in front of him and between him and the returner.
      const m = p.man;
      if (!m) return seek(p, { x: land.x - 8, y: p.y }, 0.7);
      return seek(p, { x: m.x + 1.2, y: m.y + (land.y - m.y) * 0.1 }, 0.98, 0.2);
    }
    case 'kwall': {
      if (K.stage === 'pre' || K.stage === 'snap' || K.stage === 'set') return seek(p, p.home, 0.3, 0.5);
      // Drop back to set up a wall in front of the returner.
      return seek(p, { x: land.x - 10, y: clamp(p.home.y * 0.45, -12, 12) }, 0.9, 1);
    }
    case 'returner': {
      if (K.stage !== 'air' && K.stage !== 'loose') return seek(p, p.home, 0.5, 0.5);
      if (K.stage === 'loose') return seek(p, lp.ball, 1, 0.1);
      const F = K.F, left = F.t0 + F.T - lp.t;
      // Coverage closing in as it comes down: wave for a fair catch.
      if (!K.fair && left < 0.75 && !(lp.control === p && lp.manual) && lp.players.some((q) => q.side === 'off' && dist(q, land) < 5)) { K.fair = true; event(lp, 'fairsignal', '', p); }
      // Let one going into the end zone go.
      if (F.tx > lp.goalX + 1) return seek(p, { x: lp.goalX - 2, y: p.y }, 0.6, 0.5);
      const dx = land.x - p.x, dy = land.y - p.y, d = len(dx, dy);
      if (d < 0.15) { p.want = { vx: 0, vy: 0 }; return; }
      const sp = Math.min(p.top, Math.sqrt(2 * p.accel * 1.6 * d), Math.max(d / Math.max(0.05, left) * 1.2, 2.5));
      p.want = { vx: (dx / d) * sp, vy: (dy / d) * sp };
      return;
    }
    default: return undefined;
  }
}

// The play's outcome for the engine: how it ended and where (offense-frame yards from the line).
export function kickResult(lp, end) {
  const K = lp.kick, c = lp.carrier;
  const how = end.how === 'time' ? (K.stage === 'return' ? 'tackle' : 'downed') : end.how;
  const r = { liveKick: true, kind: lp.kind, how, kicker: lp.kicker?.id ?? null, clockStop: true };
  if (!K.punt) return { ...r, how: how === 'blocked' ? 'blocked' : how === 'fg_good' ? 'good' : 'miss', blocker: K.blocker?.id ?? null };
  r.gross = K.landX != null ? Math.round(K.landX) : null;
  r.returner = K.returner?.id ?? null;
  if (how === 'touchback') return r;
  let endX = lp.spotX ?? (K.stage === 'return' && c ? c.x : lp.ball.x);
  if (how === 'td') endX = lp.ownGoalX;
  r.endX = Math.round(endX);
  if (K.catchX != null && (how === 'tackle' || how === 'td' || how === 'out') && K.stage === 'return') r.ret = Math.round(K.catchX - endX);
  r.tackler = end.tackler?.id ?? null;
  r.blocker = K.blocker?.id ?? null;
  r.downedBy = end.by?.id ?? null;
  return r;
}
