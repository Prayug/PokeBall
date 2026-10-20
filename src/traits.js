// What a Pokémon's ability, type or build does during a live snap, in one table. Each trait
// names the moment it can act (its hook), whether it applies to the players involved, what it
// changes, and the line the result card shows when it did. The live simulation asks the table
// at each hook (traitMod) instead of checking abilities inline, so adding a trait is one entry
// here; the ratings-level effects (attribute bonuses, type matchups) stay in types.js.
//
// Hooks and their context:
//   throwAccuracy  { qb, def }           added to the passer's accuracy rating
//   pressure       { qb, rusher }        scales how much pressure widens the throw (1 = full)
//   catchReach     { p }                 added to how far a player reaches for the ball (yards)
//   intChance      { d, r }              added to the chance a defender at the spot picks it off
//   tackleOdds     { c, q }              added to the chance a tackle attempt brings him down
//   stripChance    { c, q }              added to the chance a tackle strips the ball
//   shedRate       { d, b }              scales how fast a defender gets off a block (1 = as is)
//
// Powers (powers.js) act here too: a player whose power is active at the snap carries it as
// p.power, and its `live` edges are read by the power entries below. `who`
// names the player the note (and the power's flash on the field) belongs to.
import { PLAYERS } from './ratings.js';
import { ABILITIES } from './types.js';

const special = (id) => ABILITIES[PLAYERS[id]?.ability]?.special;
const types = (id) => PLAYERS[id]?.types ?? [];
const name = (id) => PLAYERS[id]?.name ?? '?';

