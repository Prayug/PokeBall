// Powers: a layer on top of abilities, in the spirit of Madden's X-Factors. Many Pokémon carry
// one power for their natural position group. It starts dormant each game; the Pokémon zones
// in by doing its thing on the field (three straight completions, two sacks, a long catch),
// plays boosted while it is active, and loses it to a specific setback (an interception, a
// sack allowed, a big play given up). The game tracks it play by play from the box score, so
// the fast simulator and the live field earn and lose powers the same way.
//
// A power entry: `group` (the position group it works in), `types` (the typings it suits, for
// Pokémon without a signature), `zone` and `lose` (what earns and what costs it, each counted
// over plays: `add` returns how far a play moves it, `reset` breaks a streak), `attr` (rating
// bonuses while active, through eff() in engine.js) and `live` (live-field effects read by the
// trait table in traits.js).
import { PLAYERS, SLOT } from './ratings.js';
import { TYPE_COLORS } from './types.js';

// Where a power works: the position group of the slot the Pokémon plays.
export const POWER_GROUPS = { QB: 'QB', RB: 'skill', WR: 'skill', TE: 'skill', OL: 'line', DL: 'rush', LB: 'cover', CB: 'cover', S: 'cover' };
export const GROUP_NAMES = { QB: 'quarterback', skill: 'running back, receiver or tight end', line: 'offensive line', rush: 'defensive line or outside linebacker', cover: 'linebacker or secondary' };
export const groupOfSlot = (slot) => (slot === 'OLB' ? 'rush' : POWER_GROUPS[SLOT[slot]?.group] ?? null);

// One play, from the side of one Pokémon: `d` its own box-score line for the play, `P` the play
// (o: the offense, run or pass, yards, a touchdown, a sack, a pick, a fumble, completions),
// `off` whether its team had the ball.
const touched = (e) => e.d.ra + e.d.rc;
const gained = (e) => e.d.ry + e.d.rcy;
const oppPlay = (e) => !e.off;

