// League mode end to end, the way the app drives it: draft, grades and the trade offer, a full
// regular season with soreness and subs, the playoff bracket, awards, the offseason (training
// camp, cuts), free agency and the rookie draft, then the next season. Career stats, the Hall
// of Fame, the record books and the playoff rivalries are checked as they build up. Every step is checked against the
// rules the league screens rely on, and a save exported mid-season (a JSON round trip, as the
// Export and Import buttons do) must play on to exactly the same results as the original.
// Trade desk 2.0 (multi-player deals, pick chips, the deadline, traded picks in the rookie
// draft) and the bigger leagues (12 and 16 teams: divisions, the longer schedule, byes and an
// eight-team bracket) are checked after the dynasty.
// Exits non-zero on any failure.
// Usage: node test/league.mjs [seasons, default 2] [seed, default 11]
import * as LG from '../src/league.js';
import { PLAYERS, RETIRED, SLOT, SLOT_KEYS, applyGrowth } from '../src/ratings.js';
import { MODEL_INDEX } from '../src/models3d.js';
import { createGame as newGame } from '../src/engine.js';
import { createGame, fgRange, simUntil } from '../src/engine.js';
import { SCHEMES, schemeBonus } from '../src/coach.js';
import { injuryOdds } from '../src/injuries.js';
import * as FA from '../src/freeagency.js';
import * as RC from '../src/records.js';
import { decodeLeague, encodeLeague, leagueFromShare } from '../src/share.js';
import * as TR from '../src/trades.js';
import * as GEO from '../src/geometry.js';

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
  checkSchedule(L, s);
  const grades = LG.draftGrades(L);
  check(grades.length === n && grades.every((g) => Object.values(g).every((u) => /^[A-DF][+]?$/.test(u.grade))), `${s}: every unit gets a letter grade`);
}

// Every team plays once a week; every pair meets once, division rivals twice with home and away
// swapped.
function checkSchedule(L, s) {
  const n = L.teams.length;
  const gpt = GEO.gamesPerTeam(L);
  check(L.schedule.length === gpt + (n % 2), `${s}: ${L.schedule.length} weeks scheduled for ${n} teams`);
  check(L.schedule.every((wk) => new Set(wk.flatMap((gm) => [gm.home, gm.away])).size === wk.length * 2), `${s}: nobody plays twice in a week`);
  const meets = {};
  for (const gm of L.schedule.flat()) (meets[[gm.home, gm.away].sort((a, b) => a - b).join('-')] ??= []).push(gm.home);
  const pairs = Object.entries(meets);
  check(pairs.length === n * (n - 1) / 2, `${s}: every pair meets`);
  for (const [k, homes] of pairs) {
    const [a, b] = k.split('-').map(Number);
    const rivals = GEO.divisionOf(L, a) && GEO.divisionOf(L, a) === GEO.divisionOf(L, b);
    check(homes.length === (rivals ? 2 : 1), `${s}: ${L.teams[a].abbr}-${L.teams[b].abbr} meet ${homes.length} times`);
    if (rivals) check(homes[0] !== homes[1], `${s}: ${L.teams[a].abbr} and ${L.teams[b].abbr} each host once`);
  }
}

function checkTrade(L) {
  const T = L.trade;
  if (!T) { console.log(`     season ${L.season}: no trade offer this time`); return; }
  const me = L.teams.find((t) => t.user), ai = L.teams[T.team];
  check(T.send.every((id) => me.roster.includes(id)) && T.get.every((id) => ai.roster.includes(id)), `season ${L.season} trade: offers Pokémon each side owns`);
  check(T.sendPicks.every((k) => TR.picksOwned(L, me.id).includes(k)) && T.getPicks.every((k) => TR.picksOwned(L, ai.id).includes(k)), `season ${L.season} trade: offers picks each side owns`);
  check(TR.tradeOpen(L), `season ${L.season} trade: open before the season`);
  check(TR.evaluateTrade(L, T).verdict === 'yes', `season ${L.season} trade: the team making the offer would say yes to it`);
  const before = [me.roster.length, ai.roster.length];
  check(TR.acceptTrade(L), `season ${L.season} trade: accepted`);
  check(T.get.every((id) => me.roster.includes(id)) && T.send.every((id) => !me.roster.includes(id)), `season ${L.season} trade: you get ${T.get.map((id) => PLAYERS[id].name).join(', ') || 'a pick'}`);
  check(T.send.every((id) => ai.roster.includes(id)), `season ${L.season} trade: they get ${T.send.map((id) => PLAYERS[id].name).join(', ') || 'a pick'}`);
  check(same(before, [me.roster.length, ai.roster.length]), `season ${L.season} trade: roster sizes unchanged`);
  check(T.send.every((id) => !Object.values(me.lineup).includes(id) && !me.bench.includes(id)), `season ${L.season} trade: the traded Pokémon leaves your depth chart`);
  check(SLOT_KEYS.every((k) => me.lineup[k] != null && me.roster.includes(me.lineup[k])), `season ${L.season} trade: your lineup stays full`);
  check(!TR.acceptTrade(L), `season ${L.season} trade: cannot be accepted twice`);
  check(L.tradeLog[L.tradeLog.length - 1]?.by === 'them', `season ${L.season} trade: in the trade log`);
}

