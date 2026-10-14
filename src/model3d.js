// Real 3D Pokémon models.
//
// The models come from the Pokémon 3D API asset collection (github.com/Pokemon-3D-api/assets),
// which gathers fan-extracted models of the official Pokémon game models from Sketchfab. They
// are Nintendo / Creatures / GAME FREAK property like the pixel sprites this game already
// uses; see README for the details. build/build_models3d.mjs converts them (one idle, run,
// walk, attack, damage, down and glad clip at most, 512px textures, meshopt compression) and
// packs them two to a file as models3d/<chunk>.js next to the page, each a call to
// __pbModels({id: base64Glb}). Species without a model keep the generated figure from
// figure3d.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODEL_INDEX } from './models3d.js';
import { bodyOf, fitScale } from './body.js';

export const hasModel = (id) => MODEL_INDEX[id] != null;

const bank = { glb: {}, chunks: {} };
if (typeof window !== 'undefined') window.__pbModels = (m) => { Object.assign(bank.glb, m); };

function loadChunk(c) {
  if (bank.chunks[c] || typeof document === 'undefined') return;
  bank.chunks[c] = 'loading';
  const s = document.createElement('script');
  s.src = `models3d/${c}.js`;
  s.async = true;
  s.onload = () => { bank.chunks[c] = 'ready'; };
  s.onerror = () => { bank.chunks[c] = 'failed'; };
  document.head.appendChild(s);
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const templates = new Map();

function b64ToBuffer(b64) {
  const bin = atob(b64), n = bin.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// The template for a species: { ready, failed, scene, clips, scale, offset, height, width, depth }.
// Call every frame until ready; it starts the chunk download and parses once it has arrived.
export function modelTemplate(id) {
  let T = templates.get(id);
  if (!T) { T = { id, ready: false, failed: false, parsing: false, version: 1 }; templates.set(id, T); }
  if (T.ready || T.failed || T.parsing) return T;
  const c = MODEL_INDEX[id];
  if (c == null) { T.failed = true; return T; }
  if (bank.chunks[c] === 'failed') { T.failed = true; return T; }
  const b64 = bank.glb[id];
  if (!b64) { loadChunk(c); return T; }
  T.parsing = true;
  loader.parse(b64ToBuffer(b64), '', (gltf) => {
    delete bank.glb[id];
    try { finish(T, gltf); } catch (e) { console.warn('model', id, e); T.failed = true; }
    T.parsing = false;
  }, (e) => { console.warn('model', id, e); T.failed = true; T.parsing = false; });
  return T;
}

function finish(T, gltf) {
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // Game models are authored for toon shading; keep them readable under the stadium
        // lights: no metal, soft roughness, textures in sRGB.
        if (m.metalness != null) m.metalness = 0;
        if (m.roughness != null) m.roughness = Math.max(0.55, m.roughness);
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.side = THREE.FrontSide;
      }
    }
  });
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  for (const k of ['idle', 'walk', 'run']) if (clips[k]) stripRootMotion(clips[k]);
  // Measure in the idle pose: skinned bounds follow the bones.
  const probe = cloneSkinned(scene);
  if (clips.idle) { const mx = new THREE.AnimationMixer(probe); mx.clipAction(clips.idle).play(); mx.update(0.01); }
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3();
  probe.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); }
    else if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = (o.isSkinnedMesh ? o.boundingBox : o.geometry.boundingBox).clone().applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  const size = box.getSize(new THREE.Vector3());
  // Species height, but never wider or longer than the collision capsule (see body.js).
  const s = fitScale(bodyOf(T.id), size.x, size.y, size.z);
  Object.assign(T, {
    ready: true, scene, clips, scale: s,
    offset: new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2),
    height: size.y * s, width: size.x * s, depth: size.z * s,
  });
}

// Many run and walk clips carry root motion: the model's origin (or hips) travels forward over
// the clip and jumps back when it loops. The simulation already moves the player, so that
// drift is taken out of every looping clip: each position track loses its straight-line travel
// from first key to last and keeps only the bob and sway around it, so the loop closes.
function stripRootMotion(clip) {
  for (const tr of clip.tracks) {
    if (!tr.name.endsWith('.position')) continue;
    const t = tr.times, v = tr.values, n = t.length, w = v.length / n;
    if (n < 2 || w !== 3) continue;
    const span = t[n - 1] - t[0];
    if (!(span > 0)) continue;
    const d = [0, 1, 2].map((c) => v[(n - 1) * 3 + c] - v[c]);
    if (Math.hypot(...d) < 1e-6) continue;
    for (let i = 0; i < n; i++) {
      const u = (t[i] - t[0]) / span;
      for (let c = 0; c < 3; c++) v[i * 3 + c] -= d[c] * u;
    }
  }
}

