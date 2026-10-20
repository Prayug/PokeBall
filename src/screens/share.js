// "Share this league": the link and code for the league's draft, and the card a shared link
// opens on the home screen (load the draft as it went, or draft from the same seed). Once you
// have played, the link is a challenge to beat your first season, and a league that took one on
// keeps score against it on the season screen.
import { render, setScreen } from '../app.js';
import { S, loadSaved, save } from '../state.js';
import { FINISH_SHORT, SHARE_URL, attachChallenge, challengeRecord, challengeText, decodeLeague, encodeLeague, leagueFromShare, recordText, settleChallenge } from '../share.js';
import { esc } from '../ui.js';

export function shareLink(code) {
  let base = SHARE_URL;
  try { if (/^https?:$/.test(location.protocol)) base = location.origin + location.pathname; } catch { /* no location */ }
  return `${base}#league=${code}`;
}

// The share box: a button that opens the link and the code, each with a copy button.
export function shareCardHtml(L) {
  const code = S.shareOpen ? encodeLeague(L) : null;
  if (!S.shareOpen) return `<button class="btn" data-act="share">Share this league</button>`;
  if (!code) return `<p class="small muted">This league was drafted before sharing existed, so its draft can't be shared.</p>`;
  const ch = challengeRecord(L);
  const picks = L.pickIndex != null && L.phase === 'draft' && (L.season ?? 1) === 1 ? `the first ${L.pickIndex} picks` : 'every pick';
  return `<div class="sharebox">
    <p class="small muted">The link carries the draft seed, your settings and ${picks}. A friend who opens it can load the draft as it went or draft from the same seed themselves.</p>
    ${ch ? `<p class="small">It is also a challenge: your first season, <b>${esc(challengeText(ch))}</b>. Your friend has to beat it with the same draft.</p>` : ''}
    <label class="sharefield"><span>Link</span><input id="share-link" readonly value="${esc(shareLink(code))}"></label>
    <div class="actions"><button class="btn primary" data-act="sharecopy" data-what="link">Copy link</button><button class="btn" data-act="sharecopy" data-what="code">Copy code only</button>
      <button class="btn" data-act="share">Close</button></div>
    ${S.shareMsg ? `<p class="small good" role="status">${esc(S.shareMsg)}</p>` : ''}
  </div>`;
}

export function copyShare(L, what) {
  const code = encodeLeague(L);
  if (!code) return;
  const text = what === 'code' ? code : shareLink(code);
  const done = (ok) => { S.shareMsg = ok ? (what === 'code' ? 'Code copied.' : 'Link copied.') : 'Copy failed. Select the link and copy it by hand.'; render(); };
  try {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
  } catch { done(fallbackCopy(text)); }
}
function fallbackCopy(text) {
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
  t.remove();
  return ok;
}

// A league code in the address (#league=…) or pasted on the home screen.
export function readShareFromUrl() {
  let D = null;
  try { D = decodeLeague(location.hash + location.search); } catch { /* no location */ }
  if (!D) return;
  S.shareIn = D;
  // Drop the code from the address so a reload doesn't offer it again.
  try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]league=[^&]*/, '')); } catch { /* file:// */ }
}
export function openSharedText(text) {
  const D = decodeLeague(text);
  if (!D) return false;
  S.shareIn = D; S.importMsg = '';
  render();
  window.scrollTo(0, 0);
  return true;
}

