// Real 3D Pokémon models.
//
// The models come from the Pokémon 3D API asset collection (github.com/Pokemon-3D-api/assets),
// which gathers fan-extracted models of the official Pokémon game models from Sketchfab. They
// are Nintendo / Creatures / GAME FREAK property like the pixel sprites this game already
// uses; see README for the details. build/build_models3d.mjs converts them (one idle, run,
// walk, attack, damage, down and glad clip at most, 512px textures, meshopt compression) and
// packs them two to a file as models3d/<chunk>.js next to the page, each a call to
// __pbModels({id: base64Glb}). Species without a model are not in the game (ratings.js
// ALL_IDS); the generated figure from figure3d.js only stands in while a model loads.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODEL_INDEX } from './models3d.js';
import { bodyOf, fitModel, setMeasured } from './body.js';
import { PLAYERS } from './ratings.js';
import { FIX } from './modelfix.js';
import { autoRig, coilBody, unskin } from './autorig.js';
import { prepareEyes, attachBlink } from './blink.js';

export const hasModel = (id) => MODEL_INDEX[id] != null;

const bank = { glb: {}, chunks: {} };
if (typeof window !== 'undefined') window.__pbModels = (m) => { Object.assign(bank.glb, m); };

// Which chunk files are actually next to the page. Missing models fall back to the generated
// figure without a 404 for every species.
let modelFiles = null;
function filesPresent() {
  if (!modelFiles) {
    modelFiles = fetch('models3d/index.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
      modelFiles = new Set(Array.isArray(list) ? list : []);
      return modelFiles;
    }).catch(() => { modelFiles = new Set(); return modelFiles; });
  }
  return modelFiles;
}
function loadChunk(c) {
  if (bank.chunks[c] || typeof document === 'undefined') return;
  bank.chunks[c] = 'loading';
  const start = (ok) => {
    if (!ok) { bank.chunks[c] = 'failed'; return; }
    const s = document.createElement('script');
    s.src = `models3d/${c}.js`;
    s.async = true;
    s.onload = () => { bank.chunks[c] = 'ready'; };
    s.onerror = () => { bank.chunks[c] = 'failed'; };
    document.head.appendChild(s);
  };
  const known = modelFiles instanceof Set ? modelFiles : null;
  if (known) { start(known.has(`${c}.js`)); return; }
  filesPresent().then((set) => start(set.has(`${c}.js`))).catch(() => { bank.chunks[c] = 'failed'; });
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
  cleanMeshes(scene, FIX[T.id]);
  if (FIX[T.id]?.bones === false) unskin(scene);
  if (FIX[T.id]?.rot) {
    const g = new THREE.Group();
    g.rotation.set(...FIX[T.id].rot);
    for (const c of [...scene.children]) g.add(c);
    scene.add(g);
    scene.updateMatrixWorld(true);
  }
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
        // Some exports mark the whole body as alpha-blended (the texture's alpha holds a
        // shading mask, not transparency), which draws Corviknight and Quaquaval see-through
        // and out of order. Bodies are drawn solid.
        if (m.transparent && !/glass|aura|effect|fx/i.test(m.name)) { m.transparent = false; m.depthWrite = true; }
        // Flames come as a dark texture whose alpha is the shape (the games color them in a
        // shader): drawn glowing, orange or a ghost's violet, cut out by that alpha.
        if (/fire|flame/i.test(m.name) && m.emissive) {
          m.emissive.set(PLAYERS[T.id]?.types.includes('Ghost') ? '#7a63ff' : '#ff8a1e');
          m.emissiveIntensity = 1.1;
          if (m.map) m.alphaTest = 0.3;
        }
      }
    }
  });
  // Bare meshes get a skeleton built for them (autorig.js).
  let bones = 0;
  scene.traverse((o) => { if (o.isBone) bones++; });
  if (!bones) T.autoRig = autoRig(scene, !!PLAYERS[T.id]?.types.includes('Flying'));
  const clips = {};
  if (FIX[T.id]?.clips !== false) for (const c of gltf.animations) clips[c.name] = c;
  for (const k of ['idle', 'walk', 'run']) if (clips[k]) stripRootMotion(clips[k]);
  dropBrokenClips(scene, clips);
  // Long straight bodies are coiled (a clip would pose them itself).
  if (!clips.idle) T.coiled = coilBody(scene, posedPoints(scene, null).pts);
  // Measure in the idle pose, from the posed vertices themselves (skinned ones follow the
  // bones): the feet, the height of the body without the last few percent of spikes and wing
  // tips, the core of the mass (the middle 80% of the vertices to the side and front to back)
  // and the tips of everything (but a stray vertex or two). The model is centered on its core,
  // so a long tail does not push the body off its spot.
  const { xs, ys, zs } = posedPoints(scene, clips.idle);
  const yMin = ys[0], yTop = q(ys, 0.97);
  const cx = (q(xs, 0.1) + q(xs, 0.9)) / 2, cz = (q(zs, 0.1) + q(zs, 0.9)) / 2;
  const core = { side: Math.max(cx - q(xs, 0.1), q(xs, 0.9) - cx), front: q(zs, 0.9) - cz, back: cz - q(zs, 0.1) };
  const tips = { side: Math.max(cx - q(xs, 0.002), q(xs, 0.998) - cx), front: q(zs, 0.998) - cz, back: cz - q(zs, 0.002) };
  const B = bodyOf(T.id);
  prepareEyes(scene, yTop - yMin);
  const s = fitModel(B, yTop - yMin, core, tips);
  // The footprint formations space this Pokémon by: what is actually drawn.
  const gw = T.coiled ? 1 : B.girth ?? 1; // a coiled serpent has its girth already
  setMeasured(T.id, tips.side * s * gw, tips.front * s * gw, tips.back * s * gw);
  Object.assign(T, {
    ready: true, scene, clips, scale: s, girth: gw,
    offset: new THREE.Vector3(-cx, -yMin, -cz),
    height: (yTop - yMin) * s, fullHeight: (ys[ys.length - 1] - yMin) * s, width: tips.side * 2 * s * gw, depth: (tips.front + tips.back) * s * gw,
  });
}