export const POWERS = {
  // ---------- quarterbacks ----------
  futureSight: {
    name: 'Future Sight', group: 'QB', types: ['Psychic', 'Fairy', 'Ghost'],
    text: 'Sees the coverage before the snap: +8 accuracy and +6 awareness, and pressure barely touches him.',
    zone: { need: 3, label: '3 straight completions', add: (e) => (e.d.pc > 0 ? 1 : 0), reset: (e) => e.d.pa > e.d.pc || e.d.sk > 0 },
    lose: { need: 1, label: 'throwing an interception', add: (e) => (e.d.pint > 0 ? 1 : 0) },
    attr: { acc: 8, awr: 6 }, live: { calm: 0.45 },
  },
  hurricane: {
    name: 'Hurricane', group: 'QB', types: ['Flying', 'Water', 'Ice', 'Dragon'],
    text: 'Throws a gale downfield: +10 throwing power and +8 accuracy on deep balls.',
    zone: { need: 2, label: '2 completions of 20+ yards', add: (e) => (e.d.pc > 0 && e.d.py >= 20 ? 1 : 0) },
    lose: { need: 2, label: '2 incompletions in a row', add: (e) => (e.d.pa > e.d.pc ? 1 : 0), reset: (e) => e.d.pc > 0 },
    attr: { arm: 10 }, deep: { acc: 8 },
  },
  thunderbolt: {
    name: 'Thunderbolt', group: 'QB', types: ['Electric', 'Steel', 'Bug'],
    text: 'Zips bullets through closing windows: +8 throwing power, +4 accuracy, and defenders jump his throws far less.',
    zone: { need: 4, label: '4 completions', add: (e) => (e.d.pc > 0 ? 1 : 0) },
    lose: { need: 1, label: 'being sacked', add: (e) => (e.d.sk > 0 ? 1 : 0) },
    attr: { arm: 8, acc: 4 }, live: { safeThrow: -0.06 },
  },
  calmMind: {
    name: 'Calm Mind', group: 'QB', types: ['Normal', 'Grass', 'Poison', 'Ground', 'Rock', 'Fighting'],
    text: 'Unshakable on the money downs: +6 accuracy and +6 awareness, and pressure barely touches him.',
    zone: { need: 2, label: '2 third-down conversions', add: (e) => (e.off && e.P.third && e.P.first && (e.d.pa > 0 || e.d.ra > 0) ? 1 : 0) },
    lose: { need: 1, label: 'being sacked', add: (e) => (e.d.sk > 0 ? 1 : 0) },
    attr: { acc: 6, awr: 6 }, live: { calm: 0.4 },
  },
  overheat: {
    name: 'Overheat', group: 'QB', types: ['Fire', 'Dark'],
    text: 'Red-hot after a score: +10 throwing power, +6 accuracy and +4 speed.',
    zone: { need: 1, label: 'a touchdown pass', add: (e) => e.d.ptd },
    lose: { need: 1, label: 'throwing an interception', add: (e) => (e.d.pint > 0 ? 1 : 0) },
    attr: { arm: 10, acc: 6, spd: 4 },
  },

  // ---------- backs, receivers and tight ends ----------
  quickAttack: {
    name: 'Quick Attack', group: 'skill', types: ['Normal', 'Electric', 'Flying', 'Dragon'],
    text: 'Hits top speed in a blink: +8 speed and +8 acceleration.',
    zone: { need: 2, label: '2 plays of 12+ yards', add: (e) => (touched(e) && gained(e) >= 12 ? 1 : 0) },
    lose: { need: 1, label: 'being stopped for a loss', add: (e) => (touched(e) && gained(e) < 0 ? 1 : 0) },
    attr: { spd: 8, acl: 8 },
  },
  rollout: {
    name: 'Rollout', group: 'skill', types: ['Rock', 'Ground', 'Steel'],
    text: 'Picks up speed and mass with every touch: +10 strength breaking tackles and tacklers bounce off.',
    zone: { need: 6, label: '6 touches', add: (e) => touched(e) },
    lose: { need: 1, label: 'a fumble', add: (e) => e.d.fum },
    attr: { str: 10 }, live: { elusive: -0.08 },
  },
  shadowSneak: {
    name: 'Shadow Sneak', group: 'skill', types: ['Ghost', 'Dark', 'Poison'],
    text: 'Slips through the cracks: +8 agility and tacklers grab at shadows.',
    zone: { need: 50, label: '50 yards from scrimmage', add: (e) => Math.max(0, gained(e)) },
    lose: { need: 2, label: '2 straight touches for 2 yards or less', add: (e) => (touched(e) && gained(e) <= 2 ? 1 : 0), reset: (e) => touched(e) && gained(e) > 2 },
    attr: { agi: 8 }, live: { elusive: -0.12 },
  },
  aerialAce: {
    name: 'Aerial Ace', group: 'skill', types: ['Flying', 'Bug', 'Fairy', 'Psychic'],
    text: 'Never misses a ball in the air: +10 catching and a far longer reach.',
    zone: { need: 2, label: '2 catches of 12+ yards', add: (e) => (e.d.rc > 0 && e.d.rcy >= 12 ? 1 : 0) },
    lose: { need: 2, label: '2 straight targets without a catch', add: (e) => (e.d.tg > e.d.rc ? 1 : 0), reset: (e) => e.d.rc > 0 },
    attr: { hnd: 10 }, live: { reach: 0.45 },
  },
  aquaJet: {
    name: 'Aqua Jet', group: 'skill', types: ['Water', 'Ice'],
    text: 'Slices through traffic after the catch: +8 agility and +6 speed.',
    zone: { need: 3, label: '3 catches', add: (e) => e.d.rc },
    lose: { need: 1, label: 'a pass to him intercepted', add: (e) => (e.P.int && e.d.tg > 0 ? 1 : 0) },
    attr: { agi: 8, spd: 6 },
  },
  flareBlitz: {
    name: 'Flare Blitz', group: 'skill', types: ['Fire', 'Fighting'],
    text: 'Plays on fire after a score: +8 strength, +6 speed and tacklers bounce off.',
    zone: { need: 1, label: 'a touchdown', add: (e) => e.d.rtd + e.d.rctd },
    lose: { need: 1, label: 'a fumble', add: (e) => e.d.fum },
    attr: { str: 8, spd: 6 }, live: { elusive: -0.06 },
  },
  razorLeaf: {
    name: 'Razor Leaf', group: 'skill', types: ['Grass'],
    text: 'Moves the chains: +6 speed, +6 catching and +6 agility.',
    zone: { need: 3, label: '3 first downs with the ball', add: (e) => (touched(e) && e.P.first ? 1 : 0) },
    lose: { need: 1, label: 'a fumble or a loss', add: (e) => (e.d.fum || (touched(e) && gained(e) < 0) ? 1 : 0) },
    attr: { spd: 6, hnd: 6, agi: 6 },
  },

  // ---------- the offensive line ----------
  protect: {
    name: 'Protect', group: 'line', types: ['Steel', 'Fairy', 'Normal', 'Psychic', 'Water'],
    text: 'An impenetrable wall: +10 blocking and rushers take far longer to get off him.',
    zone: { need: 8, label: '8 straight dropbacks without a sack', add: (e) => (e.off && e.P.kind === 'pass' && !e.P.sack ? 1 : 0), reset: (e) => e.off && e.P.sack },
    lose: { need: 1, label: 'a sack allowed', add: (e) => (e.off && e.P.sack ? 1 : 0) },
    attr: { blk: 10 }, live: { anchor: 0.6 },
  },
  earthquake: {
    name: 'Earthquake', group: 'line', types: ['Ground', 'Rock', 'Fighting', 'Dragon'],
    text: 'Moves the earth on run plays: +8 blocking and +8 strength.',
    zone: { need: 3, label: '3 team runs of 5+ yards', add: (e) => (e.off && e.P.kind === 'run' && e.P.yards >= 5 ? 1 : 0) },
    lose: { need: 1, label: 'a run stuffed for a loss', add: (e) => (e.off && e.P.kind === 'run' && e.P.yards < 0 ? 1 : 0) },
    attr: { blk: 8, str: 8 },
  },
  wideGuard: {
    name: 'Wide Guard', group: 'line', types: ['Grass', 'Fire', 'Ice', 'Poison', 'Bug', 'Electric', 'Ghost', 'Dark', 'Flying'],
    text: 'Covers the whole front: +6 blocking, +6 strength and +6 stamina.',
    zone: { need: 3, label: '3 team first downs', add: (e) => (e.off && e.P.first ? 1 : 0) },
    lose: { need: 1, label: 'a sack or a run for a loss', add: (e) => (e.off && (e.P.sack || (e.P.kind === 'run' && e.P.yards < 0)) ? 1 : 0) },
    attr: { blk: 6, str: 6, sta: 6 },
  },

  // ---------- the pass rush ----------
  outrage: {
    name: 'Outrage', group: 'rush', types: ['Dragon', 'Fighting', 'Fire', 'Dark'],
    text: 'Goes berserk off the edge: +10 pass rush and he sheds blocks far faster.',
    zone: { need: 2, label: '2 sacks', add: (e) => e.d.dsk },
    lose: { need: 1, label: 'giving up a touchdown', add: (e) => (oppPlay(e) && e.P.td ? 1 : 0) },
    attr: { rush: 10 }, live: { shed: 1.6 },
  },
  heavySlam: {
    name: 'Heavy Slam', group: 'rush', types: ['Steel', 'Rock', 'Ground', 'Normal', 'Ice'],
    text: 'Drops like a boulder on runners: +10 strength, +8 tackling and his tackles stick.',
    zone: { need: 2, label: '2 tackles for no gain or a loss', add: (e) => (oppPlay(e) && e.d.tk > 0 && e.P.yards <= 0 ? 1 : 0) },
    lose: { need: 1, label: 'giving up a 10+ yard run', add: (e) => (oppPlay(e) && e.P.kind === 'run' && e.P.yards >= 10 ? 1 : 0) },
    attr: { str: 10, tkl: 8 }, live: { tackle: 0.08 },
  },
  thunderWave: {
    name: 'Thunder Wave', group: 'rush', types: ['Electric', 'Psychic', 'Poison', 'Ghost', 'Fairy'],
    text: 'Paralyzes the passer: +8 pass rush, and a quarterback he pressures sprays the ball.',
    zone: { need: 1, label: 'a sack', add: (e) => e.d.dsk },
    lose: { need: 3, label: '3 straight completions against him', add: (e) => (oppPlay(e) && e.P.comp ? 1 : 0), reset: (e) => oppPlay(e) && e.P.kind === 'pass' && !e.P.comp },
    attr: { rush: 8 }, live: { paralyze: 1.45 },
  },
  stickyWeb: {
    name: 'Sticky Web', group: 'rush', types: ['Bug', 'Grass', 'Water', 'Flying'],
    text: 'Everything sticks to him: +8 tackling, +6 pass rush and his tackles go for the ball.',
    zone: { need: 4, label: '4 tackles', add: (e) => e.d.tk },
    lose: { need: 1, label: 'giving up a 20+ yard play', add: (e) => (oppPlay(e) && e.P.yards >= 20 ? 1 : 0) },
    attr: { tkl: 8, rush: 6 }, live: { strip: 0.05 },
  },

  // ---------- linebackers and the secondary ----------
  meanLook: {
    name: 'Mean Look', group: 'cover', types: ['Ghost', 'Dark', 'Psychic', 'Normal'],
    text: 'His man cannot get away: +10 coverage and he jumps routes.',
    zone: { need: 1, label: 'a pass breakup or an interception', add: (e) => e.d.pd + e.d.dint },
    lose: { need: 1, label: 'giving up a 25+ yard completion', add: (e) => (oppPlay(e) && e.P.comp && e.P.yards >= 25 ? 1 : 0) },
    attr: { cov: 10 }, live: { hawk: 0.06 },
  },
  iceBeam: {
    name: 'Ice Beam', group: 'cover', types: ['Ice', 'Water', 'Steel', 'Flying'],
    text: 'Freezes the passing game: +8 coverage, +8 catching and a nose for interceptions.',
    zone: { need: 2, label: 'an interception or 2 pass breakups', add: (e) => 2 * e.d.dint + e.d.pd },
    lose: { need: 1, label: 'giving up a touchdown pass', add: (e) => (oppPlay(e) && e.P.td && e.P.kind === 'pass' ? 1 : 0) },
    attr: { cov: 8, hnd: 8 }, live: { hawk: 0.1 },
  },
  pursuit: {
    name: 'Pursuit', group: 'cover', types: ['Bug', 'Fighting', 'Rock', 'Ground', 'Poison', 'Fire'],
    text: 'Runs everything down: +10 tackling, +6 speed and his tackles stick.',
    zone: { need: 4, label: '4 tackles', add: (e) => e.d.tk },
    lose: { need: 1, label: 'giving up a 20+ yard play', add: (e) => (oppPlay(e) && e.P.yards >= 20 ? 1 : 0) },
    attr: { tkl: 10, spd: 6 }, live: { tackle: 0.08 },
  },
  agility: {
    name: 'Agility', group: 'cover', types: ['Grass', 'Electric', 'Fairy', 'Dragon'],
    text: 'Everywhere at once: +8 speed, +6 acceleration and +6 coverage.',
    zone: { need: 5, label: '5 straight stops of 3 yards or less', add: (e) => (oppPlay(e) && e.P.yards <= 3 ? 1 : 0), reset: (e) => oppPlay(e) && e.P.yards > 3 },
    lose: { need: 1, label: 'giving up a touchdown', add: (e) => (oppPlay(e) && e.P.td ? 1 : 0) },
    attr: { spd: 8, acl: 6, cov: 6 },
  },
};
for (const [id, p] of Object.entries(POWERS)) p.id = id;