// One player's instance: group (yards) > pivot (whole-body lean, lift) > model (scaled).
export function makeModelFigure(T) {
  const model = cloneSkinned(T.scene);
  model.position.copy(T.offset);
  const scaled = new THREE.Group();
  scaled.scale.setScalar(T.scale);
  scaled.add(model);
  const pivot = new THREE.Group();
  pivot.add(scaled);
  const group = new THREE.Group();
  group.add(pivot);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [k, c] of Object.entries(T.clips)) actions[k] = mixer.clipAction(c);
  const fig = { model: true, group, pivot, root: model, mixer, actions, cur: null, version: T.version, template: T, limbW: 0 };
  fig.rig = buildRig(model);
  fig.hipH = fig.rig?.legs ? Math.max(0, (fig.rig.hipY + T.offset.y) * T.scale) : 0;
  playClip(fig, 'idle', 0);
  return fig;
}

// ---------- procedural limbs ----------
// Most models come without clips, and many with clips have no run, so their own skeletons
// are driven here: legs stride with the gait (thighs swing, knees fold on the way through),
// arms or front legs swing against them, tails sway in a wave down the chain, wings flap,
// the spine counter-twists and the head steadies itself. Every rotation is about a body axis
// (side to side, up, forward) expressed in the bone's parent frame, so it works whatever the
// rig's own bone axes are. Bones are recognized by name across the naming schemes these rigs
// use (LThigh, left_leg_01, Bip001 L Thigh, thigh.L, HindLegL, ...), and left or right by name
// or, failing that, by which side of the body they sit on.
const SKIP = /feeler|finger|toe|hair|eyelid|eye|jaw|ear|mouth|tongue|teeth|beak|horn|cloth|ik|pole|mch|vis_|end$|_end|eff|camera|light|lod|nail|claw|thumb|index|middle|ring|pinky|wide/;
const PARTS = [
  ['leg', /thigh|upper_?leg|hind_?leg|leg|calf|shin|knee|foot/],
  ['arm', /shoulder|upper_?arm|fore_?arm|arm|front_?leg|hand|clavicle/],
  ['wing', /wing/],
  ['tail', /tail/],
  ['neck', /neck/],
  ['head', /^head$|^head_|_head$|head\b/],
  ['spine', /spine|chest|waist|pelvis|hips?$/],
];
function normName(n) {
  return n.replace(/^\d+\s+/, '').replace(/^bip\d*\s*/i, '').replace(/^(def|org)[-_]/i, '').replace(/[\s.\-]+/g, '_')
    .replace(/_\d+$/, (m) => (m.length > 3 ? '' : m)).toLowerCase();
}
function sideOf(raw, n) {
  if (/^L[A-Z_]/.test(raw.replace(/^\d+\s+|^Bip\d*\s*/, '')) || /(^|_)(l|left)(_|$)|^left|_l$|left_/.test(n)) return 1;
  if (/^R[A-Z_]/.test(raw.replace(/^\d+\s+|^Bip\d*\s*/, '')) || /(^|_)(r|right)(_|$)|^right|_r$|right_/.test(n)) return -1;
  return 0;
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
function buildRig(model) {
  const bones = [];
  model.traverse((o) => { if (o.isBone) bones.push(o); });
  if (!bones.length) return null;
  model.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const info = new Map();
  for (const b of bones) {
    const n = normName(b.name);
    let part = null;
    if (!SKIP.test(n)) for (const [k, re] of PARTS) if (re.test(n)) { part = k; break; }
    info.set(b, { part, n });
  }
  // Body center, to tell front from back and left from right when names do not.
  const ctr = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  let nb = 0;
  for (const b of bones) { tmp.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv); ctr.add(tmp); nb++; }
  ctr.divideScalar(nb || 1);
  const out = [];
  const axisIn = (parent, axis) => {
    // A model-space axis expressed in the parent's frame.
    parent.getWorldQuaternion(_q);
    model.getWorldQuaternion(_q2);
    _q.premultiply(_q2.invert());
    return axis.clone().applyQuaternion(_q.invert()).normalize();
  };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  for (const b of bones) {
    const I = info.get(b);
    if (!I.part || !b.parent) continue;
    const pI = info.get(b.parent);
    // Chain depth within the same part: 0 at the root of a leg, arm, tail or wing.
    let depth = 0, p = b.parent;
    while (p && info.get(p)?.part === I.part) { depth++; p = p.parent; }
    if ((I.part === 'leg' || I.part === 'arm') && depth > 1) continue;
    if (I.part === 'wing' && depth > 1) continue;
    if (I.part === 'spine' && pI?.part === 'spine') continue;
    if ((I.part === 'neck' || I.part === 'head') && depth > 0) continue;
    tmp.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv);
    let side = sideOf(b.name, I.n);
    if (!side && Math.abs(tmp.x - ctr.x) > 1e-4) side = tmp.x > ctr.x ? 1 : -1;
    const rest = b.quaternion.clone();
    // Rigs bound in a T-pose would carry their arms straight out: let them hang.
    const kid = b.children.find((c) => c.isBone);
    if (I.part === 'arm' && depth === 0 && kid && side) {
      tmp2.setFromMatrixPosition(kid.matrixWorld).applyMatrix4(rootInv).sub(tmp);
      const len = tmp2.length();
      if (len > 1e-6 && Math.abs(tmp2.x) / len > 0.8 && tmp2.x * side > 0) rest.premultiply(_q.setFromAxisAngle(axisIn(b.parent, Z), -side * 1.05));
    }
    out.push({
      bone: b, n: I.n, part: I.part, depth, side, front: tmp.z > ctr.z, y: tmp.y,
      rest, lat: axisIn(b.parent, X), up: axisIn(b.parent, Y), fwd: axisIn(b.parent, Z),
    });
  }
  // Hands: the end of each arm chain, where the football sits.
  const hands = {};
  for (const b of bones) {
    if (info.get(b).part !== 'arm' || info.get(b.parent)?.part === 'arm') continue;
    let end = b, depth = 0;
    for (;;) {
      const kid = end.children.find((c) => c.isBone && info.get(c)?.part === 'arm');
      if (!kid || depth > 5) break;
      end = kid; depth++;
    }
    tmp.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv);
    let side = sideOf(b.name, info.get(b).n);
    if (!side) side = tmp.x > ctr.x ? 1 : -1;
    const k = side > 0 ? 'L' : 'R';
    if (!hands[k] || depth > hands[k].depth) hands[k] = { bone: end, depth };
  }
  const legRoots = out.filter((e) => e.part === 'leg' && e.depth === 0), armRoots = out.filter((e) => e.part === 'arm' && e.depth === 0);
  const top = Math.max(1e-6, ...bones.map((b) => tmp.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv).y));
  const avgY = (l) => l.reduce((a, e) => a + e.y, 0) / (l.length || 1);
  // Four-legged: the "arms" are front legs at about the height of the hind ones. Those get
  // no raised blocking arms or overhead reach, the head and chest go down instead.
  const quad = legRoots.length >= 2 && armRoots.length >= 2 && avgY(armRoots) - avgY(legRoots) < top * 0.15;
  return { bones: out, legs: legRoots.length, arms: armRoots.length, quad, hipY: legRoots.length ? avgY(legRoots) : 0, hands: { R: hands.R?.bone ?? null, L: hands.L?.bone ?? null },
    maxTail: Math.max(1, ...out.filter((e) => e.part === 'tail').map((e) => e.depth + 1)) };
}

