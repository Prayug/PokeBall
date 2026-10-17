// Skeletons for the models that come without one.
//
// A third of the 3D models (Snorlax, Hypno, Hitmonlee, Ursaring, Throh, ...) are bare meshes:
// nothing to bend, so they stood in one pose all game, many of them in the T-pose they were
// modelled in. This builds each of them a skeleton from the shape of the mesh and skins the
// mesh to it, so model3d.js animates them like any rigged model (it recognizes the bones by
// name: LThigh, LArm, Spine, Head, Tail1, ...).
//
// The shape is read from the vertices, in horizontal slices from the feet up:
//   legs     the slices near the ground where the body splits in two to the sides (and, for
//            a four-legged body, front to back as well), up to where it joins
//   arms     a band of slices much wider than the torso around it (arms held out, or the
//            T-pose), from the shoulder out; a flying species' band is its wings
//   neck     the narrowest slice between the shoulders and the top of the head, if the body
//            narrows there at all (otherwise the top quarter is the head)
//   tail     whatever reaches well behind the body's core
// and each vertex is weighted to the bones by smooth falloffs between those regions, so the
// joints bend instead of tearing.
import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.floor(f * (a.length - 1))))];

// Floats: the exports quantize positions to 16 bits, which cannot hold a baked transform.
function floatAttr(a, size) {
  const out = new Float32Array(a.count * size);
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = get[c].call(a, i);
  return new THREE.BufferAttribute(out, size);
}

