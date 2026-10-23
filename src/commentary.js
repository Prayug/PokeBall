// The booth: a two-man crew calling the game on the live field. Mack Rivers has the
// play-by-play: the situation before the snap and the action as it happens. Dee Hollis is the
// analyst: why the play worked, what it means for the game.
//
// A real crew talks a lot less than it could. Mack doesn't narrate every handoff and every
// five-yard catch while it happens: he calls the big moments live (the deep shot, the sack, the
// pick, the runner breaking into the open) and wraps the routine plays in one line after the
// whistle. Dee comes in after the play, not over it, and not on every snap. Both keep a memory
// of what they said, so a phrase doesn't come back for a long while and two lines in a row don't
// lean on the same words.
//
// Everything here is words only: each call returns lines ({ who, text, pri, hype }) that
// speech.js reads out and captions, so it runs in node for the tests. `pri` is how much a line
// matters (3 cuts in over anything, 2 is a live call that is stale a beat later, 1 the wrap of a
// play, 0 filler between plays); `hype` how loud the voice gets (0 to 2).
import { PLAYERS } from './ratings.js';
import { DEF_PLAYS, OFF_PLAYS, fgDistance } from './engine.js';
import { POWER_OF } from './powers.js';
import { TIMES, venueOf } from './kits.js';
import { bestMatchup } from './types.js';
import { playerToWatch } from './broadcast.js';

export const CREW = {
  pbp: { name: 'Mack Rivers', role: 'Play-by-play' },
  color: { name: 'Dee Hollis', role: 'Analyst' },
};

const nm = (id) => PLAYERS[id]?.name ?? 'the ball carrier';
const known = (id) => id != null && !!PLAYERS[id];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w.endsWith('ch') ? 'es' : 's'}`;
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
// Where the offense has the ball, for the down and distance: "on their own 25", "at the Cerulean 30".
function ballOn(g, o) {
  const s = Math.round(g.spot);
  if (s === 50) return 'at midfield';
  return s < 50 ? `on their own ${s}` : `at the ${g.teams[1 - o].name} ${100 - s}`;
}
// The yard line `x` yards past the line of scrimmage on a live play.
const fieldAt = (lp, x) => hereLine(lp.g, lp.spot + (x ?? 0));

// ---------- the crew's memory ----------
// One booth per game: the lines it has said (so a phrase doesn't come back soon), the words of
// the last few lines (so the next one doesn't lean on them), the flow of the game, and what has
// been said on the play in progress.
export function createBooth(seed = 1) {
  return { seed: (seed >>> 0) || 1, recent: new Map(), history: [], words: [], streak: { ti: null, n: 0, kind: '' }, play: null, fillers: 0, plays: 0, colorAt: -9 };
}
function rnd(B) {
  // mulberry32: the booth's own dice, so a seeded game is called the same way every time.
  let t = (B.seed = (B.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// The words that make a line sound like the last one: lower-case words of four letters or more
// (names and team names are capitalised, and short words are glue).
const STOP = new Set(['that', 'this', 'with', 'they', 'them', 'their', 'there', 'have', 'from', 'into', 'just', 'what', 'here', 'right', 'down', 'yards', 'yard', 'ball']);
const wordsOf = (t) => (String(t).match(/\b[a-z][a-z'-]{3,}\b/g) ?? []).filter((w) => !STOP.has(w));
// One of `opts`: never one used for this kind of line lately, never one the booth said in the
// last stretch of the game, and the one sharing the fewest words with the last few lines.
function pick(B, key, opts) {
  opts = opts.filter(Boolean);
  if (!opts.length) return '';
  const used = B.recent.get(key) ?? [];
  let pool = opts.filter((o) => !used.includes(o) && !B.history.includes(o));
  if (!pool.length) pool = opts.filter((o) => !used.includes(o));
  if (!pool.length) pool = opts;
  const recentW = new Set(B.words.flat());
  const score = (o) => wordsOf(o).filter((w) => recentW.has(w)).length;
  const best = Math.min(...pool.map(score));
  pool = pool.filter((o) => score(o) === best);
  const o = pool[Math.floor(rnd(B) * pool.length)];
  used.push(o);
  if (used.length > Math.max(1, Math.min(8, opts.length - 1))) used.shift();
  B.recent.set(key, used);
  return o;
}
const line = (who, text, pri = 1, hype = 0) => (text ? { who, text: text[0].toUpperCase() + text.slice(1), pri, hype } : null);
const pbp = (text, pri, hype) => line('pbp', text, pri, hype);
const color = (text, pri = 0, hype = 0) => line('color', text, pri, hype);

// Team abbreviations in the game's own text ("PAL 29") as names a voice reads well.
function spoken(g, text) {
  if (!text) return text;
  for (const t of g.teams) if (t.abbr) text = text.replace(new RegExp(`\\b${t.abbr}\\b`, 'g'), t.name);
  return text.replace(/\bTD\b/g, 'touchdown').replace(/\s+/g, ' ').trim();
}
// The lines a call hands back: spoken forms, nothing the booth said a moment ago, and the memory
// updated.
function finish(B, g, lines) {
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    const text = spoken(g, l.text);
    if (!text) continue;
    if (l.pri < 3 && B.history.slice(-12).includes(text)) continue;
    out.push({ ...l, text });
    B.history.push(text);
    if (B.history.length > 60) B.history.shift();
    B.words.push(wordsOf(text));
    if (B.words.length > 4) B.words.shift();
  }
  return out;
}
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
  return r ? `${m}:${String(r).padStart(2, '0')}` : plural(m, 'minute');
};
const QUARTER = ['', 'first quarter', 'second quarter', 'third quarter', 'fourth quarter', 'overtime'];
// How the weather plays, in words a crew would use (never the game's numbers).
const WEATHER_TALK = {
  rain: ['The rain is coming down, and ball security is going to be a story today.', 'Wet ball, slick turf. You have to hold onto it with two hands in this.'],
  sun: ['That sun is brutal today. Tracking the deep ball into it is not easy.', 'Hot one out there. Watch the receivers fighting the glare on the deep ball.'],
  sand: ['This sandstorm is a factor. It wears everybody down, and the bigger bodies love it.', 'Tough conditions with the sand blowing. Conditioning matters in a game like this.'],
  hail: ['Hail coming down, and you can see the players slowing late in the down.', 'Brutal conditions. Everybody out there is going to feel this one tomorrow.'],
};

// ---------- the open ----------
export function openLines(B, g) {
  const v = venueOf(g);
  const [H, A] = g.teams;
  const when = v.time === 'night' || v.time === 'dusk' ? 'Good evening' : 'Good afternoon';
  const wx = v.roof && g.weather === 'clear' ? 'indoors today' : g.weather === 'clear' ? 'and it is a beautiful day for football' : 'and the weather is going to be part of this one';
  const out = [pbp(pick(B, 'open', [
    `${when} everybody, and welcome to ${v.name}. I'm ${CREW.pbp.name}, alongside ${CREW.color.name}, ${wx}. The ${A.name} visit the ${H.name}.`,
    `${when} and welcome to ${TIMES[v.time] === 'Prime time' ? 'prime time ' : ''}football from ${v.name}. ${CREW.pbp.name} here with ${CREW.color.name}. It's the ${A.name} and the ${H.name}.`,
  ]), 1, 1)];
  const key = keyMatchup(g);
  const star = playerToWatch(g, 0);
  out.push(color(key ? pick(B, 'openkey', [
    `Thanks, Mack. The matchup I'm watching: ${key}.`,
    `Mack, this one could come down to ${key}.`,
  ]) : star ? `Thanks, Mack. Keep an eye on ${star.name} for the ${H.name}. Everything they do runs through him.` : '', 1));
  if (g.playoff) out.push(pbp('And remember, this is the playoffs. Lose, and your season is over.', 1));
  return finish(B, g, out);
}
// The biggest type edge on the field, said like a football matchup.
function keyMatchup(g) {
  let best = null;
  for (const [o, d] of [[0, 1], [1, 0]]) {
    const O = g.teams[o].lineup, D = g.teams[d].lineup;
    for (const [os, ds, what] of [['WR1', 'CB1', 'out wide'], ['WR2', 'CB2', 'on the outside'], ['RB', 'MLB', 'between the tackles'], ['TE', 'SS', 'over the middle'], ['LT', 'DE', 'in the trenches'], ['RT', 'LE', 'in the trenches']]) {
      const a = O[os], b = D[ds];
      if (a == null || b == null) continue;
      const m = bestMatchup(PLAYERS[a], PLAYERS[b]);
      if (m.mult > 1 && (!best || m.mult > best.m)) best = { m: m.mult, a, b, what };
    }
  }
  if (!best) return '';
  return `${nm(best.a)} against ${nm(best.b)} ${best.what}. That's a type mismatch, and you'd better believe they'll go after it`;
}

