// Penalties: false start, offside, holding and pass interference. Who commits one comes from
// awareness (a sloppy Pokémon draws more flags) and the matchup. One model for both games: the
// live field rolls the same fouls as the fast simulator, at the snap (preSnapFoul) and at the
// whistle from what happened (simFouls). No DOM access.
import { chance, clamp, eff, nm } from './engine.js';

// side: the side that commits it. pre: a dead-ball foul before the snap (no play). yards: the
// distance; spot: enforced where it happened. auto: an automatic first down. Offensive fouls
// replay the down.
export const PENALTIES = {
  false_start: { name: 'False start', side: 'off', yards: 5, pre: true },
  offside: { name: 'Offside', side: 'def', yards: 5, pre: true },
  delay_of_game: { name: 'Delay of game', side: 'off', yards: 5, pre: true },
  hold_off: { name: 'Holding', side: 'off', yards: 10 },
  hold_def: { name: 'Defensive holding', side: 'def', yards: 5, auto: true },
  dpi: { name: 'Pass interference', side: 'def', spot: true, auto: true },
  opi: { name: 'Offensive pass interference', side: 'off', yards: 10 },
};

// How much more often than an average player a Pokémon commits a foul: 1 at 70 awareness,
// about twice as often at 40, a third as often at 100.
export const sloppy = (awr) => clamp(1 + (70 - awr) * 0.033, 0.35, 2.2);

// Base rates, per player per play, for the fast simulator and the live field alike.
export const RATES = {
  falseStart: 0.0011,  // each lineman and the tight end; more on the road (crowd noise)
  offside: 0.0009,     // each down lineman and the outside linebacker
  holdBlock: 0.0021,   // each lineman, more when he is outmatched
  holdCover: 0.0026,   // each defensive back
  dpi: 0.032,          // on an incompletion with a defender on the receiver
  opi: 0.004,          // on a completion
};

const DL = ['LE', 'DE', 'DT1', 'DT2', 'OLB'];
const OL = ['LT', 'LG', 'C', 'RG', 'RT', 'TE'];
export const foul = (type, team, player, x = 0, y = 0, t = 0) => ({ type, team, player, x: Math.round(x), y, t });

// Before the snap: a false start on the offense or the defense jumping offside. Returns the foul
// or null. The road team's line hears the snap count worse.
export function preSnapFoul(g) {
  const o = g.poss, d = 1 - o;
  const road = o === 1 && !g.neutral ? 1.4 : 1;
  for (const slot of OL) {
    const id = g.teams[o].lineup[slot];
    if (id != null && chance(g, RATES.falseStart * road * sloppy(eff(g, o, id, 'awr')))) return foul('false_start', o, id, 0, 0);
  }
  for (const slot of DL) {
    const id = g.teams[d].lineup[slot];
    if (id != null && chance(g, RATES.offside * sloppy(eff(g, d, id, 'awr')))) return foul('offside', d, id, 0, 0);
  }
  return null;
}

