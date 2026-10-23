// Season hub: matchup and scouting report, standings, leaders, playoffs, awards, history,
// the stored box score of a finished game, and finishing a league game.
import { DEF_SLOTS, OFF_SLOTS, ST_SLOTS } from '../ratings.js';
import { WEATHER } from '../types.js';
import { clockText, quarterText, simUntil } from '../engine.js';
import * as LG from '../league.js';
import { setScreen } from '../app.js';
import { S } from '../state.js';
import { P, edgeRow, esc, kickerHtml, punterHtml, rangeLine, sprite, teamBadge, user } from '../ui.js';
import { tradeCardHtml } from './draft.js';
import { SCHEMES } from '../coach.js';
import { injuryReport } from '../injuries.js';
import { powerRanking } from '../weekly.js';
import { rivalryCardHtml } from './records.js';
import { signingsHtml } from './freeagency.js';
import { boxHtml } from './game.js';
import { challengeCardHtml, shareCardHtml } from './share.js';
import { isFinalRound, playoffField, playoffSeeds, roundLabel } from '../geometry.js';
import { tradeDeadline, tradeWindow } from '../trades.js';

// ---------- season ----------
export function renderSeason() {
  const L = S.league;
  const me = user();
  const st = LG.standings(L);
  const lead = LG.leaders(L);
  let main = '';
  if (L.phase === 'season') {
    const gm = LG.userGame(L);
    const opp = L.teams[gm.home === me.id ? gm.away : gm.home];
    main = `<div class="card matchup">
      <p class="eyebrow">Season ${L.season ?? 1} · Week ${L.week + 1} of ${L.schedule.length}</p>
      <div class="vs">${teamBlock(L.teams[gm.away])}<span class="at">at</span>${teamBlock(L.teams[gm.home])}</div>
      <p class="muted">${esc(opp.name)} coach: ${esc(opp.coachName)}${SCHEMES[me.coach] && me.coach !== 'balanced' ? ` · You: ${esc(SCHEMES[me.coach].name)}` : ''}</p>
      ${weekActions(L, 'Play the game')}
    </div>${reviewHtml(L)}${tradeCardHtml(L)}${deskLinkHtml(L)}${scoutHtml(L, me.id, opp.id)}`;
  } else if (L.phase === 'playoffs') {
    const P_ = L.playoffs;
    const mine = P_.games.find((g) => g.home === me.id || g.away === me.id);
    main = `<div class="card matchup"><p class="eyebrow">${roundLabel(L, P_.round, true)}</p>
      ${bracketHtml(L)}
      <div class="actions">${mine ? weekActions(L, 'Play your playoff game', false)
        : `<p class="muted">${P_.round === 0 && P_.byes?.includes(me.id) ? 'You have a bye this round: rest up and watch who you get.' : 'You missed this round. Watch it play out.'}</p>${S.online ? onlineWeekActions(L, '') : '<button class="btn primary" data-act="simweek">Simulate the round</button>'}`}</div></div>
      ${P_.games.map((g) => (g === mine || (!mine && isFinalRound(L, P_.round)) ? rivalryCardHtml(L, g.home, g.away, P_.round) : '')).join('')}
      ${mine ? scoutHtml(L, me.id, mine.home === me.id ? mine.away : mine.home) : ''}`;
  } else if (L.phase === 'done') {
    main = championHtml(L, st);
  } else if (L.phase === 'grades') {
    // The draft is done and the season has not started: start it from here too.
    main = `<div class="card matchup"><p class="eyebrow">Season ${L.season ?? 1} · Draft complete</p><h2>Ready for week 1</h2>
      <div class="actions"><button class="btn primary" data-act="startseason">Start the season</button><button class="btn" data-act="go" data-to="depth">Edit depth chart</button></div></div>`;
  } else if (L.phase === 'offseason') {
    main = `<div class="card matchup"><p class="eyebrow">Season ${L.season} offseason</p><h2>Training camp is open</h2>
      <div class="actions"><button class="btn primary" data-act="go" data-to="offseason">Make your cuts</button></div></div>`;
  }
  const results = L.results.map((r, i) => ({ r, i })).reverse();
  return `<section class="season">
    <h1>${esc(me.name)} · ${record(st.find((r) => r.id === me.id))}</h1>
    <div class="season-grid">
      <div class="col">${main}
        ${challengeCardHtml(L)}
        ${L.phase === 'season' ? '' : reviewHtml(L)}
        <div class="card"><h3>Results ${results.length ? '<span class="muted small">Open a game for its box score</span>' : ''}</h3>${results.length ? `<ul class="results scroll">${results.map(({ r, i }) => resultLine(r, i)).join('')}</ul>` : '<p class="muted">No games played yet.</p>'}</div>
        ${historyHtml(L)}
        ${L.fa?.log?.length && L.phase !== 'offseason' ? signingsHtml(L, `Season ${L.season} free agency`) : ''}
      </div>
      <div class="col">
        ${standingsHtml(L, st)}
        ${powerHtml(L)}
        ${injuryHtml(L)}
        <div class="card"><h3>League leaders</h3><div class="leaders">${Object.entries(lead).map(([k, rows]) => `<div><h4>${k}</h4><ol>${rows.slice(0, 3).map((r) => `<li>${sprite(r.id, 'xs')}<span>${esc(P(r.id).name)}</span><em>${L.teams[r.team].abbr}</em><b>${statFor(k, r)}</b></li>`).join('') || '<li class="muted">None yet</li>'}</ol></div>`).join('')}</div></div>
        <div class="card"><h3>Your save</h3><p class="small muted">Download the league to keep it safe or move it to another browser. Import it from the home screen.</p>
          <div class="actions"><button class="btn" data-act="exportsave">Export save</button><button class="btn" data-act="recap">Download recap</button></div>
          ${shareCardHtml(L)}</div>
      </div>
    </div>
  </section>`;
}

