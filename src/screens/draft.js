// Draft room and draft grades, with the post-draft trade offer (and the deal cards the trade desk shares).
import { ATTRS, BASELINE, DEF_SLOTS, OFF_SLOTS, PLAYERS, SLOT_KEYS, ST_SLOTS } from '../ratings.js';
import { TYPE_COLORS, TYPE_TRAITS } from '../types.js';
import * as LG from '../league.js';
import { SCHEMES, coachLabel } from '../coach.js';
import { render, setScreen } from '../app.js';
import { S, clearTimers, save, timers } from '../state.js';
import { ATTR_SHORT, P, abilityText, bar, coachTip, esc, monCard, ovr, powerHtml, roleHtml, sprite, teamBadge, typeChips, user } from '../ui.js';
import { shareCardHtml } from './share.js';
import { send as netSend } from '../net.js';
import * as TR from '../trades.js';

// ---------- draft ----------
// The board's Fit is the number it sorts by. With "Best open slot", that is a Pokémon's value
// to your roster: the slot's weight times how far its rating there clears a typical starter
// (LG.slotValue), at the open slot where that is highest; once every slot is filled, 90% of the
// weighted gap to the starter it would back up (LG.benchValue). Rated at one position, Fit is
// the rating there, and the board sorts by that.
const TOP_POSITIONS = 3;
const playsAt = (id, k) => P(id).best.slice(0, TOP_POSITIONS).includes(k);

export function draftFit(team, id, d = S.draft) {
  const p = P(id);
  if (d.rate !== 'fit') return { slot: d.rate, v: p.ovr[d.rate], score: p.ovr[d.rate], rated: true };
  const need = typeof d.needs === 'string' && team.slots[d.needs] == null ? d.needs : null;
  if (need) return { slot: need, v: p.ovr[need], score: LG.slotValue(id, need), open: true };
  if (LG.openSlots(team).length) {
    const k = LG.bestOpenSlot(team, id);
    return { slot: k, v: p.ovr[k], score: LG.slotValue(id, k), open: true };
  }
  const b = LG.benchValue(team, id);
  return { slot: b.slot, v: p.ovr[b.slot], score: b.score, incumbent: b.incumbent };
}
const fitNum = (f) => (f.rated ? String(f.v) : `${f.score >= 0 ? '+' : '−'}${Math.abs(Math.round(f.score))}`);

// Where a Pokémon ranks at a slot among the ones still on the board (1: the best left).
function rankerFor(L, team) {
  const pool = LG.available(L).filter((id) => !LG.blockReason(L, team, id));
  const cache = {};
  return (id, k) => {
    const list = (cache[k] ??= pool.map((x) => P(x).ovr[k]).sort((a, b) => b - a));
    const v = P(id).ovr[k];
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] > v) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
}
const nth = (n) => (n === 1 ? 'Best' : `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}-best`);

// One line for the board: why the Fit is what it is.
function fitShort(f, rank) {
  if (f.rated) return `${nth(rank)} ${f.slot} left`;
  if (f.open) return `${nth(rank)} ${f.slot} left · open`;
  return `Backs up ${f.slot}`;
}

