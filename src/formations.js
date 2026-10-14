// Formations: where all 22 Pokémon line up before the snap, in football coordinates.
//
// Coordinates are the live play's frame, in yards from the ball: x downfield (the offense
// lines up at x < 0, the defense at x > 0), y across the field (the sidelines at ±26.65). Each
// formation names an intentional spot for every position; the spot is then spaced by the
// Pokémon actually standing there, using its drawn footprint from body.js (how far its model
// reaches to the side, in front and behind), so a Snorlax at left guard pushes the tackle out
// instead of standing inside him, and a small receiver is not hidden behind a big one.
//
// The offense always sets seven on the line (five linemen and two of the tight end and
// receivers); the defense sets its front across the neutral zone, which is the length of the
// ball plus a little air, so the two lines face each other across a visible gap.
import { bodyOf } from './body.js';

export const SIDE = 26.65;
// The lines set a little off the ball on both sides, so from behind the quarterback the two
// fronts read as two rows with turf between them, not one pile (a real neutral zone is the
// ball's length, but real linemen are not drawn from a camera above and behind them).
export const NEUTRAL = 0.45;    // the offense's front edge behind the ball
export const STANDOFF = 0.55;   // the defense's front edge beyond the far end of the ball
const SPLIT = 0.5;              // air between linemen's bodies (about a two-foot split)
const AIR = 0.3;                // the least air between any two bodies before the snap

// Line spots have a set width: a lineman whose drawn body is wider than his spot (wings,
// a wide shell, a long tail across) is drawn smaller there, down to LINE_MIN_FIT of his size,
// so the five offensive linemen and the front four read as separate bodies. Everyone else
// keeps his full size. Scaling is uniform, so proportions never change.
export const LINE_SLOTS = new Set(['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DE', 'DT1', 'DT2']);
const LINE_HALF = 0.8, LINE_DEPTH = 1.0, LINE_MIN_FIT = 0.7;
export function slotFit(id, slot) {
  // The tight end sets on the line or next to it too, with a little more room.
  const wide = slot === 'TE' ? 1.15 : LINE_SLOTS.has(slot) ? 1 : 0;
  if (!wide) return 1;
  const f = bodyOf(id).foot;
  const k = Math.min(1, (LINE_HALF * wide) / f.side, (LINE_DEPTH * wide) / Math.max(f.front, f.back));
  return Math.max(LINE_MIN_FIT, k);
}

// ---------- offense ----------
// wr: [y, on the line] per receiver, y as if the ball were in the middle of the field.
// te: 'inline' (attached to the right tackle), { flex: y } (a yard off the line), or 'fb'
// (a fullback in the I). rb: { beside: ±1 } next to a shotgun quarterback, or { depth }.
// qb: depth behind the center, or 0 for under center. Every formation has seven on the line.
export const OFF_FORMATIONS = {
  gun_spread: { name: 'Shotgun Spread', short: 'Gun Spread', qb: 5, rb: { beside: 1 }, te: 'inline', wr: { WR1: [-19, true], WR3: [-10, false], WR2: [18.5, false] } },
  gun_trips: { name: 'Shotgun Trips', short: 'Gun Trips', qb: 5, rb: { beside: -1 }, te: { flex: 7.5 }, wr: { WR1: [-19, true], WR3: [13, false], WR2: [19, true] } },
  singleback: { name: 'Singleback', short: 'Singleback', qb: 0, rb: { depth: 7 }, te: 'inline', wr: { WR1: [-18, true], WR3: [-10, false], WR2: [18, false] } },
  iform: { name: 'I-Form', short: 'I-Form', qb: 0, rb: { depth: 7.5 }, te: 'fb', wr: { WR1: [-17.5, true], WR3: [-10.5, false], WR2: [17.5, true] } },
  pistol: { name: 'Pistol', short: 'Pistol', qb: 4, rb: { depth: 7.5 }, te: 'inline', wr: { WR1: [-18.5, true], WR3: [-10, false], WR2: [18, false] } },
};
// The formation each play comes out of by default, and the ones it can be run from (a sneak
// needs the quarterback under center).
export const PLAY_FORMATION = {
  inside_run: 'iform', outside_run: 'singleback', qb_sneak: 'singleback', draw: 'gun_spread',
  screen: 'gun_spread', slant: 'gun_spread', out: 'gun_trips', curl: 'gun_spread', te_seam: 'pistol', post: 'gun_trips', pa_deep: 'singleback',
};
export function formationsFor(call) {
  if (!PLAY_FORMATION[call]) return [];
  if (call === 'qb_sneak') return ['singleback', 'iform'];
  return Object.keys(OFF_FORMATIONS);
}
export const isGun = (form) => (OFF_FORMATIONS[form]?.qb ?? 0) > 0;

