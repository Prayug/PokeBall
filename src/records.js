// Career records: career stats per Pokémon, the Hall of Fame, each franchise's record book and
// the all-time head-to-head behind the playoff Rivalry card. Everything here outlives a season:
// box scores and season stats are cleared every offseason, these are not.
const n = (v) => v ?? 0;

// Stats a career keeps. Longest plays are maxima, the rest are totals.
export const CAREER_KEYS = ['gp', 'pa', 'pc', 'py', 'ptd', 'pint', 'ra', 'ry', 'rtd', 'rc', 'rcy', 'rctd', 'tk', 'dsk', 'dint', 'pd', 'ff', 'sn'];
const MAX_KEYS = ['rlong', 'rclong'];

// The individual records a franchise keeps, for one game and for one season.
export const PLAYER_RECORDS = [
  ['py', 'Passing yards'], ['ptd', 'Passing touchdowns'], ['ry', 'Rushing yards'], ['rtd', 'Rushing touchdowns'],
  ['rcy', 'Receiving yards'], ['rctd', 'Receiving touchdowns'], ['tk', 'Tackles'], ['dsk', 'Sacks'], ['dint', 'Interceptions'],
];
export const TEAM_GAME_RECORDS = [['pts', 'Points in a game'], ['margin', 'Biggest win']];
export const TEAM_SEASON_RECORDS = [['w', 'Wins in a season'], ['pf', 'Points in a season'], ['pa', 'Fewest points allowed']];
// Lower is better for these.
const LOW = new Set(['pa']);

// Hall of Fame: points from a career, and the bar to get in.
export const HOF_POINTS = 220;
export const HOF_MIN_SEASONS = 3;
// At most this many go in each year: the best careers first, the rest stay on the ballot.
export const HOF_CLASS = 2;
const AWARD_POINTS = { mvp: 40, opoy: 25, dpoy: 25, roy: 8 };

export function ensureRecords(L) {
  L.careers ??= {}; L.hof ??= []; L.records ??= {}; L.careerSeason ??= 0;
  if (!L.meetings) {
    // Saves from before records: start the head-to-head book from this season's results.
    L.meetings = (L.results ?? []).map((r) => meeting(L, r));
  }
  return L;
}

function meeting(L, r) {
  return { s: L.season ?? 1, w: r.playoff ? -1 : r.week, r: r.playoff ? r.round : -1, h: r.home, a: r.away, hs: r.score[0], as: r.score[1] };
}

function better(key, v, old) {
  if (!old) return true;
  return LOW.has(key) ? v < old.v : v > old.v;
}
function book(L, teamId) {
  return (L.records[teamId] ??= { game: {}, season: {} });
}

// After every league game: head-to-head, and single-game records for both teams.
export function noteGame(L, r) {
  ensureRecords(L);
  L.meetings.push(meeting(L, r));
  const when = { season: L.season ?? 1, week: r.playoff ? null : r.week, playoff: !!r.playoff, round: r.playoff ? r.round : null };
  [r.home, r.away].forEach((teamId, i) => {
    const B = book(L, teamId);
    const opp = i === 0 ? r.away : r.home;
    const pts = r.score[i], margin = r.score[i] - r.score[1 - i];
    if (better('pts', pts, B.game.pts)) B.game.pts = { v: pts, opp, ...when };
    if (margin > 0 && better('margin', margin, B.game.margin)) B.game.margin = { v: margin, opp, score: [pts, r.score[1 - i]], ...when };
    for (const [id, s] of Object.entries(r.box?.stats?.[i] ?? {})) {
      for (const [k] of PLAYER_RECORDS) {
        const v = n(s[k]);
        if (v > 0 && better(k, v, B.game[k])) B.game[k] = { v, id: Number(id), opp, ...when };
      }
    }
  });
}

