// The run game: each designed run is its own concept, called to one side of the ball, with its
// own blocking scheme, its own track for the ball carrier and its own read once he has it.
//
//   Inside Zone   the line steps playside together and blocks the gap it steps into; the back
//                 aims at the playside guard and reads the first down lineman: hit the B gap,
//                 or cut back into the backside A gap when the front flows with him
//   Outside Zone  the line reach-blocks to the edge; the back stretches flat to the tight end's
//                 outside hip, then bounces outside, cuts up, or cuts all the way back
//   Power O       the playside blocks down, the end of the line base-blocks the end man and
//                 the backside guard pulls through the hole onto the linebacker (the fullback
//                 leads too); the back presses the hole off tackle, downhill
//   Counter       the back jabs away first, then comes back behind the backside guard, who
//                 pulls across the formation and leads through the hole
//   Trap          the first down lineman past the center is let through on purpose and trapped
//                 by the backside guard; the back hits the A gap he vacated, fast
//   HB Dive       man blocking, a straight quick hit in the A gap
//   HB Draw       the line shows pass, the back waits, then runs where the rushers left
//   Toss Sweep    pitched out wide, reach blocks and the receivers crack inside
//   Pin & Pull    the playside tight end or tackle pins down, the guard (and the tackle) pull
//                 and lead the back around the edge
//   QB runs and the zone read use the same schemes with the quarterback as the runner.
//
// Every concept goes either way: lp.runSide is +1 (to the right of the offense) or -1. The
// play art is drawn from runTrack(), the same points the back runs, so the card shows what
// happens on the field.
import { chance, clamp } from '../engine.js';
import { lineX } from '../formations.js';
import { dist, event, seek, sgn } from './core.js';

const LINE = ['LT', 'LG', 'C', 'RG', 'RT'];
const DLINE = ['LE', 'DE', 'DT1', 'DT2'];

// scheme: how the line blocks. side: the default side ('strong', toward the tight end and the
// receiver strength, or 'weak'). hand: when the quarterback gives it. read: what the carrier
// reads once he has it ('zone' cutback, 'edge' bounce or cut up, null to hit the hole).
export const RUN_CONCEPTS = {
  inside: { scheme: 'zone', side: 'strong', hand: 0.42, read: 'zone' },
  outside: { scheme: 'reach', side: 'strong', hand: 0.45, read: 'edge' },
  // Patient: he stays on the pulling guard's hip until he is in the hole.
  power: { scheme: 'gap', side: 'strong', hand: 0.45, read: null, press: 1.2, pull: ['lead'] },
  counter: { scheme: 'gap', side: 'weak', hand: 0.55, read: null, press: 0.25, pull: ['lead'] },
  trap: { scheme: 'trap', side: 'weak', hand: 0.3, read: null, press: 0.35, pull: ['trap'] },
  dive: { scheme: 'man', side: 'weak', hand: 0.2, read: null, press: 1.0 },
  draw: { scheme: 'draw', side: 'strong', hand: 0.95, read: 'zone' },
  toss: { scheme: 'reach', side: 'weak', hand: 0.3, read: 'edge' },
  sweep: { scheme: 'pin', side: 'strong', hand: 0.4, read: 'edge', pull: ['sweep', 'sweep'] },
  sneak: { scheme: 'man', side: 'strong', hand: 0, read: null },
  qbdraw: { scheme: 'draw', side: 'strong', hand: 0.85, read: 'zone' },
  qbpower: { scheme: 'gap', side: 'strong', hand: 0.8, read: null, press: 0.25, pull: ['lead'] },
  read: { scheme: 'zone', side: 'strong', hand: 0.45, read: 'zone' },
};
export const conceptOf = (lp) => RUN_CONCEPTS[lp.play.dir] ?? RUN_CONCEPTS.inside;