// ---------- defense ----------
//   43:     four down linemen, three linebackers (the third corner plays the weak-side
//           linebacker), two corners over the outside receivers, two safeties deep
//   nickel: four down, two linebackers, the third corner over the slot, two safeties
//   goal:   everyone walked up: linebackers at two yards, corners pressed, safeties shallow
export const DEF_FORMATIONS = {
  43: { name: '4-3 Base', short: '4-3' },
  nickel: { name: 'Nickel 4-2-5', short: 'Nickel' },
  goal: { name: 'Goal Line', short: 'Goal line' },
};
export const CALL_FRONT = { base: '43', run_blitz: '43', cover3: '43', pass_blitz: 'nickel', cover2: 'nickel', man_press: 'nickel', prevent: 'nickel', goal_line: 'goal' };
// Position names the formation gives each roster slot (shown in the tactical camera).
export function positionName(lp, p) {
  if (p.side === 'off') return p.slot === 'TE' && lp.formation === 'iform' ? 'FB' : p.slot.replace(/\d$/, '');
  const f = lp.defFormation;
  const n = { LE: 'DE', DE: 'DE', DT1: 'DT', DT2: 'DT', OLB: f === 'nickel' ? 'LB' : 'SAM', MLB: f === 'nickel' ? 'LB' : 'MIKE', CB1: 'CB', CB2: 'CB', CB3: f === '43' ? 'WILL' : f === 'goal' ? 'LB' : 'NB', FS: 'FS', SS: 'SS' };
  return n[p.slot] ?? p.slot;
}

// ---------- footprints ----------
// The drawn body's box on the turf, facing downfield for the offense and back up it for the
// defense: x from -back to +front along the facing, y ±side.
export function foot(p) {
  const f = bodyOf(p.id).foot, k = p.fit ?? 1;
  return k === 1 ? f : { side: f.side * k, front: f.front * k, back: f.back * k };
}
export function box(p, x = p.x, y = p.y) {
  const f = foot(p), off = p.side === 'off';
  return { x0: x - (off ? f.back : f.front), x1: x + (off ? f.front : f.back), y0: y - f.side, y1: y + f.side };
}
// How far two drawn bodies overlap (0 when they are apart), with `air` required between them.
export function overlap(a, b, air = 0) {
  const A = box(a), B = box(b);
  const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + air, oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + air;
  return ox > 0 && oy > 0 ? Math.min(ox, oy) : 0;
}
// The quarterback under center has his hands on the center: that pair stands as close as
// their capsules allow.
const exchangePair = (a, b) => a.side === 'off' && b.side === 'off' && ((a.slot === 'C' && b.slot === 'QB') || (a.slot === 'QB' && b.slot === 'C'));

// Set lines: the offense's front edge at the neutral zone, the defense's beyond it.
export const lineX = (p) => -(foot(p).front + NEUTRAL);
export const frontX = (p) => foot(p).front + NEUTRAL + STANDOFF;

// ---------- alignment ----------
export function alignFormation(lp) {
  for (const p of lp.players) p.fit = slotFit(p.id, p.slot);
  alignOffense(lp);
  alignDefense(lp);
}

