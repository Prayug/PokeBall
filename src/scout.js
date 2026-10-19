// In-game scouting: the type edges on the field for the down about to be played, the other
// team's tendencies so far this game, and the call those tendencies point to ("Fits"). No DOM,
// so the call sheet, the panel under the field and the tests all read the same numbers.
import { DEF_PLAYS, OFF_PLAYS } from './engine.js';
import { DEF_SCHEMES } from './live/defense.js';
import { matchups } from './league.js';

// Type edges for the down: one row per matchup across the ball, edge > 0 for the user's side.
export function typeEdges(g, us) {
  const them = 1 - us, onOff = g.poss === us;
  const ms = onOff ? matchups(g.teams[us].lineup, g.teams[them].lineup) : matchups(g.teams[them].lineup, g.teams[us].lineup);
  const rows = ms.map((m) => ({ ...m, mine: onOff ? 'off' : 'def', edge: onOff ? m.net : -m.net }));
  return { rows, good: rows.filter((r) => r.edge > 0).length, bad: rows.filter((r) => r.edge < 0).length };
}

// The runs and passes logged this game (kicks and the rest left out).
const scrimmage = (g) => g.log.filter((e) => e.off && e.def && e.down && ['run', 'pass'].includes(OFF_PLAYS[e.off]?.kind));
const isRun = (e) => OFF_PLAYS[e.off].kind === 'run';
const pct = (list, f) => Math.round((100 * list.filter(f).length) / list.length);
const isBlitz = (d) => (DEF_SCHEMES[d]?.blitz?.length ?? 0) > 0;
const isZone = (d) => !!DEF_SCHEMES[d]?.zones && !DEF_SCHEMES[d]?.manUnder && !isBlitz(d);

// One-line tendencies for the panel: run and pass by down, blitzes, favorite calls.
export function tendencyLines(g, us) {
  const them = 1 - us;
  const plays = scrimmage(g);
  const theirOff = plays.filter((e) => e.team === them), theirDef = plays.filter((e) => e.team === us);
  const lines = [];
  const first = theirOff.filter((e) => e.down === 1);
  if (first.length >= 3) lines.push(`Run on 1st down ${pct(first, isRun)}% of the time, inside runs ${pct(first, (e) => e.off === 'inside_run')}% (${first.length} plays).`);
  const third = theirOff.filter((e) => e.down === 3);
  if (third.length >= 3) lines.push(`Pass on 3rd down ${pct(third, (e) => !isRun(e))}% (${third.length} plays).`);
  const long3 = theirDef.filter((e) => e.down >= 3 && e.toGo >= 7);
  if (long3.length >= 3) lines.push(`Blitz on 3rd and long ${pct(long3, (e) => isBlitz(e.def))}% (${long3.length} plays).`);
  const fav = (list, key, names) => {
    const counts = {};
    for (const e of list) counts[e[key]] = (counts[e[key]] ?? 0) + 1;
    const [k, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return `${names[k].name} ${Math.round((100 * c) / list.length)}%`;
  };
  if (theirOff.length >= 6) lines.push(`Favorite call on offense: ${fav(theirOff, 'off', OFF_PLAYS)}.`);
  if (theirDef.length >= 6) lines.push(`Favorite call on defense: ${fav(theirDef, 'def', DEF_PLAYS)}.`);
  return lines;
}

// The down and distance as a bucket: early (1st, 2nd) or late (3rd, 4th), and short, medium or long.
const bucket = (down, toGo) => [down >= 3 ? 'late' : 'early', toGo <= 3 ? 'short' : toGo <= 6 ? 'medium' : 'long'];
const SIT = { early: 'early downs', late: '3rd and 4th down' };
const NEED = 4;

// The calls the other team made on downs like this one: the same down bucket and distance, or
// the same down bucket alone when that is too few. Returns { list, label } or null.
function similar(g, list) {
  const [dn, ds] = bucket(g.down, g.toGo);
  const exact = list.filter((e) => bucket(e.down, e.toGo).join() === [dn, ds].join());
  if (exact.length >= NEED) return { list: exact, label: `${SIT[dn]} and ${ds}` };
  const broad = list.filter((e) => bucket(e.down, e.toGo)[0] === dn);
  if (broad.length >= NEED) return { list: broad, label: SIT[dn] };
  return null;
}

// The call the other team's tendencies on downs like this point to, and why:
// { call, why } or null while there is too little to go on (or nothing stands out).
export function tendencyFit(g, us) {
  const them = 1 - us;
  const plays = scrimmage(g);
  const n = (list, f) => list.filter(f).length;
  if (g.poss === us) {
    // Their defense on downs like this.
    const s = similar(g, plays.filter((e) => e.team === us));
    if (!s) return null;
    const L = s.list, t = L.length;
    const blitz = n(L, (e) => isBlitz(e.def)), zone = n(L, (e) => isZone(e.def)), man = t - blitz - zone;
    if (blitz / t >= 0.45) return { call: g.toGo >= 6 ? 'screen' : 'slant', why: `They blitz on ${s.label}: ${blitz} of ${t}` };
    if (zone / t >= 0.6) {
      const counts = {};
      for (const e of L) if (isZone(e.def)) counts[e.def] = (counts[e.def] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const call = { cover2: 'smash', tampa2: 'smash', cover3: 'flood', cover4: 'curl_flat', prevent: 'draw' }[top] ?? 'curl';
      return { call, why: `They sit in zone on ${s.label}: ${zone} of ${t}, mostly ${DEF_PLAYS[top].name}` };
    }
    if (man / t >= 0.6) return { call: 'mesh', why: `They play man on ${s.label}: ${man} of ${t}` };
    return null;
  }
  // Their offense on downs like this.
  const s = similar(g, plays.filter((e) => e.team === them));
  if (!s) return null;
  const L = s.list, t = L.length;
  const runs = n(L, isRun), passes = L.filter((e) => !isRun(e));
  if (runs / t >= 0.65) return { call: g.toGo <= 2 && g.spot >= 95 ? 'goal_line' : 'run_blitz', why: `They run on ${s.label}: ${runs} of ${t}` };
  if (passes.length / t >= 0.65) {
    const deep = n(passes, (e) => OFF_PLAYS[e.off].depth === 'deep'), quick = n(passes, (e) => ['short', 'screen'].includes(OFF_PLAYS[e.off].depth));
    if (deep / passes.length >= 0.4) return { call: 'cover4', why: `They throw deep on ${s.label}: ${deep} of ${t}` };
    if (quick / passes.length >= 0.6) return { call: 'man_press', why: `They throw quick on ${s.label}: ${quick} of ${t}` };
    return { call: 'tampa2', why: `They throw on ${s.label}: ${passes.length} of ${t}` };
  }
  return null;
}
