// Kicks played out on the live field: punts, field goals and extra points (the long snap, the
// protection, the kick itself from the punter's or kicker's own ratings, the coverage and the
// return), kickoffs (deep or onside) and the fakes, which turn into a run or a pass at the hold.
// The ball's flight is ballistic like a pass; what happens when it comes down (a catch and a
// return, a fair catch, a bounce downed by the coverage, a touchback, out of bounds) is decided
// on the field, and engine.js turns the outcome into the next possession.
import { chance, clamp, eff, fgOdds, onsideLean, onsideOdds, randn, specialist, xpOdds } from '../engine.js';
import { PLAYERS } from '../ratings.js';
import { GRAVITY, SIDE, dist, event, finish, isManual, len, seek, setCarrier, setKickResult, sgn, unengage } from './core.js';
import { buildRoute, flightAt } from './passing.js';

// A kick ends through the shared finish (core.js), which reads its result here.
setKickResult(kickResult);

// Every kick is played on the live field, fakes included.
export const liveKick = (play) => !!play && ['punt', 'fg', 'xp', 'kickoff'].includes(play.kind);
// The extra point is snapped from the 15: a 33-yard kick.
export const XP_SPOT = 85;

const CATCH_R = 1.6;     // how far a returner reaches for a punt
const POST_H = 3.33;     // the crossbar, in yards
const POST_W = 3.08;     // half the distance between the uprights

// Line both teams up for the kick. `make` builds a player (live.js makePlayer).
export function setupKick(lp, make) {
  if (lp.kind === 'kickoff') { setupKickoff(lp, make); return; }
  const g = lp.g, O = lp.off, D = lp.def, punt = lp.kind === 'punt';
  // A fake lines up like the real thing. The defense sees it coming about half the time.
  const K = (lp.kick = { punt, stage: 'pre', aim: lp.play.aim ?? null, fake: !!lp.play.fake, surprise: !!lp.play.fake && chance(g, 0.55) });
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
    // A fake punt is a direct snap to the personal protector, who runs it.
    if (K.fake) { const pp = others[2] ?? others[0]; if (pp) { lp.snapTo = pp; K.runner = pp; } }
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
  if (K.ko) { kickoffStep(lp); return; }
  if (K.stage === 'set' && K.fake && lp.t - K.caughtAt >= (K.punt ? 0.3 : 0.25)) { fakeIt(lp); return; }
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
    const good = chance(g, lp.kind === 'xp' ? xpOdds(g) : fgOdds(g));
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
  const pad = K.punt ? lp.user === lp.o ? lp : lp.p2?.user === lp.o ? lp.p2 : null : null;
  if (pad) {
    let best = null;
    for (const p of lp.players) if (p.side === 'off' && p.role === 'kcover' && (!best || dist(p, { x: tx, y: ty }) < dist(best, { x: tx, y: ty }))) best = p;
    if (best) { pad.control = best; pad.manual = false; }
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
      // The kickoff approach: a run up to the tee.
      if (K.ko) return seek(p, { x: -0.5, y: 0.3 }, 0.75, 0.2);
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
      // On a punt they turn to set up the return as soon as the ball is snapped.
      if (K.stage === 'pre' || K.stage === 'approach' || (!K.punt && (K.stage === 'snap' || K.stage === 'set'))) return seek(p, p.home, 0.3, 0.5);
      // Drop back to set up a wall in front of the returner.
      return seek(p, { x: land.x - 10, y: clamp(p.home.y * 0.45, -12, 12) }, 0.9, 1);
    }
    case 'returner': {
      if (K.stage !== 'air' && K.stage !== 'loose') return seek(p, p.home, 0.5, 0.5);
      if (K.stage === 'loose') return seek(p, lp.ball, 1, 0.1);
      const F = K.F, left = F.t0 + F.T - lp.t;
      // Coverage closing in as it comes down: wave for a fair catch.
      if (!K.fair && !K.ko && left < 0.75 && !isManual(lp, p) && lp.players.some((q) => q.side === 'off' && dist(q, land) < 5)) { K.fair = true; event(lp, 'fairsignal', '', p); }
      // Let one going into the end zone go.
      if (F.tx > lp.goalX + 1) return seek(p, { x: lp.goalX - 2, y: p.y }, 0.6, 0.5);
      const dx = land.x - p.x, dy = land.y - p.y, d = len(dx, dy);
      if (d < 0.15) { p.want = { vx: 0, vy: 0 }; return; }
      const sp = Math.min(p.top, Math.sqrt(2 * p.accel * 1.6 * d), Math.max(d / Math.max(0.05, left) * 1.2, 2.5));
      p.want = { vx: (dx / d) * sp, vy: (dy / d) * sp };
      return;
    }
    // The kickoff team: walk up behind the kicker, then cover once it is away.
    case 'kline': return seek(p, { x: Math.min(-0.4, p.home.x + lp.t * 2.5), y: p.home.y }, 0.6, 0.3);
    // An onside kick: everyone goes for the ball (the kicking team may not touch it before ten yards).
    case 'kscrum': {
      const b = lp.ball;
      if (p.side === 'off' && b.x < 10) return seek(p, { x: Math.min(b.x, 9.5), y: b.y }, 1, 0.2);
      return seek(p, b, 1, 0.1);
    }
    default: return undefined;
  }
}

