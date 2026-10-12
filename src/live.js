// Live plays: one run or pass played out in real time by 22 Pokémon on the field.
// Every player moves with its own speed and acceleration; blocks, coverage, throws, catches
// and tackles are resolved from the same ratings and type matchups as the simulated games.
// Coordinates are yards in the offense's frame: x runs downfield from the line of scrimmage,
// y runs across the field (sidelines at ±SIDE). No DOM access, so tests can run it headless.
import { traitMod } from './traits.js';
import { PLAYERS, SLOT, SLOTS } from './ratings.js';
import { OFF_PLAYS, rand, randn, chance, clamp, sigmoid, eff, rep, nm, st, fumbleCheck } from './engine.js';
import { WEATHER } from './types.js';
import { bodyOf, FOOT_DEPTH, FOOT_SIDE } from './body.js';

export const SIDE = 26.65;
export const DT = 1 / 60;
export const GRAVITY = 10.7;     // yards per second squared
const MAX_TIME = 14;
const CONTACT = 1.2;
const ENGAGE = 1.15;
// A tackle is a short sequence, not an instant: contact, wrap, both bodies carried by their
// shared momentum, the carrier going down, then the whistle. Longer when a big carrier drags
// a small tackler.
const TACKLE_T = 0.5;
// The quarterback's throwing motion, from the decision to the ball leaving his hand.
const WINDUP_T = 0.24;
// The handoff exchange: the ball travels from the quarterback's hands to the back's belly.
const EXCHANGE_T = 0.2;

// Route shapes: [downfield, across] legs from the receiver's start; 'in' and 'out' are
// relative to the middle of the field. A trailing 'stop' settles the receiver.
const ROUTES = {
  go: [[30, 0]],
  slant: [[2.5, 0], [6, 'in6']],
  out: [[6, 0], [0, 'out9']],
  curl: [[11, 0], [-1.5, 'in1'], 'stop'],
  seam: [[28, 'in1']],
  post: [[11, 0], [16, 'in11']],
  corner: [[11, 0], [12, 'out9']],
  drag: [[3, 0], [1, 'in18']],
  hitch: [[5, 0], [-1, 0], 'stop'],
  flat: [[1.5, 'out7'], [2, 'out3']],
  wheel: [[0.5, 'out7'], [24, 'out1']],
  screen: [[5.5, 'out6'], 'stop'],
  check: ['block', [3, 'out5'], [2, 'out2']],
};
const PLAY_ROUTES = {
  screen: { WR1: 'go', WR2: 'go', WR3: 'hitch', TE: 'drag', RB: 'screen' },
  slant: { WR1: 'slant', WR2: 'slant', WR3: 'slant', TE: 'flat', RB: 'check' },
  out: { WR1: 'out', WR2: 'out', WR3: 'slant', TE: 'curl', RB: 'flat' },
  curl: { WR1: 'curl', WR2: 'curl', WR3: 'drag', TE: 'curl', RB: 'check' },
  te_seam: { WR1: 'go', WR2: 'curl', WR3: 'post', TE: 'seam', RB: 'check' },
  post: { WR1: 'post', WR2: 'post', WR3: 'curl', TE: 'drag', RB: 'check' },
  pa_deep: { WR1: 'go', WR2: 'post', WR3: 'curl', TE: 'seam', RB: 'block' },
};
// Formations: where the quarterback and the back line up. Every other spot comes from the
// slot table, then line splits are spread to fit each Pokémon's body (see alignLines()).
export const FORMATIONS = {
  shotgun: { name: 'Shotgun', QB: [-5, 0], RB: [-5, 2.3] },
  singleback: { name: 'Singleback', QB: null, RB: [-7, 0] }, // QB under center
};
export const PLAY_FORMATION = {
  inside_run: 'singleback', outside_run: 'singleback', qb_sneak: 'singleback', pa_deep: 'singleback',
  draw: 'shotgun', screen: 'shotgun', slant: 'shotgun', out: 'shotgun', curl: 'shotgun', te_seam: 'shotgun', post: 'shotgun',
};
export { ROUTES, PLAY_ROUTES };
const DROP = { screen: -6, short: -6.5, mid: -7.5, deep: -8.5 };
const READ_AT = { screen: 0.55, short: 0.95, mid: 1.55, deep: 2.1 };
export const RECEIVERS = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const len = (x, y) => Math.hypot(x, y);
const sgn = (v) => (v < 0 ? -1 : 1);

// ---------- setup ----------
export function createLivePlay(g, offCall, defCall, opts = {}) {
  const o = g.poss, d = 1 - o;
  const play = OFF_PLAYS[offCall];
  const lp = {
    g, o, d, offCall, defCall, play, kind: play.kind, depth: play.depth ?? null,
    t: 0, phase: 'pre', ball: { state: 'held', holder: null, x: 0, y: 0, z: 1.2 },
    spot: g.spot, goalX: 100 - g.spot, ownGoalX: -g.spot,
    players: [], off: {}, def: {}, events: [], result: null,
    user: opts.userSide ?? null, autoQB: !!opts.autoQB, control: null, manual: false,
    blitz: defCall === 'pass_blitz' ? ['OLB', 'MLB'] : defCall === 'run_blitz' ? ['MLB'] : [],
    zone: ['cover2', 'cover3', 'prevent'].includes(defCall),
    qbState: 'drop', pressure: false, thrown: null, caught: false, crossed: false, carrierTeam: 'off',
    stats: { tackler: null, cov: null, target: null, se: false, extras: [] }, readTick: 0, notes: [], tackle: null, windup: null,
    formation: PLAY_FORMATION[offCall] ?? 'shotgun', set: true, snapQueued: false, setT: 0,
  };
  const deepCap = lp.goalX + 9;
  const backCap = lp.ownGoalX - 9;
  for (const side of ['off', 'def']) {
    const ti = side === 'off' ? o : d;
    const L = g.teams[ti].lineup;
    for (const s of SLOTS.filter((x) => x.side === side)) {
      const id = L[s.key];
      if (id == null) continue;
      const p = makePlayer(g, ti, side, s.key, id, lp);
      p.x = clamp(p.x, backCap, deepCap);
      lp.players.push(p);
      lp[side][s.key] = p;
    }
  }
  alignOffense(lp);
  alignDefense(lp);
  setupDefense(lp);
  alignLines(lp);
  setupOffense(lp);
  for (const p of lp.players) p.home = { x: p.x, y: p.y };
  lp.formationIssues = validateFormation(lp);
  if (opts.from) walkIn(lp, opts.from);
  lp.ball.holder = lp.off.C ?? lp.off.QB;
  syncBall(lp);
  // Coach mode (opts.watch): the user called the play and the AI plays every Pokémon.
  if (opts.watch) lp.control = null;
  else if (lp.user === o) lp.control = lp.off.QB;
  else if (lp.user === d) lp.control = lp.def.MLB ?? lp.players.find((p) => p.side === 'def');
  return lp;
}

function makePlayer(g, ti, side, slot, id, lp) {
  const S = SLOT[slot];
  const run = lp.kind === 'run';
  const a = {
    spd: eff(g, ti, id, 'spd', { run }), str: eff(g, ti, id, 'str'), blk: eff(g, ti, id, 'blk', { runBlock: run }),
    rush: eff(g, ti, id, 'rush'), cov: eff(g, ti, id, 'cov'), tkl: eff(g, ti, id, 'tkl'), hnd: eff(g, ti, id, 'hnd'),
    acc: eff(g, ti, id, 'acc', { deep: lp.depth === 'deep' }), arm: eff(g, ti, id, 'arm'),
    strBT: eff(g, ti, id, 'str', { breakTackle: true }), hndC: eff(g, ti, id, 'hnd', { contested: true }),
    acl: eff(g, ti, id, 'acl'), agi: eff(g, ti, id, 'agi'), awr: eff(g, ti, id, 'awr'),
  };
  const P = PLAYERS[id];
  const B = bodyOf(id);
  const heavy = clamp((P.weight / 10 - 60) / 400, 0, 0.35);
  return {
    id, slot, side, ti, x: S.x, y: S.y, vx: 0, vy: 0, px: S.x, py: S.y,
    fx: side === 'off' ? 1 : -1, fy: 0, a, r: B.r, kg: Math.max(1, B.kg), h: B.height,
    // Top speed from Speed; getting there from Acceleration; braking and cutting from Agility.
    // Heavy bodies are slower to get going and to turn.
    top: 5.6 + 0.04 * a.spd, accel: (6 + 0.03 * a.spd + 0.035 * a.acl) * (1 - heavy), cut: (1.4 + a.agi / 100) * (1 - heavy * 0.8),
    role: 'idle', eng: null, engT: 0, stun: 0, cool: 0, slow: 0, wp: 0, route: null, man: null, zone: null,
    react: 0, manual: false, anim: rand(g) * 8, juke: -1, truck: -1, spin: -1, burst: 1,
    // Authoritative state the renderer, the HUD and the tests read: the action this player is
    // doing (see classify()), its contact state in a block, its target, and its acceleration.
    act: 'SET', contact: null, tgt: null, acl: 0, turnRate: 0,
  };
}

function setupDefense(lp) {
  const D = lp.def, call = lp.defCall;
  const cap = (x) => Math.min(x, lp.goalX + 8);
  if (call === 'goal_line') {
    for (const k of ['OLB', 'MLB']) if (D[k]) D[k].x = 2.5;
    for (const k of ['CB1', 'CB2', 'CB3']) if (D[k]) D[k].x = 3.5;
    if (D.SS) D.SS.x = 5; if (D.FS) D.FS.x = 7;
  }
  if (call === 'man_press') for (const k of ['CB1', 'CB2', 'CB3']) if (D[k]) D[k].x = 1.6;
  if (call === 'run_blitz' && D.MLB) D.MLB.x = 3.2;
  if (call === 'cover2') { if (D.FS) { D.FS.x = 14; D.FS.y = -12; } if (D.SS) { D.SS.x = 14; D.SS.y = 12; } }
  if (call === 'cover3') { if (D.FS) { D.FS.x = 15; D.FS.y = 0; } for (const k of ['CB1', 'CB2']) if (D[k]) D[k].x = 8; }
  if (call === 'prevent') for (const p of Object.values(D)) if (!['LE', 'DE', 'DT1', 'DT2'].includes(p.slot)) p.x += 6;
  for (const p of Object.values(D)) p.x = Math.max(frontX(p), cap(p.x));

  const O = lp.off;
  const covR = (r, c) => {
    const route = lp.depth === 'deep' ? r.a.spd * 0.6 + r.a.hnd * 0.25 + r.a.acc * 0.15 : r.a.spd * 0.35 + r.a.hnd * 0.3 + r.a.acc * 0.35;
    const R = rep(r.id, route, c.id, c.a.cov);
    return clamp(0.12 + R.diff * 0.011, 0.02, 0.5);
  };
  const man = { WR1: 'CB1', WR2: 'CB2', WR3: 'CB3', TE: 'SS', RB: !lp.blitz.includes('OLB') ? 'OLB' : !lp.blitz.includes('MLB') ? 'MLB' : null };
  for (const [rk, ck] of Object.entries(man)) {
    const c = D[ck], r = O[rk];
    if (c && r) { c.man = r; c.lag = covR(r, c) - (call === 'man_press' ? 0.05 : 0); }
  }
  for (const p of Object.values(D)) {
    if (['LE', 'DE', 'DT1', 'DT2'].includes(p.slot) || lp.blitz.includes(p.slot)) p.role = 'rush';
    else p.role = 'cover';
  }
  if (lp.zone) {
    const g = lp.goalX;
    const z = (x, y, r) => ({ x: Math.min(x, g + 7), y, r });
    const zones = call === 'cover2'
      ? { CB1: z(5, -19, 7), CB2: z(5, 19, 7), CB3: z(7, -9, 6), FS: z(18, -12, 12), SS: z(18, 12, 12), OLB: z(6, 9, 6), MLB: z(7, 0, 6) }
      : call === 'cover3'
        ? { CB1: z(17, -17, 10), CB2: z(17, 17, 10), FS: z(21, 0, 12), CB3: z(6, -14, 7), SS: z(6, 14, 7), OLB: z(7, 6, 6), MLB: z(7, -4, 6) }
        : { CB1: z(20, -17, 12), CB2: z(20, 17, 12), FS: z(28, 0, 14), CB3: z(13, -10, 9), SS: z(13, 10, 9), OLB: z(9, 5, 7), MLB: z(9, -5, 7) };
    for (const [k, zn] of Object.entries(zones)) if (D[k] && D[k].role === 'cover') { D[k].zone = zn; D[k].lag = clamp(0.32 - (D[k].a.cov - 60) * 0.007, 0.06, 0.5); }
  }
}

function setupOffense(lp) {
  const O = lp.off, play = lp.play;
  const rbBlocks = lp.blitz.length > 0 && lp.offCall !== 'screen';
  for (const k of ['LT', 'LG', 'C', 'RG', 'RT']) if (O[k]) O[k].role = lp.kind === 'run' ? 'runblock' : 'passblock';
  if (lp.kind === 'run') {
    const dir = play.dir;
    lp.carrier = dir === 'sneak' ? O.QB : O.RB;
    // Inside runs hit the A or B gap between the actual linemen, outside runs the edge.
    const gap = (a, b) => (O[a] && O[b] ? (O[a].y + O[b].y) / 2 : null);
    const side = chance(lp.g, 0.5) ? -1 : 1;
    const inside = (k) => (side < 0 ? gap(...[['LG', 'C'], ['LT', 'LG']][k]) : gap(...[['C', 'RG'], ['RG', 'RT']][k])) ?? side * (k ? 2.7 : 0.9);
    lp.holeY = dir === 'outside' ? side * 9 : dir === 'sneak' ? 0 : inside(chance(lp.g, 0.55) ? 0 : 1);
    if (dir === 'draw') lp.holeY = inside(1);
    // Each blocker takes the nearest defender in front of him.
    const bl = ['LT', 'LG', 'C', 'RG', 'RT', 'TE'].map((k) => O[k]).filter(Boolean);
    const df = ['LE', 'DE', 'DT1', 'DT2', 'OLB', 'MLB'].map((k) => lp.def[k]).filter(Boolean);
    const pairs = [];
    for (const b of bl) for (const d of df) pairs.push([Math.abs(b.y - d.y) + Math.max(0, d.x - 2) * 0.5, b, d]);
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [, b, d] of pairs) {
      if (b.assign || used.has(d)) continue;
      b.assign = d; b.role = 'runblock'; used.add(d);
    }
    for (const [w, c] of [['WR1', 'CB1'], ['WR2', 'CB2'], ['WR3', 'CB3']]) if (O[w]) { O[w].role = 'stalk'; O[w].assign = lp.def[c]; }
    if (O.QB) O.QB.role = dir === 'sneak' ? 'carrier' : 'handoff';
    if (O.RB) O.RB.role = dir === 'sneak' ? 'runblock' : 'runner';
    lp.handAt = dir === 'draw' ? 1.15 : dir === 'sneak' ? 0 : 0.42;
    if (dir === 'sneak') { lp.handAt = 0; }
    return;
  }
  const routes = PLAY_ROUTES[lp.offCall];
  for (const k of RECEIVERS) {
    const p = O[k];
    if (!p) continue;
    let r = routes[k];
    if (k === 'RB' && rbBlocks) r = 'block';
    if (r === 'block') { p.role = 'passblock'; continue; }
    p.role = 'route';
    p.route = buildRoute(lp, p, r);
    p.routeName = r;
  }
  if (O.QB) O.QB.role = 'qb';
  lp.dropX = DROP[lp.depth] + (play.pa ? -0.5 : 0);
  lp.readAt = READ_AT[lp.depth] + (play.pa ? 0.45 : 0);
  lp.eligible = RECEIVERS.filter((k) => O[k] && O[k].role === 'route');
}