// At the end of a season (once): fold season stats into careers, set season records, award
// rings, and induct anyone whose career now clears the Hall of Fame bar.
export function archiveSeason(L, { awards, standings, champion }) {
  ensureRecords(L);
  const season = L.season ?? 1;
  if (L.careerSeason >= season) return [];
  L.careerSeason = season;
  for (const [key, s] of Object.entries(L.seasonStats)) {
    const id = Number(key);
    const c = (L.careers[id] ??= { seasons: 0, teams: [], aw: {}, rings: 0, st: {}, best: 0 });
    c.seasons++;
    if (c.teams[c.teams.length - 1] !== s.team) c.teams.push(s.team);
    for (const k of CAREER_KEYS) if (s[k]) c.st[k] = n(c.st[k]) + s[k];
    for (const k of MAX_KEYS) if (s[k]) c.st[k] = Math.max(n(c.st[k]), s[k]);
    if (s.team === champion) c.rings++;
    const B = book(L, s.team);
    for (const [k] of PLAYER_RECORDS) {
      const v = n(s[k]);
      if (v > 0 && better(k, v, B.season[k])) B.season[k] = { v, id, season };
    }
  }
  for (const a of awards) {
    const c = L.careers[a.id];
    if (c) c.aw[a.key] = n(c.aw[a.key]) + 1;
  }
  for (const row of standings) {
    const B = book(L, row.id);
    for (const [k] of TEAM_SEASON_RECORDS) if (better(k, row[k], B.season[k])) B.season[k] = { v: row[k], season, w: row.w, l: row.l, t: row.t };
  }
  const inducted = hofBallot(L).filter((b) => b.points >= HOF_POINTS).slice(0, HOF_CLASS)
    .map((b) => ({ id: b.id, season, team: b.team, points: b.points, line: careerLine(L.careers[b.id]) }));
  L.hof.push(...inducted);
  return inducted;
}

// Eligible careers not yet in the Hall, best first.
export function hofBallot(L) {
  ensureRecords(L);
  const inHall = new Set(L.hof.map((h) => h.id));
  return Object.entries(L.careers)
    .filter(([key, c]) => !inHall.has(Number(key)) && c.seasons >= HOF_MIN_SEASONS)
    .map(([key, c]) => ({ id: Number(key), team: c.teams[c.teams.length - 1], points: Math.round(hofPoints(c)), seasons: c.seasons }))
    .sort((a, b) => b.points - a.points);
}

// Career production, the same weights as the awards use, plus trophies.
export function careerImpact(st) {
  const off = n(st.py) * 0.04 + n(st.ptd) * 4 - n(st.pint) * 2 + (n(st.ry) + n(st.rcy)) * 0.1 + (n(st.rtd) + n(st.rctd)) * 6;
  const def = n(st.tk) + 4 * n(st.dsk) + 5 * n(st.dint) + 3 * n(st.ff) + 1.5 * n(st.pd);
  return off + def;
}
export function hofPoints(c) {
  let pts = careerImpact(c.st) / 4;
  for (const [k, v] of Object.entries(c.aw)) pts += (AWARD_POINTS[k] ?? 0) * v;
  return pts + c.rings * 6;
}

export function careerLine(c) {
  const st = c.st, parts = [];
  if (n(st.pa) >= 30) parts.push(`${n(st.py)} pass yds, ${n(st.ptd)} TD`);
  if (n(st.ry) >= 200) parts.push(`${n(st.ry)} rush yds, ${n(st.rtd)} TD`);
  if (n(st.rcy) >= 200) parts.push(`${n(st.rc)} rec, ${n(st.rcy)} yds, ${n(st.rctd)} TD`);
  if (n(st.tk) + 4 * n(st.dsk) + 5 * n(st.dint) >= 30) parts.push(`${n(st.tk)} tkl, ${n(st.dsk)} sacks, ${n(st.dint)} INT`);
  const trophies = Object.entries(c.aw).map(([k, v]) => `${v > 1 ? `${v}× ` : ''}${k.toUpperCase()}`);
  if (c.rings) trophies.push(`${c.rings > 1 ? `${c.rings}× ` : ''}champion`);
  const games = `${c.seasons} season${c.seasons > 1 ? 's' : ''}, ${n(st.gp)} games`;
  return [parts.join(' · ') || games, trophies.join(', ')].filter(Boolean).join(' · ');
}

// Career totals including the season in progress (which is folded in only at the offseason).
export function careerTotals(L) {
  ensureRecords(L);
  const out = {};
  for (const [id, c] of Object.entries(L.careers)) out[id] = { ...c, st: { ...c.st } };
  if (L.careerSeason < (L.season ?? 1)) {
    for (const [id, s] of Object.entries(L.seasonStats ?? {})) {
      const c = (out[id] ??= { seasons: 0, teams: [], aw: {}, rings: 0, st: {} });
      c.seasons++;
      if (c.teams[c.teams.length - 1] !== s.team) c.teams = [...c.teams, s.team];
      for (const k of CAREER_KEYS) if (s[k]) c.st[k] = n(c.st[k]) + s[k];
      for (const k of MAX_KEYS) if (s[k]) c.st[k] = Math.max(n(c.st[k]), s[k]);
    }
  }
  return out;
}

