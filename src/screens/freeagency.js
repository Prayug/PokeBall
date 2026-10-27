// Free agency: bid for cut and undrafted Pokémon under the league cap, one sealed bid a round.
import { PLAYERS } from '../ratings.js';
import * as FA from '../freeagency.js';
import { careerTotals, careerLine } from '../records.js';
import { S } from '../state.js';
import { P, esc, ovr, sprite, teamBadge, typeChips, user } from '../ui.js';

const money = (v) => `$${v}M`;
const topOvr = (id) => P(id).ovr[P(id).best[0]];

// The same target list the board always used: the pool ranked by lineup gain, type cap applied.
function capTargets(L, me) {
  return FA.faTargets(L, me, 60).filter((t) => FA.typeCapOk(L, me, t.id, t.release));
}
function shownTargets(L, me) {
  const q = (S.faQ ?? '').trim().toLowerCase();
  const rows = capTargets(L, me);
  return q ? rows.filter((t) => P(t.id).name.toLowerCase().includes(q)) : rows;
}

export function faBoardHtml() {
  const L = S.league, me = user();
  const all = capTargets(L, me);
  const rows = shownTargets(L, me);
  if (!all.length) return '<p class="empty">Nobody in the pool would start for you.</p>';
  if (!rows.length) return '<p class="empty">No Pokémon match that search.</p>';
  return rows.map((t) => {
    const p = P(t.id);
    const from = t.cutBy != null ? `Cut by ${L.teams[t.cutBy].abbr}` : 'Undrafted';
    return `<article class="fa-card ${t.id === S.faSel ? 'sel' : ''}" data-act="fasel" data-id="${t.id}">
      ${sprite(t.id, 'sm')}
      <span class="pk-name"><b>${esc(p.name)}</b>${typeChips(p.types)}</span>
      <span class="fit"><span class="slot">${p.best[0]}</span>${ovr(topOvr(t.id))}<span class="plays">${playsHtml(me, t.id)}</span></span>
      <span class="ask ${t.ask > FA.maxBid(L, me, t.release) ? 'bad' : ''}">${money(t.ask)}</span>
      <span class="from">${t.cutBy != null ? teamBadge(L.teams[t.cutBy]) : ''}<span class="muted small">${esc(from)}</span></span>
    </article>`;
  }).join('');
}

export function renderFreeAgency() {
  const L = S.league, me = user(), F = L.fa;
  if (!F) return '<section><p>Free agency is closed.</p></section>';
  const targets = capTargets(L, me);
  if (S.faSel != null && !targets.some((t) => t.id === S.faSel) && !FA.faPool(L).some((p) => p.id === S.faSel)) S.faSel = null;
  S.faSel ??= targets[0]?.id ?? null;
  const space = FA.capSpace(L, me);
  return `<section class="fa">
    <p class="eyebrow">Season ${L.season} · Free agency · Round ${F.round + 1} of ${F.rounds}</p>
    <h1>Free agency</h1>
    ${lastRoundHtml(L, me)}
    <div class="draft-grid">
      <div class="card board">
        <h3>Your targets <span class="muted small">Ranked by how much they add to your lineup</span></h3>
        <div class="filters">
          <input id="fa-q" type="search" placeholder="Search Pokémon" value="${esc(S.faQ ?? '')}" aria-label="Search free agents">
        </div>
        <div class="fa-cards" id="fa-board">${faBoardHtml()}</div>
      </div>
      <div class="draft-side">
        <div class="card">
          <h3>Your cap <span class="muted">${money(FA.payroll(L, me))} of ${money(L.cap)}</span></h3>
          <div class="capbar"><span style="width:${Math.min(100, (FA.payroll(L, me) / L.cap) * 100)}%"></span></div>
          <p class="small">${space >= 0 ? `${money(space)} of room` : `${money(-space)} over the cap: release someone to bid`} · ${me.roster.length} of ${L.settings.rounds} on the roster</p>
        </div>
        ${bidHtml(L, me)}
        ${signingsHtml(L)}
        <div class="card"><h3>Cap room around the league</h3><ul class="capall">${L.teams.slice().sort((a, b) => FA.capSpace(L, b) - FA.capSpace(L, a)).map((t) =>
          `<li class="${t.user ? 'me' : ''}">${teamBadge(t)}<span class="cn">${esc(t.name)}</span><b class="num">${money(FA.capSpace(L, t))}</b></li>`).join('')}</ul></div>
      </div>
    </div>
  </section>`;
}

function playsHtml(me, id) {
  const s = FA.signingSlot(me, id);
  if (s.open) return `<span class="slot">${s.slot}</span> <span class="small good">open</span>`;
  return `<span class="slot">${s.slot}</span> <span class="small ${s.over > 0 ? 'good' : 'muted'}">${s.over > 0 ? `+${s.over} on ${esc(P(me.lineup[s.slot]).name)}` : 'backup'}</span>`;
}