// The formation's strong side: the attached tight end, else the side with more receivers.
export function strongSide(lp) {
  const O = lp.off, te = O.TE;
  if (te && lp.formation !== 'iform' && Math.abs(te.y) < 7.5) return sgn(te.y);
  let s = 0;
  for (const k of ['WR1', 'WR2', 'WR3', 'TE']) { const p = O[k]; if (p && Math.abs(p.y) > 1) s += Math.sign(p.y); }
  return s >= 0 ? 1 : -1;
}
export function defaultSide(lp) {
  const s = strongSide(lp);
  return conceptOf(lp).side === 'weak' ? -s : s;
}
// The AI offense picks its side at the line: away from the heavier side of the box, toward
// the play's own side when it is even, and now and then the other way so it is not a tell.
export function aiSide(lp) {
  const def = Object.values(lp.def);
  const box = (s) => def.reduce((n, q) => n + (q.x < 7.5 && q.y * s > 0.4 && Math.abs(q.y) < 9 ? (DLINE.includes(q.slot) ? 1 : 0.8) : 0), 0);
  const d0 = defaultSide(lp);
  const lean = box(-d0) + 0.6 < box(d0) ? -d0 : d0;
  return chance(lp.g, 0.78) ? lean : -lean;
}

// The line from one side to the other: the five linemen and an attached tight end.
function lineOf(lp) {
  const O = lp.off, out = LINE.map((k) => O[k]).filter(Boolean);
  const te = O.TE;
  if (te && lp.formation !== 'iform' && Math.abs(te.x - lineX(te)) < 0.4) out.push(te);
  return out.sort((a, b) => a.y - b.y);
}

// Where the holes are, from the linemen actually on the field, for side s.
export function landmarks(lp, s) {
  const line = lineOf(lp);
  const ps = line.filter((b) => b.y * s > 0.3).sort((a, b) => (a.y - b.y) * s);
  const C = lp.off.C, cy = C?.y ?? 0;
  const g = ps[0], t = ps[1], end = ps[ps.length - 1];
  const a = g ? (cy + g.y) / 2 : s * 0.9;
  const b = g && t ? (g.y + t.y) / 2 : s * 2.7;
  const c = end ? end.y + s * 1.7 : s * 4.5;
  return { a, b, c, edge: (end ? end.y : s * 4) + s * 3.6, backA: -a + 2 * cy, backB: -b + 2 * cy, line, ps, end };
}

