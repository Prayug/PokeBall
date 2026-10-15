// The passing game in a live play: routes, the quarterback's reads, the throw and the ball's
// flight, and the catch, the contested ball, the interception and the incompletion.
import { traitMod } from '../traits.js';
import { PLAYERS } from '../ratings.js';
import { chance, clamp, nm, rand, randn, rep, st } from '../engine.js';
import { DT, GRAVITY, SIDE, dist, event, finish, kin, len, note, passBlockWant, seek, setCarrier, sgn, traitNotes, unengage } from '../live.js';

// The quarterback's throwing motion, from the decision to the ball leaving his hand.
const WINDUP_T = 0.24;

// Route shapes: [downfield, across] legs from the receiver's start; 'in' and 'out' are
// relative to the middle of the field. A trailing 'stop' settles the receiver.
export const ROUTES = {
  go: [[30, 0]],
  slant: [[2.5, 0], [6, 'in6']],
  out: [[6, 0], [0, 'out9']],
  curl: [[11, 0], [-1.5, 'in1'], 'stop'],
  seam: [[28, 'in1']],
  post: [[11, 0], [16, 'in11']],
  corner: [[11, 0], [12, 'out9']],
  drag: [[3, 0], [1, 'in18']],
  hitch: [[5, 0], [-1, 0], 'stop'],
  flat: [[1.5, 'out7'], [2, 'out3']],
  wheel: [[0.5, 'out7'], [24, 'out1']],
  screen: [[5.5, 'out6'], 'stop'],
  check: ['block', [3, 'out5'], [2, 'out2']],
  // Added with the bigger playbook.
  stick: [[5.5, 0], [0.3, 'in1'], 'stop'],
  dig: [[12, 0], [0, 'in13']],
  shallow: [[1.5, 0], [0.5, 'in20']],
  in5: [[5, 0], [0, 'in12']],
  sail: [[6, 0], [6, 'out9']],
  cross: [[7, 'in3'], [6, 'in22']],
  bubble: [[-1.2, 'out2.5'], [0.4, 'out2'], 'stop'],
  fade: [[28, 'out2']],
  angle: [[0.5, 'out3'], [5, 'in6']],
  comeback: [[13, 0], [-2, 'out3'], 'stop'],
};
export const PLAY_ROUTES = {
  screen: { WR1: 'go', WR2: 'go', WR3: 'hitch', TE: 'drag', RB: 'screen' },
  slant: { WR1: 'slant', WR2: 'slant', WR3: 'slant', TE: 'flat', RB: 'check' },
  out: { WR1: 'out', WR2: 'out', WR3: 'slant', TE: 'curl', RB: 'flat' },
  curl: { WR1: 'curl', WR2: 'curl', WR3: 'drag', TE: 'curl', RB: 'check' },
  te_seam: { WR1: 'go', WR2: 'curl', WR3: 'post', TE: 'seam', RB: 'check' },
  post: { WR1: 'post', WR2: 'post', WR3: 'curl', TE: 'drag', RB: 'check' },
  pa_deep: { WR1: 'go', WR2: 'post', WR3: 'curl', TE: 'seam', RB: 'block' },
  bubble: { WR1: 'stalk', WR2: 'stalk', WR3: 'bubble', TE: 'block', RB: 'block' },
  stick: { WR1: 'fade', WR2: 'slant', WR3: 'stick', TE: 'stick', RB: 'flat' },
  curl_flat: { WR1: 'curl', WR2: 'curl', WR3: 'flat', TE: 'seam', RB: 'flat' },
  mesh: { WR1: 'corner', WR2: 'dig', WR3: 'shallow', TE: 'drag', RB: 'angle' },
  smash: { WR1: 'hitch', WR2: 'hitch', WR3: 'corner', TE: 'corner', RB: 'check' },
  dagger: { WR1: 'dig', WR2: 'hitch', WR3: 'seam', TE: 'drag', RB: 'check' },
  levels: { WR1: 'dig', WR2: 'go', WR3: 'in5', TE: 'in5', RB: 'check' },
  flood: { WR1: 'go', WR2: 'go', WR3: 'sail', TE: 'drag', RB: 'flat' },
  y_cross: { WR1: 'post', WR2: 'comeback', WR3: 'go', TE: 'cross', RB: 'flat' },
  four_verts: { WR1: 'go', WR2: 'go', WR3: 'seam', TE: 'seam', RB: 'check' },
  pa_boot: { WR1: 'go', WR2: 'corner', WR3: 'post', TE: 'cross', RB: 'flat' },
};

