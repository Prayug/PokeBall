// League mode end to end, the way the app drives it: draft, grades and the trade offer, a full
// regular season with soreness and subs, the playoff bracket, awards, the offseason (training
// camp, cuts), free agency and the rookie draft, then the next season. Career stats, the Hall
// of Fame, the record books and the playoff rivalries are checked as they build up. Every step is checked against the
// rules the league screens rely on, and a save exported mid-season (a JSON round trip, as the
// Export and Import buttons do) must play on to exactly the same results as the original.
// Exits non-zero on any failure.
// Usage: node test/league.mjs [seasons, default 2] [seed, default 11]
import * as LG from '../src/league.js';
import * as FA from '../src/freeagency.js';
import * as RC from '../src/records.js';
import { PLAYERS, SLOT_KEYS, applyGrowth } from '../src/ratings.js';
import { simUntil } from '../src/engine.js';

const SEASONS = Number(process.argv[2] ?? 2);
const SEED = Number(process.argv[3] ?? 11);
const t0 = Date.now();
let failures = 0, checks = 0;

function check(ok, what) {
  checks++;
  if (!ok) { failures++; console.log(`FAIL ${what}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the app's league loop (src/app.js: draftTick, playweek/simweek, finishLeagueGame) ----------

function draftAll(L) {
  while (L.phase === 'draft') {
    const c = LG.aiChoosePick(L);
    check(c != null, `season ${L.season}: a pick exists at pick ${L.pickIndex + 1}`);
    if (!c) return;
    LG.makePick(L, c.id, c.slot);
  }
}

function playGame(L, home, away, meta) {
  const g = LG.startLeagueGame(L, home, away, !!meta.playoff);
  simUntil(g, 'game');
  LG.recordResult(L, g, meta);
  return g;
}

function playWeek(L) {
  const gm = LG.userGame(L);
  if (gm) playGame(L, gm.home, gm.away, { week: L.week });
  LG.simWeekOthers(L, gm ? 0 : -1);
  LG.advanceWeek(L);
}

function playPlayoffRound(L) {
  for (const gm of L.playoffs.games) playGame(L, gm.home, gm.away, { playoff: true, round: L.playoffs.round });
  LG.advancePlayoffs(L);
}

// ---------- checks ----------

function checkDraft(L, rosterSize) {
  const s = `season ${L.season} draft`;
  check(L.phase === 'grades', `${s}: ends on the grades screen (phase ${L.phase})`);
  check(L.picks.every((p) => p.player != null), `${s}: every pick made`);
  const all = L.teams.flatMap((t) => t.roster);
  check(new Set(all).size === all.length, `${s}: no Pokémon on two rosters`);
  for (const t of L.teams) {
    check(t.roster.length === rosterSize, `${s}: ${t.abbr} has ${t.roster.length} on the roster, expected ${rosterSize}`);
    check(SLOT_KEYS.every((k) => t.lineup[k] != null), `${s}: ${t.abbr} fills every starting slot`);
    const starters = Object.values(t.lineup);
    check(new Set(starters).size === starters.length, `${s}: ${t.abbr} starts nobody twice`);
    check(starters.every((id) => t.roster.includes(id)), `${s}: ${t.abbr} starts only its own Pokémon`);
    check(same([...starters, ...t.bench].sort(), t.roster.slice().sort()), `${s}: ${t.abbr} lineup and bench are its roster`);
    if (L.settings.typeCap && L.season === 1) {
      const counts = {};
      for (const id of t.roster) counts[PLAYERS[id].types[0]] = (counts[PLAYERS[id].types[0]] ?? 0) + 1;
      check(Math.max(...Object.values(counts)) <= 4, `${s}: ${t.abbr} keeps to 4 of a primary type`);
    }
    if (!L.settings.legendaries) check(t.roster.every((id) => !PLAYERS[id].legendary), `${s}: ${t.abbr} has no legendaries`);
  }
  const n = L.teams.length;
  check(L.schedule.length === n - 1 + (n % 2), `${s}: ${L.schedule.length} weeks scheduled for ${n} teams`);
  const pairs = L.schedule.flat().map((gm) => [gm.home, gm.away].sort().join('-'));
  check(pairs.length === n * (n - 1) / 2 && new Set(pairs).size === pairs.length, `${s}: every pair meets exactly once`);
  const grades = LG.draftGrades(L);
  check(grades.length === n && grades.every((g) => Object.values(g).every((u) => /^[A-DF][+]?$/.test(u.grade))), `${s}: every unit gets a letter grade`);
}

function checkTrade(L) {
  const T = L.trade;
  if (!T) { console.log(`     season ${L.season}: no trade offer this time`); return; }
  const me = L.teams.find((t) => t.user), ai = L.teams[T.team];
  check(me.roster.includes(T.youSend) && ai.roster.includes(T.youGet), `season ${L.season} trade: offers Pokémon each side owns`);
  check(LG.tradeOpen(L), `season ${L.season} trade: open before the season`);
  const before = [me.roster.length, ai.roster.length];
  check(LG.acceptTrade(L), `season ${L.season} trade: accepted`);
  check(me.roster.includes(T.youGet) && !me.roster.includes(T.youSend), `season ${L.season} trade: you get ${PLAYERS[T.youGet].name}`);
  check(ai.roster.includes(T.youSend) && !ai.roster.includes(T.youGet), `season ${L.season} trade: they get ${PLAYERS[T.youSend].name}`);
  check(same(before, [me.roster.length, ai.roster.length]), `season ${L.season} trade: roster sizes unchanged`);
  check(!Object.values(me.lineup).includes(T.youSend) && !me.bench.includes(T.youSend), `season ${L.season} trade: the traded Pokémon leaves your depth chart`);
  check(!LG.acceptTrade(L), `season ${L.season} trade: cannot be accepted twice`);
}

// Who is out this week sits, when the bench can cover; sore players start below full energy.
function checkCondition(L) {
  for (const t of L.teams) {
    const side = LG.teamForGame(t, L);
    const outStarters = Object.values(side.lineup).filter((id) => L.condition[id]?.out);
    const benchOk = t.bench.filter((id) => !L.condition[id]?.out).length;
    check(!outStarters.length || benchOk === 0, `week ${L.week + 1}: ${t.abbr} starts ${outStarters.length} Pokémon who are out`);
    check(SLOT_KEYS.every((k) => side.lineup[k] != null), `week ${L.week + 1}: ${t.abbr} fields a full lineup`);
    for (const [id, e] of Object.entries(side.energy ?? {})) check(e >= 0 && e <= 100, `week ${L.week + 1}: ${PLAYERS[id].name} starts at ${e} energy`);
  }
  const outByTeam = L.teams.map((t) => t.roster.filter((id) => L.condition[id]?.out).length);
  check(outByTeam.every((k) => k <= LG.MAX_OUT), `week ${L.week + 1}: at most ${LG.MAX_OUT} out per team (${outByTeam.join(' ')})`);
}

function checkSeason(L) {
  const s = `season ${L.season}`;
  const n = L.teams.length;
  const reg = L.results.filter((r) => !r.playoff);
  check(reg.length === n * (n - 1) / 2, `${s}: ${reg.length} regular-season games recorded`);
  const st = LG.standings(L);
  for (const row of st) check(row.w + row.l + row.t === n - 1, `${s}: ${L.teams[row.id].abbr} played ${row.w + row.l + row.t} games`);
  check(st.reduce((a, r) => a + r.w, 0) === st.reduce((a, r) => a + r.l, 0), `${s}: wins equal losses league-wide`);
  check(st.reduce((a, r) => a + r.pf, 0) === st.reduce((a, r) => a + r.pa, 0), `${s}: points for equal points against`);
  for (const r of reg) {
    const [h, a] = r.score;
    check(r.winner === (h > a ? r.home : a > h ? r.away : null), `${s} week ${r.week + 1}: winner matches the score`);
    check(r.box?.stats?.length === 2 && Array.isArray(r.box.scoring), `${s} week ${r.week + 1}: box score kept`);
    check(r.box.scoring.length > 0 || (h === 0 && a === 0), `${s} week ${r.week + 1}: scoring plays listed for ${h}-${a}`);
  }
  const ld = LG.leaders(L);
  check(Object.values(ld).every((list) => list.length > 0), `${s}: every leader board has entries`);
  const totals = Object.values(L.seasonStats);
  check(totals.every((x) => x.gp >= 1 && x.gp <= n - 1 + 2), `${s}: games played per Pokémon within the schedule`);
  // Playoff seeding is the top four of the standings.
  check(L.phase === 'playoffs' && same(L.playoffs.seeds, st.slice(0, 4).map((r) => r.id)), `${s}: top four seeded`);
  const sc = LG.scoutReport(L, 0, L.playoffs.seeds.find((id) => id !== 0));
  check(typeof sc.plan === 'string' && typeof sc.lean === 'string' && Array.isArray(sc.best) && Array.isArray(sc.worst), `${s}: scouting report builds`);
}

function checkPlayoffs(L) {
  const s = `season ${L.season} playoffs`;
  check(L.phase === 'done' && L.champion != null, `${s}: a champion is crowned`);
  const b = LG.bracket(L);
  check(b.semis.every((g) => g.winner != null && g.homeScore != null), `${s}: both semifinals played`);
  check(same([b.final.home, b.final.away].sort(), b.semis.map((g) => g.winner).sort()), `${s}: the semifinal winners meet in the final`);
  check(b.final.winner === L.champion && b.champion === L.champion, `${s}: the final's winner is champion`);
  check(L.results.filter((r) => r.playoff).every((r) => r.winner != null), `${s}: no playoff game ends tied`);
  const aw = LG.awards(L);
  check(['mvp', 'opoy', 'dpoy'].every((k) => aw.some((a) => a.key === k && PLAYERS[a.id])), `${s}: MVP, OPOY and DPOY named`);
  if (L.season > 1) check(aw.some((a) => a.key === 'roy' && L.rookies.includes(a.id)), `${s}: rookie of the year is a rookie`);
}

function checkOffseason(L, before) {
  const s = `season ${L.season} offseason`;
  check(L.phase === 'offseason', `${s}: offseason opens`);
  const h = L.history[L.history.length - 1];
  check(h.season === L.season && h.champion === L.champion && h.records.length === L.teams.length, `${s}: season archived`);
  for (const [id, g] of Object.entries(L.growth)) {
    const used = Object.values(g).reduce((a, b) => a + b, 0);
    check(used <= LG.GROWTH_CAP, `${s}: ${PLAYERS[id].name} grew ${used} points, cap ${LG.GROWTH_CAP}`);
    for (const [k, v] of Object.entries(g)) check(PLAYERS[id].baseAttrs[k] + v <= 99, `${s}: ${PLAYERS[id].name} ${k} stays at or under 99`);
  }
  check(L.offseason.camp.every((c) => Object.values(c.gains).reduce((a, b) => a + b, 0) <= 8), `${s}: camp gives at most 4 points of 2 each`);
  // Growth is cumulative across seasons, never lost.
  for (const [id, g] of Object.entries(before)) for (const [k, v] of Object.entries(g)) check((L.growth[id]?.[k] ?? 0) >= v, `${s}: ${PLAYERS[id].name} keeps earlier ${k} growth`);
  for (const t of L.teams) {
    const cuts = L.offseason.cuts[t.id];
    check(cuts.length === LG.CUTS && cuts.every((id) => t.roster.includes(id)), `${s}: ${t.abbr} has ${LG.CUTS} suggested cuts from its roster`);
  }
}

// Free agency: the pool is everyone cut plus everyone undrafted, nobody goes over the cap, and
// you win a bid by outbidding the league.
function runFreeAgency(L, rosterSize) {
  const s = `season ${L.season} free agency`;
  check(L.phase === 'freeagency' && L.fa?.round === 0, `${s}: opens after the cuts`);
  const pool = FA.faPool(L).map((p) => p.id);
  const cut = Object.keys(L.fa.cuts).map(Number);
  check(cut.length === L.teams.length * LG.CUTS && cut.every((id) => pool.includes(id)), `${s}: every cut Pokémon is in the pool`);
  check(pool.every((id) => !L.teams.some((t) => t.roster.includes(id))), `${s}: nobody in the pool is on a roster`);
  if (!L.settings.legendaries) check(pool.every((id) => !PLAYERS[id].legendary), `${s}: no legendaries in the pool`);
  for (const t of L.teams) check(FA.capSpace(L, t) >= 0, `${s}: ${t.abbr} opens under the $${L.cap}M cap`);
  const me = L.teams.find((t) => t.user);
  // Round 1: you bid the most you can on your best target, so nobody can outbid you.
  const target = FA.faTargets(L, me).find((x) => FA.typeCapOk(L, me, x.id, x.release));
  check(target != null, `${s}: you have someone worth signing`);
  check(FA.bidProblem(L, me, target.id, target.release, target.ask - 1) != null, `${s}: a bid under the asking price is refused`);
  check(FA.bidProblem(L, me, target.id, target.release, FA.maxBid(L, me, target.release) + 1) != null, `${s}: a bid over the cap is refused`);
  const amount = FA.maxBid(L, me, target.release);
  check(FA.bidProblem(L, me, target.id, target.release, amount) == null, `${s}: a bid at your cap room is accepted`);
  const signed = FA.runFaRound(L, { id: target.id, release: target.release, amount });
  const mine = signed.find((x) => x.id === target.id);
  const won = mine?.team === me.id;
  check(mine != null && (won || mine.amount >= amount), `${s}: your bid is resolved, highest bid wins`);
  if (won) check(me.roster.includes(target.id) && L.contracts[target.id] === amount, `${s}: you signed ${PLAYERS[target.id].name} for $${amount}M`);
  check(L.fa.last?.user?.won === won, `${s}: the round reports your result`);
  check(signed.every((x) => x.bidders.every((b) => b.amount <= x.amount)), `${s}: every signing went to the top bid`);
  check(new Set(signed.map((x) => x.team)).size === signed.length, `${s}: one signing per team per round`);
  FA.skipFreeAgency(L);
  check(L.phase === 'draft' || L.phase === 'grades', `${s}: the rookie draft opens after ${FA.FA_ROUNDS} rounds`);
  for (const t of L.teams) {
    check(FA.payroll(L, t) <= L.cap, `${s}: ${t.abbr} stays under the cap ($${FA.payroll(L, t)}M of $${L.cap}M)`);
    check(t.roster.length <= rosterSize, `${s}: ${t.abbr} roster at most ${rosterSize}`);
    check(FA.signingsBy(L, t.id).length <= FA.FA_ROUNDS, `${s}: ${t.abbr} signed at most ${FA.FA_ROUNDS}`);
  }
  const all = L.teams.flatMap((t) => t.roster);
  check(new Set(all).size === all.length, `${s}: nobody signed twice`);
  console.log(`     season ${L.season} free agency: ${L.fa.log.length} signed, cap $${L.cap}M; you ${won ? 'won' : 'lost'} ${PLAYERS[target.id].name} at $${amount}M`);
}

function checkRookieDraft(L, rosterSize, last) {
  const s = `season ${L.season} rookie draft`;
  check(L.phase === 'draft', `${s}: opens`);
  const need = L.teams.map((t) => rosterSize - t.roster.length);
  check(L.picks.length === need.reduce((a, b) => a + b, 0), `${s}: one pick per open roster spot`);
  check(need.every((k) => k >= LG.CUTS - FA.FA_ROUNDS), `${s}: every team keeps at least ${LG.CUTS - FA.FA_ROUNDS} picks`);
  const first = L.picks.slice(0, L.teams.length).map((p) => p.team);
  check(first[first.length - 1] === last.champion, `${s}: the champion picks last`);
  const others = last.records.map((r) => r.id).filter((id) => id !== last.champion).reverse();
  check(same(first.slice(0, -1), others), `${s}: worst record picks first`);
  check(L.results.length === 0 && Object.keys(L.seasonStats).length === 0 && L.champion == null, `${s}: the new season starts clean`);
}

// Careers, the Hall of Fame, the record books and rivalries after a season is archived.
function checkRecords(L, seasonStats) {
  const s = `season ${L.season} records`;
  check(L.careerSeason === L.season, `${s}: the season is folded into careers once`);
  const sum = (k) => Object.values(L.careers).reduce((a, c) => a + (c.st[k] ?? 0), 0);
  const want = (k) => L.history.reduce((a, h) => a + (h.totals?.[k] ?? 0), 0);
  for (const k of ['py', 'ry', 'tk']) check(sum(k) === want(k), `${s}: career ${k} totals match every season played (${sum(k)} vs ${want(k)})`);
  check(Object.values(L.careers).every((c) => c.seasons >= 1 && c.seasons <= L.season), `${s}: seasons per career within the league's age`);
  const champs = Object.entries(seasonStats).filter(([, x]) => x.team === L.champion).map(([id]) => Number(id));
  check(champs.length > 0 && champs.every((id) => L.careers[id].rings >= 1), `${s}: the champions get a ring`);
  const mvp = L.history[L.history.length - 1].awards.find((a) => a.key === 'mvp');
  check(L.careers[mvp.id].aw.mvp >= 1, `${s}: the MVP is on the MVP's career`);
  check(L.hof.every((h) => L.careers[h.id].seasons >= RC.HOF_MIN_SEASONS && h.points >= RC.HOF_POINTS), `${s}: Hall of Famers clear the bar`);
  check(new Set(L.hof.map((h) => h.id)).size === L.hof.length, `${s}: nobody inducted twice`);
  check(L.hof.filter((h) => h.season === L.season).length <= RC.HOF_CLASS, `${s}: at most ${RC.HOF_CLASS} inducted a year`);
  // The record book holds the best single game and season seen.
  const league = RC.recordBook(L);
  const py = league.season.find((r) => r.key === 'py').rec;
  const bestPy = Math.max(...Object.values(seasonStats).map((x) => x.py ?? 0));
  check(py && py.v >= bestPy, `${s}: the passing-yards season record is at least this season's best (${py?.v} vs ${bestPy})`);
  const wins = league.season.find((r) => r.key === 'w').rec;
  check(wins && wins.v >= Math.max(...L.history[L.history.length - 1].records.map((r) => r.w)), `${s}: the wins record is at least this season's best`);
  const pts = league.game.find((r) => r.key === 'pts').rec;
  check(pts && pts.v === Math.max(...L.meetings.flatMap((m) => [m.hs, m.as])), `${s}: the points-in-a-game record is the best score on the books`);
  for (const t of L.teams) {
    const f = RC.franchiseSummary(L, t.id);
    const played = L.meetings.filter((m) => m.h === t.id || m.a === t.id).length;
    check(f.w + f.l + f.t + f.pw + f.pl === played, `${s}: ${t.abbr} all-time record covers ${played} games`);
  }
  // Every playoff pairing has a rivalry, and its series adds up.
  const rv = RC.rivalries(L);
  check(rv.length > 0, `${s}: playoff rivalries exist`);
  for (const r of rv) {
    check(r.aWins + r.bWins + r.ties === r.played && r.playoffs.length >= 1, `${s}: ${L.teams[r.a].abbr}-${L.teams[r.b].abbr} series adds up`);
  }
  const final = L.meetings.filter((m) => m.s === L.season && m.r === 1);
  check(final.length === 1, `${s}: the final is in the head-to-head book`);
}

// ---------- the dynasty ----------

function runDynasty(seed, seasons, { exportAt = null } = {}) {
  const L = LG.createLeague({ seed, rounds: 26 });
  const rosterSize = L.settings.rounds;
  let exported = null;
  check(L.phase === 'draft' && L.picks.length === L.teams.length * rosterSize, 'league: snake draft laid out');
  check(L.picks[L.teams.length - 1].team === L.picks[L.teams.length].team, 'league: the draft snakes at the turn');
  applyGrowth(L.growth);
  draftAll(L);
  for (;;) {
    checkDraft(L, rosterSize);
    checkTrade(L);
    L.phase = 'season';
    while (L.phase === 'season') {
      if (exportAt && L.season === exportAt.season && L.week === exportAt.week) exported = JSON.stringify({ league: L, game: null, gameMeta: null, screen: 'season' });
      checkCondition(L);
      playWeek(L);
    }
    checkSeason(L);
    while (L.phase === 'playoffs') playPlayoffRound(L);
    checkPlayoffs(L);
    const champ = L.teams[L.champion];
    console.log(`ok   season ${L.season}: ${LG.standings(L).map((r) => `${L.teams[r.id].abbr} ${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`).join(', ')}; champion ${champ.abbr}`);
    if (L.season >= seasons) return { L, exported };
    const growthBefore = JSON.parse(JSON.stringify(L.growth));
    const seasonStats = JSON.parse(JSON.stringify(L.seasonStats));
    // A rivalry card is ready for the final before it is archived.
    const fin = LG.bracket(L).final;
    const card = RC.rivalry(L, fin.home, fin.away);
    check(card.playoffs.some((g) => g.season === L.season && g.round === 1), `season ${L.season}: the rivalry card shows the final`);
    LG.startOffseason(L);
    L.history[L.history.length - 1].totals = Object.fromEntries(['py', 'ry', 'tk'].map((k) => [k, Object.values(seasonStats).reduce((a, x) => a + (x[k] ?? 0), 0)]));
    checkRecords(L, seasonStats);
    checkOffseason(L, growthBefore);
    applyGrowth(L.growth);
    const last = L.history[L.history.length - 1];
    // Cut your own four by hand (the lowest overall), the AI teams take their suggestions.
    const me = L.teams.find((t) => t.user);
    const ovr = (id) => PLAYERS[id].ovr[PLAYERS[id].best[0]];
    const mine = me.roster.slice().sort((a, b) => ovr(a) - ovr(b)).slice(0, LG.CUTS);
    LG.finishOffseason(L, mine);
    check(mine.every((id) => !me.roster.includes(id)), `season ${L.season} cuts: your hand-picked cuts are gone`);
    check(L.teams.every((t) => t.roster.length === rosterSize - LG.CUTS), `season ${L.season} cuts: every team is down ${LG.CUTS}`);
    runFreeAgency(L, rosterSize);
    const picks = L.picks.length;
    checkRookieDraft(L, rosterSize, last);
    draftAll(L);
    check(L.rookies.length === picks, `season ${L.season}: ${L.rookies.length} rookies drafted`);
  }
}

const { L, exported } = runDynasty(SEED, SEASONS, { exportAt: { season: 1, week: 3 } });
check(L.history.length === SEASONS - 1 && L.season === SEASONS, `dynasty: ${SEASONS} seasons played`);

// The same seed replays the same dynasty.
const again = runDynasty(SEED, 1).L;
const firstSeason = (x) => (x.season === 1 ? x.champion : x.history[0].champion);
check(firstSeason(L) === again.champion, 'dynasty: the same seed crowns the same first champion');

// Export mid-season, import (migrating as the app does), and play on: same results.
{
  const snap = JSON.parse(exported);
  const M = LG.migrateLeague(snap.league);
  check(M.version === 2 && M.teams.some((t) => t.user), 'save: exports a league the importer accepts');
  applyGrowth(M.growth);
  while (M.phase === 'season') playWeek(M);
  while (M.phase === 'playoffs') playPlayoffRound(M);
  const ref = again;
  check(same(M.results.map((r) => [r.home, r.away, r.score]), ref.results.map((r) => [r.home, r.away, r.score])), 'save: an imported save plays on to the same results');
  check(M.champion === ref.champion, 'save: and the same champion');
  // A version 1 save comes up to the current shape.
  const v1 = JSON.parse(exported).league;
  for (const k of ['season', 'history', 'growth', 'condition', 'rookies', 'trade', 'offseason']) delete v1[k];
  delete v1.version;
  LG.migrateLeague(v1);
  check(v1.version === 2 && v1.season === 1 && Array.isArray(v1.history) && v1.growth && v1.condition && Array.isArray(v1.rookies), 'save: a version 1 save migrates');
}

applyGrowth({});
console.log(`${checks - failures} of ${checks} checks passed in ${Date.now() - t0} ms`);
if (failures) { console.log(`${failures} failed`); process.exit(1); }
