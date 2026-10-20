// The live play's shared core: field constants, geometry, movement, blocking help, events and
// the end of the play. Everything under src/live/ and src/live.js builds on this module, and it
// imports none of them, so the live modules form a tree with no import cycles.
import { traitMod } from '../traits.js';
import { chance, clamp, fumbleCheck, nm, st } from '../engine.js';

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
      || (!lp.kick && p.side === 'def' && (q.role === 'cover' || q.role === 'rush'))) {
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
    // Nobody to block: settle into the cup and look for work.
    const s = pocketSpot(lp, p, { x: p.x + 4, y: p.y });
    seek(p, s, 0.35, 0.6);
    return;
  }
  // Meet the rusher on the arc, or in front of it if he is still out wide.
  const s = pocketSpot(lp, p, m);
  const dm = dist(m, s);
  const ax = qb.x - m.x, ay = qb.y - m.y, l = len(ax, ay) || 1;
  const front = { x: m.x + (ax / l) * (m.r + p.r + 0.15), y: m.y + (ay / l) * (m.r + p.r + 0.15) };
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
        // Deep overlaps (a block coming apart, a pile) resolve over a few frames, not in one jump.
        const ux = dx / d, uy = dy / d, over = Math.min(need - Math.min(d, need), SEP_MAX);
        // A ball carrier squeezing past his own blockers moves them, not himself.
        const ha = holds(a) && !(b.carrier && a.side === b.side), hb = holds(b) && !(a.carrier && a.side === b.side);
        let ka = ha && !hb ? 0 : !ha && hb ? 1 : 0.5;
        // Past a third of their reach in, the free one is pinned (a pocket closing on the
        // quarterback from two blocks): the holder gives too, or a block would drive through him.
        if (need - d > need / 3) ka = 0.5;
        // A free teammate and the carrier share the shove; neither bulldozes the other.
        const mate = a.side === b.side && (a.carrier || b.carrier);
        if (mate && !a.eng && !b.eng) ka = a.carrier ? 0.35 : 0.65;
        a.x -= ux * over * ka; a.y -= uy * over * ka;
        b.x += ux * over * (1 - ka); b.y += uy * over * (1 - ka);
        // A body pressed into another loses the speed it had into it (a free player running
        // into a block slides off it instead of grinding in and being shoved back each step).
        if (!a.eng && !inTackle(lp, a) && ka > 0 && !(mate && a.carrier)) slide(a, ux, uy);
        if (!b.eng && !inTackle(lp, b) && ka < 1 && !(mate && b.carrier)) slide(b, -ux, -uy);
      }
    }
  }
}

// p pressed against a body in direction (ux, uy): running into it costs him the speed he had
// into it (a soft contact, over a few frames), and he works around it toward the side he wants,
// turning no faster than his feet allow (half his grip, since he also steers in kin; a pass
// rusher working an edge is all feet), so he slides off a body instead of grinding into it.
export function slide(p, ux, uy) {
  const vn = p.vx * ux + p.vy * uy;
  if (vn <= 0) return;
  const s = len(p.vx, p.vy) || 1;
  const k = 1 - 0.7 * (vn / s);
  p.vx *= k; p.vy *= k;
  const tx = -uy, ty = ux, w = p.want ?? p;
  const side = sgn((p.vx * tx + p.vy * ty) * 3 + (w.vx * tx + w.vy * ty) || 1);
  const sn = len(p.vx, p.vy);
  if (sn < 0.3) { p.vx += tx * side * vn * 0.3; p.vy += ty * side * vn * 0.3; return; }
  const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(ty * side, tx * side);
  let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const a = cur + sgn(d) * Math.min(Math.abs(d), ((p.grip ?? 16) * (p.role === 'rush' ? 1.2 : 0.5) / Math.max(sn, 1.6)) * DT);
  p.vx = Math.cos(a) * sn; p.vy = Math.sin(a) * sn;
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
  if (lp.fouls?.length) { lp.result.fouls = lp.fouls; lp.result.statSnap = lp.statSnap; }
}

