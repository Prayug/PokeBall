// Type chart, type traits, weather and curated abilities.
import { PARITY } from './parity.js';

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

// Best multiplier any of the attacker's types gets against the defender (abilities counted;
// see bestMatchup).
export function bestMultiplier(attacker, defender) {
  return bestMatchup(attacker, defender).mult;
}

// Football effect of a matchup multiplier, as a rating multiplier.
// Super effective +12%, not very effective -12%, no effect -20% (PARITY sets the sizes).
export function matchupModifier(mult) {
  if (mult === 0) return 1 - PARITY.noEffect;
  if (mult > 1) return 1 + PARITY.type;
  if (mult < 1) return 1 - PARITY.type;
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
  rain: { name: 'Rain', text: 'Water +12%, Fire -12%, passing accuracy -4, more fumbles; slick turf (wider cuts, jukes can slip) for all but Water types', boost: 'Water', nerf: 'Fire' },
  sun: { name: 'Harsh sun', text: 'Fire +12%, Water -12%; glare costs catch reach for all but Fire and Grass types', boost: 'Fire', nerf: 'Water' },
  sand: { name: 'Sandstorm', text: 'Rock, Ground and Steel +8%; everyone else tires faster, reads slower and wears down on every hit', boost: 'Rock', immune: ['Rock', 'Ground', 'Steel'] },
  hail: { name: 'Hail', text: 'Ice +12%; everyone else tires faster and slows late in a play', boost: 'Ice', immune: ['Ice'] },
};

// Every ability in the pool, with its football effect. `attr`: flat rating bonuses (`all` adds
// to every attribute); `when`: the condition they need (see cond() in engine.js); `special`: a
// named effect the sim or the live field checks; `immune`: a type whose hits have no effect on
// it (an absorbing ability); `weather`: the weather it brings to its games. An ability can
// carry more than one of these.
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
  Levitate: { text: '+4 pass rush (hard to cut-block); Ground-type hits have no effect on it', attr: { rush: 4 }, immune: 'Ground' },
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
  // Gen 5 to 9
  'Sand Rush': { text: '+10 speed in a sandstorm', attr: { spd: 10 }, when: 'sand' },
  'Slush Rush': { text: '+10 speed in hail', attr: { spd: 10 }, when: 'hail' },
  'Sheer Force': { text: '+6 strength', attr: { str: 6 } },
  'Tough Claws': { text: '+5 strength', attr: { str: 5 } },
  'Strong Jaw': { text: '+5 tackling', attr: { tkl: 5 } },
  Fluffy: { text: '+5 blocking', attr: { blk: 5 } },
  Unburden: { text: '+6 speed', attr: { spd: 6 } },
  Multiscale: { text: 'Super-effective matchups against it are halved', special: 'filter' },
  'Prism Armor': { text: 'Super-effective matchups against it are halved', special: 'filter' },
  Defiant: { text: 'Immune to Intimidate', special: 'clearBody' },
  Competitive: { text: 'Immune to Intimidate', special: 'clearBody' },
  'Protosynthesis': { text: '+5 to everything in harsh sun', attr: { all: 5 }, when: 'sun' },
};

