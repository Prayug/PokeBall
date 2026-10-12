// Physical size of each species on the field, shared by the simulation (collision radius,
// spacing in formations) and the 3D renderer (figure height and footprint), so what you see
// is what collides. Heights come from the Pokédex height (dm) and weight (hg), compressed so
// a Snorlax towers over a Raichu without a Wailord covering half the field.
import { PLAYERS } from './ratings.js';

const cache = new Map();

export function bodyOf(id) {
  let b = cache.get(id);
  if (b) return b;
  const P = PLAYERS[id];
  const m = P ? P.height / 10 : 1.2, kg = P ? P.weight / 10 : 60;
  const height = Math.min(3.0, Math.max(1.05, 0.95 + 0.72 * Math.log2(1 + m)));
  // Collision radius in yards: heavier is wider. Small Pokémon still get a usable body.
  const r = Math.min(1.0, Math.max(0.42, 0.36 + 0.115 * Math.log2(1 + kg / 10)));
  b = { height, r, kg, m };
  cache.set(id, b);
  return b;
}
