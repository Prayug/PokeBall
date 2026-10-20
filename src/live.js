// Live plays: one run or pass played out in real time by 22 Pokémon on the field.
// Every player moves with its own speed and acceleration; blocks, coverage, throws, catches
// and tackles are resolved from the same ratings and type matchups as the simulated games.
// Coordinates are yards in the offense's frame: x runs downfield from the line of scrimmage,
// y runs across the field (sidelines at ±SIDE). No DOM access, so tests can run it headless.
import { traitMod } from './traits.js';
import { PLAYERS, SLOT, SLOTS } from './ratings.js';
import { bestMatchup } from './types.js';
import { weatherPhys } from './weather.js';
import { OFF_PLAYS, aiTempo, chance, clamp, eff, fumbleCheck, nm, oobStops, rand, rep, setCall, sigmoid, snapStats, st } from './engine.js';
import { bodyOf } from './body.js';
import { diffOf, diffUser } from './difficulty.js';
import { CALL_FRONT, DEF_FORMATIONS, NEUTRAL, OFF_FORMATIONS, PLAY_FORMATION, alignFormation, foot, formationsFor, frontX, isGun, lineX, overlapIssues, resolveSpacing } from './formations.js';
import { DEF_SCHEMES, coverWant, pursueWant, rushWant, setupDefense } from './live/defense.js';
import { PLAY_ROUTES, airJumps, ballFlight, buildRoute, contest, coverageRead, looseBall, qbBrain, releasePoint, routeWant, snapFlight, startJump, startThrow, throwAway, windup } from './live/passing.js';
import { atSnap, shiftStep } from './live/presnap.js';
import { XP_SPOT, kickResult, kickStep, kickWant, liveKick, setupKick } from './live/kicks.js';
import { RATES, liveFoul, preSnapFoul, sloppy } from './penalties.js';
export { DEF_SCHEMES } from './live/defense.js';
export { liveKick } from './live/kicks.js';
export { ROUTES, PLAY_ROUTES, OPENNESS, releasePoint, catchHeight, flightAt } from './live/passing.js';
export { OFF_FORMATIONS as FORMATIONS, DEF_FORMATIONS, PLAY_FORMATION, CALL_FRONT, NEUTRAL, isGun };

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
// The handoff exchange: the ball travels from the quarterback's hands to the back's belly.
const EXCHANGE_T = 0.2;
// Run directions where the quarterback is the designed ball carrier ('read' decides at the mesh).
const QB_RUNS = new Set(['sneak', 'qbdraw', 'qbpower']);
const DROP = { screen: -6, short: -6.5, mid: -7.5, deep: -8.5 };
const READ_AT = { screen: 0.55, short: 0.95, mid: 1.55, deep: 2.1 };
export const RECEIVERS = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const len = (x, y) => Math.hypot(x, y);
export const sgn = (v) => (v < 0 ? -1 : 1);
// The line to gain, in yards past the line of scrimmage (the goal line when it is goal to go).
export const sticks = (lp) => clamp(lp.g.toGo ?? 10, 1, lp.goalX);
// Must this snap reach the sticks (third or fourth down with more than a yard to go)?
export const mustGain = (lp) => (lp.g.down ?? 1) >= 3 && sticks(lp) > 1;