// Reset the driven bones to rest before the mixer runs, so bones no clip animates do not drift.
export function resetLimbs(fig) {
  if (!fig.rig) return;
  for (const e of fig.rig.bones) e.bone.quaternion.copy(e.rest);
}

// Football poses on the model's own skeleton, on top of the clip and the stride: a crouch
// (thighs forward, knees bent), a lean from the spine, arms out front to block or down to the
// turf in a three-point stance, reaching up for a catch, the ball tucked, and the throwing arm
// (cocked by the ear, whipping through). Four-legged rigs lower the chest and head instead of
// raising front legs. q: see Animator.football.
export function poseLimbs(fig, q) {
  const R = fig.rig;
  if (!R || !q) return;
  const rot = (e, axis, ang) => { if (Math.abs(ang) < 1e-4) return; _q.setFromAxisAngle(axis, ang); e.bone.quaternion.premultiply(_q); };
  const quad = R.quad;
  for (const e of R.bones) {
    const right = e.side < 0;
    switch (e.part) {
      case 'spine':
        rot(e, e.lat, q.lean * (quad ? 0.25 : 0.55));
        rot(e, e.up, q.twist * 0.6);
        break;
      case 'neck': case 'head':
        // Eyes stay up the field even when the body leans.
        rot(e, e.lat, quad ? q.lean * 0.4 : -q.lean * 0.35);
        break;
      case 'leg':
        if (e.depth === 0) rot(e, e.lat, -q.crouch * (quad && e.front ? 0.2 : 0.55));
        else rot(e, e.lat, q.crouch * (quad && e.front ? 0.3 : 0.85));
        break;
      case 'arm': {
        if (quad) { if (e.depth === 0) rot(e, e.lat, -q.crouch * 0.3 - q.armsFwd * 0.2); else rot(e, e.lat, q.crouch * 0.45); break; }
        if (e.depth === 0) {
          let a = -q.armsFwd * 1.25 - q.reach * 2.5;
          if (right) a += -q.down * 0.9 - q.carry * 0.7 + q.throwArm;
          rot(e, e.lat, a);
          if (right && q.carry) rot(e, e.fwd, -q.carry * 0.5);
        } else rot(e, e.lat, -(q.armsFwd * 0.35 + (right ? q.carry * 1.1 + Math.max(0, -q.throwArm) * 0.4 : 0)));
        break;
      }
      case 'tail': rot(e, e.lat, -q.crouch * 0.15); break;
      default: break;
    }
  }
}

