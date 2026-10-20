// Draft room and draft grades, with the post-draft trade offer.
import { ATTRS, BASELINE, DEF_SLOTS, OFF_SLOTS, PLAYERS, SLOT, SLOT_KEYS, ST_SLOTS } from '../ratings.js';
import { TYPE_COLORS, TYPE_TRAITS } from '../types.js';
import * as LG from '../league.js';
import { SCHEMES, coachLabel } from '../coach.js';
import { render, setScreen } from '../app.js';
import { S, clearTimers, save, timers } from '../state.js';
import { ATTR_SHORT, P, abilityText, bar, esc, ovr, powerHtml, sprite, teamBadge, typeChips, user } from '../ui.js';
import { shareCardHtml } from './share.js';

// ---------- draft ----------
function boardIds() {
  const L = S.league, me = user(), d = S.draft;
  const q = d.search.trim().toLowerCase();
  // Drafted Pokémon leave the board, and so do ones this team can't take (type cap).
  let ids = LG.available(L).filter((id) => !LG.blockReason(L, me, id) && (!q || P(id).name.toLowerCase().includes(q)) && (!d.type || P(id).types.includes(d.type)) && (!d.gen || P(id).gen === Number(d.gen)));
  const open = LG.openSlots(me);
  const fit = (id) => {
    if (d.rate !== 'fit') return { slot: d.rate, v: P(id).ovr[d.rate] };
    const slots = open.length ? open : SLOT_KEYS;
    const s = slots.reduce((a, b) => (SLOT[b].value * (P(id).ovr[b] - BASELINE[b]) > SLOT[a].value * (P(id).ovr[a] - BASELINE[a]) ? b : a));
    return { slot: s, v: P(id).ovr[s], score: SLOT[s].value * (P(id).ovr[s] - BASELINE[s]) };
  };
  const rows = ids.map((id) => ({ id, fit: fit(id) }));
  const key = d.sort;
  rows.sort((a, b) => key === 'fit' ? (b.fit.score ?? b.fit.v) - (a.fit.score ?? a.fit.v) || b.fit.v - a.fit.v
    : key === 'name' ? P(a.id).name.localeCompare(P(b.id).name) : P(b.id).attrs[key] - P(a.id).attrs[key]);
  return rows;
}

export function boardRowsHtml() {
  const L = S.league, me = user();
  const myTurn = LG.currentPick(L)?.team === me.id;
  const rows = boardIds();
  if (!rows.length) return `<tr><td colspan="16" class="empty">No Pokémon match. Clear the search, type or generation filter.</td></tr>`;
  return rows.map(({ id, fit }) => {
    const p = P(id);
    const block = LG.blockReason(L, me, id);
    return `<tr class="${S.draft.sel === id ? 'sel' : ''}" data-act="select" data-id="${id}">
      <td class="pk">${sprite(id, 'sm')}<span><b>${esc(p.name)}</b>${p.legendary ? '<i class="leg">Legendary</i>' : ''}<span class="types">${typeChips(p.types)}</span></span></td>
      <td class="fit"><span class="slot">${fit.slot}</span>${ovr(fit.v)}</td>
      ${Object.keys(ATTRS).map((k) => `<td class="num a-${k}">${p.attrs[k]}</td>`).join('')}
      <td><button class="btn tiny ${myTurn && !block ? 'primary' : ''}" data-act="draftbtn" data-id="${id}" ${myTurn && !block ? '' : 'disabled'} title="${block ? esc(block) : ''}">${block ? 'Blocked' : 'Draft'}</button></td>
    </tr>`;
  }).join('');
}