// What your returner can call: the fair catch while a punt is in the air (not once it has hit
// the turf), and the knee in his own end zone with the ball in his hands (a kickoff or a punt
// caught there), which is a touchback.
export function returnerCall(lp, r) {
  const K = lp.kick;
  if (!K || lp.phase !== 'live') return false;
  if (K.stage === 'air' && !K.ko && !K.fair) { K.fair = true; event(lp, 'fairsignal', '', r); return true; }
  if (K.stage === 'return' && r.carrier && r.x >= lp.goalX && !lp.tackle) {
    K.stage = 'done'; lp.ball = { state: 'held', holder: r, x: r.x, y: r.y, z: 0.4 }; r.downed = true;
    event(lp, 'kneel', '', r);
    finish(lp, { how: 'touchback' });
    return true;
  }
  return false;
}

// The returner's choice, for the prompt over the field: where the kick comes down, how close the
// coverage is to that spot when it gets there, and what the key does now.
export function returnPrompt(lp) {
  const K = lp.kick;
  if (!K || lp.phase !== 'live' || K.onside) return null;
  const r = K.returner;
  if (K.stage === 'air' && K.F) {
    const F = K.F, left = Math.max(0, F.t0 + F.T - lp.t);
    let cov = 99;
    for (const q of lp.players) if (q.side === 'off' && q !== lp.kicker) cov = Math.min(cov, Math.hypot(q.x + q.vx * left - F.tx, q.y + q.vy * left - F.ty));
    const endZone = F.tx >= lp.goalX, out = Math.abs(F.ty) > SIDE;
    return { stage: 'air', ko: !!K.ko, left, landX: F.tx, cov: Math.max(0, cov), endZone, out, fair: !!K.fair, canFair: !K.ko && !K.fair };
  }
  if (K.stage === 'return' && r?.carrier && r.x >= lp.goalX && !lp.tackle) return { stage: 'endzone', ko: !!K.ko };
  return null;
}