// Play or sim this week's game. A game already under way is resumed (or simmed from where it
// stands) rather than started again; in the regular season the rest of it can be simmed in one go.
function weekActions(L, label, wrap = true) {
  if (S.online) return wrap ? `<div class="actions">${onlineWeekActions(L, label)}</div>` : onlineWeekActions(L, label);
  const g = S.game, live = g && !g.final && S.gameMeta && !S.gameMeta.quick;
  const rest = L.phase === 'season' && L.week < L.schedule.length - 1 && !live
    ? `<button class="btn ghost" data-act="simseason" title="Simulate your games and everyone else's to the end of the regular season">Sim to the playoffs</button>` : '';
  const btns = live
    ? `<button class="btn primary" data-act="playweek">Resume the game</button><button class="btn" data-act="simweek">Simulate the rest</button><span class="small muted">${esc(g.teams[1].abbr)} ${g.score[1]}, ${esc(g.teams[0].abbr)} ${g.score[0]} · ${quarterText(g.quarter)} ${clockText(g.clock)}</span>`
    : `<button class="btn primary" data-act="playweek">${label}</button><button class="btn" data-act="simweek">Simulate it</button>${rest}`;
  return wrap ? `<div class="actions">${btns}</div>` : btns;
}

// An online league: the server plays the week. Ready up for your game; the commissioner can sim a
// game whose coach is away; everyone sees which games are being played right now.
function onlineWeekActions(L, label) {
  const n = S.net || {};
  const me = n.yourTeam;
  const playoff = L.phase === 'playoffs';
  const round = playoff ? L.playoffs.round : null;
  const games = playoff ? L.playoffs.games : L.schedule[L.week] ?? [];
  const mine = games.find((g) => g.home === me || g.away === me);
  const done = mine && L.results.some((r) => r.home === mine.home && r.away === mine.away && (playoff ? r.playoff && r.round === round : !r.playoff && r.week === L.week));
  const ready = (n.players || []).some((p) => p.team === me && p.ready);
  const live = (n.games || []).map((g) => `<li>${esc(L.teams[g.away]?.abbr ?? '')} ${g.score[1]}, ${esc(L.teams[g.home]?.abbr ?? '')} ${g.score[0]} · ${quarterText(g.quarter)}</li>`).join('');
  const parts = [];
  if (mine && !done && label) parts.push(ready ? '<span class="muted">You are ready. Waiting for the other coach.</span>' : `<button class="btn primary" data-act="playweek">${label}</button>`);
  else if (mine && done) parts.push('<span class="muted">Your game is in. The week moves on when the rest are played.</span>');
  if (n.waiting) parts.push('<span class="small muted">Your opponent is a friend who is not here right now.</span>');
  if (n.canSim) parts.push('<button class="btn" data-act="onlinesim">Sim a game whose coach is away</button>');
  if (live) parts.push(`<div class="small"><b>Being played now</b><ul class="feed">${live}</ul></div>`);
  return parts.join('');
}

