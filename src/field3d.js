// The 3D stadium: a three.js scene that draws a live play. Pokémon are animated 3D-model
// sprites on upright planes that turn to the camera on yaw only, so they stay planted on the
// turf, showing their back when they run away from the camera and their front when they come
// toward it. They idle in place, cycle their strip with stride length when they run, crouch on
// the snap and fall flat onto the turf when they are tackled. On top of each sprite's own idle loop,
// every player is posed each frame from what it is doing in the play: running strides,
// throwing, catching, jukes, spins, trucks, blocks, dives, tackles and celebrations.
import * as THREE from 'three';
import { SPRITE_INDEX } from './sprites3d.js';
import { SPRITES } from './sprites.js';
import { PLAYERS } from './ratings.js';
import { absSpot } from './engine.js';

const PX = 16; // texture pixels per yard
// Sprites keep one pixel density across the field, like a Mode 7 stadium: yards per sprite pixel.
const SPRITE_PX = 0.034;
const FIELD_W = 53.3;
const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

export class Stage {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'stage';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1a2a');
    this.scene.fog = new THREE.Fog('#0b1a2a', 70, 170);
    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
    this.camPos = new THREE.Vector3(30, 10, 0);
    this.camLook = new THREE.Vector3(45, 0, 0);
    this.texCache = new Map();
    this.actors = new Map();
    this.fx = [];
    this.shake = 0;
    this.evSeen = 0;
    this.celebrate = 0;
    this.teamsKey = '';
    // Pixels of the stage covered by the play dock at the bottom; the view shifts up by half of
    // it so the line of scrimmage stays in the open part of the field.
    this.inset = 0; this.insetWant = 0;
    this.buildWorld();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.last = performance.now();
  }

  // ---------- static world ----------
  buildWorld() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight('#dfe9ff', '#25402c', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(20, 60, 25);
    S.add(sun);
    // Surrounding ground
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 140), new THREE.MeshLambertMaterial({ color: '#1d4a2c' }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(50, -0.02, 0);
    S.add(apron);
    // Turf
    this.fieldCanvas = document.createElement('canvas');
    this.fieldCanvas.width = 120 * PX; this.fieldCanvas.height = Math.round(FIELD_W * PX);
    this.fieldTex = new THREE.CanvasTexture(this.fieldCanvas);
    this.fieldTex.colorSpace = THREE.SRGBColorSpace;
    this.fieldTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, FIELD_W), new THREE.MeshLambertMaterial({ map: this.fieldTex }));
    field.rotation.x = -Math.PI / 2; field.position.set(50, 0, 0);
    S.add(field);
    // Stands on all four sides
    const crowd = crowdTexture();
    const stand = (w, x, z, ry) => {
      const map = crowd.clone();
      map.wrapS = THREE.RepeatWrapping; map.repeat.set(w / 16, 1); map.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 18), new THREE.MeshLambertMaterial({ map, color: '#6f7889' }));
      m.position.set(x, 8, z);
      m.rotation.set(-0.45, ry, 0, 'YXZ');
      S.add(m);
    };
    stand(160, 50, -36, 0);
    stand(160, 50, 36, Math.PI);
    stand(80, -26, 0, Math.PI / 2);
    stand(80, 126, 0, -Math.PI / 2);
    // Goal posts on both end lines
    const postMat = new THREE.MeshLambertMaterial({ color: '#ffd23f' });
    for (const [x, s] of [[-10, -1], [110, 1]]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.4, 10), postMat);
      base.position.set(x + s * 0.7, 1.7, 0);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8), postMat);
      neck.rotation.z = Math.PI / 2; neck.position.set(x + s * 0.35, 3.4, 0);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.17, 10), postMat);
      bar.rotation.x = Math.PI / 2; bar.position.set(x, 3.4, 0);
      S.add(base, neck, bar);
      for (const z of [-3.08, 3.08]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 8), postMat);
        up.position.set(x, 3.4 + 4.5, z);
        S.add(up);
      }
    }
    // Light towers
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
    const poleMat = new THREE.MeshLambertMaterial({ color: '#39424e' });
    for (const [x, z] of [[-20, -44], [120, -44], [-20, 44], [120, 44], [50, -46], [50, 46]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 34, 8), poleMat);
      pole.position.set(x, 17, z); S.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 1), lampMat);
      lamp.position.set(x, 34, z); lamp.lookAt(50, 0, 0); S.add(lamp);
    }
    // Line of scrimmage and line to gain
    const lineGeo = new THREE.PlaneGeometry(0.28, FIELD_W - 0.4);
    this.losLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: '#3d8bff', transparent: true, opacity: 0.85 }));
    this.firstLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9 }));
    for (const l of [this.losLine, this.firstLine]) { l.rotation.x = -Math.PI / 2; l.position.y = 0.02; S.add(l); }
    // Ball
    // Football: a prolate leather ball with laces, its long axis along local x.
    this.ball = new THREE.Mesh(footballGeometry(), new THREE.MeshStandardMaterial({ map: footballTexture(), roughness: 0.55 }));
    this.ballSpin = 0;
    S.add(this.ball);
    this.ballShadow = shadowMesh(0.5);
    S.add(this.ballShadow);
    // Marker over the player you control
    this.cursor = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 4), new THREE.MeshBasicMaterial({ color: '#ffe14d' }));
    this.cursor.rotation.x = Math.PI;
    S.add(this.cursor);
    this.cursorRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.1, 32), new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.cursorRing.rotation.x = -Math.PI / 2;
    S.add(this.cursorRing);
    // Target marker for the ball in the air
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    this.target.rotation.x = -Math.PI / 2; this.target.position.y = 0.04;
    S.add(this.target);
    // Receiver key icons
    this.icons = {};
    ['WR1', 'WR2', 'WR3', 'TE', 'RB'].forEach((k, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(String(i + 1), ICON_COLORS[i]), depthTest: false }));
      sp.scale.set(1.3, 1.3, 1); sp.renderOrder = 10; sp.visible = false;
      this.icons[k] = sp; S.add(sp);
    });
    this.routeGroup = new THREE.Group();
    S.add(this.routeGroup);
  }

  paintField(g) {
    const key = g.teams.map((t) => t.abbr + t.color).join('|');
    if (key === this.teamsKey) return;
    this.teamsKey = key;
    const c = this.fieldCanvas, x = c.getContext('2d');
    const W = c.width, H = c.height, X = (yd) => (yd + 10) * PX;
    for (let i = 0; i < 24; i++) { x.fillStyle = i % 2 ? '#2f7d43' : '#2a713c'; x.fillRect(i * 5 * PX, 0, 5 * PX, H); }
    // End zones: each team's color in the end zone it attacks.
    const ez = (left, team) => {
      x.fillStyle = team.color; x.globalAlpha = 0.85; x.fillRect(left ? 0 : X(100), 0, 10 * PX, H); x.globalAlpha = 1;
      x.save(); x.translate(left ? X(-5) : X(105), H / 2); x.rotate(left ? -Math.PI / 2 : Math.PI / 2);
      x.fillStyle = 'rgba(255,255,255,0.92)'; x.font = `700 ${PX * 7}px Graduate, Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(team.abbr, 0, 0); x.restore();
    };
    ez(true, g.teams[1]); ez(false, g.teams[0]);
    x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.lineWidth = PX * 0.18;
    for (let yd = 0; yd <= 100; yd += 5) { x.beginPath(); x.moveTo(X(yd), PX * 0.3); x.lineTo(X(yd), H - PX * 0.3); x.stroke(); }
    x.lineWidth = PX * 0.12;
    for (let yd = 1; yd < 100; yd++) {
      if (yd % 5 === 0) continue;
      for (const y of [0.4, H / PX / 2 - 3.1, H / PX / 2 + 3.1, H / PX - 1.4]) { x.beginPath(); x.moveTo(X(yd), y * PX); x.lineTo(X(yd), (y + 1) * PX); x.stroke(); }
    }
    x.lineWidth = PX * 0.3; x.strokeRect(PX * 0.15, PX * 0.15, W - PX * 0.3, H - PX * 0.3);
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = `600 ${PX * 2.2}px "Barlow Condensed", Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let yd = 10; yd <= 90; yd += 10) {
      const n = String(yd <= 50 ? yd : 100 - yd);
      for (const [y, rot] of [[9, Math.PI], [H / PX - 9, 0]]) {
        x.save(); x.translate(X(yd), y * PX); x.rotate(rot); x.fillText(n.split('').join(' '), 0, 0); x.restore();
      }
    }
    // Midfield logo
    x.save(); x.translate(X(50), H / 2); x.globalAlpha = 0.85;
    x.beginPath(); x.arc(0, 0, PX * 3.2, 0, Math.PI * 2); x.fillStyle = '#eef2e6'; x.fill();
    x.beginPath(); x.arc(0, 0, PX * 3.2, Math.PI, Math.PI * 2); x.fillStyle = '#e5402b'; x.fill();
    x.fillStyle = '#0d2b20'; x.fillRect(-PX * 3.2, -PX * 0.3, PX * 6.4, PX * 0.6);
    x.beginPath(); x.arc(0, 0, PX * 1.1, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(0, 0, PX * 0.7, 0, Math.PI * 2); x.fillStyle = '#eef2e6'; x.fill();
    x.restore();
    this.fieldTex.needsUpdate = true;
  }

  // ---------- sprites ----------
  // A Pokémon's textures: its animated front and back pixel strips once its chunk has loaded,
  // and its menu still until then. Sizes are in sprite pixels.
  textures(id) {
    let t = this.texCache.get(id);
    const strip = bank.strips[id];
    if (t && (t.full || !strip)) return t;
    const idx = SPRITE_INDEX[id] ?? [0, 64, 64, 64, 64, 1, 1, 1];
    if (!t) {
      loadChunk(idx[0]);
      const still = makeTex(SPRITES[id]);
      const px = [idx[1], idx[2]];
      t = { full: false, front: still, back: still, frames: 1, fFrames: 1, bFrames: 1, secs: 1, fPx: px, bPx: px, stillBack: true };
      this.texCache.set(id, t);
    }
    if (strip) {
      // Swap the still for the animated strips once both have decoded, so nothing blinks.
      if (!t.pending) t.pending = { front: makeTex(strip[0]), back: makeTex(strip[1]) };
      if (texReady(t.pending.front) && texReady(t.pending.back)) {
        t.front.dispose();
        t = { full: true, front: t.pending.front, back: t.pending.back, fFrames: idx[5] ?? 1, bFrames: idx[6] ?? 1, secs: idx[7] || 1,
          fPx: [idx[1], idx[2]], bPx: [idx[3], idx[4]] };
        this.texCache.set(id, t);
      }
    }
    return t;
  }

  actorFor(p, team) {
    const key = `${p.ti}:${p.id}`;
    let a = this.actors.get(key);
    if (a && a.color === team.color) return a;
    if (a) this.removeActor(key);
    const mat = spriteMaterial();
    mat.uniforms.team.value.set(team.color);
    const mesh = new THREE.Mesh(SPRITE_GEO, mat);
    mesh.matrixAutoUpdate = false;
    const h = 2;
    // A thin, faint team ring for everyone; the full ring marks who matters this frame.
    const ring = new THREE.Mesh(RING_THIN, new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const shadow = shadowMesh(0.75);
    this.scene.add(mesh, ring, shadow);
    a = { key, id: p.id, mesh, ring, shadow, h, h0: h, tex: null, useBack: false, flip: false, phase: Math.random() * 12,
      gait: Math.random() * 2, color: team.color, seen: 0, fall: 0, fallDir: 1, act: null, lastStep: 0, ghostT: 0, flash: 0, stars: null };
    this.actors.set(key, a);
    return a;
  }

  removeActor(key) {
    const a = this.actors.get(key);
    if (!a) return;
    for (const o of [a.mesh, a.ring, a.shadow]) { this.scene.remove(o); if (![SPRITE_GEO, RING_FULL, RING_THIN].includes(o.geometry)) o.geometry?.dispose?.(); o.material?.dispose?.(); }
    if (a.stars) { this.scene.remove(a.stars); a.stars.children.forEach((c) => c.material.dispose()); }
    this.actors.delete(key);
  }

  // ---------- per frame ----------
  setPlay(lp) {
    if (lp !== this.lp) this.evSeen = 0;
    this.lp = lp;
    if (!lp) return;
    const g = lp.g;
    this.paintField(g);
    // Fetch the animated sprites of everyone who could take the field in this game.
    for (const t of g.teams) for (const id of t.roster ?? []) { const e = SPRITE_INDEX[id]; if (e) loadChunk(e[0]); }
    this.dir = lp.o === 0 ? 1 : -1;
    this.los = absSpot(lp.o, lp.spot);
    const toGo = lp.spot + g.toGo < 100 ? absSpot(lp.o, lp.spot + g.toGo) : null;
    this.losLine.position.x = this.los;
    this.firstLine.visible = toGo != null;
    if (toGo != null) this.firstLine.position.x = toGo;
    this.camSign = lp.user === lp.d ? -this.dir : this.dir;
    const stamp = performance.now();
    for (const p of lp.players) this.actorFor(p, g.teams[p.ti]).seen = stamp;
    for (const [k, a] of this.actors) if (a.seen !== stamp) this.removeActor(k);
    for (const a of this.actors.values()) { a.fall = 0; a.act = null; a.flash = 0; }
    this.celebrate = 0;
    this.prevPhase = lp.phase;
    this.snapT = -10;
    this.drawRoutes();
  }

  drawRoutes() {
    const G = this.routeGroup;
    while (G.children.length) { const c = G.children.pop(); c.geometry.dispose(); c.material.dispose(); }
    const lp = this.lp;
    if (!lp || lp.user !== lp.o || lp.kind !== 'pass') return;
    ['WR1', 'WR2', 'WR3', 'TE', 'RB'].forEach((k, i) => {
      const p = lp.off[k];
      if (!p || !p.route) return;
      const pts = [this.world(p.x, p.y, 0.06)];
      for (const w of p.route) if (w.x != null) pts.push(this.world(w.x, w.y, 0.06));
      if (pts.length < 2) return;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ICON_COLORS[i], transparent: true, opacity: 0.9 }));
      G.add(line);
    });
  }

  world(x, y, h = 0) { return new THREE.Vector3(this.los + this.dir * x, h, y * this.dir); }

  actorOf(p) { return p ? this.actors.get(`${p.ti}:${p.id}`) : null; }

  // New play events start one-shot animations: throws, catches, jukes, spins, trucks, tackles.
  readEvents(lp, t) {
    while (this.evSeen < lp.events.length) {
      const e = lp.events[this.evSeen++];
      const a = this.actorOf(e.who), b = this.actorOf(e.other);
      const toward = (from, to) => (from && to ? Math.sign(this.lateral(from, to.pos)) || 1 : 1);
      switch (e.kind) {
        case 'throw': if (a) a.act = { kind: 'throw', t0: t, dur: 0.42, side: lp.thrown?.target ? Math.sign(this.lateralTo(a, lp.thrown.tx, lp.thrown.ty)) || 1 : 1 }; break;
        case 'catch': case 'int': if (a) { a.act = { kind: 'catch', t0: t, dur: 0.4 }; a.flash = 0.35; } break;
        case 'handoff': if (a) a.act = { kind: 'catch', t0: t, dur: 0.3 }; break;
        case 'snap': { const c = this.actorOf(lp.off.C); if (c) c.act = { kind: 'snap', t0: t, dur: 0.25 }; break; }
        case 'juke': if (a) a.act = { kind: 'juke', t0: t, dur: 0.4, side: Math.sign(a.vs || 1) }; break;
        case 'spin': if (a) a.act = { kind: 'spin', t0: t, dur: 0.45, side: e.who.spinDir ?? 1 }; break;
        case 'truck': if (a) a.act = { kind: 'truck', t0: t, dur: 0.45, side: Math.sign(a.vs || 1) }; break;
        case 'broken': {
          if (b) {
            const hard = e.how === 'truck';
            b.act = { kind: hard ? 'knocked' : 'whiff', t0: t, dur: hard ? 0.9 : 0.75, side: hard ? -toward(b, a) : toward(b, a) };
            b.flash = hard ? 0.6 : 0.25;
          }
          if (a) { a.flash = 0.25; if (e.how === 'truck') this.shake = Math.max(this.shake, 0.35); }
          if (a && b) this.burst(a.pos.clone().lerp(b.pos, 0.5), e.how === 'truck' ? 1.4 : 0.9, e.how === 'truck' ? '#ffd23f' : '#ffffff');
          break;
        }
        case 'ghost': if (a) { a.ghostT = t + 0.8; a.flash = 0.2; } break;
        case 'tackle': case 'sack': {
          if (a) { a.act = { kind: 'tackle', t0: t, dur: 9, side: toward(a, b) }; a.flash = 0.2; }
          if (b) { b.fallDir = a ? toward(a, b) : 1; b.flash = 0.4; }
          if (a && b) this.burst(b.pos.clone().lerp(a.pos, 0.4), e.kind === 'sack' ? 1.5 : 1.1, e.kind === 'sack' ? '#ff7a59' : '#ffffff');
          this.shake = Math.max(this.shake, e.kind === 'sack' ? 0.3 : 0.18);
          break;
        }
        case 'incomplete': if (a) a.act = { kind: 'miss', t0: t, dur: 0.8, side: Math.sign(a.vs || 1) }; break;
        default: break;
      }
    }
  }

  // How far a world point sits to the right of an actor, as the camera sees it.
  lateral(a, pt) { return (pt.x - a.pos.x) * a.rx + (pt.z - a.pos.z) * a.rz; }
  lateralTo(a, x, y) { return this.lateral(a, this.world(x, y)); }

  frame(now = performance.now()) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    const lp = this.lp;
    this.updateFx(t, dt);
    if (!lp) { this.renderer.render(this.scene, this.camera); return; }
    this.routeGroup.visible = lp.phase === 'pre' && !lp.preview;
    const fwdSign = this.camSign;
    const cam = this.camera.position;
    // Billboard frame for everyone: face the camera, upright.
    for (const p of lp.players) {
      const a = this.actorOf(p);
      if (!a) continue;
      a.p = p;
      a.pos = this.world(p.x, p.y);
      const yaw = Math.atan2(cam.x - a.pos.x, cam.z - a.pos.z);
      a.yaw = yaw; a.rx = Math.cos(yaw); a.rz = -Math.sin(yaw);
      const wvx = p.vx * this.dir, wvz = p.vy * this.dir;
      a.speed = Math.hypot(p.vx, p.vy);
      a.vs = (wvx * a.rx + wvz * a.rz) / Math.max(4, p.top);
    }
    this.readEvents(lp, t);
    if (this.prevPhase === 'pre' && lp.phase !== 'pre') this.snapT = t;
    this.prevPhase = lp.phase;
    const tdCarrier = lp.phase === 'dead' && lp.end?.how === 'td' ? lp.carrier : null;
    if (tdCarrier && !this.celebrate) { this.celebrate = t; this.confetti(this.actorOf(tdCarrier)?.pos, lp.g.teams[tdCarrier.ti].color); }
    let heldBy = null;
    for (const p of lp.players) {
      const a = this.actorOf(p);
      if (!a) continue;
      const tx = this.textures(p.id);
      if (a.tex !== tx) { a.tex = tx; }
      // Which way is it facing relative to the camera?
      const fX = p.fx * this.dir, fZ = p.fy * this.dir;
      const away = fX * fwdSign, side = fZ * fwdSign;
      if (away > 0.35) a.useBack = true; else if (away < -0.35) a.useBack = false;
      if (a.useBack) { if (side < -0.4) a.flip = true; else if (side > 0.4) a.flip = false; }
      else if (side > 0.4) a.flip = true; else if (side < -0.4) a.flip = false;
      // Sprite size from its pixels at one density for everyone, within sane bounds.
      a.h0 = clampN(tx.fPx[1] * SPRITE_PX, 1.0, 3.4);
      a.oneFrame = Math.max(tx.fFrames ?? 1, tx.bFrames ?? 1) < 2;
      // Idle at the sprite's own animation speed; on the move, advance the strip by distance
      // covered so a faster Pokémon cycles faster. One cycle is a stride that grows with size.
      a.moving = a.speed > (a.moving ? 0.8 : 1.4);
      a.phase += a.moving ? dt * a.speed / (1.6 + a.h0 * 1.1) : dt / (tx.secs || 1);

      const pose = this.pose(lp, p, a, t, dt, tdCarrier);
      let back = a.useBack;
      let sx = pose.sx;
      if (pose.spin != null) { const c = Math.cos(pose.spin); sx *= Math.max(0.08, Math.abs(c)); if (c < 0) back = !back; }
      const tex = back ? tx.back : tx.front;
      const flip = back && tx.stillBack ? !a.flip : a.flip;
      const nFrames = (back ? tx.bFrames : tx.fFrames) ?? 1;
      const px = back ? tx.bPx : tx.fPx;
      const u = a.mesh.material.uniforms;
      if (u.map.value !== tex) u.map.value = tex;
      u.frames.value = nFrames;
      u.frame.value = Math.floor(a.phase * nFrames) % nFrames;
      u.flip.value = flip ? 1 : 0;
      u.texel.value.set(1 / px[0], 1 / px[1]);
      a.flash = Math.max(0, a.flash - dt * 2.2);
      u.flash.value = Math.min(0.85, a.flash * 1.6);
      const aspect = px[0] / px[1];
      // Long, flat Pokémon (Wailord, Steelix...) are capped in width so they fit on a line.
      const hh = clampN(px[1] * SPRITE_PX, 1.0, 3.4);
      const fit = Math.min(1, 2.6 / (hh * aspect));
      a.h = hh * fit;
      a.w = a.h * aspect;
      // Nothing is drawn until the image has decoded; an empty texture would show as a box.
      a.mesh.visible = texReady(tex);
      spriteMatrix(a.mesh.matrix, a.pos.x, pose.lift + pose.pitch * 0.03, a.pos.z, a.yaw, pose.pitch, pose.shear, pose.roll, a.w * sx, a.h * pose.sy);
      a.mesh.matrixWorldNeedsUpdate = true;
      // Draw far to near so the near line always lands on top.
      a.mesh.renderOrder = -Math.hypot(cam.x - a.pos.x, cam.y, cam.z - a.pos.z);
      a.pose = pose;
      const key = p === lp.control || (lp.ball.state === 'held' && lp.ball.holder === p && lp.phase !== 'pre')
        || (p.slot === 'QB' && p.side === 'off' && !lp.thrown && lp.qbState !== 'run' && lp.kind === 'pass');
      const rg = key ? RING_FULL : RING_THIN;
      if (a.ring.geometry !== rg) { a.ring.geometry = rg; a.ring.material.opacity = key ? 0.9 : 0.35; }
      a.ring.position.set(a.pos.x, 0.03, a.pos.z);
      const sh = 1 / (1 + pose.lift * 0.6);
      a.shadow.position.set(a.pos.x, 0.02, a.pos.z);
      a.shadow.scale.set((0.8 + aspect * 0.4) * sh * (1 + Math.abs(Math.sin(pose.roll)) * 0.8), (0.8 + aspect * 0.4) * sh, 1);
      a.shadow.material.opacity = sh;
      // Afterimages on spins, jukes and Ghost-type phasing.
      if ((pose.ghost || t < a.ghostT) && t - (a.lastGhost ?? 0) > 0.05) { a.lastGhost = t; this.ghost(a, tex, flip, u.frame.value, nFrames, t < a.ghostT ? '#b388ff' : null); }
      // Dust kicked up at full speed.
      if (pose.step && a.speed > 0.8 * p.top) this.dust(a.pos, a.speed / 10);
      // Dazed stars over a stunned player.
      this.dazed(a, p.stun > 0.3 && !(lp.phase === 'dead' && (a.fall > 0 || a.act?.kind === 'tackle')), t);
      if (lp.ball.state === 'held' && lp.ball.holder === p) heldBy = a;
    }
    this.placeBall(lp, heldBy, t, dt);
    // Control marker
    const c = lp.control;
    const showCursor = c && lp.phase !== 'dead';
    this.cursor.visible = this.cursorRing.visible = !!showCursor;
    if (showCursor) {
      const a = this.actorOf(c);
      const cw = this.world(c.x, c.y);
      this.cursor.position.set(cw.x, (a?.h ?? 2) * (a?.pose?.sy ?? 1) + (a?.pose?.lift ?? 0) + 0.9 + Math.sin(now / 160) * 0.12, cw.z);
      this.cursor.rotation.y += dt * 3;
      this.cursorRing.position.set(cw.x, 0.05, cw.z);
    }
    // Throw keys over the receivers
    const icons = !lp.preview && lp.user === lp.o && lp.kind === 'pass' && !lp.thrown && lp.qbState !== 'run' && lp.phase !== 'dead';
    for (const [k, sp] of Object.entries(this.icons)) {
      const p = lp.off[k];
      sp.visible = !!(icons && p && p.role === 'route');
      if (sp.visible) {
        const a = this.actorOf(p);
        const pw = this.world(p.x, p.y);
        sp.position.set(pw.x, (a?.h ?? 2) + 0.9, pw.z);
        // Keep the keys small on receivers right under the camera.
        const k = clampN(this.camera.position.distanceTo(sp.position) * 0.075, 0.6, 1.3);
        sp.scale.set(k, k, 1);
      }
    }
    this.updateCamera(dt);
    if (this.shake > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-dt * 9);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // The body language for one player this frame: lean (shear), tilt (roll), falling back onto
  // the turf (pitch), squash and stretch, hop height, and a spin angle. Built from what the
  // player is doing in the play.
  pose(lp, p, a, t, dt, tdCarrier) {
    const P = { shear: 0, roll: 0, pitch: 0, sx: 1, sy: 1, lift: 0, spin: null, ghost: false, step: false };
    const sp = a.speed, run = a.moving && !reduceMotion ? Math.min(1, sp / 6) : 0;
    const live = lp.phase === 'live';
    // Running gait: a bob and a waddle in time with the stride, leaning into the run.
    const prev = a.gait;
    a.gait += dt * (0.9 + sp * 0.32);
    const s = Math.sin(a.gait * Math.PI);
    P.step = Math.floor(prev) !== Math.floor(a.gait);
    P.lift = Math.abs(s) * 0.16 * run * Math.min(1.4, a.h / 2);
    P.roll = s * 0.06 * run;
    P.sy = 1 - (1 - Math.abs(s)) * 0.06 * run + Math.sin(t * 2.3 + a.gait) * 0.012 * (1 - run);
    P.sx = 1 + (1 - Math.abs(s)) * 0.04 * run;
    const accel = a.lastSp != null ? (sp - a.lastSp) / Math.max(dt, 1e-3) : 0;
    a.lastSp = sp;
    P.shear = clampN(a.vs * 0.28 + Math.sign(a.vs) * Math.max(0, accel) * 0.01, -0.45, 0.45);
    // Ball carriers run low and protect the ball.
    if (p.carrier && live) { P.shear *= 1.25; P.sy *= 0.97; }

    // Before the snap: linemen down in their stance, everyone else set.
    if (lp.phase === 'pre') {
      const ol = ['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DE', 'DT1', 'DT2'].includes(p.slot);
      P.sy = ol ? 0.84 : 0.95; P.sx = ol ? 1.08 : 1;
      P.shear = ol ? -this.lateralTo(a, p.side === 'off' ? 5 : -5, p.y) * 0.03 : 0;
      P.sy += Math.sin(t * 2.2 + a.gait) * 0.012;
    }
    // The snap: everyone dips into a short crouch, then springs out of it.
    const sinceSnap = t - this.snapT;
    if (!reduceMotion && sinceSnap >= 0 && sinceSnap < 0.32) {
      const k = sinceSnap < 0.1 ? sinceSnap / 0.1 : 1 - (sinceSnap - 0.1) / 0.22;
      P.sy *= 1 - 0.16 * k; P.sx *= 1 + 0.07 * k; P.lift = 0;
    }
    // Quarterback in the pocket: ball up by the ear, ready to fire.
    if (live && p.slot === 'QB' && p.side === 'off' && lp.kind === 'pass' && lp.ball.holder === p && lp.qbState !== 'run') {
      P.sy *= 1.03;
      P.shear -= 0.08;
    }
    // Blocking: leaning into the man across, with shoves.
    if (p.eng) {
      const o = this.actorOf(p.eng);
      const side = o ? Math.sign(this.lateral(a, o.pos)) || 1 : 1;
      P.shear = side * (0.22 + Math.sin(t * 9 + a.gait * 3) * 0.07);
      P.sy = 0.9 + Math.sin(t * 9 + a.gait * 3) * 0.03; P.sx = 1.06;
      P.lift = 0; P.roll = 0;
    }
    // Reaching for a ball that is about to arrive.
    const T = lp.thrown;
    if (live && T && T.target === p && lp.ball.state === 'air') {
      const left = T.t0 + T.T - lp.t;
      if (left < 0.45) {
        const k = 1 - left / 0.45;
        P.sy = Math.max(P.sy, 1 + 0.14 * k); P.sx *= 1 - 0.08 * k;
        P.lift = Math.max(P.lift, 0.4 * Math.sin(k * Math.PI * 0.9) * (lp.ball.z > 2.2 ? 1.4 : 0.8));
      }
    }
    // A defender diving at the carrier or at the ball.
    if (p.dive != null && p.dive > -0.6 && a.act?.kind !== 'tackle') {
      const k = clampN((0.3 - p.dive) / 0.6, 0, 1);
      const side = Math.sign(a.vs) || 1;
      P.roll = -side * 1.25 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2);
      P.lift = Math.sin(k * Math.PI) * 0.45; P.shear = 0;
    }
    // Lowered shoulder while trucking.
    if (p.truck > 0) { const side = Math.sign(a.vs) || 1; P.shear = side * 0.45; P.roll = -side * 0.22; P.sy = 0.86; P.sx = 1.12; }
    // Stunned: wobbling on its feet.
    if (p.stun > 0 && !p.eng) { P.roll += Math.sin(t * 16) * 0.12 * Math.min(1, p.stun * 2); }

    // One-shot actions
    const A = a.act;
    if (A) {
      const u = (t - A.t0) / A.dur;
      if (u >= 1 && A.kind !== 'tackle') a.act = null;
      else {
        const bell = Math.sin(clampN(u, 0, 1) * Math.PI);
        switch (A.kind) {
          case 'throw': {
            // Wind up away from the target, then whip through toward it.
            const wind = u < 0.35 ? u / 0.35 : 0, fire = u >= 0.35 ? (u - 0.35) / 0.65 : 0;
            const f = fire ? Math.sin(Math.min(1, fire * 1.6) * Math.PI / 2) * (1 - fire * 0.6) : 0;
            P.shear = A.side * (-0.32 * Math.sin(wind * Math.PI / 2) * (fire ? 0 : 1) + 0.42 * f);
            P.roll = -A.side * (-0.12 * wind + 0.18 * f);
            P.sy = 1 + 0.06 * f - 0.04 * wind; P.sx = 1 - 0.04 * f;
            P.lift = 0;
            break;
          }
          case 'catch': P.sy = u < 0.3 ? 1 - 0.14 * (u / 0.3) : 0.86 + 0.14 * ((u - 0.3) / 0.7); P.sx = 2 - P.sy; P.lift *= 0.3; break;
          case 'snap': P.sy *= 0.9 + 0.1 * u; break;
          case 'juke': P.shear = A.side * 0.5 * bell; P.roll = -A.side * 0.18 * bell; P.sy *= 1 - 0.12 * bell; P.sx *= 1 + 0.1 * bell; P.ghost = true; break;
          case 'spin': P.spin = u * Math.PI * 2 * A.side; P.shear *= 0.3; P.roll = 0; P.sy *= 1 - 0.06 * bell; P.ghost = true; break;
          case 'truck': if (!(p.truck > 0)) { P.shear = A.side * 0.4 * bell; P.sy = 1 - 0.12 * bell; } break;
          case 'whiff': {
            // Lunges, misses and hits the turf, then pops back up.
            const fallK = u < 0.35 ? u / 0.35 : u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
            P.pitch = 1.35 * Math.sin(fallK * Math.PI / 2); P.roll = -A.side * 0.3 * fallK; P.shear = 0; P.lift = u < 0.35 ? Math.sin(u / 0.35 * Math.PI) * 0.35 : 0;
            break;
          }
          case 'knocked': {
            // Bowled over backwards by a truck stick.
            const fallK = u < 0.3 ? u / 0.3 : u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
            P.pitch = 1.45 * Math.sin(fallK * Math.PI / 2); P.roll = -A.side * 0.3 * fallK; P.lift = u < 0.3 ? Math.sin(u / 0.3 * Math.PI) * 0.6 : 0; P.shear = 0;
            break;
          }
          case 'tackle': {
            // Wraps up and drives the carrier to the ground.
            const k = reduceMotion ? 1 : Math.min(1, u * A.dur / 0.35);
            P.pitch = 1.3 * Math.sin(k * Math.PI / 2); P.roll = -A.side * 0.25 * k; P.lift = reduceMotion ? 0 : Math.sin(k * Math.PI) * 0.3; P.shear = 0; P.sy = 1;
            if (lp.phase !== 'dead' && u * A.dur > 0.6) a.act = null;
            break;
          }
          case 'miss': P.roll = -A.side * 0.5 * bell; P.sy = 1 - 0.1 * bell; P.lift = 0; break;
          default: break;
        }
      }
    }
    // Tackled ball carriers (and sacked quarterbacks) go down.
    const down = lp.phase === 'dead' && lp.end && ((lp.end.how === 'tackle' || lp.end.how === 'sack') && lp.carrier === p || (lp.end?.how === 'sack' && p.slot === 'QB' && p.side === 'off'));
    a.fall = down ? (reduceMotion ? 1 : Math.min(1, a.fall + dt * 4)) : Math.max(0, a.fall - dt * 3);
    // Tackled: the plane pitches back until the Pokémon lies on the turf, tipped a little toward
    // the side it was hit from.
    if (a.oneFrame && run > 0) { P.lift *= 1.7; P.roll *= 2.2; }
    if (a.fall > 0) { const k = Math.sin(a.fall * Math.PI / 2); P.pitch = 1.48 * k; P.roll = -a.fallDir * 0.3 * k; P.shear = 0; P.lift = 0; P.sy = 1; P.sx = 1; P.spin = null; }
    // Touchdown: the scorer leaps and spins, teammates nearby jump with him.
    if (tdCarrier && this.celebrate && !reduceMotion) {
      const ct = t - this.celebrate;
      if (p === tdCarrier) { P.lift = Math.abs(Math.sin(ct * 6.5)) * 0.9; P.spin = ct % 1.6 < 0.5 ? (ct % 1.6) / 0.5 * Math.PI * 2 : null; P.sy = 1.05; P.shear = 0; P.roll = 0; }
      else if (p.ti === tdCarrier.ti && Math.hypot(p.x - tdCarrier.x, p.y - tdCarrier.y) < 12) { P.lift = Math.abs(Math.sin(ct * 6 + a.gait)) * 0.45; P.shear = 0; P.roll = 0; }
    }
    return P;
  }

  // The ball: parked beside the carrier's chest, up by the quarterback's ear, on the turf
  // before the snap, or spiraling around its long axis in flight.
  placeBall(lp, holder, t, dt) {
    const b = lp.ball;
    const ball = this.ball;
    const orient = (yaw, pitch, spin) => ball.rotation.set(spin, yaw, pitch, 'YZX');
    if (holder && lp.phase === 'pre') {
      const w = this.world(holder.p.x + (holder.p.side === 'off' ? 0.5 : -0.5), holder.p.y, 0.2);
      ball.position.copy(w);
      orient(0, 0, Math.PI / 2);
    } else if (holder) {
      const a = holder, P = a.pose;
      const qbSet = lp.kind === 'pass' && a.p.slot === 'QB' && a.p.side === 'off' && !lp.thrown && lp.qbState !== 'run';
      // Out at the edge of the body and a step toward the camera, so the sprite never hides it.
      const side = (qbSet ? 0.3 : 0.4) * (a.vs >= 0 ? 1 : -1) * a.w;
      const up = (qbSet ? 0.8 : 0.52) * a.h * P.sy * Math.cos(P.pitch) + P.lift + 0.12;
      const cx = this.camera.position.x - a.pos.x, cz = this.camera.position.z - a.pos.z, cl = Math.hypot(cx, cz) || 1;
      const tc = 0.5;
      ball.position.set(a.pos.x + a.rx * (side + P.shear * up) + (cx / cl) * tc, up, a.pos.z + a.rz * (side + P.shear * up) + (cz / cl) * tc);
      const v = Math.hypot(a.p.vx, a.p.vy);
      orient(v > 0.5 ? Math.atan2(-a.p.vy * this.dir, a.p.vx * this.dir) : a.yaw + Math.PI / 2, qbSet ? 0.7 : 0.35, Math.PI / 2);
    } else {
      const bw = this.world(b.x, b.y, b.z);
      const rise = dt > 0 && this.lastBall ? (bw.y - this.lastBall.y) / dt : 0;
      const run = dt > 0 && this.lastBall ? Math.hypot(bw.x - this.lastBall.x, bw.z - this.lastBall.z) / dt : 0;
      ball.position.copy(bw);
      if (b.state === 'air' && lp.thrown) {
        this.ballSpin += dt * 24;
        const yaw = Math.atan2(-(lp.thrown.ty - lp.thrown.sy) * this.dir, (lp.thrown.tx - lp.thrown.sx) * this.dir);
        orient(yaw, run > 0.5 ? Math.atan2(rise, run) * 0.8 : 0, this.ballSpin);
      } else if (bw.y < 0.3) ball.position.y = 0.2;
    }
    this.lastBall = (this.lastBall ?? new THREE.Vector3()).copy(ball.position);
    // Spiking it after a touchdown.
    if (this.celebrate && lp.end?.how === 'td') {
      const ct = t - this.celebrate;
      const a = this.actorOf(lp.carrier);
      if (a && ct < 1.4) {
        const k = ct / 1.4;
        ball.position.set(a.pos.x + a.rx * 0.6, Math.max(0.2, (1 - k) * a.h * 0.6 + Math.sin(k * Math.PI) * 3 * (1 - k)), a.pos.z + a.rz * 0.6);
        this.ballSpin += dt * 14;
        orient(a.yaw, 1.2 * (1 - k), this.ballSpin);
      }
    }
    this.ballShadow.position.set(ball.position.x, 0.03, ball.position.z);
    this.ballShadow.visible = ball.position.y > 0.5;
    this.target.visible = b.state === 'air' && !!lp.thrown?.target;
    if (this.target.visible) { const tw = this.world(lp.thrown.tx, lp.thrown.ty, 0.04); this.target.position.set(tw.x, 0.04, tw.z); }
  }

  // ---------- effects ----------
  updateFx(t, dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      const u = (t - f.t0) / f.dur;
      if (u >= 1) { this.scene.remove(f.obj); f.dispose?.(); this.fx.splice(i, 1); continue; }
      f.update(u, dt);
    }
  }

  addFx(obj, dur, update, dispose) {
    this.scene.add(obj);
    this.fx.push({ obj, t0: performance.now() / 1000, dur, update, dispose });
    if (this.fx.length > 160) { const f = this.fx.shift(); this.scene.remove(f.obj); f.dispose?.(); }
  }

  dust(pos, k) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: '#c9b48a', transparent: true, depthWrite: false, opacity: 0.55 }));
    const x = pos.x + (Math.random() - 0.5) * 0.5, z = pos.z + (Math.random() - 0.5) * 0.5;
    m.position.set(x, 0.25, z);
    this.addFx(m, 0.55, (u) => { const s = (0.5 + u * 1.3) * k; m.scale.set(s, s, 1); m.position.y = 0.25 + u * 0.4; m.material.opacity = 0.5 * (1 - u); }, () => m.material.dispose());
  }

  burst(pos, size, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.06, pos.z);
    this.addFx(ring, 0.45, (u) => { const s = 0.6 + u * 2.6 * size; ring.scale.set(s, s, 1); ring.material.opacity = 0.9 * (1 - u); }, () => { ring.geometry.dispose(); ring.material.dispose(); });
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color, transparent: true, depthWrite: false, depthTest: false }));
    star.position.set(pos.x, 1.4, pos.z); star.renderOrder = 5;
    this.addFx(star, 0.3, (u) => { const s = size * (0.8 + u * 1.6); star.scale.set(s, s, 1); star.material.opacity = 1 - u; star.material.rotation = u * 1.2; }, () => star.material.dispose());
    for (let i = 0; i < 6; i++) this.dust(pos, 0.9 + Math.random() * 0.4);
  }

  ghost(a, tex, flip, frame, frames, tint) {
    const mat = spriteMaterial(true);
    const u = mat.uniforms;
    u.map.value = tex; u.frames.value = frames; u.frame.value = frame; u.flip.value = flip ? 1 : 0;
    u.outline.value = 0; u.team.value.set(tint ?? a.color); u.flash.value = 0.35;
    const m = new THREE.Mesh(SPRITE_GEO, mat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(a.mesh.matrix); m.matrixWorld.copy(a.mesh.matrix);
    m.renderOrder = -1;
    this.addFx(m, 0.28, (k) => { u.alpha.value = 0.45 * (1 - k); }, () => mat.dispose());
  }

  dazed(a, on, t) {
    if (on && !a.stars) {
      a.stars = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: '#ffe14d', transparent: true, depthWrite: false }));
        s.scale.set(0.45, 0.45, 1);
        a.stars.add(s);
      }
      this.scene.add(a.stars);
    }
    if (!a.stars) return;
    a.stars.visible = on;
    if (!on) return;
    a.stars.position.set(a.pos.x, a.h * (a.pose?.sy ?? 1) + 0.35, a.pos.z);
    a.stars.children.forEach((s, i) => { const ang = t * 5 + (i * Math.PI * 2) / 3; s.position.set(Math.cos(ang) * 0.6, Math.sin(ang * 2) * 0.08, Math.sin(ang) * 0.6); });
  }

  confetti(pos, color) {
    if (!pos) return;
    const cols = [color, '#ffd23f', '#ffffff', '#4fc3f7', '#ff7a59'];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(CONFETTI_GEO, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, transparent: true }));
      const vx = (Math.random() - 0.5) * 9, vz = (Math.random() - 0.5) * 9, vy = 7 + Math.random() * 7;
      const spin = (Math.random() - 0.5) * 20;
      m.position.set(pos.x, 1, pos.z);
      this.addFx(m, 2.4, (u) => {
        const tt = u * 2.4;
        m.position.set(pos.x + vx * tt * 0.7, Math.max(0.05, 1 + vy * tt - 5 * tt * tt), pos.z + vz * tt * 0.7);
        m.rotation.set(tt * spin, tt * spin * 0.7, 0);
        m.material.opacity = u > 0.75 ? (1 - u) * 4 : 1;
      }, () => m.material.dispose());
    }
  }

  updateCamera(dt) {
    const lp = this.lp;
    const s = this.camSign;
    // On defense the camera sits behind your secondary, so it pulls back a few yards.
    const shift = s !== this.dir ? -s * 7 : 0;
    let fx = this.los + shift, fz = 0;
    if (lp.phase !== 'pre' && (lp.carrierSet || lp.thrown || !shift)) {
      const b = lp.ball;
      const focus = b.state === 'air' && lp.thrown ? { x: lp.thrown.sx + (lp.thrown.tx - lp.thrown.sx) * 0.7, y: lp.thrown.sy + (lp.thrown.ty - lp.thrown.sy) * 0.7 } : b;
      const w = this.world(focus.x, focus.y);
      fx = w.x; fz = w.z * 0.9;
    }
    const pre = lp.phase === 'pre';
    const { back, high } = this.camRig(pre);
    const wantPos = new THREE.Vector3(fx - s * back, high, fz * 0.8);
    // Before the snap, aim at the line itself so both lines read; once it is live, lead the play.
    const wantLook = new THREE.Vector3(fx + s * (pre ? (shift ? 6 : 4) : 6), 0, fz);
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * (lp.phase === 'pre' ? 6 : 3.5));
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.applyInset(reduceMotion ? 1 : 1 - Math.exp(-dt * 6));
  }

  setInset(px) { this.insetWant = Math.max(0, px || 0); }

  applyInset(k) {
    this.inset += (this.insetWant - this.inset) * k;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    if (this.inset < 0.5) { if (this.camera.view?.enabled) this.camera.clearViewOffset(); return; }
    this.camera.setViewOffset(w, h, 0, Math.min(h * 0.3, this.inset / 2), w, h);
  }

  // Broadcast camera: close behind the play, a little higher before the snap so the routes
  // stay visible, and pulled back on narrow screens.
  camRig(pre) {
    const narrow = this.el.clientWidth < 640;
    return { back: narrow ? 17 : 13, high: (narrow ? 12 : 8.5) + (pre ? 2 : 0) };
  }

  snapCamera() {
    const { back, high } = this.camRig(true);
    const fx = this.los + (this.camSign !== this.dir ? -this.camSign * 7 : 0);
    this.camPos.set(fx - this.camSign * back, high, 0);
    this.camLook.set(fx + this.camSign * (this.camSign !== this.dir ? 6 : 4), 0, 0);
    this.inset = this.insetWant;
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Input from the screen arrows: (up, right) in screen terms to the offense frame.
  toPlayFrame(up, right) {
    const s = this.camSign * this.dir; // +1 when the camera looks the way the offense attacks
    return { mx: up * s, my: right * s };
  }
}


