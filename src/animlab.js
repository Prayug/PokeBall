// The animation lab (developer only: open the game with #animlab in the address). One Pokémon
// on an open patch of turf, driven through every animation state by the same code the game
// uses (Animator from anim3d.js, rigdrive.driveModel), with what decided its pose on show:
// species and body type, the skeleton the rig found and the bones it could not, the clips the
// model carries and the one playing at what weight, the procedural weights, warnings about
// the bind pose, and the ground: where the feet are, whether they float or sink, and how much
// they slide while planted.
//
// Everything is measured on the rendered mesh, not the bones: a sample of the skinned vertices
// is posed every frame, so a bone that turns but moves no skin counts for nothing.
//
// window.__pbLab.audit(ids, states) runs the same measurements headless over many species and
// returns them, for test/animaudit.mjs.
import * as THREE from 'three';
import { modelTemplate, makeModelFigure, disposeModelFigure, hasModel } from './model3d.js';
import { driveModel, bodyStyle } from './rigdrive.js';
import { Animator } from './anim3d.js';
import { ALL_IDS, PLAYERS } from './ratings.js';
import { bodyOf } from './body.js';

// The states the lab drives, each a synthetic situation (see Stage.situation in field3d.js)
// at time u seconds into the state. speed is a share of the Pokémon's top speed.
const TOP = 7.5;
export const LAB_STATES = {
  idle: { speed: 0, s: () => ({ mode: 'dead' }) },
  'stance-line': { speed: 0, s: (u) => ({ mode: 'pre', set: true, stance: 'line', cad: u, side: 'off' }) },
  'stance-qb': { speed: 0, s: (u) => ({ mode: 'pre', set: true, stance: 'qb', cad: u, side: 'off' }) },
  'stance-skill': { speed: 0, s: (u) => ({ mode: 'pre', set: true, stance: 'skill', cad: u, side: 'off' }) },
  walk: { speed: 0.25, s: () => ({ mode: 'live' }) },
  jog: { speed: 0.55, s: () => ({ mode: 'live' }) },
  sprint: { speed: 1, s: () => ({ mode: 'live', sprint: true }) },
  backpedal: { speed: 0.4, back: true, s: () => ({ mode: 'live', backpedal: true }) },
  cut: { speed: 0.8, zig: true, s: () => ({ mode: 'live', sprint: true }) },
  carry: { speed: 0.85, s: () => ({ mode: 'live', carrier: true, sprint: true }) },
  'qb-hold': { speed: 0, s: () => ({ mode: 'live', carrier: true, qbHold: true }) },
  throw: { speed: 0, s: (u) => { const k = (u % 1.6) / 1.6; return { mode: 'live', carrier: k < 0.45, qbHold: k < 0.3, throwU: k < 0.3 ? 0.2 : Math.min(1, (k - 0.3) / 0.5) }; } },
  catch: { speed: 0.6, s: (u) => { const k = (u % 1.6) / 1.6; return { mode: 'live', reach: k < 0.5 ? k * 2 : 0, carrier: k >= 0.5 }; } },
  block: { speed: 0.3, s: () => ({ mode: 'live', engaged: true, pushSide: 0 }) },
  tackle: { speed: 0.7, s: (u) => { const k = (u % 2) / 2; return { mode: 'live', dive: k < 0.6 ? Math.min(1, k / 0.15) : Math.max(0, 1 - (k - 0.6) / 0.2) }; } },
  tackled: { speed: 0, s: (u) => { const k = (u % 2.4) / 2.4; return { mode: 'live', fall: k < 0.25 ? k / 0.25 : k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3), fallDir: [0, -1] }; } },
  juke: { speed: 0.7, s: (u) => { const k = (u % 1.2) / 1.2; return { mode: 'live', juke: k < 0.3 ? Math.sin((k / 0.3) * Math.PI) * (Math.floor(u / 1.2) % 2 ? 1 : -1) : 0 }; } },
  spin: { speed: 0.6, s: (u) => { const k = (u % 1.4) / 1.4; return { mode: 'live', spin: k < 0.35 ? (k / 0.35) * Math.PI * 2 : null }; } },
  celebrate: { speed: 0, s: () => ({ mode: 'dead', celebrate: 1 }) },
};

