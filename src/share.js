// League sharing: a short code for a league's first draft (the seed, the settings, the user's
// team name and every pick made so far) that rebuilds the same draft in another browser. A
// friend can load the draft exactly as it went, or draft from the same seed themselves.
// Once the sharer has played, the code is also a challenge: it carries their first season's
// record, points and playoff finish, and the friend's league keeps score against it.
import { PLAYERS, RETIRED, SLOT_KEYS } from './ratings.js';
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

// The sharer's first season, for a challenge: the season so far while it is on, the whole of it
// once it is over (kept in L.firstSeason from the offseason on). Null before a game is played.
export function challengeRecord(L) {
  if (!L) return null;
  if ((L.season ?? 1) > 1) return L.firstSeason ?? null;
  const me = L.teams.find((t) => t.user) ?? L.teams[0];
  const s = LG.teamSeason(L, me.id);
  return s.gp ? s : null;
}

// A 16-bit check over the code's bytes: a challenge whose record was edited by hand, or a code
// cut short, doesn't decode. It doubles as the challenge's name (#3FA2).
function check16(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return (h ^ (h >>> 16)) & 0xffff;
}

export function encodeLeague(L, { challenge = true } = {}) {
  const rec = draftRecord(L);
  if (!rec) return null;
  const ch = challenge ? challengeRecord(L) : null;
  const me = L.teams.find((t) => t.user) ?? L.teams[0];
  const out = [VERSION];
  const u32 = (v) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const str = (s) => { const b = new TextEncoder().encode(String(s ?? '').slice(0, 24)); out.push(b.length, ...b); };
  const S = L.settings;
  u32(L.seed >>> 0);
  out.push((S.legendaries ? 1 : 0) | (S.typeCap ? 2 : 0) | (rec.rng != null ? 4 : 0) | (ch ? 8 : 0), S.rounds, S.numTeams ?? L.teams.length);
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
  // The challenge rides after the picks, so a build from before challenges reads the code as a
  // plain shared draft.
  if (ch) {
    const u16 = (v) => out.push((v >> 8) & 255, v & 255);
    out.push(Math.min(255, ch.gp), Math.min(255, ch.w), Math.min(255, ch.l), Math.min(255, ch.t));
    u16(Math.min(65535, ch.pf)); u16(Math.min(65535, ch.pa)); out.push(ch.finish ?? 0);
    u16(check16(out));
  }
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
    if (!rounds || numTeams < 2 || numTeams > LG.MAX_TEAMS || n > rounds * numTeams) return null;
    let challenge = null;
    if (flags & 8) {
      i = Math.ceil(bit / 8);
      const u16 = () => (u8() << 8) | u8();
      const c = { gp: u8(), w: u8(), l: u8(), t: u8(), pf: u16(), pa: u16(), finish: u8() };
      const end = i, sum = u16();
      if (sum !== check16(b.slice(0, end)) || c.w + c.l + c.t !== c.gp || c.finish > 5) return null;
      challenge = { ...c, id: sum.toString(16).toUpperCase().padStart(4, '0') };
    }
    return { code: m[1], seed, rounds, numTeams, legendaries: !!(flags & 1), typeCap: !!(flags & 2), rng, name, abbr, picks, challenge };
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
    // A draft shared before a Pokémon left the game can still pick it; it is swapped out below.
    const taken = L.teams.some((t) => t.roster.includes(id));
    if (RETIRED.has(id) ? taken : !LG.available(L).includes(id)) throw new Error(`${PLAYERS[id]?.name ?? id} is picked twice`);
    const ok = slot === 'BENCH' || (slot && team.slots[slot] == null);
    LG.makePick(L, id, ok ? slot : null);
  }
  LG.replaceRetired(L);
  return L;
}

// ---------- challenges ----------
export const recordText = (s) => `${s.w}-${s.l}${s.t ? `-${s.t}` : ''}`;
export const FINISH_SHORT = ['', 'missed the playoffs', 'lost a semifinal', 'lost the final', 'champions', 'lost in the first round'];
export function challengeText(C) {
  return C.finish ? `${recordText(C)}, ${FINISH_SHORT[C.finish]}` : `${recordText(C)} through ${C.gp} game${C.gp === 1 ? '' : 's'}`;
}

// A shared challenge, attached to the league that takes it on. mode: 'own' (drafted your own
// team from the same seed) or 'theirs' (playing the sharer's roster).
export function attachChallenge(L, D, mode) {
  if (!D?.challenge) return L;
  L.challenge = { ...D.challenge, name: D.name, abbr: D.abbr, mode, done: null };
  return L;
}

// Where the league's challenge stands. A whole-season mark is judged once your season is over:
// the better playoff finish wins, then the better record, then point differential. A mark made
// mid-season is judged on your first as many games: record, then point differential.
export function challengeStatus(L) {
  const C = L?.challenge;
  if (!C) return null;
  if (C.done) return C.done;
  const me = L.teams.find((t) => t.user) ?? L.teams[0];
  const first = (L.season ?? 1) === 1;
  let mine = C.finish ? (first ? LG.teamSeason(L, me.id) : L.firstSeason) : first ? LG.teamSeason(L, me.id, C.gp) : null;
  if (!mine) return { state: 'expired', mine: null };
  const ready = C.finish ? mine.finish > 0 : mine.gp >= C.gp;
  if (!ready) return { state: 'pending', mine };
  const net = (s) => s.w - s.l;
  const d = (C.finish ? LG.FINISH_RANK[mine.finish] - LG.FINISH_RANK[C.finish] : 0) || net(mine) - net(C) || (mine.pf - mine.pa) - (C.pf - C.pa);
  return { state: d > 0 ? 'won' : d < 0 ? 'lost' : 'tied', mine };
}
// Freezes a decided challenge so later seasons (whose results replace the first's) keep it.
export function settleChallenge(L) {
  const st = challengeStatus(L);
  if (st && !L.challenge.done && ['won', 'lost', 'tied'].includes(st.state)) L.challenge.done = st;
  return st;
}
