// Game simulation: one play at a time, resolved as one-on-one matchups.
// Deterministic for a given seed. No DOM access.
import { PLAYERS, OFF_SLOTS, DEF_SLOTS, unitRatings } from './ratings.js';
import { TYPE_TRAITS, ABILITIES, WEATHER, bestMultiplier, matchupModifier } from './types.js';
import { PARITY, formFor } from './parity.js';
import { PENALTIES, announce, enforce, foul, preSnapFoul, simFouls, stateValue } from './penalties.js';

// The playbook. Each run or pass has its kind, the fast simulator's numbers (depth, air yards,
// target weights) and, for plays added on top of the original eleven, `sim`: the original play
// the fast simulator resolves it as. The live field runs every play for real (routes and run
// schemes in live.js).
export const OFF_PLAYS = {
  inside_run: { name: 'Inside Zone', kind: 'run', dir: 'inside', blurb: 'Read the A and B gaps' },
  outside_run: { name: 'Outside Zone', kind: 'run', dir: 'outside', blurb: 'Stretch to the edge, cut up' },
  power: { name: 'Power O', kind: 'run', dir: 'power', sim: 'inside_run', blurb: 'Backside guard pulls, off tackle' },
  counter: { name: 'Counter', kind: 'run', dir: 'counter', sim: 'inside_run', blurb: 'Step one way, run the other' },
  toss: { name: 'Toss Sweep', kind: 'run', dir: 'toss', sim: 'outside_run', blurb: 'Pitch it wide and race the edge' },
  dive: { name: 'HB Dive', kind: 'run', dir: 'dive', sim: 'inside_run', blurb: 'Quick hit straight ahead' },
  draw: { name: 'HB Draw', kind: 'run', dir: 'draw', blurb: 'Show pass, hand off late' },
  qb_sneak: { name: 'QB Sneak', kind: 'run', dir: 'sneak', blurb: 'Push for a yard' },
  qb_draw: { name: 'QB Draw', kind: 'run', dir: 'qbdraw', sim: 'draw', qb: true, blurb: 'Drop like a pass, then the QB takes off' },
  qb_power: { name: 'QB Power', kind: 'run', dir: 'qbpower', sim: 'inside_run', qb: true, blurb: 'Guard pulls, back leads, QB carries' },
  read_option: { name: 'Zone Read', kind: 'run', dir: 'read', sim: 'inside_run', qb: 0.4, blurb: 'Read the end: give it or pull it' },
  screen: { name: 'HB Screen', kind: 'pass', depth: 'screen', air: [-2, 1], targets: { RB: 1 }, blurb: 'Let the rush in, dump to the back' },
  bubble: { name: 'WR Bubble', kind: 'pass', depth: 'screen', air: [-2, 1], sim: 'screen', targets: { WR3: 1 }, blurb: 'Slot catches it behind blockers' },
  slant: { name: 'Slants', kind: 'pass', depth: 'short', air: [3, 7], targets: { WR1: 0.35, WR2: 0.3, WR3: 0.35 }, blurb: 'Quick inside breaks, 3 to 7 yards' },
  out: { name: 'Quick Out', kind: 'pass', depth: 'short', air: [4, 9], sideline: true, targets: { WR1: 0.3, WR2: 0.3, WR3: 0.25, RB: 0.15 }, blurb: 'Sideline throws, stops the clock' },
  stick: { name: 'Stick', kind: 'pass', depth: 'short', air: [4, 7], sim: 'slant', targets: { TE: 0.4, WR3: 0.35, RB: 0.25 }, blurb: 'Sit at six yards, flat underneath' },
  curl_flat: { name: 'Curl Flat', kind: 'pass', depth: 'short', air: [3, 11], sim: 'curl', targets: { WR1: 0.35, WR2: 0.3, RB: 0.2, WR3: 0.15 }, blurb: 'High-low the flat defender' },
  mesh: { name: 'Mesh', kind: 'pass', depth: 'short', air: [2, 8], sim: 'slant', targets: { WR3: 0.35, TE: 0.35, RB: 0.15, WR1: 0.15 }, blurb: 'Two shallow crossers rub man coverage' },
  curl: { name: 'Curls', kind: 'pass', depth: 'mid', air: [7, 12], targets: { WR1: 0.3, WR2: 0.3, TE: 0.25, WR3: 0.15 }, blurb: 'Sit down in the zone holes' },
  smash: { name: 'Smash', kind: 'pass', depth: 'mid', air: [5, 16], sim: 'curl', targets: { WR3: 0.4, WR1: 0.3, WR2: 0.3 }, blurb: 'Hitch outside, corner inside' },
  dagger: { name: 'Dagger', kind: 'pass', depth: 'mid', air: [10, 16], sim: 'curl', targets: { WR1: 0.5, WR3: 0.3, TE: 0.2 }, blurb: 'Seam clears it out, dig underneath' },
  levels: { name: 'Levels', kind: 'pass', depth: 'mid', air: [5, 13], sim: 'curl', targets: { WR1: 0.4, WR3: 0.4, TE: 0.2 }, blurb: 'In-breakers at 5 and 12 yards' },
  flood: { name: 'Flood', kind: 'pass', depth: 'mid', air: [3, 16], sim: 'out', sideline: true, targets: { WR3: 0.45, RB: 0.3, WR2: 0.25 }, blurb: 'Three levels to one sideline' },
  y_cross: { name: 'Y-Cross', kind: 'pass', depth: 'mid', air: [12, 18], sim: 'te_seam', targets: { TE: 0.55, WR2: 0.25, RB: 0.2 }, blurb: 'Tight end crosses the whole field' },
  te_seam: { name: 'TE Seam', kind: 'pass', depth: 'mid', air: [9, 15], targets: { TE: 0.6, WR3: 0.25, WR1: 0.15 }, blurb: 'Tight end splits the safeties' },
  four_verts: { name: 'Four Verticals', kind: 'pass', depth: 'deep', air: [15, 32], sim: 'post', targets: { WR3: 0.3, TE: 0.25, WR1: 0.25, WR2: 0.2 }, blurb: 'Everyone goes, stretch the safeties' },
  post: { name: 'Deep Post', kind: 'pass', depth: 'deep', air: [14, 25], targets: { WR1: 0.45, WR2: 0.4, WR3: 0.15 }, blurb: 'Beat the safety to the middle' },
  pa_boot: { name: 'PA Bootleg', kind: 'pass', depth: 'mid', pa: true, boot: true, air: [3, 18], sim: 'pa_deep', targets: { TE: 0.4, WR2: 0.35, RB: 0.25 }, blurb: 'Fake the run, QB rolls out' },
  pa_deep: { name: 'PA Shot', kind: 'pass', depth: 'deep', pa: true, air: [18, 34], targets: { WR1: 0.45, WR2: 0.35, TE: 0.2 }, blurb: 'Sell the run, go long' },
  punt: { name: 'Punt', kind: 'punt', blurb: 'Flip the field' },
  coffin_punt: { name: 'Coffin Corner', kind: 'punt', aim: 'coffin', blurb: 'Shorter, angled out inside the 10' },
  fake_punt: { name: 'Fake Punt', kind: 'punt', fake: true, blurb: 'Punter takes off, needs surprise' },
  fg: { name: 'Field goal', kind: 'fg', blurb: '' },
  fake_fg: { name: 'Fake FG', kind: 'fg', fake: true, blurb: 'Holder throws to the tight end' },
  // Clock plays, the try after a touchdown and the kickoff choices (the run and pass plays
  // above are the two-point plays).
  spike: { name: 'Spike', kind: 'spike', blurb: 'Stop the clock, give up a down' },
  kneel: { name: 'Kneel', kind: 'kneel', blurb: 'Take a knee and let the clock run' },
  xp: { name: 'Extra point', kind: 'xp', blurb: 'Kick it for one' },
  kick_deep: { name: 'Kick deep', kind: 'kickoff', blurb: 'Boot it to the end zone' },
  onside: { name: 'Onside kick', kind: 'kickoff', onside: true, blurb: 'Kick it short and try to get it back' },
  // After a flag, the side it was against takes the penalty or the play.
  accept: { name: 'Accept', kind: 'penalty', blurb: 'Take the penalty' },
  decline: { name: 'Decline', kind: 'penalty', blurb: 'Keep the result of the play' },
};

