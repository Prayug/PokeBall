// Type chart, type traits, weather and curated abilities.

// Attacking type -> defending type -> multiplier (only non-1 entries).
const CHART = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

export const TYPES = Object.keys(CHART);

export function typeMultiplier(atkType, defTypes) {
  let m = 1;
  for (const t of defTypes) m *= CHART[atkType][t] ?? 1;
  return m;
}

// Best multiplier any of the attacker's types gets against the defender.
export function bestMultiplier(attacker, defender) {
  return Math.max(...attacker.types.map((t) => typeMultiplier(t, defender.types)));
}

// Football effect of a matchup multiplier, as a rating multiplier.
// Super effective +8%, not very effective -8%, no effect -15%.
export function matchupModifier(mult) {
  if (mult === 0) return 0.85;
  if (mult > 1) return 1.08;
  if (mult < 1) return 0.92;
  return 1;
}

export function effectLabel(mult) {
  if (mult === 0) return 'no effect';
  if (mult > 1) return 'super effective';
  if (mult < 1) return 'not very effective';
  return '';
}

// One small passive per type. `attr` bonuses are flat rating points.
export const TYPE_TRAITS = {
  Normal: { text: 'Tires 15% slower', fatigue: 0.85 },
  Fire: { text: '+4 pass rush', attr: { rush: 4 } },
  Water: { text: '+4 stamina', attr: { sta: 4 } },
  Grass: { text: '+3 blocking', attr: { blk: 3 } },
  Electric: { text: '+4 speed', attr: { spd: 4 } },
  Ice: { text: '+3 tackling', attr: { tkl: 3 } },
  Fighting: { text: '+4 strength', attr: { str: 4 } },
  Poison: { text: 'Tackles strip the ball more often', strip: true },
  Ground: { text: '+5 run blocking', runBlock: 5 },
  Flying: { text: '+5 on contested catches', contested: 5 },
  Psychic: { text: '+5 accuracy/vision', attr: { acc: 5 } },
  Bug: { text: '+3 coverage', attr: { cov: 3 } },
  Rock: { text: '+4 blocking', attr: { blk: 4 } },
  Ghost: { text: 'Phases through the first tackle once per game', phase: true },
  Dragon: { text: '+3 to everything in the 4th quarter', clutch: 3 },
  Dark: { text: 'Ball hawk: more interceptions', hawk: true },
  Steel: { text: 'Tires half as fast', fatigue: 0.5 },
  Fairy: { text: '+3 accuracy', attr: { acc: 3 } },
};

export const WEATHER = {
  clear: { name: 'Clear', text: 'No weather effects' },
  rain: { name: 'Rain', text: 'Water +8%, Fire -8%, passing accuracy -4, more fumbles', boost: 'Water', nerf: 'Fire' },
  sun: { name: 'Harsh sun', text: 'Fire +8%, Water -8%', boost: 'Fire', nerf: 'Water' },
  sand: { name: 'Sandstorm', text: 'Rock, Ground and Steel +5%; everyone else tires faster', boost: 'Rock', immune: ['Rock', 'Ground', 'Steel'] },
  hail: { name: 'Hail', text: 'Ice +8%; everyone else tires faster', boost: 'Ice', immune: ['Ice'] },
};

