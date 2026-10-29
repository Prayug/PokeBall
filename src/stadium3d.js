// The stadium: a 3D football field in yards (x runs from the left end line at -10 to the
// right end line at 110, z across the field with the sidelines at ±26.65, y up), a sideline
// apron, a wall with team banners, a seating bowl with an instanced crowd, light towers,
// goalposts, pylons, team benches, a video board, a sky, lighting and weather, and around it
// the home team's venue (venue3d.js) at the time of day the game kicks off. Everything the
// game draws on top (players, ball, lines) shares this coordinate system.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildVenue } from './venue3d.js';
import { inkOn, kitOf } from './kits.js';
import { fitText, paintEndZone } from './kitdraw.js';
import { logoDataUrl } from './logos.js';

export const FIELD_W = 53.3;
export const HALF_W = FIELD_W / 2;
const PX = 20; // field texture pixels per yard
const WALL_Z = 37, WALL_X0 = -24, WALL_X1 = 124;
const ROWS = 18, ROW_D = 1.05, ROW_H = 0.62, DECK_Y = 2.2;
const AISLE = 16, CLUB_ROW = 9, CLUB_GAP = 1.4;

export class Stadium {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.teamsKey = '';
    this.excite = 0;
    this.weather = null;
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildField();
    this.buildBowl();
    this.buildPosts();
    this.buildTowers();
    this.buildNight();
    this.buildBoard();
    this.venueInfo = { stadium: 'classic', time: 'day', roof: false };
    this.venueKey = '';
    this.night = 0;
  }

  // ---------- sky and light ----------
  buildSky() {
    this.skyUni = { top: { value: new THREE.Color('#3f7fc8') }, horizon: { value: new THREE.Color('#cfe5f5') } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyUni, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float k = smoothstep(-0.05, 0.55, vP.y); gl_FragColor = vec4(mix(horizon, top, k), 1.0); \n#include <colorspace_fragment>\n }',
    }));
    sky.position.set(50, 0, 0);
    sky.renderOrder = -10;
    this.root.add(sky);
    this.sky = sky;
    this.scene.fog = new THREE.Fog('#cfe5f5', 120, 420);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#eef4ff', '#55714a', 1.35);
    this.scene.add(this.hemi);
    // The main stadium light: high, off to one side, casting soft shadows. Its shadow box
    // follows the play (see follow()).
    const sun = new THREE.DirectionalLight('#fff6e8', 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(-26, 58, 34);
    this.scene.add(sun, sun.target);
    // Cool fill from the opposite stands so the shadow side never goes black.
    const fill = new THREE.DirectionalLight('#dbe7ff', 0.75);
    fill.position.set(80, 40, -60);
    this.scene.add(fill);
    this.fill = fill;
  }

  // Keep the sharp part of the shadow map on the action.
  follow(x, z) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }

  // ---------- ground, field, sideline ----------
  buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: '#557a45' }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(50, -0.6, 0);
    this.root.add(ground);
    this.ground = ground;
    // Sideline apron out to the wall: slightly darker turf.
    const apronTex = noiseTexture('#2f6f3c', 5, 256);
    apronTex.repeat.set(30, 16);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(WALL_X1 - WALL_X0, WALL_Z * 2), new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.95 }));
    apron.rotation.x = -Math.PI / 2; apron.position.set((WALL_X0 + WALL_X1) / 2, -0.01, 0);
    apron.receiveShadow = true;
    this.root.add(apron);
    this.apron = apron;
    // The white border around the field of play (six feet wide).
    const white = new THREE.MeshStandardMaterial({ color: '#f4f6f2', roughness: 0.9 });
    const strip = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.002, z); m.receiveShadow = true; this.root.add(m); };
    strip(124, 2, 50, HALF_W + 1); strip(124, 2, 50, -HALF_W - 1);
    strip(2, FIELD_W, -11, 0); strip(2, FIELD_W, 111, 0);
    // Team areas on both sidelines between the 30s, painted in team colors (set in paint()).
    this.teamArea = [];
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 4), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.32 }));
      m.rotation.x = -Math.PI / 2; m.position.set(50, 0.004, s * (HALF_W + 5.5));
      this.root.add(m);
      this.teamArea.push(m);
    }
    // Benches
    this.benches = [];
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.7 }));
        b.position.set(36 + i * 9.5, 0.45, s * (HALF_W + 8.2));
        b.castShadow = true;
        const back = new THREE.Mesh(new THREE.BoxGeometry(7, 0.7, 0.15), b.material);
        back.position.set(b.position.x, 0.95, b.position.z + s * 0.3);
        g.add(b, back);
      }
      this.root.add(g);
      this.benches.push(g);
    }
  }

  buildField() {
    const c = document.createElement('canvas');
    c.width = 120 * PX; c.height = Math.round(FIELD_W * PX);
    this.fieldCanvas = c;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.fieldTex = tex;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, FIELD_W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0 }));
    field.rotation.x = -Math.PI / 2; field.position.set(50, 0, 0);
    field.receiveShadow = true;
    this.root.add(field);
    this.field = field;
    // Pylons at the four corners of each end zone.
    const pyl = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.6 });
    for (const x of [-10, 0, 100, 110]) for (const z of [-HALF_W, HALF_W]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), pyl);
      m.position.set(x, 0.25, z); m.castShadow = true;
      this.root.add(m);
    }
  }

  // Paint the field for this matchup: grass with mowing stripes, lines, numbers, hashes,
  // the midfield logo and each team's end zone (the one it defends). view: the way your camera
  // faces along the field (+1 toward the right end, 0 when nobody is yours); both wordmarks
  // read upright from it, so your own end zone is not upside down from behind your goal line.
  paint(teams, view = 0) {
    const key = teams.map((t) => t.abbr + t.color + t.name + JSON.stringify(kitOf(t))).join('|') + view;
    if (key === this.teamsKey) return;
    this.teamsKey = key;
    const c = this.fieldCanvas, x = c.getContext('2d');
    const W = c.width, H = c.height;
    const X = (yd) => (yd + 10) * PX, Y = (z) => (z + HALF_W) * PX;
    // Clean turf: soft mowing stripes every five yards and only a whisper of grain, so the
    // lines and the players read first.
    for (let i = 0; i < 24; i++) { x.fillStyle = i % 2 ? '#3b8a46' : '#357f40'; x.fillRect(i * 5 * PX, 0, 5 * PX, H); }
    // Real turf is never one flat color: broad soft patches a shade lighter or darker, and
    // wear between the hashes where the lines meet every snap.
    let sd = 99;
    const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let k = 0; k < 140; k++) {
      const px = rr() * W, py = rr() * H, rad = (2 + rr() * 6) * PX;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      const light = rr() < 0.5;
      g.addColorStop(0, light ? 'rgba(170,210,120,0.07)' : 'rgba(10,40,15,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    for (let yd = 12; yd <= 88; yd += 2) {
      const px = X(yd + (rr() - 0.5) * 2), py = Y((rr() - 0.5) * 6), rad = (1.6 + rr() * 2) * PX;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(150,140,90,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    grain(x, W, H, 4, false);
    // End zones, in each team's kit (kitdraw.js).
    const ez = (left, team) => paintEndZone(x, left ? 0 : X(100), H, PX, team, left, view || (left ? -1 : 1));
    ez(true, teams[0]); ez(false, teams[1]);
    // Lines
    x.fillStyle = 'rgba(252,253,250,0.97)';
    const vline = (yd, w) => x.fillRect(X(yd) - (w * PX) / 2, PX * 0.15, w * PX, H - PX * 0.3);
    vline(0, 0.3); vline(100, 0.3);
    for (let yd = 5; yd < 100; yd += 5) vline(yd, yd % 10 ? 0.15 : 0.2);
    // Hash marks: inbound lines and along the sidelines, every yard.
    for (let yd = 1; yd < 100; yd++) {
      if (yd % 5 === 0) continue;
      for (const [a, b] of [[-HALF_W + 0.15, -HALF_W + 0.85], [-3.75, -3.08], [3.08, 3.75], [HALF_W - 0.85, HALF_W - 0.15]]) x.fillRect(X(yd) - 0.07 * PX, Y(a), 0.14 * PX, (b - a) * PX);
    }
    // Two-point lines
    for (const yd of [2, 98]) x.fillRect(X(yd) - 0.06 * PX, Y(-0.5), 0.12 * PX, PX);
    // Yard numbers with direction arrows, readable from each sideline.
    x.font = `700 ${PX * 2.6}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let yd = 10; yd <= 90; yd += 10) {
      const n = String(yd <= 50 ? yd : 100 - yd);
      for (const [z, rot] of [[-HALF_W + 8, Math.PI], [HALF_W - 8, 0]]) {
        x.save(); x.translate(X(yd), Y(z)); x.rotate(rot);
        x.fillStyle = 'rgba(252,253,250,0.95)';
        x.fillText(n[0], -PX * 1.0, 0); x.fillText(n[1], PX * 1.0, 0);
        if (yd !== 50) {
          // Arrow toward the nearer goal line.
          const toLeft = yd < 50, s = (toLeft ? -1 : 1) * (rot ? -1 : 1);
          x.beginPath(); x.moveTo(s * PX * 2.35, -PX * 0.55); x.lineTo(s * PX * 2.35, -PX * 0.05); x.lineTo(s * PX * 2.95, -PX * 0.3); x.closePath(); x.fill();
        }
        x.restore();
      }
    }
    // Midfield logo: the home team's crest (logos.js), painted on the turf once its image has
    // loaded; the league's own Poké Ball when there is no home team (the main menu).
    if (teams[0]?.abbr && teams[0].abbr !== 'PKB') {
      const img = new Image(), R = PX * 4.6;
      img.onload = () => {
        if (this.teamsKey !== key) return;
        x.save(); x.translate(X(50), H / 2); x.rotate(view < 0 ? -Math.PI / 2 : Math.PI / 2); x.globalAlpha = 0.92;
        x.drawImage(img, -R, -R, R * 2, R * 2);
        x.restore();
        this.fieldTex.needsUpdate = true;
      };
      img.src = logoDataUrl(teams[0], 256);
    } else {
      x.save(); x.translate(X(50), H / 2); x.globalAlpha = 0.32;
      const R = PX * 2.6;
      x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fillStyle = '#f2f4ee'; x.fill();
      x.beginPath(); x.arc(0, 0, R, Math.PI, Math.PI * 2); x.fillStyle = '#c9543f'; x.fill();
      x.fillStyle = '#16221b'; x.fillRect(-R, -PX * 0.35, R * 2, PX * 0.7);
      x.beginPath(); x.arc(0, 0, PX * 1.35, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(0, 0, PX * 0.85, 0, Math.PI * 2); x.fillStyle = '#f2f4ee'; x.fill();
      x.lineWidth = PX * 0.3; x.strokeStyle = '#16221b'; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.stroke();
      x.restore();
    }
    this.fieldTex.needsUpdate = true;
    // Team colors on the sideline, the benches, the wall and the crowd.
    this.teamArea[0].material.color.set(teams[1].color); this.teamArea[1].material.color.set(teams[0].color);
    this.benches[0].children.forEach((m) => m.material.color.set(teams[1].color));
    this.benches[1].children.forEach((m) => m.material.color.set(teams[0].color));
    this.paintBanners(teams);
    this.paintCrowd(teams);
  }

  // ---------- seating bowl, wall and crowd ----------
  buildBowl() {
    // Wall around the field with a banner strip on its inner face.
    this.bannerCanvas = document.createElement('canvas');
    this.bannerCanvas.width = 2048; this.bannerCanvas.height = 64;
    this.bannerTex = new THREE.CanvasTexture(this.bannerCanvas);
    this.bannerTex.colorSpace = THREE.SRGBColorSpace;
    this.bannerTex.wrapS = THREE.RepeatWrapping;
    const wallMat = new THREE.MeshStandardMaterial({ map: this.bannerTex, roughness: 0.7, emissive: '#ffffff', emissiveMap: this.bannerTex, emissiveIntensity: 0.25 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#2a3340', roughness: 0.8 });
    const wall = (len, x, z, ry) => {
      const t = this.bannerTex.clone(); t.repeat.set(len / 60, 1); t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.7), wallMat.clone());
      m.material.map = t; m.material.emissiveMap = t;
      m.position.set(x, 0.85, z); m.rotation.y = ry;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 0.5), capMat);
      cap.position.set(x, 1.8, z); cap.rotation.y = ry;
      this.root.add(m, cap);
      return m;
    };
    this.walls = [
      wall(WALL_X1 - WALL_X0, 50, -WALL_Z, 0), wall(WALL_X1 - WALL_X0, 50, WALL_Z, Math.PI),
      wall(WALL_Z * 2, WALL_X0, 0, Math.PI / 2), wall(WALL_Z * 2, WALL_X1, 0, -Math.PI / 2),
    ];
    // Stepped decks: long sides run past the corners, end decks sit between them. Each row is
    // a concrete riser with a band of seats on it; stairways (aisles) cut through every
    // sixteen yards, and a club-level fascia splits the bowl into a lower and an upper deck.
    const parts = [];
    const colored = (g, col) => {
      const n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (g.index) { const ng = g.toNonIndexed(); g.dispose(); return ng; }
      return g;
    };
    const place = (g, along, y, out, alongX, z0, outward) => (alongX ? g.translate(along, y, z0 + outward * out) : g.translate(z0 + outward * out, y, along));
    const box = (alongLen, h, depth, alongX) => (alongX ? new THREE.BoxGeometry(alongLen, h, depth) : new THREE.BoxGeometry(depth, h, alongLen));
    const seatA = new THREE.Color('#2b3c5c'), seatB = new THREE.Color('#33496f'), stair = new THREE.Color('#8c949e');
    const deck = (x0, x1, z0, outward, alongX) => {
      const len = Math.abs(x1 - x0), cx = (x0 + x1) / 2;
      for (let r = 0; r < ROWS; r++) {
        const y = DECK_Y + r * ROW_H, d = (r + 0.5) * ROW_D + 0.6 + (r >= CLUB_ROW ? CLUB_GAP : 0);
        parts.push(colored(place(box(len, ROW_H, ROW_D, alongX), cx, y - ROW_H / 2, d, alongX, z0, outward), new THREE.Color(r % 2 ? '#5d6672' : '#68717d')));
        // The seats: a low band at the back of each tread, two tones by section.
        const seat = colored(place(box(len, 0.32, 0.42, alongX), cx, y + 0.16, d + ROW_D * 0.22, alongX, z0, outward), (r >> 2) % 2 ? seatA : seatB);
        parts.push(seat);
      }
      // Stairways: lighter strips down the rows.
      for (let a = Math.ceil(Math.min(x0, x1) / AISLE) * AISLE; a < Math.max(x0, x1); a += AISLE) {
        for (let r = 0; r < ROWS; r++) {
          const y = DECK_Y + r * ROW_H, d = (r + 0.5) * ROW_D + 0.6 + (r >= CLUB_ROW ? CLUB_GAP : 0);
          parts.push(colored(place(box(1.1, 0.06, ROW_D, alongX), a, y + 0.03, d, alongX, z0, outward), stair));
        }
      }
      // Club level: a deep fascia between the decks.
      const yc = DECK_Y + CLUB_ROW * ROW_H, dc = CLUB_ROW * ROW_D + 0.6 + CLUB_GAP / 2;
      parts.push(colored(place(box(len, 1.3, CLUB_GAP + 0.2, alongX), cx, yc - 0.15, dc, alongX, z0, outward), new THREE.Color('#1c232d')));
      this.clubs.push({ x0, x1, z0, outward, alongX, y: yc, d: CLUB_ROW * ROW_D + 0.6 - 0.12 });
    };
    this.clubs = [];
    const ext = ROWS * ROW_D + 2 + CLUB_GAP;
    deck(WALL_X0 - ext, WALL_X1 + ext, -WALL_Z - 0.3, -1, true);
    deck(WALL_X0 - ext, WALL_X1 + ext, WALL_Z + 0.3, 1, true);
    deck(-WALL_Z, WALL_Z, WALL_X0 - 0.3, -1, false);
    deck(-WALL_Z, WALL_Z, WALL_X1 + 0.3, 1, false);
    const bowl = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.root.add(bowl);
    this.bowl = bowl;
    parts.forEach((g) => g.dispose());
    // Back wall and an LED ribbon at the top of the bowl.
    const topY = DECK_Y + ROWS * ROW_H, back = ROWS * ROW_D + 0.9 + CLUB_GAP;
    this.ribbonCanvas = document.createElement('canvas');
    this.ribbonCanvas.width = 2048; this.ribbonCanvas.height = 48;
    this.ribbonTex = new THREE.CanvasTexture(this.ribbonCanvas);
    this.ribbonTex.colorSpace = THREE.SRGBColorSpace; this.ribbonTex.wrapS = THREE.RepeatWrapping;
    const ribMat = new THREE.MeshBasicMaterial({ map: this.ribbonTex, fog: true });
    const backMat = new THREE.MeshLambertMaterial({ color: '#3b4452' });
    const backWall = (len, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 7), backMat); m.position.set(x, topY + 2.5, z); m.rotation.y = ry; this.root.add(m);
      const t = this.ribbonTex.clone(); t.repeat.set(len / 80, 1); t.needsUpdate = true;
      const r = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.3), ribMat.clone()); r.material.map = t; r.position.set(x, topY + 1.3, z); r.rotation.y = ry;
      r.position.x += Math.sin(ry) * 0.05; r.position.z += Math.cos(ry) * 0.05;
      this.root.add(r);
      this.ribbons = (this.ribbons ?? []).concat(t);
    };
    const L = WALL_X1 - WALL_X0 + ext * 2;
    // The club level's face carries the LED ribbon too.
    for (const c of this.clubs) {
      const len = Math.abs(c.x1 - c.x0), mid = (c.x0 + c.x1) / 2;
      const t = this.ribbonTex.clone(); t.repeat.set(len / 80, 1); t.needsUpdate = true;
      const r = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), ribMat.clone()); r.material.map = t;
      if (c.alongX) { r.position.set(mid, c.y - 0.15, c.z0 + c.outward * c.d); r.rotation.y = c.outward > 0 ? Math.PI : 0; }
      else { r.position.set(c.z0 + c.outward * c.d, c.y - 0.15, mid); r.rotation.y = c.outward > 0 ? -Math.PI / 2 : Math.PI / 2; }
      this.root.add(r);
      this.ribbons = (this.ribbons ?? []).concat(t);
    }
    backWall(L, 50, -WALL_Z - back, 0); backWall(L, 50, WALL_Z + back, Math.PI);
    backWall(WALL_Z * 2 + back * 2, WALL_X0 - back, 0, Math.PI / 2); backWall(WALL_Z * 2 + back * 2, WALL_X1 + back, 0, -Math.PI / 2);
    this.buildCrowd(ext);
  }

  buildCrowd(ext) {
    // One instance per fan: a body in a shirt and a head, bobbing in a vertex shader so the
    // crowd costs nothing on the CPU. Fans leave a few empty seats, the stairways clear, and
    // fill the lower deck a little more than the upper one.
    // Few triangles a fan (an open four-sided body and an eight-sided head): there are
    // thousands of them, and from the field they read as people either way.
    const body = new THREE.CylinderGeometry(0.19, 0.25, 0.62, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.31, 0);
    const head = new THREE.OctahedronGeometry(0.16).translate(0, 0.78, 0);
    const spots = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const row = (x0, x1, z0, outward, alongX) => {
      for (let r = 0; r < ROWS; r++) {
        const y = DECK_Y + r * ROW_H, d = (r + 0.5) * ROW_D + 0.6 + (r >= CLUB_ROW ? CLUB_GAP : 0) + 0.05;
        const empty = r < CLUB_ROW ? 0.08 : 0.16;
        for (let s = x0 + 0.4; s < x1; s += 0.62) {
          const a = ((s % AISLE) + AISLE) % AISLE;
          if (a < 0.8 || a > AISLE - 0.8) continue;
          if (rnd() < empty) continue;
          const jitter = (rnd() - 0.5) * 0.12;
          if (alongX) spots.push([s + jitter, y, z0 + outward * d, outward > 0 ? Math.PI : 0, r]);
          else spots.push([z0 + outward * d, y, s + jitter, outward > 0 ? -Math.PI / 2 : Math.PI / 2, r]);
        }
      }
    };
    row(WALL_X0 - ext, WALL_X1 + ext, -WALL_Z - 0.3, -1, true);
    row(WALL_X0 - ext, WALL_X1 + ext, WALL_Z + 0.3, 1, true);
    row(-WALL_Z, WALL_Z, WALL_X0 - 0.3, -1, false);
    row(-WALL_Z, WALL_Z, WALL_X1 + 0.3, 1, false);
    this.crowdUni = { time: { value: 0 }, excite: { value: 0 } };
    const mat = () => {
      const m = new THREE.MeshLambertMaterial();
      m.onBeforeCompile = (sh) => {
        sh.uniforms.time = this.crowdUni.time; sh.uniforms.excite = this.crowdUni.excite;
        sh.vertexShader = 'uniform float time; uniform float excite;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
          float sp = 2.0 + ph * 3.0;
          float idle = sin(time * (0.6 + ph) + ph * 30.0) * 0.03;
          float bob = max(0.0, sin(time * sp + ph * 40.0)) * excite * 0.35;
          transformed.y += bob + idle;`);
      };
      return m;
    };
    const bodies = new THREE.InstancedMesh(body, mat(), spots.length);
    const heads = new THREE.InstancedMesh(head, mat(), spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const skin = ['#f1c9a5', '#d9a77e', '#b47a52', '#8a5636', '#5e3a24', '#f6dcc4'].map((h) => new THREE.Color(h));
    spots.forEach(([x, y, z, ry], i) => {
      q.setFromEuler(e.set(0, ry + (rnd() - 0.5) * 0.4, 0));
      const s = 0.88 + rnd() * 0.24;
      m4.compose(v.set(x, y, z), q, one.set(s, s * (0.92 + rnd() * 0.16), s));
      bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
      heads.setColorAt(i, skin[Math.floor(rnd() * skin.length)]);
    });
    bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
    heads.instanceColor.needsUpdate = true;
    bodies.frustumCulled = false; heads.frustumCulled = false;
    this.crowd = bodies; this.crowdHeads = heads;
    this.crowdSpots = spots;
    this.crowdSeed = spots.map(() => rnd());
    this.root.add(bodies, heads);
  }

  // Crowd colors: each end and each half of the sidelines is a team's section, mostly in its
  // colors (shades of them: replica jerseys, lighter and darker), with plenty of white, black,
  // grey and other shirts mixed in, and a neutral section at midfield.
  paintCrowd(teams) {
    const c = new THREE.Color(), cols = [new THREE.Color(teams[0].color), new THREE.Color(teams[1].color)];
    const other = ['#f4f2ec', '#f4f2ec', '#22262c', '#3a3f47', '#9aa3ad', '#c9b48a', '#5d6f8a', '#7a3b3b', '#2f5d3a', '#e0c24a'].map((h) => new THREE.Color(h));
    const n = this.crowd.count;
    for (let i = 0; i < n; i++) {
      const r = this.crowdSeed[i], [x, , z, , row] = this.crowdSpots[i];
      const away = x > 100 || (x >= 0 && x <= 100 && z > 0 ? x > 56 : z < 0 && x > 64);
      const mid = x > 44 && x < 56;
      const teamShare = mid ? 0.35 : row < CLUB_ROW ? 0.62 : 0.55;
      if (r < teamShare) {
        c.copy(cols[away ? 1 : 0]);
        c.offsetHSL((this.crowdSeed[(i * 13) % n] - 0.5) * 0.03, -0.08, (this.crowdSeed[(i * 7) % n] - 0.5) * 0.26);
      } else c.copy(other[Math.floor(this.crowdSeed[(i * 11) % n] * other.length)]).offsetHSL(0, 0, (this.crowdSeed[(i * 5) % n] - 0.5) * 0.1);
      this.crowd.setColorAt(i, c);
    }
    this.crowd.instanceColor.needsUpdate = true;
  }

  paintBanners(teams) {
    const x = this.bannerCanvas.getContext('2d'), W = this.bannerCanvas.width, H = this.bannerCanvas.height;
    const blocks = [[teams[0].color, teams[0].name], ['#16221b', 'POKEBALL'], [teams[1].color, teams[1].name], ['#e5402b', 'GO ' + teams[0].abbr]];
    const bw = W / blocks.length;
    blocks.forEach(([col, text], i) => {
      x.fillStyle = col; x.fillRect(i * bw, 0, bw, H);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(i * bw, 0, bw, H * 0.18);
      x.fillStyle = '#ffffff'; x.font = '700 38px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      fitText(x, String(text).toUpperCase(), bw - 30);
      x.fillText(String(text).toUpperCase(), i * bw + bw / 2, H / 2 + 2);
    });
    this.bannerTex.needsUpdate = true;
    for (const w of this.walls) w.material.map.needsUpdate = true;
    const r = this.ribbonCanvas.getContext('2d'), RW = this.ribbonCanvas.width, RH = this.ribbonCanvas.height;
    r.fillStyle = '#0b0f14'; r.fillRect(0, 0, RW, RH);
    const seg = RW / 6;
    for (let i = 0; i < 6; i++) {
      const t = teams[i % 2];
      r.fillStyle = t.color; r.fillRect(i * seg + 6, 6, seg - 12, RH - 12);
      r.fillStyle = '#fff'; r.font = '700 30px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; r.textAlign = 'center'; r.textBaseline = 'middle';
      r.fillText(i % 3 === 2 ? 'POKEBALL' : t.abbr, i * seg + seg / 2, RH / 2 + 1);
    }
    for (const t of this.ribbons) t.needsUpdate = true;
  }

  // ---------- goalposts and light towers ----------
  buildPosts() {
    this.posts = [];
    for (const [x, s] of [[-10, -1], [110, 1]]) {
      // Each post has its own materials, so the one between the lens and the play can fade
      // (see fadePosts) without the far one fading with it.
      const mat = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.45, metalness: 0.1, transparent: true });
      const padMat = new THREE.MeshStandardMaterial({ color: '#3b4a5a', roughness: 0.8, transparent: true });
      this.posts.push({ x, mats: [mat, padMat], fade: 1 });
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 3.33, 12), mat);
      base.position.set(x + s * 0.7, 1.66, 0);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.9, 12), padMat);
      pad.position.set(x + s * 0.7, 0.95, 0);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.72, 10), mat);
      neck.rotation.z = Math.PI / 2; neck.position.set(x + s * 0.35, 3.33, 0);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.17, 12), mat);
      bar.rotation.x = Math.PI / 2; bar.position.set(x, 3.33, 0);
      g.add(base, pad, neck, bar);
      for (const z of [-3.08, 3.08]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 10, 10), mat);
        up.position.set(x, 3.33 + 5, z);
        g.add(up);
      }
      g.traverse((o) => { o.castShadow = true; });
      this.root.add(g);
    }
  }

  // A goalpost standing between the lens and what it looks at (a snap inside your own 10, the
  // camera back over the end zone) would cut through the backfield: it fades to a ghost while it
  // is in the way, and comes back once the camera is past it.
  fadePosts(cam, look, dt) {
    for (const P of this.posts ?? []) {
      const between = (cam.x - P.x) * (look.x - P.x) < 0;
      const want = between ? 0.15 : 1;
      P.fade += (want - P.fade) * (1 - Math.exp(-dt * 8));
      const op = P.fade > 0.99 ? 1 : P.fade;
      for (const m of P.mats) if (m.opacity !== op) { m.opacity = op; m.depthWrite = op === 1; }
    }
  }

  buildTowers() {
    const poleMat = new THREE.MeshLambertMaterial({ color: '#4a5462' });
    const lamp = lampTexture();
    const lampMat = new THREE.MeshBasicMaterial({ map: lamp, color: '#ffffff', fog: false });
    const glowTex = glowTexture();
    const back = ROWS * ROW_D + 3;
    this.towers = new THREE.Group();
    this.glows = [];
    for (const [x, z] of [[WALL_X0 - back + 4, -WALL_Z - back + 4], [WALL_X1 + back - 4, -WALL_Z - back + 4], [WALL_X0 - back + 4, WALL_Z + back - 4], [WALL_X1 + back - 4, WALL_Z + back - 4]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 46, 8), poleMat);
      pole.position.set(x, 23, z); this.towers.add(pole);
      const head = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), lampMat);
      head.position.set(x, 47, z); head.lookAt(50, 10, 0); this.towers.add(head);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff3d0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.55 }));
      glow.scale.set(26, 18, 1); glow.position.set(x, 47, z); this.towers.add(glow);
      this.glows.push(glow);
    }
    this.root.add(this.towers);
  }

  // ---------- night: stars, the moon and the flashes in the crowd ----------
  buildNight() {
    let seed = 31;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const N = 1400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, y = 0.12 + rnd() * 0.88, r = Math.sqrt(1 - y * y);
      pos.set([50 + Math.cos(a) * r * 560, y * 560, Math.sin(a) * r * 560], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.visible = false; this.stars.renderOrder = -9;
    this.root.add(this.stars);
    const mc = document.createElement('canvas'); mc.width = mc.height = 128;
    const mx = mc.getContext('2d'), mg = mx.createRadialGradient(64, 64, 20, 64, 64, 64);
    mg.addColorStop(0, 'rgba(255,255,255,1)'); mg.addColorStop(0.5, 'rgba(255,255,255,1)'); mg.addColorStop(0.56, 'rgba(255,255,255,0.25)'); mg.addColorStop(1, 'rgba(255,255,255,0)');
    mx.fillStyle = mg; mx.fillRect(0, 0, 128, 128);
    mx.fillStyle = 'rgba(160,165,180,0.35)';
    for (const [cx, cy, r] of [[50, 52, 9], [76, 70, 7], [60, 82, 5], [80, 48, 4]]) { mx.beginPath(); mx.arc(cx, cy, r, 0, Math.PI * 2); mx.fill(); }
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), color: '#f3f1e6', transparent: true, depthWrite: false, fog: false }));
    this.moon.position.set(-260, 250, -330); this.moon.scale.setScalar(60); this.moon.visible = false;
    this.root.add(this.moon);
    // Phone lights and camera flashes: a point of light on one fan in eight, each blinking on its
    // own beat, more of them as the crowd gets loud.
    const spots = this.crowdSpots.filter((_, i) => i % 8 === 3);
    const fp = new Float32Array(spots.length * 3), ph = new Float32Array(spots.length);
    spots.forEach(([x, y, z], i) => { fp.set([x, y + 1.0, z], i * 3); ph[i] = rnd(); });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
    this.flashUni = { time: { value: 0 }, excite: { value: 0 }, night: { value: 0 } };
    this.flashes = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: this.flashUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float ph; uniform float time; uniform float excite; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float rate = 0.35 + ph * 0.6 + excite * 2.5;
          float k = fract(time * rate + ph * 17.0);
          float flash = smoothstep(0.985 - excite * 0.05, 1.0, k);
          float phone = step(0.82, ph) * (0.35 + 0.15 * sin(time * 1.3 + ph * 40.0));
          vA = max(flash, phone);
          gl_PointSize = (2.0 + flash * 5.0) * (240.0 / max(10.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float night; varying float vA;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), vA * night * (1.0 - r * 4.0)); }`,
    }));
    this.flashes.frustumCulled = false; this.flashes.visible = false;
    this.root.add(this.flashes);
  }

  // ---------- the video board ----------
  // Above the stands at one end (a center-hung cube under a dome): the score, the quarter and
  // clock, and full-board graphics for the big moments.
  buildBoard() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 192;
    this.boardCanvas = c;
    this.boardTex = new THREE.CanvasTexture(c); this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.MeshBasicMaterial({ map: this.boardTex, fog: false, toneMapped: false });
    const frame = new THREE.MeshLambertMaterial({ color: '#1b2028' });
    const back = ROWS * ROW_D + 0.9 + CLUB_GAP, topY = DECK_Y + ROWS * ROW_H;
    // The end board, facing down the field from over the left end's stands.
    const end = new THREE.Group();
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(32, 12), face); scr.position.set(0, 0, 0.32);
    const box = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 0.6), frame);
    end.add(box, scr);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), frame); leg.position.set(s * 12, -13, -0.4); end.add(leg); }
    end.position.set(WALL_X0 - back + 1, topY + 15, 0); end.rotation.y = Math.PI / 2;
    this.root.add(end);
    // The center-hung cube for the dome.
    const hung = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const w = i % 2 ? 18 : 26, d = i % 2 ? 13.85 : 9.85;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 7.5), face);
      const a = (i * Math.PI) / 2;
      m.position.set(Math.sin(a) * d, 0, Math.cos(a) * d); m.rotation.y = a;
      hung.add(m);
    }
    hung.add(new THREE.Mesh(new THREE.BoxGeometry(27.6, 8, 19.6), frame));
    hung.position.set(50, 31, 0); hung.visible = false;
    this.root.add(hung);
    this.boards = { end, hung };
    this.boardKey = '';
  }
  // The board's picture: the score, or a graphic (TOUCHDOWN) in a team's colors for a while.
  setBoard(g, now = 0) {
    if (!g) return;
    const fl = this.boardFlash && this.boardFlash.until > now ? this.boardFlash : null;
    const q = g.final ? 'FINAL' : g.quarter <= 4 ? `Q${g.quarter}` : 'OT';
    const key = fl ? `F${fl.text}${fl.color}` : `${g.teams.map((t) => t.abbr + t.color).join()}|${g.score}|${q}|${Math.floor(g.clock / 60)}|${g.down}|${g.toGo}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    const c = this.boardCanvas, x = c.getContext('2d'), W = c.width, H = c.height;
    x.fillStyle = '#05080c'; x.fillRect(0, 0, W, H);
    const font = (w, px) => `${w} ${px}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (fl) {
      const kit = fl.kit ?? { color2: '#111' };
      x.fillStyle = fl.color; x.fillRect(0, 0, W, H);
      x.fillStyle = kit.color2; for (let i = -4; i < 12; i++) { x.beginPath(); x.moveTo(i * 64, H); x.lineTo(i * 64 + 28, H); x.lineTo(i * 64 + 28 + 60, 0); x.lineTo(i * 64 + 60, 0); x.fill(); }
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, H * 0.3, W, H * 0.4);
      x.font = font(800, 84); fitText(x, fl.text, W - 30);
      x.fillStyle = '#fff'; x.fillText(fl.text, W / 2, H / 2 + 4);
    } else {
      const [Hm, A] = g.teams;
      for (const [i, t, sc] of [[0, A, g.score[1]], [1, Hm, g.score[0]]]) {
        const x0 = i * W / 2;
        x.fillStyle = t.color; x.fillRect(x0 + 6, 6, W / 2 - 12, 118);
        x.fillStyle = inkOn(t.color); x.font = font(700, 40); x.fillText(t.abbr, x0 + W / 4 - 60, 65);
        x.font = font(800, 92); x.fillText(String(sc), x0 + W / 4 + 50, 68);
      }
      x.fillStyle = '#ffd23f'; x.font = font(700, 44);
      const clock = `${Math.floor(g.clock / 60)}:${String(Math.floor(g.clock % 60)).padStart(2, '0')}`;
      x.fillText(g.final ? 'FINAL' : `${q}  ${clock}`, W / 2, 158);
    }
    // LED pixels: a fine dark grid over everything.
    x.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < W; i += 4) x.fillRect(i, 0, 1, H);
    for (let j = 0; j < H; j += 4) x.fillRect(0, j, W, 1);
    this.boardTex.needsUpdate = true;
  }
  flashBoard(text, team, now, secs = 3.5) {
    this.boardFlash = { text: String(text).toUpperCase(), color: team?.color ?? '#e5402b', kit: team ? kitOf(team) : null, until: now + secs * 1000 };
    this.boardKey = '';
  }

  // ---------- the venue and the time of day ----------
  setVenue(v) {
    const info = { stadium: v?.stadium ?? 'classic', time: v?.time ?? 'day', roof: !!v?.roof };
    const key = `${info.stadium}|${info.time}`;
    if (key === this.venueKey) return;
    if (!this.venue || this.venueInfo.stadium !== info.stadium) {
      if (this.venue) { this.root.remove(this.venue.group); this.venue.group.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); }); }); }
      this.venue = buildVenue(info.stadium);
      this.root.add(this.venue.group);
    }
    this.venueInfo = info;
    this.venueKey = key;
    this.applyLook();
  }

  // Sky, fog and light from the weather, then the time of day and the venue on top.
  applyLook() {
    const want = this.weather?.kind ?? 'clear';
    const [top, hor, hemi0, sun0, sunCol0, f0, f1] = LOOKS[want] ?? LOOKS.clear;
    const v = this.venueInfo ?? { stadium: 'classic', time: 'day', roof: false };
    const cTop = new THREE.Color(top), cHor = new THREE.Color(hor), sunCol = new THREE.Color(sunCol0);
    let hemi = hemi0, sun = sun0, near = f0, far = f1, night = 0;
    if (v.roof) {
      cTop.set('#1c2027'); cHor.set('#2a2f38'); hemi = 1.35; sun = 2.5; sunCol.set('#fffaf0'); near = 170; far = 520;
    } else if (v.time === 'dusk') {
      cTop.lerp(new THREE.Color('#2b2f6e'), 0.75); cHor.lerp(new THREE.Color('#f39a5f'), 0.7);
      hemi *= 0.8; sun *= 0.85; sunCol.lerp(new THREE.Color('#ffc796'), 0.7); night = 0.45;
    } else if (v.time === 'night') {
      cTop.lerp(new THREE.Color('#03050d'), 0.94); cHor.lerp(new THREE.Color('#141b2e'), 0.9);
      hemi = 0.7; sun = 2.7; sunCol.set('#f3f6ff'); near = 150; far = 600; night = 1;
    }
    if (v.stadium === 'haunted') { cTop.lerp(new THREE.Color('#1a0d30'), 0.6); cHor.lerp(new THREE.Color('#5b2e70'), 0.55); near *= 0.7; far *= 0.75; }
    if (v.stadium === 'mountain' && !night) cHor.lerp(new THREE.Color('#dde9f6'), 0.35);
    if (v.stadium === 'seaside' && !night) cHor.lerp(new THREE.Color('#bfe3f2'), 0.3);
    this.skyUni.top.value.copy(cTop); this.skyUni.horizon.value.copy(cHor);
    this.scene.fog.color.copy(cHor); this.scene.fog.near = near; this.scene.fog.far = far;
    this.hemi.intensity = hemi; this.sun.intensity = sun; this.sun.color.copy(sunCol);
    this.hemi.groundColor.set(night > 0.9 ? '#2c3a2e' : '#55714a');
    this.fill.intensity = v.roof ? 0.9 : 0.75 * (1 - night * 0.4);
    // At night the light comes from the banks overhead, not a low sun.
    this.sunOffset.set(night > 0.9 || v.roof ? -12 : -26, night > 0.9 || v.roof ? 72 : 58, night > 0.9 || v.roof ? 20 : 34);
    this.night = v.roof ? 0 : night;
    this.sky.visible = !v.roof;
    this.towers.visible = !v.roof;
    this.boards.end.visible = !v.roof; this.boards.hung.visible = v.roof;
    for (const gl of this.glows) { gl.material.opacity = 0.55 + night * 0.45; gl.scale.set(26 + night * 14, 18 + night * 10, 1); }
    // Under the lights the field is the brightest thing in the building: the stands, the crowd and
    // the sideline fall back into the dark.
    const dim = v.roof ? 0.85 : 1 - night * 0.5;
    this.bowl.material.color.setScalar(dim);
    this.crowd.material.color.setScalar(Math.min(1, dim + 0.2)); this.crowdHeads.material.color.setScalar(Math.min(1, dim + 0.2));
    this.apron.material.color.setScalar(v.roof ? 0.9 : 1 - night * 0.35);
    if (v.stadium === 'haunted') { this.bowl.material.color.multiply(new THREE.Color('#c9b8e8')); this.apron.material.color.multiply(new THREE.Color('#b9a8cf')); }
    this.stars.visible = this.moon.visible = !v.roof && night > 0.3;
    this.stars.material.opacity = night > 0.9 ? 0.85 : 0.25;
    this.moon.material.color.set(v.stadium === 'haunted' ? '#d9c8ff' : '#f3f1e6');
    this.moon.scale.setScalar(v.stadium === 'haunted' ? 90 : 60);
    this.flashes.visible = night > 0.3;
    this.flashUni.night.value = night;
    // Outside the bowl the lights do not reach: the land, the trees and the hills go dark.
    const out = v.roof ? 1 : 1 - night * 0.72;
    this.ground.material.color.set(this.venue?.ground ?? '#557a45').multiplyScalar(out);
    this.venue?.group.traverse((o) => {
      const m = o.isMesh && o.material;
      if (!m || m.isMeshBasicMaterial || !m.color) return;
      m.userData.base ??= m.color.clone();
      m.color.copy(m.userData.base).multiplyScalar(out);
    });
    this.venue?.setNight?.(night);
    this.ground.visible = !(v.stadium === 'seaside');
  }

  // ---------- weather ----------
  setWeather(kind, on = true) {
    const want = on ? kind : 'clear';
    if (this.weather?.kind === want) return;
    if (this.weather?.obj) { this.scene.remove(this.weather.obj); this.weather.obj.geometry.dispose(); this.weather.obj.material.dispose(); }
    this.weather = { kind: want };
    this.applyLook();
    if (want === 'rain' || want === 'hail' || want === 'sand') {
      // Only weather draws particles, and they are soft round flecks, not squares: thin rain
      // streaks, small hailstones, a light drift of sand low over the turf.
      const N = want === 'rain' ? 3000 : want === 'hail' ? 1200 : 900;
      const rain = want === 'rain';
      const pos = new Float32Array(N * (rain ? 6 : 3));
      const seeds = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { seeds[i * 3] = Math.random(); seeds[i * 3 + 1] = Math.random(); seeds[i * 3 + 2] = Math.random(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const obj = rain
        ? new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c7d3e0', transparent: true, opacity: 0.3, depthWrite: false }))
        : new THREE.Points(g, new THREE.PointsMaterial({ map: dotTexture(), color: want === 'sand' ? '#d9b77d' : '#f2f7ff', size: want === 'sand' ? 0.12 : 0.16, transparent: true, opacity: want === 'sand' ? 0.35 : 0.75, depthWrite: false }));
      obj.frustumCulled = false;
      this.scene.add(obj);
      Object.assign(this.weather, { obj, seeds, N, rain });
    }
  }

  // ---------- per frame ----------
  update(t, dt, center) {
    this.crowdUni.time.value = t;
    this.excite = Math.max(0, this.excite - dt * 0.18);
    // A night crowd never quite sits down.
    this.crowdUni.excite.value = Math.max(this.excite, this.night * 0.14);
    this.flashUni.time.value = t; this.flashUni.excite.value = this.excite;
    this.venue?.update(t, this.night);
    for (const r of this.ribbons) r.offset.x = (t * 0.02) % 1;
    const W = this.weather;
    if (W?.obj) {
      const a = W.obj.geometry.attributes.position.array, S = W.seeds, box = 70, hgt = 30;
      const kind = W.kind;
      for (let i = 0; i < W.N; i++) {
        const sx = S[i * 3], sy = S[i * 3 + 1], sz = S[i * 3 + 2];
        let y, x, z;
        if (kind === 'sand') {
          const u = (sx + t * (0.05 + sz * 0.04)) % 1;
          x = center.x + (u - 0.5) * box; y = 0.2 + sy * 8 + Math.sin(t * 2 + sx * 30) * 0.3; z = center.z + (sz - 0.5) * box;
        } else {
          const fall = kind === 'rain' ? 26 : 7;
          y = hgt - ((sy * hgt + t * fall) % hgt);
          x = center.x + (sx - 0.5) * box + (kind === 'hail' ? Math.sin(t + sz * 20) * 0.6 : 0);
          z = center.z + (sz - 0.5) * box;
        }
        if (W.rain) { a.set([x, y, z, x + 0.12, y + 0.9, z], i * 6); } else { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; }
      }
      W.obj.geometry.attributes.position.needsUpdate = true;
    }
  }

  cheer(k) { this.excite = Math.min(1, Math.max(this.excite, k)); }
}

// Sky top, horizon, ambient, sun, sun color, fog near and far, by the weather.
const LOOKS = {
  clear: ['#3f7fc8', '#cfe5f5', 1.12, 2.5, '#fff3e0', 120, 420],
  sun: ['#2f78d0', '#ffe9c2', 1.15, 2.8, '#ffe2b0', 140, 460],
  rain: ['#5b6675', '#9aa6b3', 1.15, 1.2, '#dfe6f0', 70, 260],
  hail: ['#7e8fa3', '#d6e0ea', 1.25, 1.4, '#eef4ff', 80, 300],
  sand: ['#b39468', '#e3c99a', 1.2, 1.6, '#ffe0b0', 70, 260],
};

// ---------- textures ----------
function grain(x, W, H, amt, blades = true) {
  const img = x.getImageData(0, 0, W, H), d = img.data;
  let s = 1234567;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 8) % (amt * 2 + 1)) - amt;
    d[i] += n; d[i + 1] += n * 1.2; d[i + 2] += n * 0.6;
  }
  // Blades: short darker streaks along the field.
  x.putImageData(img, 0, 0);
  if (!blades) return;
  x.globalAlpha = 0.06; x.fillStyle = '#0d2412';
  for (let k = 0; k < 9000; k++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const px = s % W; s = (s * 1103515245 + 12345) & 0x7fffffff; const py = s % H; x.fillRect(px, py, 6, 1); }
  x.globalAlpha = 1;
}

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function noiseTexture(base, amt, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, size, size);
  grain(x, size, size, amt);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function lampTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#2b3036'; x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
    const g = x.createRadialGradient(8 + i * 16, 8 + j * 16, 1, 8 + i * 16, 8 + j * 16, 7);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffe7a8');
    x.fillStyle = g; x.beginPath(); x.arc(8 + i * 16, 8 + j * 16, 6, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,240,200,0.35)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
