// Physical size of each species on the field. Two separate things, kept apart on purpose:
//   r:      the gameplay collision capsule's radius in yards. The simulation spaces, blocks,
//           tackles and separates bodies with it, so it stays in a football range (a small
//           Pokémon is a slot receiver, a Snorlax a nose tackle, never three linemen wide).
//   height: how tall the model is drawn, from the Pokédex height, compressed so a Snorlax
//           towers over a Raichu without a Wailord covering half the field.
// The model is then scaled to that height, but never wider than its capsule (fitScale), so
// what you see is what collides and two players who do not touch never look merged.
import { PLAYERS } from './ratings.js';

const cache = new Map();

// The drawn body may spill a little past the capsule (arms, ears, tails): to the sides by 30%,
// front and back by 60% (lines face each other across the neutral zone, which leaves room for
// a snout or a tail). Formations space players by these same footprints.
export const FOOT_SIDE = 1.3;
export const FOOT_DEPTH = 1.6;
export const MIN_R = 0.38, MAX_R = 0.8;

export function bodyOf(id) {
  let b = cache.get(id);
  if (b) return b;
  const P = PLAYERS[id];
  const m = P ? P.height / 10 : 1.2, kg = P ? P.weight / 10 : 60;
  // Square root of the Pokédex height: about 1.6 yards for a Pikachu, 3 for a Greninja, 3.5
  // for a Mewtwo or a Snorlax, 4.6 for a Groudon, 5.5 at most. Big Pokémon stand well over the
  // small ones, small ones stay big enough to read from the broadcast camera.
  const height = Math.min(5.5, Math.max(1.35, 1.75 * Math.sqrt(m / 0.5)));
  // Collision radius in yards: heavier is wider, but a football body: a 0.4 yard skill player
  // up to a 0.8 yard nose tackle (a lineman is about 1.3 yards shoulder to shoulder).
  const r = Math.min(MAX_R, Math.max(MIN_R, 0.33 + 0.09 * Math.log2(1 + kg / 10)));
  b = { height, r, kg, m };
  cache.set(id, b);
  return b;
}

// Scale for a model whose rest-pose bounds are w (across), h (up), d (front to back), so it
// stands at the species height. A body much wider or longer than its footprint (wings spread,
// arms out in a T-pose, a serpent) is drawn smaller, but keeps at least 80% of its height:
// a Mewtwo or a Charizard reads as big even if its tail or wings reach over a neighbor.
export const MIN_FIT = 0.8;
export function fitScale(B, w, h, d) {
  const full = B.height / Math.max(1e-6, h);
  let s = full;
  const maxW = B.r * 2 * FOOT_SIDE * 1.6, maxD = B.r * 2 * FOOT_DEPTH * 1.6;
  if (d * s > maxD) s = Math.max(maxD / d, full * MIN_FIT);
  if (w * s > maxW) s = Math.max(maxW / w, full * MIN_FIT);
  return s;
}
