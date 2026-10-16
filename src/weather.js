// Weather as physics on the live field, on top of the rating multipliers in PARITY: how the
// conditions change the way bodies move, see and wear down during a snap. The types a weather
// favours (and anything with Overcoat, Air Lock or Immunity) play through it untouched.
//   cut    scales how sharply a player brakes and cuts (slick turf)
//   slip   chance a ball carrier's juke or spin slips out from under him
//   glare  added to how far a player reaches for the ball (yards; losing it in the sun)
//   fade   how much top speed a player loses per second of the play after the first three
//   drain  scales how fast the sprint burst runs out
//   awr    added to awareness (reads come slower when you can't see)
//   chip   energy lost each time the player is in contact (a block or a tackle attempt)
import { PLAYERS } from './ratings.js';
import { ABILITIES } from './types.js';

export const WEATHER_PHYS = {
  rain: { spares: ['Water'], cut: 0.85, slip: 0.12, text: 'Slick turf: cuts are wider and jukes can slip' },
  sun: { spares: ['Fire', 'Grass'], glare: -0.15, text: 'Glare: receivers lose the ball in the sun' },
  hail: { spares: ['Ice'], fade: 0.012, drain: 1.5, text: 'Biting cold: legs go heavy late in a play' },
  sand: { spares: ['Rock', 'Ground', 'Steel'], awr: -8, chip: 1, text: 'Blowing sand: slower reads and every hit wears you down' },
};

// What the weather does to this Pokémon on the live field, or null when it plays through it.
export function weatherPhys(weather, id) {
  const W = WEATHER_PHYS[weather], P = PLAYERS[id];
  if (!W || !P) return null;
  if (W.spares.some((t) => P.types.includes(t))) return null;
  if (ABILITIES[P.ability]?.special === 'overcoat') return null;
  return W;
}