function scoutHtml(L, myId, oppId) {
  const R = LG.scoutReport(L, myId, oppId);
  const opp = L.teams[oppId];
  const lineupRow = (slots) => slots.map((k) => `<span class="sl" title="${esc(P(R.opp.lineup[k]).name)} (${k})">${sprite(R.opp.lineup[k], 'sm')}<em>${k}</em></span>`).join('');
  const W = WEATHER;
  const weather = R.weather.length ? R.weather.map((w) => `<li>${sprite(w.id, 'xs')} ${esc(P(w.id).name)} (${w.side === 'you' ? 'yours' : 'theirs'}) brings ${W[w.weather].name.toLowerCase()} most games: ${esc(W[w.weather].text)}.</li>`).join('')
    : '<li class="muted">No weather setters in either lineup. Expect clear skies most weeks.</li>';
  const tag = (h) => (h.injury ? `<span class="cond hurt">Injured, out ${weeksText(h.injury.weeks)}</span>` : h.out ? '<span class="cond out">Out this week</span>' : `<span class="cond sore">Starts at ${h.energy}%</span>`);
  const health = R.health.length ? `<h4>Your health</h4><ul class="health">${R.health.map((h) => `<li>${sprite(h.id, 'xs')} ${esc(P(h.id).name)} ${tag(h)}</li>`).join('')}</ul>` : '';
  const theirs = R.theirHurt.length ? `<h4>Their injuries</h4><ul class="health">${R.theirHurt.map((h) => `<li>${sprite(h.id, 'xs')} ${esc(P(h.id).name)} <span class="cond hurt">Out ${weeksText(h.weeks)}</span></li>`).join('')}</ul>` : '';
  return `<div class="card scout"><h3>Scouting report <span class="muted">${teamBadge(opp)} ${esc(opp.name)}</span></h3>
    <p class="plan"><b>Game plan.</b> ${esc(R.plan)} ${esc(R.lean)}</p>
    <p class="small muted">${esc(R.coachNote)}</p>
    <div class="opprow"><span class="muted small">Their offense</span>${lineupRow(OFF_SLOTS)}</div>
    <div class="opprow"><span class="muted small">Their defense</span>${lineupRow(DEF_SLOTS)}</div>
    <div class="opprow"><span class="muted small">Their kickers</span>${lineupRow(ST_SLOTS)}</div>
    ${kickingHtml(R.kicking)}
    <div class="edges"><div><h4>Your best type edges</h4>${R.best.length ? `<ul>${R.best.map(edgeRow).join('')}</ul>` : '<p class="muted small">None this week.</p>'}</div>
    <div><h4>Where they have the edge</h4>${R.worst.length ? `<ul>${R.worst.map(edgeRow).join('')}</ul>` : '<p class="muted small">Nothing to worry about.</p>'}</div></div>
    <h4>Weather</h4><ul class="weather">${weather}</ul>
    ${health}${theirs}
  </div>`;
}

// Kicker and punter for both sides, and where each team's field goal range starts.
function kickingHtml({ me, opp }) {
  const row = (label, mine, theirs) => `<tr><th>${label}</th><td>${mine}</td><td>${theirs}</td></tr>`;
  let note = '';
  if (me.k && opp.k) {
    const d = me.k.range - opp.k.range;
    note = `Your field goal range starts at their ${rangeLine(me.k.range)}; theirs starts at your ${rangeLine(opp.k.range)}.`
      + (Math.abs(d) >= 4 ? ` ${d > 0 ? 'Your kicker has' : 'Their kicker has'} ${Math.abs(d)} more yards of range.` : '');
  }
  return `<h4>Kicking game</h4><div class="tablewrap"><table class="kicking"><thead><tr><th></th><th>Yours</th><th>Theirs</th></tr></thead><tbody>
    ${row('Kicker', kickerHtml(me.k), kickerHtml(opp.k))}${row('Punter', punterHtml(me.p), punterHtml(opp.p))}</tbody></table></div>
    ${note ? `<p class="small muted">${note}</p>` : ''}`;
}

