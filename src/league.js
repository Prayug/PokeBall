// League: teams, snake draft with AI drafters, schedule, standings and leaders.
import { PLAYERS, ALL_IDS, SLOT, SLOT_KEYS, BASELINE, autoDepthChart, unitRatings } from './ratings.js';
import { bestMultiplier } from './types.js';
import { createGame, simUntil, summary } from './engine.js';

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
];

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

export function createLeague({ teamName = 'Pallet Starters', abbr = 'PAL', rounds = 22, legendaries = false,
  typeCap = true, numTeams = 8, seed = Date.now(), userColor = '#C8102E', userPick = null } = {}) {
  const rng = makeRng(seed);
  const pool = AI_TEAMS.slice();
  const ai = [];
  while (ai.length < numTeams - 1) ai.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const teams = [
    { id: 0, name: teamName, abbr, color: userColor, coach: 'balanced', coachName: 'You', user: true },
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
    version: 1, seed, rngState: rng.state(), settings: { rounds, legendaries, typeCap, numTeams },
    teams, picks, pickIndex: 0, phase: 'draft', week: 0, schedule: [], results: [], playoffs: null, champion: null,
    seasonStats: {},
  };
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
  const taken = new Set(L.picks.filter((p) => p.player != null).map((p) => p.player));
  return ALL_IDS.filter((id) => !taken.has(id) && (L.settings.legendaries || !PLAYERS[id].legendary));
}

// Why a Pokémon can't be drafted by this team right now (or null).
export function blockReason(L, team, id) {
  const p = PLAYERS[id];
  if (L.settings.typeCap) {
    const same = team.roster.filter((x) => PLAYERS[x].types[0] === p.types[0]).length;
    if (same >= 4) return `Already 4 ${p.types[0]} types`;
  }
  if (p.legendary && team.roster.some((x) => PLAYERS[x].legendary)) return 'Already has a legendary';
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
    score += (r() - 0.5) * 6;
    if (!best || score > best.score) best = { id, slot, score };
  }
  save();
  return best;
}

export function finishDraft(L) {
  for (const t of L.teams) {
    const { lineup, bench } = autoDepthChart(t.roster);
    // Keep the drafter's slot choices when they fill every slot; otherwise fall back.
    const drafted = SLOT_KEYS.every((k) => t.slots[k] != null);
    t.lineup = drafted && t.user ? { ...t.slots } : lineup;
    t.bench = t.roster.filter((id) => !Object.values(t.lineup).includes(id));
    if (!t.user) { t.lineup = lineup; t.bench = bench; }
  }
  L.phase = 'grades';
  L.schedule = roundRobin(L.teams.map((t) => t.id), leagueRng(L));
  L.week = 0;
}

function roundRobin(ids, { r, save }) {
  const arr = ids.slice();
  if (arr.length % 2) arr.push(null);
  const n = arr.length, weeks = [];
  for (let w = 0; w < n - 1; w++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a == null || b == null) continue;
      const home = (w + i) % 2 === 0;
      games.push({ home: home ? a : b, away: home ? b : a });
    }
    weeks.push(games);
    arr.splice(1, 0, arr.pop());
  }
  for (let i = weeks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [weeks[i], weeks[j]] = [weeks[j], weeks[i]]; }
  save();
  return weeks;
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

export function teamForGame(t) {
  return { id: t.id, name: t.name, abbr: t.abbr, color: t.color, coach: t.coach, lineup: t.lineup, bench: t.bench };
}

export function newGameSeed(L) {
  const { r, save } = leagueRng(L);
  const s = Math.floor(r() * 2 ** 31);
  save();
  return s;
}

export function startLeagueGame(L, home, away, playoff = false) {
  return createGame({ home: teamForGame(L.teams[home]), away: teamForGame(L.teams[away]), seed: newGameSeed(L), playoff });
}

export function recordResult(L, g, meta) {
  const sm = summary(g);
  L.results.push({ ...meta, home: g.teams[0].id, away: g.teams[1].id, score: sm.score, winner: sm.winner == null ? null : g.teams[sm.winner].id,
    quarters: sm.quarters, weather: sm.weather });
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

export function advanceWeek(L) {
  L.week++;
  if (L.week >= L.schedule.length) {
    const top = standings(L).slice(0, 4).map((r) => r.id);
    L.phase = 'playoffs';
    L.playoffs = { round: 0, games: [{ home: top[0], away: top[3] }, { home: top[1], away: top[2] }], seeds: top, final: null };
  }
}

export function advancePlayoffs(L) {
  const P = L.playoffs;
  const winners = L.results.filter((r) => r.playoff && r.round === P.round).map((r) => r.winner);
  if (P.round === 0) {
    const [a, b] = winners;
    const seedOf = (id) => P.seeds.indexOf(id);
    const home = seedOf(a) < seedOf(b) ? a : b;
    P.round = 1; P.games = [{ home, away: home === a ? b : a }];
  } else {
    L.champion = winners[0];
    L.phase = 'done';
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

// Quick game: two AI-drafted rosters.
export function quickRosters(seed, legendaries = false) {
  const L = createLeague({ seed, numTeams: 2, rounds: 26, legendaries });
  L.teams[0].user = false; L.teams[0].coach = 'balanced';
  while (L.phase === 'draft') {
    const c = aiChoosePick(L);
    makePick(L, c.id, c.slot);
  }
  return L;
}