// ---------- measuring the rendered mesh ----------
// A sample of the model's vertices, each tagged with the body part its strongest bone belongs
// to (the rig's part for that bone or the nearest ancestor that has one).
function sampleMesh(fig, n = 900) {
  const parts = new Map();
  for (const e of fig.rig?.bones ?? []) e.bone.traverse((c) => { if (c.isBone && !parts.has(c)) parts.set(c, e.part); });
  // Rig entries deeper in a chain take over their own subtree.
  for (const e of fig.rig?.bones ?? []) parts.set(e.bone, e.part);
  const meshes = [];
  fig.root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  const total = meshes.reduce((a, o) => a + o.geometry.attributes.position.count, 0);
  const step = Math.max(1, Math.floor(total / n));
  const S = [];
  for (const o of meshes) {
    const g = o.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (let i = 0; i < pos.count; i += step) {
      let part = 'body';
      if (o.isSkinnedMesh && si && sw) {
        let best = 0, bw = -1;
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
        part = parts.get(o.skeleton.bones[best]) ?? 'body';
      }
      S.push({ o, i, part });
    }
  }
  return S;
}
const _v = new THREE.Vector3(), _inv = new THREE.Matrix4();
// Every sampled vertex where it is drawn: in world space, and in the body's own frame (the
// group's, so turning and lean count but walking across the field does not).
function posePoints(fig, S, world, local) {
  fig.group.updateMatrixWorld(true);
  _inv.copy(fig.group.matrixWorld).invert();
  for (let k = 0; k < S.length; k++) {
    const { o, i } = S[k];
    _v.fromBufferAttribute(o.geometry.attributes.position, i);
    if (o.isSkinnedMesh) o.applyBoneTransform(i, _v);
    _v.applyMatrix4(o.matrixWorld);
    world[k * 3] = _v.x; world[k * 3 + 1] = _v.y; world[k * 3 + 2] = _v.z;
    _v.applyMatrix4(_inv);
    local[k * 3] = _v.x; local[k * 3 + 1] = _v.y; local[k * 3 + 2] = _v.z;
  }
}