export function renderDraft() {
  const L = S.league, me = user(), d = S.draft;
  const pk = LG.currentPick(L);
  const onClock = pk ? L.teams[pk.team] : null;
  const myTurn = onClock?.id === me.id;
  const types = Object.keys(TYPE_COLORS);
  const head = (k, label) => `<th class="num a-${k}"><button class="sort ${d.sort === k ? 'on' : ''}" data-act="sort" data-key="${k}" title="${ATTRS[k] ?? ''}">${label}</button></th>`;
  const recent = L.picks.slice(0, L.pickIndex).slice(-10).reverse();
  return `<section class="draft">
    <div class="draft-head">
      <div>
        <p class="eyebrow">${(L.season ?? 1) > 1 ? `Season ${L.season} rookie draft · ` : ''}Round ${pk?.round ?? '-'} of ${L.picks[L.picks.length - 1].round} · Pick ${L.pickIndex + 1} of ${L.picks.length}</p>
        <h1>${myTurn ? 'You are on the clock' : `${esc(onClock?.name ?? '')} are picking`}</h1>
        ${me.coach !== 'balanced' && SCHEMES[me.coach] ? `<p class="small muted">${esc(SCHEMES[me.coach].name)}: auto-picks reach for ${schemeGroups(me.coach)}.</p>` : ''}
      </div>
      <div class="clockbox ${myTurn ? 'live' : ''}">
        ${myTurn && S.setup.clock && !d.autoAll ? `<span class="clocknum" id="pick-clock">${d.clock}</span><span>seconds, then auto-pick</span>` : myTurn ? '<span>Take your time</span>' : '<span class="dots">AI drafting</span>'}
      </div>
      <div class="head-actions">
        <button class="btn" data-act="autodraft">${d.autoAll ? 'Stop auto-draft' : 'Auto-draft the rest'}</button>
      </div>
    </div>
    <div class="draft-grid">
      <div class="board card">
        <div class="filters">
          <input id="d-search" type="search" placeholder="Search Pokémon" value="${esc(d.search)}" aria-label="Search Pokémon">
          <select id="d-type" aria-label="Type filter"><option value="">All types</option>${types.map((t) => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="d-gen" aria-label="Generation filter"><option value="">All gens</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${String(d.gen ?? '') === String(n) ? 'selected' : ''}>Gen ${n}</option>`).join('')}</select>
          <select id="d-rate" aria-label="Rate at position"><option value="fit" ${d.rate === 'fit' ? 'selected' : ''}>Best open slot</option>${SLOT_KEYS.map((k) => `<option value="${k}" ${d.rate === k ? 'selected' : ''}>Rate at ${k}</option>`).join('')}</select>
        </div>
        <div class="tablewrap">
          <table class="board-table">
            <thead><tr><th><button class="sort ${d.sort === 'name' ? 'on' : ''}" data-act="sort" data-key="name">Pokémon</button></th>
            <th><button class="sort ${d.sort === 'fit' ? 'on' : ''}" data-act="sort" data-key="fit">Fit</button></th>
            ${Object.keys(ATTRS).map((k) => head(k, ATTR_SHORT[k])).join('')}<th></th></tr></thead>
            <tbody id="board-body">${boardRowsHtml()}</tbody>
          </table>
        </div>
      </div>
      <aside class="draft-side">
        <div class="card detail" id="detail">${detailHtml()}</div>
        <div class="card">
          <h3>Your roster <span class="muted">${me.roster.length} of ${L.settings.rounds}</span></h3>
          ${rosterSlotsHtml(me)}
        </div>
        <div class="card">
          <h3>Recent picks</h3>
          <ol class="feed">${recent.map((p) => `<li>${teamBadge(L.teams[p.team])}${sprite(p.player, 'xs')}<span>${esc(P(p.player).name)}</span><em>${p.slot}</em></li>`).join('') || '<li class="muted">No picks yet</li>'}</ol>
        </div>
      </aside>
    </div>
  </section>`;
}

function rosterSlotsHtml(team) {
  const col = (keys) => keys.map((k) => {
    const id = team.slots[k];
    return `<li><span class="slot">${k}</span>${id ? `${sprite(id, 'xs')}<span>${esc(P(id).name)}</span>${ovr(P(id).ovr[k])}` : '<span class="muted">Open</span>'}</li>`;
  }).join('');
  return `<div class="slots"><ul>${col(OFF_SLOTS)}</ul><ul>${col(DEF_SLOTS)}${col(ST_SLOTS)}</ul></div>
    ${team.bench.length ? `<p class="muted small">Bench: ${team.bench.map((id) => esc(P(id).name)).join(', ')}</p>` : ''}`;
}

export function detailHtml() {
  const id = S.draft.sel;
  if (id == null || !PLAYERS[id]) return `<p class="muted">Select a Pokémon on the board to see its positions, ability, power and type matchups.</p>`;
  const L = S.league, me = user(), p = P(id);
  const taken = !LG.available(L).includes(id);
  const myTurn = LG.currentPick(L)?.team === me.id;
  const block = LG.blockReason(L, me, id);
  const open = LG.openSlots(me);
  const bestOpen = LG.bestOpenSlot(me, id);
  const edge = LG.rivalEdge(L, id);
  const s = p.stats;
  return `<div class="dhead">${sprite(id, 'lg')}<div><h3>${esc(p.name)}</h3><div class="types">${typeChips(p.types)}</div>
      <p class="small muted">Gen ${p.gen} · ${(p.height / 10).toFixed(1)} m · ${(p.weight / 10).toFixed(1)} kg</p></div></div>
    <p class="small"><b>${esc(p.ability)}.</b> ${esc(abilityText(id))}</p>
    ${p.types.map((t) => `<p class="small"><b>${t} trait.</b> ${TYPE_TRAITS[t].text}</p>`).join('')}
    ${powerHtml(id)}
    <p class="small">Super effective against <b>${edge.n}</b> of ${edge.total} Pokémon on rival rosters.</p>
    <h4>Best positions</h4>
    <ul class="best">${p.best.slice(0, 3).map((k) => `<li><span class="slot">${k}</span>${bar(p.ovr[k])}${ovr(p.ovr[k])}</li>`).join('')}</ul>
    <p class="small muted mono">HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · SpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}</p>
    ${taken ? '<p class="muted">Already drafted.</p>' : `<div class="draftto">
      <select id="d-slot" aria-label="Draft into slot">${open.map((k) => `<option value="${k}" ${k === bestOpen ? 'selected' : ''}>${k} · ${p.ovr[k]}</option>`).join('')}${open.length === 0 ? '<option value="BENCH">Bench</option>' : ''}</select>
      <button class="btn primary" data-act="draftsel" ${myTurn && !block ? '' : 'disabled'}>${block ? esc(block) : myTurn ? `Draft ${esc(p.name)}` : 'Wait for your pick'}</button>
    </div>`}`;
}

export function draftTick() {
  clearTimers();
  const L = S.league;
  if (!L || L.phase !== 'draft' || S.screen !== 'draft') return;
  const pk = LG.currentPick(L);
  const mine = L.teams[pk.team].user;
  if (!mine || S.draft.autoAll) {
    timers.draft = setTimeout(() => {
      const c = LG.aiChoosePick(L, pk.team);
      LG.makePick(L, c.id, c.slot);
      afterPick();
    }, mine ? 120 : 260);
    return;
  }
  S.draft.clock = 60;
  if (S.setup.clock) {
    timers.clock = setInterval(() => {
      S.draft.clock--;
      const el = document.getElementById('pick-clock');
      if (el) el.textContent = S.draft.clock;
      if (S.draft.clock <= 0) {
        clearInterval(timers.clock);
        const c = LG.aiChoosePick(L, pk.team);
        LG.makePick(L, c.id, c.slot);
        afterPick();
      }
    }, 1000);
  }
}
function afterPick() {
  save();
  if (S.league.phase !== 'draft') { S.draft.autoAll = false; setScreen('grades'); return; }
  if (S.draft.sel != null && !LG.available(S.league).includes(S.draft.sel)) { /* keep showing as drafted */ }
  render();
  draftTick();
}

// ---------- grades ----------
export function renderGrades() {
  const L = S.league;
  const grades = LG.draftGrades(L);
  const units = [['passOff', 'Pass offense'], ['runOff', 'Run offense'], ['passRush', 'Pass rush'], ['coverage', 'Coverage'], ['runDef', 'Run defense']];
  const order = L.teams.map((t, i) => ({ t, g: grades[i] }));
  return `<section class="grades">
    <p class="eyebrow">Draft complete</p>
    <h1>Draft grades</h1>
    <p class="lede">Each unit is graded against the other seven teams. Starters only; your bench subs in as starters tire.</p>
    <div class="tablewrap card"><table class="gtable">
      <thead><tr><th>Team</th><th>Coach</th>${units.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${order.map(({ t, g }) => `<tr class="${t.user ? 'me' : ''}"><td>${teamBadge(t)} ${esc(t.name)}</td><td class="muted">${esc(coachLabel(t))}${t.favTypes ? ` (${t.favTypes.join(', ')})` : ''}</td>
        ${units.map(([k]) => `<td><span class="grade g-${g[k].grade[0]}">${g[k].grade}</span><span class="muted small"> ${g[k].value}</span></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${tradeCardHtml(L)}
    <div class="card share"><h3>Share this league</h3>${shareCardHtml(L)}</div>
    <div class="actions">
      <button class="btn" data-act="go" data-to="depth">Edit depth chart</button>
      ${L.phase === 'grades' ? '<button class="btn primary" data-act="startseason">Start the season</button>' : '<button class="btn primary" data-act="go" data-to="season">Go to season</button>'}
    </div>
  </section>`;
}

export function tradeCardHtml(L) {
  const T = L.trade;
  if (!T) return '';
  const from = L.teams[T.team];
  if (T.status === 'accepted') {
    const me = user(), slot = Object.keys(me.lineup).find((k) => me.lineup[k] === T.youGet);
    const fit = slot && P(T.youGet).best[0] !== slot;
    return `<div class="card trade done"><h3>Trade</h3><p>You sent ${esc(P(T.youSend).name)} to ${esc(from.name)} for ${esc(P(T.youGet).name)}.</p>
      ${fit ? `<p class="small muted">${esc(P(T.youGet).name)} took ${esc(P(T.youSend).name)}'s spot at ${slot}. Auto-arrange the depth chart to get the full gain.</p>
      <div class="actions"><button class="btn" data-act="go" data-to="depth">Open the depth chart</button></div>` : ''}</div>`;
  }
  if (!LG.tradeOpen(L)) return '';
  const card = (id, label) => {
    const p = P(id), k = p.best[0];
    return `<div class="tside"><span class="muted small">${label}</span>${sprite(id, 'md')}<b>${esc(p.name)}</b><span class="types">${typeChips(p.types)}</span><span><span class="slot">${k}</span>${ovr(p.ovr[k])}</span></div>`;
  };
  return `<div class="card trade"><h3>Trade offer <span class="muted">${teamBadge(from)} ${esc(from.coachName)}</span></h3>
    <div class="tswap">${card(T.youGet, 'You get')}<span class="at">for</span>${card(T.youSend, 'You send')}</div>
    <p class="small muted">${esc(from.name)} want ${esc(P(T.youSend).name)}. By overall, your best lineup improves by ${T.gain} points. The offer stands until your first game.</p>
    ${tradeKickingHtml(L)}
    <div class="actions"><button class="btn primary" data-act="tradeyes">Accept</button><button class="btn" data-act="tradeno">Decline</button></div></div>`;
}

// When the trade moves your kicker or punter: who kicks for you afterwards, and his range.
function tradeKickingHtml(L) {
  const K = LG.tradeKicking(L);
  if (!K) return '';
  const who = (x, what) => `${esc(P(x.id).name)} (${x.ovr}, ${what(x)})`;
  const line = (role, b, a, what) => `<p class="small">Your ${role} after the trade: ${a ? who(a, what) : 'nobody'}${b ? `, replacing ${who(b, what)}` : ''}.</p>`;
  return (K.k ? line('kicker', K.before.k, K.after.k, (x) => `${x.range}-yd range`) : '')
    + (K.p ? line('punter', K.before.p, K.after.p, (x) => `about ${x.net} yds a punt`) : '');
}

export function userDraft(id, slot) {
  const L = S.league;
  if (id == null || L.phase !== 'draft') return;
  const pk = LG.currentPick(L);
  const me = user();
  if (pk.team !== me.id || LG.blockReason(L, me, id) || !LG.available(L).includes(id)) return;
  clearTimers();
  LG.makePick(L, id, slot && slot !== 'BENCH' && me.slots[slot] == null ? slot : null);
  afterPick();
}

const GROUP_NAMES = { QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'tight ends', OL: 'linemen', DL: 'the defensive line', LB: 'linebackers', CB: 'corners', S: 'safeties' };
function schemeGroups(coach) {
  const g = Object.entries(SCHEMES[coach].draft).sort((a, b) => b[1] - a[1]).map(([k]) => GROUP_NAMES[k] ?? k);
  return g.length > 1 ? `${g.slice(0, -1).join(', ')} and ${g[g.length - 1]}` : g[0];
}