// Defensive calls. `sim` is the original call the fast simulator resolves a newer one as.
export const DEF_PLAYS = {
  base: { name: 'Cover 1', blurb: 'Man across, free safety deep' },
  cover1_robber: { name: 'Cover 1 Robber', sim: 'base', blurb: 'Man, strong safety robs the middle' },
  cover2_man: { name: '2 Man Under', sim: 'man_press', blurb: 'Trail man under two deep halves' },
  man_press: { name: 'Press Man', blurb: 'Jam at the line, man across' },
  goal_line: { name: 'Goal Line', blurb: 'Stack the box' },
  cover2: { name: 'Cover 2', blurb: 'Two deep halves, five under' },
  tampa2: { name: 'Tampa 2', sim: 'cover2', blurb: 'Cover 2, Mike runs the deep middle' },
  cover3: { name: 'Cover 3', blurb: 'Three deep thirds, four under' },
  cover4: { name: 'Cover 4', sim: 'cover3', blurb: 'Quarters, four deep' },
  prevent: { name: 'Prevent', blurb: 'Give up short, stop long' },
  run_blitz: { name: 'Mike Blitz', blurb: 'Middle linebacker hits the A gap' },
  pass_blitz: { name: 'LB Dogs', blurb: 'Both linebackers rush' },
  mug: { name: 'Double A Mug', sim: 'pass_blitz', blurb: 'Linebackers walk up in the A gaps' },
  nickel_blitz: { name: 'Nickel Blitz', sim: 'pass_blitz', blurb: 'Slot corner off the edge' },
  fire_zone: { name: 'Fire Zone', sim: 'cover3', blurb: 'Zone blitz, end drops to the flat' },
  cover0: { name: 'Cover 0', sim: 'pass_blitz', blurb: 'Send six, no help deep' },
};
// The original call the fast simulator (and its tables) resolves a play as.
export const simOff = (call) => OFF_PLAYS[call]?.sim ?? call;
export const simDef = (call) => DEF_PLAYS[call]?.sim ?? call;

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
// The base completion and run numbers sit a little low to offset the scoring that the parity
// swings (parity.js) add, so a league still averages about 23 points a team.
const SEP_OFFSET = 13.5;
const BASE_CMP = { screen: 0.83, short: 0.71, mid: 0.59, deep: 0.37 };

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
const emptyTeamStats = () => ({ plays: 0, yds: 0, passYds: 0, rushYds: 0, fd: 0, to: 0, top: 0, third: [0, 0], sacks: 0, pen: 0, penYds: 0 });

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