export function buildRoute(lp, p, name) {
  const spec = ROUTES[name];
  const inward = p.y === 0 ? (chance(lp.g, 0.5) ? 1 : -1) : -sgn(p.y);
  let x = p.x, y = p.y;
  const pts = [];
  for (const leg of spec) {
    if (leg === 'stop') { if (pts.length) pts[pts.length - 1].stop = true; continue; }
    if (leg === 'block') { pts.push({ block: 1.1 }); continue; }
    const [dx, dy] = leg;
    let across = 0;
    if (typeof dy === 'string') {
      const m = /^(in|out)([\d.]+)$/.exec(dy);
      across = (m[1] === 'in' ? inward : -inward) * Number(m[2]);
    } else across = dy;
    x = Math.min(x + dx, lp.goalX + 8.5);
    y = clamp(y + across, -SIDE + 1.5, SIDE - 1.5);
    pts.push({ x, y });
  }
  return pts;
}

// How open each eligible receiver is right now, measured where the ball would meet him if it
// were thrown this instant: the nearest defender's distance from that spot. OPEN, CONTESTED or
// COVERED; the HUD colors the throw icons from it and the quarterback reads it.
export const OPENNESS = ['OPEN', 'CONTESTED', 'COVERED'];
export function coverageRead(lp) {
  const qb = lp.off.QB;
  if (!qb || lp.kind !== 'pass') return;
  if ((lp.covTick = (lp.covTick ?? 0) - DT) > 0) return;
  lp.covTick = 0.1;
  for (const k of lp.eligible ?? []) {
    const r = lp.off[k];
    if (!r) continue;
    if (r.role !== 'route' || (r.route?.[0]?.block && r.wp === 0)) { r.open = null; r.openState = null; continue; }
    const T = dist(qb, r) / throwSpeed(qb) + WINDUP_T;
    const px = r.x + r.vx * T, py = r.y + r.vy * T;
    let open = 99;
    for (const q of lp.players) if (q.side === 'def') open = Math.min(open, Math.hypot(q.x + q.vx * T * 0.6 - px, q.y + q.vy * T * 0.6 - py) - q.r * 0.5);
    r.open = open; r.lead = { x: px, y: py };
    r.openState = open >= 2.6 ? 'OPEN' : open >= 1.2 ? 'CONTESTED' : 'COVERED';
  }
}