function alignOffense(lp) {
  const O = lp.off, F = OFF_FORMATIONS[lp.formation] ?? OFF_FORMATIONS.gun_spread;
  const side = (p) => foot(p).side;
  // The five linemen from the center out, each split by both bodies plus a little air.
  const C = O.C;
  if (C) { C.x = lineX(C); C.y = 0; }
  let yL = C ? -side(C) : 0, yR = C ? side(C) : 0;
  for (const [l, r] of [['LG', 'RG'], ['LT', 'RT']]) {
    if (O[l]) { O[l].y = yL - SPLIT - side(O[l]); O[l].x = lineX(O[l]); yL = O[l].y - side(O[l]); }
    if (O[r]) { O[r].y = yR + SPLIT + side(O[r]); O[r].x = lineX(O[r]); yR = O[r].y + side(O[r]); }
  }
  // Quarterback: under center, or back in the gun.
  const qb = O.QB;
  if (qb) {
    if (F.qb > 0) { qb.x = -F.qb; qb.y = 0; }
    else { qb.x = (C ? C.x - C.r : -0.8) - qb.r - 0.12; qb.y = 0; }
  }
  // Tight end.
  const te = O.TE;
  if (te) {
    if (F.te === 'inline') { te.x = lineX(te); te.y = yR + SPLIT + 0.2 + side(te); yR = te.y + side(te); }
    else if (F.te === 'fb') { te.x = (qb ? qb.x - foot(qb).back : -1.5) - foot(te).front - 1.4; te.y = 0; }
    else { te.x = lineX(te) - 1.1; te.y = Math.max(F.te.flex, yR + 1.2 + side(te)); }
  }
  // Running back.
  const rb = O.RB;
  if (rb && qb) {
    if (F.rb.beside) { rb.x = qb.x; rb.y = qb.y + F.rb.beside * (side(qb) + side(rb) + 0.9); }
    else {
      const ahead = te && F.te === 'fb' ? te : qb;
      rb.x = Math.min(-F.rb.depth, ahead.x - foot(ahead).back - foot(rb).front - 1.2); rb.y = 0;
    }
  }
  // Receivers: spots from the formation, kept outside the box and inside the field.
  for (const [k, [y, onLine]] of Object.entries(F.wr)) {
    const w = O[k];
    if (!w) continue;
    w.x = onLine ? lineX(w) : lineX(w) - 1.1;
    const s = Math.sign(y), lim = SIDE - side(w) - 1.6;
    const box = s < 0 ? yL : yR;
    w.y = s * Math.min(lim, Math.max(Math.abs(y), Math.abs(box) + 2.5 + side(w)));
  }
  // Receivers on the same side: the inner one keeps clear of the outer one.
  const wrs = ['WR1', 'WR2', 'WR3', 'TE'].map((k) => O[k]).filter((w) => w && Math.abs(w.y) > 6);
  for (const s of [-1, 1]) {
    const on = wrs.filter((w) => Math.sign(w.y) === s).sort((a, b) => Math.abs(b.y) - Math.abs(a.y));
    for (let i = 1; i < on.length; i++) {
      const min = side(on[i - 1]) + side(on[i]) + 3.5;
      if (Math.abs(on[i - 1].y) - Math.abs(on[i].y) < min) on[i].y = s * (Math.abs(on[i - 1].y) - min);
    }
  }
}

// Strength: the side with more receivers (the tight end counts double when attached).
function strength(lp) {
  const O = lp.off;
  let s = 0;
  for (const k of ['WR1', 'WR2', 'WR3', 'TE']) { const p = O[k]; if (p && Math.abs(p.y) > 1) s += Math.sign(p.y) * (k === 'TE' && Math.abs(p.y) < 7 ? 1.5 : 1); }
  return s >= 0 ? 1 : -1;
}