// ---------- fakes ----------
// The snap is caught and the kick never comes: the punter takes off, or the holder pops up and
// throws to the tight end leaking into the flat. From here it is an ordinary run or pass, and a
// defense that did not see it coming reacts late.
function fakeIt(lp) {
  const K = lp.kick, O = lp.off;
  lp.kick = null;
  lp.fake = K.punt ? 'punt' : 'fg';
  const late = K.surprise ? (K.punt ? 1.1 : 0.2) : 0.1;
  lp.fakeSurprise = K.surprise;
  if (K.punt) {
    const c = K.runner ?? lp.kicker;
    lp.kind = 'run';
    // He bounces it outside, to the side with fewer defenders near the line.
    const near = (sd) => lp.players.filter((q) => q.side === 'def' && q.x < 8 && sgn(q.y) === sd && Math.abs(q.y) < 14).length;
    lp.fakeEdge = near(1) <= near(-1) ? 1 : -1;
    lp.holeY = lp.fakeEdge * 9;
    setCarrier(lp, c);
    // The protection turns into run blocking: everyone drives the man in front of him.
    for (const q of lp.players) {
      if (q.side === 'def') q.react = (q.react ?? 0) + late;
      else if (q !== c) q.role = q.role === 'kblock' ? 'runblock' : 'escort';
    }
    event(lp, 'fake', '', c);
    return;
  }
  const h = lp.holder;
  lp.kind = 'pass';
  O.QB = h; h.role = 'qb';
  lp.qbState = 'drop'; lp.dropX = h.x - 1; lp.readAt = lp.t + 0.35; lp.autoQB = true;
  const te = O.TE ?? lp.players.find((q) => q.side === 'off' && q.role === 'kblock' && Math.abs(q.y) > 3);
  for (const q of lp.players) {
    if (q.side === 'off' && q !== h && q !== te) q.role = 'passblock';
    if (q.side === 'def') { q.role = 'rush'; q.react = late; }
  }
  if (te) {
    if (!O.TE) { O.TE = te; }
    te.role = 'route'; te.route = buildRoute(lp, te, 'flat'); te.routeName = 'flat';
    lp.eligible = [Object.entries(O).find(([, v]) => v === te)[0]];
    // The safeties back for the kick pick him up; a defense that read it has the nearest men
    // off the edge on him at once, and even a fooled one has the end turn and chase.
    const sf = lp.players.filter((q) => q.side === 'def' && ['FS', 'SS'].includes(q.slot));
    for (const q of sf) { q.role = 'cover'; q.man = te; q.react = late + 0.3; }
    const edge = lp.players.filter((q) => q.side === 'def' && !sf.includes(q)).sort((a, c) => dist(a, te) - dist(c, te)).slice(0, K.surprise ? 2 : 4);
    for (const q of edge) { q.role = 'cover'; q.man = te; q.react = K.surprise ? 0.2 : 0; }
  } else lp.eligible = [];
  event(lp, 'fake', '', h);
}

// ---------- kickoffs ----------
// The kicking team spreads across the field a yard behind the ball with the kicker back for his
// run up; the receiving team sets a front line, a second level and its returner deep (or a hands
// team packed up front when it expects an onside kick).
function setupKickoff(lp, make) {
  const g = lp.g, O = lp.off, D = lp.def;
  const onside = !!lp.play.onside;
  const K = (lp.kick = { ko: true, onside, stage: 'pre', punt: false });
  const id = specialist(g, lp.o, 'K');
  let kp = lp.players.find((p) => p.side === 'off' && p.id === id);
  if (!kp && id != null) {
    const out = O.QB ?? O.WR3 ?? O.RB;
    kp = make(g, lp.o, 'off', 'K', id, lp);
    lp.players[lp.players.indexOf(out)] = kp;
    delete O[out.slot];
    O.K = kp;
  }
  kp ??= O.QB ?? O.RB;
  lp.kicker = kp;
  // The kickoff units are not the scrimmage lineups: the cover team is the ten fastest tacklers
  // on the roster (backs, receivers, linebackers, the secondary, bench included), the return
  // team its fastest sure-handed returner and the best blockers who can run.
  const score = (ti, id, w) => Object.entries(w).reduce((a, [k, v]) => a + eff(g, ti, id, k) * v, 0);
  koUnit(lp, make, lp.o, 'off', [kp], (id) => score(lp.o, id, { spd: 0.6, tkl: 0.4 }));
  const recv = rosterPool(g, lp.d, []);
  const retId = recv.sort((a, b) => score(lp.d, b, { spd: 0.6, hnd: 0.4 }) - score(lp.d, a, { spd: 0.6, hnd: 0.4 }))[0];
  koUnit(lp, make, lp.d, 'def', [], (id) => (id === retId ? 1e6 : score(lp.d, id, { blk: 0.5, spd: 0.3, str: 0.2 })));
  const put = (p, x, y, role, fx) => { p.x = x; p.y = y; p.role = role; p.fx = fx; p.fy = 0; };
  put(kp, -7, 0.6, 'kicker', 1);
  const cover = lp.players.filter((p) => p.side === 'off' && p !== kp);
  const lanes = [-22, -18, -13.5, -9, -4.5, 4.5, 9, 13.5, 18, 22];
  // Onside: the kicking team bunches toward the side it kicks to.
  K.side = chance(g, 0.5) ? -1 : 1;
  cover.forEach((p, i) => put(p, -1, onside ? lanes[i] * 0.75 + K.side * 3 : lanes[i] ?? 0, 'kline', 1));
  const defs = lp.players.filter((p) => p.side === 'def');
  const ret = defs.find((p) => p.id === retId) ?? [...defs].sort((a, b) => (b.a.spd + b.a.hnd) - (a.a.spd + a.a.hnd))[0];
  K.returner = ret;
  const hands = onsideLean(g, lp.o);
  K.hands = hands;
  put(ret, Math.min(lp.goalX - 3, 62), 0, 'returner', -1);
  const rest = defs.filter((p) => p !== ret);
  // Front line, second level, then the deep wedge in front of the returner.
  const spots = hands
    ? [[11, -18], [11, -10], [11, -4], [11, 4], [11, 10], [11, 18], [16, -12], [16, -4], [16, 4], [16, 12]]
    : [[11, -19], [11, -11], [11, -4], [11, 4], [11, 11], [11, 19], [25, -9], [25, 9], [40, -4], [40, 4]];
  rest.forEach((p, i) => { const [x, y] = spots[i] ?? [30, 0]; put(p, Math.min(x, lp.goalX - 5), y, 'kwall', -1); });
  for (const p of lp.players) p.home = { x: p.x, y: p.y };
  lp.ball = { state: 'tee', holder: null, x: 0, y: 0, z: 0.25 };
  lp.snapTo = kp;
}

