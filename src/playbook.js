// Play art for the call sheet: small SVG diagrams drawn from the same live-play setup the
// field uses (formation spots, routes, blocking, run lanes, zones, man and rush assignments),
// so the card shows exactly what the Pokémon will run.
import { createLivePlay, RECEIVERS, FORMATIONS, PLAY_FORMATION } from './live.js';
import { OFF_PLAYS } from './engine.js';

export const ART_COLORS = ['#ffd23f', '#4fc3f7', '#ff7a59', '#c792ff', '#7fdc93'];
const cache = new Map();

export function formationName(call, form = null) {
  const f = form && FORMATIONS[form] ? form : PLAY_FORMATION[call];
  return f ? FORMATIONS[f].name : OFF_PLAYS[call]?.kind === 'punt' ? 'Punt' : OFF_PLAYS[call]?.kind === 'fg' ? 'Field goal' : '';
}

// Diagram for a call. side: 'off' draws the offense's assignments, 'def' the defense's.
// form: the formation (offense) or front (defense) it will be run from, if not the default.
export function diagram(g, call, side, form = null) {
  const lk = (ti) => Object.values(g.teams[ti].lineup).join(',');
  const key = `${side}:${call}:${form}:${g.poss}:${lk(0)}|${lk(1)}`;
  let svg = cache.get(key);
  if (svg) return svg;
  if (side === 'off' && !['run', 'pass'].includes(OFF_PLAYS[call]?.kind)) { svg = kickArt(OFF_PLAYS[call]?.kind, OFF_PLAYS[call]); cache.set(key, svg); return svg; }
  const saved = g.rng;
  // Deep in the opponent's end the routes are cut short; draw them from midfield.
  const spot = g.spot;
  g.spot = 50;
  let lp;
  try { lp = side === 'off' ? createLivePlay(g, call, 'base', { formation: form }) : createLivePlay(g, 'slant', call, { defFormation: form }); } finally { g.rng = saved; g.spot = spot; }
  // Play frame to SVG: downfield is up, the field's width across.
  const X = (p) => (p.y).toFixed(2), Y = (p) => (-p.x).toFixed(2);
  const parts = [];
  parts.push('<line x1="-23" y1="0" x2="23" y2="0" class="los"/>');
  const arrowAt = (a, b, color, size = 1.5) => {
    const dx = b.y - a.y, dy = -(b.x - a.x), l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const bx = b.y, by = -b.x;
    return `<polygon points="${(bx + ux * size).toFixed(2)},${(by + uy * size).toFixed(2)} ${(bx - uy * size * 0.6).toFixed(2)},${(by + ux * size * 0.6).toFixed(2)} ${(bx + uy * size * 0.6).toFixed(2)},${(by - ux * size * 0.6).toFixed(2)}" fill="${color}"/>`;
  };
  const barAt = (a, b, color) => {
    const dx = b.y - a.y, dy = -(b.x - a.x), l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const bx = b.y, by = -b.x;
    return `<line x1="${(bx - uy * 1.2).toFixed(2)}" y1="${(by + ux * 1.2).toFixed(2)}" x2="${(bx + uy * 1.2).toFixed(2)}" y2="${(by - ux * 1.2).toFixed(2)}" stroke="${color}" stroke-width="0.7" stroke-linecap="round"/>`;
  };
  const path = (pts, color, w, end, dash = '') => {
    if (pts.length < 2) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p)} ${Y(p)}`).join(' ');
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>${end === 'arrow' ? arrowAt(a, b, color) : end === 'bar' ? barAt(a, b, color) : ''}`;
  };
  const O = lp.off, D = lp.def;
  if (side === 'off') {
    if (lp.kind === 'pass') {
      RECEIVERS.forEach((k, i) => {
        const p = O[k];
        if (!p) return;
        if (p.role === 'stalk' && p.assign) { parts.push(path([p.home, { x: (p.home.x + p.assign.home.x) / 2, y: (p.home.y + p.assign.home.y) / 2 }], '#cfd8e3', 0.55, 'bar')); return; }
        if (!p.route) { parts.push(path([p.home, { x: p.home.x - 1.6, y: p.home.y * 0.85 }], '#9fb3c8', 0.55, 'bar')); return; }
        const pts = [p.home, ...p.route.filter((w) => w.x != null)];
        parts.push(path(pts, ART_COLORS[i], 1, p.route[p.route.length - 1]?.stop ? 'bar' : 'arrow'));
      });
      if (O.QB) parts.push(path(lp.play.boot ? [O.QB.home, { x: lp.dropX, y: 1 }, { x: lp.dropX + 2.5, y: (O.TE ? -Math.sign(O.TE.home.y) : 1) * 8 }] : [O.QB.home, { x: lp.dropX, y: O.QB.home.y }], '#ffffff', 0.45, lp.play.boot ? 'arrow' : '', '0.8 0.6'));
    } else {
      const c = lp.carrier ?? O.RB, hole = lp.holeY ?? 0, dir = lp.play.dir;
      const lane = dir === 'counter' ? [c?.home, { x: (c?.home.x ?? -5) + 0.5, y: -Math.sign(hole) * 2 }, { x: -3, y: hole * 0.4 }, { x: 1.5, y: hole }, { x: 7, y: hole * 1.05 }]
        : dir === 'toss' || dir === 'outside' ? [c?.home, { x: -3.5, y: hole * 0.6 }, { x: 0, y: hole }, { x: 7, y: hole * 1.05 }]
          : [c?.home, { x: -3.5, y: hole * 0.35 }, { x: 1.5, y: hole }, { x: 7, y: hole * 1.05 }];
      if (dir === 'qbdraw' && c) lane.splice(1, 0, { x: c.home.x - 1.6, y: c.home.y });
      if (c) parts.push(path(lane, '#ffd23f', 1.3, 'arrow'));
      // Read option: the give (dashed) and the keep to the side of the unblocked end.
      if (dir === 'read' && O.QB) {
        parts.push(path([O.QB.home, { x: O.QB.home.x + 0.5, y: -Math.sign(hole || 1) * 4 }, { x: 1, y: -Math.sign(hole || 1) * 8.5 }, { x: 6, y: -Math.sign(hole || 1) * 9 }], '#ffd23f', 0.8, 'arrow', '1 0.7'));
        if (lp.readEnd) parts.push(`<circle cx="${X(lp.readEnd.home)}" cy="${Y(lp.readEnd.home)}" r="1.6" fill="none" stroke="#ff5a4f" stroke-width="0.4"/>`);
      }
      for (const b of Object.values(O)) {
        if (b.pull) parts.push(path([b.home, b.pull.via, { x: 2, y: hole * 0.95 }], '#ffffff', 0.6, 'bar'));
        else if (b.role === 'lead') parts.push(path([b.home, { x: 1, y: hole * 0.85 }], '#ffffff', 0.6, 'bar'));
      }
      for (const k of ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']) {
        const b = O[k];
        if (!b?.assign || b.pull) continue;
        const d = b.assign;
        parts.push(path([b.home, { x: (b.home.x + d.home.x) / 2 + 0.6, y: (b.home.y + d.home.y) / 2 }], '#cfd8e3', 0.5, 'bar'));
      }
    }
  } else {
    for (const p of Object.values(D)) {
      if (p.zone) {
        const z = p.zone, deep = z.x >= 15;
        parts.push(`<ellipse cx="${z.y.toFixed(2)}" cy="${(-z.x).toFixed(2)}" rx="${(z.r * 0.8).toFixed(2)}" ry="${(z.r * 0.55).toFixed(2)}" fill="${deep ? '#4fc3f7' : '#ffd23f'}" fill-opacity="0.22" stroke="${deep ? '#4fc3f7' : '#ffd23f'}" stroke-opacity="0.7" stroke-width="0.3"/>`);
        parts.push(path([p.home, z], deep ? '#4fc3f7' : '#ffd23f', 0.4, ''));
      } else if (p.man) parts.push(path([p.home, { x: p.man.home.x + 0.8, y: p.man.home.y }], '#ff9d7a', 0.45, '', '0.9 0.6'));
      else if (p.role === 'rush') {
        const blitz = !['LE', 'DE', 'DT1', 'DT2'].includes(p.slot);
        parts.push(path([p.home, { x: -3, y: p.home.y * 0.45 }], blitz ? '#ff5a4f' : '#e7b7b0', blitz ? 0.8 : 0.5, 'arrow'));
      }
    }
  }
  // Players: offense as circles, defense as crosses; the side you call is solid.
  for (const p of Object.values(O)) parts.push(`<circle cx="${X(p.home)}" cy="${Y(p.home)}" r="${side === 'off' ? 1.05 : 0.8}" class="o ${side === 'off' ? 'on' : ''}"/>`);
  for (const p of Object.values(D)) {
    const x = p.home.y, y = -p.home.x, s = side === 'def' ? 0.95 : 0.7;
    parts.push(`<path d="M${(x - s).toFixed(2)} ${(y - s).toFixed(2)}L${(x + s).toFixed(2)} ${(y + s).toFixed(2)}M${(x + s).toFixed(2)} ${(y - s).toFixed(2)}L${(x - s).toFixed(2)} ${(y + s).toFixed(2)}" class="x ${side === 'def' ? 'on' : ''}"/>`);
  }
  svg = `<svg class="pdiag" viewBox="-23 -24 46 33" aria-hidden="true">${parts.join('')}</svg>`;
  if (cache.size > 200) cache.clear();
  cache.set(key, svg);
  return svg;
}

