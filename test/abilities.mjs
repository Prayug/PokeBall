// Abilities, type theater and weather physics: every ability in the pool does something, the
// absorbing abilities and Scrappy change matchups, contacts show their typing on the field, and
// the weather changes how bodies move on the live field without breaking plays.
// Usage: node test/abilities.mjs
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, aiOffenseCall, aiDefenseCall, OFF_PLAYS, eff } from '../src/engine.js';
import { createLivePlay, autoPlay, typeFx } from '../src/live.js';
import { PLAYERS } from '../src/ratings.js';
import { ABILITIES, bestMatchup, pickAbility } from '../src/types.js';
import { WEATHER_PHYS, weatherPhys } from '../src/weather.js';

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const t0 = Date.now();

// 1. Every Pokémon's ability has an entry, and every entry has an effect the game knows.
const SPECIALS = new Set(['intimidate', 'speedBoost', 'noFumble', 'focus', 'pressure', 'recover', 'rockHead', 'adapt', 'tinted',
  'filter', 'ironFist', 'reckless', 'luck', 'sniper', 'runAway', 'slippery', 'clearBody', 'moldBreaker', 'download', 'truant',
  'wonderGuard', 'scrappy', 'overcoat', 'armor', 'barbs', 'hawk', 'tireless']);
const WHENS = new Set(['rain', 'sun', 'sand', 'hail', 'tired', 'q4trail', 'weather', 'q1', 'h2', 'lead', 'trail', 'fresh', 'home', 'playoff', 'electricMate']);
const ATTRS = new Set([...Object.keys(Object.values(PLAYERS)[0].attrs), 'all']);
for (const p of Object.values(PLAYERS)) ok(ABILITIES[p.ability], `${p.name}: ${p.ability} has no football effect`);
for (const [name, a] of Object.entries(ABILITIES)) {
  ok(a.text, `${name}: no text`);
  ok(a.attr || a.special || a.immune || a.weather, `${name}: no effect`);
  if (a.special) ok(SPECIALS.has(a.special), `${name}: unknown special ${a.special}`);
  if (a.when) ok(WHENS.has(a.when), `${name}: unknown condition ${a.when}`);
  for (const k of Object.keys(a.attr ?? {})) ok(ATTRS.has(k), `${name}: unknown attribute ${k}`);
}
// Pokémon that already had a curated ability keep it.
ok(pickAbility(['Water Absorb', 'Swift Swim']) === 'Swift Swim', 'a curated ability wins over a filled-in one');

// 2. Matchups: absorbing abilities, Wonder Guard, Scrappy, Mold Breaker.
const fake = (types, ability = 'None') => ({ types, ability });
ok(bestMatchup(fake(['Water']), fake(['Fire'])).mult === 2, 'Water on Fire is super effective');
ok(bestMatchup(fake(['Water']), fake(['Fire'], 'Water Absorb')).mult === 0, 'Water Absorb takes no effect from Water');
ok(bestMatchup(fake(['Water', 'Ground']), fake(['Fire'], 'Water Absorb')).type === 'Ground', 'a dual type falls back on its other type');
ok(bestMatchup(fake(['Water'], 'Mold Breaker'), fake(['Fire'], 'Water Absorb')).mult === 2, 'Mold Breaker ignores Water Absorb');
ok(bestMatchup(fake(['Ground']), fake(['Electric'], 'Levitate')).mult === 0, 'Levitate takes no effect from Ground');
ok(bestMatchup(fake(['Normal']), fake(['Ghost'])).mult === 0, 'Normal on Ghost has no effect');
ok(bestMatchup(fake(['Normal'], 'Scrappy'), fake(['Ghost'])).mult === 1, 'Scrappy hits Ghost types');
ok(bestMatchup(fake(['Water']), fake(['Bug', 'Ghost'], 'Wonder Guard')).mult === 0, 'Wonder Guard shrugs off a neutral hit');
ok(bestMatchup(fake(['Fire']), fake(['Bug', 'Ghost'], 'Wonder Guard')).mult === 2, 'Wonder Guard still takes a super-effective hit');

// 3. Conditions in a game: the filled-in conditions switch on and off.
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const game = (i, weather) => createGame({ home: teamForGame(L.teams[i % 8]), away: teamForGame(L.teams[(i + 3) % 8]), seed: 900 + i, weather });
const anyWith = (ability) => Object.values(PLAYERS).find((p) => p.ability === ability)?.id;
{
  const g = game(0, 'clear');
  const id = g.teams[0].roster[0];
  const real = PLAYERS[id].ability;
  PLAYERS[id].ability = 'Early Bird';
  g.quarter = 1; const q1 = eff(g, 0, id, 'spd');
  g.quarter = 2; const q2 = eff(g, 0, id, 'spd');
  ok(q1 > q2, 'Early Bird is stronger in the 1st quarter');
  PLAYERS[id].ability = 'Zero to Hero';
  g.quarter = 3; const h2 = eff(g, 0, id, 'str');
  g.quarter = 2; const h1 = eff(g, 0, id, 'str');
  ok(h2 > h1, 'Zero to Hero is stronger in the second half');
  PLAYERS[id].ability = 'Steadfast';
  g.score = [0, 7]; const behind = eff(g, 0, id, 'spd');
  g.score = [7, 0]; const ahead = eff(g, 0, id, 'spd');
  ok(behind > ahead, 'Steadfast is faster when trailing');
  PLAYERS[id].ability = real;
}

