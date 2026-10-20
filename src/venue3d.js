// The world around the stadium, by the home team's kit (kits.js): an open bowl in the country,
// a dome, a mountain valley, a seaside point or a haunted hollow. Each builder returns a group
// to add outside the bowl and a per-frame update. Everything is seeded, so a venue looks the
// same every visit. Coordinates as in stadium3d.js: yards, the field's center at (50, 0, 0),
// the bowl reaching about 100 yards out along the field and 60 across it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CX = 50;

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
// A geometry painted one color per vertex (so many meshes merge into one draw call).
function paint(g, color) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function merged(parts, mat) {
  const m = new THREE.Mesh(mergeGeometries(parts), mat);
  parts.forEach((p) => p.dispose());
  return m;
}
// A point on a ring around the field, stretched along it the way the bowl is.
function ring(r, a) { return [CX + Math.cos(a) * r * 1.25, Math.sin(a) * r]; }

export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(0.4, mid); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------- mountain ----------
function mountain() {
  const group = new THREE.Group(), R = rng(4242), parts = [];
  const snow = new THREE.Color('#eef3f7'), rock = new THREE.Color('#59626e'), low = new THREE.Color('#3c5541');
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + R() * 0.2, r = 230 + R() * 150;
    const h = 70 + R() * 110, base = 55 + R() * 60;
    const g = new THREE.ConeGeometry(base, h, 7, 4).toNonIndexed();
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    // Jitter every vertex but the tip and the base ring, and paint by height: snow up top.
    const jit = {};
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k), key = `${p.getX(k).toFixed(2)},${y.toFixed(2)},${p.getZ(k).toFixed(2)}`;
      if (!jit[key]) jit[key] = [(R() - 0.5) * base * 0.22, (R() - 0.5) * h * 0.08, (R() - 0.5) * base * 0.22];
      const top = y > h / 2 - 0.01, bottom = y < -h / 2 + 0.01;
      if (!top && !bottom) p.setXYZ(k, p.getX(k) + jit[key][0], y + jit[key][1], p.getZ(k) + jit[key][2]);
      const k01 = (p.getY(k) + h / 2) / h;
      c.copy(k01 > 0.62 + (R() - 0.5) * 0.08 ? snow : k01 > 0.2 ? rock : low);
      c.toArray(col, k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const [x, z] = ring(r, a);
    g.translate(x, h / 2 - 4, z);
    parts.push(g);
  }
  group.add(merged(parts, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
  group.add(pines(R, 160, 82, 190, '#22402c'));
  return { group, ground: '#40633f', update() {} };
}
function pines(R, n, r0, r1, color) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = ring(r0 + R() * (r1 - r0), R() * Math.PI * 2);
    const h = 9 + R() * 12, s = 0.8 + R() * 0.5;
    parts.push(paint(new THREE.ConeGeometry(3.2 * s, h, 6).translate(x, h / 2 + 1.5, z), color));
    parts.push(paint(new THREE.CylinderGeometry(0.5, 0.6, 2, 5).translate(x, 1, z), '#3b2a1e'));
  }
  return merged(parts, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// ---------- seaside ----------
function waterNormals() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S), R = rng(77);
  const waves = Array.from({ length: 14 }, () => [R() * 6.28, 1 + Math.floor(R() * 5), 1 + Math.floor(R() * 5), R() * 6.28]);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let dx = 0, dy = 0;
    for (const [, fx, fy, ph] of waves) {
      const v = Math.cos(((i * fx + j * fy) / S) * Math.PI * 2 + ph);
      dx += v * fx * 0.05; dy += v * fy * 0.05;
    }
    const o = (j * S + i) * 4;
    img.data[o] = 128 + dx * 60; img.data[o + 1] = 128 + dy * 60; img.data[o + 2] = 255; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40);
  return t;
}
function seaside() {
  const group = new THREE.Group(), R = rng(901);
  const normals = waterNormals();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color: '#1d5f86', roughness: 0.18, metalness: 0.25, normalMap: normals, normalScale: new THREE.Vector2(0.6, 0.6) }));
  water.rotation.x = -Math.PI / 2; water.position.set(CX, -0.9, 0);
  group.add(water);
  // The point the stadium stands on: grass, ringed by a beach.
  const sand = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ color: '#d8c79b' }));
  sand.rotation.x = -Math.PI / 2; sand.scale.set(168, 128, 1); sand.position.set(CX, -0.7, 0);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ color: '#557a45' }));
  grass.rotation.x = -Math.PI / 2; grass.scale.set(150, 112, 1); grass.position.set(CX, -0.65, 0);
  group.add(sand, grass);
  // A lighthouse on a rock off the point, red and white bands, and a beam that turns at night.
  const parts = [];
  const LX = -95, LZ = 150;
  parts.push(paint(new THREE.DodecahedronGeometry(14, 0).scale(1.4, 0.55, 1.2).translate(LX, 2, LZ), '#5b5550'));
  for (let b = 0; b < 6; b++) parts.push(paint(new THREE.CylinderGeometry(3.4 - b * 0.18 - 0.18, 3.4 - b * 0.18, 5, 14, 1, true).translate(LX, 8.5 + b * 5, LZ), b % 2 ? '#c8352b' : '#f4f2ec'));
  parts.push(paint(new THREE.CylinderGeometry(3.2, 3.2, 0.6, 14).translate(LX, 36.3, LZ), '#2b2b2b'));
  parts.push(paint(new THREE.ConeGeometry(2.8, 3, 14).translate(LX, 41.6, LZ), '#2b2b2b'));
  group.add(merged(parts, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.6, 12), new THREE.MeshBasicMaterial({ color: '#fff4c8' }));
  lamp.position.set(LX, 38.4, LZ); group.add(lamp);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 120, 16, 1, true).translate(0, -60, 0).rotateZ(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const pivot = new THREE.Group(); pivot.position.set(LX, 38.4, LZ); pivot.add(beam); group.add(pivot);
  // Boats out in the bay.
  const boats = [];
  for (let i = 0; i < 9; i++) {
    const a = R() * Math.PI * 2, [x, z] = ring(210 + R() * 160, a);
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 3.2), new THREE.MeshLambertMaterial({ color: R() < 0.5 ? '#f4f2ec' : '#2d4a66' }));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 5), new THREE.MeshLambertMaterial({ color: '#d8d8d8' }));
    mast.position.y = 5.2;
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0, 8); shape.lineTo(5, 0); shape.closePath();
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: ['#ffffff', '#ffd23f', '#e5402b', '#7dd3fc'][i % 4], side: THREE.DoubleSide }));
    sail.position.set(0.2, 1.2, 0);
    b.add(hull, mast, sail);
    b.position.set(x, -0.2, z); b.rotation.y = R() * Math.PI * 2;
    group.add(b);
    boats.push([b, R() * 6.28]);
  }
  return {
    group, ground: null, beam,
    update(t, night) {
      normals.offset.set((t * 0.004) % 1, (t * 0.0025) % 1);
      pivot.rotation.y = t * 0.6;
      beam.visible = night > 0;
      beam.material.opacity = 0.1 * night;
      for (const [b, ph] of boats) { b.position.y = -0.2 + Math.sin(t * 0.9 + ph) * 0.25; b.rotation.z = Math.sin(t * 0.7 + ph) * 0.05; }
    },
  };
}