// The quarterback's progression: the play's reads in order (its primary target first), each
// given a beat before his eyes move on; a wide-open man anywhere in his vision is taken early,
// and under pressure he takes the best he has or checks down.
export function qbBrain(lp) {
  const qb = lp.off.QB;
  if (!qb || lp.ball.holder !== qb || lp.qbState === 'run') return;
  if (lp.qbState === 'drop' && lp.t >= lp.readAt) lp.qbState = 'read';
  // Crossing the line makes the quarterback a runner.
  if (qb.x > 0.3) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble', '', qb); return; }
  if (!lp.reads) {
    const w = lp.play.targets ?? {};
    lp.reads = [...(lp.eligible ?? [])].sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0));
    lp.readIdx = 0; lp.readSince = lp.readAt;
  }
  const read = () => lp.off[lp.reads[lp.readIdx]];
  if (lp.qbState === 'read') {
    // A beat per read; sharper quarterbacks move through it faster.
    const beat = 0.62 - (qb.a.awr - 60) * 0.004;
    if (lp.t - lp.readSince > beat && lp.readIdx < lp.reads.length - 1) { lp.readIdx++; lp.readSince = lp.t; }
    lp.qbLook = read() ?? lp.qbLook;
  } else lp.qbLook = lp.off[lp.reads[0]] ?? null;
  if (lp.user === lp.o && !lp.autoQB) return; // the user throws; his eyes still go through the reads
  if (lp.qbState !== 'read') return;
  lp.readTick -= DT;
  if (lp.readTick > 0) return;
  lp.readTick = 0.12;
  const g = lp.g;
  const elapsed = lp.t - lp.readAt;
  let nearRush = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) nearRush = Math.min(nearRush, dist(q, qb));
  lp.pressure = nearRush < 2.6;
  const vision = (qb.a.acc + qb.a.awr) / 2;
  const noise = 0.4 + Math.max(0, 99 - vision) * 0.03 + (lp.pressure ? 0.8 : 0);
  const scoreOf = (r) => {
    if (!r || r.open == null) return null;
    const gain = clamp(r.lead.x, -3, 25) * 0.07;
    return r.open + gain + noise * randn(g);
  };
  const cur = read(), cs = scoreOf(cur);
  // Everyone else: only a man left wide open catches his eye off the read.
  let best = cur && cs != null ? { r: cur, score: cs } : null;
  for (const k of lp.reads) {
    const r = lp.off[k];
    if (r === cur) continue;
    const s = scoreOf(r);
    if (s == null) continue;
    const seen = s - 1.6; // off-read throws need more
    if (!best || seen > best.score) best = { r, score: seen };
  }
  const need = 3.2 - elapsed * 0.9;
  if (best && (best.score > need || (lp.pressure && best.score > 1.9))) {
    // A tight window short gets a bullet; a man running free deep gets air under it.
    const r = best.r, deep = (r.lead?.x ?? 0) > 20;
    startThrow(lp, r, false, { type: r.open < 2 && !deep ? 'bullet' : deep && r.open > 4.5 ? 'lob' : 'touch' });
    return;
  }
  if (nearRush < 1.8 || elapsed > 2.6) {
    const spd = qb.a.spd;
    if (chance(g, clamp((spd - 50) / 120, 0.05, 0.4) * 0.35)) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble', '', qb); return; }
    if (elapsed > 2.6 && chance(g, 0.12)) { throwAway(lp); return; }
    // The checkdown: whoever is most open, if anyone is.
    let dump = null;
    for (const k of lp.reads) { const r = lp.off[k]; if (r?.open != null && (!dump || r.open > dump.open)) dump = r; }
    if (dump && elapsed > 1.7 && dump.open > 1.3) throwTo(lp, dump);
  }
}

export function routeWant(lp, p) {
  if (lp.thrown && lp.thrown.target === p) {
    // Work back to the ball (but not into the bench).
    return seek(p, { x: lp.thrown.tx, y: clamp(lp.thrown.ty, -SIDE - 0.5, SIDE + 0.5) }, 1, 0.4);
  }
  if (p.jam > 0) { p.jam -= DT; p.want = { vx: 0.6, vy: 0 }; return; }
  const r = p.route;
  if (!r || p.wp >= r.length) {
    if (r && r[r.length - 1]?.stop) { p.want = { vx: 0, vy: 0 }; return; }
    const l = len(p.vx, p.vy) || 1;
    p.want = { vx: (p.vx / l) * p.top * 0.95, vy: (p.vy / l) * p.top * 0.95 };
    if (p.x > lp.goalX + 8) p.want = { vx: 0, vy: p.vy };
    return;
  }
  const w = r[p.wp];
  if (w.block != null) {
    if (lp.t > w.block) { p.wp++; return routeWant(lp, p); }
    return passBlockWant(lp, p);
  }
  const d = dist(p, w);
  if (d < 0.7) { p.wp++; return routeWant(lp, p); }
  seek(p, w, 0.97, w.stop ? 1.0 : 0.01);
}

