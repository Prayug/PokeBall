// League: teams, snake draft with AI drafters, schedule, standings and leaders.
import { PLAYERS, ALL_IDS, RETIRED, SLOT, SLOT_KEYS, BASELINE, autoDepthChart, unitRatings } from './ratings.js';
import { bestMultiplier, matchupModifier, ABILITIES } from './types.js';
import { createGame, kickingUnit, simUntil, summary } from './engine.js';
import { SCHEMES, schemeDraft } from './coach.js';
import { coverSlot, healWeek, recordInjuries } from './injuries.js';
import { gameHeadline, weekInReview } from './weekly.js';
import { archiveSeason, ensureRecords, noteGame } from './records.js';
import { openFreeAgency } from './freeagency.js';
import { buildSchedule, firstRound, isFinalRound, makeDivisions, pairSeeds, playoffRounds, playoffSeeds, roundLabel } from './geometry.js';
import { makeTradeOffer, migrateTrades, pickOwner, weeklyTradeOffer } from './trades.js';

export const AI_TEAMS = [
  { name: 'Cerulean Surf', abbr: 'CER', color: '#2F6FD6', coach: 'speed', coachName: 'Speed Kills' },
  { name: 'Pewter Boulders', abbr: 'PEW', color: '#8A7A5C', coach: 'trench', coachName: 'Trench Builder' },
  { name: 'Saffron Seers', abbr: 'SAF', color: '#D9A21B', coach: 'balanced', coachName: 'Best Available' },
  { name: 'Vermilion Volts', abbr: 'VER', color: '#D8452F', coach: 'types', coachName: 'Type Stacker' },
  { name: 'Celadon Bloom', abbr: 'CEL', color: '#3E9B5A', coach: 'balanced', coachName: 'Best Available' },
  { name: 'Fuchsia Shadows', abbr: 'FUC', color: '#B03A8C', coach: 'speed', coachName: 'Speed Kills' },
  { name: 'Cinnabar Blaze', abbr: 'CIN', color: '#E0702A', coach: 'trench', coachName: 'Trench Builder' },
  { name: 'Lavender Haunts', abbr: 'LAV', color: '#7D5BB5', coach: 'types', coachName: 'Type Stacker' },
  { name: 'Viridian Rangers', abbr: 'VIR', color: '#2E7D6B', coach: 'balanced', coachName: 'Best Available' },
  // Bigger leagues (12 and 16 teams) draw from these too; an 8-team league only from the nine
  // above, so a seed (and a shared league code) builds the same league it always did.
  { name: 'Goldenrod Gears', abbr: 'GLD', color: '#C9A227', coach: 'trench', coachName: 'Trench Builder' },
  { name: 'Ecruteak Embers', abbr: 'ECR', color: '#B5482D', coach: 'types', coachName: 'Type Stacker' },
  { name: 'Olivine Tides', abbr: 'OLV', color: '#2A8FA8', coach: 'speed', coachName: 'Speed Kills' },
  { name: 'Mahogany Frost', abbr: 'MAH', color: '#6FA8C9', coach: 'balanced', coachName: 'Best Available' },
  { name: 'Blackthorn Wyverns', abbr: 'BLK', color: '#3B4A8F', coach: 'speed', coachName: 'Speed Kills' },
  { name: 'Azalea Swarm', abbr: 'AZA', color: '#7FA332', coach: 'trench', coachName: 'Trench Builder' },
];
const CLASSIC_TEAMS = 9;
export const MAX_TEAMS = AI_TEAMS.length + 1;

// Small seeded RNG for league-level randomness (draft noise, schedule).
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.state = () => a;
  return f;
}

export function createLeague({ teamName = 'Pallet Starters', abbr = 'PAL', rounds = 24, legendaries = false,
  typeCap = true, numTeams = 8, seed = Date.now(), userColor = '#C8102E', userPick = null, scheme = 'balanced' } = {}) {
  numTeams = Math.max(2, Math.min(MAX_TEAMS, numTeams));
  // A draft the pool can't fill drops to the shortest full roster (every starting slot).
  if (rounds > maxRounds(numTeams, legendaries)) rounds = SLOT_KEYS.length;
  const rng = makeRng(seed);
  const pool = AI_TEAMS.slice(0, numTeams <= CLASSIC_TEAMS + 1 ? CLASSIC_TEAMS : AI_TEAMS.length);
  const ai = [];
  while (ai.length < numTeams - 1) ai.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const teams = [
    { id: 0, name: teamName, abbr, color: userColor, coach: SCHEMES[scheme] ? scheme : 'balanced', coachName: 'You', user: true },
    ...ai.map((t, i) => ({ id: i + 1, ...t, user: false })),
  ];
  for (const t of teams) {
    t.roster = []; t.slots = {}; t.lineup = {}; t.bench = [];
    if (t.coach === 'types') t.favTypes = pickFavTypes(rng);
  }
  // Draft order: random, user position optional.
  const order = teams.map((t) => t.id);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (userPick != null) { order.splice(order.indexOf(0), 1); order.splice(userPick, 0, 0); }
  const picks = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? order : [...order].reverse();
    for (const id of row) picks.push({ round: r + 1, team: id, player: null, slot: null });
  }
  return {
    version: 2, seed, rngState: rng.state(), settings: { rounds, legendaries, typeCap, numTeams },
    teams, divisions: makeDivisions(numTeams), picks, pickIndex: 0, phase: 'draft', week: 0, schedule: [], results: [], playoffs: null, champion: null,
    seasonStats: {}, season: 1, history: [], growth: {}, condition: {}, rookies: [], trade: null, offseason: null,
    injuries: {}, weekly: [],
    contracts: {}, cap: null, fa: null, careers: {}, careerSeason: 0, hof: [], records: {}, meetings: [],
    pickOwners: {}, tradeLog: [],
  };
}

