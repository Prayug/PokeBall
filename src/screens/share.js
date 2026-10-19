// "Share this league": the link and code for the league's draft, and the card a shared link
// opens on the home screen (load the draft as it went, or draft from the same seed).
import { render, setScreen } from '../app.js';
import { S, loadSaved, save } from '../state.js';
import { SHARE_URL, decodeLeague, encodeLeague, leagueFromShare } from '../share.js';
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
  const picks = L.pickIndex != null && L.phase === 'draft' && (L.season ?? 1) === 1 ? `the first ${L.pickIndex} picks` : 'every pick';
  return `<div class="sharebox">
    <p class="small muted">The link carries the draft seed, your settings and ${picks}. A friend who opens it can load the draft as it went or draft from the same seed themselves.</p>
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
  return `<div class="card shared">
    <p class="eyebrow">Shared league</p>
    <h2>${esc(D.name)} (${esc(D.abbr)}) sent you their draft</h2>
    <p>${opts.join(' · ')}. ${D.picks.length >= total ? 'The draft is complete.' : `${D.picks.length} of ${total} picks made.`}</p>
    <div class="actions"><button class="btn primary" data-act="shareload" data-replay="1">Load their draft</button>
      <button class="btn" data-act="shareload" data-replay="0">Draft it yourself</button>
      <button class="btn" data-act="sharedismiss">Not now</button></div>
    <p class="small muted">Load their draft: every pick as they made it, and their team becomes yours${D.picks.length < total ? '; you make the rest of their picks' : ''}. Draft it yourself: the same draft order and AI drafters, and you make every pick for your own team.${saved ? ' Either one replaces the league saved in this browser.' : ''}</p>
    ${S.shareErr ? `<p class="small bad">${esc(S.shareErr)}</p>` : ''}
  </div>`;
}

export function loadShared(replay) {
  const D = S.shareIn;
  if (!D) return;
  let L;
  try { L = leagueFromShare(D, { replay, teamName: S.setup.name, abbr: S.setup.abbr }); } catch (e) { S.shareErr = `That code doesn't rebuild a draft: ${e.message}.`; render(); return; }
  S.shareIn = null; S.shareErr = '';
  S.league = L; S.game = null; S.gameMeta = null;
  S.draft = { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false };
  save();
  setScreen(L.phase === 'draft' ? 'draft' : 'grades');
}
