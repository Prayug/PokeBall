// Physical size of each species on the field, in yards. One place decides it, and the
// simulation, the formations, the renderer and the camera all read it:
//   cls:    the size class (small, medium, large, xl), from the Pokédex height and weight. A
//           football game needs readable bodies, not Pokédex scale: a Wailord is not drawn
//           fifteen yards long, it is an extra-large lineman.
//   height: how tall the model is drawn: about 1.35 yards for small, 1.6 medium, 1.85 large,
//           2.1 extra-large (close enough that a small Pokémon still reads on the field, far
//           enough apart that a Snorlax still stands over a Pikachu), with a little spread inside each class so two large Pokémon are
//           not identical. A football player is about 2 yards tall.
//   r:      the gameplay collision capsule's radius. It is the body, not the wings or the tail:
//           the simulation spaces, blocks, tackles and separates bodies with it.
//   foot:   the drawn footprint, half extents to the side, the front and the back. The model
//           fitter (fitModel) guarantees the drawn model stays inside it, and once a model has
//           loaded its real measured extents replace the estimate (setMeasured), so formations
//           space players by what is actually drawn.
import { PLAYERS } from './ratings.js';

const cache = new Map();

export const SIZE_CLASSES = {
  small: { name: 'Small', height: 1.35, r: 0.42 },
  medium: { name: 'Medium', height: 1.6, r: 0.47 },
  large: { name: 'Large', height: 1.85, r: 0.53 },
  xl: { name: 'Extra large', height: 2.1, r: 0.58 },
};
const ORDER = ['small', 'medium', 'large', 'xl'];
// Size score: doubling the height counts one, doubling the weight about a third of that.
// The thresholds split the playable pool about 25 / 35 / 25 / 15.
const EDGES = [1.3, 2.6, 3.7];
export function sizeScore(m, kg) { return Math.log2(Math.max(0.1, m) / 0.4) + 0.35 * Math.log2(Math.max(0.1, kg) / 20); }

// How far the drawn model may reach past the capsule: the core of the body (the middle of its
// mass, see fitModel) to the sides and front to back, and the tips of wings, arms and tails.
export const CORE_SIDE = 1.1, CORE_DEPTH = 1.35;
export const TIP_SIDE = 1.4, TIP_DEPTH = 1.85;
// A model is never shrunk below this share of its class height to fit, so it stays
// recognizable (scaling is always uniform: nothing is flattened or stretched).
export const MIN_FIT = 0.6;

export function bodyOf(id) {
  let b = cache.get(id);
  if (b) return b;
  const P = PLAYERS[id];
  const m = P ? P.height / 10 : 1.2, kg = P ? P.weight / 10 : 60;
  const score = sizeScore(m, kg);
  const i = score < EDGES[0] ? 0 : score < EDGES[1] ? 1 : score < EDGES[2] ? 2 : 3;
  const cls = ORDER[i], C = SIZE_CLASSES[cls];
  // Position inside the class (-0.5 .. 0.5), for a little spread.
  const lo = i ? EDGES[i - 1] : EDGES[0] - 1.6, hi = i < 3 ? EDGES[i] : EDGES[2] + 1.8;
  const u = Math.max(-0.5, Math.min(0.5, (score - lo) / (hi - lo) - 0.5));
  const height = C.height * (1 + u * 0.14);
  const r = C.r * (1 + u * 0.1);
  // Until the model is measured, the footprint is the most the fitter lets it reach.
  b = { id, cls, height, r, kg, m, foot: { side: r * TIP_SIDE, front: r * TIP_DEPTH, back: r * TIP_DEPTH }, measured: false };
  cache.set(id, b);
  return b;
}

// The renderer reports a model's real drawn extents once it has loaded (half extents in
// yards: to the side, in front of the body center and behind it).
export let measureVersion = 0;
export function setMeasured(id, side, front, back) {
  const b = bodyOf(id);
  b.foot = { side, front, back };
  if (!b.measured) measureVersion++;
  b.measured = true;
}

// Fit a model to its body. Takes the model's rest-pose extents (in model units):
//   h:     height of the body (feet to the top of the head, ignoring the last few percent of
//          spikes, antennae and wing tips above it)
//   core:  half extents of the middle of the mass { side, front, back }
//   tips:  half extents of everything { side, front, back }
// and returns the uniform scale: the class height, shrunk if the core would spill past the
// capsule or the wings and tail past their allowance, never below MIN_FIT of the height.
export function fitModel(B, h, core, tips) {
  const full = B.height / Math.max(1e-6, h);
  let s = full;
  const lim = (ext, max) => { if (ext * s > max) s = max / ext; };
  lim(core.side, B.r * CORE_SIDE);
  lim(Math.max(core.front, core.back), B.r * CORE_DEPTH);
  lim(tips.side, B.r * TIP_SIDE);
  lim(Math.max(tips.front, tips.back), B.r * TIP_DEPTH);
  return Math.max(s, full * MIN_FIT);
}

// The older box-only fit, for the generated figures (their sprite bodies have no appendages
// to tell apart): w across, h up, d front to back.
export function fitScale(B, w, h, d) {
  return fitModel(B, h, { side: w / 2, front: d / 2, back: d / 2 }, { side: w / 2, front: d / 2, back: d / 2 });
}
