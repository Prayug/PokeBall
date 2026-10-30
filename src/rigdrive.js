// Driving a real model's skeleton each frame, from the same situation the procedural layers
// read (Stage.situation in field3d.js, or the animation lab's synthetic one): which clip plays
// and how fast, then the procedural passes on top of it in a fixed order:
//   1. resetLimbs   driven bones back to rest, so nothing drifts frame to frame
//   2. mixer        the clip (idle, run, walk, attack, damage, down, glad)
//   3. hangArms     T-posed or spread arms let down toward the sides
//   4. foldWings    a standing bird's wings folded back
//   5. driveLimbs   stride, arm swing, wings, tail, spine, head
//   6. poseLimbs    the football pose (crouch, lean, block, carry, throw, reach)
//   7. groundFeet   the body set on its lowest foot, and nothing left under the turf
// fig.diag keeps what was decided this frame, for the animation lab.
import { playClip, resetLimbs, driveLimbs, poseLimbs, hangArms, foldWings, groundFeet } from './model3d.js';
import { updateBlink } from './blink.js';
import { PLAYERS } from './ratings.js';
import { flies } from './figure3d.js';
import { FIX } from './modelfix.js';

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (k, dt, rate) => 1 - Math.exp(-dt * rate);

export function driveModel(f, anim, s, dt) {
  let role = 'idle', speed = 1;
  if (s.fall > 0.5) role = 'down';
  else if (s.celebrate > 0.3) role = 'glad';
  else if (s.stun > 0.3) role = 'damage';
  // Blocking and throwing are posed on the skeleton (poseLimbs); a rig-less model has
  // only its clips, so it uses its attack clip for contact.
  else if (s.truck > 0.3 || s.dive > 0.3 || ((s.engaged || (s.throwU != null && s.throwU < 1)) && !f.rig)) role = 'attack';
  else if (anim.moving) {
    role = f.actions.run ? 'run' : 'walk';
    // Match the clip's stride to the ground speed, within reason (a big body takes longer
    // strides, so its clip runs slower for the same speed).
    speed = clampN(s.speed / (role === 'run' ? 6 : 3) * (2 / Math.max(0.8, s.height)) * (1 + 0.15 * anim.sprK), 0.6, 2.4);
  }
  const played = playClip(f, role, 0.18, speed);
  resetLimbs(f);
  f.mixer.update(dt);
  // Arms hang naturally unless a clip is acting something out (celebrating, falling, hit);
  // a run or walk clip keeps some of its own arm swing.
  const hw = played === 'idle' || !played ? 0.9 : played === 'run' || played === 'walk' ? 0.5 : 0;
  f.hangW = (f.hangW ?? hw) + (hw - (f.hangW ?? hw)) * ease(0, dt, 6);
  hangArms(f, f.hangW);
  // A bird on its feet folds its wings, half opening them to run and fully to hover.
  const fw = s.hover ? 0 : played === 'idle' || !played ? (anim.moving ? 0.45 : 0.85) : 0;
  f.foldW = (f.foldW ?? fw) + (fw - (f.foldW ?? fw)) * ease(0, dt, 5);
  foldWings(f, f.foldW);
  // The model's own legs: full procedural stride unless its run or walk clip is playing.
  const want = played === 'run' || played === 'walk' ? 0 : played === 'idle' || !played ? 1 : 0.4;
  f.limbW += (want - f.limbW) * ease(0, dt, 8);
  const sf = s.top > 0 ? clampN(s.speed / s.top, 0, 1.2) : 0;
  const runWant = anim.moving ? 0.4 + 0.6 * Math.min(1, sf) + 0.35 * anim.sprK : s.engaged ? 0.35 : 0;
  f.runK = (f.runK ?? 0) + (runWant - (f.runK ?? 0)) * ease(0, dt, 6);
  // The head follows the ball (not when it is right behind, where it would whip side to side).
  const lk = s.look == null || Math.abs(s.look) > 2.4 ? 0 : clampN(s.look, -1.1, 1.1);
  f.look = (f.look ?? 0) + (lk - (f.look ?? 0)) * ease(0, dt, 5);
  // Standing about: breathing, glances, shrugs and stretches, a wag or a ruffle of the wings.
  const calmWant = anim.moving || s.engaged || s.fall > 0.5 ? 0 : s.mode === 'pre' && s.stance ? 0.35 : 1;
  f.calm = (f.calm ?? calmWant) + (calmWant - (f.calm ?? calmWant)) * ease(0, dt, 4);
  driveLimbs(f, { gallop: anim.style === 'quad' ? anim.sprK : 0, phase: anim.gait, run: f.runK, t: anim.t, flap: s.hover ? 1 : 0, weight: f.limbW, look: f.look, calm: f.calm, seed: anim.seed ?? 0 });
  poseLimbs(f, anim.fb);
  groundFeet(f, anim.air ?? 0, anim.groundW ?? 0);
  updateBlink(f, dt, !(s.fall > 0.5 || s.stun > 0.3));
  f.diag = { role, played, speed, hangW: f.hangW, foldW: f.foldW, limbW: f.limbW, runK: f.runK, calm: f.calm };
}

// How a species moves, from its model: four legs, two, or none (and then whether it flies,
// floats, slithers or hops), and Flying types or levitating Pokémon in the air.
export function bodyStyle(id, fig) {
  const R = fig?.rig, T = fig?.template, P = PLAYERS[id];
  const types = P?.types ?? [];
  const flier = flies(id);
  if (FIX[id]?.body === 'quad') return 'quad';
  const wings = !!R?.bones?.some((e) => e.part === 'wing');
  // Winged Pokémon built on two real legs (Charizard, Dragonite) play on their feet like any
  // biped: hovering pitched them forward into a hunched, legs-tucked crouch.
  if (flier && R?.legs >= 2 && !R?.quad) return 'biped';
  if (flier && (wings || !R?.legs)) return 'flyer';
  if (R?.quad) return 'quad';
  if (R?.legs >= 2) return 'biped';
  if (flier || types.includes('Ghost') || P?.ability === 'Levitate') return 'floater';
  if (T && T.depth > T.height * 1.6) return 'serpent';
  if (types.includes('Psychic') && T && T.height > T.width) return 'floater';
  return 'hopper';
}
