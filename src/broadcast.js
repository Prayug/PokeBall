// The broadcast package's words and numbers: drive charts, the booth's one-liners, the player
// lower-thirds and the stingers. Everything here is read from the game's own record (its log,
// drives and stats) and the notes a live play leaves, so it works the same for a live play, a
// simulated one and a replayed save. The screens in screens/broadcast.js draw it.
import { PLAYERS } from './ratings.js';
import { OFF_PLAYS, clockText } from './engine.js';
import { STADIUMS, TIMES, venueOf } from './kits.js';
import { WEATHER } from './types.js';

const nm = (id) => PLAYERS[id]?.name ?? 'nobody';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- drives ----------
// The plays of a drive as segments on the field, in absolute yards (0 is the home team's goal
// line): where each snap started and where the ball ended, and what kind of play it was. A
// drive saved before drives kept their place in the log has none.
export function driveSegs(g, d) {
  if (!d || d.at == null) return [];
  const i = g.drives.indexOf(d);
  const end = i < 0 ? g.log.length : g.drives[i + 1]?.at ?? g.drive?.at ?? g.log.length;
  return g.log.slice(d.at, end)
    .filter((e) => e.team === d.team && e.from != null && e.to != null && !e.conversion && e.kind !== 'kick')
    .map((e) => ({ from: e.from, to: e.to, kind: segKind(e), yards: e.yards ?? 0, td: e.highlight === 'td', n: e.n }));
}
function segKind(e) {
  if (e.kind === 'penalty') return 'flag';
  if (e.kind === 'turnover' || e.highlight === 'turnover') return 'to';
  const k = OFF_PLAYS[e.off]?.kind;
  if (k === 'punt' || k === 'fg') return 'kick';
  if (e.highlight === 'sack') return 'sack';
  return k === 'pass' ? 'pass' : 'run';
}
// The drive in progress, or the last one finished.
export function currentDrive(g) { return g.drive ?? g.drives[g.drives.length - 1] ?? null; }
// Game time a drive took, from its first snap to its last.
export function driveTime(g, d) {
  const segs = driveSegs(g, d);
  const last = segs.length ? g.log[segs[segs.length - 1].n] : null;
  if (!last) return 0;
  return Math.max(0, (last.q - d.q) * 900 + d.clock - last.clock);
}
export function driveLine(g, d) {
  return `${plural(d.plays, 'play')} · ${d.yards} yd${d.yards === 1 ? '' : 's'} · ${clockText(driveTime(g, d))}`;
}

// ---------- the player lower-third ----------
function slotOf(t, id) { return Object.keys(t.lineup).find((k) => t.lineup[k] === id) ?? ''; }
// A player's line for today: what he has done in this game, by what he does.
export function statLine(g, ti, id) {
  const s = g.teams[ti].stats[id];
  if (!s) return 'No stats yet today';
  const parts = [];
  if (s.pa) parts.push(`${s.pc}/${s.pa}, ${s.py} yds${s.ptd ? `, ${plural(s.ptd, 'TD')}` : ''}${s.pint ? `, ${s.pint} INT` : ''}`);
  if (s.ra) parts.push(`${plural(s.ra, 'carry').replace('carrys', 'carries')}, ${s.ry} yds${s.rtd ? `, ${plural(s.rtd, 'TD')}` : ''}`);
  if (s.rc) parts.push(`${plural(s.rc, 'catch').replace('catchs', 'catches')}, ${s.rcy} yds${s.rctd ? `, ${plural(s.rctd, 'TD')}` : ''}`);
  if (s.tk || s.dsk || s.dint) parts.push([s.tk ? plural(s.tk, 'tackle') : '', s.dsk ? `${s.dsk} sack${s.dsk === 1 ? '' : 's'}` : '', s.dint ? `${s.dint} INT` : ''].filter(Boolean).join(', '));
  return parts.join(' · ') || 'No stats yet today';
}
// Who the broadcast puts up before a drive's first snap: the offense's busiest playmaker today,
// or its quarterback on the first drive.
export function playerToWatch(g, ti = g.poss) {
  const t = g.teams[ti];
  let best = t.lineup.QB, top = 0;
  for (const k of ['RB', 'WR1', 'WR2', 'WR3', 'TE', 'QB']) {
    const id = t.lineup[k], s = t.stats[id];
    if (id == null || !s) continue;
    const v = s.ry + s.rcy + s.py * 0.4 + (s.rtd + s.rctd + s.ptd) * 25;
    if (v > top) { top = v; best = id; }
  }
  const p = PLAYERS[best];
  if (!p) return null;
  return { id: best, ti, name: p.name, slot: slotOf(t, best), types: p.types, line: statLine(g, ti, best), team: t };
}

