// Game simulation: one play at a time, resolved as one-on-one matchups.
// Deterministic for a given seed. No DOM access.
import { PLAYERS, OFF_SLOTS, DEF_SLOTS, unitRatings } from './ratings.js';
import { TYPE_TRAITS, ABILITIES, WEATHER, bestMultiplier, matchupModifier } from './types.js';

export const OFF_PLAYS = {
  inside_run: { name: 'Inside run', kind: 'run', dir: 'inside', blurb: 'Between the guards' },
  outside_run: { name: 'Outside run', kind: 'run', dir: 'outside', blurb: 'Stretch to the edge' },
  draw: { name: 'Draw', kind: 'run', dir: 'draw', blurb: 'Fake pass, hand off' },
  qb_sneak: { name: 'QB sneak', kind: 'run', dir: 'sneak', blurb: 'Push for a yard' },
  screen: { name: 'Screen', kind: 'pass', depth: 'screen', air: [-2, 1], targets: { RB: 1 }, blurb: 'Dump to the back' },
  slant: { name: 'Quick slant', kind: 'pass', depth: 'short', air: [3, 7], targets: { WR1: 0.35, WR2: 0.3, WR3: 0.35 }, blurb: '3 to 7 yards' },
  out: { name: 'Out', kind: 'pass', depth: 'short', air: [4, 9], sideline: true, targets: { WR1: 0.3, WR2: 0.3, WR3: 0.25, RB: 0.15 }, blurb: 'Sideline, stops clock' },
  curl: { name: 'Curl', kind: 'pass', depth: 'mid', air: [7, 12], targets: { WR1: 0.3, WR2: 0.3, TE: 0.25, WR3: 0.15 }, blurb: '7 to 12 yards' },
  te_seam: { name: 'TE seam', kind: 'pass', depth: 'mid', air: [9, 15], targets: { TE: 0.6, WR3: 0.25, WR1: 0.15 }, blurb: 'Tight end up the middle' },
  post: { name: 'Deep post', kind: 'pass', depth: 'deep', air: [14, 25], targets: { WR1: 0.45, WR2: 0.4, WR3: 0.15 }, blurb: '14 to 25 yards' },
  pa_deep: { name: 'Play-action deep', kind: 'pass', depth: 'deep', pa: true, air: [18, 34], targets: { WR1: 0.45, WR2: 0.35, TE: 0.2 }, blurb: 'Sell the run, go long' },
  punt: { name: 'Punt', kind: 'punt', blurb: 'Flip the field' },
  fg: { name: 'Field goal', kind: 'fg', blurb: '' },
};

export const DEF_PLAYS = {
  base: { name: 'Base', blurb: 'Balanced, man coverage' },
  run_blitz: { name: 'Run blitz', blurb: 'MLB attacks the line' },
  pass_blitz: { name: 'Pass blitz', blurb: 'OLB and MLB rush' },
  cover2: { name: 'Cover 2', blurb: 'Two deep safeties' },
  cover3: { name: 'Cover 3', blurb: 'Three deep zones' },
  man_press: { name: 'Man press', blurb: 'Jam short routes' },
  prevent: { name: 'Prevent', blurb: 'Give up short, stop long' },
  goal_line: { name: 'Goal line', blurb: 'Stack the box' },
};

// Separation adjustments by defensive call and route depth; run lane adjustments.
export const SCHEME = {
  base: { screen: 0, short: 0, mid: 0, deep: 0, run: 0, zone: false },
  run_blitz: { screen: 2, short: 3, mid: 3, deep: 2, run: -5, zone: false },
  pass_blitz: { screen: 6, short: 3, mid: 4, deep: 4, run: 2, zone: false },
  cover2: { screen: 1, short: 2, mid: 1, deep: -4, run: 2, zone: true },
  cover3: { screen: 1, short: 1, mid: 0, deep: -2, run: 1, zone: true },
  man_press: { screen: 1, short: -4, mid: -1, deep: 3, run: 0, zone: false },
  prevent: { screen: 4, short: 6, mid: -2, deep: -10, run: 5, zone: true },
  goal_line: { screen: 3, short: 2, mid: 5, deep: 6, run: -7, zone: false },
};
const SEP_OFFSET = 13.5;
const BASE_CMP = { screen: 0.87, short: 0.75, mid: 0.63, deep: 0.41 };

