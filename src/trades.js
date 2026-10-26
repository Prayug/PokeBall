// Trade desk: deals between the user and an AI team, open from the end of the draft to the
// trade deadline. A deal moves up to three Pokémon each way and the next rookie draft's first-
// and second-round picks. Rosters keep their size: a team that takes in more Pokémon than it
// sends releases its lowest keep-values, and one left short signs the best Pokémon nobody has.
// AI teams weigh a deal by how much it changes their best lineup, the Pokémon their coach
// likes, and the picks, which a rebuilding team values more and a contender less. An AI team
// also brings the user an offer after the draft and, now and then, after a week's games.
import { PLAYERS, SLOT, SLOT_KEYS, autoDepthChart } from './ratings.js';
import { kickingUnit } from './engine.js';
import { aiLikes, available, keepValue, leagueRng, teamStrength } from './league.js';
import { powerRanking } from './weekly.js';
import { leagueCap, salary } from './freeagency.js';

export const MAX_PLAYERS = 3;
export const PICK_ROUNDS = 2;
// Share of the regular season before the deadline: through week 4 of 7, week 9 of 14, week 11 of 18.
const DEADLINE = 0.6;
// Chance an AI team calls after a week's games, while the window is open.
const WEEKLY_OFFER = 0.5;
// What an AI team needs out of a deal to say yes, and how far short still counts as close.
const ACCEPT = 1, CLOSE = -2.5;

const topOvr = (id) => PLAYERS[id].ovr[PLAYERS[id].best[0]];
const userTeam = (L) => L.teams.find((t) => t.user);

// ---------- the window ----------

// The week the deadline falls before (trades are allowed while L.week is below it).
export function tradeDeadline(L) {
  return Math.max(1, Math.ceil((L.schedule?.length ?? 0) * DEADLINE));
}
export function tradeWindow(L) {
  return L.phase === 'grades' || (L.phase === 'season' && L.week < tradeDeadline(L));
}
// The AI's offer to the user is on the table.
export function tradeOpen(L) {
  return L.trade?.status === 'open' && tradeWindow(L);
}

// ---------- picks ----------
// A pick is named by the season of the draft it belongs to, its round and the team it
// originally belonged to. L.pickOwners lists the ones that changed hands.

export const pickKey = (season, round, from) => `${season}:${round}:${from}`;
export function parsePick(key) {
  const [season, round, from] = key.split(':').map(Number);
  return { season, round, from };
}
export function pickOwner(L, season, round, from) {
  return L.pickOwners?.[pickKey(season, round, from)] ?? from;
}
// The tradeable picks a team holds: next season's first two rounds, its own and acquired ones.
export function picksOwned(L, teamId) {
  const season = (L.season ?? 1) + 1, out = [];
  for (let round = 1; round <= PICK_ROUNDS; round++) {
    for (const t of L.teams) if (pickOwner(L, season, round, t.id) === teamId) out.push(pickKey(season, round, t.id));
  }
  return out;
}
export function pickLabel(L, key) {
  const { season, round, from } = parsePick(key);
  return `Season ${season} round ${round} (${L.teams[from]?.abbr ?? '?'})`;
}

// The league ordered best to worst by the power ranking (record and margin once games are
// played, roster strength before that).
function ranking(L) { return powerRanking(L).map((x) => x.id); }

// Contending teams (the top third) want help now; rebuilding ones (the bottom third) want picks.
export function teamStance(L, teamId, order = ranking(L)) {
  const i = order.indexOf(teamId), n = order.length;
  return i < n / 3 ? 'contend' : i >= (2 * n) / 3 ? 'rebuild' : 'middle';
}
const PICK_WEIGHT = { contend: 0.7, middle: 1, rebuild: 1.35 };
const NOW_WEIGHT = { contend: 1.15, middle: 1, rebuild: 0.85 };

// A pick's worth, in the same lineup points a trade is measured in: a first-rounder from the
// team projected to finish last is worth about a good starter's upgrade.
export function pickValue(L, key, order = ranking(L)) {
  const { round, from } = parsePick(key);
  const n = order.length;
  const worse = n > 1 ? order.indexOf(from) / (n - 1) : 0.5;
  return round === 1 ? 1.5 + 4 * worse : 0.6 + 1.6 * worse;
}