// ---------- the booth ----------
// One line from the booth after a play, or '' when there is nothing worth saying. The play's
// own notes (a type matchup, an ability, size, the weather) are on the result card already; the
// booth adds what they mean for the game: the score, the streaks, the milestones, the clock.
export function boothAfter(g, e, before = null, notes = []) {
  if (!e || e.kind === 'info' || e.kind === 'sub') return '';
  const o = e.team ?? before?.poss ?? g.poss, T = g.teams[o], D = g.teams[1 - o];
  const pick = (opts) => opts[(g.log.length + (e.n ?? 0)) % opts.length];
  const lead = g.score[o] - g.score[1 - o];
  const late = g.quarter >= 4 && g.clock <= 300;
  if (e.highlight === 'td' || (e.kind === 'score' && /TOUCHDOWN/.test(e.text))) {
    const d = g.drives[g.drives.length - 1];
    const drv = d && d.team === o && d.plays >= 8 ? ` A ${d.plays}-play march.` : d && d.team === o && d.plays <= 2 ? ' That was quick.' : '';
    if (late && lead > 0 && lead <= 8) return `${T.abbr} take the lead late!${drv}`;
    if (lead === 0) return `All square at ${g.score[0]}.${drv}`;
    return pick([`${T.name} find the end zone.${drv}`, `Six for ${T.abbr}.${drv}`, `${T.abbr} punch it in.${drv}`]);
  }
  if (e.kind === 'turnover' || e.highlight === 'turnover') {
    const n = D.team?.to ?? 0;
    return pick([`${D.abbr} take it away${n ? ` — ${T.abbr} have turned it over ${plural(n, 'time')} today` : ''}.`, `Huge swing. ${D.name} have the ball.`]);
  }
  if (e.highlight === 'sack') {
    return pick([`The pocket collapses on ${T.abbr}.`, `${D.abbr} get home${D.team?.sacks > 1 ? ` again: ${D.team.sacks} sacks today` : ''}.`]);
  }
  if (e.kind === 'score' && e.highlight === 'fg') return late && Math.abs(lead) <= 3 ? 'Points on the board, and this one goes down to the wire.' : 'Three points. The drive stalled, but it ends with points.';
  // Milestones: the yards a player has piled up today.
  const c = e.carrier, s = c != null ? T.stats[c] : null;
  if (s && e.yards > 0) {
    for (const [have, add, what] of [[s.ry, e.yards, 'rushing'], [s.rcy, e.yards, 'receiving']]) {
      if (have >= 100 && have - add < 100) return `That's ${have} ${what} yards on the day for ${nm(c)}.`;
    }
    const qb = T.lineup.QB, q = T.stats[qb];
    if (q && q.py >= 300 && q.py - e.yards < 300) return `${nm(qb)} goes over 300 passing yards.`;
  }
  if (before && before.down === 3 && g.poss === o && g.down === 1 && before.toGo >= 7) return `${T.abbr} convert on third and ${before.toGo}.`;
  if (before && before.down === 4 && g.poss === o && g.down === 1) return `They went for it on fourth down, and ${T.abbr} keep the ball.`;
  if ((e.yards ?? 0) >= 20) {
    const longest = Math.max(0, ...g.log.filter((x) => x !== e && x.team === o && x.n < e.n).map((x) => x.yards ?? 0));
    return e.yards > longest ? `${nm(c)} for ${e.yards}, ${T.abbr}'s longest play of the day.` : `${nm(c)} rips off ${e.yards} yards.`;
  }
  const typeNote = notes.find((n) => n.kind === 'type' && /super effective/.test(n.text));
  if (typeNote) return pick(['You can see the type matchup winning that rep.', 'That type matchup is going to be a problem all day.']);
  if (notes.some((n) => n.kind === 'weather')) return WEATHER[g.weather]?.name ? `${WEATHER[g.weather].name} is part of this game now.` : '';
  return '';
}

