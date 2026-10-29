// The live play's shared core: field constants, geometry, movement, blocking help, events and
// the end of the play. Everything under src/live/ and src/live.js builds on this module, and it
// imports none of them, so the live modules form a tree with no import cycles.
import { clamp, nm, st } from '../engine.js';
import { simFouls } from '../penalties.js';

// How a kick's result is read (src/live/kicks.js registers it), so this module needs no import
// back into the kicking game.
const results = { kick: null };
export function setKickResult(fn) { results.kick = fn; }

export const SIDE = 26.65;
export const DT = 1 / 60;
export const GRAVITY = 10.7;     // yards per second squared
export const RECEIVERS = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const len = (x, y) => Math.hypot(x, y);
export const sgn = (v) => (v < 0 ? -1 : 1);

// The line to gain, in yards past the line of scrimmage (the goal line when it is goal to go).
export const sticks = (lp) => clamp(lp.g.toGo ?? 10, 1, lp.goalX);

// Must this snap reach the sticks (third or fourth down with more than a yard to go)?
export const mustGain = (lp) => (lp.g.down ?? 1) >= 3 && sticks(lp) > 1;

// Where `who` is to a defender who reacts `delay` seconds late: his recorded state then,
// projected forward. The trail itself is kept on the player by the live loop.
export function perceive(lp, who, delay) {
  const h = who.hist;
  if (!h?.length || delay <= 0) return who;
  const want = lp.t - delay;
  let k = h.length - 1;
  while (k > 0 && h[k].t > want) k--;
  const s = h[k], e = Math.max(0, lp.t - s.t);
  return { x: s.x + s.vx * e, y: s.y + s.vy * e, vx: s.vx, vy: s.vy };
}

// Is this player steered by a person right now (player one, or player two in a two-player game)?
export function isManual(lp, p) { return (p === lp.control && lp.manual) || (!!lp.p2 && p === lp.p2.control && lp.p2.manual); }

// Events drive the HUD and the 3D animations: `who` is the player doing it, `other` the one
// it is done to (the tackler and the ball carrier, the receiver and the quarterback...).
export function event(lp, kind, text = '', who = null, other = null) { lp.events.push({ t: lp.t, kind, text, who, other }); }

export function setCarrier(lp, p) {
  for (const q of lp.players) q.carrier = false;
  lp.carrierSet = true;
  lp.carrier = p;
  p.carrier = true;
  p.role = 'carrier';
  if (p.eng) unengage(p);
  lp.ball.state = 'held';
  lp.ball.holder = p;
  lp.carrierTeam = p.side;
  lp.carrierAt = lp.t;
  p.runFrom = p.x;
  // The user takes over the ball carrier on their own team.
  if (lp.user != null && p.ti === lp.user && lp.control !== p) { lp.control = p; lp.manual = false; }
  if (lp.p2 && p.ti === lp.p2.user && lp.p2.control !== p) { lp.p2.control = p; lp.p2.manual = false; }
  // Everyone switches to the ball once it is handed off, caught or picked.
  for (const q of lp.players) {
    if (q === p) continue;
    // A defender who watched the throw already knows where the ball is: he reacts to the catch
    // in half the time of one reading a handoff, and one already playing the ball near the catch
    // goes straight for the receiver.
    if (q.side !== p.side) {
      const onBall = lp.thrown && !lp.intercepted;
      q.role = 'pursue';
      q.react = q.eng || (onBall && q.react <= 0 && dist(q, p) < 6) ? 0 : (0.1 + (100 - (q.a.spd + q.a.awr) / 2) * 0.003) * (onBall ? 0.5 : 1);
    }
    else if (q.role === 'route' || q.role === 'qb' || q.role === 'handoff' || q.role === 'idle' || q.role === 'carrier' || (lp.kick && q.role?.[0] === 'k') || q.role === 'returner'
      // An interception: the rest of the defense turns blocker for the man with the ball
      // instead of chasing him.
      || (!lp.kick && p.side === 'def' && (q.role === 'cover' || q.role === 'rush'))
      // A fumble his own side scooped up: he was chasing the old carrier, now he blocks.
      || q.role === 'pursue') {
      // The quarterback carries out his fake after a handoff and trails the play after a
      // completion; he is not a lead blocker 20 yards downfield.
      q.role = q.side === 'off' && p.side === 'off' && q.slot === 'QB' ? (lp.kind === 'run' ? 'fake' : 'trail') : 'escort';
    }
  }
}

export const inTackle = (lp, p) => !!lp.tackle && (lp.tackle.c === p || lp.tackle.q === p);