// ---------- setup ----------
// Assign every blocker and the carrier for the concept on side lp.runSide. Safe to call again
// before the snap (a flip at the line).
export function setupRun(lp) {
  const O = lp.off, D = lp.def, dir = lp.play.dir, K = conceptOf(lp);
  const s = lp.runSide;
  for (const p of Object.values(O)) { p.assign = null; p.pull = null; p.kick = false; p.kicked = false; p.wp = 0; p.track = null; }
  if (lp.readEnd) lp.readEnd.crash = null;
  lp.readEnd = null; lp.kept = false; lp.bounced = false; lp.cut = null;
  for (const k of LINE) if (O[k]) O[k].role = K.scheme === 'draw' ? 'passblock' : 'runblock';
  if (O.TE) O.TE.role = 'runblock';
  lp.qbRun = dir === 'sneak' || dir === 'qbdraw' || dir === 'qbpower';
  lp.carrier = lp.qbRun ? O.QB : O.RB;
  const L = landmarks(lp, s);
  lp.lm = L;
  lp.holeY = { inside: L.b, outside: L.edge - s * 0.8, power: L.c + s * 0.8, counter: L.c, trap: L.a, dive: L.a, draw: L.a, toss: L.edge + s * 2.4,
    sweep: L.edge - s * 0.3, sneak: 0, qbdraw: L.a, qbpower: L.c, read: L.b }[dir] ?? L.b;
  // The cutback lane for the zone runs: the backside A gap (B gap on the draw).
  lp.cutY = K.read === 'zone' ? (dir === 'draw' || dir === 'qbdraw' ? L.backA : L.backA) : null;
  const iform = lp.formation === 'iform' && O.TE;
  const fb = iform ? O.TE : null;
  const blockers = L.line.filter((b) => b !== fb);
  const box = Object.values(D).filter((q) => q.x < 8 && Math.abs(q.y) < 9.5 && !['CB1', 'CB2', 'FS'].includes(q.slot));
  const front = box.filter((q) => q.x < 2.6);
  const second = box.filter((q) => q.x >= 2.6);
  const taken = new Set();
  const take = (b, q) => { if (!q) return; b.assign = q; taken.add(q); };
  const free = (qs) => qs.filter((q) => !taken.has(q));
  const nearest = (qs, y) => free(qs).sort((p, q) => Math.abs(p.y - y) - Math.abs(q.y - y))[0] ?? null;
  // The end man on the line on the play side: who gets kicked out, pinned or read.
  const emol = free(front).filter((q) => q.y * s > 0).sort((a, b) => (b.y - a.y) * s)[0] ?? null;
  // Pullers: the backside guard (and the backside tackle, or the playside pair on a pin & pull).
  const pulls = [];
  if (K.pull) {
    const bs = L.line.filter((b) => b.y * s < -0.3 && LINE.includes(b.slot)).sort((a, b) => (b.y - a.y) * s);
    const ps = L.ps.filter((b) => LINE.includes(b.slot));
    if (K.scheme === 'pin') {
      // Whoever is uncovered on the play side pulls (the tackle only with a tight end there to
      // pin the end); a covered man pins the defender over him. Somebody always pulls.
      const front0 = Object.values(D).filter((q) => q.x < 2.6 && Math.abs(q.y) < 9.5);
      const covered = (b) => front0.some((d) => Math.abs(d.y - b.y) < 1.2);
      const cands = [ps[0], L.end && !LINE.includes(L.end.slot) ? ps[1] : null].filter(Boolean);
      const open = cands.filter((b) => !covered(b));
      pulls.push(...(open.length ? open : cands.slice(0, 1)));
    } else {
      pulls.push(bs[0]);
      if (K.pull.length > 1) pulls.push(bs[1]);
    }
  }
  const pulling = pulls.filter(Boolean);
  // Kick-outs and traps first, so nobody else takes those men.
  let trapped = null;
  if (K.scheme === 'trap') trapped = free(front).filter((q) => q.y * s > 0.2).sort((a, b) => (a.y - b.y) * s)[0] ?? null;
  if (trapped) taken.add(trapped);
  // The fullback leads through the hole on a linebacker.
  if (fb && dir !== 'sneak') {
    fb.role = 'lead';
  }
  // Power and counter: the end of the line base-blocks the end man and the pullers wrap
  // through the hole for the linebackers (the fullback, when there is one, leads too).
  if ((K.scheme === 'gap' || K.scheme === 'pin') && L.end && emol && !pulling.includes(L.end) && !L.end.assign) take(L.end, emol);
  // The rest of the line, playside first.
  const order = [...blockers].sort((a, b) => (b.y - a.y) * s);
  for (const b of order) {
    if (pulling.includes(b) || b.assign) continue;
    let q = null;
    const rel = (d) => (d.y - b.y) * s; // + toward the play side
    switch (K.scheme) {
      case 'zone': case 'reach': case 'pin': {
        // Step playside and take who is in the gap or over him; nobody there, climb.
        // Reaching for the man of a lineman pulling next to him takes a longer step.
        const nb = L.line[L.line.indexOf(b) + s];
        const w = (K.scheme === 'zone' ? 2.0 : 2.8) + (nb && pulling.includes(nb) ? 1.6 : 0);
        q = free(front).filter((d) => rel(d) > -0.5 && rel(d) < w).sort((x, y) => Math.abs(rel(x) - 0.6) - Math.abs(rel(y) - 0.6))[0]
          ?? nearest(second, b.y + s * 1.6);
        break;
      }
      case 'gap': case 'trap': {
        // Block down: the man in the inside gap or over him; the backside cuts off.
        const playside = b.y * s > 0.3 || b.slot === 'C';
        if (playside) q = free(front).filter((d) => rel(d) < 0.6 && rel(d) > (b.slot === 'C' ? -3.9 : -2.4)).sort((x, y) => Math.abs(rel(x) + 0.4) - Math.abs(rel(y) + 0.4))[0];
        else q = free(front).filter((d) => Math.abs(rel(d)) < 2.4).sort((x, y) => Math.abs(rel(x) - 0.4) - Math.abs(rel(y) - 0.4))[0];
        // The trap: the playside guard climbs past the man he leaves for the puller.
        if (K.scheme === 'trap' && b === L.ps[0]) q = null;
        // Nobody to block down on: up to the backside linebacker, who would chase the play.
        q ??= nearest(second, b.y - s * (playside ? 2 : 0.5));
        break;
      }
      default: {
        // Man: the defender over him.
        q = free(front).sort((x, y) => Math.abs(x.y - b.y) - Math.abs(y.y - b.y))[0];
        if (q && Math.abs(q.y - b.y) > 2.2) q = null;
        q ??= nearest(second, b.y);
      }
    }
    take(b, q);
    b.role = b.role === 'passblock' ? 'passblock' : 'runblock';
  }
  // Pullers' paths: flat down the line behind the others, then up through the hole.
  for (const p of pulling) {
    const kind = p.kick ? 'kick' : K.scheme === 'trap' ? 'trap' : K.scheme === 'pin' ? 'sweep' : 'lead';
    if (kind === 'trap') { if (trapped) take(p, trapped); p.kick = true; }
    // Sweep pullers: the first takes the force player at the edge, the next the linebacker inside.
    if (!p.assign) take(p, kind === 'sweep' ? (p === pulling[0] ? nearest(second, L.edge + s * 2) : nearest(second, L.edge - s * 2)) ?? nearest(free(box), L.edge)
      : (p === pulling[0] ? nearest(second, lp.holeY) : nearest(second, lp.holeY - s * 2.5)) ?? nearest(free(box), lp.holeY));
    const vy = kind === 'kick' ? lp.holeY - s * 1.2 : kind === 'trap' ? (trapped?.y ?? L.a) - s * 1 : kind === 'sweep' ? L.edge - s * (p === pulling[0] ? 0.5 : 1.8) : lp.holeY - s * 0.6;
    // A drop step straight back off the line first, then flat behind the blockers next to him
    // (a body's width behind their heels), so he runs past them, not into them.
    const heels = Math.min(...L.line.map((b) => b.x - b.r)) - p.r - 0.3;
    const vx = heels - (kind === 'sweep' ? 0.5 : kind === 'trap' ? 0 : 0.2);
    p.role = 'runblock';
    p.pull = { path: [{ x: vx + 0.2, y: p.y + s * 0.5 }, { x: vx, y: vy }], via: { x: vx, y: vy }, kind, until: 0.5 + Math.abs(vy - p.y) / 6 };
  }
  // A fullback with nobody yet: the free linebacker nearest the hole.
  if (fb && fb.role === 'lead' && !fb.assign) take(fb, nearest([...second, ...front], lp.holeY));
  // Receivers stalk the nearest man in coverage on their side, not a fixed slot. On the toss
  // the playside slot cracks down on the first linebacker inside him instead.
  for (const w of ['WR1', 'WR2', 'WR3', ...(lp.formation !== 'iform' && !L.line.includes(O.TE) ? ['TE'] : [])]) {
    const r = O[w];
    if (!r) continue;
    let best = null, bd = 99;
    const crack = dir === 'toss' && r.y * s > 0 && Math.abs(r.y) < 15;
    for (const q of Object.values(D)) {
      if (taken.has(q) || DLINE.includes(q.slot)) continue;
      const dd = Math.hypot(q.x - r.x, q.y - r.y) + (crack && q.x < 7 && (q.y - r.y) * s < 0 ? -4 : 0);
      if (dd < bd) { bd = dd; best = q; }
    }
    r.role = 'stalk'; r.assign = best; if (best) taken.add(best);
  }
  if (O.QB) O.QB.role = dir === 'sneak' ? 'carrier' : lp.qbRun ? 'qbkeep' : 'handoff';
  // The back leads for the quarterback on his designed runs, and takes the fake on a read.
  if (O.RB) O.RB.role = dir === 'sneak' ? 'runblock' : dir === 'qbpower' || dir === 'qbdraw' ? 'lead' : 'runner';
  if (O.RB?.role === 'lead' && !O.RB.assign) O.RB.assign = nearest([...second, ...front], lp.holeY);
  if (fb?.role === 'lead' && O.RB?.role === 'lead') fb.role = 'runblock';
  lp.handAt = K.hand;
  if (K.scheme === 'draw') lp.dropX = -6.5;
  // Read option: the backside end is left unblocked on purpose; the quarterback reads him.
  if (dir === 'read') {
    const end = Object.values(D).filter((q) => DLINE.includes(q.slot) && q.y * s < 0).sort((a, b) => Math.abs(b.y) - Math.abs(a.y))[0];
    if (end) {
      lp.readEnd = end;
      end.crash = chance(lp.g, ['run_blitz', 'goal_line', 'mug', 'cover0'].includes(lp.defCall) ? 0.65 : 0.45);
      for (const b of Object.values(O)) if (b.assign === end) b.assign = null;
    }
  }
  const c = lp.carrier;
  if (c && dir !== 'sneak') c.track = runTrack(lp);
  lp.mesh = c?.track?.mesh ?? null;
}

