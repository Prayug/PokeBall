// The main menu's 3D scene: the stadium from stadium3d.js at night under the lights, branded for
// PokeBall (its video board, LED ribbons, end zones and an inflatable players' tunnel), with six
// Pokémon posed on the field as if waiting for kickoff. Each is the real 3D model from model3d.js,
// posed on its own skeleton with the same football poses the game uses (a quarterback's cocked
// arm, a rusher's crouch, a lineman's hand on the turf), breathing and shifting its weight, now
// and then reacting with a clip of its own. Until a model has loaded (or when the model files are
// not next to the page) a placeholder stands on its spot instead: never a sprite.
//
// The camera frames one featured Pokémon at a time on the right of the screen (the menu sits on
// the left), eases from one to the next, drifts slowly and leans with the pointer. Reduced motion
// keeps the camera still and cuts between shots.
import * as THREE from 'three';
import { Stadium } from './stadium3d.js';
import { modelTemplate, makeModelFigure, disposeModelFigure, playClip, hasModel, resetLimbs, driveLimbs, poseLimbs, hangArms, foldWings } from './model3d.js';
import { updateBlink } from './blink.js';
import { bodyOf } from './body.js';
import { ALL_IDS, PLAYERS } from './ratings.js';
import { TYPE_COLORS } from './types.js';
import { footballGeometry, footballTexture, webglAvailable } from './field3d.js';
import { glowTexture } from './venue3d.js';
import { fitText } from './kitdraw.js';

const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The PokeBall palette: Poké red, dark navy, white, stadium gold.
export const BRAND = { red: '#d81e2c', navy: '#0b1a33', white: '#f5f7fb', gold: '#e2b23c' };
const HOME = { name: 'PokeBall', abbr: 'PKB', color: '#c8102e', kit: { color2: '#0b1a33', style: 'block', wordmark: 'POKEBALL', stadium: 'classic' } };
const AWAY = { name: 'PokeBall', abbr: 'PKB', color: '#13294b', kit: { color2: '#e2b23c', style: 'outline', wordmark: 'POKEBALL', stadium: 'classic' } };

// The lineup, staggered on the field near the left 40 and facing the camera, which looks down
// the field toward the video board. role: the spot shown on its nameplate (its rating there is
// the real one); pose: football pose channels for poseLimbs (see Animator.football); scale: drawn
// size over its game size (Gyarados looms at the back).
export const LINEUP = [
  { id: 448, role: 'QB', x: 41, z: 0.2, pose: { throwArm: -3.3, armsFwd: 0.3, twist: -0.25, crouch: 0.12, lean: 0.08 }, ball: true, line: 'Field general. Reads the coverage before the snap.' },
  { id: 445, role: 'LE', x: 39.6, z: -4, pose: { crouch: 0.55, lean: 0.75, armsFwd: 0.6 }, line: 'Edge rusher. Gets home before the pocket forms.' },
  { id: 135, role: 'WR1', x: 42.6, z: 3.6, pose: { crouch: 0.8, lean: 0.6 }, line: 'Burner. Nobody stays with Jolteon past ten yards.' },
  { id: 248, role: 'DT1', x: 35.8, z: -8.4, pose: { crouch: 0.45, lean: 0.55, down: 0.9, armsFwd: 0.25 }, line: 'Nose tackle. Takes two blockers, minimum.' },
  { id: 65, role: 'WR3', x: 37.8, z: 5.8, pose: { armsFwd: 0.45, twist: 0.18, lean: 0.12 }, line: 'Sees the play three steps ahead of the defense.' },
  { id: 130, role: 'DE', x: 31.5, z: 0.4, scale: 1.6, pose: {}, line: 'The whole stadium hears it when Gyarados lines up.' },
];
const FB_KEYS = ['crouch', 'lean', 'armsFwd', 'down', 'reach', 'carry', 'throwArm', 'twist'];
// Where the lineup faces: toward the camera's home position.
const FACE = new THREE.Vector3(64, 0, 3);
const WIDE = { pos: new THREE.Vector3(56.5, 3.4, 1.2), look: new THREE.Vector3(37, 2.5, -0.6) };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const ease = (u) => u * u * (3 - 2 * u);

