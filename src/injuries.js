// Mid-season injuries: rare, multi-week, and separate from soreness. A tackle in a league game
// can hurt either body (engine.js rolls it, from the odds below); the league keeps who is hurt
// and for how many more games (L.injuries), sits them at game time, and heals them week by week.
import { PLAYERS, SLOT, SLOT_KEYS } from './ratings.js';

const kg = (id) => Math.max(1, PLAYERS[id].weight / 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Chance that this Pokémon is hurt on a tackle against `by`. Size mismatch is most of it: a
// small Pokémon brought down by (or tackling) a giant is several times likelier to get hurt,
// a giant meeting a small one hardly ever is. speed: closing speed in yards a second when the
// live field knows it. sta: Stamina, the toughness stand-in.
export const INJURY_BASE = 0.0011;
export function injuryOdds(id, by, speed = null, sta = 70) {
  const size = clamp((kg(by) / kg(id)) ** 0.5, 0.45, 4);
  const pace = speed == null ? 1 : clamp(speed / 6, 0.6, 1.8);
  return INJURY_BASE * size * pace * clamp(1.3 - sta / 200, 0.75, 1.2);
}

// Games missed: two to four, one more when the hit came from something far bigger.
export function injuryWeeks(id, by, roll) {
  return 2 + Math.floor(roll * 3) + (kg(by) / kg(id) >= 4 ? 1 : 0);
}

const sideOf = (slot) => SLOT[slot].side;
// Who covers a slot whose starter can't play: the best healthy bench Pokémon there, or with no
// bench, the best starter from the other side of the ball (an offensive starter plays a
// defensive slot, and the other way round). Kickers and punters cover for each other first.
export function coverSlot(lineup, bench, slot, unavailable = () => false) {
  const ok = (id) => id != null && !unavailable(id);
  const best = (ids) => ids.filter(ok).reduce((a, b) => (a == null || PLAYERS[b].ovr[slot] > PLAYERS[a].ovr[slot] ? b : a), null);
  const fromBench = best(bench);
  if (fromBench != null) return fromBench;
  const side = sideOf(slot);
  const covering = (id) => SLOT_KEYS.filter((k) => lineup[k] === id).length > 1;
  const pool = SLOT_KEYS.filter((k) => k !== slot && (side === 'st' ? true : sideOf(k) !== side && sideOf(k) !== 'st'))
    .map((k) => lineup[k]).filter((id) => !covering(id));
  return best(pool);
}

// After a league game: who got hurt in it joins the injury list.
export function recordInjuries(L, g, meta) {
  L.injuries ??= {};
  for (const inj of g.injuries ?? []) {
    L.injuries[inj.id] = { weeks: inj.weeks, team: inj.team, by: inj.by, fresh: true,
      when: meta.playoff ? (meta.round === 0 ? 'Semifinal' : 'Championship') : `Week ${meta.week + 1}` };
    // Hurt is not sore: an injured Pokémon's soreness is moot until it heals.
    if (L.condition) delete L.condition[inj.id];
  }
}

// A week (or playoff round) has passed: each injury is one game closer to healed. One picked
// up this week doesn't count this week down.
export function healWeek(L) {
  for (const [id, inj] of Object.entries(L.injuries ?? {})) {
    if (inj.fresh) { delete inj.fresh; continue; }
    inj.weeks--;
    if (inj.weeks <= 0) delete L.injuries[id];
  }
}

export const injured = (L, id) => !!L?.injuries?.[id];

// Everyone hurt around the league, worst first.
export function injuryReport(L) {
  return Object.entries(L.injuries ?? {}).map(([id, inj]) => ({ id: Number(id), ...inj }))
    .sort((a, b) => b.weeks - a.weeks || a.team - b.team);
}