// Curated abilities with football effects. `attr`: flat bonuses; `when`: condition.
// Abilities not listed here do nothing in v1.
export const ABILITIES = {
  Intimidate: { text: 'Opposing QB accuracy -3 while on the field', special: 'intimidate' },
  'Swift Swim': { text: '+10 speed in rain', attr: { spd: 10 }, when: 'rain' },
  Chlorophyll: { text: '+10 speed in harsh sun', attr: { spd: 10 }, when: 'sun' },
  'Sand Veil': { text: '+6 coverage in a sandstorm', attr: { cov: 6 }, when: 'sand' },
  'Snow Cloak': { text: '+6 coverage in hail', attr: { cov: 6 }, when: 'hail' },
  Guts: { text: '+8 strength when tired', attr: { str: 8 }, when: 'tired' },
  'Marvel Scale': { text: '+6 blocking when tired', attr: { blk: 6 }, when: 'tired' },
  'Huge Power': { text: '+10 strength', attr: { str: 10 } },
  'Pure Power': { text: '+10 strength', attr: { str: 10 } },
  'Speed Boost': { text: '+2 speed each quarter', special: 'speedBoost' },
  Levitate: { text: '+4 pass rush (hard to cut-block)', attr: { rush: 4 } },
  Sturdy: { text: 'Never fumbles', special: 'noFumble' },
  'Thick Fat': { text: '+5 blocking', attr: { blk: 5 } },
  Technician: { text: '+4 hands', attr: { hnd: 4 } },
  'Compound Eyes': { text: '+6 accuracy', attr: { acc: 6 } },
  'Keen Eye': { text: '+4 accuracy/vision and coverage', attr: { acc: 4, cov: 4 } },
  'Inner Focus': { text: 'Pressure hurts half as much', special: 'focus' },
  Pressure: { text: 'Opposing QB feels pressure more', special: 'pressure' },
  Hustle: { text: '+6 strength, -4 hands', attr: { str: 6, hnd: -4 } },
  Insomnia: { text: '+6 stamina', attr: { sta: 6 } },
  'Vital Spirit': { text: '+6 stamina', attr: { sta: 6 } },
  'Natural Cure': { text: 'Recovers energy twice as fast', special: 'recover' },
  'Shed Skin': { text: 'Recovers energy twice as fast', special: 'recover' },
  'Rock Head': { text: 'Tires 25% slower', special: 'rockHead' },
  Adaptability: { text: 'Type matchup bonuses doubled', special: 'adapt' },
  'Tinted Lens': { text: 'Not-very-effective matchups count as neutral', special: 'tinted' },
  'Solid Rock': { text: 'Super-effective matchups against it are halved', special: 'filter' },
  Filter: { text: 'Super-effective matchups against it are halved', special: 'filter' },
  'Iron Fist': { text: '+5 breaking tackles', special: 'ironFist' },
  Reckless: { text: '+6 strength, fumbles more', attr: { str: 6 }, special: 'reckless' },
  'Serene Grace': { text: 'More breakaway runs', special: 'luck' },
  'Super Luck': { text: 'More breakaway runs', special: 'luck' },
  Sniper: { text: '+6 accuracy on deep throws', special: 'sniper' },
  'Run Away': { text: '+5 speed on run plays', special: 'runAway' },
  Static: { text: 'Tacklers miss more often', special: 'slippery' },
  'Flame Body': { text: 'Tacklers miss more often', special: 'slippery' },
  'Poison Point': { text: 'Tacklers miss more often', special: 'slippery' },
  'Clear Body': { text: 'Immune to Intimidate', special: 'clearBody' },
  'White Smoke': { text: 'Immune to Intimidate', special: 'clearBody' },
  'Own Tempo': { text: 'Immune to Intimidate', special: 'clearBody' },
  'Mold Breaker': { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  Download: { text: '+4 to its best attribute', special: 'download' },
  Overgrow: { text: '+6 to everything in the 4th quarter when trailing', attr: { all: 6 }, when: 'q4trail' },
  Blaze: { text: '+6 to everything in the 4th quarter when trailing', attr: { all: 6 }, when: 'q4trail' },
  Torrent: { text: '+6 to everything in the 4th quarter when trailing', attr: { all: 6 }, when: 'q4trail' },
  Swarm: { text: '+6 to everything in the 4th quarter when trailing', attr: { all: 6 }, when: 'q4trail' },
  Truant: { text: 'Loafs around: plays at half effort every other snap', special: 'truant' },
  Drizzle: { text: 'Brings rain to its games', weather: 'rain' },
  Drought: { text: 'Brings harsh sun to its games', weather: 'sun' },
  'Sand Stream': { text: 'Brings a sandstorm to its games', weather: 'sand' },
  'Snow Warning': { text: 'Brings hail to its games', weather: 'hail' },
};

// A Pokémon's football ability: its first curated ability, else its first ability.
export function pickAbility(abilities) {
  return abilities.find((a) => ABILITIES[a]) ?? abilities[0] ?? 'None';
}

export const TYPE_COLORS = {
  Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C', Grass: '#7AC74C',
  Ice: '#96D9D6', Fighting: '#C22E28', Poison: '#A33EA1', Ground: '#E2BF65', Flying: '#A98FF3',
  Psychic: '#F95587', Bug: '#A6B91A', Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC',
  Dark: '#705746', Steel: '#B7B7CE', Fairy: '#D685AD',
};