// ---------- formations ----------
// Real football alignments, measured from the ball in yards. The neutral zone is the length of
// the ball; each lineman sets his drawn body just behind his side of it, so the two lines face
// each other across a visible gap. Linemen are spaced by their collision capsules plus a
// split, so a Snorlax takes more of the line than a Pikachu but five linemen still span about
// eight yards, not twenty. Seven offensive players are on the line (five linemen, the tight
// end and the split end); the flanker and slot are a yard off it.
export const NEUTRAL = 0.15;     // half the neutral zone
const SPLIT = 0.4;               // gap between linemen's capsules
const lineX = (p) => -(p.r * FOOT_DEPTH + NEUTRAL);   // offense, on the line
const offX = (p) => lineX(p) - 1.1;                   // offense, a yard off the line
const frontX = (p) => p.r * FOOT_DEPTH + NEUTRAL;      // defensive front

function alignOffense(lp) {
  const O = lp.off, F = FORMATIONS[lp.formation];
  const C = O.C;
  if (C) { C.x = lineX(C); C.y = 0; }
  let yL = C ? -C.r : 0, yR = C ? C.r : 0;
  for (const [l, r] of [['LG', 'RG'], ['LT', 'RT']]) {
    if (O[l]) { O[l].y = yL - SPLIT - O[l].r; O[l].x = lineX(O[l]); yL = O[l].y - O[l].r; }
    if (O[r]) { O[r].y = yR + SPLIT + O[r].r; O[r].x = lineX(O[r]); yR = O[r].y + O[r].r; }
  }
  // Tight end attached outside the right tackle.
  if (O.TE) { O.TE.y = yR + SPLIT + 0.25 + O.TE.r; O.TE.x = lineX(O.TE); yR = O.TE.y + O.TE.r; }
  if (O.QB) {
    if (F.QB) { O.QB.x = F.QB[0]; O.QB.y = F.QB[1]; }
    else { O.QB.x = (C ? C.x - C.r : -1) - O.QB.r - 0.15; O.QB.y = 0; } // under center
  }
  if (O.RB && F.RB) {
    if (lp.formation === 'shotgun' && O.QB) { O.RB.x = O.QB.x; O.RB.y = O.QB.y + O.QB.r + O.RB.r + 1.0; }
    else { O.RB.x = Math.min(F.RB[0], (O.QB?.x ?? -5) - ((O.QB?.r ?? 0.6) + O.RB.r) * FOOT_DEPTH - 2.2); O.RB.y = F.RB[1]; }
  }
  // Receivers: the split end on the line, the flanker and the slot off it, all outside the
  // formation with room to release.
  if (O.WR1) { O.WR1.x = lineX(O.WR1); O.WR1.y = Math.min(SLOT.WR1.y, yL - 6); }
  if (O.WR3) { O.WR3.x = offX(O.WR3); O.WR3.y = Math.min(SLOT.WR3.y, yL - 3.5); }
  if (O.WR2) { O.WR2.x = offX(O.WR2); O.WR2.y = Math.max(SLOT.WR2.y, yR + 6); }
}

// The 4-3 front lines up across from the offense: tackles shading the guards, ends outside
// the tackles, linebackers over the box, corners over the wideouts, safeties deep.
function alignDefense(lp) {
  const O = lp.off, D = lp.def;
  const front = (p, y) => { if (!p) return; p.x = frontX(p); p.y = y; };
  front(D.DT1, O.RG ? O.RG.y - O.RG.r * 0.35 : 1.4);
  front(D.DT2, O.LG ? O.LG.y + O.LG.r * 0.35 : -1.4);
  const te = O.TE && O.TE.y > (O.RT?.y ?? 0) ? O.TE : O.RT;
  front(D.LE, te ? te.y + te.r * 0.6 + (D.LE?.r ?? 0.6) * 0.6 : 5.5);
  front(D.DE, O.LT ? O.LT.y - O.LT.r * 0.6 - (D.DE?.r ?? 0.6) * 0.6 : -5.5);
  const over = (d, o, depth, inside = 0.6) => { if (!d || !o) return; d.y = o.y - Math.sign(o.y || 1) * inside; d.x = depth; };
  over(D.CB1, O.WR1, SLOT.CB1.x);
  over(D.CB2, O.WR2, SLOT.CB2.x);
  over(D.CB3, O.WR3, SLOT.CB3.x);
  if (D.OLB) { D.OLB.x = SLOT.OLB.x; D.OLB.y = (te?.y ?? 4) - 0.5; }
  if (D.MLB) { D.MLB.x = SLOT.MLB.x; D.MLB.y = SLOT.MLB.y; }
}

// Nobody starts inside anybody else. Teammates are pushed apart across the field (linemen
// keep their depth), and anyone crowding the line from the other side backs off it. Spacing
// is by the drawn bodies (capsule plus spill) with a little air between them.
function alignLines(lp) {
  const ps = lp.players;
  const lineman = (p) => ['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DE', 'DT1', 'DT2', 'TE'].includes(p.slot);
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      // Under center the quarterback's hands are on the center: that pair only needs to not touch.
      const exchange = a.side === b.side && a.side === 'off' && (a.slot === 'C' && b.slot === 'QB' || a.slot === 'QB' && b.slot === 'C');
      const need = exchange ? a.r + b.r + 0.1 : a.side === b.side ? (a.r + b.r) * FOOT_SIDE + 0.2 : (a.r + b.r) * FOOT_DEPTH + 0.25;
      const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
      if (d >= need) continue;
      moved = true;
      if (a.side !== b.side) {
        // Back the defender off the ball.
        const dfd = a.side === 'def' ? a : b, o = dfd === a ? b : a;
        dfd.x = o.x + Math.sqrt(Math.max(0, need * need - (dfd.y - o.y) ** 2)) + 0.02;
        continue;
      }
      const push = (need - d) / 2 + 0.01;
      if (lineman(a) && lineman(b) || Math.abs(dy) > Math.abs(dx) * 0.5 || d < 0.01) {
        const s = dy === 0 ? (a.y <= 0 ? -1 : 1) : sgn(dy);
        // The center stays over the ball; whoever crowds him moves the whole way.
        const ka = a.slot === 'C' && a.side === 'off' ? 0 : b.slot === 'C' && b.side === 'off' ? 2 : 1;
        a.y -= s * push * ka; b.y += s * push * (2 - ka);
      } else {
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
    }
    for (const p of ps) p.y = clamp(p.y, -SIDE + p.r + 0.4, SIDE - p.r - 0.4);
    if (!moved) break;
  }
  for (const p of ps) if (p.side === 'def') p.x = Math.max(p.x, frontX(p));
}

// The formation check run before every snap. Returns the list of problems (empty when the
// alignment is legal and clean): eleven a side, seven on the line with the quarterback, back
// and receivers where they belong, both lines clearly set, no two bodies overlapping, everyone
// facing the right way and inside the field.
export function validateFormation(lp) {
  const issues = [];
  const off = lp.players.filter((p) => p.side === 'off'), def = lp.players.filter((p) => p.side === 'def');
  if (off.length !== 11) issues.push(`offense has ${off.length} players`);
  if (def.length !== 11) issues.push(`defense has ${def.length} players`);
  const O = lp.off, D = lp.def;
  const onLine = (p) => p.x + p.r * FOOT_DEPTH > -NEUTRAL - 0.6;
  const line = off.filter(onLine);
  if (line.length !== 7) issues.push(`${line.length} offensive players on the line (need 7: ${line.map((p) => p.slot).join(' ')})`);
  for (const k of ['LT', 'LG', 'C', 'RG', 'RT']) if (O[k] && !onLine(O[k])) issues.push(`${k} is off the line`);
  const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => O[k]).filter(Boolean);
  for (let i = 1; i < ol.length; i++) if (!(ol[i].y > ol[i - 1].y)) issues.push(`line order broken at ${ol[i].slot}`);
  if (O.C && Math.abs(O.C.y) > 0.05) issues.push('center is not over the ball');
  if (O.QB) {
    const depth = -O.QB.x;
    if (lp.formation === 'shotgun' ? Math.abs(depth - 5) > 0.6 : depth > 3.5 || Math.abs(O.QB.y) > 0.3) issues.push(`quarterback at ${depth.toFixed(1)} yards`);
  }
  if (O.RB && O.QB && O.RB.x > O.QB.x + 0.05) issues.push('running back is in front of the quarterback');
  if (O.RB && -O.RB.x < 4) issues.push('running back is not in the backfield');
  const wrs = ['WR1', 'WR2', 'WR3'].map((k) => O[k]).filter(Boolean);
  for (const w of wrs) if (Math.abs(w.y) < 9) issues.push(`${w.slot} is not split out`);
  for (let i = 0; i < wrs.length; i++) for (let j = i + 1; j < wrs.length; j++) if (Math.abs(wrs[i].y - wrs[j].y) < 4) issues.push(`${wrs[i].slot} and ${wrs[j].slot} are stacked`);
  for (const k of ['LE', 'DE', 'DT1', 'DT2']) if (D[k] && D[k].x - D[k].r * FOOT_DEPTH > NEUTRAL + 1.2) issues.push(`${k} is off the line`);
  for (const p of lp.players) {
    if (p.side === 'off' && p.x + p.r > -NEUTRAL + 0.01) issues.push(`${p.slot} is offside`);
    if (p.side === 'def' && p.x + 0.01 < frontX(p)) issues.push(`${p.slot} is in the neutral zone`);
    if (Math.abs(p.y) > SIDE - p.r) issues.push(`${p.slot} is out of bounds`);
    if (p.x > lp.goalX + 10 || p.x < lp.ownGoalX - 10) issues.push(`${p.slot} is behind the end line`);
    if (Math.sign(p.fx) !== (p.side === 'off' ? 1 : -1)) issues.push(`${p.slot} faces the wrong way`);
  }
  const ps = lp.players;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (dist(a, b) < a.r + b.r - 1e-3) issues.push(`${a.side} ${a.slot} overlaps ${b.side} ${b.slot}`);
  }
  return issues;
}

// Between plays: everyone starts where they finished the last play (or in a huddle when the
// ball moved far) and jogs to the new spot. from: Map "team:id" -> world { ax, az }.
function walkIn(lp, from) {
  const los = lp.o === 0 ? lp.spot : 100 - lp.spot, dir = lp.o === 0 ? 1 : -1;
  const huddle = { off: { x: -10, y: 0, n: 0 }, def: { x: 8, y: 0, n: 0 } };
  for (const p of lp.players) {
    const f = from.get(`${p.ti}:${p.id}`);
    let x, y;
    if (f) { x = (f.ax - los) * dir; y = f.az * dir; }
    if (!f || Math.hypot(x - p.home.x, y - p.home.y) > 24) {
      // A huddle a few yards off the ball.
      const H = huddle[p.side], k = H.n++, ang = (k / 11) * Math.PI * 2;
      x = H.x + Math.cos(ang) * 2.6; y = H.y + Math.sin(ang) * 2.6;
    }
    p.x = x; p.y = clamp(y, -SIDE - 3, SIDE + 3);
    // Down on the turf after the last play: get up before jogging over.
    if (f?.down) p.recover = 0.9;
  }
  lp.set = lp.players.every((p) => Math.hypot(p.x - p.home.x, p.y - p.home.y) < 0.3 && !(p.recover > 0));
  if (lp.set) for (const p of lp.players) { p.x = p.home.x; p.y = p.home.y; }
}

// Pre-snap: players jog to their spots, then settle.
function lineUp(lp) {
  if (lp.set) return;
  lp.setT += DT;
  let done = true;
  for (const p of lp.players) {
    const d = dist(p, p.home);
    if (p.recover > 0) { p.recover = Math.max(0, p.recover - DT); if (p.recover > 0.25) { done = false; continue; } }
    if (d > 0.12) {
      done = false;
      // Jog, then hurry if the play clock is getting on; walk around anyone in the way.
      seek(p, p.home, lp.setT > 6 ? 1 : d > 6 ? 0.85 : 0.6, 1.4);
      p.aim = null;
      const [vx, vy] = d > 1.5 ? steer(lp, p, p.want.vx, p.want.vy) : [p.want.vx, p.want.vy];
      kin(p, vx, vy, p.top, DT);
    } else { p.vx *= 0.6; p.vy *= 0.6; p.x += (p.home.x - p.x) * 0.2; p.y += (p.home.y - p.y) * 0.2; }
  }
  separate(lp);
  if (done || lp.setT > 12) {
    for (const p of lp.players) { p.x = p.home.x; p.y = p.home.y; p.vx = 0; p.vy = 0; p.fx = p.side === 'off' ? 1 : -1; p.fy = 0; }
    lp.set = true;
  }
}

function buildRoute(lp, p, name) {
  const spec = ROUTES[name];
  const inward = p.y === 0 ? (chance(lp.g, 0.5) ? 1 : -1) : -sgn(p.y);
  let x = p.x, y = p.y;
  const pts = [];
  for (const leg of spec) {
    if (leg === 'stop') { if (pts.length) pts[pts.length - 1].stop = true; continue; }
    if (leg === 'block') { pts.push({ block: 1.1 }); continue; }
    const [dx, dy] = leg;
    let across = 0;
    if (typeof dy === 'string') {
      const m = /^(in|out)(\d+)$/.exec(dy);
      across = (m[1] === 'in' ? inward : -inward) * Number(m[2]);
    } else across = dy;
    x = Math.min(x + dx, lp.goalX + 8.5);
    y = clamp(y + across, -SIDE + 1.5, SIDE - 1.5);
    pts.push({ x, y });
  }
  return pts;
}

// ---------- main step ----------
export function snap(lp) {
  if (lp.phase !== 'pre') return;
  // Still walking up to the line: snap as soon as everyone is set.
  if (!lp.set) { lp.snapQueued = true; return; }
  lp.phase = 'live';
  lp.t = 0;
  const qb = lp.off.QB, c = lp.off.C;
  if (lp.formation === 'shotgun' && c && qb) {
    // The ball flies back from the center to the quarterback.
    lp.ball = { state: 'snap', holder: null, x: c.x + 0.4, y: c.y, z: 0.3, from: { x: c.x + 0.4, y: c.y }, t0: 0, T: 0.22 + dist(c, qb) * 0.02 };
  } else {
    // Under center: the ball comes up from the center's hands into the quarterback's.
    lp.ball.holder = qb;
    if (c && qb) lp.ball.xfer = { from: c, to: qb, t0: 0, T: 0.12, snap: true, at: { x: lp.ball.x, y: lp.ball.y, z: lp.ball.z ?? 0.17 } };
  }
  if (lp.kind === 'run' && lp.play.dir === 'sneak') setCarrier(lp, qb);
  // Front responsibilities: each down lineman owns the gap he is shaded toward; the widest
  // rusher on each side keeps contain.
  const front = lp.players.filter((p) => p.side === 'def' && p.role === 'rush');
  for (const p of front) if (['LE', 'DE', 'DT1', 'DT2'].includes(p.slot)) p.gapY = p.y + sgn(p.y || 0.01) * 0.6;
  const wide = (s) => front.filter((p) => sgn(p.y) === s).sort((a, b) => Math.abs(b.y) - Math.abs(a.y))[0];
  for (const s of [-1, 1]) { const w = wide(s); if (w) w.edge = s; }
  event(lp, 'snap', '', c ?? qb, qb);
}