function bracketHtml(L) {
  const B = LG.bracket(L);
  if (!B) return '';
  const side = (id, seed, score, winner) => id == null ? '<div class="bteam tbd">To be decided</div>'
    : `<div class="bteam ${winner === id ? 'won' : winner != null ? 'lost' : ''} ${L.teams[id].user ? 'me' : ''}"><em>${seed}</em>${teamBadge(L.teams[id])}<span>${esc(L.teams[id].name)}</span><b>${score ?? ''}</b></div>`;
  const game = (g) => `<div class="bgame">${side(g.home, g.seeds[0], g.homeScore, g.winner)}${side(g.away, g.seeds[1], g.awayScore, g.winner)}</div>`;
  const bye = (id) => `<div class="bgame bye">${side(id, L.playoffs.seeds.indexOf(id) + 1, null, null)}<div class="bteam tbd">Bye</div></div>`;
  return `<div class="bracket">${B.rounds.map((r) => `<div class="bround"><h4>${r.name}</h4>${r.byes.map(bye).join('')}${r.games.map(game).join('')}</div>`).join('')}
    <div class="bround champcol"><h4>Champion</h4>${B.champion != null ? `<div class="bteam won">${teamBadge(L.teams[B.champion])}<span>${esc(L.teams[B.champion].name)}</span></div>` : '<div class="bteam tbd">To be decided</div>'}</div></div>`;
}

function seasonFinish(L, id) {
  const x = LG.playoffExit(L, id);
  if (x === 'champion') return 'Won the championship';
  if (x == null) return 'Missed the playoffs';
  if (typeof x === 'number') return `Lost in the ${roundLabel(L, x, true).toLowerCase()}`;
  return 'Still alive in the playoffs';
}

// Standings: one table, or one per division with the leader marked. The seed column shows
// where each team would land in the playoffs if the season ended today.
function standingsHtml(L, st) {
  const seeds = playoffSeeds(L, st);
  const head = '<thead><tr><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th></tr></thead>';
  const row = (r, i, cut) => {
    const t = L.teams[r.id], seed = seeds.indexOf(r.id) + 1;
    return `<tr class="${t.user ? 'me' : ''} ${cut ? 'cut' : ''}"><td>${seed ? `<em class="seed" title="Seed ${seed}">${seed}</em>` : ''}${teamBadge(t)} ${esc(t.name)}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${r.pf}</td><td class="num">${r.pa}</td><td class="num">${r.pf - r.pa > 0 ? '+' : ''}${r.pf - r.pa}</td></tr>`;
  };
  const field = playoffField(L);
  if (!L.divisions) {
    return `<div class="card"><h3>Standings</h3><div class="tablewrap"><table class="stand">${head}
      <tbody>${st.map((r, i) => row(r, i, i === field - 1)).join('')}</tbody></table></div>
      <p class="small muted">Top ${field} make the playoffs.</p></div>`;
  }
  const byes = field === 6 ? ' The top two seeds get a first-round bye.' : '';
  return `<div class="card"><h3>Standings</h3>${L.divisions.map((d) => `<h4>${esc(d.name)}</h4><div class="tablewrap"><table class="stand">${head}
      <tbody>${st.filter((r) => d.teams.includes(r.id)).map((r, i) => row(r, i, i === 0)).join('')}</tbody></table></div>`).join('')}
    <p class="small muted">Each division winner makes the playoffs and seeds first, with the ${field - L.divisions.length} best of the rest.${byes} Division rivals meet twice, everyone else once.</p></div>`;
}

// Points the season hub at the trade desk while it is open.
function deskLinkHtml(L) {
  if (!tradeWindow(L)) return '';
  return `<div class="card deskline"><p class="small">The trade desk is open until the deadline, before week ${tradeDeadline(L) + 1}: build a deal with any team, Pokémon and next season's picks.</p>
    <div class="actions"><button class="btn" data-act="go" data-to="trades">Open the trade desk</button></div></div>`;
}

function awardsHtml(L, list) {
  if (!list.length) return '';
  return `<ul class="awards">${list.map((a) => `<li>${sprite(a.id, 'md')}<span><em>${esc(a.label)}</em><b>${esc(P(a.id).name)}</b> ${teamBadge(L.teams[a.team])}<span class="small muted">${esc(a.line)}</span></span></li>`).join('')}</ul>`;
}

