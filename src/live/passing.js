// The passing game in a live play: routes, the quarterback's reads, the throw and the ball's
// flight, and the catch, the contested ball, the interception and the incompletion.
import { traitMod } from '../traits.js';
import { RATES, liveFoul, sloppy } from '../penalties.js';
import { PLAYERS } from '../ratings.js';
import { chance, clamp, nm, rand, randn, rep, st } from '../engine.js';
import { DT, GRAVITY, SIDE, dist, event, finish, isManual, kin, len, mustGain, note, passBlockWant, seek, setCarrier, sgn, sticks, traitNotes, unengage } from './core.js';

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
  pts.from = { x: p.x, y: p.y }; // where the route is drawn from (the first leg starts here)
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
    const beat = (0.62 - (qb.a.awr - 60) * 0.004) * (lp.user === lp.d ? lp.aiRead ?? 1 : 1);
    if (lp.t - lp.readSince > beat && lp.readIdx < lp.reads.length - 1) { lp.readIdx++; lp.readSince = lp.t; }
    lp.qbLook = read() ?? lp.qbLook;
  } else lp.qbLook = lp.off[lp.reads[0]] ?? null;
  if ((lp.user === lp.o || lp.p2?.user === lp.o) && !lp.autoQB) return; // the user throws; his eyes still go through the reads
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
  // Down and distance: on third and fourth down a catch short of the sticks loses the ball, so
  // a man short of them has to be much more open to be worth it (less so once the play is
  // breaking down); on early downs a throw that moves the chains is a little better.
  const line = sticks(lp), must = mustGain(lp);
  const sticksBonus = (x) => x >= line - 0.3 ? (must ? 0.6 : 0.25) : must ? -clamp((line - x) * 0.22, 0, 1.8) * (elapsed > 1.8 || lp.pressure ? 0.45 : 1) : 0;
  const scoreOf = (r) => {
    if (!r || r.open == null) return null;
    const gain = clamp(r.lead.x, -3, 25) * 0.04;
    return r.open + gain + sticksBonus(r.lead.x) + noise * randn(g);
  };
  const cur = read(), cs = scoreOf(cur);
  // Everyone else: only a man left wide open catches his eye off the read.
  let best = cur && cs != null ? { r: cur, score: cs } : null;
  for (const k of lp.reads) {
    const r = lp.off[k];
    if (r === cur) continue;
    const s = scoreOf(r);
    if (s == null) continue;
    // Off-read throws need more, except on a money down a man open past the sticks: the
    // quarterback knows where the line to gain is and is looking for him.
    const seen = s - (must && r.openState === 'OPEN' && r.lead.x >= line - 0.3 ? 0.5 : 1.6);
    if (!best || seen > best.score) best = { r, score: seen };
  }
  // Early in the read only a clearly open man gets the ball; the bar drops as he holds it.
  const need = 6 - elapsed;
  // Nobody clearly open and the defense has left a wide lane in front of him (the rush
  // flushed past, the coverage turned its back): a mobile quarterback pulls it down and runs.
  if (elapsed > 1.2 && !(best && best.score > need)) {
    const lane = runLane(lp, qb);
    if (lane > 4.5 && chance(g, clamp((qb.a.spd - 55) / 160 + (qb.a.awr - 60) / 400, 0.02, 0.3))) {
      lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble', '', qb); return;
    }
  }
  if (best && (best.score > need || (lp.pressure && best.score > 1.9))) {
    // A tight window short gets a bullet; a man running free deep gets air under it.
    const r = best.r, deep = (r.lead?.x ?? 0) > 20;
    startThrow(lp, r, false, { type: r.open < 2 && !deep ? 'bullet' : deep && r.open > 4.5 ? 'lob' : 'touch' });
    return;
  }
  if (lp.pressure || elapsed > 2.6) {
    // Pressure, or nobody open: take off, but only through a real running lane (no free
    // defender in the space ahead of him). Quick, aware quarterbacks see it; the rest rarely go.
    const lane = runLane(lp, qb);
    const spd = qb.a.spd, awr = qb.a.awr;
    const go = lane > 3.2 ? clamp(0.12 + (spd - 55) / 110 + (awr - 60) / 300, 0.06, 0.55) : lane > 2 ? 0.04 : 0.01;
    if (chance(g, go)) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble', '', qb); return; }
    // The checkdown: whoever is most open, counting the sticks on a money down.
    let dump = null, ds = -99;
    for (const k of lp.reads) {
      const r = lp.off[k];
      if (r?.open == null) continue;
      const v = r.open + (must ? sticksBonus(r.lead.x) : 0);
      if (v > ds) { ds = v; dump = r; }
    }
    if (dump && elapsed > 1.7 && dump.open > 1.3 && (!must || ds > 0.5 || elapsed > 2.6)) { throwTo(lp, dump); return; }
    // Nothing there and the play is breaking down: an aware passer throws it away rather than
    // forcing it or taking the sack.
    if (elapsed > 2.6 && chance(g, clamp(0.08 + (awr - 60) * 0.004, 0.05, 0.2))) { throwAway(lp); return; }
  }
}