// The carrier's designed path, from where he lines up through the line of scrimmage: the
// points he runs (and the play art draws), plus the mesh point where the quarterback meets him.
export function runTrack(lp, s = lp.runSide) {
  const c = lp.carrier ?? lp.off.RB, dir = lp.play.dir, H = lp.holeY ?? 0;
  if (!c) return null;
  const h = c.home ?? c;
  const pts = (...a) => a.map(([x, y]) => ({ x, y }));
  let t, mesh = null;
  switch (dir) {
    case 'inside': case 'read':
      mesh = { x: -4.1, y: s * 0.7 };
      t = pts([mesh.x, mesh.y], [-1.8, H * 0.85], [1.4, H], [6.5, H]); break;
    case 'outside':
      mesh = { x: -4.4, y: s * 1.4 };
      t = pts([mesh.x, mesh.y], [-3.6, H * 0.62], [-1.2, H * 0.95], [1, H], [6.5, H + s * 0.6]); break;
    case 'power':
      // Patient: he lets the pulling guard get across, then follows him downhill.
      mesh = { x: -4.8, y: s * 0.6 };
      t = pts([mesh.x, mesh.y], [-2.2, H * 0.8], [1.4, H], [6.5, H]); break;
    case 'counter':
      // The jab step away first, then back across behind the pullers.
      mesh = { x: -5.1, y: -s * 0.4 };
      t = pts([h.x + 0.3, h.y - s * 1.5], [mesh.x, mesh.y], [-2.4, H * 0.75], [1.4, H], [6.5, H]); break;
    case 'trap':
      mesh = { x: -4.6, y: s * 0.3 };
      t = pts([mesh.x, mesh.y], [-2.4, H], [1.2, H], [6.5, H]); break;
    case 'dive':
      mesh = { x: -3.1, y: H * 0.6 };
      t = pts([mesh.x, mesh.y], [1.2, H], [6.5, H]); break;
    case 'draw': case 'qbdraw':
      // Sit in pass protection, then go.
      mesh = dir === 'draw' ? { x: Math.min(h.x, -5.8), y: h.y * 0.6 } : null;
      t = pts([Math.min(h.x - 1.4, -5.8), h.y * 0.6], [-1.6, H], [1.4, H], [6.5, H]); break;
    case 'toss':
      mesh = null;
      t = pts([-4.6, s * 4.6], [-2.6, H * 0.8], [0.6, H], [6.5, H]); break;
    case 'sweep':
      // Deep, a step behind the pullers, then turn up off their blocks.
      mesh = { x: -5.4, y: s * 1.1 };
      t = pts([mesh.x, mesh.y], [-5.2, H * 0.55], [-2.6, H * 0.92], [0.8, H], [6.5, H - s * 0.4]); break;
    case 'qbpower':
      t = pts([h.x + 0.4, h.y + s * 0.8], [-2.4, H * 0.6], [1.4, H], [6.5, H]); break;
    default:
      t = pts([-3.5, H * 0.35], [1.5, H], [6.5, H]);
  }
  t.mesh = mesh;
  return t;
}
// The keep side on the zone read: around the unblocked end.
export function keepTrack(lp) {
  const e = lp.readEnd, s = -lp.runSide, q = lp.off.QB;
  if (!q) return [];
  return [{ x: q.home.x + 0.6, y: s * 3.5 }, { x: -1, y: (e ? Math.abs(e.y) + 1.5 : 7.5) * s }, { x: 1.5, y: s * 8.8 }, { x: 6.5, y: s * 9.2 }];
}

