// The booth: a two-man crew calling the game on the live field, the way a Madden broadcast
// does. Mack Rivers has the play-by-play: the situation before the snap and the action as it
// happens (the handoff, the throw, the catch, the hit, the run into the open field, the score).
// Dee Hollis is the analyst: what the play meant, why it worked (a type matchup, an ability,
// a size mismatch, a power switching on, the weather) and where the game is going (the score,
// the clock, streaks and momentum).
//
// Everything here is words only: each call returns lines ({ who, text, pri, hype }) that
// speech.js reads out and captions, so it runs in node for the tests. `pri` is how much a line
// matters (3 cuts in over anything, 2 is a live call that is stale a beat later, 1 the wrap of a
// play, 0 filler between plays); `hype` how loud the voice gets (0 to 2).
import { PLAYERS } from './ratings.js';
import { DEF_PLAYS, OFF_PLAYS, fgDistance } from './engine.js';
import { POWER_OF } from './powers.js';
import { STADIUMS, TIMES, venueOf } from './kits.js';
import { WEATHER, bestMatchup } from './types.js';
import { boothAfter, playerToWatch } from './broadcast.js';

export const CREW = {
  pbp: { name: 'Mack Rivers', role: 'Play-by-play' },
  color: { name: 'Dee Hollis', role: 'Analyst' },
};

const nm = (id) => PLAYERS[id]?.name ?? 'nobody';
const kg = (id) => Math.round((PLAYERS[id]?.weight ?? 0) / 10);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ORD = ['', 'First', 'Second', 'Third', 'Fourth'];
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
const say = (n) => (n >= 0 && n <= 10 ? NUM[n] : String(n));
// A yard line the way a booth says it: "the twenty-three", "the five", "midfield".
function yardWord(n) {
  n = Math.round(Math.abs(n));
  if (n <= 10) return NUM[n];
  if (n < 20) return TEENS[n - 10];
  const t = Math.floor(n / 10), o = n % 10;
  return o ? `${TENS[t]}-${NUM[o]}` : TENS[t] || String(n);
}
function hereLine(g, spot = g.spot) {
  spot = Math.round(spot);
  if (spot <= 0 || spot >= 100) return 'the goal line';
  if (spot === 50) return 'midfield';
  return `the ${yardWord(spot < 50 ? spot : 100 - spot)}`;
}

// The yard line `x` yards past the line of scrimmage on a live play, said aloud.
const fieldAt = (lp, x) => hereLine(lp.g, lp.spot + (x ?? 0));
// How the offense lines up, the way a booth calls it before the snap.
const FORM_CALL = {
  gun_spread: ['Spread out of the shotgun.', 'Shotgun, three wide.'],
  gun_trips: ['Trips bunched to one side, out of the shotgun.', 'Shotgun, trips.'],
  singleback: ['Singleback set, one back behind the quarterback.', 'Under center, singleback.'],
  iform: ['I-formation, fullback in front of the tailback.', 'Under center in the I.'],
  pistol: ['Pistol look, back right behind the quarterback.', 'Out of the pistol.'],
};
const FRONT_CALL = { nickel: 'They are in nickel, five defensive backs.', goal: 'Goal line defense, everybody in the box.' };

// What a type brings to a call: a word for how the Pokémon plays.
const TYPE_FLAVOR = {
  Normal: 'does everything well', Fire: 'is red hot', Water: 'just flows through traffic', Electric: 'is lightning quick',
  Grass: 'is rooted in there', Ice: 'has ice in the veins', Fighting: 'plays with a mean streak', Poison: 'wears you down',
  Ground: 'is a load to bring down', Flying: 'is flying around out there', Psychic: 'sees it before it happens', Bug: 'never stops swarming',
  Rock: 'is a wall', Ghost: 'is impossible to get a hand on', Dragon: 'plays like a monster', Dark: 'plays dirty in the best way',
  Steel: 'is built like a tank', Fairy: 'makes it look easy',
};