// The room a scrambling quarterback would have: how far the nearest unblocked defender is from
// the spot four yards ahead of him (straight up or angled either way, the best of them).
function runLane(lp, qb) {
  let best = 0;
  for (const a of [-0.6, 0, 0.6]) {
    const px = qb.x + Math.cos(a) * 4, py = qb.y + Math.sin(a) * 4;
    if (Math.abs(py) > SIDE - 2) continue;
    let near = 99;
    for (const q of lp.players) if (q.side === 'def' && !q.eng && !(q.stun > 0.3)) near = Math.min(near, Math.hypot(q.x - px, q.y - py) - q.r);
    best = Math.max(best, near);
  }
  return best;
}

export function routeWant(lp, p) {
  if (lp.thrown && lp.thrown.target === p) {
    // Go to where the ball comes down (not into the bench) and get there as it does: run on
    // only as fast as the flight needs and brake in time to stop under it, not through it.
    const F = lp.thrown, spot = { x: F.tx, y: clamp(F.ty, -SIDE - 0.5, SIDE + 0.5) };
    const dx = spot.x - p.x, dy = spot.y - p.y, d = len(dx, dy);
    if (d < 0.15) { p.want = { vx: 0, vy: 0 }; return; }
    const left = Math.max(0.05, F.t0 + F.T - lp.t);
    const stop = Math.sqrt(2 * p.accel * (p.cut ?? 2) * 0.8 * d);
    const sp = Math.min(p.top, stop, Math.max(d / left * 1.1, Math.min(p.top, 2.5)));
    p.want = { vx: (dx / d) * sp, vy: (dy / d) * sp };
    return;
  }
  if (p.jam > 0) p.jam -= DT;
  const r = p.route;
  const live = !!lp.players;   // (futureRoute runs this on a bare copy to lead the receiver)
  // The quarterback is out of the pocket and still looking to throw: the scramble drill.
  if (live && scrambleDrill(lp, p) && !(r?.[p.wp]?.block != null)) return scrambleWant(lp, p);
  if (!r || p.wp >= r.length) {
    // The route is run. A curl, a hitch or a stick (a bar on the play art) sits down and works a
    // step or two into the open. Anything with an arrow keeps going the way the arrow points
    // (a slant keeps slanting, a drag keeps crossing, a go keeps going), turning upfield along
    // the sideline when it gets there, and only late in a play that never found him does he
    // settle into a hole in the coverage.
    const stop = !r || r[r.length - 1]?.stop;
    if (!stop) {
      if (live) p.doneAt ??= lp.t;
      if (p.x < lp.goalX + 7.5 && (!live || lp.t - p.doneAt < 2)) return arrowWant(lp, p, r);
    }
    if (!live) { p.want = { vx: 0, vy: 0 }; return; }
    return seekSpace(lp, p, p.settle ??= { x: Math.min(p.x + (stop ? 0 : 1.5), lp.goalX + 5), y: p.y }, stop ? 1.6 : 3.2, stop ? 0.5 : 0.75);
  }
  const w = r[p.wp];
  if (w.block != null) {
    if (lp.t > w.block) {
      // Done checking for the blitz: release into the route, the same shape as drawn, from
      // wherever the block left him.
      const o = r[p.wp + 1], base = r.from;
      if (o && o.x != null && base) {
        const ox = p.x - base.x, oy = p.y - base.y;
        for (let i = p.wp + 1; i < r.length; i++) if (r[i].x != null) r[i] = { ...r[i], x: r[i].x + ox, y: clamp(r[i].y + oy, -SIDE + 1.5, SIDE - 1.5) };
      }
      p.wp++; p.legFrom = { x: p.x, y: p.y }; return routeWant(lp, p);
    }
    return passBlockWant(lp, p);
  }
  // Run the leg as drawn: the leg runs from the last break (or where he started) to this one.
  // He chases a point a little ahead of himself on that line, so a step off it (a release around
  // a press corner, a defender's shoulder) is worked back onto the line instead of becoming a
  // new diagonal to the break; and he counts the break as made once he is level with it, so he
  // never circles back to touch a spot he ran past.
  const prev = r[p.wp - 1];
  const a = prev && prev.x != null ? prev : p.legFrom ?? r.from ?? w;
  const lx = w.x - a.x, ly = w.y - a.y, L = len(lx, ly);
  const d = dist(p, w);
  const u = L > 0.01 ? ((p.x - a.x) * lx + (p.y - a.y) * ly) / (L * L) : 1;
  if (d < 0.6 || u >= 1) { p.wp++; p.legFrom = { x: w.x, y: w.y }; return routeWant(lp, p); }
  const sp = len(p.vx, p.vy);
  const ahead = clamp(u, 0, 1) * L + 1.1 + sp * 0.12;
  const t = Math.min(ahead, L);
  const aim = L > 0.01 ? { x: a.x + (lx / L) * t, y: a.y + (ly / L) * t } : w;
  // Into a break: sink the hips. He gets down to the speed he can carry through the cut by the
  // time he reaches it, so he plants at the spot the play shows rather than rounding it off
  // a few yards past.
  let frac = 0.97;
  const next = r[p.wp + 1];
  if (w.stop) frac = Math.min(frac, Math.sqrt(2 * p.accel * (p.cut ?? 2) * 0.7 * d) / p.top);
  else if (next && next.x != null && L > 0.01) {
    const nx = next.x - w.x, ny = next.y - w.y, nl = len(nx, ny) || 1;
    const turn = Math.acos(clamp((lx * nx + ly * ny) / (L * nl), -1, 1));
    if (turn > 0.35) {
      const vCut = p.top * clamp(1.05 - turn / 2.1, 0.3, 1);
      frac = Math.min(frac, Math.sqrt(vCut * vCut + 2 * p.accel * (p.cut ?? 2) * 0.6 * d) / p.top);
    }
  }
  seek(p, aim, Math.max(frac, 0.25), 0.01);
}