// The longer case for a pick, for the detail card.
function whyHtml(L, team, id) {
  const f = draftFit(team, id), p = P(id);
  const rank = rankerFor(L, team)(id, f.slot);
  const cur = team.slots[f.slot];
  const lines = [];
  if (f.rated) {
    lines.push(`${nth(rank)} ${f.slot} left at ${f.v}.${cur != null ? ` You start ${esc(P(cur).name)} (${P(cur).ovr[f.slot]}) there.` : ` Your ${f.slot} spot is open.`}`);
  } else if (f.open) {
    lines.push(`${nth(rank)} ${f.slot} left, and your ${f.slot} spot is open.`);
    lines.push(`Fit ${fitNum(f)}: ${f.v} at ${f.slot} against ${BASELINE[f.slot]} for a typical starter, times how much the ${f.slot} spot counts.`);
  } else {
    const inc = f.incumbent != null ? P(f.incumbent) : null;
    const gap = inc ? f.v - inc.ovr[f.slot] : 0;
    lines.push(inc ? (gap > 0 ? `Beats your ${f.slot} ${esc(inc.name)} (${inc.ovr[f.slot]}) by ${gap}: it would start.` : `Backup ${f.slot}, ${-gap} under ${esc(inc.name)} (${inc.ovr[f.slot]}).`) : `Backup ${f.slot}.`);
    lines.push(`Fit ${fitNum(f)}: 90% of that gap, times how much the ${f.slot} spot counts.`);
  }
  const next = nextOwnPick(L, team.id);
  if (next != null) {
    const between = next - L.pickIndex - (L.picks[L.pickIndex]?.team === team.id ? 1 : 0);
    const better = rank - 1;
    lines.push(between > 0 ? `${between} pick${between === 1 ? '' : 's'} before your next turn${L.picks[L.pickIndex]?.team === team.id ? ' after this one' : ''}${better ? `; ${better} better ${f.slot}${better === 1 ? ' is' : 's are'} still on the board` : ''}.` : 'You pick again right after this.');
  }
  if (p.legendary) lines.push('Legendary.');
  return `<div class="why"><h4>Why this player</h4>${lines.map((l) => `<p class="small">${l}</p>`).join('')}</div>`;
}
function nextOwnPick(L, teamId) {
  for (let i = L.pickIndex + (L.picks[L.pickIndex]?.team === teamId ? 1 : 0); i < L.picks.length; i++) if (L.picks[i].team === teamId) return i;
  return null;
}

// Your queue: the Pokémon you starred, in order, while they are still on the board.
export function draftQueue(L = S.league, team = user()) {
  const free = new Set(LG.available(L));
  return (L.draftQueue ?? []).filter((id) => free.has(id));
}
export function queueTop(L = S.league, team = user()) {
  return draftQueue(L, team).find((id) => !LG.blockReason(L, team, id)) ?? null;
}
export function toggleQueue(id) {
  const L = S.league, q = (L.draftQueue ??= []);
  const i = q.indexOf(id);
  if (i >= 0) q.splice(i, 1); else q.push(id);
  L.draftQueue = draftQueue(L);
  save();
}
export function moveQueue(id, by) {
  const L = S.league, q = (L.draftQueue = draftQueue(L));
  const i = q.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  save();
}
// The pick the clock (or auto-draft) makes for you: the top of your queue, else the AI's choice.
function autoChoice(L, teamId) {
  const team = L.teams[teamId];
  const q = team.user && !S.online ? queueTop(L, team) : null;
  return q != null ? { id: q, slot: null } : LG.aiChoosePick(L, teamId);
}

function boardIds() {
  const L = S.league, me = user(), d = S.draft;
  const q = d.search.trim().toLowerCase();
  const open = LG.openSlots(me);
  const need = typeof d.needs === 'string' && open.includes(d.needs) ? d.needs : null;
  // Drafted Pokémon leave the board, and so do ones this team can't take (type cap). Open
  // spots keeps the ones with an open slot among their best three positions.
  const ids = LG.available(L).filter((id) => !LG.blockReason(L, me, id) && (!q || P(id).name.toLowerCase().includes(q)) && (!d.type || P(id).types.includes(d.type)) && (!d.gen || P(id).gen === Number(d.gen))
    && (need ? playsAt(id, need) : !d.needs || !open.length || open.some((k) => playsAt(id, k))));
  const rows = ids.map((id) => ({ id, fit: draftFit(me, id, { ...d, needs: need }) }));
  const key = d.sort;
  rows.sort((a, b) => key === 'fit' ? b.fit.score - a.fit.score || b.fit.v - a.fit.v
    : key === 'name' ? P(a.id).name.localeCompare(P(b.id).name) : P(b.id).attrs[key] - P(a.id).attrs[key]);
  return rows;
}