// The body plan from the vertices (model space): see the top of the file.
export function analyse(P, flying) {
  const n = P.length / 3;
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < n; i++) { xs.push(P[i * 3]); ys.push(P[i * 3 + 1]); zs.push(P[i * 3 + 2]); }
  for (const a of [xs, ys, zs]) a.sort((m, k) => m - k);
  const y0 = ys[0], H = Math.max(1e-6, q(ys, 0.995) - y0);
  const cx = (q(xs, 0.1) + q(xs, 0.9)) / 2, cz = (q(zs, 0.1) + q(zs, 0.9)) / 2;
  const W = q(xs, 0.99) - q(xs, 0.01), D = q(zs, 0.99) - q(zs, 0.01);
  const coreBack = cz - q(zs, 0.12), coreFront = q(zs, 0.88) - cz;
  // Slices.
  const NS = 40, sl = Array.from({ length: NS }, () => ({ dx: [], dz: [] }));
  for (let i = 0; i < n; i++) {
    const k = Math.min(NS - 1, Math.max(0, Math.floor(((P[i * 3 + 1] - y0) / H) * NS)));
    sl[k].dx.push(P[i * 3] - cx); sl[k].dz.push(P[i * 3 + 2] - cz);
  }
  const hw = sl.map((s) => { if (s.dx.length < 3) return 0; const a = s.dx.map(Math.abs).sort((m, k) => m - k); return q(a, 0.97); });
  // Split to the sides: points on both sides, (almost) none in a band around the middle.
  const splitX = (s, gap) => { if (s.dx.length < 6) return false; let l = 0, r = 0, mid = 0; for (const d of s.dx) { if (Math.abs(d) < gap) mid++; else if (d > 0) l++; else r++; } return mid <= s.dx.length * 0.01 && l > 2 && r > 2; };
  const splitZ = (s, gap) => { if (s.dz.length < 6) return false; let f = 0, b = 0, mid = 0; for (const d of s.dz) { if (Math.abs(d) < gap) mid++; else if (d > 0) f++; else b++; } return mid <= s.dz.length * 0.03 && f > 2 && b > 2; };
  let legK = 0;
  while (legK < NS * 0.5 && splitX(sl[legK], H * 0.008)) legK++;
  // Four legs whose left and right stand close together (or a mane hangs between them):
  // the ground slices still split front to back.
  let zOnly = false;
  if (legK < NS * 0.04 && D > H * 0.9) {
    let k = 0;
    while (k < NS * 0.5 && splitZ(sl[k], D * 0.05)) k++;
    if (k >= NS * 0.08) { legK = k; zOnly = true; }
  }
  let legTop = (legK / NS) * H;
  const legs = legTop >= H * 0.04;
  // Four legs: the leg slices split front to back too, and the body is longer than tall.
  let quad = zOnly;
  if (legs && !zOnly) {
    let zk = 0;
    for (let k = 0; k < legK; k++) if (splitZ(sl[k], D * 0.08)) zk++;
    quad = zk >= legK * 0.6 && D > H * 0.75;
  }
  if (!legs) legTop = H * 0.3;
  // Torso width: a low percentile of the slice widths above the legs, so arms held out and
  // the T-pose do not count.
  const torsoK = []; for (let k = Math.ceil(legTop / H * NS); k < NS * 0.92; k++) if (hw[k] > 0) torsoK.push(hw[k]);
  torsoK.sort((m, k) => m - k);
  const wT = Math.max(H * 0.04, q(torsoK, 0.3) || W * 0.3);
  // Arms (or wings): the widest run of slices well wider than the torso, above the legs.
  let arm = null;
  if (!quad) {
    let best = null, cur = null;
    for (let k = Math.ceil((legTop / H + 0.08) * NS); k < NS * 0.94; k++) {
      if (hw[k] > wT * 1.45) { if (!cur) cur = { a: k, b: k, reach: 0, sum: 0, wy: 0 }; cur.b = k; cur.reach = Math.max(cur.reach, hw[k]); cur.sum += hw[k] - wT; cur.wy += (hw[k] - wT) * k; }
      else if (cur) { if (!best || cur.reach > best.reach) best = cur; cur = null; }
    }
    if (cur && (!best || cur.reach > best.reach)) best = cur;
    if (best && best.reach > wT * 1.7) {
      const ky = best.wy / best.sum;
      arm = { y: y0 + ((ky + 0.5) / NS) * H, half: Math.max(H * 0.06, ((best.b - best.a + 1) / NS) * H * 0.5), reach: best.reach, wing: flying };
    }
  }
  // The neck: the narrowest slice between the shoulders and the top, if it is clearly narrower.
  const kFrom = Math.ceil(Math.max(legTop / H + 0.15, arm ? (arm.y - y0) / H + 0.03 : 0.45) * NS), kTo = Math.floor(NS * 0.9);
  let neckY = y0 + H * 0.72;
  if (kFrom < kTo) {
    let kMin = -1, wMin = Infinity;
    for (let k = kFrom; k <= kTo; k++) if (hw[k] > 0 && hw[k] < wMin) { wMin = hw[k]; kMin = k; }
    const below = hw.slice(Math.ceil(legTop / H * NS), kMin).filter((w) => w > 0);
    const above = hw.slice(kMin + 1, NS).filter((w) => w > 0);
    if (kMin > 0 && below.length && above.length && wMin < Math.max(...below) * 0.8 && wMin < Math.max(...above) * 0.85) neckY = y0 + ((kMin + 0.5) / NS) * H;
    else if (arm) neckY = Math.max(neckY, arm.y + arm.half);
  }
  // Leg spacing and the knees.
  let legX = wT * 0.5;
  if (legs) {
    const a = []; for (let k = 0; k < legK; k++) for (const d of sl[k].dx) a.push(Math.abs(d));
    a.sort((m, k) => m - k); legX = Math.max(wT * 0.2, q(a, 0.5));
  }
  let frontZ = coreFront * 0.6, backZ = -coreBack * 0.6;
  if (quad) {
    const f = [], b = []; for (let k = 0; k < legK; k++) for (const d of sl[k].dz) (d > 0 ? f : b).push(d);
    f.sort((m, k) => m - k); b.sort((m, k) => m - k);
    if (f.length) frontZ = q(f, 0.5); if (b.length) backZ = q(b, 0.5);
  }
  // A tail: enough of the mesh well behind the core, off the ground.
  let tail = null;
  {
    let cnt = 0, far = 0;
    for (let i = 0; i < n; i++) { const dz = P[i * 3 + 2] - cz, y = P[i * 3 + 1] - y0; if (dz < -Math.max(coreBack * 1.5, H * 0.12) && y > legTop * 0.5) { cnt++; far = Math.min(far, dz); } }
    if (cnt > n * 0.02 && -far > Math.max(coreBack * 2, H * 0.25)) tail = { z0: -coreBack * 1.05, z1: far, y: y0 + Math.max(legTop, H * 0.3) };
  }
  return { y0, H, cx, cz, W, D, legs, quad, legTop: y0 + legTop, legX, frontZ, backZ, wT, arm, neckY, tail };
}