export const CAREER_BOARDS = [['py', 'Passing yards'], ['ry', 'Rushing yards'], ['rcy', 'Receiving yards'], ['dsk', 'Sacks'], ['dint', 'Interceptions'], ['tk', 'Tackles']];
export function careerLeaders(L, count = 5) {
  const rows = Object.entries(careerTotals(L)).map(([id, c]) => ({ id: Number(id), ...c }));
  return Object.fromEntries(CAREER_BOARDS.map(([k, label]) => [label,
    rows.filter((r) => n(r.st[k]) > 0).sort((a, b) => b.st[k] - a.st[k]).slice(0, count).map((r) => ({ id: r.id, v: r.st[k], seasons: r.seasons, team: r.teams[r.teams.length - 1] }))]));
}

// One franchise's record book, or the league's (the best entry across franchises) with teamId null.
export function recordBook(L, teamId = null) {
  ensureRecords(L);
  const ids = teamId == null ? L.teams.map((t) => t.id) : [teamId];
  const pick = (scope, key) => ids.reduce((best, id) => {
    const r = L.records[id]?.[scope]?.[key];
    return r && better(key, r.v, best) ? { ...r, team: id } : best;
  }, null);
  return {
    game: [...TEAM_GAME_RECORDS, ...PLAYER_RECORDS].map(([k, label]) => ({ key: k, label, rec: pick('game', k) })),
    season: [...TEAM_SEASON_RECORDS, ...PLAYER_RECORDS].map(([k, label]) => ({ key: k, label, rec: pick('season', k) })),
  };
}

// All-time results and titles per franchise.
export function franchiseSummary(L, teamId) {
  ensureRecords(L);
  let w = 0, l = 0, t = 0, pw = 0, pl = 0;
  for (const m of L.meetings) {
    if (m.h !== teamId && m.a !== teamId) continue;
    const mine = m.h === teamId ? m.hs : m.as, theirs = m.h === teamId ? m.as : m.hs;
    if (m.r >= 0) { if (mine > theirs) pw++; else if (mine < theirs) pl++; continue; }
    if (mine > theirs) w++; else if (mine < theirs) l++; else t++;
  }
  const titles = (L.history ?? []).filter((h) => h.champion === teamId).map((h) => h.season);
  return { w, l, t, pw, pl, titles };
}

// Head-to-head between two franchises, for the Rivalry card when they meet in the playoffs.
export function rivalry(L, a, b) {
  ensureRecords(L);
  const games = L.meetings.filter((m) => (m.h === a && m.a === b) || (m.h === b && m.a === a))
    .map((m) => {
      const as = m.h === a ? m.hs : m.as, bs = m.h === a ? m.as : m.hs;
      return { season: m.s, week: m.w, round: m.r, playoff: m.r >= 0, home: m.h, aScore: as, bScore: bs, winner: as > bs ? a : bs > as ? b : null };
    });
  const count = (list, id) => list.filter((g) => g.winner === id).length;
  const playoffs = games.filter((g) => g.playoff);
  let streak = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const w = games[i].winner;
    if (w == null) break;
    if (!streak) streak = { team: w, n: 1 };
    else if (streak.team === w) streak.n++;
    else break;
  }
  const biggest = games.filter((g) => g.winner != null).reduce((best, g) => (!best || Math.abs(g.aScore - g.bScore) > Math.abs(best.aScore - best.bScore) ? g : best), null);
  const titlesA = (L.history ?? []).filter((h) => h.champion === a).length, titlesB = (L.history ?? []).filter((h) => h.champion === b).length;
  return {
    a, b, games, played: games.length, aWins: count(games, a), bWins: count(games, b), ties: games.filter((g) => g.winner == null).length,
    playoffs, aPlayoffWins: count(playoffs, a), bPlayoffWins: count(playoffs, b), last: games[games.length - 1] ?? null,
    streak, biggest, titles: [titlesA, titlesB], points: [games.reduce((s, g) => s + g.aScore, 0), games.reduce((s, g) => s + g.bScore, 0)],
  };
}

// Pairs of franchises that have met in the playoffs, most playoff meetings first.
export function rivalries(L) {
  ensureRecords(L);
  const pairs = new Map();
  for (const m of L.meetings) {
    if (m.r < 0) continue;
    const key = [Math.min(m.h, m.a), Math.max(m.h, m.a)].join('-');
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return [...pairs.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => {
    const [a, b] = k.split('-').map(Number);
    return rivalry(L, a, b);
  });
}
