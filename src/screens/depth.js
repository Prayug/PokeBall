// Depth chart: the lineup on an 11-column field, with swaps between slots and the bench.
import { ATTRS, SLOT, unitRatings } from '../ratings.js';
import { kickingUnit } from '../engine.js';
import { render } from '../app.js';
import { S, save } from '../state.js';
import { P, coachTip, esc, monCard, ovr, powerTag, rangeLine, roleHtml, sprite, user } from '../ui.js';

function conditionTag(id) {
  const inj = S.league?.injuries?.[id];
  if (inj) return `<span class="cond hurt" title="Hurt ${esc(inj.when)}">Injured, ${inj.weeks} ${inj.weeks === 1 ? 'week' : 'weeks'}</span>`;
  const c = S.league?.condition?.[id];
  if (!c) return '';
  return c.out ? '<span class="cond out">Out this week</span>' : `<span class="cond sore">Sore ${c.energy}%</span>`;
}

// ---------- depth chart ----------
// [slot, column, row] on an 11-column field seen from behind the offense; row 4 is the line of scrimmage.
const FORMATION = [
  ['FS', 4, 1], ['SS', 8, 1],
  ['CB1', 1, 2], ['CB3', 2, 2], ['MLB', 6, 2], ['OLB', 9, 2], ['CB2', 11, 2],
  ['DE', 3, 3], ['DT2', 5, 3], ['DT1', 7, 3], ['LE', 9, 3],
  ['WR1', 1, 5], ['LT', 4, 5], ['LG', 5, 5], ['C', 6, 5], ['RG', 7, 5], ['RT', 8, 5], ['TE', 9, 5], ['WR2', 11, 5],
  ['WR3', 2, 6], ['QB', 6, 6],
  ['RB', 6, 7], ['K', 3, 7], ['P', 9, 7],
];
const UNITS = [['all', 'Full lineup'], ['off', 'Offense'], ['def', 'Defense'], ['st', 'Special teams']];
export function renderDepth() {
  const me = user();
  const u = unitRatings(me.lineup);
  const kick = kickingUnit(me.lineup);
  const unit = UNITS.some(([k]) => k === S.depthUnit) ? S.depthUnit : 'all';
  const cell = ([k, col, row]) => {
    const id = me.lineup[k];
    const place = unit === 'all' ? `style="grid-column:${col};grid-row:${row}"` : '';
    if (id == null) return `<button class="dslot ${SLOT[k].side} ${S.depthSel === k ? 'sel' : ''}" ${place} data-act="dslot" data-slot="${k}" data-drop="${k}" data-drag="slot:${k}" draggable="true"><span class="slot">${k}</span><span class="dn muted">Open</span></button>`;
    const p = P(id);
    const gap = p.ovr[p.best[0]] - p.ovr[k];
    const misfit = p.best[0] !== k && gap >= 6;
    const note = SLOT[k].group === p.primary
      ? `Best at ${p.best[0]} ${p.ovr[p.best[0]]}`
      : `Best at ${p.primary} · ${p.best[0]} ${p.ovr[p.best[0]]}`;
    return `<button class="dslot ${SLOT[k].side} ${S.depthSel === k ? 'sel' : ''}" ${place} data-act="dslot" data-slot="${k}" data-drop="${k}" data-drag="slot:${k}" draggable="true">
      <span class="slot">${k}</span>${sprite(id, 'md')}<span class="dn">${esc(p.name)}</span>${roleHtml(p)}${ovr(p.ovr[k])}
      ${misfit ? `<span class="fitnote">${note}</span>` : ''}${powerTag(id, k)}${conditionTag(id)}</button>`;
  };
  const shown = FORMATION.filter(([k]) => unit === 'all' || SLOT[k].side === unit);
  return `<section class="depth">
    <p class="eyebrow">${esc(me.name)}</p>
    <h1>Lineup</h1>
    ${coachTip('depth', 'Tap a position, then a replacement. You can also drag a Pokémon onto a spot. The rating is for that position.')}
    <div class="unitbar">${[['Pass offense', u.passOff], ['Run offense', u.runOff], ['Pass rush', u.passRush], ['Coverage', u.coverage], ['Run defense', u.runDef]]
      .map(([l, v]) => `<div><span class="muted small">${l}</span><b>${Math.round(v)}</b></div>`).join('')}
      <div><span class="muted small">Kicker</span><b>${kick.k ? kick.k.ovr : '–'}</b>${kick.k ? `<span class="muted small" title="Makes half his kicks from ${kick.k.range} yards: snaps at the opponent's ${rangeLine(kick.k.range)}">${kick.k.range}-yd range</span>` : ''}</div>
      <div><span class="muted small">Punter</span><b>${kick.p ? kick.p.ovr : '–'}</b>${kick.p ? `<span class="muted small">about ${kick.p.net} yds</span>` : ''}</div></div>
    <div class="seg gm-row" role="tablist">${UNITS.map(([k, l]) => `<button class="btn tiny ${unit === k ? 'on' : ''}" data-act="dunit" data-unit="${k}" role="tab" aria-selected="${unit === k}">${l}</button>`).join('')}</div>
    <div class="gridwrap"><div class="gridiron ${unit === 'all' ? '' : 'flow'}">
      ${unit === 'all' ? '<span class="gside def">Defense</span><span class="gside off">Offense</span><div class="los" aria-hidden="true"></div>' : ''}
      <h4 class="gunit off">Offense</h4><h4 class="gunit def">Defense</h4><h4 class="gunit st">Special teams</h4>
      ${shown.map(cell).join('')}
    </div></div>
    ${compareHtml(me)}
    <div class="card"><h3>Bench</h3><div class="benchrow">${me.bench.length ? me.bench.map((id) => `<button class="dslot bench" data-act="dbench" data-id="${id}" data-drag="id:${id}" draggable="true">${monCard(id, { slot: S.depthSel, size: 'sm' })}${conditionTag(id)}</button>`).join('') : '<p class="muted">No bench. Draft 28 rounds to carry 4 backups.</p>'}</div></div>
    <details class="card"><summary>Injuries and soreness</summary>
      <p class="small muted">Injured Pokémon miss games until they heal. Leave them in the lineup and the best healthy backup covers each game. With no bench, a starter from the other side of the ball plays both ways. Sore Pokémon start the next game below full energy.</p>
    </details>
    <div class="actions"><button class="btn" data-act="autodepth">Auto-arrange for best overall</button>
    <button class="btn primary" data-act="go" data-to="${S.league.phase === 'grades' ? 'grades' : 'season'}">Done</button></div>
  </section>`;
}
function compareHtml(me) {
  const slot = S.depthSel;
  if (!slot || me.lineup[slot] == null) return '';
  const id = me.lineup[slot];
  const alts = [...Object.entries(me.lineup).filter(([k, pid]) => k !== slot && pid != null), ...me.bench.map((pid) => ['BN', pid])];
  const ranked = alts.map(([k, pid]) => ({ k, pid, ovr: P(pid).ovr[slot] })).sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  return `<div class="card depth-compare"><h3>${esc(P(id).name)} at ${esc(slot)}</h3>
    <div class="depth-now">${monCard(id, { slot })}<button class="btn tiny" data-act="profile" data-id="${id}">Full card</button></div>
    ${ranked.length ? `<h4>Other options at ${esc(slot)}</h4><ul class="depth-alts">${ranked.map((a) => `<li><button class="alt" ${a.k === 'BN' ? `data-act="dbench" data-id="${a.pid}"` : `data-act="dslot" data-slot="${a.k}"`}>${monCard(a.pid, { slot, size: 'sm' })}<span class="small">${esc(swapNote(slot, id, a.pid))}</span></button></li>`).join('')}</ul>` : ''}
  </div>`;
}
function swapNote(slot, outId, inId) {
  const w = SLOT[slot]?.w ?? {};
  const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0];
  const dO = P(inId).ovr[slot] - P(outId).ovr[slot];
  const dA = top ? Math.round((P(inId).attrs[top] ?? 0) - (P(outId).attrs[top] ?? 0)) : 0;
  const ovrBit = `${dO >= 0 ? '+' : ''}${dO} overall at ${slot}`;
  if (!top) return ovrBit;
  return `${ovrBit}. ${ATTRS[top]} ${dA >= 0 ? '+' : ''}${dA}.`;
}

