// Depth chart: the lineup on an 11-column field, with swaps between slots and the bench.
import { SLOT, unitRatings } from '../ratings.js';
import { kickingUnit } from '../engine.js';
import { render } from '../app.js';
import { S, save } from '../state.js';
import { P, esc, ovr, powerTag, rangeLine, roleHtml, sprite, user } from '../ui.js';

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
export function renderDepth() {
  const me = user();
  const u = unitRatings(me.lineup);
  const kick = kickingUnit(me.lineup);
  const cell = ([k, col, row]) => {
    const id = me.lineup[k];
    if (id == null) return `<button class="dslot ${SLOT[k].side} ${S.depthSel === k ? 'sel' : ''}" style="grid-column:${col};grid-row:${row}" data-act="dslot" data-slot="${k}" aria-pressed="${S.depthSel === k}"><span class="slot">${k}</span><span class="dn muted">Open</span></button>`;
    const p = P(id);
    const gap = p.ovr[p.best[0]] - p.ovr[k];
    const misfit = p.best[0] !== k && gap >= 6;
    const note = SLOT[k].group === p.primary
      ? `Best at ${p.best[0]} ${p.ovr[p.best[0]]}`
      : `Best at ${p.primary} · ${p.best[0]} ${p.ovr[p.best[0]]}`;
    return `<button class="dslot ${SLOT[k].side} ${S.depthSel === k ? 'sel' : ''}" style="grid-column:${col};grid-row:${row}" data-act="dslot" data-slot="${k}" draggable="true" aria-pressed="${S.depthSel === k}" aria-label="${k}: ${esc(p.name)}, ${p.ovr[k]} overall">
      <span class="slot">${k}</span>${sprite(id, 'md')}<span class="dn">${esc(p.name)}</span>${roleHtml(p)}${ovr(p.ovr[k])}
      ${misfit ? `<span class="fitnote">${note}</span>` : ''}${powerTag(id, k)}${conditionTag(id)}</button>`;
  };
  return `<section class="depth">
    <p class="eyebrow">${esc(me.name)}</p>
    <h1>Depth chart</h1>
    <p class="lede">Drag a Pokémon onto another slot or off the bench to swap them, or tap (or Enter) one and then the other. Overalls update for the new position.</p>
    <div class="unitbar">${[['Pass offense', u.passOff], ['Run offense', u.runOff], ['Pass rush', u.passRush], ['Coverage', u.coverage], ['Run defense', u.runDef]]
      .map(([l, v]) => `<div><span class="muted small">${l}</span><b>${Math.round(v)}</b></div>`).join('')}
      <div><span class="muted small">Kicker</span><b>${kick.k ? kick.k.ovr : '–'}</b>${kick.k ? `<span class="muted small" title="Makes half his kicks from ${kick.k.range} yards: snaps at the opponent's ${rangeLine(kick.k.range)}">${kick.k.range}-yd range</span>` : ''}</div>
      <div><span class="muted small">Punter</span><b>${kick.p ? kick.p.ovr : '–'}</b>${kick.p ? `<span class="muted small">about ${kick.p.net} yds</span>` : ''}</div></div>
    <div class="gridwrap"><div class="gridiron">
      <span class="gside def">Defense</span><span class="gside off">Offense</span>
      <div class="los" aria-hidden="true"></div>
      <h4 class="gunit off">Offense</h4><h4 class="gunit def">Defense</h4><h4 class="gunit st">Special teams</h4>
      ${FORMATION.map(cell).join('')}
    </div></div>
    <div class="card"><h3>Bench</h3><div class="benchrow">${me.bench.length ? me.bench.map((id) => `<button class="dslot bench" data-act="dbench" data-id="${id}" draggable="true">${sprite(id, 'md')}<span class="dn">${esc(P(id).name)}</span>
      ${S.depthSel ? ovr(P(id).ovr[S.depthSel]) : `<span class="slot">${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</span>`}${roleHtml(P(id))}${conditionTag(id)}</button>`).join('') : '<p class="muted">No bench. Draft 28 rounds to carry 4 backups.</p>'}</div></div>
    ${Object.keys(S.league.injuries ?? {}).some((id) => me.roster.includes(Number(id))) ? '<p class="small muted">Injured Pokémon miss games until they heal. Leave them in the lineup and the best healthy backup covers each game; with no bench, a starter from the other side of the ball plays both ways.</p>' : ''}
    ${Object.keys(S.league.condition ?? {}).length ? '<p class="small muted">Sore Pokémon start the next game below full energy, and the bench subs in as they tire. A Pokémon who is out sits the next game when the bench can cover him; with no bench he plays hurt.</p>' : ''}
    <div class="actions"><button class="btn" data-act="autodepth">Auto-arrange for best overall</button>
    <button class="btn primary" data-act="go" data-to="${S.league.phase === 'grades' ? 'grades' : 'season'}">Done</button></div>
  </section>`;
}

// Dragging is the same swap as two taps: the picked-up card is selected, the drop target tapped.
let dragFrom = null;
if (typeof document !== 'undefined') {
  const target = (e) => e.target.closest?.('.depth .dslot');
  document.addEventListener('dragstart', (e) => {
    const el = target(e);
    if (!el) return;
    dragFrom = el;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.slot ?? el.dataset.id ?? '');
    el.classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => {
    const el = target(e);
    if (!dragFrom || !el || el === dragFrom || (el.dataset.act === 'dbench' && dragFrom.dataset.act === 'dbench')) return;
    e.preventDefault();
    document.querySelectorAll('.depth .dslot.over').forEach((x) => x !== el && x.classList.remove('over'));
    el.classList.add('over');
  });
  document.addEventListener('dragend', () => { dragFrom?.classList.remove('dragging'); document.querySelectorAll('.depth .dslot.over').forEach((x) => x.classList.remove('over')); dragFrom = null; });
  document.addEventListener('drop', (e) => {
    const el = target(e), from = dragFrom;
    if (!from || !el || el === from) return;
    e.preventDefault();
    dragFrom = null;
    // A bench card dropped on a slot is the slot tapped first, then the bench card.
    const [a, b] = from.dataset.act === 'dbench' ? [el, from] : [from, el];
    S.depthSel = null;
    depthClick(a, false);
    depthClick(b);
  });
}

export function depthClick(el, commit = true) {
  const me = user();
  if (el.dataset.act === 'dslot') {
    const k = el.dataset.slot;
    if (!S.depthSel) { S.depthSel = k; if (commit) render(); return; }
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
