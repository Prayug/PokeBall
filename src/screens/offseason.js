// Offseason: training camp report and roster cuts before the rookie draft.
import { ATTRS, SLOT_KEYS } from '../ratings.js';
import * as LG from '../league.js';
import { S } from '../state.js';
import { P, esc, ovr, sprite, teamBadge, user } from '../ui.js';
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
  return `<section class="offseason">
    <p class="eyebrow">Season ${L.season} offseason</p>
    <h1>Training camp and cuts</h1>
    <p class="lede">Pokémon who played the most snaps last season developed. Now cut exactly ${need}. Cut Pokémon join the free agent pool, where every team bids for them and for the undrafted, and the rookie draft fills whatever spots are left.</p>
    <div class="season-grid">
      <div class="col">
        <div class="card"><h3>Your camp report</h3>${mineCamp.length ? `<ul class="camp">${mineCamp.map((c) => `<li>${sprite(c.id, 'sm')}<span><b>${esc(P(c.id).name)}</b> <span class="slot">${c.slot}</span>${ovr(P(c.id).ovr[c.slot])}</span><span class="small good">${gainText(c.gains)}</span></li>`).join('')}</ul>` : '<p class="muted">Nobody played enough snaps to develop.</p>'}
          <p class="small muted">Each ${LG.SNAPS_PER_POINT} snaps is worth +2 to a rating the Pokémon's position uses, up to +8 a season and +${LG.GROWTH_CAP} in a career.</p></div>
        <div class="card"><h3>Your roster <span class="muted">${cuts.size} of ${need} cut</span></h3>
          <ul class="cutlist">${rows.map((id) => {
            const k = slotOf(id) ?? P(id).best[0];
            return `<li><label class="check ${cuts.has(id) ? 'cut' : ''}"><input type="checkbox" data-cut="${id}" ${cuts.has(id) ? 'checked' : ''}>
              <span class="slot">${slotOf(id) ?? 'BN'}</span>${sprite(id, 'xs')}<span class="cn">${esc(P(id).name)}</span>${ovr(P(id).ovr[k])}</label></li>`;
          }).join('')}</ul>
          <div class="actions"><button class="btn primary" data-act="finishoffseason" ${cuts.size === need ? '' : 'disabled'}>Confirm cuts and open free agency</button>
          <button class="btn" data-act="suggestcuts">Use suggested cuts</button></div></div>
      </div>
      <div class="col">
        ${hofClassHtml(L)}
        <div class="card"><h3>Around the league</h3><ul class="leaguecuts">${others.map((t) => `<li>${teamBadge(t)}<span>Cutting ${O.cuts[t.id].map((id) => esc(P(id).name)).join(', ')}</span></li>`).join('')}</ul></div>
        <div class="card"><h3>Top developers</h3><ul class="camp">${O.camp.slice().sort((a, b) => Object.values(b.gains).reduce((x, y) => x + y, 0) - Object.values(a.gains).reduce((x, y) => x + y, 0)).slice(0, 8)
          .map((c) => `<li>${sprite(c.id, 'xs')}<span>${esc(P(c.id).name)} ${teamBadge(L.teams[c.team])}</span><span class="small good">${gainText(c.gains)}</span></li>`).join('')}</ul></div>
      </div>
    </div>
  </section>`;
}

// This year's Hall of Fame class, announced as the season closes.
function hofClassHtml(L) {
  const cls = L.hof.filter((h) => h.season === L.season);
  if (!cls.length) return '';
  return `<div class="card"><h3>Hall of Fame class <span class="muted small">Season ${L.season}</span></h3>
    <ul class="awards hof">${cls.map((h) => `<li>${sprite(h.id, 'md')}<span><b>${esc(P(h.id).name)}</b> ${teamBadge(L.teams[h.team])}<span class="small muted">${esc(h.line)} · ${h.points} points, the bar is ${HOF_POINTS}</span></span></li>`).join('')}</ul>
    <button class="btn tiny" data-act="go" data-to="records">Open the record book</button></div>`;
}