// The rest of the pool's abilities. Kept apart so a Pokémon whose abilities include one of the
// curated set above still plays with that one (see pickAbility), as saved leagues expect.
const FILLED = {
  // Absorbing abilities: hits of one type have no effect on it.
  'Water Absorb': { text: 'Water-type hits have no effect on it', immune: 'Water' },
  'Volt Absorb': { text: 'Electric-type hits have no effect on it', immune: 'Electric' },
  'Lightning Rod': { text: 'Electric-type hits have no effect on it', immune: 'Electric' },
  'Motor Drive': { text: 'Electric-type hits have no effect on it', immune: 'Electric' },
  'Flash Fire': { text: 'Fire-type hits have no effect on it', immune: 'Fire' },
  'Well-Baked Body': { text: 'Fire-type hits have no effect on it', immune: 'Fire' },
  'Water Bubble': { text: 'Fire-type hits have no effect on it; +4 stamina', immune: 'Fire', attr: { sta: 4 } },
  'Sap Sipper': { text: 'Grass-type hits have no effect on it', immune: 'Grass' },
  'Earth Eater': { text: 'Ground-type hits have no effect on it', immune: 'Ground' },
  'Wind Rider': { text: 'Flying-type hits have no effect on it; +3 speed', immune: 'Flying', attr: { spd: 3 } },
  'Wonder Guard': { text: 'Only super-effective hits have any effect on it', special: 'wonderGuard' },
  Scrappy: { text: 'Its Normal and Fighting hits work on Ghost types', special: 'scrappy' },

  // Weather and the field.
  Hydration: { text: '+8 stamina in rain', attr: { sta: 8 }, when: 'rain' },
  'Water Compaction': { text: '+8 blocking in rain', attr: { blk: 8 }, when: 'rain' },
  'Leaf Guard': { text: '+8 stamina in harsh sun', attr: { sta: 8 }, when: 'sun' },
  'Flower Gift': { text: '+5 to everything in harsh sun', attr: { all: 5 }, when: 'sun' },
  'Sand Force': { text: '+8 strength in a sandstorm', attr: { str: 8 }, when: 'sand' },
  'Ice Face': { text: '+8 blocking in hail', attr: { blk: 8 }, when: 'hail' },
  Forecast: { text: '+5 to everything in any weather', attr: { all: 5 }, when: 'weather' },
  'Wind Power': { text: '+6 speed in any weather', attr: { spd: 6 }, when: 'weather' },
  Overcoat: { text: 'Weather never wears it down or slows it', special: 'overcoat' },
  'Air Lock': { text: 'Weather never wears it down or slows it', special: 'overcoat' },
  Immunity: { text: 'Weather never wears it down or slows it', special: 'overcoat' },
  'Orichalcum Pulse': { text: 'Brings harsh sun to its games; +4 strength', weather: 'sun', attr: { str: 4 } },
  'Hadron Engine': { text: '+5 to everything (charges the field)', attr: { all: 5 } },
  'Electric Surge': { text: '+4 to everything (charges the field)', attr: { all: 4 } },
  'Psychic Surge': { text: '+4 to everything (warps the field)', attr: { all: 4 } },
  'Grassy Surge': { text: '+4 to everything (grows the field)', attr: { all: 4 } },
  'Misty Surge': { text: '+4 to everything (mists the field)', attr: { all: 4 } },

  // Game situations.
  'Early Bird': { text: '+6 to everything in the 1st quarter', attr: { all: 6 }, when: 'q1' },
  'Slow Start': { text: '-12 to everything in the 1st quarter', attr: { all: -12 }, when: 'q1' },
  'Zero to Hero': { text: '+8 to everything in the second half', attr: { all: 8 }, when: 'h2' },
  'Soul-Heart': { text: '+4 to everything in the second half', attr: { all: 4 }, when: 'h2' },
  Steadfast: { text: '+6 speed when trailing', attr: { spd: 6 }, when: 'trail' },
  Justified: { text: '+6 strength when trailing', attr: { str: 6 }, when: 'trail' },
  Merciless: { text: '+6 tackling when leading', attr: { tkl: 6 }, when: 'lead' },
  'Chilling Neigh': { text: '+5 to everything when leading', attr: { all: 5 }, when: 'lead' },
  'Grim Neigh': { text: '+5 to everything when leading', attr: { all: 5 }, when: 'lead' },
  'Punk Rock': { text: '+6 strength at home, with its crowd', attr: { str: 6 }, when: 'home' },
  Rivalry: { text: '+5 to everything in the playoffs', attr: { all: 5 }, when: 'playoff' },
  Plus: { text: '+5 to everything with another Electric type on its side', attr: { all: 5 }, when: 'electricMate' },
  Minus: { text: '+5 to everything with another Electric type on its side', attr: { all: 5 }, when: 'electricMate' },
  Schooling: { text: '+8 to everything while fresh', attr: { all: 8 }, when: 'fresh' },
  'Shields Down': { text: '+6 blocking while fresh', attr: { blk: 6 }, when: 'fresh' },
  Defeatist: { text: '-6 to everything when tired', attr: { all: -6 }, when: 'tired' },
  Berserk: { text: '+6 strength when tired', attr: { str: 6 }, when: 'tired' },
  'Anger Shell': { text: '+6 speed and strength when tired', attr: { spd: 6, str: 6 }, when: 'tired' },
  'Emergency Exit': { text: '+8 speed when tired', attr: { spd: 8 }, when: 'tired' },
  'Tangled Feet': { text: '+6 agility and +3 speed when tired', attr: { agi: 6, spd: 3 }, when: 'tired' },

  // Hard to tackle or strip.
  'Cute Charm': { text: 'Tacklers miss more often', special: 'slippery' },
  'Effect Spore': { text: 'Tacklers miss more often', special: 'slippery' },
  Stench: { text: 'Tacklers miss more often', special: 'slippery' },
  'Cursed Body': { text: 'Tacklers miss more often', special: 'slippery' },
  'Liquid Ooze': { text: 'Tacklers miss more often', special: 'slippery' },
  Gooey: { text: 'Tacklers miss more often', special: 'slippery' },
  'Cotton Down': { text: 'Tacklers miss more often', special: 'slippery' },
  'Innards Out': { text: 'Tacklers miss more often', special: 'slippery' },
  Disguise: { text: 'Tacklers miss more often', special: 'slippery' },
  'Sticky Hold': { text: 'Never fumbles', special: 'noFumble' },
  'Water Veil': { text: 'Never fumbles', special: 'noFumble' },
  Bulletproof: { text: 'Never fumbles', special: 'noFumble' },
  'Shell Armor': { text: 'Big hits jar the ball loose half as often', special: 'armor' },
  'Battle Armor': { text: 'Big hits jar the ball loose half as often', special: 'armor' },
  'Shield Dust': { text: 'Big hits jar the ball loose half as often', special: 'armor' },
  'Iron Barbs': { text: 'Rushers take longer to get off its blocks; +3 blocking', special: 'barbs', attr: { blk: 3 } },
  'Rough Skin': { text: 'Rushers take longer to get off its blocks; +3 blocking', special: 'barbs', attr: { blk: 3 } },

  // Ball hawks.
  Pickup: { text: 'Ball hawk: more interceptions', special: 'hawk' },
  'Honey Gather': { text: 'Ball hawk: more interceptions', special: 'hawk' },
  Magician: { text: 'Ball hawk: more interceptions', special: 'hawk' },
  Opportunist: { text: 'Ball hawk: more interceptions', special: 'hawk' },

  // Composure and reading the game.
  Oblivious: { text: 'Immune to Intimidate', special: 'clearBody' },
  'Big Pecks': { text: 'Immune to Intimidate', special: 'clearBody' },
  Soundproof: { text: 'Immune to Intimidate', special: 'clearBody' },
  'Flower Veil': { text: 'Immune to Intimidate', special: 'clearBody' },
  Contrary: { text: 'Immune to Intimidate', special: 'clearBody' },
  'Good as Gold': { text: 'Immune to Intimidate', special: 'clearBody' },
  'Full Metal Body': { text: 'Immune to Intimidate', special: 'clearBody' },
  Unnerve: { text: 'Opposing QB accuracy -3 while on the field', special: 'intimidate' },
  Unaware: { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  Turboblaze: { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  Teravolt: { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  Mummy: { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  'Wandering Spirit': { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  'Lingering Aroma': { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  'Mycelium Might': { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  'Unseen Fist': { text: 'Ignores the opponent\'s abilities in matchups', special: 'moldBreaker' },
  'Color Change': { text: 'Super-effective matchups against it are halved', special: 'filter' },
  'Wonder Skin': { text: 'Super-effective matchups against it are halved', special: 'filter' },
  'Shadow Shield': { text: 'Super-effective matchups against it are halved', special: 'filter' },
  Simple: { text: 'Type matchup bonuses doubled', special: 'adapt' },
  Anticipation: { text: '+4 coverage and awareness', attr: { cov: 4, awr: 4 } },
  Forewarn: { text: '+4 coverage and awareness', attr: { cov: 4, awr: 4 } },
  Frisk: { text: '+5 awareness, +3 coverage', attr: { awr: 5, cov: 3 } },
  Illuminate: { text: '+5 awareness, +3 catching', attr: { awr: 5, hnd: 3 } },
  Telepathy: { text: '+6 awareness, +3 catching', attr: { awr: 6, hnd: 3 } },
  Synchronize: { text: '+4 catching, +2 coverage', attr: { hnd: 4, cov: 2 } },
  Illusion: { text: '+6 agility, +3 accuracy (fakes out the defense)', attr: { agi: 6, acc: 3 } },

  // Recovering energy.
  Gluttony: { text: 'Recovers energy twice as fast', special: 'recover' },
  'Cheek Pouch': { text: 'Recovers energy twice as fast', special: 'recover' },
  Ripen: { text: 'Recovers energy twice as fast', special: 'recover' },
  'Cud Chew': { text: 'Recovers energy twice as fast', special: 'recover' },
  'Hunger Switch': { text: 'Recovers energy twice as fast', special: 'recover' },
  Healer: { text: 'Recovers energy twice as fast', special: 'recover' },
  Hospitality: { text: 'Recovers energy twice as fast', special: 'recover' },
  'Sweet Veil': { text: 'Recovers energy twice as fast', special: 'recover' },
  Comatose: { text: 'Tires half as fast', special: 'tireless' },

  // Plain rating bonuses.
  'Hyper Cutter': { text: '+5 tackling', attr: { tkl: 5 } },
  Limber: { text: '+6 agility, +2 speed', attr: { agi: 6, spd: 2 } },
  Dancer: { text: '+6 agility, +2 speed', attr: { agi: 6, spd: 2 } },
  Prankster: { text: '+6 acceleration, +2 speed', attr: { acl: 6, spd: 2 } },
  'Weak Armor': { text: '+7 speed, -4 blocking', attr: { spd: 7, blk: -4 } },
  Damp: { text: '+4 catching, +2 stamina', attr: { hnd: 4, sta: 2 } },
  'Shadow Tag': { text: '+8 coverage (its man can\'t get away)', attr: { cov: 8 } },
  'Suction Cups': { text: '+6 blocking (can\'t be moved off its spot)', attr: { blk: 6 } },
  'Fur Coat': { text: '+8 blocking', attr: { blk: 8 } },
  'Stance Change': { text: '+4 blocking and tackling', attr: { blk: 4, tkl: 4 } },
  'Mega Launcher': { text: '+6 throwing', attr: { arm: 6 } },
  'Gulp Missile': { text: '+6 throwing', attr: { arm: 6 } },
  Refrigerate: { text: '+4 tackling', attr: { tkl: 4 } },
  Corrosion: { text: '+5 tackling', attr: { tkl: 5 } },
  'Toxic Chain': { text: '+5 tackling', attr: { tkl: 5 } },
  'Toxic Debris': { text: '+4 tackling', attr: { tkl: 4 } },
  'Poison Puppeteer': { text: '+4 tackling', attr: { tkl: 4 } },
  'Supersweet Syrup': { text: '+4 tackling', attr: { tkl: 4 } },
  Receiver: { text: '+6 catching', attr: { hnd: 6 } },
  Commander: { text: '+5 catching', attr: { hnd: 5 } },
  Steelworker: { text: '+5 blocking', attr: { blk: 5 } },
  'Friend Guard': { text: '+4 blocking', attr: { blk: 4 } },
  'Power Spot': { text: '+4 blocking, +2 strength', attr: { blk: 4, str: 2 } },
  'Seed Sower': { text: '+5 blocking', attr: { blk: 5 } },
  'Thermal Exchange': { text: '+5 strength', attr: { str: 5 } },
  Transistor: { text: '+6 pass rush', attr: { rush: 6 } },
  'Dragon’s Maw': { text: '+6 pass rush', attr: { rush: 6 } },
  'Intrepid Sword': { text: '+6 strength', attr: { str: 6 } },
  'Dauntless Shield': { text: '+6 blocking', attr: { blk: 6 } },
  'Sword of Ruin': { text: '+6 strength', attr: { str: 6 } },
  'Tablets of Ruin': { text: '+6 tackling', attr: { tkl: 6 } },
  'Vessel of Ruin': { text: '+6 pass rush', attr: { rush: 6 } },
  'Beads of Ruin': { text: '+6 coverage', attr: { cov: 6 } },
  'Bad Dreams': { text: '+4 tackling and coverage', attr: { tkl: 4, cov: 4 } },
  'Beast Boost': { text: '+4 to its best attribute', special: 'download' },
  'Quark Drive': { text: '+5 to everything when the field is charged (any weather)', attr: { all: 5 }, when: 'weather' },
  Multitype: { text: '+4 to everything', attr: { all: 4 } },
  'RKS System': { text: '+4 to everything', attr: { all: 4 } },
  'Victory Star': { text: '+3 to everything', attr: { all: 3 } },
  'Fairy Aura': { text: '+4 to everything', attr: { all: 4 } },
  'Dark Aura': { text: '+4 to everything', attr: { all: 4 } },
  'Aura Break': { text: '+4 to everything', attr: { all: 4 } },
  'Tera Shift': { text: '+4 to everything', attr: { all: 4 } },
};
const CURATED = new Set(Object.keys(ABILITIES));
Object.assign(ABILITIES, FILLED);

// Which of the attacker's types hits the defender hardest, and how hard, counting the
// defender's absorbing abilities, Wonder Guard and Scrappy. A Mold Breaker attacker ignores the
// defender's abilities. Returns { type, mult }.
export function bestMatchup(attacker, defender) {
  const aa = ABILITIES[attacker.ability] ?? {}, da = ABILITIES[defender.ability] ?? {};
  const ignore = aa.special === 'moldBreaker';
  let best = { type: attacker.types[0], mult: -1 };
  for (const t of attacker.types) {
    let m = aa.special === 'scrappy' && (t === 'Normal' || t === 'Fighting')
      ? typeMultiplier(t, defender.types.filter((x) => x !== 'Ghost')) : typeMultiplier(t, defender.types);
    if (!ignore && da.immune === t) m = 0;
    if (!ignore && da.special === 'wonderGuard' && m <= 1) m = 0;
    if (m > best.mult) best = { type: t, mult: m };
  }
  return best;
}

// A Pokémon's football ability: its first curated ability, else its first ability.
export function pickAbility(abilities) {
  return abilities.find((a) => CURATED.has(a)) ?? abilities[0] ?? 'None';
}

export const TYPE_COLORS = {
  Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C', Grass: '#7AC74C',
  Ice: '#96D9D6', Fighting: '#C22E28', Poison: '#A33EA1', Ground: '#E2BF65', Flying: '#A98FF3',
  Psychic: '#F95587', Bug: '#A6B91A', Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC',
  Dark: '#705746', Steel: '#B7B7CE', Fairy: '#D685AD',
};