const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.floor(f * (a.length - 1))))];

// The model's vertices as drawn in a pose (a clip at time t, or the bind pose), sorted along
// each axis, about 9000 of them; with perMesh, each visible mesh's bounds as well.
function posedPoints(scene, clip, t = 0.01, perMesh = false) {
  const probe = cloneSkinned(scene);
  if (clip) { const mx = new THREE.AnimationMixer(probe); mx.clipAction(clip).play(); mx.update(t); }
  probe.updateMatrixWorld(true);
  const src = [], dst = [];
  scene.traverse((o) => { if (o.isMesh) src.push(o); });
  probe.traverse((o) => { if (o.isMesh) dst.push(o); });
  let total = 0;
  for (const o of dst) if (o.visible) total += o.geometry.attributes.position.count;
  const stride = Math.max(1, Math.floor(total / 9000));
  const xs = [], ys = [], zs = [], pts = [], boxes = [];
  const v = new THREE.Vector3();
  dst.forEach((o, k) => {
    if (!o.visible) return;
    if (o.isSkinnedMesh) o.skeleton.update();
    const pos = o.geometry.attributes.position, box = perMesh ? new THREE.Box3() : null;
    for (let i = 0; i < pos.count; i += perMesh ? Math.max(1, Math.floor(pos.count / 400)) : stride) {
      v.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      if (!Number.isFinite(v.x + v.y + v.z)) continue;
      if (box) box.expandByPoint(v);
      else { xs.push(v.x); ys.push(v.y); zs.push(v.z); pts.push(v.x, v.y, v.z); }
    }
    if (box) boxes.push({ mesh: src[k], box, n: pos.count });
  });
  for (const a of [xs, ys, zs]) a.sort((m, n) => m - n);
  return { xs, ys, zs, pts, boxes };
}