// A deal the user builds on the trade desk, mid-season: a pick for a Pokémon off the bench of
// whichever AI team says yes first. Returns the pick traded, or null.
function deskTrade(L) {
  const s = `season ${L.season} week ${L.week + 1} trade desk`;
  const me = L.teams.find((t) => t.user);
  // Your own second-rounder, or the first-rounder if the offer after the draft took it.
  const own = TR.picksOwned(L, me.id).filter((k) => TR.parsePick(k).from === me.id);
  check(own.length > 0, `${s}: you hold one of your own picks`);
  const myR2 = own[own.length - 1];
  let done = null;
  for (const t of L.teams.filter((x) => !x.user)) {
    for (const id of t.bench) {
      const ev = TR.evaluateTrade(L, { team: t.id, send: [], get: [id], sendPicks: [myR2], getPicks: [] });
      if (ev.verdict !== 'yes') continue;
      const res = TR.proposeTrade(L, ev.deal);
      check(res.ok, `${s}: a deal they said yes to goes through`);
      done = { key: myR2, to: t.id, from: me.id, id };
      break;
    }
    if (done) break;
  }
  if (!done) { console.log(`     ${s}: nobody wanted a second-rounder for a bench Pokémon`); return null; }
  check(L.pickOwners[myR2] === done.to && !TR.picksOwned(L, me.id).includes(myR2) && TR.picksOwned(L, done.to).includes(myR2), `${s}: the pick changes hands`);
  check(me.roster.includes(done.id) && !L.teams[done.to].roster.includes(done.id), `${s}: the Pokémon changes hands`);
  // One in, nothing out: you release one to stay at the roster size; they sign one.
  const e = L.tradeLog[L.tradeLog.length - 1];
  check(e.released.you.length === 1 && e.signed.them.length === 1, `${s}: you release one and they sign one`);
  check(L.teams.every((t) => t.roster.length === L.settings.rounds), `${s}: every roster stays at ${L.settings.rounds}`);
  const all = L.teams.flatMap((t) => t.roster);
  check(new Set(all).size === all.length, `${s}: nobody on two rosters`);
  check(e.released.you.every((id) => LG.available(L).includes(id)), `${s}: the released Pokémon go back to the pool`);
  for (const t of L.teams) check(SLOT_KEYS.every((k) => t.lineup[k] != null && t.roster.includes(t.lineup[k])), `${s}: ${t.abbr} lineup stays full`);
  check(TR.evaluateTrade(L, { team: done.to, send: [], get: [], sendPicks: [myR2], getPicks: [] }).problems.length > 0, `${s}: a pick you no longer hold can't be traded`);
  console.log(`     ${s}: ${PLAYERS[done.id].name} from ${L.teams[done.to].abbr} for your second-rounder`);
  return done;
}

// Injured Pokémon never play; who is out sore sits when the bench can cover (what is left of it
// after the injuries are covered); sore players start below full energy.
function checkCondition(L) {
  for (const t of L.teams) {
    const side = LG.teamForGame(t, L);
    const outStarters = Object.values(side.lineup).filter((id) => L.condition[id]?.out);
    check(!outStarters.length || side.bench.length === 0, `week ${L.week + 1}: ${t.abbr} starts ${outStarters.length} Pokémon who are out with healthy bench left`);
    const hurt = [...Object.values(side.lineup), ...side.bench].filter((id) => L.injuries[id]);
    check(!hurt.length, `week ${L.week + 1}: ${t.abbr} dresses ${hurt.length} injured Pokémon`);
    check(Object.values(side.lineup).every((id) => t.roster.includes(id)), `week ${L.week + 1}: ${t.abbr} covers injuries from its own roster`);
    check(SLOT_KEYS.every((k) => side.lineup[k] != null), `week ${L.week + 1}: ${t.abbr} fields a full lineup`);
    for (const [id, e] of Object.entries(side.energy ?? {})) check(e >= 0 && e <= 100, `week ${L.week + 1}: ${PLAYERS[id].name} starts at ${e} energy`);
  }
  const outByTeam = L.teams.map((t) => t.roster.filter((id) => L.condition[id]?.out).length);
  check(outByTeam.every((k) => k <= LG.MAX_OUT), `week ${L.week + 1}: at most ${LG.MAX_OUT} out per team (${outByTeam.join(' ')})`);
}

