// Football attributes derived from Pokémon base stats, and the 22 roster slots.
import { POKEMON } from './data.js';
import { MODEL_INDEX } from './models3d.js';
import { pickAbility, TYPE_TRAITS, ABILITIES } from './types.js';

export const ATTRS = {
  spd: 'Speed', acl: 'Acceleration', agi: 'Agility', str: 'Strength', blk: 'Blocking', rush: 'Pass rush',
  arm: 'Throwing', acc: 'Accuracy', hnd: 'Catching', cov: 'Coverage', tkl: 'Tackling', awr: 'Awareness', sta: 'Stamina',
  kpw: 'Kick power', kac: 'Kick accuracy',
};

// Formation spots: x = yards from the line of scrimmage (offense negative),
// y = yards from the middle of the field.
export const SLOTS = [
  { key: 'QB', side: 'off', group: 'QB', w: { arm: 0.35, acc: 0.4, spd: 0.15, sta: 0.1 }, value: 1.6, x: -5, y: 0 },
  { key: 'RB', side: 'off', group: 'RB', w: { spd: 0.4, str: 0.35, hnd: 0.1, sta: 0.15 }, value: 1.0, x: -7.5, y: 0 },
  { key: 'LT', side: 'off', group: 'OL', w: { blk: 0.55, str: 0.3, spd: 0.15 }, value: 1.1, x: -1, y: -4.4 },
  { key: 'LG', side: 'off', group: 'OL', w: { blk: 0.55, str: 0.45 }, value: 0.9, x: -1, y: -2.2 },
  { key: 'C', side: 'off', group: 'OL', w: { blk: 0.55, str: 0.3, acc: 0.15 }, value: 0.9, x: -1, y: 0 },
  { key: 'RG', side: 'off', group: 'OL', w: { blk: 0.55, str: 0.45 }, value: 0.9, x: -1, y: 2.2 },
  { key: 'RT', side: 'off', group: 'OL', w: { blk: 0.55, str: 0.3, spd: 0.15 }, value: 1.0, x: -1, y: 4.4 },
  { key: 'WR1', side: 'off', group: 'WR', w: { spd: 0.45, hnd: 0.4, acc: 0.15 }, value: 1.1, x: -0.8, y: -19 },
  { key: 'WR2', side: 'off', group: 'WR', w: { spd: 0.45, hnd: 0.4, acc: 0.15 }, value: 1.0, x: -1.6, y: 19 },
  { key: 'WR3', side: 'off', group: 'WR', w: { hnd: 0.45, spd: 0.35, acc: 0.2 }, value: 0.9, x: -1.6, y: -11.5 },
  { key: 'TE', side: 'off', group: 'TE', w: { hnd: 0.35, blk: 0.35, str: 0.3 }, value: 0.95, x: -1, y: 7 },
  { key: 'FS', side: 'def', group: 'S', w: { cov: 0.45, spd: 0.3, acc: 0.25 }, value: 1.0, x: 12, y: -4 },
  { key: 'SS', side: 'def', group: 'S', w: { tkl: 0.45, cov: 0.35, spd: 0.2 }, value: 0.95, x: 9, y: 6 },
  { key: 'CB1', side: 'def', group: 'CB', w: { cov: 0.55, spd: 0.45 }, value: 1.1, x: 6, y: -18.5 },
  { key: 'CB2', side: 'def', group: 'CB', w: { cov: 0.55, spd: 0.45 }, value: 1.0, x: 6, y: 18.5 },
  { key: 'CB3', side: 'def', group: 'CB', w: { cov: 0.5, spd: 0.35, tkl: 0.15 }, value: 0.9, x: 5, y: -11 },
  { key: 'OLB', side: 'def', group: 'LB', w: { rush: 0.4, cov: 0.3, tkl: 0.3 }, value: 1.0, x: 4.5, y: 5 },
  { key: 'MLB', side: 'def', group: 'LB', w: { tkl: 0.5, acc: 0.25, str: 0.25 }, value: 1.0, x: 4.5, y: -1 },
  { key: 'LE', side: 'def', group: 'DL', w: { rush: 0.6, spd: 0.25, str: 0.15 }, value: 1.1, x: 1, y: 5.5 },
  { key: 'DE', side: 'def', group: 'DL', w: { rush: 0.5, str: 0.35, tkl: 0.15 }, value: 1.05, x: 1, y: -5.5 },
  { key: 'DT1', side: 'def', group: 'DL', w: { str: 0.55, tkl: 0.25, blk: 0.2 }, value: 0.95, x: 1, y: 1.4 },
  { key: 'DT2', side: 'def', group: 'DL', w: { str: 0.5, tkl: 0.4, blk: 0.1 }, value: 0.9, x: 1, y: -1.4 },
  // Special teams: the kicker (field goals, extra points, kickoffs) and the punter.
  { key: 'K', side: 'st', group: 'K', w: { kac: 0.55, kpw: 0.45 }, value: 0.6, x: -7, y: 0 },
  { key: 'P', side: 'st', group: 'P', w: { kpw: 0.6, kac: 0.4 }, value: 0.45, x: -14, y: 0 },
];
export const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
export const SLOT_KEYS = SLOTS.map((s) => s.key);
export const OFF_SLOTS = SLOTS.filter((s) => s.side === 'off').map((s) => s.key);
export const DEF_SLOTS = SLOTS.filter((s) => s.side === 'def').map((s) => s.key);
export const ST_SLOTS = SLOTS.filter((s) => s.side === 'st').map((s) => s.key);

