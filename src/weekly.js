// Weekly game hooks for the season screen: a one-line headline per game (written when the
// result is recorded), and after each week a Player of the Week and a power ranking (kept in
// L.weekly so the movement from one week to the next can be shown).
import { PLAYERS, unitRatings } from './ratings.js';
import { impact } from './league.js';

const n = (v) => v ?? 0;
const nm = (id) => PLAYERS[id].name;
const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;

// What one Pokémon did in one game, in a few words ("throws for 312 yards and 3 touchdowns").
export function gamePhrase(s) {
  const opts = [];
  if (n(s.pa) > 0) opts.push([n(s.py) * 0.04 + n(s.ptd) * 4 - n(s.pint) * 2,
    `throws for ${n(s.py)} yards${n(s.ptd) ? ` and ${plural(s.ptd, 'touchdown')}` : ''}`]);
  if (n(s.ra) > 0) opts.push([n(s.ry) * 0.1 + n(s.rtd) * 6, `runs for ${n(s.ry)} yards${n(s.rtd) ? ` and ${plural(s.rtd, 'score')}` : ''}`]);
  if (n(s.rc) > 0) opts.push([n(s.rcy) * 0.1 + n(s.rctd) * 6, `catches ${n(s.rc)} for ${n(s.rcy)} yards${n(s.rctd) ? ` and ${plural(s.rctd, 'touchdown')}` : ''}`]);
  if (n(s.dint)) opts.push([5 * n(s.dint) + 2, `picks off ${n(s.dint) === 1 ? 'a pass' : `${n(s.dint)} passes`}`]);
  if (n(s.dsk)) opts.push([4 * n(s.dsk) + 1, `records ${plural(s.dsk, 'sack')}`]);
  if (n(s.ff)) opts.push([3 * n(s.ff), `forces ${plural(s.ff, 'fumble')}`]);
  if (n(s.tk)) opts.push([n(s.tk), `makes ${plural(s.tk, 'tackle')}`]);
  opts.sort((a, b) => b[0] - a[0]);
  return opts.length ? opts.slice(0, opts[1] && opts[1][0] >= opts[0][0] * 0.6 && opts[1][0] >= 8 ? 2 : 1).map((o) => o[1]).join(', ') : 'plays a quiet game';
}

// The best performer in a stored result: { id, team, score }, optionally only one side.
function topPerformer(r, side = null) {
  let best = null;
  r.box?.stats.forEach((stats, i) => {
    if (side != null && i !== side) return;
    for (const [id, s] of Object.entries(stats)) {
      const v = impact(s);
      if (!best || v > best.score) best = { id: Number(id), team: i === 0 ? r.home : r.away, side: i, score: v, s };
    }
  });
  return best;
}

// The largest deficit the winner faced at a quarter break.
function biggestComeback(r, wi) {
  const q = r.quarters;
  if (!q) return 0;
  let a = 0, b = 0, worst = 0;
  for (let i = 0; i < Math.max(q[0].length, q[1].length) - 1; i++) {
    a += q[wi][i] ?? 0; b += q[1 - wi][i] ?? 0;
    worst = Math.max(worst, b - a);
  }
  return worst;
}

// One line on the game, from the result alone (score by quarter, box score, the ranking going in).
export function gameHeadline(L, r) {
  const T = (id) => L.teams[id].name;
  const [hs, as] = r.score;
  if (r.winner == null) return `${T(r.away)} and ${T(r.home)} battle to a ${hs}-${as} tie.`;
  const wi = r.winner === r.home ? 0 : 1;
  const W = r.winner, Lo = wi === 0 ? r.away : r.home;
  const ws = r.score[wi], ls = r.score[1 - wi], margin = ws - ls;
  const sc = `${ws}-${ls}`;
  const star = topPerformer(r, wi);
  const by = star && star.score >= 14 ? `${nm(star.id)} ${gamePhrase(star.s)} as ` : '';
  const ot = (r.quarters?.[0]?.length ?? 4) > 4;
  const prev = latestPower(L);
  const rank = (id) => (prev ? prev.indexOf(id) + 1 : 0);
  const stage = r.playoff ? (r.round === 0 ? ' in the semifinal' : ' for the championship') : '';
  if (r.playoff && r.round === 1) return `${by}${T(W)} win the championship, ${sc} over ${T(Lo)}${ot ? ' in overtime' : ''}.`;
  if (ot) return `${by}${T(W)} outlast ${T(Lo)} in overtime${stage}, ${sc}.`;
  if (ls === 0) return `${by}${T(W)} shut out ${T(Lo)}${stage}, ${sc}.`;
  const back = biggestComeback(r, wi);
  if (back >= 10) return `${T(W)} rally from ${back} down to beat ${T(Lo)}${stage}, ${sc}.`;
  if (prev && (L.weekly?.length ?? 0) >= 2 && rank(W) - rank(Lo) >= 4) return `Upset${stage}: No. ${rank(W)} ${T(W)} knock off No. ${rank(Lo)} ${T(Lo)}, ${sc}.`;
  if (margin >= 24) return `${by}${T(W)} rout ${T(Lo)}${stage}, ${sc}.`;
  if (margin <= 3) return `${by}${T(W)} edge ${T(Lo)}${stage}, ${sc}.`;
  if (by) return `${by}${T(W)} beat ${T(Lo)}${stage}, ${sc}.`;
  return `${T(W)} beat ${T(Lo)}${stage}, ${sc}.`;
}

