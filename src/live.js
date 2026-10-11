// Live plays: one run or pass played out in real time by 22 Pokémon on the field.
// Every player moves with its own speed and acceleration; blocks, coverage, throws, catches
// and tackles are resolved from the same ratings and type matchups as the simulated games.
// Coordinates are yards in the offense's frame: x runs downfield from the line of scrimmage,
// y runs across the field (sidelines at ±SIDE). No DOM access, so tests can run it headless.
import { PLAYERS, SLOT, SLOTS } from './ratings.js';
import { OFF_PLAYS, rand, randn, chance, clamp, sigmoid, eff, rep, has, nm, st, fumbleCheck } from './engine.js';
import { WEATHER } from './types.js';

export const SIDE = 26.65;
export const DT = 1 / 60;
const MAX_TIME = 14;
const CONTACT = 1.2;
const ENGAGE = 1.15;

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
    stats: { tackler: null, cov: null, target: null, se: false, extras: [] }, readTick: 0,
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
  setupDefense(lp);
  setupOffense(lp);
  lp.ball.holder = lp.off.C ?? lp.off.QB;
  syncBall(lp);
  if (lp.user === o) lp.control = lp.off.QB;
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
  };
  const P = PLAYERS[id];
  const heavy = clamp((P.weight / 10 - 60) / 400, 0, 0.35);
  return {
    id, slot, side, ti, x: S.x, y: S.y, vx: 0, vy: 0,
    fx: side === 'off' ? 1 : -1, fy: 0, a,
    top: 6.2 + 0.03 * a.spd, accel: (7 + 0.05 * a.spd) * (1 - heavy),
    role: 'idle', eng: null, engT: 0, stun: 0, cool: 0, slow: 0, wp: 0, route: null, man: null, zone: null,
    react: 0, manual: false, anim: rand(g) * 8, juke: 0, truck: 0, burst: 1,
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
  for (const p of Object.values(D)) p.x = Math.max(0.9, cap(p.x));

  const O = lp.off;
  const covR = (r, c) => {
    const route = lp.depth === 'deep' ? r.a.spd * 0.6 + r.a.hnd * 0.25 + r.a.acc * 0.15 : r.a.spd * 0.35 + r.a.hnd * 0.3 + r.a.acc * 0.35;
    const R = rep(r.id, route, c.id, c.a.cov);
    return clamp(0.12 + R.diff * 0.008, 0.03, 0.4);
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
    for (const [k, zn] of Object.entries(zones)) if (D[k] && D[k].role === 'cover') { D[k].zone = zn; D[k].lag = clamp(0.32 - (D[k].a.cov - 60) * 0.005, 0.08, 0.45); }
  }
}

