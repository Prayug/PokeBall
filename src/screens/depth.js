// Depth chart: the lineup on an 11-column field, with swaps between slots and the bench.
import { unitRatings } from '../ratings.js';
import { render } from '../app.js';
import { S, save } from '../state.js';
import { P, esc, ovr, sprite, user } from '../ui.js';

function conditionTag(id) {
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
  const cell = ([k, col, row]) => {
    const id = me.lineup[k];
    if (id == null) return `<button class="dslot ${S.depthSel === k ? 'sel' : ''}" style="grid-column:${col};grid-row:${row}" data-act="dslot" data-slot="${k}"><span class="slot">${k}</span><span class="dn muted">Open</span></button>`;
    const p = P(id);
    const misfit = p.best[0] !== k && p.ovr[p.best[0]] - p.ovr[k] >= 6;
    return `<button class="dslot ${S.depthSel === k ? 'sel' : ''}" style="grid-column:${col};grid-row:${row}" data-act="dslot" data-slot="${k}">
      <span class="slot">${k}</span>${sprite(id, 'md')}<span class="dn">${esc(p.name)}</span>${ovr(p.ovr[k])}
      ${misfit ? `<span class="fitnote">Best at ${p.best[0]} ${p.ovr[p.best[0]]}</span>` : ''}${conditionTag(id)}</button>`;
  };
  return `<section class="depth">
    <p class="eyebrow">${esc(me.name)}</p>
    <h1>Depth chart</h1>
    <p class="lede">Tap a slot, then tap another slot or a bench Pokémon to swap them. Overalls update for the new position.</p>
    <div class="unitbar">${[['Pass offense', u.passOff], ['Run offense', u.runOff], ['Pass rush', u.passRush], ['Coverage', u.coverage], ['Run defense', u.runDef]]
      .map(([l, v]) => `<div><span class="muted small">${l}</span><b>${Math.round(v)}</b></div>`).join('')}</div>
    <div class="gridwrap"><div class="gridiron">
      <span class="gside def">Defense</span><span class="gside off">Offense</span>
      <div class="los" aria-hidden="true"></div>
      ${FORMATION.map(cell).join('')}
    </div></div>
    <div class="card"><h3>Bench</h3><div class="benchrow">${me.bench.length ? me.bench.map((id) => `<button class="dslot bench" data-act="dbench" data-id="${id}">${sprite(id, 'md')}<span class="dn">${esc(P(id).name)}</span>
      ${S.depthSel ? ovr(P(id).ovr[S.depthSel]) : `<span class="slot">${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</span>`}${conditionTag(id)}</button>`).join('') : '<p class="muted">No bench. Draft 28 rounds to carry 4 backups.</p>'}</div></div>
    ${Object.keys(S.league.condition ?? {}).length ? '<p class="small muted">Sore Pokémon start the next game below full energy, and the bench subs in as they tire. A Pokémon who is out sits the next game when the bench can cover him; with no bench he plays hurt.</p>' : ''}
    <div class="actions"><button class="btn" data-act="autodepth">Auto-arrange for best overall</button>
    <button class="btn primary" data-act="go" data-to="${S.league.phase === 'grades' ? 'grades' : 'season'}">Done</button></div>
  </section>`;
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