// Everyone a side can put on the field for a kick: its lineup and bench, once each, without the
// quarterback, the kicker and the punter (and anyone in `skip`).
function rosterPool(g, ti, skip) {
  const T = g.teams[ti], L = T.lineup, out = new Set([L.QB, L.K, L.P, ...skip].filter((x) => x != null));
  return [...new Set([...Object.values(L), ...(T.bench ?? [])])].filter((id) => id != null && !out.has(id) && PLAYERS[id]);
}
// Put a side's kickoff unit on the field: its best eleven (less the players kept) by `rank`,
// each taking over a spot of someone not picked. They keep that spot's key, so the rest of the
// play finds them like anyone else.
function koUnit(lp, make, ti, side, keep, rank) {
  const g = lp.g, map = lp[side];
  const on = lp.players.filter((p) => p.side === side && !keep.includes(p));
  const want = rosterPool(g, ti, keep.map((p) => p.id)).sort((a, b) => rank(b) - rank(a)).slice(0, on.length);
  const chosen = new Set(want);
  const free = on.filter((p) => !chosen.has(p.id));
  const add = want.filter((id) => !on.some((p) => p.id === id));
  free.forEach((p, i) => {
    const id = add[i];
    if (id == null) return;
    const np = make(g, ti, side, p.slot, id, lp);
    lp.players[lp.players.indexOf(p)] = np;
    map[p.slot] = np;
  });
}

function kickoffStep(lp) {
  const K = lp.kick, b = lp.ball, kp = lp.kicker;
  if (K.stage === 'approach' && (dist(kp, b) < kp.r + 0.5 || lp.t > 1.6)) koKick(lp);
  else if (K.stage === 'air') {
    const F = K.F, e = lp.t - F.t0;
    const at = flightAt(F, Math.min(e, F.T));
    b.x = at.x; b.y = at.y; b.z = at.z;
    if (e >= F.T) puntDown(lp);
  } else if (K.stage === 'onside') onsideStep(lp);
  else if (K.stage === 'loose') bouncing(lp);
}

