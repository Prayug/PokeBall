// What a Pokémon's ability, type or build does during a live snap, in one table. Each trait
// names the moment it can act (its hook), whether it applies to the players involved, what it
// changes, and the line the result card shows when it did. The live simulation asks the table
// at each hook (traitMod) instead of checking abilities inline, so adding a trait is one entry
// here; the ratings-level effects (attribute bonuses, type matchups) stay in types.js.
//
// Hooks and their context:
//   throwAccuracy  { qb, def }           added to the passer's accuracy rating
//   pressure       { qb }                scales how much pressure widens the throw (1 = full)
//   catchReach     { p }                 added to how far a player reaches for the ball (yards)
//   intChance      { d, r }              added to the chance a defender at the spot picks it off
//   tackleOdds     { c, q }              added to the chance a tackle attempt brings him down
//   stripChance    { c, q }              added to the chance a tackle strips the ball
import { PLAYERS } from './ratings.js';
import { ABILITIES } from './types.js';

const special = (id) => ABILITIES[PLAYERS[id]?.ability]?.special;
const types = (id) => PLAYERS[id]?.types ?? [];
const name = (id) => PLAYERS[id]?.name ?? '?';

export const LIVE_TRAITS = [
  { id: 'intimidate', hook: 'throwAccuracy', kind: 'ability',
    applies: ({ qb, def }) => def.some((d) => special(d.id) === 'intimidate') && special(qb.id) !== 'clearBody',
    value: -3, note: ({ qb }) => `${name(qb.id)} is rattled by Intimidate` },
  { id: 'focus', hook: 'pressure', kind: 'ability',
    applies: ({ qb }) => special(qb.id) === 'focus',
    value: 0.5, note: ({ qb }) => `${name(qb.id)} stays calm under pressure (${PLAYERS[qb.id].ability})` },
  { id: 'flier', hook: 'catchReach', kind: 'ability', quiet: true,
    applies: ({ p }) => types(p.id).includes('Flying') || PLAYERS[p.id]?.ability === 'Levitate',
    value: 0.25, note: ({ p }) => `${name(p.id)} flies up for a ball out of reach` },
  { id: 'darkRead', hook: 'intChance', kind: 'type',
    applies: ({ d }) => types(d.id).includes('Dark'),
    value: 0.07, note: ({ d }) => `${name(d.id)} reads the throw (Dark type)` },
  { id: 'slippery', hook: 'tackleOdds', kind: 'ability',
    applies: ({ c }) => special(c.id) === 'slippery',
    value: -0.05, note: ({ c }) => `${name(c.id)} is hard to hold on to (${PLAYERS[c.id].ability})` },
  { id: 'poisonStrip', hook: 'stripChance', kind: 'type',
    applies: ({ q }) => types(q.id).includes('Poison'),
    value: 0.03, note: ({ q }) => `${name(q.id)}'s Poison-type tackle goes for the ball` },
  { id: 'secureBall', hook: 'stripChance', kind: 'ability',
    applies: ({ c }) => special(c.id) === 'noFumble',
    value: -1, note: ({ c }) => `${name(c.id)} never lets go of the ball (${PLAYERS[c.id].ability})` },
];

// The summed (or, for multiplying hooks, multiplied) effect of every trait that applies at
// this hook, plus the traits that did. A trait marked quiet only gets a note when its caller
// says the effect decided something (see live.js arrival()).
const MULTIPLY = new Set(['pressure']);
export function traitMod(hook, ctx) {
  let v = MULTIPLY.has(hook) ? 1 : 0;
  const used = [];
  for (const t of LIVE_TRAITS) {
    if (t.hook !== hook || !t.applies(ctx)) continue;
    v = MULTIPLY.has(hook) ? v * t.value : v + t.value;
    used.push(t);
  }
  return { v, used };
}