// The week in review: a Player of the Week from one of the week's games, a power ranking of
// every team, and a headline on every game.
function checkWeekly(L, label) {
  const W = L.weekly[L.weekly.length - 1];
  check(W?.label === label, `${label}: week in review written (${W?.label})`);
  if (!W) return;
  const games = W.games.map((i) => L.results[i]);
  check(games.length > 0 && games.every((r) => typeof r.headline === 'string' && r.headline.length > 10), `${label}: every game has a headline`);
  check(games.every((r) => r.headline.includes(`${Math.max(...r.score)}-${Math.min(...r.score)}`)), `${label}: headlines carry the score`);
  const teamsIn = new Set(games.flatMap((r) => [r.home, r.away]));
  check(W.potw && PLAYERS[W.potw.id] && teamsIn.has(W.potw.team) && L.teams[W.potw.team].roster.includes(W.potw.id), `${label}: Player of the Week plays for a team that played`);
  if (!W.playoff) check(W.power && same(W.power.slice().sort(), L.teams.map((t) => t.id).sort()), `${label}: power ranking lists every team once`);
}

// Injuries: rare, two to five games, and healing one game per week.
function checkInjuries(L, before) {
  for (const [id, inj] of Object.entries(L.injuries)) {
    check(inj.weeks >= 1 && inj.weeks <= 5, `week ${L.week}: ${PLAYERS[id].name} out ${inj.weeks} games`);
    check(L.teams[inj.team].roster.includes(Number(id)), `week ${L.week}: ${PLAYERS[id].name} is on the team that lost him`);
    const prev = before[id];
    if (prev && !inj.fresh) check(inj.weeks === prev.weeks - (prev.fresh ? 0 : 1), `week ${L.week}: ${PLAYERS[id].name} heals a game a week`);
  }
}

function checkSeason(L) {
  const s = `season ${L.season}`;
  const n = L.teams.length;
  const reg = L.results.filter((r) => !r.playoff);
  const gpt = GEO.gamesPerTeam(L);
  check(reg.length === n * gpt / 2, `${s}: ${reg.length} regular-season games recorded`);
  const st = LG.standings(L);
  for (const row of st) check(row.w + row.l + row.t === gpt, `${s}: ${L.teams[row.id].abbr} played ${row.w + row.l + row.t} games`);
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
  check(totals.every((x) => x.gp >= 1 && x.gp <= gpt + GEO.playoffRounds(L)), `${s}: games played per Pokémon within the schedule`);
  // Playoff seeding: the top of the standings, division winners first.
  const field = GEO.playoffField(L);
  check(L.phase === 'playoffs' && L.playoffs.seeds.length === field && new Set(L.playoffs.seeds).size === field, `${s}: ${field} teams seeded`);
  if (!L.divisions) check(same(L.playoffs.seeds, st.slice(0, field).map((r) => r.id)), `${s}: the top ${field} seeded`);
  else {
    const winners = L.divisions.map((d) => st.find((r) => d.teams.includes(r.id)).id);
    check(same(L.playoffs.seeds.slice(0, winners.length).sort(), winners.slice().sort()), `${s}: division winners take the top seeds`);
    const rest = st.map((r) => r.id).filter((id) => !winners.includes(id)).slice(0, field - winners.length);
    check(same(L.playoffs.seeds.slice(winners.length), rest), `${s}: the best of the rest fill the field`);
  }
  check(same(L.playoffs.byes, L.playoffs.seeds.slice(0, GEO.playoffByes(L))), `${s}: the top ${GEO.playoffByes(L)} seeds get byes`);
  const sc = LG.scoutReport(L, 0, L.playoffs.seeds.find((id) => id !== 0));
  check(typeof sc.plan === 'string' && typeof sc.lean === 'string' && Array.isArray(sc.best) && Array.isArray(sc.worst), `${s}: scouting report builds`);
}

