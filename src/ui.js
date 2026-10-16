// Small view helpers shared by every screen: escaping, sprites, type chips, overall badges.
import { PLAYERS } from './ratings.js';
import { SPRITES } from './sprites.js';
import { ABILITIES, TYPE_COLORS, effectLabel } from './types.js';
import { S } from './state.js';

// ---------- small view helpers ----------
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const P = (id) => PLAYERS[id];
export const ATTR_SHORT = { spd: 'SPD', acl: 'ACL', agi: 'AGI', str: 'STR', blk: 'BLK', rush: 'RSH', arm: 'THR', acc: 'ACC', hnd: 'CTH', cov: 'COV', tkl: 'TKL', awr: 'AWR', sta: 'STA', kpw: 'KPW', kac: 'KAC' };
export function sprite(id, cls = '') {
  return `<img class="spr ${cls}" src="${SPRITES[id]}" alt="${esc(P(id).name)}" loading="lazy" draggable="false">`;
}
export function typeChips(types) {
  return types.map((t) => `<span class="type" style="--tc:${TYPE_COLORS[t]}">${t}</span>`).join('');
}
function ovrTone(v) { return v >= 90 ? 'elite' : v >= 78 ? 'good' : v >= 62 ? 'ok' : 'low'; }
export function ovr(v) { return `<span class="ovr ${ovrTone(v)}">${v}</span>`; }
export function teamBadge(t) { return `<span class="tbadge" style="--team:${t.color}">${esc(t.abbr)}</span>`; }
export function user() { return S.league?.teams.find((t) => t.user); }
export function abilityText(id) { const a = ABILITIES[P(id).ability]; return a ? a.text : 'No football effect'; }
export function bar(v) { return `<span class="bar"><span style="width:${Math.max(4, v)}%"></span></span>`; }

export function edgeRow(e) {
  const [mySlot, myId, thSlot, thId] = e.mine === 'off' ? [e.oSlot, e.oId, e.dSlot, e.dId] : [e.dSlot, e.dId, e.oSlot, e.oId];
  const [myMult, thMult] = e.mine === 'off' ? [e.oMult, e.dMult] : [e.dMult, e.oMult];
  const tag = (m) => (effectLabel(m) ? `<span class="eff ${m > 1 ? 'se' : m === 0 ? 'ne' : 'nve'}">${effectLabel(m)}</span>` : '<span class="eff">neutral</span>');
  return `<li class="edge ${e.edge > 0 ? 'good' : e.edge < 0 ? 'bad' : ''}">
    <span class="eside"><span class="slot">${mySlot}</span>${sprite(myId, 'xs')}<span class="en">${esc(P(myId).name)}</span>${tag(myMult)}</span>
    <span class="vsx">vs</span>
    <span class="eside"><span class="slot">${thSlot}</span>${sprite(thId, 'xs')}<span class="en">${esc(P(thId).name)}</span>${tag(thMult)}</span></li>`;
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