// Signature powers: a famous Pokémon's own move on top of the power for its position, a little
// stronger (+2 on each bonus, and its live edge a third bigger).
export const SIGNATURES = {
  Mewtwo: ['Psystrike', 'futureSight'], Lucario: ['Aura Sphere', 'futureSight'], Togekiss: ['Dazzling Gleam', 'futureSight'],
  Rayquaza: ['Dragon Ascent', 'hurricane'], Kyogre: ['Origin Pulse', 'hurricane'], Dragonite: ['Hurricane Wings', 'hurricane'], Venusaur: ['Solar Beam', 'hurricane'],
  'Ho-Oh': ['Sacred Fire', 'overheat'], Hydreigon: ['Dark Pulse', 'overheat'], Moltres: ['Heat Wave', 'overheat'],
  Charizard: ['Blast Burn', 'flareBlitz'], Typhlosion: ['Eruption', 'flareBlitz'],
  Gengar: ['Phantom Force', 'shadowSneak'], Darkrai: ['Dark Void', 'shadowSneak'], Zoroark: ['Night Daze', 'shadowSneak'],
  Arcanine: ['Extreme Speed', 'quickAttack'], Dragapult: ['Dragon Darts', 'quickAttack'], Zapdos: ['Thunder', 'quickAttack'],
  Alakazam: ['Teleport', 'aerialAce'], Lugia: ['Aeroblast', 'aerialAce'], Volcarona: ['Quiver Dance', 'aerialAce'],
  Inteleon: ['Snipe Shot', 'aerialAce'], Gardevoir: ['Moonblast', 'aerialAce'],
  Greninja: ['Water Shuriken', 'aquaJet'], Feraligatr: ['Liquidation', 'aquaJet'], Sceptile: ['Leaf Blade', 'razorLeaf'],
  Snorlax: ['Body Slam', 'earthquake'], Tyranitar: ['Stone Edge', 'earthquake'], Groudon: ['Precipice Blades', 'earthquake'],
  Rhyperior: ['Rock Wrecker', 'earthquake'], Steelix: ['Iron Tail', 'protect'], Corviknight: ['Iron Defense', 'protect'],
  Ferrothorn: ['Spiky Shield', 'protect'], Lapras: ['Sheer Cold', 'protect'],
  Gyarados: ['Dragon Dance', 'outrage'], Salamence: ['Draco Meteor', 'outrage'], Cinderace: ['Pyro Ball', 'outrage'],
  Infernape: ['Close Combat', 'outrage'], Hitmonlee: ['High Jump Kick', 'outrage'], Absol: ['Night Slash', 'outrage'],
  Electivire: ['Thunder Punch', 'thunderWave'], Heracross: ['Megahorn', 'heavySlam'], Rillaboom: ['Drum Beating', 'heavySlam'],
  Kingler: ['Crabhammer', 'heavySlam'],
  Mew: ['Transform', 'meanLook'], Crobat: ['Cross Poison', 'meanLook'], Mimikyu: ['Play Rough', 'meanLook'],
  Umbreon: ['Foul Play', 'meanLook'], Ninetales: ['Will-O-Wisp', 'meanLook'],
  Weavile: ['Ice Shard', 'iceBeam'], Articuno: ['Freeze-Dry', 'iceBeam'], Blastoise: ['Hydro Cannon', 'iceBeam'], Aegislash: ["King's Shield", 'iceBeam'],
  Garchomp: ['Dragon Rush', 'pursuit'], Machamp: ['Dynamic Punch', 'pursuit'], Metagross: ['Meteor Mash', 'pursuit'],
  Scizor: ['Bullet Punch', 'pursuit'], Swampert: ['Muddy Water', 'pursuit'], Hitmonchan: ['Mach Punch', 'pursuit'],
  Jolteon: ['Volt Switch', 'agility'], Raichu: ['Volt Tackle', 'agility'],
};

