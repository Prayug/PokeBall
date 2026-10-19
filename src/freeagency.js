// Free agency: after the offseason cuts and before the rookie draft, every team bids for the
// Pokémon in the pool (cut league-wide, or never drafted). Each Pokémon's salary comes from its overall rating,
// every team's payroll stays under one league cap, and each round every team may make one
// sealed bid: the highest bid signs, ties going to the team with the worse record.
import { PLAYERS, SLOT, SLOT_KEYS } from './ratings.js';
import { aiLikes, available, bestOpenSlot, keepValue, leagueRng, openRookieDraft, teamStrength } from './league.js';

// Two rounds, so every team still has at least two rookie picks after them.
export const FA_ROUNDS = 2;
// Lineup value an AI team needs per $1M it spends.
const VALUE_PER_M = 0.6;
const CAP_ROOM = 12;

const topOvr = (id) => PLAYERS[id].ovr[PLAYERS[id].best[0]];

// Asking salary, in millions, from the overall rating at the Pokémon's best position.
export function askingPrice(id) {
  return Math.max(1, Math.round((topOvr(id) - 50) ** 2 / 60));
}
export function salary(L, id) { return L.contracts?.[id] ?? askingPrice(id); }
export function payroll(L, team) { return team.roster.reduce((s, id) => s + salary(L, id), 0); }

// One cap for the whole league, set each time free agency opens: the biggest payroll after the
// cuts, plus some room, so every team can bid and the thinner rosters have the most to spend.
export function setCap(L) {
  L.cap = Math.ceil((Math.max(...L.teams.map((t) => payroll(L, t))) + CAP_ROOM) / 5) * 5;
  return L.cap;
}
export function leagueCap(L) { return L.cap ?? setCap(L); }
export function capSpace(L, team) { return leagueCap(L) - payroll(L, team); }

// Who goes if this team signs someone: nobody while the roster has room, else the lowest keep-value.
export function releaseFor(L, team, exclude = null) {
  if (team.roster.length < L.settings.rounds) return null;
  return team.roster.filter((id) => id !== exclude).sort((a, b) => keepValue(team, a) - keepValue(team, b))[0] ?? null;
}

// The most a team can bid on someone, releasing `release`.
export function maxBid(L, team, release) {
  return capSpace(L, team) + (release != null ? salary(L, release) : 0);
}

export function typeCapOk(L, team, id, release) {
  if (!L.settings.typeCap) return true;
  const t = PLAYERS[id].types[0];
  return team.roster.filter((x) => x !== release && PLAYERS[x].types[0] === t).length < 4;
}

export function openFreeAgency(L, cuts = {}) {
  L.contracts ??= {};
  setCap(L);
  L.fa = { round: 0, rounds: FA_ROUNDS, cuts, log: [], userBid: null };
  L.phase = 'freeagency';
}

// The pool, with who cut each Pokémon (null for never drafted).
export function faPool(L) {
  return available(L).map((id) => ({ id, cutBy: L.fa?.cuts?.[id] ?? null, ask: askingPrice(id) }));
}

// How much this signing (releasing `release`) adds to the team, in starting-lineup value.
export function signingGain(team, id, release) {
  const base = teamStrength(team.roster);
  return teamStrength([...team.roster.filter((x) => x !== release), id]) - base;
}

// Quick upper bound on what a Pokémon adds: its best upgrade over a current starter.
function quickUpgrade(team, id) {
  const p = PLAYERS[id];
  let best = 0;
  for (const k of SLOT_KEYS) {
    const cur = team.lineup[k] != null ? PLAYERS[team.lineup[k]].ovr[k] : 0;
    best = Math.max(best, SLOT[k].value * (p.ovr[k] - cur));
  }
  return best;
}

// Where a signing would play: the open slot it fills, or the starter it beats by the most.
export function signingSlot(team, id) {
  if (SLOT_KEYS.some((k) => team.lineup[k] == null)) return { slot: bestOpenSlot({ slots: team.lineup }, id), open: true, over: 0 };
  let best = null;
  for (const k of SLOT_KEYS) {
    const over = PLAYERS[id].ovr[k] - PLAYERS[team.lineup[k]].ovr[k];
    if (!best || SLOT[k].value * over > SLOT[best.slot].value * best.over) best = { slot: k, open: false, over };
  }
  return best;
}

// The pool ranked for one team: the signings that help it most, with the release each implies.
export function faTargets(L, team, limit = 40) {
  const pool = faPool(L).filter((p) => quickUpgrade(team, p.id) > 0)
    .sort((a, b) => quickUpgrade(team, b.id) - quickUpgrade(team, a.id)).slice(0, limit);
  return pool.map((p) => {
    const release = releaseFor(L, team);
    return { ...p, release, gain: Math.round(signingGain(team, p.id, release) * 10) / 10 };
  }).sort((a, b) => b.gain - a.gain);
}