// The play's state for the game loop: PRE_SNAP, SNAP (the ball on its way from the center
// to the quarterback, or the exchange under center), PLAY_ACTIVE, PLAY_DEAD. The app adds
// RESULT and NEXT_DOWN between plays.
export function playState(lp) {
  if (lp.phase === 'pre') return 'PRE_SNAP';
  if (lp.phase === 'dead') return 'PLAY_DEAD';
  return lp.ball.state === 'snap' || lp.t < 0.2 ? 'SNAP' : 'PLAY_ACTIVE';
}

// Is the ball in the quarterback's hands yet?
function qbHas(lp) { return lp.ball.state === 'held' && lp.ball.holder === lp.off.QB; }

export function step(lp, input = null) {
  // Last step's positions, so the renderer can interpolate between fixed steps.
  for (const p of lp.players) { p.px = p.x; p.py = p.y; p.psp = Math.hypot(p.vx, p.vy); p.pfx = p.fx; p.pfy = p.fy; }
  const b = lp.ball; b.px = b.x; b.py = b.y; b.pz = b.z;
  if (lp.phase === 'pre') {
    animIdle(lp, DT);
    lineUp(lp);
    for (const p of lp.players) { orient(lp, p); classify(lp, p); }
    if (lp.set && lp.snapQueued) snap(lp);
    return;
  }
  if (lp.phase !== 'live') {
    // After the whistle: everyone pulls up, the tackled pair stays down, a loose ball settles.
    lp.tDead = (lp.tDead ?? 0) + DT;
    for (const p of lp.players) {
      if (!p.downed) slowDown(p, DT, 3.5); else { p.vx *= 0.8; p.vy *= 0.8; }
      // Pull up at the bench area rather than running into it.
      if (Math.abs(p.y) > SIDE + 2) { p.vy *= 0.5; p.y = clamp(p.y, -SIDE - 2.5, SIDE + 2.5); }
    }
    looseBall(lp);
    syncBall(lp);
    for (const p of lp.players) { orient(lp, p); classify(lp, p); }
    return;
  }
  lp.t += DT;
  if (input) applyInput(lp, input);

  // Run play handoff: the exchange starts when the quarterback and the back actually meet.
  if (lp.kind === 'run' && !lp.carrierSet && lp.t >= lp.handAt && qbHas(lp)) {
    const rb = lp.carrier, qb = lp.off.QB;
    if (rb && dist(rb, qb) < rb.r + qb.r + 0.75) startExchange(lp, qb, rb);
  }
  // AI quarterback, then the throwing motion
  if (lp.kind === 'pass' && !lp.thrown && !lp.windup) coverageRead(lp);
  if (lp.kind === 'pass' && !lp.thrown && !lp.windup && lp.qbState !== 'done') qbBrain(lp);
  windup(lp);

  for (const p of lp.players) think(lp, p);
  for (const p of lp.players) move(lp, p, DT);
  separate(lp);
  blocks(lp);
  separate(lp, 1);
  wrapHold(lp);
  for (const p of lp.players) orient(lp, p);
  snapFlight(lp);
  ballFlight(lp);
  if (lp.phase === 'live' && !lp.tackle) contacts(lp);
  if (lp.phase === 'live') tackleStep(lp);
  if (lp.phase === 'live') boundaries(lp);
  looseBall(lp);
  syncBall(lp);
  for (const p of lp.players) classify(lp, p);
  if (lp.phase === 'live' && lp.t > MAX_TIME) whistle(lp, 'time');
}

// ---------- the authoritative action state ----------
// What each player is doing this step, decided by the simulation from its real state. The
// renderer picks poses and clips from it, the debug view prints it and the tests check it.
export const ACTIONS = ['IDLE', 'WALK', 'READY', 'SNAP_REACT', 'ACCEL', 'RUN', 'SPRINT', 'DECEL', 'TURN', 'BACKPEDAL',
  'BLOCK', 'BLOCKED', 'SHED', 'TACKLE', 'TACKLED', 'REACH', 'CATCH', 'THROW', 'HANDOFF', 'CARRY', 'FALL', 'DOWN', 'RECOVER', 'CELEBRATE', 'STUMBLE'];
function classify(lp, p) {
  const sp = Math.hypot(p.vx, p.vy);
  // Acceleration along the motion and turn rate, smoothed over a few steps.
  const a = (sp - (p.psp ?? sp)) / DT;
  p.acl += (a - p.acl) * 0.25;
  const cr = (p.pfx ?? p.fx) * p.fy - (p.pfy ?? p.fy) * p.fx;
  p.turnRate += (Math.asin(clamp(cr, -1, 1)) / DT - p.turnRate) * 0.25;
  p.act = actionOf(lp, p, sp);
}
function actionOf(lp, p, sp) {
  if (lp.phase === 'pre') {
    if (p.recover > 0) return 'RECOVER';
    if (sp > 2.2) return 'RUN';
    if (sp > 0.3) return 'WALK';
    return lp.set ? 'READY' : 'IDLE';
  }
  if (lp.phase === 'dead') {
    if (p.downed) return 'DOWN';
    if (lp.end?.how === 'td' && lp.carrier && p.ti === lp.carrier.ti && dist(p, lp.carrier) < 14) return 'CELEBRATE';
    return sp > 1.2 ? 'DECEL' : 'IDLE';
  }
  const T = lp.tackle;
  if (T && T.c === p) return 'TACKLED';
  if (T && T.q === p) return 'TACKLE';
  if (p.stun > 0 && !p.eng && p.stunFall) return 'STUMBLE';
  if (lp.windup && p === lp.off.QB) return 'THROW';
  if (lp.thrown && p === lp.off.QB && lp.t - lp.thrown.t0 < 0.3) return 'THROW';
  const X = lp.ball.xfer;
  if (X && !X.snap && (X.from === p || X.to === p)) return 'HANDOFF';
  if (p.caughtAt != null && lp.t - p.caughtAt < 0.4) return 'CATCH';
  const F = lp.thrown;
  if (F && lp.ball.state === 'air' && (F.target === p || (p.side === 'def' && Math.hypot(F.tx - p.x, F.ty - p.y) < 1.8)) && F.t0 + F.T - lp.t < 0.5) return 'REACH';
  if (p.eng) {
    if (p.contact === 'SHEDDING') return p.side === lp.carrierTeam ? 'BLOCKED' : 'SHED';
    return p.side === lp.carrierTeam ? 'BLOCK' : 'BLOCKED';
  }
  if (lp.t < 0.3 && sp > 0.2) return 'SNAP_REACT';
  if (lp.ball.state === 'held' && lp.ball.holder === p && !(p === lp.off.QB && lp.kind === 'pass' && !lp.carrierSet)) return 'CARRY';
  if (sp < 0.35) return 'IDLE';
  const fwd = p.vx * p.fx + p.vy * p.fy;
  if (fwd < -0.3 * sp) return 'BACKPEDAL';
  if (Math.abs(p.turnRate) > 3.2 && sp > 1.5) return 'TURN';
  if (p.acl < -4) return 'DECEL';
  if (p.acl > 3 && sp < p.top * 0.8) return 'ACCEL';
  return sp > p.top * 0.86 ? 'SPRINT' : 'RUN';
}

// Events drive the HUD and the 3D animations: `who` is the player doing it, `other` the one
// it is done to (the tackler and the ball carrier, the receiver and the quarterback...).
function event(lp, kind, text = '', who = null, other = null) { lp.events.push({ t: lp.t, kind, text, who, other }); }

function setCarrier(lp, p) {
  for (const q of lp.players) q.carrier = false;
  lp.carrierSet = true;
  lp.carrier = p;
  p.carrier = true;
  p.role = 'carrier';
  if (p.eng) unengage(p);
  lp.ball.state = 'held';
  lp.ball.holder = p;
  lp.carrierTeam = p.side;
  lp.carrierAt = lp.t;
  p.runFrom = p.x;
  // The user takes over the ball carrier on their own team.
  if (lp.user != null && p.ti === lp.user && lp.control !== p) { lp.control = p; lp.manual = false; }
  // Everyone switches to the ball once it is handed off, caught or picked.
  for (const q of lp.players) {
    if (q === p) continue;
    if (q.side !== p.side) { q.role = 'pursue'; q.react = q.eng ? 0 : 0.1 + (100 - (q.a.spd + q.a.awr) / 2) * 0.003; }
    else if (q.role === 'route' || q.role === 'qb' || q.role === 'handoff' || q.role === 'idle' || q.role === 'carrier') {
      q.role = q.side === 'off' && p.side === 'off' && lp.kind === 'run' && q.slot === 'QB' ? 'fake' : 'escort';
    }
  }
}

function applyInput(lp, inp) {
  const c = lp.control;
  if (inp.switchTo === 'ball' && lp.user === lp.d) {
    const target = lp.thrown ? { x: lp.thrown.tx, y: lp.thrown.ty } : lp.ball;
    let best = null;
    for (const p of lp.players) if (p.side === (lp.carrierTeam === 'def' ? 'off' : 'def') && p.ti === lp.user && (!best || dist(p, target) < dist(best, target))) best = p;
    if (best) { lp.control = best; lp.manual = false; }
  }
  if (!c) return;
  const mag = len(inp.mx ?? 0, inp.my ?? 0);
  if (mag > 0.1) lp.manual = true;
  c.input = { mx: mag > 0.1 ? inp.mx / Math.max(1, mag) : 0, my: mag > 0.1 ? inp.my / Math.max(1, mag) : 0, sprint: !!inp.sprint };
  if (c.carrier) {
    if (inp.juke) startMove(lp, c, 'juke');
    if (inp.truck) startMove(lp, c, 'truck');
    if (inp.spin) startMove(lp, c, 'spin');
  }
  if (inp.dive && c.dive == null) { c.dive = 0.3; }
  if (inp.throwTo && lp.kind === 'pass' && !lp.thrown && lp.ball.holder === lp.off.QB && lp.qbState !== 'run') {
    const r = lp.off[inp.throwTo];
    if (r && r.role === 'route') throwTo(lp, r);
  }
  if (inp.throwAway && lp.kind === 'pass' && !lp.thrown && lp.ball.holder === lp.off.QB && lp.qbState !== 'run') throwAway(lp);
}

// Ball-carrier moves: a short active window, then a shared cooldown. How well each one works
// comes from the carrier's ratings against the tackler's (see contacts()).
const MOVES = { juke: 0.35, spin: 0.45, truck: 0.4 };
function startMove(lp, c, kind) {
  if (c.juke > -0.9 || c.spin > -0.9 || c.truck > -0.9) return false;
  c[kind] = MOVES[kind];
  if (kind === 'spin') c.spinDir = chance(lp.g, 0.5) ? 1 : -1;
  event(lp, kind, '', c);
  return true;
}

// ---------- decisions ----------
const inTackle = (lp, p) => !!lp.tackle && (lp.tackle.c === p || lp.tackle.q === p);
function think(lp, p) {
  p.want = null;
  p.aim = null;
  if (p.stun > 0 || inTackle(lp, p)) return;
  if (p === lp.control && lp.manual) { manualWant(lp, p); return; }
  const c = lp.carrierSet ? lp.carrier : null;
  // A tackle is under way: everyone else closes on the pile and pulls up around it instead of
  // running into it.
  if (lp.tackle && (p.role === 'pursue' || p.role === 'escort' || p.role === 'cover' || p.role === 'rush')) {
    if (p.eng) return;
    const k = lp.tackle.c, ring = k.r + p.r + 0.9 + (p.slot.charCodeAt(0) % 3) * 0.35;
    const dx = p.x - k.x, dy = p.y - k.y, d = len(dx, dy) || 1;
    return seek(p, { x: k.x + (dx / d) * ring, y: k.y + (dy / d) * ring }, 0.55, 1.5);
  }
  switch (p.role) {
    case 'qb': return qbMove(lp, p);
    case 'handoff': {
      // Open to the back and meet him at the mesh point; if he is late, go to him.
      const rb = lp.carrier;
      if (!lp.carrierSet && rb && lp.t > lp.handAt + 0.15) return seek(p, rb, 0.55, 0.6);
      const mesh = { x: -4.2, y: lp.holeY > 0 ? 0.6 : -0.6 };
      return seek(p, lp.carrierSet ? { x: -6, y: -lp.holeY * 0.3 } : mesh, 0.6);
    }
    case 'fake': return seek(p, { x: -7, y: -sgn(lp.holeY) * 4 }, 0.5);
    case 'runner': {
      // Before the handoff: head for the mesh point, then aim at the hole.
      if (lp.play.dir === 'draw' && lp.t < lp.handAt - 0.35) return seek(p, { x: -6.5, y: 1 }, 0.2);
      return seek(p, { x: -3.5, y: lp.holeY * 0.35 }, 0.8);
    }
    case 'carrier': return carrierWant(lp, p);
    case 'route': return routeWant(lp, p);
    case 'passblock': return passBlockWant(lp, p);
    case 'runblock': return runBlockWant(lp, p);
    case 'stalk': return stalkWant(lp, p);
    case 'escort': return escortWant(lp, p, c);
    case 'rush': return rushWant(lp, p);
    case 'cover': return coverWant(lp, p);
    case 'pursue': return pursueWant(lp, p, c);
    default: return null;
  }
}

function manualWant(lp, p) {
  const i = p.input ?? { mx: 0, my: 0 };
  const sprint = i.sprint ? 1 : 0.88;
  p.want = { vx: i.mx * p.top * sprint, vy: i.my * p.top * sprint };
}

function seek(p, pt, frac = 1, arrive = 1.2) {
  const dx = pt.x - p.x, dy = pt.y - p.y;
  const d = len(dx, dy);
  if (d < 0.05) { p.want = { vx: 0, vy: 0 }; return; }
  const sp = p.top * frac * Math.min(1, d / arrive);
  p.want = { vx: (dx / d) * sp, vy: (dy / d) * sp };
}

function qbMove(lp, p) {
  if (lp.qbState === 'run') return carrierWant(lp, p);
  const pa = lp.play.pa && lp.t < 0.7;
  const target = { x: lp.dropX, y: pa ? 0.8 : 0 };
  if (lp.t < 1.1 || pa) return seek(p, target, 0.75, 0.8);
  // Slide away from the nearest free rusher.
  let threat = null, td = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng && q.role === 'rush') { const dd = dist(q, p); if (dd < td) { td = dd; threat = q; } }
  if (threat && td < 4) {
    const ax = p.x - threat.x, ay = p.y - threat.y, l = len(ax, ay) || 1;
    p.want = { vx: (ax / l) * 0.4 * p.top + 1.2, vy: (ay / l) * p.top * 0.75 };
  } else seek(p, { x: lp.dropX + 1, y: p.y * 0.9 }, 0.3);
}

// How open each eligible receiver is right now, measured where the ball would meet him if it
// were thrown this instant: the nearest defender's distance from that spot. OPEN, CONTESTED or
// COVERED; the HUD colors the throw icons from it and the quarterback reads it.
export const OPENNESS = ['OPEN', 'CONTESTED', 'COVERED'];
function coverageRead(lp) {
  const qb = lp.off.QB;
  if (!qb || lp.kind !== 'pass') return;
  if ((lp.covTick = (lp.covTick ?? 0) - DT) > 0) return;
  lp.covTick = 0.1;
  for (const k of lp.eligible ?? []) {
    const r = lp.off[k];
    if (!r) continue;
    if (r.role !== 'route' || (r.route?.[0]?.block && r.wp === 0)) { r.open = null; r.openState = null; continue; }
    const T = dist(qb, r) / throwSpeed(qb) + WINDUP_T;
    const px = r.x + r.vx * T, py = r.y + r.vy * T;
    let open = 99;
    for (const q of lp.players) if (q.side === 'def') open = Math.min(open, Math.hypot(q.x + q.vx * T * 0.6 - px, q.y + q.vy * T * 0.6 - py) - q.r * 0.5);
    r.open = open; r.lead = { x: px, y: py };
    r.openState = open >= 2.6 ? 'OPEN' : open >= 1.2 ? 'CONTESTED' : 'COVERED';
  }
}