// Past the end of an arrow route: the play art carries on along the last leg, then up the
// sideline when that leg runs out of field. He chases a point a little ahead of himself on
// that line, the same way he runs a leg, so a corner on his hip cannot walk him off it. He
// never runs out of bounds or out the back of the end zone.
function arrowWant(lp, p, r) {
  const pts = p.arrow ??= arrowArt(p, r);
  const aim = pointAhead(pts, p.x, p.y, 1.1 + len(p.vx, p.vy) * 0.12);
  if (aim.x > lp.goalX + 7.5) aim.x = lp.goalX + 7.5;
  seek(p, aim, 0.9, 0.01);
}

// The arrow as the play art draws it on: from the last break, along that leg, turning upfield
// at the sideline instead of running out of bounds.
function arrowArt(p, r) {
  const b = r[r.length - 1], a0 = r[r.length - 2];
  const a = a0 && a0.x != null ? a0 : p.legFrom && (p.legFrom.x !== b.x || p.legFrom.y !== b.y) ? p.legFrom : r.from ?? { x: p.x, y: p.y };
  let dx = b.x - a.x, dy = b.y - a.y;
  const l = len(dx, dy) || 1;
  dx /= l; dy /= l;
  const sideIn = SIDE - 2.5;
  let k = 25;
  if (dy && Math.abs(b.y + dy * k) > sideIn) k = Math.max(0, (sideIn * Math.sign(dy) - b.y) / dy);
  const e = { x: b.x + dx * k, y: clamp(b.y + dy * k, -sideIn, sideIn) };
  const pts = [b, e];
  if (k < 25) pts.push({ x: e.x + 30, y: e.y });
  return pts;
}

