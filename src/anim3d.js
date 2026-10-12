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
    this.diveK = 0;
    this.fallX = 0; this.fallZ = 1;
    // Football pose for real models (see model3d.poseLimbs), eased toward each frame's target.
    this.fb = { crouch: 0, lean: 0, armsFwd: 0, down: 0, reach: 0, carry: 0, throwArm: 0, twist: 0 };
    this.lastSpeed = 0;
    this.accel = 0;
    this.sprK = 0; // eased 0..1 while sprinting
    this.moving = false;
  }

  setFigure(fig) { this.fig = fig; }

  // s: the player's situation this frame (see Stage.situation()).
  update(dt, s) {
    this.t += dt;
    const t = this.t;
    const H = s.height;
    const sf = s.top > 0 ? clamp(s.speed / s.top, 0, 1.2) : 0;
    this.sprK += ((s.sprint ? 1 : 0) - this.sprK) * (1 - Math.exp(-dt * 6));
    const spr = this.sprK;
    this.H = H; this.sf = sf;
    // ----- locomotion targets -----
    // Start running above 0.9 yd/s, stop below 0.5, so a player easing around 0.7 does not
    // flicker between the run and the stand.
    const moving = this.moving = s.speed > (this.moving ? 0.5 : 0.9);
    const target = { idle: 0, stance: 0, run: 0, block: 0 };
    if (s.engaged) target.block = 1;
    else if (moving) target.run = 1;
    else if (s.mode === 'pre' && s.set) target.stance = 1;
    else target.idle = 1;
    let sum = 0;
    for (const k of BASE) { this.w[k] += (target[k] - this.w[k]) * (1 - Math.exp(-dt * FADE)); sum += this.w[k]; }
    // Stride: one full cycle every two steps, a step about half the body height (longer in a
    // sprint, so the legs reach out instead of only spinning faster).
    const stride = Math.max(0.45, H * (0.55 + 0.15 * spr));
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
    const lean = st === 'line' ? 0.5 : st === 'qbUnder' ? 0.3 : st === 'qb' ? 0.05 : st === 'back' ? 0.24 : 0.2;
    p[PITCH] = lean;
    p[bi.legL] = -lean * 0.8; p[bi.legR] = -lean * 0.8;
    p[bi.legL + 2] = 0.12; p[bi.legR + 2] = -0.12;
    p[bi.head] = -lean * 0.7;
    if (st === 'line') { p[bi.armR] = -1.1; p[bi.armL] = -0.6; p[bi.armL + 2] = 0.2; }
    else if (st === 'qb' || st === 'qbUnder') { p[bi.armL] = st === 'qbUnder' ? -1.0 : -0.55; p[bi.armR] = st === 'qbUnder' ? -1.0 : -0.55; }
    else { p[bi.armL] = -0.35; p[bi.armR] = -0.35; p[bi.armL + 2] = 0.15; p[bi.armR + 2] = -0.15; }
    p[bi.chest] = Math.sin(t * 2.4) * 0.02;
    // run / sprint
    p = L.run; p.fill(0);
    const A = 0.3 + 0.5 * Math.min(1, sf) + 0.3 * spr;
    const sn = Math.sin(ph), cs = Math.cos(ph);
    p[bi.legL] = -A * sn; p[bi.legR] = A * sn;
    // Sprinting: arms pump hard, elbows driving back.
    p[bi.armL] = A * (0.85 + 0.4 * spr) * sn; p[bi.armR] = -A * (0.85 + 0.4 * spr) * sn;
    p[bi.armL + 2] = 0.12; p[bi.armR + 2] = -0.12;
    p[bi.chest + 1] = 0.14 * sn * Math.min(1, sf);
    p[bi.head + 1] = -0.08 * sn;
    const runLean = 0.08 + 0.24 * Math.min(1, sf) + 0.2 * spr + (s.backpedal ? -0.32 : 0);
    p[PITCH] = runLean;
    p[bi.legL] -= runLean * 0.6; p[bi.legR] -= runLean * 0.6;
    p[bi.head] = -runLean * 0.6;
    p[LIFT] = Math.abs(cs) * H * (0.025 + 0.035 * Math.min(1, sf) + 0.03 * spr);
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
    // Getting off a block: a rip swings the near arm up through the blocker's armpit, a swim
    // clubs and reaches the far arm over his shoulder, a bull rush drops the hips and drives
    // both hands through his chest. The blocker being beaten is turned and pushed back.
    if (s.shed && s.shedMove) {
      const u = Math.sin(clamp(s.shedU ?? 0, 0, 1) * Math.PI);
      if (!s.shedder) { p[PITCH] -= 0.25 * u; p[bi.chest + 1] += 0.35 * u * (s.pushSide || 1); }
      else if (s.shedMove === 'rip') { p[bi.armR] = -1.35 - 1.3 * u; p[bi.chest + 1] += 0.45 * u; p[PITCH] += 0.1 * u; }
      else if (s.shedMove === 'swim') { p[bi.armL] = -1.35 - 1.7 * u; p[bi.armL + 2] -= 0.4 * u; p[bi.chest + 1] -= 0.4 * u; }
      else { p[PITCH] += 0.22 * u; p[bi.armL] = -1.55; p[bi.armR] = -1.55; p[bi.legL] -= 0.2 * u; p[bi.legR] -= 0.2 * u; }
    }

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
    this.diveK = s.dive ?? 0;
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

    this.football(dt, s, t);
    this.apply(o);
    return o;
  }

  // The football pose a real model's skeleton is bent into this frame: stance by position
  // before the snap, the lean of a runner (more while accelerating), a blocker's crouch with
  // arms locked out (leaning back when he is losing), the ball tucked or cocked by the ear,
  // the throw, reaching for the ball, laying out and celebrating.
  football(dt, s, t) {
    const sp = s.speed;
    this.accel += ((sp - this.lastSpeed) / Math.max(dt, 1e-3) - this.accel) * (1 - Math.exp(-dt * 8));
    this.lastSpeed = sp;
    const sf = s.top > 0 ? clamp(sp / s.top, 0, 1.2) : 0;
    const T = { crouch: 0, lean: 0, armsFwd: 0, down: 0, reach: 0, carry: 0, throwArm: 0, twist: 0 };
    if (s.engaged) {
      const push = Math.sin(t * 9 + this.gait) * 0.12;
      T.crouch = 0.6; T.lean = (s.pushBack ? 0.15 : 0.55) + push * 0.3; T.armsFwd = 1 + push;
    } else if (sp > 0.7) {
      T.lean = (s.backpedal ? -0.05 : 0.1 + 0.25 * Math.min(1, sf) + 0.25 * this.sprK) + clamp(this.accel * 0.025, 0, 0.25);
      T.crouch = s.backpedal ? 0.35 : 0.12 + 0.12 * this.sprK;
      T.armsFwd = s.backpedal ? 0.25 : 0;
    } else if (s.mode === 'pre' && s.set) {
      const P = {
        line: [0.85, 0.6, 0.15, 1], qbUnder: [0.55, 0.35, 0.75, 0], qb: [0.22, 0.08, 0.4, 0],
        back: [0.5, 0.35, 0.25, 0], skill: [0.35, 0.3, 0.15, 0], db: [0.42, 0.25, 0.2, 0],
      }[s.stance] ?? [0.1, 0, 0, 0];
      [T.crouch, T.lean, T.armsFwd, T.down] = P;
    } else if (s.mode === 'live') { T.crouch = 0.2; T.lean = 0.1; T.armsFwd = 0.15; }
    if (s.carrier && !s.qbHold) T.carry = 1;
    if (s.qbHold) { T.throwArm = -3.3; T.armsFwd = Math.max(T.armsFwd, 0.3); T.twist = -0.25; T.carry = 0; }
    if (s.throwU != null && s.throwU < 1) {
      const u = s.throwU;
      // Cocked, whipped through by a third of the way, then the follow-through.
      T.throwArm = u < 0.3 ? -3.3 + (u / 0.3) * 2.2 : -1.1 + (u - 0.3) * 0.6;
      T.twist = u < 0.3 ? -0.25 + (u / 0.3) * 0.65 : 0.4 - (u - 0.3) * 0.3;
      T.lean = 0.15 + Math.sin(Math.min(1, u * 2) * Math.PI) * 0.15; T.carry = 0;
    }
    if (s.reach) { T.reach = s.reach; T.armsFwd = Math.max(T.armsFwd, s.reach * 0.5); }
    if (s.dive) { T.lean = Math.max(T.lean, 0.7 * s.dive); T.armsFwd = Math.max(T.armsFwd, s.dive); }
    if (s.truck) { T.lean = Math.max(T.lean, 0.55 * s.truck); T.crouch = Math.max(T.crouch, 0.4 * s.truck); }
    if (s.celebrate) { T.reach = s.celebrate; T.lean = -0.1; }
    if (this.fallK > 0.3) { T.armsFwd = 0.6; T.crouch = 0; }
    const k = 1 - Math.exp(-dt * 10), kThrow = 1 - Math.exp(-dt * 30);
    for (const key of Object.keys(T)) this.fb[key] += (T[key] - this.fb[key]) * (key === 'throwArm' || key === 'twist' ? kThrow : k);
  }

  apply(o) {
    const f = this.fig;
    if (f?.model) {
      // Real models animate their own skeleton from clips; the whole body still leans into
      // runs and cuts, bobs, hops, dives and goes down the way it was hit. Lean from the base
      // layers is softened so a full model does not tip over in a stance.
      // Rigs bend at the spine and knees (poseLimbs), so their whole body leans less;
      // models without a skeleton can only lean as one piece, so they lean more.
      const hard = Math.max(clamp(this.fallK, 0, 1), this.diveK);
      const soft = f.rig ? 0.2 : 0.55;
      const k = soft + (1 - soft) * hard;
      // Models with no legs to stride (no skeleton, or none the rig could find) and no run
      // clip would glide: they bound instead, one hop a step with a forward rock and a
      // side-to-side waddle, squashing as they land and stretching as they push off.
      const clipRun = f.cur && (f.cur === f.actions.run || f.cur === f.actions.walk);
      const m = (!f.rig?.legs && !clipRun ? this.w.run : 0) * (1 - hard);
      const H = this.H ?? 2, sf = Math.min(1, this.sf ?? 0), ph = this.gait, hs = Math.abs(Math.sin(ph));
      const hop = m * hs * H * (0.05 + 0.06 * sf + 0.04 * this.sprK);
      const pitch = o[PITCH] * k + (f.rig ? 0 : clamp(this.fb.lean - o[PITCH] * 0.3, -0.2, 0.35) * (1 - hard)) + m * Math.sin(ph * 2) * 0.08;
      f.pivot.rotation.set(pitch, f.rig ? 0 : this.fb.twist * 0.8, o[ROLL] * k + m * Math.sin(ph) * 0.1, 'XZY');
      // A crouch lowers the hips, so the feet stay on the turf.
      const c = this.fb.crouch, drop = f.rig ? (f.hipH ?? 0) * (1 - 0.5 * (Math.cos(0.55 * c) + Math.cos(0.3 * c))) : 0;
      f.pivot.position.y = Math.max(0, o[LIFT]) - drop + hop;
      // Breathing while standing, squash and stretch while bounding.
      const still = this.w.idle + this.w.stance;
      const sy = 1 + Math.sin(this.t * 2.3) * 0.018 * still * (1 - hard) + m * (hs - 0.55) * 0.12;
      f.pivot.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      return;
    }
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