export function sharedInHtml() {
  const D = S.shareIn;
  if (!D) return '';
  const total = D.rounds * D.numTeams;
  const saved = loadSaved()?.league;
  const opts = [`${D.rounds} rounds`, `${D.numTeams} teams`, D.legendaries ? 'legendaries in' : 'no legendaries', D.typeCap ? 'type cap on' : 'no type cap'];
  const replaces = saved ? ' Either one replaces the league saved in this browser.' : '';
  const err = S.shareErr ? `<p class="small bad">${esc(S.shareErr)}</p>` : '';
  const C = D.challenge;
  if (C) {
    const rule = C.finish ? 'The better playoff finish wins, then the better record, then point differential.'
      : `You are judged on your first ${C.gp} game${C.gp === 1 ? '' : 's'}: the better record wins, then point differential.`;
    return `<div class="card shared challenge-in">
    <p class="eyebrow">Challenge #${esc(C.id)}</p>
    <h2>${esc(D.name)} (${esc(D.abbr)}) challenges you to beat ${esc(challengeText(C))}</h2>
    <p>Their first season: ${recordText(C)}, ${C.pf} points scored and ${C.pa} allowed. ${opts.join(' · ')}.</p>
    <div class="actions"><button class="btn primary" data-act="shareload" data-replay="0" data-challenge="1">Draft your own team</button>
      <button class="btn" data-act="shareload" data-replay="1" data-challenge="1">Play their team</button>
      <button class="btn" data-act="sharedismiss">Not now</button></div>
    <p class="small muted">Draft your own team: the same draft order and AI drafters, and every pick for your team is yours. Play their team: their draft as it went, and you coach their roster through the same schedule. ${rule}${replaces}</p>
    ${err}
  </div>`;
  }
  return `<div class="card shared">
    <p class="eyebrow">Shared league</p>
    <h2>${esc(D.name)} (${esc(D.abbr)}) sent you their draft</h2>
    <p>${opts.join(' · ')}. ${D.picks.length >= total ? 'The draft is complete.' : `${D.picks.length} of ${total} picks made.`}</p>
    <div class="actions"><button class="btn primary" data-act="shareload" data-replay="1">Load their draft</button>
      <button class="btn" data-act="shareload" data-replay="0">Draft it yourself</button>
      <button class="btn" data-act="sharedismiss">Not now</button></div>
    <p class="small muted">Load their draft: every pick as they made it, and their team becomes yours${D.picks.length < total ? '; you make the rest of their picks' : ''}. Draft it yourself: the same draft order and AI drafters, and you make every pick for your own team.${replaces}</p>
    ${err}
  </div>`;
}

export function loadShared(replay, challenge = false) {
  const D = S.shareIn;
  if (!D) return;
  let L;
  try { L = leagueFromShare(D, { replay, teamName: S.setup.name, abbr: S.setup.abbr }); } catch (e) { S.shareErr = `That code doesn't rebuild a draft: ${e.message}.`; render(); return; }
  if (challenge) {
    attachChallenge(L, D, replay ? 'theirs' : 'own');
    // Taking on their roster, you still coach it under your own name.
    const me = L.teams.find((t) => t.user);
    if (replay && me) { me.name = S.setup.name; me.abbr = S.setup.abbr; }
  }
  S.shareIn = null; S.shareErr = '';
  S.league = L; S.game = null; S.gameMeta = null;
  S.draft = { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false };
  save();
  setScreen(L.phase === 'draft' ? 'draft' : 'grades');
}

// The season screen's challenge card: their mark, yours so far, and the verdict once it is in.
export function challengeCardHtml(L) {
  const C = L?.challenge;
  if (!C) return '';
  const st = settleChallenge(L);
  const mine = st.mine;
  const yours = !mine ? 'Your first season is over without a mark to compare.'
    : C.finish ? `You: ${recordText(mine)}${mine.finish ? `, ${FINISH_SHORT[mine.finish]}` : ` so far, ${mine.pf - mine.pa >= 0 ? '+' : ''}${mine.pf - mine.pa} in points`}.`
      : `You: ${recordText(mine)} through ${mine.gp} of ${C.gp} game${C.gp === 1 ? '' : 's'}.`;
  const verdict = { won: ['good', `You beat ${C.abbr}'s mark.`], lost: ['bad', `${C.abbr}'s mark stands.`], tied: ['', 'Dead even with their mark.'] }[st.state];
  return `<div class="card challenge"><h3>Challenge from ${esc(C.name)} <span class="muted small">#${esc(C.id)}</span></h3>
    <p>Their mark: <b>${esc(challengeText(C))}</b> (${C.pf - C.pa >= 0 ? '+' : ''}${C.pf - C.pa} in points)${C.mode === 'theirs' ? ', with the roster you are coaching' : ', from the same draft seed'}.</p>
    <p>${esc(yours)}</p>
    ${verdict ? `<p class="verdict ${verdict[0]}"><b>${esc(verdict[1])}</b> Send your own mark back with Share this league.</p>` : ''}
  </div>`;
}