function koKick(lp) {
  const K = lp.kick, g = lp.g, kp = lp.kicker;
  const pw = eff(g, lp.o, kp.id, 'kpw'), ac = eff(g, lp.o, kp.id, 'kac');
  K.kickedAt = lp.t;
  event(lp, 'kickoff', '', kp);
  for (const p of lp.players) if (p.side === 'off' && p !== kp) p.role = K.onside ? 'kscrum' : 'kcover';
  kp.role = 'ksafety';
  if (K.onside) {
    // A hard, low kick into the turf that hops toward the bunched side; the receiving front
    // line goes for it too. Who comes up with it is rolled once, at the kicker's own odds.
    K.stage = 'onside'; K.win = chance(g, onsideOdds(g, lp.o)) ? 'off' : 'def';
    const ty = K.side * (5 + 3 * Math.abs(randn(g))), tx = 12 + Math.abs(randn(g)) * 1.5;
    K.on = { tx, ty, T: 1.7 };
    lp.ball = { state: 'onside', holder: null, x: 0.4, y: 0, z: 0.3 };
    for (const p of lp.players) if (p.side === 'def' && p !== K.returner && p.x < 20) p.role = 'kscrum';
    return;
  }
  // Deep: the leg sets how far (most strong legs reach the end zone), accuracy the spread.
  const sx = 0.4, sy = 0, z0 = 0.3;
  const tx = clamp(63 + (pw - 60) * 0.25 + 4.5 * randn(g), 40, lp.goalX + 9);
  const ty = clamp((7 - (ac - 60) * 0.06) * randn(g), -SIDE + 1, SIDE - 1);
  const T = clamp(3.9 + (pw - 60) * 0.012 + 0.2 * randn(g), 3.3, 4.6);
  const zc = 1.2, vz = (zc - z0 + 0.5 * GRAVITY * T * T) / T;
  K.F = { sx, sy, z0, tx, ty, zc, T, vz, t0: lp.t };
  K.landX = tx; K.stage = 'air';
  lp.ball = { state: 'air', holder: null, x: sx, y: sy, z: z0 };
  if (lp.user === lp.o) {
    let best = null;
    for (const p of lp.players) if (p.side === 'off' && p.role === 'kcover' && (!best || Math.abs(p.y - ty) < Math.abs(best.y - ty))) best = p;
    if (best) { lp.control = best; lp.manual = false; }
  }
}

// The onside kick bounces along: once it has gone ten yards, the side that wins the scramble
// falls on it (the other side's hands are on it too, but it squirts away from them).
function onsideStep(lp) {
  const K = lp.kick, b = lp.ball;
  // It skips along the turf in shrinking hops and dies a dozen yards out.
  const u = clamp((lp.t - K.kickedAt) / K.on.T, 0, 1), d = 1 - (1 - u) * (1 - u);
  b.x = 0.4 + (K.on.tx - 0.4) * d; b.y = K.on.ty * d;
  b.z = 0.15 + 1.1 * Math.abs(Math.sin(Math.PI * 3 * u)) * (1 - u);
  if (Math.abs(b.y) > SIDE) { lp.spotX = clamp(b.x, 1, lp.goalX - 1); K.rec = 'def'; K.stage = 'done'; finish(lp, { how: 'onside' }); return; }
  const near = (side) => lp.players.filter((p) => p.side === side && p !== lp.kicker && dist(p, b) < p.r + 0.7 && b.z < 1.4).sort((a, c) => dist(a, b) - dist(c, b))[0];
  const w = b.x >= 10 ? near(K.win) : near('def');
  // A receiving player touches it short of ten: it is live, and the scramble decides it anyway.
  if (w && (b.x >= 10 || K.win === 'def')) {
    K.rec = w.side; K.stage = 'done'; K.by = w;
    lp.spotX = clamp(b.x, 1, lp.goalX - 1);
    lp.ball = { state: 'held', holder: w, x: w.x, y: w.y, z: 0.4 };
    w.downed = true;
    event(lp, 'recover', '', w);
    finish(lp, { how: 'onside' });
    return;
  }
  if (lp.t - K.kickedAt > 5) { lp.spotX = clamp(b.x, 1, lp.goalX - 1); K.rec = 'def'; K.stage = 'done'; finish(lp, { how: 'onside' }); }
}

// The play's outcome for the engine: how it ended and where (offense-frame yards from the line).
export function kickResult(lp, end) {
  const K = lp.kick, c = lp.carrier;
  const how = end.how === 'time' ? (K.stage === 'return' ? 'tackle' : 'downed') : end.how;
  const r = { liveKick: true, kind: lp.kind, how, kicker: lp.kicker?.id ?? null, clockStop: true };
  if (K.ko) {
    r.returner = K.returner?.id ?? null;
    if (how === 'onside') return { ...r, onside: true, rec: K.rec === 'off' ? 'kick' : 'recv', endX: Math.round(lp.spotX ?? lp.ball.x), recoveredBy: K.by?.id ?? null };
    if (how === 'touchback') return r;
    let endX = lp.spotX ?? (K.stage === 'return' && c ? c.x : lp.ball.x);
    if (how === 'td') endX = lp.ownGoalX;
    r.endX = Math.round(endX);
    if (K.catchX != null && K.stage === 'return') r.ret = Math.round(K.catchX - endX);
    r.tackler = end.tackler?.id ?? null;
    return r;
  }
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