export function seek(p, pt, frac = 1, arrive = 1.2) {
  const dx = pt.x - p.x, dy = pt.y - p.y;
  const d = len(dx, dy);
  if (d < 0.05) { p.want = { vx: 0, vy: 0 }; return; }
  const sp = p.top * frac * Math.min(1, d / arrive);
  p.want = { vx: (dx / d) * sp, vy: (dy / d) * sp };
}

// Pass protection. At the snap the line slides into a cup around the quarterback's drop spot:
// each blocker owns the rusher matched to him left to right (slide protection), kick-steps back
// to the arc between that rusher and the quarterback and meets him there, so the pocket is a
// shape on the field, not a scrum at the line. A blocker whose man is taken or gone picks up
// the free rusher nearest the quarterback.
export function protect(lp) {
  if (lp.prot) return;
  lp.prot = true;
  const bl = lp.players.filter((p) => p.side === 'off' && p.role === 'passblock').sort((a, b) => a.y - b.y);
  const ru = lp.players.filter((p) => p.side === 'def' && p.role === 'rush').sort((a, b) => a.y - b.y);
  // Match in order, linemen first; extra blockers (a back or tight end) take the widest leftover.
  const line = bl.filter((p) => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot));
  const used = new Set();
  const pairs = [];
  for (const b of bl) for (const r of ru) pairs.push([Math.abs(b.y - r.y) + (line.includes(b) ? 0 : 2), b, r]);
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, b, r] of pairs) if (!b.pick && !used.has(r)) { b.pick = r; used.add(r); }
}

export function pocketSpot(lp, p, toward) {
  // The cup: a circle around the drop spot whose front edge sits a yard and a half behind the
  // line; the tackles' spots swing wider and deeper so the edge rushers are run past the QB.
  const cx = lp.dropX, cy = 0;
  const R = Math.max(3.2, -lp.dropX - 1.6);
  let ax = toward.x - cx, ay = toward.y - cy;
  const l = len(ax, ay) || 1; ax /= l; ay /= l;
  return { x: cx + ax * R, y: cy + ay * R * 1.15 };
}

