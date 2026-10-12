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
import { bodyOf } from './body.js';

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
  const B = bodyOf(T.id);
  // Species height in yards, shrunk if the body would not fit its footprint (long Pokémon).
  let s = B.height / Math.max(1e-6, size.y);
  const maxLen = Math.max(B.r * 2 * 1.9, 1.5);
  const len = Math.max(size.x, size.z);
  if (len * s > maxLen) s = maxLen / len;
  Object.assign(T, {
    ready: true, scene, clips, scale: s,
    offset: new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2),
    height: size.y * s, width: size.x * s, depth: size.z * s,
  });
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
  const fig = { model: true, group, pivot, root: model, mixer, actions, cur: null, version: T.version, template: T };
  playClip(fig, 'idle', 0);
  return fig;
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
