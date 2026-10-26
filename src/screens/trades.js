// Trade desk: the AI's offer on the table, a deal builder for any team (up to three Pokémon
// each way and next season's first- and second-round picks) with the other side's answer as
// the deal takes shape, the picks you hold, where each team stands, and the season's trades.
import * as LG from '../league.js';
import * as TR from '../trades.js';
import { SLOT_KEYS } from '../ratings.js';
import { render } from '../app.js';
import { S, save } from '../state.js';
import { P, coachTip, esc, monCard, ovr, sprite, teamBadge, user } from '../ui.js';
import { dealSideHtml, tradeCardHtml, tradeKickingHtml, tradeMovesHtml } from './draft.js';
import { latestPower } from '../weekly.js';
import { send as netSend } from '../net.js';
import { capSpace, leagueCap, payroll, salary } from '../freeagency.js';

const STANCE = { contend: 'Contending', middle: 'In the middle', rebuild: 'Rebuilding' };

function desk() {
  const L = S.league;
  // Online, the other coaches' teams are not on the desk: deals are with the AI teams.
  const ai = L.teams.filter((t) => !t.user && !t.human);
  if (!S.desk || !L.teams[S.desk.team] || L.teams[S.desk.team].user || L.teams[S.desk.team].human) S.desk = { team: ai[0].id, send: [], get: [], sendPicks: [], getPicks: [], msg: '', ok: false, counter: null };
  return S.desk;
}

export function renderTrades() {
  const L = S.league, me = user(), D = desk();
  const open = TR.tradeWindow(L);
  const deadline = TR.tradeDeadline(L);
  const when = L.phase === 'grades' ? `Open until the deadline, before week ${deadline + 1}`
    : open ? `Week ${L.week + 1} · Deadline before week ${deadline + 1}` : 'The deadline has passed';
  const st = LG.standings(L);
  const order = latestPower(L) ?? st.map((r) => r.id);
  return `<section class="trades">
    <p class="eyebrow">Season ${L.season ?? 1} · ${when}</p>
    <h1>Trade desk</h1>
    ${coachTip('trades', 'Add players on each side. The reaction is that club\'s real evaluation.')}
    <p class="small muted">Up to ${TR.MAX_PLAYERS} Pokémon each way, plus next year's first- and second-round picks. Rosters stay at ${L.settings.rounds}.</p>
    <div class="season-grid">
      <div class="col">
        ${D.msg ? `<div class="card verdict ${D.ok ? 'yes' : 'no'}" role="status"><p>${esc(D.msg)}</p>${D.ok && D.entry ? tradeMovesHtml(L, D.entry) : ''}</div>` : ''}
        ${tradeCardHtml(L)}
        ${open ? builderHtml(L, me, D) : '<div class="card"><h3>Trades are closed</h3><p class="muted">The trade deadline has passed. The desk opens again after next season\'s draft.</p></div>'}
      </div>
      <div class="col">
        ${payrollHtml(L, me, open ? L.teams[D.team] : null)}
        ${picksHtml(L, me)}
        <div class="card"><h3>Trade partners</h3><div class="partner-grid">${order.filter((id) => !L.teams[id].user && !L.teams[id].human).map((id) => {
          const t = L.teams[id], s = TR.teamStance(L, id, order), rec = st.find((r) => r.id === id);
          return `<button class="partner ${id === D.team ? 'on' : ''}" data-act="deskteam" data-team="${id}" ${open ? '' : 'disabled'} style="--team:${t.color}"><b>${esc(t.abbr)}</b><span>${esc(t.name)}</span><small>${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''} · ${STANCE[s]}</small></button>`;
        }).join('')}</div>
          <p class="small muted">Contenders want help now. Rebuilders prefer picks.</p></div>
        ${logHtml(L)}
      </div>
    </div>
  </section>`;
}

function builderHtml(L, me, D) {
  const ai = L.teams[D.team];
  const deal = { team: D.team, send: D.send, get: D.get, sendPicks: D.sendPicks, getPicks: D.getPicks };
  const empty = !D.send.length && !D.get.length && !D.sendPicks.length && !D.getPicks.length;
  const ev = empty ? null : TR.evaluateTrade(L, deal);
  const q = (S.deskQ ?? '').trim().toLowerCase();
  return `<div class="card deal-room"><h3>You send ↔ you receive</h3>
    <div class="deal-canvas">
      <div class="deal-side"><h4>You send</h4>${canvasChips(L, D.send, D.sendPicks, 'send')}${pickChips(L, TR.picksOwned(L, me.id), 'send', D.sendPicks)}</div>
      <div class="deal-side"><h4>You receive</h4>${canvasChips(L, D.get, D.getPicks, 'get')}${pickChips(L, TR.picksOwned(L, ai.id), 'get', D.getPicks)}</div>
    </div>
    ${ev ? verdictHtml(L, ev, D) : '<p class="small muted">Add a Pokémon or a pick on each side.</p>'}
    <label>Find a player<input id="desk-q" type="search" value="${esc(S.deskQ ?? '')}" placeholder="Name"></label>
    <div class="desk-cols">
      <div><h4>Your roster</h4>${rosterList(L, me, 'send', D.send, q)}</div>
      <div><h4>${esc(ai.name)}</h4>${rosterList(L, ai, 'get', D.get, q)}</div>
    </div>
  </div>`;
}
function canvasChips(L, ids, picks, side) {
  if (!ids.length && !picks.length) return '<p class="small muted">Empty</p>';
  return `<div class="canvas-row">${ids.map((id) => `<button class="canvas-mon" data-act="desktoggle" data-side="${side}" data-id="${id}" aria-pressed="true">${sprite(id, 'md')}<span>${esc(P(id).name)}</span></button>`).join('')}</div>`;
}

