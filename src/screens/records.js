// Record book: the Hall of Fame and its ballot, career leaders, each franchise's records and
// all-time results, and the rivalries built in the playoffs. Also the Rivalry card the season
// hub shows when two teams meet in the playoffs.
import * as RC from '../records.js';
import { S } from '../state.js';
import { P, esc, sprite, teamBadge, user } from '../ui.js';

const ROUND = ['Semifinal', 'Championship'];

export function renderRecords() {
  const L = S.league, me = user();
  RC.ensureRecords(L);
  const pick = S.recTeam === 'league' ? null : (S.recTeam ?? me.id);
  const teamOpts = [['league', 'Whole league'], ...L.teams.map((t) => [t.id, t.name])];
  const book = RC.recordBook(L, pick);
  const fr = pick != null ? RC.franchiseSummary(L, pick) : null;
  const rivals = RC.rivalries(L);
  return `<section class="records">
    <p class="eyebrow">Season ${L.season} · ${L.history.length} complete</p>
    <h1>Record book</h1>
    <div class="season-grid">
      <div class="col">
        ${hofHtml(L)}
        <div class="card"><h3>Career leaders <span class="muted small">Every season, this one included</span></h3>
          <div class="leaders">${Object.entries(RC.careerLeaders(L)).map(([k, rows]) => `<div><h4>${k}</h4><ol>${rows.map((r) =>
            `<li>${sprite(r.id, 'xs')}<span>${esc(P(r.id).name)}</span><em>${L.teams[r.team]?.abbr ?? ''}</em><b>${r.v}</b></li>`).join('') || '<li class="muted">None yet</li>'}</ol></div>`).join('')}</div></div>
        <div class="card"><h3>Rivalries <span class="muted small">Teams that have met in the playoffs</span></h3>
          ${rivals.length ? `<ul class="rivals">${rivals.map((r) => rivalLine(L, r)).join('')}</ul>` : '<p class="muted small">No playoff games yet.</p>'}</div>
      </div>
      <div class="col">
        <div class="card"><h3>Records <label class="inline"><span class="sr">Franchise</span><select id="rec-team">${teamOpts.map(([v, n]) => `<option value="${v}" ${String(v) === String(pick ?? 'league') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></h3>
          ${fr ? `<p class="small">All time: <b>${fr.w}-${fr.l}${fr.t ? `-${fr.t}` : ''}</b> in the regular season, <b>${fr.pw}-${fr.pl}</b> in the playoffs${fr.titles.length ? `, champions in season ${fr.titles.join(', ')}` : ''}.</p>` : ''}
          <h4>Single game</h4>${recTable(L, book.game, pick == null)}
          <h4>Single season</h4>${recTable(L, book.season, pick == null)}
        </div>
      </div>
    </div>
  </section>`;
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
  if (r.playoff) return `S${r.season} ${ROUND[r.round] ?? 'playoffs'}`;
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
    <h3>Rivalry <span class="muted small">${ROUND[round] ?? 'Playoffs'}</span></h3>
    <div class="rv-head">${teamBadge(A)}<b class="num">${r.aWins}</b><span class="muted">series</span><b class="num">${r.bWins}</b>${teamBadge(B)}</div>
    <p>${series} ${po}</p>
    ${facts.length ? `<ul class="rv-facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
    ${r.playoffs.length ? `<p class="small muted">${r.playoffs.map((g) => `Season ${g.season} ${ROUND[g.round].toLowerCase()}: ${score(g)}`).join(' · ')}</p>` : ''}
  </div>`;
}