// ---------- passing ----------
function throwSpeed(qb) { return 17 + 0.09 * qb.a.arm; }

// The throw: the quarterback sets his feet and turns to the target (the windup), then the
// ball leaves his hand on a real arc. Nothing is resolved until it gets there.
function throwTo(lp, r) { startThrow(lp, r, false); }
export function throwAway(lp) { startThrow(lp, null, true); }
// Throws come in three kinds, like the real thing: a bullet (hard and flat, through a closing
// window, a little harder to catch), touch (the default: drilled short, lofted a bit as it gets
// longer) and a lob (high and soft, over the underneath defenders, but it hangs in the air).
const THROWS = { bullet: { v: 1.14, sd: 1.08, catch: -0.04, windup: 0.9 }, touch: { v: 1, sd: 1, catch: 0, windup: 1 }, lob: { v: 0.7, sd: 1.12, catch: 0.03, windup: 1.1 } };
export function startThrow(lp, r, away, opts = {}) {
  if (lp.windup || lp.thrown || lp.tackle) return;
  const qb = lp.off.QB;
  const kind = THROWS[opts.type] ? opts.type : 'touch';
  lp.windup = { r, away, kind, place: opts.place ?? null, t0: lp.t, T: WINDUP_T * (1.15 - qb.a.arm / 400) * THROWS[kind].windup, at: away ? { x: qb.x + 6, y: (qb.y >= 0 ? 1 : -1) * (SIDE + 4) } : null };
  lp.qbState = 'windup';
  event(lp, 'windup', '', qb, r);
}
export function windup(lp) {
  const W = lp.windup;
  if (!W) return;
  const qb = lp.off.QB;
  // Sacked or out of the pocket mid-motion: no throw.
  if (lp.ball.holder !== qb || lp.tackle || lp.phase !== 'live') { lp.windup = null; return; }
  if (lp.t - W.t0 < W.T) return;
  lp.windup = null;
  release(lp, W.r, W.away, W.kind, W.place);
}

// Where the ball leaves the passer's hand: in front of his throwing shoulder, near the top of
// his body (lower for a short Pokémon).
export function releasePoint(qb) {
  return { x: qb.x + qb.fx * (qb.r + 0.1) + qb.fy * 0.22, y: qb.y + qb.fy * (qb.r + 0.1) - qb.fx * 0.22, z: clamp(qb.h * 0.82, 1.1, 3.4) };
}
// The height a receiver catches the ball at.
export function catchHeight(p) { return clamp(p.h * 0.6, 0.9, 2.6); }