// ---------- power ranking ----------
// Record and point differential, with recent form, leaning on roster strength early in the
// season when there are few games to go on.
export function powerRanking(L) {
  const rec = Object.fromEntries(L.teams.map((t) => [t.id, { w: 0, l: 0, t: 0, pf: 0, pa: 0, form: [] }]));
  for (const r of L.results) {
    if (r.playoff) continue;
    for (const [id, me, them] of [[r.home, r.score[0], r.score[1]], [r.away, r.score[1], r.score[0]]]) {
      const x = rec[id];
      x.pf += me; x.pa += them;
      const res = me > them ? 'W' : me < them ? 'L' : 'T';
      x[res.toLowerCase()]++;
      x.form.push(res);
    }
  }
  const str = Object.fromEntries(L.teams.map((t) => {
    const u = unitRatings(t.lineup);
    return [t.id, Object.values(u).reduce((a, b) => a + b, 0) / Object.values(u).length];
  }));
  const vals = Object.values(str), mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  const rows = L.teams.map((t) => {
    const x = rec[t.id], gp = x.w + x.l + x.t;
    const wp = gp ? (x.w + x.t / 2) / gp : 0.5;
    const diff = gp ? (x.pf - x.pa) / gp : 0;
    const recent = x.form.slice(-2).reduce((s, f) => s + (f === 'W' ? 1 : f === 'L' ? -1 : 0), 0);
    const k = gp / (gp + 2);
    const score = k * (60 * (wp - 0.5) + 0.8 * Math.max(-28, Math.min(28, diff)) + 3 * recent) + (1 - k * 0.5) * 8 * ((str[t.id] - mean) / sd);
    return { id: t.id, score, w: x.w, l: x.l, t: x.t, diff, streak: streak(x.form) };
  });
  return rows.sort((a, b) => b.score - a.score || a.id - b.id);
}
function streak(form) {
  if (!form.length) return null;
  const last = form[form.length - 1];
  let k = 0;
  for (let i = form.length - 1; i >= 0 && form[i] === last; i--) k++;
  return { kind: last, n: k };
}

// The ranking in the latest weekly review (ids, best first), or null before week 1 is done.
export function latestPower(L) {
  for (let i = (L.weekly ?? []).length - 1; i >= 0; i--) if (L.weekly[i].power) return L.weekly[i].power;
  return null;
}

// ---------- the week in review ----------
// Called once the week's (or playoff round's) games are all recorded.
export function weekInReview(L, { week = null, playoff = false, round = null }) {
  L.weekly ??= [];
  const games = L.results.map((r, i) => ({ r, i }))
    .filter(({ r }) => (playoff ? r.playoff && r.round === round : !r.playoff && r.week === week));
  if (!games.length) return null;
  let potw = null;
  for (const { r } of games) {
    const t = topPerformer(r);
    if (t && (!potw || t.score > potw.score)) potw = t;
  }
  const entry = {
    label: playoff ? (round === 0 ? 'Semifinals' : 'Championship') : `Week ${week + 1}`,
    playoff, week, round, games: games.map((x) => x.i),
    potw: potw ? { id: potw.id, team: potw.team, line: gamePhrase(potw.s) } : null,
  };
  if (!playoff) entry.power = powerRanking(L).map((x) => x.id);
  L.weekly.push(entry);
  return entry;
}