// The fast simulator's fouls during a play it resolved (r): holding on the line (likelier for a
// lineman his man beats), defensive holding and interference downfield, offensive interference
// on a catch. Returns a list (usually empty).
export function simFouls(g, r) {
  const o = g.poss, d = 1 - o;
  const O = g.teams[o].lineup, D = g.teams[d].lineup;
  const out = [];
  if (r.turnover || r.spike || r.kneel || !['run', 'pass', 'sack'].includes(r.kind)) return out;
  const pass = r.kind === 'pass' || r.kind === 'sack';
  const pairs = [['LT', 'LE'], ['LG', 'DT1'], ['C', 'DT1'], ['RG', 'DT2'], ['RT', 'DE']];
  for (const [b, rr] of pairs) {
    const bid = O[b], rid = D[rr];
    if (bid == null) continue;
    const beat = rid == null ? 0 : Math.max(0, eff(g, d, rid, pass ? 'rush' : 'str') - eff(g, o, bid, 'blk'));
    if (chance(g, RATES.holdBlock * sloppy(eff(g, o, bid, 'awr')) * (1 + beat / 20))) { out.push(foul('hold_off', o, bid, -1, 0)); break; }
  }
  if (r.kind !== 'pass') return out;
  for (const slot of ['CB1', 'CB2', 'CB3', 'SS', 'FS']) {
    const id = D[slot];
    if (id != null && chance(g, RATES.holdCover * sloppy(eff(g, d, id, 'awr')))) { out.push(foul('hold_def', d, id, 6, 0)); break; }
  }
  if (r.incomplete && r.cov != null && chance(g, RATES.dpi * sloppy(eff(g, d, r.cov, 'awr')))) out.push(foul('dpi', d, r.cov, Math.max(1, r.air ?? 8), 0));
  else if (!r.incomplete && r.carrier != null && chance(g, RATES.opi * sloppy(eff(g, o, r.carrier, 'awr')))) out.push(foul('opi', o, r.carrier, r.air ?? 5, 0));
  return out;
}

// The down, distance and spot if the penalty is accepted, from the spot before the play.
// Distance penalties stop at half the distance to the goal; interference is spotted where it
// happened (at the 1 if in the end zone).
export function enforce(before, f) {
  const P = PENALTIES[f.type];
  let { spot, down, toGo } = before;
  let first = false, moved;
  if (P.side === 'off') {
    moved = -Math.min(P.yards, Math.floor(spot / 2));
    spot += moved; toGo -= moved;
  } else {
    // From the 1 there is nowhere left to go: interference there is a first down at the 1.
    moved = P.spot ? Math.min(Math.max(1, f.x), 99 - spot) : Math.min(P.yards, Math.floor((100 - spot) / 2));
    spot += moved;
    if (P.auto || moved >= toGo) { first = true; down = 1; toGo = Math.min(10, 100 - spot); } else toGo -= moved;
  }
  return { spot, down, toGo: Math.max(1, toGo), first, moved };
}

// A rough worth of a game state to side ti, in points: the score margin plus the possession's
// expected points (or the try or kickoff about to happen). The AI accepts or declines a penalty
// by whichever leaves it better off.
export function stateValue(s, ti) {
  let v = s.score[ti] - s.score[1 - ti];
  const mine = s.poss === ti ? 1 : -1;
  if (s.final) return v * 10;
  if (s.phase === 'pat') return v + mine * 0.95;
  if (s.phase === 'kickoff') return v - mine * 0.5;
  const ep = -0.6 + s.spot * 0.065 - (s.down - 1) * 0.45 - Math.min(s.toGo, 25) * 0.05 - (s.down === 4 ? 0.6 : 0);
  return v + mine * ep;
}

// The referee's announcement: the foul, the side, who, the yards, and what it means.
export function announce(g, f, acc, before, accepted = true) {
  const P = PENALTIES[f.type];
  const side = f.team === before.poss ? 'offense' : 'defense';
  const slot = Object.entries(g.teams[f.team].lineup).find(([, id]) => id === f.player)?.[0];
  const who = f.player != null ? `${nm(f.player)}${slot ? ` (${slot})` : ''}` : g.teams[f.team].name;
  const yd = Math.abs(acc.moved);
  const ord = ['', '1st', '2nd', '3rd', '4th'];
  const what = !accepted ? 'The penalty is declined.' : P.side === 'off' ? `${yd}-yard penalty, repeat ${ord[before.down]} down.`
    : `${P.spot ? (yd ? `Spot foul, ${yd} yard${yd === 1 ? '' : 's'}` : 'Spot foul, the ball stays at the 1') : `${yd}-yard penalty`}${acc.first ? ', automatic first down' : `, repeat ${ord[before.down]} down`}.`;
  return `Flag: ${P.name}, ${side}, ${who}. ${what}`;
}