export function passBlockWant(lp, p) {
  protect(lp);
  if (p.eng) return;
  const qb = lp.off.QB;
  let m = p.pick;
  // The assigned man is blocked by someone else, beaten past the pocket or out of the play:
  // help on the free rusher nearest the quarterback.
  if (!m || m.eng || m.stun > 0.3 || m.x < qb.x - 1) {
    let best = null, bd = 9;
    for (const q of lp.players) {
      if (q.side !== 'def' || q.role !== 'rush' || q.eng || q.stun > 0.3) continue;
      const taken = lp.players.some((b) => b !== p && b.side === 'off' && b.pick === q && !b.eng);
      const dd = dist(q, qb) * 0.6 + dist(q, p) * 0.4 + (taken ? 4 : 0);
      if (dd < bd) { bd = dd; best = q; }
    }
    m = best;
    if (m) p.pick = m;
  }
  p.aim = m;
  if (!m) {
    // Nobody to block: settle into the cup and look for work. A back behind the line sets up
    // at the quarterback's shoulder instead, not in front of him where he would wall off the drop.
    if (!['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot) && p.x < qb.x + 3) {
      let side = p.y - qb.y;
      if (Math.abs(side) < 0.3) for (const q of lp.players) if (q.side === 'def' && q.role === 'rush' && Math.abs(q.y) > Math.abs(side)) side = q.y;
      seek(p, { x: Math.max(qb.x, lp.dropX) + 1, y: qb.y + sgn(side || 1) * 1.9 }, 0.5, 0.6);
      return;
    }
    const s = pocketSpot(lp, p, { x: p.x + 4, y: p.y });
    seek(p, s, 0.35, 0.6);
    return;
  }
  // Meet the rusher on the arc, or in front of it if he is still out wide.
  const s = pocketSpot(lp, p, m);
  const dm = dist(m, s);
  const ax = qb.x - m.x, ay = qb.y - m.y, l = len(ax, ay) || 1;
  const front = { x: m.x + (ax / l) * (m.r + p.r + 0.15), y: m.y + (ay / l) * (m.r + p.r + 0.15) };
  // A second blocker coming to the same man takes the other shoulder of the double team instead
  // of the same spot, so the two of them don't stand pressed into each other.
  if (lp.players.some((b) => b !== p && b.side === 'off' && b.aim === m && dist(b, front) < dist(p, front))) {
    const sd = sgn(p.y - m.y || 1);
    front.x -= 0.2; front.y += sd * (p.r + 0.25);
  }
  // Close to him, mirror at full speed so a quick rusher can't just run around.
  const close = dm < 2.2 || dist(p, m) < 2;
  seek(p, close ? front : { x: (s.x * 2 + front.x) / 3, y: (s.y * 2 + front.y) / 3 }, close ? 1 : 0.85, 0.4);
}

// Steering around bodies in the way: anyone (but the player this one is going after) a little
// ahead and inside the path bends the path to the open side, so runners hit gaps, rushers
// loop around blockers and pursuers take an angle instead of pushing through a pile.
export function steer(lp, p, vx, vy) {
  const sp = len(vx, vy);
  if (sp < 0.5) return [vx, vy];
  const ux = vx / sp, uy = vy / sp, look = 1.2 + sp * 0.3;
  let ax = 0, ay = 0;
  for (const q of lp.players) {
    if (q === p || q === p.aim || q === p.eng) continue;
    const rx = q.x - p.x, ry = q.y - p.y;
    const along = rx * ux + ry * uy;
    if (along <= 0 || along > look) continue;
    const lat = -rx * uy + ry * ux; // + when q is to the left of the path
    const need = p.r + q.r + 0.15;
    if (Math.abs(lat) >= need) continue;
    const k = ((need - Math.abs(lat)) / need) * (1 - along / look) * (q.eng ? 1.6 : q.side === p.side ? 0.5 : 1.2);
    const side = lat === 0 ? (p.y > q.y ? 1 : -1) : -sgn(lat);
    ax += -uy * side * k; ay += ux * side * k;
  }
  if (!ax && !ay) return [vx, vy];
  const nx = ux + ax * 1.6, ny = uy + ay * 1.6, l = len(nx, ny) || 1;
  return [(nx / l) * sp, (ny / l) * sp];
}

// Locomotion. A body has a speed and a heading, not a velocity it can rewrite at will: it
// speeds up from its Acceleration (harder from a standstill than near top speed), brakes
// harder than it speeds up (Agility), and swings its path no faster than its feet can grip
// the turf at the speed it carries (lateral grip / speed, so a sprinter bends his path and a
// player at a jog changes direction almost on the spot). Asked to go somewhere well off his
// heading, he plants: he sheds the speed he cannot turn with, cuts, and drives out of it, so
// a sharp route break, a juke or a defender flipping his hips all cost what they should.
// Nearly stopped, he simply pivots and goes. boost scales the whole engine for moves (a juke,
// the sprint burst). gripK lets a ball carrier or a free rusher cut a little harder.
const PIVOT = 0.8;
export function kin(p, vx, vy, top, dt, boost = 1, gripK = 1) {
  let wl = len(vx, vy);
  if (wl > top) { vx *= top / wl; vy *= top / wl; wl = top; }
  const s = len(p.vx, p.vy);
  const acc = p.accel * boost * (1.15 - 0.45 * clamp(s / (p.top || top), 0, 1));
  const brake = p.accel * (p.cut ?? 2) * Math.max(1, boost * 0.8);
  if (s < PIVOT || wl < 0.05) {
    // From a standstill (or stopping): accelerate straight toward what he wants.
    let dvx = vx - p.vx, dvy = vy - p.vy;
    const dl = len(dvx, dvy), amax = (wl < 0.05 ? brake : Math.max(acc, s < 0.3 ? acc : brake * 0.6)) * dt;
    if (dl > amax) { dvx *= amax / dl; dvy *= amax / dl; }
    p.vx += dvx; p.vy += dvy;
    integrate(p, dt);
    return;
  }
  const hx = p.vx / s, hy = p.vy / s, ux = vx / wl, uy = vy / wl;
  const err = Math.atan2(hx * uy - hy * ux, hx * ux + hy * uy);
  // The speed he can carry through this much turn: all of it straight ahead, none of it on a
  // reversal (he plants and comes back).
  const keep = Math.cos(Math.min(Math.abs(err), Math.PI / 2));
  const sWant = wl * keep * keep;
  const ds = clamp(sWant - s, -brake * dt, acc * dt);
  const sn = Math.max(0, s + ds);
  // Grip: how hard he can bend his path (yards per second squared, sideways).
  const grip = (p.grip ?? 16) * boost * gripK;
  const wMax = grip / Math.max(sn, 1.6);
  const turn = clamp(err, -wMax * dt, wMax * dt);
  const c = Math.cos(turn), sn2 = Math.sin(turn);
  const nx = hx * c - hy * sn2, ny = hx * sn2 + hy * c;
  p.vx = nx * sn; p.vy = ny * sn;
  integrate(p, dt);
}

export function integrate(p, dt) {
  p.x += p.vx * dt; p.y += p.vy * dt;
}

export function slowDown(p, dt, k = 6) {
  const f = Math.max(0, 1 - k * dt);
  p.vx *= f; p.vy *= f;
  if (!p.eng) integrate(p, dt);
}

// Bodies don't pass through each other: overlapping capsules are pushed apart until they
// just touch. Ball carriers and engaged blockers hold their ground and the other one gives;
// when both hold, both give. Contact itself (blocks, tackles) happens at the capsule edge.
export const SEP_MAX = 0.12;

export function separate(lp, passes = 2) {
  const ps = lp.players;
  const holds = (p) => !!(p.eng || p.carrier);
  const row = ps.map((p) => rightOfWay(lp, p));
  for (let it = 0; it < passes; it++) {
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (a.eng === b) continue;
        const T = lp.tackle;
        if (T && ((a === T.c && b === T.q) || (a === T.q && b === T.c))) continue;
        const need = a.r + b.r;
        let dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
        if (d >= need) continue;
        if (d < 1e-6) { dx = a.side === 'off' ? 1 : -1; dy = 0; d = 1; }
        // Shallow overlaps (a block coming apart) resolve over a few frames, not in one jump; a deep
        // one (a pile in the trenches) gives up half its depth each pass, so bodies never linger
        // inside each other.
        const pen = need - Math.min(d, need);
        const ux = dx / d, uy = dy / d, over = Math.min(pen, Math.max(SEP_MAX, pen * 0.5));
        // A ball carrier squeezing past his own blockers moves them, not himself.
        const ha = holds(a) && !(b.carrier && a.side === b.side), hb = holds(b) && !(a.carrier && a.side === b.side);
        let ka = ha && !hb ? 0 : !ha && hb ? 1 : 0.5;
        // Past a third of their reach in, the free one is pinned (a pocket closing on the
        // quarterback from two blocks): the holder gives too, or a block would drive through him.
        if (need - d > need / 3) ka = 0.5;
        // A free teammate and the carrier share the shove; neither bulldozes the other.
        const mate = a.side === b.side && (a.carrier || b.carrier);
        if (mate && !a.eng && !b.eng) ka = a.carrier ? 0.35 : 0.65;
        // The passer in his drop (or whoever a person is steering) brushes past a free teammate:
        // the teammate is moved out of his lane, sideways to it, and he keeps his feet.
        const pa = row[i] && !row[j] && a.side === b.side && !b.eng && !inTackle(lp, b);
        const pb = row[j] && !row[i] && a.side === b.side && !a.eng && !inTackle(lp, a);
        if (pa || pb) {
          const P = pa ? a : b, O = pa ? b : a, s = pa ? 1 : -1;
          const [lx, ly] = aside(lp, P, O, ux * s, uy * s);
          P.x -= ux * s * over * 0.1; P.y -= uy * s * over * 0.1;
          O.x += lx * over * 0.95; O.y += ly * over * 0.95;
          slide(O, -lx, -ly);
          continue;
        }
        // A receiver in his route and a defender in coverage: the man running the route has the
        // right to his path, so the defender gives most of the ground, and the receiver works
        // off the contact instead of being stopped by it.
        const route = (p) => p.role === 'route' && !lp.thrown && !lp.carrierSet;
        if (a.side !== b.side && !a.eng && !b.eng && (route(a) || route(b))) ka = route(a) ? 0.3 : 0.7;
        a.x -= ux * over * ka; a.y -= uy * over * ka;
        b.x += ux * over * (1 - ka); b.y += uy * over * (1 - ka);
        // A body pressed into another loses the speed it had into it (a free player running
        // into a block slides off it instead of grinding in and being shoved back each step).
        if (!a.eng && !inTackle(lp, a) && ka > 0 && !(mate && a.carrier)) { slide(a, ux, uy, route(a) && b.side !== a.side); touch(lp, a, b, ux, uy); }
        if (!b.eng && !inTackle(lp, b) && ka < 1 && !(mate && b.carrier)) { slide(b, -ux, -uy, route(b) && b.side !== a.side); touch(lp, b, a, -ux, -uy); }
      }
    }
  }
}