function championHtml(L, st) {
  const champ = L.teams[L.champion], me = user();
  const mine = st.find((r) => r.id === me.id);
  const myStats = Object.entries(L.seasonStats).filter(([, s]) => s.team === me.id);
  const star = myStats.length ? myStats.reduce((a, b) => (LG.impact(b[1]) > LG.impact(a[1]) ? b : a)) : null;
  return `<div class="card matchup champ"><p class="eyebrow">Season ${L.season ?? 1} complete</p><h2>${esc(champ.name)} are champions</h2>
    <div class="champrow">${Object.values(champ.lineup).slice(0, 6).map((id) => sprite(id, 'md')).join('')}</div>
    <h4>Your season</h4>
    <p>${esc(me.name)} went ${record(mine)}, scored ${mine.pf} and allowed ${mine.pa}. ${seasonFinish(L, me.id)}.
      ${star ? ` Team star: ${esc(P(Number(star[0])).name)}, ${esc(LG.statLine(star[1]))}.` : ''}</p>
    <h4>Awards</h4>${awardsHtml(L, LG.awards(L))}
    <h4>Playoff bracket</h4>${bracketHtml(L)}
    <div class="actions"><button class="btn primary" data-act="offseason">Start the offseason</button><button class="btn" data-act="recap">Download recap</button><button class="btn" data-act="newleague">Start a new league</button></div>
    <p class="small muted">The offseason keeps every roster. Pokémon who played a lot of snaps develop, every team cuts ${LG.CUTS}, free agents sign by bidding under the cap, and a rookie draft fills the rest, worst record first.</p></div>`;
}

function historyHtml(L) {
  if (!L.history?.length) return '';
  return `<div class="card"><h3>League history</h3><ul class="history">${L.history.slice().reverse().map((h) => {
    const mvp = h.awards.find((a) => a.key === 'mvp');
    const mine = h.records.find((r) => L.teams[r.id].user);
    return `<li><em>Season ${h.season}</em>${teamBadge(L.teams[h.champion])}<span>${esc(L.teams[h.champion].name)} won it all.${mvp ? ` MVP ${esc(P(mvp.id).name)}.` : ''}</span><span class="muted small">You: ${record(mine)}</span></li>`;
  }).join('')}</ul></div>`;
}

export function recapText(L) {
  const st = LG.standings(L);
  const lines = [`PokeBall · ${user().name} · Season ${L.season ?? 1}`, ''];
  if (L.champion != null) lines.push(`Champion: ${L.teams[L.champion].name}`, '');
  lines.push('Standings');
  st.forEach((r, i) => lines.push(`${i + 1}. ${L.teams[r.id].name} ${record(r)} (PF ${r.pf}, PA ${r.pa})`));
  const B = LG.bracket(L);
  if (B) {
    lines.push('', 'Playoffs');
    for (const g of B.rounds.flatMap((x) => x.games)) {
      if (g.home == null) continue;
      lines.push(`${L.teams[g.away].name} ${g.awayScore ?? '-'} at ${L.teams[g.home].name} ${g.homeScore ?? '-'}`);
    }
  }
  const aw = LG.awards(L);
  if (aw.length) {
    lines.push('', 'Awards');
    for (const a of aw) lines.push(`${a.label}: ${P(a.id).name} (${L.teams[a.team].abbr}), ${a.line}`);
  }
  const potw = (L.weekly ?? []).filter((w) => w.potw);
  if (potw.length) {
    lines.push('', 'Players of the Week');
    for (const w of potw) lines.push(`${w.label}: ${P(w.potw.id).name} (${L.teams[w.potw.team].abbr}), ${w.potw.line}`);
  }
  lines.push('', 'Results');
  for (const r of L.results) {
    lines.push(`${r.playoff ? 'Playoffs' : `Week ${r.week + 1}`}: ${L.teams[r.away].abbr} ${r.score[1]} at ${L.teams[r.home].abbr} ${r.score[0]}${r.headline ? `. ${r.headline}` : ''}`);
  }
  return lines.join('\n');
}