// The longest draft the pool can fill: every team drafts a full roster with some Pokémon left
// over for free agency and the rookie drafts (16 teams can't all draft 28 without legendaries).
export function maxRounds(numTeams, legendaries) {
  const pool = ALL_IDS.filter((id) => legendaries || !PLAYERS[id].legendary).length;
  return Math.floor((pool * 0.94) / numTeams);
}

// Brings older saves up to the current league shape.
export function migrateLeague(L) {
  if (!L) return L;
  if ((L.version ?? 1) < 2) {
    L.season ??= 1; L.history ??= []; L.growth ??= {}; L.condition ??= {}; L.rookies ??= [];
    L.trade ??= null; L.offseason ??= null;
    L.version = 2;
  }
  L.injuries ??= {}; L.weekly ??= [];
  // Free agency and career records arrived within version 2: fill them in where missing.
  L.contracts ??= {}; L.cap ??= null; L.fa ??= null;
  // Bigger leagues and trade desk 2.0 arrived within version 2 as well.
  if (L.divisions === undefined) L.divisions = makeDivisions(L.teams.length);
  if (L.playoffs && !L.playoffs.rounds) {
    const P = L.playoffs, s = P.seeds;
    P.byes = [];
    P.rounds = [[{ home: s[0], away: s[3] }, { home: s[1], away: s[2] }]];
    if (P.round >= 1) P.rounds.push(P.games);
  }
  migrateTrades(L);
  ensureRecords(L);
  replaceRetired(L);
  return L;
}

// Pokémon without a 3D model left the game. A saved league that has one on a roster gets the
// closest free Pokémon in its place: the same primary type where one is free, then the nearest
// overall at the slot it plays. The newcomer takes over its slot, depth chart spot, contract,
// condition and growth; the retired one's stats and records stay under its own name.
export function replaceRetired(L) {
  if (!L?.teams) return [];
  const swaps = [];
  for (const t of L.teams) {
    for (const old of t.roster.filter((id) => RETIRED.has(id))) {
      const p = PLAYERS[old];
      const slot = Object.keys(t.lineup ?? {}).find((k) => t.lineup[k] === old)
        ?? Object.keys(t.slots ?? {}).find((k) => t.slots[k] === old) ?? p.best[0];
      const free = available(L).filter((id) => p.legendary || !PLAYERS[id].legendary);
      const pool = free.length ? free : available(L);
      if (!pool.length) continue;
      const cost = (id) => Math.abs(PLAYERS[id].ovr[slot] - p.ovr[slot]) + (PLAYERS[id].types[0] === p.types[0] ? 0 : 6);
      const id = pool.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      const swap = (x) => (x === old ? id : x);
      t.roster = t.roster.map(swap);
      t.bench = (t.bench ?? []).map(swap);
      for (const m of [t.slots, t.lineup]) if (m) for (const k of Object.keys(m)) m[k] = swap(m[k]);
      if (L.offseason?.cuts?.[t.id]) L.offseason.cuts[t.id] = L.offseason.cuts[t.id].map(swap);
      for (const m of [L.contracts, L.condition, L.growth, L.injuries]) {
        if (m && old in m) { m[id] = m[old]; delete m[old]; }
      }
      if (L.rookies) L.rookies = L.rookies.map(swap);
      swaps.push({ team: t.id, out: old, in: id });
    }
  }
  if (swaps.length && L.trade && swaps.some((s) => [...L.trade.get, ...L.trade.send].includes(s.out))) L.trade = null;
  if (swaps.length) L.retiredSwaps = [...(L.retiredSwaps ?? []), ...swaps];
  return swaps;
}

// The same for a game saved in progress: each retired Pokémon on a side is replaced by the one
// its league team took in its place, or else (a quick game) the closest Pokémon on neither side.
export function replaceRetiredInGame(g, L = null) {
  if (!g?.teams) return g;
  const inGame = new Set(g.teams.flatMap((s) => s.roster ?? []));
  for (const side of g.teams) {
    for (const old of (side.roster ?? []).filter((id) => RETIRED.has(id))) {
      let id = (L?.retiredSwaps ?? []).find((s) => s.out === old && s.team === side.id)?.in;
      if (id == null || inGame.has(id)) {
        const p = PLAYERS[old], k = p.best[0];
        const pool = ALL_IDS.filter((x) => !inGame.has(x) && (p.legendary || !PLAYERS[x].legendary));
        id = pool.reduce((a, b) => (Math.abs(PLAYERS[b].ovr[k] - p.ovr[k]) < Math.abs(PLAYERS[a].ovr[k] - p.ovr[k]) ? b : a));
      }
      inGame.add(id);
      const swap = (x) => (x === old ? id : x);
      side.roster = side.roster.map(swap);
      side.bench = (side.bench ?? []).map(swap);
      for (const m of [side.starters, side.lineup]) if (m) for (const k of Object.keys(m)) m[k] = swap(m[k]);
      for (const m of [side.energy, side.locks, side.out, side.stats]) {
        if (m && old in m) { m[id] = m[old]; delete m[old]; }
      }
    }
  }
  return g;
}