// p pressed against a body in direction (ux, uy): running into it costs him the speed he had
// into it (a soft contact, over a few frames), and he works around it toward the side he wants,
// turning no faster than his feet allow (half his grip, since he also steers in kin; a pass
// rusher working an edge is all feet), so he slides off a body instead of grinding into it.
export function slide(p, ux, uy, fight = false) {
  const vn = p.vx * ux + p.vy * uy;
  if (vn <= 0) return;
  const s = len(p.vx, p.vy) || 1;
  // A receiver fighting through a defender's hands gives up less of his speed to the contact.
  const k = 1 - (fight ? 0.35 : 0.7) * (vn / s);
  p.vx *= k; p.vy *= k;
  const tx = -uy, ty = ux, w = p.want ?? p;
  const side = sgn((p.vx * tx + p.vy * ty) * 3 + (w.vx * tx + w.vy * ty) || 1);
  const sn = len(p.vx, p.vy);
  if (sn < 0.3) { p.vx += tx * side * vn * 0.3; p.vy += ty * side * vn * 0.3; return; }
  const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(ty * side, tx * side);
  let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const a = cur + sgn(d) * Math.min(Math.abs(d), ((p.grip ?? 16) * (p.role === 'rush' || fight ? 1.2 : 0.5) / Math.max(sn, 1.6)) * DT);
  p.vx = Math.cos(a) * sn; p.vy = Math.sin(a) * sn;
}