// ---------- setup ----------
export function createLivePlay(g, offCall, defCall, opts = {}) {
  setCall(g, offCall, defCall);
  const o = g.poss, d = 1 - o;
  const play = OFF_PLAYS[offCall];
  // The extra point lines up at the 15, not at the 2 where a two-point try is run.
  const spot = play.kind === 'xp' ? XP_SPOT : g.spot;
  const lp = {
    g, o, d, offCall, defCall, play, kind: play.kind, depth: play.depth ?? null,
    t: 0, phase: 'pre', ball: { state: 'held', holder: null, x: 0, y: 0, z: 1.2 },
    spot, goalX: 100 - spot, ownGoalX: -spot,
    players: [], off: {}, def: {}, events: [], result: null,
    user: opts.userSide ?? null, autoQB: !!opts.autoQB, control: null, manual: false,
    // Two-player games: the second human plays the other team through the same fields here.
    p2: opts.user2 != null ? { user: opts.user2, control: null, manual: false, handoverLock: false, aggro: false } : null,
    blitz: [...(DEF_SCHEMES[defCall]?.blitz ?? [])],
    zone: !!DEF_SCHEMES[defCall]?.zones && !DEF_SCHEMES[defCall]?.manUnder,
    qbState: 'drop', pressure: false, thrown: null, caught: false, crossed: false, carrierTeam: 'off',
    stats: { tackler: null, cov: null, target: null, se: false, extras: [] }, readTick: 0, notes: [], tackle: null, windup: null,
    // A kick's long snap flies back like a shotgun snap.
    formation: liveKick(play) ? 'gun_spread' : formationsFor(offCall).includes(opts.formation) ? opts.formation : PLAY_FORMATION[offCall] ?? 'gun_spread',
    defFormation: DEF_FORMATIONS[opts.defFormation] ? opts.defFormation : CALL_FRONT[defCall] ?? '43',
    set: true, snapQueued: false, setT: 0,
    // The two-minute drill: an AI ball carrier heads for the sideline to stop the clock.
    clockOut: opts.clockOut ?? (g.phase !== 'pat' && aiTempo(g) === 'hurry' && oobStops(g)),
    // Flags: on in the game (the tests that replay seeded plays leave them off), never on kicks
    // or the try. fouls collects the ones thrown.
    flags: !!opts.flags && g.phase === 'play' && !liveKick(play), fouls: [],
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
  // The difficulty, in games the user coaches: how fast the AI side reads the play, and how far
  // the user's receivers reach for the ball (Pro changes neither).
  const D = diffUser(g) != null && lp.user != null ? diffOf(g) : null;
  lp.aiRead = D?.aiRead ?? 1;
  lp.userReach = D ? D.catchReach : 0;
  alignFormation(lp);
  setupDefense(lp);
  if (lp.user === o && lp.aiRead !== 1) for (const p of Object.values(lp.def)) if (p.lag != null) p.lag *= lp.aiRead;
  if (liveKick(play)) {
    // A punt or field goal: the kicking units line up (see live/kicks.js).
    setupKick(lp, makePlayer);
    lp.formationIssues = [];
  } else {
    resolveSpacing(lp);
    setupOffense(lp);
    for (const p of lp.players) p.home = { x: p.x, y: p.y };
    lp.formationIssues = validateFormation(lp);
  }
  if (opts.from) walkIn(lp, opts.from);
  // The returner and the punter come on from the sideline straight to their spots (on a
  // kickoff, everyone far from his spot does).
  if (lp.kick && opts.from) for (const p of lp.kick.ko ? lp.players : [lp.kick.returner, lp.kicker]) if (p && dist(p, p.home) > 12) { p.x = p.home.x; p.y = p.home.y; }
  if (!lp.kick?.ko) lp.ball.holder = lp.off.C ?? lp.off.QB;
  syncBall(lp);
  trackPossession(lp);
  // Coach mode (opts.watch): the user called the play and the AI plays every Pokémon.
  if (opts.watch) lp.control = null;
  // A kick: the receiving side has the returner; the kicking side takes a cover man once it is away.
  else if (lp.kick) lp.control = lp.user === d && lp.kick.returner ? lp.kick.returner : null;
  else if (lp.user === o) lp.control = lp.off.QB;
  else if (lp.user === d) lp.control = lp.def.MLB ?? lp.players.find((p) => p.side === 'def');
  if (lp.p2 && !opts.watch) {
    const P = lp.p2;
    if (lp.kick) P.control = P.user === d && lp.kick.returner ? lp.kick.returner : null;
    else if (P.user === o) P.control = lp.off.QB;
    else if (P.user === d) P.control = lp.def.MLB ?? lp.players.find((p) => p.side === 'def');
  }
  return lp;
}

// Is this player steered by a person right now (player one, or player two in a two-player game)?
export function isManual(lp, p) { return (p === lp.control && lp.manual) || (!!lp.p2 && p === lp.p2.control && lp.p2.manual); }
export function isControlled(lp, p) { return p === lp.control || (!!lp.p2 && p === lp.p2.control); }
// Player two's input runs through the same code as player one's: their control fields trade
// places for the call. Swapping twice restores both.
const PAD_KEYS = ['user', 'control', 'manual', 'handoverLock', 'aggro'];
export function swapPads(lp) {
  const P = lp.p2;
  for (const k of PAD_KEYS) [lp[k], P[k]] = [P[k], lp[k]];
}

function makePlayer(g, ti, side, slot, id, lp) {
  const S = SLOT[slot];
  const run = lp.kind === 'run';
  const a = {
    spd: eff(g, ti, id, 'spd', { run }), str: eff(g, ti, id, 'str'), blk: eff(g, ti, id, 'blk', { runBlock: run }),
    rush: eff(g, ti, id, 'rush'), cov: eff(g, ti, id, 'cov'), tkl: eff(g, ti, id, 'tkl'), hnd: eff(g, ti, id, 'hnd'),
    acc: eff(g, ti, id, 'acc', { deep: lp.depth === 'deep' }), arm: eff(g, ti, id, 'arm'),
    strBT: eff(g, ti, id, 'str', { breakTackle: true }), hndC: eff(g, ti, id, 'hnd', { contested: true }),
    acl: eff(g, ti, id, 'acl'), agi: eff(g, ti, id, 'agi'), awr: eff(g, ti, id, 'awr'), sta: eff(g, ti, id, 'sta'),
  };
  const P = PLAYERS[id];
  const B = bodyOf(id);
  const heavy = clamp((P.weight / 10 - 60) / 400, 0, 0.35);
  // The weather's hold on this body for the play (see weather.js): null when it plays through.
  const wx = weatherPhys(g.weather, id);
  if (wx?.awr) a.awr += wx.awr;
  return {
    id, slot, side, ti, x: S.x, y: S.y, vx: 0, vy: 0, px: S.x, py: S.y,
    fx: side === 'off' ? 1 : -1, fy: 0, a, r: B.r, kg: Math.max(1, B.kg), h: B.height,
    // Top speed from Speed; getting there from Acceleration; braking and cutting from Agility.
    // Heavy bodies are slower to get going and to turn.
    top: 5.6 + 0.04 * a.spd, accel: (6 + 0.03 * a.spd + 0.035 * a.acl) * (1 - heavy), cut: (1.4 + a.agi / 100) * (1 - heavy * 0.8) * (wx?.cut ?? 1), wx,
    // Sideways grip in a cut, yards per second squared: agility, less for a heavy body and on
    // a slick field.
    grip: (12 + a.agi * 0.1) * (1 - heavy * 0.7) * (wx?.cut ?? 1),
    role: 'idle', eng: null, engT: 0, stun: 0, cool: 0, slow: 0, wp: 0, route: null, man: null, zone: null,
    react: 0, manual: false, anim: rand(g) * 8, juke: -1, truck: -1, spin: -1, burst: 1,
    // Authoritative state the renderer, the HUD and the tests read: the action this player is
    // doing (see classify()), its contact state in a block, its target, and its acceleration.
    act: 'SET', contact: null, tgt: null, acl: 0, turnRate: 0,
  };
}

function setupOffense(lp) {
  const O = lp.off, play = lp.play;
  const rbBlocks = lp.blitz.length > 0 && lp.offCall !== 'screen';
  for (const k of ['LT', 'LG', 'C', 'RG', 'RT']) if (O[k]) O[k].role = lp.kind === 'run' ? 'runblock' : 'passblock';
  if (lp.kind === 'run') {
    const dir = play.dir;
    // Designed quarterback runs: he keeps it (a read option decides at the mesh).
    lp.qbRun = QB_RUNS.has(dir);
    lp.carrier = lp.qbRun ? O.QB : O.RB;
    // Inside runs hit the A or B gap between the actual linemen, outside runs the edge.
    const gap = (a, b) => (O[a] && O[b] ? (O[a].y + O[b].y) / 2 : null);
    const side = chance(lp.g, 0.5) ? -1 : 1;
    const inside = (k) => (side < 0 ? gap(...[['LG', 'C'], ['LT', 'LG']][k]) : gap(...[['C', 'RG'], ['RG', 'RT']][k])) ?? side * (k ? 2.7 : 0.9);
    lp.holeY = dir === 'outside' ? side * 7 : dir === 'sneak' ? 0 : inside(chance(lp.g, 0.55) ? 0 : 1);
    if (dir === 'draw') lp.holeY = inside(1);
    if (dir === 'dive' || dir === 'qbdraw' || dir === 'read') lp.holeY = inside(0);
    if (dir === 'counter') lp.holeY = inside(1);
    // Toss: pitched to the back, who races the edge.
    if (dir === 'toss') lp.holeY = side * 9.5;
    // Power: off tackle to the tight end's side, behind a pulling guard.
    lp.runSide = side;
    if (dir === 'power' || dir === 'qbpower') {
      const s2 = O.TE && O.TE.x > -3 ? sgn(O.TE.y) : side;
      lp.runSide = s2;
      const t = s2 > 0 ? O.RT : O.LT;
      lp.holeY = t ? t.y + s2 * 1.7 : s2 * 4.5;
    }
    // Each blocker takes the nearest defender in front of him.
    const bl = ['LT', 'LG', 'C', 'RG', 'RT', lp.formation === 'iform' && dir !== 'sneak' ? null : 'TE'].map((k) => k && O[k]).filter(Boolean);
    const df = ['LE', 'DE', 'DT1', 'DT2', 'OLB', 'MLB'].map((k) => lp.def[k]).filter(Boolean);
    const pairs = [];
    for (const b of bl) for (const d of df) pairs.push([Math.abs(b.y - d.y) + Math.max(0, d.x - 2) * 0.5, b, d]);
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [, b, d] of pairs) {
      if (b.assign || used.has(d)) continue;
      b.assign = d; b.role = 'runblock'; used.add(d);
    }
    // Receivers stalk-block the nearest man in coverage on their side, not a fixed slot (the
    // slot corner may be lined up across the field).
    const taken = new Set();
    for (const w of ['WR1', 'WR2', 'WR3']) {
      const r = O[w];
      if (!r) continue;
      let best = null, bd = 99;
      for (const q of Object.values(lp.def)) {
        if (taken.has(q) || used.has(q) || ['LE', 'DE', 'DT1', 'DT2'].includes(q.slot)) continue;
        const dd = Math.hypot(q.x - r.x, q.y - r.y);
        if (dd < bd) { bd = dd; best = q; }
      }
      r.role = 'stalk'; r.assign = best; if (best) taken.add(best);
    }
    // Power and counter pull the backside guard: he runs flat behind the line and leads
    // through the hole onto the first linebacker.
    if (dir === 'power' || dir === 'counter' || dir === 'qbpower') {
      const hs = sgn(lp.holeY || lp.runSide);
      const g2 = hs > 0 ? O.LG : O.RG;
      const lbs = ['OLB', 'MLB', 'CB3'].map((k) => lp.def[k]).filter(Boolean);
      const lb = lbs.sort((a, b) => Math.abs(a.y - lp.holeY) - Math.abs(b.y - lp.holeY))[0];
      if (g2 && lb) {
        // Whoever had the linebacker takes the guard's man instead.
        const was = bl.find((b) => b !== g2 && b.assign === lb);
        if (was) was.assign = g2.assign;
        g2.assign = lb; g2.pull = { until: dir === 'power' ? 0.85 : 0.85, via: { x: -1.5, y: lp.holeY - hs * 0.8 } };
      }
    }
    // A fullback (the I-form's tight end) leads through the hole instead of blocking a man: he
    // takes the linebacker nobody up front has.
    if (O.TE && lp.formation === 'iform' && dir !== 'sneak') {
      O.TE.role = 'lead';
      const free = ['MLB', 'OLB', 'SS'].map((k) => lp.def[k]).filter((q) => q && !bl.some((x) => x !== O.TE && x.assign === q));
      O.TE.assign = free.sort((a, b) => Math.abs(a.y - lp.holeY) - Math.abs(b.y - lp.holeY))[0] ?? null;
    }
    if (O.QB) O.QB.role = dir === 'sneak' ? 'carrier' : lp.qbRun ? 'qbkeep' : 'handoff';
    // The back leads for the quarterback on his designed runs, and takes the fake on a read.
    if (O.RB) O.RB.role = dir === 'sneak' ? 'runblock' : dir === 'qbpower' || dir === 'qbdraw' ? 'lead' : 'runner';
    if (O.TE?.role === 'lead' && O.RB?.role === 'lead') O.TE.role = 'runblock';
    lp.handAt = { draw: 0.95, sneak: 0, dive: 0.2, power: 0.5, counter: 0.45, toss: 0.3, qbdraw: 0.85, qbpower: 0.8, read: 0.45 }[dir] ?? 0.42;
    // Read option: the backside end is left unblocked on purpose; the quarterback reads him.
    if (dir === 'read') {
      const s2 = -sgn(lp.holeY || 1);
      const ends = Object.values(lp.def).filter((q) => ['LE', 'DE'].includes(q.slot) && sgn(q.y) === s2);
      const end = ends.sort((a, b) => Math.abs(b.y) - Math.abs(a.y))[0];
      if (end) {
        lp.readEnd = end;
        end.crash = chance(lp.g, ['run_blitz', 'goal_line', 'mug', 'cover0'].includes(lp.defCall) ? 0.65 : 0.45);
        for (const b of bl) if (b.assign === end) b.assign = null;
      }
    }
    return;
  }
  const routes = PLAY_ROUTES[lp.offCall];
  for (const k of RECEIVERS) {
    const p = O[k];
    if (!p) continue;
    let r = routes[k];
    if (k === 'RB' && rbBlocks) r = 'block';
    if (r === 'block') { p.role = 'passblock'; continue; }
    if (r === 'stalk') {
      // Block the man over him for the screen.
      p.role = 'stalk';
      let best = null;
      for (const q of lp.players) if (q.side === 'def' && (!best || dist(q, p) < dist(best, p))) best = q;
      p.assign = best;
      continue;
    }
    p.role = 'route';
    p.route = buildRoute(lp, p, r);
    p.routeName = r;
  }
  if (O.QB) O.QB.role = 'qb';
  lp.dropX = DROP[lp.depth] + (play.pa ? -0.5 : 0);
  lp.readAt = READ_AT[lp.depth] + (play.pa ? 0.45 : 0);
  lp.eligible = RECEIVERS.filter((k) => O[k] && O[k].role === 'route');
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
  // On the line: his front edge at the neutral zone.
  const onLine = (p) => Math.abs(p.x - lineX(p)) < 0.6;
  const line = off.filter(onLine);
  if (line.length !== 7) issues.push(`${line.length} offensive players on the line (need 7: ${line.map((p) => p.slot).join(' ')})`);
  for (const k of ['LT', 'LG', 'C', 'RG', 'RT']) if (O[k] && !onLine(O[k])) issues.push(`${k} is off the line`);
  const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => O[k]).filter(Boolean);
  for (let i = 1; i < ol.length; i++) if (!(ol[i].y > ol[i - 1].y)) issues.push(`line order broken at ${ol[i].slot}`);
  if (O.C && Math.abs(O.C.y) > 0.05) issues.push('center is not over the ball');
  if (O.QB) {
    const depth = -O.QB.x;
    const want = OFF_FORMATIONS[lp.formation]?.qb ?? 0;
    if (want > 0 ? Math.abs(depth - want) > 0.6 || Math.abs(O.QB.y) > 0.3 : depth > 3.5 || Math.abs(O.QB.y) > 0.3) issues.push(`quarterback at ${depth.toFixed(1)} yards`);
  }
  if (O.RB && O.QB && O.RB.x > O.QB.x + 0.05) issues.push('running back is in front of the quarterback');
  if (O.RB && -O.RB.x < 4) issues.push('running back is not in the backfield');
  const wrs = ['WR1', 'WR2', 'WR3'].map((k) => O[k]).filter(Boolean);
  for (const w of wrs) if (Math.abs(w.y) < 9) issues.push(`${w.slot} is not split out`);
  for (let i = 0; i < wrs.length; i++) for (let j = i + 1; j < wrs.length; j++) if (Math.abs(wrs[i].y - wrs[j].y) < 4) issues.push(`${wrs[i].slot} and ${wrs[j].slot} are stacked`);
  for (const k of ['LE', 'DE', 'DT1', 'DT2']) if (D[k] && D[k].x - frontX(D[k]) > 1.2) issues.push(`${k} is off the line`);
  for (const p of lp.players) {
    if (p.side === 'off' && p.x + foot(p).front > -NEUTRAL + 0.01) issues.push(`${p.slot} is offside`);
    if (p.side === 'def' && p.x + 0.01 < frontX(p)) issues.push(`${p.slot} is in the neutral zone`);
    if (Math.abs(p.y) > SIDE - p.r) issues.push(`${p.slot} is out of bounds`);
    if (p.x > lp.goalX + 10 || p.x < lp.ownGoalX - 10) issues.push(`${p.slot} is behind the end line`);
    if (Math.sign(p.fx) !== (p.side === 'off' ? 1 : -1)) issues.push(`${p.slot} faces the wrong way`);
  }
  // No two drawn bodies overlap (by their measured footprints, not only their capsules).
  issues.push(...overlapIssues(lp));
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