// The quarterback's progression: the play's reads in order (its primary target first), each
// given a beat before his eyes move on; a wide-open man anywhere in his vision is taken early,
// and under pressure he takes the best he has or checks down.
function qbBrain(lp) {
  const qb = lp.off.QB;
  if (!qb || lp.ball.holder !== qb || lp.qbState === 'run') return;
  if (lp.qbState === 'drop' && lp.t >= lp.readAt) lp.qbState = 'read';
  // Crossing the line makes the quarterback a runner.
  if (qb.x > 0.3) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble', '', qb); return; }
  if (!lp.reads) {
    const w = lp.play.targets ?? {};
    lp.reads = [...(lp.eligible ?? [])].sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0));
    lp.readIdx = 0; lp.readSince = lp.readAt;
  }
  const read = () => lp.off[lp.reads[lp.readIdx]];
  if (lp.qbState === 'read') {
    // A beat per read; sharper quarterbacks move through it faster.
    const beat = 0.62 - (qb.a.awr - 60) * 0.004;
    if (lp.t - lp.readSince > beat && lp.readIdx < lp.reads.length - 1) { lp.readIdx++; lp.readSince = lp.t; }
    lp.qbLook = read() ?? lp.qbLook;
  } else lp.qbLook = lp.off[lp.reads[0]] ?? null;
  if (lp.user === lp.o && !lp.autoQB) return; // the user throws; his eyes still go through the reads
  if (lp.qbState !== 'read') return;
  lp.readTick -= DT;
  if (lp.readTick > 0) return;
  lp.readTick = 0.12;
  const g = lp.g;
  const elapsed = lp.t - lp.readAt;
  let nearRush = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) nearRush = Math.min(nearRush, dist(q, qb));
  lp.pressure = nearRush < 2.6;
  const vision = (qb.a.acc + qb.a.awr) / 2;
  const noise = 0.4 + Math.max(0, 99 - vision) * 0.03 + (lp.pressure ? 0.8 : 0);
  const scoreOf = (r) => {
    if (!r || r.open == null) return null;
    const gain = clamp(r.lead.x, -3, 25) * 0.07;
    return r.open + gain + noise * randn(g);
  };
  const cur = read(), cs = scoreOf(cur);
  // Everyone else: only a man left wide open catches his eye off the read.
  let best = cur && cs != null ? { r: cur, score: cs } : null;
  for (const k of lp.reads) {
    const r = lp.off[k];
    if (r === cur) continue;
    const s = scoreOf(r);
    if (s == null) continue;
    const seen = s - 1.6; // off-read throws need more
    if (!best || seen > best.score) best = { r, score: seen };
  }
  const need = 3.2 - elapsed * 0.9;
  if (best && (best.score > need || (lp.pressure && best.score > 1.9))) { throwTo(lp, best.r); return; }
  if (nearRush < 1.8 || elapsed > 2.6) {
    const spd = qb.a.spd;
    if (chance(g, clamp((spd - 50) / 120, 0.05, 0.4) * 0.35)) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble', '', qb); return; }
    if (elapsed > 2.6 && chance(g, 0.12)) { throwAway(lp); return; }
    // The checkdown: whoever is most open, if anyone is.
    let dump = null;
    for (const k of lp.reads) { const r = lp.off[k]; if (r?.open != null && (!dump || r.open > dump.open)) dump = r; }
    if (dump && elapsed > 1.7 && dump.open > 1.3) throwTo(lp, dump);
  }
}

function routeWant(lp, p) {
  if (lp.thrown && lp.thrown.target === p) {
    // Work back to the ball (but not into the bench).
    return seek(p, { x: lp.thrown.tx, y: clamp(lp.thrown.ty, -SIDE - 0.5, SIDE + 0.5) }, 1, 0.4);
  }
  if (p.jam > 0) { p.jam -= DT; p.want = { vx: 0.6, vy: 0 }; return; }
  const r = p.route;
  if (!r || p.wp >= r.length) {
    if (r && r[r.length - 1]?.stop) { p.want = { vx: 0, vy: 0 }; return; }
    const l = len(p.vx, p.vy) || 1;
    p.want = { vx: (p.vx / l) * p.top * 0.95, vy: (p.vy / l) * p.top * 0.95 };
    if (p.x > lp.goalX + 8) p.want = { vx: 0, vy: p.vy };
    return;
  }
  const w = r[p.wp];
  if (w.block != null) {
    if (lp.t > w.block) { p.wp++; return routeWant(lp, p); }
    return passBlockWant(lp, p);
  }
  const d = dist(p, w);
  if (d < 0.7) { p.wp++; return routeWant(lp, p); }
  seek(p, w, 0.97, w.stop ? 1.0 : 0.01);
}

// Pass protection. At the snap the line slides into a cup around the quarterback's drop spot:
// each blocker owns the rusher matched to him left to right (slide protection), kick-steps back
// to the arc between that rusher and the quarterback and meets him there, so the pocket is a
// shape on the field, not a scrum at the line. A blocker whose man is taken or gone picks up
// the free rusher nearest the quarterback.
function protect(lp) {
  if (lp.prot) return;
  lp.prot = true;
  const bl = lp.players.filter((p) => p.side === 'off' && p.role === 'passblock').sort((a, b) => a.y - b.y);
  const ru = lp.players.filter((p) => p.side === 'def' && p.role === 'rush').sort((a, b) => a.y - b.y);
  // Match in order, linemen first; extra blockers (a back or tight end) take the widest leftover.
  const line = bl.filter((p) => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot));
  const used = new Set();
  const pairs = [];
  for (const b of bl) for (const r of ru) pairs.push([Math.abs(b.y - r.y) + (line.includes(b) ? 0 : 2), b, r]);
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, b, r] of pairs) if (!b.pick && !used.has(r)) { b.pick = r; used.add(r); }
}
function pocketSpot(lp, p, toward) {
  // The cup: a circle around the drop spot whose front edge sits a yard and a half behind the
  // line; the tackles' spots swing wider and deeper so the edge rushers are run past the QB.
  const cx = lp.dropX, cy = 0;
  const R = Math.max(3.2, -lp.dropX - 1.6);
  let ax = toward.x - cx, ay = toward.y - cy;
  const l = len(ax, ay) || 1; ax /= l; ay /= l;
  return { x: cx + ax * R, y: cy + ay * R * 1.15 };
}
function passBlockWant(lp, p) {
  protect(lp);
  if (p.eng) return;
  const qb = lp.off.QB;
  let m = p.pick;
  // The assigned man is blocked by someone else, beaten past the pocket or out of the play:
  // help on the free rusher nearest the quarterback.
  if (!m || m.eng || m.stun > 0.3 || m.x < qb.x - 1) {
    let best = null, bd = 9;
    for (const q of lp.players) {
      if (q.side !== 'def' || q.role !== 'rush' || q.eng || q.stun > 0.3) continue;
      const taken = lp.players.some((b) => b !== p && b.side === 'off' && b.pick === q && !b.eng);
      const dd = dist(q, qb) * 0.6 + dist(q, p) * 0.4 + (taken ? 4 : 0);
      if (dd < bd) { bd = dd; best = q; }
    }
    m = best;
    if (m) p.pick = m;
  }
  p.aim = m;
  if (!m) {
    // Nobody to block: settle into the cup and look for work.
    const s = pocketSpot(lp, p, { x: p.x + 4, y: p.y });
    seek(p, s, 0.35, 0.6);
    return;
  }
  // Meet the rusher on the arc, or in front of it if he is still out wide.
  const s = pocketSpot(lp, p, m);
  const dm = dist(m, s);
  const ax = qb.x - m.x, ay = qb.y - m.y, l = len(ax, ay) || 1;
  const front = { x: m.x + (ax / l) * (m.r + p.r + 0.15), y: m.y + (ay / l) * (m.r + p.r + 0.15) };
  seek(p, dm < 2.2 || dist(p, m) < 2 ? front : { x: (s.x * 2 + front.x) / 3, y: (s.y * 2 + front.y) / 3 }, 0.85, 0.4);
}

function runBlockWant(lp, p) {
  if (p.eng) return;
  let tgt = p.assign && !p.assign.eng && p.assign.stun <= 0.3 ? p.assign : null;
  if (!tgt || dist(tgt, p) > 7) {
    tgt = null;
    let bd = 6;
    for (const q of lp.players) if (q.side === 'def' && !q.eng && dist(q, p) < bd) { bd = dist(q, p); tgt = q; }
  }
  if (!tgt) { seek(p, { x: p.x + 3, y: p.y + (p.y - lp.holeY > 0 ? 0.6 : -0.6) }, 0.5); return; }
  p.aim = tgt;
  // Take the defender on his hole-side shoulder so the drive pushes him away from the lane.
  const side = sgn(tgt.y - lp.holeY);
  const c = lp.carrier ?? lp.off.RB;
  const ax = (c?.x ?? -4) - tgt.x, ay = (c?.y ?? 0) - tgt.y, l = len(ax, ay) || 1;
  const k = tgt.r + p.r + 0.1;
  seek(p, { x: tgt.x + (ax / l) * k * 0.8, y: tgt.y + (ay / l) * k * 0.8 - side * 0.35 }, 0.85, 0.4);
}

function stalkWant(lp, p) {
  if (p.eng) return;
  const t = p.assign;
  if (!t || t.eng) { seek(p, { x: p.x + 2, y: p.y }, 0.4); return; }
  p.aim = t;
  const c = lp.carrier;
  const ax = (c?.x ?? 0) - t.x, ay = (c?.y ?? 0) - t.y, l = len(ax, ay) || 1;
  seek(p, { x: t.x + (ax / l) * 0.9, y: t.y + (ay / l) * 0.9 }, 0.8, 0.4);
}

function escortWant(lp, p, c) {
  if (p.eng || !c) return;
  // Block the nearest free defender ahead of the ball carrier.
  let tgt = null, bd = 9;
  for (const q of lp.players) {
    if (q.side === c.side || q.eng || q.stun > 0) continue;
    const dd = dist(q, c);
    const ahead = (c.side === 'off' ? q.x - c.x : c.x - q.x) > -2;
    if (ahead && dd < bd && dist(q, p) < 10) { bd = dd; tgt = q; }
  }
  if (!tgt) { seek(p, { x: c.x + (c.side === 'off' ? 4 : -4), y: c.y + (p.y > c.y ? 3 : -3) }, 0.7); return; }
  p.aim = tgt;
  const ax = c.x - tgt.x, ay = c.y - tgt.y, l = len(ax, ay) || 1;
  seek(p, { x: tgt.x + (ax / l) * 0.8, y: tgt.y + (ay / l) * 0.8 }, 0.95, 0.3);
}

function rushWant(lp, p) {
  if (p.eng) return;
  const c = lp.carrierSet ? lp.carrier : lp.off.QB;
  if (!c) return;
  // Draws and play-action freeze the front for a beat.
  const fooled = (lp.play.dir === 'draw' || lp.play.pa) && lp.t < 0.5;
  // Against a run each lineman fills his own gap until the ball declares itself: he plays his
  // gap a yard into the backfield and only chases once the carrier is in his lane or past the
  // line. That is what keeps the cutback lanes closed.
  if (lp.kind === 'run' && lp.play.dir !== 'draw' && p.gapY != null && c.x < 0.5 && Math.abs(c.y - p.gapY) > 2.2 && lp.t < 2.2) {
    return seek(p, { x: Math.max(0.3, c.x + 2), y: p.gapY + (c.y - p.gapY) * 0.2 }, 0.7, 0.5);
  }
  // Pass rush: keep outside leverage on the edge so the quarterback cannot escape that way.
  if (lp.kind === 'pass' && !lp.carrierSet && p.edge && lp.t < 1.6 && Math.abs(p.y) > Math.abs(c.y) + 1.2) {
    return seek(p, { x: c.x + 1.5, y: c.y + p.edge * 2.4 }, 1, 0.3);
  }
  // A rusher whose way to the quarterback is walled off by the pile at the line picks the
  // nearest open lane through it instead of pressing into bodies.
  if (lp.kind === 'pass' && !lp.carrierSet && p.x > c.x + 2) {
    const lane = rushLane(lp, p, c);
    if (lane) return seek(p, lane, fooled ? 0.7 : 1, 0.05);
  }
  intercept(p, c, fooled ? 0.7 : 1);
}
// The point to aim for to get through the line, or null if the straight path is open.
function rushLane(lp, p, c) {
  // Room along the path from him to (x, y): the closest any body comes to that segment.
  const clear = (x, y) => {
    const sx = x - p.x, sy = y - p.y, L2 = sx * sx + sy * sy || 1;
    let m = 99;
    for (const q of lp.players) {
      if (q === p) continue;
      const u = clamp(((q.x - p.x) * sx + (q.y - p.y) * sy) / L2, 0, 1);
      m = Math.min(m, Math.hypot(q.x - (p.x + sx * u), q.y - (p.y + sy * u)) - q.r);
    }
    return m - p.r;
  };
  // Is anybody on the straight line within the next three yards?
  const dx = c.x - p.x, dy = c.y - p.y, d = len(dx, dy) || 1;
  let blocked = false;
  for (const q of lp.players) {
    if (q === p) continue;
    const rx = q.x - p.x, ry = q.y - p.y, along = (rx * dx + ry * dy) / d;
    if (along <= 0 || along > 3) continue;
    if (Math.abs(rx * dy - ry * dx) / d < q.r + p.r * 0.8) { blocked = true; break; }
  }
  if (!blocked) return null;
  // Candidate lanes a yard or two ahead, from his own y outward; the closest one with room.
  const ax = p.x - 1.6;
  let best = null;
  for (let k = 0; k <= 16; k++) {
    for (const s of k ? [-1, 1] : [1]) {
      const y = p.y + s * k * 0.6, room = clear(ax, y);
      if (room > 0.1) { const cost = k * 0.6 + Math.abs(y - c.y) * 0.15; if (!best || cost < best.cost) best = { x: ax, y, cost }; }
    }
    if (best) break;
  }
  if (best) return best;
  // No lane at all: loop around the end of the line.
  let wide = 0;
  for (const q of lp.players) if (q.side !== p.side && Math.abs(q.x) < 3) wide = Math.max(wide, Math.abs(q.y) + q.r);
  return { x: p.x, y: sgn(p.y || 0.01) * (wide + p.r + 0.6) };
}