// ---------- stored box score ----------
const STAT_KEYS = ['pa', 'pc', 'py', 'ptd', 'pint', 'sk', 'ra', 'ry', 'rtd', 'rlong', 'fum', 'tg', 'rc', 'rcy', 'rctd', 'rclong', 'tk', 'dsk', 'dint', 'pd', 'ff', 'sn'];
const fullStats = (s) => Object.fromEntries(STAT_KEYS.map((k) => [k, s[k] ?? 0]));

export function renderResult() {
  const L = S.league, r = L?.results[S.resultIdx];
  if (!r?.box) return `<section><p>That game has no box score.</p><button class="btn" data-act="go" data-to="season">Back to the season</button></section>`;
  const teams = [L.teams[r.home], L.teams[r.away]];
  const g = {
    score: r.score, qs: r.quarters,
    teams: teams.map((t, i) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, team: r.box.team[i],
      stats: Object.fromEntries(Object.entries(r.box.stats[i]).map(([id, s]) => [id, fullStats(s)])) })),
  };
  const winner = r.winner == null ? 'Tie game' : `${L.teams[r.winner].name} win`;
  return `<section class="result">
    <p class="eyebrow">${r.playoff ? roundLabel(L, r.round) : `Week ${r.week + 1}`} · ${WEATHER[r.weather].name}</p>
    <h1>${esc(teams[1].abbr)} ${r.score[1]}, ${esc(teams[0].abbr)} ${r.score[0]}</h1>
    <p class="lede">${esc(r.headline ?? `${winner}. ${teams[1].name} at ${teams[0].name}.`)}</p>
    ${r.injuries?.length ? `<p class="small">${r.injuries.map((x) => `<span class="cond hurt">Injured</span> ${esc(P(x.id).name)} (${esc(L.teams[x.team].abbr)}), out ${x.weeks} games`).join(' · ')}</p>` : ''}
    <div class="card"><h3>Scoring plays</h3>${r.box.scoring.length ? `<ol class="pbp scoring">${r.box.scoring.map((e) => `<li><span class="when">${quarterText(e.q)} ${clockText(e.clock)}</span><span class="sit">${teamBadge(teams[e.team])}</span><span class="txt">${esc(e.text)}</span></li>`).join('')}</ol>` : '<p class="muted">No points scored.</p>'}</div>
    <div class="card">${boxHtml(g)}</div>
    <div class="actions"><button class="btn primary" data-act="go" data-to="season">Back to the season</button></div>
  </section>`;
}
// ---------- weekly hooks ----------
const weeksText = (w) => `${w} more ${w === 1 ? 'game' : 'games'}`;

// The latest week: Player of the Week and every game's headline.
function reviewHtml(L) {
  const W = L.weekly?.[L.weekly.length - 1];
  if (!W) return '';
  const pw = W.potw;
  const games = W.games.map((i) => ({ r: L.results[i], i })).filter(({ r }) => r?.headline);
  return `<div class="card review"><h3>${esc(W.label)} in review</h3>
    ${pw ? `<div class="potw">${sprite(pw.id, 'md')}<span><em>Player of the Week</em><b>${esc(P(pw.id).name)}</b> ${teamBadge(L.teams[pw.team])}<span class="small muted">${esc(pw.line)}</span></span></div>` : ''}
    <ul class="headlines">${games.map(({ r, i }) => `<li class="${L.teams[r.home].user || L.teams[r.away].user ? 'mine' : ''}">${r.box ? `<button class="resline" data-act="openresult" data-i="${i}">` : '<span>'}<span class="hl">${esc(r.headline)}</span>${r.box ? '<span class="open">Box score</span></button>' : '</span>'}</li>`).join('')}</ul></div>`;
}