function release(lp, r, away, kind = 'touch', place = null) {
  const g = lp.g, qb = lp.off.QB;
  const K = THROWS[kind] ?? THROWS.touch;
  const v = throwSpeed(qb) * (away ? 1 : K.v);
  const rp = releasePoint(qb);
  if (away) {
    const side = qb.y >= 0 ? 1 : -1;
    launch(lp, { target: null, sx: rp.x, sy: rp.y, z0: rp.z, tx: qb.x + 6, ty: side * (SIDE + 4), zc: 0.6, v: v * 0.85, away: true });
    event(lp, 'throw', `${nm(qb.id)} throws it away`, qb);
    return;
  }
  // Lead the receiver: where will he be when the ball arrives?
  let T = dist(rp, r) / v, px = r.x, py = r.y;
  for (let i = 0; i < 4; i++) {
    const fut = futureRoute(r, T);
    px = fut.x; py = fut.y;
    T = Math.hypot(px - rp.x, py - rp.y) / v;
  }
  let near = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) near = Math.min(near, dist(q, qb));
  const pressured = near < 2.4;
  const D = lp.def;
  const tAcc = traitMod('throwAccuracy', { qb, def: Object.values(D) });
  traitNotes(lp, tAcc, { qb }, qb);
  const acc = qb.a.acc + tAcc.v - (lp.g.weather === 'rain' ? 4 : 0);
  const air = Math.hypot(px - rp.x, py - rp.y);
  const tPr = pressured ? traitMod('pressure', { qb }) : null;
  if (tPr) traitNotes(lp, tPr, { qb }, qb);
  let sd = (0.25 + air * 0.042) * (1.9 - acc / 90) * (pressured ? 1 + 0.5 * tPr.v : 1) * K.sd;
  // A bullet thrown a long way sprays more; a lob thrown short is hard to drop in.
  if (kind === 'bullet' && air > 18) sd *= 1.15;
  if (kind === 'lob' && air < 10) sd *= 1.2;
  const moving = len(qb.vx, qb.vy) > 2;
  if (moving && ((lp.manual && lp.control === qb) || lp.play.boot)) sd *= lp.play.boot ? 1.12 : 1.25; // throwing on the run
  // Placement: lead him downfield (high), bring it back (low, he works back to it) or put it to
  // one side. The receiver adjusts to it in the air.
  let zc = catchHeight(r);
  if (place) {
    const k = 1.5;
    px += place.x * (place.x > 0 ? k * 1.2 : k);
    py += place.y * k;
    if (place.x > 0.5) zc += 0.35; else if (place.x < -0.5) zc -= 0.3;
    zc = clamp(zc, 0.6, 3.2);
  }
  px += randn(g) * sd * 1.2; py += randn(g) * sd;
  py = clamp(py, -SIDE - 2, SIDE + 2);
  // Touch: deep balls are lofted, short ones are drilled.
  const loft = kind !== 'touch' ? 1 : air > 18 ? 0.86 : air > 10 ? 0.94 : 1;
  launch(lp, { target: r, sx: rp.x, sy: rp.y, z0: rp.z, tx: px, ty: py, zc, v: v * loft, pressured, air: px, kind, catchMod: K.catch, placed: !!place });
  // The user takes over the receiver while the ball is in the air (and can attack it).
  if (lp.user === lp.o && lp.control === qb && !lp.autoQB) { lp.control = r; lp.manual = false; lp.handoverLock = true; }
  lp.stats.target = r;
  lp.stats.cov = nearestDef(lp, r);
  event(lp, 'throw', `${nm(qb.id)} throws for ${nm(r.id)}`, qb, r);
}

// A ballistic flight from (sx, sy, z0) that comes down through (tx, ty, zc) after T seconds.
function launch(lp, f) {
  const horiz = Math.hypot(f.tx - f.sx, f.ty - f.sy);
  const T = Math.max(0.18, horiz / f.v);
  const vz = (f.zc - f.z0 + 0.5 * GRAVITY * T * T) / T;
  lp.thrown = { ...f, T, vz, t0: lp.t };
  lp.ball = { ...lp.ball, state: 'air', holder: null, x: f.sx, y: f.sy, z: f.z0 };
  lp.qbState = 'done';
}

// The ball's position e seconds into its flight (the renderer draws the arc from this too).
export function flightAt(F, e) {
  const u = e / F.T;
  return { x: F.sx + (F.tx - F.sx) * u, y: F.sy + (F.ty - F.sy) * u, z: F.z0 + F.vz * e - 0.5 * GRAVITY * e * e };
}

function futureRoute(r, T) {
  // Run a copy of the receiver along his route for T seconds.
  const c = { x: r.x, y: r.y, vx: r.vx, vy: r.vy, fx: r.fx, fy: r.fy, top: r.top, accel: r.accel, route: r.route, wp: r.wp, role: 'route' };
  const stub = { thrown: null, t: 9, goalX: 999 };
  for (let t = 0; t < T; t += DT) {
    const w = c.route?.[c.wp];
    if (w && w.block != null) { c.wp++; continue; }
    routeWant(stub, c);
    const want = c.want ?? { vx: 0, vy: 0 };
    kin(c, want.vx, want.vy, c.top, DT);
  }
  return { x: c.x, y: c.y };
}