// ---------- the crew's memory ----------
// One booth per game: the lines it has used lately (so it doesn't repeat itself), the flow of
// the game (who has the momentum), and what it said on the play in progress.
export function createBooth(seed = 1) {
  return { seed: (seed >>> 0) || 1, recent: new Map(), streak: { ti: null, n: 0, kind: '' }, play: null, said: new Set(), quietAt: 0, fillers: 0 };
}
function rnd(B) {
  // mulberry32: the booth's own dice, so a seeded game is called the same way every time.
  let t = (B.seed = (B.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// One of `opts` for this kind of line, not one used for it in the last few times.
function pick(B, key, opts) {
  opts = opts.filter(Boolean);
  if (!opts.length) return '';
  const used = B.recent.get(key) ?? [];
  const fresh = opts.filter((o) => !used.includes(o));
  const pool = fresh.length ? fresh : opts;
  const o = pool[Math.floor(rnd(B) * pool.length)];
  used.push(o);
  if (used.length > Math.min(4, opts.length - 1)) used.shift();
  B.recent.set(key, used);
  return o;
}
const line = (who, text, pri = 1, hype = 0) => (text ? { who, text: text[0].toUpperCase() + text.slice(1), pri, hype } : null);
const pbp = (text, pri, hype) => line('pbp', text, pri, hype);
const color = (text, pri = 0, hype = 0) => line('color', text, pri, hype);

// Where the ball is, said aloud: "the Cerulean 20", "midfield", "his own 35".
function yardLine(g, poss, spot) {
  spot = Math.round(spot);
  if (spot <= 0 || spot >= 100) return 'the goal line';
  if (spot === 50) return 'midfield';
  return spot < 50 ? `their own ${spot}` : `the ${g.teams[1 - poss].name} ${100 - spot}`;
}
// Team abbreviations in the game's own text ("PAL 29") as the names a voice reads well.
function spoken(g, text) {
  if (!text) return text;
  for (const t of g.teams) if (t.abbr) text = text.replace(new RegExp(`\\b${t.abbr}\\b`, 'g'), t.name);
  return text.replace(/\bTD\b/g, 'touchdown').replace(/\s+/g, ' ').trim();
}
const finish = (g, lines) => lines.filter(Boolean).map((l) => ({ ...l, text: spoken(g, l.text) }));
function scoreLine(g) {
  const [h, a] = g.score;
  const H = g.teams[0], A = g.teams[1];
  if (h === a) return h === 0 ? 'still scoreless' : `tied at ${h}`;
  const [w, l, W] = h > a ? [h, a, H] : [a, h, A];
  return `${W.name} ${w}, ${(W === H ? A : H).name} ${l}`;
}
const clockWords = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60), r = s % 60;
  if (!m) return `${r} seconds`;
  return r ? `${m}:${String(r).padStart(2, '0')}` : `${plural(m, 'minute')}`;
};
const QUARTER = ['', 'first quarter', 'second quarter', 'third quarter', 'fourth quarter', 'overtime'];

// ---------- the open ----------
export function openLines(B, g) {
  const v = venueOf(g);
  const [H, A] = g.teams;
  const when = v.time === 'night' ? 'Good evening' : v.time === 'dusk' ? 'Good evening' : 'Good afternoon';
  const wx = v.roof && g.weather === 'clear' ? 'under the roof' : g.weather === 'clear' ? 'and what a day for football' : `and we have ${WEATHER[g.weather]?.name.toLowerCase()} to deal with today`;
  const where = `${v.name}${STADIUMS[v.stadium]?.roof ? '' : ''}`;
  const out = [pbp(pick(B, 'open', [
    `${when} everybody, and welcome to ${where}. I'm ${CREW.pbp.name}, alongside ${CREW.color.name}, ${wx}. The ${A.name} visit the ${H.name}.`,
    `${when} and welcome to ${TIMES[v.time] === 'Prime time' ? 'prime time ' : ''}football from ${where}! ${CREW.pbp.name} here with ${CREW.color.name}. It's the ${A.name} against the ${H.name}, ${wx}.`,
  ]), 1, 1)];
  // The analyst's key to the game: the biggest type edge either way, or the star to watch.
  const key = keyMatchup(g);
  const star = playerToWatch(g, 0);
  out.push(color(key ? pick(B, 'openkey', [
    `Mack, my key to this one: ${key}.`,
    `The thing I'll be watching, Mack: ${key}.`,
  ]) : star ? `Keep an eye on ${star.name} for the ${H.name}. ${typeFlavor(star.id)}.` : '', 1));
  if (g.playoff) out.push(pbp('And remember, this is the playoffs. Lose and go home.', 1));
  return out.filter(Boolean);
}
// The biggest type edge on the field for either side, in words.
function keyMatchup(g) {
  let best = null;
  for (const [o, d] of [[0, 1], [1, 0]]) {
    const O = g.teams[o].lineup, D = g.teams[d].lineup;
    for (const [os, ds] of [['WR1', 'CB1'], ['WR2', 'CB2'], ['RB', 'MLB'], ['TE', 'SS'], ['QB', 'DE'], ['LT', 'DE'], ['RT', 'LE']]) {
      const a = O[os], b = D[ds];
      if (a == null || b == null) continue;
      const m = bestMatchup(PLAYERS[a], PLAYERS[b]);
      if (m.mult > 1 && (!best || m.mult > best.m)) best = { m: m.mult, a, b, type: m.type, ti: o };
      const r = bestMatchup(PLAYERS[b], PLAYERS[a]);
      if (r.mult > 1 && (!best || r.mult > best.m)) best = { m: r.mult, a: b, b: a, type: r.type, ti: d };
    }
  }
  if (!best) return '';
  return `${nm(best.a)}'s ${best.type} moves against ${nm(best.b)}. That's ${best.m >= 4 ? 'four times' : 'super'} effective, and the ${g.teams[best.ti].name} know it`;
}
function typeFlavor(id) {
  const p = PLAYERS[id];
  if (!p) return '';
  return `${p.name} ${TYPE_FLAVOR[p.types[0]] ?? 'can play'}`;
}

// ---------- before the snap ----------
// Mack sets the scene; now and then Dee adds what to watch on this down.
export function presnapLines(B, g, lp) { return finish(g, presnapRaw(B, g, lp)); }
function presnapRaw(B, g, lp) {
  if (!g || !lp || g.final) return [];
  B.play = { lp, said: new Set(), calls: [], marks: new Set(), deep: false, carrierAt: 0 };
  const o = lp.o, T = g.teams[o], D = g.teams[lp.d];
  const out = [];
  const lead = g.score[o] - g.score[1 - o];
  const late = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 120;
  if (lp.kick?.ko) {
    const deep = lp.play?.onside ? 'They are showing onside.' : 'They are kicking it deep.';
    out.push(pbp(pick(B, 'ko', [
      `${nm(lp.kicker?.id)} on the tee for the ${T.name}. ${deep}`,
      `Kickoff formation. ${nm(lp.kicker?.id)} back for the ${T.name}. ${deep}`,
      `The ${T.name} line up to kick. ${nm(lp.kicker?.id)} is over the ball. ${deep}`,
    ]), 1));
    return out.filter(Boolean);
  }
  if (lp.kick) {
    if (lp.kind === 'punt') out.push(pbp(pick(B, 'punt', [
      `Fourth down. Punt team on, ${nm(lp.kicker?.id)} back from ${yardLine(g, o, g.spot)}.`,
      `They are going to flip the field. ${nm(lp.kicker?.id)} is deep for the ${T.name}.`,
      `Punt formation, ${nm(lp.kicker?.id)} standing back from ${hereLine(g)}.`,
    ]), 1));
    else if (lp.kind === 'xp') out.push(pbp(pick(B, 'xp', [`${nm(lp.kicker?.id)} on for the extra point.`, `The point after, by ${nm(lp.kicker?.id)}.`]), 1));
    else {
      const dist = fgDistance(g);
      out.push(pbp(pick(B, 'fg', [`${nm(lp.kicker?.id)} on for a ${dist}-yard try.`, `Here's ${nm(lp.kicker?.id)}, from ${dist} yards out.`]), 1));
      if (late && lead <= 0 && lead >= -3) out.push(color(lead === 0 ? 'This is for the lead. Ice in the veins time.' : 'This one ties it. No pressure.', 1, 1));
      else if (dist >= 50) out.push(color(`That's a long way, Mack. ${dist >= 55 ? 'I am not sure he has the leg.' : 'He needs to get all of it.'}`, 0));
    }
    return out.filter(Boolean);
  }
  if (g.phase === 'pat') {
    out.push(pbp(pick(B, 'two', ['They are going for two!', `The ${T.name} are going for two here.`]), 1, 1));
    return out.filter(Boolean);
  }
  const goal = g.spot + g.toGo >= 100;
  const dd = `${ORD[g.down]} and ${goal ? 'goal' : say(g.toGo)}`;
  const own = Math.round(g.spot);
  const where = own === 50 ? 'at midfield' : own < 50 ? `on their own ${own}` : `at the ${D.name} ${100 - own}`;
  const red = g.spot >= 80 && !goal;
  const qb = PLAYERS[T.lineup.QB] ? nm(T.lineup.QB) : 'The quarterback';
  let lead1 = '';
  if (late && g.quarter >= 4 && lead < 0) lead1 = pick(B, 'latepre', [`${clockWords(g.clock)} to go, and the ${T.name} need ${lead >= -3 ? 'a field goal' : lead >= -8 ? 'a touchdown' : 'a miracle'}.`, `Under two minutes, the ${T.name} down ${-lead}.`, `Clock is the enemy now. ${clockWords(g.clock)} left, ${T.name} trailing by ${-lead}.`]);
  else if (late && g.quarter === 2) lead1 = pick(B, 'halfpre', [`${clockWords(g.clock)} left in the half.`, 'Two-minute drill before the half.', `Inside two minutes before halftime.`]);
  // The need on the money downs: short yardage, long yardage, the sticks.
  const need = goal ? '' : g.down >= 3 && g.toGo <= 1 ? pick(B, 'needs', ['They need a yard.', 'Just a yard to go for the first.', 'Short yardage here.'])
    : g.down >= 3 && g.toGo >= 8 ? pick(B, 'needl', ['Long way to go for the sticks.', `${T.name} need ${g.toGo} to move the chains.`, 'Obvious passing down.']) : '';
  const form = !lp.formation || need || rnd(B) < 0.7 ? '' : pick(B, `form-${lp.formation}`, FORM_CALL[lp.formation] ?? ['']);
  const front = FRONT_CALL[lp.defFormation] && !form && (g.down >= 3 || goal) && rnd(B) < 0.5 ? FRONT_CALL[lp.defFormation] : '';
  out.push(pbp([lead1, pick(B, 'dd', [
    `${dd} ${where}.`,
    `${red ? 'In the red zone, ' : ''}${dd.toLowerCase()} for the ${T.name} ${where}.`,
    `${T.name} ball, ${dd.toLowerCase()} ${where}.`,
    `${dd}. ${qb} brings them to the line ${where}.`,
    `${dd}, ball ${where}. ${qb} surveys the defense.`,
    `${qb} and the ${T.name}, ${dd.toLowerCase()} ${where}.`,
  ]), need, form, front].filter(Boolean).join(' '), 1));
  // The analyst only on some downs, and always on the big ones.
  const big = g.down >= 3 || late || g.spot >= 90;
  if (big || rnd(B) < 0.4) {
    const c = presnapColor(B, g, lp, { lead, late, goal });
    if (c) out.push(color(c, big ? 1 : 0));
  }
  return out.filter(Boolean);
}
function presnapColor(B, g, lp, { lead, late, goal }) {
  const o = lp.o, T = g.teams[o], D = g.teams[lp.d];
  const opts = [];
  if (g.down === 4) opts.push(`They're going for it on fourth down! ${lead < 0 ? 'They have to.' : 'Gutsy call.'}`);
  if (g.down === 3) {
    const [made, tries] = T.team?.third ?? [0, 0];
    if (tries >= 2) opts.push(`The ${T.name} are ${made} of ${tries} on third down today.`);
    if (g.toGo >= 8) opts.push(`Third and long. The ${D.name} can pin their ears back and get after the quarterback, or sit back in coverage and rally to the tackle short of the sticks.`, `On third and long, Mack, watch for a disguised blitz. The ${D.name} love to show one look and play another.`);
    else if (g.toGo <= 2) opts.push('Short yardage. Everybody in the building knows they need a push up front.', 'This is a big-boy down. Win the line of scrimmage, and you move the chains.');
    else opts.push(`Third and manageable. The ${T.name} have the whole playbook open here.`);
  }
  if (goal && g.spot >= 95) opts.push('Goal line. This is where you find out who wants it more.', 'Inside the five, the field gets awfully small. No room to throw it, so it comes down to the trenches.');
  if (g.spot >= 80 && g.spot < 95) opts.push('Red zone. The field shrinks, and those throwing windows get tight.', 'You have to come away with seven down here, Mack. Settling for three is a win for the defense.');
  if (lp.play?.pa) opts.push('Watch the backfield. This has play-action written on it.', 'If they can sell the run here, the linebackers are going to bite.');
  if (g.down === 1 && g.toGo >= 10 && !goal && rnd(B) < 0.25) opts.push('First down is where you stay ahead of the chains. Get four or five here and the whole playbook opens up.');
  if (g.down === 2 && g.toGo >= 8) opts.push('Second and long. They need to get some of that back before third down.');
  if (lp.disguise === 'show') opts.push('Look at the linebackers creeping up. They are showing blitz!');
  // A Pokémon zoning in, or already in the zone.
  for (const ti of [o, lp.d]) {
    const pw = g.pw?.s?.[ti];
    if (!pw) continue;
    for (const [id, st] of Object.entries(pw)) {
      const w = POWER_OF[id];
      if (!w || !Object.values(g.teams[ti].lineup).includes(Number(id))) continue;
      if (st.on) opts.push(`${nm(id)} is in the zone with ${w.name}. ${ti === o ? 'Get him the ball.' : 'You have to account for him on every snap.'}`);
      else if (st.n > 0 && st.n === w.zone.need - 1) opts.push(`${nm(id)} is one play from zoning in. ${w.name} is close.`);
    }
  }
  // Size: the biggest mismatch across from a receiver.
  for (const [os, ds] of [['WR1', 'CB1'], ['WR2', 'CB2'], ['TE', 'SS']]) {
    const a = T.lineup[os], b = D.lineup[ds];
    if (a == null || b == null) continue;
    const wa = kg(a), wb = kg(b);
    if (wa >= wb * 5 && wa - wb > 60) opts.push(`Look at this matchup outside: ${nm(a)} at ${wa} kilos against ${nm(b)} at ${wb}. That's not fair.`);
    else if (wb >= wa * 5 && wb - wa > 60) opts.push(`${nm(b)} outweighs ${nm(a)} by ${wb - wa} kilos. ${nm(a)} has to win with quickness.`);
    const m = bestMatchup(PLAYERS[a], PLAYERS[b]);
    if (m.mult > 1) opts.push(`Watch ${nm(a)} against ${nm(b)}. ${m.type} on ${PLAYERS[b].types.join(' and ')}, that's super effective.`);
  }
  if (g.weather !== 'clear' && !venueOf(g).roof && rnd(B) < 0.3) {
    const W = WEATHER[g.weather];
    const boosted = Object.values(T.lineup).filter((id) => PLAYERS[id]?.types.includes(W.boost)).map(nm);
    if (boosted.length) opts.push(`${W.name} out there, and ${boosted[0]} loves it.`);
  }
  if (Math.abs(lead) >= 17 && !late) opts.push(lead > 0 ? `The ${T.name} are rolling. They just have to keep it clean now.` : `The ${T.name} need something to get going. Down ${-lead}.`);
  if (B.streak.n >= 3 && B.streak.ti != null) opts.push(B.streak.kind === 'stop' ? `The ${g.teams[B.streak.ti].name} defense has been dominant. ${say(B.streak.n)} straight stops.` : `The ${g.teams[B.streak.ti].name} have all the momentum right now.`);
  const tw = playerToWatch(g, o);
  if (tw && tw.line && !/No stats/.test(tw.line)) opts.push(`${tw.name} has been the story: ${spokenLine(tw.line)}.`);
  if (!opts.length) return '';
  return pick(B, 'precolor', opts);
}
// A stat line as words.
function spokenLine(s) {
  return s.replace(/(\d+)\/(\d+)/, '$1 of $2').replace(/yds/g, 'yards').replace(/ TDs?/g, (m) => (m.endsWith('s') ? ' touchdowns' : ' touchdown')).replace(/INT/g, 'interception').replace(/ · /g, ', ');
}

// ---------- during the play ----------
// One live event: Mack's call for it, or nothing. Keeps to a few words; the speech queue drops
// a call the play has already run past.
export function liveLine(B, lp, e) {
  const P = B.play?.lp === lp ? B.play : (B.play = { lp, said: new Set(), calls: [], marks: new Set(), deep: false, carrierAt: 0 });
  const g = lp.g;
  const who = e.who, other = e.other;
  const n = who ? nm(who.id) : '', m = other ? nm(other.id) : '';
  const once = (k) => { if (P.said.has(k)) return false; P.said.add(k); return true; };
  switch (e.kind) {
    case 'handoff': {
      if (!once('handoff')) return null;
      const dir = lp.play?.dir;
      const call = {
        inside: [`Handoff to ${n}, inside zone.`, `${n} takes it up the middle, looking for a crease.`, `Give to ${n}, he presses the line.`],
        outside: [`${n} on the stretch play, heading for the edge.`, `Outside zone, ${n} stretching it wide.`],
        power: [`Power, the guard pulls, and ${n} follows him.`, `${n} off tackle behind the pulling guard.`],
        counter: [`Counter, ${n} cuts back against the grain.`, `Misdirection, the counter to ${n}.`],
        toss: [`Toss to ${n}, racing for the corner.`, `Pitch to ${n}, he wants the edge.`],
        dive: [`Quick hitter, ${n} straight up the gut.`, `Dive play, ${n} hits it downhill.`],
        trap: [`Trap play, ${n} right up the middle.`, `They let the tackle in, trap block, ${n} with the ball.`],
        sweep: [`Sweep, ${n} with linemen out in front.`, `${n} on the sweep, he has convoy.`],
        draw: [`Draw play! Delayed handoff to ${n}.`, `Shows pass, and it's a draw to ${n}.`],
        read: [`Zone read, and he gives it to ${n}.`, `Read option, the end crashes, give to ${n}.`],
      }[dir] ?? [];
      return pbp(pick(B, `handoff-${dir ?? 'run'}`, [...call, `Handoff, ${n}.`, `${n} with the carry.`]), 2);
    }
    case 'keep': return once('keep') ? pbp(pick(B, 'keep', [`He pulls it! ${n} keeps!`, `The end crashed, and ${n} keeps it himself!`, `Fakes the give, ${n} keeps!`]), 2, 1) : null;
    case 'scramble': return once('scramble') ? pbp(pick(B, 'scramble', [
      `The pocket breaks down, and ${n} takes off!`,
      `${n} steps up and runs!`,
      `Flushed out of the pocket, ${n} on the move!`,
      `Nobody open, so ${n} tucks it and runs!`,
    ]), 2, 1) : null;
    case 'throw': {
      if (!once('throw')) return null;
      if (!other) return pbp(pick(B, 'away', [`Nothing open, ${n} throws it away.`, 'He gets rid of it, out of bounds.', `${n} throws it into the stands. Live to play another down.`]), 2);
      const air = (other.x ?? 0) - (who?.x ?? 0);
      const heat = lp.pressure ? pick(B, 'heat', ['Under pressure, ', 'With a man in his face, ', 'Off his back foot, ']) : '';
      P.deep = air >= 18;
      const c = lp.offCall;
      const lead = (t) => (heat && !t.startsWith(n) && !t.startsWith(m) ? heat + t[0].toLowerCase() + t.slice(1) : heat + t);
      if (P.deep) return pbp(heat + pick(B, `deep-${c}`, [
        ...(c === 'four_verts' ? [`everybody's going deep. ${n} launches one for ${m}!`] : []),
        ...(c === 'pa_deep' ? [`play-action, ${n} sets and fires deep for ${m}!`] : []),
        ...(c === 'post' ? [`${n} lets it fly, deep post for ${m}!`] : []),
        `${n} goes deep for ${m}!`,
        `here's the shot down the field, for ${m}!`,
        `${n} airs it out, ${m} is going!`,
      ]), 2, 1);
      const call = {
        slant: [`${n} on the quick slant for ${m}.`, `Three-step drop, slant to ${m}.`],
        out: [`${n} throws the out, to ${m} on the sideline.`, `Quick out for ${m}.`],
        stick: [`${n} looks for ${m} on the stick route.`],
        curl: [`${n} throws for ${m}, sitting down in the zone.`, `Curl route, ${m} turns for the ball.`],
        curl_flat: [`${n} throws for ${m}, sitting down in the zone.`, `High-low on the flat defender, ${n} throws for ${m}.`],
        mesh: [`${n} throws for ${m} on the shallow cross.`, `Crossers underneath, ${n} hits ${m} on the move.`],
        smash: [`${n} throws for ${m}.`, `Smash concept, ${n} throws for ${m}.`],
        dagger: [`${n} throws the dig, over the middle for ${m}.`],
        levels: [`${n} throws over the middle for ${m}.`],
        flood: [`${n} throws to the sideline for ${m}.`],
        y_cross: [`${m} working all the way across the field, here's the throw.`],
        te_seam: [`${n} throws up the seam for ${m}.`, `Up the seam, looking for ${m}.`],
        screen: [`Screen pass! ${n} dumps it to ${m}, and he has blockers.`, `They let the rush in, and it's a screen to ${m}.`],
        bubble: [`Bubble screen out to ${m}.`, `Quick screen to ${m}, he has blockers out front.`],
        pa_boot: [`Bootleg, ${n} rolls out and throws for ${m}.`, `Play-action, ${n} on the boot, looking for ${m}.`],
      }[c] ?? [];
      return pbp(lead(pick(B, `throw-${c}`, [
        ...call,
        `${n} throws for ${m}.`,
        `${n} delivers it on time to ${m}.`,
        air < 6 ? `${n} checks it down to ${m}.` : `${n} finds ${m}.`,
      ])), 2);
    }
    case 'catch': {
      if (lp.kick) return once('kcatch') ? pbp(pick(B, 'kcatch', [
        `${n} fields it, and here comes the return.`,
        `${n} brings it out, looking for a seam.`,
        `${n} gathers it in and takes off.`,
      ]), 2, 1) : null;
      if (!once('catch')) return null;
      const at = fieldAt(lp, who?.x);
      const side = lp.play?.sideline && Math.abs(who?.y ?? 0) > 20;
      return P.deep ? pbp(pick(B, 'deepcatch', [`Caught at ${at}! ${n} hauls it in!`, `What a grab by ${n}!`, `${n} goes up and gets it!`, `He's got it! ${n} over the top!`]), 3, 2) : pbp(pick(B, side ? 'scatch' : 'catch', side ? [
        `${n} gets a foot down, caught at ${at}.`,
        `Toe tap on the sideline, ${n} makes the catch.`,
      ] : [
        `Caught by ${n} at ${at}.`,
        `${n} makes the catch, and he looks for more.`,
        `Complete to ${n}.`,
        `${n} hauls it in at ${at}.`,
        `Got it, ${n}, yards after the catch!`,
      ]), 2);
    }
    case 'int': return once('int') ? pbp(pick(B, 'int', [
      `Intercepted! ${n} jumps the route!`,
      `Picked off! ${n} undercuts it!`,
      `Into coverage, and it's intercepted by ${n}!`,
      `He never saw him! Picked off by ${n}!`,
    ]), 3, 2) : null;
    case 'incomplete': {
      if (!once('inc')) return null;
      const t = e.text || '';
      if (/dropped/i.test(t)) return pbp(pick(B, 'drop', ['Dropped! Right through his hands.', `Off the hands of ${n}! He has to make that catch.`, 'He dropped it! That was right on the money.', `${n} can't hang on!`, 'Dropped! Hit him in the hands.', `Ball goes right off ${n}'s hands.`]), 2, 1);
      if (/broken up|knock/i.test(t) && other) return pbp(pick(B, 'pbu', [`Broken up by ${m}!`, `${m} gets a hand in there!`, `Great coverage, ${m} knocks it away.`, `${m} breaks it up!`]), 2, 1);
      return pbp(pick(B, 'inc', ['Incomplete.', 'Falls incomplete.', 'Nobody there, incomplete.', 'Off target, incomplete.', 'Overthrown, incomplete.']), 2);
    }
    case 'deflect': return once('deflect') ? pbp(pick(B, 'tip', ['Tipped!', 'Batted at the line!', 'Got a finger on it!', 'Tipped in the air!']), 2, 1) : null;
    case 'broken': {
      const how = /trucks|runs over/.test(e.text) ? 'truck' : /spins/.test(e.text) ? 'spin' : /jukes/.test(e.text) ? 'juke' : 'shake';
      if (P.said.has(`brk:${who?.id}`) && P.calls.length > 3) return null;
      P.said.add(`brk:${who?.id}`);
      const opts = {
        truck: [`${n} runs right over ${m}!`, `${n} trucks ${m}!`, `Oh, ${n} just bowled over ${m}!`],
        spin: [`Spin move! ${n} gets away from ${m}!`, `${n} spins out of it!`],
        juke: [`${n} jukes ${m}!`, `Oh, ${n} made ${m} miss!`, `${m} grabs nothing but air!`],
        shake: [`${n} shakes ${m}!`, `${n} breaks a tackle!`, `He breaks a tackle. ${m} cannot bring him down!`],
      }[how];
      return pbp(pick(B, `brk-${how}`, opts), 2, 1);
    }
    case 'ghost': return pbp(pick(B, 'ghost', [`${n} goes right through ${m}! You can't tackle a ghost!`, `${n} phases through him!`]), 2, 2);
    case 'slip': return once('slip') ? pbp(pick(B, 'slip', [`${n} slips!`, `${n} loses his footing!`]), 2) : null;
    case 'bighit': return pbp(pick(B, 'bighit', ['Boom! What a shot!', `What a hit by ${n}!`, `${n} lays the lumber!`, `Oh, ${n} unloads on him!`, `${n} delivers the blow!`]), 2, 2);
    case 'sack': return once('sack') ? pbp(pick(B, 'sack', [
      `The pocket collapses, and he's sacked! ${n} gets him!`,
      `${n} off the edge, and he gets home! Sack!`,
      `Down goes ${m}! ${n} with the sack!`,
      `${m} is in trouble, and he's sacked by ${n}!`,
    ]), 3, 2) : null;
    case 'flag': return once('flag') ? pbp(pick(B, 'flag', ['Flag on the play.', "There's a flag down.", 'And we have laundry on the field.', 'Yellow flag is out.']), 2, 1) : null;
    case 'power':
      if (!who?.power || !once(`pw:${who.id}`)) return null;
      return pbp(pick(B, 'power', [`${who.power.name}! ${n}!`, `There's ${who.power.name} from ${n}!`]), 3, 2);
    case 'typefx':
      if (e.fx !== 'se' && !/super effective/i.test(e.text)) return null;
      if (!once('se') || rnd(B) < 0.45) return null;
      return color(pick(B, 'se', ["It's super effective!", "Super effective! You'll feel that one.", 'Type advantage, right there!', `${n} had the type on him there.`, 'Oh, that is super effective!']), 2, 1);
    case 'kickoff': return once('kickoff') ? pbp(pick(B, 'kickoff', [
      `${n} approaches, and the kick is away. Nice and high.`,
      `${n} puts his foot into it, and the kick is away.`,
      `Here's the kickoff. The kick is away, good hang time.`,
    ]), 2, 1) : null;
    case 'punt': return once('puntk') ? pbp(pick(B, 'puntk', [
      `Snap is back to ${n}, and the punt is away.`,
      `${n} gets it off. The punt is away, high and deep.`,
      `Protection holds, the punt is away.`,
    ]), 2, 1) : null;
    case 'fgkick': return once('fgk') ? pbp(pick(B, 'fgk', ['The snap, the hold, the kick is up...', 'Snap is good, hold is down, here is the kick...', 'Down, and the kick is on the way...']), 2, 1) : null;
    case 'fg_good': return once('fgres') ? pbp(pick(B, 'fggood', ["Through the uprights. It's good!", 'Right down the middle. It is good!', 'And it is good!', "Split the uprights. It's good!"]), 3, 2) : null;
    case 'fg_miss': return once('fgres') ? pbp(pick(B, 'fgmiss', ['Off the mark. No good!', "Wide right! It's no good!", "Wide left! It's no good!", "It hits the upright, and it's no good!", 'Short, and no good!']), 3, 2) : null;
    case 'block': return once('block') ? pbp(pick(B, 'block', ['Blocked! It is blocked!', `${n} gets a hand on it! Blocked!`]), 3, 2) : null;
    case 'fair': return once('fair') ? pbp(`Fair catch, ${n}.`, 2) : null;
    case 'downed': return once('downed') ? pbp('Downed by the coverage.', 2) : null;
    case 'fake': return once('fake') ? pbp(pick(B, 'fake', ['They sold the kick. It is a fake!', 'Fake! They are running a fake!']), 3, 2) : null;
    case 'recover': return once('recover') ? pbp(pick(B, 'recover', [`${n} recovers!`, `${n} falls on it!`, `Who has it? ${n} has it!`]), 3, 2) : null;
    default: return null;
  }
}

// While a kickoff or a punt hangs, one call of the landing: hash and yard line, so you can get under it.
function kickSpotLine(B, lp) {
  const K = lp.kick, F = K?.F;
  if (!F || K.onside || K.stage !== 'air' || lp.ball?.state !== 'air' || !(K.ko || K.punt)) return null;
  const P = B.play?.lp === lp ? B.play : null;
  if (!P) return null;
  const age = lp.t - F.t0;
  if (age < 0.35 || age > 1.5 || P.marks.has('kickspot')) return null;
  P.marks.add('kickspot');
  const g = lp.g;
  const from = K.ko ? (g.spot || 35) : g.spot;
  const abs = from + F.tx;
  const side = F.ty >= 0 ? 'right' : 'left';
  const a = Math.abs(F.ty);
  const hash = a < 4 ? 'middle' : a < 16 ? `${side} hash` : `${side} numbers`;
  let where;
  if (abs >= 100) where = 'into the end zone';
  else {
    const their = Math.max(1, Math.min(50, Math.round(100 - abs)));
    where = their >= 45 ? 'near midfield' : `around the ${yardWord(their)}`;
  }
  const depth = abs >= 90 ? 'Deep' : 'Short';
  return pbp(`${depth}, ${hash}, ${where}.`, 2, 1);
}

// The run in the open field: called off the carrier's progress each frame. Returns a line the
// first time he breaks into the clear and as he passes the 30, 20 and 10 on a long run.
export function progressLine(B, lp) {
  const spot = kickSpotLine(B, lp);
  if (spot) return spot;
  const P = B.play;
  if (!P || P.lp !== lp || lp.phase !== 'live') return null;
  const c = lp.ball?.holder;
  if (!c || lp.ball.state !== 'held') return null;
  const up = c.side === 'off';
  const gained = up ? c.x : -c.x;
  const toGo = up ? lp.goalX - c.x : c.x - lp.ownGoalX;
  // Defenders (from the carrier's point of view) between him and the goal line, and close.
  const chasers = lp.players.filter((q) => q.side !== c.side && (up ? q.x > c.x - 1 : q.x < c.x + 1) && Math.hypot(q.x - c.x, q.y - c.y) < 6).length;
  const n = nm(c.id);
  const mark = (k) => { if (P.marks.has(k)) return false; P.marks.add(k); return true; };
  // A quarterback run has no handoff to call: say it as he takes off.
  const qdir = lp.play?.dir;
  if (c === lp.off.QB && lp.kind === 'run' && ['sneak', 'qbdraw', 'qbpower'].includes(qdir) && lp.t > (qdir === 'qbdraw' ? 0.9 : 0.25) && mark('qbrun')) {
    const dir = qdir;
    return pbp(pick(B, `qbrun-${dir}`, {
      sneak: [`Quarterback sneak, ${n} pushes behind the center.`, `${n} on the sneak.`],
      qbdraw: [`Quarterback draw! ${n} takes off up the middle.`, `He drops like it's a pass, and ${n} takes off!`],
      qbpower: [`${n} keeps it on the power, guard leading the way.`, `Quarterback power, ${n} follows his blockers.`],
    }[dir] ?? [`${n} keeps it and runs.`]), 2, dir === 'qbdraw' ? 1 : 0);
  }
  if (gained >= 12 && chasers === 0 && toGo > 25 && mark('open')) return pbp(pick(B, 'open', [
    `${n} breaks into the clear!`,
    `He's got daylight! ${n} is loose!`,
    `Nothing but green grass in front of ${n}!`,
    `${n} hits the second level, and he is gone!`,
    `${n} turns the corner, and he's got room to run!`,
  ]), 2, 2);
  for (const yd of [30, 20, 10]) {
    if (toGo <= yd && toGo > yd - 6 && gained >= 15 && mark(`yd${yd}`)) {
      if (yd === 20 && chasers === 0 && mark('allway')) return pbp(pick(B, 'allway', ['He could go all the way!', `${n} could go all the way!`, 'Nobody is going to catch him!', `${n}, the twenty, the fifteen...`]), 2, 2);
      return pbp(yd === 10 ? pick(B, 'yd10', ['Inside the ten!', `${n} to the ten!`, 'Down to the ten, and still going!']) : pick(B, `yd${yd}`, [`The ${yardWord(yd)}!`, `He's at the ${yardWord(yd)}!`, `${n}, to the ${yardWord(yd)}!`]), 2, 2);
    }
  }
  return null;
}
// How tense the stadium should sound right now (0 calm .. 1 everyone on their feet): the ball
// in the air on a deep shot, a runner loose in the open field.
export function tension(lp) {
  if (!lp || lp.phase !== 'live') return 0;
  const b = lp.ball;
  if (b?.state === 'air' && !lp.kick && lp.thrown) {
    const r = lp.thrown.target;
    const air = r ? r.x - (lp.off.QB?.x ?? 0) : 0;
    return air >= 15 ? 0.75 : 0.35;
  }
  const c = b?.holder;
  if (!c || b.state !== 'held') return 0;
  const up = c.side === 'off';
  const gained = up ? c.x : -c.x, toGo = up ? lp.goalX - c.x : c.x - lp.ownGoalX;
  if (gained < 6) return 0.1;
  return Math.min(1, 0.25 + gained / 50 + (toGo < 20 ? 0.3 : 0));
}

// ---------- after the whistle ----------
// The play went into the game as `e` (its log entry); `before` is the game as it was at the
// snap; `lp` the live play (null for a play resolved without the field). Mack wraps it up if
// the live calls didn't already say it all, and Dee tells you what it meant.
export function afterLines(B, g, e, before = null, lp = null) { return finish(g, afterRaw(B, g, e, before, lp)); }
function afterRaw(B, g, e, before, lp) {
  if (!e) return [];
  const out = [];
  const P = B.play?.lp === lp && lp ? B.play : null;
  const said = P?.said ?? new Set();
  B.play = null;
  const o = e.team ?? before?.poss ?? g.poss;
  const T = g.teams[o], D = g.teams[1 - o];
  const yd = e.yards ?? 0;
  const scoredBy = before ? [0, 1].find((i) => g.score[i] - before.score[i] >= 6) : null;
  const td = e.highlight === 'td' || (e.kind === 'score' && /TOUCHDOWN/.test(e.text ?? '')) || (scoredBy != null && !e.conversion);
  const c = e.carrier;
  const notes = lp?.notes ?? [];
  const changed = before && g.poss !== before.poss && !g.final;
  // The game's own clock events: the end of a quarter, the two-minute warning, timeouts.
  if (e.kind === 'quarter') return quarterLines(B, g, e);
  if (e.kind === 'timeout') return [pbp(pick(B, 'to', [`Timeout, ${(e.text ?? '').match(/^(.+?) (call|use|take)/)?.[1] ?? 'on the field'}.`, 'And there is a timeout.']), 1)].filter(Boolean);
  if (e.kind === 'info') return e.head && /two-minute/i.test(e.head) ? [pbp("That's the two-minute warning.", 1), color(`${scoreLine(g)}. Here's where games are won, Mack.`, 1)] : [];
  if (e.kind === 'sub') return [];
  // Penalties: the referee's call.
  if (e.kind === 'penalty' || e.highlight === 'flag') {
    const txt = (e.text ?? '').replace(/\s+/g, ' ').trim();
    out.push(pbp(txt ? `${said.has('flag') ? '' : 'Flag. '}${txt}` : 'There is a flag on the play.', 1));
    out.push(color(pick(B, 'flagc', ['You cannot do that. Drive killer.', "That's a mental mistake.", 'Discipline, Mack. That hurts.']), 0));
    return out.filter(Boolean);
  }
  // Kicks resolved on the spot or played out on the field.
  if (e.conversion) {
    const good = g.score[o] > (before?.score?.[o] ?? g.score[o]) || /good|is good|GOOD/.test(e.text ?? '');
    if (/two|2-point|conversion/i.test(e.head ?? '') && !/Extra point/i.test(e.head ?? '')) out.push(pbp(good ? pick(B, '2good', ['They get it! Two-point try is good!', 'In for two!']) : pick(B, '2no', ['They come up short on the try.', 'No good on the two-point try.']), 2, good ? 2 : 1));
    else if (!said.has('fgres')) out.push(pbp(good ? pick(B, 'xpgood', ['The extra point is good.', 'And the point after is good.']) : 'The extra point is no good!', 1, good ? 0 : 1));
    out.push(pbp(`${scoreLine(g)}.`, 1));
    return out.filter(Boolean);
  }
  const kind = OFF_PLAYS[e.off]?.kind;
  if (e.kind === 'kick' || /Kickoff/i.test(e.head ?? '')) {
    if (/Touchback/i.test(e.text ?? '')) out.push(pbp(pick(B, 'tb', ['Into the end zone, touchback.', 'Touchback.']), 1));
    else if (/onside/i.test(e.text ?? '')) out.push(pbp(e.text, 2, 1));
    else if (lp && e.text) out.push(pbp(`${e.text.replace(/\.$/, '')}.`, 1));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy ?? 1 - o, 'return'));
    return out.filter(Boolean);
  }
  if (kind === 'punt' && !OFF_PLAYS[e.off]?.fake || e.kind === 'punt') {
    out.push(pbp(e.text ? e.text.replace(/\s+/g, ' ') : 'The punt.', 1));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy ?? 1 - o, 'return'));
    return out.filter(Boolean);
  }
  if (e.kind === 'score' && e.highlight === 'fg') {
    if (!said.has('fgres')) out.push(pbp(pick(B, 'fgg', ['The field goal is good.', "And it's good."]), 1, 1));
    out.push(pbp(`${scoreLine(g)}.`, 1));
    const late = g.quarter >= 4 && g.clock <= 300 && Math.abs(g.score[0] - g.score[1]) <= 3;
    out.push(color(late ? 'Points on the board, and this one goes down to the wire.' : pick(B, 'fgc', ['The drive stalled, but you take the points.', 'Three points. You would like seven, but you take three.']), 0));
    return out.filter(Boolean);
  }
  if (e.kind === 'fg' || (kind === 'fg' && !OFF_PLAYS[e.off]?.fake && !e.highlight)) {
    if (!said.has('fgres')) out.push(pbp('The kick is no good.', 1, 1));
    out.push(color(pick(B, 'fgm', ['Points left on the field, Mack.', 'That one is going to sting.']), 0));
    return out.filter(Boolean);
  }
  if (/safety/i.test(e.text ?? '') && e.kind === 'score') {
    out.push(pbp(`Safety! Two points for the ${D.name}!`, 3, 2));
    out.push(pbp(`${scoreLine(g)}.`, 1));
    return out;
  }
  // Takeaways.
    if (e.turnover === 'fumble' || /FUMBLE!/.test(e.text ?? '') && changed) {
    out.push(pbp(pick(B, 'fum', [
      `Contact, and the ball is out. Fumble! The ${D.name} recover!`,
      `He did not protect it. Fumble! ${D.name} have it!`,
    ]), 3, 2));
    out.push(color(pick(B, 'fumc', [`${nm(c)} has to protect the football there. Two hands in traffic.`, 'Huge turnover. That changes everything.']), 1, 1));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy, 'defense'));
    streak(B, 1 - o, 'stop');
    return out.filter(Boolean);
  }
  if (e.turnover === 'int' || (e.kind === 'turnover' && /INTERCEPT/i.test(e.text ?? ''))) {
    const by = e.returner ?? c;
    if (!said.has('int')) out.push(pbp(`Intercepted by ${nm(by)}!`, 3, 2));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy, 'pick'));
    else out.push(color(pick(B, 'intc', [`${nm(by)} read that all the way. The quarterback never saw him.`, 'Bad decision. You cannot throw that ball into coverage.', `What a play by ${nm(by)}. That's a game changer.`]), 1, 1));
    const n = T.team?.to ?? 0;
    if (n >= 2) out.push(color(`That's ${plural(n, 'turnover')} for the ${T.name} today.`, 0));
    streak(B, 1 - o, 'stop');
    return out.filter(Boolean);
  }
  if (td) {
    out.push(...scoreCall(B, g, e, before, scoredBy ?? o, kind === 'pass' ? 'pass' : 'run'));
    streak(B, scoredBy ?? o, 'score');
    return out.filter(Boolean);
  }
  if ((changed && ['run', 'pass', 'sack', 'play', 'turnover'].includes(e.kind)) || /Turnover on downs/i.test(e.text ?? '')) {
    out.push(pbp(pick(B, 'tod', ['They come up short! Turnover on downs!', `Stopped! The ${D.name} take over on downs.`]), 3, 2));
    out.push(color(pick(B, 'todc', ['Huge stand by that defense.', 'You roll the dice, you live with it.']), 1, 1));
    streak(B, 1 - o, 'stop');
    return out.filter(Boolean);
  }
  // Sacks.
  if (e.kind === 'sack' || e.highlight === 'sack') {
    if (!said.has('sack')) out.push(pbp(`${(e.text ?? '').split('.')[0]}.`, 2, 1));
    out.push(color(pick(B, 'sackc', [
      'The pocket collapsed. He had nowhere to go.',
      'Great push up front. That is a drive killer.',
      `The ${D.name} front is winning the battle in the trenches.`,
      'He held onto it too long, Mack. Everybody was covered, and the rush got there.',
      'Watch the edge rusher on the replay. Beats the tackle with a speed rush and bends around the corner.',
      'Drive-killing sack. Now they are behind the chains.',
    ]), 1));
    streak(B, 1 - o, 'stop');
    return out.filter(Boolean);
  }
  // Runs, catches and incompletions.
  const first = before && !changed && g.down === 1 && before.down >= 1 && yd > 0 && g.poss === before.poss;
  const inc = lp?.end?.how === 'incomplete' || (kind === 'pass' && yd === 0 && /incomplete|broken up|dropped|thrown away|throws it away|overthrown|off the hands/i.test(e.text ?? ''));
  if (inc) {
    if (!said.has('inc')) out.push(pbp(pick(B, 'incw', ['Incomplete.', 'The pass falls incomplete.']), 1));
    if (g.down === 4 || (before?.down === 3)) out.push(color(pick(B, 'inc3', ['Bring on the punt team.', 'They have a decision to make on fourth down.']), 0));
    streak(B, 1 - o, 'stop');
  } else if (c != null) {
    const wrap = endWrap(B, g, e, lp, yd);
    if (wrap) out.push(pbp(wrap, 1, yd >= 20 ? 1 : 0));
    const fgoal = first && g.spot + g.toGo >= 100;
    if (first) out.push(pbp(fgoal ? pick(B, 'firstg', ['And that sets up first and goal.', `First and goal, ${T.name}.`]) : pick(B, 'first', ['First down.', `And that's a first down, ${T.name}.`, 'That will move the chains.', 'Past the sticks for a first down.', "He's got the marker. First down.", `First down, ${T.name}, and they keep it moving.`, 'And they pick up the first.', 'Enough for the first down.']), 1, yd >= 15 ? 1 : 0));
    if (yd <= 0) streak(B, 1 - o, 'stop'); else if (first) streak(B, o, 'go');
  }
  // Dee: why it happened. A power switching on, a type, an ability, size, the weather, a
  // milestone, the drive; otherwise a word on how the play was won, now and then.
  const why = whyLine(B, g, e, before, lp, notes, { yd, first, inc });
  if (why) out.push(color(why, why.length > 0 && (e.powers?.length || yd >= 20) ? 1 : 0, e.powers?.some((p) => p.on) ? 1 : 0));
  return out.filter(Boolean);
}
// The whistle on a play the live calls followed: where he went down, unless it was obvious.
function endWrap(B, g, e, lp, yd) {
  const c = e.carrier, n = nm(c);
  const how = lp?.end?.how;
  const tk = lp?.end?.tackler ? nm(lp.end.tackler.id) : (e.text ?? '').match(/Tackled by ([^.]+)\./)?.[1];
  const at = yardLine(g, g.poss, g.spot);
  const spot = hereLine(g);
  if (how === 'out') return pick(B, 'oob', [`${n} steps out of bounds at ${at}.`, `${n} gets out of bounds, ${yd > 0 ? `a gain of ${yd}` : 'no gain'}.`, `${n} runs out of bounds to stop the clock${yd > 0 ? `, ${yd} yards on the play` : ''}.`]);
  if (how === 'slide') return pick(B, 'slide', [`${n} slides down at ${spot}. Smart, and the clock stops.`, `${n} gets down at ${spot}. Lives to play another down.`]);
  if (yd < 0) return pick(B, 'loss', [`${tk ? `${tk} drops ${n}` : `${n} is dropped`} for a loss of ${-yd}.`, `Stuffed in the backfield! Loss of ${-yd}.`, `${tk ? `${tk} blows it up` : 'They blow it up'} in the backfield. Tackle for loss.`]);
  if (yd === 0) return pick(B, 'nogain', [`${tk ? `Stopped by ${tk}` : 'Stopped'} for no gain.`, 'Stuffed at the line of scrimmage, no gain.', `${n} goes nowhere.`, `${tk ? `${tk} plugs the hole.` : 'They plug the hole.'} No gain.`]);
  if (yd >= 20) return pick(B, 'bigwrap', [`${n} for ${yd}! ${tk ? `Finally brought down by ${tk} at ${spot}.` : ''}`, `A gain of ${yd} on the play!`, `${yd} yards! ${tk ? `${tk} saves the touchdown.` : ''}`, `Big play! ${n} picks up ${yd} before ${tk ? `${tk} drags him down` : 'they drag him down'}.`]).trim();
  if (yd <= 3) return pick(B, 'short', [`${n} grinds out ${say(yd)}.`, `${n} for a short gain of ${say(yd)}.`, `${n} falls forward for ${say(yd)}.`, `${tk ? `${tk} wraps him up` : 'Wrapped up'} after a gain of ${say(yd)}.`]);
  return pick(B, 'gain', [
    `${n} picks up ${say(yd)}, brought down at ${spot}.`,
    `${tk ? `${tk} makes the stop` : 'Brought down'} at ${spot}, a gain of ${say(yd)}.`,
    `Nice gain, ${say(yd)} yards for ${n}.`,
    `${n} picks up ${say(yd)}.`,
    `${n} gets ${say(yd)} before ${tk ? tk : 'the defense'} gets him down.`,
  ]);
}
function scoreCall(B, g, e, before, ti, how) {
  ti = ti ?? e.team ?? g.poss;
  const T = g.teams[ti];
  const c = e.returner ?? e.scorer ?? e.carrier;
  const yd = e.yards ?? 0;
  const out = [];
  const cry = how === 'pick' ? 'Pick six!' : how === 'return' ? 'He took it to the house!' : 'Touchdown!';
  const from = how === 'pass' || how === 'run' ? `from ${yd === 1 ? 'a yard' : `${yd} yards`} out` : 'all the way';
  const scorer = c != null ? nm(c) : T.name;
  out.push(pbp(pick(B, `td-${how}`, [
    `He will not be denied! ${cry} ${T.name}!`,
    `He's in! ${cry} ${scorer}!`,
    `${cry} ${scorer} ${from}!`,
    `${scorer} into the end zone! ${cry}`,
    how === 'run' ? `${scorer} punches it in! ${cry}` : how === 'pass' ? `Pitch and catch, and that's a ${cry.toLowerCase().replace('!', '')}! ${scorer}!` : `Nobody is catching him! ${cry}`,
  ]), 3, 2));
  const lead = g.score[ti] - g.score[1 - ti];
  const late = g.quarter >= 4 && g.clock <= 300;
  const d = g.drives[g.drives.length - 1];
  const opts = [boothAfter(g, e, before, [])];
  if (late && lead > 0 && lead <= 8) opts.push(`The ${T.name} take the lead late! What a moment in this building.`);
  if (d && d.team === ti && d.plays >= 8) opts.push(`A ${d.plays}-play drive, capped off in style. That's championship football.`);
  if (yd >= 40) opts.push(`${nm(c)} ${TYPE_FLAVOR[PLAYERS[c]?.types[0]] ?? 'is special'}. ${yd} yards, and he made it look easy.`);
  if (how === 'pass' && e.qb != null) opts.push(`${nm(e.qb)} put that ball right on the money for ${nm(c)}.`);
  out.push(color(pick(B, 'tdc', opts), 1, 1));
  return out.filter(Boolean);
}
function whyLine(B, g, e, before, lp, notes, { yd, first, inc }) {
  const opts = [];
  const pw = (e.powers ?? []).find((p) => p.on);
  if (pw) {
    const w = POWER_OF[pw.id];
    return `${nm(pw.id)} is in the zone! ${w?.name ?? 'His power'} is on. ${w?.text ? w.text.split(':')[0].replace(/\.$/, '') + '.' : ''}`.trim();
  }
  const off = (e.powers ?? []).find((p) => !p.on);
  if (off) return `And that costs ${nm(off.id)} ${POWER_OF[off.id]?.name ?? 'his power'}. He's out of the zone.`;
  // Each note once a game: an ability that acts on every snap is worth saying the first time.
  const fresh = notes.filter((x) => !B.said.has(x.text));
  const n = fresh.find((x) => x.kind === 'ability') ?? fresh.find((x) => x.kind === 'type') ?? fresh.find((x) => x.kind === 'size') ?? fresh.find((x) => x.kind === 'power');
  if (n && rnd(B) < 0.8) {
    B.said.add(n.text);
    const t = n.text.replace(/\.$/, '');
    opts.push({ ability: pick(B, 'nab', [`Did you see that? ${t}. Abilities matter in this league.`, `${t}. That ability is a big reason that play went the way it did.`]), type: pick(B, 'ntype', [`${t}. The type matchup won that rep.`, `That's ${t.toLowerCase()}. You can't coach around a type disadvantage.`]), size: pick(B, 'nsize', [`${t}. Size matters, Mack.`, `${t}. Too much Pokémon for him.`]), power: `${t}.` }[n.kind] ?? `${t}.`);
  }
  if (lp?.end?.how === 'tackle' && lp.end.tackler && e.hit?.speed > 0) {
    const q = lp.end.tackler.id;
    if (kg(q) >= 200 && rnd(B) < 0.5) opts.push(`${nm(q)} is ${kg(q)} kilos of bad news. You feel that one in the upper deck.`);
  }
  const sch = schemeLine(B, g, e, lp, { yd, inc });
  if (sch && rnd(B) < 0.55) opts.push(sch);
  const bb = boothAfter(g, e, before, notes);
  if (bb) opts.push(bb);
  if (!opts.length && !inc && yd >= 10 && rnd(B) < 0.7) {
    const c = e.carrier;
    opts.push(pick(B, 'praise', [`${typeFlavor(c)}. Great vision on that one.`, 'The line opened a hole you could drive a Snorlax through.', `${nm(c)} found the soft spot in that zone. Smart football.`, 'That is great play design. They had the right call on.']));
  }
  if (!opts.length && yd <= 0 && !inc && rnd(B) < 0.5) {
    const tk = lp?.end?.tackler?.id;
    opts.push(pick(B, 'stuffc', [tk ? `${nm(tk)} ${TYPE_FLAVOR[PLAYERS[tk]?.types[0]] ?? 'was right there'}. He read it from the snap.` : 'The defense read that one from the snap.', 'Nowhere to go. They sold out for the run.']));
  }
  if (!opts.length && first && rnd(B) < 0.3) opts.push(pick(B, 'chains', ['Keep the chains moving and good things happen.', 'Methodical. They are taking what the defense gives them.']));
  return opts.length ? pick(B, 'why', opts) : '';
}
// The X's and O's: what the two calls did to each other, said the way an analyst breaks down
// the replay.
function schemeLine(B, g, e, lp, { yd, inc }) {
  const off = lp?.offCall ?? e.off, def = lp?.defCall ?? e.def;
  const O = OFF_PLAYS[off], kind = O?.kind;
  if (!O || !def) return '';
  const blitz = /blitz|dogs|mug|cover0|fire_zone/.test(def);
  const zone = /cover2|tampa2|cover3|cover4|prevent/.test(def);
  const n = e.carrier != null && PLAYERS[e.carrier] ? nm(e.carrier) : 'he';
  if (kind === 'pass' && !inc && yd >= 12) {
    if (def === 'cover0') return pick(B, 'sx-c0', ['Cover zero. They sent everybody, and the deep middle was empty. You make them pay for that.', 'They brought the house, and he beat it. When you blitz with no safety, that is the risk.']);
    if (blitz) return pick(B, 'sx-bl', ['They brought pressure, and he stood in there and delivered. Hot read, right where the blitzer came from.', 'Blitz, and he knew exactly where to go with it. That is beating the pressure.']);
    if (/cover2|tampa2/.test(def)) return pick(B, 'sx-c2', ['That is the hole in Cover 2, right between the corner and the safety. Perfect throw.', 'Cover 2 look, and he hit the honey hole along the sideline.']);
    if (/cover3|cover4/.test(def)) return pick(B, 'sx-c3', [`They were in zone, and ${n} sat down right in the soft spot.`, 'Three deep, four under, and he found the seam between the hook defenders.']);
    if (/man|base|robber/.test(def)) return pick(B, 'sx-man', [`Man coverage, and ${n} just beat his guy. Great release off the line.`, `${n} won the one-on-one. You cannot play man on him all day.`]);
  }
  if (kind === 'pass' && !inc && off === 'mesh' && /man|base/.test(def) && yd >= 5) return 'Mesh against man coverage. The crossers rub the defenders off, and that is the perfect call.';
  if (kind === 'pass' && !inc && /screen|bubble/.test(off) && yd >= 6) return pick(B, 'sx-scr', ['The screen was set up beautifully. Let the rush come, get the big guys out in front.', 'Great job by the linemen getting out on that screen.']);
  if (kind === 'pass' && !inc && O.pa && yd >= 8) return pick(B, 'sx-pa', ['The play-action froze the linebackers. Watch them bite on the fake.', 'They sold the run, and the second level came up. That opened the window behind them.']);
  if (kind === 'pass' && inc && zone && rnd(B) < 0.5) return pick(B, 'sx-inc', ['Good coverage on the back end. Nobody broke open.', 'The defense took that away. Sticky coverage all over the field.']);
  if (kind === 'run' && yd >= 6) {
    if (blitz) return pick(B, 'rx-bl', ['They blitzed, and he ran right through the gap the linebacker left.', 'The run against the blitz. Once he gets past that first wave, the second level is wide open.']);
    if (O.dir === 'counter') return 'The counter gets the linebackers flowing the wrong way, and then he cuts it back.';
    if (O.dir === 'draw') return 'The draw, perfect call. The rush gets upfield, and he runs right past them.';
    if (zone) return pick(B, 'rx-z', ['They were sitting back in coverage, light box, and you run the ball against that all day.', 'Light box, Mack. Six in the box and you can run the football.']);
    if (/outside|toss|sweep/.test(O.dir ?? '')) return 'He got to the edge, and the corner never set the edge. Contain was lost.';
    return pick(B, 'rx-gen', ['Great blocking up front. The combination blocks got to the second level.', `${n} followed his blockers and hit the hole hard.`]);
  }
  if (kind === 'run' && yd <= 0) {
    if (def === 'run_blitz') return 'Great call on defense. The Mike linebacker shoots the A gap, right into the play.';
    if (def === 'goal_line') return 'They stacked the box, and there was nowhere to go.';
    return pick(B, 'rx-stuff', ['Penetration up front. The line got knocked back, and the play never had a chance.', 'Defense was gap sound there. Everybody fit their run responsibility.']);
  }
  return '';
}
function streak(B, ti, kind) {
  const s = B.streak;
  if (s.ti === ti && s.kind === kind) s.n++;
  else Object.assign(s, { ti, kind, n: 1 });
}
function quarterLines(B, g, e) {
  const q = e.q ?? g.quarter - 1;
  if (g.final) {
    const W = g.winner != null ? g.teams[g.winner] : null;
    return [pbp(W ? pick(B, 'final', [`And that's the ballgame! The ${W.name} win it, ${g.score[g.winner]} to ${g.score[1 - g.winner]}!`, `It's over! ${W.name} ${g.score[g.winner]}, ${g.teams[1 - g.winner].name} ${g.score[1 - g.winner]}. That's your final.`]) : `It's over, and it ends in a tie at ${g.score[0]}.`, 3, 2),
      color(W ? pick(B, 'finalc', [`What a performance by the ${W.name}. For ${CREW.pbp.name}, I'm ${CREW.color.name}. Good night everybody.`, `The ${W.name} earned that one. Great game to call, Mack.`]) : 'Nobody wanted to lose this one.', 1, 1)].filter(Boolean);
  }
  if (q === 2) return [pbp(`That's halftime here. ${scoreLine(g)}.`, 1, 1), color(halftimeNote(g), 1)].filter(Boolean);
  return [pbp(`That's the end of the ${QUARTER[q] ?? 'quarter'}. ${scoreLine(g)}.`, 1)].filter(Boolean);
}
function halftimeNote(g) {
  let best = null;
  for (const ti of [0, 1]) for (const [id, s] of Object.entries(g.teams[ti].stats)) {
    const v = (s.py ?? 0) * 0.5 + (s.ry ?? 0) + (s.rcy ?? 0) + ((s.ptd ?? 0) + (s.rtd ?? 0) + (s.rctd ?? 0)) * 20 + (s.dsk ?? 0) * 25 + (s.dint ?? 0) * 30;
    if (!best || v > best.v) best = { v, id, ti };
  }
  if (!best || best.v <= 0) return 'A defensive battle so far. Somebody has to make a play in the second half.';
  return `The story of the first half is ${nm(best.id)}. The ${g.teams[1 - best.ti].name} have to find an answer for him.`;
}

