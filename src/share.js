// League sharing: a short code for a league's first draft (the seed, the settings, the user's
// team name and every pick made so far) that rebuilds the same draft in another browser. A
// friend can load the draft exactly as it went, or draft from the same seed themselves.
import { PLAYERS, SLOT_KEYS } from './ratings.js';
import * as LG from './league.js';

const VERSION = 1;
// The deployed game: share links point here when the game is opened from a file.
export const SHARE_URL = 'https://prayug.github.io/PokeBall/';

// The season-1 draft as it stands: every pick made so far, and the league's random state at that
// point (the schedule and the trade offer are drawn from it once the draft ends).
export function draftRecord(L) {
  if (!L) return null;
  if ((L.season ?? 1) > 1) return L.firstDraft ? { picks: L.firstDraft.picks, rng: L.firstDraft.rng ?? null } : null;
  const picks = L.picks.slice(0, L.pickIndex).map((p) => [p.player, p.slot]);
  return { picks, rng: L.phase === 'draft' ? L.rngState : L.draftRng ?? null };
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function encodeLeague(L) {
  const rec = draftRecord(L);
  if (!rec) return null;
  const me = L.teams.find((t) => t.user) ?? L.teams[0];
  const out = [VERSION];
  const u32 = (v) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const str = (s) => { const b = new TextEncoder().encode(String(s ?? '').slice(0, 24)); out.push(b.length, ...b); };
  const S = L.settings;
  u32(L.seed >>> 0);
  out.push((S.legendaries ? 1 : 0) | (S.typeCap ? 2 : 0) | (rec.rng != null ? 4 : 0), S.rounds, S.numTeams ?? L.teams.length);
  if (rec.rng != null) u32(rec.rng >>> 0);
  str(me.name); str(me.abbr);
  out.push((rec.picks.length >> 8) & 255, rec.picks.length & 255);
  // Each pick is 12 bits: the Pokémon, and whether it went somewhere other than the slot the
  // draft would put it in on its own (then 5 more bits name the slot).
  const order = LG.createLeague({ seed: L.seed, rounds: S.rounds, numTeams: S.numTeams ?? L.teams.length }).picks;
  const slots = L.teams.map(() => ({ slots: {} }));
  const bits = [];
  const put = (v, n) => { for (let k = n - 1; k >= 0; k--) bits.push((v >> k) & 1); };
  rec.picks.forEach(([id, slot], i) => {
    const team = slots[order[i].team];
    const custom = slot !== LG.bestOpenSlot(team, id);
    put(id, 11); put(custom ? 1 : 0, 1);
    if (custom) put(slot === 'BENCH' ? SLOT_KEYS.length : Math.max(0, SLOT_KEYS.indexOf(slot)), 5);
    if (slot !== 'BENCH' && slot) team.slots[slot] = id;
  });
  for (let k = 0; k < bits.length; k += 8) out.push(bits.slice(k, k + 8).reduce((a, v, j) => a | (v << (7 - j)), 0));
  return b64url(out);
}

// Accepts the code itself or any link carrying it (#league=… or ?league=…).
export function decodeLeague(text) {
  const m = /[#?&]league=([A-Za-z0-9_-]+)/.exec(String(text ?? '')) ?? /^\s*([A-Za-z0-9_-]{12,})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  let b;
  try { b = unb64url(m[1]); } catch { return null; }
  let i = 0;
  const need = (n) => { if (i + n > b.length) throw new Error('short'); };
  const u8 = () => { need(1); return b[i++]; };
  const u32 = () => { need(4); const v = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; i += 4; return v; };
  const str = () => { const n = u8(); need(n); const s = new TextDecoder().decode(b.slice(i, i + n)); i += n; return s; };
  try {
    if (u8() !== VERSION) return null;
    const seed = u32();
    const flags = u8(), rounds = u8(), numTeams = u8();
    const rng = flags & 4 ? u32() : null;
    const name = str(), abbr = str();
    const n = (u8() << 8) | u8();
    const picks = [];
    let bit = i * 8;
    const get = (nb) => {
      let v = 0;
      for (let k = 0; k < nb; k++, bit++) { if (bit >> 3 >= b.length) throw new Error('short'); v = (v << 1) | ((b[bit >> 3] >> (7 - (bit & 7))) & 1); }
      return v;
    };
    for (let k = 0; k < n; k++) {
      const id = get(11);
      if (!PLAYERS[id]) return null;
      // null: the slot the draft picks on its own (see leagueFromShare).
      const s = get(1) ? get(5) : -1;
      picks.push([id, s < 0 ? null : s === SLOT_KEYS.length ? 'BENCH' : SLOT_KEYS[s] ?? null]);
    }
    if (!rounds || numTeams < 2 || numTeams > 10 || n > rounds * numTeams) return null;
    return { code: m[1], seed, rounds, numTeams, legendaries: !!(flags & 1), typeCap: !!(flags & 2), rng, name, abbr, picks };
  } catch { return null; }
}

// A fresh league from the same seed and settings. With the picks, it is the shared draft as it
// went (the sharer's team becomes yours); without them, you draft against the same AI teams.
export function leagueFromShare(D, { replay = true, teamName, abbr } = {}) {
  const L = LG.createLeague({ teamName: replay ? D.name : teamName ?? D.name, abbr: replay ? D.abbr : abbr ?? D.abbr, rounds: D.rounds,
    legendaries: D.legendaries, typeCap: D.typeCap, numTeams: D.numTeams, seed: D.seed });
  if (!replay) return L;
  // Picks don't draw from the league's random state, so it can be set to the shared one first:
  // the schedule and the trade offer at the end of the draft come out the same.
  if (D.rng != null) L.rngState = D.rng;
  for (const [id, slot] of D.picks) {
    if (L.phase !== 'draft') break;
    const team = L.teams[LG.currentPick(L).team];
    if (!LG.available(L).includes(id)) throw new Error(`${PLAYERS[id]?.name ?? id} is picked twice`);
    const ok = slot === 'BENCH' || (slot && team.slots[slot] == null);
    LG.makePick(L, id, ok ? slot : null);
  }
  return L;
}