// Percentile of v within a sorted array (ties count half).
function percentile(sorted, v) {
  let lo = 0, hi = 0;
  for (const x of sorted) { if (x < v) lo++; else if (x === v) hi++; }
  return (lo + hi / 2) / sorted.length;
}

// Inverse of the standard normal CDF (Acklam's approximation, plenty for ratings).
function invNorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(p, 1 - p);
  let z;
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    z = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  } else {
    const r = (q - 0.5) * (q - 0.5), t = q - 0.5;
    z = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return p > 0.5 ? -z : z;
}

// Where v sits in the pool as a z-score: ranks are mapped onto a bell curve so the elite
// pull away from the pack and the dregs fall off. Values past the pool's best (legendaries)
// keep climbing at the pool's spread.
function zScore(sorted, v) {
  const n = sorted.length, top = sorted[n - 1], zTop = invNorm(1 - 0.5 / n);
  if (v > top) {
    const sd = (top - sorted[Math.floor(n * 0.16)]) / (zTop + 1) || 1;
    return zTop + (v - top) / sd;
  }
  return invNorm(Math.min(1 - 0.5 / n, Math.max(0.5 / n, percentile(sorted, v))));
}

// Attributes center on 60 with a 16-point spread; position overalls center on 50 with a
// 16-point spread, so a 99 is the best in the league at that spot, an 80 is a solid starter
// and a 50 is a middling backup.
const ATTR_MID = 60, ATTR_SD = 16, OVR_MID = 50, OVR_SD = 16;

