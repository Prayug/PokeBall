// The online lobby: a room code and its link, who is here, ready, ping, and a forfeit or a
// rematch. For a league before the draft: who has which team, and the commissioner starts it.
import { S } from '../state.js';
import { esc, teamBadge } from '../ui.js';
import { myName, roomLink } from '../net.js';

export function renderLobby() {
  const n = S.net || {};
  const link = n.code ? roomLink() : '';
  const players = n.players || [];
  const me = players.find((p) => (n.mode === 'quick' ? p.side === n.you && n.you != null : p.team != null && p.team === n.yourTeam));
  const meReady = !!me?.ready;
  const league = n.mode === 'league';
  const setup = league && n.phase === 'setup';
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(link.replace(/^https?:\/\//, ''));
  const who = (p) => {
    const team = league && p.team != null && S.league?.teams?.[p.team] ? S.league.teams[p.team].name : '';
    const seat = p.side === 0 ? 'Home' : p.side === 1 ? 'Away' : '';
    return `<article class="who-card ${p.ready ? 'ready' : ''} ${p.online ? '' : 'away'}">
      <b>${esc(p.name)}</b>
      <span>${[seat, team].filter(Boolean).map(esc).join(' · ') || 'In the room'}</span>
      <em>${p.ready ? 'Ready' : 'Not ready'}</em>
      <em>${p.online ? 'Here' : 'Away'}</em>
    </article>`;
  };
  return `<section class="home lobby">
    <div class="card">
      <p class="eyebrow">${n.h2h ? 'Head-to-head draft' : league ? 'Online league' : 'Quick match'}</p>
      <h1>${n.code ? esc(n.code) : 'Connecting…'}</h1>
      <p class="lede">${S.netDown ? 'Connection lost. Reconnecting…' : n.paused ? `Paused. Reconnect within ${Math.ceil((n.reconnectMs || 0) / 1000)}s, or the other side can take the forfeit.` : 'Send this link. The room code is the only secret.'}</p>
      ${link ? `<p class="mono small">${esc(link)}</p>` : ''}
      ${local ? '<p class="small bad">This link only works on this computer. Start the server with <code>npm run online</code> for a link your friends can open from anywhere.</p>' : ''}
      <div class="actions"><input id="net-name" type="text" maxlength="22" placeholder="Your name" value="${esc(me?.name && me.name !== 'Coach' && me.name !== 'Commissioner' ? me.name : myName())}" aria-label="Your name"><button class="btn" data-act="setname">Save name</button></div>
      <p>Ping <b id="net-ping">${n.ping != null ? `${n.ping} ms` : '…'}</b></p>
      ${S.netMsg ? `<p class="small bad">${esc(S.netMsg)}</p>` : ''}
      ${setup ? setupHtml(n) : `<div class="who-grid">${players.map(who).join('') || '<p class="muted">Waiting for a friend.</p>'}</div>`}
      ${league && !n.h2h ? claimHtml(n) : ''}
      <div class="actions">
        ${setup && n.yourTeam === 0 ? `<button class="btn primary" data-act="startdraft" ${n.h2h && !n.claims?.[1] ? 'disabled' : ''}>Start the draft</button>` : ''}
        ${!league && n.phase === 'lobby' && !meReady ? '<button class="btn primary" data-act="onlineready">Ready</button>' : ''}
        ${meReady ? '<span class="muted">You are ready. Waiting for the other coach.</span>' : ''}
        <button class="btn" data-act="netcopy">Copy link</button>
        ${n.canForfeit ? '<button class="btn" data-act="onlineforfeit">Take the forfeit</button>' : ''}
        ${n.canSim ? '<button class="btn" data-act="onlinesim">Sim the game they missed</button>' : ''}
        ${n.phase === 'final' && n.mode === 'quick' ? '<button class="btn primary" data-act="onlinerematch">Rematch</button>' : ''}
        ${league && !setup && n.yourTeam != null ? `<button class="btn primary" data-act="go" data-to="${n.phase === 'draft' ? 'draft' : n.phase === 'grades' ? 'grades' : 'season'}">To the league</button>` : ''}
        <button class="btn ghost" data-act="home">Leave</button>
      </div>
    </div>
  </section>`;
}
// Before the draft: every team, who coaches it, and what the commissioner is waiting on.
function setupHtml(n) {
  const teams = S.league?.teams || [];
  const claims = n.claims || {};
  const rows = teams.map((t) => {
    const coach = claims[t.id] ?? claims[String(t.id)];
    const here = (n.players || []).some((p) => p.team === t.id && p.online);
    return `<article class="who-card ${coach ? 'ready' : ''}">${teamBadge(t)}<span><b>${esc(t.name)}</b><em>${coach ? `${esc(coach)}${here ? '' : ' · away'}` : 'AI'}</em></span></article>`;
  }).join('');
  const wait = n.h2h ? (claims[1] ? 'Both coaches are in. The commissioner starts the draft.' : 'Waiting for your friend to open the link.')
    : n.yourTeam === 0 ? 'Start the draft once your friends have their teams. Teams nobody takes are drafted by the AI.'
      : 'Waiting for the commissioner to start the draft.';
  return `<div class="who-grid">${rows}</div><p class="small">${wait}</p>`;
}
function claimHtml(n) {
  const claims = n.claims || {};
  const mine = n.yourTeam;
  if (mine != null) return n.phase === 'setup' ? '' : `<p class="small">You coach ${esc(S.league?.teams?.[mine]?.name ?? `team ${mine}`)}. Empty teams stay on the AI.</p>`;
  const teams = S.league?.teams || [];
  const open = [];
  for (let i = 1; i < (teams.length || 8); i++) if (!claims[i] && !claims[String(i)]) open.push(i);
  if (!open.length) return '<p class="small muted">Every team is claimed.</p>';
  return `<p class="small">Pick a team to coach. Empty teams stay on the AI.</p><div class="who-grid">${open.map((i) => `<article class="who-card"><span><b>${esc(teams[i]?.name || `Team ${i}`)}</b><em>Open</em></span><button class="btn" data-act="claimteam" data-team="${i}">Coach ${esc(teams[i]?.name || `Team ${i}`)}</button></article>`).join('')}</div>`;
}