// Who teammates make room for: the quarterback holding the ball in his drop on a pass (before
// the throw, the handoff or the scramble), and whoever a person is steering.
export function rightOfWay(lp, p) {
  if (p.eng || p.stun > 0) return false;
  if (isManual(lp, p)) return true;
  const qb = lp.off?.QB;
  return p === qb && lp.kind === 'pass' && lp.ball?.holder === qb && !lp.thrown && !lp.carrierSet;
}

// The way for O to step out of P's lane: sideways to where P is headed (what the stick asks for
// when a person steers him), on the side O is already on; (nx, ny) is from P to O. Straight
// away when P is standing still.
function aside(lp, P, O, nx, ny) {
  const w = isManual(lp, P) && P.input && (P.input.mx || P.input.my) ? { vx: P.input.mx, vy: P.input.my } : len(P.vx, P.vy) > 0.5 ? P : null;
  if (!w) return [nx, ny];
  const s = len(w.vx, w.vy), ux = w.vx / s, uy = w.vy / s;
  const lat = -nx * uy + ny * ux;
  const side = Math.abs(lat) > 0.08 ? sgn(lat) : sideOf(O, ux, uy);
  const ahead = clamp(nx * ux + ny * uy, 0, 1);
  // Mostly sideways when he is in front, along the normal once he is beside.
  let lx = nx * (1 - ahead) + -uy * side * (0.4 + ahead), ly = ny * (1 - ahead) + ux * side * (0.4 + ahead);
  const l = len(lx, ly) || 1;
  return [lx / l, ly / l];
}
// Which way a body dead in someone's lane steps: the way he already wants to go, else away
// from the middle of the field, else to his own side of the formation.
function sideOf(O, ux, uy) {
  const w = O.want ?? O;
  const lat = -(w.vx ?? 0) * uy + (w.vy ?? 0) * ux;
  if (Math.abs(lat) > 0.3) return sgn(lat);
  const h = O.home?.y ?? O.y, y = Math.abs(h) > 0.3 ? sgn(h) : O.slot === 'RB' ? 1 : -1;
  return sgn(y * ux || 1);
}

// An AI teammate in the lane of a body with the right of way (the passer in his drop, or the
// player you steer) gets out of it before they meet: he stops walking into it and sidesteps to
// the near side, so a back checking the blitz or releasing from behind the quarterback never
// becomes a wall in his drop. A blocker on his way to a man (p.aim) only yields to the passer.
export function giveWay(lp, p, vx, vy) {
  if (p.eng || p.carrier) return [vx, vy];
  for (const P of lp.players) {
    if (P === p || P.side !== p.side || !rightOfWay(lp, P)) continue;
    if (p.aim && P.carrier) continue;
    const rx = p.x - P.x, ry = p.y - P.y;
    if (rx * rx + ry * ry > 36) continue;
    const manual = isManual(lp, P) && P.input && (P.input.mx || P.input.my);
    const wx = manual ? P.input.mx * P.top : P.vx, wy = manual ? P.input.my * P.top : P.vy;
    const s = len(wx, wy), need = p.r + P.r + 0.45;
    if (s < 0.5) continue;
    const ux = wx / s, uy = wy / s;
    // Where they would be closest if both kept going.
    const along = rx * ux + ry * uy, lat = -rx * uy + ry * ux;
    const look = 1 + s * 0.45;
    if (along < -0.3 || along > look || Math.abs(lat) >= need) continue;
    const side = Math.abs(lat) > 0.08 ? sgn(lat) : sideOf(p, ux, uy);
    const k = (1 - Math.abs(lat) / need) * (1 - Math.max(0, along) / look);
    // Nothing of his own speed back into the lane, nothing toward the passer.
    const vl = -vx * uy + vy * ux, va = vx * ux + vy * uy;
    const nl = side * Math.max(vl * side, p.top * (0.35 + 0.65 * k)), na = va < 0 ? va * (1 - k) : va;
    vx = ux * na - uy * nl; vy = uy * na + ux * nl;
  }
  return [vx, vy];
}

