// Franchise kits and the broadcast package, without a browser: kits are validated and every
// team has one, a game's venue follows its home team's kit (a dome keeps the sky's weather out
// without changing the game's random stream), and over simulated games the drive charts, the
// booth's lines, the stingers and the player lower-thirds read sensibly from the game's record.
// Usage: node test/broadcast.mjs [games=40]
import { createGame, simPlay } from '../src/engine.js';
import * as LG from '../src/league.js';
import { STADIUM_KEYS, CHANT_KEYS, CHANTS, cleanKit, defaultKit, kitOf, venueFor, venueOf, wordmarkOf } from '../src/kits.js';
import { boothAfter, boothBefore, driveSegs, driveTime, playerToWatch, statLine, stingerFor } from '../src/broadcast.js';

const games = Number(process.argv[2] ?? 40);
let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log(`FAIL ${msg}`); } };
const t0 = Date.now();

// ---------- kits ----------
const team = { name: 'Pallet Starters', abbr: 'PAL', color: '#c8102e' };
const bad = cleanKit({ color2: 'red', wordmark: '   a   very long wordmark indeed   ', style: 'comic', stadium: 'moon', kickoff: 'noon', chant: 'kazoo' }, team);
ok(/^#[0-9a-f]{6}$/.test(bad.color2), 'a bad second color falls back to a hex color');
ok(bad.wordmark === 'a very long wordma', `wordmarks are trimmed to 18 characters (${bad.wordmark})`);
ok(STADIUM_KEYS.includes(bad.stadium) && CHANT_KEYS.includes(bad.chant) && bad.style === defaultKit(team).style && bad.kickoff === 'auto', 'unknown kit values fall back to the defaults');
ok(cleanKit(null, team).stadium === 'classic', 'no kit is the default kit');
ok(wordmarkOf({ ...team, kit: { wordmark: 'Starters' } }) === 'STARTERS' && wordmarkOf(team) === 'PALLET STARTERS', 'the wordmark, or the team name');
const L8 = LG.createLeague({ seed: 7 });
for (const t of L8.teams) {
  const k = kitOf(t);
  ok(STADIUM_KEYS.includes(k.stadium) && CHANT_KEYS.includes(k.chant) && /^#[0-9a-f]{6}$/i.test(k.color2), `${t.abbr} has a full kit`);
}
ok(new Set(L8.teams.map((t) => kitOf(t).stadium)).size >= 3, 'the league plays in at least three kinds of stadium');
for (const k of CHANT_KEYS) ok(CHANTS[k].steps.every(([kind, at]) => ['clap', 'stomp', 'drum', 'organ', 'shout'].includes(kind) && at >= 0 && at < CHANTS[k].beats * 2), `chant ${k} is well formed`);

// ---------- venues ----------
const times = { day: 0, dusk: 0, night: 0 };
for (let s = 1; s <= 400; s++) {
  const v = venueFor(team, { seed: s });
  times[v.time]++;
  ok(v.name === 'Pallet Bowl' && !v.roof, 'an open bowl named for the team');
  ok(venueFor(team, { seed: s }).time === v.time, 'the time of day is the same for the same game');
  ok(venueFor(team, { seed: s, playoff: true }).time === 'night', 'playoff games are in prime time');
  ok(venueFor({ ...team, kit: { stadium: 'haunted' } }, { seed: s }).time !== 'day', 'the haunted hollow never plays in daylight');
  ok(venueFor({ ...team, kit: { kickoff: 'day' } }, { seed: s }).time === 'day', 'a day-games kit plays in the afternoon');
  ok(venueFor({ ...team, kit: { stadium: 'dome' } }, { seed: s, neutral: true }).stadium === 'classic', 'neutral sites are open bowls');
}
ok(times.day > 120 && times.dusk > 40 && times.night > 80, `the schedule mixes day, dusk and night games (${JSON.stringify(times)})`);

// A dome keeps random weather out, and the game's random stream is the same in any stadium.
const Q = LG.quickRosters(11);
const [qa, qb] = Q.teams;
let wet = 0;
for (let s = 1; s <= 120; s++) {
  const open = createGame({ home: LG.teamForGame(qa), away: LG.teamForGame(qb), seed: s });
  const dome = createGame({ home: LG.teamForGame({ ...qa, kit: { stadium: 'dome' } }), away: LG.teamForGame(qb), seed: s });
  ok(open.rng === dome.rng, 'a dome does not change the random stream');
  ok(dome.venue.roof && dome.venue.stadium === 'dome', 'the home kit picks the venue');
  if (open.weather !== 'clear') wet++;
  ok(dome.weather === 'clear' || dome.weather === open.weather, 'under the roof the weather is clear unless a Pokémon brings it');
}
ok(wet > 10, `open-air games still get weather (${wet} of 120)`);
const old = createGame({ home: LG.teamForGame(qa), away: LG.teamForGame(qb), seed: 3 });
delete old.venue;
ok(venueOf(old).stadium === kitOf(qa).stadium && old.venue, 'a game saved before kits gets its venue');

// ---------- the broadcast over simulated games ----------
const text = (s) => typeof s === 'string' && !/undefined|NaN|null|\[object/.test(s);
let segsTotal = 0, lines = 0, ot = 0, stingers = { td: 0, to: 0, fg: 0, quarter: 0, final: 0 }, tds = 0;
for (let n = 0; n < games; n++) {
  const R = LG.quickRosters(100 + n);
  const g = createGame({ home: LG.teamForGame(R.teams[0]), away: LG.teamForGame(R.teams[1]), seed: 500 + n });
  // Before every snap: the strip under the scorebug and the player to watch.
  let guard = 0, prev = null;
  while (!g.final && guard++ < 400) {
    const bb = boothBefore(g);
    ok(text(bb) && bb.length <= 90, `the strip reads cleanly (${bb})`);
    const tw = playerToWatch(g);
    ok(tw && text(tw.name) && text(tw.line) && tw.slot, 'there is a player to watch');
    const before = { poss: g.poss, down: g.down, toGo: g.toGo, spot: g.spot, score: [...g.score], quarter: g.quarter, logN: g.log.length };
    simPlay(g);
    if (g.log.length === before.logN && prev === g.playNo) break;
    prev = g.playNo;
    for (const e of g.log.slice(before.logN)) {
      const b = boothAfter(g, e, before, []);
      ok(text(b) && b.length <= 120, `the booth line reads cleanly (${b})`);
      if (b) lines++;
      const st = stingerFor(g, e, before);
      if (st) { stingers[st.kind]++; ok(text(st.text) && (st.ti == null || st.ti === 0 || st.ti === 1), `a stinger names its team (${st.text})`); }
      if (e.highlight === 'td') tds++;
    }
  }
  ok(g.final, 'the game finishes');
  if (g.quarter >= 5) ot++;
  for (const d of g.drives) {
    const segs = driveSegs(g, d);
    segsTotal += segs.length;
    ok(d.plays === 0 || segs.length > 0, `a drive with plays has a chart (${d.result}, ${d.plays} plays)`);
    ok(segs.every((s) => s.from >= -1 && s.from <= 101 && s.to >= -1 && s.to <= 101 && ['run', 'pass', 'flag', 'sack', 'to', 'kick'].includes(s.kind)), 'every snap is on the field');
    ok(segs.filter((s) => s.kind !== 'kick').length <= d.plays + 2, `a chart has no more snaps than the drive (${segs.length} for ${d.plays})`);
    const t = driveTime(g, d);
    ok(t >= 0 && t <= 3600, `drive time is sane (${t})`);
    if (d.result === 'Touchdown') ok(segs.some((s) => s.td), 'a touchdown drive ends in the end zone');
  }
  for (const ti of [0, 1]) for (const id of Object.values(g.teams[ti].lineup)) ok(text(statLine(g, ti, id)), 'stat lines read cleanly');
}
ok(stingers.td === tds && tds > 0, `every touchdown gets a stinger (${stingers.td} of ${tds})`);
// (A game won in overtime ends on the score, not a quarter break: the screen adds the final.)
ok(stingers.quarter >= games * 3 && stingers.final >= games - ot, `quarter breaks and finals get stingers (${JSON.stringify(stingers)})`);
ok(lines > games * 5, `the booth has something to say (${lines} lines in ${games} games)`);
ok(segsTotal > games * 60, `drive charts have their snaps (${segsTotal})`);

console.log(`${checks - fails} of ${checks} checks passed in ${Date.now() - t0} ms`);
if (fails) process.exit(1);