// ---------- before the snap ----------
// Mack sets the scene (not on every routine snap); now and then Dee adds what to watch.
export function presnapLines(B, g, lp) {
  if (!g || !lp || g.final) return [];
  return finish(B, g, presnapRaw(B, g, lp));
}
function presnapRaw(B, g, lp) {
  B.play = { lp, said: new Set(), calls: 0, marks: new Set(), deep: false };
  const o = lp.o, T = g.teams[o];
  const out = [];
  const lead = g.score[o] - g.score[1 - o];
  const late = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 120;
  const kick = nm(lp.kicker?.id);
  if (lp.kick?.ko) {
    out.push(pbp(lp.play?.onside ? pick(B, 'onside', [`Everybody bunched up on one side. The ${T.name} are going to try the onside kick.`, 'Hands team is on the field. Here comes the onside try.']) : pick(B, 'ko', [
      `${kick} will kick it off for the ${T.name}.`,
      `The ${T.name} kick it off, ${kick} with the boot.`,
      `${kick} sets the ball on the tee.`,
    ]), 1));
    return out;
  }
  if (lp.kick) {
    if (lp.kind === 'punt') out.push(pbp(pick(B, 'punt', [
      `Fourth down, and the punt team comes on. ${kick} is back to kick.`,
      `They'll punt it away. ${kick} deep for the ${T.name}.`,
      `Fourth down, ${kick} back to punt from ${hereLine(g)}.`,
    ]), 1));
    else if (lp.kind === 'xp') out.push(pbp(pick(B, 'xp', [`${kick} on for the extra point.`, `Here's the point after, ${kick} to kick.`]), 1));
    else {
      const dist = fgDistance(g);
      out.push(pbp(pick(B, 'fg', [`${kick} on for a ${dist}-yard try.`, `Field goal unit is out. ${kick}, from ${dist} yards.`, `${kick} will try it from ${dist}.`]), 1));
      if (late && lead <= 0 && lead >= -3) out.push(color(lead === 0 ? 'This is for the lead, Mack. Big kick.' : 'This one ties it. No pressure at all.', 1, 1));
      else if (dist >= 50) out.push(color(dist >= 55 ? "That's at the edge of his range. He needs to hit it clean." : "Long way. He'll need all of it.", 0));
    }
    return out;
  }
  if (g.phase === 'pat') {
    out.push(pbp(pick(B, 'two', ['They are going for two!', `The ${T.name} are going to go for two here.`]), 1, 1));
    return out;
  }
  const goal = g.spot + g.toGo >= 100;
  const dd = `${ORD[g.down]} and ${goal ? 'goal' : g.toGo === 1 ? 'one' : say(g.toGo)}`;
  const where = ballOn(g, o);
  const qb = known(T.lineup.QB) ? nm(T.lineup.QB) : 'the quarterback';
  const big = g.down >= 3 || late || g.spot >= 80;
  // A routine first or second down gets the down and distance only about half the time.
  if (big || rnd(B) < 0.5) {
    let head = '';
    if (late && g.quarter >= 4 && lead < 0) head = pick(B, 'latepre', [`${clockWords(g.clock)} to go, and the ${T.name} need ${lead >= -3 ? 'a field goal' : lead >= -8 ? 'a touchdown' : 'a miracle'}.`, `Under two minutes, the ${T.name} down ${-lead}.`]);
    else if (late && g.quarter === 2) head = pick(B, 'halfpre', [`${clockWords(g.clock)} left in the half.`, 'Inside two minutes before halftime.']);
    const tail = goal ? '' : g.down >= 3 && g.toGo <= 1 ? pick(B, 'needs', ['They need a yard.', 'Just a yard to go.', 'Short yardage.'])
      : g.down >= 3 && g.toGo >= 8 ? pick(B, 'needl', ['Long way to go.', 'An obvious passing down.']) : '';
    out.push(pbp([head, pick(B, 'dd', [
      `${dd} ${where}.`,
      `${dd} for the ${T.name} ${where}.`,
      `${T.name} ball, ${dd.toLowerCase()} ${where}.`,
      `${dd}. ${qb} brings them to the line.`,
      g.down === 1 && !goal ? `${qb} and the ${T.name} offense, first and ten ${where}.` : '',
      goal ? `${dd} from the ${yardWord(100 - g.spot)}.` : '',
    ]), tail].filter(Boolean).join(' '), 1));
  }
  // The analyst: only on the big downs, now and then, and not right after he spoke.
  if (big && B.plays - B.colorAt >= 2 && rnd(B) < 0.5) {
    const c = presnapColor(B, g, lp, { lead, late, goal });
    if (c) { out.push(color(c, 1)); B.colorAt = B.plays; }
  }
  return out;
}
function presnapColor(B, g, lp, { lead, late, goal }) {
  const o = lp.o, T = g.teams[o], D = g.teams[lp.d];
  const opts = [];
  if (g.down === 4) opts.push(lead < 0 ? 'They have to go for it here. The whole game might ride on this snap.' : 'They are going for it on fourth down. Gutsy call.');
  if (g.down === 3) {
    const [made, tries] = T.team?.third ?? [0, 0];
    if (tries >= 3 && made <= tries) opts.push(made / tries >= 0.5 ? `They have been good on third down today, ${made} of ${tries}.` : `Third down has been a problem for them. Just ${made} of ${tries}.`);
    if (g.toGo >= 8) opts.push(`Third and long. The ${D.name} can pin their ears back and get after the quarterback.`, 'Watch for a disguised blitz here. Show one look, play another.');
    else if (g.toGo <= 2) opts.push('Short yardage. Whoever wins up front wins this down.', 'Everybody in the building knows they need a push up front.');
    else opts.push("Third and manageable. They've got the whole playbook available here.");
  }
  if (goal && g.spot >= 95) opts.push('Goal line. No room to throw it down here, it comes down to the big guys up front.');
  else if (g.spot >= 80) opts.push('Red zone. The field shrinks, and those throwing windows get tight.', "You've got to come away with seven down here. Three is a win for the defense.");
  if (late) opts.push(lead < 0 ? 'Clock management matters now. Get out of bounds, use your timeouts wisely.' : 'Keep the ball in bounds, keep the clock running. That is the job now.');
  if (B.streak.n >= 3 && B.streak.ti != null) opts.push(B.streak.kind === 'stop' ? `The ${g.teams[B.streak.ti].name} defense has been all over it. ${say(B.streak.n)} straight stops.` : `The ${g.teams[B.streak.ti].name} have all the momentum right now.`);
  const tw = playerToWatch(g, o);
  const s = tw ? T.stats?.[tw.id] : null;
  if (s && (s.ry + s.rcy >= 60 || s.py >= 150)) opts.push(s.py >= 150 ? `${tw.name} is dealing today, ${s.py} yards through the air.` : `${tw.name} has been the story, ${s.ry + s.rcy} yards from scrimmage.`);
  return opts.length ? pick(B, 'precolor', opts) : '';
}

