// Small view helpers shared by every screen: escaping, sprites, type chips, overall badges.
import { PLAYERS } from './ratings.js';
import { SPRITES } from './sprites.js';
import { ABILITIES, TYPE_COLORS, effectLabel } from './types.js';
import { S } from './state.js';
import { POWER_OF, powerColor, powerText, sidePowers, worksAt } from './powers.js';

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

// A kicker or punter from kickingUnit(): sprite, name, rating and range.
export function kickerHtml(k) {
  return k ? `${sprite(k.id, 'xs')}<span>${esc(P(k.id).name)}</span> ${ovr(k.ovr)} <span class="small muted krange">${k.range}-yd range</span>` : '<span class="muted">None</span>';
}
export function punterHtml(p) {
  return p ? `${sprite(p.id, 'xs')}<span>${esc(P(p.id).name)}</span> ${ovr(p.ovr)} <span class="small muted krange">about ${p.net} yds a punt</span>` : '<span class="muted">None</span>';
}
// Where a field goal range starts: the yard line of the snap, a 17-yard kick shorter.
export const rangeLine = (range) => Math.max(1, range - 17);

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- powers ----------
// A Pokémon's power on its scouting card: what it does, where it works, and how it is earned and lost.
export function powerHtml(id) {
  const w = powerText(id);
  if (!w) return '<p class="small muted">No power.</p>';
  return `<div class="pw-desc" style="--pw:${powerColor(id)}"><p class="small"><b>Power: ${esc(w.name)}</b>${w.signature ? ' <em class="pw-sig">Signature</em>' : ''} <span class="muted">(at ${esc(w.group)})</span></p>
    <p class="small">${esc(w.text)}</p><p class="small muted">Zones in after ${esc(w.zone)}; lost on ${esc(w.lose)}.</p></div>`;
}
// A small tag for a lineup spot: the power's name, dimmed where it does not work.
export function powerTag(id, slot) {
  const w = POWER_OF[id];
  if (!w) return '';
  const on = worksAt(id, slot);
  return `<span class="pw-tag ${on ? '' : 'dormant'}" style="--pw:${powerColor(id)}" title="${esc(on ? `${w.name}: ${w.text}` : `${w.name} only works at ${powerText(id).group}`)}">${esc(w.name)}</span>`;
}
// The powers between plays: your carriers with their meters, and the other side's that are active.
export function powersRow(g, us) {
  if (!g.pw) return '';
  const chip = (ti, r) => {
    const m = r.meter;
    const pips = m.need <= 8 ? Array.from({ length: m.need }, (_, i) => `<i class="${i < m.have ? 'on' : ''}"></i>`).join('') : `<i class="num">${m.have}/${m.need}</i>`;
    return `<span class="pw-chip ${r.active ? 'on' : ''} ${ti === us ? 'mine' : 'theirs'}" style="--pw:${powerColor(r.id)}" title="${esc(`${PLAYERS[r.id].name}, ${r.power.name}: ${r.power.text} ${m.label}.`)}">
      <b>${esc(PLAYERS[r.id].name)}</b> ${esc(r.power.name)}${r.active ? '' : `<span class="pw-pips" aria-label="${esc(m.label)}">${pips}</span>`}</span>`;
  };
  const mine = sidePowers(g, us).filter((r) => !r.dormant).slice(0, 5).map((r) => chip(us, r));
  const theirs = sidePowers(g, 1 - us).filter((r) => r.active).slice(0, 3).map((r) => chip(1 - us, r));
  if (!mine.length && !theirs.length) return '';
  return `<div class="cs-powers"><span class="pw-label">Powers</span>${mine.join('')}${theirs.length ? `<span class="pw-vs">${esc(g.teams[1 - us].abbr)}</span>${theirs.join('')}` : ''}</div>`;
}