// Who carries a power: every signature Pokémon, and anyone who rates 88 or
// better at his natural position (his best spot other than kicker or punter): a handful per lineup.
const POWER_CUTOFF = 88;
function naturalSlot(p) { return p.best.find((k) => k !== 'K' && k !== 'P'); }
function boosted(base, sig) {
  const up = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v + 2]));
  // Live edges: calm and anchor scale something down, shed and paralyze scale it up, the rest add.
  const more = (k, v) => (k === 'calm' || k === 'anchor' ? v * 0.85 : k === 'shed' || k === 'paralyze' ? 1 + (v - 1) * 4 / 3 : v * 4 / 3);
  const live = base.live && Object.fromEntries(Object.entries(base.live).map(([k, v]) => [k, more(k, v)]));
  return { ...base, id: `${base.id}:${sig}`, base: base.id, name: sig, signature: true, attr: up(base.attr), deep: base.deep && up(base.deep), live };
}
function assign() {
  const out = {};
  for (const [key, p] of Object.entries(PLAYERS)) {
    const slot = naturalSlot(p);
    const group = groupOfSlot(slot);
    const sig = SIGNATURES[p.name];
    if (sig && POWERS[sig[1]].group === group) { out[key] = boosted(POWERS[sig[1]], sig[0]); continue; }
    if (p.ovr[slot] < POWER_CUTOFF) continue;
    const pool = Object.values(POWERS).filter((w) => w.group === group);
    const pick = pool.find((w) => w.types.includes(p.types[0])) ?? pool.find((w) => p.types.some((t) => w.types.includes(t))) ?? pool[pool.length - 1];
    out[key] = pick;
  }
  return out;
}
export const POWER_OF = assign();
export const powerOf = (id) => (id == null ? null : POWER_OF[id] ?? null);
// Whether a Pokémon's power works when he lines up at this slot.
export const worksAt = (id, slot) => !!POWER_OF[id] && groupOfSlot(slot) === POWER_OF[id].group;
export const powerColor = (id) => TYPE_COLORS[PLAYERS[id]?.types[0]] ?? '#ffd23f';