// A point `ahead` yards further along a polyline than the closest point to (x, y).
function pointAhead(pts, x, y, ahead) {
  let best = 99, bi = 1, bu = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const d = Math.hypot(a.x + dx * u - x, a.y + dy * u - y);
    if (d < best) { best = d; bi = i; bu = u; }
  }
  let i = bi, a = pts[i - 1], b = pts[i];
  let dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, u = bu, left = ahead;
  let rem = (1 - u) * L;
  while (left > rem && i < pts.length - 1) {
    left -= rem; i++;
    a = pts[i - 1]; b = pts[i];
    dx = b.x - a.x; dy = b.y - a.y; L = Math.hypot(dx, dy) || 1; u = 0; rem = L;
  }
  const t = u * L + Math.min(left, rem);
  return { x: a.x + (dx / L) * t, y: a.y + (dy / L) * t };
}

// Is the quarterback scrambling with the ball, still a passer (rolled out of the pocket, or
// pushed deep), with nobody thrown to yet?
export function scrambling(lp) {
  const qb = lp.off.QB;
  if (!qb || lp.kind !== 'pass' || lp.thrown || lp.windup || lp.carrierSet || lp.ball.holder !== qb || lp.t < 1.2 || lp.play.boot) return false;
  // Out of the pocket: outside the tackle box, or chased far behind his drop (a full dropback,
  // even a deep one, is still the pocket).
  return Math.abs(qb.y) > 5.5 || qb.x < lp.dropX - 8;
}

// Does this receiver break off into the scramble drill? A quarterback sliding in the pocket,
// dropping back or stepping a yard or two wide doesn't break the play: the routes run as called
// until he has clearly been on the move outside it for a second. A man who has finished his
// route reacts sooner.
export function scrambleDrill(lp, p) {
  if (lp.scrambleChk !== lp.t) {
    lp.scrambleChk = lp.t;
    // (Once the drill is on, it stays on through the throwing motion: nobody snaps back to the
    // old route while the arm comes forward.)
    if (!scrambling(lp) && !(lp.windup && lp.scrambleFrom != null)) lp.scrambleFrom = null;
    else lp.scrambleFrom ??= lp.t;
  }
  if (lp.scrambleFrom == null) return false;
  return lp.t - lp.scrambleFrom > (!p.route || p.wp >= p.route.length ? 0.3 : 1);
}

// The scramble drill, the way receivers are coached it: deep men keep going deep and drift
// toward the side the quarterback is rolling to, the short and intermediate men come back
// toward the line on his side, each finding a window between defenders he can see.
function scrambleWant(lp, p) {
  const qb = lp.off.QB, side = sgn(qb.y || 1);
  if (p.x > 14) {
    const ty = clamp(p.y + side * 6, -SIDE + 3, SIDE - 3);
    return seekSpace(lp, p, { x: Math.min(p.x + 5, lp.goalX + 4), y: ty }, 3, 0.95);
  }
  const ty = clamp(qb.y + side * 4 + (p.y - qb.y) * 0.35, -SIDE + 2.5, SIDE - 2.5);
  return seekSpace(lp, p, { x: clamp(p.x - 1.5, 3, lp.goalX + 2), y: ty }, 3.5, 0.9);
}

