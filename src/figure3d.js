// Generated 3D figures, the fallback for the Pokémon that have no real model (model3d.js has
// the models; see README).
//
// The figure is built in the browser from the Pokémon's own Black/White pixel art: the front
// sprite's silhouette is "inflated" into a closed, rounded volume (each point bulges out by a
// circular profile of the local body thickness), the front of the body takes the front
// sprite's colors and the back takes the back sprite's colors. It is a lit mesh with volume
// that casts shadows and turns in world space, not a billboard.
//
// Each figure is auto-rigged with a small skeleton (hips, chest, head, two arms or wings, two
// legs) and skinned, so the animation layer in anim3d.js can drive it with blended poses.
import * as THREE from 'three';
import { SPRITES } from './sprites.js';
import { SPRITE_INDEX } from './sprites3d.js';
import { PLAYERS } from './ratings.js';
import { bodyOf, fitScale } from './body.js';

const DEPTH = 0.78; // front-to-back thickness relative to a round cross-section
export const BONES = ['root', 'hips', 'chest', 'head', 'armL', 'armR', 'legL', 'legR'];

// ---------- sprite pixels ----------
const imgCache = new Map();
function loadImage(uri) {
  let p = imgCache.get(uri);
  if (!p) {
    p = new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = uri; });
    imgCache.set(uri, p);
  }
  return p;
}

let scratch = null;
// First frame of an image (or of a horizontal strip), cropped to its opaque box.
function readFrame(img, frameW, frameH) {
  const w = frameW || img.naturalWidth, h = frameH || img.naturalHeight;
  scratch ??= document.createElement('canvas');
  scratch.width = w; scratch.height = h;
  const x = scratch.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 100) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j); }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Uint8ClampedArray(cw * ch * 4);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const s = ((j + y0) * w + i + x0) * 4, t = (j * cw + i) * 4;
    out[t] = d[s]; out[t + 1] = d[s + 1]; out[t + 2] = d[s + 2]; out[t + 3] = d[s + 3];
  }
  return { w: cw, h: ch, px: out };
}

// Fill every transparent pixel with the color of the nearest opaque one, so the back of the
// body can sample the back sprite anywhere inside the front silhouette.
function fillNearest(im) {
  const { w, h, px } = im, n = w * h;
  const out = new Uint8ClampedArray(px), seen = new Uint8Array(n), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let k = 0; k < n; k++) if (px[k * 4 + 3] > 100) { seen[k] = 1; q[tail++] = k; }
  while (head < tail) {
    const k = q[head++], i = k % w, j = (k / w) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= w || b >= h) continue;
      const m = b * w + a;
      if (seen[m]) continue;
      seen[m] = 1; out[m * 4] = out[k * 4]; out[m * 4 + 1] = out[k * 4 + 1]; out[m * 4 + 2] = out[k * 4 + 2]; out[m * 4 + 3] = 255;
      q[tail++] = m;
    }
  }
  return { w, h, px: out };
}

// ---------- inflation ----------
// Distance from each inside pixel to the outside (chamfer 1 / 1.414), then the local body
// thickness: the radius of the biggest inscribed disc covering each pixel.
function inflate(mask, w, h) {
  const n = w * h, INF = 1e9, d = new Float32Array(n);
  for (let k = 0; k < n; k++) d[k] = mask[k] ? INF : 0;
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : d[j * w + i]);
  const D = Math.SQRT2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + D, at(i + 1, j - 1) + D);
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + D, at(i - 1, j + 1) + D);
  }
  const R = new Float32Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const r = d[j * w + i]; if (!r) continue;
    const ri = Math.ceil(r - 0.5);
    for (let b = Math.max(0, j - ri); b <= Math.min(h - 1, j + ri); b++) for (let a = Math.max(0, i - ri); a <= Math.min(w - 1, i + ri); a++) {
      if ((a - i) * (a - i) + (b - j) * (b - j) <= r * r) { const m = b * w + a; if (R[m] < r) R[m] = r; }
    }
  }
  // Height of the surface above the middle plane: a circle of radius R, d in from the edge.
  const hgt = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!mask[k]) continue;
    const r = R[k] + 0.25, e = d[k] - 0.25;
    hgt[k] = Math.sqrt(Math.max(0, r * r - (r - e) * (r - e))) * DEPTH;
  }
  return hgt;
}

