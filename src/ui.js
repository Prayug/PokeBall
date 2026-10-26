// Small view helpers shared by every screen: escaping, sprites, type chips, overall badges.
import { PLAYERS, roleLabel } from './ratings.js';
import { SPRITES } from './sprites.js';
import { ABILITIES, TYPE_COLORS, bestMatchup, effectLabel } from './types.js';
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
// Primary group, and Flex or Wildcard when the player is more than one job.
export function roleHtml(p) {
  if (!p) return '';
  const cls = p.wildcard ? 'wild' : p.flex ? 'flex' : '';
  return `<span class="role ${cls}">${esc(roleLabel(p))}</span>`;
}
export function teamBadge(t) { return `<span class="tbadge" style="--team:${t.color}">${esc(t.abbr)}</span>`; }
export function user() { return S.league?.teams.find((t) => t.user); }
export function abilityText(id) { const a = ABILITIES[P(id).ability]; return a ? a.text : 'No football effect'; }
export function bar(v) { return `<span class="bar"><span style="width:${Math.max(4, v)}%"></span></span>`; }

// One matchup as one verdict (who has the edge), with the type effects behind it underneath,
// rather than two effect labels to weigh against each other.
export function edgeRow(e) {
  const [mySlot, myId, thSlot, thId] = e.mine === 'off' ? [e.oSlot, e.oId, e.dSlot, e.dId] : [e.dSlot, e.dId, e.oSlot, e.oId];
  const [myMult, thMult] = e.mine === 'off' ? [e.oMult, e.dMult] : [e.dMult, e.oMult];
  return `<li class="edge ${e.edge > 0 ? 'good' : e.edge < 0 ? 'bad' : ''}">
    <span class="eside"><span class="slot">${mySlot}</span>${sprite(myId, 'xs')}<span class="en">${esc(P(myId).name)}</span></span>
    <span class="enet">${e.edge > 0 ? 'You have the edge' : e.edge < 0 ? 'They have the edge' : 'Even'}</span>
    <span class="eside"><span class="slot">${thSlot}</span>${sprite(thId, 'xs')}<span class="en">${esc(P(thId).name)}</span></span>
    <span class="ewhy small muted">${edgeWhy(myId, thId, myMult, thMult)}</span></li>`;
}
// The type effects behind a matchup, in words: "Ghost is super effective on Alakazam".
export function edgeWhy(myId, thId, myMult, thMult) {
  const line = (a, d, m) => `${bestMatchup(P(a), P(d)).type} is ${effectLabel(m)} on ${esc(P(d).name)}`;
  const parts = [myMult !== 1 && line(myId, thId, myMult), thMult !== 1 && line(thId, myId, thMult)].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Neutral both ways';
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
  return `<div class="pw-desc" style="--pw:${powerColor(id)}"><p class="small"><b>Power: ${esc(w.name)}</b>${w.signature ? ' <em class="pw-sig">Signature</em>' : ''} <span class="pw-at">${esc(w.at)}</span></p>
    <p class="small"><b>Boost:</b> ${esc(w.text)}</p><p class="small"><b>Zones in after</b> ${esc(w.zone)} · <b>lost on</b> ${esc(w.lose)}</p></div>`;
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
  // Each chip says whose power it is and how close it is; hovering, focusing or tapping it opens
  // the card: what it does, the trigger with the count so far, and what turns it off.
  const chip = (ti, r) => {
    const m = r.meter, w = r.power, name = PLAYERS[r.id].name, team = g.teams[ti].abbr;
    const pips = m.need <= 8 ? Array.from({ length: m.need }, (_, i) => `<i class="${i < m.have ? 'on' : ''}"></i>`).join('') : `<i class="num">${m.have}/${m.need}</i>`;
    const status = r.active ? `In the zone. Lost on ${w.lose.label}${m.need > 1 ? ` (${m.have} of ${m.need})` : ''}.`
      : `Zones in after ${w.zone.label}: ${m.have} of ${m.need} so far.`;
    const pop = `<span class="pw-pop" role="tooltip"><b>${esc(name)}</b> <span class="muted">${esc(team)} ${esc(r.slot ?? '')}${ti === us ? ' · yours' : ''}</span>
      <span class="pw-pname">${esc(w.name)}${w.signature ? ' <em class="pw-sig">Signature</em>' : ''}</span><span>${esc(w.text)}</span><span class="pw-st">${esc(status)}</span></span>`;
    return `<span class="pw-chip ${r.active ? 'on' : ''} ${ti === us ? 'mine' : 'theirs'}" tabindex="0" style="--pw:${powerColor(r.id)}" aria-label="${esc(`${name} (${team}), ${w.name}: ${w.text} ${status}`)}">
      <b>${esc(name)}</b> ${esc(w.name)}${r.active ? '' : `<span class="pw-pips" aria-hidden="true">${pips}</span>`}${pop}</span>`;
  };
  const mine = sidePowers(g, us).filter((r) => !r.dormant).slice(0, 5).map((r) => chip(us, r));
  const theirs = sidePowers(g, 1 - us).filter((r) => r.active).slice(0, 3).map((r) => chip(1 - us, r));
  if (!mine.length && !theirs.length) return '';
  return `<div class="cs-powers"><span class="pw-label">Powers</span>${mine.join('')}${theirs.length ? `<span class="pw-vs">${esc(g.teams[1 - us].abbr)}</span>${theirs.join('')}` : ''}</div>`;
}