function buildPlayers() {
  const base = POKEMON.filter((p) => !p.legendary);
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const dist = Object.fromEntries(keys.map((k) => [k, base.map((p) => p.stats[k]).sort((a, b) => a - b)]));
  const wDist = base.map((p) => p.weight).sort((a, b) => a - b);
  const hDist = base.map((p) => p.height).sort((a, b) => a - b);
  // Raw attribute mixes from stat percentiles, height and weight. A build lifts only the
  // attributes of that build: a physical Pokémon is not also a quarterback, and base-stat
  // total is not added to every attribute.
  const raws = new Map();
  for (const p of POKEMON) {
    const q = Object.fromEntries(keys.map((k) => [k, percentile(dist[k], p.stats[k])]));
    const w = percentile(wDist, p.weight), h = percentile(hDist, p.height);
    const phys = 0.48 * q.atk + 0.24 * w + 0.18 * q.def + 0.1 * q.hp;
    const spec = 0.64 * q.spa + 0.36 * q.spd;
    const fast = 0.74 * q.spe + 0.26 * (1 - w);
    const axes = [phys, spec, fast].sort((a, b) => b - a);
    const gap = Math.max(0, axes[0] - axes[1]);
    // The leading build gets the lift, and only as clearly as it leads the other two.
    const lift = (axis) => (axis === axes[0] && gap > 0.04 ? 0.2 * gap + 0.06 * axis : 0);
    // A true all-rounder has no hole to tax. The lift is theirs alone, so Mew and Arceus
    // clear the pool instead of sitting in the middle of every curve. Everyone else stays a specialist.
    const round = isWildcard(p) ? 0.2 + Math.max(0, (bstOf(p) - 600) / 1200) : 0;
    const str = 0.58 * q.atk + 0.28 * w + 0.14 * q.hp;
    raws.set(p.id, {
      spd: 0.84 * q.spe + 0.16 * (1 - w) + lift(fast) + round,
      str: str + lift(phys) + round,
      blk: 0.48 * q.def + 0.22 * q.hp + 0.3 * w + lift(phys) + round,
      rush: 0.5 * q.atk + 0.32 * q.spe + 0.18 * q.def + round,
      arm: 0.8 * q.spa + 0.2 * q.atk + lift(spec) + round,
      acc: 0.58 * q.spa + 0.42 * q.spd + lift(spec) + round,
      hnd: 0.52 * q.spa + 0.28 * h + 0.2 * q.spe + lift(spec) + round,
      cov: 0.68 * q.spe + 0.2 * (1 - w) + 0.12 * q.def + lift(fast) + round,
      tkl: 0.42 * q.atk + 0.33 * q.def + 0.25 * w + lift(phys) + round,
      sta: 0.72 * q.hp + 0.28 * q.def + round,
      // Getting to top speed, and cutting: speed and lightness, not a special-attack bonus.
      acl: 0.66 * q.spe + 0.28 * (1 - w) + 0.06 * q.atk + lift(fast) + round,
      agi: 0.6 * q.spe + 0.26 * (1 - w) + 0.14 * (1 - h) + lift(fast) + round,
      // Reads come from composure (Sp. Def) and size, not from the same mix as accuracy.
      awr: 0.55 * q.spd + 0.25 * q.def + 0.2 * q.hp + round,
      // Kicking is its own job. Power is Attack and weight. Accuracy is a narrow composure mix,
      // so a fast special attacker is not also a 99 kicker. All-rounders are not exempt from that split.
      kpw: 0.62 * q.atk + 0.38 * w,
      kac: 0.86 * q.spd + 0.14 * q.hp,
    });
  }
  const rawDist = Object.fromEntries(Object.keys(ATTRS).map((k) => [k, base.map((p) => raws.get(p.id)[k]).sort((a, b) => a - b)]));
  const out = {};
  for (const p of POKEMON) {
    const raw = raws.get(p.id);
    const attrs = {};
    for (const k of Object.keys(ATTRS)) attrs[k] = Math.round(ATTR_MID + ATTR_SD * zScore(rawDist[k], raw[k]));
    const ability = pickAbility(p.abilities);
    // Always-on bonuses from type traits and unconditional abilities go into the
    // displayed ratings; conditional ones apply during games.
    const shown = { ...attrs };
    for (const t of p.types) for (const [k, v] of Object.entries(TYPE_TRAITS[t].attr ?? {})) shown[k] += v;
    const ab = ABILITIES[ability];
    if (ab?.attr && !ab.when) {
      for (const [k, v] of Object.entries(ab.attr)) {
        if (k === 'all') for (const a of Object.keys(shown)) shown[a] += v;
        else shown[k] += v;
      }
    }
    if (ab?.special === 'download') {
      const best = Object.keys(shown).reduce((a, b) => (shown[a] >= shown[b] ? a : b));
      shown[best] += 4;
    }
    for (const k of Object.keys(shown)) shown[k] = Math.max(10, Math.min(99, shown[k]));
    out[p.id] = { id: p.id, name: p.name, types: p.types, gen: p.gen, legendary: p.legendary, ability,
      stats: p.stats, height: p.height, weight: p.weight, attrs: shown, baseAttrs: { ...shown }, ovr: {} };
  }
  // Position overalls: the slot's attribute mix, graded on a curve against the whole pool.
  const ids = Object.keys(out);
  for (const s of SLOTS) {
    const sorted = base.map((p) => slotScore(out[p.id].attrs, s.key)).sort((a, b) => a - b);
    CURVES[s.key] = sorted;
    for (const id of ids) out[id].ovr[s.key] = curvedOverall(out[id].attrs, s.key);
  }
  for (const id of ids) specialize(out[id]);
  return out;
}

function slotScore(attrs, slot) {
  let v = 0;
  for (const [k, w] of Object.entries(SLOT[slot].w)) v += attrs[k] * w;
  return v;
}

// Base-pool slot scores, kept so league growth is graded on the same curve.
const CURVES = {};
function curvedOverall(attrs, slot) {
  const z = zScore(CURVES[slot], slotScore(attrs, slot));
  return Math.max(1, Math.min(99, Math.round(OVR_MID + OVR_SD * z)));
}