// 4. Weather physics: who it holds and who it spares.
for (const [w, W] of Object.entries(WEATHER_PHYS)) {
  const spared = Object.values(PLAYERS).find((p) => W.spares.some((t) => p.types.includes(t)));
  const held = Object.values(PLAYERS).find((p) => !W.spares.some((t) => p.types.includes(t)) && ABILITIES[p.ability]?.special !== 'overcoat');
  ok(weatherPhys(w, spared.id) === null, `${w}: ${spared.name} plays through it`);
  ok(weatherPhys(w, held.id) === W, `${w}: ${held.name} is held by it`);
}
ok(weatherPhys('clear', Object.values(PLAYERS)[0].id) === null, 'clear weather does nothing');
const coat = anyWith('Overcoat');
if (coat) ok(weatherPhys('hail', coat) === null && weatherPhys('rain', coat) === null, 'Overcoat plays through any weather');

// 5. Type theater on the live field: a forced super-effective contact shows once per pair, and
// whole plays in every weather finish with their effects showing up.
{
  const g = game(1, 'clear');
  const lp = createLivePlay(g, 'inside_run', 'base', {});
  const [a, b] = [lp.players.find((p) => p.side === 'off'), lp.players.find((p) => p.side === 'def')];
  const ra = PLAYERS[a.id].types, rb = PLAYERS[b.id].types, aa = PLAYERS[a.id].ability, ba = PLAYERS[b.id].ability;
  PLAYERS[a.id].types = ['Water']; PLAYERS[b.id].types = ['Fire']; PLAYERS[a.id].ability = 'None'; PLAYERS[b.id].ability = 'None';
  ok(typeFx(lp, a, b) === 'se', 'Water hitting Fire shows super effective');
  ok(typeFx(lp, a, b) === null, 'a pair shows it once a play');
  ok(typeFx(lp, b, a) === 'nve', 'Fire hitting Water shows not very effective');
  const ev = lp.events.filter((e) => e.kind === 'typefx');
  ok(ev.length === 2 && ev[0].type === 'Water' && ev[0].fx === 'se' && /super effective/.test(ev[0].text), 'type events carry the type and the line');
  PLAYERS[a.id].types = ra; PLAYERS[b.id].types = rb; PLAYERS[a.id].ability = aa; PLAYERS[b.id].ability = ba;
}
const seen = { typefx: 0, se: 0, nve: 0, immune: 0, slip: 0, weatherNotes: 0, plays: 0 };
const yds = {};
for (const w of ['clear', 'rain', 'sun', 'sand', 'hail']) {
  yds[w] = { n: 0, y: 0 };
  for (let i = 0; i < 40; i++) {
    const g = game(i, w);
    let off = aiOffenseCall(g);
    if (!['run', 'pass'].includes(OFF_PLAYS[off].kind)) off = i % 2 ? 'inside_run' : 'slant';
    const lp = createLivePlay(g, off, aiDefenseCall(g), {});
    const e0 = { ...g.teams[1 - g.poss].energy };
    const r = autoPlay(lp);
    seen.plays++;
    ok(r && typeof r.text === 'string', `${w} play ${i}: no result`);
    if (!r) continue;
    yds[w].n++; yds[w].y += r.yards ?? 0;
    for (const e of lp.events) {
      if (e.kind === 'typefx') { seen.typefx++; seen[e.fx]++; ok(e.type && e.who && e.other, `${w} play ${i}: type event without its pair`); }
      if (e.kind === 'slip') { seen.slip++; ok(w === 'rain', `slip outside rain (${w})`); }
    }
    seen.weatherNotes += lp.notes.filter((n) => n.kind === 'weather').length;
    if (w === 'rain') for (const p of lp.players) ok(!!p.wx === !!weatherPhys('rain', p.id), `rain: ${PLAYERS[p.id].name} weather state`);
    if (w === 'sand') {
      const chipped = Object.keys(e0).some((id) => (g.teams[1 - g.poss].energy[id] ?? 100) < e0[id]);
      if (lp.events.some((e) => e.kind === 'contact')) ok(chipped, `sand play ${i}: contact chipped nobody`);
    }
  }
}
ok(seen.typefx > 0 && seen.se > 0, `type theater never showed (${JSON.stringify(seen)})`);
// Slick turf: everyone the rain holds cuts less sharply than on a dry field.
{
  const dry = createLivePlay(game(2, 'clear'), 'inside_run', 'base', {}), wet = createLivePlay(game(2, 'rain'), 'inside_run', 'base', {});
  for (const p of wet.players) {
    const q = dry.players.find((x) => x.id === p.id);
    if (p.wx) ok(p.cut < q.cut, `rain: ${PLAYERS[p.id].name} cuts as sharply as on a dry field`);
    else ok(p.cut >= q.cut - 1e-9, `rain: ${PLAYERS[p.id].name} should play through it`);
  }
}

const dt = Date.now() - t0;
console.log(`type theater: ${seen.typefx} in ${seen.plays} plays (SE ${seen.se}, NVE ${seen.nve}, no effect ${seen.immune}); rain slips ${seen.slip}; weather notes ${seen.weatherNotes}`);
console.log('yards/play by weather:', Object.entries(yds).map(([w, v]) => `${w} ${(v.y / v.n).toFixed(1)}`).join('  '));
if (fails.length) { for (const f of fails.slice(0, 30)) console.log('FAIL', f); console.log(`${fails.length} failed, ${pass} passed in ${dt} ms`); process.exit(1); }
console.log(`${pass} of ${pass} checks passed in ${dt} ms`);