// ---------- rig ----------
// Where the legs split, the shoulders and the neck sit, read off the silhouette.
function analyse(mask, w, h) {
  const rowRuns = (j) => {
    const runs = []; let s = -1;
    for (let i = 0; i <= w; i++) {
      const on = i < w && mask[j * w + i];
      if (on && s < 0) s = i; else if (!on && s >= 0) { runs.push([s, i - 1]); s = -1; }
    }
    return runs;
  };
  let minX = w, maxX = 0;
  for (let k = 0; k < w * h; k++) if (mask[k]) { minX = Math.min(minX, k % w); maxX = Math.max(maxX, k % w); }
  const cx = (minX + maxX + 1) / 2;
  // Legs: rows from the bottom up while the silhouette is split in two around the middle.
  let legRows = 0, legL = [], legR = [];
  for (let j = h - 1; j >= h * 0.5; j--) {
    const runs = rowRuns(j).filter(([a, b]) => b - a >= 1);
    const left = runs.filter(([, b]) => b < cx), right = runs.filter(([a]) => a >= cx);
    if (!left.length || !right.length) break;
    legRows++;
    legL.push((left[0][0] + left[left.length - 1][1] + 1) / 2);
    legR.push((right[0][0] + right[right.length - 1][1] + 1) / 2);
  }
  const width = maxX - minX + 1, wide = width / h > 1.3;
  const legTop = Math.min(h * 0.42, Math.max(h * 0.16, legRows + 1)); // in pixels from the bottom
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const legX = legRows >= 2 ? Math.max(width * 0.1, (mean(legR) - mean(legL)) / 2) : width * 0.2;
  return { cx, width, wide, legTop, legX, shoulder: legTop + (h - legTop) * 0.52, neck: legTop + (h - legTop) * 0.7, armX: width * 0.3 };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Bone weights at a point (x right of center, y up from the feet), in pixels.
function weightsAt(A, h, x, y) {
  const W = A.width;
  const leg = 1 - smooth(A.legTop - h * 0.05, A.legTop + h * 0.04, y);
  const left = smooth(W * 0.05, -W * 0.05, x);
  const head = smooth(A.neck - h * 0.05, A.neck + h * 0.06, y);
  let arm = A.wide ? 0 : smooth(W * 0.22, W * 0.36, Math.abs(x)) * (1 - leg) * (1 - head * 0.7) * smooth(A.legTop, A.legTop + h * 0.08, y);
  if (A.flies) arm = smooth(W * 0.2, W * 0.34, Math.abs(x)) * (1 - leg) * smooth(A.legTop, A.legTop + h * 0.1, y);
  const w = { legL: leg * left, legR: leg * (1 - left), armL: arm * left, armR: arm * (1 - left) };
  const rest = Math.max(0, 1 - w.legL - w.legR - w.armL - w.armR);
  w.head = rest * head;
  const torso = rest - w.head;
  const up = smooth(A.legTop, A.shoulder, y);
  w.chest = torso * up; w.hips = torso * (1 - up);
  return w;
}

// ---------- geometry ----------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

function buildGeometry(front, back, A) {
  const { w, h, px } = front;
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) mask[k] = px[k * 4 + 3] > 100 ? 1 : 0;
  const hgt = inflate(mask, w, h);
  // Corner heights, shared by neighbouring pixels so the surface has no cracks; zero on
  // the silhouette so the front and back shells meet in one seam.
  const CW = w + 1, ch = new Float32Array(CW * (h + 1));
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
    let s = 0, inside = true;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
      if (a < 0 || b < 0 || a >= w || b >= h || !mask[b * w + a]) { inside = false; break; }
      s += hgt[b * w + a];
    }
    ch[j * CW + i] = inside ? s / 4 : 0;
  }
  const H = (i, j) => (i < 0 || j < 0 || i > w || j > h ? 0 : ch[j * CW + i]);
  const bk = back ? fillNearest(back) : null;
  let count = 0;
  for (let k = 0; k < w * h; k++) count += mask[k];
  const pos = new Float32Array(count * 8 * 3), nor = new Float32Array(count * 8 * 3), col = new Float32Array(count * 8 * 3);
  const si = new Uint16Array(count * 8 * 4), sw = new Float32Array(count * 8 * 4);
  const idx = new Uint32Array(count * 12);
  const boneIx = Object.fromEntries(BONES.map((b, i) => [b, i]));
  const cornerSkin = new Map();
  const skinAt = (i, j) => {
    const key = j * CW + i;
    let s = cornerSkin.get(key);
    if (!s) {
      const wt = weightsAt(A, h, i - A.cx, h - j);
      const top = Object.entries(wt).filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((t, [, v]) => t + v, 0) || 1;
      s = top.map(([b, v]) => [boneIx[b], v / sum]);
      cornerSkin.set(key, s);
    }
    return s;
  };
  let v = 0, t = 0;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (!mask[k]) continue;
    const fr = lin(px[k * 4]), fg = lin(px[k * 4 + 1]), fb = lin(px[k * 4 + 2]);
    let br = fr * 0.8, bg = fg * 0.8, bb = fb * 0.8;
    if (bk) {
      // The back sprite seen from behind: mirror across, match the boxes.
      const u = 1 - (i + 0.5) / w, vv = (j + 0.5) / h;
      const a = Math.min(bk.w - 1, Math.floor(u * bk.w)), b = Math.min(bk.h - 1, Math.floor(vv * bk.h));
      const m = (b * bk.w + a) * 4;
      br = lin(bk.px[m]); bg = lin(bk.px[m + 1]); bb = lin(bk.px[m + 2]);
    }
    for (const side of [1, -1]) {
      const base = v;
      for (const [di, dj] of corners) {
        const ci = i + di, cj = j + dj;
        const z = H(ci, cj) * side;
        const gx = (H(ci + 1, cj) - H(ci - 1, cj)) / 2, gy = (H(ci, cj + 1) - H(ci, cj - 1)) / 2;
        // x right, y up (rows go down), z toward the front
        let nx = -gx * side, ny = gy * side, nz = side;
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        pos[v * 3] = ci - A.cx; pos[v * 3 + 1] = h - cj; pos[v * 3 + 2] = z;
        nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
        if (side > 0) { col[v * 3] = fr; col[v * 3 + 1] = fg; col[v * 3 + 2] = fb; } else { col[v * 3] = br; col[v * 3 + 1] = bg; col[v * 3 + 2] = bb; }
        const s = skinAt(ci, cj);
        for (let q = 0; q < 4; q++) { si[v * 4 + q] = s[q]?.[0] ?? 0; sw[v * 4 + q] = s[q]?.[1] ?? 0; }
        v++;
      }
      // Rows run down the image, so (0,0) (1,0) (1,1) is clockwise seen from the front.
      if (side > 0) { idx.set([base, base + 2, base + 1, base, base + 3, base + 2], t); } else { idx.set([base, base + 1, base + 2, base, base + 2, base + 3], t); }
      t += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  let maxZ = 0;
  for (let k = 0; k < ch.length; k++) maxZ = Math.max(maxZ, ch[k]);
  return { geometry: g, maxZ };
}