export const LIVE_TRAITS = [
  { id: 'intimidate', hook: 'throwAccuracy', kind: 'ability',
    applies: ({ qb, def }) => def.some((d) => special(d.id) === 'intimidate') && special(qb.id) !== 'clearBody',
    value: -3, note: ({ qb }) => `${name(qb.id)} is rattled by Intimidate` },
  { id: 'pressureAura', hook: 'pressure', kind: 'ability',
    applies: ({ rusher }) => !!rusher && special(rusher.id) === 'pressure',
    value: 1.3, note: ({ qb, rusher }) => `${name(qb.id)} feels ${name(rusher.id)}'s Pressure` },
  { id: 'focus', hook: 'pressure', kind: 'ability',
    applies: ({ qb }) => special(qb.id) === 'focus',
    value: 0.5, note: ({ qb }) => `${name(qb.id)} stays calm under pressure (${PLAYERS[qb.id].ability})` },
  { id: 'flier', hook: 'catchReach', kind: 'ability', quiet: true,
    applies: ({ p }) => types(p.id).includes('Flying') || PLAYERS[p.id]?.ability === 'Levitate',
    value: 0.25, note: ({ p }) => `${name(p.id)} flies up for a ball out of reach` },
  { id: 'darkRead', hook: 'intChance', kind: 'type',
    applies: ({ d }) => types(d.id).includes('Dark'),
    value: 0.07, note: ({ d }) => `${name(d.id)} reads the throw (Dark type)` },
  { id: 'hawk', hook: 'intChance', kind: 'ability',
    applies: ({ d }) => special(d.id) === 'hawk',
    value: 0.05, note: ({ d }) => `${name(d.id)} jumps the route (${PLAYERS[d.id].ability})` },
  { id: 'slippery', hook: 'tackleOdds', kind: 'ability',
    applies: ({ c, q }) => special(c.id) === 'slippery' && special(q.id) !== 'moldBreaker',
    value: -0.05, note: ({ c }) => `${name(c.id)} is hard to hold on to (${PLAYERS[c.id].ability})` },
  { id: 'luck', hook: 'tackleOdds', kind: 'ability', quiet: true,
    applies: ({ c }) => special(c.id) === 'luck',
    value: -0.03, note: ({ c }) => `${name(c.id)} gets a lucky bounce off the tackle (${PLAYERS[c.id].ability})` },
  { id: 'poisonStrip', hook: 'stripChance', kind: 'type',
    applies: ({ q }) => types(q.id).includes('Poison'),
    value: 0.03, note: ({ q }) => `${name(q.id)}'s Poison-type tackle goes for the ball` },
  { id: 'secureBall', hook: 'stripChance', kind: 'ability',
    applies: ({ c }) => special(c.id) === 'noFumble',
    value: -1, note: ({ c }) => `${name(c.id)} never lets go of the ball (${PLAYERS[c.id].ability})` },
  { id: 'armor', hook: 'stripChance', kind: 'ability',
    applies: ({ c }) => special(c.id) === 'armor',
    value: -0.035, note: ({ c }) => `${name(c.id)}'s ${PLAYERS[c.id].ability} keeps the ball in` },
  // ---------- powers ----------
  { id: 'pwCalm', hook: 'pressure', kind: 'power',
    applies: ({ qb }) => !!qb.power?.live?.calm, value: ({ qb }) => qb.power.live.calm,
    note: ({ qb }) => `${name(qb.id)} shrugs off the rush (${qb.power.name})`, who: ({ qb }) => qb },
  { id: 'pwParalyze', hook: 'pressure', kind: 'power',
    applies: ({ rusher }) => !!rusher?.power?.live?.paralyze, value: ({ rusher }) => rusher.power.live.paralyze,
    note: ({ qb, rusher }) => `${name(rusher.id)}'s ${rusher.power.name} rattles ${name(qb.id)}`, who: ({ rusher }) => rusher },
  { id: 'pwReach', hook: 'catchReach', kind: 'power', quiet: true,
    applies: ({ p }) => !!p.power?.live?.reach, value: ({ p }) => p.power.live.reach,
    note: ({ p }) => `${name(p.id)} snags it with ${p.power.name}`, who: ({ p }) => p },
  { id: 'pwHawk', hook: 'intChance', kind: 'power',
    applies: ({ d }) => !!d.power?.live?.hawk, value: ({ d }) => d.power.live.hawk,
    note: ({ d }) => `${name(d.id)} sits on the route (${d.power.name})`, who: ({ d }) => d },
  { id: 'pwSafeThrow', hook: 'intChance', kind: 'power',
    applies: ({ qb }) => !!qb?.power?.live?.safeThrow, value: ({ qb }) => qb.power.live.safeThrow,
    note: ({ qb }) => `${name(qb.id)}'s ${qb.power.name} beats the defender to the spot`, who: ({ qb }) => qb },
  { id: 'pwElusive', hook: 'tackleOdds', kind: 'power',
    applies: ({ c }) => !!c.power?.live?.elusive, value: ({ c }) => c.power.live.elusive,
    note: ({ c }) => `${name(c.id)}'s ${c.power.name} shakes the tackler`, who: ({ c }) => c },
  { id: 'pwTackle', hook: 'tackleOdds', kind: 'power',
    applies: ({ q }) => !!q.power?.live?.tackle, value: ({ q }) => q.power.live.tackle,
    note: ({ q }) => `${name(q.id)} wraps up with ${q.power.name}`, who: ({ q }) => q },
  { id: 'pwStrip', hook: 'stripChance', kind: 'power',
    applies: ({ q }) => !!q.power?.live?.strip, value: ({ q }) => q.power.live.strip,
    note: ({ q }) => `${name(q.id)}'s ${q.power.name} goes for the ball`, who: ({ q }) => q },
  { id: 'pwShed', hook: 'shedRate', kind: 'power', quiet: true,
    applies: ({ d }) => !!d.power?.live?.shed, value: ({ d }) => d.power.live.shed,
    note: ({ d }) => `${name(d.id)} tears through the block (${d.power.name})`, who: ({ d }) => d },
  { id: 'pwAnchor', hook: 'shedRate', kind: 'power', quiet: true,
    applies: ({ b }) => !!b.power?.live?.anchor, value: ({ b }) => b.power.live.anchor,
    note: ({ b }) => `${name(b.id)} holds the wall (${b.power.name})`, who: ({ b }) => b },
  { id: 'barbs', hook: 'shedRate', kind: 'ability', quiet: true,
    applies: ({ b, d }) => special(b.id) === 'barbs' && special(d.id) !== 'moldBreaker',
    value: 0.75, note: ({ b }) => `${name(b.id)}'s ${PLAYERS[b.id].ability} keeps the rusher off` },
];

// The summed (or, for multiplying hooks, multiplied) effect of every trait that applies at
// this hook, plus the traits that did. A trait marked quiet only gets a note when its caller
// says the effect decided something (see live.js arrival()).
const MULTIPLY = new Set(['pressure', 'shedRate']);
export function traitMod(hook, ctx) {
  let v = MULTIPLY.has(hook) ? 1 : 0;
  const used = [];
  for (const t of LIVE_TRAITS) {
    if (t.hook !== hook || !t.applies(ctx)) continue;
    const val = typeof t.value === 'function' ? t.value(ctx) : t.value;
    v = MULTIPLY.has(hook) ? v * val : v + val;
    used.push(t);
  }
  return { v, used };
}