// Some clips throw the body apart (Marshadow's idle flings its vertices twenty yards out):
// a clip whose pose spreads the body to well over twice its bind-pose size is dropped.
function dropBrokenClips(scene, clips) {
  const size = (P) => Math.max(q(P.xs, 0.98) - q(P.xs, 0.02), q(P.ys, 0.98) - q(P.ys, 0.02), q(P.zs, 0.98) - q(P.zs, 0.02));
  const bind = size(posedPoints(scene, null));
  for (const [k, c] of Object.entries(clips)) {
    const worst = Math.max(...[0.25, 0.75].map((f) => size(posedPoints(scene, c, Math.max(0.01, c.duration * f)))));
    if (!(worst < bind * 2.5)) delete clips[k];
  }
}

// What the exports carry besides the Pokémon: lower-detail copies of the body (LOD meshes,
// all drawn on top of each other), and shadow discs or other untextured helper meshes left
// unskinned in a skinned model (Marshadow stands on a black disc).
function cleanMeshes(scene, fix) {
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (fix?.hide) for (const o of meshes) if (fix.hide.test(o.name) || [].concat(o.material).some((m) => fix.hide.test(m.name))) o.visible = false;
  const skinned = meshes.some((o) => o.isSkinnedMesh);
  const lod = (o) => /(^|[_\s.])lod\d|_lod_?\d/i.test(o.name) || [].concat(o.material).some((m) => /lod\d/i.test(m.name));
  // (Some exports hold only the lower-detail meshes: those stay.)
  const full = meshes.some((o) => !lod(o));
  for (const o of meshes) {
    const mats = [].concat(o.material);
    const helper = skinned && !o.isSkinnedMesh && mats.every((m) => !m.map && !o.geometry.attributes.color);
    if ((full && lod(o)) || helper || /shadow|(^|_)shdw|(^|_)ball_?shape/i.test(o.name)) o.visible = false;
  }
  // Repeated bodies: meshes with the same materials and the same bounds as a bigger one.
  // Bounds as drawn (posed through the skin: a quantized skinned mesh's own box is just the
  // unit cube, so Starmie's rings would all look alike).
  const drawn = new Map(posedPoints(scene, null, 0.01, true).boxes.map((e) => [e.mesh, e.box]));
  const key = (o) => { const b = drawn.get(o); if (!b) return o.uuid;
    const c = b.getCenter(_v), z = b.getSize(_v2);
    return [...[].concat(o.material).map((m) => m.uuid), ...[c.x, c.y, c.z, z.x, z.y, z.z].map((x) => x.toFixed(3))].join(); };
  const best = new Map();
  for (const o of meshes) {
    if (!o.visible) continue;
    const k = key(o), n = o.geometry.attributes.position.count, b = best.get(k);
    if (!b) best.set(k, o);
    else if (n > b.geometry.attributes.position.count) { b.visible = false; best.set(k, o); } else o.visible = false;
  }
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
  scaled.scale.set(T.scale * (T.girth ?? 1), T.scale, T.scale * (T.girth ?? 1));
  scaled.add(model);
  const pivot = new THREE.Group();
  pivot.add(scaled);
  const group = new THREE.Group();
  group.add(pivot);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [k, c] of Object.entries(T.clips)) actions[k] = mixer.clipAction(c);
  const fig = { model: true, group, pivot, root: model, mixer, actions, cur: null, version: T.version, template: T, limbW: 0 };
  fig.rig = buildRig(model, T.id);
  attachBlink(fig);
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
// Whole words only: "ear" must not catch a forearm, nor "ik" a spike, nor "ring" a spring.
const SKIP = /feeler|feather|camtgt|skin(_|\d|$)|(^|_)loc(_|$)|finger|toe|hair|eyelid|eye|jaw|mouth|tongue|teeth|beak|horn|cloth|camera|light|nail|claw|thumb|index|middle|pinky|wide|(^|_)[lr]?ears?(_|\d|$)|(^|_)(left|right)_ear|(^|_)[lr]?ring(_|\d|$)|(^|_)(ik|pole|mch|lod\d*)(_|$)|^vis_|^eff|_eff|^end|end$|_end/;
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