// ---------- before the handoff ----------
// The back runs his track to the mesh; the counter's jab, the draw's wait and the toss's
// flat run to the pitch are all points on it.
export function runnerWant(lp, p) {
  const t = p.track;
  if (!t?.length) return seek(p, { x: -3.5, y: lp.holeY * 0.35 }, 0.8);
  const dir = lp.play.dir;
  if ((dir === 'draw') && lp.t < lp.handAt - 0.3) return seek(p, t[0], 0.25);
  while (p.wp < t.length - 1 && (dist(p, t[p.wp]) < 0.7 || t[p.wp].x < p.x - 0.4)) p.wp++;
  const pace = dir === 'power' && lp.t < 0.3 ? 0.55 : dir === 'counter' && p.wp <= 1 ? 0.62 : 1;
  return seek(p, t[p.wp], pace, 0.1);
}
// The quarterback meets the back at the mesh (and opens the other way on the counter).
export function meshPoint(lp) {
  return lp.mesh ?? { x: -4.2, y: (lp.holeY ?? 0) > 0 ? 0.6 : -0.6 };
}

// ---------- with the ball, behind the line ----------
// How crowded a lane is a yard or two past the line: unblocked defenders count most.
function laneTraffic(lp, p, y) {
  let d = 0;
  for (const q of lp.players) {
    if (q.side === p.side || q.stun > 0.3) continue;
    // Where he will be in a moment: a front flowing to the play side opens the cutback.
    const dd = Math.hypot(q.x + q.vx * 0.35 - 1.2, (q.y + q.vy * 0.35 - y) * 1.15);
    d += (q.eng ? 0.35 : 1) / (0.8 + dd * dd);
  }
  return d;
}
// Returns true when the designed track set his want. The zone runs read the front once on the
// way to the line: bang it in the called gap, or cut back. The edge runs bounce outside when
// the edge is open and cut up inside when it is set. Gap runs hit their hole.
export function designedWant(lp, p) {
  const K = conceptOf(lp), s = lp.runSide;
  const e = lp.t - (lp.carrierAt ?? 0);
  // Near the line he runs to daylight (the open-field search, which still leans to the hole).
  const edgeRun = K.read === 'edge' && !lp.cut;
  if (p.x > (edgeRun ? 0.2 : -1.4) || e > 1.2) return false;
  // Gap runs press the hole for a beat, then run to daylight leaning on it.
  if (K.press != null && e > K.press) return false;
  if (lp.kept) {
    const t = lp.keepTrack ??= keepTrack(lp);
    p.wp ??= 0;
    while (p.wp < t.length - 1 && (dist(p, t[p.wp]) < 0.8 || t[p.wp].x < p.x - 0.3)) p.wp++;
    seek(p, t[p.wp], 1, 0.05);
    return true;
  }
  const t = p.track ?? [];
  if (!lp.cut && K.read === 'zone' && lp.cutY != null && p.x > -2.8 && e > 0.08) {
    const draw = K.scheme === 'draw';
    const go = laneTraffic(lp, p, lp.holeY), back = laneTraffic(lp, p, lp.cutY), bounce = lp.lm && !draw ? laneTraffic(lp, p, lp.lm.c) : 99;
    // The called gap gets the benefit of the doubt: he leaves it only for a clearly better one.
    const cb = back * 1.15 + 0.04, bo = bounce * 1.5 + 0.08;
    lp.cut = cb < go && cb <= bo ? 'back' : bo < go ? 'bounce' : 'bang';
    if (lp.cut === 'back') { lp.holeY = lp.cutY; event(lp, 'cutback', '', p); }
    if (lp.cut === 'bounce') lp.holeY = lp.lm.c;
  }
  if (!lp.cut && K.read === 'edge' && p.x > -3.2 && e > 0.25) {
    // The edge: somebody set outside him means cut it up inside the block; open means bounce.
    const out = sgn(lp.holeY);
    const setter = lp.players.find((q) => q.side !== p.side && !q.eng && q.stun <= 0 && (q.y - p.y) * out > 0.3 && Math.abs(q.x - p.x) < 3.2 && dist(q, p) < 3.6);
    if (setter) {
      const up = lp.lm?.end ? lp.lm.end.y + out * 0.9 : lp.holeY - out * 3;
      const back = lp.cutY ?? lp.lm?.backB ?? 0;
      lp.cut = laneTraffic(lp, p, back) + 0.15 < laneTraffic(lp, p, up) * 0.6 ? 'back' : 'up';
      lp.holeY = lp.cut === 'back' ? back : up;
      lp.bounced = true;
      event(lp, lp.cut === 'back' ? 'cutback' : 'bounce', '', p, setter);
    }
  }
  if (lp.cut && lp.cut !== 'bang') {
    // Plant and go: downhill into the new lane, then daylight (never dancing behind the line).
    if (p.x > -1.6 || e > 0.9) return false;
    seek(p, { x: Math.max(p.x + 2.4, 1.4), y: clamp(lp.holeY, p.y - 3, p.y + 3) }, 1, 0.05);
    return true;
  }
  if (lp.cut === 'bang' && p.x > -2.2) return false;
  // Gap runs hit inside the kick-out: once the end is kicked, the hole is just inside that block.
  if (K.scheme === 'gap' || K.scheme === 'trap') {
    const k = Object.values(lp.off).find((b) => b.kick && b.eng);
    if (k && lp.lm) {
      const inner = lp.lm.ps[0] ? lp.lm.ps[0].y : 0;
      lp.holeY = (k.y - s * 1.3 - inner) * s > 0.4 ? k.y - s * 1.3 : inner + s * 0.8;
    }
  }
  // Still on the track: the next point ahead of him, with the hole where he reads it.
  while (p.wp < t.length - 1 && (dist(p, t[p.wp]) < 0.8 || t[p.wp].x < p.x - 0.3)) p.wp++;
  const w = t[p.wp];
  if (!w) return false;
  // Behind the line he stays on the inside hip of the lead puller until the puller has turned
  // up into his block (he never outruns his convoy to the edge).
  const lead = K.scheme === 'pin' ? Object.values(lp.off).filter((b) => b.pull && !b.pull.done && !b.eng).sort((a, b) => (b.y - a.y) * s)[0] : null;
  let to = w.x > 1 ? { x: w.x, y: lp.holeY } : w;
  if (lead && (to.y - (lead.y - s * 1.4)) * s > 0) to = { x: Math.min(to.x, lead.x - 0.6), y: lead.y - s * 1.4 };
  seek(p, to, 1, 0.05);
  return true;
}