// ---------- between plays ----------
// When the call sheet is up and the booth has been quiet a while: one of Dee's notes.
export function fillerLine(B, g) {
  if (!g || g.final || g.phase !== 'play') return null;
  B.fillers++;
  const o = g.poss, T = g.teams[o], D = g.teams[1 - o];
  const opts = [];
  const tw = playerToWatch(g, o);
  if (tw && !/No stats/.test(tw.line)) opts.push(`${tw.name} today: ${spokenLine(tw.line)}.`);
  const key = keyMatchup(g);
  if (key && B.fillers % 3 === 1) opts.push(`I keep coming back to ${key}.`);
  const def = g.log.filter((x) => x.team === o && x.def && DEF_PLAYS[x.def]).slice(-6);
  const blitz = def.filter((x) => /blitz|dogs|mug|cover0|fire_zone/.test(x.def)).length;
  if (def.length >= 5 && blitz >= 3) opts.push(`The ${D.name} have been bringing pressure all day. ${blitz} blitzes in the last ${def.length} snaps.`);
  const runs = g.log.filter((x) => x.team === o && x.off && OFF_PLAYS[x.off]?.kind === 'run').slice(-8);
  const ry = runs.reduce((s, x) => s + (x.yards ?? 0), 0);
  if (runs.length >= 4) opts.push(ry / runs.length >= 5 ? `The ${T.name} are averaging ${(ry / runs.length).toFixed(1)} a carry lately. Keep pounding it.` : `The ${T.name} run game has been bottled up. ${(ry / runs.length).toFixed(1)} a carry.`);
  if (g.weather !== 'clear' && !venueOf(g).roof) opts.push(`This ${WEATHER[g.weather].name.toLowerCase()} is a factor. ${WEATHER[g.weather].text.split(';')[0]}.`);
  opts.push(`${scoreLine(g)} in the ${QUARTER[g.quarter] ?? 'overtime'}.`);
  return color(pick(B, 'filler', opts), 0);
}