// Box scores are most of a save's size (about 130 KB a season). Keep them for the current and
// last season and drop older ones, leaving the score and quarters of every game. Covers this
// season's results and any game lists archived in the league's history.
export const BOX_SEASONS = 2;
export function trimBoxScores(L, keep = BOX_SEASONS) {
  if (!L) return 0;
  const cur = L.season ?? 1;
  let n = 0;
  const lists = [[L.results, cur], ...(L.history ?? []).map((h) => [h.results ?? h.games, h.season])];
  for (const [list, season] of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) if (r.box && (r.season ?? season ?? 0) <= cur - keep) { delete r.box; n++; }
  }
  return n;
}

function pickFavTypes(rng) {
  const options = ['Water', 'Fire', 'Electric', 'Psychic', 'Dragon', 'Steel', 'Ground', 'Fighting', 'Dark', 'Rock', 'Flying', 'Ghost'];
  const a = options[Math.floor(rng() * options.length)];
  let b = a;
  while (b === a) b = options[Math.floor(rng() * options.length)];
  return [a, b];
}

export function leagueRng(L) {
  const r = makeRng(L.rngState);
  return { r, save: () => { L.rngState = r.state(); } };
}

export function available(L) {
  const taken = new Set(L.teams.flatMap((t) => t.roster));
  return ALL_IDS.filter((id) => !taken.has(id) && (L.settings.legendaries || !PLAYERS[id].legendary));
}

// Why a Pokémon can't be drafted by this team right now (or null).
export function blockReason(L, team, id) {
  const p = PLAYERS[id];
  if (L.settings.typeCap) {
    const same = team.roster.filter((x) => PLAYERS[x].types[0] === p.types[0]).length;
    if (same >= 4) return `Already 4 ${p.types[0]} types`;
  }
  return null;
}

export function openSlots(team) { return SLOT_KEYS.filter((k) => team.slots[k] == null); }

// The open slot where this Pokémon adds the most value.
export function bestOpenSlot(team, id) {
  const open = openSlots(team);
  if (!open.length) return 'BENCH';
  return open.reduce((a, b) => (slotValue(id, b) > slotValue(id, a) ? b : a));
}
function slotValue(id, slot) { return SLOT[slot].value * (PLAYERS[id].ovr[slot] - BASELINE[slot]); }

export function currentPick(L) { return L.picks[L.pickIndex] ?? null; }

export function makePick(L, id, slot) {
  const pk = currentPick(L);
  const team = L.teams[pk.team];
  slot = slot ?? bestOpenSlot(team, id);
  pk.player = id; pk.slot = slot;
  team.roster.push(id);
  if ((L.season ?? 1) > 1) (L.rookies ??= []).push(id);
  if (slot === 'BENCH') team.bench.push(id); else team.slots[slot] = id;
  L.pickIndex++;
  if (L.pickIndex >= L.picks.length) finishDraft(L);
  return pk;
}

export function aiChoosePick(L, teamId = currentPick(L).team) {
  const team = L.teams[teamId];
  const { r, save } = leagueRng(L);
  const open = openSlots(team);
  const picksLeft = L.picks.slice(L.pickIndex).filter((p) => p.team === teamId).length;
  let best = null;
  for (const id of available(L)) {
    if (blockReason(L, team, id)) continue;
    const p = PLAYERS[id];
    let score, slot;
    if (open.length) {
      slot = open.reduce((a, b) => (slotValue(id, b) > slotValue(id, a) ? b : a));
      score = slotValue(id, slot);
      // Don't leave a slot unfilled: urgency when picks run short.
      if (picksLeft <= open.length) score += 5;
    } else {
      slot = 'BENCH';
      score = Math.max(...SLOT_KEYS.map((k) => PLAYERS[id].ovr[k] - PLAYERS[team.slots[k]].ovr[k] * 0.9));
    }
    const S = slot === 'BENCH' ? null : SLOT[slot];
    if (team.coach === 'speed' && S && ['WR', 'CB', 'RB', 'S'].includes(S.group)) score += (p.attrs.spd - 70) * 0.25;
    if (team.coach === 'trench' && S && ['OL', 'DL'].includes(S.group)) score += 4;
    if (team.coach === 'types' && team.favTypes.some((t) => p.types.includes(t))) score += 5;
    if (S) score += schemeDraft(team.coach, S.group);
    score += (r() - 0.5) * 6;
    if (!best || score > best.score) best = { id, slot, score };
  }
  save();
  return best;
}

export function finishDraft(L) {
  // The random state as the first draft ended: a shared league (share.js) rebuilds the same
  // schedule and trade offer from it.
  if ((L.season ?? 1) === 1) L.draftRng = L.rngState;
  for (const t of L.teams) {
    const { lineup, bench } = autoDepthChart(t.roster);
    // Keep the drafter's slot choices when they fill every slot; otherwise fall back.
    const drafted = SLOT_KEYS.every((k) => t.slots[k] != null);
    t.lineup = drafted && t.user ? { ...t.slots } : lineup;
    t.bench = t.roster.filter((id) => !Object.values(t.lineup).includes(id));
    if (!t.user) { t.lineup = lineup; t.bench = bench; }
  }
  L.phase = 'grades';
  L.schedule = buildSchedule(L, leagueRng(L));
  L.week = 0;
  L.trade = makeTradeOffer(L);
}

