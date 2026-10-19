// Pre-snap adjustments, made at the line once both teams are set and before the snap.
// Offense: an audible to another play from the same formation (the game screen rebuilds the play
// from audibles()), a hot route for one receiver, and motion for one receiver off the line.
// Defense: shade the coverage, show blitz (walk the linebackers and the strong safety up to the
// line) and back out (drop the blitzers back to their normal depth, so the blitz is hidden).
// Everything here changes the live play in place and is deterministic, so the replay (which
// starts from a copy of the play at the snap) shows exactly what was played.
import { formationsFor, frontX, lineX } from '../formations.js';
import { DT, RECEIVERS, SIDE, dist, kin, seek, separate, sgn, steer } from '../live.js';
import { PLAY_ROUTES, buildRoute } from './passing.js';
import { clamp } from '../engine.js';

const ready = (lp) => lp.phase === 'pre' && lp.set && !lp.kick;
const onOffense = (lp) => lp.user != null && lp.user === lp.o;
const onDefense = (lp) => lp.user != null && lp.user === lp.d;

// ---------- audibles ----------
// The audible menu for the formation on the field: one call from each family that the
// formation can run (and the scouting "Fits" call first, when it is one of them), never the
// call already lined up. The quick, short list a real offense carries to the line.
const AUDIBLE_FAMILIES = [
  ['inside_run', 'dive', 'power', 'counter'], ['outside_run', 'toss'], ['slant', 'stick', 'out'],
  ['screen', 'bubble'], ['smash', 'curl', 'flood'], ['four_verts', 'post'],
];
export function audibles(lp, fit = null) {
  if (!ready(lp) || !onOffense(lp)) return [];
  const ok = (c) => c && c !== lp.offCall && formationsFor(c).includes(lp.formation);
  const out = ok(fit) ? [fit] : [];
  for (const fam of AUDIBLE_FAMILIES) {
    const c = fam.find((k) => ok(k) && !out.includes(k));
    if (c) out.push(c);
  }
  return out.slice(0, 7);
}

// ---------- hot routes ----------
export const HOT_ROUTES = [['go', 'Go'], ['slant', 'Slant'], ['out', 'Out'], ['curl', 'Curl'], ['drag', 'Drag'], ['post', 'Post'], ['corner', 'Corner'], ['flat', 'Flat'], ['block', 'Block']];
// Receivers that can take a hot route: on a pass play, any eligible receiver on the field.
export function hotCandidates(lp) {
  if (!ready(lp) || !onOffense(lp) || lp.kind !== 'pass') return [];
  return RECEIVERS.filter((k) => lp.off[k]);
}
// Give one receiver a new route (or keep him in to block). Returns true when it took.
export function hotRoute(lp, slot, route) {
  if (!hotCandidates(lp).includes(slot) || !HOT_ROUTES.some(([k]) => k === route)) return false;
  const p = lp.off[slot];
  p.assign = null;
  if (route === 'block') { p.role = 'passblock'; p.route = null; p.routeName = 'block'; }
  else {
    // Built from where he will be at the snap (the end of his motion, if he is going in motion).
    p.role = 'route'; p.routeName = route; p.wp = 0;
    p.route = buildRoute(lp, { x: p.home.x, y: p.home.y }, route);
  }
  (lp.hot ??= {})[slot] = route;
  lp.eligible = RECEIVERS.filter((k) => lp.off[k]?.role === 'route');
  lp.reads = null;
  return true;
}

// ---------- motion ----------
// Receivers who may go in motion: off the line of scrimmage, and not the ball carrier or a lead
// blocker on a run. One man in motion per play.
export function motionCandidates(lp) {
  if (!ready(lp) || !onOffense(lp) || lp.motion) return [];
  return RECEIVERS.filter((k) => {
    const p = lp.off[k];
    if (!p) return false;
    if (Math.abs(p.home.x - lineX(p)) < 0.6) return false;
    if (lp.kind === 'run' && (p === lp.carrier || p.role === 'runner' || p.role === 'lead')) return false;
    return true;
  });
}
// Send him across the formation: a slot or a tight end to the far side, a back out wide. He
// jogs there before the snap (snap while he is moving and he starts the play at speed), and a
// defender in man coverage on him follows him across, which is the tell for man coverage.
export function startMotion(lp, slot) {
  if (!motionCandidates(lp).includes(slot)) return false;
  const p = lp.off[slot];
  const ty = Math.abs(p.home.y) < 3 ? sgn(p.home.y || 1) * 11 : -sgn(p.home.y) * clamp(Math.abs(p.home.y) * 0.6, 4, 9);
  lp.motion = slot;
  p.motion = { y0: p.home.y };
  p.home = { x: Math.min(p.home.x, lineX(p) - 1.2), y: ty };
  if (p.role === 'route' && p.routeName) { p.route = buildRoute(lp, { x: p.home.x, y: p.home.y }, p.routeName); p.wp = 0; }
  for (const q of Object.values(lp.def)) if (q.man === p && q.role === 'cover') q.follow = { r: p, off: q.home.y - p.y };
  return true;
}

// ---------- the defense's look ----------
export const SHADES = [[null, 'Normal'], ['deep', 'Over the top'], ['under', 'Underneath'], ['inside', 'Inside'], ['outside', 'Outside']];
const LINE = new Set(['LE', 'DE', 'DT1', 'DT2']);
export function canShade(lp) { return ready(lp) && onDefense(lp); }
// Show blitz walks up who is not already up; back out only makes sense when somebody blitzes.
export function canBackOut(lp) { return canShade(lp) && lp.blitz.length > 0; }
export function setShade(lp, shade) {
  if (!canShade(lp) || !SHADES.some(([k]) => k === shade)) return false;
  lp.shade = shade;
  refreshDefense(lp);
  return true;
}
export function cycleShade(lp) {
  const i = SHADES.findIndex(([k]) => k === (lp.shade ?? null));
  return setShade(lp, SHADES[(i + 1) % SHADES.length][0]);
}
// 'show', 'back' or null (a second press of the same one takes it off).
export function setDisguise(lp, d) {
  if (!canShade(lp) || (d === 'back' && !canBackOut(lp))) return false;
  lp.disguise = lp.disguise === d ? null : d;
  refreshDefense(lp);
  return true;
}