// Birds whose wings are rigged as arms (Ho-Oh, Pidgeot, Aerodactyl: a shoulder, arm and hand
// with the flight feathers hanging off them). Those chains are wings: they are not let down
// to hang at the sides or pumped like a runner's arms, they beat. Told by wing bones further
// down the chain, or by a flying species whose arm chain reaches well out from the shoulder
// (over 60% of the skeleton's height; real arms reach 30 to 50%). Articuno and Zapdos have
// short wing chains, so they are named.
const WING_ARMS = new Set([144, 145]);
function wingArms(bones, info, rootInv, id) {
  const P = PLAYERS[id], flying = !!P?.types.includes('Flying');
  const pos = (b) => _v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv);
  let top = -Infinity, bot = Infinity;
  for (const b of bones) { const y = pos(b).y; top = Math.max(top, y); bot = Math.min(bot, y); }
  const span = Math.max(1e-6, top - bot);
  const hasWings = bones.some((b) => info.get(b).part === 'wing');
  for (const b of bones) {
    if (info.get(b).part !== 'arm' || info.get(b.parent)?.part === 'arm') continue;
    const chain = [], p0 = pos(b).clone();
    let reach = 0, wingBelow = false;
    b.traverse((c) => {
      if (!c.isBone) return;
      if (/wing/i.test(c.name)) wingBelow = true;
      reach = Math.max(reach, pos(c).distanceTo(p0));
      if (info.get(c)?.part === 'arm') chain.push(c);
    });
    if (wingBelow || WING_ARMS.has(id) || (flying && !hasWings && reach / span > 0.6)) for (const c of chain) info.get(c).part = 'wing';
  }
}