function coverWant(lp, p) {
  const g = lp.g;
  const c = lp.carrierSet ? lp.carrier : null;
  if (c) { pursueWant(lp, p, c); return; }
  if (lp.thrown) {
    const T = lp.thrown;
    if (p.react == null || p.react <= -1) p.react = 0.1 + (100 - (p.a.cov * 0.6 + p.a.awr * 0.4)) * 0.005;
    if (p.react > 0) { p.react -= DT; }
    else if (dist(p, { x: T.tx, y: T.ty }) < 16) return seek(p, { x: T.tx + 0.3, y: T.ty }, 1, 0.2);
  }
  // Run reads: linebackers and safeties fill once the ball is handed off (handled by pursuit).
  if (lp.kind === 'run' && !lp.carrierSet && ['MLB', 'OLB', 'SS'].includes(p.slot)) {
    return seek(p, { x: Math.max(1.5, p.x - 1), y: lp.holeY * 0.5 }, 0.5);
  }
  if (lp.play.pa && lp.t < 0.6 && ['MLB', 'OLB', 'SS'].includes(p.slot)) return seek(p, { x: 1.5, y: p.y }, 0.6);
  if (p.zone) return zoneWant(lp, p);
  if (p.man) {
    const r = p.man;
    if (r.role !== 'route' && r.role !== 'carrier') { // receiver stayed in to block: rob the middle
      return seek(p, { x: 6, y: p.y * 0.7 }, 0.6);
    }
    // A worse cover man reacts later to the receiver's cuts (lag), and a slower one simply
    // falls behind; on straight lines downfield he only gives up a little ground.
    p.aim = r;
    const lag = p.lag ?? 0.2;
    const px = r.x - r.vx * lag * 0.45, py = r.y - r.vy * lag;
    // Keep a cushion over the top that closes as the route develops.
    p.gap0 ??= Math.max(1, p.x - r.x);
    const cushion = Math.max(r.x > 12 ? 1.4 : 0.4, p.gap0 - lp.t * 5);
    const tx = px + cushion, ty = py + (r.y > 0 ? -0.4 : 0.4);
    let vx = (tx - p.x) * 3 + r.vx, vy = (ty - p.y) * 3 + r.vy;
    const l = len(vx, vy), cap = p.top;
    if (l > cap) { vx *= cap / l; vy *= cap / l; }
    p.want = { vx, vy };
    void g;
    return;
  }
  // Free safety in man schemes: shade the deepest threat from over the top.
  let deep = null;
  for (const k of RECEIVERS) { const r = lp.off[k]; if (r && r.role === 'route' && (!deep || r.x > deep.x)) deep = r; }
  if (deep && deep.x > 4) return seek(p, { x: Math.max(p.x, deep.x + 5), y: deep.y * 0.6 + p.y * 0.4 }, 0.9, 1);
  seek(p, { x: p.x, y: p.y }, 0.2);
}

function zoneWant(lp, p) {
  const z = p.zone;
  let threat = null, tv = -99;
  for (const k of RECEIVERS) {
    const r = lp.off[k];
    if (!r || r.role !== 'route') continue;
    const dz = Math.hypot(r.x - z.x, r.y - z.y);
    if (dz > z.r + 2) continue;
    const v = -dz + r.x * 0.15;
    if (v > tv) { tv = v; threat = r; }
  }
  if (!threat) { seek(p, z, 0.75, 2); return; }
  const lag = p.lag ?? 0.25;
  const px = threat.x - threat.vx * lag * 0.45, py = threat.y - threat.vy * lag;
  let tx = (px + 1.2) * 0.75 + z.x * 0.25;
  const ty = py * 0.75 + z.y * 0.25;
  // Deep zones never let a receiver get behind them.
  if (z.x >= 15) tx = Math.max(tx, px + 2.5);
  seek(p, { x: tx, y: ty }, 1, 0.6);
}

// Pursuit with leverage. The defender with the outside position on the carrier keeps it
// (contain: he aims a step outside so the carrier is turned back inside); the others come
// inside-out so there is no cutback; the deep men stay over the top, between the carrier and
// the end zone, until he is close enough to take on.
function pursueWant(lp, p, c) {
  if (!c || p.eng) return;
  if (p.react > 0) { p.react -= DT; slowDown(p, DT); return; }
  const fwd = c.side === 'off' ? 1 : -1;
  const d = dist(p, c);
  if (d > 3.2 && c.side === 'off') {
    const out = sgn(c.y || 0.01);
    // Contain: the pursuer outside the carrier and level with or ahead of him.
    const outside = (p.y - c.y) * out > 0.5 && (p.x - c.x) * fwd > -1;
    // Deep help: well downfield of the carrier.
    const deep = (p.x - c.x) * fwd > 8 && d > 7;
    if (deep) {
      // Shuffle to stay square over the top and close the gap at an angle.
      const T = Math.min(1.2, d / p.top);
      const tx = c.x + c.vx * T + fwd * Math.min(2.5, d * 0.2), ty = c.y + c.vy * T;
      return seek(p, { x: tx, y: ty }, 1, 0.05);
    }
    intercept(p, c, 1);
    if (p.want) {
      const sh = outside ? out * 0.6 : -out * 0.25;
      const tl = Math.max(1, d);
      p.want.vy += sh * p.top / tl;
      const l = len(p.want.vx, p.want.vy) || 1, cap = p.top;
      if (l > cap) { p.want.vx *= cap / l; p.want.vy *= cap / l; }
    }
    return;
  }
  intercept(p, c, 1);
}

// Aim at where the target will be, not where it is.
function intercept(p, c, frac) {
  p.aim = c;
  // Solve |c + v t - p| = speed * t for the earliest t.
  const sp = Math.max(3, p.top * frac);
  const rx = c.x - p.x, ry = c.y - p.y;
  const a = c.vx * c.vx + c.vy * c.vy - sp * sp, b = 2 * (rx * c.vx + ry * c.vy), cc = rx * rx + ry * ry;
  let T = len(rx, ry) / sp;
  if (Math.abs(a) > 1e-6) {
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const t1 = (-b - Math.sqrt(disc)) / (2 * a), t2 = (-b + Math.sqrt(disc)) / (2 * a);
      const ts = [t1, t2].filter((t) => t > 0);
      if (ts.length) T = Math.min(...ts);
    }
  }
  T = Math.min(T, 2.5);
  // Up close, take him on directly instead of racing to a spot downfield.
  const d = len(rx, ry);
  if (d < 5) T = Math.min(T, 0.08 + d * 0.05);
  seek(p, { x: c.x + c.vx * T, y: c.y + c.vy * T }, frac, 0.05);
}

function carrierWant(lp, p) {
  const g = lp.g;
  const fwd = p.side === 'off' ? 1 : -1;
  // Designed runs hit the hole first.
  // Designed runs hit the hole first. An outside run stretches to the edge, then reads it: if
  // a defender has set the edge outside him, he bounces back inside instead of running into it.
  if (lp.kind === 'run' && p.slot === 'RB' && p.x < 0.5) {
    const e = lp.t - (lp.carrierAt ?? 0);
    if (lp.play.dir === 'outside' && e < 1.1 && !lp.bounced) {
      const out = sgn(lp.holeY);
      const edge = lp.players.find((q) => q.side !== p.side && !q.eng && q.stun <= 0 && (q.y - p.y) * out > 0.3 && Math.abs(q.x - p.x) < 3 && dist(q, p) < 3.4);
      if (edge && e > 0.35) { lp.bounced = true; event(lp, 'bounce', '', p, edge); }
      else return seek(p, { x: Math.min(1.5, -1 + e * 3), y: lp.holeY }, 1, 0.05);
    } else if (e < 0.55 && lp.play.dir !== 'outside') return seek(p, { x: 1.5, y: lp.holeY }, 1, 0.05);
  }
  let best = null;
  for (let a = -90; a <= 90; a += 15) {
    const r = (a * Math.PI) / 180;
    const dx = Math.cos(r) * fwd, dy = Math.sin(r);
    let danger = 0;
    for (let k = 0.5; k <= 3; k = k < 1 ? 1 : k + 1) {
      const px = p.x + dx * 2.2 * k, py = p.y + dy * 2.2 * k;
      for (const q of lp.players) {
        if (q === p || q.stun > 0.2) continue;
        const dd = Math.hypot(q.x - px, q.y - py);
        if (q.side === p.side) {
          // Own blockers are walls too: aim for the seams between bodies, not through them.
          if (k < 3 && dd < q.r + p.r + 0.3) danger += (q.eng ? 0.9 : 0.5) / Math.max(k, 0.7);
          continue;
        }
        const w = q.eng ? (k < 1 && dd < q.r + p.r ? 1.2 : 0.35) : 1;
        danger += (w * 2.4) / (0.6 + dd * dd) / Math.max(k, 0.7);
      }
      if (Math.abs(py) > SIDE - 1) danger += 0.8 / k;
    }
    const score = dx * fwd * 1.7 - danger - Math.abs(a) * 0.002;
    if (!best || score > best.score) best = { dx, dy, score };
  }
  const sprint = 1;
  const l = len(best.dx, best.dy);
  p.want = { vx: (best.dx / l) * p.top * sprint, vy: (best.dy / l) * p.top * sprint };
  // When a tackler closes in, the AI carrier puts a move on him: power backs lower the
  // shoulder against smaller tacklers, shifty ones juke or spin.
  if ((p !== lp.control || !lp.manual) && p.juke <= -0.9 && p.spin <= -0.9 && p.truck <= -0.9) {
    for (const q of lp.players) {
      if (q.side === p.side || q.eng || q.stun > 0 || dist(q, p) > 1.9) continue;
      if (chance(g, 0.02 + p.a.spd / 3000)) {
        const power = p.a.strBT - q.a.tkl + Math.log(PLAYERS[p.id].weight / Math.max(1, PLAYERS[q.id].weight)) * 12;
        const quick = p.a.spd - q.a.spd;
        startMove(lp, p, power > 6 && power > quick ? 'truck' : chance(g, 0.4) ? 'spin' : 'juke');
      }
      break;
    }
  }
}

// ---------- movement ----------
function move(lp, p, dt) {
  p.anim += dt * (2 + len(p.vx, p.vy) * 0.9);
  p.juke = Math.max(-1, p.juke - dt);
  p.truck = Math.max(-1, p.truck - dt);
  p.spin = Math.max(-1, p.spin - dt);
  if (p.dive != null) { p.dive -= dt; if (p.dive < -0.6) p.dive = null; }
  p.cool = Math.max(0, p.cool - dt);
  if (inTackle(lp, p)) return; // the tackle sequence moves the pair (tackleStep)
  if (p.stun > 0) { p.stun -= dt; slowDown(p, dt, 9); return; }
  if (p.eng) return; // engaged players move as a pair in blocks()
  let { vx, vy } = p.want ?? { vx: 0, vy: 0 };
  // Nobody but the ball carrier runs off the field into the bench area.
  // Carrying the ball costs a step and long runs wear the carrier down, while pursuers find
  // a little extra, so only a carrier who is truly faster than the defense breaks away.
  const tired = p.carrier ? clamp((Math.abs(p.x - (p.runFrom ?? p.x)) - 12) * 0.004, 0, 0.1) : 0;
  const chase = p.role === 'pursue' ? (lp.carrier && dist(p, lp.carrier) < 8 ? 1.06 : 1.03) : 1;
  let top = p.top * (p.slow > 0 ? 0.6 : 1) * (p.carrier ? 0.96 - tired : chase);
  vx *= chase; vy *= chase;
  if (p.juke > 0.15) {
    // A sharp cut sideways.
    const l = len(vx, vy) || 1;
    const side = p.jukeSide ?? (chance(lp.g, 0.5) ? 1 : -1);
    p.jukeSide = side;
    const px = (-vy / l) * side, py = (vx / l) * side;
    vx = px * top * 0.9 + vx * 0.45; vy = py * top * 0.9 + vy * 0.45;
  } else p.jukeSide = null;
  // A spin keeps the line but bleeds a little speed; a truck drives straight ahead.
  if (p.spin > 0) { top *= 0.86; const l = len(vx, vy) || 1; vx += (-vy / l) * p.spinDir * 1.2; vy += (vx / l) * p.spinDir * 1.2; }
  if (p.truck > 0) top *= 0.94;
  p.slow = Math.max(0, p.slow - dt);
  if (!(p === lp.control && lp.manual) && !p.carrier) [vx, vy] = steer(lp, p, vx, vy);
  // Routes and pursuit bend along the sideline instead of running out over it.
  if (!p.carrier && Math.abs(p.y) > SIDE - 1.5 && vy * p.y > 0) vy *= clamp((SIDE + 0.5 - Math.abs(p.y)) / 2, 0, 1);
  kin(p, vx, vy, top, dt, p.juke > 0 ? 2.2 : p.truck > 0 ? 1.6 : 1);
}

// Steering around bodies in the way: anyone (but the player this one is going after) a little
// ahead and inside the path bends the path to the open side, so runners hit gaps, rushers
// loop around blockers and pursuers take an angle instead of pushing through a pile.
function steer(lp, p, vx, vy) {
  const sp = len(vx, vy);
  if (sp < 0.5) return [vx, vy];
  const ux = vx / sp, uy = vy / sp, look = 1.2 + sp * 0.3;
  let ax = 0, ay = 0;
  for (const q of lp.players) {
    if (q === p || q === p.aim || q === p.eng) continue;
    const rx = q.x - p.x, ry = q.y - p.y;
    const along = rx * ux + ry * uy;
    if (along <= 0 || along > look) continue;
    const lat = -rx * uy + ry * ux; // + when q is to the left of the path
    const need = p.r + q.r + 0.15;
    if (Math.abs(lat) >= need) continue;
    const k = ((need - Math.abs(lat)) / need) * (1 - along / look) * (q.eng ? 1.6 : q.side === p.side ? 0.5 : 1.2);
    const side = lat === 0 ? (p.y > q.y ? 1 : -1) : -sgn(lat);
    ax += -uy * side * k; ay += ux * side * k;
  }
  if (!ax && !ay) return [vx, vy];
  const nx = ux + ax * 1.6, ny = uy + ay * 1.6, l = len(nx, ny) || 1;
  return [(nx / l) * sp, (ny / l) * sp];
}

// Accelerate toward a wanted velocity; braking and cutting are quicker than speeding up.
function kin(p, vx, vy, top, dt, boost = 1) {
  const wl = len(vx, vy);
  if (wl > top) { vx *= top / wl; vy *= top / wl; }
  let dvx = vx - p.vx, dvy = vy - p.vy;
  const brake = dvx * p.vx + dvy * p.vy < 0 ? (p.cut ?? 2) : 1;
  const dl = len(dvx, dvy), amax = p.accel * dt * boost * brake;
  if (dl > amax) { dvx *= amax / dl; dvy *= amax / dl; }
  p.vx += dvx; p.vy += dvy;
  integrate(p, dt);
}

function integrate(p, dt) {
  p.x += p.vx * dt; p.y += p.vy * dt;
}

// Orientation is simulation state too: each player turns toward what he should be facing (his
// path, his man, the ball, the receiver he is reading) at a rate set by agility and weight,
// so nobody snaps around or slides sideways while facing the wrong way.
function orient(lp, p) {
  const want = faceWant(lp, p);
  if (!want) return;
  let [wx, wy] = want;
  const l = len(wx, wy);
  if (l < 1e-6) return;
  wx /= l; wy /= l;
  const cur = Math.atan2(p.fy, p.fx), tgt = Math.atan2(wy, wx);
  let d = tgt - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const heavy = clamp((p.kg - 60) / 400, 0, 0.35);
  const rate = (5 + (p.a.agi ?? 60) / 14) * (1 - heavy) * (p.carrier ? 1.1 : 1) * DT;
  const a = cur + clamp(d, -rate, rate);
  p.fx = Math.cos(a); p.fy = Math.sin(a);
}
function faceWant(lp, p) {
  const sp = len(p.vx, p.vy);
  const toward = (q) => [q.x - p.x, q.y - p.y];
  const fwd = p.side === 'off' ? 1 : -1;
  if (lp.phase === 'pre') return sp > 0.8 ? [p.vx, p.vy] : lp.set || sp < 0.3 ? [fwd, 0] : null;
  if (lp.phase === 'dead') return sp > 1 ? [p.vx, p.vy] : null;
  const T = lp.tackle;
  if (T && T.q === p) return toward(T.c);
  if (T && T.c === p) return null;
  if (p.eng) return toward(p.eng);
  const qb = lp.off.QB;
  if (p === qb && lp.windup) return toward(lp.windup.at ?? lp.windup.r);
  const F = lp.thrown;
  if (F && lp.ball.state === 'air' && F.target) {
    const left = F.t0 + F.T - lp.t, near = Math.hypot(F.tx - p.x, F.ty - p.y);
    if ((F.target === p && left < 0.8) || (p.side === 'def' && near < 3 && left < 0.6)) return toward(lp.ball);
  }
  if (!lp.carrierSet && !F) {
    if (p === qb && lp.ball.holder === p && lp.kind === 'pass') {
      if (lp.qbState === 'read' && lp.qbLook) return toward(lp.qbLook);
      if (p.vx < 0) return [1, 0];
    }
    if (p.side === 'off' && p.role === 'passblock' && p.vx < 0.5) return p.pick ? toward(p.pick) : [1, 0];
    if (p.side === 'def' && p.role === 'cover' && p.vx > 0 && sp < p.top * 0.8) return [-1, p.vy * 0.15];
  }
  if (sp > 0.6) return [p.vx, p.vy];
  const b = lp.ball;
  if (Math.hypot(b.x - p.x, b.y - p.y) > 1) return toward(b);
  return null;
}