export class MenuStage {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mm-canvas';
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.ratio = this.maxRatio;
    r.setPixelRatio(this.ratio);
    this.el.appendChild(r.domElement);
    r.domElement.setAttribute('aria-hidden', 'true');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.3, 1400);
    this.stadium = new Stadium(this.scene, r);
    this.stadium.paint([HOME, AWAY], 1);
    this.stadium.setVenue({ stadium: 'classic', time: 'night' });
    this.stadium.follow(37, 0);
    this.paintRibbon();
    this.paintBanners();
    this.buildTunnels();
    this.buildAtmosphere();
    this.buildSpot();
    this.ball = new THREE.Mesh(footballGeometry(), new THREE.MeshStandardMaterial({ map: footballTexture(), roughness: 0.5 }));
    this.ball.castShadow = true; this.ball.visible = false; this.ball.scale.setScalar(0.62);
    this.scene.add(this.ball);
    this.actors = LINEUP.map((L, i) => this.makeActor(L, i));
    this.feature = null;       // featured Pokémon id, or null for the whole lineup
    this.board = { info: null, slide: 0, next: 0, key: '' };
    this.cam = { pos: WIDE.pos.clone(), look: WIDE.look.clone(), off: 0, offY: 0, snap: true };
    this.ptr = { x: 0, y: 0, sx: 0, sy: 0 };
    this.t = 0; this.last = 0; this.running = false; this.launchAt = null;
    this.reactNext = 4;
    this.frames = []; this.slowFor = 0;
    this.quality = 'auto';
    this.frame = this.frame.bind(this);
    this.onPointer = (e) => { this.ptr.x = (e.clientX / window.innerWidth) * 2 - 1; this.ptr.y = (e.clientY / window.innerHeight) * 2 - 1; };
    this.onVis = () => { if (!document.hidden) this.last = performance.now(); };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
  }

  // ---------- the lineup ----------
  makeActor(L, i) {
    const root = new THREE.Group();
    root.position.set(L.x, 0, L.z);
    const yaw = Math.atan2(FACE.x - L.x, FACE.z - L.z);
    root.rotation.y = yaw;
    root.scale.setScalar(L.scale ?? 1);
    this.scene.add(root);
    const B = bodyOf(L.id);
    const a = { ...L, root, yaw, turn: 0, height: B.height * (L.scale ?? 1), radius: B.r, seed: i * 1.37 + 0.4, fig: null, ph: null, pw: 1, react: null, look: 0, fb: {} };
    for (const k of FB_KEYS) a.fb[k] = 0;
    this.placeholder(a);
    return a;
  }

  // The stand-in while a model loads: a glass capsule the Pokémon's size in its type color,
  // with a ring turning on the turf under it.
  placeholder(a) {
    const col = new THREE.Color(TYPE_COLORS[PLAYERS[a.id]?.types[0]] ?? '#8aa0b8');
    const g = new THREE.Group();
    const h = bodyOf(a.id).height, r = Math.min(h * 0.32, bodyOf(a.id).r * 1.1);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.05, h - r * 2), 6, 16),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, transparent: true, opacity: 0.32, roughness: 0.3, depthWrite: false }));
    body.position.y = h / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.5, r * 1.75, 48, 1, 0, Math.PI * 1.5),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    g.add(body, ring);
    g.userData = { body, ring };
    a.ph = g;
    a.root.add(g);
  }

  // A real model once its template is ready: swap it in for the placeholder.
  syncActor(a) {
    if (a.fig || !hasModel(a.id)) return;
    const M = modelTemplate(a.id);
    if (!M.ready) { a.failed = M.failed; return; }
    if (a.ph) { a.root.remove(a.ph); a.ph.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); a.ph = null; }
    a.fig = makeModelFigure(M);
    a.root.add(a.fig.group);
    playClip(a.fig, 'idle', 0);
  }

  // Which Pokémon are on screen as real models (the nameplate says when one is still loading).
  modelState(id) {
    const a = this.actors.find((x) => x.id === id);
    if (!a) return 'none';
    return a.fig ? 'ready' : a.failed || !hasModel(id) ? 'missing' : 'loading';
  }

  updateActor(a, dt) {
    this.syncActor(a);
    const t = this.t + a.seed * 7;
    const featured = this.feature === a.id;
    // The featured Pokémon turns a little toward the lens.
    const toCam = Math.atan2(this.camera.position.x - a.root.position.x, this.camera.position.z - a.root.position.z);
    const want = featured ? clamp(angDiff(a.yaw, toCam), -0.5, 0.5) * 0.6 : 0;
    a.turn += (want - a.turn) * (1 - Math.exp(-dt * 3));
    a.root.rotation.y = a.yaw + a.turn;
    if (a.ph) {
      const { body, ring } = a.ph.userData;
      ring.rotation.z = -t * 1.8;
      body.material.opacity = 0.26 + Math.sin(t * 3) * 0.06;
      body.position.y = bodyOf(a.id).height / 2 + Math.sin(t * 1.6) * 0.04;
      return;
    }
    const f = a.fig;
    // A reaction: a clip of its own for a moment (a cheer, a roar, a lunge), then back to idle.
    const reacting = a.react && this.t < a.react.until;
    if (a.react && !reacting) a.react = null;
    const played = playClip(f, reacting ? a.react.clip : 'idle', 0.3, 1);
    resetLimbs(f);
    f.mixer.update(dt);
    const idle = played === 'idle' || !played;
    hangArms(f, idle ? 0.9 : 0);
    foldWings(f, idle ? 0.85 : 0);
    // The football pose eases off while a clip acts something out.
    a.pw += ((idle ? 1 : 0.2) - a.pw) * (1 - Math.exp(-dt * 5));
    // Stance adjustments: the weight settles and lifts, the quarterback pats the ball.
    const sway = Math.sin(t * 0.55) * 0.5 + Math.sin(t * 0.23 + 1) * 0.5;
    for (const k of FB_KEYS) a.fb[k] = (a.pose[k] ?? 0) * a.pw;
    if (a.pose.crouch) a.fb.crouch += sway * 0.05 * a.pw;
    if (a.pose.lean) a.fb.lean += Math.sin(t * 0.4) * 0.04 * a.pw;
    if (a.pose.throwArm) { const pump = Math.max(0, Math.sin(t * 0.45)) ** 6; a.fb.throwArm += pump * 0.9 * a.pw; }
    const lk = featured ? clamp(angDiff(a.yaw + a.turn, toCam), -1, 1) * 0.5 : Math.sin(t * 0.21) * 0.25;
    a.look += (lk - a.look) * (1 - Math.exp(-dt * 3));
    driveLimbs(f, { phase: 0, run: 0, t, flap: 0, weight: 1, look: a.look, calm: idle ? 1 : 0.3, seed: a.seed });
    poseLimbs(f, a.fb);
    updateBlink(f, dt, true);
    if (a.ball) this.placeBall(a);
  }

  // The quarterback's football: in the throwing hand when the rig has one, else up by the ear.
  placeBall(a) {
    const f = a.fig, T = f.template, b = this.ball;
    const h = f.rig?.hands?.R ?? f.rig?.hands?.L;
    f.pivot.updateMatrixWorld(true);
    let ok = false;
    if (h) {
      h.getWorldPosition(b.position);
      const s = a.scale ?? 1, off = Math.hypot(b.position.x - a.root.position.x, b.position.z - a.root.position.z);
      ok = off < (Math.max(T.width, T.depth) * 0.9 + 0.3) * s && b.position.y > 0.2 && b.position.y < T.height * 1.6 * s;
    }
    if (!ok) b.position.set(-0.42 * Math.max(0.3, T.width / 2), 0.78 * T.height, 0.15 * Math.max(0.3, T.depth / 2)).applyMatrix4(f.pivot.matrixWorld);
    b.rotation.set(0, a.root.rotation.y - Math.PI / 2, 0.6, 'YZX');
    b.visible = true;
  }

  // Now and then one of them reacts: the featured one most often.
  scheduleReactions() {
    if (reduceMotion || this.t < this.reactNext) return;
    this.reactNext = this.t + 5 + Math.random() * 4;
    const pool = this.actors.filter((a) => a.fig && !a.react);
    if (!pool.length) return;
    const a = pool.find((x) => x.id === this.feature && Math.random() < 0.5) ?? pool[Math.floor(Math.random() * pool.length)];
    this.react(a.id);
  }
  react(id, prefer = null) {
    const a = this.actors.find((x) => x.id === id);
    if (!a?.fig || reduceMotion) return;
    const have = ['glad', 'attack'].filter((k) => a.fig.actions[k]);
    const clip = prefer && a.fig.actions[prefer] ? prefer : have[Math.floor(Math.random() * have.length)];
    if (!clip) return;
    const dur = a.fig.actions[clip].getClip().duration;
    a.react = { clip, until: this.t + clamp(dur, 0.8, 2.2) };
  }

  // ---------- the featured shot ----------
  setFeature(id) {
    if (this.feature === id) return;
    this.feature = id;
    this.board.next = 0;
    if (id != null) this.react(id, 'glad');
  }

  shot() {
    const portrait = this.el.clientWidth < this.el.clientHeight * 0.95;
    const a = this.actors.find((x) => x.id === this.feature);
    if (!a) return { pos: WIDE.pos, look: WIDE.look, off: portrait ? 0 : this.panel ? 0.3 : 0.17, offY: portrait ? 0.06 : 0 };
    const p = a.root.position, h = a.height;
    // In front of it and a little to its right, at about chest height, close enough that it
    // fills most of the screen's height.
    const d = (portrait ? 3.2 : 2.3) + h * (portrait ? 2.6 : 2.05);
    const dir = Math.atan2(FACE.x - p.x, FACE.z - p.z) + this.clearAngle(a, d);
    const pos = new THREE.Vector3(p.x + Math.sin(dir) * d, Math.max(1.0, h * 0.62 + 0.35), p.z + Math.cos(dir) * d);
    const look = new THREE.Vector3(p.x, h * 0.52, p.z);
    return { pos, look, off: portrait ? 0 : this.panel ? 0.3 : 0.22, offY: portrait ? 0.14 : 0 };
  }

  // The angle off its facing (toward its right first) the lens can see the featured Pokémon from
  // with nobody else standing in between.
  clearAngle(a, d) {
    this.clear ??= new Map();
    const key = `${a.id}|${d.toFixed(1)}`;
    if (this.clear.has(key)) return this.clear.get(key);
    const p = a.root.position, face = Math.atan2(FACE.x - p.x, FACE.z - p.z);
    let best = -0.32;
    for (const off of [-0.32, -0.55, -0.15, 0.1, 0.32, -0.8, 0.55, 0.8, -1.05, 1.05]) {
      const cx = p.x + Math.sin(face + off) * d, cz = p.z + Math.cos(face + off) * d;
      const blocked = this.actors.some((o) => {
        if (o === a) return false;
        const ox = o.root.position.x - p.x, oz = o.root.position.z - p.z, vx = cx - p.x, vz = cz - p.z;
        // Nobody right beside the lens either.
        if (Math.hypot(ox - vx, oz - vz) < o.radius * (o.scale ?? 1) + 3.6) return true;
        const t = (ox * vx + oz * vz) / (vx * vx + vz * vz);
        if (t < -0.1 || t > 1) return false;
        return Math.hypot(ox - vx * t, oz - vz * t) < o.radius * (o.scale ?? 1) + 0.9;
      });
      if (!blocked) { best = off; break; }
    }
    this.clear.set(key, best);
    return best;
  }

  updateCamera(dt, realDt = dt) {
    const S = this.shot(), C = this.cam;
    // (Eased on the wall clock, so a slow machine still arrives on time.)
    const k = reduceMotion || C.snap ? 1 : 1 - Math.exp(-Math.min(0.5, realDt) * 3.6);
    C.snap = false;
    C.pos.lerp(S.pos, k); C.look.lerp(S.look, k);
    C.off += (S.off - C.off) * k; C.offY += (S.offY - C.offY) * k;
    const cam = this.camera;
    cam.position.copy(C.pos);
    if (!reduceMotion) {
      // A slow drift, and a lean with the pointer.
      const t = this.t;
      this.ptr.sx += (this.ptr.x - this.ptr.sx) * (1 - Math.exp(-dt * 2.5));
      this.ptr.sy += (this.ptr.y - this.ptr.sy) * (1 - Math.exp(-dt * 2.5));
      const fwd = new THREE.Vector3().subVectors(C.look, C.pos).normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
      cam.position.addScaledVector(right, Math.sin(t * 0.09) * 0.45 + this.ptr.sx * 0.35);
      cam.position.y += Math.sin(t * 0.13) * 0.12 - this.ptr.sy * 0.15;
      cam.position.addScaledVector(fwd, Math.sin(t * 0.06) * 0.35);
    }
    let fov = 36;
    if (this.launchAt != null) {
      // Into the game: push in on the field and narrow the lens.
      const u = ease(clamp((performance.now() - this.launchAt) / 520, 0, 1));
      cam.position.lerp(C.look, u * 0.55);
      fov = 36 - u * 10;
    }
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.lookAt(C.look);
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w && h) cam.setViewOffset(w, h, -w * C.off, h * C.offY, w, h);
  }
  launch() { this.launchAt = performance.now(); }
  // With a panel open beside the menu, the featured Pokémon stands further right.
  setPanel(open) { this.panel = !!open; }

  // ---------- stadium dressing ----------
  // The LED ribbons around the bowl, in the brand's colors (Stadium.update scrolls them).
  paintRibbon() {
    const c = this.stadium.ribbonCanvas, r = c.getContext('2d'), W = c.width, H = c.height;
    r.fillStyle = '#060a12'; r.fillRect(0, 0, W, H);
    const segs = [[BRAND.red, '#fff', 'POKEBALL'], [BRAND.navy, BRAND.gold, 'DRAFT · COACH · WIN'], [BRAND.gold, BRAND.navy, `${ALL_IDS.length} POKÉMON`], [BRAND.navy, '#fff', 'GEN 1 TO 9'], [BRAND.red, '#fff', 'POKEBALL'], [BRAND.navy, BRAND.gold, 'GAME DAY']];
    const sw = W / segs.length;
    segs.forEach(([bg, ink, text], i) => {
      r.fillStyle = bg; r.fillRect(i * sw + 4, 5, sw - 8, H - 10);
      r.fillStyle = ink; r.font = '700 28px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; r.textAlign = 'center'; r.textBaseline = 'middle';
      fitText(r, text, sw - 30);
      r.fillText(text, i * sw + sw / 2, H / 2 + 1);
    });
    for (const t of this.stadium.ribbons) t.needsUpdate = true;
  }

  // The banner strip along the wall around the field.
  paintBanners() {
    const st = this.stadium, c = st.bannerCanvas, x = c.getContext('2d'), W = c.width, H = c.height;
    const blocks = [[BRAND.navy, BRAND.white, 'POKEBALL'], [BRAND.red, BRAND.white, 'DRAFT POKÉMON'], [BRAND.navy, BRAND.gold, 'COACH FOOTBALL'], [BRAND.gold, BRAND.navy, 'GAME DAY']];
    const bw = W / blocks.length;
    blocks.forEach(([bg, ink, text], i) => {
      x.fillStyle = bg; x.fillRect(i * bw, 0, bw, H);
      x.fillStyle = 'rgba(255,255,255,0.1)'; x.fillRect(i * bw, 0, bw, H * 0.16);
      x.fillStyle = ink; x.font = '700 38px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      fitText(x, text, bw - 30);
      x.fillText(text, i * bw + bw / 2, H / 2 + 2);
    });
    st.bannerTex.needsUpdate = true;
    for (const w of st.walls) w.material.map.needsUpdate = true;
  }

  // Inflatable players' tunnels on both sidelines near the left 20: a half tube in the brand's
  // red with navy bands, a gold arch at the mouth and a dark opening in the wall behind it.
  buildTunnels() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = BRAND.red; x.fillRect(0, 0, 512, 128);
    x.fillStyle = BRAND.navy; for (const v of [0, 104]) x.fillRect(0, v, 512, 24);
    x.fillStyle = '#fff'; x.font = '800 52px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('POKEBALL', 256, 66);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const skin = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, side: THREE.FrontSide });
    const inner = new THREE.MeshBasicMaterial({ color: '#05070b', side: THREE.BackSide });
    const gold = new THREE.MeshStandardMaterial({ color: BRAND.gold, roughness: 0.4, metalness: 0.3 });
    this.tunnels = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const R = 2.6, len = 8.5;
      const tube = new THREE.CylinderGeometry(R, R, len, 28, 1, true, -Math.PI / 2, Math.PI);
      tube.rotateX(Math.PI / 2);
      const outer = new THREE.Mesh(tube, skin), inside = new THREE.Mesh(tube, inner);
      outer.castShadow = true;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(R + 0.05, 0.28, 10, 28, Math.PI), gold);
      arch.position.z = len / 2;
      const door = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), inner);
      door.position.set(0, 1.6, -len / 2 - 0.1);
      g.add(outer, inside, arch, door);
      g.position.set(17, 0, s * (37 - len / 2));
      g.rotation.y = s < 0 ? 0 : Math.PI;
      this.scene.add(g);
      this.tunnels.push(g);
    }
  }

  // Light shafts from the towers at the far end, haze hanging over the field and smoke curling
  // out of the tunnels.
  buildAtmosphere() {
    const c = document.createElement('canvas'); c.width = 4; c.height = 128;
    const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,248,225,0)'); gr.addColorStop(0.08, 'rgba(255,248,225,0.9)'); gr.addColorStop(1, 'rgba(255,248,225,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 128);
    const beamTex = new THREE.CanvasTexture(c);
    this.beams = [];
    for (const gl of this.stadium.glows) {
      const from = gl.position.clone();
      if (from.x > 60) continue; // only the towers in front of the lens
      const to = new THREE.Vector3(30, 0, from.z > 0 ? 8 : -8);
      const L = from.distanceTo(to);
      const geo = new THREE.CylinderGeometry(3, 16, L, 24, 1, true);
      geo.translate(0, -L / 2, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.075, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      m.position.copy(from);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      this.scene.add(m);
      this.beams.push(m);
    }
    const puff = glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.3)');
    this.haze = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#9fb2d4', transparent: true, opacity: 0.07, depthWrite: false }));
      s.scale.set(46, 10, 1);
      s.userData = { x: 4 + i * 9, z: (i % 2 ? -1 : 1) * (6 + (i % 3) * 5), y: 2.6 + (i % 3), ph: i * 1.7 };
      this.scene.add(s); this.haze.push(s);
    }
    this.smoke = [];
    for (const tn of this.tunnels) {
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#c8cfdc', transparent: true, opacity: 0, depthWrite: false }));
        s.userData = { base: tn.position.clone().add(new THREE.Vector3(0, 0.6, -Math.sign(tn.position.z) * 4.6)), ph: i / 6, dir: -Math.sign(tn.position.z) };
        this.scene.add(s); this.smoke.push(s);
      }
    }
  }
  updateAtmosphere() {
    const t = this.t;
    for (const s of this.haze) { const u = s.userData; s.position.set(u.x + Math.sin(t * 0.05 + u.ph) * 6, u.y, u.z + Math.cos(t * 0.04 + u.ph) * 3); }
    for (const s of this.smoke) {
      const u = s.userData, k = (t * 0.12 + u.ph) % 1;
      s.position.set(u.base.x + Math.sin(k * 6 + u.ph * 9) * 0.8, u.base.y + k * 3.2, u.base.z + u.dir * k * 5);
      const sc = 2 + k * 6; s.scale.set(sc, sc, 1);
      s.material.opacity = Math.sin(k * Math.PI) * 0.16;
    }
    for (const [i, b] of this.beams.entries()) b.material.opacity = 0.065 + Math.sin(t * 0.7 + i * 2) * 0.012;
  }

  // A pool of light on the featured Pokémon.
  buildSpot() {
    const sp = new THREE.SpotLight('#fff1d6', 2.4, 0, 0.42, 0.7, 0);
    sp.castShadow = false;
    this.scene.add(sp, sp.target);
    this.spot = sp;
  }
  updateSpot(dt) {
    const a = this.actors.find((x) => x.id === this.feature);
    const want = a ? 2.4 : 0;
    this.spot.intensity += (want - this.spot.intensity) * (1 - Math.exp(-dt * 4));
    if (!a) return;
    const p = a.root.position;
    this.spot.position.set(p.x + 6, a.height * 3 + 8, p.z + 6);
    this.spot.target.position.set(p.x, a.height * 0.4, p.z);
  }

  // ---------- the video board ----------
  // It cycles: the PokeBall wordmark, the featured Pokémon, the franchise you last played.
  setBoardInfo(info) { this.board.info = info; this.board.next = 0; }
  updateBoard() {
    const B = this.board;
    if (this.t >= B.next) { B.slide = (B.slide + 1) % 3; B.next = this.t + (B.slide === 0 ? 6 : 4.5); }
    // Redrawn at about 12 frames a second for the sweep of light across it.
    const frame = Math.floor(this.t * 12);
    if (frame === B.frame) return;
    B.frame = frame;
    const st = this.stadium, c = st.boardCanvas, x = c.getContext('2d'), W = c.width, H = c.height;
    const font = (w, px) => `${w} ${px}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#13284d'); bg.addColorStop(1, BRAND.navy);
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const P = this.feature != null ? PLAYERS[this.feature] : null;
    const info = B.info;
    let slide = B.slide;
    if (slide === 1 && !P) slide = 0;
    if (slide === 2 && !info) slide = 0;
    if (slide === 0) {
      x.fillStyle = BRAND.red; x.fillRect(0, H - 34, W, 34);
      drawEmblem(x, 92, 82, 52);
      x.font = `italic ${font(800, 92)}`; x.fillStyle = BRAND.white; x.textAlign = 'left';
      x.fillText('POKEBALL', 160, 84);
      x.textAlign = 'center'; x.font = font(700, 22); x.fillStyle = BRAND.white;
      x.fillText('DRAFT POKÉMON  ·  COACH FOOTBALL', W / 2, H - 17);
    } else if (slide === 1) {
      const tc = TYPE_COLORS[P.types[0]] ?? BRAND.gold;
      x.fillStyle = tc; x.fillRect(0, 0, 14, H);
      x.font = font(600, 26); x.fillStyle = BRAND.gold; x.fillText('ON THE FIELD', W / 2, 34);
      x.font = font(800, 84); x.fillStyle = BRAND.white; fitText(x, P.name.toUpperCase(), W - 60); x.fillText(P.name.toUpperCase(), W / 2, 94);
      const a = this.actors.find((q) => q.id === this.feature);
      x.font = font(700, 30); x.fillStyle = BRAND.white; x.fillText(`${a.role}  ·  ${P.ovr[a.role]} OVR  ·  ${P.types.join(' / ').toUpperCase()}`, W / 2, 152);
    } else {
      x.fillStyle = info.color; x.fillRect(0, 0, W, 54);
      x.font = font(800, 40); x.fillStyle = info.ink; fitText(x, info.name.toUpperCase(), W - 40); x.fillText(info.name.toUpperCase(), W / 2, 29);
      x.font = font(800, 74); x.fillStyle = BRAND.white; x.fillText(info.big, W / 2, 106);
      x.font = font(600, 26); x.fillStyle = BRAND.gold; fitText(x, info.small, W - 40); x.fillText(info.small, W / 2, 160);
    }
    if (!reduceMotion) {
      // A sweep of light across the panels.
      const u = (this.t * 0.35) % 1.6 - 0.3, sx = u * W;
      const sh = x.createLinearGradient(sx - 60, 0, sx + 60, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.13)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = sh; x.fillRect(0, 0, W, H);
    }
    x.fillStyle = 'rgba(0,0,0,0.26)';
    for (let i = 0; i < W; i += 4) x.fillRect(i, 0, 1, H);
    for (let j = 0; j < H; j += 4) x.fillRect(0, j, W, 1);
    st.boardTex.needsUpdate = true;
  }

  // ---------- running ----------
  mount(host) {
    if (this.el.parentElement !== host) host.appendChild(this.el);
    this.resize();
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.onVis);
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  }
  unmount() {
    this.running = false;
    this.launchAt = null;
    this.cam.snap = true;
    window.removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVis);
    this.el.remove();
  }
  setQuality(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.applyRatio(q === 'low' ? 1 : this.maxRatio);
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  applyRatio(r) { if (r === this.ratio) return; this.ratio = r; this.renderer.setPixelRatio(r); this.resize(); }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const real = Math.max(0, (now - this.last) / 1000), dt = Math.min(0.05, real);
    this.last = now;
    this.t += dt;
    // Frame time: on a slow machine (auto quality) drop the resolution once.
    this.frames.push(Math.min(1, real));
    if (this.frames.length > 60) this.frames.shift();
    const avg = this.frames.reduce((s, v) => s + v, 0) / this.frames.length;
    window.__menuFps = Math.round(1 / Math.max(1e-3, avg));
    if (this.quality === 'auto' && this.frames.length === 60 && avg > 1 / 40 && this.ratio > 1) { this.applyRatio(1); this.frames.length = 0; }
    for (const a of this.actors) this.updateActor(a, dt);
    if (!this.actors.find((a) => a.ball)?.fig) this.ball.visible = false;
    this.scheduleReactions();
    this.updateCamera(dt, real);
    this.updateSpot(dt);
    this.updateAtmosphere();
    this.stadium.update(this.t, dt, this.cam.look);
    this.updateBoard();
    this.renderer.render(this.scene, this.camera);
  }
}

// The PokeBall emblem: a Poké Ball whose center band is a football's laces. Drawn on a canvas
// (the video board); the page draws the same mark in SVG.
export function drawEmblem(x, cx, cy, r) {
  x.save();
  x.translate(cx, cy);
  x.beginPath(); x.arc(0, 0, r, Math.PI, 0); x.closePath(); x.fillStyle = BRAND.red; x.fill();
  x.beginPath(); x.arc(0, 0, r, 0, Math.PI); x.closePath(); x.fillStyle = BRAND.white; x.fill();
  x.fillStyle = BRAND.navy; x.fillRect(-r, -r * 0.13, r * 2, r * 0.26);
  x.fillStyle = BRAND.white;
  for (let i = -3; i <= 3; i++) if (Math.abs(i) > 0) x.fillRect(i * r * 0.17 - r * 0.03, -r * 0.2, r * 0.06, r * 0.4);
  x.beginPath(); x.arc(0, 0, r * 0.3, 0, Math.PI * 2); x.fillStyle = BRAND.navy; x.fill();
  x.beginPath(); x.arc(0, 0, r * 0.18, 0, Math.PI * 2); x.fillStyle = BRAND.white; x.fill();
  x.lineWidth = r * 0.08; x.strokeStyle = BRAND.navy; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke();
  x.restore();
}

let menu = null, tried = false;
// The one menu scene, built the first time the home screen shows (null without WebGL).
export function menuStage() {
  if (menu || tried) return menu;
  tried = true;
  try { if (webglAvailable()) menu = new MenuStage(); } catch (e) { console.warn('menu scene', e); menu = null; }
  if (typeof window !== "undefined") window.__pbMenu = menu; // for the browser tests
  return menu;
}
export const peekMenu = () => menu;
