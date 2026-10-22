// Powers: who carries one, how a Pokémon zones in and loses it, what an active power changes in
// the ratings and on the live field, and whole games (fast and live) earning and losing them.
// Usage: node test/powers.mjs
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, simPlay, eff, aiOffenseCall, aiDefenseCall, snapClock, runLivePlay, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, autoPlay, playSeconds } from '../src/live.js';
import { PLAYERS } from '../src/ratings.js';
import { POWERS, POWER_OF, SIGNATURES, activePower, groupOfSlot, powerMeter, powerText, sidePowers, tickPowers, worksAt } from '../src/powers.js';
import { traitMod } from '../src/traits.js';

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const t0 = Date.now();
const byName = (n) => Object.values(PLAYERS).find((p) => p.name === n);

// 1. The table: every power has a group, a zone-in and a loss with labels, and some effect.
for (const w of Object.values(POWERS)) {
  ok(['QB', 'skill', 'line', 'rush', 'cover'].includes(w.group), `${w.id}: group`);
  ok(w.zone.need > 0 && w.zone.label && typeof w.zone.add === 'function', `${w.id}: zone in`);
  ok(w.lose.need > 0 && w.lose.label && typeof w.lose.add === 'function', `${w.id}: loss`);
  ok(Object.keys(w.attr).length > 0 && w.text, `${w.id}: effect and text`);
}
// Every group has powers for every type, so a carrier always gets one that suits it.
const assigned = Object.entries(POWER_OF);
ok(assigned.length > 120 && assigned.length < 260, `power carriers in the pool: ${assigned.length}`);
for (const [n, [sig, base]] of Object.entries(SIGNATURES)) {
  const p = byName(n);
  ok(!!p, `signature for a Pokémon in the pool: ${n}`);
  if (p) ok(POWER_OF[p.id]?.name === sig && POWER_OF[p.id].base === base, `${n} carries ${sig}`);
}
// A carrier's power works in its group. A signature still belongs to that Pokémon even when
// their best job is now a different group; it only fires in the group it was written for.
for (const [id, w] of assigned) {
  if (w.signature) {
    const slot = PLAYERS[id].best.find((k) => groupOfSlot(k) === w.group) ?? (w.group === 'QB' ? 'QB' : w.group === 'skill' ? 'WR1' : w.group === 'line' ? 'LT' : w.group === 'rush' ? 'LE' : 'CB1');
    ok(worksAt(Number(id), slot), `${PLAYERS[id].name}'s ${w.name} works in its group`);
  } else {
    const slot = PLAYERS[id].best.find((k) => k !== 'K' && k !== 'P');
    ok(groupOfSlot(slot) === w.group, `${PLAYERS[id].name}'s ${w.name} works at its best spot`);
  }
}
const zard = byName('Charizard');
ok(powerText(zard.id).signature && powerText(zard.id).name === 'Blast Burn', 'Charizard: Blast Burn, signature');
ok(worksAt(zard.id, 'WR1') && !worksAt(zard.id, 'LT'), 'Charizard\'s power works at receiver, not tackle');