function slowDown(p, dt, k = 6) {
  const f = Math.max(0, 1 - k * dt);
  p.vx *= f; p.vy *= f;
  if (!p.eng) integrate(p, dt);
}

function animIdle(lp, dt) { for (const p of lp.players) p.anim += dt * 2; }

// Bodies don't pass through each other: overlapping capsules are pushed apart until they
// just touch. Ball carriers and engaged blockers hold their ground and the other one gives;
// when both hold, both give. Contact itself (blocks, tackles) happens at the capsule edge.
const SEP_MAX = 0.12;
function separate(lp, passes = 2) {
  const ps = lp.players;
  const holds = (p) => !!(p.eng || p.carrier);
  for (let it = 0; it < passes; it++) {
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (a.eng === b) continue;
        const T = lp.tackle;
        if (T && ((a === T.c && b === T.q) || (a === T.q && b === T.c))) continue;
        const need = a.r + b.r;
        let dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
        if (d >= need) continue;
        if (d < 1e-6) { dx = a.side === 'off' ? 1 : -1; dy = 0; d = 1; }
        // Deep overlaps (a block coming apart, a pile) resolve over a few frames, not in one jump.
        const ux = dx / d, uy = dy / d, over = Math.min(need - Math.min(d, need), SEP_MAX);
        // A ball carrier squeezing past his own blockers moves them, not himself.
        const ha = holds(a) && !(b.carrier && a.side === b.side), hb = holds(b) && !(a.carrier && a.side === b.side);
        let ka = ha && !hb ? 0 : !ha && hb ? 1 : 0.5;
        // A free teammate and the carrier share the shove; neither bulldozes the other.
        const mate = a.side === b.side && (a.carrier || b.carrier);
        if (mate && !a.eng && !b.eng) ka = a.carrier ? 0.35 : 0.65;
        a.x -= ux * over * ka; a.y -= uy * over * ka;
        b.x += ux * over * (1 - ka); b.y += uy * over * (1 - ka);
        // A body pressed into another loses the speed it had into it (a free player running
        // into a block slides off it instead of grinding in and being shoved back each step).
        if (!a.eng && !inTackle(lp, a) && ka > 0 && !(mate && a.carrier)) slide(a, ux, uy);
        if (!b.eng && !inTackle(lp, b) && ka < 1 && !(mate && b.carrier)) slide(b, -ux, -uy);
      }
    }
  }
}

// p pressed against a body in direction (ux, uy): the speed into it turns into a slide around
// it, toward the side he was already drifting (or the side of the spot he wants).
function slide(p, ux, uy) {
  const vn = p.vx * ux + p.vy * uy;
  if (vn <= 0) return;
  const sp0 = len(p.vx, p.vy);
  p.vx -= ux * vn; p.vy -= uy * vn;
  const tx = -uy, ty = ux;
  const w = p.want ?? p;
  const vt = p.vx * tx + p.vy * ty, wt = w.vx * tx + w.vy * ty;
  const s = sgn(vt * 3 + wt || 1);
  // Keep at least half the lost speed as a slide along the body, never more than he had.
  const want = Math.max(Math.abs(vt), vn * 0.6);
  p.vx += tx * (s * want - vt); p.vy += ty * (s * want - vt);
  const sp = len(p.vx, p.vy);
  if (sp > sp0) { p.vx *= sp0 / sp; p.vy *= sp0 / sp; }
}

// ---------- blocking ----------
// A block is a sequence of contact states, set on both players each step:
//   APPROACHING  a blocker closing on his man (within three yards)
//   ENGAGED      hands on, the first moments of the fit
//   PUSHING      one side is winning and drives the pair
//   SHEDDING     the defender's move to get off (rip, swim or bull rush), a quarter second
//   DISENGAGED   just released; the defender cannot be re-blocked for a moment
// Who wins comes from ratings, type and size: mass moves the pair, agility sheds faster.
const SHED_T = 0.24;
function blocks(lp) {
  const g = lp.g;
  for (const p of lp.players) {
    if (p.contact === 'DISENGAGED' && (p.shedT ?? 0) > 0) continue;
    p.contact = null;
  }
  // New engagements
  for (const b of lp.players) {
    if (b.eng || b.stun > 0 || b.carrier) continue;
    const blocker = b.side === lp.carrierTeam && ['passblock', 'runblock', 'stalk', 'escort'].includes(b.role)
      || (b.role === 'route' && b.route?.[b.wp]?.block != null);
    if (!blocker) continue;
    for (const d of lp.players) {
      if (d.side === b.side || d.eng || d.carrier || d.stun > 0 || d.shedT > 0) continue;
      if (dist(b, d) > Math.max(ENGAGE, b.r + d.r + 0.08)) continue;
      engage(lp, b, d);
      break;
    }
    if (!b.eng && b.aim && dist(b, b.aim) < 3) { b.contact = 'APPROACHING'; b.tgt = b.aim; }
  }
  // Existing engagements: fit, push, shed
  for (const b of lp.players) {
    if (!b.eng || b.side !== lp.carrierTeam) continue;
    const d = b.eng;
    b.engT += DT; d.engT = b.engT;
    b.tgt = d; d.tgt = b;
    const passPro = lp.kind === 'pass' && !lp.carrierSet;
    const bv = passPro ? b.a.blk * 0.75 + b.a.str * 0.25 : b.a.blk * 0.5 + b.a.str * 0.5;
    const dv = passPro ? d.a.rush : d.a.str * 0.6 + d.a.tkl * 0.4;
    const R = rep(d.id, dv, b.id, bv);
    const mass = clamp(Math.log(d.kg / b.kg), -1.2, 1.2);   // > 0: the defender is heavier
    // The shed move already under way finishes, then the pair comes apart.
    if (d.shed) {
      d.shed.t += DT;
      b.contact = d.contact = 'SHEDDING';
      const S = d.shed;
      if (S.move !== 'bull') {
        // Rip or swim: the defender's near shoulder slips past the blocker's.
        const nx = d.x + S.sx * S.speed * DT, ny = d.y + S.sy * S.speed * DT;
        if (!lp.players.some((q) => q !== d && q !== b && Math.hypot(q.x - nx, q.y - ny) < (q.r + d.r) * 0.95)) { d.x = nx; d.y = ny; }
      }
      // He goes around the blocker's body, never through it.
      const ox = d.x - b.x, oy = d.y - b.y, ol = len(ox, oy) || 1, min = (b.r + d.r) * 0.92;
      if (ol < min) { const k = Math.min(min - ol, 0.08); d.x += (ox / ol) * k; d.y += (oy / ol) * k; }
      b.vx *= 0.8; b.vy *= 0.8;
      if (S.t >= SHED_T) {
        unengage(b);
        b.stun = S.move === 'bull' ? 0.45 : 0.3; b.stunFall = S.move === 'bull' && mass > 0.3;
        d.shedFrom = b; d.shedT = passPro ? 0.8 : 0.5; d.shed = null;
        b.contact = d.contact = 'DISENGAGED';
        if (passPro) lp.pressureBy = d;
        event(lp, 'shed', S.move, d, b);
      }
      continue;
    }
    // Rate of getting off the block, per second: rating and type edge, quick feet shed sooner,
    // and nobody sheds in the first instants of the fit.
    const base = passPro ? 0.7 : lp.carrierSet ? 0.13 : 0.08;
    const quick = clamp((d.a.acc - b.a.acc) / 60, -0.4, 0.5);
    let rate = base * Math.exp(R.diff / 9) * (1 + quick) * (b.engT < 0.45 ? 0.3 : 1);
    if (!passPro) rate = Math.max(rate, 0.1);
    // Blocks far from the ball break up on their own.
    if (lp.carrierSet && dist(d, lp.carrier) > 6 && b.engT > 0.6) rate = Math.max(rate, 2.5);
    if (chance(g, rate * DT)) {
      // The move fits the body: big and strong bull rushes, light and quick swims, the rest rip.
      const move = mass > 0.25 && d.a.str >= d.a.acc ? 'bull' : d.a.acc > 70 || mass < -0.3 ? 'swim' : 'rip';
      const target = lp.carrierSet ? lp.carrier : lp.off.QB;
      const side = sgn((target.y - b.y) * 0.3 + (d.y - b.y)) || 1;
      const ux = target.x - d.x, l = len(ux, side) || 1;
      d.shed = { move, t: 0, sx: (ux / l) * 0.5, sy: side * 0.9, speed: move === 'swim' ? 4.2 : 3.2 };
      b.contact = d.contact = 'SHEDDING';
      continue;
    }
    // The pair drifts toward whoever is winning. In pass protection the rusher drives toward the
    // quarterback, slowed by the blocker sitting on the cup's edge; in a run block the blocker
    // drives the defender away from the hole.
    const target = lp.carrierSet ? lp.carrier : lp.off.QB;
    let ux = target.x - d.x, uy = target.y - d.y; const l = len(ux, uy) || 1; ux /= l; uy /= l;
    let push = clamp((passPro ? 0.3 : -0.15) + R.diff * 0.06 + mass * 0.55, -2.2, 2.2);
    if (passPro) {
      // Inside the cup the blocker anchors: the deeper the rusher gets, the harder it is.
      const S = pocketSpot(lp, b, d), behind = (S.x - b.x) * sgn(b.x - lp.dropX + 0.01);
      if (behind > 0) push *= Math.max(0.25, 1 - behind * 0.4);
    } else if (push < 0 && lp.holeY != null && (lp.kind === 'run')) {
      // Drive him off the lane: back and to the side away from the hole.
      const away = sgn(d.y - lp.holeY);
      ux = 0.75; uy = away * 0.66;
      push = -push;
    }
    const vx = ux * push, vy = uy * push * 0.6;
    b.contact = d.contact = Math.abs(push) > 0.5 && b.engT > 0.3 ? 'PUSHING' : 'ENGAGED';
    for (const q of [b, d]) { q.vx = vx; q.vy = vy; q.x += vx * DT; q.y += vy * DT; }
    // Keep the blocker in front, squaring up over a few frames (never a jump on contact).
    const mx = (b.x + d.x) / 2, my = (b.y + d.y) / 2;
    const half = (b.r + d.r) * 0.5;
    // Turn the pair gradually toward the target side; when the target swings behind them
    // (a catch downfield) they wheel around each other rather than swap through.
    let fx = b.x - d.x, fy = b.y - d.y; const fl = len(fx, fy) || 1;
    fx = fx / fl + ux * 0.12; fy = fy / fl + uy * 0.12; const fl2 = len(fx, fy) || 1; fx /= fl2; fy /= fl2;
    ease(b, mx + fx * half, my + fy * half); ease(d, mx - fx * half, my - fy * half);
  }
  for (const p of lp.players) if (p.shedT > 0) { p.shedT -= DT; if (p.shedT <= 0) { p.shedFrom = null; if (p.contact === 'DISENGAGED') p.contact = null; } }
}

// Slide a body toward a spot at no more than 6 yards a second.
function ease(p, x, y, speed = 6) {
  let dx = (x - p.x) * SQUARE_K, dy = (y - p.y) * SQUARE_K;
  const l = len(dx, dy), max = speed * DT;
  if (l > max) { dx *= max / l; dy *= max / l; }
  p.x += dx; p.y += dy;
}
const SQUARE_K = 1 - Math.exp(-DT * 10);

function engage(lp, b, d) { b.eng = d; d.eng = b; b.engT = 0; d.engT = 0; }
function unengage(p) { const q = p.eng; if (q) { q.eng = null; q.shed = null; } p.eng = null; p.shed = null; }

// ---------- passing ----------
function throwSpeed(qb) { return 17 + 0.09 * qb.a.arm; }

// The throw: the quarterback sets his feet and turns to the target (the windup), then the
// ball leaves his hand on a real arc. Nothing is resolved until it gets there.
function throwTo(lp, r) { startThrow(lp, r, false); }
function throwAway(lp) { startThrow(lp, null, true); }
function startThrow(lp, r, away) {
  if (lp.windup || lp.thrown || lp.tackle) return;
  const qb = lp.off.QB;
  lp.windup = { r, away, t0: lp.t, T: WINDUP_T * (1.15 - qb.a.arm / 400), at: away ? { x: qb.x + 6, y: (qb.y >= 0 ? 1 : -1) * (SIDE + 4) } : null };
  lp.qbState = 'windup';
  event(lp, 'windup', '', qb, r);
}
function windup(lp) {
  const W = lp.windup;
  if (!W) return;
  const qb = lp.off.QB;
  // Sacked or out of the pocket mid-motion: no throw.
  if (lp.ball.holder !== qb || lp.tackle || lp.phase !== 'live') { lp.windup = null; return; }
  if (lp.t - W.t0 < W.T) return;
  lp.windup = null;
  release(lp, W.r, W.away);
}

// Where the ball leaves the passer's hand: in front of his throwing shoulder, near the top of
// his body (lower for a short Pokémon).
export function releasePoint(qb) {
  return { x: qb.x + qb.fx * (qb.r + 0.1) + qb.fy * 0.22, y: qb.y + qb.fy * (qb.r + 0.1) - qb.fx * 0.22, z: clamp(qb.h * 0.82, 1.1, 2.6) };
}
// The height a receiver catches the ball at.
export function catchHeight(p) { return clamp(p.h * 0.6, 0.9, 2.0); }