// The usual pseudo-legendaries: one extra group at full value, and nothing else.
const PSEUDO = /^(Dragonite|Tyranitar|Salamence|Metagross|Garchomp|Hydreigon|Goodra|Kommo-o|Dragapult|Baxcalibur)$/;
const statList = (p) => Object.values(p.stats);
const bstOf = (p) => statList(p).reduce((a, b) => a + b, 0);
// A wildcard is a legendary with a very high base-stat total and no dump stat: Mew, Arceus,
// Mewtwo and the other true all-rounders. A one-dimensional legendary stays elite at one group.
function isWildcard(p) {
  if (!p.legendary) return false;
  const vals = statList(p), bst = bstOf(p);
  if (bst < 600) return false;
  const min = Math.min(...vals), mean = bst / vals.length;
  return min >= 80 && min >= mean * 0.72;
}
function isPseudo(p) {
  return !p.legendary && bstOf(p) >= 590 && bstOf(p) <= 610 && PSEUDO.test(p.name);
}

// Same-family flex: corner and safety, kicker and punter, end and outside linebacker.
// Receiver and tight end are a step down from that. Left and right tackle are one group.
function family(primary, bestSlot, slotKey) {
  const g = SLOT[slotKey].group;
  if (g === primary) return 'home';
  if ((primary === 'CB' && g === 'S') || (primary === 'S' && g === 'CB')) return 'flex';
  if ((primary === 'K' && g === 'P') || (primary === 'P' && g === 'K')) return 'flex';
  if ((bestSlot === 'LE' || bestSlot === 'DE') && slotKey === 'OLB') return 'flex';
  if (bestSlot === 'OLB' && (slotKey === 'LE' || slotKey === 'DE')) return 'flex';
  if ((primary === 'WR' && g === 'TE') || (primary === 'TE' && g === 'WR')) return 'step';
  return 'other';
}
function hasFamily(primary, bestSlot) {
  return primary === 'CB' || primary === 'S' || primary === 'WR' || primary === 'TE' || primary === 'K' || primary === 'P'
    || bestSlot === 'LE' || bestSlot === 'DE' || bestSlot === 'OLB';
}
function byJob(p) {
  return (a, b) => p.ovr[b] - p.ovr[a] || slotScore(p.attrs, b) - slotScore(p.attrs, a);
}
// After the per-slot curve: one primary group, a specialization tax on the others.
// Wildcards skip the tax but keep only two groups at 95 or better.
const CAP = { flex: 94, step: 86, other: 82, wild: 94, fifth: 94 };
function specialize(p) {
  const ranked = SLOT_KEYS.slice().sort(byJob(p));
  const bestSlot = ranked[0];
  const primary = SLOT[bestSlot].group;
  const groups = {};
  for (const s of SLOTS) {
    const sc = slotScore(p.attrs, s.key);
    if (groups[s.group] == null || sc > groups[s.group]) groups[s.group] = sc;
  }
  const order = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const second = order.find((g) => g !== primary);
  const wild = isWildcard(p);
  const pseudo = !wild && isPseudo(p);
  p.primary = primary;
  p.wildcard = wild;
  p.pseudo = pseudo;
  p.flex = !wild && (pseudo || hasFamily(primary, bestSlot));
  const keep = new Set([primary]);
  if ((wild || pseudo) && second) keep.add(second);
  for (const s of SLOTS) {
    if (keep.has(s.group)) continue;
    if (wild) { p.ovr[s.key] = Math.min(p.ovr[s.key], CAP.wild); continue; }
    if (pseudo) { p.ovr[s.key] = Math.min(p.ovr[s.key], CAP.other); continue; }
    const rel = family(primary, bestSlot, s.key);
    if (rel === 'flex') p.ovr[s.key] = Math.min(p.ovr[s.key], CAP.flex);
    else if (rel === 'step') p.ovr[s.key] = Math.min(p.ovr[s.key], CAP.step);
    else p.ovr[s.key] = Math.min(p.ovr[s.key], CAP.other);
  }
  // A non-wildcard is 99 in one job, not 95-plus at a fifth slot.
  if (!wild) {
    const slots = SLOT_KEYS.slice().sort(byJob(p));
    for (let i = 4; i < slots.length; i++) if (p.ovr[slots[i]] >= 95) p.ovr[slots[i]] = CAP.fifth;
  }
  p.best = SLOT_KEYS.slice().sort(byJob(p));
}

// What the draft board and the depth chart show: the primary group, plus Flex or Wildcard.
export function roleLabel(p) {
  if (!p) return '';
  const g = p.primary || (p.best?.[0] && SLOT[p.best[0]]?.group) || '';
  if (p.wildcard) return `${g} · Wildcard`;
  if (p.flex) return `${g} · Flex`;
  return g;
}

