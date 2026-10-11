// The 3D stadium: a three.js scene that draws a live play. Pokémon are animated 3D-model
// sprites standing on the turf as billboards, showing their back when they run away from the
// camera and their front when they come toward it.
import * as THREE from 'three';
import { SPRITES3D, FRAMES } from './sprites3d.js';
import { PLAYERS } from './ratings.js';
import { absSpot } from './engine.js';

const PX = 16; // texture pixels per yard
const FIELD_W = 53.3;

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
    this.loader = new THREE.TextureLoader();
    this.texCache = new Map();
    this.actors = new Map();
    this.teamsKey = '';
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
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), new THREE.MeshStandardMaterial({ color: '#7a3b1b', roughness: 0.6 }));
    this.ball.scale.set(0.62, 0.38, 0.38);
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
  textures(id) {
    let t = this.texCache.get(id);
    if (t) return t;
    const S = SPRITES3D[id];
    const mk = (uri) => {
      const img = new Image();
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.clones = [];
      img.onload = () => { tex.ready = true; tex.needsUpdate = true; for (const c of tex.clones) c.needsUpdate = true; };
      img.src = uri;
      return tex;
    };
    t = { front: mk(S.f), back: mk(S.b) };
    this.texCache.set(id, t);
    return t;
  }

  cloneTex(tex) {
    const c = tex.clone();
    c.repeat.set(1 / FRAMES, 1);
    if (tex.ready) c.needsUpdate = true; else tex.clones.push(c);
    return c;
  }

  actorFor(p, team) {
    const key = `${p.ti}:${p.id}`;
    let a = this.actors.get(key);
    if (a && a.color === team.color) return a;
    if (a) this.removeActor(key);
    const tx = this.textures(p.id);
    const front = this.cloneTex(tx.front), back = this.cloneTex(tx.back);
    const mat = new THREE.SpriteMaterial({ map: front, transparent: true, alphaTest: 0.1 });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0.02);
    const S = SPRITES3D[p.id];
    const hM = PLAYERS[p.id].height / 10;
    const h = Math.max(1.3, Math.min(3.8, 1.05 + Math.sqrt(hM) * 0.9));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.86, 28), new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    const shadow = shadowMesh(0.75);
    this.scene.add(sprite, ring, disc, shadow);
    a = { key, sprite, ring, disc, shadow, front, back, h, fAspect: S.fw / S.fh, bAspect: S.bw / S.bh, useBack: false, flip: false, phase: Math.random() * FRAMES, color: team.color, seen: 0, fall: 0 };
    this.actors.set(key, a);
    return a;
  }

  removeActor(key) {
    const a = this.actors.get(key);
    if (!a) return;
    for (const o of [a.sprite, a.ring, a.disc, a.shadow]) { this.scene.remove(o); o.geometry?.dispose?.(); o.material?.dispose?.(); }
    a.front.dispose(); a.back.dispose();
    this.actors.delete(key);
  }

  // ---------- per frame ----------
  setPlay(lp) {
    this.lp = lp;
    if (!lp) return;
    const g = lp.g;
    this.paintField(g);
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
    for (const a of this.actors.values()) a.fall = 0;
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

  frame(now = performance.now()) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const lp = this.lp;
    if (!lp) { this.renderer.render(this.scene, this.camera); return; }
    this.routeGroup.visible = lp.phase === 'pre' && !lp.preview;
    const fwdSign = this.camSign;
    for (const p of lp.players) {
      const a = this.actors.get(`${p.ti}:${p.id}`);
      if (!a) continue;
      const w = this.world(p.x, p.y);
      const speed = Math.hypot(p.vx, p.vy);
      // Which way is it facing relative to the camera?
      const fX = p.fx * this.dir, fZ = p.fy * this.dir;
      const away = fX * fwdSign, side = fZ * fwdSign;
      if (away > 0.35) a.useBack = true; else if (away < -0.35) a.useBack = false;
      if (a.useBack) { if (side < -0.4) a.flip = true; else if (side > 0.4) a.flip = false; }
      else if (side > 0.4) a.flip = true; else if (side < -0.4) a.flip = false;
      const tex = a.useBack ? a.back : a.front;
      if (a.sprite.material.map !== tex) { a.sprite.material.map = tex; a.sprite.material.needsUpdate = true; }
      a.phase += dt * (7 + speed * 0.7);
      const f = Math.floor(a.phase) % FRAMES;
      tex.repeat.x = (a.flip ? -1 : 1) / FRAMES;
      tex.offset.x = (a.flip ? f + 1 : f) / FRAMES;
      const aspect = a.useBack ? a.bAspect : a.fAspect;
      const hop = speed > 1.5 ? Math.abs(Math.sin(a.phase * 1.3)) * 0.18 : 0;
      a.sprite.scale.set(a.h * aspect, a.h, 1);
      a.sprite.position.set(w.x, hop, w.z);
      // Tackled ball carriers topple over.
      const down = lp.phase === 'dead' && lp.end && (lp.end.how === 'tackle' || lp.end.how === 'sack') && lp.carrier === p || (lp.end?.how === 'sack' && p.slot === 'QB' && p.side === 'off');
      a.fall = down ? Math.min(1, a.fall + dt * 4) : Math.max(0, a.fall - dt * 3);
      const lean = speed > 2 ? -side * 0.1 : 0;
      a.sprite.material.rotation = lean + (a.flip ? -1 : 1) * a.fall * 1.35 * (a.useBack ? -1 : 1);
      a.ring.position.set(w.x, 0.03, w.z);
      a.disc.position.set(w.x, 0.025, w.z);
      a.shadow.position.set(w.x, 0.02, w.z);
      a.shadow.scale.setScalar(0.8 + aspect * 0.4);
    }
    // Ball
    const b = lp.ball;
    const bw = this.world(b.x, b.y, b.z);
    this.ball.position.copy(bw);
    if (b.state === 'air') { this.ball.rotation.z += dt * 18; this.ball.rotation.y = Math.atan2(-(lp.thrown.ty - lp.thrown.sy) * this.dir, (lp.thrown.tx - lp.thrown.sx) * this.dir); }
    this.ballShadow.position.set(bw.x, 0.03, bw.z);
    this.ballShadow.visible = b.z > 0.5;
    this.target.visible = b.state === 'air' && !!lp.thrown?.target;
    if (this.target.visible) { const t = this.world(lp.thrown.tx, lp.thrown.ty, 0.04); this.target.position.set(t.x, 0.04, t.z); }
    // Control marker
    const c = lp.control;
    const showCursor = c && lp.phase !== 'dead';
    this.cursor.visible = this.cursorRing.visible = !!showCursor;
    if (showCursor) {
      const a = this.actors.get(`${c.ti}:${c.id}`);
      const cw = this.world(c.x, c.y);
      this.cursor.position.set(cw.x, (a?.h ?? 2) + 0.9 + Math.sin(now / 160) * 0.12, cw.z);
      this.cursor.rotation.y += dt * 3;
      this.cursorRing.position.set(cw.x, 0.05, cw.z);
    }
    // Throw keys over the receivers
    const icons = !lp.preview && lp.user === lp.o && lp.kind === 'pass' && !lp.thrown && lp.qbState !== 'run' && lp.phase !== 'dead';
    for (const [k, sp] of Object.entries(this.icons)) {
      const p = lp.off[k];
      sp.visible = !!(icons && p && p.role === 'route');
      if (sp.visible) {
        const a = this.actors.get(`${p.ti}:${p.id}`);
        const pw = this.world(p.x, p.y);
        sp.position.set(pw.x, (a?.h ?? 2) + 0.9, pw.z);
      }
    }
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
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
      fx = w.x; fz = w.z * 0.75;
    }
    const narrow = this.el.clientWidth < 640;
    const back = narrow ? 22 : 18, high = narrow ? 15 : 11.5;
    const wantPos = new THREE.Vector3(fx - s * back, high, fz * 0.8);
    const wantLook = new THREE.Vector3(fx + s * 10, 0, fz);
    const k = 1 - Math.exp(-dt * (lp.phase === 'pre' ? 6 : 3.5));
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  snapCamera() {
    const narrow = this.el.clientWidth < 640;
    const fx = this.los + (this.camSign !== this.dir ? -this.camSign * 7 : 0);
    this.camPos.set(fx - this.camSign * (narrow ? 22 : 18), narrow ? 15 : 11.5, 0);
    this.camLook.set(fx + this.camSign * 10, 0, 0);
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

function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#141c26'; x.fillRect(0, 0, 256, 256);
  const cols = ['#e5402b', '#eef2e6', '#ffb547', '#3d6fd6', '#7d5bb5', '#2e7d6b', '#a7bba9'];
  for (let row = 0; row < 26; row++) {
    for (let i = 0; i < 40; i++) {
      x.fillStyle = cols[(row * 7 + i * 13 + ((i * row) % 5)) % cols.length];
      x.globalAlpha = 0.35 + ((i * 31 + row * 17) % 10) / 20;
      x.fillRect(i * 6.4 + (row % 2) * 3, row * 9.8 + 2, 3.4, 4.2);
    }
    x.globalAlpha = 1;
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, row * 9.8, 256, 1.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
