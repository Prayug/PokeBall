// Every kick played on the live field (punts, field goals, kickoffs deep and onside, extra
// points and the fakes): each ends in an outcome the engine can apply, the ball never jumps or
// leaves the stadium, the right team gets the ball where the play ended, and distances and
// rates stay in a believable range.
// Usage: node test/kicks.mjs
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runLivePlay, fgOdds } from '../src/engine.js';
import { createLivePlay, snap, step, playSeconds, SIDE } from '../src/live.js';

const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const problems = [];
const t0 = Date.now();

function play(call, spot, i, setup) {
  const g = createGame({ home: teamForGame(L.teams[i % 8]), away: teamForGame(L.teams[(i + 3) % 8]), seed: 300 + i, weather: 'clear' });
  g.spot = spot; g.poss = i % 2; g.down = 4; g.toGo = 7;
  setup?.(g);
  const odds = fgOdds(g);
  const lp = createLivePlay(g, call, 'base', {});
  snap(lp);
  let last = null;
  for (let k = 0; k < 60 * 16 && lp.phase === 'live'; k++) {
    step(lp, null);
    const b = lp.ball;
    if (last && Math.hypot(b.x - last.x, b.y - last.y) > 1.2 && !(b.holder && last.holder !== b.holder)) problems.push(`${call} seed ${i}: ball jumped ${Math.hypot(b.x - last.x, b.y - last.y).toFixed(2)} yds at t=${lp.t.toFixed(2)}`);
    if (Math.abs(b.y) > SIDE + 12 || b.z > 40) problems.push(`${call} seed ${i}: ball left the stadium`);
    last = { x: b.x, y: b.y, holder: b.holder };
  }
  if (!lp.result) { problems.push(`${call} seed ${i}: no result (stage ${lp.kick?.stage})`); return null; }
  // The ball's possession states only move the legal ways (see POSSESSION_FLOW in live.js).
  for (const e of lp.possErrors ?? []) problems.push(`${call} seed ${i}: possession ${e} (${(lp.possLog ?? []).map((x) => x.state).join(' > ')})`);
  const before = { poss: g.poss, spot: g.spot, score: [...g.score] };
  const e = runLivePlay(g, call, 'base', lp.result, playSeconds(lp));
  if (!e?.text) problems.push(`${call} seed ${i}: no log entry`);
  return { r: lp.result, g, before, odds };
}

// Punts from the offense's own 30: the other team gets it, net and return in range.
const punt = { n: 0, gross: 0, ret: 0, nr: 0, net: 0, how: {} };
for (let i = 0; i < 120; i++) {
  const o = play('punt', 30, i);
  if (!o) continue;
  const { r, g, before } = o;
  punt.n++; punt.how[r.how] = (punt.how[r.how] ?? 0) + 1;
  if (r.gross != null) punt.gross += r.gross;
  if (r.ret != null) { punt.ret += r.ret; punt.nr++; }
  if (r.how !== 'td' && g.poss === before.poss) problems.push(`punt seed ${i}: the kicking team kept the ball (${r.how})`);
  if (r.how !== 'td' && r.how !== 'blocked') punt.net += 100 - g.spot - before.spot;
}
const pg = punt.gross / punt.n, pn = punt.net / punt.n;
if (pg < 38 || pg > 55) problems.push(`punt gross ${pg.toFixed(1)} out of range`);
if (pn < 28 || pn > 48) problems.push(`punt net ${pn.toFixed(1)} out of range`);
if (!punt.how.tackle || !punt.how.fair) problems.push(`punts never ended in both a return and a fair catch: ${JSON.stringify(punt.how)}`);

// Inside the opponent's 45 the punter pins them deep instead of kicking it through the end zone.
let deep = 0, tb = 0;
for (let i = 0; i < 60; i++) { const o = play('punt', 58, i); if (!o) continue; if (o.r.how === 'touchback') tb++; else if (o.g.spot <= 15) deep++; }
if (tb > 20) problems.push(`short-field punts: ${tb} of 60 touchbacks`);
if (deep < 25) problems.push(`short-field punts: only ${deep} of 60 pinned inside the 15`);