function release(lp, r, away) {
  const g = lp.g, qb = lp.off.QB;
  const v = throwSpeed(qb);
  const rp = releasePoint(qb);
  if (away) {
    const side = qb.y >= 0 ? 1 : -1;
    launch(lp, { target: null, sx: rp.x, sy: rp.y, z0: rp.z, tx: qb.x + 6, ty: side * (SIDE + 4), zc: 0.6, v: v * 0.85, away: true });
    event(lp, 'throw', `${nm(qb.id)} throws it away`, qb);
    return;
  }
  // Lead the receiver: where will he be when the ball arrives?
  let T = dist(rp, r) / v, px = r.x, py = r.y;
  for (let i = 0; i < 4; i++) {
    const fut = futureRoute(r, T);
    px = fut.x; py = fut.y;
    T = Math.hypot(px - rp.x, py - rp.y) / v;
  }
  let near = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) near = Math.min(near, dist(q, qb));
  const pressured = near < 2.4;
  const D = lp.def;
  const tAcc = traitMod('throwAccuracy', { qb, def: Object.values(D) });
  traitNotes(lp, tAcc, { qb }, qb);
  const acc = qb.a.acc + tAcc.v - (lp.g.weather === 'rain' ? 4 : 0);
  const air = Math.hypot(px - rp.x, py - rp.y);
  const tPr = pressured ? traitMod('pressure', { qb }) : null;
  if (tPr) traitNotes(lp, tPr, { qb }, qb);
  let sd = (0.25 + air * 0.042) * (1.9 - acc / 90) * (pressured ? 1 + 0.5 * tPr.v : 1);
  if (lp.manual && lp.control === qb && len(qb.vx, qb.vy) > 2) sd *= 1.25; // throwing on the run
  px += randn(g) * sd * 1.2; py += randn(g) * sd;
  py = clamp(py, -SIDE - 2, SIDE + 2);
  // Deep balls are lofted (a touch pass), short ones are drilled.
  const loft = air > 18 ? 0.86 : air > 10 ? 0.94 : 1;
  launch(lp, { target: r, sx: rp.x, sy: rp.y, z0: rp.z, tx: px, ty: py, zc: catchHeight(r), v: v * loft, pressured, air: px });
  lp.stats.target = r;
  lp.stats.cov = nearestDef(lp, r);
  event(lp, 'throw', `${nm(qb.id)} throws for ${nm(r.id)}`, qb, r);
}

// A ballistic flight from (sx, sy, z0) that comes down through (tx, ty, zc) after T seconds.
function launch(lp, f) {
  const horiz = Math.hypot(f.tx - f.sx, f.ty - f.sy);
  const T = Math.max(0.18, horiz / f.v);
  const vz = (f.zc - f.z0 + 0.5 * GRAVITY * T * T) / T;
  lp.thrown = { ...f, T, vz, t0: lp.t };
  lp.ball = { ...lp.ball, state: 'air', holder: null, x: f.sx, y: f.sy, z: f.z0 };
  lp.qbState = 'done';
}

// The ball's position e seconds into its flight (the renderer draws the arc from this too).
export function flightAt(F, e) {
  const u = e / F.T;
  return { x: F.sx + (F.tx - F.sx) * u, y: F.sy + (F.ty - F.sy) * u, z: F.z0 + F.vz * e - 0.5 * GRAVITY * e * e };
}

function futureRoute(r, T) {
  // Run a copy of the receiver along his route for T seconds.
  const c = { x: r.x, y: r.y, vx: r.vx, vy: r.vy, fx: r.fx, fy: r.fy, top: r.top, accel: r.accel, route: r.route, wp: r.wp, role: 'route' };
  const stub = { thrown: null, t: 9, goalX: 999 };
  for (let t = 0; t < T; t += DT) {
    const w = c.route?.[c.wp];
    if (w && w.block != null) { c.wp++; continue; }
    routeWant(stub, c);
    const want = c.want ?? { vx: 0, vy: 0 };
    kin(c, want.vx, want.vy, c.top, DT);
  }
  return { x: c.x, y: c.y };
}

function nearestDef(lp, r) {
  let best = null, bd = 99;
  for (const q of lp.players) if (q.side === 'def') { const d = dist(q, r); if (d < bd) { bd = d; best = q; } }
  return best;
}

function snapFlight(lp) {
  const b = lp.ball;
  if (b.state !== 'snap') return;
  const qb = lp.off.QB;
  const u = clamp((lp.t - b.t0) / b.T, 0, 1);
  b.x = b.from.x + (qb.x + 0.3 - b.from.x) * u; b.y = b.from.y + (qb.y - b.from.y) * u;
  b.z = 0.3 + 0.8 * u + Math.sin(u * Math.PI) * 0.25;
  if (u >= 1) { b.state = 'held'; b.holder = qb; }
}

function ballFlight(lp) {
  const T = lp.thrown;
  if (!T || lp.ball.state !== 'air') return;
  const e = lp.t - T.t0;
  const at = flightAt(T, Math.min(e, T.T));
  const b = lp.ball;
  b.x = at.x; b.y = at.y; b.z = at.z;
  if (e < T.T) return;
  if (T.away) { dropBall(lp, 0.45); incomplete(lp, `${nm(lp.off.QB.id)} throws it away.`); return; }
  arrival(lp);
}

// The ball comes loose (incomplete, dropped, batted): it keeps some of its flight and falls.
function dropBall(lp, keep, pop = 0) {
  const T = lp.thrown, b = lp.ball;
  const horiz = T ? Math.hypot(T.tx - T.sx, T.ty - T.sy) : 1;
  const ux = T ? (T.tx - T.sx) / (horiz || 1) : 1, uy = T ? (T.ty - T.sy) / (horiz || 1) : 0;
  const v = T ? horiz / T.T : 4;
  const vzArr = T ? T.vz - GRAVITY * T.T : -2;
  b.state = 'loose'; b.holder = null;
  b.vx = ux * v * keep + (pop ? (rand(lp.g) - 0.5) * 3 : 0);
  b.vy = uy * v * keep + (pop ? (rand(lp.g) - 0.5) * 3 : 0);
  b.vz = pop ? pop : vzArr * 0.5;
}

function looseBall(lp) {
  const b = lp.ball;
  if (b.state !== 'loose') return;
  b.vz -= GRAVITY * DT;
  b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
  if (b.z <= 0.15) {
    b.z = 0.15;
    if (Math.abs(b.vz) > 1.2) { b.vz = -b.vz * 0.35; b.vx *= 0.6; b.vy *= 0.6; }
    else { b.vz = 0; b.vx *= 0.9; b.vy *= 0.9; }
  }
}

// The ball reaches the catch point. Whoever is there plays it: the receiver, a defender who
// beat him to the spot, or nobody. Flying Pokémon reach a little farther for it.
function arrival(lp) {
  const g = lp.g, T = lp.thrown;
  const spot = { x: T.tx, y: T.ty };
  const r = T.target;
  const dr = dist(r, spot);
  const reachOf = (p) => 1.45 + traitMod('catchReach', { p }).v;
  let dfd = null, dd = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) { const d = dist(q, spot); if (d < dd) { dd = d; dfd = q; } }
  lp.sepAtArrival = dd; lp.drAtArrival = dr;
  const userDef = lp.user === lp.d && lp.control && lp.control.side === 'def' ? lp.control : null;
  const userPlay = userDef && dist(userDef, spot) < 1.8 && userDef.dive != null;
  lp.stats.cov = dfd && dd < 3 ? dfd : lp.stats.cov;
  const inBounds = Math.abs(spot.y) < SIDE && spot.x < lp.goalX + 10;
  const rReach = reachOf(r);
  if (dr <= rReach && dr > 1.45) traitNotes(lp, traitMod('catchReach', { p: r }), { p: r }, r, true);
  // Defender plays the ball first if he is closer.
  if (dfd && dd < 1.5 && (dd < dr || dr > rReach - 0.05)) {
    const tInt = traitMod('intChance', { d: dfd, r });
    const hawk = tInt.v;
    traitNotes(lp, tInt, { d: dfd, r }, dfd);
    const R = rep(dfd.id, dfd.a.cov, r.id, r.a.hndC);
    const pI = (diff) => clamp(0.12 + hawk + diff * 0.006 + (T.pressured ? 0.04 : 0) + (dr > rReach ? 0.12 : 0) - dd * 0.05, 0.03, 0.42)
      * (lp.offCall === 'screen' ? 0.4 : 1) + (userPlay && dfd === userDef ? 0.18 : 0);
    if (inBounds && contest(lp, pI(R.diff), pI(R.base), R, dfd, r, 'for the interception')) { interception(lp, dfd, spot); return; }
    const pB = (diff) => clamp(0.45 + diff * 0.01 - dd * 0.15 + (userPlay ? 0.25 : 0), 0.15, 0.9);
    if (dr > rReach || contest(lp, pB(R.diff), pB(R.base), R, dfd, r, 'at the catch point')) {
      st(g, lp.d, dfd.id).pd++;
      dropBall(lp, 0.12, 3.2);
      event(lp, 'deflect', '', dfd, r);
      incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is broken up by ${nm(dfd.id)}.`, dfd);
      return;
    }
  }
  if (dr > rReach || !inBounds) {
    dropBall(lp, 0.45);
    incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} falls incomplete${dr > rReach ? ', just out of reach' : ''}.`);
    return;
  }
  const contested = dfd && dd < 1.8;
  const hands = contested ? r.a.hndC : r.a.hnd;
  const thrown = Math.hypot(T.tx - T.sx, T.ty - T.sy);
  const base = 0.93 + (hands - 75) * 0.006 - dr * 0.1 - Math.max(0, thrown - 14) * 0.009;
  let caught;
  if (contested) {
    const R = rep(r.id, hands, dfd.id, dfd.a.cov);
    const pc = (diff) => clamp(base - ((1.8 - dd) * 0.2 - diff * 0.006), 0.15, 0.98);
    caught = contest(lp, pc(R.diff), pc(R.base), R, r, dfd, 'on the contested catch');
  } else caught = chance(g, clamp(base, 0.15, 0.98));
  if (caught) {
    // The ball comes to his hands where he is; nobody jumps to the spot.
    const deepCatch = thrown > 18;
    r.vx *= deepCatch ? 0.3 : 0.45; r.vy *= deepCatch ? 0.3 : 0.45; r.slow = deepCatch ? 0.5 : 0.3;
    r.caughtAt = lp.t;
    lp.caught = true;
    lp.catchX = r.x;
    lp.catchAt = { x: lp.ball.x, y: lp.ball.y };
    setCarrier(lp, r);
    event(lp, 'catch', `${nm(r.id)} makes the catch`, r, lp.off.QB);
    return;
  }
  if (contested) st(g, lp.d, dfd.id).pd++;
  dropBall(lp, 0.2, 1.5);
  incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is dropped${contested ? ` with ${nm(dfd.id)} draped on him` : ''}.`);
}

function interception(lp, d, spot) {
  lp.intercepted = true;
  lp.picker = d;
  lp.catchX = d.x;
  lp.catchAt = { x: spot.x, y: spot.y };
  d.caughtAt = lp.t;
  for (const p of lp.players) if (p.eng) unengage(p);
  setCarrier(lp, d);
  event(lp, 'int', `INTERCEPTED by ${nm(d.id)}!`, d, lp.thrown?.target);
}

// A rated contest rolled once. pWith includes the type matchup, pWithout leaves it out; when
// they disagree about this roll, the types decided it, and the play says so.
function contest(lp, pWith, pWithout, R, a, d, where) {
  const roll = rand(lp.g);
  const hit = roll < pWith;
  if (hit !== roll < pWithout) {
    const w = hit ? a : d, l = hit ? d : a;
    const se = hit ? R.aSE : R.dSE;
    note(lp, 'type', se ? `${nm(w.id)}'s ${PLAYERS[w.id].types.join('/')} typing is super effective against ${nm(l.id)} ${where}`
      : `${nm(l.id)}'s ${PLAYERS[l.id].types.join('/')} typing costs it ${where}`, w);
    if (se) lp.typeWin = { winner: w, loser: l, where };
  }
  return hit;
}

// Notes for the traits that acted at a hook (quiet ones only when the caller says so).
function traitNotes(lp, T, ctx, who, decided = false) {
  for (const t of T.used) if (!t.quiet || decided) note(lp, t.kind, t.note(ctx), who);
}

// Something about a Pokémon (its type, its ability, its build) changed this play.
function note(lp, kind, text, who = null) {
  if (lp.notes.some((n) => n.text === text)) return;
  lp.notes.push({ t: lp.t, kind, text, who });
  event(lp, 'note', text, who);
}


function incomplete(lp, text, by = null) {
  if (lp.ball.state === 'air') dropBall(lp, 0.3);
  event(lp, 'incomplete', text, lp.thrown?.target ?? null, by);
  finish(lp, { how: 'incomplete', text, by });
}

// ---------- contact: tackles ----------
function contacts(lp) {
  const c = lp.carrierSet ? lp.carrier : lp.kind === 'pass' && lp.ball.holder === lp.off.QB ? lp.off.QB : null;
  if (!c) return;
  const g = lp.g;
  for (const q of lp.players) {
    if (q.side === c.side || q.eng || q.stun > 0 || q.cool > 0) continue;
    const dd = dist(q, c);
    // AI defenders lay out for a diving tackle when they are just out of reach.
    // Reach grows with body size so big Pokémon can still get their arms on a carrier they
    // are touching, but the base reach is the same for everyone.
    const near = Math.max(CONTACT, q.r + c.r + 0.3);
    const aiDive = q !== lp.control && dd > near && dd < near + 1 && chance(g, 0.05);
    const reach = near + (q.dive != null && q.dive > 0 ? 0.8 : 0);
    if (dd > reach && !aiDive) continue;
    q.cool = 0.5;
    if (aiDive) q.dive = 0.3;
    const tackle = q.a.tkl * 0.7 + q.a.str * 0.3;
    const evade = c.a.strBT * 0.55 + c.a.spd * 0.45;
    const R = rep(q.id, tackle, c.id, evade);
    const sack = lp.kind === 'pass' && !lp.carrierSet && c.slot === 'QB';
    const baseP = (diff) => (sack ? sigmoid(diff / 10 + 2.3) : sigmoid(diff / 11 + 2.6) - (aiDive ? 0.12 : 0));
    // Everything below adjusts the odds the same way whatever the type matchup.
    let p = 0;
    if (lp.players.some((o) => o !== q && o.side === q.side && !o.eng && dist(o, c) < 2.6)) p += 0.08;
    const user = c === lp.control && lp.manual;
    // Is the tackler coming from in front (spins beat those) or from the side (jukes do)?
    const cs = len(c.vx, c.vy) || 1;
    const headOn = ((q.x - c.x) * c.vx + (q.y - c.y) * c.vy) / (cs * (dd || 1)) > 0.5;
    if (c.juke > 0) p -= (user ? 0.32 : 0.18) * (0.35 + c.a.spd / 160 - q.a.spd / 400) * (headOn ? 0.8 : 1.2);
    if (c.spin > 0) p -= (user ? 0.3 : 0.17) * (0.3 + (c.a.spd + c.a.strBT) / 320 - q.a.tkl / 400) * (headOn ? 1.25 : 0.8);
    if (c.truck > 0) p -= 0.08 + (c.a.strBT - q.a.tkl) * 0.012 + clamp(Math.log(PLAYERS[c.id].weight / Math.max(1, PLAYERS[q.id].weight)) * 0.06, -0.12, 0.15);
    if (q.dive != null && q.dive > 0) p += 0.1;
    const tTk = traitMod('tackleOdds', { c, q });
    p += tTk.v;
    if (tTk.used.length) traitNotes(lp, tTk, { c, q }, c);
    if (c.slow > 0) p += 0.12;
    if (lp.t - (lp.carrierAt ?? 0) < 0.5 && lp.caught) p += 0.1;
    // A Ghost phases through its first would-be tackler each game.
    if (PLAYERS[c.id].types.includes('Ghost') && !g.ghostUsed[c.id] && !sack && chance(g, 0.35)) {
      g.ghostUsed[c.id] = true;
      q.stun = 0.8;
      lp.stats.extras.push(`phases right through ${nm(q.id)}`);
      event(lp, 'ghost', `${nm(c.id)} phases through ${nm(q.id)}!`, c, q);
      continue;
    }
    // Size: a small Pokémon has a hard time bringing down a giant one, and vice versa.
    const mass = clamp(Math.log(q.kg / c.kg) * 0.07, -0.18, 0.1);
    const pk = (diff) => clamp(baseP(diff) + p + mass, 0.08, 0.97);
    if (contest(lp, pk(R.diff), pk(R.base), R, q, c, sack ? 'on the sack' : 'on the tackle')) {
      if (lp.typeWin?.winner === q) lp.stats.se = true;
      startTackle(lp, c, q, sack, dd > near);
      return;
    }
    if (c.kg > q.kg * 2.5 && mass < -0.05) note(lp, 'size', `${nm(q.id)} is too small to bring down ${nm(c.id)} alone`, c);
    q.stun = aiDive ? 0.9 : c.truck > 0 ? 0.9 : 0.55; q.cool = 1.1; q.stunFall = c.truck > 0 || aiDive;
    if (c.truck > 0) { const k = clamp(c.kg / q.kg, 0.3, 1.2); q.vx = c.vx * 0.6 * k; q.vy = c.vy * 0.6 * k; } // knocked back
    c.slow = c.spin > 0 ? 0.12 : 0.22;
    const how = c.truck > 0 ? 'truck' : c.spin > 0 ? 'spin' : c.juke > 0 ? 'juke' : 'shake';
    if (!sack) lp.stats.extras.push(`${{ truck: 'runs over', spin: 'spins away from', juke: 'jukes', shake: 'breaks a tackle from' }[how]} ${nm(q.id)}`);
    event(lp, 'broken', `${nm(c.id)} ${{ truck: 'trucks', spin: 'spins off', juke: 'jukes', shake: 'shakes' }[how]} ${nm(q.id)}`, c, q);
    lp.events[lp.events.length - 1].how = how;
  }
}

