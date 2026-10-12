// The football camera. Every mode works out where it wants to be from the play (the line,
// the ball, the carrier, a pass in the air) and the rig eases toward it, so cuts between
// modes and between pre-snap, live and dead-ball framing are smooth.
//   broadcast: Madden-style, high behind the offense, centered on the ball
//   sideline:  TV sideline shot from the near side, following the ball across the field
//   qb:        low behind the quarterback (and then behind the ball carrier)
//   tactical:  high and far back, most of the field in view
import * as THREE from 'three';

export const CAMERA_MODES = [
  ['broadcast', 'Broadcast'],
  ['sideline', 'Sideline'],
  ['qb', 'Behind the QB'],
  ['tactical', 'Tactical'],
];

const v = new THREE.Vector3();

// The broadcast camera's setups, one per moment of a play: how far behind the focus it sits,
// how high, how steeply it looks down and its lens. Low and behind the quarterback like a
// game broadcast's "all-22 behind the offense" shot, so the stands and the horizon stay in
// the frame and the Pokémon read at their size; the pass setup sits a little higher and wider
// for the routes, the run setup tighter on the carrier, the post-play shot closer still.
// The debug calibration panel edits these live.
export const CAMERA_SHOTS = [['pre', 'Pre-snap'], ['pass', 'Passing'], ['run', 'Running'], ['post', 'Post-play']];
export const CAMERA_DEFAULTS = {
  pre: { distance: 13, height: 8.5, pitch: 22, fov: 50 },
  pass: { distance: 14, height: 9.5, pitch: 23, fov: 52 },
  run: { distance: 12, height: 8, pitch: 22, fov: 50 },
  post: { distance: 11, height: 7, pitch: 21, fov: 48 },
};
export const CAMERA_LIMITS = { distance: [6, 45], height: [2.5, 40], pitch: [5, 70], fov: [25, 75] };
export const cameraDefaults = () => JSON.parse(JSON.stringify(CAMERA_DEFAULTS));

