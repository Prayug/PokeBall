// League mode end to end, the way the app drives it: draft, grades and the trade offer, a full
// regular season with soreness and subs, the playoff bracket, awards, the offseason (training
// camp, cuts) and the rookie draft, then the next season. Every step is checked against the
// rules the league screens rely on, and a save exported mid-season (a JSON round trip, as the
// Export and Import buttons do) must play on to exactly the same results as the original.
// Exits non-zero on any failure.
// Usage: node test/league.mjs [seasons, default 2] [seed, default 11]
import * as LG from '../src/league.js';
import { PLAYERS, SLOT_KEYS, applyGrowth } from '../src/ratings.js';
import { fgRange, simUntil } from '../src/engine.js';

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

function checkRookieDraft(L, rosterSize, last) {
  const s = `season ${L.season} rookie draft`;
  check(L.phase === 'draft' && L.picks.length === L.teams.length * LG.CUTS, `${s}: ${LG.CUTS} rounds open`);
  const first = L.picks.slice(0, L.teams.length).map((p) => p.team);
  check(first[first.length - 1] === last.champion, `${s}: the champion picks last`);
  const others = last.records.map((r) => r.id).filter((id) => id !== last.champion).reverse();
  check(same(first.slice(0, -1), others), `${s}: worst record picks first`);
  check(L.teams.every((t) => t.roster.length === rosterSize - LG.CUTS), `${s}: every team is down ${LG.CUTS}`);
  check(L.results.length === 0 && Object.keys(L.seasonStats).length === 0 && L.champion == null, `${s}: the new season starts clean`);
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
    LG.startOffseason(L);
    checkOffseason(L, growthBefore);
    applyGrowth(L.growth);
    const last = L.history[L.history.length - 1];
    // Cut your own four by hand (the lowest overall), the AI teams take their suggestions.
    const me = L.teams.find((t) => t.user);
    const ovr = (id) => PLAYERS[id].ovr[PLAYERS[id].best[0]];
    const mine = me.roster.slice().sort((a, b) => ovr(a) - ovr(b)).slice(0, LG.CUTS);
    LG.finishOffseason(L, mine);
    check(mine.every((id) => !me.roster.includes(id)), `season ${L.season} cuts: your hand-picked cuts are gone`);
    checkRookieDraft(L, rosterSize, last);
    draftAll(L);
    check(L.rookies.length === L.teams.length * LG.CUTS, `season ${L.season}: ${L.rookies.length} rookies drafted`);
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

// Box scores: every result carries its season, and trimming keeps the current and last season's.
{
  check(L.results.length > 0 && L.results.every((r) => r.season === L.season && r.box), 'saves: results carry their season and box score');
  const T = JSON.parse(JSON.stringify(L));
  const games = (season, tag) => T.results.map((r) => { const c = { ...r }; if (tag) c.season = season; else delete c.season; return c; });
  T.history = [{ season: T.season, results: games(T.season, true) }, { season: T.season + 1, results: games(T.season + 1, false) }];
  T.season += 2; T.results = games(T.season, true);
  const before = JSON.stringify(T).length;
  const n = LG.trimBoxScores(T);
  check(n === L.results.length && T.history[0].results.every((r) => !r.box && r.score), 'saves: box scores two seasons back are dropped, scores kept');
  check(T.history[1].results.every((r) => r.box) && T.results.every((r) => r.box), 'saves: last season and this season keep their box scores');
  check(JSON.stringify(T).length < before * 0.75, 'saves: trimming shrinks the save');
  check(LG.trimBoxScores(T) === 0, 'saves: trimming twice changes nothing');
}

// Kicking: the scouting report rates both kickers and punters with their range.
{
  const me = L.teams.find((t) => t.user), opp = L.teams.find((t) => !t.user);
  const R = LG.scoutReport(L, me.id, opp.id);
  for (const [side, u] of Object.entries(R.kicking)) {
    check(u.k && u.k.range >= 20 && u.k.range <= 70 && u.k.ovr === PLAYERS[u.k.id].ovr.K, `scouting: ${side} kicker has a rating and a range (${u.k?.range})`);
    check(u.p && u.p.net > 20 && u.p.net < 70 && u.p.ovr === PLAYERS[u.p.id].ovr.P, `scouting: ${side} punter has a rating and a net (${u.p?.net})`);
  }
  // A stronger leg and truer aim never shorten the range.
  const ids = Object.keys(PLAYERS).map(Number).sort((a, b) => PLAYERS[a].attrs.kac + PLAYERS[a].attrs.kpw - PLAYERS[b].attrs.kac - PLAYERS[b].attrs.kpw);
  check(fgRange(ids[ids.length - 1]) >= fgRange(ids[0]), 'kicking: the best leg out-ranges the worst');
}

// Trades weigh kickers and punters: across seeds some offers move one, and the trade card's
// kicking line names the right Pokémon.
{
  let kp = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const M = LG.createLeague({ seed });
    draftAll(M);
    const K = LG.tradeKicking(M);
    if (!K) continue;
    kp++;
    const T = M.trade;
    check([K.before.k?.id, K.after.k?.id, K.before.p?.id, K.after.p?.id].some((id) => id === T.youSend || id === T.youGet), `trades: seed ${seed} kicking line involves the traded Pokémon`);
  }
  check(kp > 0, `trades: ${kp} of 24 offers change your kicker or punter`);
}

applyGrowth({});
console.log(`${checks - failures} of ${checks} checks passed in ${Date.now() - t0} ms`);
if (failures) { console.log(`${failures} failed`); process.exit(1); }