// ---------- species templates ----------
// One built template per species (geometry, rig layout and scale); every player on the field
// gets its own skeleton bound to the shared geometry.
const templates = new Map();

export function flies(id) {
  const P = PLAYERS[id];
  return P.types.includes('Flying') || P.ability === 'Levitate';
}

// The template for a species: { ready, geometry, rig, scale, height, width, depth, version }.
// Starts from the bundled menu still (front only) and rebuilds once the animated strip's
// back view has loaded, bumping `version`.
export function template(id) {
  let T = templates.get(id);
  if (!T) {
    T = { id, ready: false, version: 0, building: false, hasBack: false };
    templates.set(id, T);
    build(T, false);
  }
  return T;
}

export function upgradeTemplate(id, strip) {
  const T = template(id);
  if (T.hasBack || T.upgrading || !strip) return;
  T.upgrading = true;
  build(T, strip);
}

async function build(T, strip) {
  const id = T.id;
  try {
    const idx = SPRITE_INDEX[id];
    let front, back = null;
    if (strip) {
      const [fi, bi] = await Promise.all([loadImage(strip[0]), loadImage(strip[1])]);
      front = readFrame(fi, idx[1], idx[2]);
      back = readFrame(bi, idx[3], idx[4]);
    } else {
      front = readFrame(await loadImage(SPRITES[id]));
    }
    if (!front) return;
    // Big sprites are halved so every figure stays a few thousand pixels.
    if (front.w * front.h > 7000) { front = halve(front); if (back) back = halve(back); }
    const mask = new Uint8Array(front.w * front.h);
    for (let k = 0; k < mask.length; k++) mask[k] = front.px[k * 4 + 3] > 100 ? 1 : 0;
    const A = analyse(mask, front.w, front.h);
    A.flies = flies(id);
    const { geometry, maxZ } = buildGeometry(front, back, A);
    const B = bodyOf(id);
    // Species height in yards, then shrunk if needed so the body fits its footprint.
    const s = fitScale(B, A.width, front.h, maxZ * 2);
    const old = T.geometry;
    Object.assign(T, {
      ready: true, geometry, rig: A, px: front.h, scale: s, height: front.h * s, width: A.width * s, depth: maxZ * 2 * s,
      hasBack: !!back, version: T.version + 1,
    });
    if (old) setTimeout(() => old.dispose(), 2000);
  } catch (e) {
    // A sprite that fails to decode leaves the placeholder up.
    console.warn('figure', id, e);
  } finally { T.upgrading = false; }
}