// Work into the open near a spot: of the points around it, the one farthest from any defender
// (and in the quarterback's view, not behind someone), chosen a few times a second so he
// settles rather than twitches.
function seekSpace(lp, p, base, R, frac) {
  if (!p.space || lp.t - p.space.t > 0.3) {
    let best = null;
    for (let k = -1; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr = k < 0 ? 0 : R;
      const c = { x: base.x + Math.cos(a) * rr, y: clamp(base.y + Math.sin(a) * rr, -SIDE + 1.5, SIDE - 1.5) };
      if (c.x < 1) continue;
      let room = 99;
      for (const q of lp.players) if (q.side === 'def') room = Math.min(room, Math.hypot(q.x - c.x, q.y - c.y));
      const score = Math.min(room, 7) - Math.hypot(c.x - base.x, c.y - base.y) * 0.25 - Math.hypot(c.x - p.x, c.y - p.y) * 0.08;
      if (!best || score > best.score) best = { ...c, score };
    }
    p.space = { t: lp.t, x: best?.x ?? base.x, y: best?.y ?? base.y };
  }
  seek(p, p.space, frac, 1.2);
  // Settled in the hole: face the quarterback (see faceWant), ready for the ball.
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
    const fut = futureRoute(r, T, lp.goalX);
    px = fut.x; py = fut.y;
    T = Math.hypot(px - rp.x, py - rp.y) / v;
  }
  let near = 99, rusher = null;
  for (const q of lp.players) if (q.side === 'def' && !q.eng && dist(q, qb) < near) { near = dist(q, qb); rusher = q; }
  const pressured = near < 2.4;
  const D = lp.def;
  const tAcc = traitMod('throwAccuracy', { qb, def: Object.values(D) });
  traitNotes(lp, tAcc, { qb }, qb);
  const acc = qb.a.acc + tAcc.v - (lp.g.weather === 'rain' ? 4 : 0);
  const air = Math.hypot(px - rp.x, py - rp.y);
  const tPr = pressured ? traitMod('pressure', { qb, rusher }) : null;
  if (tPr) traitNotes(lp, tPr, { qb, rusher }, qb);
  // Accuracy falls off faster past 15 yards: the deep ball is a lower-percentage throw.
  let sd = (0.25 + air * 0.042 + Math.max(0, air - 15) * 0.035) * (1.9 - acc / 90) * (pressured ? 1 + 0.5 * tPr.v : 1) * K.sd;
  // A bullet thrown a long way sprays more; a lob thrown short is hard to drop in.
  if (kind === 'bullet' && air > 18) sd *= 1.15;
  if (kind === 'lob' && air < 10) sd *= 1.2;
  const moving = len(qb.vx, qb.vy) > 2;
  if (moving && (isManual(lp, qb) || lp.play.boot)) sd *= lp.play.boot ? 1.12 : 1.25; // throwing on the run
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
  // The miss. Near a sideline or the end line a passer keeps the ball on the field side of his
  // man (only he can get it, or nobody), so a miss that would sail out is mostly pulled back in:
  // a wild one still can, but the ball no longer goes out wherever the receiver would be if
  // the field kept going.
  let ex = randn(g) * sd * 1.2, ey = randn(g) * sd;
  const out = (x, y) => Math.abs(y) > SIDE - 0.4 || x > lp.goalX + 9.6;
  if (out(px + ex, py + ey)) { ex = randn(g) * sd * 1.2; ey = randn(g) * sd; }
  if (out(px + ex, py + ey) && chance(g, 0.6)) { ey = Math.abs(py + ey) > SIDE - 0.4 ? -sgn(py) * Math.abs(ey) * 0.5 : ey; ex = px + ex > lp.goalX + 9.6 ? -Math.abs(ex) * 0.5 : ex; }
  px += ex; py += ey;
  py = clamp(py, -SIDE - 2, SIDE + 2);
  // Touch: deep balls are lofted, short ones are drilled.
  const loft = kind !== 'touch' ? 1 : air > 18 ? 0.86 : air > 10 ? 0.94 : 1;
  launch(lp, { target: r, sx: rp.x, sy: rp.y, z0: rp.z, tx: px, ty: py, zc, v: v * loft, pressured, air: px, kind, catchMod: K.catch, placed: !!place });
  // The user takes over the receiver while the ball is in the air (and can attack it).
  for (const pad of [lp, lp.p2]) if (pad && pad.user === lp.o && pad.control === qb && !lp.autoQB) { pad.control = r; pad.manual = false; pad.handoverLock = true; }
  lp.stats.target = r;
  lp.stats.cov = nearestDef(lp, r);
  // A defender hanging on a receiver downfield the ball is not going to: defensive holding.
  if (lp.flags) for (const q of lp.players) {
    const m = q.man;
    if (q.side !== 'def' || !m || m === r || m.x < 5 || dist(q, m) > 1.3) continue;
    if (chance(g, RATES.holdCoverLive * sloppy(q.a.awr)) && liveFoul(lp, 'hold_def', q, m)) { event(lp, 'flag', '', q, m); break; }
  }
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