// ---------- during a game ----------
// g.pw: per side, each power carrier's state ({ n: progress to zone in, l: progress to losing
// it, on: active }), and the box score as it stood after the last play counted.
function slotOf(g, ti, id) {
  const L = g.teams[ti].lineup;
  for (const k of Object.keys(L)) if (L[k] === id) return k;
  return null;
}
// Only the power carriers' lines are kept, as numbers in KEYS order: that is all the meters read.
const KEYS = ['pa', 'pc', 'py', 'ptd', 'pint', 'sk', 'ra', 'ry', 'rtd', 'fum', 'tg', 'rc', 'rcy', 'rctd', 'tk', 'dsk', 'dint', 'pd'];
const line = (s) => (s ? [s.pa, s.pc, s.py, s.ptd, s.pint, s.sk, s.ra, s.ry, s.rtd, s.fum, s.tg, s.rc, s.rcy, s.rctd, s.tk, s.dsk, s.dint, s.pd] : KEYS.map(() => 0));
// One play's line from two snapshots, as a fixed-shape object (the meters read it by name).
// `wiped`: a count went down, so a penalty took the play off.
function lineDelta(a, b) {
  const d = (i) => a[i] - b[i];
  const out = { pa: d(0), pc: d(1), py: d(2), ptd: d(3), pint: d(4), sk: d(5), ra: d(6), ry: d(7), rtd: d(8), fum: d(9),
    tg: d(10), rc: d(11), rcy: d(12), rctd: d(13), tk: d(14), dsk: d(15), dint: d(16), pd: d(17), wiped: false };
  for (let i = 0; i < a.length; i++) if (i !== 2 && i !== 7 && i !== 12 && a[i] < b[i]) out.wiped = true;
  return out;
}
export function initPowers(g) {
  // Per side, [id, line] pairs (a list, not an object keyed by id: it is read every play).
  const seen = g.teams.map((t) => Object.keys(t.stats).filter((id) => POWER_OF[id]).map((id) => [id, line(t.stats[id])]));
  g.pw = { s: [{}, {}], seen };
  return g.pw;
}
// Whether a Pokémon's power is live right now (in the zone and playing a spot it works at).
export function activePower(g, ti, id) {
  const st = g.pw?.s[ti]?.[id];
  if (!st?.on) return null;
  const w = POWER_OF[id];
  return w && groupOfSlot(slotOf(g, ti, id)) === w.group ? w : null;
}
// What the live field carries for an active power: plain data, so a play can be copied for
// its replay.
export function livePower(g, ti, id) {
  const w = activePower(g, ti, id);
  return w ? { id: w.id, name: w.name, color: powerColor(id), live: { ...(w.live ?? {}) } } : null;
}
// A rating bonus from an active power (see eff() in engine.js).
export function powerBonus(g, ti, id, attr, ctx) {
  const w = activePower(g, ti, id);
  if (!w) return 0;
  return (w.attr[attr] ?? 0) + (ctx?.deep && w.deep ? w.deep[attr] ?? 0 : 0);
}