// Contact is remembered for a beat: who p is pressed against, and from which way.
// Pressed between two (a receiver caught in the line), he works off the sum of the contacts.
function touch(lp, p, q, ux, uy) {
  const T = p.touch;
  if (T && T.t === lp.t && T.q !== q) {
    const sx = T.ux + ux, sy = T.uy + uy, l = len(sx, sy);
    if (l > 0.2) { T.ux = sx / l; T.uy = sy / l; }
    T.n++;
    return;
  }
  p.touch = { q, ux, uy, t: lp.t, n: 1 };
}

// Two teammates on offense pressed together (two blockers come to the same man, a back setting up
// beside a tackle) part: the part of where each wants to go that runs into the other is turned
// along the other's edge, to one side, and he keeps that side until the contact is over, so the
// two don't stand mirroring each other. (A receiver against a defender fights through in slide();
// rushers and pursuers working around blockers are the blocking game's business.)
export function skirt(lp, p, vx, vy) {
  const T = p.touch;
  if (!T || p.side !== 'off' || T.q.side !== 'off' || lp.t - T.t > 0.05 || T.q === p.aim || T.q === p.eng || p.carrier || isManual(lp, p)) { if (T && lp.t - T.t > 0.25) { p.touch = null; p.skirt = 0; } return [vx, vy]; }
  const vn = vx * T.ux + vy * T.uy;
  if (vn <= 0) return [vx, vy];
  const tx = -T.uy, ty = T.ux;
  if (!p.skirt || p.skirtFrom !== T.q) {
    // The side he is already leaning to, else the one the other body isn't heading for.
    const lean = vx * tx + vy * ty, other = (T.q.vx ?? 0) * tx + (T.q.vy ?? 0) * ty;
    p.skirt = Math.abs(lean) > 0.4 ? sgn(lean) : Math.abs(other) > 0.4 ? -sgn(other) : sgn((p.y - T.q.y) * tx + (p.x - T.q.x) * ty || 1);
    p.skirtFrom = T.q;
  }
  const vt = vx * tx + vy * ty;
  const nt = p.skirt * Math.max(vt * p.skirt, vn * 0.95);
  return [T.ux * vn * 0.15 + tx * nt, T.uy * vn * 0.15 + ty * nt];
}

// A cover man plays his receiver from where he is (a step off, a hip on him), not through him:
// he matches what the receiver is doing, but does not drive into his body.
export function noPush(p, r) {
  const w = p.want;
  if (!w || !r) return;
  const dx = r.x - p.x, dy = r.y - p.y, d = len(dx, dy), reach = p.r + r.r + 0.5;
  if (d > reach || d < 1e-6) return;
  const nx = dx / d, ny = dy / d;
  const rel = (w.vx - (r.vx ?? 0)) * nx + (w.vy - (r.vy ?? 0)) * ny;
  if (rel <= 0) return;
  const k = clamp((reach - d) / 0.5, 0, 1);
  w.vx -= nx * rel * k; w.vy -= ny * rel * k;
}

export function unengage(p) { const q = p.eng; if (q) { q.eng = null; q.shed = null; } p.eng = null; p.shed = null; }

// Notes for the traits that acted at a hook (quiet ones only when the caller says so).
export function traitNotes(lp, T, ctx, who, decided = false) {
  for (const t of T.used) {
    if (t.quiet && !decided) continue;
    const by = t.who?.(ctx) ?? who;
    // A power that changed the play flashes its name over the player.
    if (t.kind === 'power' && !lp.notes.some((n) => n.kind === 'power' && n.who === by)) event(lp, 'power', by.power.name, by);
    note(lp, t.kind, t.note(ctx), by);
  }
}

// Something about a Pokémon (its type, its ability, its build) changed this play.
export function note(lp, kind, text, who = null) {
  if (lp.notes.some((n) => n.text === text)) return;
  lp.notes.push({ t: lp.t, kind, text, who });
  event(lp, 'note', text, who);
}

