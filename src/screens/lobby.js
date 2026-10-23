// The online lobby: a room code, who is here, ready, ping, and a forfeit or a rematch.
import { S } from '../state.js';
import { esc } from '../ui.js';

export function renderLobby() {
  const n = S.net || {};
  const tag = n.mode === 'league' ? 'online' : 'play';
  const link = n.code ? `${location.origin}${location.pathname}${location.search}#${tag}=${n.code}` : '';
  const players = n.players || [];
  return `<section class="home">
    <div class="card">
      <p class="eyebrow">${n.mode === 'league' ? 'Online league' : 'Quick match'}</p>
      <h1>${n.code ? esc(n.code) : 'Connecting…'}</h1>
      <p class="lede">${n.paused ? `Paused. Reconnect within ${Math.ceil((n.reconnectMs || 0) / 1000)}s, or the other side can take the forfeit.` : 'Send this link. The room code is the only secret.'}</p>
      ${link ? `<p class="mono small">${esc(link)}</p>` : ''}
      <p>Ping <b class="net-ping">${n.ping != null ? `${n.ping} ms` : '…'}</b></p>
      ${S.netMsg ? `<p class="small bad">${esc(S.netMsg)}</p>` : ''}
      <ul class="feed">${players.map((p) => `<li>${esc(p.name)} ${p.side === 0 ? '· home' : p.side === 1 ? '· away' : ''}${p.team != null ? ` · team ${p.team}` : ''} ${p.ready ? '· ready' : ''} ${p.online ? '' : '· disconnected'}</li>`).join('') || '<li class="muted">Waiting for a friend.</li>'}</ul>
      ${n.mode === 'league' ? claimHtml(n) : ''}
      <div class="actions">
        ${n.phase === 'lobby' || n.phase === 'season' ? `<button class="btn primary" data-act="onlineready">${n.mode === 'league' ? 'Ready for the game' : 'Ready'}</button>` : ''}
        <button class="btn" data-act="netcopy">Copy link</button>
        ${n.canForfeit ? '<button class="btn" data-act="onlineforfeit">Take the forfeit</button>' : ''}
        ${n.canSim ? '<button class="btn" data-act="onlinesim">Sim the game they missed</button>' : ''}
        ${n.phase === 'final' && n.mode === 'quick' ? '<button class="btn primary" data-act="onlinerematch">Rematch</button>' : ''}
        <button class="btn ghost" data-act="home">Home</button>
      </div>
    </div>
  </section>`;
}
function claimHtml(n) {
  const claims = n.claims || {};
  const mine = n.yourTeam;
  if (mine != null) return `<p class="small">You have team ${mine}. Empty teams stay on the AI.</p>`;
  const teams = S.league?.teams || [];
  const open = [];
  for (let i = 1; i < (teams.length || 8); i++) if (!claims[i] && !claims[String(i)]) open.push(i);
  if (!open.length) return '<p class="small muted">Every team is claimed.</p>';
  return `<p class="small">Claim an open team. Empty teams stay on the AI.</p><div class="actions">${open.map((i) => `<button class="btn" data-act="claimteam" data-team="${i}">${esc(teams[i]?.name || `Team ${i}`)}</button>`).join('')}</div>`;
}