export function depthDrop(from, slot) {
  const me = user();
  if (!me || !SLOT[slot]) return;
  if (from.startsWith('slot:')) {
    const other = from.slice(5);
    if (other !== slot && SLOT[other]) [me.lineup[slot], me.lineup[other]] = [me.lineup[other], me.lineup[slot]];
  } else if (from.startsWith('id:')) {
    const id = Number(from.slice(3));
    if (!me.bench.includes(id)) return;
    const out = me.lineup[slot];
    me.lineup[slot] = id;
    me.bench = me.bench.map((x) => (x === id ? out : x));
  }
  S.depthSel = slot;
  save();
  render();
}
export function depthClick(el) {
  const me = user();
  if (el.dataset.act === 'dslot') {
    const k = el.dataset.slot;
    if (!S.depthSel) { S.depthSel = k; render(); return; }
    if (S.depthSel !== k) { [me.lineup[S.depthSel], me.lineup[k]] = [me.lineup[k], me.lineup[S.depthSel]]; }
    S.depthSel = null;
  } else {
    if (!S.depthSel) return;
    const id = Number(el.dataset.id);
    const out = me.lineup[S.depthSel];
    me.lineup[S.depthSel] = id;
    me.bench = me.bench.map((x) => (x === id ? out : x));
    S.depthSel = null;
  }
  save(); render();
}