// Rebuild the defense's alignment, zones and technique from the call's own, then apply the
// shade and the disguise on top. The players walk to their new spots before the snap.
function refreshDefense(lp) {
  const D = Object.values(lp.def);
  for (const p of D) p.base ??= { home: { ...p.home }, zone: p.zone ? { ...p.zone } : null };
  const cap = lp.goalX + 8;
  for (const p of D) {
    p.home = { ...p.base.home }; p.zone = p.base.zone ? { ...p.base.zone } : null;
    p.cushion = 0; p.lev = 0.4;
    if (LINE.has(p.slot) || p.role !== 'cover') continue;
    const z = p.zone, deepZ = z && z.x >= 15;
    switch (lp.shade) {
      case 'deep':
        p.home.x = Math.min(cap, p.home.x + 2); p.cushion = 1.5;
        if (z) z.x = Math.min(cap, z.x + (deepZ ? 3 : 2));
        break;
      case 'under':
        p.home.x = Math.max(frontX(p) + 0.3, p.home.x - 1.5); p.cushion = -0.6;
        if (z) z.x = Math.max(2, z.x - (deepZ ? 3 : 1.5));
        break;
      case 'inside':
        if (Math.abs(p.home.y) > 2) p.home.y -= sgn(p.home.y) * 1.5;
        p.lev = 1.1;
        if (z) z.y *= 0.82;
        break;
      case 'outside':
        p.home.y = clamp(p.home.y + sgn(p.home.y || 1) * 1.5, -SIDE + 2, SIDE - 2);
        p.lev = -0.6;
        if (z) z.y = clamp(z.y * 1.15, -SIDE + 3, SIDE - 3);
        break;
      default: break;
    }
  }
  if (lp.disguise === 'show') {
    // Walk the second level up into the gaps, as if everyone is coming.
    const up = ['MLB', 'OLB', 'SS', lp.defFormation === '43' ? 'CB3' : null];
    for (const k of up) {
      const p = lp.def[k];
      if (!p || p.home.x < frontX(p) + 2) continue;
      p.home.x = frontX(p) + 1.3;
      p.home.y = k === 'SS' ? sgn(p.home.y || 1) * 4.5 : clamp(p.home.y, -6, 6);
    }
  } else if (lp.disguise === 'back') {
    // The blitzers line up at their normal depth: the blitz is hidden, but they start farther away.
    for (const k of lp.blitz) {
      const p = lp.def[k];
      if (!p || p.home.x >= frontX(p) + 2.5) continue;
      p.home.x = k === 'SS' ? 10 : 5.4;
    }
  }
  for (const p of D) p.home.x = Math.max(frontX(p), Math.min(cap, p.home.x));
}

// ---------- every step before the snap ----------
// Once set, anyone whose spot changed (the man in motion, a defender following him, a shifted
// defense) walks to it; everyone else stands still.
export function shiftStep(lp) {
  if (!lp.set) return;
  let moved = false;
  for (const p of lp.players) {
    const F = p.follow;
    const tgt = F ? { x: p.home.x, y: clamp(F.r.y + F.off, -SIDE + 1.5, SIDE - 1.5) } : p.home;
    const d = dist(p, tgt);
    if (d < 0.1 && Math.hypot(p.vx, p.vy) < 0.2) continue;
    moved = true;
    seek(p, tgt, p.motion ? 0.6 : F ? 0.7 : 0.55, 0.8);
    const [vx, vy] = steer(lp, p, p.want.vx, p.want.vy);
    kin(p, vx, vy, p.top, DT);
  }
  if (moved) separate(lp);
}

// ---------- at the snap ----------
export function atSnap(lp) {
  const m = lp.motion && lp.off[lp.motion];
  if (m) {
    // His route starts from where he actually is, moving.
    m.home = { x: m.x, y: m.y };
    if (m.role === 'route' && m.routeName) { m.route = buildRoute(lp, m, m.routeName); m.wp = 0; }
    if (m.role === 'stalk') {
      let best = null;
      for (const q of lp.players) if (q.side === 'def' && (!best || dist(q, m) < dist(best, m))) best = q;
      m.assign = best;
    }
  }
  for (const q of Object.values(lp.def)) if (q.follow) { q.follow = null; q.home = { x: q.x, y: q.y }; }
  // The AI offense reads the defense's look: a shown blitz keeps the back in to block and
  // speeds up the quarterback's first read; a backed-out blitz sends the back out on his route.
  if (lp.disguise && lp.user === lp.d && lp.kind === 'pass') {
    const look = lp.disguise === 'show';
    const rb = lp.off.RB, mine = PLAY_ROUTES[lp.offCall]?.RB;
    if (rb && lp.offCall !== 'screen' && mine && mine !== 'block' && mine !== 'stalk') {
      if (look && rb.role === 'route') { rb.role = 'passblock'; rb.route = null; }
      else if (!look && rb.role === 'passblock') { rb.role = 'route'; rb.routeName = mine; rb.route = buildRoute(lp, rb, mine); rb.wp = 0; }
      lp.eligible = RECEIVERS.filter((k) => lp.off[k]?.role === 'route');
      lp.reads = null;
    }
    if (look) lp.readAt = Math.max(0.5, lp.readAt - 0.3);
  }
}