function futureRoute(r, T, goalX = 999) {
  // Run a copy of the receiver along his route for T seconds.
  const c = { x: r.x, y: r.y, vx: r.vx, vy: r.vy, fx: r.fx, fy: r.fy, top: r.top, accel: r.accel, cut: r.cut, grip: r.grip, route: r.route, wp: r.wp, legFrom: r.legFrom, role: 'route' };
  const stub = { thrown: null, t: 9, goalX };
  for (let t = 0; t < T; t += DT) {
    const w = c.route?.[c.wp];
    if (w && w.block != null) { c.wp++; continue; }
    routeWant(stub, c);
    const want = c.want ?? { vx: 0, vy: 0 };
    kin(c, want.vx, want.vy, c.top, DT);
    // He bends along the sideline rather than over it (as move() has him do).
    if (Math.abs(c.y) > SIDE - 1.5 && c.vy * c.y > 0) c.vy *= clamp((SIDE + 0.5 - Math.abs(c.y)) / 2, 0, 1);
  }
  return { x: Math.min(c.x, goalX + 9), y: clamp(c.y, -SIDE + 1, SIDE - 1) };
}

function nearestDef(lp, r) {
  let best = null, bd = 99;
  for (const q of lp.players) if (q.side === 'def') { const d = dist(q, r); if (d < bd) { bd = d; best = q; } }
  return best;
}

export function snapFlight(lp) {
  const b = lp.ball;
  if (b.state !== 'snap') return;
  const qb = lp.snapTo ?? lp.off.QB;
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
  b.state = 'loose'; b.holder = null; b.looseT = lp.t;
  b.vx = ux * v * keep + (pop ? (rand(lp.g) - 0.5) * 3 : 0);
  b.vy = uy * v * keep + (pop ? (rand(lp.g) - 0.5) * 3 : 0);
  b.vz = pop ? pop : vzArr * 0.5;
}