// The strip under the scorebug before the snap: the situation, or a stat that fits it.
export function boothBefore(g) {
  if (g.final || g.phase !== 'play') return '';
  const o = g.poss, T = g.teams[o], D = g.teams[1 - o];
  const lead = g.score[o] - g.score[1 - o];
  if ((g.quarter === 2 || g.quarter >= 4) && g.clock <= 120) {
    if (g.quarter >= 4 && lead < 0 && lead >= -8) return `${T.abbr} need ${lead >= -3 ? 'a field goal to tie' : 'a touchdown'} · ${plural(g.timeouts?.[o] ?? 0, 'timeout')} left`;
    if (g.quarter === 2) return `Two-minute drill before the half · ${plural(g.timeouts?.[o] ?? 0, 'timeout')} left`;
  }
  if (g.down === 3) {
    const [made, tries] = T.team.third ?? [0, 0];
    return tries ? `${T.abbr} on third down today: ${made} of ${tries}` : `First third down of the day for ${T.abbr}`;
  }
  if (g.down === 4) return `Fourth and ${g.spot + g.toGo >= 100 ? 'goal' : g.toGo}: decision time for ${T.abbr}`;
  if (g.spot >= 80) return `Red zone · ${T.abbr} at the ${100 - g.spot}`;
  if (g.drive && g.drive.plays >= 1) return `Drive · ${driveLine(g, g.drive)}`;
  const tw = playerToWatch(g, o);
  return tw ? `${tw.slot} ${tw.name} · ${tw.line}` : `${D.abbr} on defense`;
}

// ---------- stingers ----------
// The full-screen wipe for the moments a broadcast cuts away for: touchdowns, takeaways,
// field goals, safeties, the end of a quarter, halftime and the final.
export function stingerFor(g, e, before) {
  if (!e) return null;
  const o = e.team ?? before?.poss ?? g.poss;
  if (e.highlight === 'td' || (e.kind === 'score' && /TOUCHDOWN/.test(e.text))) {
    // A pick-six or a return scores for the defense.
    const scorer = before ? [0, 1].find((i) => g.score[i] - before.score[i] >= 6) ?? o : o;
    return { kind: 'td', text: 'Touchdown', ti: scorer };
  }
  if (e.kind === 'turnover' || e.highlight === 'turnover') return { kind: 'to', text: /INTERCEPT/i.test(e.text) ? 'Interception' : /FUMBLE/i.test(e.text) ? 'Fumble' : 'Turnover', ti: 1 - o };
  if (e.kind === 'score' && e.highlight === 'fg') return { kind: 'fg', text: 'Field goal', ti: o };
  if (e.kind === 'score' && /safety/i.test(e.text)) return { kind: 'fg', text: 'Safety', ti: 1 - o };
  if (e.kind === 'quarter') return g.final && e.q >= 4 ? { kind: 'final', text: 'Final', ti: g.winner } : { kind: 'quarter', text: e.head ?? `End of quarter ${e.q}`, ti: null };
  return null;
}

// ---------- the open ----------
// The card that opens a broadcast: where, when, who and the weather.
export function openCard(g, records = null) {
  const v = venueOf(g);
  const [H, A] = g.teams;
  return {
    venue: v.name, stadium: STADIUMS[v.stadium].name, time: TIMES[v.time], night: v.time === 'night', roof: v.roof,
    weather: v.roof && g.weather === 'clear' ? 'Under the roof' : WEATHER[g.weather]?.name ?? '',
    home: H, away: A, records, playoff: !!g.playoff,
  };
}