function nearestDef(lp, r) {
  let best = null, bd = 99;
  for (const q of lp.players) if (q.side === 'def') { const d = dist(q, r); if (d < bd) { bd = d; best = q; } }
  return best;
}

export function snapFlight(lp) {
  const b = lp.ball;
  if (b.state !== 'snap') return;
  const qb = lp.off.QB;
  const u = clamp((lp.t - b.t0) / b.T, 0, 1);
  b.x = b.from.x + (qb.x + 0.3 - b.from.x) * u; b.y = b.from.y + (qb.y - b.from.y) * u;
  b.z = 0.3 + 0.8 * u + Math.sin(u * Math.PI) * 0.25;
  if (u >= 1) { b.state = 'held'; b.holder = qb; }
}

export function ballFlight(lp) {
  const T = lp.thrown;
  if (!T || lp.ball.state !== 'air') return;
  const e = lp.t - T.t0;
  const at = flightAt(T, Math.min(e, T.T));
  const b = lp.ball;
  b.x = at.x; b.y = at.y; b.z = at.z;
  if (e < T.T) { if (!T.away && underneath(lp, T, e)) return; return; }
  if (T.away) { dropBall(lp, 0.45); incomplete(lp, `${nm(lp.off.QB.id)} throws it away.`); return; }
  arrival(lp);
}

// On its way the ball passes over (or into) defenders between the passer and the target: a
// linebacker sitting in the throwing lane, a rusher with his hands up at the line. Each gets one
// chance to get a hand on it if it comes by low enough; a bullet stays under the radar of no one,
// a lob sails over them. Returns true when the ball was tipped or picked.
function underneath(lp, T, e) {
  if (e < 0.08 || T.T - e < 0.2) return false;
  const b = lp.ball;
  T.seen ??= new Set();
  for (const q of lp.players) {
    if (q.side !== 'def' || q.eng || q.stun > 0 || T.seen.has(q)) continue;
    const dd = Math.hypot(q.x - b.x, q.y - b.y);
    if (dd > 1.1) continue;
    T.seen.add(q);
    // How high he gets a hand: his height, a jump, more for a flyer.
    const reach = q.h * 1.05 + 0.5 + (q.h > 2.2 ? 0.2 : 0);
    const low = clamp((reach - b.z) / 0.9, 0, 1);
    if (low <= 0) continue;
    // He has to see it coming: a rusher facing the passer, a zone defender reading him; a man
    // defender trailing his receiver with his back to the ball rarely does.
    const facing = (q.fx * (lp.off.QB.x - q.x) + q.fy * (lp.off.QB.y - q.y)) / (Math.hypot(lp.off.QB.x - q.x, lp.off.QB.y - q.y) || 1);
    const eyes = clamp(0.35 + facing * 0.5, 0.1, 0.85) * (q.react > 0 ? 0.4 : 1);
    const p = low * eyes * (0.1 + (q.a.awr + q.a.cov) / 1000) * (1.1 - dd * 0.5);
    if (!chance(lp.g, p)) continue;
    const pick = q.role === 'cover' && b.z > 0.6 && chance(lp.g, clamp(0.12 + (q.a.hnd - 60) * 0.005, 0.05, 0.3));
    if (pick) { interception(lp, q, { x: b.x, y: b.y }); return true; }
    st(lp.g, lp.d, q.id).pd++;
    dropBall(lp, 0.1, 2.6);
    event(lp, 'deflect', '', q, T.target);
    incomplete(lp, `${nm(q.id)} gets a hand on ${nm(lp.off.QB.id)}'s pass${q.role === 'rush' ? ' at the line' : ''}.`, q);
    return true;
  }
  return false;
}

