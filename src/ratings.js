// Football attributes derived from Pokémon base stats, and the 22 roster slots.
import { POKEMON } from './data.js';
import { pickAbility, TYPE_TRAITS, ABILITIES } from './types.js';

export const ATTRS = {
  spd: 'Speed', str: 'Strength', blk: 'Blocking', rush: 'Pass rush', arm: 'Arm',
  acc: 'Accuracy', hnd: 'Hands', cov: 'Coverage', tkl: 'Tackling', sta: 'Stamina',
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
  { key: 'WR1', side: 'off', group: 'WR', w: { spd: 0.45, hnd: 0.4, acc: 0.15 }, value: 1.1, x: -1, y: -21 },
  { key: 'WR2', side: 'off', group: 'WR', w: { spd: 0.45, hnd: 0.4, acc: 0.15 }, value: 1.0, x: -1, y: 21 },
  { key: 'WR3', side: 'off', group: 'WR', w: { hnd: 0.45, spd: 0.35, acc: 0.2 }, value: 0.9, x: -2, y: -13 },
  { key: 'TE', side: 'off', group: 'TE', w: { hnd: 0.35, blk: 0.35, str: 0.3 }, value: 0.95, x: -1, y: 7 },
  { key: 'FS', side: 'def', group: 'S', w: { cov: 0.45, spd: 0.3, acc: 0.25 }, value: 1.0, x: 15, y: -5 },
  { key: 'SS', side: 'def', group: 'S', w: { tkl: 0.45, cov: 0.35, spd: 0.2 }, value: 0.95, x: 9, y: 8 },
  { key: 'CB1', side: 'def', group: 'CB', w: { cov: 0.55, spd: 0.45 }, value: 1.1, x: 6, y: -21 },
  { key: 'CB2', side: 'def', group: 'CB', w: { cov: 0.55, spd: 0.45 }, value: 1.0, x: 6, y: 21 },
  { key: 'CB3', side: 'def', group: 'CB', w: { cov: 0.5, spd: 0.35, tkl: 0.15 }, value: 0.9, x: 5, y: -13 },
  { key: 'OLB', side: 'def', group: 'LB', w: { rush: 0.4, cov: 0.3, tkl: 0.3 }, value: 1.0, x: 4, y: 7 },
  { key: 'MLB', side: 'def', group: 'LB', w: { tkl: 0.5, acc: 0.25, str: 0.25 }, value: 1.0, x: 5, y: 0 },
  { key: 'LE', side: 'def', group: 'DL', w: { rush: 0.6, spd: 0.25, str: 0.15 }, value: 1.1, x: 1, y: 5.5 },
  { key: 'DE', side: 'def', group: 'DL', w: { rush: 0.5, str: 0.35, tkl: 0.15 }, value: 1.05, x: 1, y: -5.5 },
  { key: 'DT1', side: 'def', group: 'DL', w: { str: 0.55, tkl: 0.25, blk: 0.2 }, value: 0.95, x: 1, y: 1.4 },
  { key: 'DT2', side: 'def', group: 'DL', w: { str: 0.5, tkl: 0.4, blk: 0.1 }, value: 0.9, x: 1, y: -1.4 },
];
export const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
export const SLOT_KEYS = SLOTS.map((s) => s.key);
export const OFF_SLOTS = SLOTS.filter((s) => s.side === 'off').map((s) => s.key);
export const DEF_SLOTS = SLOTS.filter((s) => s.side === 'def').map((s) => s.key);

// Percentile of v within a sorted array (ties count half).
function percentile(sorted, v) {
  let lo = 0, hi = 0;
  for (const x of sorted) { if (x < v) lo++; else if (x === v) hi++; }
  return (lo + hi / 2) / sorted.length;
}

function buildPlayers() {
  const base = POKEMON.filter((p) => !p.legendary);
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const dist = Object.fromEntries(keys.map((k) => [k, base.map((p) => p.stats[k]).sort((a, b) => a - b)]));
  const wDist = base.map((p) => p.weight).sort((a, b) => a - b);
  const hDist = base.map((p) => p.height).sort((a, b) => a - b);
  const out = {};
  for (const p of POKEMON) {
    const q = Object.fromEntries(keys.map((k) => [k, percentile(dist[k], p.stats[k])]));
    const w = percentile(wDist, p.weight), h = percentile(hDist, p.height);
    const str = 0.6 * q.atk + 0.4 * w;
    const raw = {
      spd: 0.8 * q.spe + 0.2 * (1 - w),
      str,
      blk: 0.5 * q.def + 0.3 * q.hp + 0.2 * w,
      rush: 0.5 * q.atk + 0.3 * q.spe + 0.2 * str,
      arm: 0.7 * q.spa + 0.3 * q.atk,
      acc: 0.6 * q.spd + 0.4 * q.spa,
      hnd: 0.5 * q.spa + 0.3 * q.spe + 0.2 * h,
      cov: 0.5 * q.spe + 0.3 * q.spd + 0.2 * q.def,
      tkl: 0.4 * q.atk + 0.4 * q.def + 0.2 * w,
      sta: q.hp,
    };
    const attrs = {};
    for (const [k, v] of Object.entries(raw)) attrs[k] = Math.max(1, Math.min(99, Math.round(25 + 74 * v)));
    const ability = pickAbility(p.abilities);
    // Always-on bonuses from type traits and unconditional abilities go into the
    // displayed ratings; conditional ones apply during games.
    const shown = { ...attrs };
    for (const t of p.types) for (const [k, v] of Object.entries(TYPE_TRAITS[t].attr ?? {})) shown[k] += v;
    const ab = ABILITIES[ability];
    if (ab?.attr && !ab.when) for (const [k, v] of Object.entries(ab.attr)) if (k !== 'all') shown[k] += v;
    if (ab?.special === 'download') {
      const best = Object.keys(shown).reduce((a, b) => (shown[a] >= shown[b] ? a : b));
      shown[best] += 4;
    }
    for (const k of Object.keys(shown)) shown[k] = Math.max(1, Math.min(99, shown[k]));
    const player = { id: p.id, name: p.name, types: p.types, gen: p.gen, legendary: p.legendary, ability,
      stats: p.stats, height: p.height, weight: p.weight, attrs: shown, baseAttrs: { ...shown }, ovr: {} };
    for (const s of SLOTS) player.ovr[s.key] = slotOverall(shown, s.key);
    player.best = SLOT_KEYS.slice().sort((a, b) => player.ovr[b] - player.ovr[a]);
    out[p.id] = player;
  }
  return out;
}

export function slotOverall(attrs, slot) {
  let v = 0;
  for (const [k, w] of Object.entries(SLOT[slot].w)) v += attrs[k] * w;
  return Math.round(v);
}

export const PLAYERS = buildPlayers();
export const ALL_IDS = Object.keys(PLAYERS).map(Number);

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
    for (const k of Object.keys(p.baseAttrs)) p.attrs[k] = Math.max(1, Math.min(99, p.baseAttrs[k] + (add[k] ?? 0)));
    for (const s of SLOTS) p.ovr[s.key] = slotOverall(p.attrs, s.key);
    p.best = SLOT_KEYS.slice().sort((a, b) => p.ovr[b] - p.ovr[a]);
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