// ---------- animated sprite strips, loaded on demand ----------
// build_sprites3d.py writes the strips into sprites3d/<chunk>.js next to the page, each a call
// to __pbSprites({id: [front, back]}). A <script> tag works from file:// and from any host.
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

const texReady = (tex) => !!(tex?.image?.complete && tex.image.naturalWidth && tex.version > 0);

// Pixel art: nearest-neighbour up close, no mipmaps (they would bleed frames together).
function makeTex(uri) {
  const img = new Image();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  img.onload = () => { tex.needsUpdate = true; };
  if (uri) img.src = uri;
  return tex;
}

// One quad for every sprite: feet at the origin, with a margin around the strip cell so the
// team-colored outline has room.
const MARGIN = 0.06;
const SPRITE_GEO = new THREE.PlaneGeometry(1 + 2 * MARGIN, 1 + 2 * MARGIN).translate(0, 0.5, 0);
const CONFETTI_GEO = new THREE.PlaneGeometry(0.22, 0.12);
const RING_FULL = new THREE.RingGeometry(0.62, 0.86, 32);
const RING_THIN = new THREE.RingGeometry(0.74, 0.8, 32);

const SPRITE_VERT = `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SPRITE_FRAG = `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D map;
uniform float frames, frame, flip, margin, flash, alpha, outline;
uniform vec3 team;
uniform vec2 texel;
varying vec2 vUv;
float cellA(vec2 cu) {
  if (cu.x < 0.0 || cu.x > 1.0 || cu.y < 0.0 || cu.y > 1.0) return 0.0;
  return texture2D(map, vec2((frame + cu.x) / frames, cu.y)).a;
}
void main() {
  vec2 cu = vUv * (1.0 + 2.0 * margin) - margin;
  if (flip > 0.5) cu.x = 1.0 - cu.x;
  vec4 c = vec4(0.0);
  if (cu.x >= 0.0 && cu.x <= 1.0 && cu.y >= 0.0 && cu.y <= 1.0) c = texture2D(map, vec2((frame + cu.x) / frames, cu.y));
  if (c.a < 0.45) {
    if (outline < 0.5) discard;
    vec2 d = texel * 1.7;
    float o = max(max(cellA(cu + vec2(d.x, 0.0)), cellA(cu - vec2(d.x, 0.0))), max(cellA(cu + vec2(0.0, d.y)), cellA(cu - vec2(0.0, d.y))));
    o = max(o, max(max(cellA(cu + d * 0.7), cellA(cu - d * 0.7)), max(cellA(cu + vec2(d.x, -d.y) * 0.7), cellA(cu + vec2(-d.x, d.y) * 0.7))));
    if (o < 0.5) discard;
    gl_FragColor = vec4(mix(team, vec3(1.0), flash), alpha);
  } else {
    // A touch of contact shadow at the feet and a rim of light up top.
    vec3 col = c.rgb * mix(0.7, 1.0, smoothstep(0.0, 0.16, cu.y)) * mix(1.0, 1.08, smoothstep(0.75, 1.0, cu.y));
    col = mix(col, vec3(1.0), flash);
    if (outline < 0.5) col = mix(col, team, 0.35);
    gl_FragColor = vec4(col, alpha);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function spriteMaterial(ghost = false) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null }, frames: { value: 1 }, frame: { value: 0 }, flip: { value: 0 }, margin: { value: MARGIN },
      flash: { value: 0 }, alpha: { value: 1 }, outline: { value: 1 }, team: { value: new THREE.Color('#ffffff') }, texel: { value: new THREE.Vector2(0.01, 0.01) },
    }]),
    vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, fog: true, side: THREE.DoubleSide,
    transparent: ghost, depthWrite: !ghost,
  });
}