function alignDefense(lp) {
  const O = lp.off, D = lp.def, form = lp.defFormation;
  const s = strength(lp);
  const side = (p) => foot(p).side;
  const at = (p, x, y) => { if (p) { p.x = x; p.y = y; } };
  const front = (p, y) => at(p, p ? frontX(p) : 0, y);
  // Offensive landmarks on each side.
  const tackle = (sd) => (sd > 0 ? O.RT : O.LT), guard = (sd) => (sd > 0 ? O.RG : O.LG);
  const edgeY = (sd) => { const t = tackle(sd); return t ? t.y + sd * side(t) : sd * 4; };
  const teOn = O.TE && Math.abs(O.TE.x - lineX(O.TE)) < 0.3 && Math.sign(O.TE.y) === s ? O.TE : null;
  // Down linemen by technique: the strong-side tackle in a 3 (outside shade of the guard),
  // the weak-side tackle in a 1 (shading the center), the ends outside the tackles (a 7
  // inside the tight end when he is attached).
  const strongEnd = s > 0 ? D.LE : D.DE, weakEnd = s > 0 ? D.DE : D.LE;
  const g = guard(s), wg = guard(-s);
  front(D.DT1, g ? g.y + s * side(g) * 0.55 : s * 1.6);
  front(D.DT2, wg ? (wg.y + (O.C?.y ?? 0)) / 2 : -s * 0.8);
  front(strongEnd, teOn ? teOn.y - s * side(teOn) * 0.2 : edgeY(s) + s * 0.6);
  front(weakEnd, edgeY(-s) - s * 0.7);
  // Corners over the widest receiver on each side; the nickel over the slot.
  const rec = ['WR1', 'WR2', 'WR3', 'TE'].map((k) => O[k]).filter((w) => w && Math.abs(w.y) > 6);
  const press = form === 'goal';
  const over = (c, w, depth) => { if (!c || !w) return; at(c, press ? 1.6 : depth, w.y - Math.sign(w.y) * 0.8); };
  const wide = (sd) => rec.filter((w) => Math.sign(w.y) === sd).sort((a, b) => Math.abs(b.y) - Math.abs(a.y));
  // Man coverage pairs each corner with a receiver (see live.js), so they line up over him.
  over(D.CB1, O.WR1 ?? wide(-1)[0], 6.5);
  over(D.CB2, O.WR2 ?? wide(1)[0], 6.5);
  // Linebackers: over the box at four and a half yards (two in the goal line).
  const lbX = form === 'goal' ? 2.8 : 5;
  const sam = D.OLB, mike = D.MLB, will = D.CB3;
  if (form === 'nickel') {
    at(sam, lbX, s * 2.2);
    at(mike, lbX, -s * 2.2);
    if (will && O.WR3) at(will, 5, O.WR3.y - Math.sign(O.WR3.y) * 0.8);
    else if (will) at(will, 5, -s * 9);
  } else {
    at(sam, lbX, teOn ? teOn.y - s * 0.4 : edgeY(s) + s * 0.4);
    at(mike, lbX + (form === 'goal' ? 0.6 : 0.4), -s * 0.4);
    // The weak-side backer stacks at the apex between the box and the slot receiver on his side.
    const slot = O.WR3;
    const wy = slot ? (edgeY(Math.sign(slot.y)) + slot.y) / 2 : edgeY(-s) - s * 1.5;
    at(will, form === 'goal' ? lbX : lbX + 0.3, Math.abs(wy - (sam?.y ?? 99)) < 3 ? edgeY(-s) - s * 1.5 : wy);
  }
  // Safeties: two high, the free safety to the weak side a little deeper.
  const deep = form === 'goal' ? 0.45 : 1;
  at(D.FS, 12.5 * deep, -s * 7);
  at(D.SS, 10.5 * deep, s * 6.5);
}

// Nobody starts inside anybody else: every pair of drawn bodies keeps a little air between
// them. Teammates move apart across the field (the center stays over the ball, linemen keep
// their depth, backs in a stack move apart in depth); a defender too close to the offense
// backs off the ball. Returns how many passes it took.
export function resolveSpacing(lp, keepSet = new Set()) {
  const ps = lp.players;
  const lineman = (p) => ['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DE', 'DT1', 'DT2'].includes(p.slot);
  let it = 0;
  for (; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (exchangePair(a, b)) continue;
      const o = overlap(a, b, AIR);
      if (o <= 0) continue;
      moved = true;
      if (a.side !== b.side) {
        // Back the defender off the ball.
        const d = a.side === 'def' ? a : b;
        d.x += Math.min(o, 0.5) + 0.01;
        continue;
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const across = lineman(a) && lineman(b) || Math.abs(dy) * 1.2 >= Math.abs(dx) || Math.abs(dx) < 0.3;
      const push = Math.min(o, 0.6) / 2 + 0.01;
      if (across) {
        const sg = dy === 0 ? (a.y <= 0 ? -1 : 1) : Math.sign(dy);
        const fixA = (a.slot === 'C' && a.side === 'off') || keepSet.has(a), fixB = (b.slot === 'C' && b.side === 'off') || keepSet.has(b);
        const ka = fixA && !fixB ? 0 : fixB && !fixA ? 2 : 1;
        a.y -= sg * push * ka; b.y += sg * push * (2 - ka);
      } else {
        // Stacked in depth (backs, a deep safety over a backer): the deeper one moves back.
        const deeper = Math.abs(a.x) > Math.abs(b.x) ? a : b;
        deeper.x += Math.sign(deeper.x || (deeper.side === 'off' ? -1 : 1)) * push * 2;
      }
    }
    for (const p of ps) p.y = Math.max(-SIDE + foot(p).side + 0.4, Math.min(SIDE - foot(p).side - 0.4, p.y));
    if (!moved) break;
  }
  for (const p of ps) if (p.side === 'def') p.x = Math.max(p.x, frontX(p));
  return it;
}

// Pre-snap overlaps by drawn body, for the formation check.
export function overlapIssues(lp) {
  const out = [];
  const ps = lp.players;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (exchangePair(a, b)) { if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 1e-3) out.push(`${a.side} ${a.slot} overlaps ${b.side} ${b.slot}`); continue; }
    if (overlap(a, b) > 1e-3) out.push(`${a.side} ${a.slot} overlaps ${b.side} ${b.slot}`);
  }
  return out;
}