// ---------- rosters after a deal ----------

// Brings a roster back to `size`: releases the lowest keep-values (never the Pokémon the deal
// brings in, `keep`), or signs the best free Pokémon (by how much each lifts the lineup).
// `skip` are Pokémon that can't be signed.
export function settle(L, team, roster, size, skip = [], keep = []) {
  roster = roster.slice();
  const released = [], signed = [];
  while (roster.length > size) {
    const tmp = { lineup: autoDepthChart(roster).lineup, coach: team.coach, favTypes: team.favTypes };
    const out = roster.filter((id) => !keep.includes(id)).reduce((a, b) => (keepValue(tmp, b) < keepValue(tmp, a) ? b : a));
    roster = roster.filter((x) => x !== out);
    released.push(out);
  }
  if (roster.length < size) {
    const blocked = new Set([...skip, ...released]);
    const typeOk = (id, ids) => !L.settings.typeCap || ids.filter((x) => PLAYERS[x].types[0] === PLAYERS[id].types[0]).length < 4;
    // Shortlist by the biggest upgrade over a starter (or the best overall), then try each.
    const lineup = autoDepthChart(roster).lineup;
    const lift = (id) => Math.max(...SLOT_KEYS.map((k) => SLOT[k].value * (PLAYERS[id].ovr[k] - (lineup[k] != null ? PLAYERS[lineup[k]].ovr[k] : 0))));
    const pool = available(L).filter((id) => !blocked.has(id)).map((id) => [id, lift(id)]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
    while (roster.length < size) {
      const base = teamStrength(roster);
      let best = null, bestGain = -Infinity;
      for (const id of pool) {
        if (signed.includes(id) || !typeOk(id, roster)) continue;
        const gain = teamStrength([...roster, id]) - base + topOvr(id) * 0.001;
        if (gain > bestGain) { best = id; bestGain = gain; }
      }
      if (best == null) break;
      roster.push(best); signed.push(best);
    }
  }
  return { roster, released, signed };
}

const emptyDeal = (team) => ({ team, send: [], get: [], sendPicks: [], getPicks: [] });
export function normalizeDeal(d) {
  return { team: d.team, send: [...(d.send ?? [])], get: [...(d.get ?? [])], sendPicks: [...(d.sendPicks ?? [])], getPicks: [...(d.getPicks ?? [])] };
}

// Everything about a deal from both sides. you/them: roster after, released, signed, lineup
// change. value: what it's worth to the AI team; verdict 'yes', 'close' or 'no'. problems:
// reasons it can't happen at all.
export function evaluateTrade(L, deal, order = ranking(L)) {
  deal = normalizeDeal(deal);
  const me = userTeam(L), ai = L.teams[deal.team];
  const problems = [];
  if (!ai || ai.user) return { deal, problems: ['Pick a team to trade with.'], verdict: 'no' };
  if (!deal.send.length && !deal.sendPicks.length) problems.push('Add something you send.');
  if (!deal.get.length && !deal.getPicks.length) problems.push('Add something you get.');
  if (deal.send.length > MAX_PLAYERS || deal.get.length > MAX_PLAYERS) problems.push(`At most ${MAX_PLAYERS} Pokémon each way.`);
  if (!deal.send.every((id) => me.roster.includes(id)) || !deal.get.every((id) => ai.roster.includes(id))) problems.push('Those Pokémon have moved since.');
  const mine = picksOwned(L, me.id), theirs = picksOwned(L, ai.id);
  if (!deal.sendPicks.every((k) => mine.includes(k)) || !deal.getPicks.every((k) => theirs.includes(k))) problems.push('Those picks have moved since.');
  if (problems.length) return { deal, problems, verdict: 'no' };

  const involved = [...deal.send, ...deal.get];
  const aiSide = settle(L, ai, [...ai.roster.filter((x) => !deal.get.includes(x)), ...deal.send], ai.roster.length, involved, deal.send);
  const meSide = settle(L, me, [...me.roster.filter((x) => !deal.send.includes(x)), ...deal.get], me.roster.length, [...involved, ...aiSide.signed], deal.get);
  const side = (team, s) => {
    const before = teamStrength(team.roster), after = teamStrength(s.roster);
    return { ...s, before, after, gain: Math.round((after - before) * 10) / 10 };
  };
  const you = side(me, meSide), them = side(ai, aiSide);

  // Hard rules: the cap, the type cap and injuries. The cap holds from week 1: the first trade
  // looked at sets it (the biggest payroll plus some room), and free agency resets it each year.
  const cap = leagueCap(L);
  for (const [t, s, name] of [[me, you, 'you'], [ai, them, ai.name]]) {
    const pay = s.roster.reduce((a, id) => a + salary(L, id), 0), before = t.roster.reduce((a, id) => a + salary(L, id), 0);
    s.payroll = pay;
    if (pay > cap && pay > before) problems.push(`That puts ${name === 'you' ? 'you' : name} over the $${cap}M cap ($${pay}M).`);
  }
  if (L.settings.typeCap) {
    for (const [t, s, name] of [[me, meSide, 'you'], [ai, aiSide, ai.name]]) {
      for (const id of s.roster) {
        const type = PLAYERS[id].types[0];
        const n = s.roster.filter((x) => PLAYERS[x].types[0] === type).length;
        if (n > 4 && n > t.roster.filter((x) => PLAYERS[x].types[0] === type).length) { problems.push(`That gives ${name} ${n} ${type} types (4 is the limit).`); break; }
      }
    }
  }
  const hurt = deal.send.filter((id) => L.injuries?.[id]);
  if (hurt.length) problems.push(`${ai.name} won't take an injured Pokémon (${hurt.map((id) => PLAYERS[id].name).join(', ')}).`);

  const stance = teamStance(L, ai.id, order);
  const likes = deal.send.reduce((a, id) => a + aiLikes(ai, id), 0) - deal.get.reduce((a, id) => a + aiLikes(ai, id), 0);
  const picks = PICK_WEIGHT[stance] * (deal.sendPicks.reduce((a, k) => a + pickValue(L, k, order), 0) - deal.getPicks.reduce((a, k) => a + pickValue(L, k, order), 0));
  const value = NOW_WEIGHT[stance] * (them.after - them.before) + likes + picks;
  // The user's side, in the same points without a stance: lineup change plus picks.
  const yours = (you.after - you.before) + deal.getPicks.reduce((a, k) => a + pickValue(L, k, order), 0) - deal.sendPicks.reduce((a, k) => a + pickValue(L, k, order), 0);
  const verdict = problems.length ? 'no' : value > ACCEPT ? 'yes' : value > CLOSE ? 'close' : 'no';
  return { deal, problems, you, them, stance, value: Math.round(value * 10) / 10, yours: Math.round(yours * 10) / 10, verdict };
}

// Why the AI team said what it did, in a sentence.
export function verdictText(L, ev) {
  const ai = L.teams[ev.deal.team];
  if (ev.problems?.length) return ev.problems[0];
  const why = { contend: 'They are chasing a title and want help now.', rebuild: 'They are rebuilding and like picks.', middle: '' }[ev.stance];
  if (ev.verdict === 'yes') return `${ai.name} would take that deal. ${why}`.trim();
  if (ev.verdict === 'close') return `${ai.name} are close but want a little more. ${why}`.trim();
  return `${ai.name} say no. ${why}`.trim();
}

// The smallest change that gets a no or a close to yes: add one of your picks or bench
// Pokémon, or take one of theirs off. Null when nothing simple works.
export function counterOffer(L, deal) {
  deal = normalizeDeal(deal);
  const order = ranking(L), me = userTeam(L);
  const starters = new Set(Object.values(me.lineup));
  const tries = [];
  for (const k of picksOwned(L, me.id)) if (!deal.sendPicks.includes(k)) tries.push({ ...deal, sendPicks: [...deal.sendPicks, k] });
  if (deal.send.length < MAX_PLAYERS) {
    const bench = me.roster.filter((id) => !deal.send.includes(id) && !L.injuries?.[id]).sort((a, b) => (starters.has(a) - starters.has(b)) || topOvr(b) - topOvr(a)).slice(0, 6);
    for (const id of bench) tries.push({ ...deal, send: [...deal.send, id] });
  }
  if (deal.get.length + deal.getPicks.length > 1) {
    for (const id of deal.get) tries.push({ ...deal, get: deal.get.filter((x) => x !== id) });
    for (const k of deal.getPicks) tries.push({ ...deal, getPicks: deal.getPicks.filter((x) => x !== k) });
  }
  let best = null;
  for (const d of tries) {
    const ev = evaluateTrade(L, d, order);
    if (ev.verdict === 'yes' && (!best || ev.yours > best.yours)) best = ev;
  }
  return best;
}

// ---------- making a trade ----------

// Puts a new Pokémon into every starting slot a departed one left, from what's left on the
// roster; everyone else is on the bench.
function refillLineup(team) {
  const on = new Set(team.roster);
  const used = new Set(Object.values(team.lineup).filter((id) => on.has(id)));
  for (const k of SLOT_KEYS) {
    if (on.has(team.lineup[k])) continue;
    const pick = team.roster.filter((id) => !used.has(id)).reduce((a, b) => (a == null || PLAYERS[b].ovr[k] > PLAYERS[a].ovr[k] ? b : a), null);
    if (pick == null) delete team.lineup[k]; else { team.lineup[k] = pick; used.add(pick); }
  }
  team.bench = team.roster.filter((id) => !used.has(id));
  team.slots = { ...team.lineup };
}

// Carries out an evaluated deal. by: 'you' (a proposal) or 'them' (their offer).
export function executeTrade(L, ev, by = 'you') {
  const { deal } = ev;
  const me = userTeam(L), ai = L.teams[deal.team];
  for (const [t, s] of [[ai, ev.them], [me, ev.you]]) {
    t.roster = s.roster.slice();
    for (const id of s.released) if (L.contracts) delete L.contracts[id];
  }
  for (const k of deal.sendPicks) L.pickOwners[k] = ai.id;
  for (const k of deal.getPicks) L.pickOwners[k] = me.id;
  for (const [ids, to] of [[deal.send, ai.id], [deal.get, me.id], [ev.them.signed, ai.id], [ev.you.signed, me.id]]) {
    for (const id of ids) {
      if (L.injuries?.[id]) L.injuries[id].team = to;
      if (L.seasonStats?.[id]) L.seasonStats[id].team = to;
    }
  }
  const { lineup, bench } = autoDepthChart(ai.roster);
  ai.lineup = lineup; ai.bench = bench; ai.slots = { ...lineup };
  refillLineup(me);
  const entry = { season: L.season ?? 1, week: L.phase === 'season' ? L.week : null, team: ai.id, by, ...deal,
    released: { you: ev.you.released, them: ev.them.released }, signed: { you: ev.you.signed, them: ev.them.signed }, gain: ev.you.gain };
  (L.tradeLog ??= []).push(entry);
  return entry;
}

// The user proposes a deal: done if the AI team says yes.
export function proposeTrade(L, deal) {
  if (!tradeWindow(L)) return { ok: false, ev: null, text: 'The trade deadline has passed.' };
  const ev = evaluateTrade(L, deal);
  if (ev.verdict !== 'yes') return { ok: false, ev, text: verdictText(L, ev) };
  return { ok: true, ev, entry: executeTrade(L, ev, 'you'), text: `Done. ${L.teams[ev.deal.team].name} accepted.` };
}

// The AI's offer on the table.
export function acceptTrade(L) {
  const T = L.trade;
  if (!tradeOpen(L)) return false;
  const ev = evaluateTrade(L, T);
  // Something changed since it was made (an injury, a release): the offer is off.
  if (ev.problems.length) { T.status = 'expired'; return false; }
  executeTrade(L, ev, 'them');
  T.status = 'accepted';
  return true;
}
export function declineTrade(L) {
  if (L.trade?.status === 'open') L.trade.status = 'declined';
}

// How your kicker and punter change if a deal goes through and the depth chart is auto-arranged
// (the lineup the gain is measured on). Null when neither changes.
export function tradeKicking(L, deal = L.trade) {
  const me = userTeam(L);
  if (!deal || !me) return null;
  const ev = evaluateTrade(L, deal);
  if (!ev.you) return null;
  const before = kickingUnit(me.lineup);
  const after = kickingUnit(autoDepthChart(ev.you.roster).lineup);
  const touched = [...ev.deal.send, ...ev.deal.get];
  const k = before.k?.id !== after.k?.id && (touched.includes(before.k?.id) || touched.includes(after.k?.id));
  const p = before.p?.id !== after.p?.id && (touched.includes(before.p?.id) || touched.includes(after.p?.id));
  return k || p ? { before, after, k, p } : null;
}

// ---------- AI offers ----------

// A quick estimate of how a team's best lineup changes when `out` leaves and `inn` arrives
// (either may be null), from its current auto lineup: the newcomer takes the slot it upgrades
// most, or the departed starter's slot (directly, or by sliding that slot's starter over), and
// a departed starter's slot otherwise goes to the best on the bench (or, when the roster comes
// up short, the best free Pokémon). Used to shortlist offers before the exact (much slower) count.
function quickContext(team, free) {
  const { lineup, bench } = autoDepthChart(team.roster);
  const slotOf = Object.fromEntries(Object.entries(lineup).map(([k, id]) => [id, k]));
  return { lineup, bench, slotOf, free };
}
function bestAt(ids, k, skip = null) {
  return ids.reduce((a, b) => (b === skip ? a : a == null || PLAYERS[b].ovr[k] > PLAYERS[a].ovr[k] ? b : a), null);
}
function quickDelta(ctx, out, inn) {
  const v = (k, id) => (id == null ? 0 : SLOT[k].value * PLAYERS[id].ovr[k]);
  const upgrade = (skip) => (inn == null ? 0 : Math.max(0, ...SLOT_KEYS.filter((k) => k !== skip).map((k) => v(k, inn) - v(k, ctx.lineup[k]))));
  const k = out != null ? ctx.slotOf[out] : null;
  if (k == null) return upgrade(null);
  const sub = bestAt(ctx.bench, k, out);
  if (inn == null) return Math.max(v(k, sub), v(k, bestAt(ctx.free, k))) - v(k, out);
  let best = Math.max(v(k, inn) - v(k, out), v(k, sub) - v(k, out) + upgrade(k));
  for (const s2 of SLOT_KEYS) {
    if (s2 === k) continue;
    const cur = ctx.lineup[s2];
    best = Math.max(best, v(s2, inn) - v(s2, cur) + v(k, cur) - v(k, out));
  }
  return best;
}

// The best deal one of `teams` would offer the user: a swap of one Pokémon each, a Pokémon for
// one of their picks, or one of theirs for one of your picks. Both sides have to come out ahead.
// Without a list, up to seven AI teams drawn at random (all of them in an 8-team league).
// Candidates are shortlisted by the quick estimate, then the best dozen are counted exactly.
export function makeTradeOffer(L, teams = null) {
  const me = userTeam(L);
  if (!me) return null;
  const { r, save } = leagueRng(L);
  if (!teams) {
    const ai = L.teams.filter((t) => !t.user);
    teams = [];
    while (teams.length < Math.min(7, ai.length)) {
      const t = ai[Math.floor(r() * ai.length)];
      if (!teams.includes(t)) teams.push(t);
    }
  }
  const order = ranking(L);
  const hurt = (id) => !!L.injuries?.[id];
  const free = available(L).sort((a, b) => topOvr(b) - topOvr(a)).slice(0, 40);
  const mc = quickContext(me, free);
  // Your ten best by overall, plus the kicker and punter, whose value is at their own slot.
  const mine = [...new Set([...me.roster.slice().sort((a, b) => topOvr(b) - topOvr(a)).slice(0, 10), me.lineup.K, me.lineup.P])].filter((id) => id != null && !hurt(id));
  const upgrade = (id, k) => me.lineup[k] == null || PLAYERS[id].ovr[k] > PLAYERS[me.lineup[k]].ovr[k];
  const myPicks = picksOwned(L, me.id);
  const found = [];
  const consider = (deal, you, them) => { if (you > 0.5 && them > ACCEPT) found.push({ deal, score: Math.min(you, them) + r() * 2 }); };
  const meBase = teamStrength(me.roster);
  for (const t of teams) {
    if (t.user) continue;
    const tc = quickContext(t, free);
    const base = teamStrength(t.roster);
    const stance = teamStance(L, t.id, order);
    const theirs = t.roster.filter((id) => !hurt(id) && upgrade(id, PLAYERS[id].best[0])).sort((a, b) => topOvr(b) - topOvr(a)).slice(0, 8);
    for (const k of ['K', 'P']) if (t.lineup[k] != null && !hurt(t.lineup[k]) && upgrade(t.lineup[k], k) && !theirs.includes(t.lineup[k])) theirs.push(t.lineup[k]);
    // One for one, counted exactly.
    for (const send of mine) {
      for (const get of theirs) {
        const you = teamStrength(me.roster.map((x) => (x === send ? get : x))) - meBase;
        if (you <= 0.5) continue;
        consider(emptyDealWith(t.id, [send], [get]), you,
          NOW_WEIGHT[stance] * (teamStrength(t.roster.map((x) => (x === get ? send : x))) - base) + aiLikes(t, send) - aiLikes(t, get));
      }
    }
    // Picks change the roster size, so those deals are shortlisted by the quick estimate and
    // the best two counted exactly.
    const shortlist = [];
    const quick = (deal, you, them) => shortlist.push({ deal, q: Math.min(you, them - ACCEPT) });
    // A Pokémon of yours for one of their picks: a contender adding a piece.
    if (stance !== 'rebuild') {
      for (const key of picksOwned(L, t.id)) {
        const pv = pickValue(L, key, order);
        for (const send of me.roster) {
          if (hurt(send)) continue;
          quick({ ...emptyDeal(t.id), send: [send], getPicks: [key] }, quickDelta(mc, send, null) + pv,
            NOW_WEIGHT[stance] * quickDelta(tc, null, send) + aiLikes(t, send) - PICK_WEIGHT[stance] * pv);
        }
      }
    }
    // One of theirs for one of your picks: a rebuilder cashing in.
    if (stance !== 'contend') {
      for (const key of myPicks) {
        const pv = pickValue(L, key, order);
        for (const get of t.roster) {
          if (hurt(get)) continue;
          quick({ ...emptyDeal(t.id), get: [get], sendPicks: [key] }, quickDelta(mc, null, get) - pv,
            NOW_WEIGHT[stance] * quickDelta(tc, get, null) - aiLikes(t, get) + PICK_WEIGHT[stance] * pv);
        }
      }
    }
    for (const c of shortlist.sort((a, b) => b.q - a.q).slice(0, 2)) {
      const e = evaluateTrade(L, c.deal, order);
      if (!e.problems.length) consider(e.deal, e.yours, e.value);
    }
  }
  save();
  // The best-scoring deal that clears every rule (the cap, the type cap) and that they'd still
  // say yes to when counted exactly.
  found.sort((a, b) => b.score - a.score);
  let best = null;
  for (const c of found.slice(0, 12)) {
    const e = evaluateTrade(L, c.deal, order);
    if (e.verdict !== 'yes' || e.yours <= 0.5) continue;
    const score = Math.min(e.yours, e.value) + (c.score - Math.floor(c.score));
    if (!best || score > best.score) best = { ev: e, score };
  }
  if (!best) return null;
  const { ev } = best;
  return { ...ev.deal, gain: ev.you.gain, season: L.season ?? 1, week: L.phase === 'season' ? L.week : null, status: 'open' };
}
const emptyDealWith = (team, send, get) => ({ ...emptyDeal(team), send, get });

// After a week's games, before the deadline: last week's offer is off the table, and about
// half the time one of three AI teams calls with a new one.
export function weeklyTradeOffer(L) {
  if (L.trade && L.trade.status === 'open') L.trade.status = 'expired';
  if (L.trade && L.trade.status !== 'open') L.trade = null;
  if (!tradeWindow(L)) return null;
  const { r, save } = leagueRng(L);
  const roll = r();
  const ai = L.teams.filter((t) => !t.user);
  const pick = [];
  while (pick.length < Math.min(3, ai.length)) {
    const t = ai[Math.floor(r() * ai.length)];
    if (!pick.includes(t)) pick.push(t);
  }
  save();
  if (roll >= WEEKLY_OFFER) return null;
  L.trade = makeTradeOffer(L, pick);
  return L.trade;
}

// ---------- draft-day swaps ----------
// While the user is on the clock, an AI team that picks a little later can trade down with
// them: the user's pick now and a later pick of theirs for the AI's next pick and one of its
// picks a round or more on. Two picks each way, so every roster still drafts to full size.

// A pick's draft-day worth: steepest at the top of the draft, flatter later on, so a few spots
// in round 1 buy more spots a round or two later.
const slotWorth = (L, i) => 1 / (1 + i / (3 * L.teams.length));
// What the AI wants out of a swap: its side worth at least this much more.
const SWAP_EDGE = 0.004;

// "Round 2, pick 5 (13th overall)": the pick's place in its round and in the whole draft.
export function draftPickLabel(L, i, short = false) {
  const pk = L.picks[i];
  const inRound = L.picks.slice(0, i + 1).filter((p) => p.round === pk.round).length;
  return short ? `${pk.round}.${inRound}` : `Round ${pk.round}, pick ${inRound} (${ordinal(i + 1)} overall)`;
}
const ordinal = (n) => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : [, 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

// The best swap each AI team would take for the pick on the clock, at most `max` of them,
// the closest to even first. Empty unless the user is on the clock in a local draft.
export function draftSwapOffers(L, max = 3) {
  if (L.phase !== 'draft') return [];
  const i = L.pickIndex, me = userTeam(L);
  if (L.picks[i]?.team !== me.id) return [];
  const T = L.teams.length;
  const mine = L.picks.map((p, x) => x).filter((x) => x > i && L.picks[x].team === me.id);
  const offers = [];
  for (const t of L.teams) {
    if (t.user) continue;
    const theirs = L.picks.map((p, x) => x).filter((x) => x > i && L.picks[x].team === t.id);
    const j = theirs[0];
    // Trading down a full round or more is not a trade down.
    if (j == null || j - i >= T) continue;
    // The user's earliest later pick that buys a move up: the swap settles soon after.
    let best = null;
    for (const m of mine) {
      if (m <= j) continue;
      for (const k of theirs) {
        if (k <= j || k >= m) continue;
        const give = slotWorth(L, i) + slotWorth(L, m), get = slotWorth(L, j) + slotWorth(L, k);
        if (give - get < SWAP_EDGE) continue;
        if (!best || get > best.worth) best = { team: t.id, give: [i, m], get: [j, k], worth: get, edge: give - get };
      }
      if (best) break;
    }
    if (best) offers.push(best);
  }
  return offers.sort((a, b) => a.edge - b.edge || a.get[0] - b.get[0]).slice(0, max);
}

// Swaps who owns two picks (a[0] with b[0], a[1] with b[1]). A pick keeps the team it started
// with in `from` while someone else holds it.
export function swapDraftPicks(picks, a, b) {
  const pa = picks[a], pb = picks[b];
  const fa = pa.from ?? pa.team, fb = pb.from ?? pb.team;
  [pa.team, pb.team] = [pb.team, pa.team];
  pa.from = fa; pb.from = fb;
  if (pa.from === pa.team) delete pa.from;
  if (pb.from === pb.team) delete pb.from;
}

// Makes the swap if it is still on offer. In the first season it is kept in L.draftSwaps, so a
// shared league rebuilds the same draft order.
export function acceptDraftSwap(L, teamId) {
  const offer = draftSwapOffers(L, L.teams.length).find((o) => o.team === teamId);
  if (!offer) return null;
  for (let n = 0; n < 2; n++) {
    swapDraftPicks(L.picks, offer.give[n], offer.get[n]);
    if ((L.season ?? 1) === 1) (L.draftSwaps ??= []).push([offer.give[n], offer.get[n]]);
  }
  (L.draftDeals ??= []).push({ season: L.season ?? 1, team: teamId, give: offer.give, get: offer.get });
  return offer;
}

// ---------- saves ----------

// Saves from before trade desk 2.0: the one-for-one offer becomes a deal, and the pick and
// trade books start empty.
export function migrateTrades(L) {
  L.pickOwners ??= {};
  L.tradeLog ??= [];
  const T = L.trade;
  if (T && !Array.isArray(T.send)) {
    L.trade = { team: T.team, send: T.youSend != null ? [T.youSend] : [], get: T.youGet != null ? [T.youGet] : [], sendPicks: [], getPicks: [],
      gain: T.gain, season: T.season ?? L.season ?? 1, week: null, status: T.status ?? 'open' };
  }
}