function setupOffense(lp) {
  const O = lp.off, play = lp.play;
  const rbBlocks = lp.blitz.length > 0 && lp.offCall !== 'screen';
  for (const k of ['LT', 'LG', 'C', 'RG', 'RT']) if (O[k]) { O[k].role = lp.kind === 'run' ? 'runblock' : 'passblock'; O[k].x = -0.8; }
  if (lp.kind === 'run') {
    const dir = play.dir;
    lp.carrier = dir === 'sneak' ? O.QB : O.RB;
    lp.holeY = dir === 'outside' ? (chance(lp.g, 0.5) ? -9 : 9) : dir === 'sneak' ? 0 : (chance(lp.g, 0.5) ? -1.6 : 1.6);
    if (dir === 'draw') lp.holeY = chance(lp.g, 0.5) ? -2.5 : 2.5;
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
  lp.phase = 'live';
  lp.t = 0;
  const qb = lp.off.QB;
  lp.ball.holder = qb;
  if (lp.kind === 'run' && lp.play.dir === 'sneak') setCarrier(lp, qb);
  event(lp, 'snap');
}

export function step(lp, input = null) {
  if (lp.phase === 'pre') { animIdle(lp, DT); return; }
  if (lp.phase !== 'live') { for (const p of lp.players) slowDown(p, DT); syncBall(lp); return; }
  lp.t += DT;
  const g = lp.g;
  if (input) applyInput(lp, input);

  // Run play handoff
  if (lp.kind === 'run' && !lp.carrierSet && lp.t >= lp.handAt) {
    const rb = lp.carrier;
    if (rb && dist(rb, lp.off.QB) < 2.4) { setCarrier(lp, rb); event(lp, 'handoff'); }
    else if (lp.t > lp.handAt + 0.8 && rb) { setCarrier(lp, rb); }
  }
  // AI quarterback
  if (lp.kind === 'pass' && lp.qbState !== 'done' && !lp.thrown) qbBrain(lp);

  for (const p of lp.players) think(lp, p);
  for (const p of lp.players) move(lp, p, DT);
  separate(lp);
  blocks(lp);
  ballFlight(lp);
  if (lp.phase === 'live') contacts(lp);
  if (lp.phase === 'live') boundaries(lp);
  syncBall(lp);
  if (lp.phase === 'live' && lp.t > MAX_TIME) whistle(lp, 'time');
  void g;
}

function event(lp, kind, text = '') { lp.events.push({ t: lp.t, kind, text }); }

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
  // The user takes over the ball carrier on their own team.
  if (lp.user != null && p.ti === lp.user && lp.control !== p) { lp.control = p; lp.manual = false; }
  // Everyone switches to the ball once it is handed off, caught or picked.
  for (const q of lp.players) {
    if (q === p) continue;
    if (q.side !== p.side) { q.role = 'pursue'; q.react = q.eng ? 0 : 0.12 + (100 - q.a.spd) * 0.002; }
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
  if (inp.juke && c.juke <= -0.9) { c.juke = 0.35; event(lp, 'juke'); }
  if (inp.truck && c.truck <= -0.9) { c.truck = 0.35; event(lp, 'truck'); }
  if (inp.dive && c.dive == null) { c.dive = 0.3; }
  if (inp.throwTo && lp.kind === 'pass' && !lp.thrown && lp.ball.holder === lp.off.QB && lp.qbState !== 'run') {
    const r = lp.off[inp.throwTo];
    if (r && r.role === 'route') throwTo(lp, r);
  }
  if (inp.throwAway && lp.kind === 'pass' && !lp.thrown && lp.ball.holder === lp.off.QB && lp.qbState !== 'run') throwAway(lp);
}

// ---------- decisions ----------
function think(lp, p) {
  p.want = null;
  if (p.stun > 0) return;
  if (p === lp.control && lp.manual) { manualWant(lp, p); return; }
  const c = lp.carrierSet ? lp.carrier : null;
  switch (p.role) {
    case 'qb': return qbMove(lp, p);
    case 'handoff': {
      const mesh = { x: -4.2, y: lp.holeY > 0 ? 0.6 : -0.6 };
      return seek(p, lp.t > lp.handAt + 0.3 ? { x: -6, y: -lp.holeY * 0.3 } : mesh, 0.6);
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

function qbBrain(lp) {
  const qb = lp.off.QB;
  if (!qb || lp.ball.holder !== qb || lp.qbState === 'run') return;
  if (lp.qbState === 'drop' && lp.t >= lp.readAt) lp.qbState = 'read';
  // Crossing the line makes the quarterback a runner.
  if (qb.x > 0.3) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble'); return; }
  if (lp.user === lp.o && !lp.autoQB) return; // the user throws
  if (lp.qbState !== 'read') return;
  lp.readTick -= DT;
  if (lp.readTick > 0) return;
  lp.readTick = 0.12;
  const g = lp.g;
  const elapsed = lp.t - lp.readAt;
  let nearRush = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) nearRush = Math.min(nearRush, dist(q, qb));
  lp.pressure = nearRush < 2.6;
  const vision = qb.a.acc;
  const noise = 0.5 + (95 - vision) * 0.025 + (lp.pressure ? 0.8 : 0);
  let best = null;
  for (const k of lp.eligible) {
    const r = lp.off[k];
    if (!r || r.role !== 'route' || (r.route?.[0]?.block && r.wp === 0)) continue;
    const T = dist(qb, r) / throwSpeed(qb);
    const px = r.x + r.vx * T, py = r.y + r.vy * T;
    let open = 99;
    for (const q of lp.players) if (q.side === 'def') open = Math.min(open, Math.hypot(q.x + q.vx * T * 0.6 - px, q.y + q.vy * T * 0.6 - py));
    const gain = clamp(px, -3, 25) * 0.07;
    const score = open + gain + (lp.play.targets[k] ?? 0) * 2.2 + noise * randn(g);
    if (!best || score > best.score) best = { r, score, open };
  }
  const need = 4.3 - elapsed * 1.4;
  if (best && (best.score > need || (lp.pressure && best.score > 2.4))) { throwTo(lp, best.r); return; }
  if (nearRush < 1.8 || elapsed > 2.6) {
    const spd = qb.a.spd;
    if (chance(g, clamp((spd - 50) / 120, 0.05, 0.4) * 0.35)) { lp.qbState = 'run'; lp.scramble = true; setCarrier(lp, qb); event(lp, 'scramble'); return; }
    if (elapsed > 2.6 && chance(g, 0.12)) { throwAway(lp); return; }
    if (best && elapsed > 1.7 && best.score > 0.3) throwTo(lp, best.r);
  }
}

function routeWant(lp, p) {
  if (lp.thrown && lp.thrown.target === p) {
    // Work back to the ball.
    return seek(p, { x: lp.thrown.tx, y: lp.thrown.ty }, 1, 0.4);
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

function passBlockWant(lp, p) {
  const qb = lp.off.QB;
  if (p.eng) return;
  // Pick up the most dangerous rusher nobody has.
  let best = null, bd = 99;
  for (const q of lp.players) {
    if (q.side !== 'def' || q.role !== 'rush' || q.eng) continue;
    const taken = lp.players.some((b) => b !== p && b.side === 'off' && b.pick === q);
    const dd = dist(q, p) + (taken ? 3 : 0) + Math.abs(q.y - p.y) * 0.4;
    if (dd < bd) { bd = dd; best = q; }
  }
  p.pick = best;
  if (!best || bd > 9) { seek(p, { x: lp.dropX + 3, y: p.y * 0.8 }, 0.4); return; }
  // Stay between the rusher and the quarterback.
  const ax = qb.x - best.x, ay = qb.y - best.y, l = len(ax, ay) || 1;
  seek(p, { x: best.x + (ax / l) * 0.9, y: best.y + (ay / l) * 0.9 }, 0.9, 0.5);
}

function runBlockWant(lp, p) {
  if (p.eng) return;
  let tgt = p.assign && !p.assign.eng ? p.assign : null;
  if (!tgt || dist(tgt, p) > 7) {
    let bd = 6;
    for (const q of lp.players) if (q.side === 'def' && !q.eng && dist(q, p) < bd) { bd = dist(q, p); tgt = q; }
  }
  if (!tgt) { seek(p, { x: p.x + 3, y: p.y }, 0.5); return; }
  const c = lp.carrier ?? lp.off.RB;
  const ax = (c?.x ?? -4) - tgt.x, ay = (c?.y ?? 0) - tgt.y, l = len(ax, ay) || 1;
  seek(p, { x: tgt.x + (ax / l) * 0.8, y: tgt.y + (ay / l) * 0.8 }, 0.85, 0.4);
}

function stalkWant(lp, p) {
  if (p.eng) return;
  const t = p.assign;
  if (!t || t.eng) { seek(p, { x: p.x + 2, y: p.y }, 0.4); return; }
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
  const ax = c.x - tgt.x, ay = c.y - tgt.y, l = len(ax, ay) || 1;
  seek(p, { x: tgt.x + (ax / l) * 0.8, y: tgt.y + (ay / l) * 0.8 }, 0.95, 0.3);
}

function rushWant(lp, p) {
  if (p.eng) return;
  const c = lp.carrierSet ? lp.carrier : lp.off.QB;
  if (!c) return;
  // Draws and play-action freeze the front for a beat.
  const fooled = (lp.play.dir === 'draw' || lp.play.pa) && lp.t < 0.5;
  intercept(p, c, fooled ? 0.7 : 1);
}

function coverWant(lp, p) {
  const g = lp.g;
  const c = lp.carrierSet ? lp.carrier : null;
  if (c) { pursueWant(lp, p, c); return; }
  if (lp.thrown) {
    const T = lp.thrown;
    if (p.react == null || p.react <= -1) p.react = 0.12 + (100 - p.a.cov) * 0.004;
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
    const lag = p.lag ?? 0.2;
    const px = r.x - r.vx * lag, py = r.y - r.vy * lag;
    // Keep a cushion over the top that closes as the route develops.
    p.gap0 ??= Math.max(1, p.x - r.x);
    const cushion = Math.max(r.x > 12 ? 1.0 : 0.4, p.gap0 - lp.t * 5);
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
  const px = threat.x - threat.vx * lag, py = threat.y - threat.vy * lag;
  const tx = (px + 1.2) * 0.75 + z.x * 0.25, ty = py * 0.75 + z.y * 0.25;
  seek(p, { x: tx, y: ty }, 1, 0.6);
}

function pursueWant(lp, p, c) {
  if (!c || p.eng) return;
  if (p.react > 0) { p.react -= DT; slowDown(p, DT); return; }
  intercept(p, c, 1);
}

// Aim at where the target will be, not where it is.
function intercept(p, c, frac) {
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
  if (lp.kind === 'run' && p.slot === 'RB' && lp.t - (lp.carrierAt ?? 0) < 0.55 && p.x < 0) {
    return seek(p, { x: 1.5, y: lp.holeY }, 1, 0.05);
  }
  let best = null;
  for (let a = -90; a <= 90; a += 15) {
    const r = (a * Math.PI) / 180;
    const dx = Math.cos(r) * fwd, dy = Math.sin(r);
    let danger = 0;
    for (let k = 1; k <= 3; k++) {
      const px = p.x + dx * 2.2 * k, py = p.y + dy * 2.2 * k;
      for (const q of lp.players) {
        if (q.side === p.side || q.stun > 0.2) continue;
        const dd = Math.hypot(q.x - px, q.y - py);
        const w = q.eng ? 0.35 : 1;
        danger += (w * 2.4) / (0.6 + dd * dd) / k;
      }
      if (Math.abs(py) > SIDE - 1) danger += 0.8 / k;
    }
    const score = dx * fwd * 1.7 - danger - Math.abs(a) * 0.002;
    if (!best || score > best.score) best = { dx, dy, score };
  }
  const sprint = 1;
  const l = len(best.dx, best.dy);
  p.want = { vx: (best.dx / l) * p.top * sprint, vy: (best.dy / l) * p.top * sprint };
  // Fast backs juke when a tackler closes in.
  if (p !== lp.control || !lp.manual) {
    for (const q of lp.players) {
      if (q.side !== p.side && !q.eng && dist(q, p) < 1.9 && p.juke <= -0.9 && chance(g, 0.04 + p.a.spd / 1500)) { p.juke = 0.35; break; }
    }
  }
}

// ---------- movement ----------
function move(lp, p, dt) {
  p.anim += dt * (2 + len(p.vx, p.vy) * 0.9);
  p.juke = Math.max(-1, p.juke - dt);
  p.truck = Math.max(-1, p.truck - dt);
  if (p.dive != null) { p.dive -= dt; if (p.dive < -0.6) p.dive = null; }
  p.cool = Math.max(0, p.cool - dt);
  if (p.stun > 0) { p.stun -= dt; slowDown(p, dt, 9); integrate(p, dt); return; }
  if (p.eng) return; // engaged players move as a pair in blocks()
  let { vx, vy } = p.want ?? { vx: 0, vy: 0 };
  let top = p.top * (p.slow > 0 ? 0.6 : 1) * (p.carrier ? 0.97 : 1);
  if (p.juke > 0.15) {
    // A sharp cut sideways.
    const l = len(vx, vy) || 1;
    const side = p.jukeSide ?? (chance(lp.g, 0.5) ? 1 : -1);
    p.jukeSide = side;
    const px = (-vy / l) * side, py = (vx / l) * side;
    vx = px * top * 0.9 + vx * 0.45; vy = py * top * 0.9 + vy * 0.45;
  } else p.jukeSide = null;
  p.slow = Math.max(0, p.slow - dt);
  kin(p, vx, vy, top, dt, p.juke > 0 ? 2.2 : 1);
}

// Accelerate toward a wanted velocity; braking and cutting are quicker than speeding up.
function kin(p, vx, vy, top, dt, boost = 1) {
  const wl = len(vx, vy);
  if (wl > top) { vx *= top / wl; vy *= top / wl; }
  let dvx = vx - p.vx, dvy = vy - p.vy;
  const brake = dvx * p.vx + dvy * p.vy < 0 ? 2 : 1;
  const dl = len(dvx, dvy), amax = p.accel * dt * boost * brake;
  if (dl > amax) { dvx *= amax / dl; dvy *= amax / dl; }
  p.vx += dvx; p.vy += dvy;
  integrate(p, dt);
}

function integrate(p, dt) {
  p.x += p.vx * dt; p.y += p.vy * dt;
  const sp = len(p.vx, p.vy);
  if (sp > 0.6) { p.fx = p.vx / sp; p.fy = p.vy / sp; }
}

function slowDown(p, dt, k = 6) {
  const f = Math.max(0, 1 - k * dt);
  p.vx *= f; p.vy *= f;
  if (!p.eng) integrate(p, dt);
}

function animIdle(lp, dt) { for (const p of lp.players) p.anim += dt * 2; }

function separate(lp) {
  const ps = lp.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (a.eng === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
      if (d > 0.75 || d === 0) continue;
      const push = (0.75 - d) * 0.5;
      const ux = dx / d, uy = dy / d;
      if (!a.eng && !a.carrier) { a.x -= ux * push; a.y -= uy * push; }
      if (!b.eng && !b.carrier) { b.x += ux * push; b.y += uy * push; }
    }
  }
}

// ---------- blocking ----------
function blocks(lp) {
  const g = lp.g;
  // New engagements
  for (const b of lp.players) {
    if (b.eng || b.stun > 0 || b.carrier) continue;
    const blocker = b.side === lp.carrierTeam && ['passblock', 'runblock', 'stalk', 'escort'].includes(b.role)
      || (b.role === 'route' && b.route?.[b.wp]?.block != null);
    if (!blocker) continue;
    for (const d of lp.players) {
      if (d.side === b.side || d.eng || d.carrier || d.stun > 0 || d.shedT > 0) continue;
      if (dist(b, d) > ENGAGE) continue;
      engage(lp, b, d);
      break;
    }
  }
  // Existing engagements: push and shed
  for (const b of lp.players) {
    if (!b.eng || b.side !== lp.carrierTeam) continue;
    const d = b.eng;
    b.engT += DT;
    const passPro = lp.kind === 'pass' && !lp.carrierSet;
    const bv = passPro ? b.a.blk * 0.75 + b.a.str * 0.25 : b.a.blk * 0.5 + b.a.str * 0.5;
    const dv = passPro ? d.a.rush : d.a.str * 0.6 + d.a.tkl * 0.4;
    const R = rep(d.id, dv, b.id, bv);
    // Rate of getting off the block, per second.
    const base = passPro ? 0.3 : lp.carrierSet ? 0.4 : 0.18;
    let rate = base * Math.exp(R.diff / 11) * (b.engT < 0.4 ? 0.4 : 1);
    if (!passPro) rate = Math.max(rate, 0.1);
    // Blocks far from the ball break up on their own.
    if (lp.carrierSet && dist(d, lp.carrier) > 6 && b.engT > 0.6) rate = Math.max(rate, 2.5);
    if (chance(g, rate * DT)) {
      unengage(b);
      b.stun = 0.35; d.shedFrom = b; d.shedT = passPro ? 0.8 : 0.5;
      if (passPro) lp.pressureBy = d;
      continue;
    }
    // The pair drifts toward whoever is winning.
    const target = lp.carrierSet ? lp.carrier : lp.off.QB;
    let ux = target.x - d.x, uy = target.y - d.y; const l = len(ux, uy) || 1; ux /= l; uy /= l;
    const push = clamp((passPro ? 0.4 : -0.3) + R.diff * 0.05, -1.6, 1.8);
    const vx = ux * push, vy = uy * push * 0.6;
    for (const q of [b, d]) { q.vx = vx; q.vy = vy; q.x += vx * DT; q.y += vy * DT; }
    // keep the blocker in front
    const mx = (b.x + d.x) / 2, my = (b.y + d.y) / 2;
    b.x = mx + ux * 0.45; b.y = my + uy * 0.45; d.x = mx - ux * 0.45; d.y = my - uy * 0.45;
  }
  for (const p of lp.players) if (p.shedT > 0) { p.shedT -= DT; if (p.shedT <= 0) p.shedFrom = null; }
}

function engage(lp, b, d) { b.eng = d; d.eng = b; b.engT = 0; d.engT = 0; }
function unengage(p) { const q = p.eng; if (q) q.eng = null; p.eng = null; }

// ---------- passing ----------
function throwSpeed(qb) { return 17 + 0.09 * qb.a.arm; }

function throwTo(lp, r) {
  const g = lp.g, qb = lp.off.QB;
  const v = throwSpeed(qb);
  // Lead the receiver: where will he be when the ball arrives?
  let T = dist(qb, r) / v, px = r.x, py = r.y;
  for (let i = 0; i < 4; i++) {
    const fut = futureRoute(r, T);
    px = fut.x; py = fut.y;
    T = Math.hypot(px - qb.x, py - qb.y) / v;
  }
  let near = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) near = Math.min(near, dist(q, qb));
  const pressured = near < 2.4;
  const D = lp.def;
  const intimidated = Object.values(D).some((d) => has(d.id, 'intimidate')) && !has(qb.id, 'clearBody');
  const acc = qb.a.acc - (intimidated ? 3 : 0) - (lp.g.weather === 'rain' ? 4 : 0);
  const air = Math.hypot(px - qb.x, py - qb.y);
  let sd = (0.25 + air * 0.042) * (1.75 - acc / 100) * (pressured ? (has(qb.id, 'focus') ? 1.25 : 1.5) : 1);
  if (lp.manual && lp.control === qb && len(qb.vx, qb.vy) > 2) sd *= 1.25; // throwing on the run
  px += randn(g) * sd * 1.2; py += randn(g) * sd;
  py = clamp(py, -SIDE - 2, SIDE + 2);
  T = Math.hypot(px - qb.x, py - qb.y) / v;
  lp.thrown = { target: r, sx: qb.x, sy: qb.y, tx: px, ty: py, T, t0: lp.t, pressured, air: px };
  lp.ball.state = 'air';
  lp.ball.holder = null;
  lp.qbState = 'done';
  lp.stats.target = r;
  lp.stats.cov = nearestDef(lp, r);
  event(lp, 'throw', `${nm(qb.id)} throws for ${nm(r.id)}`);
}

function throwAway(lp) {
  const qb = lp.off.QB;
  const side = qb.y >= 0 ? 1 : -1;
  lp.thrown = { target: null, sx: qb.x, sy: qb.y, tx: qb.x + 6, ty: side * (SIDE + 4), T: 1.1, t0: lp.t, away: true };
  lp.ball.state = 'air'; lp.ball.holder = null; lp.qbState = 'done';
  event(lp, 'throw', `${nm(qb.id)} throws it away`);
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

function ballFlight(lp) {
  const T = lp.thrown;
  if (!T || lp.ball.state !== 'air') return;
  const u = (lp.t - T.t0) / T.T;
  lp.ball.x = T.sx + (T.tx - T.sx) * Math.min(u, 1.05);
  lp.ball.y = T.sy + (T.ty - T.sy) * Math.min(u, 1.05);
  lp.ball.z = 1.9 + Math.sin(Math.PI * clamp(u, 0, 1)) * (0.3 + T.T * T.T * 1.4) - (u > 1 ? (u - 1) * 6 : 0);
  if (u < 1) return;
  if (T.away) { incomplete(lp, `${nm(lp.off.QB.id)} throws it away.`); return; }
  arrival(lp);
}

function arrival(lp) {
  const g = lp.g, T = lp.thrown;
  const spot = { x: T.tx, y: T.ty };
  const r = T.target;
  const dr = dist(r, spot);
  let dfd = null, dd = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng) { const d = dist(q, spot); if (d < dd) { dd = d; dfd = q; } }
  lp.sepAtArrival = dd; lp.drAtArrival = dr;
  const userDef = lp.user === lp.d && lp.control && lp.control.side === 'def' ? lp.control : null;
  const userPlay = userDef && dist(userDef, spot) < 1.8 && userDef.dive != null;
  lp.stats.cov = dfd && dd < 3 ? dfd : lp.stats.cov;
  const inBounds = Math.abs(spot.y) < SIDE && spot.x < lp.goalX + 10;
  // Defender plays the ball first if he is closer.
  if (dfd && dd < 1.5 && (dd < dr || dr > 1.4)) {
    const hawk = PLAYERS[dfd.id].types.includes('Dark') ? 0.07 : 0;
    const R = rep(dfd.id, dfd.a.cov, r.id, r.a.hndC);
    let pInt = clamp(0.12 + hawk + R.diff * 0.004 + (lp.thrown.pressured ? 0.04 : 0) + (dr > 1.4 ? 0.12 : 0) - dd * 0.05, 0.03, 0.42);
    if (userPlay && dfd === userDef) pInt += 0.18;
    if (lp.offCall === 'screen') pInt *= 0.4;
    if (inBounds && chance(g, pInt)) { interception(lp, dfd, spot); return; }
    const pBreak = clamp(0.45 + R.diff * 0.01 - dd * 0.15 + (userPlay ? 0.25 : 0), 0.15, 0.9);
    if (chance(g, pBreak) || dr > 1.4) {
      st(g, lp.d, dfd.id).pd++;
      incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is broken up by ${nm(dfd.id)}.`);
      return;
    }
  }
  if (dr > 1.45 || !inBounds) {
    incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} falls incomplete${dr > 1.45 ? ', just out of reach' : ''}.`);
    return;
  }
  const contested = dfd && dd < 1.8;
  const hands = contested ? r.a.hndC : r.a.hnd;
  const thrown = Math.hypot(T.tx - T.sx, T.ty - T.sy);
  let pc = 0.93 + (hands - 75) * 0.004 - dr * 0.1 - Math.max(0, thrown - 14) * 0.009;
  if (contested) {
    const R = rep(r.id, hands, dfd.id, dfd.a.cov);
    pc -= (1.8 - dd) * 0.2 - R.diff * 0.004;
  }
  if (chance(g, clamp(pc, 0.15, 0.98))) {
    r.x = spot.x; r.y = spot.y;
    const deepCatch = thrown > 18;
    r.vx *= deepCatch ? 0.3 : 0.45; r.vy *= deepCatch ? 0.3 : 0.45; r.slow = deepCatch ? 0.5 : 0.3;
    lp.caught = true;
    lp.catchX = spot.x;
    setCarrier(lp, r);
    event(lp, 'catch', `${nm(r.id)} makes the catch`);
    return;
  }
  if (contested) st(g, lp.d, dfd.id).pd++;
  incomplete(lp, `${nm(lp.off.QB.id)}'s pass for ${nm(r.id)} is dropped${contested ? ` with ${nm(dfd.id)} draped on him` : ''}.`);
}

function interception(lp, d, spot) {
  d.x = spot.x; d.y = spot.y;
  lp.intercepted = true;
  lp.picker = d;
  lp.catchX = spot.x;
  for (const p of lp.players) if (p.eng) unengage(p);
  setCarrier(lp, d);
  event(lp, 'int', `INTERCEPTED by ${nm(d.id)}!`);
}

function incomplete(lp, text) {
  lp.ball.state = 'dead';
  event(lp, 'incomplete', text);
  finish(lp, { how: 'incomplete', text });
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
    const aiDive = q !== lp.control && dd > CONTACT && dd < CONTACT + 0.7 && chance(g, 0.06);
    const reach = CONTACT + (q.dive != null && q.dive > 0 ? 0.8 : 0);
    if (dd > reach && !aiDive) continue;
    q.cool = 0.5;
    const tackle = q.a.tkl * 0.7 + q.a.str * 0.3;
    const evade = c.a.strBT * 0.5 + c.a.spd * 0.5;
    const R = rep(q.id, tackle, c.id, evade);
    let p = sigmoid(R.diff / 14 + 2.1) - (aiDive ? 0.2 : 0);
    const sack = lp.kind === 'pass' && !lp.carrierSet && c.slot === 'QB';
    if (sack) p = sigmoid(R.diff / 14 + 2.3);
    if (lp.players.some((o) => o !== q && o.side === q.side && !o.eng && dist(o, c) < 2.2)) p += 0.08;
    if (c.juke > 0) p -= (c === lp.control && lp.manual ? 0.32 : 0.18) * (0.6 + c.a.spd / 250);
    if (c.truck > 0) p -= 0.1 + (c.a.strBT - q.a.tkl) * 0.008;
    if (q.dive != null && q.dive > 0) p += 0.1;
    if (has(c.id, 'slippery')) p -= 0.05;
    if (c.slow > 0) p += 0.12;
    if (lp.t - (lp.carrierAt ?? 0) < 0.5 && lp.caught) p += 0.1;
    // A Ghost phases through its first would-be tackler each game.
    if (PLAYERS[c.id].types.includes('Ghost') && !g.ghostUsed[c.id] && !sack && chance(g, 0.35)) {
      g.ghostUsed[c.id] = true;
      q.stun = 0.8;
      lp.stats.extras.push(`phases right through ${nm(q.id)}`);
      event(lp, 'ghost', `${nm(c.id)} phases through ${nm(q.id)}!`);
      continue;
    }
    if (chance(g, clamp(p, 0.08, 0.97))) {
      if (R.aSE && R.diff > 8) lp.stats.se = true;
      tackled(lp, c, q, sack);
      return;
    }
    q.stun = aiDive ? 0.9 : 0.55; q.cool = 1.1;
    c.slow = 0.22;
    if (!sack) lp.stats.extras.push(`${c.truck > 0 ? 'runs over' : 'breaks a tackle from'} ${nm(q.id)}`);
    event(lp, 'broken', `${nm(c.id)} ${c.truck > 0 ? 'trucks' : 'shakes'} ${nm(q.id)}`);
  }
}

function tackled(lp, c, q, sack) {
  lp.stats.tackler = q;
  // Falling forward
  const fwd = c.side === 'off' ? 1 : -1;
  if (c.vx * fwd > 1 && !sack) c.x += fwd * 0.6;
  event(lp, sack ? 'sack' : 'tackle', `${nm(q.id)} ${sack ? 'sacks' : 'tackles'} ${nm(c.id)}`);
  finish(lp, { how: sack ? 'sack' : 'tackle', tackler: q });
}

function boundaries(lp) {
  const c = lp.carrierSet ? lp.carrier : null;
  if (!c) {
    const qb = lp.off.QB;
    if (qb && lp.ball.holder === qb && (Math.abs(qb.y) > SIDE || qb.x < lp.ownGoalX - 10)) finish(lp, { how: 'out' });
    return;
  }
  if (c.side === 'off' && c.x >= lp.goalX) { c.x = lp.goalX; finish(lp, { how: 'td' }); return; }
  if (c.side === 'def' && c.x <= lp.ownGoalX) { c.x = lp.ownGoalX; finish(lp, { how: 'td' }); return; }
  if (Math.abs(c.y) > SIDE) { finish(lp, { how: 'out' }); return; }
  if (c.side === 'off' && c.x < lp.ownGoalX - 9.5) finish(lp, { how: 'out' });
}

function whistle(lp, why) { finish(lp, { how: why }); }

function syncBall(lp) {
  const b = lp.ball;
  if (b.state === 'held' && b.holder) {
    const h = b.holder;
    b.x = h.x + h.fx * 0.35; b.y = h.y + h.fy * 0.35; b.z = 1.1;
  }
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
    const endX = c.x;
    let returnSpot = Math.round(100 - lp.spot - endX);
    if (lp.catchX >= lp.goalX && endX >= lp.goalX) returnSpot = 0; // downed in the end zone: touchback
    return { kind: 'pass', yards: 0, carrier: c.id, qb: qb.id, returner: c.id, highlight: 'turnover', clockStop: true, turnover: 'int', returnSpot,
      text: `${nm(qb.id)} throws for ${nm(stats.target.id)}... INTERCEPTED by ${nm(c.id)}${returnSpot >= 100 ? ' and he takes it all the way back' : ''}!` };
  }
  let yards = Math.round(c.x);
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
    const strip = has(qb.id, 'noFumble') ? 0 : 0.07 + (PLAYERS[tackler.id].types.includes('Poison') ? 0.03 : 0);
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
      if (chance(g, 0.006) && !has(c.id, 'noFumble')) {
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

// Play the whole thing with every player on autopilot (tests and "watch" mode).
export function autoPlay(lp, maxSteps = 60 * 20) {
  snap(lp);
  for (let i = 0; i < maxSteps && lp.phase === 'live'; i++) step(lp, null);
  return lp.result;
}

// Seconds of game clock the play used.
export function playSeconds(lp) { return Math.max(4, Math.round((lp.deadAt ?? lp.t) + 2.5)); }