function buildRig(model, id) {
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
  wingArms(bones, info, rootInv, id);
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
    if ((I.part === 'leg' && depth > 1) || (I.part === 'arm' && depth > 2)) continue;
    if (I.part === 'wing' && depth > 2) continue;
    if (I.part === 'spine' && pI?.part === 'spine') continue;
    if ((I.part === 'neck' || I.part === 'head') && depth > 0) continue;
    tmp.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv);
    let side = sideOf(b.name, I.n);
    if (!side && Math.abs(tmp.x - ctr.x) > 1e-4) side = tmp.x > ctr.x ? 1 : -1;
    const rest = b.quaternion.clone();
    // Rigs bound in a T-pose would carry their arms straight out: let them hang.
    const kid = b.children.find((c) => c.isBone);
    // (Not a collar or shoulder bone: turning one of those that far wrenches the whole torso
    // off some rigs, Buzzwole's among them; hangArms lets the arm itself down.)
    if (I.part === 'arm' && depth === 0 && kid && side && !/clavicle|shoulder/.test(I.n)) {
      tmp2.setFromMatrixPosition(kid.matrixWorld).applyMatrix4(rootInv).sub(tmp);
      const len = tmp2.length();
      if (len > 1e-6 && Math.abs(tmp2.x) / len > 0.8 && tmp2.x * side > 0) rest.premultiply(_q.setFromAxisAngle(axisIn(b.parent, Z), -side * 1.05));
    }
    out.push({
      bone: b, n: I.n, part: I.part, depth, side, front: tmp.z > ctr.z, y: tmp.y, z: tmp.z,
      rest, lat: axisIn(b.parent, X), up: axisIn(b.parent, Y), fwd: axisIn(b.parent, Z), kid: b.children.find((c) => c.isBone) ?? null,
    });
  }
  // The upper arm of each side, the bone hangArms aims: past a clavicle or shoulder bone.
  for (const e of out) {
    if (e.part !== 'arm' || !e.kid || !e.side || /hand|wrist|palm/.test(e.n)) continue;
    const collar = /clavicle|shoulder/.test(e.n);
    if (e.depth === 0 ? !collar || !out.some((o) => o.part === 'arm' && o.depth === 1 && o.bone.parent === e.bone) : out.some((o) => o.bone === e.bone.parent && /clavicle|shoulder/.test(o.n))) e.upper = true;
  }
  // Each arm bone's segment: 0 the upper arm (it swings), 1 the forearm (it bends), -1 a
  // collar or shoulder bone above the upper arm (it shrugs). Rigs with a clavicle start the
  // arm one bone higher, so the chain depth alone would swing the collar and bend the upper arm.
  for (const e of out) {
    if (e.part !== 'arm') continue;
    const pe = out.find((o) => o.bone === e.bone.parent);
    if (e.upper) e.seg = 0;
    else if (pe?.upper) e.seg = 1;
    else if (out.some((o) => o.upper && o.bone.parent === e.bone)) e.seg = -1;
    else if (pe?.part === 'arm' && pe.seg === 1) e.seg = 2;
    else e.seg = e.depth;
  }
  // Each upper arm's reach (to the farthest bone down its chain), so a long arm can be let
  // down without going into the ground.
  for (const e of out) {
    if (!e.upper) continue;
    tmp.setFromMatrixPosition(e.bone.matrixWorld).applyMatrix4(rootInv);
    let far = 0;
    e.bone.traverse((c) => { if (c.isBone && info.get(c)?.part === 'arm') far = Math.max(far, tmp2.setFromMatrixPosition(c.matrixWorld).applyMatrix4(rootInv).distanceTo(tmp)); });
    e.reach = far;
  }
  // Wing tips: the farthest wing bone from each wing's root.
  for (const e of out) {
    if (e.part !== 'wing' || e.depth !== 0) continue;
    tmp.setFromMatrixPosition(e.bone.matrixWorld);
    let far = 0;
    e.bone.traverse((c) => { if (!c.isBone || c === e.bone) return; const d = tmp2.setFromMatrixPosition(c.matrixWorld).distanceTo(tmp); if (d > far) { far = d; e.tip = c; } });
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
  // A biped's arms and legs are at the same depth; four legs stand apart front to back.
  const avgZ = (l) => l.reduce((a, e) => a + e.z, 0) / (l.length || 1);
  const quad = legRoots.length >= 2 && armRoots.length >= 2 && avgY(armRoots) - avgY(legRoots) < top * 0.15 && Math.abs(avgZ(armRoots) - avgZ(legRoots)) > top * 0.12;
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
        if (e.seg < 0 || e.seg > 1) break;
        if (quad) { if (e.seg === 0) rot(e, e.lat, -q.crouch * 0.3 - q.armsFwd * 0.2); else rot(e, e.lat, q.crouch * 0.45); break; }
        if (e.seg === 0) {
          let a = -q.armsFwd * 1.25 - q.reach * 2.5;
          if (right) a += -q.down * 0.9 - q.carry * 0.7 + q.throwArm;
          rot(e, e.lat, a);
          if (right && q.carry) rot(e, e.fwd, -q.carry * 0.5);
        } else rot(e, e.lat, -(q.armsFwd * 0.35 + (right ? q.carry * 1.1 + Math.max(0, -q.throwArm) * 0.4 : 0)));
        break;
      }
      // Spread over the chain, so a long tail (Charizard has twelve bones) is not curled up over the back.
      case 'tail': rot(e, e.lat, (-q.crouch * 0.15 * 3) / Math.max(3, R.maxTail)); break;
      default: break;
    }
  }
}

