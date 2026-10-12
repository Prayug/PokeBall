// The 3D game view. A three.js scene that draws the live play from the simulation in
// live.js: the stadium (stadium3d.js), a 3D figure for every Pokémon (figure3d.js) animated
// from what the simulation says it is doing (anim3d.js), a real 3D football, the line of
// scrimmage, the line to gain, play art and the football camera (camera3d.js).
//
// World coordinates are yards: x from the left end line (-10) to the right one (110), y up,
// z across the field. A live play's own frame (x downfield from the line, y across) maps to
// the world through world(): x_w = los + dir * x, z_w = dir * y.
import * as THREE from 'three';
import { SPRITE_INDEX } from './sprites3d.js';
import { PLAYERS } from './ratings.js';
import { absSpot } from './engine.js';
import { Stadium, HALF_W } from './stadium3d.js';
import { template, upgradeTemplate, makeFigure, disposeFigure, placeholder, flies } from './figure3d.js';
import { Animator } from './anim3d.js';
import { CameraRig } from './camera3d.js';
import { bodyOf } from './body.js';

const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const RECEIVER_KEYS = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
export const ART_COLORS = ['#ffd23f', '#4fc3f7', '#ff7a59', '#c792ff', '#7fdc93'];
const LINE_SLOTS = new Set(['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DE', 'DT1', 'DT2']);
const BACK_SLOTS = new Set(['CB1', 'CB2', 'CB3', 'FS', 'SS', 'MLB', 'OLB']);

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Stage {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'stage';
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.ratio = this.maxRatio;
    r.setPixelRatio(this.ratio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.el.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.3, 1400);
    this.rig = new CameraRig(this.camera);
    this.stadium = new Stadium(this.scene, r);
    this.actors = new Map();
    this.fx = [];
    this.evSeen = 0;
    this.celebrate = 0;
    this.inset = 0; this.insetWant = 0;
    this.quality = 'auto';
    this.weatherFx = true;
    this.frameMs = 16; this.lastScale = 0;
    this.buildOverlays();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.last = performance.now();
  }

  // ---------- markers and play art ----------
  buildOverlays() {
    const S = this.scene;
    // Line of scrimmage (blue) and line to gain (yellow): thin glowing strips on the turf.
    const lineGeo = new THREE.PlaneGeometry(0.32, HALF_W * 2 - 0.2);
    const lineMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false });
    this.losLine = new THREE.Mesh(lineGeo, lineMat('#2f7bff', 0.9));
    this.firstLine = new THREE.Mesh(lineGeo, lineMat('#ffd21f', 0.92));
    for (const l of [this.losLine, this.firstLine]) { l.rotation.x = -Math.PI / 2; l.position.y = 0.025; l.renderOrder = 2; S.add(l); }
    // Football
    this.ball = new THREE.Mesh(footballGeometry(), new THREE.MeshStandardMaterial({ map: footballTexture(), roughness: 0.5 }));
    this.ball.castShadow = true;
    this.ballSpin = 0;
    S.add(this.ball);
    // Selection ring under your player and a halo under the ball carrier.
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.12, 48), new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
    this.selRing.rotation.x = -Math.PI / 2; this.selRing.renderOrder = 3; S.add(this.selRing);
    this.selArrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 3), new THREE.MeshBasicMaterial({ color: '#ffe14d', fog: false }));
    this.selArrow.rotation.x = Math.PI; S.add(this.selArrow);
    this.carryRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.25, 48), new THREE.MeshBasicMaterial({ map: haloTexture(), color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.carryRing.rotation.x = -Math.PI / 2; this.carryRing.renderOrder = 3; S.add(this.carryRing);
    // Landing spot of a pass and its flight path.
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
    this.target.rotation.x = -Math.PI / 2; this.target.position.y = 0.04; S.add(this.target);
    this.arcPts = new Float32Array(41 * 3);
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(this.arcPts, 3));
    this.arc = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.45, transparent: true, opacity: 0.55, fog: false }));
    this.arc.frustumCulled = false; this.arc.visible = false; S.add(this.arc);
    // Throw keys over the receivers.
    this.icons = {};
    RECEIVER_KEYS.forEach((k, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(String(i + 1), ART_COLORS[i]), depthTest: false, fog: false }));
      sp.scale.set(1.1, 1.1, 1); sp.renderOrder = 10; sp.visible = false;
      this.icons[k] = sp; S.add(sp);
    });
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, fog: false, transparent: true }));
    this.label.renderOrder = 11; this.label.visible = false; this.labelKey = '';
    S.add(this.label);
    this.art = new THREE.Group();
    S.add(this.art);
  }

  // ---------- play ----------
  setPlay(lp) {
    if (lp !== this.lp) { this.evSeen = 0; this.celebrate = 0; }
    this.lp = lp;
    if (!lp) return;
    const g = lp.g;
    this.stadium.paint(g.teams);
    this.stadium.setWeather(g.weather, this.weatherFx);
    for (const t of g.teams) for (const id of t.roster ?? []) { const e = SPRITE_INDEX[id]; if (e) loadChunk(e[0]); template(id); }
    this.dir = lp.o === 0 ? 1 : -1;
    this.los = absSpot(lp.o, lp.spot);
    const toGo = lp.spot + g.toGo < 100 ? absSpot(lp.o, lp.spot + g.toGo) : null;
    this.losLine.position.x = this.los;
    this.firstLine.visible = toGo != null;
    if (toGo != null) this.firstLine.position.x = toGo;
    const stamp = performance.now();
    for (const p of lp.players) this.actorFor(p, g.teams[p.ti]).seen = stamp;
    for (const [k, a] of this.actors) if (a.seen !== stamp) this.removeActor(k);
    for (const a of this.actors.values()) { a.act = null; a.fallWant = 0; a.flash = 0; }
    this.prevPhase = lp.phase;
    this.drawArt();
  }

  world(x, y, h = 0, out = new THREE.Vector3()) { return out.set(this.los + this.dir * x, h, y * this.dir); }
  actorOf(p) { return p ? this.actors.get(`${p.ti}:${p.id}`) : null; }

  actorFor(p, team) {
    const key = `${p.ti}:${p.id}`;
    const old = this.actors.get(key);
    if (old && old.color === team.color) return old;
    if (old) this.removeActor(key);
    const body = bodyOf(p.id);
    const root = new THREE.Group();
    const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 1;
    ring.scale.setScalar(body.r * 1.25);
    const blob = new THREE.Mesh(BLOB_GEO, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; blob.scale.setScalar(body.r * 1.5);
    this.scene.add(root, ring, blob);
    const a = { key, id: p.id, root, ring, blob, body, color: team.color, fig: null, ph: null, version: -1,
      anim: null, yaw: p.side === 'off' ? Math.PI / 2 * this.dirOr(1) : -Math.PI / 2 * this.dirOr(1), yawInit: false, turn: 0,
      act: null, fallWant: 0, fallDir: null, flash: 0, flier: flies(p.id), seen: 0, pos: new THREE.Vector3() };
    a.anim = new Animator(null, (p.id * 0.618) % 1);
    this.actors.set(key, a);
    return a;
  }

  dirOr(d) { return this.dir ?? d; }

  removeActor(key) {
    const a = this.actors.get(key);
    if (!a) return;
    if (a.fig) { disposeFigure(a.fig); a.fig.mesh.material.dispose(); }
    for (const o of [a.root, a.ring, a.blob]) { this.scene.remove(o); o.material?.dispose?.(); }
    this.actors.delete(key);
  }

  // Swap in the species' figure once it is built (or rebuilt with its back view).
  syncFigure(a) {
    const T = template(a.id);
    const strip = bank.strips[a.id];
    if (strip && !T.hasBack) upgradeTemplate(a.id, strip);
    if (!T.ready) {
      if (!a.ph) { a.ph = placeholder(); a.root.add(a.ph); }
      return;
    }
    if (a.version === T.version) return;
    if (a.ph) { a.root.remove(a.ph); a.ph = null; }
    if (a.fig) { disposeFigure(a.fig); a.fig.mesh.material.dispose(); }
    a.fig = makeFigure(T);
    a.fig.mesh.material = a.fig.mesh.material.clone();
    a.root.add(a.fig.group);
    a.anim.setFigure(a.fig);
    a.version = T.version;
  }

  // ---------- pre-snap play art ----------
  drawArt() {
    const G = this.art;
    while (G.children.length) { const c = G.children.pop(); c.geometry.dispose(); c.material.dispose(); }
    const lp = this.lp;
    if (!lp || lp.preview || lp.user == null) return;
    const W = (x, y) => this.world(x, y, 0.05);
    if (lp.user === lp.o) {
      if (lp.kind === 'pass') {
        RECEIVER_KEYS.forEach((k, i) => {
          const p = lp.off[k];
          if (!p) return;
          if (p.role === 'passblock' || !p.route) { G.add(ribbon([W(p.home.x, p.home.y), W(p.home.x - 1.4, p.home.y * 0.8)], 0.16, '#9fb3c8', 0.6, 'bar')); return; }
          const pts = [W(p.home.x, p.home.y)];
          for (const w of p.route) if (w.x != null) pts.push(W(w.x, w.y));
          if (pts.length > 1) G.add(ribbon(pts, 0.2, ART_COLORS[i], 0.92, p.route[p.route.length - 1]?.stop ? 'bar' : 'arrow'));
        });
      } else {
        // Run: the lane the carrier takes and who each blocker takes.
        const c = lp.carrier ?? lp.off.RB;
        if (c) {
          const hole = lp.holeY ?? 0;
          G.add(ribbon([W(c.home.x, c.home.y), W(-3.5, hole * 0.35), W(1.5, hole), W(6, hole * 1.05)], 0.34, '#ffd23f', 0.9, 'arrow'));
        }
        for (const k of ['LT', 'LG', 'C', 'RG', 'RT', 'TE']) {
          const b = lp.off[k];
          if (!b?.assign) continue;
          const d = b.assign;
          const to = { x: (b.home.x + d.home.x) / 2 + 0.3, y: (b.home.y + d.home.y) / 2 };
          G.add(ribbon([W(b.home.x, b.home.y), W(to.x, to.y)], 0.12, '#cfd8e3', 0.75, 'bar'));
        }
      }
    } else {
      // Defense: zones as soft discs, man assignments as thin lines, rushers as arrows.
      for (const p of Object.values(lp.def)) {
        if (p.zone) {
          const z = p.zone;
          const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: z.x >= 15 ? '#4fc3f7' : '#ffd23f', transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
          disc.rotation.x = -Math.PI / 2; disc.position.copy(W(z.x, z.y)); disc.scale.set(z.r * 0.85, z.r * 0.6, 1); disc.position.y = 0.035;
          G.add(disc);
          G.add(ribbon([W(p.home.x, p.home.y), W(z.x, z.y)], 0.1, z.x >= 15 ? '#4fc3f7' : '#ffd23f', 0.55, 'bar'));
        } else if (p.man) {
          G.add(ribbon([W(p.home.x, p.home.y), W(p.man.home.x + 0.5, p.man.home.y)], 0.09, '#ff9d7a', 0.7, 'bar'));
        } else if (p.role === 'rush') {
          const blitz = !LINE_SLOTS.has(p.slot);
          G.add(ribbon([W(p.home.x, p.home.y), W(-2.5, p.home.y * 0.5)], blitz ? 0.24 : 0.14, blitz ? '#ff5a4f' : '#e7b7b0', blitz ? 0.95 : 0.6, 'arrow'));
        }
      }
    }
  }

  // ---------- events ----------
  readEvents(lp, t) {
    while (this.evSeen < lp.events.length) {
      const e = lp.events[this.evSeen++];
      const a = this.actorOf(e.who), b = this.actorOf(e.other);
      switch (e.kind) {
        case 'throw':
          if (a) { a.act = { kind: 'throw', t0: t, dur: 0.38 }; a.releaseH = this.handHeight(a); }
          break;
        case 'catch': case 'int':
          if (a) { a.act = { kind: 'secure', t0: t, dur: 0.45 }; a.flash = 0.5; this.burst(a.pos, e.kind === 'int' ? '#ff7a59' : '#ffffff', 0.8); }
          if (e.kind === 'int') { this.stadium.cheer(0.7); this.rig.shake = Math.max(this.rig.shake, 0.15); }
          break;
        case 'handoff': if (a) a.act = { kind: 'secure', t0: t, dur: 0.35 }; break;
        case 'broken':
          if (b) {
            const hard = e.how === 'truck';
            b.act = { kind: 'whiff', t0: t, dur: hard ? 1.0 : 0.8 };
            b.fallDir = this.localDir(b, a ? b.pos.x - a.pos.x : 1, a ? b.pos.z - a.pos.z : 0, hard ? 1 : -1);
            b.flash = hard ? 0.5 : 0.2;
            if (hard) this.rig.shake = Math.max(this.rig.shake, 0.3);
            if (a) this.burst(a.pos.clone().lerp(b.pos, 0.5), hard ? '#ffd23f' : '#ffffff', hard ? 1.1 : 0.7);
          }
          break;
        case 'tackle': case 'sack': {
          if (a) { a.act = { kind: 'tackle', t0: t, dur: 99 }; }
          if (b) {
            b.fallWant = 1;
            // Driven the way the tackler was moving into him.
            const dx = a ? b.pos.x - a.pos.x : 1, dz = a ? b.pos.z - a.pos.z : 0;
            b.fallDir = this.localDir(b, dx, dz, 1);
            b.flash = 0.35;
          }
          if (a && b) this.burst(b.pos.clone().lerp(a.pos, 0.4), e.kind === 'sack' ? '#ff7a59' : '#ffffff', e.kind === 'sack' ? 1.3 : 0.9);
          this.rig.shake = Math.max(this.rig.shake, e.kind === 'sack' ? 0.28 : 0.14);
          if (e.kind === 'sack') this.stadium.cheer(0.6);
          break;
        }
        case 'incomplete': if (a) a.act = { kind: 'miss', t0: t, dur: 0.7 }; break;
        default: break;
      }
    }
  }

  // A world direction as the [x, z] components in an actor's own frame.
  localDir(a, wx, wz, sign) {
    const l = Math.hypot(wx, wz) || 1;
    wx = (wx / l) * sign; wz = (wz / l) * sign;
    const c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    return [wx * c - wz * s, wx * s + wz * c];
  }

  // ---------- per frame ----------
  frame(now = performance.now()) {
    const dtRaw = (now - this.last) / 1000;
    const dt = Math.min(0.05, dtRaw);
    this.last = now;
    this.autoScale(dtRaw);
    const t = now / 1000;
    const lp = this.lp;
    this.updateFx(t, dt);
    if (!lp) { this.stadium.update(t, dt, this.rig.look); this.renderer.render(this.scene, this.camera); return; }
    const pre = lp.phase === 'pre';
    this.art.visible = pre;
    this.readEvents(lp, t);
    const td = lp.phase === 'dead' && lp.end?.how === 'td';
    if (td && !this.celebrate) { this.celebrate = t; this.confetti(this.actorOf(lp.carrier)?.pos, lp.g.teams[lp.carrier.ti].color); this.stadium.cheer(1); }
    let held = null;
    const obstacles = this.obstacles ?? (this.obstacles = []);
    obstacles.length = 0;
    for (const p of lp.players) {
      const a = this.actorOf(p);
      if (!a) continue;
      this.syncFigure(a);
      this.world(p.x, p.y, 0, a.pos);
      // Facing: where the player is going, turning at its own rate.
      const want = this.wantYaw(lp, p, a);
      if (!a.yawInit || reduceMotion) { a.yaw = want; a.yawInit = true; }
      const rate = (5 + (p.a.agi ?? 60) / 14) * (p.carrier ? 1.1 : 1);
      const d = angDiff(a.yaw, want);
      const step = clampN(d, -rate * dt, rate * dt);
      a.yaw += step;
      a.turn = a.turn * 0.8 + (dt > 0 ? step / dt : 0) * 0.2;
      const s = this.situation(lp, p, a, t, td);
      const T = a.fig?.template;
      s.height = T?.height ?? a.body.height;
      s.shortLegs = T ? T.rig.legTop / T.px < 0.22 : false;
      if (a.fig) a.anim.update(dt, s);
      a.root.position.copy(a.pos);
      a.root.rotation.y = a.yaw + (a.fig ? a.anim.yawOffset : 0);
      if (a.ph) { a.ph.position.y = s.hover ? 0.4 : 0; }
      // Flash on contact: a quick white glow.
      a.flash = Math.max(0, a.flash - dt * 2);
      if (a.fig) { const m = a.fig.mesh.material; m.emissive.setScalar(a.flash * 0.6); }
      // Team ring and contact shadow stay on the turf.
      const lift = a.fig ? a.anim.lift : 0;
      a.ring.position.set(a.pos.x, 0.03, a.pos.z);
      a.blob.position.set(a.pos.x, 0.02, a.pos.z);
      const sh = 1 / (1 + lift * 0.9);
      a.blob.scale.setScalar(a.body.r * 1.6 * (0.7 + sh * 0.3));
      a.blob.material.opacity = 0.75 * sh;
      a.ring.visible = !(lp.phase === 'dead' && a.fallWant);
      if (lp.ball.state === 'held' && lp.ball.holder === p) held = a;
      obstacles.push({ x: a.pos.x, z: a.pos.z, r: a.body.r, h: s.height + lift });
    }
    this.placeBall(lp, held, t, dt);
    this.markers(lp, now, dt);
    // Camera
    this.rig.update(dt, this.framing(lp), this.camera.aspect, obstacles, this.snapNext || reduceMotion);
    this.snapNext = false;
    this.applyInset(reduceMotion ? 1 : 1 - Math.exp(-dt * 6));
    this.stadium.follow(this.rig.look.x, this.rig.look.z * 0.5);
    this.stadium.update(t, dt, this.rig.look);
    this.prevPhase = lp.phase;
    this.renderer.render(this.scene, this.camera);
  }

  // Which way a player should face this frame.
  wantYaw(lp, p, a) {
    const yawOf = (fx, fy) => Math.atan2(fx * this.dir, fy * this.dir);
    const toward = (x, y) => yawOf(x - p.x, y - p.y);
    const sp = Math.hypot(p.vx, p.vy);
    if (lp.phase === 'pre') {
      if (sp > 0.8) return yawOf(p.vx, p.vy);
      return yawOf(p.side === 'off' ? 1 : -1, 0);
    }
    if (p.eng) return toward(p.eng.x, p.eng.y);
    // Dropping back and backpedaling in coverage: keep the eyes upfield.
    if (lp.phase === 'live' && !lp.carrierSet && !lp.thrown) {
      if (p.side === 'off' && (p.slot === 'QB' || p.role === 'passblock') && p.vx < 0) return yawOf(1, 0);
      if (p.side === 'def' && p.role === 'cover' && p.vx > 0 && sp < p.top * 0.8) return yawOf(-1, p.vy * 0.15);
    }
    if (sp > 0.6) return yawOf(p.vx, p.vy);
    if (lp.phase === 'dead') return a.yaw;
    // Standing: watch the ball.
    const b = lp.ball;
    if (Math.hypot(b.x - p.x, b.y - p.y) > 1) return toward(b.x, b.y);
    return a.yaw;
  }

  // What the animation layer needs to know about a player this frame.
  situation(lp, p, a, t, td) {
    const s = { speed: Math.hypot(p.vx, p.vy), top: p.top, mode: lp.phase, turn: a.turn, set: true };
    if (lp.phase === 'pre') {
      s.set = s.speed < 0.35;
      s.stance = LINE_SLOTS.has(p.slot) ? 'line' : p.slot === 'QB' ? 'qb' : BACK_SLOTS.has(p.slot) ? 'back' : 'skill';
    }
    s.engaged = !!p.eng && lp.phase === 'live';
    if (p.eng) { const o = this.actorOf(p.eng); s.pushSide = o ? Math.sign(this.lateralOf(a, o.pos)) : 0; }
    const holding = lp.ball.state === 'held' && lp.ball.holder === p && lp.phase !== 'pre';
    s.carrier = holding;
    s.qbHold = holding && p.slot === 'QB' && p.side === 'off' && lp.kind === 'pass' && !lp.thrown && lp.qbState !== 'run' && lp.t > 0.25;
    s.hover = a.flier && !(a.fallWant > 0);
    // Facing vs moving: backpedaling.
    if (s.speed > 0.7) { const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw); s.backpedal = (p.vx * this.dir * fx + p.vy * this.dir * fz) / s.speed < -0.3; }
    // One-shots
    const A = a.act;
    if (A) {
      const u = (t - A.t0) / A.dur;
      if (u >= 1 && A.kind !== 'tackle') a.act = null;
      else switch (A.kind) {
        case 'throw': s.throwU = u; break;
        case 'secure': s.carrier = true; s.reach = Math.max(0, 1 - u * 2); break;
        case 'whiff': { const k = u < 0.3 ? u / 0.3 : u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35; s.fall = k; s.fallDir = a.fallDir; break; }
        case 'tackle': s.dive = Math.min(1, (t - A.t0) / 0.28); if (lp.phase !== 'dead' && t - A.t0 > 0.7) a.act = null; break;
        case 'miss': s.stun = Math.sin(u * Math.PI) * 0.6; break;
        default: break;
      }
    }
    // Diving at the carrier or the ball.
    if (p.dive != null && p.dive > -0.6 && A?.kind !== 'tackle') s.dive = clampN((0.3 - p.dive) / 0.5, 0, 1) * (p.dive > -0.3 ? 1 : (p.dive + 0.6) / 0.3);
    // Reaching for a pass that is about to arrive (the target, and a defender playing it).
    const T = lp.thrown;
    if (lp.phase === 'live' && T && lp.ball.state === 'air') {
      const left = T.t0 + T.T - lp.t;
      const close = Math.hypot(T.tx - p.x, T.ty - p.y);
      if ((T.target === p || (p.side === 'def' && close < 1.8)) && left < 0.5) { s.reach = 1 - left / 0.5; s.reachHigh = lp.ball.z > 2.6 ? 0.35 : 0; }
    }
    if (p.juke > 0) s.juke = Math.sin(clampN(p.juke / 0.35, 0, 1) * Math.PI) * (p.jukeSide ?? 1);
    if (p.truck > 0) s.truck = Math.sin(clampN(p.truck / 0.4, 0, 1) * Math.PI);
    if (p.spin > 0) s.spin = (1 - p.spin / 0.45) * Math.PI * 2 * (p.spinDir ?? 1);
    if (p.stun > 0 && !p.eng) s.stun = Math.max(s.stun ?? 0, Math.min(1, p.stun * 2));
    // Down on the turf after the whistle.
    const downed = lp.phase === 'dead' && lp.end && (((lp.end.how === 'tackle' || lp.end.how === 'sack') && lp.carrier === p) || (lp.end.how === 'sack' && p.slot === 'QB' && p.side === 'off'));
    if (downed) { a.fallWant = 1; if (!a.fallDir) a.fallDir = [0, -1]; }
    if (a.fallWant) { s.fall = Math.max(s.fall ?? 0, a.fallWant); s.fallDir = a.fallDir; s.carrier = false; }
    if (lp.phase === 'pre' && a.fallWant) a.fallWant = 0;
    // Touchdown: the scorer and nearby teammates celebrate.
    if (td && this.celebrate && lp.carrier) {
      const c = lp.carrier;
      if (p === c) s.celebrate = Math.min(1, (t - this.celebrate) * 3);
      else if (p.ti === c.ti && Math.hypot(p.x - c.x, p.y - c.y) < 14) s.celebrate = Math.min(1, (t - this.celebrate - 0.3) * 2);
      if (s.celebrate <= 0) s.celebrate = 0;
    }
    return s;
  }

  lateralOf(a, pt) { const c = Math.cos(a.yaw), s = Math.sin(a.yaw); return (pt.x - a.pos.x) * c - (pt.z - a.pos.z) * s; }

  handHeight(a) { return a.fig ? a.fig.template.height * 0.85 : 1.8; }

  // A point in a figure's bone space, in world coordinates.
  bonePoint(a, bone, x, y, z, out) {
    const f = a.fig;
    f.group.updateMatrixWorld(true);
    return out.set(x, y, z).applyMatrix4(f.bones[bone].matrixWorld);
  }

  // The ball: in the carrier's arm, up by the passer's ear, in the center's hands before the
  // snap, or flying on the simulation's trajectory.
  placeBall(lp, holder, t, dt) {
    const b = lp.ball, ball = this.ball;
    const orient = (yaw, pitch, spin) => ball.rotation.set(spin, yaw, pitch, 'YZX');
    if (holder?.fig && b.state === 'held') {
      const T = holder.fig.template, A = T.rig, dz = (T.depth / T.scale) * 0.5;
      const qbSet = lp.phase !== 'pre' && lp.kind === 'pass' && holder === this.actorOf(lp.off.QB) && !lp.thrown && lp.qbState !== 'run';
      if (lp.phase === 'pre') {
        // On the turf at the center's hands.
        this.world(0.05, 0, 0.17, ball.position);
        orient(Math.PI / 2, 0, 0);
      } else if (qbSet) {
        this.bonePoint(holder, 'armR', A.armX * 0.35, A.width * 0.08, dz * 0.4, ball.position);
        orient(holder.yaw - Math.PI / 2, 0.6, 0);
      } else {
        this.bonePoint(holder, 'chest', A.armX * 0.75, -(A.shoulder - A.legTop) * 0.25, dz * 0.95, ball.position);
        orient(holder.yaw - Math.PI / 2, 0.35, 0);
      }
      // Hand-offs and catches: glide the last few inches instead of popping.
      if (this.ballGlide > 0 && this.lastBall) { ball.position.lerp(this.lastBall, this.ballGlide); this.ballGlide = Math.max(0, this.ballGlide - dt * 6); }
    } else if (b.state === 'held' && b.holder) {
      this.world(b.x, b.y, b.z, ball.position);
    } else {
      this.world(b.x, b.y, b.z, ball.position);
      const T = lp.thrown;
      if (b.state === 'air' && T) {
        // Leave from the passer's hand and arrive at the receiver's chest.
        const u = clampN((lp.t - T.t0) / T.T, 0, 1.2);
        const qa = this.actorOf(lp.off.QB), ra = this.actorOf(T.target);
        const h0 = qa?.releaseH ?? 1.9, h1 = ra ? (ra.fig?.template.height ?? 1.8) * 0.62 : 1.2;
        ball.position.y += (h0 - 1.9) * Math.max(0, 1 - u) + (h1 - 1.9) * Math.min(1, u);
        this.ballSpin += dt * 26;
        const yaw = Math.atan2(-(T.ty - T.sy) * this.dir, (T.tx - T.sx) * this.dir);
        const rise = this.lastBall && dt > 0 ? (ball.position.y - this.lastBall.y) / dt : 0;
        const run = this.lastBall && dt > 0 ? Math.hypot(ball.position.x - this.lastBall.x, ball.position.z - this.lastBall.z) / dt : 1;
        orient(yaw, Math.atan2(rise, run) * 0.9, this.ballSpin);
      } else if (b.state === 'snap') {
        this.ballSpin += dt * 10;
        orient(Math.PI / 2 * this.dir, 0, this.ballSpin);
      } else if (ball.position.y < 0.3) ball.position.y = 0.17;
    }
    if (this.prevHolder !== holder) { this.ballGlide = this.prevHolder && holder ? 0.85 : 0; this.prevHolder = holder; }
    // Spiking it after a touchdown.
    if (this.celebrate && lp.end?.how === 'td') {
      const ct = t - this.celebrate, a = this.actorOf(lp.carrier);
      if (a && ct < 1.3) {
        const k = ct / 1.3;
        ball.position.set(a.pos.x + Math.sin(a.yaw) * 0.6, Math.max(0.17, (1 - k) * 1.6 + Math.sin(k * Math.PI) * 2.4 * (1 - k)), a.pos.z + Math.cos(a.yaw) * 0.6);
        this.ballSpin += dt * 14; orient(a.yaw, 1.2 * (1 - k), this.ballSpin);
      }
    }
    this.lastBall = (this.lastBall ?? new THREE.Vector3()).copy(ball.position);
    // Pass target and flight path
    const T = lp.thrown;
    const inAir = b.state === 'air' && !!T?.target;
    this.target.visible = inAir;
    this.arc.visible = inAir && !reduceMotion;
    if (inAir) {
      this.world(T.tx, T.ty, 0.04, this.target.position);
      const qa = this.actorOf(lp.off.QB), ra = this.actorOf(T.target);
      const h0 = qa?.releaseH ?? 1.9, h1 = ra ? (ra.fig?.template.height ?? 1.8) * 0.62 : 1.2;
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const z = 1.9 + Math.sin(Math.PI * u) * (0.3 + T.T * T.T * 1.4) + (h0 - 1.9) * (1 - u) + (h1 - 1.9) * u;
        this.world(T.sx + (T.tx - T.sx) * u, T.sy + (T.ty - T.sy) * u, z, _v);
        this.arcPts.set([_v.x, _v.y, _v.z], i * 3);
      }
      this.arc.geometry.attributes.position.needsUpdate = true;
      this.arc.computeLineDistances();
    }
  }

  // Selection ring, carrier halo, throw keys and the name over your player.
  markers(lp, now, dt) {
    const c = lp.control;
    const sel = c && lp.phase !== 'dead' && !lp.preview ? this.actorOf(c) : null;
    this.selRing.visible = this.selArrow.visible = !!sel;
    if (sel) {
      const k = 1 + Math.sin(now / 220) * 0.05;
      this.selRing.position.set(sel.pos.x, 0.045, sel.pos.z);
      this.selRing.scale.setScalar(sel.body.r * 1.25 * k);
      const h = (sel.fig?.template.height ?? 2) + (sel.fig ? sel.anim.lift : 0);
      this.selArrow.position.set(sel.pos.x, h + 0.75 + Math.sin(now / 180) * 0.1, sel.pos.z);
      this.selArrow.rotation.y += dt * 2.5;
    }
    const holder = lp.ball.state === 'held' && lp.phase === 'live' ? this.actorOf(lp.ball.holder) : null;
    const showCarry = holder && !(lp.kind === 'pass' && lp.ball.holder === lp.off.QB && !lp.thrown && lp.qbState !== 'run');
    this.carryRing.visible = !!showCarry;
    if (showCarry) { this.carryRing.position.set(holder.pos.x, 0.04, holder.pos.z); this.carryRing.scale.setScalar(holder.body.r * 1.35); this.carryRing.material.color.set(lp.g.teams[lp.ball.holder.ti].color).lerp(_c.set('#ffffff'), 0.55); }
    const icons = !lp.preview && lp.user === lp.o && lp.kind === 'pass' && !lp.thrown && lp.qbState !== 'run' && lp.phase !== 'dead';
    for (const [k, sp] of Object.entries(this.icons)) {
      const p = lp.off[k];
      sp.visible = !!(icons && p && p.role === 'route');
      if (sp.visible) {
        const a = this.actorOf(p);
        sp.position.set(a.pos.x, (a.fig?.template.height ?? 2) + 0.85, a.pos.z);
        const s = clampN(this.camera.position.distanceTo(sp.position) * 0.05, 0.7, 1.6);
        sp.scale.set(s, s, 1);
      }
    }
    // Name and slot over your player before the snap, and over the ball carrier you control.
    const showName = sel && (lp.phase === 'pre' || (c.carrier && lp.phase === 'live'));
    this.label.visible = !!showName;
    if (showName) {
      const key = `${c.id}:${c.slot}`;
      if (key !== this.labelKey) {
        this.labelKey = key;
        this.label.material.map?.dispose();
        const { tex, aspect } = labelTexture(PLAYERS[c.id].name, c.slot);
        this.label.material.map = tex; this.label.material.needsUpdate = true; this.labelAspect = aspect;
      }
      const h = (sel.fig?.template.height ?? 2) + 1.55;
      this.label.position.set(sel.pos.x, h, sel.pos.z);
      const s = clampN(this.camera.position.distanceTo(this.label.position) * 0.034, 0.5, 1.2);
      this.label.scale.set(s * this.labelAspect, s, 1);
    }
  }

  // What the camera should frame this frame.
  framing(lp) {
    const f = this.frm ?? (this.frm = { focus: new THREE.Vector3(), fwd: 1, spread: 10, pre: true, deep: 0, tight: false, qb: new THREE.Vector3() });
    f.fwd = this.dir; f.pre = lp.phase === 'pre'; f.deep = 0; f.tight = false;
    const qb = this.actorOf(lp.off.QB);
    if (qb) f.qb.copy(qb.pos); else f.qb.copy(this.world(-5, 0));
    const b = lp.ball;
    if (f.pre) {
      this.world(2, 0, 0, f.focus);
      f.spread = 16;
    } else if (b.state === 'air' && lp.thrown) {
      const T = lp.thrown;
      const u = clampN((lp.t - T.t0) / T.T, 0, 1);
      // Pan with the ball, leaning toward where it will come down.
      this.world(T.sx + (T.tx - T.sx) * (0.35 + u * 0.65), T.sy + (T.ty - T.sy) * (0.35 + u * 0.65), 0, f.focus);
      f.deep = Math.hypot(T.tx - T.sx, T.ty - T.sy);
      f.spread = 12 + Math.min(14, f.deep * 0.3);
    } else if (lp.carrierSet || lp.phase === 'dead') {
      const c = lp.carrier ?? lp.ball.holder;
      if (c) this.world(c.x + c.vx * 0.3, c.y + c.vy * 0.3, 0, f.focus); else this.world(b.x, b.y, 0, f.focus);
      f.spread = lp.phase === 'dead' ? 8 : 10;
      f.tight = lp.phase === 'dead';
    } else {
      // Pocket: stay on the line so the routes stay in view.
      const x = Math.max(b.x, -3) * 0.4 + 1.5;
      this.world(x, b.y * 0.4, 0, f.focus);
      f.spread = lp.kind === 'pass' ? 14 : 11;
    }
    return f;
  }

  // ---------- effects ----------
  updateFx(t, dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i], u = (t - f.t0) / f.dur;
      if (u >= 1) { this.scene.remove(f.obj); f.dispose?.(); this.fx.splice(i, 1); continue; }
      f.update(u, dt);
    }
  }

  addFx(obj, dur, update, dispose) {
    this.scene.add(obj);
    this.fx.push({ obj, t0: performance.now() / 1000, dur, update, dispose });
    if (this.fx.length > 140) { const f = this.fx.shift(); this.scene.remove(f.obj); f.dispose?.(); }
  }

  burst(pos, color, size) {
    if (!pos || reduceMotion) return;
    const ring = new THREE.Mesh(BURST_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.06, pos.z);
    this.addFx(ring, 0.45, (u) => { const s = 0.6 + u * 2.4 * size; ring.scale.set(s, s, 1); ring.material.opacity = 0.75 * (1 - u); }, () => ring.material.dispose());
  }

  confetti(pos, color) {
    if (!pos || reduceMotion) return;
    const cols = [color, '#ffd23f', '#ffffff', '#4fc3f7', '#ff7a59'];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(CONFETTI_GEO, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, transparent: true }));
      const vx = (Math.random() - 0.5) * 9, vz = (Math.random() - 0.5) * 9, vy = 7 + Math.random() * 7, spin = (Math.random() - 0.5) * 20;
      const x0 = pos.x, z0 = pos.z;
      this.addFx(m, 2.4, (u) => {
        const tt = u * 2.4;
        m.position.set(x0 + vx * tt * 0.7, Math.max(0.05, 1 + vy * tt - 5 * tt * tt), z0 + vz * tt * 0.7);
        m.rotation.set(tt * spin, tt * spin * 0.7, 0);
        m.material.opacity = u > 0.75 ? (1 - u) * 4 : 1;
      }, () => m.material.dispose());
    }
  }

  // ---------- view ----------
  snapCamera() { this.snapNext = true; this.inset = this.insetWant; }
  setInset(px) { this.insetWant = Math.max(0, px || 0); }
  setCameraMode(m) { this.rig.setMode(m); }
  setWeatherFx(on) { this.weatherFx = on; if (this.lp) this.stadium.setWeather(this.lp.g.weather, on); }
  setQuality(q) { this.quality = q; this.applyRatio(q === 'high' ? this.maxRatio : q === 'low' ? Math.min(1, this.maxRatio) * 0.75 : this.ratio); this.renderer.shadowMap.enabled = q !== 'low'; this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }

  applyInset(k) {
    this.inset += (this.insetWant - this.inset) * k;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    if (this.inset < 0.5) { if (this.camera.view?.enabled) this.camera.clearViewOffset(); return; }
    this.camera.setViewOffset(w, h, 0, Math.min(h * 0.28, this.inset / 2), w, h);
  }

  // Resolution scaling: drop the pixel ratio when frames run long, raise it when there is room.
  autoScale(dtRaw) {
    if (this.quality !== 'auto' || !(dtRaw > 0) || dtRaw > 0.5) return;
    this.frameMs = this.frameMs * 0.95 + dtRaw * 1000 * 0.05;
    const now = performance.now();
    if (now - this.lastScale < 2500) return;
    if (this.frameMs > 24 && this.ratio > 0.6) { this.lastScale = now; this.applyRatio(Math.max(0.6, this.ratio * 0.85)); }
    else if (this.frameMs < 14 && this.ratio < this.maxRatio) { this.lastScale = now; this.applyRatio(Math.min(this.maxRatio, this.ratio * 1.15)); }
  }

  applyRatio(r) { this.ratio = r; this.renderer.setPixelRatio(r); this.resize(); }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Input from the screen arrows (up, right) to the play's own frame, for any camera.
  toPlayFrame(up, right) {
    const { up: U, right: R } = this.rig.groundAxes();
    const wx = U.x * up + R.x * right, wz = U.z * up + R.z * right;
    return { mx: wx * (this.dir ?? 1), my: wz * (this.dir ?? 1) };
  }

  dispose() {
    this.ro.disconnect();
    for (const k of [...this.actors.keys()]) this.removeActor(k);
    this.renderer.dispose();
  }
}