// A roster with a tick box per Pokémon: starters by slot first, then the bench.
function rosterList(L, team, side, chosen, q = '') {
  const slotOf = (id) => SLOT_KEYS.find((k) => team.lineup[k] === id);
  const ids = [...SLOT_KEYS.map((k) => team.lineup[k]).filter((id) => id != null), ...team.bench];
  const full = chosen.length >= TR.MAX_PLAYERS;
  const rows = [...new Set(ids)].filter((id) => !q || P(id).name.toLowerCase().includes(q));
  return `<div class="mon-grid">${rows.map((id) => {
    const on = chosen.includes(id), k = slotOf(id) ?? P(id).best[0];
    const hurt = L.injuries?.[id];
    const dis = !on && full;
    return `<button class="monpick ${on ? 'on' : ''}" data-act="desktoggle" data-side="${side}" data-id="${id}" aria-pressed="${on}" ${dis ? 'disabled' : ''}>${monCard(id, { slot: k, size: 'sm' })}${hurt ? '<span class="cond hurt">Hurt</span>' : ''}<span class="sal">$${salary(L, id)}M</span></button>`;
  }).join('') || '<p class="small muted">No match.</p>'}</div>`;
}

function pickChips(L, keys, side, chosen) {
  if (!keys.length) return '<p class="small muted">No picks to trade.</p>';
  return `<div class="desk-picks">${keys.map((k) => `<button class="pickchip ${chosen.includes(k) ? 'on' : ''}" data-act="deskpick" data-side="${side}" data-key="${k}" aria-pressed="${chosen.includes(k)}">${esc(TR.pickLabel(L, k))}</button>`).join('')}</div>`;
}

function verdictHtml(L, ev, D) {
  if (!ev.you) return `<div class="verdict no"><p>${esc(TR.verdictText(L, ev))}</p></div>`;
  const moves = tradeMovesHtml(L, { team: ev.deal.team, released: { you: ev.you.released, them: ev.them.released }, signed: { you: ev.you.signed, them: ev.them.signed } });
  const g = ev.you.gain;
  const C = D.counter;
  const tone = ev.problems?.length ? 'Invalid' : ev.verdict === 'yes' ? 'Likely accepted' : ev.verdict === 'close' ? 'Needs improvement' : 'Unlikely';
  return `<div class="verdict ${ev.problems?.length ? 'no' : ev.verdict}"><p class="verdict-k">${tone}</p><p><b>${esc(TR.verdictText(L, ev))}</b></p>
      <p class="small">Your best lineup ${g > 0 ? `improves by ${g}` : g < 0 ? `drops by ${-g}` : 'stays the same'} points${ev.deal.getPicks.length || ev.deal.sendPicks.length ? ', before the picks' : ''}.</p>
      ${ev.you.payroll != null ? `<p class="small">Payroll after: you $${ev.you.payroll}M (${capLine(L, ev.you.payroll)}), ${esc(L.teams[ev.deal.team].abbr)} $${ev.them.payroll}M (${capLine(L, ev.them.payroll)}).</p>` : ''}
      ${moves}${tradeKickingHtml(L, ev.deal)}</div>
    ${C ? `<div class="verdict yes"><p class="small">${esc(L.teams[C.deal.team].name)} would take it like this:</p>
      <div class="trade"><div class="tswap">${dealSideHtml(L, C.deal.get, C.deal.getPicks, 'You get')}<span class="at">for</span>${dealSideHtml(L, C.deal.send, C.deal.sendPicks, 'You send')}</div></div>
      <div class="actions"><button class="btn" data-act="deskusecounter">Use this deal</button></div></div>` : ''}
    <div class="actions">
      <button class="btn primary" data-act="deskpropose" ${ev.problems.length ? 'disabled' : ''}>Propose the trade</button>
      ${ev.verdict !== 'yes' && !ev.problems.length && !C ? '<button class="btn" data-act="deskcounter">What would it take?</button>' : ''}
      <button class="btn ghost" data-act="deskclear">Clear</button>
    </div>`;
}

