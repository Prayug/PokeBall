// Animation for the 3D figures: a small state machine that blends procedural poses on the
// auto-rigged skeleton from figure3d.js. Locomotion states (idle, pre-snap stance, run,
// sprint, block) cross-fade by weight; one-shot and contextual layers (carry, ball up by the
// ear, throw, catch, dive, tackled, juke, spin, truck, stunned, celebrate) blend over them.
// Everything is driven by what the simulation says the player is doing this frame.

// Pose channels: rotation x/y/z for each animated bone, then root pitch, roll, lift (yards)
// and a yaw offset applied by the stage (spins).
const B = ['hips', 'chest', 'head', 'armL', 'armR', 'legL', 'legR'];
const N = B.length * 3 + 4;
const PITCH = B.length * 3, ROLL = PITCH + 1, LIFT = PITCH + 2, YAW = PITCH + 3;
const bi = Object.fromEntries(B.map((b, i) => [b, i * 3]));

const BASE = ['idle', 'stance', 'run', 'block'];
const FADE = 10; // cross-fade rate (1/s)

function pose() { return new Float32Array(N); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => u * u * (3 - 2 * u);

export class Animator {
  constructor(fig, seed = Math.random()) {
    this.fig = fig;
    this.w = { idle: 1, stance: 0, run: 0, block: 0 };
    this.layers = Object.fromEntries(BASE.map((k) => [k, pose()]));
    this.out = pose();
    this.tmp = pose();
    this.ov = {}; // overlay weights
    this.gait = seed * 10;
    this.t = seed * 30;
    this.fallK = 0;
    this.fallX = 0; this.fallZ = 1;
  }

  setFigure(fig) { this.fig = fig; }

  // s: the player's situation this frame (see Stage.situation()).
  update(dt, s) {
    this.t += dt;
    const t = this.t;
    const H = s.height;
    const sf = s.top > 0 ? clamp(s.speed / s.top, 0, 1.2) : 0;
    // ----- locomotion targets -----
    const moving = s.speed > 0.7;
    const target = { idle: 0, stance: 0, run: 0, block: 0 };
    if (s.engaged) target.block = 1;
    else if (moving) target.run = 1;
    else if (s.mode === 'pre' && s.set) target.stance = 1;
    else target.idle = 1;
    let sum = 0;
    for (const k of BASE) { this.w[k] += (target[k] - this.w[k]) * (1 - Math.exp(-dt * FADE)); sum += this.w[k]; }
    // Stride: one full cycle every two steps, a step about half the body height.
    const stride = Math.max(0.45, H * 0.55);
    this.gait += dt * (moving ? s.speed / stride : s.engaged ? 3.2 : 0) * Math.PI * 0.5;
    const ph = this.gait;

    // ----- base layers -----
    const L = this.layers;
    // idle: breathing and a look around
    let p = L.idle; p.fill(0);
    p[bi.chest] = Math.sin(t * 1.9) * 0.035; p[bi.head + 1] = Math.sin(t * 0.6) * 0.18; p[bi.head] = Math.sin(t * 1.9 + 0.5) * 0.03;
    p[bi.armL + 2] = 0.06 + Math.sin(t * 1.9) * 0.03; p[bi.armR + 2] = -0.06 - Math.sin(t * 1.9) * 0.03;
    if (s.hover) { p[bi.armL + 2] -= 0.4 * Math.sin(t * 7); p[bi.armR + 2] += 0.4 * Math.sin(t * 7); }
    // stance: down in a three-point stance on the line, set elsewhere
    p = L.stance; p.fill(0);
    const st = s.stance;
    const lean = st === 'line' ? 0.5 : st === 'qb' ? 0.05 : st === 'back' ? 0.24 : 0.2;
    p[PITCH] = lean;
    p[bi.legL] = -lean * 0.8; p[bi.legR] = -lean * 0.8;
    p[bi.legL + 2] = 0.12; p[bi.legR + 2] = -0.12;
    p[bi.head] = -lean * 0.7;
    if (st === 'line') { p[bi.armR] = -1.1; p[bi.armL] = -0.6; p[bi.armL + 2] = 0.2; }
    else if (st === 'qb') { p[bi.armL] = -0.55; p[bi.armR] = -0.55; }
    else { p[bi.armL] = -0.35; p[bi.armR] = -0.35; p[bi.armL + 2] = 0.15; p[bi.armR + 2] = -0.15; }
    p[bi.chest] = Math.sin(t * 2.4) * 0.02;
    // run / sprint
    p = L.run; p.fill(0);
    const A = 0.3 + 0.5 * Math.min(1, sf);
    const sn = Math.sin(ph), cs = Math.cos(ph);
    p[bi.legL] = -A * sn; p[bi.legR] = A * sn;
    p[bi.armL] = A * 0.85 * sn; p[bi.armR] = -A * 0.85 * sn;
    p[bi.armL + 2] = 0.12; p[bi.armR + 2] = -0.12;
    p[bi.chest + 1] = 0.14 * sn * Math.min(1, sf);
    p[bi.head + 1] = -0.08 * sn;
    const runLean = 0.08 + 0.24 * Math.min(1, sf) + (s.backpedal ? -0.32 : 0);
    p[PITCH] = runLean;
    p[bi.legL] -= runLean * 0.6; p[bi.legR] -= runLean * 0.6;
    p[bi.head] = -runLean * 0.6;
    p[LIFT] = Math.abs(cs) * H * (0.025 + 0.035 * Math.min(1, sf));
    // Short-legged Pokémon waddle.
    p[ROLL] = sn * (s.shortLegs ? 0.1 : 0.035) * Math.min(1, sf + 0.3);
    // block: leaning in, arms locked out, feet churning
    p = L.block; p.fill(0);
    const push = Math.sin(t * 9 + this.gait) * 0.12;
    p[PITCH] = 0.38 + push * 0.4;
    p[bi.armL] = -1.35 + push; p[bi.armR] = -1.35 - push;
    p[bi.armL + 2] = -0.15; p[bi.armR + 2] = 0.15;
    p[bi.legL] = -0.3 - 0.22 * sn; p[bi.legR] = -0.3 + 0.22 * sn;
    p[bi.head] = -0.2;
    p[ROLL] = (s.pushSide ?? 0) * 0.12;

    const o = this.out; o.fill(0);
    for (const k of BASE) { const wk = this.w[k] / (sum || 1); if (wk < 1e-3) continue; const q = L[k]; for (let i = 0; i < N; i++) o[i] += q[i] * wk; }

    // Leaning into turns.
    o[ROLL] += clamp(-(s.turn ?? 0) * s.speed * 0.035, -0.4, 0.4);
    if (s.hover) { o[LIFT] += H * 0.18 + Math.sin(t * 3 + this.gait) * H * 0.03; o[bi.legL] += 0.25; o[bi.legR] += 0.25; o[bi.armL + 2] -= 0.35 * Math.sin(t * (moving ? 12 : 7)); o[bi.armR + 2] += 0.35 * Math.sin(t * (moving ? 12 : 7)); }

    // ----- overlays -----
    const blendIn = (name, want, rate = 12) => {
      const cur = this.ov[name] ?? 0;
      const v = cur + (want - cur) * (1 - Math.exp(-dt * rate));
      this.ov[name] = v;
      return v;
    };
    const set = (w, ch, v) => { if (w > 1e-3) o[ch] += (v - o[ch]) * w; };
    // Carrying the ball: tucked under the right arm.
    let w = blendIn('carry', s.carrier && !s.qbHold ? 1 : 0);
    set(w, bi.armR, -0.75); set(w, bi.armR + 2, 0.55); set(w, bi.armR + 1, -0.3);
    // Quarterback in the pocket: ball up by the ear.
    w = blendIn('qb', s.qbHold ? 1 : 0);
    set(w, bi.armR, 0.25); set(w, bi.armR + 2, 1.15); set(w, bi.armL, -0.7); set(w, bi.chest + 1, -0.25);
    // Throw: whip from cocked to released, the chest turning through.
    if (s.throwU != null && s.throwU < 1) {
      const u = s.throwU, k = u < 0.45 ? ease(u / 0.45) : 1;
      const f = u < 0.45 ? 0 : (u - 0.45) / 0.55;
      const wt = Math.sin(Math.min(1, u * 6) * Math.PI / 2) * (1 - Math.max(0, f - 0.5) * 2);
      set(wt, bi.armR, 0.6 - k * 2.5 + f * 1.3); set(wt, bi.armR + 2, 1.0 - k * 0.6); set(wt, bi.chest + 1, -0.45 + k * 0.9 - f * 0.3);
      set(wt, PITCH, k * 0.18); set(wt, bi.armL, -0.5 + k * 0.4);
    }
    // Reaching for the ball (catch), then securing it.
    w = blendIn('reach', s.reach ?? 0, 16);
    set(w, bi.armL, -2.5); set(w, bi.armR, -2.5); set(w, bi.armL + 2, 0.25); set(w, bi.armR + 2, -0.25); set(w, bi.head, 0.3);
    if (s.reachHigh) o[LIFT] += w * s.reachHigh;
    // Juke and truck
    if (s.juke) { o[ROLL] += s.juke * 0.4; o[LIFT] += Math.abs(s.juke) * H * 0.06; }
    if (s.truck) { set(s.truck, PITCH, 0.55); set(s.truck, bi.armR, -1.5); set(s.truck, bi.armR + 2, 0.1); set(s.truck, bi.head, -0.3); }
    // Stunned: wobbling.
    if (s.stun) { o[ROLL] += Math.sin(t * 15) * 0.14 * s.stun; o[bi.head + 2] += Math.sin(t * 11) * 0.2 * s.stun; }
    // Diving tackle: laid out, arms out front.
    if (s.dive) {
      const k = s.dive;
      set(k, PITCH, 1.32); set(k, bi.armL, -2.7); set(k, bi.armR, -2.7); set(k, bi.legL, 0.45); set(k, bi.legR, 0.35); set(k, bi.head, -0.9);
      o[LIFT] += Math.sin(Math.min(1, k) * Math.PI) * H * 0.18;
    }
    // Going down (tackled, sacked, whiffed): falls the way it was hit, arms out.
    const fallWant = s.fall ?? 0;
    this.fallK += (fallWant - this.fallK) * (1 - Math.exp(-dt * (fallWant > this.fallK ? 9 : 4)));
    if (s.fallDir) { this.fallX = s.fallDir[0]; this.fallZ = s.fallDir[1]; }
    if (this.fallK > 1e-3) {
      const k = ease(clamp(this.fallK, 0, 1));
      // fallDir is local: [x, z]; pitching about x tips toward +z, rolling about z tips toward -x.
      set(k, PITCH, 1.42 * this.fallZ); set(k, ROLL, -1.42 * this.fallX);
      set(k, bi.armL + 2, -1.1); set(k, bi.armR + 2, 1.1); set(k, bi.armL, -0.4); set(k, bi.armR, -0.4);
      set(k, bi.legL, 0.2); set(k, bi.legR, -0.15); set(k, LIFT, 0);
    }
    // Celebrating: jumping with both arms up.
    if (s.celebrate) {
      const k = s.celebrate;
      set(k, bi.armL + 2, -2.3 + Math.sin(t * 12) * 0.25); set(k, bi.armR + 2, 2.3 - Math.sin(t * 12) * 0.25);
      set(k, bi.armL, 0); set(k, bi.armR, 0); set(k, PITCH, -0.1);
      o[LIFT] += k * Math.abs(Math.sin(t * 6.5 + this.gait)) * H * 0.35;
    }
    if (s.spin != null) o[YAW] = s.spin;

    this.apply(o);
    return o;
  }

  apply(o) {
    const f = this.fig;
    if (!f?.bones) return;
    const bones = f.bones;
    for (const b of B) { const i = bi[b]; bones[b].rotation.set(o[i], o[i + 1], o[i + 2]); }
    const r = bones.root;
    r.rotation.set(o[PITCH], 0, o[ROLL], 'XZY');
    r.position.y = Math.max(0, o[LIFT]) / (f.group.scale.y || 1);
  }

  get yawOffset() { return this.out[YAW]; }
  get lift() { return this.out[LIFT]; }
  get pitch() { return this.out[PITCH]; }
}