// Counts the play just applied: each carrier's zone and loss meters move, powers switch on and
// off. Returns the changes ({ ti, id, power, on }) so the play's record and the field can show
// them. A play wiped by a penalty moves nothing (its stats came off).
export function tickPowers(g, entry, counts) {
  const pw = g.pw ?? initPowers(g);
  // Each carrier's line for this play: what changed since the last play counted. Yards can go
  // down (a loss); the counts never do, except when a penalty takes a play off.
  const deltas = [new Map(), new Map()];
  for (let ti = 0; ti < 2; ti++) {
    const stats = g.teams[ti].stats;
    for (const row of pw.seen[ti]) {
      const now = line(stats[row[0]]);
      deltas[ti].set(Number(row[0]), lineDelta(now, row[1]));
      row[1] = now;
    }
  }
  if (!counts) return [];
  const o = counts.o;
  const P = {
    o, kind: counts.kind, yards: entry?.yards ?? 0, td: entry?.highlight === 'td' && g.score[o] > (entry?.score?.[o] ?? 0),
    sack: !!counts.sack, int: !!counts.int, comp: !!counts.comp, first: !!counts.first, third: counts.down === 3,
  };
  const out = [];
  for (const ti of [0, 1]) {
    const L = g.teams[ti].lineup, slots = new Map();
    for (const k in L) if (!slots.has(L[k])) slots.set(L[k], k);
    for (const [id, d] of deltas[ti]) {
      const w = POWER_OF[id], slot = slots.get(id);
      if (slot == null) continue;
      const inRole = groupOfSlot(slot) === w.group;
      const st = pw.s[ti][id] ?? (pw.s[ti][id] = { n: 0, l: 0, on: false });
      if (d.wiped) continue;
      const e = { d, P, off: ti === o };
      if (!st.on) {
        if (!inRole) continue;
        if (w.zone.reset?.(e)) st.n = 0;
        else st.n += w.zone.add(e);
        if (st.n >= w.zone.need) { st.on = true; st.n = 0; st.l = 0; out.push({ ti, id, power: w.id, on: true }); }
      } else {
        if (w.lose.reset?.(e)) st.l = 0;
        else st.l += w.lose.add(e);
        if (st.l >= w.lose.need) { st.on = false; st.l = 0; st.n = 0; out.push({ ti, id, power: w.id, on: false }); }
      }
    }
  }
  return out;
}