export const PLAYERS = buildPlayers();
// Only Pokémon with a 3D model are in the game. The rest stay in PLAYERS, rated on the same
// curve, so old saves, box scores and record books still name them, but nobody can draft,
// sign or play one (league.js swaps them off saved rosters).
export const ALL_IDS = Object.keys(PLAYERS).map(Number).filter((id) => id in MODEL_INDEX);
export const RETIRED = new Set(Object.keys(PLAYERS).map(Number).filter((id) => !(id in MODEL_INDEX)));

// League development: growth = { id: { attr: points } } on top of the base ratings.
// PLAYERS is shared, so the active league's growth is applied in place.
let appliedGrowth = null;
export function applyGrowth(growth = {}) {
  if (growth === appliedGrowth) return;
  const touched = new Set([...Object.keys(appliedGrowth ?? {}), ...Object.keys(growth)]);
  appliedGrowth = growth;
  for (const key of touched) {
    const p = PLAYERS[key];
    if (!p) continue;
    const add = growth[key] ?? {};
    for (const k of Object.keys(p.baseAttrs)) p.attrs[k] = Math.max(10, Math.min(99, p.baseAttrs[k] + (add[k] ?? 0)));
    for (const s of SLOTS) p.ovr[s.key] = curvedOverall(p.attrs, s.key);
    specialize(p);
  }
}

// Typical starter quality at each slot (70th percentile of the non-legendary pool),
// used to judge how much a pick improves a roster.
export const BASELINE = Object.fromEntries(SLOT_KEYS.map((k) => {
  const vals = ALL_IDS.filter((id) => !PLAYERS[id].legendary).map((id) => PLAYERS[id].ovr[k]).sort((a, b) => a - b);
  return [k, vals[Math.floor(vals.length * 0.7)]];
}));

// Best assignment of a roster to the 22 slots: greedy by slot value, then pairwise swaps.
export function autoDepthChart(rosterIds) {
  const lineup = {};
  const free = new Set(rosterIds);
  const order = SLOTS.slice().sort((a, b) => b.value - a.value);
  for (const s of order) {
    let best = null;
    for (const id of free) if (best === null || PLAYERS[id].ovr[s.key] > PLAYERS[best].ovr[s.key]) best = id;
    if (best !== null) { lineup[s.key] = best; free.delete(best); }
  }
  const score = (slot, id) => (id == null ? 0 : SLOT[slot].value * PLAYERS[id].ovr[slot]);
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    const keys = Object.keys(lineup);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i], b = keys[j];
        const before = score(a, lineup[a]) + score(b, lineup[b]);
        const after = score(a, lineup[b]) + score(b, lineup[a]);
        if (after > before + 0.01) { [lineup[a], lineup[b]] = [lineup[b], lineup[a]]; improved = true; }
      }
      for (const id of free) {
        const a = keys[i];
        if (score(a, id) > score(a, lineup[a]) + 0.01) { free.add(lineup[a]); free.delete(id); lineup[a] = id; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { lineup, bench: [...free] };
}

// Unit ratings used for draft grades and AI play calling.
export function unitRatings(lineup) {
  const o = (k) => (lineup[k] != null ? PLAYERS[lineup[k]].ovr[k] : 30);
  const a = (k, attr) => (lineup[k] != null ? PLAYERS[lineup[k]].attrs[attr] : 30);
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ol = ['LT', 'LG', 'C', 'RG', 'RT'];
  return {
    passOff: 0.4 * o('QB') + 0.35 * avg(['WR1', 'WR2', 'WR3', 'TE'].map(o)) + 0.25 * avg(ol.map((k) => a(k, 'blk'))),
    runOff: 0.4 * o('RB') + 0.45 * avg(ol.map((k) => (a(k, 'blk') + a(k, 'str')) / 2)) + 0.15 * o('TE'),
    passRush: 0.8 * avg(['LE', 'DE', 'DT1', 'DT2'].map((k) => a(k, 'rush'))) + 0.2 * a('OLB', 'rush'),
    coverage: avg(['CB1', 'CB2', 'CB3', 'FS', 'SS'].map(o)),
    runDef: avg(['DT1', 'DT2', 'MLB', 'OLB', 'SS'].map((k) => (a(k, 'tkl') + a(k, 'str')) / 2)),
  };
}