// Field goals: the make rate follows the kicker's odds from that distance.
for (const [spot, lo, hi] of [[80, 0.75, 1], [62, 0.35, 0.9]]) {
  let made = 0, n = 0, odds = 0;
  for (let i = 0; i < 80; i++) {
    const o = play('fg', spot, i);
    if (!o) continue;
    n++; odds += o.odds;
    if (o.r.how === 'good') { made++; if (o.g.score[o.before.poss] !== o.before.score[o.before.poss] + 3) problems.push(`fg seed ${i}: good but the score did not go up by 3`); }
  }
  const rate = made / n, exp = odds / n;
  if (rate < lo || rate > hi || Math.abs(rate - exp) > 0.15) problems.push(`field goals from the ${100 - spot}: ${(rate * 100).toFixed(0)}% made, odds ${(exp * 100).toFixed(0)}%`);
}

// Kickoffs: the receiving team gets the ball, most deep kicks reach the end zone or get a
// short return, and a few are run back.
const ko = { n: 0, how: {}, start: 0, ns: 0 };
for (let i = 0; i < 80; i++) {
  const o = play('kick_deep', 35, i, (g) => { g.phase = 'kickoff'; g.kick = { kicker: g.poss, free: false }; });
  if (!o) continue;
  const { r, g, before } = o;
  ko.n++; ko.how[r.how] = (ko.how[r.how] ?? 0) + 1;
  if (r.how === 'td') continue;
  if (g.poss === before.poss) problems.push(`kickoff seed ${i}: the kicking team kept the ball (${r.how})`);
  if (g.phase !== 'play' || g.down !== 1) problems.push(`kickoff seed ${i}: next snap is not 1st down (${g.phase})`);
  ko.start += g.spot; ko.ns++;
}
const ks = ko.start / ko.ns;
if (ks < 18 || ks > 32) problems.push(`kickoff average start ${ks.toFixed(1)} out of range`);
if (!ko.how.touchback || !ko.how.tackle) problems.push(`kickoffs never ended in both a touchback and a return: ${JSON.stringify(ko.how)}`);

// Onside kicks: the ball goes ten yards and someone falls on it; the kicking team gets some back.
let kept = 0;
for (let i = 0; i < 60; i++) {
  const o = play('onside', 35, i, (g) => { g.phase = 'kickoff'; g.kick = { kicker: g.poss, free: false }; });
  if (!o) continue;
  if (!o.r.onside) problems.push(`onside seed ${i}: not an onside result (${o.r.how})`);
  if (o.g.poss === o.before.poss) kept++;
}
if (kept < 6 || kept > 45) problems.push(`onside kicks: kicking team kept ${kept} of 60`);

// Extra points: kicked from the 15 and nearly always good.
let xp = 0;
for (let i = 0; i < 40; i++) {
  const o = play('xp', 98, i, (g) => { g.phase = 'pat'; g.liveKicks = true; });
  if (!o) continue;
  if (o.r.how === 'good') { xp++; if (o.g.score[o.before.poss] !== o.before.score[o.before.poss] + 1) problems.push(`xp seed ${i}: good but the score did not go up by 1`); }
  if (o.g.phase !== 'kickoff' && !o.g.final) problems.push(`xp seed ${i}: no kickoff after the try (${o.g.phase})`);
}
if (xp < 34) problems.push(`extra points: only ${xp} of 40 good`);

// Fakes on 4th and 3 turn into a live run or pass and convert some of the time, not always.
const fakes = {};
for (const [call, spot] of [['fake_punt', 45], ['fake_fg', 70]]) {
  let conv = 0;
  for (let i = 0; i < 60; i++) {
    const o = play(call, spot, i, (g) => { g.toGo = 3; });
    if (!o) continue;
    if (!/^Fake (punt|field goal)!/.test(o.r.text ?? '')) problems.push(`${call} seed ${i}: not played as a fake (${o.r.text})`);
    if (o.g.poss === o.before.poss) conv++;
  }
  fakes[call] = conv;
  if (conv < 9 || conv > 48) problems.push(`${call}: converted ${conv} of 60`);
}

console.log(`kickoffs: start ${ks.toFixed(1)} ${JSON.stringify(ko.how)}  onside kept ${kept} of 60  xp ${xp} of 40  fakes converted ${JSON.stringify(fakes)}`);
console.log(`punts: gross ${pg.toFixed(1)}  net ${pn.toFixed(1)}  return ${(punt.ret / (punt.nr || 1)).toFixed(1)}  ${JSON.stringify(punt.how)}  short field: ${deep} pinned, ${tb} touchbacks`);
if (problems.length) { console.log(problems.slice(0, 20).join('\n')); console.log(`FAILED: ${problems.length} problems`); process.exit(1); }
console.log(`kicks passed in ${Date.now() - t0} ms`);