export function finish(lp, end) {
  if (lp.phase !== 'live') return;
  lp.phase = 'dead';
  lp.deadAt = lp.t;
  lp.end = end;
  lp.result = lp.kick ? results.kick(lp, end) : buildResult(lp, end);
  // The hit, for the league's injury roll (engine.js): who wrapped up whom, and how fast they met.
  const T = lp.tackle;
  if (!lp.kick && T && end.tackler && !lp.intercepted && lp.result) lp.result.hit = { carrier: T.c.id, tackler: T.q.id, speed: T.impact };
  if (lp.fake && lp.result.text) lp.result.text = `${lp.fake === 'punt' ? 'Fake punt!' : 'Fake field goal!'} ${lp.result.text}`;
  // Fouls during the play: the fast simulator's rolls (penalties.js simFouls), one model for both
  // games, made at the whistle from what happened here and flagged where the player stands.
  if (lp.flags && !lp.kick && !lp.result.noPlay) for (const f of simFouls(lp.g, lp.result)) {
    const who = lp.players.find((p) => p.id === f.player && p.ti === f.team);
    lp.fouls.push({ ...f, y: who?.y ?? 0, t: lp.t });
    event(lp, 'flag', '', who ?? null);
  }
  if (lp.fouls?.length) { lp.result.fouls = lp.fouls; lp.result.statSnap = lp.statSnap; }
}

export function buildResult(lp, end) {
  if (lp.fumble && end.how !== 'flag') return fumbleResult(lp, end);
  const g = lp.g, o = lp.o, d = lp.d;
  const qb = lp.off.QB;
  const stats = lp.stats;
  const extras = stats.extras.length ? `, ${stats.extras.slice(0, 2).join(' and ')}` : '';
  const yardsWord = (y) => (y === 0 ? 'no gain' : y > 0 ? `${y} yard${y === 1 ? '' : 's'}` : `a loss of ${-y}`);
  const stop = end.how === 'out' || end.how === 'incomplete';
  if (end.how === 'flag') return { kind: 'none', noPlay: true, yards: 0, text: '' };
  // The play ran past its time cap: the officials rule it over as it stands. A ball in the air
  // or on the turf is an incompletion; whoever holds it is down where he is.
  if (end.how === 'time') {
    const b = lp.ball;
    end = b.state === 'held' && b.holder ? { ...end, how: 'down' } : { ...end, how: 'incomplete', text: `${nm(qb.id)}'s pass falls incomplete.` };
  }

  if (end.how === 'incomplete') {
    st(g, o, qb.id).pa++;
    if (stats.target) st(g, o, stats.target.id).tg++;
    return { kind: 'pass', yards: 0, carrier: qb.id, qb: qb.id, text: end.text, clockStop: true, incomplete: true,
      cov: stats.cov?.id ?? null, air: Math.round(lp.thrown?.air ?? 8) };
  }
  // Whoever actually has the ball is the runner the play is scored from.
  const hb = lp.ball.holder;
  const c = (!lp.intercepted && hb && hb.side === 'off' ? hb : null) ?? lp.carrier ?? qb;
  // Interception return
  if (lp.intercepted) {
    st(g, o, qb.id).pa++; st(g, o, qb.id).pint++;
    st(g, o, stats.target.id).tg++;
    st(g, d, c.id).dint++;
    if (end.tackler) st(g, o, end.tackler.id).tk++;
    const endX = lp.spotX ?? c.x;
    let returnSpot = Math.round(100 - lp.spot - endX);
    if (lp.catchX >= lp.goalX && endX >= lp.goalX) returnSpot = 0; // downed in the end zone: touchback
    return { kind: 'pass', yards: 0, carrier: c.id, qb: qb.id, returner: c.id, highlight: 'turnover', clockStop: true, turnover: 'int', returnSpot,
      text: `${nm(qb.id)} throws for ${nm(stats.target.id)}... INTERCEPTED by ${nm(c.id)}${returnSpot >= 100 ? ' and he takes it all the way back' : ''}!` };
  }
  // The dead-ball spot: forward progress for a tackle or a push out of bounds.
  let yards = Math.round(lp.spotX ?? c.x);
  if (end.how === 'td') yards = lp.goalX;
  yards = Math.max(yards, -lp.spot);
  const tackler = end.tackler ?? null;
  const tk = tackler ? ` Tackled by ${nm(tackler.id)}.` : end.how === 'out' ? ' Pushed out of bounds.' : end.how === 'slide' ? ' He slides to give himself up.' : end.how === 'down' ? ' He is ruled down.' : '';
  const se = stats.se;
  const highlight = yards >= 20 ? 'big' : null;

  if (end.how === 'sack') {
    const qs = st(g, o, qb.id);
    qs.sk++; st(g, d, tackler.id).dsk++; st(g, d, tackler.id).tk++; g.teams[o].team.sacks++;
    // (A strip is played out on the field: see the live fumbles in live.js.)
    const text = `${nm(tackler.id)} sacks ${nm(qb.id)} for a loss of ${Math.max(0, -yards)}.${se ? " It's super effective!" : ''}`;
    return { kind: 'sack', yards, carrier: qb.id, text, highlight: 'sack', se };
  }

  const isPass = lp.caught;
  if (isPass) {
    const qs = st(g, o, qb.id), rs = st(g, o, c.id);
    const counted = Math.min(yards, 100 - lp.spot);
    qs.pa++; qs.pc++; qs.py += counted; rs.tg++; rs.rc++; rs.rcy += counted; rs.rclong = Math.max(rs.rclong, yards);
    let text = `${nm(qb.id)} finds ${nm(c.id)}${extras} for ${yardsWord(yards)}.${tk}`;
    if (se) text += " It's super effective!";
    const r = { kind: 'pass', yards, carrier: c.id, scorer: c.id, qb: qb.id, text, clockStop: stop, oob: end.how === 'out', highlight, se };
    if (tackler && end.how === 'tackle') st(g, d, tackler.id).tk++;
    return r;
  }
  // Runs and scrambles
  const s = st(g, o, c.id);
  s.ra++; s.ry += Math.min(yards, 100 - lp.spot); s.rlong = Math.max(s.rlong, yards);
  const how = lp.scramble ? 'scrambles' : { inside: 'runs up the middle', outside: c.y < 0 ? 'runs around the left end' : 'runs around the right end', draw: 'runs the draw', sneak: 'sneaks ahead', qbdraw: 'takes off on the QB draw', qbpower: 'keeps it on QB power', read: c.slot === 'QB' ? 'pulls it on the read and runs' : 'takes the give on the read' }[lp.play.dir] ?? 'runs';
  let text = `${nm(c.id)} ${how}${extras} for ${yardsWord(yards)}.${tk}`;
  if (se) text += " It's super effective!";
  const r = { kind: 'run', yards, carrier: c.id, scorer: c.id, text, clockStop: stop, oob: end.how === 'out', highlight: yards >= 20 ? 'big' : yards < 0 ? 'loss' : null, se };
  if (tackler && end.how === 'tackle') st(g, d, tackler.id).tk++;
  return r;
}

