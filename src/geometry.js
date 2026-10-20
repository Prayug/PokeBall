// League geometry: how many teams, the divisions, the schedule and the playoff format.
// 8 teams play a single round robin and a four-team playoff, as the league always has. 12 and
// 16 teams split into divisions of four: everyone meets once, division rivals twice (home and
// away), division winners seed first, and the bracket grows to six (two byes) or eight teams.

export const LEAGUE_SIZES = [8, 12, 16];
export const DIVISION_SIZE = 4;
export const DIVISION_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh'];

// Four divisions of consecutive team ids (the AI franchises are drawn at random, so this is a
// random split already, and needs no league randomness). Null when the league is too small.
export function makeDivisions(numTeams) {
  if (numTeams < 12 || numTeams % DIVISION_SIZE) return null;
  return Array.from({ length: numTeams / DIVISION_SIZE }, (_, d) => ({
    name: DIVISION_NAMES[d] ?? `Division ${d + 1}`,
    teams: Array.from({ length: DIVISION_SIZE }, (_, i) => d * DIVISION_SIZE + i),
  }));
}
export function divisionOf(L, id) {
  return L.divisions?.find((d) => d.teams.includes(id)) ?? null;
}

// One round robin: every pair once, each team once a week.
function roundRobinWeeks(ids) {
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
  return weeks;
}

// The season: a round robin, plus (with divisions) a second round robin inside each division
// with home and away swapped from the first meeting. Weeks are shuffled together.
export function buildSchedule(L, { r, save }) {
  const weeks = roundRobinWeeks(L.teams.map((t) => t.id));
  if (L.divisions) {
    const homeOf = new Map(weeks.flat().map((gm) => [[gm.home, gm.away].sort().join('-'), gm.home]));
    const div = L.divisions.map((d) => roundRobinWeeks(d.teams));
    for (let w = 0; w < div[0].length; w++) {
      weeks.push(div.flatMap((dw) => dw[w]).map((gm) => {
        const first = homeOf.get([gm.home, gm.away].sort().join('-'));
        return first === gm.home ? { home: gm.away, away: gm.home } : gm;
      }));
    }
  }
  for (let i = weeks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [weeks[i], weeks[j]] = [weeks[j], weeks[i]]; }
  save();
  return weeks;
}

// Games each team plays in the regular season.
export function gamesPerTeam(L) {
  const n = L.teams.length;
  return n - 1 + (L.divisions ? DIVISION_SIZE - 1 : 0);
}

// ---------- playoffs ----------

// How many teams make it: four in an 8-team league, six in 12 (the top two seeds rest the
// first weekend), eight in 16.
export function playoffField(L) {
  const n = L.teams.length;
  return n >= 16 ? 8 : n >= 12 ? 6 : Math.min(4, n);
}
export function playoffByes(L) { return playoffField(L) === 6 ? 2 : 0; }
export function playoffRounds(L) { return Math.ceil(Math.log2(playoffField(L))); }

// Seeds from the standings (best first): division winners first, then the best of the rest.
export function playoffSeeds(L, standings) {
  const field = playoffField(L);
  if (!L.divisions) return standings.slice(0, field).map((r) => r.id);
  const order = standings.map((r) => r.id);
  const winners = L.divisions.map((d) => order.find((id) => d.teams.includes(id)));
  winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...winners, ...order.filter((id) => !winners.includes(id))].slice(0, field);
}

// Highest seed left hosts the lowest, and so on inward.
export function pairSeeds(ids, seeds) {
  const s = ids.slice().sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
  const games = [];
  for (let i = 0; i < s.length / 2; i++) games.push({ home: s[i], away: s[s.length - 1 - i] });
  return games;
}

// The first round: the byes sit, the rest pair off.
export function firstRound(L, seeds) {
  const byes = playoffByes(L);
  return { byes: seeds.slice(0, byes), games: pairSeeds(seeds.slice(byes), seeds) };
}

// What a playoff round is called. Round 0 is the first; the last is the championship.
export function roundLabel(L, round, plural = false) {
  const fromEnd = playoffRounds(L) - 1 - round;
  if (fromEnd <= 0) return 'Championship';
  if (fromEnd === 1) return plural ? 'Semifinals' : 'Semifinal';
  return playoffField(L) === 6 ? (plural ? 'Wild card round' : 'Wild card game') : (plural ? 'Quarterfinals' : 'Quarterfinal');
}
export const isFinalRound = (L, round) => round === playoffRounds(L) - 1;