export function createGame({ home, away, seed = Date.now(), playoff = false, weather = null, neutral = false }) {
  const g = {
    seed, rng: seed >>> 0 || 1, playoff, neutral, form: formFor(seed),
    teams: [makeSide(home), makeSide(away)],
    score: [0, 0], qs: [[0, 0, 0, 0], [0, 0, 0, 0]], quarter: 1, clock: 900,
    poss: 0, spot: 25, down: 1, toGo: 10, phase: 'play', final: false, winner: null,
    playNo: 0, ghostUsed: {}, log: [], drives: [], drive: null, lastPlay: null,
    weather: weather ?? 'clear', firstReceiver: 0,
    // Clock rules: timeouts left per side this half, whether the clock is running into the
    // next snap, the two-minute warnings given, and the sides whose try and kickoff choices
    // wait for a call (the user's team; every other side's are made by the AI on the spot).
    timeouts: [3, 3], clockRunning: false, warned: {}, manual: [false, false],
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
  if (g.weather === 'sand') { if (w.immune.some((t) => p.types.includes(t))) m *= 1 + PARITY.sandImmune; }
  else if (w.boost && p.types.includes(w.boost)) m *= 1 + PARITY.weather;
  if (w.nerf && p.types.includes(w.nerf)) m *= 1 - PARITY.weather;
  // Parity: the side's form for the day, home field, and easing off with a big second-half lead.
  m *= 1 + (g.form?.[ti] ?? 0) + (ti === 0 && !g.neutral ? PARITY.home : 0);
  const lead = g.score[ti] - g.score[1 - ti];
  if (g.quarter >= 3 && lead > PARITY.coastFrom) m *= 1 - Math.min(PARITY.coastMax, (lead - PARITY.coastFrom) * PARITY.coastPerPoint);
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
  // base: the same rep with no type matchup, so a caller can tell when the types decided it.
  return { diff: aVal * am.mod - dVal * dm.mod, base: aVal - dVal, aSE: am.mult > 1, dSE: dm.mult > 1, aMod: am.mod, dMod: dm.mod };
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
  if (g.phase === 'pat') return 'Try';
  if (g.phase === 'kickoff') return 'Kickoff';
  if (g.phase === 'penalty') return 'Flag';
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
// The team's kicker or punter: the one at that slot, or (an older roster without one) whoever
// on the roster has the best rating there.
export function specialist(g, ti, slot) {
  const t = g.teams[ti];
  if (t.lineup[slot] != null) return t.lineup[slot];
  const pool = [...Object.values(t.lineup), ...(t.bench ?? [])].filter((id) => id != null && PLAYERS[id]);
  return pool.sort((a, b) => PLAYERS[b].ovr[slot] - PLAYERS[a].ovr[slot])[0] ?? null;
}
const kick = (g, ti, slot, attr) => eff(g, ti, specialist(g, ti, slot), attr);
// The distance a kick plays like for this kicker: accuracy moves the whole curve, leg power
// adds range on the long ones.
function kickerDistance(g, ti, dist) {
  const pw = kick(g, ti, 'K', 'kpw'), ac = kick(g, ti, 'K', 'kac');
  return dist - (ac - 60) * 0.18 - Math.max(0, dist - 40) * (pw - 60) * 0.012;
}
export function fgOdds(g) { return fgChance(kickerDistance(g, g.poss, fgDistance(g))); }
const XP_DISTANCE = 33;
export function xpOdds(g) { return Math.min(0.995, fgChance(kickerDistance(g, g.poss, XP_DISTANCE)) + 0.02); }

// A kickoff (or the free kick after a safety). A side whose choices wait for a call gets the
// kickoff call (deep or onside); the AI decides on the spot for everyone else.
function kickoff(g, kicker, freeKick = false) {
  g.clockRunning = false;
  // A game played on the live field (g.liveKicks) waits for every kickoff, so the screen can
  // play it out; the fast simulator kicks at once.
  if ((g.manual?.[kicker] || g.liveKicks) && !g.final) {
    g.phase = 'kickoff'; g.kick = { kicker, free: freeKick };
    g.poss = kicker; g.spot = freeKick ? 20 : 35; g.down = 1; g.toGo = 10;
    return null;
  }
  return doKickoff(g, kicker, freeKick, onsideLean(g, kicker) || chance(g, surpriseOnside(g, kicker)));
}

// The kicking team goes onside when it is behind late and needs the ball back.
export function onsideLean(g, kicker) {
  const lead = g.score[kicker] - g.score[1 - kicker];
  return g.quarter >= 4 && lead < 0 && lead >= -16 && g.clock <= (lead < -8 ? 300 : 180);
}
// Once in a long while, a surprise onside kick when it is not expected (never with a lead late).
function surpriseOnside(g, kicker) {
  const lead = g.score[kicker] - g.score[1 - kicker];
  return g.quarter >= 4 && lead > 0 ? 0 : 0.006;
}

// How often the kicking team gets an onside kick back: the receiving team brings its hands
// team when it sees it coming (late and behind); a surprise works far more often. The kicker's
// touch decides how well it bounces.
export function onsideOdds(g, kicker) {
  const ac = kick(g, kicker, 'K', 'kac');
  return clamp((onsideLean(g, kicker) ? 0.12 : 0.45) + (ac - 60) * 0.003, 0.04, 0.6);
}

function doKickoff(g, kicker, freeKick, onside, live = null, seconds = 0) {
  const rec = 1 - kicker;
  const leg = kick(g, kicker, 'K', 'kpw');
  if (live) return liveKickoff(g, kicker, freeKick, live, seconds);
  g.kick = null;
  g.phase = 'play'; g.down = 1; g.toGo = 10;
  g.clockRunning = false;
  let text;
  if (onside) {
    const p = onsideOdds(g, kicker);
    const at = (freeKick ? 20 : 35) + between(g, 10, 14);
    g.clock = Math.max(0, g.clock - 4);
    const K = specialist(g, kicker, 'K');
    if (chance(g, p)) {
      g.poss = kicker; g.spot = at;
      text = `${K != null ? nm(K) : g.teams[kicker].name} kicks it onside... and ${g.teams[kicker].name} RECOVER at the ${spotText(g)}!`;
    } else {
      g.poss = rec; g.spot = 100 - at;
      text = `${g.teams[kicker].name} try an onside kick. ${g.teams[rec].name} recover at the ${spotText(g)}.`;
    }
    g.toGo = Math.min(10, 100 - g.spot);
    const e = addLog(g, { kind: 'kick', text, head: g.poss === kicker ? 'Onside recovered' : 'Onside kick', highlight: g.poss === kicker ? 'turnover' : null, ball: absSpot(g.poss, g.spot) });
    startDrive(g);
    return e;
  }
  g.poss = rec;
  if (!freeKick && chance(g, clamp(0.62 + (leg - 60) * 0.008, 0.25, 0.92))) {
    g.spot = 25;
    text = `${g.teams[kicker].name} kick off. Touchback.`;
  } else if (chance(g, 0.004)) {
    g.spot = 100;
    text = `${g.teams[kicker].name} kick off and ${g.teams[rec].name} return it all the way!`;
  } else {
    g.spot = Math.round(clamp((freeKick ? 32 : 23) - (leg - 60) * 0.08 + 7 * randn(g), 5, 50));
    g.clock = Math.max(0, g.clock - 6);
    text = `${g.teams[kicker].name} kick off. Returned to the ${spotText(g)}.`;
  }
  const e = addLog(g, { kind: 'kick', text, head: 'Kickoff', ball: absSpot(g.poss, g.spot) });
  if (g.spot >= 100) { scoreTD(g, rec, null); return e; }
  startDrive(g);
  return e;
}

// A kickoff played out on the live field (live/kicks.js): live.endX is where the ball ended up,
// in yards from the kicking team's line.
function liveKickoff(g, kicker, freeKick, live, seconds) {
  const rec = 1 - kicker, from = freeKick ? 20 : 35;
  const K = specialist(g, kicker, 'K'), knm = K != null ? nm(K) : g.teams[kicker].name;
  const rnm = live.returner != null ? nm(live.returner) : g.teams[rec].name;
  g.kick = null;
  g.phase = 'play'; g.down = 1; g.toGo = 10;
  g.clockRunning = false;
  const run = live.how === 'touchback' || live.onside ? 0 : clamp(Math.round(seconds), 2, 15);
  g.clock = Math.max(0, g.clock - run);
  g.teams[rec].team.top += run;
  let text, head = 'Kickoff', highlight = null;
  if (live.onside) {
    const kept = live.rec === 'kick';
    g.poss = kept ? kicker : rec;
    const at = clamp(from + (live.endX ?? 10), 1, 99);
    g.spot = kept ? at : 100 - at;
    text = kept ? `${knm} kicks it onside... and ${g.teams[kicker].name} RECOVER at the ${spotText(g)}!`
      : `${g.teams[kicker].name} try an onside kick. ${g.teams[rec].name} recover at the ${spotText(g)}.`;
    head = kept ? 'Onside recovered' : 'Onside kick';
    if (kept) highlight = 'turnover';
  } else if (live.how === 'touchback') {
    g.poss = rec; g.spot = 25;
    text = `${knm} kicks off into the end zone. Touchback.`;
  } else if (live.how === 'td') {
    g.poss = rec; g.spot = 100;
    text = `${knm} kicks off. ${rnm} returns it all the way for a TOUCHDOWN!`;
    head = 'Kickoff return touchdown'; highlight = 'td';
  } else if (live.how === 'out' && live.ret == null) {
    // Out of bounds before anyone touched it: the receiving team takes it at its 40.
    g.poss = rec; g.spot = 40;
    text = `${knm}'s kickoff goes out of bounds. ${g.teams[rec].name} take over at the ${spotText(g)}.`;
  } else {
    g.poss = rec; g.spot = clamp(100 - (from + (live.endX ?? 65)), 1, 99);
    const ret = live.ret ?? 0;
    text = `${knm} kicks off. ${rnm} returns it ${ret} yard${ret === 1 ? '' : 's'} to the ${spotText(g)}${live.tackler != null ? `, tackled by ${nm(live.tackler)}` : live.how === 'out' ? ', out of bounds' : ''}.`;
    if (ret >= 35) highlight = 'big';
  }
  g.toGo = Math.min(10, 100 - g.spot);
  const e = addLog(g, { kind: 'kick', text, head, highlight, ball: absSpot(g.poss, g.spot) });
  if (g.spot >= 100) { scoreTD(g, rec, live.returner); return e; }
  startDrive(g);
  return e;
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

// A touchdown: six points, then the try. A side whose choices wait for a call gets the try
// call (the extra point, or any run or pass from the 2 for two); the AI tries it on the spot.
function scoreTD(g, ti, scorer) {
  addScore(g, ti, 6);
  endDrive(g, 'Touchdown');
  if (otOver(g)) return;
  g.phase = 'pat'; g.poss = ti; g.spot = 98; g.down = 1; g.toGo = 2; g.clockRunning = false;
  // A two-point play does not count in anyone's stats: they are put back as they were.
  g.patStats = g.teams.map((t) => structuredClone({ stats: t.stats, team: t.team }));
  if (!g.manual?.[ti] && !g.liveKicks) convert(g, aiConvertCall(g), aiDefenseCall(g));
}

// The try after a touchdown. live: a two-point play's result from the live field.
function convert(g, offCall, defCall, live = null, kickLive = null) {
  const o = g.poss, d = 1 - o;
  const play = OFF_PLAYS[offCall];
  let good, text, pts;
  const base = { kind: 'play', off: offCall, def: defCall, team: o, spotBefore: g.spot, from: absSpot(o, g.spot), yards: 0, conversion: true };
  if (!live && !['run', 'pass'].includes(play?.kind)) {
    const K = specialist(g, o, 'K');
    // Played on the live field, the kick says whether it went through (or was blocked).
    good = kickLive ? kickLive.how === 'good' : chance(g, xpOdds(g));
    pts = 1;
    if (K != null) { const s = st(g, o, K); s.xpa = (s.xpa ?? 0) + 1; if (good) s.xpm = (s.xpm ?? 0) + 1; }
    const blocked = kickLive?.how === 'blocked';
    text = `${K != null ? `${nm(K)}'s extra point` : 'The extra point'} is ${good ? 'good' : blocked ? `BLOCKED${kickLive.blocker != null ? ` by ${nm(kickLive.blocker)}` : ''}` : 'NO GOOD'}.`;
    base.off = 'xp';
  } else {
    const r = live ?? (play.kind === 'run' ? doRun(g, simOff(offCall), simDef(defCall), play.qb === true || (play.qb > 0 && chance(g, play.qb)))
      : doPass(g, simOff(offCall), simDef(defCall)));
    good = !r.turnover && g.spot + (r.yards ?? 0) >= 100;
    pts = 2;
    base.carrier = r.carrier; base.yards = r.yards ?? 0;
    text = `Two-point try: ${r.text.replace(/ (Tackled by [^.]*\.|TOUCHDOWN!)/, '')} ${good ? 'The conversion is GOOD!' : 'No good.'}`;
  }
  if (g.patStats) {
    g.patStats.forEach((p, i) => { g.teams[i].stats = p.stats; g.teams[i].team = p.team; });
    g.patStats = null;
  }
  if (good) addScore(g, o, pts);
  const head = pts === 1 ? (good ? 'Extra point' : 'Extra point no good') : good ? 'Two-point conversion' : 'Two-point try fails';
  const e = addLog(g, { ...base, kind: 'score', head, highlight: good ? (pts === 2 ? 'td' : null) : 'miss', text: `${text} ${scoreLine(g)}`, to: absSpot(o, good ? 100 : g.spot) });
  g.phase = 'play';
  afterScore(g, o);
  return e;
}

// After a try or a field goal: the kickoff, or the end of the quarter when the score came
// with no time left (the try is played even then).
function afterScore(g, kicker, freeKick = false) {
  g.clockRunning = false;
  if (otOver(g)) return;
  if (g.clock <= 0 && !g.final) {
    const half = g.quarter === 2 || g.quarter >= 4;
    endQuarter(g);
    if (half) return;
  }
  kickoff(g, kicker, freeKick);
}

// Go for two late in the game when the chart says so: down 2, 5, 9, 10, 12 or 13, or up 1,
// 4, 5 or 12 (the lead after the touchdown, before the try).
export function convertLean(g) {
  const o = g.poss, lead = g.score[o] - g.score[1 - o];
  if (g.quarter < 4) return 'xp';
  return [-2, -5, -9, -10, -12, -13, 1, 4, 5, 12].includes(lead) ? 'two' : 'xp';
}
function aiConvertCall(g) {
  if (convertLean(g) === 'xp') return 'xp';
  return chance(g, 0.55) ? pickWeighted(g, passWeights(g)) : pickWeighted(g, runWeights(g));
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

// ---------- the clock ----------
// The clock between plays: after a play that keeps it running, the next snap comes after a
// runoff that depends on the offense's tempo (no huddle, normal, or bleeding the play clock).
// A timeout before the snap saves that runoff; the two-minute warning stops it at 2:00.
export const TEMPOS = [['auto', 'Auto'], ['hurry', 'No huddle'], ['normal', 'Huddle'], ['milk', 'Bleed it']];

// Fill in the clock fields on a game saved before they existed.
function clockFields(g) {
  g.timeouts ??= [3, 3]; g.warned ??= {}; g.clockRunning ??= false; g.manual ??= [false, false]; g.phase ??= 'play';
}
const lateHalf = (g) => g.quarter === 2 || g.quarter >= 4;
// Out of bounds stops the clock until the snap only in the last two minutes of the first half
// and the last five of the second; otherwise it starts again when the ball is spotted.
export const oobStops = (g) => (g.quarter === 2 && g.clock <= 120) || (g.quarter >= 4 && g.clock <= 300);

// The tempo the AI's offense plays at: no huddle when it needs points before the half or the
// game runs out, bleeding the clock with a lead late, a normal huddle otherwise.
export function aiTempo(g) {
  const o = g.poss, lead = g.score[o] - g.score[1 - o];
  if (g.quarter === 2 && g.clock <= 120 && g.spot >= 20) return 'hurry';
  if (g.quarter >= 4 && lead <= 0 && (g.clock <= 150 || (lead < -8 && g.clock <= 420))) return 'hurry';
  if (g.quarter >= 4 && lead > 0 && g.clock <= 360) return 'milk';
  return 'normal';
}
// Seconds between the whistle and the snap at a tempo; a spike or a hurried field goal unit
// needs only a few.
function runoff(g, tempo, call) {
  const kind = OFF_PLAYS[call]?.kind;
  if (kind === 'spike') return between(g, 3, 6);
  if (kind === 'fg' && tempo === 'hurry') return between(g, 6, 10);
  if (kind === 'kneel' || tempo === 'milk') return between(g, 38, 40);
  return tempo === 'hurry' ? between(g, 7, 13) : between(g, 32, 40);
}

// Time runs off between the last play and this snap. Returns false when the quarter ran out
// first (the call is never played; the next call is made in the new situation).
export function snapClock(g, tempo = null, call = null) {
  clockFields(g);
  g.ranIntoSnap = false;
  if (g.final || g.phase !== 'play' || !g.clockRunning) return true;
  g.clockRunning = false; g.ranIntoSnap = true;
  const t = tempo && tempo !== 'auto' ? tempo : aiTempo(g);
  let run = runoff(g, t, call);
  const q = g.quarter;
  if (lateHalf(g) && q <= 4 && !g.warned[q] && g.clock > 120 && g.clock - run <= 120) {
    g.teams[g.poss].team.top += g.clock - 120;
    g.clock = 120; g.warned[q] = true;
    addLog(g, { kind: 'info', head: 'Two-minute warning', text: 'Two-minute warning.' });
    return true;
  }
  if (run >= g.clock) {
    g.teams[g.poss].team.top += g.clock;
    g.clock = 0;
    endQuarter(g);
    return false;
  }
  g.clock -= run;
  g.teams[g.poss].team.top += run;
  return true;
}

// A timeout: stops the clock before the next snap and gives everyone a short breather.
export function callTimeout(g, ti) {
  clockFields(g);
  if (g.final || g.phase !== 'play' || g.timeouts[ti] <= 0) return false;
  g.timeouts[ti]--;
  const saved = g.clockRunning;
  g.clockRunning = false;
  const t = g.teams[ti];
  for (const id of t.roster) t.energy[id] = Math.min(100, (t.energy[id] ?? 100) + 3);
  const left = g.timeouts[ti];
  addLog(g, { kind: 'timeout', team: ti, head: 'Timeout', text: `Timeout, ${t.name}. ${left === 0 ? 'No timeouts left' : `${left} left`}${g.quarter >= 5 ? '' : ' in the half'}.${saved ? ` The clock stops at ${clockText(g.clock)}.` : ''}` });
  return true;
}

// The AI's clock management before a snap, for each side it coaches: the offense stops a
// running clock when it needs points before the half or the game ends; a defense that is
// behind late stops it to get the ball back with time left.
export function aiTimeouts(g) {
  clockFields(g);
  if (g.final || g.phase !== 'play' || !g.clockRunning) return null;
  const o = g.poss, d = 1 - o;
  const lead = g.score[o] - g.score[d];
  const want = (ti) => {
    if (g.manual[ti] || g.timeouts[ti] <= 0) return false;
    if (ti === o) {
      if (g.quarter === 2) return g.clock <= (g.spot >= 50 ? 90 : 45) && g.spot >= 30;
      if (g.quarter >= 4) return lead <= 0 && g.clock <= 150;
      return false;
    }
    // A defense down by up to two scores, with the offense running clock.
    return g.quarter >= 4 && lead > 0 && lead <= 16 && g.clock <= 240 && !(g.quarter >= 5 && !g.playoff && lead > 0 && g.clock < 20);
  };
  for (const ti of [o, d]) if (want(ti) && callTimeout(g, ti)) return ti;
  return null;
}

// Can the offense run out the clock by kneeling? Each kneel takes a couple of seconds and then
// the full play clock, unless the defense stops it with a timeout.
export function canKneelOut(g) {
  const o = g.poss, lead = g.score[o] - g.score[1 - o];
  if (lead <= 0 || g.spot <= 3 || g.phase !== 'play') return false;
  const downs = 5 - g.down;
  const stops = Math.min(downs, g.timeouts?.[1 - o] ?? 0);
  const burn = downs * 2 + (downs - stops) * 38 + (g.clockRunning ? 36 : 0);
  return g.quarter >= 4 && g.clock <= burn;
}

// ---------- the play ----------
export function runPlay(g, offCall, defCall) {
  if (g.final) return null;
  clockFields(g);
  if (g.phase === 'pat') { g.playNo++; return convert(g, offCall, defCall); }
  if (g.phase === 'kickoff') {
    const k = g.kick ?? { kicker: g.poss, free: false };
    g.playNo++;
    return doKickoff(g, k.kicker, k.free, !!OFF_PLAYS[offCall]?.onside);
  }
  if (g.phase === 'penalty') return decidePenalty(g, offCall === 'accept' || (offCall !== 'decline' && !!g.pending?.aiAccept));
  if (g.clockRunning && !snapClock(g, null, offCall)) return null;
  const play = OFF_PLAYS[offCall];
  g.playNo++;
  // Runs and passes can draw a flag: before the snap (no play), or during it.
  if (play.kind === 'run' || play.kind === 'pass') {
    const pre = preSnapFoul(g);
    const base0 = { kind: 'play', off: offCall, def: defCall, down: g.down, toGo: g.toGo, spotBefore: g.spot, from: absSpot(g.poss, g.spot), team: g.poss, yards: 0 };
    if (pre) return finishPlay(g, { kind: 'none', noPlay: true, yards: 0, fouls: [pre], text: '' }, base0, offCall, defCall, 0);
  }
  const statSnap = play.kind === 'run' || play.kind === 'pass' ? snapStats(g) : null;
  const base = { kind: 'play', off: offCall, def: defCall, down: g.down, toGo: g.toGo, spotBefore: g.spot,
    from: absSpot(g.poss, g.spot), team: g.poss, yards: 0 };
  let r;
  if (play.kind === 'punt') r = doPunt(g, base);
  else if (play.kind === 'fg') r = doFieldGoal(g, base);
  else if (play.kind === 'spike' || play.kind === 'kneel') r = clockPlay(g, play.kind);
  else if (play.kind === 'run') r = doRun(g, simOff(offCall), simDef(defCall), play.qb === true || (play.qb > 0 && chance(g, play.qb)));
  else if (play.kind === 'pass') r = doPass(g, simOff(offCall), simDef(defCall));
  else r = clockPlay(g, 'spike');
  const secs = play.kind === 'spike' ? 1 : play.kind === 'kneel' ? 2 : between(g, 4, 8);
  if (statSnap && !r.special) { const fouls = simFouls(g, r); if (fouls.length) { r.fouls = fouls; r.statSnap = statSnap; } }
  return finishPlay(g, r, base, offCall, defCall, secs);
}

// A spike (an incomplete pass into the ground) or a kneel (a yard lost, the clock running).
function clockPlay(g, kind) {
  const o = g.poss, qb = g.teams[o].lineup.QB;
  const s = st(g, o, qb);
  if (kind === 'spike') {
    s.pa++;
    return { kind: 'pass', yards: 0, carrier: qb, qb, text: `${nm(qb)} spikes the ball to stop the clock.`, clockStop: true, head: 'Spike' };
  }
  const yards = -Math.min(1, g.spot - 1);
  s.ra++; s.ry += yards;
  return { kind: 'run', yards, carrier: qb, text: `${nm(qb)} takes a knee.`, head: 'Kneel' };
}

// A run or pass played out on the live field: live.js decides what happened and keeps the
// player stats; this applies it to the down, distance, score and clock like any other play.
export function runLivePlay(g, offCall, defCall, r, seconds) {
  if (g.final) return null;
  clockFields(g);
  g.playNo++;
  if (g.phase === 'pat') {
    if (r.liveKick) return convert(g, 'xp', defCall, null, r);
    return convert(g, offCall, defCall, r.noPlay ? { kind: 'pass', yards: 0, text: 'The snap is fumbled.', turnover: null } : r);
  }
  if (g.phase === 'kickoff') {
    const k = g.kick ?? { kicker: g.poss, free: false };
    return doKickoff(g, k.kicker, k.free, !!OFF_PLAYS[offCall]?.onside, r, seconds);
  }
  if (r.liveKick) {
    // A punt or field goal played on the field: the kick's own outcome, then the usual bookkeeping.
    const kb = { kind: 'play', off: offCall, def: defCall, down: g.down, toGo: g.toGo, spotBefore: g.spot, from: absSpot(g.poss, g.spot), team: g.poss, yards: 0 };
    const k = r.kind === 'punt' ? doPunt(g, kb, r) : doFieldGoal(g, kb, r);
    return finishPlay(g, k, kb, offCall, defCall, clamp(Math.round(seconds), 2, 20));
  }
  const base = { spotBefore: g.spot };
  return finishPlay(g, r, base, offCall, defCall, r.noPlay ? 0 : clamp(Math.round(seconds), 2, 20));
}

function finishPlay(g, r, base, offCall, defCall, playSecs) {
  const o = g.poss;
  const play = OFF_PLAYS[offCall];
  const before = { spot: base.spotBefore, down: g.down, toGo: g.toGo, poss: o };
  if (r.special) { before.down = base.down; before.toGo = base.toGo; }
  const ctx = { o, q: g.quarter, clockBefore: g.clock, offCall, defCall };

  // The play's own seconds. Whether the clock keeps running into the next snap: an
  // incompletion, a score, a change of possession and (late in a half) going out of bounds
  // stop it.
  const elapsed = r.noPlay ? 0 : Math.min(playSecs, g.clock);
  g.clock -= elapsed;
  g.teams[o].team.top += elapsed;
  ctx.stopped = r.oob ? oobStops(g) : !!r.clockStop;
  if (!r.noPlay && (play.kind === 'run' || play.kind === 'pass')) applyFatigue(g);

  if (r.fouls?.length && !r.special) return flagged(g, r, before, ctx);
  const entry = resolve(g, r, before, offCall, defCall);
  if (entry && r.oob && !r.special) entry.oob = true;
  return afterPlay(g, entry, ctx);
}

// After the result is applied: whether the clock runs into the next snap, the two-minute
// warning when the play ran past 2:00, and the end of the quarter.
function afterPlay(g, entry, ctx, untimed = false) {
  const { o, q, clockBefore } = ctx;
  g.lastPlay = entry;
  g.clockRunning = !ctx.stopped && g.poss === o && g.phase === 'play' && g.quarter === q && !g.final;
  if (lateHalf(g) && q <= 4 && g.quarter === q && !g.warned[q] && clockBefore > 120 && g.clock <= 120 && g.clock > 0) {
    g.warned[q] = true; g.clockRunning = false;
    addLog(g, { kind: 'info', head: 'Two-minute warning', text: 'Two-minute warning.' });
  }
  // A half never ends on an accepted defensive foul: the offense gets one untimed down.
  if (untimed && g.clock <= 0) { g.clockRunning = false; return entry; }
  g.ranIntoSnap = false;
  if (g.clock <= 0 && !g.final && g.phase !== 'pat' && g.phase !== 'penalty' && g.quarter === q) endQuarter(g);
  return entry;
}

// ---------- penalties ----------
// A flag on the play. A foul before the snap kills the play and is enforced; one during it is
// accepted or declined by the side it was against: the AI picks whichever leaves it better off,
// the user's side gets the choice (the game waits in the 'penalty' phase).
function flagged(g, r, before, ctx) {
  const o = ctx.o;
  const fouls = r.fouls;
  const f = fouls[0];
  const T = (ti) => g.teams[ti].team;
  if (r.noPlay) {
    const acc = enforce(before, f);
    T(f.team).pen = (T(f.team).pen ?? 0) + 1; T(f.team).penYds = (T(f.team).penYds ?? 0) + Math.abs(acc.moved);
    if (acc.first) T(o).fd++;
    Object.assign(g, { spot: acc.spot, down: acc.down, toGo: acc.toGo });
    const e = addLog(g, { kind: 'penalty', head: PENALTIES[f.type].name, highlight: 'flag', team: o, down: before.down, toGo: before.toGo, spotBefore: before.spot,
      from: absSpot(o, before.spot), to: absSpot(o, acc.spot), yards: 0, foul: f, text: announce(g, f, acc, before) });
    // The clock starts again on the ready signal if it was running (not late in a half).
    ctx.stopped = !g.ranIntoSnap || oobStops(g);
    return afterPlay(g, e, ctx);
  }
  // Fouls by both sides offset: the down is played again.
  if (fouls.some((x) => x.team !== f.team)) {
    restoreStats(g, r.statSnap);
    const e = addLog(g, { kind: 'penalty', head: 'Offsetting penalties', highlight: 'flag', team: o, down: before.down, toGo: before.toGo, spotBefore: before.spot,
      from: absSpot(o, before.spot), to: absSpot(o, before.spot), yards: 0, text: `Flags on both teams: ${fouls.map((x) => PENALTIES[x.type].name.toLowerCase()).join(' and ')}. Offsetting penalties, replay ${['', '1st', '2nd', '3rd', '4th'][before.down]} down.` });
    ctx.stopped = true;
    return afterPlay(g, e, ctx);
  }
  const offended = 1 - f.team;
  const acc = enforce(before, f);
  // What declining leaves: the play's own result, worked out on a copy of the game.
  const dg = structuredClone(g);
  resolve(dg, r, before, ctx.offCall, ctx.defCall);
  const accState = { score: g.score, poss: o, spot: acc.spot, down: acc.down, toGo: acc.toGo, phase: 'play' };
  const aiAccept = stateValue(accState, offended) >= stateValue(dg, offended);
  const ord = ['', '1st', '2nd', '3rd', '4th'];
  const P = { foul: f, r, before, ctx, acc, offended, aiAccept,
    acceptText: `${g.teams[o].abbr} ${ord[acc.down]} & ${acc.spot + acc.toGo >= 100 ? 'Goal' : acc.toGo} at ${spotText(g, acc.spot, o)}`,
    declineText: outcomeText(g, dg, before) };
  if (g.manual?.[offended]) {
    g.phase = 'penalty'; g.pending = P;
    const e = addLog(g, { kind: 'penalty', head: `Flag: ${PENALTIES[f.type].name}`, highlight: 'flag', team: o, down: before.down, toGo: before.toGo, spotBefore: before.spot,
      from: absSpot(o, before.spot), to: absSpot(o, before.spot + (r.yards ?? 0)), yards: r.yards ?? 0, foul: f, pendingFlag: true,
      text: `${r.text} ${announce(g, f, acc, before).replace(/ [^.]*\.$/, '')} ${g.teams[offended].name} to decide.` });
    g.lastPlay = e; P.text = e.text;
    return e;
  }
  return applyPenalty(g, P, aiAccept);
}

// The declined result in a few words: the next down, a score or a change of possession.
function outcomeText(g, dg, before) {
  const o = before.poss;
  if (dg.score[o] > g.score[o]) return `${g.teams[o].abbr} score (${dg.score[o] - g.score[o]} points)`;
  if (dg.score[1 - o] > g.score[1 - o]) return `${g.teams[1 - o].abbr} score (${dg.score[1 - o] - g.score[1 - o]} points)`;
  if (dg.poss !== o) return `${g.teams[dg.poss].abbr} ball at ${spotText(dg)}`;
  return `${g.teams[o].abbr} ${downText(dg)} at ${spotText(dg)}`;
}

// The side the foul was against takes the penalty (accept) or the play (decline).
export function decidePenalty(g, accept) {
  const P = g.pending;
  if (g.phase !== 'penalty' || !P) return null;
  g.phase = 'play'; g.pending = null;
  return applyPenalty(g, P, accept);
}

function applyPenalty(g, P, accept) {
  const { foul: f, r, before, ctx, acc } = P;
  const o = ctx.o;
  const name = PENALTIES[f.type].name;
  if (!accept) {
    const e = resolve(g, r, before, ctx.offCall, ctx.defCall);
    if (e && r.oob) e.oob = true;
    addLog(g, { kind: 'penalty', head: 'Penalty declined', team: o, foul: f, text: `${name} on ${g.teams[f.team].name} (${nm(f.player)}), declined.` });
    return afterPlay(g, e, ctx);
  }
  // Accepted: the play does not count (its stats come off), the yards are walked off.
  restoreStats(g, r.statSnap);
  const T = g.teams[f.team].team;
  T.pen = (T.pen ?? 0) + 1; T.penYds = (T.penYds ?? 0) + Math.abs(acc.moved);
  if (acc.first) g.teams[o].team.fd++;
  if (f.player != null) { const s = st(g, f.team, f.player); s.pen = (s.pen ?? 0) + 1; }
  if (g.drive) g.drive.plays++;
  Object.assign(g, { spot: acc.spot, down: acc.down, toGo: acc.toGo });
  const e = addLog(g, { kind: 'penalty', head: name, highlight: 'flag', team: o, off: ctx.offCall, def: ctx.defCall, down: before.down, toGo: before.toGo,
    spotBefore: before.spot, from: absSpot(o, before.spot), to: absSpot(o, acc.spot), yards: 0, foul: f, text: announce(g, f, acc, before) });
  // The clock starts again on the ready signal, except late in a half or after a play that
  // would have stopped it anyway.
  ctx.stopped = ctx.stopped || oobStops(g);
  return afterPlay(g, e, ctx, PENALTIES[f.type].side === 'def');
}

// Stats as they were at the snap, for a play that does not count.
export function snapStats(g) {
  return g.teams.map((t) => ({ stats: Object.fromEntries(Object.entries(t.stats).map(([k, v]) => [k, { ...v }])), team: { ...t.team, third: [...t.team.third] } }));
}
function restoreStats(g, snap) {
  if (!snap) return;
  snap.forEach((p, i) => { g.teams[i].stats = p.stats; g.teams[i].team = { ...p.team, top: g.teams[i].team.top }; });
}

function resolve(g, r, before, offCall, defCall) {
  const o = before.poss, d = 1 - o;
  const T = g.teams[o].team;
  const base = { kind: 'play', off: offCall, def: defCall, down: before.down, toGo: before.toGo, spotBefore: before.spot,
    from: absSpot(o, before.spot), carrier: r.carrier, team: o, highlight: r.highlight ?? null, yards: r.yards ?? 0, se: r.se ?? false, ...(r.head ? { head: r.head } : {}) };
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
    afterScore(g, o, true);
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
  const head = q === 2 ? 'Halftime' : q === 4 ? 'End of regulation' : q > 4 ? 'End of overtime' : `End of the ${['1st', '2nd', '3rd'][q - 1]} quarter`;
  addLog(g, { kind: 'quarter', head, text: `End of ${q <= 4 ? `quarter ${q}` : 'overtime'}. ${scoreLine(g)}` });
  if (q === 2) {
    endDrive(g, 'Half');
    g.quarter = 3; g.clock = 900; g.timeouts = [3, 3]; g.clockRunning = false;
    for (const t of g.teams) for (const id of t.roster) t.energy[id] = Math.min(100, t.energy[id] + 30);
    addLog(g, { kind: 'info', text: 'Halftime. Everyone gets a breather.' });
    kickoff(g, g.firstReceiver);
    return;
  }
  if (q === 1 || q === 3) { g.quarter++; g.clock = 900; g.clockRunning = false; return; }
  // End of regulation or an overtime period
  if (g.score[0] !== g.score[1] || (q >= 5 && !g.playoff)) { endDrive(g, 'End of game'); finish(g); return; }
  endDrive(g, 'End of regulation');
  g.quarter++; g.clock = 600; g.timeouts = [2, 2]; g.clockRunning = false;
  for (const t of g.teams) for (const id of t.roster) t.energy[id] = Math.min(100, t.energy[id] + 20);
  addLog(g, { kind: 'info', text: 'Overtime. Next score wins.' });
  kickoff(g, chance(g, 0.5) ? 0 : 1);
}

function doPunt(g, base, live = null) {
  const o = g.poss, d = 1 - o;
  const call = OFF_PLAYS[base.off] ?? OFF_PLAYS.punt;
  const P = specialist(g, o, 'P'), pnm = P != null ? nm(P) : g.teams[o].name;
  if (call.fake && !live) return fakeKick(g, base, P, 'punt');
  if (live) return livePunt(g, base, live, pnm);
  endDrive(g, 'Punt');
  const pw = kick(g, o, 'P', 'kpw'), ac = kick(g, o, 'P', 'kac');
  // Net yards from the punter's leg; a coffin-corner kick gives up distance to angle it out
  // short of the goal line, and the punter's accuracy decides how close he gets.
  const room = 100 - g.spot;
  let net, text, highlight = null;
  if (call.aim === 'coffin' && room < 55) {
    const target = room - 6;
    net = Math.round(clamp(target + (6 - (ac - 60) * 0.12) * randn(g) * 0.8, 15, room + 5));
  } else net = Math.round(41 + (pw - 60) * 0.18 + (5.5 - (ac - 60) * 0.03) * randn(g));
  const land = g.spot + net;
  g.poss = d; g.down = 1; g.toGo = 10;
  if (chance(g, 0.005)) {
    g.spot = clamp(100 - (base.spotBefore - 8), 1, 99); g.toGo = Math.min(10, 100 - g.spot);
    text = `${pnm}'s punt is BLOCKED! ${g.teams[d].name} take over at the ${spotText(g)}.`;
    highlight = 'turnover';
  } else if (land >= 100) { g.spot = 20; text = `${pnm} punts into the end zone. Touchback.`; }
  else { g.spot = 100 - land; text = `${pnm} punts ${net} net yards${call.aim === 'coffin' && land >= 90 ? ', out of bounds inside the 10' : ''}. ${g.teams[d].name} take over at the ${spotText(g)}.`; }
  if (P != null) { const s = st(g, o, P); s.punts = (s.punts ?? 0) + 1; s.puntYds = (s.puntYds ?? 0) + net; }
  const entry = addLog(g, { ...base, text, highlight, to: absSpot(g.poss, g.spot) });
  startDrive(g);
  return { special: true, entry, clockStop: true };
}

function doFieldGoal(g, base, live = null) {
  const o = g.poss, d = 1 - o;
  const call = OFF_PLAYS[base.off] ?? OFF_PLAYS.fg;
  const K = specialist(g, o, 'K'), knm = K != null ? nm(K) : 'The';
  if (call.fake && !live) return fakeKick(g, base, K, 'fg');
  const dist = fgDistance(g);
  // Accuracy moves the whole curve; leg power adds range on the long ones.
  const eff = kickerDistance(g, o, dist);
  const s = K != null ? st(g, o, K) : {};
  s.fga = (s.fga ?? 0) + 1;
  if (live ? live.how === 'good' : chance(g, fgChance(eff))) {
    s.fgm = (s.fgm ?? 0) + 1;
    addScore(g, o, 3);
    endDrive(g, 'Field goal');
    const entry = addLog(g, { ...base, kind: 'score', highlight: 'fg', text: `${K != null ? `${knm}'s ` : ''}${dist}-yard field goal is GOOD. ${scoreLine(g)}`, to: absSpot(o, 100) });
    afterScore(g, o);
    return { special: true, entry, clockStop: true };
  }
  endDrive(g, 'Missed FG');
  g.poss = d; g.spot = Math.max(20, 100 - (base.spotBefore - 7)); g.down = 1; g.toGo = 10;
  const blocked = live?.how === 'blocked';
  const entry = addLog(g, { ...base, highlight: 'miss', text: `${K != null ? `${knm}'s ` : ''}${dist}-yard field goal ${blocked ? `is BLOCKED${live.blocker != null ? ` by ${nm(live.blocker)}` : ''}` : 'is NO GOOD'}.`, to: absSpot(o, 100) });
  startDrive(g);
  return { special: true, entry, clockStop: true };
}

// A punt played out on the live field: where it came down and what the return team did with it.
// live.endX is where the ball ended up, in yards downfield from the line of scrimmage.
function livePunt(g, base, live, pnm) {
  const o = g.poss, d = 1 - o;
  const P = live.kicker;
  endDrive(g, 'Punt');
  const rnm = live.returner != null ? nm(live.returner) : g.teams[d].name;
  const gross = live.gross ?? 0;
  g.poss = d; g.down = 1; g.toGo = 10;
  let text, highlight = null, net = gross;
  if (live.how === 'blocked') {
    g.spot = clamp(100 - (base.spotBefore + (live.endX ?? -8)), 1, 99);
    text = `${pnm}'s punt is BLOCKED${live.blocker != null ? ` by ${nm(live.blocker)}` : ''}! ${g.teams[d].name} take over at the ${spotText(g)}.`;
    highlight = 'turnover'; net = 0;
  } else if (live.how === 'td') {
    const ret = live.ret ?? 0;
    const entry = addLog(g, { ...base, kind: 'score', highlight: 'td', text: `${pnm} punts ${gross} yards. ${rnm} returns it ${ret} yards for a TOUCHDOWN!`, to: absSpot(d, 100) });
    if (P != null) { const s = st(g, o, P); s.punts = (s.punts ?? 0) + 1; s.puntYds = (s.puntYds ?? 0) + gross - ret; }
    g.spot = 100;
    scoreTD(g, d, live.returner);
    return { special: true, entry, clockStop: true };
  } else if (live.how === 'touchback') {
    g.spot = 20; net = gross - 20;
    text = `${pnm} punts ${gross} yards into the end zone. Touchback.`;
  } else {
    const endX = live.endX ?? gross;
    net = Math.min(endX, 100 - base.spotBefore);
    g.spot = clamp(100 - (base.spotBefore + endX), 1, 99);
    const what = { fair: `fair catch by ${rnm}`, downed: 'downed by the coverage', out: 'out of bounds' }[live.how]
      ?? `${rnm} returns it ${live.ret ?? 0} yard${live.ret === 1 ? '' : 's'}${live.tackler != null ? `, tackled by ${nm(live.tackler)}` : ''}`;
    text = `${pnm} punts ${gross} yards, ${what}. ${g.teams[d].name} take over at the ${spotText(g)}.`;
    if ((live.ret ?? 0) >= 20) highlight = 'big';
  }
  if (P != null) { const s = st(g, o, P); s.punts = (s.punts ?? 0) + 1; s.puntYds = (s.puntYds ?? 0) + net; }
  const entry = addLog(g, { ...base, text, highlight, to: absSpot(g.poss, g.spot) });
  startDrive(g);
  return { special: true, entry, clockStop: true };
}

// A fake: the punter runs it, or the holder throws to the tight end. It works when the
// defense is not ready for it (more often on a kicking down they expect to be routine), and
// the down and distance still have to be made.
function fakeKick(g, base, kicker, kind) {
  const o = g.poss, d = 1 - o;
  const L = g.teams[o].lineup;
  const surprise = chance(g, 0.55);
  let yards, text, carrier;
  if (kind === 'punt') {
    carrier = kicker ?? L.RB;
    const sp = eff(g, o, carrier, 'spd');
    yards = Math.round((surprise ? 5 + (sp - 60) * 0.08 : -1) + 4 * randn(g));
    text = `Fake punt! ${nm(carrier)} takes off ${yards > 0 ? `for ${yards} yard${yards === 1 ? '' : 's'}` : yards === 0 ? 'and is stopped for no gain' : `and is dropped for a loss of ${-yards}`}.`;
  } else {
    carrier = L.TE ?? L.WR1;
    const hit = surprise ? chance(g, 0.7) : chance(g, 0.25);
    yards = hit ? Math.round(clamp(8 + 5 * randn(g), 2, 30)) : 0;
    base.qb = kicker ?? L.QB;
    text = hit ? `Fake field goal! ${nm(kicker ?? L.QB)} pops up and finds ${nm(carrier)} for ${yards} yards.` : `Fake field goal! ${nm(kicker ?? L.QB)}'s pass falls incomplete.`;
  }
  yards = Math.min(yards, 100 - g.spot);
  return { kind: kind === 'punt' ? 'run' : 'pass', yards, carrier, scorer: carrier, qb: base.qb ?? carrier, text, clockStop: true, highlight: yards >= base.toGo ? 'big' : null };
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

function doRun(g, call, defCall, qbRun = false) {
  const o = g.poss, d = 1 - o;
  const O = (s) => g.teams[o].lineup[s], D = (s) => g.teams[d].lineup[s];
  const dir = OFF_PLAYS[call].dir;
  const carrier = dir === 'sneak' || qbRun ? O('QB') : O('RB');
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
    let mean = 2.1 + lane * 0.1;
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
  // An outside run ends out of bounds now and then; more often when the runner is trying to save clock.
  const out = !td && dir === 'outside' && chance(g, aiTempo(g) === 'hurry' ? 0.4 : 0.2);
  if (out) text = text.replace(/ Tackled by [^.]*\./, ' Pushed out of bounds.');
  return { kind: 'run', yards, carrier, scorer: carrier, text, oob: out, clockStop: out, highlight: bigPlay, se };
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
    // Sideline routes often end out of bounds; in the two-minute drill receivers get there on purpose.
    const out = !td && chance(g, (play.sideline ? 0.5 : 0.04) + (aiTempo(g) === 'hurry' ? 0.25 : 0));
    if (out) text = text.replace(/ Tackled by [^.]*\./, ' Out of bounds.');
    return { kind: 'pass', yards, carrier: tgt, scorer: tgt, qb, text, oob: out, clockStop: out, air, highlight: yards >= 20 ? 'big' : null, se: best.se };
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
  return { kind: 'pass', yards: 0, carrier: qb, qb, text: text + '.', clockStop: true, incomplete: true, cov, air };
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
  // The last snap of a half: kick it if in range (a running clock leaves time for a hurried
  // field goal unit only with a few seconds to spare).
  const endOfHalf = (g.quarter === 2 || late) && g.clock <= (g.clockRunning ? 22 : 14);
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

// The clock call the down asks for, if any: kneel to run out a win, take a knee at the end of
// the half backed up, or spike a running clock with no timeouts left in the two-minute drill.
export function clockLean(g) {
  if (g.phase !== 'play') return null;
  const o = g.poss, lead = g.score[o] - g.score[1 - o];
  if (canKneelOut(g)) return 'kneel';
  if (g.quarter === 2 && g.clock <= 30 && g.spot <= 30 && lead >= -3) return 'kneel';
  if (!g.clockRunning || (g.timeouts?.[o] ?? 0) > 0 || g.down === 4) return null;
  const needPts = g.quarter === 2 ? g.spot >= 45 : g.quarter >= 4 && lead <= 0;
  if (!needPts || g.clock > 45 || g.clock < 6) return null;
  const inRange = fgDistance(g) <= 52;
  if (g.down <= 2 || (g.down === 3 && inRange && g.clock <= 20)) return 'spike';
  return null;
}

export function aiOffenseCall(g) {
  if (g.phase === 'penalty') return g.pending?.aiAccept ? 'accept' : 'decline';
  if (g.phase === 'pat') return aiConvertCall(g);
  if (g.phase === 'kickoff') return onsideLean(g, g.kick?.kicker ?? g.poss) || chance(g, surpriseOnside(g, g.kick?.kicker ?? g.poss)) ? 'onside' : 'kick_deep';
  const cl = clockLean(g);
  if (cl) return cl;
  const lean = offenseLean(g);
  if (lean === 'punt') {
    // Near midfield the punter angles it for the corner; once in a while a fake on 4th and short.
    if (g.toGo <= 3 && g.spot >= 35 && g.spot <= 60 && chance(g, 0.05)) return 'fake_punt';
    if (g.spot >= 55) return 'coffin_punt';
  }
  if (lean === 'fg' && g.down === 4 && g.toGo <= 3 && chance(g, 0.03)) return 'fake_fg';
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
  // The two-minute drill works the sidelines.
  if (aiTempo(g) === 'hurry') { w.out *= 2; w.screen *= 0.5; }
  if (g.toGo > 15) { w.screen *= 0.5; w.slant *= 0.4; }
  return spread(w, 'pass');
}

// The newer plays share the weight of the original play they resolve as, so the AI mixes the
// whole playbook in the same proportions by kind and depth.
const SHARE = { bubble: 0.5, stick: 0.8, curl_flat: 0.7, mesh: 0.8, smash: 0.7, dagger: 0.6, levels: 0.6, flood: 0.6, y_cross: 0.7,
  four_verts: 0.7, pa_boot: 1.2, power: 0.8, counter: 0.6, toss: 0.7, dive: 0.6,
  cover1_robber: 0.6, cover2_man: 0.6, tampa2: 0.7, cover4: 0.8, mug: 0.6, nickel_blitz: 0.6, fire_zone: 0.7, cover0: 0.35 };
function spread(w, kind) {
  const table = kind === 'def' ? DEF_PLAYS : OFF_PLAYS;
  for (const [k, P] of Object.entries(table)) {
    if (!P.sim || w[P.sim] == null || (kind !== 'def' && P.kind !== kind)) continue;
    w[k] = w[P.sim] * (SHARE[k] ?? 0.6);
  }
  return w;
}

export function runWeights(g) {
  const o = g.poss;
  const t = g.teams[o], L = t.lineup;
  const A = (ti, id, a) => eff(g, ti, id, a);
  const w = { inside_run: 1.2, outside_run: 1 + (A(o, L.RB, 'spd') - 70) / 30, draw: g.toGo >= 7 ? 0.8 : 0.25 };
  if (g.toGo <= 1) w.qb_sneak = 0.6 + Math.max(0, A(o, L.QB, 'str') - 65) / 30;
  if (t.coach === 'trench') w.inside_run *= 1.5;
  spread(w, 'run');
  // Designed quarterback runs, more for a quarterback who can run.
  const legs = (A(o, L.QB, 'spd') - 60) / 40;
  w.qb_draw = Math.max(0.05, 0.25 * legs) * (g.toGo >= 6 ? 1.4 : 0.8);
  w.qb_power = Math.max(0.05, 0.3 * legs) * (g.toGo <= 3 ? 1.5 : 1);
  w.read_option = Math.max(0.1, 0.45 * legs + 0.1);
  if (g.toGo <= 2) { w.dive = (w.dive ?? 0) * 1.6; w.power = (w.power ?? 0) * 1.4; }
  if (g.toGo >= 7) w.toss = (w.toss ?? 0) * 1.2;
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
  spread(w, 'def');
  // A few calls the down asks for by name: quarters and Tampa 2 on long yardage, an all-out
  // blitz when the offense needs only a yard or two.
  if (g.down >= 3 && g.toGo >= 7) { w.cover4 = (w.cover4 ?? 0) + 1; w.tampa2 = (w.tampa2 ?? 0) + 0.8; }
  if (g.toGo <= 2) w.cover0 = (w.cover0 ?? 0) + 0.5;
  return w;
}

export function aiDefenseCall(g) { return pickWeighted(g, defenseWeights(g)); }

// One AI-called down: timeouts first, then the calls, then the clock runs to the snap.
// The play clock ran out before the offense called a play: the full play clock comes off a
// running game clock, then a delay of game on the offense (5 yards, repeat the down). Returns
// the log entry, or null when the quarter ran out first or there is no down to play.
export function delayOfGame(g) {
  if (g.final || g.phase !== 'play') return null;
  if (!snapClock(g, 'milk')) return null;
  g.playNo++;
  const base = { kind: 'play', down: g.down, toGo: g.toGo, spotBefore: g.spot, from: absSpot(g.poss, g.spot), team: g.poss, yards: 0 };
  return finishPlay(g, { kind: 'none', noPlay: true, yards: 0, fouls: [foul('delay_of_game', g.poss, g.teams[g.poss].lineup.QB ?? null)], text: '' }, base, null, null, 0);
}

export function simPlay(g) {
  aiTimeouts(g);
  const off = aiOffenseCall(g), def = aiDefenseCall(g);
  if (!snapClock(g, null, off)) return null;
  return runPlay(g, off, def);
}

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