// Motion over a window of frames: for each part, how far its skin travels in the body's frame
// (the mean over its vertices of the range of each, over the body height): a limb that swings
// scores well above a limb carried along. Ground: the lowest point under the body each frame
// (floating above zero, sinking below), and how fast the planted skin slides over the turf
// against how fast the body moves.
export class Meter {
  constructor(fig) {
    this.fig = fig;
    this.S = sampleMesh(fig);
    const n = this.S.length * 3;
    this.w = new Float32Array(n); this.l = new Float32Array(n); this.pw = new Float32Array(n);
    this.reset();
  }
  reset() {
    const n = this.S.length;
    this.lo = new Float32Array(n * 3).fill(Infinity); this.hi = new Float32Array(n * 3).fill(-Infinity);
    this.frames = 0; this.slideS = 0; this.slideSN = 0; this.minY = []; this.slide = 0; this.slideN = 0; this.travel = 0; this.havePrev = false;
  }
  sample(dt, bodySpeed) {
    const { S, w, l, pw } = this;
    posePoints(this.fig, S, w, l);
    for (let k = 0; k < l.length; k++) { if (l[k] < this.lo[k]) this.lo[k] = l[k]; if (l[k] > this.hi[k]) this.hi[k] = l[k]; }
    let minY = Infinity;
    for (let k = 1; k < w.length; k += 3) if (w[k] < minY) minY = w[k];
    this.minY.push(minY);
    // Planted feet: the foot contact points (model3d.contacts) on the turf, within 3% of the
    // height. Bodies without feet: the skin within 4% of the lowest point.
    const F = this.fig.feet;
    if (F) {
      const fw = this.fw ?? (this.fw = new Float32Array(F.length * 3)), pf = this.pf ?? (this.pf = new Float32Array(F.length * 3));
      for (let k = 0; k < F.length; k++) {
        _v.fromBufferAttribute(F[k].o.geometry.attributes.position, F[k].i);
        if (F[k].o.isSkinnedMesh) F[k].o.applyBoneTransform(F[k].i, _v);
        _v.applyMatrix4(F[k].o.matrixWorld);
        fw[k * 3] = _v.x; fw[k * 3 + 1] = _v.y; fw[k * 3 + 2] = _v.z;
      }
      if (this.havePrev && dt > 0 && bodySpeed > 0.5) {
        const H = this.fig.template.height;
        let v = 0, c = 0;
        // Each foot by its lowest point.
        // Each foot by its lowest point; planted when on the turf and as low as the lowest.
        let k0 = 0, g = Infinity;
        const lows = [];
        for (const n of this.fig.footLimbs ?? [F.length]) {
          let lo = -1;
          for (let k = k0; k < k0 + n; k++) if (lo < 0 || fw[k * 3 + 1] < fw[lo * 3 + 1]) lo = k;
          k0 += n;
          if (lo >= 0) { lows.push(lo); g = Math.min(g, fw[lo * 3 + 1]); }
        }
        const yw = this.fig.group.rotation.y, dx = Math.sin(yw), dz = Math.cos(yw);
        for (const lo of lows) if (fw[lo * 3 + 1] < H * 0.015 && fw[lo * 3 + 1] < g + H * 0.008) {
          const vx = (fw[lo * 3] - pf[lo * 3]) / dt, vz = (fw[lo * 3 + 2] - pf[lo * 3 + 2]) / dt;
          v += Math.hypot(vx, vz); c++; this.slideS = (this.slideS ?? 0) + (vx * dx + vz * dz);
        }
        if (c) { this.slide += v / c; this.slideN++; this.travel += bodySpeed; this.slideSN = (this.slideSN ?? 0) + c; }
      }
      pf.set(fw);
    } else if (this.havePrev && dt > 0 && bodySpeed > 0.5) {
      const H = this.fig.template.height, lim = minY + H * 0.04;
      let v = 0, c = 0;
      for (let k = 0; k < S.length; k++) {
        if (w[k * 3 + 1] > lim) continue;
        v += Math.hypot(w[k * 3] - pw[k * 3], w[k * 3 + 2] - pw[k * 3 + 2]) / dt; c++;
      }
      if (c) { this.slide += v / c; this.slideN++; this.travel += bodySpeed; }
    }
    pw.set(w); this.havePrev = true;
    this.frames++;
  }
  result() {
    const H = this.fig.template.height, by = {};
    this.S.forEach((p, k) => {
      const r = Math.hypot(this.hi[k * 3] - this.lo[k * 3], this.hi[k * 3 + 1] - this.lo[k * 3 + 1], this.hi[k * 3 + 2] - this.lo[k * 3 + 2]);
      const b = by[p.part] ?? (by[p.part] = { sum: 0, n: 0 });
      b.sum += r; b.n++;
    });
    const motion = {};
    for (const [k, b] of Object.entries(by)) motion[k] = +(b.sum / b.n / H).toFixed(3);
    const ys = [...this.minY].sort((a, b) => a - b), med = ys[Math.floor(ys.length / 2)] ?? 0;
    return {
      motion, ground: { median: +(med / H).toFixed(3), low: +((ys[0] ?? 0) / H).toFixed(3), high: +((ys[ys.length - 1] ?? 0) / H).toFixed(3) },
      drift: this.slideSN ? +((this.slideS / this.slideSN) / Math.max(0.01, this.travel / this.slideN)).toFixed(2) : null,
      slide: this.slideN ? +((this.slide / this.slideN) / Math.max(0.01, this.travel / this.slideN)).toFixed(2) : null,
    };
  }
}

// ---------- what the rig found ----------
export function rigReport(fig, id) {
  const R = fig.rig, T = fig.template, warn = [];
  const bones = [];
  fig.root.traverse((o) => { if (o.isBone) bones.push(o); });
  const parts = {};
  for (const e of R?.bones ?? []) (parts[e.part] ??= []).push(`${e.bone.name}${e.side ? (e.side > 0 ? ' (L)' : ' (R)') : ''}${e.seg != null ? ` seg${e.seg}` : ''}${e.upper ? ' upper' : ''}`);
  const style = bodyStyle(id, fig);
  if (!bones.length) warn.push('No skeleton: the model can only move as one piece.');
  if (T.autoRig) warn.push(`Skeleton built by autorig (${T.autoRig.kind ?? 'mesh analysis'}).`);
  if (style === 'biped' && !(R?.arms >= 2)) warn.push('Biped with fewer than two arms found: arms will not swing.');
  if ((style === 'biped' || style === 'quad') && !(R?.legs >= 2)) warn.push('Legged body with fewer than two legs found: no stride.');
  if (style === 'quad' && R?.legs + R?.arms < 4) warn.push('Quadruped with fewer than four limbs found.');
  if (!Object.keys(T.clips).length) warn.push('No animation clips: everything is procedural.');
  else if (!T.clips.run && !T.clips.walk) warn.push('No run or walk clip: the stride is procedural.');
  const unmapped = bones.filter((b) => !R?.bones.some((e) => e.bone === b)).length;
  return {
    id, name: PLAYERS[id]?.name, style, cls: bodyOf(id).cls, height: +T.height.toFixed(2), scale: +T.scale.toFixed(3),
    bones: bones.length, mapped: R?.bones.length ?? 0, unmapped, legs: R?.legs ?? 0, arms: R?.arms ?? 0, quad: !!R?.quad,
    hands: { L: R?.hands.L?.name ?? null, R: R?.hands.R?.name ?? null },
    clips: Object.fromEntries(Object.entries(T.clips).map(([k, c]) => [k, +c.duration.toFixed(2)])), parts, warn,
  };
}