// Add the procedural motion on top of whatever the clip set this frame.
// g: { phase (gait radians), run (0..1 stride amount), t (seconds), flap (0..1), weight (0..1) }
export function driveLimbs(fig, g) {
  const R = fig.rig;
  if (!R || g.weight < 0.01) return;
  const w = g.weight, A = g.run, ph = g.phase, t = g.t;
  const rot = (e, axis, ang) => { if (Math.abs(ang) < 1e-4) return; _q.setFromAxisAngle(axis, ang); e.bone.quaternion.premultiply(_q); };
  for (const e of R.bones) {
    const left = e.side >= 0;
    switch (e.part) {
      case 'leg': {
        // Left and right in opposite phase; a hind leg pairs with the opposite front leg.
        const p = ph + (left ? 0 : Math.PI) + (/front|fore/.test(e.n) ? Math.PI : 0);
        if (e.depth === 0) rot(e, e.lat, -Math.sin(p) * 0.62 * A * w);
        else rot(e, e.lat, Math.max(0, Math.cos(p)) * 0.9 * A * w);
        break;
      }
      case 'arm': {
        const p = ph + (left ? Math.PI : 0);
        const quad = R.legs >= 2 && R.arms >= 2 && e.front;
        if (e.depth === 0) rot(e, e.lat, -Math.sin(p) * (quad ? 0.55 : 0.42) * A * w + Math.sin(t * 1.8) * 0.03 * w);
        else rot(e, e.lat, (quad ? Math.max(0, Math.cos(p)) * 0.6 * A : 0.25 * A) * w);
        break;
      }
      case 'wing': {
        const sp = g.flap > 0 ? 9 + 6 * A : 2.2;
        const amp = (g.flap > 0 ? 0.55 : 0.08 + 0.2 * A) * w;
        rot(e, e.fwd, (e.side || 1) * Math.sin(t * sp + e.depth * 0.6) * amp);
        break;
      }
      case 'tail': {
        // A wave down the tail, faster and wider at speed.
        const k = (e.depth + 1) / R.maxTail;
        rot(e, e.up, Math.sin(t * (2 + 5 * A) - e.depth * 0.55 + ph * 0.5) * (0.06 + 0.14 * A) * w * (0.6 + k));
        rot(e, e.lat, Math.sin(ph * 2 - e.depth * 0.4) * 0.05 * A * w);
        break;
      }
      case 'spine':
        rot(e, e.up, Math.sin(ph) * 0.1 * A * w);
        rot(e, e.lat, Math.sin(t * 1.9) * 0.02 * w);
        break;
      case 'neck':
      case 'head':
        rot(e, e.up, -Math.sin(ph) * 0.07 * A * w);
        rot(e, e.lat, (Math.sin(ph * 2) * 0.05 * A + Math.sin(t * 0.7) * 0.03) * w);
        break;
    }
  }
}

// Cross-fade to a role's clip ('idle', 'run', 'walk', 'attack', 'damage', 'down', 'glad');
// roles the model has no clip for fall back to the nearest one it has.
const FALLBACK = { run: ['run', 'walk', 'idle'], walk: ['walk', 'run', 'idle'], attack: ['attack', 'idle'], damage: ['damage', 'idle'], down: ['down', 'damage', 'idle'], glad: ['glad', 'idle'], idle: ['idle'] };
export function playClip(fig, role, fade = 0.2, speed = 1) {
  const pick = (FALLBACK[role] ?? [role]).find((r) => fig.actions[r]);
  if (!pick) return null;
  const a = fig.actions[pick];
  a.timeScale = speed;
  if (fig.cur === a) return pick;
  const once = pick === 'down' || pick === 'damage' || pick === 'attack';
  a.reset();
  a.setLoop(once && pick !== 'attack' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = true;
  a.play();
  if (fig.cur && fade > 0) fig.cur.crossFadeTo(a, fade, false);
  else if (fig.cur) fig.cur.stop();
  fig.cur = a;
  return pick;
}

export function disposeModelFigure(f) {
  f.mixer.stopAllAction();
  f.mixer.uncacheRoot(f.root);
  f.group.removeFromParent();
}
