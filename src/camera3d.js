// The football cameras. One rig, four views, each working out every frame what it has to
// show and where to stand to show it, then easing there on critically damped springs, so a
// change of shot, of view or of possession never jumps:
//   gameplay:  the default. Behind the offense and up high enough to see the whole formation:
//              the quarterback and backs at the bottom of the screen, both lines in the middle,
//              the receivers toward the edges and the secondary above them, with the field
//              running away to the far end zone. It frames by fitting: the players that matter
//              this moment (the formation before the snap, the pocket and the routes, the ball
//              in the air, the ball carrier and whoever is near him) are projected through the
//              lens and the camera backs off just far enough for all of them to fit, so a
//              wide formation or a tall Pokémon pulls it back and a tight run brings it in.
//   tactical:  the same idea from much higher and steeper, like an all-22 coaching view, with
//              position labels on the field (see field3d.js).
//   broadcast: an elevated sideline shot from the press box side, for replays and big moments.
//   player:    behind the Pokémon you control (or the ball carrier), far enough back to see
//              defenders coming. It never turns with the player: it always looks down the field.
// The rig never leaves the stadium bowl (the end walls and the press box), never sits inside a
// Pokémon and never rolls.
import * as THREE from 'three';

export const CAMERA_MODES = [
  ['gameplay', 'Gameplay'],
  ['tactical', 'Tactical'],
  ['broadcast', 'Broadcast'],
  ['player', 'Player focus'],
];
// Old saved names.
export const CAMERA_ALIASES = { sideline: 'broadcast', qb: 'player' };

// Per-view lens settings, editable live from the debug panel: how steeply the camera looks
// down (pitch), its vertical field of view, and an extra zoom factor on the fitted distance.
export const CAMERA_SHOTS = CAMERA_MODES;
export const CAMERA_DEFAULTS = {
  gameplay: { pitch: 31, fov: 44, zoom: 1 },
  tactical: { pitch: 56, fov: 42, zoom: 1 },
  broadcast: { pitch: 30, fov: 34, zoom: 1 },
  player: { pitch: 23, fov: 52, zoom: 1 },
};
export const CAMERA_LIMITS = { pitch: [10, 75], fov: [25, 75], zoom: [0.6, 1.8] };
export const cameraDefaults = () => JSON.parse(JSON.stringify(CAMERA_DEFAULTS));

// The stadium bowl (world yards; see stadium3d.js): the walls stand at x = -24 and 124 and
// z = ±37, and the seats rise from them about 0.6 yards per yard for 19 yards. The camera may
// go back over the stands, like a broadcast camera on the upper deck, but always above the
// seats (never inside them), and never past the back of the bowl.
const BOUND_X0 = -40, BOUND_X1 = 140, BOUND_Z = 54;
export function bowl(pos) {
  pos.x = Math.min(BOUND_X1, Math.max(BOUND_X0, pos.x));
  pos.z = Math.min(BOUND_Z, Math.max(-BOUND_Z, pos.z));
  const past = Math.max(Math.abs(pos.z) - 35.5, -23 - pos.x, pos.x - 123);
  if (past > 0) pos.y = Math.max(pos.y, 3 + Math.min(past, 20) * 0.62 + 3);
  return pos;
}

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();

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