// translate * yaw (face the camera) * pitch (fall back about the feet) * shear (lean, feet
// planted) * roll (tilt about the feet) * scale
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
function spriteMatrix(out, x, y, z, yaw, pitch, shear, roll, sx, sy) {
  out.makeTranslation(x, y, z);
  out.multiply(_r.makeRotationY(yaw));
  if (pitch) out.multiply(_r.makeRotationX(-pitch));
  out.multiply(_m.set(1, shear, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  out.multiply(_r.makeRotationZ(roll));
  out.multiply(_m.makeScale(sx, sy, 1));
  return out;
}

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

let starTex = null;
function starTexture() {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.translate(32, 32); x.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 29, a = (i * Math.PI) / 5 - Math.PI / 2; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  x.closePath(); x.fillStyle = '#ffffff'; x.fill();
  starTex = new THREE.CanvasTexture(c);
  return starTex;
}

const ICON_COLORS = ['#ffd23f', '#4fc3f7', '#ff7a59', '#b388ff', '#7fdc93'];

function iconTexture(label, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fillStyle = color; x.fill();
  x.lineWidth = 4; x.strokeStyle = '#0d2b20'; x.stroke();
  x.fillStyle = '#0d2b20'; x.font = '700 38px "Barlow Condensed", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shadowTex = null;
function shadowMesh(r) {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 1.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Stands: big, soft seat blocks in a few muted shades, so the crowd reads as a crowd from the
// field instead of confetti noise.
function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#18212c'; x.fillRect(0, 0, 256, 256);
  const cols = ['#5a6577', '#6d7686', '#8a5550', '#4f6a8c', '#7c7368', '#a4a9b0'];
  for (let row = 0; row < 14; row++) {
    for (let i = 0; i < 20; i++) {
      x.fillStyle = cols[(row * 5 + i * 7 + ((i * row) % 3)) % cols.length];
      x.globalAlpha = 0.55 + ((i * 31 + row * 17) % 5) / 25;
      x.fillRect(i * 12.8 + (row % 2) * 6.4 + 1.5, row * 18.3 + 4, 9, 11);
    }
    x.globalAlpha = 1;
    x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, row * 18.3, 256, 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The football: a lathe-turned prolate spheroid, long axis along x.
function footballGeometry() {
  const L = 0.34, R = 0.2, pts = [];
  for (let i = 0; i <= 16; i++) {
    const u = -1 + (2 * i) / 16;
    pts.push(new THREE.Vector2(Math.max(0.012, R * Math.pow(1 - u * u, 0.75)), u * L));
  }
  return new THREE.LatheGeometry(pts, 20).rotateZ(-Math.PI / 2);
}

// Leather with white stripes near the tips and a lace strip along the top seam.
function footballTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  // u runs around the ball, v along its length.
  const gr = x.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#5a2a12'); gr.addColorStop(0.5, '#8a4520'); gr.addColorStop(1, '#5a2a12');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#f4efe6';
  for (const v of [9, 51]) { x.fillRect(0, v, 128, 4); }
  x.fillRect(30, 21, 4, 22);
  for (let k = 0; k < 7; k++) x.fillRect(26, 22 + k * 3, 12, 1.6);
  x.strokeStyle = 'rgba(30,12,4,0.6)'; x.lineWidth = 1;
  for (const u of [32, 96]) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, 64); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