const _c = new THREE.Color();

// ---------- animated sprite strips, loaded on demand ----------
// build_sprites3d.py writes the strips into sprites3d/<chunk>.js next to the page, each a call
// to __pbSprites({id: [front, back]}). The figures read their back view from them.
const bank = { strips: {}, chunks: {} };
if (typeof window !== 'undefined') window.__pbSprites = (strips) => { Object.assign(bank.strips, strips); };
function loadChunk(c) {
  if (c == null || bank.chunks[c] || typeof document === 'undefined') return;
  bank.chunks[c] = 'loading';
  const s = document.createElement('script');
  s.src = `sprites3d/${c}.js`;
  s.async = true;
  s.onload = () => { bank.chunks[c] = 'ready'; };
  s.onerror = () => { bank.chunks[c] = 'failed'; };
  document.head.appendChild(s);
}

// ---------- shared geometry and textures ----------
const RING_GEO = new THREE.RingGeometry(0.86, 1, 40);
const BLOB_GEO = new THREE.PlaneGeometry(2, 2);
const BURST_GEO = new THREE.RingGeometry(0.5, 0.7, 32);
const CONFETTI_GEO = new THREE.PlaneGeometry(0.22, 0.12);

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 30, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function badgeTexture(label, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(32, 32, 27, 0, Math.PI * 2); x.fillStyle = color; x.fill();
  x.lineWidth = 4; x.strokeStyle = 'rgba(10,20,15,0.85)'; x.stroke();
  x.fillStyle = '#0d1a14'; x.font = '700 36px "Barlow Condensed", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function labelTexture(name, slot) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 64;
  const x = c.getContext('2d');
  x.font = '700 30px "Barlow Condensed", Arial, sans-serif';
  const text = `${name.toUpperCase()}  ·  ${slot}`;
  const w = Math.min(316, x.measureText(text).width + 28);
  x.fillStyle = 'rgba(10,22,16,0.82)';
  const x0 = (320 - w) / 2;
  x.beginPath(); x.roundRect(x0, 10, w, 44, 8); x.fill();
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 160, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: 5 };
}