export function boardRowsHtml() {
  const L = S.league, me = user();
  const myTurn = LG.currentPick(L)?.team === me.id;
  const rows = boardIds();
  if (!rows.length) return `<tr><td colspan="17" class="empty">No Pokémon match. Clear the search, type, generation or open-spots filter.</td></tr>`;
  const rank = rankerFor(L, me);
  const queued = new Set(draftQueue(L, me));
  const canQueue = !S.online;
  return rows.map(({ id, fit }) => {
    const p = P(id);
    const block = LG.blockReason(L, me, id);
    const why = fitShort(fit, rank(id, fit.slot));
    return `<tr class="${S.draft.sel === id ? 'sel' : ''}" data-act="select" data-id="${id}">
      <td class="pk">${sprite(id, 'sm')}<span><b>${esc(p.name)}</b>${p.legendary ? '<i class="leg">Legendary</i>' : ''}${roleHtml(p)}<span class="types">${typeChips(p.types)}</span></span></td>
      <td class="fit" title="${esc(why)}"><div class="fitcell"><b class="fitnum">${fitNum(fit)}</b><span class="fitsub"><span class="slot">${fit.slot}</span>${fit.rated ? '' : ovr(fit.v)}</span><span class="fitwhy">${esc(why)}</span></div></td>
      ${Object.keys(ATTRS).map((k) => `<td class="num a-${k}">${p.attrs[k]}</td>`).join('')}
      <td class="acts">${canQueue ? `<button class="btn tiny ghost star ${queued.has(id) ? 'on' : ''}" data-act="queue" data-id="${id}" aria-pressed="${queued.has(id)}" title="${queued.has(id) ? 'Take off your queue' : 'Add to your queue'}">${queued.has(id) ? '★' : '☆'}</button>` : ''}<button class="btn tiny ${myTurn && !block ? 'primary' : ''}" data-act="draftbtn" data-id="${id}" ${myTurn && !block ? '' : 'disabled'} title="${block ? esc(block) : ''}">${block ? 'Blocked' : 'Draft'}</button></td>
    </tr>`;
  }).join('');
}

// Pinned over the board: the slots still open, each a filter.
function needsHtml(team) {
  const open = LG.openSlots(team), d = S.draft;
  if (!open.length) return `<div class="needs"><span class="muted small">Every slot is filled. Fit now rates each Pokémon as a backup.</span></div>`;
  return `<div class="needs"><span class="needs-l">Still need</span>
    ${open.map((k) => `<button class="chip-btn ${d.needs === k ? 'on' : ''}" data-act="needslot" data-slot="${k}" aria-pressed="${d.needs === k}">${k}</button>`).join('')}
    <label class="check small"><input type="checkbox" id="d-needs" ${d.needs ? 'checked' : ''}> Open spots only</label></div>`;
}