// Let the upper arms hang at the sides, whatever the clip or bind pose holds them at (many
// models idle with arms spread wide, or are bound in a T-pose). Each upper arm is turned, by
// weight w, toward pointing down and a little out and forward; the football poses then work
// from there. Two-legged rigs only.
const _m = new THREE.Quaternion(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _id = new THREE.Quaternion();
export function hangArms(fig, w) {
  const R = fig.rig;
  if (!R || R.quad || w < 0.01) return;
  // Arms that are most of the body (Regieleki's, Tangrowth's vines: spread more than twice
  // as wide as the body is tall) stay as modelled.
  const T = fig.template;
  if (T && T.width > T.height * 2.2) return;
  const model = fig.root ?? null;
  for (const e of R.bones) {
    if (!e.upper) continue;
    const b = e.bone, par = b.parent;
    if (e.kid.position.lengthSq() < 1e-10) continue;
    par.updateWorldMatrix(true, false);
    // Parent frame -> model frame rotation.
    par.getWorldQuaternion(_m);
    if (model) { model.getWorldQuaternion(_q2); _m.premultiply(_q2.invert()); }
    _d.copy(e.kid.position).applyQuaternion(b.quaternion).normalize();
    // Down and a little out, or further out for arms longer than the shoulder is high
    // (Hypno's hands would reach the turf).
    const hgt = e.y + (T?.offset.y ?? 0), dy = e.reach > 0 && hgt > 0 ? Math.min(0.95, Math.max(0.3, hgt / e.reach)) : 0.95;
    const out = Math.sqrt(1 - dy * dy);
    _t.set(e.side * Math.max(0.3, out * 0.92), -dy, Math.max(0.17, out * 0.4)).normalize().applyQuaternion(_q2.copy(_m).invert());
    _q.setFromUnitVectors(_d, _t);
    _id.identity().slerp(_q, Math.min(1, w));
    b.quaternion.premultiply(_id);
  }
}

// Fold a standing bird's wings back along its body. Rigs are exported with the wings spread
// (Ho-Oh's reach out past its beak seen from the side), which on the ground reads as a bird
// in the middle of a crash. Each wing's root is turned, by weight w, so the line from the
// shoulder to the wing tip runs back, a little out and down; the beats work from there.
export function foldWings(fig, w) {
  const R = fig.rig;
  if (!R || R.legs < 2 || w < 0.01) return;
  const model = fig.root ?? null;
  for (const e of R.bones) {
    if (e.part !== 'wing' || e.depth !== 0 || !e.tip || !e.side) continue;
    const b = e.bone, par = b.parent;
    e.tip.updateWorldMatrix(true, false);
    // Parent frame -> model frame rotation, and the shoulder-to-tip line in the model frame.
    par.getWorldQuaternion(_m);
    if (model) { model.getWorldQuaternion(_q2); _m.premultiply(_q2.invert()); }
    _v.setFromMatrixPosition(b.matrixWorld); _d.setFromMatrixPosition(e.tip.matrixWorld).sub(_v);
    if (model) _d.applyQuaternion(_q2);
    if (_d.lengthSq() < 1e-12) continue;
    _d.normalize();
    _t.set(e.side * 0.42, -0.3, -1).normalize();
    // Swing it round the body's up axis first (a wing spread forward goes back the way a
    // wing folds, not over the top), then tilt it the rest of the way.
    const turn = Math.atan2(_t.x, _t.z) - Math.atan2(_d.x, _d.z);
    _q.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(Math.sin(turn), Math.cos(turn)));
    _d.applyQuaternion(_q);
    _q.premultiply(_q2.setFromUnitVectors(_d, _t));
    // Into the parent's frame: m^-1 * q * m.
    _q.premultiply(_q2.copy(_m).invert()).multiply(_m);
    _id.identity().slerp(_q, Math.min(1, w));
    b.quaternion.premultiply(_id);
  }
}