// ---------- during the play ----------
// One live event: Mack's call for it, or nothing. The big moments always get a call; the routine
// ones (a short throw, a plain handoff) only sometimes, and the play gets a few calls at most:
// the speech queue drops a call the play has already run past, and a crew that says everything
// talks over itself.
export function liveLine(B, lp, e) {
  const P = B.play?.lp === lp ? B.play : (B.play = { lp, said: new Set(), calls: 0, marks: new Set(), deep: false });
  const ln = liveRaw(B, P, lp, e);
  if (!ln) return null;
  if (ln.pri < 3 && P.calls >= 3) return null;
  P.calls++;
  return finish(B, lp.g, [ln])[0] ?? null;
}
function liveRaw(B, P, lp, e) {
  const who = e.who, other = e.other;
  const n = who ? nm(who.id) : '', m = other ? nm(other.id) : '';
  const once = (k) => { if (P.said.has(k)) return false; P.said.add(k); return true; };
  const some = (p) => rnd(B) < p;
  switch (e.kind) {
    case 'handoff': {
      if (!once('handoff')) return null;
      const dir = lp.play?.dir;
      const call = {
        counter: [`Counter, ${n} cuts back against the grain.`, `Misdirection, and ${n} has it going the other way.`],
        toss: [`Toss to ${n}, racing for the corner.`, `Pitch to ${n}, he wants the edge.`],
        sweep: [`Sweep, ${n} with linemen pulling in front.`],
        draw: [`Draw play! ${n} on the delayed handoff.`, `Shows pass, and it's a draw to ${n}.`],
        read: [`Zone read, he gives it to ${n}.`],
        outside: [`${n} stretching it toward the sideline.`],
        power: [`${n} off tackle behind the pulling guard.`],
      }[dir];
      // A plain inside run is only called now and then.
      if (!call && !some(0.3)) return null;
      return pbp(pick(B, `handoff-${dir ?? 'run'}`, call ?? [`Handoff, ${n}.`, `${n} up the middle.`, `Give to ${n}.`]), 2);
    }
    case 'keep': return once('keep') ? pbp(pick(B, 'keep', [`He pulls it! ${n} keeps!`, `Fakes the give, and ${n} keeps it himself!`]), 2, 1) : null;
    case 'scramble': return once('scramble') ? pbp(pick(B, 'scramble', [
      `Pocket breaks down, and ${n} takes off!`,
      `${n} steps up and runs!`,
      'Nobody open, so he tucks it and goes!',
    ]), 2, 1) : null;
    case 'throw': {
      if (!once('throw')) return null;
      if (!other) return pbp(pick(B, 'away', ['Nothing there, and he throws it away.', 'He gets rid of it out of bounds.']), 2);
      const air = (other.x ?? 0) - (who?.x ?? 0);
      P.deep = air >= 18;
      const c = lp.offCall;
      if (P.deep) return pbp(pick(B, 'deep', [
        `Here's the shot downfield, for ${m}!`,
        `${n} lets it fly, ${m} is going deep!`,
        c === 'pa_deep' ? `Play-action, he sets, and fires deep for ${m}!` : `${n} airs it out for ${m}!`,
        `Deep ball, ${m} has a step!`,
      ]), 2, 1);
      if (/screen|bubble/.test(c ?? '')) return some(0.6) ? pbp(pick(B, 'screen', [`Screen pass to ${m}, and he's got blockers.`, `They set up the screen for ${m}.`]), 2) : null;
      if (c === 'pa_boot') return some(0.6) ? pbp(pick(B, 'boot', [`Bootleg, ${n} rolls out, throws for ${m}.`, `Play-action, he's on the move, looking for ${m}.`]), 2) : null;
      if (lp.pressure && some(0.6)) return pbp(pick(B, 'heat', [`Under pressure, he gets it off to ${m}.`, `Throws with a man in his face, for ${m}.`]), 2);
      // A routine short throw: let the wrap tell it, most of the time.
      if (!some(0.25)) return null;
      return pbp(pick(B, `throw-${c}`, [
        c === 'slant' ? `Quick slant for ${m}.` : c === 'out' ? `Quick out to ${m}.` : c === 'te_seam' ? `Up the seam for ${m}.` : c === 'mesh' ? `${m} on the crosser.` : `${n} throws for ${m}.`,
        `Looking for ${m}.`,
        air < 6 ? `Checks it down to ${m}.` : `${n} fires for ${m}.`,
      ]), 2);
    }
    case 'catch': {
      if (lp.kick) return once('kcatch') ? pbp(pick(B, 'kcatch', [`${n} fields it and brings it out.`, `${n} takes it, here comes the return.`, `${n} gathers it in and goes.`]), 2, 1) : null;
      if (!once('catch')) return null;
      if (P.deep) return pbp(pick(B, 'deepcatch', [`Caught! ${n} hauls it in at ${fieldAt(lp, who?.x)}!`, `What a grab by ${n}!`, `${n} goes up and gets it!`, `He's got it! ${n} over the top!`]), 3, 2);
      if (lp.play?.sideline && Math.abs(who?.y ?? 0) > 20 && some(0.5)) return pbp(pick(B, 'scatch', [`${n} gets a foot down on the sideline.`, "Toe tap, and he's got it."]), 2);
      return null;
    }
    case 'int': return once('int') ? pbp(pick(B, 'int', [
      `Intercepted! ${n} jumps the route!`,
      `Picked off! ${n} undercuts it!`,
      `Intercepted, ${n}! The quarterback never saw him!`,
      `Picked off by ${n}!`,
    ]), 3, 2) : null;
    case 'incomplete': {
      if (!once('inc')) return null;
      const t = e.text || '';
      if (/dropped/i.test(t)) return pbp(pick(B, 'drop', ['Dropped!', `Right through the hands of ${n}.`, "He can't hang on!", 'Dropped! Hit him right in the hands.', `${n} lets it get away.`, 'Should have had it. Dropped.', 'On the hands, and off.']), 2, 1);
      if (/broken up|knock/i.test(t) && other) return pbp(pick(B, 'pbu', [`Broken up by ${m}!`, `${m} gets a hand in there!`, `Knocked away by ${m}.`]), 2, 1);
      return pbp(pick(B, 'inc', ['Incomplete.', 'Falls incomplete.', 'Off target, incomplete.', 'Overthrown.', 'Thrown behind him, incomplete.', 'Nobody there.']), 2);
    }
    case 'deflect': return once('deflect') ? pbp(pick(B, 'tip', ['Tipped at the line!', 'Batted down!', 'Got a finger on it!']), 2, 1) : null;
    case 'broken': {
      if (!once('broken')) return null;
      const how = /trucks|runs over/.test(e.text) ? 'truck' : /spins/.test(e.text) ? 'spin' : /jukes/.test(e.text) ? 'juke' : 'shake';
      return pbp(pick(B, `brk-${how}`, {
        truck: [`${n} runs right over him!`, `Oh, ${n} just trucked him!`, `${n} lowers the shoulder and runs through him!`],
        spin: ['Spin move, and he gets away!', `${n} spins out of the tackle!`],
        juke: [`${n} makes him miss!`, `Oh, what a cut by ${n}!`, `${m} grabs nothing but air!`],
        shake: [`${n} breaks a tackle!`, 'He shakes off the tackler!', `${n} slips out of it!`, `${n} stays on his feet!`, 'Broken tackle!', `${n} bounces off the hit!`],
      }[how]), 2, 1);
    }
    case 'ghost': return once('ghost') ? pbp(pick(B, 'ghost', [`${n} goes right through him! You can't tackle a ghost!`, `${n} phases right through the tackle!`]), 2, 2) : null;
    case 'slip': return once('slip') && some(0.5) ? pbp(pick(B, 'slip', [`${n} loses his footing!`, `${n} slips!`]), 2) : null;
    case 'bighit': return once('bighit') && some(0.6) ? pbp(pick(B, 'bighit', ['Boom! What a shot!', `What a hit by ${n}!`, `${n} delivers the blow!`, `Oh, ${n} unloads on him!`]), 2, 2) : null;
    case 'sack': return once('sack') ? pbp(pick(B, 'sack', [
      `${n} gets home! Sacked!`,
      `Down goes the quarterback! ${n} with the sack!`,
      `Pressure, and he's sacked! ${n} got him!`,
      `${n} off the edge, and that's a sack!`,
    ]), 3, 2) : null;
    case 'flag': return once('flag') ? pbp(pick(B, 'flag', ['Flag on the play.', "There's a flag down.", 'Yellow flag is out.']), 2, 1) : null;
    case 'power':
      if (!who?.power || !once(`pw:${who.id}`)) return null;
      return pbp(pick(B, 'power', [`${who.power.name}! ${n}!`, `There's ${who.power.name} from ${n}!`]), 3, 2);
    case 'kickoff': return once('kickoff') ? pbp(pick(B, 'kickoff', ['And the kick is away.', `${n} puts his foot into it, and the kick is away.`, 'Here is the kickoff.', `${n} approaches, and we are underway.`, 'Off the tee, end over end.', `${n} gets into it.`]), 2, 1) : null;
    case 'punt': return once('puntk') ? pbp(pick(B, 'puntk', ['Snap is back, and the punt is away.', `${n} gets it off. High and deep.`, 'Protection holds, the punt is away.']), 2, 1) : null;
    case 'fgkick': return once('fgk') ? pbp(pick(B, 'fgk', ['The snap, the hold, the kick is up...', 'Snap is good, hold is down, here is the kick...', 'The kick is on the way...', 'Here it is...', 'The kick...', 'Down, and kicked...']), 2, 1) : null;
    case 'fg_good': return once('fgres') ? pbp(pick(B, 'fggood', ["It's good!", 'Right down the middle. It is good!', "Split the uprights. It's good!", 'And that is good.', "Plenty of leg. It's good!", 'Through.']), 3, 2) : null;
    case 'fg_miss': return once('fgres') ? pbp(pick(B, 'fgmiss', ["Wide right! It's no good!", "Wide left! It's no good!", 'Off the upright, and no good!', 'Short, and no good!']), 3, 2) : null;
    case 'block': return once('block') ? pbp(pick(B, 'block', ['Blocked! It is blocked!', `${n} gets a hand on it! Blocked!`]), 3, 2) : null;
    case 'fair': return once('fair') ? pbp(`Fair catch, ${n}.`, 2) : null;
    case 'downed': return once('downed') ? pbp('Downed by the coverage team.', 2) : null;
    case 'fake': return once('fake') ? pbp(pick(B, 'fake', ["It's a fake!", 'Fake! They are running a fake!']), 3, 2) : null;
    case 'recover': return once('recover') ? pbp(pick(B, 'recover', [`${n} recovers!`, `${n} falls on it!`]), 3, 2) : null;
    default: return null;
  }
}