// The ball comes loose (incomplete, dropped, batted): it keeps some of its flight and falls.
function dropBall(lp, keep, pop = 0) {
  const T = lp.thrown, b = lp.ball;
  const horiz = T ? Math.hypot(T.tx - T.sx, T.ty - T.sy) : 1;
  const ux = T ? (T.tx - T.sx) / (horiz || 1) : 1, uy = T ? (T.ty - T.sy) / (horiz || 1) : 0;
  const v = T ? horiz / T.T : 4;
  const vzArr = T ? T.vz - GRAVITY * T.T : -2;
  b.state = 'loose'; b.holder = null;
  b.vx = ux * v * keep + (pop ? (rand(lp.g) - 0.5) * 3 : 0);
  b.vy = uy * v * keep + (pop ? (rand(lp.g) - 0.5) * 3 : 0);
  b.vz = pop ? pop : vzArr * 0.5;
}

export function looseBall(lp) {
  const b = lp.ball;
  if (b.state !== 'loose') return;
  b.vz -= GRAVITY * DT;
  b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
  if (b.z <= 0.15) {
    b.z = 0.15;
    if (Math.abs(b.vz) > 1.2) { b.vz = -b.vz * 0.35; b.vx *= 0.6; b.vy *= 0.6; }
    else { b.vz = 0; b.vx *= 0.9; b.vy *= 0.9; }
  }
}

