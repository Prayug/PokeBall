// Record book: the Hall of Fame and its ballot, career leaders, each franchise's records and
// all-time results, and the rivalries built in the playoffs. Also the Rivalry card the season
// hub shows when two teams meet in the playoffs.
import * as RC from '../records.js';
import { S } from '../state.js';
import { P, esc, sprite, teamBadge, user } from '../ui.js';
import { roundLabel } from '../geometry.js';

const ROUND = (round) => roundLabel(S.league, round);

export function renderRecords() {
  const L = S.league, me = user();
  RC.ensureRecords(L);
  const pick = S.recTeam === 'league' ? null : (S.recTeam ?? me.id);
  const teamOpts = [['league', 'Whole league'], ...L.teams.map((t) => [t.id, t.name])];
  const book = RC.recordBook(L, pick);
  const fr = pick != null ? RC.franchiseSummary(L, pick) : null;
  const rivals = RC.rivalries(L);
  const leaders = RC.careerLeaders(L);
  const anyRec = [...book.game, ...book.season].some((row) => row.rec);
  const fresh = !L.hof.length && !L.history.length && !anyRec;
  return `<section class="records trophy">
    <p class="eyebrow">Season ${L.season} · ${L.history.length} complete</p>
    <h1>Trophy room</h1>
    ${fresh ? `<div class="card trophy-empty"><h2>Your franchise history begins here.</h2><p>Championships, a Hall of Fame, and single-game records fill these walls as the league is played.</p><ul class="trophy-slots">${['Championship', 'Hall of Fame', 'Career leader', 'Rivalry'].map((n) => `<li><span class="sil" aria-hidden="true"></span><b>${n}</b><em>Not earned yet</em></li>`).join('')}</ul></div>` : ''}
    ${bannerHtml(L)}
    ${hofHtml(L)}
    <div class="card"><h3>Career leaders</h3>
      <div class="leader-row">${Object.entries(leaders).map(([k, rows]) => {
        const r = rows[0];
        return r ? `<button class="leader-card" data-act="profile" data-id="${r.id}">${sprite(r.id, 'lg')}<span><em>${esc(k)}</em><b>${esc(P(r.id).name)}</b><small>${L.teams[r.team]?.abbr ?? ''} · ${r.v}</small></span></button>` : `<div class="leader-card empty"><span class="sil" aria-hidden="true"></span><span><em>${esc(k)}</em><b>Open</b></span></div>`;
      }).join('')}</div></div>
    <div class="card"><h3>Rivalries</h3>
      ${rivals.length ? `<ul class="rivals">${rivals.map((r) => rivalLine(L, r)).join('')}</ul>` : '<p class="muted">Playoff meetings become rivalries. None yet.</p>'}</div>
    <details class="card" ${anyRec ? '' : ''}><summary>Statistical records</summary>
      <label class="inline"><span class="sr">Franchise</span><select id="rec-team">${teamOpts.map(([v, n]) => `<option value="${v}" ${String(v) === String(pick ?? 'league') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${fr ? `<p class="small">All time: <b>${fr.w}-${fr.l}${fr.t ? `-${fr.t}` : ''}</b> regular season, <b>${fr.pw}-${fr.pl}</b> playoffs${fr.titles.length ? `, champions in season ${fr.titles.join(', ')}` : ''}.</p>` : ''}
      <h4>Single game</h4>${recTable(L, book.game, pick == null)}
      <h4>Single season</h4>${recTable(L, book.season, pick == null)}
    </details>
  </section>`;
}
function bannerHtml(L) {
  if (!L.history?.length) return '';
  return `<div class="banner-row">${L.history.map((h) => `<div class="banner" style="--team:${L.teams[h.champion]?.color ?? '#888'}"><em>Season ${h.season}</em><b>${esc(L.teams[h.champion]?.name ?? '')}</b><span>Champions</span></div>`).join('')}</div>`;
}

function hofHtml(L) {
  const ballot = RC.hofBallot(L).slice(0, 4);
  return `<div class="card"><h3>Hall of Fame <span class="muted small">${L.hof.length} enshrined</span></h3>
    ${L.hof.length ? `<ul class="awards hof">${L.hof.slice().reverse().map((h) => `<li>${sprite(h.id, 'md')}<span><em>Class of season ${h.season}</em><b>${esc(P(h.id).name)}</b> ${teamBadge(L.teams[h.team])}<span class="small muted">${esc(h.line)}</span></span></li>`).join('')}</ul>`
      : `<p class="muted small">Nobody yet. A Pokémon becomes eligible after ${RC.HOF_MIN_SEASONS} seasons and goes in once its career is worth ${RC.HOF_POINTS} points: production, awards and titles. At most ${RC.HOF_CLASS} go in each year.</p>`}
    ${ballot.length ? `<h4>On the ballot</h4><ul class="ballot">${ballot.map((b) => `<li>${sprite(b.id, 'xs')}<span class="cn">${esc(P(b.id).name)}</span>${teamBadge(L.teams[b.team])}<span class="small muted">${b.seasons} seasons</span><b class="num">${b.points} of ${RC.HOF_POINTS}</b></li>`).join('')}</ul>` : ''}
  </div>`;
}

function when(r) {
  if (r.playoff) return `S${r.season} ${ROUND(r.round)}`;
  return r.week != null ? `S${r.season} wk ${r.week + 1}` : `Season ${r.season}`;
}

function recTable(L, rows, showTeam) {
  return `<div class="tablewrap"><table class="recs"><tbody>${rows.map(({ label, rec, key }) => {
    if (!rec) return `<tr><td>${label}</td><td class="muted" colspan="3">Not set yet</td></tr>`;
    const who = rec.id != null ? `${sprite(rec.id, 'xs')} ${esc(P(rec.id).name)}` : key === 'w' || key === 'pa' || key === 'pf' ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}` : '';
    const vs = rec.opp != null ? ` vs ${L.teams[rec.opp].abbr}` : '';
    return `<tr><td>${label}</td><td class="num"><b>${rec.v}</b></td><td>${showTeam ? `${teamBadge(L.teams[rec.team])} ` : ''}${who}</td><td class="small muted">${when(rec)}${vs}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function rivalLine(L, r) {
  const A = L.teams[r.a], B = L.teams[r.b];
  return `<li>${teamBadge(A)}<b class="num">${r.aWins}-${r.bWins}${r.ties ? `-${r.ties}` : ''}</b>${teamBadge(B)}
    <span class="small muted">${r.playoffs.length} playoff meeting${r.playoffs.length > 1 ? 's' : ''}, ${r.aPlayoffWins}-${r.bPlayoffWins}</span></li>`;
}

// The Rivalry card for a playoff game: series, playoff history, streak and the last meeting.
export function rivalryCardHtml(L, a, b, round) {
  const r = RC.rivalry(L, a, b);
  const A = L.teams[a], B = L.teams[b];
  const name = (id) => esc(L.teams[id].name);
  const series = r.played ? (r.aWins === r.bWins ? `The series is level at ${r.aWins}-${r.bWins}${r.ties ? `-${r.ties}` : ''}.`
    : `${name(r.aWins > r.bWins ? a : b)} lead the series ${Math.max(r.aWins, r.bWins)}-${Math.min(r.aWins, r.bWins)}${r.ties ? `-${r.ties}` : ''}.`)
    : 'These two have never met.';
  const po = r.playoffs.length ? `${r.playoffs.length === 1 ? 'One earlier playoff meeting' : `${r.playoffs.length} earlier playoff meetings`}, ${r.aPlayoffWins}-${r.bPlayoffWins}.` : 'Their first playoff meeting.';
  const score = (g) => `${L.teams[g.winner ?? a].abbr} ${Math.max(g.aScore, g.bScore)}-${Math.min(g.aScore, g.bScore)}`;
  const facts = [];
  if (r.last) facts.push(`Last time: ${r.last.winner == null ? `tied ${r.last.aScore}-${r.last.bScore}` : `${score(r.last)}`}, ${when(r.last).replace(/^S(\d+)/, 'season $1')}.`);
  if (r.streak && r.streak.n >= 2) facts.push(`${name(r.streak.team)} have won ${r.streak.n} straight.`);
  if (r.biggest && r.played > 1) facts.push(`Biggest win: ${score(r.biggest)} in season ${r.biggest.season}.`);
  if (r.titles[0] || r.titles[1]) facts.push(`Titles: ${A.abbr} ${r.titles[0]}, ${B.abbr} ${r.titles[1]}.`);
  return `<div class="card rivalry" style="--ta:${A.color};--tb:${B.color}">
    <h3>Rivalry <span class="muted small">${ROUND(round)}</span></h3>
    <div class="rv-head">${teamBadge(A)}<b class="num">${r.aWins}</b><span class="muted">series</span><b class="num">${r.bWins}</b>${teamBadge(B)}</div>
    <p>${series} ${po}</p>
    ${facts.length ? `<ul class="rv-facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
    ${r.playoffs.length ? `<p class="small muted">${r.playoffs.map((g) => `Season ${g.season} ${ROUND(g.round).toLowerCase()}: ${score(g)}`).join(' · ')}</p>` : ''}
  </div>`;
}