// Power ranking with the move since the week before.
function powerHtml(L) {
  if (!L.results.some((r) => !r.playoff)) return '';
  const rows = powerRanking(L);
  const ranked = (L.weekly ?? []).filter((w) => w.power);
  const before = ranked.length >= 2 ? ranked[ranked.length - 2].power : null;
  const move = (id, i) => {
    if (!before) return '<span class="mv">–</span>';
    const d = before.indexOf(id) - i;
    return d > 0 ? `<span class="mv up" title="Up ${d}">▲${d}</span>` : d < 0 ? `<span class="mv down" title="Down ${-d}">▼${-d}</span>` : '<span class="mv">–</span>';
  };
  const note = (x) => (x.streak && x.streak.n >= 2 && x.streak.kind !== 'T' ? `${x.streak.kind === 'W' ? 'Won' : 'Lost'} ${x.streak.n} straight` : `${x.diff >= 0 ? '+' : ''}${Math.round(x.diff)} per game`);
  return `<div class="card"><h3>Power ranking</h3><ol class="power">${rows.map((x, i) => {
    const t = L.teams[x.id];
    return `<li class="${t.user ? 'me' : ''}"><b class="rk">${i + 1}</b>${move(x.id, i)}${teamBadge(t)}<span class="pn">${esc(t.name)}</span><span class="small muted">${record(x)} · ${note(x)}</span></li>`;
  }).join('')}</ol><p class="small muted">Record and point margin, with recent form, and roster strength while the sample is small.</p></div>`;
}

// Every injured Pokémon in the league.
function injuryHtml(L) {
  const list = injuryReport(L);
  if (!list.length) return '';
  return `<div class="card"><h3>Injury report</h3><ul class="health">${list.map((h) => `<li class="${L.teams[h.team].user ? 'me' : ''}">${sprite(h.id, 'xs')} ${esc(P(h.id).name)} ${teamBadge(L.teams[h.team])}
    <span class="cond hurt">Out ${weeksText(h.weeks)}</span><span class="small muted">Hurt ${esc(h.when)}${h.by != null ? ` on a hit from ${esc(P(h.by).name)}` : ''}</span></li>`).join('')}</ul>
    <p class="small muted">Injuries come from tackles, more often when a small Pokémon meets a much bigger one. They are separate from soreness and heal over the offseason.</p></div>`;
}

function statFor(k, r) { return { 'Passing yards': r.py, 'Rushing yards': r.ry, 'Receiving yards': r.rcy, Sacks: r.dsk, Interceptions: r.dint, Tackles: r.tk }[k]; }
function record(r) { return r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '0-0'; }
function teamBlock(t) { return `<div class="tblock" style="--team:${t.color}"><span class="tabbr">${esc(t.abbr)}</span><span>${esc(t.name)}</span></div>`; }
function resultLine(r, i) {
  const L = S.league, h = L.teams[r.home], a = L.teams[r.away];
  const inner = `${r.playoff ? '<em class="po">Playoffs</em>' : `<em>Wk ${r.week + 1}</em>`}${teamBadge(a)} <b class="${r.winner === a.id ? 'won' : ''}">${r.score[1]}</b> at ${teamBadge(h)} <b class="${r.winner === h.id ? 'won' : ''}">${r.score[0]}</b>`;
  const mine = a.user || h.user ? 'mine' : '';
  if (r.headline) return r.box ? `<li class="${mine}"><button class="resline" data-act="openresult" data-i="${i}">${inner}<span class="open">Box score</span><span class="hl small muted">${esc(r.headline)}</span></button></li>`
    : `<li class="${mine}">${inner}<span class="hl small muted">${esc(r.headline)}</span></li>`;
  return r.box ? `<li class="${mine}"><button class="resline" data-act="openresult" data-i="${i}">${inner}<span class="open">Box score</span></button></li>` : `<li class="${mine}">${inner}</li>`;
}

export function finishLeagueGame({ go = true } = {}) {
  const L = S.league, g = S.game, meta = S.gameMeta;
  if (!g?.final || !meta) return;
  if (meta.playoff) {
    LG.recordResult(L, g, { playoff: true, round: L.playoffs.round });
    simPlayoffOthers(L, meta.userTeamId);
    LG.advancePlayoffs(L);
  } else {
    LG.recordResult(L, g, { week: L.week });
    LG.simWeekOthers(L, meta.userTeamId);
    LG.advanceWeek(L);
  }
  S.game = null; S.gameMeta = null;
  if (go) setScreen('season');
}
export function simPlayoffOthers(L, skip) {
  for (const gm of L.playoffs.games) {
    if (gm.home === skip || gm.away === skip) continue;
    const g = LG.startLeagueGame(L, gm.home, gm.away, true);
    simUntil(g, 'game');
    LG.recordResult(L, g, { playoff: true, round: L.playoffs.round });
  }
}
