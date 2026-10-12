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
// a snout or a tail). Formations space players by these same footprints, so bodies drawn at
// this size still never touch before the snap.
export const FOOT_SIDE = 1.3;
export const FOOT_DEPTH = 1.6;
export const MIN_R = 0.38, MAX_R = 0.8;

export function bodyOf(id) {
  let b = cache.get(id);
  if (b) return b;
  const P = PLAYERS[id];
  const m = P ? P.height / 10 : 1.2, kg = P ? P.weight / 10 : 60;
  // About 1.6 yards for a Pikachu, 2.6 for a Snorlax, 3.2 at most: big enough to recognize
  // from the broadcast camera, with the size order of the Pokédex kept.
  const height = Math.min(3.2, Math.max(1.35, 1.25 + 0.8 * Math.log2(1 + m)));
  // Collision radius in yards: heavier is wider, but a football body: a 0.4 yard skill player
  // up to a 0.8 yard nose tackle (a lineman is about 1.3 yards shoulder to shoulder).
  const r = Math.min(MAX_R, Math.max(MIN_R, 0.33 + 0.09 * Math.log2(1 + kg / 10)));
  b = { height, r, kg, m };
  cache.set(id, b);
  return b;
}

// Scale for a model whose rest-pose bounds are w (across), h (up), d (front to back), so it
// stands at the species height without spilling past its footprint. Wide or long bodies come
// out shorter than their height says. A long body (a serpent, a whale) keeps at least 75% of
// its height and may run a little past its footprint front to back, where there is room; a
// wide one never gets wider than its spot, so it cannot cover the neighbors on the line.
export const MIN_FIT = 0.75;
export function fitScale(B, w, h, d) {
  const full = B.height / Math.max(1e-6, h);
  let s = full;
  const maxW = B.r * 2 * FOOT_SIDE, maxD = B.r * 2 * FOOT_DEPTH;
  if (d * s > maxD) s = Math.max(maxD / d, full * MIN_FIT);
  if (w * s > maxW) s = maxW / w; // never wider than its spot on the line
  return s;
}
