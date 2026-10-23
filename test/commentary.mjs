// The booth: full games played out on the live field (kicks included), every play called the
// way the live game calls it: the situation before the snap, each live event, the run into the
// open field, the wrap after the whistle and the analyst's notes. Checks every line is a real
// sentence (no undefined, NaN or empty names), the crew calls the big moments (every
// touchdown, takeaway and sack gets a line), and doesn't say the same thing over and over.
// Usage: node test/commentary.mjs [games] [--print]
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame, runPlay, runLivePlay, snapClock, aiOffenseCall, aiDefenseCall, OFF_PLAYS } from '../src/engine.js';
import { createLivePlay, snap, step, playSeconds } from '../src/live.js';
import { liveKick } from '../src/live/kicks.js';
import { afterLines, createBooth, fillerLine, liveLine, openLines, presnapLines, progressLine, tension } from '../src/commentary.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 6);
const PRINT = process.argv.includes('--print');
const L = createLeague({ seed: 11, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }

const bad = [];
const all = [];
const counts = { td: 0, tdCalled: 0, to: 0, toCalled: 0, sack: 0, sackCalled: 0, lines: 0, plays: 0 };
const check = (ln, where) => {
  if (!ln) return;
  if (typeof ln.text !== 'string' || !ln.text.trim()) bad.push(`${where}: empty line`);
  else if (/undefined|NaN|null|\[object|nobody|\$\{/.test(ln.text)) bad.push(`${where}: ${ln.text}`);
  if (!['pbp', 'color'].includes(ln.who)) bad.push(`${where}: bad speaker ${ln.who}`);
  if (all.length && ln.text === all[all.length - 1]) bad.push(`back to back: ${ln.text}`);
  all.push(ln.text);
  counts.lines++;
  if (PRINT) console.log(`${ln.who === 'pbp' ? 'PBP  ' : 'COLOR'} [${ln.pri}${'!'.repeat(ln.hype)}] ${ln.text}`);
};

for (let i = 0; i < N; i++) {
  const a = i % 8, b = (a + 3) % 8;
  const g = createGame({ home: teamForGame(L.teams[a]), away: teamForGame(L.teams[b]), seed: 900 + i });
  g.liveKicks = true;
  const B = createBooth(g.seed);
  for (const ln of openLines(B, g)) check(ln, 'open');
  let n = 0;
  while (!g.final && n++ < 500) {
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    const before = { poss: g.poss, down: g.down, toGo: g.toGo, spot: g.spot, score: [...g.score], quarter: g.quarter, logN: g.log.length, drives: g.drives.length };
    const k = OFF_PLAYS[off].kind;
    if (n % 7 === 0) check(fillerLine(B, g), 'filler');
    if (k === 'run' || k === 'pass' || liveKick(OFF_PLAYS[off])) {
      if (!snapClock(g, null, off)) { for (const e of g.log.slice(before.logN)) for (const ln of afterLines(B, g, e, before, null)) check(ln, 'clock'); continue; }
      const lp = createLivePlay(g, off, def, {});
      for (const ln of presnapLines(B, g, lp)) check(ln, 'presnap');
      snap(lp);
      let seen = 0;
      for (let s = 0; s < 1200 && lp.phase === 'live'; s++) {
        step(lp, null);
        while (seen < lp.events.length) check(liveLine(B, lp, lp.events[seen++]), `live:${lp.events[seen - 1].kind}`);
        check(progressLine(B, lp), 'progress');
        const t = tension(lp);
        if (!(t >= 0 && t <= 1)) bad.push(`tension ${t}`);
      }
      while (seen < lp.events.length) check(liveLine(B, lp, lp.events[seen++]), 'live:end');
      const entry = runLivePlay(g, off, def, lp.result, playSeconds(lp));
      counts.plays++;
      const fresh = g.log.slice(before.logN);
      for (const e of fresh) {
        const lines = afterLines(B, g, e, before, e === entry ? lp : null);
        for (const ln of lines) check(ln, `after:${e.kind}`);
        const txt = lines.map((l) => l.text).join(' ');
        if (e.highlight === 'td' && !e.conversion) { counts.td++; if (/Touchdown|Pick six|to the house/i.test(txt)) counts.tdCalled++; else console.log('MISS TD', JSON.stringify(e).slice(0, 300), txt); }
        if (e.turnover || e.kind === 'turnover') { counts.to++; if (/Intercept|Fumble|ball is out|downs|Picked|Pick six/i.test(txt + (lp.events.some((x) => x.kind === 'int') ? ' Intercept' : ''))) counts.toCalled++; else console.log('MISS TO', JSON.stringify(e).slice(0, 300), '=>', txt); }
        if (e.highlight === 'sack') { counts.sack++; if (lines.length || lp.events.some((x) => x.kind === 'sack')) counts.sackCalled++; }
      }
    } else {
      const entry = runPlay(g, off, def);
      for (const e of g.log.slice(before.logN)) for (const ln of afterLines(B, g, e, before, null)) check(ln, `sim:${e.kind}`);
      void entry;
    }
  }
}

// Variety: the share of lines that are the single most common line.
const freq = new Map();
for (const t of all) freq.set(t, (freq.get(t) ?? 0) + 1);
const top = [...freq.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
const distinct = freq.size / all.length;
console.log(`${N} games, ${counts.plays} live plays, ${counts.lines} lines (${(counts.lines / Math.max(1, counts.plays)).toFixed(1)} a play), ${(distinct * 100).toFixed(0)}% distinct`);
console.log(`touchdowns called ${counts.tdCalled}/${counts.td}, takeaways ${counts.toCalled}/${counts.to}, sacks ${counts.sackCalled}/${counts.sack}`);
console.log('most used:', top.map(([t, c]) => `${c}× "${t}"`).join(' | '));
let fail = false;
if (bad.length) { console.log(`${bad.length} bad lines:\n  ${[...new Set(bad)].slice(0, 20).join('\n  ')}`); fail = true; }
if (counts.tdCalled < counts.td) { console.log('FAIL: a touchdown went uncalled'); fail = true; }
if (counts.toCalled < counts.to) { console.log('FAIL: a takeaway went uncalled'); fail = true; }
if (counts.sackCalled < counts.sack) { console.log('FAIL: a sack went uncalled'); fail = true; }
if (distinct < 0.12) { console.log('FAIL: the booth repeats itself too much'); fail = true; }
if (fail) process.exit(1);
console.log('ok');