// Hurry-up: the snap was called while players are still walking up. Everyone sprints to the
// line and the stragglers are set within a beat, so the snap is never kept waiting.
export function hurry(lp) {
  if (lp.phase === 'pre' && !lp.set && lp.hurry == null) lp.hurry = lp.setT;
}

// Pre-snap: players jog to their spots, then settle.
function lineUp(lp) {
  if (lp.set) return;
  lp.setT += DT;
  const rush = lp.hurry != null;
  let done = true;
  for (const p of lp.players) {
    const d = dist(p, p.home);
    if (p.recover > 0) { p.recover = Math.max(0, p.recover - DT); if (p.recover > 0.25) { done = false; continue; } }
    if (d > 0.12) {
      done = false;
      // Jog, then hurry if the play clock is getting on; walk around anyone in the way.
      seek(p, p.home, rush || lp.setT > 4 ? 1 : d > 6 ? 0.85 : 0.6, 1.4);
      p.aim = null;
      const [vx, vy] = d > 1.5 ? steer(lp, p, p.want.vx, p.want.vy) : [p.want.vx, p.want.vy];
      kin(p, vx, vy, p.top, DT);
      // Hurrying: close the rest of the gap smoothly so nobody is still walking at the snap.
      if (rush) { const k = 1 - Math.exp(-DT * 4); p.x += (p.home.x - p.x) * k; p.y += (p.home.y - p.y) * k; }
    } else { p.vx *= 0.6; p.vy *= 0.6; p.x += (p.home.x - p.x) * 0.2; p.y += (p.home.y - p.y) * 0.2; }
  }
  separate(lp);
  if (done || lp.setT > 7 || (rush && lp.setT - lp.hurry > 1.1)) {
    for (const p of lp.players) { p.x = p.home.x; p.y = p.home.y; p.vx = 0; p.vy = 0; p.fx = p.side === 'off' ? 1 : -1; p.fy = 0; }
    lp.set = true;
  }
}

// ---------- main step ----------
export function snap(lp) {
  if (lp.phase !== 'pre') return;
  // Still walking up to the line: snap as soon as everyone is set.
  if (!lp.set) { lp.snapQueued = true; return; }
  lp.phase = 'live';
  lp.t = 0;
  atSnap(lp);
  if (lp.flags) {
    // The stats as they stand, in case a flag wipes out the play; and a false start or a
    // defender offside kills it before it starts.
    lp.statSnap = snapStats(lp.g);
    const pre = preSnapFoul(lp.g);
    if (pre) {
      const who = lp.players.find((p) => p.id === pre.player && p.ti === pre.team);
      lp.fouls.push({ ...pre, y: who?.y ?? 0, t: 0 });
      event(lp, 'flag', '', who ?? null);
      finish(lp, { how: 'flag' });
      return;
    }
  }
  // A kickoff has no snap: the kicker starts his run up to the tee.
  if (lp.kick?.ko) { lp.kick.stage = 'approach'; event(lp, 'snap', '', lp.kicker, lp.kicker); trackPossession(lp); return; }
  const qb = lp.snapTo ?? lp.off.QB, c = lp.off.C;
  if (isGun(lp.formation) && c && qb) {
    // The ball flies back from the center to the quarterback.
    lp.ball = { state: 'snap', holder: null, x: c.x + 0.4, y: c.y, z: 0.3, from: { x: c.x + 0.4, y: c.y }, t0: 0, T: 0.22 + dist(c, qb) * 0.02 };
  } else {
    // Under center: the ball comes up from the center's hands into the quarterback's.
    lp.ball.holder = qb;
    if (c && qb) lp.ball.xfer = { from: c, to: qb, t0: 0, T: clamp(dist(lp.ball, qb) * 0.075, 0.12, 0.3), snap: true, at: { x: lp.ball.x, y: lp.ball.y, z: lp.ball.z ?? 0.17 } };
  }
  if (lp.kind === 'run' && lp.play.dir === 'sneak') setCarrier(lp, qb);
  // Front responsibilities: each down lineman owns the gap he is shaded toward; the widest
  // rusher on each side keeps contain.
  const front = lp.players.filter((p) => p.side === 'def' && p.role === 'rush');
  for (const p of front) if (['LE', 'DE', 'DT1', 'DT2'].includes(p.slot)) p.gapY = p.y + sgn(p.y || 0.01) * 0.6;
  const wide = (s) => front.filter((p) => sgn(p.y) === s).sort((a, b) => Math.abs(b.y) - Math.abs(a.y))[0];
  for (const s of [-1, 1]) { const w = wide(s); if (w) w.edge = s; }
  event(lp, 'snap', '', c ?? qb, qb);
  trackPossession(lp);
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
    shiftStep(lp);
    for (const p of lp.players) { orient(lp, p); classify(lp, p); }
    if (lp.set && lp.snapQueued) snap(lp);
    trackPossession(lp);
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
    trackPossession(lp);
    return;
  }
  lp.t += DT;
  if (input) applyInput(lp, input);
  // Player two's input rides along on player one's as input.p2.
  if (input?.p2 && lp.p2) { swapPads(lp); try { applyInput(lp, input.p2); } finally { swapPads(lp); } }

  // Run play handoff: the exchange starts when the quarterback and the back actually meet.
  if (lp.kind === 'run' && !lp.carrierSet && lp.t >= lp.handAt && qbHas(lp)) {
    const rb = lp.carrier, qb = lp.off.QB;
    if (lp.qbRun) setCarrier(lp, qb);
    else if (lp.play.dir === 'read' && rb && dist(rb, qb) < rb.r + qb.r + 0.9) {
      // Pull it if the end crashed down on the back, give it if he stayed home.
      const e = lp.readEnd;
      const right = chance(lp.g, clamp(0.72 + (qb.a.awr - 70) * 0.006, 0.55, 0.95));
      if (e && !e.eng && e.crash === right) {
        lp.kept = true; lp.holeY = sgn(e.y || 1) * 8.5; lp.carrier = qb; setCarrier(lp, qb); rb.role = 'escort';
        event(lp, 'keep', '', qb, e);
      } else startExchange(lp, qb, rb);
    }
    else if (lp.play.dir === 'toss' && rb && dist(rb, qb) < 7) startExchange(lp, qb, rb, 0.4);
    else if (rb && dist(rb, qb) < rb.r + qb.r + 0.75) startExchange(lp, qb, rb);
  }
  if (lp.kind === 'run' && !lp.carrierSet && lp.t >= lp.handAt + 1.2 && qbHas(lp)) { lp.carrier = lp.off.QB; setCarrier(lp, lp.off.QB); }
  // AI quarterback, then the throwing motion
  if (lp.kind === 'pass' && !lp.thrown && !lp.windup) coverageRead(lp);
  if (lp.kind === 'pass' && !lp.thrown && !lp.windup && lp.qbState !== 'done') qbBrain(lp);
  windup(lp);

  for (const p of lp.players) think(lp, p);
  airJumps(lp);
  for (const p of lp.players) move(lp, p, DT);
  separate(lp);
  blocks(lp);
  separate(lp, 1);
  wrapHold(lp);
  for (const p of lp.players) orient(lp, p);
  snapFlight(lp);
  ballFlight(lp);
  if (lp.kick) kickStep(lp);
  if (lp.phase === 'live' && !lp.tackle) qbSlide(lp);
  if (lp.phase === 'live' && !lp.tackle) contacts(lp);
  if (lp.phase === 'live') tackleStep(lp);
  if (lp.phase === 'live') boundaries(lp);
  looseBall(lp);
  syncBall(lp);
  for (const p of lp.players) { classify(lp, p); remember(lp, p); }
  if (lp.phase === 'live' && lp.t > MAX_TIME) whistle(lp, 'time');
  trackPossession(lp);
}