// Letter grades by unit relative to the league.
export function draftGrades(L) {
  const units = L.teams.map((t) => unitRatings(t.lineup));
  const keys = Object.keys(units[0]);
  const grades = L.teams.map(() => ({}));
  for (const k of keys) {
    const vals = units.map((u) => u[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    vals.forEach((v, i) => { grades[i][k] = { value: Math.round(v), grade: letter((v - mean) / sd) }; });
  }
  return grades;
}
function letter(z) {
  const scale = [[1.4, 'A+'], [0.9, 'A'], [0.5, 'B+'], [0.15, 'B'], [-0.2, 'C+'], [-0.55, 'C'], [-0.9, 'D'], [-Infinity, 'F']];
  return scale.find(([t]) => z >= t)[1];
}

// Game-day side. With a league, injured players sit (the bench covers them, or with no bench
// a starter from the other side of the ball plays both ways), players who are out sore sit
// when the bench can cover them, and sore players start below full energy.
export function teamForGame(t, L = null) {
  const side = { id: t.id, name: t.name, abbr: t.abbr, color: t.color, coach: t.coach, kit: t.kit ?? null, lineup: { ...t.lineup }, bench: [...t.bench] };
  const cond = L?.condition;
  if (!cond) return side;
  const hurt = (id) => !!L.injuries?.[id];
  for (const k of SLOT_KEYS) {
    if (!hurt(side.lineup[k])) continue;
    const bench = side.bench.filter((id) => !hurt(id) && !cond[id]?.out && !Object.values(side.lineup).includes(id));
    const sub = coverSlot(side.lineup, bench, k, (id) => hurt(id) || !!cond[id]?.out);
    if (sub != null) side.lineup[k] = sub;
  }
  let bench = side.bench.filter((id) => !cond[id]?.out && !hurt(id) && !Object.values(side.lineup).includes(id));
  for (const k of SLOT_KEYS) {
    if (!cond[side.lineup[k]]?.out || !bench.length) continue;
    const sub = bench.reduce((a, b) => (PLAYERS[b].ovr[k] > PLAYERS[a].ovr[k] ? b : a));
    side.lineup[k] = sub;
    bench = bench.filter((x) => x !== sub);
  }
  side.bench = bench;
  side.energy = {};
  for (const id of [...Object.values(side.lineup), ...bench]) if (cond[id]?.energy != null) side.energy[id] = cond[id].energy;
  return side;
}

export const OUT_BELOW = 12, MAX_OUT = 2;
// Next week's starting energy from where a Pokémon finished the game.
function nextCondition(energy, canSit) {
  if (energy < OUT_BELOW && canSit) return { out: true, energy: 50 };
  const next = Math.round(Math.min(100, 60 + energy * 0.5));
  return next < 95 ? { energy: next } : null;
}

export function newGameSeed(L) {
  const { r, save } = leagueRng(L);
  const s = Math.floor(r() * 2 ** 31);
  save();
  return s;
}

export function startLeagueGame(L, home, away, playoff = false, liveKicks = false) {
  return createGame({ home: teamForGame(L.teams[home], L), away: teamForGame(L.teams[away], L), seed: newGameSeed(L), playoff, injuries: true, liveKicks });
}

const compactStats = (stats) => Object.fromEntries(Object.entries(stats)
  .map(([id, s]) => [id, Object.fromEntries(Object.entries(s).filter(([, v]) => v))])
  .filter(([, s]) => Object.keys(s).length));

// Touchdowns, field goals and safeties, with the extra point folded into the touchdown line.
export function scoringPlays(g) {
  const out = [];
  g.log.forEach((e, i) => {
    const next = g.log[i + 1];
    const xp = next && next.kind === 'score' && next.text.startsWith('Extra point');
    if (!['td', 'fg', 'safety'].includes(e.highlight) && !(e.kind === 'kick' && xp)) return;
    out.push({ q: e.q, clock: e.clock, team: e.highlight === 'safety' ? 1 - e.poss : e.poss, text: xp ? `${e.text} ${next.text}` : e.text });
  });
  return out;
}

export function recordResult(L, g, meta) {
  const sm = summary(g);
  L.results.push({ ...meta, season: L.season ?? 1, home: g.teams[0].id, away: g.teams[1].id, score: sm.score, winner: sm.winner == null ? null : g.teams[sm.winner].id,
    quarters: sm.quarters, weather: sm.weather,
    box: { stats: g.teams.map((t) => compactStats(t.stats)), team: g.teams.map((t) => ({ ...t.team, third: [...t.team.third] })), scoring: scoringPlays(g) },
    injuries: (g.injuries ?? []).map((i) => ({ id: i.id, team: i.team, weeks: i.weeks })) });
  L.results[L.results.length - 1].headline = gameHeadline(L, L.results[L.results.length - 1]);
  L.condition ??= {};
  for (const [ti, t] of g.teams.entries()) {
    const played = new Set(t.roster);
    // Only the most worn-out few sit; the rest come back sore.
    const sit = new Set(t.roster.filter((id) => !t.out?.[id] && (t.energy[id] ?? 100) < OUT_BELOW)
      .sort((a, b) => t.energy[a] - t.energy[b]).slice(0, MAX_OUT));
    for (const id of t.roster) {
      const c = nextCondition(t.energy[id] ?? 100, sit.has(id));
      if (c) L.condition[id] = c; else delete L.condition[id];
    }
    for (const id of L.teams[g.teams[ti].id].roster) {
      if (!played.has(id) && L.condition[id]?.out) L.condition[id] = { energy: 85 };
    }
  }
  recordInjuries(L, g, meta);
  for (const t of g.teams) {
    for (const [id, s] of Object.entries(t.stats)) {
      const agg = (L.seasonStats[id] ??= { team: t.id });
      for (const [k, v] of Object.entries(s)) {
        if (k === 'rlong' || k === 'rclong') agg[k] = Math.max(agg[k] ?? 0, v);
        else agg[k] = (agg[k] ?? 0) + v;
      }
      agg.gp = (agg.gp ?? 0) + 1;
    }
  }
  noteGame(L, L.results[L.results.length - 1]);
}

export function simWeekOthers(L, skipTeam = 0) {
  for (const gm of L.schedule[L.week] ?? []) {
    if (gm.home === skipTeam || gm.away === skipTeam) continue;
    const g = startLeagueGame(L, gm.home, gm.away);
    simUntil(g, 'game');
    recordResult(L, g, { week: L.week });
  }
}

export function userGame(L) {
  return (L.schedule[L.week] ?? []).find((gm) => gm.home === 0 || gm.away === 0) ?? null;
}

export function standings(L) {
  const rows = L.teams.map((t) => ({ id: t.id, w: 0, l: 0, t: 0, pf: 0, pa: 0 }));
  for (const r of L.results) {
    if (r.playoff) continue;
    const h = rows[r.home], a = rows[r.away];
    h.pf += r.score[0]; h.pa += r.score[1]; a.pf += r.score[1]; a.pa += r.score[0];
    if (r.winner == null) { h.t++; a.t++; } else if (r.winner === r.home) { h.w++; a.l++; } else { a.w++; h.l++; }
  }
  return rows.sort((x, y) => (y.w + y.t / 2) - (x.w + x.t / 2) || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf);
}

// A team's season so far: its regular-season record and points, and how far it went (finish 0
// while that is still open, 1 missed the playoffs, 2 lost a semifinal, 3 lost the championship,
// 4 champions, 5 lost in the first round of a bigger league's bracket: a wild card game or a
// quarterfinal). The numbers aren't in order of merit (5 came later); FINISH_RANK orders them.
// With upTo, only its first upTo regular-season games count.
export function teamSeason(L, id, upTo = Infinity) {
  const s = { gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, finish: 0 };
  for (const r of L.results) {
    if (r.playoff || (r.home !== id && r.away !== id) || s.gp >= upTo) continue;
    const i = r.home === id ? 0 : 1;
    s.gp++; s.pf += r.score[i]; s.pa += r.score[1 - i];
    if (r.winner == null) s.t++; else if (r.winner === id) s.w++; else s.l++;
  }
  if (upTo < Infinity) return s;
  const lost = L.results.find((r) => r.playoff && (r.home === id || r.away === id) && r.winner !== id);
  if (L.champion === id) s.finish = 4;
  else if (lost) s.finish = isFinalRound(L, lost.round) ? 3 : playoffRounds(L) - 1 - lost.round === 1 ? 2 : 5;
  else if (L.playoffs && !L.playoffs.seeds.includes(id)) s.finish = 1;
  return s;
}

export const FINISH_RANK = [0, 1, 3, 4, 5, 2];

export function advanceWeek(L) {
  weekInReview(L, { week: L.week });
  healWeek(L);
  L.week++;
  if (L.week >= L.schedule.length) {
    const seeds = playoffSeeds(L, standings(L));
    const { byes, games } = firstRound(L, seeds);
    L.phase = 'playoffs';
    if (L.trade?.status === 'open') L.trade.status = 'expired';
    L.playoffs = { round: 0, games, seeds, byes, rounds: [games], final: null };
  } else {
    weeklyTradeOffer(L);
  }
}

// After a playoff round: the winners (and any teams on a bye) reseed, highest left hosting the
// lowest, until one is left.
export function advancePlayoffs(L) {
  const P = L.playoffs;
  weekInReview(L, { playoff: true, round: P.round });
  healWeek(L);
  const winners = L.results.filter((r) => r.playoff && r.round === P.round).map((r) => r.winner);
  const alive = [...(P.round === 0 ? P.byes ?? [] : []), ...winners];
  if (isFinalRound(L, P.round) || alive.length < 2) {
    L.champion = winners[0];
    L.phase = 'done';
  } else {
    P.round++;
    P.games = pairSeeds(alive, P.seeds);
    P.rounds.push(P.games);
  }
}

export function leaders(L) {
  const rows = Object.entries(L.seasonStats).map(([id, s]) => ({ id: Number(id), ...s }));
  const top = (k, n = 5) => rows.filter((r) => (r[k] ?? 0) > 0).sort((a, b) => b[k] - a[k]).slice(0, n);
  return {
    'Passing yards': top('py'), 'Rushing yards': top('ry'), 'Receiving yards': top('rcy'),
    Sacks: top('dsk'), Interceptions: top('dint'), Tackles: top('tk'),
  };
}

// How many Pokémon on rival rosters this one is super effective against.
export function rivalEdge(L, id) {
  const p = PLAYERS[id];
  let n = 0, total = 0;
  for (const t of L.teams) {
    if (t.user) continue;
    for (const x of t.roster) { total++; if (bestMultiplier(p, PLAYERS[x]) > 1) n++; }
  }
  return { n, total };
}

// ---------- matchups and scouting ----------

// The one-on-ones the engine resolves: [offense slot, defense slot, group].
export const MATCHUP_PAIRS = [
  ['LT', 'LE', 'trench'], ['LG', 'DT1', 'trench'], ['C', 'MLB', 'trench'], ['RG', 'DT2', 'trench'], ['RT', 'DE', 'trench'], ['TE', 'OLB', 'trench'],
  ['WR1', 'CB1', 'cover'], ['WR2', 'CB2', 'cover'], ['WR3', 'CB3', 'cover'], ['TE', 'SS', 'cover'],
];

// Type matchups for one offense against one defense. net > 0 favours the offense.
export function matchups(offLineup, defLineup) {
  return MATCHUP_PAIRS.filter(([o, d]) => offLineup[o] != null && defLineup[d] != null).map(([oSlot, dSlot, group]) => {
    const oId = offLineup[oSlot], dId = defLineup[dSlot];
    const oMult = bestMultiplier(PLAYERS[oId], PLAYERS[dId]), dMult = bestMultiplier(PLAYERS[dId], PLAYERS[oId]);
    return { group, oSlot, oId, dSlot, dId, oMult, dMult, net: matchupModifier(oMult) - matchupModifier(dMult) };
  });
}

const COACH_NOTES = {
  speed: 'Speed Kills: takes more deep shots and plays more man press.',
  trench: 'Trench Builder: runs inside more and blitzes more often.',
  types: 'Type Stacker: drafted for its favorite types.',
  balanced: 'Best Available: no strong lean.',
  ...Object.fromEntries(Object.entries(SCHEMES).filter(([k]) => k !== 'balanced').map(([k, s]) => [k, `${s.name}: ${s.blurb}`])),
};

// Pre-game report for the user's next opponent.
export function scoutReport(L, myId, oppId) {
  const me = teamForGame(L.teams[myId], L), opp = teamForGame(L.teams[oppId], L);
  const edges = [
    ...matchups(me.lineup, opp.lineup).map((m) => ({ ...m, mine: 'off', edge: m.net })),
    ...matchups(opp.lineup, me.lineup).map((m) => ({ ...m, mine: 'def', edge: -m.net })),
  ];
  const best = edges.filter((e) => e.edge > 0).sort((a, b) => b.edge - a.edge).slice(0, 3);
  const worst = edges.filter((e) => e.edge < 0).sort((a, b) => a.edge - b.edge).slice(0, 3);
  const weather = [];
  for (const [side, t] of [['you', me], ['them', opp]]) {
    for (const id of Object.values(t.lineup)) {
      const w = ABILITIES[PLAYERS[id].ability]?.weather;
      if (w) weather.push({ side, id, weather: w });
    }
  }
  const mu = unitRatings(me.lineup), ou = unitRatings(opp.lineup);
  const sum = (group) => edges.filter((e) => e.mine === 'off' && e.group === group).reduce((s, e) => s + e.edge, 0) * 50;
  const pass = mu.passOff - ou.coverage + sum('cover'), run = mu.runOff - ou.runDef + sum('trench');
  const lean = pass > run + 2 ? 'Attack through the air.' : run > pass + 2 ? 'Lean on the run game.' : 'Stay balanced.';
  let plan = 'No type edges either way, so this one comes down to raw ratings.';
  const top = best[0];
  if (top) {
    const [mySlot, myP, theirSlot, theirP] = top.mine === 'off' ? [top.oSlot, top.oId, top.dSlot, top.dId] : [top.dSlot, top.dId, top.oSlot, top.oId];
    plan = `Their ${theirSlot} ${PLAYERS[theirP].name} is ${PLAYERS[theirP].types.join('/')}; your ${mySlot} ${PLAYERS[myP].name} (${PLAYERS[myP].types.join('/')}) wins that battle.`;
  }
  const cond = L.condition ?? {};
  const inj = L.injuries ?? {};
  const health = L.teams[myId].roster.filter((id) => cond[id] || inj[id]).map((id) => ({ id, ...cond[id], injury: inj[id] ?? null }));
  const theirHurt = L.teams[oppId].roster.filter((id) => inj[id] && Object.values(L.teams[oppId].lineup).includes(id)).map((id) => ({ id, ...inj[id] }));
  const kicking = { me: kickingUnit(me.lineup), opp: kickingUnit(opp.lineup) };
  return { me, opp, best, worst, weather, plan, lean, health, theirHurt, kicking, coachNote: COACH_NOTES[L.teams[oppId].coach] ?? '' };
}

// ---------- awards, bracket ----------

const n = (v) => v ?? 0;
const offScore = (s) => n(s.py) * 0.04 + n(s.ptd) * 4 - n(s.pint) * 2 + (n(s.ry) + n(s.rcy)) * 0.1 + (n(s.rtd) + n(s.rctd)) * 6;
const defScore = (s) => n(s.tk) + 4 * n(s.dsk) + 5 * n(s.dint) + 3 * n(s.ff) + 1.5 * n(s.pd);
export const impact = (s) => offScore(s) + defScore(s);

export function statLine(s) {
  const parts = [];
  if (n(s.pa) > 0) parts.push(`${n(s.py)} pass yds, ${n(s.ptd)} TD, ${n(s.pint)} INT`);
  if (n(s.ry) >= 100) parts.push(`${n(s.ry)} rush yds, ${n(s.rtd)} TD`);
  if (n(s.rcy) >= 100) parts.push(`${n(s.rc)} rec, ${n(s.rcy)} yds, ${n(s.rctd)} TD`);
  if (defScore(s) >= 15) parts.push(`${n(s.tk)} tkl, ${n(s.dsk)} sacks, ${n(s.dint)} INT`);
  return parts.join(' · ') || `${n(s.tk)} tackles`;
}

export function awards(L) {
  const rows = Object.entries(L.seasonStats).map(([id, s]) => ({ id: Number(id), s }));
  if (!rows.length) return [];
  const st = standings(L);
  const pct = Object.fromEntries(st.map((r) => [r.id, (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t)]));
  const pick = (list, f) => list.reduce((a, b) => (f(b.s) > f(a.s) ? b : a), list[0]);
  const team = (r) => r.s.team;
  const out = [];
  const mvp = pick(rows, (s) => (offScore(s) + defScore(s)) * (0.7 + 0.6 * (pct[s.team] ?? 0)));
  out.push({ key: 'mvp', label: 'Most valuable player', id: mvp.id, team: team(mvp), line: statLine(mvp.s) });
  const opoy = pick(rows, offScore);
  out.push({ key: 'opoy', label: 'Offensive player of the year', id: opoy.id, team: team(opoy), line: statLine(opoy.s) });
  const dpoy = pick(rows, defScore);
  out.push({ key: 'dpoy', label: 'Defensive player of the year', id: dpoy.id, team: team(dpoy), line: statLine(dpoy.s) });
  const rookies = rows.filter((r) => (L.rookies ?? []).includes(r.id));
  if (rookies.length) {
    const roy = pick(rookies, (s) => offScore(s) + defScore(s));
    out.push({ key: 'roy', label: 'Rookie of the year', id: roy.id, team: team(roy), line: statLine(roy.s) });
  }
  return out;
}

// Every playoff round with scores where played, and the rounds still to come as open slots.
// semis and final are the last two rounds.
export function bracket(L) {
  const P = L.playoffs;
  if (!P) return null;
  const s = P.seeds;
  const res = (round, a, b) => L.results.find((r) => r.playoff && r.round === round && [r.home, r.away].includes(a) && [r.home, r.away].includes(b));
  const game = (round, home, away) => {
    const r = home != null && away != null ? res(round, home, away) : null;
    const score = (id) => (r ? (r.home === id ? r.score[0] : r.score[1]) : null);
    return { home, away, homeScore: score(home), awayScore: score(away), winner: r?.winner ?? null, seeds: [s.indexOf(home) + 1, s.indexOf(away) + 1] };
  };
  const total = playoffRounds(L);
  const rounds = [];
  let size = (s.length - (P.byes?.length ?? 0)) / 2;
  for (let i = 0; i < total; i++) {
    const played = P.rounds[i];
    const games = played ? played.map((g) => game(i, g.home, g.away)) : Array.from({ length: size }, () => game(i, null, null));
    rounds.push({ round: i, name: roundLabel(L, i, true), games, byes: i === 0 ? P.byes ?? [] : [] });
    size = Math.max(1, (games.length + (i === 0 ? P.byes?.length ?? 0 : 0)) / 2);
  }
  return { rounds, semis: rounds[total - 2]?.games ?? [], final: rounds[total - 1].games[0], champion: L.champion };
}

// How far a team went: 'champion', the round it lost in, or null when it missed the playoffs.
export function playoffExit(L, id) {
  if (L.champion === id) return 'champion';
  const B = bracket(L);
  if (!B || !B.rounds.some((r) => r.byes.includes(id) || r.games.some((g) => g.home === id || g.away === id))) return null;
  const lost = B.rounds.find((r) => r.games.some((g) => g.winner != null && (g.home === id || g.away === id) && g.winner !== id));
  return lost ? lost.round : 'alive';
}

// ---------- trades ----------

export function teamStrength(ids) {
  const { lineup } = autoDepthChart(ids);
  return SLOT_KEYS.reduce((s, k) => s + (lineup[k] != null ? SLOT[k].value * PLAYERS[lineup[k]].ovr[k] : 0), 0);
}
export function aiLikes(team, id) {
  const p = PLAYERS[id];
  const grp = SLOT[p.best[0]].group;
  if (team.coach === 'types' && team.favTypes?.some((t) => p.types.includes(t))) return 6;
  if (team.coach === 'speed' && p.attrs.spd >= 85 && ['WR', 'CB', 'RB', 'S'].includes(grp)) return 5;
  if (team.coach === 'trench' && ['OL', 'DL'].includes(grp)) return 5;
  return 0;
}

// ---------- offseason ----------

export const CUTS = 4;
export const GROWTH_CAP = 16;
export const SNAPS_PER_POINT = 180;

// Keep-value for a rostered Pokémon; the lowest values get cut.
export function keepValue(team, id) {
  const p = PLAYERS[id];
  const slot = Object.keys(team.lineup).find((k) => team.lineup[k] === id);
  let v = slot ? 100 + SLOT[slot].value * p.ovr[slot] : 0.5 * p.ovr[p.best[0]];
  if (slot) v -= SLOT[slot].value * BASELINE[slot] * 0.3;
  return v + aiLikes(team, id);
}
export function suggestCuts(team, count = CUTS) {
  return team.roster.slice().sort((a, b) => keepValue(team, a) - keepValue(team, b)).slice(0, Math.min(count, team.roster.length));
}

// Close the season: archive it, run training camp, and propose cuts.
export function startOffseason(L) {
  if (L.phase !== 'done') return;
  const st = standings(L);
  const aw = awards(L);
  const hof = archiveSeason(L, { awards: aw, standings: st, champion: L.champion });
  // The user's first season is kept whole: a challenge code carries it (see share.js).
  if ((L.season ?? 1) === 1) { const me = L.teams.find((t) => t.user); if (me) L.firstSeason = teamSeason(L, me.id); }
  L.history.push({ season: L.season, champion: L.champion, awards: aw, records: st.map((r) => ({ id: r.id, w: r.w, l: r.l, t: r.t })), hof: hof.map((h) => h.id) });
  const growth = { ...L.growth };
  const camp = [];
  for (const [key, s] of Object.entries(L.seasonStats)) {
    const id = Number(key);
    const team = L.teams.find((t) => t.roster.includes(id));
    if (!team) continue;
    const p = PLAYERS[id];
    const g = { ...(growth[id] ?? {}) };
    const used = Object.values(g).reduce((a, b) => a + b, 0);
    let pts = Math.min(4, Math.floor(n(s.sn) / SNAPS_PER_POINT), Math.floor((GROWTH_CAP - used) / 2));
    if (pts <= 0) continue;
    const slot = Object.keys(team.lineup).find((k) => team.lineup[k] === id) ?? p.best[0];
    const order = Object.entries(SLOT[slot].w).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const gains = {};
    for (let i = 0; pts > 0 && i < order.length * 3; i++) {
      const k = order[i % order.length];
      if (p.attrs[k] + (gains[k] ?? 0) + 2 > 99) continue;
      gains[k] = (gains[k] ?? 0) + 2; pts--;
    }
    if (!Object.keys(gains).length) continue;
    for (const [k, v] of Object.entries(gains)) g[k] = (g[k] ?? 0) + v;
    growth[id] = g;
    camp.push({ id, team: team.id, slot, gains });
  }
  L.growth = growth;
  L.offseason = { camp, cuts: Object.fromEntries(L.teams.map((t) => [t.id, suggestCuts(t)])) };
  L.phase = 'offseason';
}

// Apply cuts and open free agency; the rookie draft follows it.
export function finishOffseason(L, userCuts) {
  if (L.phase !== 'offseason') return;
  // Remember who cut whom for the free agent pool.
  const cutBy = {};
  L.contracts ??= {};
  for (const t of L.teams) {
    const cuts = new Set(t.user && userCuts?.length === Math.min(CUTS, t.roster.length) ? userCuts : L.offseason.cuts[t.id]);
    for (const id of cuts) { cutBy[id] = t.id; delete L.contracts[id]; }
    t.roster = t.roster.filter((id) => !cuts.has(id));
    t.bench = t.bench.filter((id) => !cuts.has(id));
    for (const k of Object.keys(t.lineup)) if (cuts.has(t.lineup[k])) delete t.lineup[k];
    t.slots = { ...t.lineup };
  }
  if ((L.season ?? 1) === 1 && !L.firstDraft) {
    L.firstDraft = { picks: L.picks.slice(0, L.pickIndex).map((p) => [p.player, p.slot]), rng: L.draftRng ?? null };
  }
  L.season++;
  L.picks = []; L.pickIndex = 0; L.week = 0; L.schedule = []; L.results = []; L.seasonStats = {};
  L.playoffs = null; L.champion = null; L.condition = {}; L.rookies = []; L.trade = null; L.offseason = null;
  L.injuries = {}; L.weekly = [];
  openFreeAgency(L, cutBy);
}

// Rookie draft order: worst record first, the champion last.
export function rookieOrder(L) {
  const last = L.history[L.history.length - 1];
  const order = last.records.map((r) => r.id).reverse();
  const champ = order.indexOf(last.champion);
  if (champ >= 0) { order.splice(champ, 1); order.push(last.champion); }
  return order;
}

// After free agency: a snake rookie draft that fills every roster back to full. A team that
// signed free agents has fewer picks and sits out the later rounds. Picks traded during the
// season move the slot: the new owner uses it, and every team still makes exactly as many
// picks as it has open spots (its earliest ones; a team that traded picks away makes up the
// rest at the end of the draft).
export function openRookieDraft(L) {
  const order = rookieOrder(L);
  const need = Object.fromEntries(L.teams.map((t) => [t.id, Math.max(0, L.settings.rounds - t.roster.length)]));
  const rounds = Math.max(0, ...Object.values(need));
  const made = Object.fromEntries(L.teams.map((t) => [t.id, 0]));
  L.picks = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? order : [...order].reverse();
    for (const from of row) {
      const team = pickOwner(L, L.season, r + 1, from);
      if (made[team] >= need[team]) continue;
      made[team]++;
      L.picks.push({ round: r + 1, team, player: null, slot: null, ...(team !== from ? { from } : {}) });
    }
  }
  for (let r = rounds; L.teams.some((t) => made[t.id] < need[t.id]); r++) {
    for (const id of order) if (made[id] < need[id]) { made[id]++; L.picks.push({ round: r + 1, team: id, player: null, slot: null }); }
  }
  L.pickOwners = Object.fromEntries(Object.entries(L.pickOwners ?? {}).filter(([k]) => !k.startsWith(`${L.season}:`)));
  L.pickIndex = 0; L.phase = 'draft';
  if (!L.picks.length) finishDraft(L);
}

// Quick game: two AI-drafted rosters.
export function quickRosters(seed, legendaries = false) {
  const L = createLeague({ seed, numTeams: 2, rounds: 28, legendaries });
  L.teams[0].user = false; L.teams[0].coach = 'balanced';
  while (L.phase === 'draft') {
    const c = aiChoosePick(L);
    makePick(L, c.id, c.slot);
  }
  return L;
}
