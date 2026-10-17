// Blinking. About half the models carry their eyes as their own material (Eye, REye,
// pm0091_00_Eye1, ...). Those vertices are squashed, in the vertex shader, onto the line
// across the middle of each eye: shut for a moment every few seconds, sometimes twice.
//
// Each eye is an island of the eye mesh (vertices joined by triangles, or sharing a position
// across a seam), so a mesh holding three heads' eyes (Dugtrio) closes each eye on its own
// center. An island too tall to be an eye (a material that also covers a face) is left open.
import * as THREE from 'three';

const EYE = /eye(?!lash|brow)/i;
const isEye = (m) => !!m && EYE.test(m.name);

// Template time: give each eye mesh's geometry an `eyeC` attribute (the island's center
// along the model's up axis, and 1 where the vertex should close) and its up axis.
export function prepareEyes(scene, height) {
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  let any = false;
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || o.geometry.attributes.eyeC) return;
    const mats = [].concat(o.material);
    if (!mats.some(isEye)) return;
    const g = o.geometry, pos = g.attributes.position, n = pos.count;
    // Which vertices belong to an eye material.
    const eyeV = new Uint8Array(n);
    const idx = g.index;
    const mark = (start, count) => { for (let i = start; i < start + count; i++) eyeV[idx ? idx.getX(i) : i] = 1; };
    if (Array.isArray(o.material) && g.groups.length) { for (const gr of g.groups) if (isEye(o.material[gr.materialIndex])) mark(gr.start, gr.count); }
    else if (isEye(o.material)) eyeV.fill(1);
    // The model's up axis in the geometry's own frame (at bind, a skinned vertex is drawn
    // through the mesh's world matrix like any other).
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(m).invert()).normalize();
    // Islands: union by triangle and by shared position.
    const par = new Int32Array(n).map((_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const tri = idx ? idx.count : n;
    for (let t = 0; t + 2 < tri; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      if (eyeV[a] && eyeV[b] && eyeV[c]) { join(a, b); join(a, c); }
    }
    const seen = new Map();
    for (let i = 0; i < n; i++) {
      if (!eyeV[i]) continue;
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (seen.has(k)) join(i, seen.get(k)); else seen.set(k, i);
    }
    // Each island's span along up: its center, and whether it is eye-sized.
    const v = new THREE.Vector3(), lo = new Map(), hi = new Map();
    const h = (i) => v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).dot(up);
    for (let i = 0; i < n; i++) {
      if (!eyeV[i]) continue;
      const r = find(i), y = h(i);
      lo.set(r, Math.min(lo.get(r) ?? Infinity, y)); hi.set(r, Math.max(hi.get(r) ?? -Infinity, y));
    }
    // Model units per geometry unit along up, to compare an island with the body's height.
    const scaleUp = up.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(m)).length() || 1;
    const attr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      if (!eyeV[i]) continue;
      const r = find(i), span = (hi.get(r) - lo.get(r)) * scaleUp;
      if (!(span > 0) || span > height * 0.2) continue;
      attr[i * 2] = (hi.get(r) + lo.get(r)) / 2;
      attr[i * 2 + 1] = 1;
    }
    g.setAttribute('eyeC', new THREE.BufferAttribute(attr, 2));
    g.userData.eyeUp = up.toArray();
    any = true;
  });
  return any;
}

// Figure time: the eye materials get their own copies that close on the figure's blink.
export function attachBlink(fig) {
  const u = { value: 0 }, mats = [];
  fig.root.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.eyeC) return;
    const up = new THREE.Vector3().fromArray(o.geometry.userData.eyeUp);
    const swap = (m) => {
      if (!isEye(m)) return m;
      const c = m.clone();
      c.onBeforeCompile = (sh) => {
        sh.uniforms.uBlink = u;
        sh.uniforms.uEyeUp = { value: up };
        sh.vertexShader = 'uniform float uBlink;\nuniform vec3 uEyeUp;\nattribute vec2 eyeC;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n\ttransformed -= uEyeUp * ((dot(transformed, uEyeUp) - eyeC.x) * uBlink * eyeC.y);');
      };
      c.customProgramCacheKey = () => 'blink';
      mats.push(c);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  if (mats.length) fig.blink = { u, mats, next: 1 + Math.random() * 4, t: -1 };
}

// Step the blink: shut over 0.07 s, open over 0.11, every 2 to 6 seconds, one in five twice.
export function updateBlink(fig, dt, open = true) {
  const B = fig.blink;
  if (!B) return;
  if (B.t < 0) {
    B.next -= dt;
    if (B.next <= 0) { B.t = 0; B.next = Math.random() < 0.2 ? 0.25 : 2 + Math.random() * 4; }
  } else B.t += dt;
  let k = 0;
  if (B.t >= 0) {
    k = B.t < 0.07 ? B.t / 0.07 : 1 - (B.t - 0.07) / 0.11;
    if (B.t > 0.18) { B.t = -1; k = 0; }
  }
  // Knocked flat, the eyes stay shut.
  B.u.value = open ? Math.max(0, Math.min(1, k)) : 1;
}