// Add the procedural motion on top of whatever the clip set this frame.
// g: { phase (gait radians), run (0..1 stride amount), t (seconds), flap (0..1), weight (0..1),
//      look (radians to turn the head toward the ball), calm (0..1: standing about), seed }
//
// Standing still is not standing frozen: the chest breathes, the arms hang loose and drift,
// the weight shifts from foot to foot, and every few seconds the Pokémon does something, from
// a set of small gestures picked by its seed: a glance around, a shoulder roll, a wave of
// one arm, a bounce on the knees, a wag of the tail or a ruffle of the wings.
const GESTURES = ['glance', 'shrug', 'wave', 'bounce', 'wag', 'ruffle']; // stretch: a wave of one arm
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function gestureAt(t, seed) {
  const period = 3 + hash(seed * 13) * 1.5, k = Math.floor((t + seed * 17) / period), u = ((t + seed * 17) / period - k) * period;
  const len = 1.7;
  if (u > len || hash(k + seed * 7) < 0.15) return null;
  return { kind: GESTURES[Math.floor(hash(k * 3.7 + seed) * GESTURES.length)], e: Math.sin((Math.PI * u) / len) ** 2, u: u / len, side: hash(k * 9.1 + seed) < 0.5 ? 1 : -1 };
}
export function driveLimbs(fig, g) {
  const R = fig.rig;
  if (!R) return;
  const w = g.weight, A = g.run, ph = g.phase, t = g.t, calm = (g.calm ?? 0) * w, look = g.look ?? 0;
  const rot = (e, axis, ang) => { if (Math.abs(ang) < 1e-4) return; _q.setFromAxisAngle(axis, ang); e.bone.quaternion.premultiply(_q); };
  const G = calm > 0.05 ? gestureAt(t, g.seed ?? 0) : null, ge = G ? G.e * calm : 0;
  const gk = G?.kind;
  const breath = Math.sin(t * 2.1 + (g.seed ?? 0) * 5);
  const heads = R.heads ?? (R.heads = R.bones.filter((e) => e.part === 'neck' || e.part === 'head').length);
  for (const e of R.bones) {
    const left = e.side >= 0, sd = e.side || 1;
    switch (e.part) {
      case 'leg': {
        // Left and right in opposite phase; a hind leg pairs with the opposite front leg.
        const p = ph + (left ? 0 : Math.PI) + (/front|fore/.test(e.n) ? Math.PI : 0);
        // Weight shifting from foot to foot, and a bounce on the knees.
        const shift = Math.max(0, Math.sin(t * 0.8 + (left ? 0 : Math.PI))) * 0.07 * calm + (gk === 'bounce' ? ge * 0.22 : 0);
        if (e.depth === 0) rot(e, e.lat, -Math.sin(p) * 0.62 * A * w - shift * 0.6);
        else rot(e, e.lat, Math.max(0, Math.cos(p)) * 0.9 * A * w + shift);
        break;
      }
      case 'arm': {
        const p = ph + (left ? Math.PI : 0);
        const quad = R.quad || (R.legs >= 2 && R.arms >= 2 && e.front);
        const mine = G && (G.side === sd);
        if (e.seg === -1) {
          // The collar: a shrug, or a roll of one shoulder.
          rot(e, e.fwd, -sd * ((gk === 'shrug' ? ge * 0.22 : 0) + breath * 0.015 * calm));
        } else if (e.seg === 0) {
          // Upper arm: swings against the legs; at rest it drifts and breathes out from the side.
          const drift = (Math.sin(t * 1.3 + sd * 1.7) * 0.07 + breath * 0.03) * calm;
          let a = -Math.sin(p) * (quad ? 0.55 : 0.5) * A * w + drift;
          if (!quad && mine && gk === 'wave') a -= ge * 0.35;
          if (!quad && gk === 'shrug') a -= ge * 0.12;
          rot(e, e.lat, a);
          // A wave: the arm comes up and out to the side.
          if (!quad) rot(e, e.fwd, sd * (breath * 0.04 * calm + (mine && gk === 'wave' ? ge * 1.25 : 0)));
        } else if (e.seg === 1) {
          // Forearm: front legs fold on the way through; elbows pump, and rest a little bent.
          if (quad) rot(e, e.lat, Math.max(0, Math.cos(p)) * 0.6 * A * w);
          else rot(e, e.lat, -(0.5 * A + 0.3 * A * Math.max(0, Math.sin(p))) * w - 0.22 * calm - (mine && gk === 'wave' ? ge * (0.7 + 0.35 * Math.sin(t * 11)) : 0) - Math.max(0, Math.sin(t * 1.1 + sd)) * 0.1 * calm);
        } else if (e.seg === 2) {
          // Hands and wrists swing loose.
          rot(e, e.lat, Math.sin(t * 1.6 + sd) * 0.08 * calm - 0.12 * A * w);
        }
        break;
      }
      case 'wing': {
        // Hovering: full beats. On foot: wings half open and beating with the stride, and at
        // rest a slow fold and breathe with a ruffle now and then.
        let sp, amp;
        if (g.flap > 0) { sp = 9 + 6 * A; amp = 0.6; } else { sp = 2 + 8 * A; amp = 0.03 + 0.35 * A; }
        let a = sd * Math.sin(t * sp + e.depth * 0.7) * amp * w;
        if (gk === 'ruffle') a += sd * Math.sin(t * 16 + e.depth) * 0.12 * ge;
        if (gk === 'wave' && e.depth === 0) a += sd * ge * 0.3;
        rot(e, e.fwd, a + sd * breath * 0.015 * calm);
        if (e.depth > 0) rot(e, e.fwd, sd * Math.sin(t * sp - 0.8 + e.depth * 0.7) * (amp - 0.03) * 0.5 * w);
        break;
      }
      case 'tail': {
        // A wave down the tail, faster and wider at speed, and a wag now and then.
        // The sway is shared out along the chain: a long tail bends as much in total as a short one.
        const k = (e.depth + 1) / R.maxTail, share = 4 / Math.max(4, R.maxTail);
        const wag = gk === 'wag' ? Math.sin(t * 9) * 0.35 * ge : 0;
        rot(e, e.up, (Math.sin(t * (1.6 + 5 * A) - e.depth * 0.55 + ph * 0.5) * (0.13 + 0.16 * A) * w + wag) * (0.6 + k) * share);
        rot(e, e.lat, (Math.sin(ph * 2 - e.depth * 0.4) * 0.07 * A * w + Math.sin(t * 1.1 - e.depth * 0.5) * 0.05 * calm) * share);
        break;
      }
      case 'spine':
        rot(e, e.up, Math.sin(ph) * 0.12 * A * w + (gk === 'glance' ? G.side * Math.sin(Math.PI * G.u) * 0.12 * ge : 0) + look * 0.15);
        rot(e, e.lat, breath * 0.03 * calm + Math.sin(t * 1.9) * 0.015 * w + (gk === 'wave' ? ge * 0.1 : 0) - (gk === 'bounce' ? ge * 0.06 : 0));
        break;
      case 'neck':
      case 'head': {
        // Turned toward the ball (shared between neck and head), glancing about, nodding with
        // the stride. The look is not scaled by the stride weight: a clip's head follows too.
        const share = 1 / Math.max(1, heads);
        const glance = gk === 'glance' ? G.side * Math.sin(2 * Math.PI * G.u) * 0.6 * ge : 0;
        rot(e, e.up, (-Math.sin(ph) * 0.07 * A * w + glance + Math.sin(t * 0.37 + sd) * 0.12 * calm) * share + look * 0.85 * share);
        rot(e, e.lat, (Math.sin(ph * 2) * 0.06 * A * w + Math.sin(t * 0.7) * 0.04 * w + breath * 0.02 * calm + (gk === 'shrug' ? ge * 0.1 : 0)) * share);
        rot(e, e.fwd, (Math.sin(t * 0.53 + 1) * 0.06 * calm + (gk === 'glance' ? G.side * 0.12 * ge : 0)) * share);
        break;
      }
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
  for (const m of f.blink?.mats ?? []) m.dispose();
  f.group.removeFromParent();
}