// A serpent's weights: shared between the two joints the point lies between, along the body.
function serpentWeights(A, x, y, z) {
  const N = A.joints.length, names = serpentNames(N);
  const f = Math.min(N - 1, Math.max(0, ((new THREE.Vector3(x, y, z).sub(A.m).dot(A.ax) - A.t0) / A.L) * N - 0.5));
  const j = Math.min(N - 2, Math.floor(f)), u = f - j;
  return { [names[j]]: 1 - u, [names[j + 1]]: u };
}

// Per-vertex bone weights (unnormalized), for a point at (x, y, z) in model space.
function weightsAt(A, x, y, z) {
  const dx = x - A.cx, dz = z - A.cz, H = A.H, s = dx >= 0 ? 'L' : 'R';
  const w = {};
  let rest = 1;
  if (A.legs) {
    const leg = 1 - smooth(A.legTop - H * 0.05, A.legTop + H * 0.03, y);
    if (leg > 0) {
      const side = smooth(-A.legX * 0.25, A.legX * 0.25, dx);
      const knee = A.y0 + (A.legTop - A.y0) * 0.5, low = 1 - smooth(knee - H * 0.04, knee + H * 0.04, y);
      const front = A.quad ? smooth(A.backZ * 0.15, A.frontZ * 0.15, dz) : 0;
      const parts = A.quad ? [['', 1 - front], ['F', front]] : [['', 1]];
      for (const [fk, fw] of parts) {
        if (fw <= 0) continue;
        for (const [sk, sw] of [['L', side], ['R', 1 - side]]) {
          const v = leg * fw * sw;
          if (v <= 0) continue;
          const up = fk ? `${sk}Arm` : `${sk}Thigh`, dn = fk ? `${sk}ForeArm` : `${sk}Leg`;
          w[up] = (w[up] ?? 0) + v * (1 - low); w[dn] = (w[dn] ?? 0) + v * low;
        }
      }
      rest -= leg;
    }
  }
  if (A.arm && rest > 0) {
    const a = A.arm;
    // A band around the shoulder height that widens out along the arm (arms held a little up
    // or down from level).
    const along = Math.max(0, Math.abs(dx) - A.wT), half = a.half + along * 0.35;
    const band = 1 - smooth(half * 0.9, half * 1.6, Math.abs(y - a.y));
    const out = smooth(A.wT * 0.8, A.wT * 1.1, Math.abs(dx));
    const v = band * out * rest;
    if (v > 0) {
      const elbow = A.wT + (a.reach - A.wT) * 0.5, far = smooth(elbow - A.H * 0.03, elbow + A.H * 0.03, Math.abs(dx));
      const up = a.wing ? `${s}Wing` : `${s}Arm`, dn = a.wing ? `${s}Wing2` : `${s}ForeArm`;
      w[up] = v * (1 - far); w[dn] = v * far;
      rest -= v;
    }
  }
  if (A.tail && rest > 0) {
    const t = smooth(A.tail.z0 * 0.9, A.tail.z0 * 1.2, dz) * smooth(A.y0 + A.H * 0.05, A.y0 + A.H * 0.2, y);
    const v = t * rest;
    if (v > 0) {
      const mid = (A.tail.z0 + A.tail.z1) / 2, far = smooth(mid * 0.85, mid * 1.15, dz);
      w.Tail1 = v * (1 - far); w.Tail2 = v * far;
      rest -= v;
    }
  }
  if (rest > 0) {
    const head = smooth(A.neckY - A.H * 0.035, A.neckY + A.H * 0.045, y);
    w.Head = rest * head;
    const torso = rest * (1 - head), chest = smooth(A.legTop, A.legTop + (A.neckY - A.legTop) * 0.6, y);
    w.Spine = torso * chest; w.Hips = torso * (1 - chest);
  }
  return w;
}