// ---------- a headless driver: one Pokémon through one state ----------
// Moves the group like the simulation would (forward at the state's speed, zig-zagging for a
// cut, backward for a backpedal), runs the Animator and driveModel, then measures.
export function runState(fig, id, state, secs = 2, dt = 1 / 30, meter = null, anim = null) {
  const L = LAB_STATES[state];
  anim = anim ?? new Animator(fig, (id * 0.618) % 1);
  anim.setFigure(fig);
  anim.style = bodyStyle(id, fig);
  const H = fig.template.height;
  const top = TOP, speed = L.speed * top;
  const m = meter ?? new Meter(fig);
  m.reset();
  let yaw = 0, x = 0, z = 0, u = 0;
  const warm = 0.6;
  for (let f = 0; u < secs + warm; f++, u += dt) {
    const turn = L.zig ? Math.cos(u * 2.6) * 2.2 : 0;
    yaw += turn * dt;
    const dir = L.back ? -1 : 1;
    x += Math.sin(yaw) * speed * dt * dir; z += Math.cos(yaw) * speed * dt * dir;
    fig.group.position.set(x, 0, z); fig.group.rotation.y = yaw + (anim.yawOffset ?? 0);
    const s = { top, height: H, speed, turn, set: true, ...L.s(u) };
    anim.update(dt, s);
    driveModel(fig, anim, s, dt);
    fig.group.rotation.y = yaw + (anim.yawOffset ?? 0);
    if (u >= warm) m.sample(dt, speed);
  }
  return { ...m.result(), clip: fig.diag?.played ?? null, diag: fig.diag };
}

// Audit many species headless: loads each model (waiting for its chunk), runs the states.
export async function audit(ids = ALL_IDS, states = ['idle', 'jog', 'sprint', 'block', 'throw'], secs = 1.6) {
  const out = [];
  for (const id of ids) {
    if (!hasModel(id)) continue;
    let T = modelTemplate(id);
    for (let k = 0; k < 400 && !T.ready && !T.failed; k++) { await new Promise((r) => setTimeout(r, 25)); T = modelTemplate(id); }
    if (!T.ready) { out.push({ id, failed: true }); continue; }
    const fig = makeModelFigure(T);
    const scene = new THREE.Scene(); scene.add(fig.group);
    const rep = rigReport(fig, id), meter = new Meter(fig), anim = new Animator(fig, (id * 0.618) % 1);
    rep.states = {};
    for (const st of states) rep.states[st] = runState(fig, id, st, secs, 1 / 30, meter, anim);
    disposeModelFigure(fig);
    out.push(rep);
  }
  return out;
}