// Lines for the play's record and the result card.
export function powerLine(c) {
  const w = POWER_OF[c.id], n = PLAYERS[c.id].name;
  return c.on ? `${n} is in the zone: ${w.name}!` : `${n} loses ${w.name}.`;
}
// A carrier's meter for the HUD: { label, have, need } toward zoning in, or toward losing it.
export function powerMeter(g, ti, id) {
  const w = POWER_OF[id];
  if (!w) return null;
  const st = g.pw?.s[ti]?.[id] ?? { n: 0, l: 0, on: false };
  return st.on ? { on: true, label: `Lost on ${w.lose.label}`, have: st.l, need: w.lose.need }
    : { on: false, label: `Zone in: ${w.zone.label}`, have: Math.min(st.n, w.zone.need), need: w.zone.need };
}
// Every power carrier on a side's lineup, active first, for the HUD and the game screen.
export function sidePowers(g, ti) {
  const ids = [...new Set(Object.values(g.teams[ti].lineup))].filter((id) => POWER_OF[id]);
  const rows = ids.map((id) => ({ id, power: POWER_OF[id], meter: powerMeter(g, ti, id), active: !!activePower(g, ti, id),
    dormant: groupOfSlot(slotOf(g, ti, id)) !== POWER_OF[id].group }));
  return rows.sort((a, b) => (b.active - a.active) || (b.meter.have / b.meter.need - a.meter.have / a.meter.need));
}
export function powerText(id) {
  const w = POWER_OF[id];
  if (!w) return null;
  return { name: w.name, signature: !!w.signature, group: GROUP_NAMES[w.group], text: w.text, zone: w.zone.label, lose: w.lose.label };
}