// Build the skeleton and skin every visible mesh of the scene to it. Returns the analysis,
// or null when there is nothing to rig.
// A long tube of a body with no legs or arms (Steelix, Milotic, Huntail): a chain of bones
// down its middle, head end first, so it can coil and sway. null when the body is not one.
// eyes: centroid of the eye meshes, if any, to tell the head end from the tail.
function serpent(P, eyes) {
  const n = P.length / 3, m = new THREE.Vector3();
  for (let i = 0; i < n; i++) m.x += P[i * 3], m.y += P[i * 3 + 1], m.z += P[i * 3 + 2];
  m.divideScalar(n);
  // Principal axis, by power iteration on the covariance.
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = [P[i * 3] - m.x, P[i * 3 + 1] - m.y, P[i * 3 + 2] - m.z];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += d[r] * d[c];
  }
  let ax = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (let k = 0; k < 40; k++) {
    ax = new THREE.Vector3(C[0] * ax.x + C[1] * ax.y + C[2] * ax.z, C[3] * ax.x + C[4] * ax.y + C[5] * ax.z, C[6] * ax.x + C[7] * ax.y + C[8] * ax.z).normalize();
  }
  const v = new THREE.Vector3(), ts = [], rs = [];
  for (let i = 0; i < n; i++) { v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).sub(m); const t = v.dot(ax); ts.push(t); rs.push(v.addScaledVector(ax, -t).length()); }
  const st = [...ts].sort((a, b) => a - b), sr = [...rs].sort((a, b) => a - b);
  const t0 = q(st, 0.01), t1 = q(st, 0.99), L = t1 - t0, thick = 2 * q(sr, 0.5);
  if (!(L > thick * 6)) return null;
  // The centerline: the middle of each slice along the axis.
  const N = 16, sum = Array.from({ length: N }, () => [0, 0, 0, 0]), rad = Array.from({ length: N }, () => []);
  for (let i = 0; i < n; i++) {
    const k = Math.min(N - 1, Math.max(0, Math.floor(((ts[i] - t0) / L) * N)));
    sum[k][0] += P[i * 3]; sum[k][1] += P[i * 3 + 1]; sum[k][2] += P[i * 3 + 2]; sum[k][3]++; rad[k].push(rs[i]);
  }
  let joints = sum.map((c, k) => (c[3] ? new THREE.Vector3(c[0], c[1], c[2]).divideScalar(c[3]) : m.clone().addScaledVector(ax, t0 + ((k + 0.5) / N) * L)));
  // Head end: by the eyes, else the top of a standing body, else the thicker end.
  const endR = (ks) => ks.reduce((t, k) => t + (rad[k].length ? rad[k].reduce((a, b) => a + b, 0) / rad[k].length : 0), 0);
  let headFirst;
  if (eyes) headFirst = eyes.distanceTo(joints[0]) < eyes.distanceTo(joints[N - 1]);
  else if (Math.abs(ax.y) > 0.6) headFirst = joints[0].y > joints[N - 1].y;
  else headFirst = endR([0, 1, 2]) > endR([N - 3, N - 2, N - 1]);
  if (!headFirst) { joints = joints.reverse(); ax.negate(); }
  return { serpent: true, joints, ax, t0: headFirst ? t0 : -t1, L, m, thick };
}

// The bone names of a serpent chain, head end first: the middle joint is the root.
function serpentNames(N) {
  const mid = N >> 1;
  return Array.from({ length: N }, (_, i) => (i === 0 ? 'Head' : i === 1 ? 'Neck' : i < mid ? `Spine${mid - i}` : i === mid ? 'Hips' : `Tail${i - mid}`));
}