// ---------- haunted ----------
function haunted() {
  const group = new THREE.Group(), R = rng(666), parts = [];
  for (let i = 0; i < 110; i++) {
    const [x, z] = ring(78 + R() * 110, R() * Math.PI * 2);
    const w = 1.6 + R() * 1.2, h = 2.2 + R() * 1.6;
    const stone = new THREE.BoxGeometry(w, h, 0.6).translate(0, h / 2, 0);
    const top = new THREE.CylinderGeometry(w / 2, w / 2, 0.6, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, h, 0);
    for (const g of [stone, top]) {
      g.rotateZ((R() - 0.5) * 0.25).rotateY(R() * Math.PI).translate(x, -0.3, z);
      parts.push(paint(g, R() < 0.5 ? '#6d6a75' : '#5b5863'));
    }
  }
  for (let i = 0; i < 46; i++) {
    const [x, z] = ring(80 + R() * 130, R() * Math.PI * 2);
    const h = 10 + R() * 12;
    parts.push(paint(new THREE.CylinderGeometry(0.35, 0.9, h, 6).translate(x, h / 2, z), '#241d29'));
    for (let b = 0; b < 5; b++) {
      const l = 3 + R() * 5, y = h * (0.45 + R() * 0.5), ang = R() * Math.PI * 2, tilt = 0.5 + R() * 0.7;
      const br = new THREE.CylinderGeometry(0.12, 0.3, l, 4).translate(0, l / 2, 0).rotateZ(-tilt).rotateY(ang).translate(x, y, z);
      parts.push(paint(br, '#241d29'));
    }
  }
  group.add(merged(parts, new THREE.MeshLambertMaterial({ vertexColors: true })));
  // Will-o'-wisps drifting over the stands.
  const tex = glowTexture();
  const wisps = [];
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: ['#9d7bff', '#5ef0ff', '#c58bff', '#7cffc4'][i % 4], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const a = R() * Math.PI * 2, r = 62 + R() * 30;
    s.userData = { a, r, y: 16 + R() * 20, ph: R() * 6.28, sp: (R() - 0.5) * 0.05 };
    s.scale.setScalar(3 + R() * 2.5);
    group.add(s); wisps.push(s);
  }
  return {
    group, ground: '#2b2633',
    update(t) {
      for (const s of wisps) {
        const u = s.userData, a = u.a + t * u.sp;
        const [x, z] = ring(u.r, a);
        s.position.set(x, u.y + Math.sin(t * 0.8 + u.ph) * 2.2, z);
        s.material.opacity = 0.55 + Math.sin(t * 3.1 + u.ph * 3) * 0.25;
      }
    },
  };
}