function checkPlayoffs(L) {
  const s = `season ${L.season} playoffs`;
  check(L.phase === 'done' && L.champion != null, `${s}: a champion is crowned`);
  const b = LG.bracket(L);
  check(b.rounds.length === GEO.playoffRounds(L) && b.rounds.every((r) => r.games.every((g) => g.winner != null && g.homeScore != null)), `${s}: every round played`);
  for (let i = 1; i < b.rounds.length; i++) {
    const through = [...b.rounds[i - 1].byes, ...b.rounds[i - 1].games.map((g) => g.winner)].sort();
    check(same(b.rounds[i].games.flatMap((g) => [g.home, g.away]).sort(), through), `${s}: ${b.rounds[i].name} is the ${b.rounds[i - 1].name.toLowerCase()} winners${b.rounds[i - 1].byes.length ? ' and the byes' : ''}`);
    check(b.rounds[i].games.every((g) => g.seeds[0] < g.seeds[1]), `${s}: the better seed hosts in the ${b.rounds[i].name.toLowerCase()}`);
  }
  check(b.final.home != null && b.semis.length === 2, `${s}: two semifinals and a final`);
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

function checkRookieDraft(L, rosterSize, last, traded = null) {
  const s = `season ${L.season} rookie draft`;
  check(L.phase === 'draft', `${s}: opens`);
  const need = L.teams.map((t) => rosterSize - t.roster.length);
  check(L.picks.length === need.reduce((a, b) => a + b, 0), `${s}: one pick per open roster spot`);
  check(L.teams.every((t) => L.picks.filter((p) => p.team === t.id).length === need[t.id]), `${s}: every team picks once per open spot, traded picks or not`);
  if (traded) {
    // The second-rounder you traded: its new owner makes it (unless that team had its fill
    // by then), and you make up the pick at the end of the draft.
    const round = TR.parsePick(traded.key).round;
    const inRound = L.picks.filter((p) => p.round === round);
    const slot = inRound.find((p) => p.from === traded.from);
    check(slot ? slot.team === traded.to : need[traded.to] <= round, `${s}: ${L.teams[traded.to].abbr} make the round ${round} pick they traded for`);
    check(!inRound.some((p) => p.team === traded.from && p.from == null), `${s}: you don't pick in your traded round ${round} slot`);
    check(!Object.keys(L.pickOwners).some((k) => k.startsWith(`${L.season}:`)), `${s}: this draft's traded picks are used up`);
  }
  check(need.every((k) => k >= LG.CUTS - FA.FA_ROUNDS), `${s}: every team keeps at least ${LG.CUTS - FA.FA_ROUNDS} picks`);
  // By slot: a traded pick keeps its place in the order under its new owner.
  const first = L.picks.slice(0, L.teams.length).map((p) => p.from ?? p.team);
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
  const final = L.meetings.filter((m) => m.s === L.season && GEO.isFinalRound(L, m.r));
  check(final.length === 1, `${s}: the final is in the head-to-head book`);
}

// ---------- the dynasty ----------

let totalInjuries = 0, totalGames = 0;
function runDynasty(seed, seasons, { exportAt = null, numTeams = 8 } = {}) {
  const L = LG.createLeague({ seed, rounds: 26, scheme: 'airraid', numTeams });
  check(L.teams[0].coach === 'airraid', 'league: your scheme is set');
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
    let traded = null;
    while (L.phase === 'season') {
      if (L.season === 1 && L.week === 1) traded = deskTrade(L) ?? traded;
      if (L.week === TR.tradeDeadline(L)) {
        check(!TR.tradeWindow(L) && !TR.proposeTrade(L, { team: 1, send: [], get: [], sendPicks: TR.picksOwned(L, 0), getPicks: [] }).ok, `season ${L.season} week ${L.week + 1}: trades close at the deadline`);
      }
      if (exportAt && L.season === exportAt.season && L.week === exportAt.week) exported = JSON.stringify({ league: L, game: null, gameMeta: null, screen: 'season' });
      checkCondition(L);
      const label = `season ${L.season} week ${L.week + 1}`, wk = `Week ${L.week + 1}`;
      const before = JSON.parse(JSON.stringify(L.injuries));
      playWeek(L);
      check(L.weekly[L.weekly.length - 1]?.label === wk, `${label}: review labelled ${wk}`);
      checkWeekly(L, wk);
      checkInjuries(L, before);
    }
    const hurt = L.results.flatMap((r) => r.injuries ?? []);
    totalInjuries += hurt.length; totalGames += L.results.length;
    check(hurt.every((x) => x.weeks >= 2 && x.weeks <= 5), `season ${L.season}: injuries last 2 to 5 games`);
    checkSeason(L);
    while (L.phase === 'playoffs') { const lab = GEO.roundLabel(L, L.playoffs.round, true); playPlayoffRound(L); checkWeekly(L, lab); }
    checkPlayoffs(L);
    const champ = L.teams[L.champion];
    console.log(`ok   season ${L.season}: ${LG.standings(L).map((r) => `${L.teams[r.id].abbr} ${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`).join(', ')}; champion ${champ.abbr}`);
    if (L.season >= seasons) return { L, exported };
    const growthBefore = JSON.parse(JSON.stringify(L.growth));
    const seasonStats = JSON.parse(JSON.stringify(L.seasonStats));
    // A rivalry card is ready for the final before it is archived.
    const fin = LG.bracket(L).final;
    const card = RC.rivalry(L, fin.home, fin.away);
    check(card.playoffs.some((g) => g.season === L.season && GEO.isFinalRound(L, g.round)), `season ${L.season}: the rivalry card shows the final`);
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
    check(!Object.keys(L.injuries).length && !L.weekly.length, `season ${L.season}: injuries heal and the weekly reviews reset over the offseason`);
    check(mine.every((id) => !me.roster.includes(id)), `season ${L.season} cuts: your hand-picked cuts are gone`);
    check(L.teams.every((t) => t.roster.length === rosterSize - LG.CUTS), `season ${L.season} cuts: every team is down ${LG.CUTS}`);
    runFreeAgency(L, rosterSize);
    const picks = L.picks.length;
    checkRookieDraft(L, rosterSize, last, traded);
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

// ---------- bigger leagues ----------
// 12 teams (three divisions, 14 weeks, six in the playoffs with two byes) through an offseason
// into season 2, and 16 teams (four divisions, 18 weeks, an eight-team bracket) for a season.
{
  const big = runDynasty(SEED + 1, 2, { numTeams: 12 }).L;
  check(big.teams.length === 12 && big.divisions.length === 3 && big.divisions.every((d) => d.teams.length === 4), 'big leagues: 12 teams in three divisions of four');
  check(big.history[0] && GEO.playoffField(big) === 6 && GEO.playoffByes(big) === 2, 'big leagues: 12 teams send six to the playoffs, two on a bye');
  check(new Set(big.teams.map((t) => t.abbr)).size === 12, 'big leagues: twelve different franchises');
  const huge = runDynasty(SEED + 2, 1, { numTeams: 16 }).L;
  check(huge.settings.rounds === SLOT_KEYS.length, `big leagues: 16 teams without legendaries draft ${SLOT_KEYS.length} rounds, not 26 (${huge.settings.rounds})`);
  check(huge.divisions.length === 4 && huge.schedule.length === 18 && GEO.playoffField(huge) === 8, 'big leagues: 16 teams, four divisions, 18 weeks, eight in the playoffs');
  check(['Quarterfinals', 'Semifinals', 'Championship'].every((n, i) => GEO.roundLabel(huge, i, true) === n), 'big leagues: the 16-team rounds are named');
  check(['Wild card round', 'Semifinals', 'Championship'].every((n, i) => GEO.roundLabel(big, i, true) === n), 'big leagues: the 12-team rounds are named');
  check(LG.createLeague({ seed: 3, numTeams: 16, rounds: 28, legendaries: true }).settings.rounds === 28, 'big leagues: with legendaries, 16 teams can draft 28 rounds');
  // An 8-team league is the league it always was: same franchises for the same seed.
  const eight = LG.createLeague({ seed: 41 });
  check(eight.divisions === null && eight.teams.every((t) => LG.AI_TEAMS.slice(0, 9).some((a) => a.abbr === t.abbr) || t.user), 'big leagues: 8 teams have no divisions and the classic franchises');
  // Share codes carry the league size.
  const code = encodeLeague(huge);
  const D = decodeLeague(code);
  check(D?.numTeams === 16 && leagueFromShare(D).teams.length === 16, 'big leagues: a 16-team league shares and rebuilds');
}

// ---------- saves from before trade desk 2.0 and the bigger leagues ----------
{
  const X = LG.createLeague({ seed: 61 });
  draftAll(X);
  const old = JSON.parse(JSON.stringify(X));
  delete old.divisions; delete old.pickOwners; delete old.tradeLog;
  old.trade = { team: 2, youGet: X.teams[2].roster[0], youSend: X.teams[0].roster[0], gain: 3, season: 1, status: 'open' };
  LG.migrateLeague(old);
  check(old.divisions === null && same(old.pickOwners, {}) && same(old.tradeLog, []), 'old saves: trade books and divisions filled in');
  check(same(old.trade.send, [X.teams[0].roster[0]]) && same(old.trade.get, [X.teams[2].roster[0]]) && old.trade.status === 'open', 'old saves: a one-for-one offer becomes a deal');
  // Playoffs in progress, in the old shape: semifinals done, final to play.
  const P = LG.createLeague({ seed: 62 });
  draftAll(P); P.phase = 'season';
  while (P.phase === 'season') playWeek(P);
  playPlayoffRound(P);
  const saved = JSON.parse(JSON.stringify(P));
  const s = saved.playoffs.seeds;
  saved.playoffs = { round: 1, games: saved.playoffs.games, seeds: s, final: null };
  LG.migrateLeague(saved);
  check(saved.playoffs.rounds.length === 2 && same(saved.playoffs.rounds[0], [{ home: s[0], away: s[3] }, { home: s[1], away: s[2] }]), 'old saves: a bracket in progress is rebuilt');
  playPlayoffRound(saved);
  check(saved.phase === 'done' && saved.champion != null && LG.bracket(saved).final.winner === saved.champion, 'old saves: and plays on to a champion');
}

// ---------- the trade desk ----------
// Uneven deals settle both rosters; the counter offer is one they accept; injured Pokémon and
// over-the-limit types are refused.
{
  const X = LG.createLeague({ seed: 71, rounds: 26 });
  draftAll(X);
  const me = X.teams[0], them = X.teams[3];
  const ovr = (id) => PLAYERS[id].ovr[PLAYERS[id].best[0]];
  const myBench = me.bench.slice().sort((a, b) => ovr(b) - ovr(a));
  // Two of yours for one of theirs: you sign one to fill the roster, they release one.
  const ev = TR.evaluateTrade(X, { team: them.id, send: myBench.slice(0, 2), get: [them.bench[0]] });
  check(ev.you.signed.length === 1 && ev.them.released.length === 1 && ev.you.released.length === 0 && ev.them.signed.length === 0, 'desk: two for one signs one for you, releases one for them');
  check(!ev.them.released.some((id) => myBench.includes(id)), 'desk: they never release the Pokémon they just got');
  const free = LG.available(X);
  check(ev.you.signed.every((id) => free.includes(id)), 'desk: the signing comes from the free pool');
  TR.executeTrade(X, ev, 'you');
  check(X.teams.every((t) => t.roster.length === 26), 'desk: rosters stay at 26 after a two-for-one');
  const all = X.teams.flatMap((t) => t.roster);
  check(new Set(all).size === all.length, 'desk: nobody on two rosters after a two-for-one');
  check(X.teams.every((t) => SLOT_KEYS.every((k) => t.lineup[k] != null && t.roster.includes(t.lineup[k]))), 'desk: every lineup stays full');
  check(same([...Object.values(me.lineup), ...me.bench].sort(), me.roster.slice().sort()) && new Set(Object.values(me.lineup)).size === SLOT_KEYS.length, 'desk: your depth chart is your roster, nobody twice');
  // Three's the limit, and something has to go each way.
  const many = TR.evaluateTrade(X, { team: them.id, send: me.roster.slice(0, 4), get: [them.roster[0]] });
  check(many.verdict === 'no' && many.problems.length, 'desk: four Pokémon one way is refused');
  check(TR.evaluateTrade(X, { team: them.id, send: [me.bench[0]], get: [] }).problems.length > 0, 'desk: a deal needs something coming back');
  // Injured Pokémon: they won't take one.
  const hurtId = me.bench[0];
  X.injuries[hurtId] = { weeks: 3, team: me.id };
  check(TR.evaluateTrade(X, { team: them.id, send: [hurtId], get: [them.bench[0]] }).problems.some((p) => /injured/.test(p)), 'desk: an injured Pokémon is refused');
  delete X.injuries[hurtId];
  // A lopsided ask: no, and the counter is a deal they'd take.
  const star = Object.values(them.lineup).sort((a, b) => ovr(b) - ovr(a))[0];
  const ask = { team: them.id, send: [me.bench[0]], get: [star] };
  const no = TR.evaluateTrade(X, ask);
  check(no.verdict !== 'yes', 'desk: a bench Pokémon for their best starter is not a yes');
  const c = TR.counterOffer(X, ask);
  if (c) check(TR.evaluateTrade(X, c.deal).verdict === 'yes', 'desk: the counter offer is one they accept');
  // Rebuilders value picks more than contenders do.
  const order = LG.standings(X).map((r) => r.id);
  const key = TR.pickKey(2, 1, me.id);
  check(TR.pickValue(X, TR.pickKey(2, 1, order[order.length - 1]), order) > TR.pickValue(X, TR.pickKey(2, 1, order[0]), order), 'desk: the worst team\'s first-rounder is worth more');
  check(TR.pickValue(X, key, order) > TR.pickValue(X, TR.pickKey(2, 2, me.id), order), 'desk: a first-rounder is worth more than a second');
  // The window: open after the draft, shut once the deadline week is reached.
  check(TR.tradeWindow(X), 'desk: open after the draft');
  X.phase = 'season'; X.week = TR.tradeDeadline(X);
  check(!TR.tradeWindow(X) && !TR.proposeTrade(X, ask).ok, 'desk: closed from the deadline week on');
}

// ---------- sharing a league (share.js) ----------
// The code rebuilds the draft exactly: every pick (the user's own slot choices too), the
// schedule and the trade offer; mid-draft, and after the rookie draft has replaced the picks.
{
  const draftView = (L) => ({ teams: L.teams.map((t) => [t.name, t.abbr, t.roster, t.slots, t.lineup, t.bench]), picks: L.picks, schedule: L.schedule, trade: L.trade, phase: L.phase, rng: L.rngState });
  const S2 = LG.createLeague({ seed: SEED * 7919 + 3, teamName: 'Sharé Testers', abbr: 'SHR', rounds: 28, legendaries: true });
  let n = 0;
  while (S2.phase === 'draft') {
    const pk = LG.currentPick(S2);
    if (S2.teams[pk.team].user) {
      // The user takes the third-best choice, into its worst open slot or the bench.
      const open = LG.openSlots(S2.teams[pk.team]);
      const ids = LG.available(S2).filter((id) => !LG.blockReason(S2, S2.teams[pk.team], id));
      const id = ids[(n * 7) % ids.length];
      LG.makePick(S2, id, open.length ? open[(n * 5) % open.length] : 'BENCH');
      n++;
    } else { const c = LG.aiChoosePick(S2); LG.makePick(S2, c.id, c.slot); }
    if (S2.pickIndex === 37) {
      const mid = leagueFromShare(decodeLeague(`https://example.com/PokeBall/#league=${encodeLeague(S2)}`));
      check(same(draftView(mid), draftView(S2)), 'share: a code made mid-draft rebuilds the draft so far');
    }
  }
  const code = encodeLeague(S2);
  check(code.length < 600, `share: the code is compact (${code.length} characters for ${S2.picks.length} picks)`);
  const D = decodeLeague(code);
  check(D && D.name === 'Sharé Testers' && D.abbr === 'SHR' && D.rounds === 28 && D.legendaries && D.typeCap, 'share: the code carries the team name and settings');
  check(same(draftView(leagueFromShare(D)), draftView(S2)), 'share: the code rebuilds the finished draft, schedule and trade offer');
  const own = leagueFromShare(D, { replay: false, teamName: 'Mine', abbr: 'MIN' });
  check(own.phase === 'draft' && own.pickIndex === 0 && own.teams[0].name === 'Mine' && same(own.picks.map((p) => p.team), S2.picks.map((p) => p.team)), 'share: drafting it yourself starts the same draft order fresh');
  // Through a season and the offseason: the first draft is kept for sharing.
  S2.phase = 'season';
  while (S2.phase === 'season') playWeek(S2);
  while (S2.phase === 'playoffs') playPlayoffRound(S2);
  LG.startOffseason(S2);
  LG.finishOffseason(S2, null);
  check(encodeLeague(S2) === code, 'share: after the rookie draft the league still shares its first draft');
  check(decodeLeague('not a code') === null && decodeLeague('#league=AAAA') === null && decodeLeague(`#league=${code.slice(0, 40)}`) === null, 'share: a bad or cut-off code is refused');
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
  check(JSON.stringify(T).length < before, 'saves: trimming shrinks the save');
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
    const K = TR.tradeKicking(M);
    if (!K) continue;
    kp++;
    const T = M.trade;
    check([K.before.k?.id, K.after.k?.id, K.before.p?.id, K.after.p?.id].some((id) => [...T.send, ...T.get].includes(id)), `trades: seed ${seed} kicking line involves the traded Pokémon`);
  }
  check(kp > 0, `trades: ${kp} of 24 offers change your kicker or punter`);
}

// Injuries stay rare: a few per season league-wide, not one a game.
const rate = totalInjuries / Math.max(1, totalGames);
check(totalInjuries > 0 && rate < 0.6, `injuries: ${totalInjuries} in ${totalGames} games (${rate.toFixed(2)} a game)`);
console.log(`ok   injuries: ${totalInjuries} in ${totalGames} games`);
// Size mismatch drives the odds: a Rotom hit by a Snorlax is far likelier hurt than the reverse.
check(injuryOdds(479, 143) > 3 * injuryOdds(143, 479), 'injuries: the small body takes the risk in a size mismatch');

// Schemes: the edge on the plays they are built around, the cost on the others, and the draft lean.
{
  const L = LG.createLeague({ seed: 5, numTeams: 2, rounds: 26, scheme: 'airraid' });
  while (L.phase === 'draft') { const c = LG.aiChoosePick(L); LG.makePick(L, c.id, c.slot); }
  const g = createGame({ home: LG.teamForGame(L.teams[0], L), away: LG.teamForGame(L.teams[1], L), seed: 1 });
  g.poss = 0;
  g.call = { off: 'slant', def: 'cover3', o: 0 };
  check(schemeBonus(g, 0, 'acc') === SCHEMES.airraid.off.pass.acc && schemeBonus(g, 1, 'acc') === 0, 'schemes: Air Raid passers play up on pass plays, the other side does not');
  g.call = { off: 'inside_run', def: 'base', o: 0 };
  check(schemeBonus(g, 0, 'blk') < 0, 'schemes: Air Raid gives up some push on runs');
  g.teams[1].coach = 'd46';
  g.call = { off: 'slant', def: 'nickel_blitz', o: 0 };
  check(schemeBonus(g, 1, 'rush') > 0, 'schemes: a 46 defense rushes harder on a blitz');
  g.call = { off: 'slant', def: 'cover3', o: 0 };
  check(schemeBonus(g, 1, 'cov') < 0, 'schemes: and covers a step slower otherwise');
  const groups = (scheme) => {
    let n = 0;
    for (const seed of [1, 2, 3, 4]) {
      const X = LG.createLeague({ seed, rounds: 24, scheme });
      while (X.phase === 'draft') { const c = LG.aiChoosePick(X); LG.makePick(X, c.id, c.slot); }
      const mine = X.picks.filter((p) => p.team === 0).slice(0, 8);
      n += mine.filter((p) => ['QB', 'WR'].includes(SLOT[p.slot]?.group)).length;
    }
    return n;
  };
  const air = groups('airraid'), ground = groups('ground');
  check(air > ground, `schemes: Air Raid auto-drafts more passers and receivers early (${air} vs ${ground} in the first 8 picks)`);
}

// ---------- Pokémon without a 3D model (league.js replaceRetired) ----------
{
  check(RETIRED.size > 0 && [...RETIRED].every((id) => !(id in MODEL_INDEX)), 'retired: every retired Pokémon is one without a model');
  const X = LG.createLeague({ seed: 77, rounds: 24 });
  check(LG.available(X).every((id) => id in MODEL_INDEX), 'retired: only Pokémon with a 3D model can be drafted');
  while (X.phase === 'draft') { const c = LG.aiChoosePick(X); LG.makePick(X, c.id, c.slot); }
  // An old save: two retired Pokémon on rosters, one a starter with a contract and growth.
  const [r1, r2] = [...RETIRED];
  const me = X.teams[0], them = X.teams[1];
  const slot = Object.keys(me.lineup)[0], was = me.lineup[slot];
  const put = (t, old, id) => {
    t.roster = t.roster.map((x) => (x === old ? id : x)); t.bench = t.bench.map((x) => (x === old ? id : x));
    for (const m of [t.slots, t.lineup]) for (const k of Object.keys(m)) if (m[k] === old) m[k] = id;
  };
  put(me, was, r1); put(them, them.roster[them.roster.length - 1], r2);
  X.contracts[r1] = { salary: 3, years: 2 }; X.growth[r1] = { spd: 2 };
  const game = newGame({ home: LG.teamForGame(me, X), away: LG.teamForGame(them, X), seed: 5 });
  const saved = JSON.parse(JSON.stringify({ league: X, game }));
  LG.migrateLeague(saved.league);
  LG.replaceRetiredInGame(saved.game, saved.league);
  const L2 = saved.league, all = L2.teams.flatMap((t) => t.roster);
  check(!all.some((id) => RETIRED.has(id)), 'retired: a saved league keeps no retired Pokémon on a roster');
  check(new Set(all).size === all.length, 'retired: their replacements are not on another roster');
  check(L2.teams.every((t, i) => t.roster.length === X.teams[i].roster.length), 'retired: rosters keep their size');
  const sub = L2.teams[0].lineup[slot];
  check(!RETIRED.has(sub) && L2.contracts[sub]?.salary === 3 && L2.growth[sub]?.spd === 2 && !(r1 in L2.contracts),
    'retired: the newcomer takes over the starter\'s slot, contract and growth');
  const gIds = saved.game.teams.flatMap((t) => [...t.roster, ...Object.values(t.lineup)]);
  check(!gIds.some((id) => RETIRED.has(id)) && saved.game.teams[0].lineup[slot] === sub && saved.game.teams[0].stats[sub],
    'retired: a game saved in progress swaps them for the same newcomers');
  LG.migrateLeague(L2);
  check(L2.teams[0].lineup[slot] === sub, 'retired: migrating twice changes nothing');
}

applyGrowth({});
console.log(`${checks - failures} of ${checks} checks passed in ${Date.now() - t0} ms`);
if (failures) { console.log(`${failures} failed`); process.exit(1); }
