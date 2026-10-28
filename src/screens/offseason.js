// Offseason: training camp report and roster cuts before the rookie draft.
import { ATTRS, SLOT_KEYS } from '../ratings.js';
import * as LG from '../league.js';
import { S } from '../state.js';
import { P, esc, monCard, teamBadge, user } from '../ui.js';
import { HOF_POINTS } from '../records.js';

// ---------- offseason ----------
export function renderOffseason() {
  const L = S.league, me = user(), O = L.offseason;
  if (!O) return '<section><p>No offseason in progress.</p></section>';
  const need = Math.min(LG.CUTS, me.roster.length);
  S.offCuts ??= new Set(O.cuts[me.id]);
  const cuts = S.offCuts;
  const mineCamp = O.camp.filter((c) => c.team === me.id);
  const gainText = (g) => Object.entries(g).map(([k, v]) => `+${v} ${ATTRS[k]}`).join(', ');
  const slotOf = (id) => Object.keys(me.lineup).find((k) => me.lineup[k] === id);
  const rows = me.roster.slice().sort((a, b) => {
    const sa = slotOf(a), sb = slotOf(b);
    return (sa ? SLOT_KEYS.indexOf(sa) : 99) - (sb ? SLOT_KEYS.indexOf(sb) : 99);
  });
  const others = L.teams.filter((t) => !t.user);
  const campCard = (c, big) => `<article class="dev-card">${monCard(c.id, { slot: c.slot, size: big ? 'sm' : 'sm' })}${c.team != null && c.team !== me.id ? teamBadge(L.teams[c.team]) : ''}<span class="small good">${gainText(c.gains)}</span></article>`;
  return `<section class="offseason">
    <p class="eyebrow">Season ${L.season} offseason</p>
    <h1>Training camp and cuts</h1>
    <p class="lede">Cut exactly ${need}.</p>
    <div class="season-grid">
      <div class="col">
        <div class="card"><h3>Your camp report</h3>${mineCamp.length ? `<div class="dev-cards">${mineCamp.map((c) => campCard(c, true)).join('')}</div>` : '<p class="muted">Nobody played enough snaps to develop.</p>'}
          <p class="small muted">Each ${LG.SNAPS_PER_POINT} snaps is worth +2 to a rating the Pokémon's position uses, up to +8 a season and +${LG.GROWTH_CAP} in a career.</p></div>
        <div class="card"><h3>Your roster <span class="muted">${cuts.size} of ${need} cut</span></h3>
          <div class="cut-cards">${rows.map((id) => {
            const k = slotOf(id) ?? P(id).best[0];
            return `<article class="cut-card ${cuts.has(id) ? 'cut' : ''}"><label class="check">
              <input type="checkbox" data-cut="${id}" ${cuts.has(id) ? 'checked' : ''}>
              ${monCard(id, { slot: k, size: 'sm' })}
              <span class="cutmark">${cuts.has(id) ? 'Cut' : 'Keep'}</span></label></article>`;
          }).join('')}</div>
          <div class="actions"><button class="btn primary" data-act="finishoffseason" ${cuts.size === need ? '' : 'disabled'}>Confirm cuts and open free agency</button>
          <button class="btn" data-act="suggestcuts">Use suggested cuts</button></div></div>
      </div>
      <div class="col">
        ${hofClassHtml(L)}
        <div class="card"><h3>Around the league</h3><div class="dev-cards">${others.map((t) => `<article class="dev-card">${teamBadge(t)}<span><b>${esc(t.name)}</b><span class="small muted">Cutting ${O.cuts[t.id].map((id) => esc(P(id).name)).join(', ')}</span></span></article>`).join('')}</div></div>
        <div class="card"><h3>Top developers</h3><div class="dev-cards">${O.camp.slice().sort((a, b) => Object.values(b.gains).reduce((x, y) => x + y, 0) - Object.values(a.gains).reduce((x, y) => x + y, 0)).slice(0, 8)
          .map((c) => campCard(c, false)).join('')}</div></div>
      </div>
    </div>
  </section>`;
}

// This year's Hall of Fame class, announced as the season closes.
function hofClassHtml(L) {
  const cls = L.hof.filter((h) => h.season === L.season);
  if (!cls.length) return '';
  return `<div class="card"><h3>Hall of Fame class <span class="muted small">Season ${L.season}</span></h3>
    <ul class="awards hof">${cls.map((h) => `<li>${monCard(h.id, { size: 'sm' })} ${teamBadge(L.teams[h.team])}<span class="small muted">${esc(h.line)} · ${h.points} points, the bar is ${HOF_POINTS}</span></li>`).join('')}</ul>
    <button class="btn tiny" data-act="go" data-to="records">Open the record book</button></div>`;
}