export function buildResult(lp, end) {
  const g = lp.g, o = lp.o, d = lp.d;
  const qb = lp.off.QB;
  const stats = lp.stats;
  const extras = stats.extras.length ? `, ${stats.extras.slice(0, 2).join(' and ')}` : '';
  const yardsWord = (y) => (y === 0 ? 'no gain' : y > 0 ? `${y} yard${y === 1 ? '' : 's'}` : `a loss of ${-y}`);
  const stop = end.how === 'out' || end.how === 'incomplete';
  if (end.how === 'flag') return { kind: 'none', noPlay: true, yards: 0, text: '' };

  if (end.how === 'incomplete') {
    st(g, o, qb.id).pa++;
    if (stats.target) st(g, o, stats.target.id).tg++;
    return { kind: 'pass', yards: 0, carrier: qb.id, qb: qb.id, text: end.text, clockStop: true };
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
  const tk = tackler ? ` Tackled by ${nm(tackler.id)}.` : end.how === 'out' ? ' Pushed out of bounds.' : end.how === 'slide' ? ' He slides to give himself up.' : '';
  const se = stats.se;
  const highlight = yards >= 20 ? 'big' : null;

  if (end.how === 'sack') {
    const qs = st(g, o, qb.id);
    qs.sk++; st(g, d, tackler.id).dsk++; st(g, d, tackler.id).tk++; g.teams[o].team.sacks++;
    let text = `${nm(tackler.id)} sacks ${nm(qb.id)} for a loss of ${Math.max(0, -yards)}.${se ? " It's super effective!" : ''}`;
    const tSt = traitMod('stripChance', { c: qb, q: tackler });
    const strip = Math.max(0, 0.07 + tSt.v);
    if (chance(g, strip)) {
      qs.fum++; st(g, d, tackler.id).ff++;
      if (chance(g, 0.6)) {
        const spotAt = clamp(lp.spot + yards, 1, 99);
        return { kind: 'sack', yards, carrier: qb.id, text: text + ` Strip sack! ${g.teams[d].name} recover.`, turnover: 'fumble',
          returnSpot: 100 - spotAt, highlight: 'turnover', clockStop: true, se };
      }
      text += ' The ball comes loose, but the offense falls on it.';
    }
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
    if (tackler && end.how === 'tackle') {
      st(g, d, tackler.id).tk++;
      if (chance(g, Math.max(0, 0.006 + Math.min(0, traitMod('stripChance', { c, q: tackler }).v)))) {
        rs.fum++; st(g, d, tackler.id).ff++;
        return { ...r, text: text + ` FUMBLE! ${g.teams[d].name} recover.`, turnover: 'fumble', returnSpot: 100 - clamp(lp.spot + yards, 1, 99), highlight: 'turnover', clockStop: true };
      }
    }
    return r;
  }
  // Runs and scrambles
  const s = st(g, o, c.id);
  s.ra++; s.ry += Math.min(yards, 100 - lp.spot); s.rlong = Math.max(s.rlong, yards);
  const how = lp.scramble ? 'scrambles' : { inside: 'runs up the middle', outside: c.y < 0 ? 'runs around the left end' : 'runs around the right end', draw: 'runs the draw', sneak: 'sneaks ahead', qbdraw: 'takes off on the QB draw', qbpower: 'keeps it on QB power', read: c.slot === 'QB' ? 'pulls it on the read and runs' : 'takes the give on the read' }[lp.play.dir] ?? 'runs';
  let text = `${nm(c.id)} ${how}${extras} for ${yardsWord(yards)}.${tk}`;
  if (se) text += " It's super effective!";
  const r = { kind: 'run', yards, carrier: c.id, scorer: c.id, text, clockStop: stop, oob: end.how === 'out', highlight: yards >= 20 ? 'big' : yards < 0 ? 'loss' : null, se };
  if (tackler && end.how === 'tackle') {
    st(g, d, tackler.id).tk++;
    if (fumbleCheck(g, o, d, c.id, tackler.id)) {
      s.fum++; st(g, d, tackler.id).ff++;
      if (chance(g, 0.55)) {
        return { ...r, text: text + ` FUMBLE! ${g.teams[d].name} recover.`, turnover: 'fumble', returnSpot: 100 - clamp(lp.spot + yards, 1, 99), highlight: 'turnover', clockStop: true };
      }
      r.text += ' Fumble, but the offense recovers.';
    }
  }
  return r;
}