// The ball reaches the catch point. Whoever is there plays it: the receiver, a defender who
// beat him to the spot, or nobody. Flying Pokémon reach a little farther for it.
function arrival(lp) {
  const g = lp.g, T = lp.thrown;
  const spot = { x: T.tx, y: T.ty };
  const r = T.target;
  const dr = dist(r, spot);
  const reachOf = (p) => 1.45 + traitMod('catchReach', { p }).v;
  let dfd = null, dd = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) { const d = dist(q, spot); if (d < dd) { dd = d; dfd = q; } }
  lp.sepAtArrival = dd; lp.drAtArrival = dr;
  const userDef = lp.user === lp.d && lp.control && lp.control.side === 'def' ? lp.control : null;
  const userPlay = userDef && dist(userDef, spot) < 1.8 && userDef.dive != null;
  lp.stats.cov = dfd && dd < 3 ? dfd : lp.stats.cov;
  const inBounds = Math.abs(spot.y) < SIDE && spot.x < lp.goalX + 10;
  const rReach = reachOf(r);
  if (dr <= rReach && dr > 1.45) traitNotes(lp, traitMod('catchReach', { p: r }), { p: r }, r, true);
  // Defender plays the ball first if he is closer.
  if (dfd && dd < 1.5 && (dd < dr || dr > rReach - 0.05)) {
    const tInt = traitMod('intChance', { d: dfd, r });
    const hawk = tInt.v;
    traitNotes(lp, tInt, { d: dfd, r }, dfd);
    const R = rep(dfd.id, dfd.a.cov, r.id, r.a.hndC);
    const pI = (diff) => clamp(0.08 + hawk + diff * 0.006 + (T.pressured ? 0.04 : 0) + (dr > rReach ? 0.12 : 0) - dd * 0.05, 0.03, 0.42)
      * (lp.offCall === 'screen' ? 0.4 : 1) + (userPlay && dfd === userDef ? 0.18 : 0);
    if (inBounds && contest(lp, pI(R.diff), pI(R.base), R, dfd, r, 'for the interception')) { interception(lp, dfd, spot); return; }
    const pB = (diff) => clamp(0.3 + diff * 0.01 - dd * 0.15 + (userPlay ? 0.25 : 0), 0.15, 0.9);
    if (dr > rReach || contest(lp, pB(R.diff), pB(R.base), R, dfd, r, 'at the catch point')) {
      st(g, lp.d, dfd.id).pd++;
      dropBall(lp, 0.12, 3.2);
      event(lp, 'deflect', '', dfd, r);
      incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is broken up by ${nm(dfd.id)}.`, dfd);
      return;
    }
  }
  if (dr > rReach || !inBounds) {
    dropBall(lp, 0.45);
    incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} falls incomplete${dr > rReach ? ', just out of reach' : ''}.`);
    return;
  }
  const contested = dfd && dd < 1.8;
  const hands = contested ? r.a.hndC : r.a.hnd;
  const thrown = Math.hypot(T.tx - T.sx, T.ty - T.sy);
  // Attacking the ball at its high point (Space while it is in the air to your receiver):
  // better in traffic, and he stops to make the catch.
  const aggro = !!lp.aggro && lp.control === r;
  const base = 0.95 + (hands - 70) * 0.004 - Math.max(0, dr - 0.5) * 0.12 - Math.max(0, thrown - 18) * 0.006 + (T.catchMod ?? 0) + (aggro ? (contested ? 0.1 : -0.02) : 0);
  let caught;
  if (contested) {
    const R = rep(r.id, hands, dfd.id, dfd.a.cov);
    const pc = (diff) => clamp(base - ((1.8 - dd) * 0.12 - diff * 0.006), 0.15, 0.98);
    caught = contest(lp, pc(R.diff), pc(R.base), R, r, dfd, 'on the contested catch');
  } else caught = chance(g, clamp(base, 0.15, 0.98));
  if (caught) {
    // The ball comes to his hands where he is. Open and in stride, he catches it running and
    // keeps going (a run-after-catch catch); in traffic or going up for it, he secures it first.
    const deepCatch = thrown > 18;
    const rac = !contested && !aggro && dd > 3 && len(r.vx, r.vy) > 4;
    const k = rac ? 0.6 : deepCatch || aggro ? 0.3 : 0.45;
    r.vx *= k; r.vy *= k; r.slow = rac ? 0.08 : deepCatch ? 0.5 : 0.3;
    lp.catchKind = rac ? 'rac' : aggro || contested ? 'aggressive' : 'possession';
    r.caughtAt = lp.t;
    lp.caught = true;
    lp.catchX = r.x;
    lp.catchAt = { x: lp.ball.x, y: lp.ball.y };
    setCarrier(lp, r);
    event(lp, 'catch', `${nm(r.id)} makes the catch`, r, lp.off.QB);
    return;
  }
  if (contested) st(g, lp.d, dfd.id).pd++;
  dropBall(lp, 0.2, 1.5);
  incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is dropped${contested ? ` with ${nm(dfd.id)} draped on him` : ''}.`);
}

function interception(lp, d, spot) {
  lp.intercepted = true;
  lp.picker = d;
  lp.catchX = d.x;
  lp.catchAt = { x: spot.x, y: spot.y };
  d.caughtAt = lp.t;
  for (const p of lp.players) if (p.eng) unengage(p);
  setCarrier(lp, d);
  event(lp, 'int', `INTERCEPTED by ${nm(d.id)}!`, d, lp.thrown?.target);
}

// A rated contest rolled once. pWith includes the type matchup, pWithout leaves it out; when
// they disagree about this roll, the types decided it, and the play says so.
export function contest(lp, pWith, pWithout, R, a, d, where) {
  const roll = rand(lp.g);
  const hit = roll < pWith;
  if (hit !== roll < pWithout) {
    const w = hit ? a : d, l = hit ? d : a;
    const se = hit ? R.aSE : R.dSE;
    note(lp, 'type', se ? `${nm(w.id)}'s ${PLAYERS[w.id].types.join('/')} typing is super effective against ${nm(l.id)} ${where}`
      : `${nm(l.id)}'s ${PLAYERS[l.id].types.join('/')} typing costs it ${where}`, w);
    if (se) lp.typeWin = { winner: w, loser: l, where };
  }
  return hit;
}

function incomplete(lp, text, by = null) {
  if (lp.ball.state === 'air') dropBall(lp, 0.3);
  event(lp, 'incomplete', text, lp.thrown?.target ?? null, by);
  finish(lp, { how: 'incomplete', text, by });
}