// The tackle sequence. Contact: the tackler wraps up at body distance, both bodies are carried
// along by their shared momentum (a big carrier drags a small tackler for a yard or two, a big
// tackler stops a small carrier dead or drives him back), the carrier goes down, and the
// whistle blows when he is on the turf. The ball is spotted at his forward progress.
function startTackle(lp, c, q, sack, dove) {
  for (const p of [c, q]) if (p.eng) unengage(p);
  const mc = c.kg, mq = q.kg * (dove ? 0.7 : 1);
  const vx = (mc * c.vx + mq * q.vx) / (mc + mq), vy = (mc * c.vy + mq * q.vy) / (mc + mq);
  const fwd = c.side === 'off' ? 1 : -1;
  const drag = clamp(Math.log(mc / mq) * 0.25 + len(vx, vy) * 0.03, -0.2, 0.6);
  lp.tackle = { c, q, sack, t0: lp.t, T: TACKLE_T * (1 + drag), vx, vy, fp: c.x, fwd, dove, contact: { x: c.x, y: c.y } };
  if (lp.windup) lp.windup = null;
  c.slow = 0; q.dive = dove ? 0.3 : q.dive;
  event(lp, 'contact', `${nm(q.id)} wraps up ${nm(c.id)}`, q, c);
}

function tackleStep(lp) {
  const T = lp.tackle;
  if (!T) return;
  const { c, q } = T;
  const e = lp.t - T.t0;
  if (e <= 0) return; // both already moved this step
  // Teammates arriving add their weight and the pile stops sooner.
  let help = 0;
  for (const o of lp.players) if (o !== q && o.side === q.side && !o.eng && dist(o, c) < o.r + c.r + 0.25) help++;
  const f = Math.exp(-DT * (3.2 + help * 2.5));
  T.vx *= f; T.vy *= f;
  c.vx = T.vx; c.vy = T.vy; c.x += c.vx * DT; c.y += c.vy * DT;
  // The tackler stays wrapped on the side he hit from, at body distance.
  let ux = q.x - c.x, uy = q.y - c.y; const l = len(ux, uy) || 1; ux /= l; uy /= l;
  const want = (c.r + q.r) * 0.9;
  q.vx = T.vx; q.vy = T.vy;
  q.x += q.vx * DT; q.y += q.vy * DT;
  ease(q, c.x + ux * want, c.y + uy * want, 5);
  c.fallU = clamp(e / T.T, 0, 1); q.fallU = clamp((e - 0.1) / T.T, 0, 1);
  // Forward progress: the farthest the carrier got before he was stopped or driven back.
  T.fp = T.fwd > 0 ? Math.max(T.fp, c.x) : Math.min(T.fp, c.x);
  if (c.side === 'off' && T.fp >= lp.goalX) { finish(lp, { how: 'td' }); return; }
  if (c.side === 'def' && T.fp <= lp.ownGoalX) { finish(lp, { how: 'td' }); return; }
  if (e >= T.T) tackled(lp, c, q, T.sack);
}

// The wrapped pair keeps its spacing when a third body crowds the tackler.
function wrapHold(lp) {
  const T = lp.tackle;
  if (!T) return;
  const { c, q } = T, need = (c.r + q.r) * 0.82;
  const dx = q.x - c.x, dy = q.y - c.y, d = len(dx, dy);
  if (d >= need || d < 1e-6) return;
  const k = Math.min(need - d, SEP_MAX) / d;
  q.x += dx * k; q.y += dy * k;
}

function tackled(lp, c, q, sack) {
  lp.stats.tackler = q;
  lp.spotX = lp.tackle?.fp ?? c.x;
  c.downed = true; q.downed = true;
  event(lp, sack ? 'sack' : 'tackle', `${nm(q.id)} ${sack ? 'sacks' : 'tackles'} ${nm(c.id)}`, q, c);
  finish(lp, { how: sack ? 'sack' : 'tackle', tackler: q });
}

function boundaries(lp) {
  const c = lp.carrierSet ? lp.carrier : null;
  if (!c) {
    const qb = lp.off.QB;
    if (qb && lp.ball.holder === qb && (Math.abs(qb.y) > SIDE || qb.x < lp.ownGoalX - 10)) finish(lp, { how: 'out' });
    return;
  }
  if (c.side === 'off' && c.x >= lp.goalX) { finish(lp, { how: 'td' }); return; }
  if (c.side === 'def' && c.x <= lp.ownGoalX) { finish(lp, { how: 'td' }); return; }
  const fp = lp.tackle ? lp.tackle.fp : c.x;
  if (Math.abs(c.y) > SIDE) { lp.spotX = fp; finish(lp, { how: 'out' }); return; }
  if (c.side === 'off' && c.x < lp.ownGoalX - 9.5) { lp.spotX = fp; finish(lp, { how: 'out' }); }
}

function whistle(lp, why) { finish(lp, { how: why }); }

// Where a holder carries the ball: tucked in front of the body at mid height, or up by the
// ear for a quarterback with a pass to throw. The renderer pins the ball to the model's own
// hand bone when it has one; this is the gameplay position the tests check.
export function holdPoint(lp, h) {
  if (lp.phase === 'pre') return { x: 0.05, y: 0, z: 0.17 };
  const qbSet = h === lp.off.QB && lp.kind === 'pass' && !lp.carrierSet;
  if (qbSet) return releasePoint(h);
  const k = h.r * 0.75;
  return { x: h.x + h.fx * k + h.fy * 0.12, y: h.y + h.fy * k - h.fx * 0.12, z: clamp(h.h * 0.48, 0.55, 1.4) };
}

function syncBall(lp) {
  const b = lp.ball;
  if (b.state === 'held' && b.holder) {
    const at = holdPoint(lp, b.holder);
    // A handoff: the ball travels from the quarterback's hands to the back's over the exchange.
    const X = b.xfer;
    if (X) {
      const u = clamp((lp.t - X.t0) / X.T, 0, 1), k = u * u * (3 - 2 * u);
      const q = X.from, from = X.at ?? { x: q.x + q.fx * (q.r + 0.15), y: q.y + q.fy * (q.r + 0.15), z: clamp(q.h * 0.55, 0.7, 1.5) };
      at.x = from.x + (at.x - from.x) * k; at.y = from.y + (at.y - from.y) * k; at.z = from.z + (at.z - from.z) * k;
      if (u >= 1) b.xfer = null;
    } else {
      // The hold changes shape (a snap caught, the passer cocking it, a catch tucked away):
      // the ball moves there over a few frames instead of jumping.
      const h = b.holder, d = Math.hypot(at.x - b.x, at.y - b.y, at.z - (b.z ?? at.z));
      const max = Math.hypot(h.vx, h.vy) * DT + 0.22;
      if (d > max && Number.isFinite(b.z)) {
        const k = max / d;
        at.x = b.x + (at.x - b.x) * k; at.y = b.y + (at.y - b.y) * k; at.z = b.z + (at.z - b.z) * k;
      }
    }
    b.x = at.x; b.y = at.y; b.z = at.z;
  }
}

function startExchange(lp, qb, rb) {
  setCarrier(lp, rb);
  lp.ball.xfer = { from: qb, to: rb, t0: lp.t, T: EXCHANGE_T };
  event(lp, 'handoff', '', rb, qb);
}

// ---------- the result ----------
function finish(lp, end) {
  if (lp.phase !== 'live') return;
  lp.phase = 'dead';
  lp.deadAt = lp.t;
  lp.end = end;
  lp.result = buildResult(lp, end);
}

function buildResult(lp, end) {
  const g = lp.g, o = lp.o, d = lp.d;
  const qb = lp.off.QB;
  const stats = lp.stats;
  const extras = stats.extras.length ? `, ${stats.extras.slice(0, 2).join(' and ')}` : '';
  const yardsWord = (y) => (y === 0 ? 'no gain' : y > 0 ? `${y} yard${y === 1 ? '' : 's'}` : `a loss of ${-y}`);
  const stop = end.how === 'out' || end.how === 'incomplete';

  if (end.how === 'incomplete') {
    st(g, o, qb.id).pa++;
    if (stats.target) st(g, o, stats.target.id).tg++;
    return { kind: 'pass', yards: 0, carrier: qb.id, qb: qb.id, text: end.text, clockStop: true };
  }
  const c = lp.carrier ?? qb;
  // Interception return
  if (lp.intercepted) {
    st(g, o, qb.id).pa++; st(g, o, qb.id).pint++;
    st(g, o, stats.target.id).tg++;
    st(g, d, c.id).dint++;
    if (end.tackler) st(g, o, end.tackler.id).tk++;
    const endX = lp.spotX ?? c.x;
    let returnSpot = Math.round(100 - lp.spot - endX);
    if (lp.catchX >= lp.goalX && endX >= lp.goalX) returnSpot = 0; // downed in the end zone: touchback
    return { kind: 'pass', yards: 0, carrier: c.id, qb: qb.id, returner: c.id, highlight: 'turnover', clockStop: true, turnover: 'int', returnSpot,
      text: `${nm(qb.id)} throws for ${nm(stats.target.id)}... INTERCEPTED by ${nm(c.id)}${returnSpot >= 100 ? ' and he takes it all the way back' : ''}!` };
  }
  // The dead-ball spot: forward progress for a tackle or a push out of bounds.
  let yards = Math.round(lp.spotX ?? c.x);
  if (end.how === 'td') yards = lp.goalX;
  yards = Math.max(yards, -lp.spot);
  const tackler = end.tackler ?? null;
  const tk = tackler ? ` Tackled by ${nm(tackler.id)}.` : end.how === 'out' ? ' Pushed out of bounds.' : '';
  const se = stats.se;
  const highlight = yards >= 20 ? 'big' : null;

  if (end.how === 'sack') {
    const qs = st(g, o, qb.id);
    qs.sk++; st(g, d, tackler.id).dsk++; st(g, d, tackler.id).tk++; g.teams[o].team.sacks++;
    let text = `${nm(tackler.id)} sacks ${nm(qb.id)} for a loss of ${Math.max(0, -yards)}.${se ? " It's super effective!" : ''}`;
    const tSt = traitMod('stripChance', { c: qb, q: tackler });
    const strip = Math.max(0, 0.07 + tSt.v);
    if (chance(g, strip)) {
      qs.fum++; st(g, d, tackler.id).ff++;
      if (chance(g, 0.6)) {
        const spotAt = clamp(lp.spot + yards, 1, 99);
        return { kind: 'sack', yards, carrier: qb.id, text: text + ` Strip sack! ${g.teams[d].name} recover.`, turnover: 'fumble',
          returnSpot: 100 - spotAt, highlight: 'turnover', clockStop: true, se };
      }
      text += ' The ball comes loose, but the offense falls on it.';
    }
    return { kind: 'sack', yards, carrier: qb.id, text, highlight: 'sack', se };
  }

  const isPass = lp.caught;
  if (isPass) {
    const qs = st(g, o, qb.id), rs = st(g, o, c.id);
    const counted = Math.min(yards, 100 - lp.spot);
    qs.pa++; qs.pc++; qs.py += counted; rs.tg++; rs.rc++; rs.rcy += counted; rs.rclong = Math.max(rs.rclong, yards);
    let text = `${nm(qb.id)} finds ${nm(c.id)}${extras} for ${yardsWord(yards)}.${tk}`;
    if (se) text += " It's super effective!";
    const r = { kind: 'pass', yards, carrier: c.id, scorer: c.id, qb: qb.id, text, clockStop: stop, highlight, se };
    if (tackler && end.how === 'tackle') {
      st(g, d, tackler.id).tk++;
      if (chance(g, Math.max(0, 0.006 + Math.min(0, traitMod('stripChance', { c, q: tackler }).v)))) {
        rs.fum++; st(g, d, tackler.id).ff++;
        return { ...r, text: text + ` FUMBLE! ${g.teams[d].name} recover.`, turnover: 'fumble', returnSpot: 100 - clamp(lp.spot + yards, 1, 99), highlight: 'turnover', clockStop: true };
      }
    }
    return r;
  }
  // Runs and scrambles
  const s = st(g, o, c.id);
  s.ra++; s.ry += Math.min(yards, 100 - lp.spot); s.rlong = Math.max(s.rlong, yards);
  const how = lp.scramble ? 'scrambles' : { inside: 'runs up the middle', outside: c.y < 0 ? 'runs around the left end' : 'runs around the right end', draw: 'runs the draw', sneak: 'sneaks ahead' }[lp.play.dir] ?? 'runs';
  let text = `${nm(c.id)} ${how}${extras} for ${yardsWord(yards)}.${tk}`;
  if (se) text += " It's super effective!";
  const r = { kind: 'run', yards, carrier: c.id, scorer: c.id, text, clockStop: stop, highlight: yards >= 20 ? 'big' : yards < 0 ? 'loss' : null, se };
  if (tackler && end.how === 'tackle') {
    st(g, d, tackler.id).tk++;
    if (fumbleCheck(g, o, d, c.id, tackler.id)) {
      s.fum++; st(g, d, tackler.id).ff++;
      if (chance(g, 0.55)) {
        return { ...r, text: text + ` FUMBLE! ${g.teams[d].name} recover.`, turnover: 'fumble', returnSpot: 100 - clamp(lp.spot + yards, 1, 99), highlight: 'turnover', clockStop: true };
      }
      r.text += ' Fumble, but the offense recovers.';
    }
  }
  return r;
}

// Where everyone is on the field in world yards (x from the left end line, z across), for
// the next play's walk-in.
export function worldSpots(lp) {
  const los = lp.o === 0 ? lp.spot : 100 - lp.spot, dir = lp.o === 0 ? 1 : -1;
  return new Map(lp.players.map((p) => [`${p.ti}:${p.id}`, { ax: los + dir * p.x, az: dir * p.y, down: !!p.downed || (p.recover ?? 0) > 0 }]));
}

// Play the whole thing with every player on autopilot (tests and "watch" mode).
export function autoPlay(lp, maxSteps = 60 * 20) {
  snap(lp);
  for (let i = 0; i < maxSteps && lp.phase === 'live'; i++) step(lp, null);
  return lp.result;
}

// Seconds of game clock the play used.
export function playSeconds(lp) { return Math.max(4, Math.round((lp.deadAt ?? lp.t) + 2.5)); }