export function looseBall(lp) {
  const b = lp.ball;
  if (b.state !== 'loose') return;
  // It already moved this step on its flight; it starts falling on the next one.
  if (b.looseT === lp.t) return;
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
// Going up for the ball. Each player's jump has its own height (agility and speed, a little
// more for Flying types) and lasts long enough that he peaks about when it comes down.
export function jumpHeight(p) { return clamp(0.35 + (p.a.agi ?? 60) / 320 + (p.a.spd ?? 60) / 600 + (PLAYERS[p.id]?.types?.includes('Flying') ? 0.15 : 0), 0.4, 1.1); }
export function jumpTime(p) { return 0.42 + jumpHeight(p) * 0.25; }
export function jumpZ(p) { if (p.jump == null) return 0; const u = clamp(p.jump / p.jumpT, 0, 1); return 4 * u * (1 - u) * p.jumpH; }
export function startJump(lp, p) {
  if (p.jump != null || p.eng || p.stun > 0 || (lp.tackle && (lp.tackle.c === p || lp.tackle.q === p))) return false;
  p.jump = 0; p.jumpH = jumpHeight(p); p.jumpT = jumpTime(p);
  event(lp, 'jump', '', p);
  return true;
}
// Is he in the air at the moment the ball gets there (the middle of the jump, near its top)?
const upNow = (p) => p.jump != null && p.jump / p.jumpT > 0.2 && p.jump / p.jumpT < 0.85;

// While the ball is in the air: the target goes up for a high ball or one with a defender on
// him, and the closest defender goes up to knock it away, each timed to peak as it arrives.
export function airJumps(lp) {
  const F = lp.thrown;
  if (!F || F.away || !F.target || lp.ball.state !== 'air') return;
  const left = F.t0 + F.T - lp.t, spot = { x: F.tx, y: F.ty }, r = F.target;
  const userR = isManual(lp, r);
  let dfd = null, dd = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) { const d = dist(q, spot); if (d < dd) { dd = d; dfd = q; } }
  if (!userR && F.rJump == null && left <= jumpTime(r) * 0.5 && dist(r, spot) < 2) {
    const high = F.zc > catchHeight(r) + 0.25;
    F.rJump = (high || (dfd && dd < 1.8)) && chance(lp.g, high ? 0.9 : clamp(0.45 + ((r.a.hndC ?? 60) - 60) * 0.006, 0.3, 0.8));
    if (F.rJump) startJump(lp, r);
  }
  const userD = !!dfd && isManual(lp, dfd);
  if (dfd && !userD && F.dJump == null && left <= jumpTime(dfd) * 0.5 && dd < 2) {
    F.dJump = chance(lp.g, clamp(0.5 + ((dfd.a.cov ?? 60) - 60) * 0.008, 0.3, 0.85));
    if (F.dJump) startJump(lp, dfd);
  }
}