// ---------- random numbers (state lives in the game so saves resume exactly) ----------
export function rand(g) {
  g.rng = (g.rng + 0x6D2B79F5) >>> 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randn = (g) => Math.sqrt(-2 * Math.log(1 - rand(g))) * Math.cos(2 * Math.PI * rand(g));
export const expo = (g, mean) => -Math.log(1 - rand(g)) * mean;
export const chance = (g, p) => rand(g) < p;
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const between = (g, lo, hi) => lo + Math.floor(rand(g) * (hi - lo + 1));
function pickWeighted(g, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = rand(g) * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return entries[entries.length - 1][0];
}

// ---------- setup ----------
const emptyStats = () => ({ pa: 0, pc: 0, py: 0, ptd: 0, pint: 0, sk: 0, ra: 0, ry: 0, rtd: 0, rlong: 0, fum: 0,
  tg: 0, rc: 0, rcy: 0, rctd: 0, rclong: 0, tk: 0, dsk: 0, dint: 0, pd: 0, ff: 0, sn: 0 });
const emptyTeamStats = () => ({ plays: 0, yds: 0, passYds: 0, rushYds: 0, fd: 0, to: 0, top: 0, third: [0, 0], sacks: 0, pen: 0 });

function makeSide(t) {
  const roster = [...Object.values(t.lineup), ...(t.bench ?? [])];
  return {
    id: t.id, name: t.name, abbr: t.abbr, color: t.color, coach: t.coach ?? 'balanced',
    starters: { ...t.lineup }, lineup: { ...t.lineup }, bench: [...(t.bench ?? [])], roster,
    energy: Object.fromEntries(roster.map((id) => [id, t.energy?.[id] ?? 100])),
    locks: {},
    stats: Object.fromEntries(roster.map((id) => [id, emptyStats()])),
    team: emptyTeamStats(),
    units: unitRatings(t.lineup),
  };
}

export function createGame({ home, away, seed = Date.now(), playoff = false, weather = null }) {
  const g = {
    seed, rng: seed >>> 0 || 1, playoff,
    teams: [makeSide(home), makeSide(away)],
    score: [0, 0], qs: [[0, 0, 0, 0], [0, 0, 0, 0]], quarter: 1, clock: 900,
    poss: 0, spot: 25, down: 1, toGo: 10, phase: 'play', final: false, winner: null,
    playNo: 0, ghostUsed: {}, log: [], drives: [], drive: null, lastPlay: null,
    weather: weather ?? 'clear', firstReceiver: 0,
  };
  if (!weather) g.weather = pickWeather(g);
  const receiver = chance(g, 0.5) ? 0 : 1;
  g.firstReceiver = receiver;
  addLog(g, { kind: 'info', text: `${WEATHER[g.weather].name} at kickoff. ${g.teams[receiver].name} will receive.` });
  kickoff(g, 1 - receiver);
  return g;
}

function pickWeather(g) {
  // A weather-setting ability on either team's starters usually brings its weather (home side first).
  for (const t of g.teams) {
    for (const id of Object.values(t.starters)) {
      const w = ABILITIES[PLAYERS[id].ability]?.weather;
      if (w && chance(g, 0.6)) return w;
    }
  }
  return pickWeighted(g, { clear: 70, rain: 12, sun: 8, sand: 5, hail: 5 });
}

// ---------- ratings in context ----------
function energyOf(g, ti, id) { return g.teams[ti].energy[id] ?? 100; }

function cond(g, ti, id, when) {
  switch (when) {
    case 'rain': case 'sun': case 'sand': case 'hail': return g.weather === when;
    case 'tired': return energyOf(g, ti, id) < 60;
    case 'q4trail': return g.quarter >= 4 && g.score[ti] < g.score[1 - ti];
    default: return true;
  }
}

export function eff(g, ti, id, attr, ctx = {}) {
  if (id == null) return 30;
  const p = PLAYERS[id];
  const ab = ABILITIES[p.ability];
  let v = p.attrs[attr];
  if (ab?.attr && ab.when && cond(g, ti, id, ab.when)) v += ab.attr[attr] ?? ab.attr.all ?? 0;
  if (ab?.special === 'speedBoost' && attr === 'spd') v += 2 * (Math.min(g.quarter, 4) - 1);
  if (ab?.special === 'runAway' && attr === 'spd' && ctx.run) v += 5;
  if (ab?.special === 'sniper' && attr === 'acc' && ctx.deep) v += 6;
  if (ab?.special === 'ironFist' && attr === 'str' && ctx.breakTackle) v += 5;
  if (p.types.includes('Dragon') && g.quarter >= 4) v += 3;
  if (attr === 'blk' && ctx.runBlock && p.types.includes('Ground')) v += TYPE_TRAITS.Ground.runBlock;
  if (attr === 'hnd' && ctx.contested && p.types.includes('Flying')) v += TYPE_TRAITS.Flying.contested;
  let m = 1;
  const w = WEATHER[g.weather];
  if (g.weather === 'sand') { if (w.immune.some((t) => p.types.includes(t))) m *= 1.05; }
  else if (w.boost && p.types.includes(w.boost)) m *= 1.08;
  if (w.nerf && p.types.includes(w.nerf)) m *= 0.92;
  m *= 0.85 + 0.15 * energyOf(g, ti, id) / 100;
  if (ab?.special === 'truant' && g.playNo % 2 === 1) m *= 0.6;
  return v * m;
}

function typeMod(attId, defId) {
  if (attId == null || defId == null) return { mult: 1, mod: 1 };
  const A = PLAYERS[attId], D = PLAYERS[defId];
  let mult = bestMultiplier(A, D);
  const aa = ABILITIES[A.ability]?.special, da = ABILITIES[D.ability]?.special;
  if (aa === 'tinted' && mult < 1 && mult > 0) mult = 1;
  let mod = matchupModifier(mult);
  if (mult > 1 && da === 'filter' && aa !== 'moldBreaker') mod = 1.04;
  if (aa === 'adapt') mod = 1 + (mod - 1) * 2;
  return { mult, mod };
}

// A contested rep: each side's value scaled by its type matchup against the other.
export function rep(aId, aVal, dId, dVal) {
  const am = typeMod(aId, dId), dm = typeMod(dId, aId);
  return { diff: aVal * am.mod - dVal * dm.mod, aSE: am.mult > 1, dSE: dm.mult > 1 };
}

export const has = (id, special) => id != null && ABILITIES[PLAYERS[id].ability]?.special === special;
export const nm = (id) => (id == null ? 'nobody' : PLAYERS[id].name);

// ---------- helpers on game state ----------
function addLog(g, e) {
  const entry = { n: g.log.length, q: g.quarter, clock: g.clock, poss: g.poss, score: [...g.score], ...e };
  g.log.push(entry);
  return entry;
}
export function st(g, ti, id) {
  const s = g.teams[ti].stats;
  if (!s[id]) s[id] = emptyStats();
  return s[id];
}
export function spotText(g, spot = g.spot, poss = g.poss) {
  if (spot === 50) return 'midfield';
  return spot < 50 ? `${g.teams[poss].abbr} ${spot}` : `${g.teams[1 - poss].abbr} ${100 - spot}`;
}
export function downText(g) {
  const ord = ['', '1st', '2nd', '3rd', '4th'][g.down];
  const goal = g.spot + g.toGo >= 100;
  return `${ord} & ${goal ? 'Goal' : g.toGo}`;
}
export const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
export const quarterText = (q) => (q <= 4 ? `Q${q}` : q === 5 ? 'OT' : `${q - 4}OT`);
export function fgDistance(g) { return 100 - g.spot + 17; }
// Absolute field position for drawing: home (team 0) always attacks to the right.
export function absSpot(poss, spot) { return poss === 0 ? spot : 100 - spot; }

function startDrive(g) {
  g.drive = { team: g.poss, start: g.spot, plays: 0, yards: 0, q: g.quarter, clock: g.clock, top: 0 };
  checkSubs(g, g.poss, OFF_SLOTS);
  checkSubs(g, 1 - g.poss, DEF_SLOTS);
}
function endDrive(g, result) {
  if (g.drive) { g.drives.push({ ...g.drive, result }); g.drive = null; }
}

// Bench Pokémon replace tired starters at the start of a drive.
function checkSubs(g, ti, slots) {
  const t = g.teams[ti];
  const onField = new Set(Object.values(t.lineup));
  for (const slot of slots) {
    if (t.locks?.[slot] != null) continue;
    const cur = t.lineup[slot];
    const value = (id) => PLAYERS[id].ovr[slot] * (0.85 + 0.15 * energyOf(g, ti, id) / 100);
    const cands = [t.starters[slot], ...t.bench].filter((id) => id !== cur && !onField.has(id) && energyOf(g, ti, id) >= 75);
    let best = cur, bestV = value(cur) + 2;
    for (const id of cands) if (value(id) > bestV) { best = id; bestV = value(id); }
    if (best !== cur) {
      onField.delete(cur); onField.add(best); t.lineup[slot] = best;
      addLog(g, { kind: 'sub', text: `${t.abbr} sub: ${nm(best)} in for ${nm(cur)} at ${slot}.` });
    }
  }
}

// Coach's substitution: the auto-sub leaves a locked slot alone until the starter returns.
// Pass id = null to send the starter back in.
export function manualSub(g, ti, slot, id) {
  const t = g.teams[ti];
  t.locks ??= {};
  const cur = t.lineup[slot];
  const onField = new Set(Object.values(t.lineup));
  if (id == null) {
    delete t.locks[slot];
    const s = t.starters[slot];
    if (s === cur || onField.has(s) || !t.roster.includes(s)) return false;
    t.lineup[slot] = s;
    addLog(g, { kind: 'sub', text: `${t.abbr} sub: ${nm(s)} back in for ${nm(cur)} at ${slot}.` });
    return true;
  }
  if (onField.has(id) || !t.roster.includes(id)) return false;
  t.lineup[slot] = id;
  t.locks[slot] = id;
  addLog(g, { kind: 'sub', text: `${t.abbr} sub: ${nm(id)} in for ${nm(cur)} at ${slot}, coach's call.` });
  return true;
}

function applyFatigue(g) {
  for (let ti = 0; ti < 2; ti++) {
    const t = g.teams[ti];
    const active = new Set(Object.entries(t.lineup)
      .filter(([slot]) => (ti === g.poss ? OFF_SLOTS : DEF_SLOTS).includes(slot)).map(([, id]) => id));
    for (const id of t.roster) {
      const p = PLAYERS[id];
      if (active.has(id)) {
        const slot = Object.keys(t.lineup).find((k) => t.lineup[k] === id);
        const grp = ['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DE', 'DT1', 'DT2'].includes(slot) ? 2.0
          : ['RB', 'OLB', 'MLB'].includes(slot) ? 1.7 : slot === 'QB' ? 1.0 : 1.4;
        let drain = grp * (1.2 - p.attrs.sta / 200);
        for (const ty of p.types) drain *= TYPE_TRAITS[ty].fatigue ?? 1;
        if (has(id, 'rockHead')) drain *= 0.75;
        const w = WEATHER[g.weather];
        if (w.immune && !w.immune.some((ty) => p.types.includes(ty))) drain *= 1.3;
        t.energy[id] = Math.max(0, t.energy[id] - drain);
        const s = st(g, ti, id);
        s.sn = (s.sn ?? 0) + 1;
      } else {
        t.energy[id] = Math.min(100, t.energy[id] + (has(id, 'recover') ? 1.4 : 0.7));
      }
    }
  }
}

// ---------- special teams ----------
function kickoff(g, kicker, freeKick = false) {
  const rec = 1 - kicker;
  g.poss = rec; g.down = 1; g.toGo = 10; g.phase = 'play';
  let text;
  if (!freeKick && chance(g, 0.62)) {
    g.spot = 25;
    text = `${g.teams[kicker].name} kick off. Touchback.`;
  } else if (chance(g, 0.004)) {
    g.spot = 100;
    text = `${g.teams[kicker].name} kick off and ${g.teams[rec].name} return it all the way!`;
  } else {
    g.spot = Math.round(clamp((freeKick ? 32 : 23) + 7 * randn(g), 5, 50));
    g.clock = Math.max(0, g.clock - 6);
    text = `${g.teams[kicker].name} kick off. Returned to the ${spotText(g)}.`;
  }
  addLog(g, { kind: 'kick', text, ball: absSpot(g.poss, g.spot) });
  if (g.spot >= 100) { scoreTD(g, rec, null); return; }
  startDrive(g);
}

function fgChance(dist) {
  const pts = [[20, 0.99], [30, 0.95], [40, 0.86], [45, 0.78], [50, 0.66], [55, 0.48], [60, 0.25], [66, 0.05]];
  if (dist <= 20) return 0.99;
  for (let i = 1; i < pts.length; i++) {
    if (dist <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (dist - x0) / (x1 - x0);
    }
  }
  return 0;
}
export { fgChance };

function scoreTD(g, ti, scorer) {
  addScore(g, ti, 6);
  const xp = chance(g, 0.94);
  if (xp) addScore(g, ti, 1);
  endDrive(g, 'Touchdown');
  addLog(g, { kind: 'score', text: `Extra point ${xp ? 'is good' : 'is no good'}. ${scoreLine(g)}` });
  if (otOver(g)) return;
  kickoff(g, ti);
}
function addScore(g, ti, pts) {
  g.score[ti] += pts;
  g.qs[ti][g.quarter - 1] = (g.qs[ti][g.quarter - 1] ?? 0) + pts;
}
function scoreLine(g) { return `${g.teams[0].abbr} ${g.score[0]}, ${g.teams[1].abbr} ${g.score[1]}.`; }
function otOver(g) {
  if (g.quarter >= 5 && g.score[0] !== g.score[1]) { finish(g); return true; }
  return false;
}
function finish(g) {
  g.final = true; g.phase = 'final';
  g.winner = g.score[0] === g.score[1] ? null : g.score[0] > g.score[1] ? 0 : 1;
  const w = g.winner == null ? 'The game ends in a tie' : `${g.teams[g.winner].name} win`;
  addLog(g, { kind: 'final', text: `Final: ${w}, ${Math.max(...g.score)} to ${Math.min(...g.score)}.` });
}
export function quarterTotals(g, ti) {
  return g.qs[ti].map((v, i) => (i < 4 || i < g.quarter ? v ?? 0 : null)).filter((v) => v != null);
}

// ---------- the play ----------
export function runPlay(g, offCall, defCall) {
  if (g.final) return null;
  const play = OFF_PLAYS[offCall];
  g.playNo++;
  const base = { kind: 'play', off: offCall, def: defCall, down: g.down, toGo: g.toGo, spotBefore: g.spot,
    from: absSpot(g.poss, g.spot), team: g.poss, yards: 0 };
  let r;
  if (play.kind === 'punt') r = doPunt(g, base);
  else if (play.kind === 'fg') r = doFieldGoal(g, base);
  else if (play.kind === 'run') r = doRun(g, offCall, defCall);
  else r = doPass(g, offCall, defCall);
  return finishPlay(g, r, base, offCall, defCall, between(g, 4, 8));
}

// A run or pass played out on the live field: live.js decides what happened and keeps the
// player stats; this applies it to the down, distance, score and clock like any other play.
export function runLivePlay(g, offCall, defCall, r, seconds) {
  if (g.final) return null;
  g.playNo++;
  const base = { spotBefore: g.spot };
  return finishPlay(g, r, base, offCall, defCall, clamp(Math.round(seconds), 2, 20));
}

function finishPlay(g, r, base, offCall, defCall, playSecs) {
  const o = g.poss, d = 1 - o;
  const play = OFF_PLAYS[offCall];
  const before = { spot: base.spotBefore, down: g.down, toGo: g.toGo, poss: o };
  if (r.special) { before.down = base.down; before.toGo = base.toGo; }
  const hurry = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 120 && (g.quarter === 2 || g.score[o] <= g.score[d]);
  const milk = g.quarter >= 4 && g.score[o] > g.score[d] && g.clock < 360;

  // Clock
  let elapsed = playSecs;
  if (!r.clockStop) elapsed += hurry ? between(g, 8, 14) : milk ? between(g, 34, 39) : between(g, 25, 35);
  elapsed = Math.min(elapsed, g.clock);
  g.clock -= elapsed;
  g.teams[o].team.top += elapsed;
  if (play.kind === 'run' || play.kind === 'pass') applyFatigue(g);

  const entry = resolve(g, r, before, offCall, defCall);
  g.lastPlay = entry;
  if (g.clock <= 0 && !g.final) endQuarter(g);
  return entry;
}

function resolve(g, r, before, offCall, defCall) {
  const o = before.poss, d = 1 - o;
  const T = g.teams[o].team;
  const base = { kind: 'play', off: offCall, def: defCall, down: before.down, toGo: before.toGo, spotBefore: before.spot,
    from: absSpot(o, before.spot), carrier: r.carrier, team: o, highlight: r.highlight ?? null, yards: r.yards ?? 0, se: r.se ?? false };
  if (r.special) return r.entry;
  if (g.drive) { g.drive.plays++; }
  T.plays++;
  let text = r.text;
  const newSpot = before.spot + r.yards;
  if (before.down === 3) T.third[0]++;

  if (r.turnover) {
    T.to++;
    endDrive(g, r.turnover === 'int' ? 'Interception' : 'Fumble');
    let ret = r.returnSpot;
    g.poss = d; g.down = 1; g.toGo = 10;
    if (ret >= 100) {
      const e = addLog(g, { ...base, text: text + ' Returned for a TOUCHDOWN!', to: absSpot(d, 100), highlight: 'td', kind: 'score' });
      g.spot = 100;
      scoreTD(g, d, r.returner);
      return e;
    }
    if (ret <= 0) ret = 20;
    g.spot = ret;
    const e = addLog(g, { ...base, text, to: absSpot(d, g.spot), kind: 'turnover' });
    startDrive(g);
    return e;
  }
  if (r.yards) { T.yds += Math.min(r.yards, 100 - before.spot); if (g.drive) g.drive.yards += r.yards; }
  if (r.kind === 'pass') T.passYds += Math.min(r.yards, 100 - before.spot);
  if (r.kind === 'run') T.rushYds += Math.min(r.yards, 100 - before.spot);

  if (newSpot >= 100) {
    if (r.scorer != null) {
      if (r.kind === 'pass') { st(g, o, r.qb).ptd++; st(g, o, r.scorer).rctd++; } else st(g, o, r.scorer).rtd++;
    }
    if (before.down === 3) T.third[1]++;
    T.fd++;
    g.spot = 100;
    const e = addLog(g, { ...base, text: text + ' TOUCHDOWN!', to: absSpot(o, 100), highlight: 'td', kind: 'score' });
    scoreTD(g, o, r.scorer);
    return e;
  }
  if (newSpot <= 0) {
    addScore(g, d, 2);
    endDrive(g, 'Safety');
    const e = addLog(g, { ...base, text: text + ` Tackled in the end zone. SAFETY! ${scoreLine(g)}`, to: absSpot(o, 0), highlight: 'safety', kind: 'score' });
    if (!otOver(g)) kickoff(g, o, true);
    return e;
  }
  g.spot = newSpot;
  if (r.yards >= before.toGo) {
    g.down = 1; g.toGo = Math.min(10, 100 - newSpot); T.fd++;
    if (before.down === 3) T.third[1]++;
  } else if (before.down === 4) {
    endDrive(g, 'Downs');
    g.poss = d; g.spot = 100 - newSpot; g.down = 1; g.toGo = Math.min(10, 100 - g.spot);
    const e = addLog(g, { ...base, text: text + ' Turnover on downs.', to: absSpot(o, newSpot), kind: 'turnover' });
    startDrive(g);
    return e;
  } else {
    g.down++; g.toGo -= r.yards;
  }
  return addLog(g, { ...base, text, to: absSpot(o, newSpot) });
}

function endQuarter(g) {
  const q = g.quarter;
  addLog(g, { kind: 'quarter', text: `End of ${q <= 4 ? `quarter ${q}` : 'overtime'}. ${scoreLine(g)}` });
  if (q === 2) {
    endDrive(g, 'Half');
    g.quarter = 3; g.clock = 900;
    for (const t of g.teams) for (const id of t.roster) t.energy[id] = Math.min(100, t.energy[id] + 30);
    addLog(g, { kind: 'info', text: 'Halftime. Everyone gets a breather.' });
    kickoff(g, g.firstReceiver);
    return;
  }
  if (q === 1 || q === 3) { g.quarter++; g.clock = 900; return; }
  // End of regulation or an overtime period
  if (g.score[0] !== g.score[1] || (q >= 5 && !g.playoff)) { endDrive(g, 'End of game'); finish(g); return; }
  endDrive(g, 'End of regulation');
  g.quarter++; g.clock = 600;
  for (const t of g.teams) for (const id of t.roster) t.energy[id] = Math.min(100, t.energy[id] + 20);
  addLog(g, { kind: 'info', text: 'Overtime. Next score wins.' });
  kickoff(g, chance(g, 0.5) ? 0 : 1);
}

function doPunt(g, base) {
  const o = g.poss, d = 1 - o;
  endDrive(g, 'Punt');
  const net = Math.round(41 + 6 * randn(g));
  const land = g.spot + net;
  let text, highlight = null;
  g.poss = d; g.down = 1; g.toGo = 10;
  if (chance(g, 0.005)) {
    g.spot = clamp(100 - (base.spotBefore - 8), 1, 99); g.toGo = Math.min(10, 100 - g.spot);
    text = `${g.teams[o].name} punt is BLOCKED! ${g.teams[d].name} take over at the ${spotText(g)}.`;
    highlight = 'turnover';
  } else if (land >= 100) { g.spot = 20; text = `${g.teams[o].name} punt into the end zone. Touchback.`; }
  else { g.spot = 100 - land; text = `${g.teams[o].name} punt ${net} net yards. ${g.teams[d].name} take over at the ${spotText(g)}.`; }
  const entry = addLog(g, { ...base, text, highlight, to: absSpot(g.poss, g.spot) });
  startDrive(g);
  return { special: true, entry, clockStop: true };
}

function doFieldGoal(g, base) {
  const o = g.poss, d = 1 - o;
  const dist = fgDistance(g);
  if (chance(g, fgChance(dist))) {
    addScore(g, o, 3);
    endDrive(g, 'Field goal');
    const entry = addLog(g, { ...base, kind: 'score', highlight: 'fg', text: `${dist}-yard field goal is GOOD. ${scoreLine(g)}`, to: absSpot(o, 100) });
    if (!otOver(g)) kickoff(g, o);
    return { special: true, entry, clockStop: true };
  }
  endDrive(g, 'Missed FG');
  g.poss = d; g.spot = Math.max(20, 100 - (base.spotBefore - 7)); g.down = 1; g.toGo = 10;
  const entry = addLog(g, { ...base, highlight: 'miss', text: `${dist}-yard field goal is NO GOOD.`, to: absSpot(o, 100) });
  startDrive(g);
  return { special: true, entry, clockStop: true };
}

function pickTackler(g, d, weights) {
  const L = g.teams[d].lineup;
  const w = {};
  for (const [slot, v] of Object.entries(weights)) if (L[slot] != null) w[slot] = v * (0.6 + eff(g, d, L[slot], 'tkl') / 100);
  return L[pickWeighted(g, w)];
}

export function fumbleCheck(g, o, d, carrier, tackler) {
  if (has(carrier, 'noFumble')) return false;
  let p = 0.009 + (eff(g, d, tackler, 'tkl') - eff(g, o, carrier, 'str')) / 4000;
  if (g.weather === 'rain') p += 0.005;
  if (tackler != null && PLAYERS[tackler].types.includes('Poison')) p += 0.004;
  if (has(carrier, 'reckless')) p += 0.005;
  return chance(g, clamp(p, 0.002, 0.04));
}

function seNote(flag) { return flag ? " It's super effective!" : ''; }

function doRun(g, call, defCall) {
  const o = g.poss, d = 1 - o;
  const O = (s) => g.teams[o].lineup[s], D = (s) => g.teams[d].lineup[s];
  const dir = OFF_PLAYS[call].dir;
  const carrier = dir === 'sneak' ? O('QB') : O('RB');
  const pairs = dir === 'outside'
    ? [['LT', 'LE', 1.2], ['RT', 'DE', 1.2], ['TE', 'OLB', 1.2], ['LG', 'DT1', 0.6], ['RG', 'DT2', 0.6], ['C', 'MLB', 0.5]]
    : [['LG', 'DT1', 1.2], ['C', 'MLB', 1.0], ['RG', 'DT2', 1.2], ['LT', 'LE', 0.6], ['RT', 'DE', 0.6], ['TE', 'OLB', 0.4]];
  let lane = 0, wsum = 0, keyRep = null;
  const extras = [];
  for (const [b, rr, w] of pairs) {
    const bv = eff(g, o, O(b), 'blk', { runBlock: true }) * 0.5 + eff(g, o, O(b), 'str') * 0.5;
    const rv = eff(g, d, D(rr), 'str') * 0.6 + eff(g, d, D(rr), 'tkl') * 0.4;
    const R = rep(O(b), bv, D(rr), rv);
    lane += R.diff * w; wsum += w;
    if (!keyRep || Math.abs(R.diff) > Math.abs(keyRep.diff)) keyRep = { ...R, b: O(b), r: D(rr) };
  }
  lane = lane / wsum + SCHEME[defCall].run;
  if (dir === 'draw') lane += { pass_blitz: 6, prevent: 4, cover2: 2, run_blitz: -4, goal_line: -3 }[defCall] ?? 0;

  const power = eff(g, o, carrier, 'str', { run: true }), speed = eff(g, o, carrier, 'spd', { run: true });
  let yards;
  if (dir === 'sneak') {
    const push = (power - (eff(g, d, D('DT1'), 'str') + eff(g, d, D('DT2'), 'str')) / 2) * 0.03;
    yards = Math.round(1.3 + push + lane * 0.04 + 1.3 * randn(g));
  } else {
    let mean = 2.5 + lane * 0.1;
    let sd = 3.0;
    if (dir === 'outside') {
      const edge = (eff(g, d, D('OLB'), 'spd') + eff(g, d, D('CB1'), 'spd')) / 2;
      mean += (speed - edge) * 0.06 + (speed - 65) * 0.02; sd = 4.3;
    } else {
      mean += (power - 65) * 0.04 + (speed - 65) * 0.02; sd = dir === 'draw' ? 3.8 : 3.0;
    }
    yards = Math.round(mean + sd * randn(g));
    yards = Math.max(yards, -4);
  }
  let tackler = pickTackler(g, d, dir === 'outside' ? { OLB: 3, CB1: 2, SS: 2.5, MLB: 2, LE: 1, DE: 1 }
    : { MLB: 4, DT1: 2, DT2: 2, OLB: 1.5, SS: 2, LE: 0.7, DE: 0.7 });
  // broken tackle at the second level
  if (yards >= 2 && dir !== 'sneak') {
    const bt = sigmoid(((eff(g, o, carrier, 'str', { breakTackle: true }) * 0.5 + speed * 0.5) - eff(g, d, tackler, 'tkl')) / 10 - 2.1)
      + (has(carrier, 'slippery') ? 0.04 : 0);
    if (chance(g, bt)) { yards += Math.round(expo(g, 5)); extras.push(`breaks a tackle from ${nm(tackler)}`); }
  }
  if (yards >= 5 && dir !== 'sneak') {
    const fs = D('FS');
    const p = sigmoid((speed - eff(g, d, fs, 'spd')) / 10 - 2.5) + (has(carrier, 'luck') ? 0.04 : 0);
    if (chance(g, p)) { yards += Math.round(expo(g, 14)); tackler = fs; extras.push('breaks into the open field'); }
  }
  if (PLAYERS[carrier].types.includes('Ghost') && !g.ghostUsed[carrier] && yards >= 1 && yards <= 9 && chance(g, 0.35)) {
    g.ghostUsed[carrier] = true;
    yards += 5 + Math.round(expo(g, 12));
    extras.push(`phases right through ${nm(tackler)}`);
  }
  const s = st(g, o, carrier);
  s.ra++; s.ry += Math.min(yards, 100 - g.spot); s.rlong = Math.max(s.rlong, yards);
  const where = { inside: 'up the middle', outside: chance(g, 0.5) ? 'around the left end' : 'around the right end', draw: 'on the draw', sneak: 'on the sneak' }[dir];
  const gain = yards > 0 ? `for ${yards} yard${yards === 1 ? '' : 's'}` : yards === 0 ? 'for no gain' : `for a loss of ${-yards}`;
  let text = extras.length ? `${nm(carrier)} runs ${where}, ${extras.join(' and ')}. Gain of ${yards}.` : `${nm(carrier)} runs ${where} ${gain}.`;
  const se = keyRep && Math.abs(keyRep.diff) > 12 && (keyRep.diff > 0 ? keyRep.aSE : keyRep.dSE);
  if (se) text += keyRep.diff > 0 ? ` ${nm(keyRep.b)} clears the way.${seNote(true)}` : ` ${nm(keyRep.r)} blows up the play.${seNote(true)}`;
  const td = g.spot + yards >= 100;
  if (!td) {
    st(g, d, tackler).tk++;
    text += ` Tackled by ${nm(tackler)}.`;
    if (fumbleCheck(g, o, d, carrier, tackler)) {
      s.fum++; st(g, d, tackler).ff++;
      if (chance(g, 0.55)) {
        const spotAt = clamp(g.spot + yards, 1, 99);
        return { kind: 'run', yards, carrier, text: text + ` FUMBLE! ${g.teams[d].name} recover.`, turnover: 'fumble',
          returnSpot: 100 - spotAt, highlight: 'turnover', clockStop: true, se };
      }
      text += ' Fumble, but the offense recovers.';
    }
  }
  const bigPlay = yards >= 20 ? 'big' : yards < 0 ? 'loss' : null;
  return { kind: 'run', yards, carrier, scorer: carrier, text, clockStop: dir === 'outside' && chance(g, 0.2), highlight: bigPlay, se };
}

function doPass(g, call, defCall) {
  const o = g.poss, d = 1 - o;
  const O = (s) => g.teams[o].lineup[s], D = (s) => g.teams[d].lineup[s];
  const play = OFF_PLAYS[call];
  const qb = O('QB');
  const blitz = defCall === 'pass_blitz' ? ['OLB', 'MLB'] : defCall === 'run_blitz' ? ['MLB'] : [];
  const rbBlocks = blitz.length > 0 && call !== 'screen';
  const qs = st(g, o, qb);
  const depth = play.depth;
  const T = g.teams[o].team;

  // Pass rush
  const reps = [['LT', 'LE'], ['LG', 'DT1'], ['RG', 'DT2'], ['RT', 'DE']];
  if (blitz.includes('MLB')) reps.push(['C', 'MLB']);
  if (blitz.includes('OLB')) reps.push([rbBlocks ? 'RB' : null, 'OLB']);
  let pressure = 0, sacker = null, sackSE = false, pressAbility = false;
  const timing = (play.pa ? 0.3 : 0) + ({ screen: -1.6, short: -0.6, mid: 0, deep: 0.35 })[depth];
  for (const [b, rr] of reps) {
    const rid = D(rr), bid = b ? O(b) : null;
    let p;
    let se = false;
    if (bid == null) p = 0.5;
    else {
      const bv = eff(g, o, bid, 'blk') * 0.75 + eff(g, o, bid, 'str') * 0.25;
      const rv = eff(g, d, rid, 'rush');
      const R = rep(rid, rv, bid, bv);
      p = sigmoid(R.diff / 8 - 3.15 + timing);
      se = R.aSE;
    }
    if (chance(g, p)) {
      pressure++;
      if (!sacker || chance(g, 0.5)) { sacker = rid; sackSE = se; }
      if (has(rid, 'pressure')) pressAbility = true;
    }
  }
  const qbSpd = eff(g, o, qb, 'spd');
  if (pressure > 0) {
    let pSack = 0.22 + 0.08 * (pressure - 1) - (qbSpd - 60) / 350;
    if (depth === 'screen') pSack *= 0.3;
    if (chance(g, clamp(pSack, 0.05, 0.6))) {
      const loss = Math.round(5 + expo(g, 2.5));
      qs.sk++; st(g, d, sacker).dsk++; st(g, d, sacker).tk++; T.sacks++;
      let text = `${nm(sacker)} sacks ${nm(qb)} for a loss of ${loss}.${seNote(sackSE)}`;
      const strip = has(qb, 'noFumble') ? 0 : 0.07 + (PLAYERS[sacker].types.includes('Poison') ? 0.03 : 0);
      if (chance(g, strip)) {
        st(g, o, qb).fum++; st(g, d, sacker).ff++;
        if (chance(g, 0.6)) {
          const spotAt = clamp(g.spot - loss, 1, 99);
          return { kind: 'sack', yards: -loss, carrier: qb, text: text + ` Strip sack! ${g.teams[d].name} recover.`,
            turnover: 'fumble', returnSpot: 100 - spotAt, highlight: 'turnover', clockStop: true, se: sackSE };
        }
        text += ' The ball comes loose, but the offense falls on it.';
      }
      return { kind: 'sack', yards: -loss, carrier: qb, text, highlight: 'sack', se: sackSE };
    }
    if (chance(g, clamp((qbSpd - 55) / 220, 0, 0.25))) {
      const yards = Math.max(-2, Math.round(4 + (qbSpd - 65) * 0.06 + 3.5 * randn(g)));
      const s = qs; s.ra++; s.ry += Math.min(yards, 100 - g.spot); s.rlong = Math.max(s.rlong, yards);
      const tk = pickTackler(g, d, { MLB: 2, OLB: 2, SS: 1, LE: 1, DE: 1 });
      if (g.spot + yards < 100) st(g, d, tk).tk++;
      return { kind: 'run', yards, carrier: qb, scorer: qb, text: `Under pressure, ${nm(qb)} scrambles for ${yards} yard${yards === 1 ? '' : 's'}.` };
    }
    if (chance(g, 0.1)) {
      qs.pa++;
      return { kind: 'pass', yards: 0, carrier: qb, text: `${nm(qb)} is flushed out and throws it away.`, clockStop: true };
    }
  }

  // Coverage and the read
  const sch = SCHEME[defCall];
  const man = {
    WR1: D('CB1'), WR2: D('CB2'), WR3: D('CB3'), TE: D('SS'),
    RB: !blitz.includes('OLB') ? D('OLB') : !blitz.includes('MLB') ? D('MLB') : null,
  };
  const targets = ['WR1', 'WR2', 'WR3', 'TE', 'RB'].filter((t) => !(t === 'RB' && rbBlocks));
  const deep = depth === 'deep';
  const safetyHelp = Math.max(0, (eff(g, d, D('FS'), 'cov') - 55) * (defCall === 'cover2' || defCall === 'prevent' ? 0.2 : 0.12));
  let best = null;
  const vision = eff(g, o, qb, 'acc');
  const noiseSd = 3 + (90 - vision) * 0.12 + (pressure ? 4 : 0);
  for (const t of targets) {
    const rid = O(t), cid = man[t];
    const route = depth === 'deep'
      ? eff(g, o, rid, 'spd') * 0.6 + eff(g, o, rid, 'hnd') * 0.25 + eff(g, o, rid, 'acc') * 0.15
      : eff(g, o, rid, 'spd') * 0.35 + eff(g, o, rid, 'hnd') * 0.3 + eff(g, o, rid, 'acc') * 0.35;
    let sep;
    let se = false;
    if (cid == null) sep = 14;
    else {
      let cov = eff(g, d, cid, 'cov');
      if (sch.zone) {
        const zone = deep ? (eff(g, d, D('FS'), 'cov') + eff(g, d, D('SS'), 'cov')) / 2 : (eff(g, d, D('MLB'), 'cov') + eff(g, d, D('OLB'), 'cov')) / 2;
        cov = cov * 0.65 + zone * 0.35;
      }
      const R = rep(rid, route, cid, cov);
      sep = R.diff; se = R.aSE;
    }
    sep += sch[depth];
    if (play.pa && ['base', 'run_blitz', 'goal_line'].includes(defCall)) sep += 4;
    if (deep) sep -= safetyHelp;
    if (t === 'RB' && depth !== 'screen') sep -= 4;
    sep += 8 * randn(g) - SEP_OFFSET;
    const read = sep + noiseSd * randn(g) + (play.targets[t] ?? 0) * 14;
    if (!best || read > best.read) best = { t, rid, cid, sep, read, se };
  }

  // Throw
  const tgt = best.rid, cov = best.cid;
  let air = between(g, play.air[0], play.air[1]);
  air = Math.min(air, 100 - g.spot + 8);
  if (depth !== 'screen') air = Math.max(1, air);
  const intimidated = DEF_SLOTS.some((s) => has(D(s), 'intimidate')) && !has(qb, 'clearBody');
  let acc = eff(g, o, qb, 'acc', { deep }) - (intimidated ? 3 : 0) - (g.weather === 'rain' ? 4 : 0);
  const arm = eff(g, o, qb, 'arm');
  const hands = eff(g, o, tgt, 'hnd', { contested: best.sep < 0 });
  let pc = BASE_CMP[depth] + 0.011 * best.sep + 0.005 * (acc - 82) + 0.003 * (hands - 78);
  if (deep) pc += (arm - 80) * 0.004;
  if (depth === 'mid') pc += (arm - 80) * 0.0015;
  if (pressure) pc -= 0.13 * (has(qb, 'focus') ? 0.5 : 1) * (pressAbility ? 1.3 : 1);
  pc = clamp(pc, 0.04, 0.95);

  qs.pa++;
  const rs = st(g, o, tgt);
  rs.tg++;
  const route = { screen: 'on the screen', short: call === 'out' ? 'on the out' : 'on the slant', mid: call === 'te_seam' ? 'up the seam' : 'on the curl', deep: 'deep downfield' }[depth];

  if (chance(g, pc)) {
    const tackler = cov ?? D(deep ? 'FS' : 'SS');
    let yacMean = deep ? 2.5 : depth === 'screen' ? 4.5 : 2.1;
    yacMean += (eff(g, o, tgt, 'spd') - eff(g, d, tackler, 'spd')) * 0.05;
    if (depth === 'screen') {
      const olb = (eff(g, o, O('LT'), 'blk') + eff(g, o, O('C'), 'blk') + eff(g, o, O('RT'), 'blk')) / 3;
      yacMean += (olb - eff(g, d, D('MLB'), 'tkl')) * 0.05 + (blitz.length ? 3 : 0);
    }
    let yac = Math.round(expo(g, Math.max(1, yacMean)));
    let extra = '';
    let finalTackler = tackler;
    const stop = eff(g, d, tackler, 'tkl') * 0.5 + eff(g, d, tackler, 'spd') * 0.5;
    const bt = sigmoid(((eff(g, o, tgt, 'str', { breakTackle: true }) * 0.4 + eff(g, o, tgt, 'spd') * 0.6) - stop) / 9 - 2.7)
      + (has(tgt, 'slippery') ? 0.04 : 0);
    if (chance(g, bt)) { yac += Math.round(expo(g, 9)); extra = `, shakes ${nm(tackler)}`; finalTackler = D('FS'); }
    if (PLAYERS[tgt].types.includes('Ghost') && !g.ghostUsed[tgt] && chance(g, 0.12)) {
      g.ghostUsed[tgt] = true; yac += 5 + Math.round(expo(g, 10)); extra += `, phases through ${nm(finalTackler)}`;
    }
    const yards = air + yac;

    const counted = Math.min(yards, 100 - g.spot);
    qs.pc++; qs.py += counted; rs.rc++; rs.rcy += counted; rs.rclong = Math.max(rs.rclong, yards);
    let text = `${nm(qb)} finds ${nm(tgt)} ${route}${extra} for ${yards === 0 ? 'no gain' : `${yards} yard${Math.abs(yards) === 1 ? '' : 's'}`}.`;
    if (best.se && best.sep > 10) text += ` ${nm(tgt)} is wide open.${seNote(true)}`;
    const td = g.spot + yards >= 100;
    if (!td) {
      st(g, d, finalTackler).tk++;
      text += ` Tackled by ${nm(finalTackler)}.`;
      if (chance(g, 0.006) && !has(tgt, 'noFumble')) {
        rs.fum++; st(g, d, finalTackler).ff++;
        const spotAt = clamp(g.spot + yards, 1, 99);
        return { kind: 'pass', yards, carrier: tgt, qb, text: text + ` FUMBLE! ${g.teams[d].name} recover.`, turnover: 'fumble',
          returnSpot: 100 - spotAt, highlight: 'turnover', clockStop: true, se: best.se };
      }
    }
    const out = play.sideline && chance(g, 0.5);
    return { kind: 'pass', yards, carrier: tgt, scorer: tgt, qb, text, clockStop: out, highlight: yards >= 20 ? 'big' : null, se: best.se };
  }

  // Incomplete or intercepted
  let pInt = 0.027 + 0.005 * Math.max(0, -best.sep) + (pressure ? 0.04 : 0) - 0.0015 * (acc - 82) + (deep ? 0.03 : 0);
  const hawk = cov != null && PLAYERS[cov].types.includes('Dark');
  if (hawk) pInt += 0.03;
  if (depth === 'screen') pInt *= 0.3;
  const picker = cov ?? D('FS');
  if (chance(g, clamp(pInt, 0.01, 0.3))) {
    qs.pint++; st(g, d, picker).dint++;
    const catchAt = g.spot + air;
    let returnSpot;
    if (catchAt >= 100) returnSpot = 20;
    else {
      const ret = Math.round(expo(g, 7 + (eff(g, d, picker, 'spd') - 65) * 0.08));
      returnSpot = 100 - catchAt + ret;
    }
    return { kind: 'pass', yards: 0, carrier: picker, qb, text: `${nm(qb)} throws for ${nm(tgt)}... INTERCEPTED by ${nm(picker)}!`,
      turnover: 'int', returnSpot, returner: picker, highlight: 'turnover', clockStop: true };
  }
  let text = `${nm(qb)}'s pass for ${nm(tgt)} ${route} falls incomplete`;
  if (cov != null && chance(g, 0.45)) { st(g, d, cov).pd++; text += `, broken up by ${nm(cov)}`; }
  return { kind: 'pass', yards: 0, carrier: qb, qb, text: text + '.', clockStop: true };
}

// ---------- AI coach ----------
// The AI's leanings are split from its dice so the play caller can show which call fits the
// down without consuming g.rng: offenseLean gives a kick call or a pass rate, the weight tables
// below rank the calls within each kind.
export function offenseLean(g) {
  const o = g.poss, d = 1 - o;
  const t = g.teams[o];
  const lead = g.score[o] - g.score[d];
  const late = g.quarter >= 4;
  const dist = fgDistance(g);
  const endOfHalf = (g.quarter === 2 || late) && g.clock <= 8;
  if (endOfHalf && dist <= 57 && (g.quarter === 2 || (lead <= 0 && lead >= -3))) return 'fg';
  if (g.down === 4) {
    const desperate = late && lead < 0 && (g.clock < 150 || (lead < -8 && g.clock < 420));
    const needTD = late && lead < -3 && g.clock < 150;
    if (desperate && (needTD || dist > 52)) return 0.85;
    if (g.toGo <= 1 && g.spot >= 45 && g.spot <= 97 && !(late && lead > 0)) return 0.3;
    if (dist <= 52) return 'fg';
    if (g.toGo <= 2 && g.spot >= 60) return 0.4;
    return 'punt';
  }
  let pPass = 0.52;
  if (g.down === 1) pPass = 0.48;
  else if (g.down === 2) pPass = g.toGo >= 8 ? 0.62 : g.toGo <= 3 ? 0.4 : 0.52;
  else if (g.down === 3) pPass = g.toGo >= 5 ? 0.86 : g.toGo >= 3 ? 0.6 : 0.35;
  if (late && lead < -8) pPass += 0.25;
  else if (late && lead < 0 && g.clock < 240) pPass += 0.25;
  if (late && lead > 0) pPass -= 0.22;
  pPass += (t.units.passOff - t.units.runOff) / 50;
  if (t.coach === 'speed') pPass += 0.05;
  if (t.coach === 'trench') pPass -= 0.07;
  return clamp(pPass, 0.1, 0.95);
}

export function aiOffenseCall(g) {
  const lean = offenseLean(g);
  return typeof lean === 'string' ? lean : passOrRun(g, lean);
}

export function passWeights(g) {
  const o = g.poss, d = 1 - o;
  const t = g.teams[o], L = t.lineup, DL = g.teams[d].lineup;
  const A = (ti, id, a) => eff(g, ti, id, a);
  const long = g.toGo >= 8, short = g.toGo <= 4;
  const speedEdge = Math.max(A(o, L.WR1, 'spd') - A(d, DL.CB1, 'cov'), A(o, L.WR2, 'spd') - A(d, DL.CB2, 'cov'));
  const red = g.spot >= 85;
  const w = {
    screen: short ? 0.6 : 1, slant: short ? 2.2 : 1.2, out: short ? 1.6 : 1, curl: long ? 1.6 : 1.3,
    te_seam: 0.6 + Math.max(0, A(o, L.TE, 'hnd') - 70) / 20,
    post: red ? 0.2 : (long ? 1.0 : 0.45) + Math.max(0, speedEdge) / 35,
    pa_deep: red ? 0.1 : (g.down === 1 ? 0.55 : 0.2) + Math.max(0, speedEdge) / 40,
  };
  if (t.coach === 'speed') { w.post *= 1.4; w.pa_deep *= 1.4; }
  if (g.toGo > 15) { w.screen *= 0.5; w.slant *= 0.4; }
  return w;
}

export function runWeights(g) {
  const o = g.poss;
  const t = g.teams[o], L = t.lineup;
  const A = (ti, id, a) => eff(g, ti, id, a);
  const w = { inside_run: 1.2, outside_run: 1 + (A(o, L.RB, 'spd') - 70) / 30, draw: g.toGo >= 7 ? 0.8 : 0.25 };
  if (g.toGo <= 1) w.qb_sneak = 0.6 + Math.max(0, A(o, L.QB, 'str') - 65) / 30;
  if (t.coach === 'trench') w.inside_run *= 1.5;
  return w;
}

function passOrRun(g, pPass) {
  if (chance(g, pPass)) return pickWeighted(g, passWeights(g));
  return pickWeighted(g, runWeights(g));
}

export function defenseWeights(g) {
  const d = 1 - g.poss;
  const coach = g.teams[d].coach;
  const lead = g.score[d] - g.score[g.poss];
  let w;
  if (g.spot >= 96 || (g.toGo <= 1 && g.spot >= 90)) w = { goal_line: 4, run_blitz: 2, base: 2, man_press: 1 };
  else if (g.toGo <= 2) w = { run_blitz: 3.5, goal_line: 1.5, base: 3, man_press: 1.5 };
  else if (g.down >= 3 && g.toGo >= 7) w = { cover2: 3, cover3: 2, pass_blitz: 2.5, man_press: 1.5, prevent: lead > 0 && g.quarter >= 4 ? 4 : 0.3 };
  else w = { base: 3.5, cover3: 2, cover2: 1.5, run_blitz: 1, pass_blitz: 1, man_press: 1 };
  if (g.quarter >= 4 && lead > 0 && lead <= 8 && g.clock < 120) w.prevent = (w.prevent ?? 0) + 4;
  if (coach === 'trench') { w.pass_blitz = (w.pass_blitz ?? 0) * 1.5 + 0.5; w.run_blitz = (w.run_blitz ?? 0) * 1.3; }
  if (coach === 'speed') w.man_press = (w.man_press ?? 0) * 1.6 + 0.5;
  return w;
}

export function aiDefenseCall(g) { return pickWeighted(g, defenseWeights(g)); }

export function simPlay(g) { return runPlay(g, aiOffenseCall(g), aiDefenseCall(g)); }

export function simUntil(g, stop) {
  const start = { poss: g.poss, quarter: g.quarter, drives: g.drives.length };
  let n = 0;
  while (!g.final && n < 400) {
    simPlay(g); n++;
    if (stop === 'drive' && g.drives.length > start.drives) break;
    if (stop === 'quarter' && g.quarter !== start.quarter) break;
  }
}

// Box score summary used by the season standings and the UI.
export function summary(g) {
  return {
    score: [...g.score], winner: g.winner, quarters: [quarterTotals(g, 0), quarterTotals(g, 1)],
    teams: g.teams.map((t) => ({ id: t.id, stats: t.stats, team: t.team })), weather: g.weather,
  };
}