// Season payroll: salaries count from week 1, against the league cap (see trades.js).
const capLine = (L, pay) => { const room = leagueCap(L) - pay; return room >= 0 ? `$${room}M under the cap` : `$${-room}M over the cap`; };
function payrollHtml(L, me, them) {
  const cap = leagueCap(L);
  const row = (t) => {
    const pay = payroll(L, t), pct = Math.min(100, Math.round((pay / cap) * 100));
    return `<li>${teamBadge(t)} <span class="pn">${esc(t.user ? 'You' : t.name)}</span> <b>$${pay}M</b> <span class="small muted">${capSpace(L, t) >= 0 ? `$${capSpace(L, t)}M space` : `$${-capSpace(L, t)}M over`}</span>
      <span class="capbar" aria-hidden="true"><i style="width:${pct}%"></i></span></li>`;
  };
  return `<div class="card payroll"><h3>Payroll <span class="muted small">Cap $${cap}M</span></h3><ul class="tradelog">${row(me)}${them ? row(them) : ''}</ul>
    <p class="small muted">Every Pokémon's salary counts from week 1. A trade can't take a team over the cap unless it cuts its payroll.</p></div>`;
}

function picksHtml(L, me) {
  const mine = TR.picksOwned(L, me.id);
  const gone = Array.from({ length: TR.PICK_ROUNDS }, (_, i) => TR.pickKey((L.season ?? 1) + 1, i + 1, me.id)).filter((k) => !mine.includes(k));
  return `<div class="card"><h3>Your picks <span class="muted small">Season ${(L.season ?? 1) + 1} rookie draft</span></h3>
    ${mine.length ? `<div class="desk-picks">${mine.map((k) => `<span class="pickchip">${esc(TR.pickLabel(L, k))}</span>`).join('')}</div>` : '<p class="muted small">You have traded all your picks.</p>'}
    ${gone.length ? `<p class="small muted">Traded away: ${gone.map((k) => `${esc(TR.pickLabel(L, k))} to ${esc(L.teams[L.pickOwners[k]].abbr)}`).join(', ')}. You still fill your roster in the rookie draft, at the end of it.</p>` : ''}</div>`;
}

function logHtml(L) {
  const log = (L.tradeLog ?? []).slice().reverse();
  if (!log.length) return '<div class="card"><h3>Trades</h3><p class="muted small">No trades yet.</p></div>';
  const part = (ids, picks) => [...ids.map((id) => esc(P(id).name)), ...picks.map((k) => esc(TR.pickLabel(L, k)))].join(', ') || 'nothing';
  return `<div class="card"><h3>Trades</h3><ul class="tradelog">${log.map((e) => `<li><span class="small muted">Season ${e.season}${e.week != null ? `, week ${e.week + 1}` : ', after the draft'}</span><br>
    You sent ${part(e.send, e.sendPicks)} to ${teamBadge(L.teams[e.team])} for ${part(e.get, e.getPicks)}.</li>`).join('')}</ul></div>`;
}

// ---------- events ----------

export function deskToggle(side, id, on) {
  const D = desk();
  const list = side === 'send' ? D.send : D.get;
  const i = list.indexOf(id);
  if (on && i < 0 && list.length < TR.MAX_PLAYERS) list.push(id);
  if (!on && i >= 0) list.splice(i, 1);
  D.counter = null; D.msg = '';
  render();
}
export function deskPick(side, key) {
  const D = desk();
  const list = side === 'send' ? D.sendPicks : D.getPicks;
  const i = list.indexOf(key);
  if (i < 0) list.push(key); else list.splice(i, 1);
  D.counter = null; D.msg = '';
  render();
}
export function deskTeam(id) {
  const D = desk();
  S.desk = { ...D, team: id, get: [], getPicks: [], counter: null, msg: '' };
  render();
}
export function deskClear() {
  const D = desk();
  S.desk = { ...D, send: [], get: [], sendPicks: [], getPicks: [], counter: null, msg: '' };
  render();
}
export function deskCounter() {
  const D = desk();
  const c = TR.counterOffer(S.league, D);
  D.counter = c;
  D.msg = c ? '' : `${S.league.teams[D.team].name} don't see a simple way to make that work.`;
  D.ok = false;
  render();
}
export function deskUseCounter() {
  const D = desk();
  if (!D.counter) return;
  const d = D.counter.deal;
  S.desk = { ...D, send: d.send, get: d.get, sendPicks: d.sendPicks, getPicks: d.getPicks, counter: null, msg: '' };
  render();
}
export function deskPropose() {
  const D = desk();
  // Online the server makes the deal; its answer comes back to the desk.
  if (S.online) { netSend({ t: 'propose', deal: { team: D.team, send: D.send, get: D.get, sendPicks: D.sendPicks, getPicks: D.getPicks } }); S.desk = { ...D, msg: 'Sending the offer…', ok: false }; render(); return; }
  const res = TR.proposeTrade(S.league, D);
  S.desk = res.ok ? { team: D.team, send: [], get: [], sendPicks: [], getPicks: [], msg: res.text, ok: true, entry: res.entry, counter: null }
    : { ...D, msg: res.text, ok: false };
  if (res.ok) save();
  render();
}