// Where points land on screen for a camera at pos looking at look (fov in degrees, aspect):
// the extents in normalized device coordinates. Points behind the lens count as off screen.
function extents(pos, look, fov, aspect, pts, out) {
  _f.subVectors(look, pos).normalize();
  _r.crossVectors(_f, _u.set(0, 1, 0)).normalize();
  _u.crossVectors(_r, _f);
  const ty = Math.tan((fov * D2R) / 2), tx = ty * aspect;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
  for (const p of pts) {
    _v.set(p.x - pos.x, p.y - pos.y, p.z - pos.z);
    const z = _v.dot(_f);
    if (z < 0.5) { behind = true; continue; }
    const sx = _v.dot(_r) / (z * tx), sy = _v.dot(_u) / (z * ty);
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  out.x0 = x0; out.x1 = x1; out.y0 = y0; out.y1 = y1; out.behind = behind;
  return out;
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'gameplay';
    this.pos = new THREE.Vector3(20, 14, 0);
    this.look = new THREE.Vector3(35, 0, 0);
    this.wantPos = new THREE.Vector3();
    this.wantLook = new THREE.Vector3();
    this.vPos = new THREE.Vector3();
    this.vLook = new THREE.Vector3();
    this.shake = 0;
    this.kick = 0;
    this.cal = cameraDefaults();
    this.shot = 'PRE_SNAP';
    this.dist = 30;        // the fitted distance, eased so the zoom breathes rather than pops
    this.wantFov = 46;
    this.ext = {};
  }

  setCalibration(c) {
    for (const [m] of CAMERA_MODES) for (const k of Object.keys(CAMERA_LIMITS)) {
      const v = Number(c?.[m]?.[k]);
      if (Number.isFinite(v)) this.cal[m][k] = Math.min(CAMERA_LIMITS[k][1], Math.max(CAMERA_LIMITS[k][0], v));
    }
  }

  setMode(m) {
    m = CAMERA_ALIASES[m] ?? m;
    if (CAMERA_MODES.some(([k]) => k === m)) this.mode = m;
  }

  // Fit: the camera looks along a fixed heading (yaw: unit ground vector hx, hz) at a pitch,
  // aimed at a point on the turf. Find the aim point along the heading and the distance back
  // so every point is on screen inside the safe area (sx in ±sxMax, sy in [syMin, syMax]).
  // The aim moves until the points sit centered between the safe edges vertically; then the
  // distance is the least that fits them. Returns { aim, dist }.
  fit(pts, hx, hz, pitch, fov, aspect, center, safe, dMin, dMax) {
    const cp = Math.cos(pitch * D2R), sp = Math.sin(pitch * D2R);
    const aim = new THREE.Vector3(center.x, 0, center.z);
    const pos = new THREE.Vector3();
    const place = (d) => {
      const back = d * cp;
      return bowl(pos.set(aim.x - hx * back, d * sp, aim.z - hz * back));
    };
    const E = this.ext;
    const fits = (d) => {
      extents(place(d), aim, fov, aspect, pts, E);
      return !E.behind && E.x0 >= -safe.x && E.x1 <= safe.x && E.y0 >= safe.y0 && E.y1 <= safe.y1;
    };
    let d = dMax;
    for (let round = 0; round < 3; round++) {
      // Binary search for the least distance that fits.
      let lo = dMin, hi = dMax;
      if (!fits(hi)) { d = hi; } else {
        for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
        d = hi;
      }
      // Recenter vertically: slide the aim along the heading toward the empty side.
      extents(place(d), aim, fov, aspect, pts, E);
      const mid = (E.y0 + E.y1) / 2, want = (safe.y0 + safe.y1) / 2;
      const off = mid - want;
      if (Math.abs(off) < 0.03) break;
      const slide = off * d * 0.45;
      aim.x += hx * slide; aim.z += hz * slide;
    }
    return { aim, dist: d, pos: place(d).clone() };
  }

  // f: framing for this frame (see Stage.framing): fwd (+1 or -1, the way the offense attacks),
  // pts (world points that must be in view), focus (where the action is), carrier/control
  // positions, pre (before the snap).
  target(f, aspect) {
    const C = this.cal[this.mode] ?? this.cal.gameplay;
    const s = f.fwd;
    const narrow = aspect < 1.1;
    const fov = (narrow ? C.fov * 1.12 : C.fov) + this.kick * 4;
    this.wantFov = fov;
    switch (this.mode) {
      case 'broadcast': {
        // From the near sideline, high in the press box, following the action up and down the
        // field; it backs off or comes in to keep the players that matter in frame.
        const aimZ = f.focus.z * 0.5;
        const R = this.fit(f.pts, 0, -1, C.pitch, fov, aspect, { x: f.focus.x, z: aimZ }, { x: 0.8, y0: -0.72, y1: 0.55 }, 26, 90);
        this.place(R, f, C.zoom);
        break;
      }
      case 'player': {
        // Behind your Pokémon, looking the way his team is going.
        const a = f.control ?? f.focus;
        const dir = f.controlDir ?? s;
        const pitch = C.pitch, back = 12 * C.zoom;
        this.applyDist(back, f);
        this.wantLook.set(a.x + dir * 9, 0, a.z * 0.92);
        const h = Math.max(4.2, (back + 9) * Math.tan(pitch * D2R));
        this.wantPos.set(a.x - dir * back, h, a.z * 0.97);
        break;
      }
      default: {
        // Gameplay and tactical: behind the offense, fitted to the players that matter.
        const tac = this.mode === 'tactical';
        const safe = tac ? { x: 0.86, y0: -0.8, y1: 0.78 } : f.pre ? { x: 0.9, y0: -0.8, y1: 0.4 } : { x: 0.84, y0: -0.72, y1: 0.45 };
        const R = this.fit(f.pts, s, 0, C.pitch, fov, aspect, { x: f.focus.x + s * (tac ? 6 : 3), z: f.focus.z * 0.75 },
          safe, tac ? 30 : 20, tac ? 95 : 64);
        this.place(R, f, C.zoom);
      }
    }
    // Never outside the stadium bowl, never inside the seats.
    bowl(this.wantPos);
  }

  // Aim where the fit says and back off along the same line by the eased distance.
  place(R, f, zoom) {
    this.applyDist(R.dist * zoom, f);
    const k = this.dist / Math.max(1e-3, R.dist);
    this.wantLook.copy(R.aim);
    this.wantPos.subVectors(R.pos, R.aim).multiplyScalar(k).add(R.aim);
  }

  // Ease the fitted distance: it may pull back quickly (something important is leaving the
  // frame) but comes in slowly, so the view does not pump during a play.
  applyDist(d, f) {
    if (f.snap) { this.dist = d; return; }
    const out = d > this.dist;
    this.dist += (d - this.dist) * (1 - Math.exp(-this.dt * (out ? 3.2 : f.pre ? 2 : 1.1)));
  }

  update(dt, f, aspect, obstacles, snap = false) {
    this.dt = dt;
    f.snap = snap;
    this.target(f, aspect);
    // Never inside a Pokémon: lift the camera over anything close to it.
    for (const o of obstacles) {
      const d = Math.hypot(this.wantPos.x - o.x, this.wantPos.z - o.z);
      if (d < o.r + 1.6) this.wantPos.y = Math.max(this.wantPos.y, o.h + 1.8);
    }
    this.wantPos.y = Math.max(this.wantPos.y, 2.5);
    // Occlusion: a body standing close to the lens between it and the aim would fill the
    // frame; rise until the sight line clears his head.
    {
      const lx = this.wantLook.x - this.wantPos.x, lz = this.wantLook.z - this.wantPos.z, L = Math.hypot(lx, lz) || 1;
      for (const o of obstacles) {
        const ox = o.x - this.wantPos.x, oz = o.z - this.wantPos.z;
        const along = (ox * lx + oz * lz) / L;
        if (along < 0.5 || along > L * 0.4) continue;
        const across = Math.abs(ox * lz - oz * lx) / L;
        if (across > o.r + 0.6) continue;
        const y0 = this.wantPos.y, yAt = y0 + (this.wantLook.y - y0) * (along / L);
        if (yAt < o.h + 0.5) this.wantPos.y += Math.min(4, (o.h + 0.5 - yAt) / Math.max(0.2, 1 - along / L));
      }
    }
    // Critically damped springs on the lens and the aim point: smooth starts and stops, no
    // velocity jump when the shot changes. A little tighter while the ball is live.
    const w = f.pre ? 3.2 : f.shot === 'pass' ? 3 : 3.6;
    if (snap) { this.pos.copy(this.wantPos); this.look.copy(this.wantLook); this.vPos.set(0, 0, 0); this.vLook.set(0, 0, 0); }
    else { spring(this.pos, this.vPos, this.wantPos, w, dt); spring(this.look, this.vLook, this.wantLook, w * 1.3, dt); }
    this.camera.position.copy(this.pos);
    if (this.shake > 0.004) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    const fov = this.wantFov;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3)); this.camera.updateProjectionMatrix(); }
  }

  // Screen up and screen right as world directions on the turf.
  groundAxes() {
    _v.subVectors(this.look, this.pos); _v.y = 0;
    const l = Math.hypot(_v.x, _v.z) || 1;
    const ux = _v.x / l, uz = _v.z / l;
    return { up: { x: ux, z: uz }, right: { x: -uz, z: ux } };
  }
}