export function autoRig(scene, flying) {
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.visible) meshes.push(o); });
  if (!meshes.length) return null;
  // Every vertex in model space (baked), for the analysis and the weights.
  const baked = meshes.map((o) => {
    const g = o.geometry.clone();
    for (const k of ['position', 'normal']) if (g.attributes[k]) g.setAttribute(k, floatAttr(g.attributes[k], 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && g.attributes[k].isInterleavedBufferAttribute) g.setAttribute(k, floatAttr(g.attributes[k], g.attributes[k].itemSize));
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    return g;
  });
  // Points spread over the surface by area (low-poly legs have vertices only at the ends).
  let area = 0;
  const tri = (g, f) => {
    const p = g.attributes.position.array, ix = g.index?.array, nt = ix ? ix.length / 3 : p.length / 9;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < nt; t++) {
      const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2;
      a.fromArray(p, i0 * 3); b.fromArray(p, i1 * 3); c.fromArray(p, i2 * 3);
      f(a, b, c, b.clone().sub(a).cross(c.clone().sub(a)).length() / 2);
    }
  };
  for (const g of baked) tri(g, (a, b, c, ar) => { area += ar; });
  const sample = [], per = 16000 / Math.max(1e-12, area);
  let carry = 0, seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const g of baked) tri(g, (a, b, c, ar) => {
    carry += ar * per;
    for (; carry >= 1; carry--) {
      let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
      sample.push(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v);
    }
  });
  let A = analyse(sample, flying);
  if (!A.legs) {
    // The eyes (by material name) mark the head end of a long body.
    const e = new THREE.Vector3(); let ne = 0;
    meshes.forEach((o, k) => {
      if (![].concat(o.material).some((mt) => /eye/i.test(mt.name))) return;
      const p = baked[k].attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { e.x += p[i]; e.y += p[i + 1]; e.z += p[i + 2]; ne++; }
    });
    const S = serpent(sample, ne ? e.divideScalar(ne) : null);
    if (globalThis.DBG) console.log("serpent?", !!S, S && S.L / S.thick);
    if (S) A = S;
  }
  // Bones, placed in model space.
  const bones = {}, add = (name, parent, x, y, z) => {
    const b = new THREE.Bone(); b.name = name;
    const pp = parent ? bones[parent].userData.at : new THREE.Vector3();
    b.position.set(x - pp.x, y - pp.y, z - pp.z);
    b.userData.at = new THREE.Vector3(x, y, z);
    if (parent) bones[parent].add(b);
    bones[name] = b;
  };
  if (A.serpent) {
    const J = A.joints, N = J.length, mid = N >> 1, names = serpentNames(N);
    add('Hips', null, J[mid].x, J[mid].y, J[mid].z);
    for (let i = mid - 1; i >= 0; i--) add(names[i], names[i + 1], J[i].x, J[i].y, J[i].z);
    for (let i = mid + 1; i < N; i++) add(names[i], names[i - 1], J[i].x, J[i].y, J[i].z);
  } else {
  const { cx, cz, H } = A, chestY = A.legTop + (A.neckY - A.legTop) * 0.6;
  add('Hips', null, cx, A.legTop, cz);
  add('Spine', 'Hips', cx, chestY, cz);
  add('Head', 'Spine', cx, A.neckY, cz);
  if (A.legs) {
    const knee = A.y0 + (A.legTop - A.y0) * 0.5;
    for (const s of ['L', 'R']) {
      const x = cx + (s === 'L' ? 1 : -1) * A.legX;
      add(`${s}Thigh`, 'Hips', x, A.legTop, cz + (A.quad ? A.backZ : 0));
      add(`${s}Leg`, `${s}Thigh`, x, knee, cz + (A.quad ? A.backZ : 0));
      if (A.quad) {
        add(`${s}Arm`, 'Spine', x, A.legTop, cz + A.frontZ);
        add(`${s}ForeArm`, `${s}Arm`, x, knee, cz + A.frontZ);
      }
    }
  }
  if (A.arm) {
    const elbow = A.wT + (A.arm.reach - A.wT) * 0.5;
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1, up = A.arm.wing ? `${s}Wing` : `${s}Arm`, dn = A.arm.wing ? `${s}Wing2` : `${s}ForeArm`;
      add(up, 'Spine', cx + sg * A.wT * 0.9, A.arm.y, cz);
      add(dn, up, cx + sg * elbow, A.arm.y, cz);
      // The tip: hangArms aims the upper arm along its first child.
      add(A.arm.wing ? `${s}WingTip` : `${s}Hand`, dn, cx + sg * A.arm.reach, A.arm.y, cz);
    }
  }
  if (A.tail) {
    add('Tail1', 'Hips', cx, A.tail.y, cz + A.tail.z0);
    add('Tail2', 'Tail1', cx, A.tail.y, cz + (A.tail.z0 + A.tail.z1) / 2);
  }
  }
  const list = Object.values(bones), index = new Map(list.map((b, i) => [b.name, i]));
  const root = bones.Hips;
  scene.add(root);
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  meshes.forEach((o, k) => {
    const g = baked[k], p = g.attributes.position.array, n = p.length / 3;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const w = A.serpent ? serpentWeights(A, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) : weightsAt(A, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      const top = Object.entries(w).filter(([b, v]) => v > 1e-4 && index.has(b)).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((t, [, v]) => t + v, 0) || 1;
      if (!top.length) top.push(['Spine', 1]);
      top.forEach(([b, v], c) => { si[i * 4 + c] = index.get(b); sw[i * 4 + c] = v / sum; });
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const sm = new THREE.SkinnedMesh(g, o.material);
    sm.name = o.name;
    scene.add(sm);
    sm.bind(skeleton, new THREE.Matrix4());
    o.visible = false;
  });
  return A;
}