// ---------- the interactive lab ----------
export function startLab(root = document.body) {
  document.title = 'PokeBall · animation lab';
  root.innerHTML = `<div id="lab" style="position:fixed;inset:0;display:grid;grid-template-columns:1fr 380px;background:#0d1712;color:#e8efe9;font:13px/1.4 system-ui,sans-serif">
    <div id="lab-view" style="position:relative;min-width:0"></div>
    <aside style="overflow:auto;padding:12px 14px;border-left:1px solid #24342a">
      <h2 style="margin:0 0 8px;font-size:16px">Animation lab</h2>
      <label>Species <select id="lab-sp" style="width:100%"></select></label>
      <div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap" id="lab-states"></div>
      <label><input type="checkbox" id="lab-bones"> Show skeleton</label>
      <label style="margin-left:10px"><input type="checkbox" id="lab-feet" checked> Ground contact</label>
      <label style="margin-left:10px"><input type="checkbox" id="lab-slow"> Slow motion</label>
      <pre id="lab-info" style="white-space:pre-wrap;font:12px/1.35 ui-monospace,monospace;margin-top:10px"></pre>
    </aside></div>`;
  const view = root.querySelector('#lab-view');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  view.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b2a20');
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#dfeaff', '#2a3a22', 1.4));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(6, 12, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  scene.add(sun, sun.target);
  // Turf with a yard grid, so sliding feet show against it.
  const tc = document.createElement('canvas'); tc.width = tc.height = 256;
  const g = tc.getContext('2d'); g.fillStyle = '#2f6b37'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#3a7b42'; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(tc); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(200, 200); tex.colorSpace = THREE.SRGBColorSpace;
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true; scene.add(turf);
  const feet = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#ffd54a', size: 0.07, depthTest: false }));
  feet.renderOrder = 5; scene.add(feet);

  const sel = root.querySelector('#lab-sp');
  const ids = [...ALL_IDS].sort((a, b) => a - b);
  sel.innerHTML = ids.map((id) => `<option value="${id}">#${id} ${PLAYERS[id].name}</option>`).join('');
  const want = Number(/[?&#]animlab=(\d+)/.exec(location.search + location.hash)?.[1] ?? 445);
  sel.value = String(ids.includes(want) ? want : ids[0]);
  const stBox = root.querySelector('#lab-states');
  stBox.innerHTML = Object.keys(LAB_STATES).map((k) => `<button data-st="${k}" style="padding:4px 8px;border-radius:6px;border:1px solid #3c5446;background:#16241b;color:inherit;cursor:pointer">${k}</button>`).join('');
  const L = { id: null, fig: null, anim: null, meter: null, state: 'jog', u: 0, x: 0, z: 0, yaw: 0, report: null, last: performance.now(), helper: null, res: null, resAt: 0 };
  window.__pbLabView = L;
  stBox.addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) setState(b.dataset.st); });
  sel.addEventListener('change', () => load(Number(sel.value)));
  const info = root.querySelector('#lab-info');
  function setState(k) {
    L.state = k; L.u = 0; L.meter?.reset();
    for (const b of stBox.children) b.style.background = b.dataset.st === k ? '#2f6b37' : '#16241b';
  }
  function load(id) {
    if (L.fig) { disposeModelFigure(L.fig); L.fig = null; }
    if (L.helper) { scene.remove(L.helper); L.helper = null; }
    L.id = id; L.report = null;
  }
  function resize() { const w = view.clientWidth, h = view.clientHeight; r.setSize(w, h); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(view);
  resize();
  load(Number(sel.value)); setState('jog');
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - L.last) / 1000); L.last = now;
    if (root.querySelector('#lab-slow').checked) dt *= 0.25;
    if (L.manual) return;
    tick(dt, now);
  }
  // Advance the lab by secs in fixed steps and draw (for the contact-sheet script).
  function step(secs) { const n = Math.max(1, Math.round(secs * 60)); for (let i = 0; i < n; i++) tick(1 / 60, performance.now(), i === n - 1); }
  function tick(dt, now, draw = true) {
    if (!L.fig) {
      const T = modelTemplate(L.id);
      if (!T.ready) { info.textContent = T.failed ? 'This model failed to load.' : 'Loading the model...'; r.render(scene, cam); return; }
      L.fig = makeModelFigure(T); scene.add(L.fig.group);
      L.anim = new Animator(L.fig, (L.id * 0.618) % 1); L.anim.style = bodyStyle(L.id, L.fig);
      L.meter = new Meter(L.fig); L.report = rigReport(L.fig, L.id);
      L.x = L.z = L.yaw = 0;
      if (L.manual) cam.position.set(2.3 * T.height, T.height * 0.62, 0.9 * T.height);
    }
    const S = LAB_STATES[L.state], H = L.fig.template.height, speed = S.speed * TOP;
    L.u += dt;
    // Back and forth over twelve yards, so the camera keeps it framed.
    const turn = S.zig ? Math.cos(L.u * 2.6) * 2.2 : 0;
    L.yaw += turn * dt;
    const dir = S.back ? -1 : 1;
    L.x += Math.sin(L.yaw) * speed * dt * dir; L.z += Math.cos(L.yaw) * speed * dt * dir;
    if (Math.hypot(L.x, L.z) > 12) { L.x = L.z = 0; L.meter.havePrev = false; }
    const s = { top: TOP, height: H, speed, turn, set: true, ...S.s(L.u) };
    L.anim.update(dt, s);
    L.fig.group.position.set(L.x, 0, L.z);
    driveModel(L.fig, L.anim, s, dt);
    L.fig.group.rotation.y = L.yaw + (L.anim.yawOffset ?? 0);
    L.meter.sample(dt, speed);
    // Skeleton.
    const showB = root.querySelector('#lab-bones').checked;
    if (showB && !L.helper) { L.helper = new THREE.SkeletonHelper(L.fig.root); L.helper.material.depthTest = false; scene.add(L.helper); }
    if (L.helper) L.helper.visible = showB;
    // Ground contact: the planted skin in yellow.
    const fw = L.meter.w, lim = L.meter.minY[L.meter.minY.length - 1] + H * 0.04, pts = [];
    if (root.querySelector('#lab-feet').checked) for (let k = 0; k < fw.length; k += 3) if (fw[k + 1] <= lim) pts.push(fw[k], Math.max(0.01, fw[k + 1]), fw[k + 2]);
    feet.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    // Camera: from the side and a little in front.
    const c = new THREE.Vector3(L.x + 2.3 * H, H * 0.62, L.z + 0.9 * H);
    cam.position.lerp(c, L.manual ? 1 : 0.12); cam.lookAt(L.x, H * 0.42, L.z);
    sun.position.set(L.x + 6, 12, L.z + 4); sun.target.position.set(L.x, 0, L.z);
    if (now - L.resAt > 1500) { L.res = L.meter.result(); L.meter.reset(); L.resAt = now; }
    const R = L.report, d = L.fig.diag ?? {};
    const clipW = Object.entries(L.fig.actions).map(([k, a]) => `${k}${a.isRunning() ? ` ${a.getEffectiveWeight().toFixed(2)}` : ''}`).join('  ');
    info.textContent = [
      `${R.name} #${R.id}   body: ${R.style}   size: ${R.cls} (${R.height} yd)`,
      `skeleton: ${R.bones} bones, ${R.mapped} driven, ${R.unmapped} not mapped`,
      `legs ${R.legs}  arms ${R.arms}  quad ${R.quad}  hands L:${R.hands.L ?? '-'} R:${R.hands.R ?? '-'}`,
      '', `state: ${L.state}   clip role: ${d.role} -> playing: ${d.played ?? 'none'} x${(d.speed ?? 1).toFixed(2)}`,
      `clips: ${clipW || 'none'}`,
      `weights: hang ${(d.hangW ?? 0).toFixed(2)}  fold ${(d.foldW ?? 0).toFixed(2)}  stride ${(d.limbW ?? 0).toFixed(2)}  run ${(d.runK ?? 0).toFixed(2)}  calm ${(d.calm ?? 0).toFixed(2)}`,
      `animator: ${Object.entries(L.anim.w).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')}`,
      '', 'measured on the mesh (skin travel / height):',
      ...(L.res ? Object.entries(L.res.motion).map(([k, v]) => `  ${k.padEnd(6)} ${'█'.repeat(Math.min(30, Math.round(v * 60)))} ${v}`) : []),
      L.res ? `ground: lowest point ${L.res.ground.median} of height (low ${L.res.ground.low}, high ${L.res.ground.high})` : '',
      L.res?.slide != null ? `foot slide: ${L.res.slide} (planted skin speed / body speed; 0 is planted, 1 is gliding)` : '',
      '', R.warn.length ? `warnings:\n  ${R.warn.join('\n  ')}` : 'no warnings',
      '', 'driven bones:', ...Object.entries(R.parts).map(([k, v]) => `  ${k}: ${v.join(', ')}`),
    ].join('\n');
    if (draw) r.render(scene, cam);
  }
  requestAnimationFrame(frame);
  window.__pbLab = { ALL: ALL_IDS, audit, rigReport, runState, LAB_STATES, view: L, setState, step, load: (id) => { sel.value = String(id); load(id); } };
}