// A flat ribbon along points on the turf, with an arrowhead or a block at the end.
function ribbon(pts, width, color, opacity, end) {
  const pos = [];
  const push = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const side = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: -dz / l, z: dx / l }; };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = side(a, b), h = width / 2;
    const a1 = { x: a.x + n.x * h, y: a.y, z: a.z + n.z * h }, a2 = { x: a.x - n.x * h, y: a.y, z: a.z - n.z * h };
    const b1 = { x: b.x + n.x * h, y: b.y, z: b.z + n.z * h }, b2 = { x: b.x - n.x * h, y: b.y, z: b.z - n.z * h };
    push(a1, a2, b1); push(b1, a2, b2);
    // Round the joint
    if (i > 0) { const pn = side(pts[i - 1], a); push(a, { x: a.x + pn.x * h, y: a.y, z: a.z + pn.z * h }, a1); push(a, { x: a.x - pn.x * h, y: a.y, z: a.z - pn.z * h }, a2); }
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1], n = side(a, b);
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
  if (end === 'arrow') {
    const s = width * 2.6;
    push({ x: b.x + n.x * s, y: b.y, z: b.z + n.z * s }, { x: b.x - n.x * s, y: b.y, z: b.z - n.z * s }, { x: b.x + ux * s * 1.6, y: b.y, z: b.z + uz * s * 1.6 });
  } else if (end === 'bar') {
    const s = width * 3.2, t = width * 0.9;
    const p1 = { x: b.x + n.x * s, y: b.y, z: b.z + n.z * s }, p2 = { x: b.x - n.x * s, y: b.y, z: b.z - n.z * s };
    const p3 = { x: p1.x + ux * t, y: b.y, z: p1.z + uz * t }, p4 = { x: p2.x + ux * t, y: b.y, z: p2.z + uz * t };
    push(p1, p2, p3); push(p3, p2, p4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.renderOrder = 2;
  return m;
}

// The football: a lathe-turned prolate spheroid, long axis along x.
function footballGeometry() {
  const L = 0.31, R = 0.19, pts = [];
  for (let i = 0; i <= 16; i++) {
    const u = -1 + (2 * i) / 16;
    pts.push(new THREE.Vector2(Math.max(0.012, R * Math.pow(1 - u * u, 0.75)), u * L));
  }
  return new THREE.LatheGeometry(pts, 20).rotateZ(-Math.PI / 2);
}

function footballTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#5a2a12'); gr.addColorStop(0.5, '#8a4520'); gr.addColorStop(1, '#5a2a12');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#f4efe6';
  for (const v of [9, 51]) x.fillRect(0, v, 128, 4);
  x.fillRect(30, 21, 4, 22);
  for (let k = 0; k < 7; k++) x.fillRect(26, 22 + k * 3, 12, 1.6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

void _v2; void _m;