// 2. Zoning in and losing it, from the box score.
const L = createLeague({ seed: 7, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
function gameWith(slot, id, seed = 3) {
  const home = teamForGame(L.teams[0]), away = teamForGame(L.teams[1]);
  home.lineup = { ...home.lineup, [slot]: id };
  home.bench = (home.bench ?? []).filter((x) => x !== id);
  away.lineup = Object.fromEntries(Object.entries(away.lineup).filter(([, v]) => v !== id));
  return createGame({ home, away, seed, weather: 'clear' });
}
const st = (g, ti, id) => g.teams[ti].stats[id];
// A Future Sight quarterback: three straight completions, then an interception.
const fsQB = assigned.find(([, w]) => (w.base ?? w.id) === 'futureSight')[0] | 0;
{
  const g = gameWith('QB', fsQB);
  const s = st(g, 0, fsQB);
  const play = (pa, pc, pint = 0) => { s.pa += pa; s.pc += pc; s.pint += pint; return tickPowers(g, { yards: 5 }, { o: 0, kind: 'pass', down: 1, comp: pc > 0, int: pint > 0 }); };
  const accBefore = eff(g, 0, fsQB, 'acc');
  play(1, 1); play(1, 1);
  ok(!activePower(g, 0, fsQB) && powerMeter(g, 0, fsQB).have === 2, 'two completions: not yet, meter at 2 of 3');
  play(1, 0);
  ok(powerMeter(g, 0, fsQB).have === 0, 'an incompletion breaks the streak');
  play(1, 1); play(1, 1);
  const ch = play(1, 1);
  ok(!!activePower(g, 0, fsQB) && ch.length === 1 && ch[0].on, 'three straight completions: in the zone');
  ok(eff(g, 0, fsQB, 'acc') > accBefore + 4, `accuracy up while active (${accBefore.toFixed(1)} to ${eff(g, 0, fsQB, 'acc').toFixed(1)})`);
  ok(sidePowers(g, 0)[0].id === fsQB && sidePowers(g, 0)[0].active, 'the HUD lists the active power first');
  // The live field carries it as plain data the replay can copy, and the trait table reads it.
  g.down = 1; g.toGo = 10; g.spot = 30; g.poss = 0; g.phase = 'play';
  const lp = createLivePlay(g, 'slant', 'cover3', {});
  const qb = lp.off.QB;
  ok(qb.power?.name === POWER_OF[fsQB].name, 'the live quarterback carries his power');
  let cloned = true; try { structuredClone(lp); } catch { cloned = false; }
  ok(cloned, 'a live play with powers still copies for its replay');
  ok(traitMod('pressure', { qb, rusher: null }).v < 0.6, 'Future Sight eases the pressure on him');
  // Moving out of his group switches it off; back in, on again.
  g.teams[0].lineup.QB = g.teams[0].lineup.LT; g.teams[0].lineup.LT = fsQB;
  ok(!activePower(g, 0, fsQB) && Math.abs(eff(g, 0, fsQB, 'acc') - accBefore) < 0.01, 'out of position: dormant');
  g.teams[0].lineup.LT = g.teams[0].lineup.QB; g.teams[0].lineup.QB = fsQB;
  const lost = play(1, 0, 1);
  ok(!activePower(g, 0, fsQB) && lost.length === 1 && !lost[0].on, 'an interception: power lost');
  // A play taken off by a penalty moves nothing.
  play(1, 1); play(1, 1);
  s.pa -= 2; s.pc -= 2;
  tickPowers(g, null, null);
  ok(powerMeter(g, 0, fsQB).have === 2, 'a wiped play leaves the meter alone');
}
// A pass rusher with Outrage loses it when the other team scores a touchdown.
{
  const id = assigned.find(([, w]) => w.id === 'outrage')[0] | 0;
  const g = gameWith('LE', id);
  const s = st(g, 0, id);
  s.dsk += 1; s.tk += 1; tickPowers(g, { yards: -7 }, { o: 1, kind: 'pass', down: 2, sack: true });
  ok(!activePower(g, 0, id), 'one sack: not yet');
  s.dsk += 1; s.tk += 1; tickPowers(g, { yards: -5 }, { o: 1, kind: 'pass', down: 3, sack: true });
  ok(!!activePower(g, 0, id), 'two sacks: Outrage');
  const shed = traitMod('shedRate', { d: { id, power: { name: 'Outrage', live: POWER_OF[id].live } }, b: { id: g.teams[1].lineup.LT } }).v;
  ok(shed > 1.4, 'Outrage sheds blocks faster');
  g.score[1] += 6;
  tickPowers(g, { yards: 30, highlight: 'td', score: [g.score[0], g.score[1] - 6] }, { o: 1, kind: 'pass', down: 1, comp: true, first: true });
  ok(!activePower(g, 0, id), 'a touchdown against him: lost');
}

// 3. Whole games: the fast simulator and the live field both earn and lose powers, the play's
// record says so, and the meters stay in range.
let ons = 0, offs = 0, logged = 0, games = 0;
for (let i = 0; i < 60; i++) {
  const g = createGame({ home: teamForGame(L.teams[i % 8]), away: teamForGame(L.teams[(i + 3) % 8]), seed: 900 + i });
  let n = 0;
  while (!g.final && n++ < 500) {
    simPlay(g);
    const e = g.lastPlay;
    for (const c of e?.powers ?? []) { logged++; if (c.on) ons++; else offs++; ok(!!POWER_OF[c.id] && typeof c.ti === 'number', 'a power change names its carrier'); }
  }
  for (const ti of [0, 1]) for (const r of sidePowers(g, ti)) ok(r.meter.have >= 0 && r.meter.have <= r.meter.need, 'meters stay in range');
  ok(g.final, `game ${i} finishes`);
  games++;
}
ok(ons / games > 2 && ons / games < 25, `zone-ins per game: ${(ons / games).toFixed(1)}`);
ok(offs > 0 && offs <= ons, `powers lost: ${offs} of ${ons}`);
let liveOn = 0, liveNotes = 0;
for (let i = 0; i < 4; i++) {
  const g = createGame({ home: teamForGame(L.teams[i % 8]), away: teamForGame(L.teams[(i + 5) % 8]), seed: 7000 + i });
  let n = 0;
  while (!g.final && n++ < 400) {
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    const k = OFF_PLAYS[off].kind;
    if (k === 'run' || k === 'pass') {
      if (!snapClock(g, null, off)) continue;
      const lp = createLivePlay(g, off, def, {});
      const r = autoPlay(lp);
      liveNotes += lp.notes.filter((x) => x.kind === 'power').length;
      const e = runLivePlay(g, off, def, r, playSeconds(lp));
      liveOn += (e?.powers ?? []).filter((c) => c.on).length;
    } else simPlay(g);
  }
  ok(g.final, `live game ${i} finishes`);
}
ok(liveOn > 0, `live games zone in too: ${liveOn}`);
ok(liveNotes > 0, `active powers decide live plays: ${liveNotes} notes`);

console.log(`zone-ins ${(ons / games).toFixed(1)} per game, ${offs} of ${ons} lost; live: ${liveOn} zone-ins, ${liveNotes} power notes`);
for (const f of fails.slice(0, 30)) console.log('FAIL', f);
console.log(`${pass} of ${pass + fails.length} checks passed in ${Date.now() - t0} ms`);
process.exit(fails.length ? 1 : 0);