function bidHtml(L, me) {
  const id = S.faSel;
  if (id == null) return `<div class="card"><h3>Your bid</h3><p class="muted">Nobody to bid on.</p>
    <div class="actions"><button class="btn primary" data-act="fapass">Pass this round</button></div></div>`;
  const full = me.roster.length >= L.settings.rounds;
  const suggested = FA.releaseFor(L, me);
  if (full && (S.faRelease == null || !me.roster.includes(S.faRelease))) S.faRelease = suggested;
  const release = full ? S.faRelease : null;
  const ask = FA.askingPrice(id), max = FA.maxBid(L, me, release);
  if (S.faAmount == null || S.faAmountFor !== id) { S.faAmount = Math.max(ask, Math.min(max, Math.round(ask * 1.2))); S.faAmountFor = id; }
  const problem = FA.bidProblem(L, me, id, release, S.faAmount);
  const c = careerTotals(L)[id];
  const cutBy = L.fa.cuts[id];
  const slotOf = (x) => Object.keys(me.lineup).find((k) => me.lineup[k] === x) ?? 'BN';
  return `<div class="card fa-bid">
    <div class="dhead">${sprite(id, 'lg')}<div><h3>${esc(P(id).name)}</h3>${typeChips(P(id).types)}
      <p class="small muted">${P(id).best.slice(0, 3).map((k) => `${k} ${P(id).ovr[k]}`).join(' · ')}</p></div></div>
    <p class="small">${cutBy != null ? `Cut by ${esc(L.teams[cutBy].name)}.` : 'Never drafted.'} Asking ${money(ask)}.${c ? ` Career: ${esc(careerLine(c))}.` : ''}</p>
    ${full ? `<label>Release to make room
      <select id="fa-release">${me.roster.slice().sort((a, b) => FA.salary(L, b) - FA.salary(L, a)).map((x) => `<option value="${x}" ${x === release ? 'selected' : ''}>${esc(P(x).name)} (${slotOf(x)}, ${money(FA.salary(L, x))})${x === suggested ? ' · suggested' : ''}</option>`).join('')}</select></label>` : `<p class="small muted">You have ${L.settings.rounds - me.roster.length} open roster spots, so nobody has to go.</p>`}
    <label>${max >= ask ? `Your bid, ${money(ask)} to ${money(max)}` : `Your bid: you have room for ${money(Math.max(0, max))}`}
      <input id="fa-amount" type="number" inputmode="numeric" min="${ask}" max="${Math.max(ask, max)}" step="1" value="${S.faAmount}"></label>
    ${problem ? `<p class="small bad">${esc(problem)}</p>` : ''}
    <div class="actions"><button class="btn primary" data-act="fabid" ${problem ? 'disabled' : ''}>Bid ${money(S.faAmount)}</button>
      <button class="btn" data-act="fapass">Pass this round</button></div>
    <button class="btn tiny" data-act="faskip">Skip the rest and go to the rookie draft</button>
  </div>`;
}

function lastRoundHtml(L, me) {
  const last = L.fa.last;
  if (!last?.user) return '';
  const u = last.user;
  const msg = u.won ? `You signed ${esc(P(u.id).name)} for ${money(u.price)}.`
    : u.winner != null ? `${esc(L.teams[u.winner].name)} outbid you for ${esc(P(u.id).name)} at ${money(u.price)}.`
      : `Your bid for ${esc(P(u.id).name)} did not go through.`;
  return `<div class="fa-note ${u.won ? 'good' : 'bad'}" role="status">Round ${last.round}: ${msg}</div>`;
}

export function signingsHtml(L, title = 'Signed so far') {
  const log = L.fa?.log ?? [];
  if (!log.length) return `<div class="card"><h3>${title}</h3><p class="muted small">No signings yet.</p></div>`;
  return `<div class="card"><h3>${title}</h3><ul class="faLog">${log.slice().reverse().map((s) => `<li class="${L.teams[s.team].user ? 'me' : ''}">${sprite(s.id, 'xs')}
    <span class="cn"><b>${esc(P(s.id).name)}</b> <span class="slot">${P(s.id).best[0]}</span>${ovr(topOvr(s.id))}</span>${teamBadge(L.teams[s.team])}<b class="num">${money(s.amount)}</b>
    <span class="small muted note">${s.bidders.length > 1 ? `${s.bidders.length} bids` : '1 bid'}${s.release != null && PLAYERS[s.release] ? `, released ${esc(P(s.release).name)}` : ''}</span></li>`).join('')}</ul></div>`;
}