// ---------- long bodies ----------
// Serpents exported straight (Rayquaza lying 23 yards long, Arbok and Seviper standing like
// poles, Steelix and Milotic as bare meshes) are bent into a resting coil: the back of the
// body spirals flat on the ground and the front rises out of it, curving forward so the head
// looks up the field. The body's own chain of bones (spine, neck, tail; built along the body
// for bare meshes) is aimed joint by joint along that curve.

const AXIAL = /spine|tail|neck|head|waist|hips?(_|\d|$)|body|chest|pelvis/i;
const NOT_AXIAL = /feeler|fin|jaw|hair|eye|mouth|tongue|horn|arm|leg|hand|foot|wing|end|eff|skin|mesh/i;

// The longest run of axial bones through the skeleton, ordered head end first.
function axialChain(scene) {
  const bones = [];
  scene.traverse((o) => { if (o.isBone && AXIAL.test(o.name) && !NOT_AXIAL.test(o.name)) bones.push(o); });
  if (bones.length < 6) return null;
  const set = new Set(bones), pos = new Map(bones.map((b) => [b, new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)]));
  // Undirected tree among axial bones (a bone's nearest axial ancestor counts as its parent).
  const nb = new Map(bones.map((b) => [b, []])), tops = [];
  for (const b of bones) {
    let p = b.parent;
    while (p && !set.has(p)) p = p.parent;
    if (p) { nb.get(b).push(p); nb.get(p).push(b); } else tops.push(b);
  }
  // Chains with no axial ancestor (Arbok's spine and tail, both children of the armature)
  // join where they meet: siblings under one parent.
  for (let i = 1; i < tops.length; i++) {
    const j = tops.findIndex((t) => t.parent === tops[i].parent);
    if (j < i) { nb.get(tops[i]).push(tops[j]); nb.get(tops[j]).push(tops[i]); }
  }
  const far = (start) => {
    const dist = new Map([[start, 0]]), prev = new Map(), stack = [start];
    while (stack.length) {
      const b = stack.pop();
      for (const c of nb.get(b)) if (!dist.has(c)) { dist.set(c, dist.get(b) + pos.get(b).distanceTo(pos.get(c))); prev.set(c, b); stack.push(c); }
    }
    let best = start; for (const [b, d] of dist) if (d > dist.get(best)) best = b;
    return { best, dist, prev };
  };
  const a = far(bones[0]).best, r = far(a), path = [];
  for (let b = r.best; b; b = r.prev.get(b)) path.push(b);
  if (path.length < 6) return null;
  // Head end first: the end nearer a bone named head.
  const head = bones.find((b) => /head/i.test(b.name));
  if (head && pos.get(head).distanceTo(pos.get(path[0])) > pos.get(head).distanceTo(pos.get(path[path.length - 1]))) path.reverse();
  return { path, pos: path.map((b) => pos.get(b).clone()) };
}

// Is the chain long and straight enough to coil? thickness: the body's girth around it.
function needsCoil(chain, pts) {
  const P = chain.pos, n = P.length;
  let L = 0; for (let i = 1; i < n; i++) L += P[i].distanceTo(P[i - 1]);
  const straight = P[0].distanceTo(P[n - 1]) / Math.max(1e-9, L);
  // Girth: twice the median distance of the vertices from the chain's straight line.
  const a = P[0], d = P[n - 1].clone().sub(a).normalize(), v = new THREE.Vector3(), ds = [];
  for (let i = 0; i < pts.length; i += 3) { v.set(pts[i], pts[i + 1], pts[i + 2]).sub(a); ds.push(v.addScaledVector(d, -v.dot(d)).length()); }
  ds.sort((m, k) => m - k);
  const thick = Math.max(L * 0.02, 2 * q(ds, 0.5));
  return { L, thick, ok: straight > 0.8 && L > thick * 5.5 };
}