// ---------- possession ----------
// Where the ball is, as one state the whole game agrees on:
//   PRE_SNAP      on the turf at the center
//   SNAP          on its way back from the center (a shotgun or long snap)
//   LIVE_PLAY     in the quarterback's (or holder's, or punter's) hands behind the line, or on
//                 the tee, before anyone runs with it
//   PASS_IN_AIR   thrown, not yet caught, batted or on the ground
//   KICK_IN_AIR   punted or kicked
//   BALL_CARRIED  a runner has it: a handoff, a scramble, a catch, an interception, a return
//   LOOSE         nobody has it: a fumbled or batted ball bouncing, an onside kick
//   PLAY_DEAD     the whistle: nothing about the ball changes after this
// It is derived from the simulation each step and checked against the legal moves below, so a
// conflicting state (a catch after the whistle, a carrier with the ball in the air) is caught
// the step it happens; lp.possLog keeps the sequence with the holder at each change.
export const POSSESSION_FLOW = {
  PRE_SNAP: ['SNAP', 'LIVE_PLAY', 'BALL_CARRIED', 'PLAY_DEAD'],
  SNAP: ['LIVE_PLAY', 'BALL_CARRIED', 'LOOSE', 'PLAY_DEAD'],
  LIVE_PLAY: ['PASS_IN_AIR', 'KICK_IN_AIR', 'BALL_CARRIED', 'LOOSE', 'PLAY_DEAD'],
  PASS_IN_AIR: ['BALL_CARRIED', 'LOOSE', 'PLAY_DEAD'],
  KICK_IN_AIR: ['BALL_CARRIED', 'LOOSE', 'PLAY_DEAD'],
  BALL_CARRIED: ['PASS_IN_AIR', 'LOOSE', 'PLAY_DEAD'],
  LOOSE: ['BALL_CARRIED', 'PLAY_DEAD'],
  PLAY_DEAD: [],
};
export function possessionOf(lp) {
  if (lp.phase === 'pre') return 'PRE_SNAP';
  if (lp.phase === 'dead') return 'PLAY_DEAD';
  const b = lp.ball;
  if (b.state === 'snap') return 'SNAP';
  if (b.state === 'air') return lp.kick?.F && !lp.thrown ? 'KICK_IN_AIR' : 'PASS_IN_AIR';
  if (b.state === 'loose' || b.state === 'onside') return 'LOOSE';
  if (b.state === 'held' && lp.carrierSet && b.holder === lp.carrier) return 'BALL_CARRIED';
  return 'LIVE_PLAY';
}
function trackPossession(lp) {
  const now = possessionOf(lp);
  if (now === lp.possession) return;
  const was = lp.possession;
  if (was && !(POSSESSION_FLOW[was] ?? []).includes(now)) (lp.possErrors ??= []).push(`${was} -> ${now} at t=${lp.t.toFixed(2)}`);
  lp.possession = now;
  const h = lp.ball.holder;
  (lp.possLog ??= []).push({ t: lp.t, state: now, holder: h ? `${h.side}${h.slot}` : null });
}

// ---------- what the defense can see ----------
// Nobody reads a cut the instant it happens. Each player keeps a short trail of where he was
// and how he was moving; a defender acts on what a receiver or a ball carrier was doing a
// moment ago (his reaction time), carried forward along that path. A receiver who breaks his
// route is still "running the old route" to his man for that beat, so the separation at the
// break is real, and then the defender drives on the new path through his own feet.
const HIST = 0.8;
function remember(lp, p) {
  const h = (p.hist ??= []);
  h.push({ t: lp.t, x: p.x, y: p.y, vx: p.vx, vy: p.vy });
  while (h.length > 2 && h[0].t < lp.t - HIST) h.shift();
}
// Where `who` is to a defender who reacts `delay` seconds late: his state then, projected on.
export function perceive(lp, who, delay) {
  const h = who.hist;
  if (!h?.length || delay <= 0) return who;
  const want = lp.t - delay;
  let k = h.length - 1;
  while (k > 0 && h[k].t > want) k--;
  const s = h[k], e = Math.max(0, lp.t - s.t);
  return { x: s.x + s.vx * e, y: s.y + s.vy * e, vx: s.vx, vy: s.vy };
}

// ---------- the authoritative action state ----------
// What each player is doing this step, decided by the simulation from its real state. The
// renderer picks poses and clips from it, the debug view prints it and the tests check it.
export const ACTIONS = ['IDLE', 'WALK', 'READY', 'SNAP_REACT', 'ACCEL', 'RUN', 'SPRINT', 'DECEL', 'TURN', 'BACKPEDAL',
  'BLOCK', 'BLOCKED', 'SHED', 'TACKLE', 'TACKLED', 'REACH', 'CATCH', 'THROW', 'HANDOFF', 'CARRY', 'FALL', 'DOWN', 'RECOVER', 'CELEBRATE', 'STUMBLE', 'JUMP'];
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
  if (p.jump != null) return 'JUMP';
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
  return p.sprinting || sp > p.top * 0.92 ? 'SPRINT' : 'RUN';
}

// Events drive the HUD and the 3D animations: `who` is the player doing it, `other` the one
// it is done to (the tackler and the ball carrier, the receiver and the quarterback...).
export function event(lp, kind, text = '', who = null, other = null) { lp.events.push({ t: lp.t, kind, text, who, other }); }