// One step of a critically damped spring pulling x toward target (angular frequency w).
function spring(x, v, target, w, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v.x += (w * w * (target.x - x.x) - 2 * w * v.x) * h;
    v.y += (w * w * (target.y - x.y) - 2 * w * v.y) * h;
    v.z += (w * w * (target.z - x.z) - 2 * w * v.z) * h;
    x.x += v.x * h; x.y += v.y * h; x.z += v.z * h;
  }
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'broadcast';
    this.pos = new THREE.Vector3(20, 14, 0);
    this.look = new THREE.Vector3(35, 0, 0);
    this.wantPos = new THREE.Vector3();
    this.wantLook = new THREE.Vector3();
    this.zoom = 1; // extra pull-back for deep passes, eased
    this.shake = 0;
    this.fov = 42;
    this.cal = cameraDefaults();
    this.vPos = new THREE.Vector3();
    this.vLook = new THREE.Vector3();
    this.shot = 'PRE_SNAP';
  }

  setCalibration(c) {
    for (const [shot] of CAMERA_SHOTS) for (const k of Object.keys(CAMERA_LIMITS)) {
      const v = Number(c?.[shot]?.[k]);
      if (Number.isFinite(v)) this.cal[shot][k] = Math.min(CAMERA_LIMITS[k][1], Math.max(CAMERA_LIMITS[k][0], v));
    }
  }

  setMode(m) { if (CAMERA_MODES.some(([k]) => k === m)) this.mode = m; }

  // f: framing for this frame. focus = where the action is (world x, z); fwd = +1 or -1, the
  // way the offense attacks; spread = how much field must be in view (yards); pre = before
  // the snap; tight = zoom toward a finished play; qb = the quarterback's world position.
  target(f, aspect) {
    const s = f.fwd;
    const narrow = aspect < 1.1 ? 1.45 : aspect < 1.5 ? 1.15 : 1;
    const z = this.zoom * narrow;
    const fx = f.focus.x, fz = f.focus.z;
    switch (this.mode) {
      case 'sideline': {
        const back = (30 + f.spread * 0.5) * z;
        this.wantPos.set(fx - s * 2, 12 + f.spread * 0.18, Math.min(60, fz + back));
        this.wantLook.set(fx + s * 3, 0, fz * 0.7);
        break;
      }
      case 'qb': {
        const a = f.qb ?? f.focus;
        const back = (f.pre ? 7.5 : 8.5) * z;
        this.wantPos.set(a.x - s * back, 3.6 + (z - 1) * 4, a.z * 0.9);
        this.wantLook.set(a.x + s * 14, 0.6, a.z * 0.6);
        break;
      }
      case 'tactical': {
        const back = (22 + f.spread * 0.4) * z;
        this.wantPos.set(fx - s * back, 42 * z, fz * 0.5);
        this.wantLook.set(fx + s * 8, 0, fz * 0.5);
        break;
      }
      default: {
        // Behind the offense, from this moment's setup; widened a little for spread
        // formations and long passes rather than shrinking anyone.
        const C = this.cal[f.shot] ?? this.cal.pre;
        const k = z * (1 + Math.max(0, f.spread - 14) * 0.012);
        const back = C.distance * k, high = C.height * k;
        // Where the view's center lands, ahead of the camera, from the pitch.
        const ahead = high / Math.tan((C.pitch * Math.PI) / 180) - back;
        this.wantPos.set(fx - s * back, high, fz * 0.7);
        this.wantLook.set(fx + s * ahead, 0, fz * 0.9);
        this.wantFov = C.fov;
      }
    }
  }

  update(dt, f, aspect, obstacles, snap = false) {
    // Deep balls widen the shot; it eases back in once the ball comes down.
    const zWant = 1 + Math.min(0.55, Math.max(0, (f.deep ?? 0) - 12) * 0.022);
    this.zoom += (zWant - this.zoom) * (1 - Math.exp(-dt * 2.2));
    this.target(f, aspect);
    // Never inside a Pokémon: lift the camera over anything close to it.
    for (const o of obstacles) {
      const d = Math.hypot(this.wantPos.x - o.x, this.wantPos.z - o.z);
      if (d < o.r + 1.4) this.wantPos.y = Math.max(this.wantPos.y, o.h + 1.6);
    }
    this.wantPos.y = Math.max(this.wantPos.y, 1.8);
    // Occlusion: a body standing between the lens and the focus, near the lens, would fill the
    // frame; rise until the sight line clears his head.
    {
      const lx = this.wantLook.x - this.wantPos.x, lz = this.wantLook.z - this.wantPos.z, L = Math.hypot(lx, lz) || 1;
      for (const o of obstacles) {
        const ox = o.x - this.wantPos.x, oz = o.z - this.wantPos.z;
        const along = (ox * lx + oz * lz) / L;
        if (along < 0.5 || along > L * 0.45) continue;
        const across = Math.abs(ox * lz - oz * lx) / L;
        if (across > o.r + 0.5) continue;
        // Height of the sight line at his distance, if the camera were at this height.
        const y0 = this.wantPos.y, yAt = y0 + (this.wantLook.y - y0) * (along / L);
        if (yAt < o.h + 0.4) this.wantPos.y += Math.min(4, (o.h + 0.4 - yAt) / Math.max(0.2, 1 - along / L));
      }
    }
    // Critically damped springs on the lens and the aim point: smooth starts and stops, no
    // velocity jump when the shot changes. Tighter while the ball is live.
    const w = f.pre ? 4 : f.shot === 'pass' ? 3.6 : 4.5;
    if (snap) { this.pos.copy(this.wantPos); this.look.copy(this.wantLook); this.vPos.set(0, 0, 0); this.vLook.set(0, 0, 0); }
    else { spring(this.pos, this.vPos, this.wantPos, w, dt); spring(this.look, this.vLook, this.wantLook, w * 1.35, dt); }
    this.camera.position.copy(this.pos);
    if (this.shake > 0.004) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.look);
    const fov = this.mode === 'qb' ? 52 : this.mode === 'tactical' ? 38 : this.mode === 'broadcast' ? (this.wantFov ?? 50) : 42;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3)); this.camera.updateProjectionMatrix(); }
  }

  // Screen up and screen right as world directions on the turf.
  groundAxes() {
    v.subVectors(this.look, this.pos); v.y = 0;
    const l = Math.hypot(v.x, v.z) || 1;
    const ux = v.x / l, uz = v.z / l;
    return { up: { x: ux, z: uz }, right: { x: -uz, z: ux } };
  }
}
