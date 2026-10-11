// How much do ratings matter? Builds teams from different tiers of the pool (each starter is
// about the Nth best non-legendary at his slot) and plays them against each other in the
// simulator. Prints win rates, scoring margins and each team's average starter overall.
// Usage: node test/tiers.mjs [games per matchup] [live]   (live: every run and pass is a live play on autopilot)
import { PLAYERS, SLOTS } from '../src/ratings.js';
import { createGame, simUntil, runPlay, runLivePlay, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, autoPlay, playSeconds } from '../src/live.js';

const N = Number(process.argv[2] ?? 400);
const LIVE = process.argv[3] === 'live';
function playLive(g) {
  let n = 0;
  while (!g.final && n++ < 400) {
    const off = aiOffenseCall(g), def = aiDefenseCall(g), k = OFF_PLAYS[off].kind;
    if (k === 'run' || k === 'pass') { const lp = createLivePlay(g, off, def, {}); const r = autoPlay(lp); runLivePlay(g, off, def, r, playSeconds(lp)); }
    else runPlay(g, off, def);
  }
}
const ids = Object.keys(PLAYERS).map(Number).filter((id) => !PLAYERS[id].legendary);
const rank = Object.fromEntries(SLOTS.map((s) => [s.key, ids.slice().sort((a, b) => PLAYERS[b].ovr[s.key] - PLAYERS[a].ovr[s.key])]));

function tierTeam(name, target) {
  const used = new Set(), lineup = {};
  for (const s of SLOTS.slice().sort((a, b) => b.value - a.value)) {
    const list = rank[s.key].filter((id) => !used.has(id));
    const id = list[Math.min(target, list.length - 1)];
    lineup[s.key] = id; used.add(id);
  }
  const ovr = SLOTS.reduce((t, s) => t + PLAYERS[lineup[s.key]].ovr[s.key], 0) / SLOTS.length;
  return { id: 0, name, abbr: name.slice(0, 3).toUpperCase(), color: '#888', coach: 'balanced', lineup, bench: [], ovr };
}

const T = { elite: tierTeam('Elite', 0), strong: tierTeam('Strong', 12), good: tierTeam('Good', 30), average: tierTeam('Average', 60), weak: tierTeam('Weak', 140) };
for (const t of Object.values(T)) console.log(t.name.padEnd(8), 'avg starter ovr', t.ovr.toFixed(1));
const pairs = [['elite', 'strong'], ['strong', 'good'], ['good', 'average'], ['elite', 'average'], ['average', 'weak'], ['strong', 'average']];
for (const [a, b] of pairs) {
  let w = 0, ties = 0, marg = 0, pts = 0;
  for (let i = 0; i < N; i++) {
    const home = i % 2 === 0;
    const g = createGame({ home: home ? T[a] : T[b], away: home ? T[b] : T[a], seed: 77 + i });
    if (LIVE) playLive(g); else simUntil(g, 'game');
    const sa = g.score[home ? 0 : 1], sb = g.score[home ? 1 : 0];
    if (sa > sb) w++; else if (sa === sb) ties++;
    marg += sa - sb; pts += sa + sb;
  }
  console.log(`${a.padEnd(7)} vs ${b.padEnd(7)}  win ${(100 * (w + ties / 2) / N).toFixed(1)}%  margin ${(marg / N).toFixed(1)}  pts/team ${(pts / N / 2).toFixed(1)}`);
}