// ---------- dome ----------
function dome() {
  const group = new THREE.Group();
  // The roof: a shallow shell over the whole bowl, its inside a lattice of panels and trusses.
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2f38'; x.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 64; i++) { x.fillStyle = i % 2 ? '#323843' : '#2c313b'; x.fillRect(i * 16, 0, 16, 256); }
  x.strokeStyle = '#8b939f'; x.lineWidth = 2;
  for (let i = 0; i <= 32; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 256); x.stroke(); }
  for (let j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(0, j * 32); x.lineTo(1024, j * 32); x.stroke(); }
  x.strokeStyle = 'rgba(139,147,159,0.5)'; x.lineWidth = 1;
  for (let i = 0; i < 32; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.moveTo(i * 32, j * 32); x.lineTo(i * 32 + 32, j * 32 + 32); x.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(3, 1);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshLambertMaterial({ map: tex, side: THREE.BackSide, color: '#c9ced6' }));
  shell.scale.set(128, 44, 92); shell.position.set(CX, 16, 0);
  group.add(shell);
  // The ring of lights around the roof's rim, and a band of them around the crown.
  const lamp = new THREE.MeshBasicMaterial({ color: '#fffaf0' });
  const lights = [];
  for (const [rx, rz, y, n] of [[118, 84, 31, 72], [70, 50, 50, 40]]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 2.2), lamp);
      m.position.set(CX + Math.cos(a) * rx, y, Math.sin(a) * rz);
      lights.push(m);
    }
  }
  const lg = new THREE.Group(); lights.forEach((m) => lg.add(m)); group.add(lg);
  return { group, ground: '#3a3f47', roof: true, update() {} };
}

// ---------- the open bowl: farmland and a skyline on the horizon ----------
function classic() {
  const group = new THREE.Group(), R = rng(1234), parts = [];
  // Windows: a canvas of lit and dark panes, the lit ones glowing after dark.
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 64, 128);
  for (let j = 0; j < 32; j++) for (let i = 0; i < 8; i++) if (R() < 0.45) { x.fillStyle = R() < 0.8 ? '#ffe2a8' : '#bfe2ff'; x.fillRect(i * 8 + 2, j * 4 + 1, 4, 2); }
  const win = new THREE.CanvasTexture(c); win.colorSpace = THREE.SRGBColorSpace; win.wrapS = win.wrapT = THREE.RepeatWrapping;
  for (let i = 0; i < 70; i++) {
    const a = -0.9 + R() * 1.8 + (i % 2 ? Math.PI : 0);
    const [bx, bz] = ring(230 + R() * 70, a);
    const w = 10 + R() * 14, h = 18 + R() * (R() < 0.2 ? 90 : 45);
    const g = new THREE.BoxGeometry(w, h, w * (0.7 + R() * 0.6)).translate(bx, h / 2, bz);
    // Each building samples its own patch of windows.
    const uv = g.attributes.uv, u0 = R(), v0 = R();
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * w / 24, v0 + uv.getY(k) * h / 40);
    parts.push(paint(g, ['#5f6b7a', '#6b7380', '#4f5a68', '#7a828c'][i % 4]));
  }
  const city = merged(parts, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffffff', emissiveMap: win, emissiveIntensity: 0 }));
  group.add(city);
  group.add(pines(R, 70, 90, 200, '#2d4d33'));
  return { group, ground: null, update() {}, setNight(n) { city.material.emissiveIntensity = n * 0.9; } };
}

export function buildVenue(kind) {
  switch (kind) {
    case 'mountain': return mountain();
    case 'seaside': return seaside();
    case 'haunted': return haunted();
    case 'dome': return dome();
    default: return classic();
  }
}