function arrival(lp) {
  const g = lp.g, T = lp.thrown;
  const spot = { x: T.tx, y: T.ty };
  const r = T.target;
  const dr = dist(r, spot);
  // Up in the air at the catch point, a player gets his hands on balls a little farther away.
  // Glare (harsh sun) costs anyone the weather does not spare a little reach. Difficulty widens
  // (Rookie) or tightens (Legend) the user's receivers' reach.
  const reachOf = (p) => 1.45 + traitMod('catchReach', { p }).v + (upNow(p) ? 0.3 : 0) + (p.wx?.glare ?? 0) + (p.side === 'off' && lp.user === lp.o ? lp.userReach ?? 0 : 0);
  let dfd = null, dd = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) { const d = dist(q, spot); if (d < dd) { dd = d; dfd = q; } }
  lp.sepAtArrival = dd; lp.drAtArrival = dr;
  const pad = lp.user === lp.d ? lp : lp.p2?.user === lp.d ? lp.p2 : null;
  const userDef = pad?.control && pad.control.side === 'def' ? pad.control : null;
  const userPlay = userDef && dist(userDef, spot) < 1.8 && (userDef.dive != null || upNow(userDef));
  lp.stats.cov = dfd && dd < 3 ? dfd : lp.stats.cov;
  const inBounds = Math.abs(spot.y) < SIDE && spot.x < lp.goalX + 10;
  const rReach = reachOf(r);
  if (dr <= rReach && dr > 1.45) traitNotes(lp, traitMod('catchReach', { p: r }), { p: r }, r, true);
  if (r.wx?.glare && dr > rReach && dr <= rReach - r.wx.glare) note(lp, 'weather', `${nm(r.id)} loses the ball in the sun`, r);
  // Defender plays the ball first if he is closer.
  const dUp = dfd && upNow(dfd), rUp = upNow(r);
  if (dfd && dd < (dUp ? 1.75 : 1.5) && (dd < dr + (dUp ? 0.5 : 0.25) || dr > rReach - 0.05)) {
    const tInt = traitMod('intChance', { d: dfd, r, qb: lp.off.QB });
    const hawk = tInt.v;
    traitNotes(lp, tInt, { d: dfd, r, qb: lp.off.QB }, dfd);
    const R = rep(dfd.id, dfd.a.cov, r.id, r.a.hndC);
    const pI = (diff) => clamp(0.11 + hawk + diff * 0.006 + (T.pressured ? 0.04 : 0) + (dr > rReach ? 0.12 : 0) - dd * 0.05, 0.03, 0.42)
      * (lp.offCall === 'screen' ? 0.4 : 1) + (userPlay && dfd === userDef ? 0.18 : 0);
    if (inBounds && contest(lp, pI(R.diff), pI(R.base), R, dfd, r, 'for the interception')) { interception(lp, dfd, spot); return; }
    const pB = (diff) => clamp(0.3 + diff * 0.01 - dd * 0.15 + (userPlay ? 0.25 : 0) + (dUp ? 0.1 : 0) - (rUp ? 0.08 : 0), 0.15, 0.9);
    if (dr > rReach || contest(lp, pB(R.diff), pB(R.base), R, dfd, r, 'at the catch point')) {
      interference(lp, dfd, r, dd, dr, spot);
      st(g, lp.d, dfd.id).pd++;
      dropBall(lp, 0.12, 3.2);
      event(lp, 'deflect', '', dfd, r);
      incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is broken up by ${nm(dfd.id)}.`, dfd);
      return;
    }
  }
  if (dr > rReach || !inBounds) {
    dropBall(lp, 0.45);
    // Out of bounds is its own result: the ball sails past the sideline or the end line, and
    // the receiver can't bring it in there however close he got.
    const why = !inBounds ? (Math.abs(spot.y) >= SIDE ? ' sails out of bounds' : ' sails out the back of the end zone') : dr > rReach ? ' falls incomplete, just out of reach' : ' falls incomplete';
    if (!inBounds) event(lp, 'oob', '', r, null);
    incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)}${why}.`);
    return;
  }
  const contested = dfd && dd < 1.8;
  const hands = contested ? r.a.hndC : r.a.hnd;
  const thrown = Math.hypot(T.tx - T.sx, T.ty - T.sy);
  // Attacking the ball at its high point (Space while it is in the air to your receiver):
  // better in traffic, and he stops to make the catch.
  const aggro = (!!lp.aggro && lp.control === r) || (!!lp.p2?.aggro && lp.p2.control === r);
  // Going up for it high-points the ball over a defender; a defender in the air with him makes it harder.
  const air = (rUp && contested ? 0.06 : 0) - (dUp && contested ? 0.06 : 0);
  const base = 0.89 + (hands - 70) * 0.004 - Math.max(0, dr - 0.5) * 0.12 - Math.max(0, thrown - 18) * 0.014 + (T.catchMod ?? 0) + (aggro ? (contested ? 0.1 : -0.02) : 0) + air;
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
    // Shoving off to make a contested catch: offensive pass interference.
    if (contested && lp.flags && chance(g, RATES.opi * 4 * sloppy(r.a.awr)) && liveFoul(lp, 'opi', r)) event(lp, 'flag', '', r, dfd);
    r.caughtAt = lp.t;
    lp.caught = true;
    lp.catchX = r.x;
    lp.catchAt = { x: lp.ball.x, y: lp.ball.y };
    setCarrier(lp, r);
    event(lp, 'catch', `${nm(r.id)} makes the catch`, r, lp.off.QB);
    return;
  }
  if (contested) { st(g, lp.d, dfd.id).pd++; interference(lp, dfd, r, dd, dr, spot); }
  dropBall(lp, 0.2, 1.5);
  incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is dropped${contested ? ` with ${nm(dfd.id)} draped on him` : ''}.`);
}

// A defender who gets there late and through the receiver, not to the ball: pass interference,
// spotted where the ball came down. Likelier for a careless defender and the later he is.
function interference(lp, d, r, dd, dr, spot) {
  if (!lp.flags || !d || dd > 1.6 || dd < dr - 0.2) return;
  if (chance(lp.g, RATES.dpiLive * sloppy(d.a.awr) * (1 + Math.max(0, dd - dr))) && liveFoul(lp, 'dpi', d, spot)) event(lp, 'flag', '', d, r);
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
