// How far luck can move a game. Ratings still decide most games, but these swings let a weaker
// team steal some: a per-game form roll for each side, home field, and bigger type and weather
// effects. Each is a rating multiplier, so 0.05 means 5%. The difficulty levels tune them.
export const PARITY = {
  form: 0.04,       // standard deviation of each team's form for the day
  formCap: 0.11,    // form never goes past this, either way
  home: 0.01,       // home side's edge (none at a neutral site)
  type: 0.12,       // super effective +12%, not very effective -12%
  noEffect: 0.2,    // a matchup with no effect costs 20%
  weather: 0.12,    // a type the weather favours gains 12%, the one it hurts loses 12%
  sandImmune: 0.08, // Rock, Ground and Steel in a sandstorm
  coastFrom: 14,    // after halftime, a side leading by more than this eases off...
  coastPerPoint: 0.01, // ...by 1% for each point past it...
  coastMax: 0.15,   // ...up to 15%, so blowouts stay football scores
  // The chaos floor: things that happen whatever the ratings, so a mismatch is never a sure
  // thing. Close games barely notice, since their own odds sit above these floors.
  missedTackle: 0.06, // any ball carrier slips at least this share of first tackles...
  openField: 0.04,    // ...and breaks into the open field at least this often on a 5+ yard run
  tipped: 0.015,      // share of throws batted or tipped at the line or the catch point...
  tippedPick: 0.3,    // ...and the share of those that end up intercepted
  blown: 0.02,        // share of routes where the coverage is blown and the man is open
  puntSwing: 0.012,   // share of returnable punts muffed (half) or taken back all the way (half)
};

// A game's form roll, taken from its seed alone so it never shifts the play-by-play random
// stream: the same seed always gives the same form. Returns a multiplier offset per side.
export function formFor(seed) {
  let h = (seed >>> 0) ^ 0x9E3779B9;
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    h ^= h >>> 16;
    return ((h >>> 0) + 0.5) / 4294967296;
  };
  const roll = () => {
    const z = Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
    return Math.max(-PARITY.formCap, Math.min(PARITY.formCap, z * PARITY.form));
  };
  return [roll(), roll()];
}