// The resting coil as a function of arc length from the head (s = 0) to the tail tip (s = L).
function coilCurve(L, thick) {
  const rise = Math.min(L * 0.4, thick * 6), Lc = L - rise;
  const k = (thick * 1.1) / (Math.PI * 2), rIn = thick * 0.6;
  const R = Math.sqrt(2 * k * Lc + rIn * rIn);
  const y0 = thick * 0.5;
  // The coil: from its front (0, y0, 0), around a center behind it, winding inward.
  const ctr = new THREE.Vector3(0, y0, -R);
  const coil = (s) => {
    // Arc length to angle along r = R - k*phi: s = R*phi - k*phi^2/2.
    const phi = (R - Math.sqrt(Math.max(0, R * R - 2 * k * s))) / k, r = R - k * phi;
    return new THREE.Vector3(Math.sin(phi) * r, y0, Math.cos(phi) * r).add(ctr);
  };
  // The rise: from the coil's front, up and curving forward to the head, sampled finely.
  const N = 48, risePts = [new THREE.Vector3(0, y0, 0)];
  for (let i = 1; i <= N; i++) {
    const u = (i - 0.5) / N, th = (Math.PI / 2) * Math.pow(u, 1.4), ds = rise / N;
    risePts.push(risePts[i - 1].clone().add(new THREE.Vector3(0, Math.cos(th) * ds, Math.sin(th) * ds)));
  }
  return (s) => {
    if (s >= rise) return coil(s - rise);
    const f = ((rise - s) / rise) * N, i = Math.min(N - 1, Math.floor(f));
    return risePts[i].clone().lerp(risePts[i + 1], f - i);
  };
}

// Bend the chain onto the curve: each bone is turned so the next joint lies where the curve
// puts it, working out from the skeleton's root so every joint is placed on a settled parent.
function bendChain(scene, chain, curve) {
  const { path, pos } = chain, n = path.length;
  const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + pos[i].distanceTo(pos[i - 1]));
  const target = s.map((x) => curve(x));
  // The joint nearest the root of the hierarchy: work outward from it in both directions.
  let root = 0, depth = Infinity;
  path.forEach((b, i) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; if (d < depth) { depth = d; root = i; } });
  // Put a joint on its spot (move the bone in its parent's frame).
  const place = (i) => {
    scene.updateMatrixWorld(true);
    const rb = path[i], shift = target[i].clone().sub(new THREE.Vector3().setFromMatrixPosition(rb.matrixWorld));
    if (!rb.parent) return;
    const pq = new THREE.Quaternion(); rb.parent.getWorldQuaternion(pq);
    const ps = new THREE.Vector3(); rb.parent.getWorldScale(ps);
    rb.position.add(shift.applyQuaternion(pq.invert()).divide(ps));
  };
  place(root);
  // A tail that hangs beside the spine rather than from it (siblings) is placed on its own.
  if (root + 1 < n && path[root + 1].parent !== path[root]) place(root + 1);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _w = new THREE.Quaternion(), _p = new THREE.Quaternion();
  const aim = (i, j) => {
    scene.updateMatrixWorld(true);
    const b = path[i];
    _a.setFromMatrixPosition(b.matrixWorld);
    _b.setFromMatrixPosition(path[j].matrixWorld).sub(_a);
    const want = target[j].clone().sub(target[i]);
    if (_b.lengthSq() < 1e-12 || want.lengthSq() < 1e-12) return;
    _q.setFromUnitVectors(_b.normalize(), want.normalize());
    b.getWorldQuaternion(_w);
    _w.premultiply(_q);
    if (b.parent) { b.parent.getWorldQuaternion(_p); _w.premultiply(_p.invert()); }
    b.quaternion.copy(_w);
  };
  // The root joint takes the head side's direction (its other side follows from there).
  for (let i = root; i > 0; i--) aim(i, i - 1);
  for (let i = root > 0 ? root + 1 : 0; i < n - 1; i++) aim(i, i + 1);
  scene.updateMatrixWorld(true);
  if (globalThis.DBG) console.log("bend root", root, path[root].name, path.map((b, i) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).distanceTo(target[i]).toFixed(2)).join(","), path.map((b) => b.name).join(","));
}

// Coil a long, straight body; returns true when it did. pts: model-space vertex samples.
export function coilBody(scene, pts) {
  scene.updateMatrixWorld(true);
  const chain = axialChain(scene);
  if (!chain) return false;
  const c = needsCoil(chain, pts);
  if (globalThis.DBG) console.log("coil", chain.path.length, chain.path[0].name, chain.path[chain.path.length - 1].name, JSON.stringify(c), chain.pos[0].distanceTo(chain.pos[chain.pos.length - 1]));
  if (!c.ok) return false;
  bendChain(scene, chain, coilCurve(c.L, c.thick));
  return true;
}
