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
        // Behind the offense, up high; pull back and up as the play spreads out.
        const back = ((f.pre ? 17 : 15) + f.spread * 0.34) * z * (f.tight ? 0.86 : 1);
        const high = ((f.pre ? 12.5 : 11) + f.spread * 0.22) * z * (f.tight ? 0.88 : 1);
        this.wantPos.set(fx - s * back, high, fz * 0.75);
        this.wantLook.set(fx + s * (f.pre ? 1.5 : 4), 0, fz * 0.92);
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
    const kp = snap ? 1 : 1 - Math.exp(-dt * (f.pre ? 3.5 : 2.8));
    const kl = snap ? 1 : 1 - Math.exp(-dt * (f.pre ? 4.5 : 4.2));
    this.pos.lerp(this.wantPos, kp);
    this.look.lerp(this.wantLook, kl);
    this.camera.position.copy(this.pos);
    if (this.shake > 0.004) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.look);
    const fov = this.mode === 'qb' ? 52 : this.mode === 'tactical' ? 38 : 42;
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