// A fumble played out on the field (live.js popBall): the play up to the strip is scored as a
// tackle there, then whoever came up with the ball has it where he fell on it, or where his
// scoop and run ended.
function fumbleResult(lp, end) {
  const g = lp.g, o = lp.o, d = lp.d, F = lp.fumble;
  const c = F.c, q = F.q;
  const at = lp.spotX, ball = lp.ball;
  // The play to the strip, as the tackle it was.
  const view = { ...lp, fumble: null, carrier: c, carrierSet: true, spotX: F.x, ball: { ...ball, state: 'held', holder: c } };
  const base = buildResult(view, { how: F.sack ? 'sack' : 'tackle', tackler: q });
  st(g, o, c.id).fum++; st(g, d, q.id).ff++;
  const rec = F.by ?? null, scoop = !!F.scoop && !!rec;
  // Where it ended, in the offense's yards: the recovery, the end of the scoop, or where it went out.
  let endX = at ?? (scoop ? rec.x : ball.x);
  if (end.how === 'td') endX = rec?.side === 'def' ? lp.ownGoalX : lp.goalX;
  const text = base.text.replace(/ It's super effective!$/, '');
  if (rec?.side === 'def') {
    const returnSpot = end.how === 'td' ? 100 : Math.round(100 - lp.spot - endX);
    const ran = scoop ? (returnSpot >= 100 ? ' and takes it all the way back' : ` and returns it ${Math.max(0, Math.round(F.at.x - endX))} yards`) : '';
    return { ...base, kind: base.kind, yards: base.yards, returner: rec.id, turnover: 'fumble', returnSpot, highlight: 'turnover', clockStop: true,
      text: `${text} FUMBLE! ${nm(rec.id)} recovers for ${g.teams[d].name}${ran}!` };
  }
  // The offense keeps it (it fell on it, ran with it, or the ball went out).
  const yards = Math.max(-lp.spot, Math.round(endX)) || 0;
  const how = !rec ? (end.how === 'fumbleOut' ? ' It rolls out of bounds.' : ' The officials give it back to the offense at the spot.') : scoop ? ` ${nm(rec.id)} picks it up and runs.` : ` ${nm(rec.id)} falls on it.`;
  return { ...base, yards, carrier: rec?.id ?? c.id, scorer: rec?.id ?? c.id, clockStop: true, highlight: yards >= lp.goalX ? 'td' : base.highlight,
    text: `${text} FUMBLE!${how} ${g.teams[o].name} keep it.` };
}