export function setCarrier(lp, p) {
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
  if (lp.p2 && p.ti === lp.p2.user && lp.p2.control !== p) { lp.p2.control = p; lp.p2.manual = false; }
  // Everyone switches to the ball once it is handed off, caught or picked.
  for (const q of lp.players) {
    if (q === p) continue;
    // A defender who watched the throw already knows where the ball is: he reacts to the catch
    // in half the time of one reading a handoff, and one already playing the ball near the catch
    // goes straight for the receiver.
    if (q.side !== p.side) {
      const onBall = lp.thrown && !lp.intercepted;
      q.role = 'pursue';
      q.react = q.eng || (onBall && q.react <= 0 && dist(q, p) < 6) ? 0 : (0.1 + (100 - (q.a.spd + q.a.awr) / 2) * 0.003) * (onBall ? 0.5 : 1);
    }
    else if (q.role === 'route' || q.role === 'qb' || q.role === 'handoff' || q.role === 'idle' || q.role === 'carrier' || (lp.kick && q.role?.[0] === 'k') || q.role === 'returner'
      // An interception: the rest of the defense turns blocker for the man with the ball
      // instead of chasing him.
      || (!lp.kick && p.side === 'def' && (q.role === 'cover' || q.role === 'rush'))) {
      // The quarterback carries out his fake after a handoff and trails the play after a
      // completion; he is not a lead blocker 20 yards downfield.
      q.role = q.side === 'off' && p.side === 'off' && q.slot === 'QB' ? (lp.kind === 'run' ? 'fake' : 'trail') : 'escort';
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
  // Control just moved to the receiver: a direction still held from the throw (moving the
  // passer, placing the ball) is not steering him. He runs to the ball on his own until the
  // keys are let go and pressed again.
  // A called run: the handoff (or the quarterback's own run) happens on its own; the stick
  // takes over once someone is carrying it.
  if (lp.kind === 'run' && !lp.carrierSet && c === lp.off.QB) { inp = { ...inp, mx: 0, my: 0 }; lp.manual = false; }
  if (lp.handoverLock) { if (mag <= 0.1) lp.handoverLock = false; else inp = { ...inp, mx: 0, my: 0 }; }
  if (!lp.handoverLock && len(inp.mx ?? 0, inp.my ?? 0) > 0.1) lp.manual = true;
  c.input = { mx: mag > 0.1 ? inp.mx / Math.max(1, mag) : 0, my: mag > 0.1 ? inp.my / Math.max(1, mag) : 0, sprint: !!inp.sprint };
  if (c.carrier) {
    if (inp.juke) startMove(lp, c, 'juke');
    if (inp.truck) startMove(lp, c, 'truck');
    if (inp.spin) startMove(lp, c, 'spin');
  }
  // The ball in the air to the receiver you now control: Space goes up and attacks it at its
  // highest point (better in traffic, but he stops to make the catch).
  const air = lp.thrown && lp.ball.state === 'air' && lp.thrown.target === c;
  if (air && inp.juke) { lp.aggro = true; startJump(lp, c); }
  // A defender near where the ball comes down goes up for it instead of diving.
  else if (inp.dive && c.side === 'def' && lp.thrown && lp.ball.state === 'air' && Math.hypot(lp.thrown.tx - c.x, lp.thrown.ty - c.y) < 3) startJump(lp, c);
  else if (inp.dive && c.dive == null) { c.dive = 0.3; }
  if (inp.throwTo && lp.kind === 'pass' && !lp.thrown && lp.ball.holder === lp.off.QB && lp.qbState !== 'run') {
    const r = lp.off[inp.throwTo];
    // Ball placement: the stick at release leads him (up), brings it back to him (down) or
    // puts it to one side, away from the defender.
    const place = Math.hypot(inp.mx ?? 0, inp.my ?? 0) > 0.3 ? { x: inp.mx, y: inp.my } : null;
    if (r && r.role === 'route') startThrow(lp, r, false, { type: inp.throwType ?? 'touch', place });
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
  // On slick turf a cut can go out from under him: the move still comes, but he loses his footing.
  if (kind !== 'truck' && c.wx?.slip && chance(lp.g, c.wx.slip)) {
    c.slow = 0.5;
    event(lp, 'slip', `${nm(c.id)} slips on the wet turf`, c);
    note(lp, 'weather', `${nm(c.id)} slips on the wet turf`, c);
  }
  return true;
}

// ---------- decisions ----------
const inTackle = (lp, p) => !!lp.tackle && (lp.tackle.c === p || lp.tackle.q === p);
function think(lp, p) {
  p.want = null;
  p.aim = null;
  if (p.stun > 0 || inTackle(lp, p)) return;
  if (isManual(lp, p)) { manualWant(lp, p); return; }
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
      if (lp.play.dir === 'toss') return seek(p, lp.carrierSet ? { x: p.x - 1, y: -sgn(lp.holeY) * 2 } : { x: p.x - 0.6, y: sgn(lp.holeY) * 0.8 }, 0.5);
      const mesh = { x: lp.play.dir === 'dive' ? -3.2 : -4.2, y: lp.holeY > 0 ? 0.6 : -0.6 };
      return seek(p, lp.carrierSet ? { x: -6, y: -lp.holeY * 0.3 } : mesh, 0.6);
    }
    case 'fake': return seek(p, { x: -7, y: -sgn(lp.holeY) * 4 }, 0.5);
    case 'trail':
      // Jog after the play well behind the ball, in case it turns into a return.
      if (!c) return seek(p, { x: p.x, y: p.y }, 0.2);
      return seek(p, { x: Math.min(c.x - 9, Math.max(p.x, 3)), y: c.y * 0.6 + p.y * 0.4 }, 0.45, 2);
    case 'qbkeep':
      // QB draw: drop as if to pass, then go. QB power: a step to the hole side.
      if (lp.play.dir === 'qbdraw') return seek(p, { x: Math.min(p.home.x - 1.6, p.x), y: p.home.y }, 0.35);
      return seek(p, { x: p.x, y: p.y + sgn(lp.holeY) * 0.6 }, 0.4);
    case 'runner': {
      // Before the handoff: head for the mesh point, then aim at the hole.
      const dir = lp.play.dir;
      if (dir === 'draw' && lp.t < lp.handAt - 0.35) return seek(p, { x: -6.5, y: 1 }, 0.2);
      // Counter: a jab step the wrong way first, so the linebackers flow with it.
      if (dir === 'counter' && lp.t < 0.4) return seek(p, { x: p.x, y: -sgn(lp.holeY) * 2.5 }, 0.7);
      if (dir === 'toss') return seek(p, { x: Math.min(p.x, -4.5), y: sgn(lp.holeY) * 6 }, 1, 0.1);
      if (dir === 'dive') return seek(p, { x: -2.2, y: lp.holeY }, 1);
      return seek(p, { x: -3.5, y: lp.holeY * 0.35 }, 0.8);
    }
    case 'carrier': return carrierWant(lp, p);
    case 'route': return routeWant(lp, p);
    case 'passblock': return passBlockWant(lp, p);
    case 'runblock': return runBlockWant(lp, p);
    case 'stalk': return stalkWant(lp, p);
    case 'escort': return escortWant(lp, p, c);
    case 'lead': {
      // Through the hole a step ahead of the back onto his linebacker, then the first defender
      // who shows.
      const lb = p.assign && !p.assign.eng && p.assign.stun <= 0.3 && !p.eng ? p.assign : null;
      if (lb && p.x > -1.5 && dist(p, lb) < 8) {
        p.aim = lb;
        return seek(p, { x: lb.x - 0.6, y: lb.y + (lb.y > lp.holeY ? 0.3 : -0.3) }, 1, 0.3);
      }
      if (!c) return seek(p, { x: 0.8, y: lp.holeY * (lp.play.dir === 'counter' && lp.t < 0.4 ? -0.3 : 0.85) }, 0.9, 0.3);
      return escortWant(lp, p, c);
    }
    case 'rush': return rushWant(lp, p);
    case 'cover': return coverWant(lp, p);
    case 'pursue': return pursueWant(lp, p, c);
    default: return lp.kick ? kickWant(lp, p) ?? null : null;
  }
}

function manualWant(lp, p) {
  const i = p.input ?? { mx: 0, my: 0 };
  // Full stick; move() decides the pace (a jog, or the sprint burst while Shift is down).
  p.want = { vx: i.mx * p.top * 1.2, vy: i.my * p.top * 1.2 };
}

export function seek(p, pt, frac = 1, arrive = 1.2) {
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
  // Bootleg: after the fake the quarterback rolls out to the flood side, set to throw on the move.
  if (lp.play.boot && !pa) {
    const side = lp.bootSide ??= (lp.off.TE ? -sgn(lp.off.TE.y) : 1); // away from the tight end, who crosses to meet him
    return seek(p, { x: lp.dropX + 2.5, y: side * 8 }, lp.t < 2.4 ? 0.8 : 0.45, 1);
  }
  if (lp.t < 1.1 || pa) return seek(p, target, 0.75, 0.8);
  // Slide away from the nearest free rusher.
  let threat = null, td = 99;
  for (const q of lp.players) if (q.side === 'def' && !q.eng && q.role === 'rush') { const dd = dist(q, p); if (dd < td) { td = dd; threat = q; } }
  if (threat && td < 4) {
    const ax = p.x - threat.x, ay = p.y - threat.y, l = len(ax, ay) || 1;
    p.want = { vx: (ax / l) * 0.4 * p.top + 1.2, vy: (ay / l) * p.top * 0.75 };
  } else seek(p, { x: lp.dropX + 1, y: p.y * 0.9 }, 0.3);
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
export function passBlockWant(lp, p) {
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
  // Close to him, mirror at full speed so a quick rusher can't just run around.
  const close = dm < 2.2 || dist(p, m) < 2;
  seek(p, close ? front : { x: (s.x * 2 + front.x) / 3, y: (s.y * 2 + front.y) / 3 }, close ? 1 : 0.85, 0.4);
}

function runBlockWant(lp, p) {
  if (p.eng) return;
  if (p.pull && lp.t < p.pull.until && !lp.tackle) {
    // Pulling: flat down the line behind the other blockers, then turn up through the hole.
    p.aim = p.assign;
    return seek(p, p.pull.via, 1, 0.3);
  }
  let tgt = p.assign && !p.assign.eng && p.assign.stun <= 0.3 ? p.assign : null;
  if (!tgt || dist(tgt, p) > 7) {
    tgt = null;
    let bd = 6;
    for (const q of lp.players) if (q.side === 'def' && !q.eng && q !== lp.readEnd && dist(q, p) < bd) { bd = dist(q, p); tgt = q; }
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

function carrierWant(lp, p) {
  const g = lp.g;
  const fwd = p.side === 'off' ? 1 : -1;
  // Designed runs hit the hole first.
  // Designed runs hit the hole first. An outside run stretches to the edge, then reads it: if
  // a defender has set the edge outside him, he bounces back inside instead of running into it.
  if (lp.kind === 'run' && (p.slot === 'RB' || (p.slot === 'QB' && (lp.qbRun || lp.kept) && lp.play.dir !== 'sneak')) && p.x < 0.5) {
    const e = lp.t - (lp.carrierAt ?? 0);
    const wide = lp.play.dir === 'outside' || lp.play.dir === 'toss' || lp.kept;
    if (wide && e < 1.1 && !lp.bounced) {
      const out = sgn(lp.holeY);
      const edge = lp.players.find((q) => q.side !== p.side && !q.eng && q.stun <= 0 && (q.y - p.y) * out > 0.3 && Math.abs(q.x - p.x) < 3 && dist(q, p) < 3.4);
      if (edge && e > 0.35) { lp.bounced = true; event(lp, 'bounce', '', p, edge); }
      else return seek(p, { x: Math.min(1.5, -1 + e * (lp.play.dir === 'toss' ? 4.5 : 3)), y: lp.holeY }, 1, 0.05);
    } else if (e < (lp.play.dir === 'power' || lp.play.dir === 'qbpower' ? 0.8 : 0.55) && !wide) return seek(p, { x: 1.5, y: lp.holeY }, 1, 0.05);
  }
  // A fake punt: the up-back gets to the edge first.
  if (lp.fake === 'punt' && p.x < 0.5 && lp.t - (lp.carrierAt ?? 0) < 1.6) return seek(p, { x: 1.5, y: lp.fakeEdge * 9 }, 1, 0.05);
  // The sneak: straight ahead behind the center, leaning a half step to the softer A gap. The
  // pile decides it; he never bounces it outside.
  if (lp.kind === 'run' && lp.play.dir === 'sneak' && p.slot === 'QB' && p.x < 2) {
    let soft = 0, sd = -99;
    for (const s2 of [-1, 1]) {
      let room = 99;
      for (const q of lp.players) if (q.side !== p.side) room = Math.min(room, Math.hypot(q.x - (p.x + 1.5), q.y - s2 * 1));
      if (room > sd) { sd = room; soft = s2; }
    }
    p.want = { vx: p.top, vy: clamp(soft * 1 - p.y, -1, 1) * 1.5 };
    return;
  }
  // Behind the line with the play strung out, a back gets north and takes what is there
  // rather than running sideways for the boundary.
  const strung = p.side === 'off' && lp.kind === 'run' && p.x < 0.5 && lp.t - (lp.carrierAt ?? 0) > 0.8 ? 1 : 0;
  // A yard or two short of the line to gain (or the goal line) with a tackler coming, he gets
  // north and fights for it instead of dancing sideways.
  let north = 0;
  if (p.side === 'off' && p.x > -1) {
    const mark = lp.spot + sticks(lp) >= 100 ? lp.goalX : sticks(lp);
    const short = mark - p.x;
    if (short > 0 && short < 3) for (const q of lp.players) if (q.side !== p.side && !q.eng && dist(q, p) < 3.5) { north = 1.6 * (1 - short / 3) + 0.6; break; }
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
      if (Math.abs(py) > SIDE - 1 && !lp.clockOut) danger += 0.8 / k;
    }
    // Saving clock: past the line, angle for the nearer sideline.
    const out = lp.clockOut && p.x > 1 ? dy * sgn(p.y || 1) * 0.9 : 0;
    const score = dx * fwd * (1.7 + north) - danger - Math.abs(a) * 0.002 - strung * Math.max(0, Math.abs(a) - 45) / 45 * 0.9 + out;
    if (!best || score > best.score) best = { dx, dy, score };
  }
  const sprint = 1;
  const l = len(best.dx, best.dy);
  p.want = { vx: (best.dx / l) * p.top * sprint, vy: (best.dy / l) * p.top * sprint };
  // When a tackler closes in, the AI carrier puts a move on him: power backs lower the
  // shoulder against smaller tacklers, shifty ones juke or spin.
  // (Not while he is still securing a catch.)
  if (!isManual(lp, p) && p.juke <= -0.9 && p.spin <= -0.9 && p.truck <= -0.9 && lp.t - (p.caughtAt ?? -9) > 0.45) {
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
  if (inTackle(lp, p)) { p.jump = null; return; } // the tackle sequence moves the pair (tackleStep)
  // In the air: no steering, he carries what speed he took off with and lands.
  if (p.jump != null) {
    p.jump += dt;
    if (p.jump < p.jumpT) { p.vx *= 1 - dt * 0.6; p.vy *= 1 - dt * 0.6; integrate(p, dt); return; }
    p.jump = null; p.vx *= 0.5; p.vy *= 0.5;
  }
  if (p.stun > 0) { p.stun -= dt; slowDown(p, dt, 9); return; }
  if (p.eng) return; // engaged players move as a pair in blocks()
  let { vx, vy } = p.want ?? { vx: 0, vy: 0 };
  // Nobody but the ball carrier runs off the field into the bench area.
  // Carrying the ball costs a step and long runs wear the carrier down, while pursuers find
  // a little extra, so only a carrier who is truly faster than the defense breaks away.
  const tired = p.carrier ? clamp((Math.abs(p.x - (p.runFrom ?? p.x)) - 12) * 0.004, 0, 0.1) : 0;
  const chase = p.role === 'pursue' ? (lp.carrier && dist(p, lp.carrier) < 8 ? 1.06 : 1.03) : 1;
  let top = p.top * (p.slow > 0 ? 0.6 : 1) * (p.carrier ? 0.96 - tired : chase);
  if (p.wx?.fade) top *= 1 - clamp((lp.t - 3) * p.wx.fade, 0, 0.06);
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
  // The player you control jogs at 86% of top speed; Shift is a sprint burst to 110% with a
  // harder first step, for about three seconds (longer with Stamina) before it needs to
  // recover. The burst refills while jogging or standing.
  let boost = p.juke > 0 ? 2.2 : p.truck > 0 ? 1.6 : 1;
  p.sprinting = false;
  if (isManual(lp, p)) {
    const i = p.input ?? {};
    p.sprinting = !!i.sprint && p.burst > 0.02 && len(i.mx ?? 0, i.my ?? 0) > 0.1;
    if (p.sprinting) { top *= 1.1; boost = Math.max(boost, 1.4); p.burst = Math.max(0, p.burst - (dt * (p.wx?.drain ?? 1)) / (2.4 + (p.a.sta ?? 70) / 100)); }
    else { top *= 0.86; p.burst = Math.min(1, p.burst + dt / 5); }
  }
  p.slow = Math.max(0, p.slow - dt);
  if (!isManual(lp, p) && !p.carrier) [vx, vy] = steer(lp, p, vx, vy);
  // Routes and pursuit bend along the sideline instead of running out over it.
  if (!p.carrier && Math.abs(p.y) > SIDE - 1.5 && vy * p.y > 0) vy *= clamp((SIDE + 0.5 - Math.abs(p.y)) / 2, 0, 1);
  // A ball carrier and a pass rusher with a lane are all feet: they cut a little harder.
  kin(p, vx, vy, top, dt, boost, p.carrier ? 1.45 : p.role === 'rush' && !p.eng ? 1.3 : 1);
}

// Steering around bodies in the way: anyone (but the player this one is going after) a little
// ahead and inside the path bends the path to the open side, so runners hit gaps, rushers
// loop around blockers and pursuers take an angle instead of pushing through a pile.
export function steer(lp, p, vx, vy) {
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

// Locomotion. A body has a speed and a heading, not a velocity it can rewrite at will: it
// speeds up from its Acceleration (harder from a standstill than near top speed), brakes
// harder than it speeds up (Agility), and swings its path no faster than its feet can grip
// the turf at the speed it carries (lateral grip / speed, so a sprinter bends his path and a
// player at a jog changes direction almost on the spot). Asked to go somewhere well off his
// heading, he plants: he sheds the speed he cannot turn with, cuts, and drives out of it, so
// a sharp route break, a juke or a defender flipping his hips all cost what they should.
// Nearly stopped, he simply pivots and goes. boost scales the whole engine for moves (a juke,
// the sprint burst).
const PIVOT = 0.8;
export function kin(p, vx, vy, top, dt, boost = 1, gripK = 1) {
  let wl = len(vx, vy);
  if (wl > top) { vx *= top / wl; vy *= top / wl; wl = top; }
  const s = len(p.vx, p.vy);
  const acc = p.accel * boost * (1.15 - 0.45 * clamp(s / (p.top || top), 0, 1));
  const brake = p.accel * (p.cut ?? 2) * Math.max(1, boost * 0.8);
  if (s < PIVOT || wl < 0.05) {
    // From a standstill (or stopping): accelerate straight toward what he wants.
    let dvx = vx - p.vx, dvy = vy - p.vy;
    const dl = len(dvx, dvy), amax = (wl < 0.05 ? brake : Math.max(acc, s < 0.3 ? acc : brake * 0.6)) * dt;
    if (dl > amax) { dvx *= amax / dl; dvy *= amax / dl; }
    p.vx += dvx; p.vy += dvy;
    integrate(p, dt);
    return;
  }
  const hx = p.vx / s, hy = p.vy / s, ux = vx / wl, uy = vy / wl;
  const err = Math.atan2(hx * uy - hy * ux, hx * ux + hy * uy);
  // The speed he can carry through this much turn: all of it straight ahead, none of it on a
  // reversal (he plants and comes back).
  const keep = Math.cos(Math.min(Math.abs(err), Math.PI / 2));
  const sWant = wl * keep * keep;
  const ds = clamp(sWant - s, -brake * dt, acc * dt);
  const sn = Math.max(0, s + ds);
  // Grip: how hard he can bend his path (yards per second squared, sideways).
  const grip = (p.grip ?? 16) * boost * gripK;
  const wMax = grip / Math.max(sn, 1.6);
  const turn = clamp(err, -wMax * dt, wMax * dt);
  const c = Math.cos(turn), sn2 = Math.sin(turn);
  const nx = hx * c - hy * sn2, ny = hx * sn2 + hy * c;
  p.vx = nx * sn; p.vy = ny * sn;
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

export function slowDown(p, dt, k = 6) {
  const f = Math.max(0, 1 - k * dt);
  p.vx *= f; p.vy *= f;
  if (!p.eng) integrate(p, dt);
}

function animIdle(lp, dt) { for (const p of lp.players) p.anim += dt * 2; }

// Bodies don't pass through each other: overlapping capsules are pushed apart until they
// just touch. Ball carriers and engaged blockers hold their ground and the other one gives;
// when both hold, both give. Contact itself (blocks, tackles) happens at the capsule edge.
const SEP_MAX = 0.12;
export function separate(lp, passes = 2) {
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
        // Past a third of their reach in, the free one is pinned (a pocket closing on the
        // quarterback from two blocks): the holder gives too, or a block would drive through him.
        if (need - d > need / 3) ka = 0.5;
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

// p pressed against a body in direction (ux, uy): running into it costs him the speed he had
// into it (a soft contact, over a few frames), and he works around it toward the side he wants,
// turning no faster than his feet allow (half his grip, since he also steers in kin; a pass
// rusher working an edge is all feet), so he
// slides off a body instead of grinding into it or spinning around it.
function slide(p, ux, uy) {
  const vn = p.vx * ux + p.vy * uy;
  if (vn <= 0) return;
  const s = len(p.vx, p.vy) || 1;
  const k = 1 - 0.7 * (vn / s);
  p.vx *= k; p.vy *= k;
  const tx = -uy, ty = ux, w = p.want ?? p;
  const side = sgn((p.vx * tx + p.vy * ty) * 3 + (w.vx * tx + w.vy * ty) || 1);
  const sn = len(p.vx, p.vy);
  if (sn < 0.3) { p.vx += tx * side * vn * 0.3; p.vy += ty * side * vn * 0.3; return; }
  const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(ty * side, tx * side);
  let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const a = cur + sgn(d) * Math.min(Math.abs(d), ((p.grip ?? 16) * (p.role === 'rush' ? 1.2 : 0.5) / Math.max(sn, 1.6)) * DT);
  p.vx = Math.cos(a) * sn; p.vy = Math.sin(a) * sn;
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
    const blocker = b.side === lp.carrierTeam && ['passblock', 'runblock', 'stalk', 'escort', 'lead', 'kblock'].includes(b.role)
      || (b.role === 'route' && b.route?.[b.wp]?.block != null);
    if (!blocker) continue;
    for (const d of lp.players) {
      if (d.side === b.side || d.eng || d.carrier || d.stun > 0 || d.shedT > 0) continue;
      // Linemen get their hands on anyone who comes within arm's length; nobody runs through them.
      const line = b.role === 'passblock' || b.role === 'runblock' || b.role === 'kblock';
      if (dist(b, d) > Math.max(ENGAGE, b.r + d.r + (line ? 0.45 : 0.08))) continue;
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
        d.shedFrom = b; d.shedT = passPro ? 1.2 : 0.5; d.shed = null;
        b.contact = d.contact = 'DISENGAGED';
        if (passPro) lp.pressureBy = d;
        event(lp, 'shed', S.move, d, b);
      }
      continue;
    }
    // Rate of getting off the block, per second: rating and type edge, quick feet shed sooner,
    // and nobody sheds in the first instants of the fit.
    const base = passPro ? 1.9 : lp.carrierSet ? 0.11 : 0.06;
    const quick = clamp((d.a.acc - b.a.acc) / 60, -0.4, 0.5);
    let rate = base * Math.exp(R.diff / 9) * (1 + quick) * (b.engT < 0.8 ? 0.25 : 1) * traitMod('shedRate', { d, b }).v;
    if (!passPro) rate = Math.max(rate, 0.1);
    // Blocks far from the ball break up on their own.
    // (A block well in front of the carrier holds: that is the lane he is about to run through.)
    if (lp.carrierSet && b.engT > 0.6) {
      const c = lp.carrier, ahead = (d.x - c.x) * (c.side === 'off' ? 1 : -1);
      if (dist(d, c) > 9 || (dist(d, c) > 4 && ahead < -1.5)) rate = Math.max(rate, 2.5);
    }
    if (chance(g, rate * DT)) {
      // Beaten, the blocker may grab him: the rusher stays held up, and the flag comes out.
      if (lp.flags && b.side === 'off' && (passPro ? !lp.thrown : lp.carrierSet && dist(d, lp.carrier) < 4) && chance(g, RATES.holdShed * sloppy(b.a.awr) * (1 + Math.max(0, R.diff) / 20)) && liveFoul(lp, 'hold_off', b)) {
        event(lp, 'flag', '', b, d);
        continue;
      }
      // The move fits the body: big and strong bull rushes, light and quick swims, the rest rip.
      const move = mass > 0.25 && d.a.str >= d.a.acc ? 'bull' : d.a.acc > 70 || mass < -0.3 ? 'swim' : 'rip';
      const target = lp.carrierSet ? lp.carrier : lp.snapTo ?? lp.off.QB;
      const side = sgn((target.y - b.y) * 0.3 + (d.y - b.y)) || 1;
      const ux = target.x - d.x, l = len(ux, side) || 1;
      d.shed = { move, t: 0, sx: (ux / l) * 0.5, sy: side * 0.9, speed: move === 'swim' ? 4.2 : 3.2 };
      b.contact = d.contact = 'SHEDDING';
      continue;
    }
    // The pair drifts toward whoever is winning. In pass protection the rusher drives toward the
    // quarterback, slowed by the blocker sitting on the cup's edge; in a run block the blocker
    // drives the defender away from the hole.
    const target = lp.carrierSet ? lp.carrier : lp.snapTo ?? lp.off.QB;
    let ux = target.x - d.x, uy = target.y - d.y; const l = len(ux, uy) || 1; ux /= l; uy /= l;
    let push = clamp((passPro ? 0.12 : lp.kind === 'run' ? -0.7 : -0.35) + R.diff * 0.05 + mass * 0.45, -2.2, 2.2);
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
    let vx = ux * push, vy = uy * push * 0.6;
    // Hand fighting: the defender works to one shoulder of the blocker (toward the passer, or
    // the side of the ball on a run) and counters back to the other when it stalls; the blocker
    // mirrors him, so the pair shuffles along the line instead of standing frozen. Quicker feet
    // win the shuffle, and the bigger the blocker's edge the less ground it gives.
    if (b.engT > 0.15) {
      d.rs ??= sgn((target.y - b.y) * 0.5 + (d.y - b.y)) || 1;
      if (b.engT > (d.rsT ??= 0.5 + (b.id % 5) * 0.08)) { d.rs = -d.rs; d.rsT = b.engT + 0.55 + clamp((b.a.blk - (passPro ? d.a.rush : d.a.str)) * 0.01, -0.2, 0.4); }
      const quick = clamp(1 + ((d.a.agi ?? 60) - (b.a.agi ?? 60)) * 0.015, 0.5, 1.6) * (passPro ? 1 : 0.3);
      const lat = d.rs * quick * clamp(1.1 - Math.abs(push) * 0.3, 0.3, 1.1);
      vx += -uy * lat; vy += ux * lat;
    }
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

function engage(lp, b, d) { b.eng = d; d.eng = b; b.engT = 0; d.engT = 0; chip(lp, b); chip(lp, d); }

// Sand chip: contact in a sandstorm wears down anyone the weather does not spare.
function chip(lp, p) {
  if (!p.wx?.chip) return;
  const E = lp.g.teams[p.ti].energy;
  E[p.id] = Math.max(0, (E[p.id] ?? 100) - p.wx.chip);
}

// Type theater: when a tackle or a broken tackle goes the attacker's way, its typing shows. On
// the field this is a burst in the type's colour with "Super effective!", "Not very
// effective..." or "No effect" over it (see field3d.js); each pair shows it once a play.
export function typeFx(lp, att, def, only = null) {
  if (!att || !def) return null;
  const m = bestMatchup(PLAYERS[att.id], PLAYERS[def.id]);
  if (m.mult === 1) return null;
  const fx = m.mult === 0 ? 'immune' : m.mult > 1 ? 'se' : 'nve';
  if (only && !only.includes(fx)) return null;
  const key = `${att.id}>${def.id}`;
  lp.typeFxSeen ??= new Set();
  if (lp.typeFxSeen.has(key)) return null;
  lp.typeFxSeen.add(key);
  const text = { se: "It's super effective!", nve: "It's not very effective...", immune: `It doesn't affect ${nm(def.id)}...` }[fx];
  event(lp, 'typefx', text, att, def);
  Object.assign(lp.events[lp.events.length - 1], { fx, type: m.type });
  return fx;
}
export function unengage(p) { const q = p.eng; if (q) { q.eng = null; q.shed = null; } p.eng = null; p.shed = null; }

// Notes for the traits that acted at a hook (quiet ones only when the caller says so).
export function traitNotes(lp, T, ctx, who, decided = false) {
  for (const t of T.used) if (!t.quiet || decided) note(lp, t.kind, t.note(ctx), who);
}

// Something about a Pokémon (its type, its ability, its build) changed this play.
export function note(lp, kind, text, who = null) {
  if (lp.notes.some((n) => n.text === text)) return;
  lp.notes.push({ t: lp.t, kind, text, who });
  event(lp, 'note', text, who);
}

// ---------- the quarterback slide ----------
// A scrambling quarterback who has what he needs (the first down, or a solid gain) gives
// himself up feet first when a defender is about to hit him, instead of taking the shot. Not
// with the end zone in reach, and the more aware he is the more reliably he does it.
function qbSlide(lp) {
  const c = lp.carrierSet ? lp.carrier : null;
  if (!c || !lp.scramble || c !== lp.off.QB || lp.kick || c === lp.control && lp.manual) return;
  if (lp.goalX - c.x < 5 || c.x < 1) return;
  const gained = c.x >= sticks(lp) || c.x >= 5;
  if (!gained) return;
  let hit = null;
  for (const q of lp.players) {
    if (q.side === c.side || q.eng || q.stun > 0) continue;
    const d = dist(q, c), close = ((c.x - q.x) * q.vx + (c.y - q.y) * q.vy) / (d || 1);
    if (d < c.r + q.r + 1.6 && close > 1.5) { hit = q; break; }
  }
  if (!hit || lp.slideRoll === hit) return;
  lp.slideRoll = hit; // one decision per tackler
  if (!chance(lp.g, clamp(0.55 + (c.a.awr - 60) * 0.01, 0.4, 0.95))) return;
  // He goes down where he is: the ball is spotted where he started the slide.
  lp.spotX = c.x;
  c.downed = true; c.vx *= 0.4; c.vy *= 0.4;
  event(lp, 'slide', `${nm(c.id)} slides`, c, hit);
  finish(lp, { how: 'slide' });
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
    const aiDive = !isControlled(lp, q) && dd > near && dd < near + 1 && chance(g, 0.05);
    const reach = near + (q.dive != null && q.dive > 0 ? 0.8 : 0);
    if (dd > reach && !aiDive) continue;
    q.cool = 0.5;
    if (aiDive) q.dive = 0.3;
    chip(lp, q); chip(lp, c);
    const tackle = q.a.tkl * 0.7 + q.a.str * 0.3;
    const evade = c.a.strBT * 0.55 + c.a.spd * 0.45;
    const R = rep(q.id, tackle, c.id, evade);
    const sack = lp.kind === 'pass' && !lp.carrierSet && c.slot === 'QB';
    const baseP = (diff) => (sack ? sigmoid(diff / 10 + 2.3) : sigmoid(diff / 11 + 2.6) - (aiDive ? 0.12 : 0));
    // Everything below adjusts the odds the same way whatever the type matchup.
    let p = 0;
    if (lp.players.some((o) => o !== q && o.side === q.side && !o.eng && dist(o, c) < 2.6)) p += 0.08;
    const user = isManual(lp, c);
    // Is the tackler coming from in front (spins beat those) or from the side (jukes do)?
    const cs = len(c.vx, c.vy) || 1;
    const headOn = ((q.x - c.x) * c.vx + (q.y - c.y) * c.vy) / (cs * (dd || 1)) > 0.5;
    if (c.juke > 0) p -= (user ? 0.32 : 0.18) * (0.35 + c.a.spd / 160 - q.a.spd / 400) * (headOn ? 0.8 : 1.2);
    if (c.spin > 0) p -= (user ? 0.3 : 0.17) * (0.3 + (c.a.spd + c.a.strBT) / 320 - q.a.tkl / 400) * (headOn ? 1.25 : 0.8);
    if (c.truck > 0) p -= 0.08 + (c.a.strBT - q.a.tkl) * 0.012 + clamp(Math.log(PLAYERS[c.id].weight / Math.max(1, PLAYERS[q.id].weight)) * 0.06, -0.12, 0.15);
    if (q.dive != null && q.dive > 0) p += 0.1;
    // How he arrives: square and closing fast wraps up; chasing from behind is an arm tackle.
    const ux = (c.x - q.x) / (dd || 1), uy = (c.y - q.y) / (dd || 1);
    const closing = (q.vx - c.vx) * ux + (q.vy - c.vy) * uy;
    const behind = (c.vx * ux + c.vy * uy) > 0.6 * cs && cs > 3;
    p += clamp((closing - 5) * 0.02, -0.08, 0.06) - (behind ? 0.07 : 0);
    const tTk = traitMod('tackleOdds', { c, q });
    p += tTk.v;
    if (tTk.used.length) traitNotes(lp, tTk, { c, q }, c);
    if (c.slow > 0) p += 0.12;
    if (lp.t - (lp.carrierAt ?? 0) < 0.8 && lp.caught) p += 0.2;
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
      typeFx(lp, q, c, ['se']);
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
    // He bounced off: the tackler's typing did little to him, or the carrier's own hit him hard.
    if (!typeFx(lp, q, c, ['nve', 'immune'])) typeFx(lp, c, q, ['se']);
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
  // Falling forward: a carrier going downfield gets his body length past the contact point,
  // more when he is stronger and heavier than the tackler, less when he is met square.
  const headOn = (q.x - c.x) * fwd > 0.2;
  // Short of the sticks or the goal line he stretches the ball out for it.
  const mark = c.side === 'off' ? (lp.spot + sticks(lp) >= 100 ? lp.goalX : sticks(lp)) : null;
  const reach = mark != null && mark - c.x > 0 && mark - c.x < 1.5 ? 0.35 : 0;
  const lean = sack ? 0 : clamp(0.3 + reach + (c.a.strBT - q.a.tkl) * 0.012 + Math.max(0, c.vx * fwd) * 0.07 + Math.log(mc / mq) * 0.35 - (headOn ? 0.35 : 0), 0, 1.4 + reach);
  // A big hit: the tackler arrives with much more momentum along the hit than the carrier has
  // coming the other way. The carrier is stood up and put down about where he is.
  const hl = dist(c, q) || 1, ux = (c.x - q.x) / hl, uy = (c.y - q.y) / hl;
  const pq = mq * Math.max(0, q.vx * ux + q.vy * uy), pc = mc * Math.max(0, -(c.vx * ux + c.vy * uy));
  const big = !dove && !sack && pq > 450 && pq > pc * 1.6 + 150;
  lp.tackle = { c, q, sack, t0: lp.t, T: TACKLE_T * (1 + drag), vx, vy, fp: c.x, fwd, dove, lean: big ? Math.min(lean, 0.15) : lean, big, contact: { x: c.x, y: c.y },
    impact: len(c.vx - q.vx, c.vy - q.vy) };
  if (lp.windup) lp.windup = null;
  c.slow = 0; q.dive = dove ? 0.3 : q.dive;
  event(lp, 'contact', `${nm(q.id)} wraps up ${nm(c.id)}`, q, c);
  if (big) event(lp, 'bighit', '', q, c);
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
  // Friction on the pile: the pair is brought to a stop over the sequence (faster on a big
  // hit and with help arriving), not left to skate across the turf.
  const f = Math.exp(-DT * ((T.big ? 7 : 3.9) + help * 2.2));
  T.vx *= f; T.vy *= f;
  c.vx = T.vx; c.vy = T.vy; c.x += c.vx * DT; c.y += c.vy * DT;
  if (T.lean && e < T.T) { const k = (T.lean * DT) / T.T; c.x += T.fwd * k; q.x += T.fwd * k; }
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
  // (Bigger bodies get crowded harder, so it may move a little further per step.)
  const k = Math.min(need - d, SEP_MAX * 2) / d;
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
      // (Less on the catch frame itself: the ball has already flown part of this step.)
      const max = Math.hypot(h.vx, h.vy) * DT + (h.caughtAt === lp.t ? 0.1 : 0.22);
      if (d > max && Number.isFinite(b.z)) {
        const k = max / d;
        at.x = b.x + (at.x - b.x) * k; at.y = b.y + (at.y - b.y) * k; at.z = b.z + (at.z - b.z) * k;
      }
    }
    b.x = at.x; b.y = at.y; b.z = at.z;
  }
}

function startExchange(lp, qb, rb, T = EXCHANGE_T) {
  setCarrier(lp, rb);
  lp.ball.xfer = { from: qb, to: rb, t0: lp.t, T, pitch: T > EXCHANGE_T };
  event(lp, 'handoff', '', rb, qb);
}

// ---------- the result ----------
export function finish(lp, end) {
  if (lp.phase !== 'live') return;
  lp.phase = 'dead';
  lp.deadAt = lp.t;
  lp.end = end;
  lp.result = lp.kick ? kickResult(lp, end) : buildResult(lp, end);
  // The hit, for the league's injury roll (engine.js): who wrapped up whom, and how fast they met.
  const T = lp.tackle;
  if (!lp.kick && T && end.tackler && !lp.intercepted && lp.result) lp.result.hit = { carrier: T.c.id, tackler: T.q.id, speed: T.impact };
  if (lp.fake && lp.result.text) lp.result.text = `${lp.fake === 'punt' ? 'Fake punt!' : 'Fake field goal!'} ${lp.result.text}`;
  if (lp.fouls?.length) { lp.result.fouls = lp.fouls; lp.result.statSnap = lp.statSnap; }
}

function buildResult(lp, end) {
  const g = lp.g, o = lp.o, d = lp.d;
  const qb = lp.off.QB;
  const stats = lp.stats;
  const extras = stats.extras.length ? `, ${stats.extras.slice(0, 2).join(' and ')}` : '';
  const yardsWord = (y) => (y === 0 ? 'no gain' : y > 0 ? `${y} yard${y === 1 ? '' : 's'}` : `a loss of ${-y}`);
  const stop = end.how === 'out' || end.how === 'incomplete';
  if (end.how === 'flag') return { kind: 'none', noPlay: true, yards: 0, text: '' };

  if (end.how === 'incomplete') {
    st(g, o, qb.id).pa++;
    if (stats.target) st(g, o, stats.target.id).tg++;
    return { kind: 'pass', yards: 0, carrier: qb.id, qb: qb.id, text: end.text, clockStop: true };
  }
  // Whoever actually has the ball is the runner the play is scored from.
  const hb = lp.ball.holder;
  const c = (!lp.intercepted && hb && hb.side === 'off' ? hb : null) ?? lp.carrier ?? qb;
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
  const tk = tackler ? ` Tackled by ${nm(tackler.id)}.` : end.how === 'out' ? ' Pushed out of bounds.' : end.how === 'slide' ? ' He slides to give himself up.' : '';
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
    const r = { kind: 'pass', yards, carrier: c.id, scorer: c.id, qb: qb.id, text, clockStop: stop, oob: end.how === 'out', highlight, se };
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
  const how = lp.scramble ? 'scrambles' : { inside: 'runs up the middle', outside: c.y < 0 ? 'runs around the left end' : 'runs around the right end', draw: 'runs the draw', sneak: 'sneaks ahead', qbdraw: 'takes off on the QB draw', qbpower: 'keeps it on QB power', read: c.slot === 'QB' ? 'pulls it on the read and runs' : 'takes the give on the read' }[lp.play.dir] ?? 'runs';
  let text = `${nm(c.id)} ${how}${extras} for ${yardsWord(yards)}.${tk}`;
  if (se) text += " It's super effective!";
  const r = { kind: 'run', yards, carrier: c.id, scorer: c.id, text, clockStop: stop, oob: end.how === 'out', highlight: yards >= 20 ? 'big' : yards < 0 ? 'loss' : null, se };
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