function halve(im) {
  const w = Math.ceil(im.w / 2), h = Math.ceil(im.h / 2), out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    // Keep the most opaque of the four, so thin outlines survive.
    let best = -1, bi = 0;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = i * 2 + a, y = j * 2 + b;
      if (x >= im.w || y >= im.h) continue;
      const k = (y * im.w + x) * 4;
      const al = im.px[k + 3] + (a === 0 && b === 0 ? 1 : 0);
      if (al > best) { best = al; bi = k; }
    }
    out.set(im.px.subarray(bi, bi + 4), (j * w + i) * 4);
  }
  return { w, h, px: out };
}

// ---------- per-player figure ----------
const FIG_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });

// A skinned instance of a template: a Group (scaled to yards) holding the bones and mesh.
// Bones are in sprite pixels, laid out from the template's rig analysis.
export function makeFigure(T) {
  const A = T.rig, h = T.px;
  const bones = {};
  for (const n of BONES) { bones[n] = new THREE.Bone(); bones[n].name = n; }
  const P = (b, x, y, z = 0) => bones[b].position.set(x, y, z);
  // Bone positions are relative to the parent.
  P('root', 0, 0);
  P('hips', 0, A.legTop);
  P('chest', 0, A.shoulder - A.legTop);
  P('head', 0, A.neck - A.shoulder);
  P('armL', -A.armX, 0); P('armR', A.armX, 0);
  P('legL', -A.legX, 0); P('legR', A.legX, 0);
  bones.root.add(bones.hips);
  bones.hips.add(bones.chest, bones.legL, bones.legR);
  bones.chest.add(bones.head, bones.armL, bones.armR);
  const mesh = new THREE.SkinnedMesh(T.geometry, FIG_MAT);
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Poses can swing limbs past the bind-pose bounds.
  mesh.frustumCulled = false;
  const g = new THREE.Group();
  g.add(mesh);
  g.scale.setScalar(T.scale);
  void h;
  return { group: g, mesh, bones, version: T.version, template: T };
}

export function disposeFigure(f) {
  f.mesh.skeleton.dispose();
  f.group.removeFromParent();
}

// Placeholder while a species' sprite decodes: a neutral capsule, clearly not a Pokémon.
const PH_GEO = new THREE.CapsuleGeometry(0.32, 0.7, 4, 10).translate(0, 0.67, 0);
const PH_MAT = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.8, transparent: true, opacity: 0.55 });
export function placeholder() { const m = new THREE.Mesh(PH_GEO, PH_MAT); m.castShadow = true; return m; }