function queueHtml(L, team, myTurn) {
  if (S.online) return '';
  const q = draftQueue(L, team), top = queueTop(L, team);
  const d = S.draft;
  return `<div class="card queue"><h3>Your queue <span class="muted">${q.length || ''}</span></h3>
    ${q.length ? `<ol class="qlist">${q.map((id, i) => {
    const block = LG.blockReason(L, team, id);
    const f = draftFit(team, id, { ...d, rate: 'fit', needs: false });
    return `<li class="${block ? 'blocked' : ''}">${sprite(id, 'xs')}<button class="qname" data-act="select" data-id="${id}">${esc(P(id).name)}</button><span class="slot">${f.slot}</span>${ovr(f.v)}
      <span class="qbtns"><button class="btn tiny ghost" data-act="queueup" data-id="${id}" ${i ? '' : 'disabled'} aria-label="Move ${esc(P(id).name)} up">↑</button><button class="btn tiny ghost" data-act="queuedown" data-id="${id}" ${i < q.length - 1 ? '' : 'disabled'} aria-label="Move ${esc(P(id).name)} down">↓</button><button class="btn tiny ghost" data-act="queue" data-id="${id}" aria-label="Take ${esc(P(id).name)} off your queue">✕</button></span></li>`;
  }).join('')}</ol>` : '<p class="small muted">Star Pokémon on the board (☆) to line them up. When the pick clock runs out, or auto-draft picks for you, it takes the top of your queue first.</p>'}
    ${q.length ? `<div class="actions"><button class="btn primary" data-act="draftqueue" ${myTurn && top != null ? '' : 'disabled'}>${top != null ? `Draft ${esc(P(top).name)}` : 'Nobody you can draft'}</button>
      <label class="check small"><input type="checkbox" id="d-qauto" ${d.queueAuto ? 'checked' : ''}> Draft my queue when I'm on the clock</label></div>` : ''}
  </div>`;
}

// Trade down while you are on the clock, and the swaps made so far this draft.
function swapsHtml(L, myTurn) {
  if (S.online) return '';
  const season = L.season ?? 1;
  const done = (L.draftDeals ?? []).filter((x) => x.season === season);
  const offers = myTurn && !S.draft.autoAll ? TR.draftSwapOffers(L) : [];
  if (!offers.length && !done.length) return '';
  const lab = (i) => esc(TR.draftPickLabel(L, i, true));
  const full = (i) => esc(TR.draftPickLabel(L, i));
  return `<div class="card swaps"><h3>Trade down</h3>
    ${offers.length ? `<p class="small muted">Teams picking soon will move up. Two picks each way, so your roster still fills.</p>
    <ul class="swaplist">${offers.map((o) => `<li>${teamBadge(L.teams[o.team])}<span class="small">You get <b title="${full(o.get[0])}">${lab(o.get[0])}</b> and <b title="${full(o.get[1])}">${lab(o.get[1])}</b> for <b title="${full(o.give[0])}">${lab(o.give[0])}</b> and <b title="${full(o.give[1])}">${lab(o.give[1])}</b></span>
      <button class="btn tiny" data-act="draftswap" data-team="${o.team}">Accept</button></li>`).join('')}</ul>` : ''}
    ${done.length ? `<p class="small muted">${done.map((x) => `You sent ${lab(x.give[0])} and ${lab(x.give[1])} to ${esc(L.teams[x.team].abbr)} for ${lab(x.get[0])} and ${lab(x.get[1])}.`).join(' ')}</p>` : ''}
  </div>`;
}

export function draftSwap(teamId) {
  const L = S.league;
  if (S.online || L.phase !== 'draft') return;
  if (!TR.acceptDraftSwap(L, teamId)) { render(); return; }
  clearTimers();
  afterPick();
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
        <p class="eyebrow">${(L.season ?? 1) > 1 ? `Season ${L.season} rookie draft · ` : ''}Round ${pk?.round ?? '-'} of ${L.picks[L.picks.length - 1].round} · Pick ${L.pickIndex + 1} of ${L.picks.length}${pk?.from != null ? ` · ${esc(L.teams[pk.from].abbr)}'s pick, traded` : ''}</p>
        <h1>${myTurn ? 'You are on the clock' : `${esc(onClock?.name ?? '')} are picking`}</h1>
        ${coachTip('draft', 'The rating is for a position. Open a row to see the card, then draft into a spot.')}
        ${S.online && !myTurn && onClock ? `<p class="small muted">${onClock.human ? `${esc(onClock.coachName)} is on the clock` : 'The AI picks for this team'}</p>` : ''}
        ${me.coach !== 'balanced' && SCHEMES[me.coach] ? `<p class="small muted">${esc(SCHEMES[me.coach].name)}: auto-picks reach for ${schemeGroups(me.coach)}.</p>` : ''}
      </div>
      <div class="clockbox ${myTurn ? 'live' : ''}">
        ${S.online ? onlineClockHtml(myTurn, onClock)
    : myTurn && S.setup.clock && !d.autoAll ? `<span class="clocknum" id="pick-clock">${d.clock}</span><span>seconds, then auto-pick</span>` : myTurn ? '<span>Take your time</span>' : '<span class="dots">AI drafting</span>'}
      </div>
      <div class="head-actions">
        ${S.online ? `<button class="btn ${S.net?.autoDraft ? 'primary' : ''}" data-act="onlineautodraft">${S.net?.autoDraft ? 'Stop auto-draft' : 'Auto-draft my picks'}</button>`
    : `${!myTurn || d.autoAll ? `<button class="btn primary" data-act="draftskip">${d.autoAll ? 'Finish the draft now' : 'Skip to my pick'}</button>` : ''}
        <button class="btn" data-act="autodraft">${d.autoAll ? 'Stop auto-draft' : 'Auto-draft the rest'}</button>`}
      </div>
    </div>
    <div class="draft-grid">
      <div class="board card">
        <div class="filters">
          <input id="d-search" type="search" placeholder="Search Pokémon" value="${esc(d.search)}" aria-label="Search Pokémon">
          <select id="d-type" aria-label="Type filter"><option value="">All types</option>${types.map((t) => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="d-gen" aria-label="Generation filter"><option value="">All gens</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${String(d.gen ?? '') === String(n) ? 'selected' : ''}>Gen ${n}</option>`).join('')}</select>
          <select id="d-rate" aria-label="Rate at position"><option value="fit" ${d.rate === 'fit' ? 'selected' : ''}>Fit: value to your roster</option>${SLOT_KEYS.map((k) => `<option value="${k}" ${d.rate === k ? 'selected' : ''}>Rate at ${k}</option>`).join('')}</select>
        </div>
        ${needsHtml(me)}
        <div class="tablewrap">
          <table class="board-table">
            <thead><tr><th><button class="sort ${d.sort === 'name' ? 'on' : ''}" data-act="sort" data-key="name">Pokémon</button></th>
            <th><button class="sort ${d.sort === 'fit' ? 'on' : ''}" data-act="sort" data-key="fit" title="${d.rate === 'fit' ? 'Value to your roster: the slot weight times the rating over a typical starter, at your best open slot' : `Rating at ${d.rate}`}">${d.rate === 'fit' ? 'Fit' : d.rate}</button></th>
            ${Object.keys(ATTRS).map((k) => head(k, ATTR_SHORT[k])).join('')}<th></th></tr></thead>
            <tbody id="board-body">${boardRowsHtml()}</tbody>
          </table>
        </div>
      </div>
      <aside class="draft-side">
        <div class="card detail" id="detail">${detailHtml()}</div>
        ${swapsHtml(L, myTurn)}
        ${queueHtml(L, me, myTurn)}
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

// The type matchups against everyone rivals have drafted, as net verdicts with the names.
function rivalEdgeHtml({ good, bad, total }) {
  if (!total) return '<p class="small muted">Type matchups show here once rivals have drafted.</p>';
  const names = (ids) => ids.slice(0, 3).map((x) => esc(P(x).name)).join(', ') + (ids.length > 3 ? ` and ${ids.length - 3} more` : '');
  return `<p class="small">Against the ${total} Pokémon on rival rosters: <span class="good">you have the edge on <b>${good.length}</b></span>${good.length ? ` (${names(good)})` : ''},
    <span class="bad">they have the edge on <b>${bad.length}</b></span>${bad.length ? ` (${names(bad)})` : ''}.</p>`;
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
  return `<div class="dhead">${monCard(id, { size: 'lg' })}<p class="small muted">Gen ${p.gen} · ${(p.height / 10).toFixed(1)} m · ${(p.weight / 10).toFixed(1)} kg</p></div>
    ${taken ? '' : whyHtml(L, me, id)}
    ${typeCapHtml(L, me, p)}
    <p class="small"><b>${esc(p.ability)}.</b> ${esc(abilityText(id))}</p>
    ${powerHtml(id)}
    ${rivalEdgeHtml(edge)}
    <h4>Best positions</h4>
    <ul class="best">${p.best.slice(0, 3).map((k) => `<li><span class="slot">${k}</span>${bar(p.ovr[k])}${ovr(p.ovr[k])}</li>`).join('')}</ul>
    <details><summary>Type notes and base stats</summary>
      ${p.types.map((t) => `<p class="small"><b>${t}.</b> ${TYPE_TRAITS[t].text}</p>`).join('')}
      <p class="small muted mono">HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · SpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}</p>
    </details>
    ${taken ? '<p class="muted">Already drafted.</p>' : `<div class="draftto">
      <select id="d-slot" aria-label="Draft into slot">${open.map((k) => `<option value="${k}" ${k === bestOpen ? 'selected' : ''}>${k} · ${p.ovr[k]}</option>`).join('')}${open.length === 0 ? '<option value="BENCH">Bench</option>' : ''}</select>
      <button class="btn primary" data-act="draftsel" ${myTurn && !block ? '' : 'disabled'}>${block ? esc(block) : myTurn ? `Draft ${esc(p.name)}` : 'Wait for your pick'}</button>
    </div>`}`;
}

// The primary-type cap, and how many of your Pokémon share each of this one's types either way,
// so a dual-type stack the cap lets through still shows.
function typeCapHtml(L, team, p) {
  const prim = (t) => team.roster.filter((x) => P(x).types[0] === t).length;
  const second = (t) => team.roster.filter((x) => P(x).types[1] === t).length;
  const parts = p.types.map((t, i) => {
    const a = prim(t), b = second(t);
    return `${t}: ${a} primary${b ? `, ${b} more with ${t} second` : ''}${i === 0 && L.settings.typeCap ? ` (cap 4 primary)` : ''}`;
  });
  return `<p class="small muted">Your roster · ${parts.join(' · ')}</p>`;
}

// Online: the server's pick clock, counted down here between updates.
const pickSecs = () => (S.net?.pickAt ? Math.max(0, Math.ceil((S.net.pickAt - Date.now()) / 1000)) : null);
function onlineClockHtml(myTurn, onClock) {
  const secs = pickSecs();
  if (S.net?.autoDraft && myTurn) return '<span class="dots">Auto-drafting for you</span>';
  if (!onClock?.human) return '<span class="dots">AI drafting</span>';
  if (secs == null || secs > 3600) return myTurn ? '<span>Take your time</span>' : `<span>Waiting on ${esc(onClock.coachName)}</span>`;
  return `<span class="clocknum" id="pick-clock">${secs}</span><span>${myTurn ? 'seconds, then auto-pick' : 'seconds left on the clock'}</span>`;
}

export function draftTick() {
  if (S.online) {
    clearInterval(timers.clock);
    timers.clock = setInterval(() => {
      const el = document.getElementById('pick-clock');
      const secs = pickSecs();
      if (el && secs != null) el.textContent = secs;
    }, 500);
    return;
  }
  clearTimers();
  const L = S.league;
  if (!L || L.phase !== 'draft' || S.screen !== 'draft') return;
  const pk = LG.currentPick(L);
  const mine = L.teams[pk.team].user;
  if (!mine || S.draft.autoAll || (S.draft.queueAuto && queueTop(L) != null)) {
    // AI picks come quicker in a bigger league, so the wait between your picks stays about the same.
    timers.draft = setTimeout(() => {
      const c = autoChoice(L, pk.team);
      LG.makePick(L, c.id, c.slot);
      afterPick();
    }, mine ? (S.draft.autoAll ? 120 : 700) : Math.max(90, Math.round(260 * 8 / L.teams.length)));
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
        const c = autoChoice(L, pk.team);
        LG.makePick(L, c.id, c.slot);
        afterPick();
      }
    }, 1000);
  }
}
// Skip ahead: the AI makes every pick up to your next one at once (with auto-draft on, every pick
// left, yours too), instead of one at a time.
export function draftSkip() {
  const L = S.league;
  if (!L || L.phase !== 'draft' || S.online) return;
  clearTimers();
  while (L.phase === 'draft') {
    const pk = LG.currentPick(L);
    if (L.teams[pk.team].user && !S.draft.autoAll) break;
    const c = autoChoice(L, pk.team);
    LG.makePick(L, c.id, c.slot);
  }
  afterPick();
}
function afterPick() {
  save();
  if (S.league.phase !== 'draft') { S.draft.autoAll = false; setScreen('grades'); return; }
  render();
  draftTick();
}

// ---------- grades ----------
function gradeCard(L, t, g) {
  const units = [['passOff', 'Pass'], ['runOff', 'Run'], ['passRush', 'Rush'], ['coverage', 'Coverage'], ['runDef', 'Run D']];
  const bestU = units.slice().sort((a, b) => g[b[0]].value - g[a[0]].value)[0];
  const weakU = units.slice().sort((a, b) => g[a[0]].value - g[b[0]].value)[0];
  const slots = Object.entries(t.lineup).filter(([, id]) => id != null);
  const star = slots.slice().sort((a, b) => P(b[1]).ovr[b[0]] - P(a[1]).ovr[a[0]])[0];
  const hole = slots.slice().sort((a, b) => P(a[1]).ovr[a[0]] - P(b[1]).ovr[b[0]])[0];
  const avg = Math.round(units.reduce((s, [k]) => s + g[k].value, 0) / units.length);
  const open = S.gradeTeam === t.id;
  return `<article class="gcard ${t.user ? 'me' : ''} ${open ? 'open' : ''}" style="--team:${t.color}">
    <button class="gcard-hit" data-act="gradeteam" data-team="${t.id}" aria-expanded="${open}">
      <span class="gcard-mark">${esc(t.abbr)}</span>
      <span class="gcard-body"><b>${esc(t.name)}</b><span class="small muted">${esc(coachLabel(t))}</span></span>
      <span class="gcard-grade">${avg}</span>
    </button>
    <p class="gcard-id"><span>Strength <b>${bestU[1]} ${g[bestU[0]].grade}</b></span><span>Soft spot <b>${weakU[1]} ${g[weakU[0]].grade}</b></span></p>
    ${star ? `<p class="gcard-star">${sprite(star[1], 'md')}<span>Best starter <b>${esc(P(star[1]).name)}</b> ${star[0]} ${P(star[1]).ovr[star[0]]}${hole ? ` · Lowest ${esc(P(hole[1]).name)} ${hole[0]} ${P(hole[1]).ovr[hole[0]]}` : ''}</span></p>` : ''}
    ${open ? `<div class="gcard-roster">${slots.map(([k, id]) => `<button class="gmini" data-act="profile" data-id="${id}">${sprite(id, 'sm')}<em>${k}</em><b>${P(id).ovr[k]}</b></button>`).join('')}</div>` : ''}
  </article>`;
}
export function renderGrades() {
  const L = S.league;
  const grades = LG.draftGrades(L);
  const units = [['passOff', 'Pass offense'], ['runOff', 'Run offense'], ['passRush', 'Pass rush'], ['coverage', 'Coverage'], ['runDef', 'Run defense']];
  const order = L.teams.map((t, i) => ({ t, g: grades[i], avg: units.reduce((s, [k]) => s + grades[i][k].value, 0) })).sort((a, b) => b.avg - a.avg);
  return `<section class="grades">
    <p class="eyebrow">Draft complete</p>
    <h1>Draft board</h1>
    ${coachTip('grades', 'Cards are ordered by starter ratings. Open a club to see every position, or the table for every unit grade.')}
    <div class="gcards">${order.map(({ t, g }) => gradeCard(L, t, g)).join('')}</div>
    <details class="card"><summary>Unit grades table</summary>
    <div class="tablewrap"><table class="gtable">
      <thead><tr><th>Team</th><th>Coach</th>${units.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${order.map(({ t, g }) => `<tr class="${t.user ? 'me' : ''}"><td>${teamBadge(t)} ${esc(t.name)}</td><td class="muted">${esc(coachLabel(t))}${t.favTypes ? ` (${t.favTypes.join(', ')})` : ''}</td>
        ${units.map(([k]) => `<td><span class="grade g-${g[k].grade[0]}">${g[k].grade}</span><span class="muted small"> ${g[k].value}</span></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></details>
    ${tradeCardHtml(L)}
    ${S.online ? '' : `<div class="card share"><h3>Share this league</h3>${shareCardHtml(L)}</div>`}
    <div class="actions">
      <button class="btn" data-act="go" data-to="depth">Edit depth chart</button>
      ${S.online ? onlineGradesActions(L) : L.phase === 'grades' ? '<button class="btn primary" data-act="startseason">Start the season</button>' : '<button class="btn primary" data-act="go" data-to="season">Go to season</button>'}
    </div>
  </section>`;
}

// Online: the commissioner starts the season; head to head, both coaches ready up for the game.
function onlineGradesActions(L) {
  const n = S.net || {};
  if (['between', 'pre', 'live'].includes(n.phase)) return '<button class="btn primary" data-act="go" data-to="game">Back to your game</button>';
  if (n.h2h) {
    const ready = (n.players || []).some((p) => p.team === n.yourTeam && p.ready);
    const past = L.online?.h2hResults ?? [];
    const rec = past.length ? `<span class="small muted">Series: ${L.teams[0].abbr} ${past.filter((r) => r.winner === 0).length}, ${L.teams[1].abbr} ${past.filter((r) => r.winner === 1).length}</span>` : '';
    return (ready ? '<span class="muted">You are ready. Waiting for the other coach.</span>' : `<button class="btn primary" data-act="onlineready">${past.length ? 'Play again' : 'Play the game'}</button>`) + rec;
  }
  if (L.phase !== 'grades') return '<button class="btn primary" data-act="go" data-to="season">Go to season</button>';
  return n.yourTeam === 0 ? '<button class="btn primary" data-act="startseason">Start the season</button>' : '<span class="muted">Waiting for the commissioner to start the season.</span>';
}

export function tradeCardHtml(L) {
  const T = L.trade;
  if (!T) return '';
  const from = L.teams[T.team];
  const names = (ids) => ids.map((id) => esc(P(id).name)).join(', ');
  if (T.status === 'accepted') {
    const entry = L.tradeLog?.[L.tradeLog.length - 1];
    const parts = (ids, picks) => [names(ids), ...picks.map((k) => esc(TR.pickLabel(L, k)))].filter(Boolean).join(' and ');
    return `<div class="card trade done"><h3>Trade</h3><p>You sent ${parts(T.send, T.sendPicks)} to ${esc(from.name)} for ${parts(T.get, T.getPicks)}.</p>
      ${entry ? tradeMovesHtml(L, entry) : ''}
      <div class="actions"><button class="btn" data-act="go" data-to="depth">Open the depth chart</button></div></div>`;
  }
  if (!TR.tradeOpen(L)) return '';
  const note = T.week != null ? 'The offer stands until your next game.' : 'The offer stands until your first game.';
  return `<div class="card trade"><h3>Trade offer <span class="muted">${teamBadge(from)} ${esc(from.coachName)}</span></h3>
    <div class="tswap">${dealSideHtml(L, T.get, T.getPicks, 'You get')}<span class="at">for</span>${dealSideHtml(L, T.send, T.sendPicks, 'You send')}</div>
    <p class="small muted">${esc(from.name)} want ${[names(T.send), ...T.sendPicks.map((k) => esc(TR.pickLabel(L, k)))].filter(Boolean).join(' and ')}. By overall, your best lineup ${T.gain >= 0 ? `improves by ${T.gain}` : `drops by ${-T.gain}`} points. ${note}</p>
    ${tradeKickingHtml(L)}
    <div class="actions"><button class="btn primary" data-act="tradeyes">Accept</button><button class="btn" data-act="tradeno">Decline</button><button class="btn ghost" data-act="go" data-to="trades">Trade desk</button></div></div>`;
}

// One side of a deal: each Pokémon with its best slot and overall, then any picks.
export function dealSideHtml(L, ids, picks, label) {
  const card = (id) => {
    const p = P(id), k = p.best[0];
    return `<span class="tp">${sprite(id, 'md')}<b>${esc(p.name)}</b><span class="types">${typeChips(p.types)}</span><span><span class="slot">${k}</span>${ovr(p.ovr[k])}</span></span>`;
  };
  return `<div class="tside"><span class="muted small">${label}</span>${ids.map(card).join('')}${picks.map((k) => `<span class="pickchip">${esc(TR.pickLabel(L, k))}</span>`).join('')}</div>`;
}

// Who a trade made each side release or sign to keep its roster size.
export function tradeMovesHtml(L, entry) {
  const ai = L.teams[entry.team];
  const list = (ids) => ids.map((id) => esc(P(id).name)).join(', ');
  const lines = [];
  if (entry.released.you.length) lines.push(`You released ${list(entry.released.you)} to make room.`);
  if (entry.signed.you.length) lines.push(`You signed ${list(entry.signed.you)} to fill the roster.`);
  if (entry.released.them.length) lines.push(`${esc(ai.name)} released ${list(entry.released.them)}.`);
  if (entry.signed.them.length) lines.push(`${esc(ai.name)} signed ${list(entry.signed.them)}.`);
  return lines.length ? `<p class="small muted">${lines.join(' ')}</p>` : '';
}

// When the trade moves your kicker or punter: who kicks for you afterwards, and his range.
export function tradeKickingHtml(L, deal = L.trade) {
  const K = TR.tradeKicking(L, deal);
  if (!K) return '';
  const who = (x, what) => `${esc(P(x.id).name)} (${x.ovr}, ${what(x)})`;
  const line = (role, b, a, what) => `<p class="small">Your ${role} after the trade: ${a ? who(a, what) : 'nobody'}${b ? `, replacing ${who(b, what)}` : ''}.</p>`;
  return (K.k ? line('kicker', K.before.k, K.after.k, (x) => `${x.range}-yd range`) : '')
    + (K.p ? line('punter', K.before.p, K.after.p, (x) => `about ${x.net} yds a punt`) : '');
}

export function userDraft(id, slot) {
  if (S.online) { netSend({ t: 'pick', id, slot }); return; }
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