// While a kickoff or a punt hangs, one call of where it is coming down.
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
  if (abs >= 100) return pbp(pick(B, 'kspot', ['High and deep, into the end zone.', 'That one is headed for the end zone.']), 2, 1);
  const their = Math.max(1, Math.min(50, Math.round(100 - abs)));
  return pbp(their >= 45 ? 'Short kick, near midfield.' : pick(B, 'kspot2', [`Coming down around the ${yardWord(their)}.`, `High kick, down to the ${yardWord(their)}.`]), 2, 1);
}

// The run in the open field, called off the carrier's progress each frame: once when he breaks
// into the clear, once more as he closes on the goal line.
export function progressLine(B, lp) {
  const spot = kickSpotLine(B, lp);
  if (spot) return finish(B, lp.g, [spot])[0] ?? null;
  const P = B.play;
  if (!P || P.lp !== lp || lp.phase !== 'live') return null;
  const c = lp.ball?.holder;
  if (!c || lp.ball.state !== 'held') return null;
  const up = c.side === 'off';
  const gained = up ? c.x : -c.x;
  const toGo = up ? lp.goalX - c.x : c.x - lp.ownGoalX;
  const chasers = lp.players.filter((q) => q.side !== c.side && (up ? q.x > c.x - 1 : q.x < c.x + 1) && Math.hypot(q.x - c.x, q.y - c.y) < 6).length;
  const n = nm(c.id);
  const mark = (k) => { if (P.marks.has(k)) return false; P.marks.add(k); return true; };
  let ln = null;
  // A quarterback run has no handoff to call: say it as he takes off.
  const dir = lp.play?.dir;
  if (c === lp.off?.QB && lp.kind === 'run' && ['sneak', 'qbdraw', 'qbpower'].includes(dir) && lp.t > (dir === 'qbdraw' ? 0.9 : 0.25) && mark('qbrun')) {
    ln = pbp(pick(B, `qbrun-${dir}`, {
      sneak: ['Quarterback sneak.', `${n} on the sneak.`],
      qbdraw: [`Quarterback draw! ${n} takes off up the middle.`, `He drops back, and ${n} takes off!`],
      qbpower: [`${n} keeps it, guard leading the way.`],
    }[dir]), 2, dir === 'qbdraw' ? 1 : 0);
  } else if (gained >= 12 && chasers === 0 && toGo > 25 && mark('open')) {
    ln = pbp(pick(B, 'open', [`${n} breaks into the clear!`, `He's got daylight! ${n} is loose!`, `Nothing but green grass in front of ${n}!`, `${n} turns the corner, and he's got room!`]), 2, 2);
  } else if (gained >= 15 && toGo <= 20 && toGo > 8 && P.marks.has('open') && mark('close')) {
    ln = pbp(chasers === 0 ? pick(B, 'allway', ['He could go all the way!', 'Nobody is going to catch him!', `${n} is gone!`]) : pick(B, 'close', ['Inside the twenty, still going!', `${n}, down to the ${yardWord(Math.round(toGo))}!`]), 2, 2);
  }
  return ln ? finish(B, lp.g, [ln])[0] ?? null : null;
}
// How tense the stadium should sound right now (0 calm .. 1 everyone on their feet).
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
// The play went into the game as `e` (its log entry); `before` is the game at the snap; `lp` the
// live play (null for a play resolved without the field). Mack wraps it in a line unless the live
// calls said it all, and Dee speaks up when there is something worth saying.
export function afterLines(B, g, e, before = null, lp = null) {
  const lines = afterRaw(B, g, e, before, lp);
  B.plays++;
  // Dee once after the play at most.
  let seen = false;
  const kept = lines.filter((l) => { if (!l || l.who !== 'color') return true; if (seen) return false; seen = true; B.colorAt = B.plays; return true; });
  return finish(B, g, kept);
}
function afterRaw(B, g, e, before, lp) {
  if (!e) return [];
  const out = [];
  const P = B.play?.lp === lp && lp ? B.play : null;
  const said = P?.said ?? new Set();
  B.play = null;
  const o = e.team ?? before?.poss ?? g.poss;
  const D = g.teams[1 - o];
  const yd = e.yards ?? 0;
  const scoredBy = before ? [0, 1].find((i) => g.score[i] - before.score[i] >= 6) : null;
  const td = e.highlight === 'td' || (e.kind === 'score' && /TOUCHDOWN/.test(e.text ?? '')) || (scoredBy != null && !e.conversion);
  const c = e.carrier;
  const changed = before && g.poss !== before.poss && !g.final;
  // Dee speaks after a routine play only every few plays.
  const colorOk = B.plays - B.colorAt >= 3;
  if (e.kind === 'quarter') return quarterLines(B, g, e);
  if (e.kind === 'timeout') return [pbp(pick(B, 'to', [`Timeout, ${(e.text ?? '').match(/^(.+?) (call|use|take)/)?.[1] ?? 'on the field'}.`, 'And they will take a timeout.']), 1)];
  if (e.kind === 'info') return e.head && /two-minute/i.test(e.head) ? [pbp(`That's the two-minute warning. ${scoreLine(g)}.`, 1), color("Here's where games are won, Mack.", 1)] : [];
  if (e.kind === 'sub') return [];
  // Penalties: the referee's call, in his words.
  if (e.kind === 'penalty' || e.highlight === 'flag') {
    const txt = (e.text ?? '').replace(/\s+/g, ' ').trim();
    out.push(pbp(txt || 'There is a flag on the play.', 1));
    if (colorOk && rnd(B) < 0.5) out.push(color(pick(B, 'flagc', ["You can't do that. That's a drive killer.", 'Mental mistake, and it costs them.', 'Discipline, Mack. That one hurts.']), 0));
    return out;
  }
  if (e.conversion) {
    const good = g.score[o] > (before?.score?.[o] ?? g.score[o]) || /good|GOOD/.test(e.text ?? '');
    if (/two|2-point|conversion/i.test(e.head ?? '') && !/Extra point/i.test(e.head ?? '')) out.push(pbp(good ? pick(B, '2good', ['They get it! The two-point try is good!', 'In for two!']) : pick(B, '2no', ['They come up short on the try.', 'Stopped. No good on the two-point try.']), 2, good ? 2 : 1));
    else if (!said.has('fgres')) out.push(pbp(good ? pick(B, 'xpgood', ['The extra point is good.', 'And the kick is good.']) : 'The extra point is no good!', 1, good ? 0 : 1));
    out.push(pbp(`${scoreLine(g)}.`, 1));
    return out;
  }
  const kind = OFF_PLAYS[e.off]?.kind;
  if (e.kind === 'kick' || /Kickoff/i.test(e.head ?? '')) {
    if (/Touchback/i.test(e.text ?? '')) out.push(pbp(pick(B, 'tb', ['Touchback.', "That'll be a touchback.", 'Into the end zone, and it will be a touchback.']), 1));
    else if (/onside/i.test(e.text ?? '')) out.push(pbp(e.text, 2, 1));
    else if (lp && e.text) out.push(pbp(`${e.text.replace(/\.$/, '')}.`, 1));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy ?? 1 - o, 'return'));
    return out;
  }
  if ((kind === 'punt' && !OFF_PLAYS[e.off]?.fake) || e.kind === 'punt') {
    out.push(pbp(e.text ? e.text.replace(/\s+/g, ' ') : 'The punt.', 1));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy ?? 1 - o, 'return'));
    return out;
  }
  if (e.kind === 'score' && e.highlight === 'fg') {
    if (!said.has('fgres')) out.push(pbp(pick(B, 'fgg', ['The field goal is good.', "And it's good."]), 1, 1));
    out.push(pbp(`${scoreLine(g)}.`, 1));
    const late = g.quarter >= 4 && g.clock <= 300 && Math.abs(g.score[0] - g.score[1]) <= 3;
    if (late || colorOk) out.push(color(late ? 'Points on the board, and this one is going down to the wire.' : pick(B, 'fgc', ['The drive stalled, but you take the points.', 'You want seven there, but you take three.']), 0));
    return out;
  }
  if (e.kind === 'fg' || (kind === 'fg' && !OFF_PLAYS[e.off]?.fake && !e.highlight)) {
    if (!said.has('fgres')) out.push(pbp('The kick is no good.', 1, 1));
    out.push(color(pick(B, 'fgm', ['Points left on the field, Mack.', 'That one is going to sting.']), 0));
    return out;
  }
  if (/safety/i.test(e.text ?? '') && e.kind === 'score') {
    out.push(pbp(`Safety! Two points for the ${D.name}!`, 3, 2));
    out.push(pbp(`${scoreLine(g)}.`, 1));
    return out;
  }
  // Takeaways.
  if (e.turnover === 'fumble' || (/FUMBLE!/.test(e.text ?? '') && changed)) {
    out.push(pbp(pick(B, 'fum', [`The ball is out! Fumble! The ${D.name} recover!`, `Fumble! And the ${D.name} come up with it!`]), 3, 2));
    out.push(color(pick(B, 'fumc', [`${known(c) ? nm(c) : 'He'} has to protect the football there. Two hands in traffic.`, 'Huge turnover. That changes everything.']), 1, 1));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy, 'defense'));
    streak(B, 1 - o, 'stop');
    return out;
  }
  if (e.turnover === 'int' || (e.kind === 'turnover' && /INTERCEPT/i.test(e.text ?? ''))) {
    const by = e.returner ?? c;
    if (!said.has('int')) out.push(pbp(`Intercepted by ${nm(by)}!`, 3, 2));
    if (td) out.push(...scoreCall(B, g, e, before, scoredBy, 'pick'));
    else out.push(color(pick(B, 'intc', [`${nm(by)} read that all the way. The quarterback never saw him.`, "Bad decision. You can't throw that ball into coverage.", `What a play by ${nm(by)}. That's a game changer.`]), 1, 1));
    streak(B, 1 - o, 'stop');
    return out;
  }
  if (td) {
    out.push(...scoreCall(B, g, e, before, scoredBy ?? o, kind === 'pass' ? 'pass' : 'run'));
    streak(B, scoredBy ?? o, 'score');
    return out;
  }
  if ((changed && ['run', 'pass', 'sack', 'play', 'turnover'].includes(e.kind)) || /Turnover on downs/i.test(e.text ?? '')) {
    out.push(pbp(pick(B, 'tod', ['They come up short! Turnover on downs!', `Stopped! The ${D.name} take over on downs.`]), 3, 2));
    out.push(color(pick(B, 'todc', ['Huge stand by that defense.', 'You roll the dice, you live with it.']), 1, 1));
    streak(B, 1 - o, 'stop');
    return out;
  }
  if (e.kind === 'sack' || e.highlight === 'sack') {
    if (!said.has('sack')) out.push(pbp(`${(e.text ?? 'Sacked').split('.')[0]}.`, 2, 1));
    if (colorOk || rnd(B) < 0.4) out.push(color(pick(B, 'sackc', [
      'The pocket collapsed. He had nowhere to go.',
      'Great push up front. That is a drive killer.',
      'He held onto it too long. Everybody was covered, and the rush got there.',
      "Now they're behind the chains.",
    ]), 1));
    streak(B, 1 - o, 'stop');
    return out;
  }
  // Runs, catches and incompletions: one line that says it all.
  const first = before && !changed && g.down === 1 && before.down >= 1 && yd > 0 && g.poss === before.poss;
  const inc = lp?.end?.how === 'incomplete' || (kind === 'pass' && yd === 0 && /incomplete|broken up|dropped|thrown away|throws it away|overthrown|off the hands/i.test(e.text ?? ''));
  if (inc) {
    if (!said.has('inc')) out.push(pbp(pick(B, 'incw', ['Incomplete.', 'The pass falls incomplete.']), 1));
    if (before?.down === 3 && colorOk) out.push(color(pick(B, 'inc3', ['That will bring up fourth down.', 'They have a decision to make on fourth down.']), 0));
    streak(B, 1 - o, 'stop');
  } else if (c != null) {
    const fgoal = first && g.spot + g.toGo >= 100;
    out.push(pbp(wrapLine(B, g, e, lp, yd, first ? (fgoal ? 'goal' : 'first') : ''), 1, yd >= 20 ? 1 : 0));
    if (yd <= 0) streak(B, 1 - o, 'stop'); else if (first) streak(B, o, 'go');
  }
  // Dee: why it happened, on the big plays always, otherwise every few plays.
  const bigPlay = yd >= 20 || (e.powers ?? []).some((p) => p.on) || (before?.down >= 3 && (first || yd <= 0));
  if (bigPlay || (colorOk && rnd(B) < 0.6)) {
    const why = whyLine(B, g, e, before, lp, { yd, first, inc });
    if (why) out.push(color(why, bigPlay ? 1 : 0, (e.powers ?? []).some((p) => p.on) ? 1 : 0));
  }
  return out;
}
// The whistle on a run or a catch, with the first down folded in: "Gengar picks up nine, and
// that's a first down."
function wrapLine(B, g, e, lp, yd, first) {
  const c = e.carrier, n = nm(c);
  const how = lp?.end?.how;
  const tk = lp?.end?.tackler ? nm(lp.end.tackler.id) : (e.text ?? '').match(/Tackled by ([^.]+)\./)?.[1];
  const spot = hereLine(g);
  const caught = OFF_PLAYS[e.off]?.kind === 'pass';
  let w;
  if (how === 'out') w = pick(B, 'oob', [`${n} steps out of bounds at ${spot}`, `${n} gets out of bounds${yd > 0 ? ` after a gain of ${say(yd)}` : ''}`]);
  else if (how === 'slide') w = pick(B, 'slide', [`He slides down at ${spot}`, `${n} gets down at ${spot}, smart football`]);
  else if (yd < 0) w = pick(B, 'loss', [`${tk ? `${tk} drops him` : 'Dropped'} for a loss of ${say(-yd)}`, `Stuffed in the backfield, a loss of ${say(-yd)}`, `${tk ? `${tk} blows it up` : 'Blown up'} in the backfield`]);
  else if (yd === 0) w = pick(B, 'nogain', [`${tk ? `${tk} plugs the hole` : 'Stopped at the line'}, no gain`, 'Nothing doing, no gain on the play', `${n} goes nowhere`]);
  else if (yd >= 20) w = pick(B, 'bigwrap', [`${n} for ${yd} yards${tk ? ` before ${tk} finally drags him down` : ''}`, `A big gain of ${yd} on the play`, `${yd} yards on the play, and he's brought down at ${spot}`]);
  else if (caught) w = pick(B, 'cgain', [`${n} makes the catch for ${say(yd)}`, `Complete to ${n}, a gain of ${say(yd)}`, `${n} hauls it in, ${say(yd)} yards`, `Caught by ${n} at ${spot}`, `${n} with the grab, down at ${spot}`]);
  else if (yd <= 3) w = pick(B, 'short', [`${n} grinds out ${say(yd)}`, `${n} for a short gain`, `${n} falls forward for ${say(yd)}`, `${n} pushes ahead for ${say(yd)}`]);
  else w = pick(B, 'gain', [`${n} picks up ${say(yd)}`, `${n} for ${say(yd)}, brought down at ${spot}`, `Nice run by ${n}, ${say(yd)} yards`, tk ? `${n} gets ${say(yd)} before ${tk} brings him down` : `${n} gets ${say(yd)} on the carry`]);
  if (first === 'goal') return `${w}, and that sets up first and goal.`;
  if (first) return `${w}${pick(B, 'first', [", and that's a first down.", ', enough for the first down.', '. That will move the chains.', ', and he gets past the sticks.', '. First down.'])}`;
  return `${w}.`;
}
function scoreCall(B, g, e, before, ti, how) {
  ti = ti ?? e.team ?? g.poss;
  const T = g.teams[ti];
  const c = e.returner ?? e.scorer ?? e.carrier;
  const yd = e.yards ?? 0;
  const out = [];
  const cry = how === 'pick' ? 'Pick six!' : how === 'return' ? 'He took it to the house!' : 'Touchdown!';
  const scorer = known(c) ? nm(c) : `the ${T.name}`;
  const from = yd === 1 ? ' from a yard out' : yd > 1 ? ` from ${yd} yards out` : '';
  out.push(pbp(pick(B, `td-${how}`, [
    how === 'pass' || how === 'run' ? `${cry} ${scorer}${from}!` : `${cry} ${scorer}!`,
    `He's in! ${cry} ${scorer}!`,
    `${scorer} into the end zone! ${cry}`,
    how === 'run' ? `${scorer} punches it in! ${cry}` : how === 'pass' ? `Caught in the end zone! ${cry} ${scorer}!` : `Nobody is catching him! ${cry}`,
  ]).replace('Touchdown! ', 'Touchdown, '), 3, 2));
  const lead = g.score[ti] - g.score[1 - ti];
  const late = g.quarter >= 4 && g.clock <= 300;
  const d = g.drives[g.drives.length - 1];
  const opts = [];
  if (late && lead > 0 && lead <= 8) opts.push(`The ${T.name} take the lead late! What a moment in this building.`);
  if (d && d.team === ti && d.plays >= 8) opts.push(`A ${d.plays}-play drive, and they finish it off. That's how you grind one out.`);
  if (d && d.team === ti && d.plays <= 2 && how !== 'pick') opts.push('That was quick. They did not waste any time.');
  if (yd >= 40) opts.push(`${scorer} made that look easy. ${yd} yards.`);
  if (how === 'pass' && known(e.qb)) opts.push(`${nm(e.qb)} put that ball right on the money.`, 'What a throw. That ball was placed where only his guy could get it.');
  if (how === 'run') opts.push('Great push up front on that one. The line just moved the pile.');
  if (how === 'pick') opts.push('You cannot make that throw. It goes the other way for six.');
  if (lead === 0) opts.push(`And we are all square at ${g.score[0]}.`);
  opts.push(`${scoreLine(g)}.`);
  out.push(color(pick(B, 'tdc', opts), 1, 1));
  return out;
}
function whyLine(B, g, e, before, lp, { yd, first, inc }) {
  const opts = [];
  const pw = (e.powers ?? []).find((p) => p.on);
  if (pw) return `${nm(pw.id)} is in the zone now. ${POWER_OF[pw.id]?.name ?? 'His power'} is switched on, and he is a different player.`;
  const off = (e.powers ?? []).find((p) => !p.on);
  if (off) return `And that knocks ${nm(off.id)} out of the zone.`;
  const sch = schemeLine(B, g, e, lp, { yd, inc });
  if (sch) opts.push(sch);
  const T = g.teams[e.team ?? g.poss];
  const s = known(e.carrier) ? T?.stats?.[e.carrier] : null;
  if (s && yd > 0) {
    for (const [have, what] of [[s.ry, 'rushing'], [s.rcy, 'receiving']]) if (have >= 100 && have - yd < 100) opts.push(`That puts ${nm(e.carrier)} over a hundred ${what} yards on the day.`);
  }
  if (before?.down === 3 && first && rnd(B) < 0.6) opts.push(pick(B, 'conv3', ['Huge conversion on third down.', 'Big third-down conversion. That keeps the drive alive.', 'Clutch. They needed that one.', 'Moving the chains on third down, that is how you keep a defense on the field.', "That's a money down, and they came through.", 'The drive stays alive.']));
  if (before?.down === 3 && yd <= 0 && !first && rnd(B) < 0.6) opts.push(pick(B, 'stop3', ['Big stop on third down by that defense.', 'Get off the field on third down. That is what good defenses do.', 'They held. That will bring up fourth down.', 'Great tackling there. Nothing after contact.', 'The defense wins that one.']));
  if (g.weather !== 'clear' && !venueOf(g).roof && rnd(B) < 0.15) opts.push(pick(B, 'wx', WEATHER_TALK[g.weather] ?? []));
  return opts.length ? pick(B, 'why', opts) : '';
}
// The X's and O's: what the two calls did to each other.
function schemeLine(B, g, e, lp, { yd, inc }) {
  const off = lp?.offCall ?? e.off, def = lp?.defCall ?? e.def;
  const O = OFF_PLAYS[off], kind = O?.kind;
  if (!O || !def || !DEF_PLAYS[def]) return '';
  const blitz = /blitz|dogs|mug|cover0|fire_zone/.test(def);
  const zone = /cover2|tampa2|cover3|cover4|prevent/.test(def);
  const n = known(e.carrier) ? nm(e.carrier) : 'he';
  if (kind === 'pass' && !inc && yd >= 12) {
    if (def === 'cover0') return pick(B, 'sx-c0', ['They sent everybody, and the deep middle was empty. You make them pay for that.', 'They brought the house, and he beat it. That is the risk with no safety help.']);
    if (blitz) return pick(B, 'sx-bl', ['They brought pressure, and he stood in there and delivered.', 'Blitz, and he knew exactly where to go with the ball.']);
    if (/cover2|tampa2/.test(def)) return pick(B, 'sx-c2', ['That is the hole in Cover 2, right between the corner and the safety.', 'Perfect throw into the soft spot of that Cover 2.']);
    if (zone) return pick(B, 'sx-z', [`They were in zone, and ${n} sat down right in the soft spot.`, 'Found the seam between the zone defenders. Great feel.']);
    return pick(B, 'sx-man', [`Man coverage, and ${n} just beat his guy.`, `${n} won the one-on-one. You can't play man on him all day.`]);
  }
  if (kind === 'pass' && !inc && /screen|bubble/.test(off) && yd >= 6) return 'The screen was set up beautifully. Let the rush come, get the big guys out in front.';
  if (kind === 'pass' && !inc && O.pa && yd >= 8) return 'The play-action froze the linebackers. That opened the window behind them.';
  if (kind === 'run' && yd >= 6) {
    if (blitz) return 'They blitzed, and he ran right through the gap the linebacker left.';
    if (O.dir === 'counter') return 'The counter gets the linebackers flowing the wrong way, and then he cuts it back.';
    if (O.dir === 'draw') return 'Perfect call. The rush gets upfield, and he runs right past them.';
    if (zone) return 'Light box. They were sitting back in coverage, and you run the ball against that all day.';
    if (/outside|toss|sweep/.test(O.dir ?? '')) return 'He got to the edge. The defense lost contain on that one.';
    return pick(B, 'rx-gen', ['Great blocking up front. The line got to the second level.', `${n} followed his blockers and hit the hole hard.`]);
  }
  if (kind === 'run' && yd <= 0) {
    if (def === 'run_blitz') return 'Great call on defense. The linebacker shoots the gap, right into the play.';
    if (def === 'goal_line') return 'They stacked the box, and there was nowhere to go.';
    return pick(B, 'rx-stuff', ['Penetration up front. The play never had a chance.', 'Defense was gap sound. Everybody fit their run responsibility.']);
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
      color(W ? pick(B, 'finalc', [`What a performance by the ${W.name}. For ${CREW.pbp.name}, I'm ${CREW.color.name}. Good night, everybody.`, `The ${W.name} earned that one. Great game to call, Mack.`]) : 'Nobody wanted to lose this one.', 1, 1)];
  }
  if (q === 2) return [pbp(`That's halftime. ${scoreLine(g)}.`, 1, 1), color(halftimeNote(g), 1)];
  return [pbp(`That's the end of the ${QUARTER[q] ?? 'quarter'}. ${scoreLine(g)}.`, 1)];
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
// When the call sheet is up and the booth has been quiet a while: one of Dee's notes, and not
// over and over.
export function fillerLine(B, g) {
  if (!g || g.final || g.phase !== 'play') return null;
  if (B.plays - B.colorAt < 2) return null;
  B.fillers++;
  const o = g.poss, T = g.teams[o], D = g.teams[1 - o];
  const opts = [];
  const tw = playerToWatch(g, o);
  const s = tw ? T.stats?.[tw.id] : null;
  if (s && s.rc >= 3) opts.push(`${tw.name} has ${plural(s.rc, 'catch')} today. They keep finding ways to get him the ball.`);
  else if (s && s.ra >= 5) opts.push(`${tw.name} has ${s.ra} carries already. They are leaning on him.`);
  const def = g.log.filter((x) => x.team === o && x.def && DEF_PLAYS[x.def]).slice(-6);
  const blitz = def.filter((x) => /blitz|dogs|mug|cover0|fire_zone/.test(x.def)).length;
  if (def.length >= 5 && blitz >= 3) opts.push(`The ${D.name} have been bringing pressure all day. The quarterback has to get the ball out quick.`);
  const runs = g.log.filter((x) => x.team === o && x.off && OFF_PLAYS[x.off]?.kind === 'run').slice(-8);
  const ry = runs.reduce((sum, x) => sum + (x.yards ?? 0), 0);
  if (runs.length >= 4 && B.fillers % 2) opts.push(ry / runs.length >= 5 ? pick(B, 'rungood', ['They are running the ball well. Keep pounding it until somebody stops it.', 'The offensive line is winning up front. That run game is humming.']) : pick(B, 'runbad', ['The run game has been bottled up. They might have to throw it more.', 'Not much room on the ground today. The defensive front is winning.', 'They cannot get the run game going. That puts a lot on the quarterback.']));
  if (g.weather !== 'clear' && !venueOf(g).roof) opts.push(...(WEATHER_TALK[g.weather] ?? []));
  if (B.streak.n >= 3 && B.streak.ti != null) opts.push(`The ${g.teams[B.streak.ti].name} have the momentum right now. You can feel it in the building.`);
  if (!opts.length) return null;
  B.colorAt = B.plays;
  return finish(B, g, [color(pick(B, 'filler', opts), 0)])[0] ?? null;
}