// An AI team's one bid this round, or null. It goes after the best upgrade for the money, and
// pays more over the asking price the further that upgrade is ahead of its next choice.
function aiBid(L, team, r) {
  const space = capSpace(L, team);
  const options = [];
  for (const t of faTargets(L, team, 24)) {
    if (!typeCapOk(L, team, t.id, t.release)) continue;
    const value = t.gain + aiLikes(team, t.id) - (t.release != null ? aiLikes(team, t.release) : 0);
    const limit = space + (t.release != null ? salary(L, t.release) : 0);
    if (value <= 1 || t.ask > limit) continue;
    options.push({ ...t, value, limit, score: value - VALUE_PER_M * t.ask + (r() - 0.5) * 2 });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);
  const [best, next] = options;
  const surplus = next ? best.score - next.score : 4;
  const premium = 0.1 + Math.min(0.5, surplus / 8) + r() * 0.15;
  const amount = Math.min(best.limit, Math.max(best.ask, Math.round(best.ask * (1 + premium))));
  return { team: team.id, id: best.id, release: best.release, amount };
}

// Checks a user bid; returns why it can't be placed, or null.
export function bidProblem(L, team, id, release, amount) {
  if (L.phase !== 'freeagency') return 'Free agency is closed.';
  if (!available(L).includes(id)) return 'That Pokémon is no longer available.';
  const full = team.roster.length >= L.settings.rounds;
  if (full && (release == null || !team.roster.includes(release))) return 'Pick someone to release: your roster is full.';
  if (!full) release = null;
  if (!Number.isFinite(amount) || amount < askingPrice(id)) return `Bid at least the asking price of $${askingPrice(id)}M.`;
  if (amount > maxBid(L, team, release)) return `That is over the cap: you can bid up to $${maxBid(L, team, release)}M.`;
  if (!typeCapOk(L, team, id, release)) return `Already 4 ${PLAYERS[id].types[0]} types.`;
  return null;
}

// Run one round. userBid is { id, release, amount } or null to pass.
export function runFaRound(L, userBid = null) {
  if (L.phase !== 'freeagency') return null;
  const { r, save } = leagueRng(L);
  const bids = [];
  const me = L.teams.find((t) => t.user);
  if (me && userBid && !bidProblem(L, me, userBid.id, userBid.release, userBid.amount)) {
    bids.push({ team: me.id, id: userBid.id, release: me.roster.length >= L.settings.rounds ? userBid.release : null, amount: Math.round(userBid.amount) });
  }
  for (const t of L.teams) {
    if (t.user) continue;
    const b = aiBid(L, t, r);
    if (b) bids.push(b);
  }
  save();
  // Worse record wins ties: the last season's standings, last place first.
  const last = L.history[L.history.length - 1];
  const rank = (id) => (last ? -last.records.findIndex((x) => x.id === id) : 0);
  const byPlayer = new Map();
  for (const b of bids) (byPlayer.get(b.id) ?? byPlayer.set(b.id, []).get(b.id)).push(b);
  const signings = [];
  for (const [id, list] of byPlayer) {
    list.sort((x, y) => y.amount - x.amount || rank(x.team) - rank(y.team));
    const win = list[0];
    sign(L, L.teams[win.team], id, win.release, win.amount);
    signings.push({ round: L.fa.round + 1, id, team: win.team, amount: win.amount, release: win.release, bidders: list.map((b) => ({ team: b.team, amount: b.amount })) });
  }
  const userResult = userBid ? (signings.find((s) => s.id === userBid.id) ?? null) : null;
  L.fa.log.push(...signings);
  L.fa.last = { round: L.fa.round + 1, user: userBid ? { ...userBid, won: userResult?.team === me?.id, winner: userResult?.team ?? null, price: userResult?.amount ?? null } : null };
  L.fa.round++;
  if (L.fa.round >= L.fa.rounds) finishFreeAgency(L);
  return signings;
}

function sign(L, team, id, release, amount) {
  if (release != null) {
    team.roster = team.roster.filter((x) => x !== release);
    team.bench = team.bench.filter((x) => x !== release);
    for (const k of Object.keys(team.lineup)) if (team.lineup[k] === release) delete team.lineup[k];
    delete L.contracts[release];
  }
  team.roster.push(id);
  L.contracts[id] = amount;
  // Into the open slot where it helps most, as a draft pick would go; the bench if none is open.
  team.slots = { ...team.lineup };
  const slot = bestOpenSlot(team, id);
  if (slot === 'BENCH') team.bench.push(id);
  else { team.lineup[slot] = id; team.slots[slot] = id; }
}

// Sims the rounds left without the user and opens the rookie draft.
export function skipFreeAgency(L) {
  while (L.phase === 'freeagency') runFaRound(L, null);
}

export function finishFreeAgency(L) {
  if (L.phase !== 'freeagency') return;
  L.fa.done = true;
  openRookieDraft(L);
}

// Every Pokémon a team signed this period, for the screen and the season hub.
export function signingsBy(L, teamId) {
  return (L.fa?.log ?? []).filter((s) => s.team === teamId);
}