function kickArt(kind, P = {}) {
  // Punt: a high arc downfield (a coffin-corner kick angles out short of the goal line).
  // Field goal: the uprights. A fake shows the run or the throw instead, the kick dashed.
  const arc = kind === 'punt' ? (P.aim === 'coffin' ? 'M0 9 Q4 -34 17 -20' : 'M0 9 Q0 -40 0 -24') : 'M0 9 Q0 -30 0 -25';
  const fake = !P.fake ? '' : kind === 'punt' ? '<path d="M0 9 L-6 4 L-9 -8" fill="none" stroke="#ffd23f" stroke-width="1.2"/><polygon points="-9.3,-10 -10.6,-7 -7.6,-7.4" fill="#ffd23f"/>'
    : '<path d="M0 7 L9 -9" fill="none" stroke="#ffd23f" stroke-width="1"/><polygon points="9.8,-10.6 7.4,-9.4 9.6,-7.6" fill="#ffd23f"/>';
  return `<svg class="pdiag" viewBox="-23 -24 46 33" aria-hidden="true"><line x1="-23" y1="0" x2="23" y2="0" class="los"/>
    ${kind === 'fg' ? '<path d="M-3.1 -24 L-3.1 -18 M3.1 -24 L3.1 -18 M-3.1 -21 L3.1 -21 M0 -21 L0 -17" stroke="#ffd23f" stroke-width="0.7" fill="none"/>' : ''}
    <path d="${arc}" fill="none" stroke="#ffffff" stroke-width="0.6" stroke-dasharray="1 0.8" ${P.fake ? 'opacity="0.35"' : ''}/>${fake}<circle cx="0" cy="9" r="1.05" class="o on"/></svg>`;
}
