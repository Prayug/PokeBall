// Replay review: the officials' ruling on the field, a coach's challenge and the booth.
//
// The live simulation knows exactly where a play ended. The officials on the field don't: on a
// bang-bang play they spot the ball, rule on the goal line or blow a fumble dead as they see it,
// and now and then they get it wrong. Three calls can be missed:
//   spot    the ball ends within a foot of the line to gain: first down or short?
//   goal    the runner is stopped inches short of the goal line, or the pile pushes him over
//   fumble  the ball comes out as he goes down: fumble or down by contact?
// Every other play is ruled exactly as it happened. The review is the instant replay (the
// recorded inputs from L3.rec, see screens/live3d.js) run again, and then the true result.
//
// Who reviews what, close to the NFL:
//   - each side has one challenge a half; it needs a timeout to throw the flag, and a lost
//     challenge costs that timeout (a won one keeps it)
//   - the booth reviews every close call in the last two minutes of a half and in overtime,
//     and close scoring plays and turnovers at any time; coaches can't challenge those
//   - the challenge is open until the next snap
import { addLog } from './engine.js';

// How close a play must be for the officials to miss it, in yards, and how often they miss
// the closest ones (falling to never at the edge of the window).
export const REVIEW = { spotWindow: 0.3, goalWindow: 0.45, miss: 0.45, pileMiss: 0.3, fumbleClose: 0.4, fumbleMiss: 0.35 };

// The same random draw for the same play every time (the game's seed and play number), kept off
// the game's own random stream so a ruling never changes what happens next.
function draw(g, salt) {
  let s = (g.seed ^ Math.imul((g.playNo ?? 0) + 1 + salt * 977, 2654435761)) >>> 0 || 1;
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const yardsWord = (y) => (y === 0 ? 'no gain' : y > 0 ? `${y} yard${y === 1 ? '' : 's'}` : `a loss of ${-y}`);
const withYards = (text, from, to) => text.replace(`for ${yardsWord(from)}`, `for ${yardsWord(to)}`);

// The last two minutes of either half, and overtime: the booth's time.
export const boothTime = (g) => g.quarter >= 5 || ((g.quarter === 2 || g.quarter === 4) && g.clock <= 120);

// The call on the field for a live run or pass that just ended (lp.result is what really
// happened). Returns null for a play that isn't close, otherwise
//   { kind, wrong, truth, call, against, deltas, said, really }
// where call is the result the officials give (the truth itself when they get it right),
// against the side the call went against (who would challenge it), deltas the player stats
// the call changes, and said / really the call and the truth in a few words.
export function fieldRuling(lp) {
  const R = ruleOn(lp);
  if (R) R.scores = R.call.yards >= lp.goalX && !R.call.turnover;
  return R;
}
function ruleOn(lp) {
  const g = lp.g, r = lp.result, end = lp.end;
  if (!r || lp.kick || r.noPlay || r.fouls?.length || lp.intercepted || g.phase !== 'play') return null;
  if (!['run', 'pass', 'sack'].includes(r.kind) || end?.how === 'incomplete') return null;
  const o = lp.o, d = lp.d, goal = lp.goalX, toGo = g.toGo;
  const stat = (yards) => {
    // The yards a spot change moves on the stat sheet (the play's own yards stay as counted).
    const dy = yards - r.yards;
    if (!dy || r.carrier == null) return [];
    return r.kind === 'pass' && lp.caught ? [[o, r.qb, 'py', dy], [o, r.carrier, 'rcy', dy]] : r.kind === 'run' ? [[o, r.carrier, 'ry', dy]] : [];
  };
  const respot = (yards, extra = '') => ({ ...r, yards, text: withYards(r.text, r.yards, yards).replace(/ (Tackled by [^.]*|Pushed out of bounds)\./, yards >= goal ? '' : ' $1.') + extra });

  // Fumble or down by contact: the ball came out and the defense has it.
  if (r.turnover === 'fumble' && end?.tackler) {
    if (draw(g, 1) >= REVIEW.fumbleClose) return null;
    const wrong = draw(g, 2) < REVIEW.fumbleMiss;
    const base = r.text.replace(/ (Strip sack!|FUMBLE!).*$/, '');
    const down = { ...r, text: `${base} Ruled down by contact.`, highlight: r.kind === 'sack' ? 'sack' : r.yards >= 20 ? 'big' : null, clockStop: false };
    delete down.turnover; delete down.returnSpot;
    return { kind: 'fumble', wrong, truth: r, call: wrong ? down : r, against: wrong ? d : o,
      deltas: wrong ? [[o, r.carrier, 'fum', -1], [d, end.tackler.id, 'ff', -1]] : [],
      said: wrong ? 'down by contact' : 'a fumble', really: 'a fumble' };
  }
  if (r.kind === 'sack' || r.turnover) return null;
  const at = lp.spotX;

  // The goal line: stopped just short, or carried over by the pile.
  if (end.how === 'td' && lp.tackle) {
    const wrong = draw(g, 3) < REVIEW.pileMiss;
    const short = Math.max(-lp.spot, goal - 1);
    const call = wrong ? { ...respot(short), text: `${withYards(r.text, r.yards, short)} Down inside the 1.` } : r;
    return { kind: 'goal', wrong, truth: r, call, against: wrong ? o : d, deltas: wrong ? stat(short) : [], said: wrong ? 'down short of the goal line' : 'a touchdown', really: 'a touchdown' };
  }
  if ((end.how === 'tackle' || end.how === 'out') && at != null && r.yards < goal && at >= goal - REVIEW.goalWindow) {
    const k = (goal - at) / REVIEW.goalWindow;
    const wrong = draw(g, 4) < REVIEW.miss * (1 - k);
    return { kind: 'goal', wrong, truth: r, call: wrong ? respot(goal) : r, against: wrong ? d : o, deltas: wrong ? stat(goal) : [], said: wrong ? 'a touchdown' : 'down short of the goal line', really: 'down short of the goal line' };
  }

  // The line to gain: the spot decides a first down.
  if ((end.how === 'tackle' || end.how === 'out' || end.how === 'slide') && at != null && toGo < goal && Math.abs(at - (toGo - 0.5)) < REVIEW.spotWindow) {
    const k = Math.abs(at - (toGo - 0.5)) / REVIEW.spotWindow;
    const wrong = draw(g, 5) < REVIEW.miss * (1 - k);
    const first = r.yards >= toGo;
    const flip = first ? toGo - 1 : toGo;
    const word = (f) => (f ? 'a first down' : 'short of the line to gain');
    return { kind: 'spot', wrong, truth: r, call: wrong ? respot(flip) : r, against: (wrong ? !first : first) ? d : o, deltas: wrong ? stat(flip) : [],
      said: word(wrong ? !first : first), really: word(first) };
  }
  return null;
}

// Apply (sign 1) or take back (sign -1) a ruling's stat changes.
export function applyDeltas(g, deltas, sign = 1) {
  for (const [ti, id, key, v] of deltas ?? []) {
    const s = g.teams[ti].stats[id];
    if (s && typeof s[key] === 'number') s[key] += v * sign;
  }
}

// Does the booth take this one (no coach's challenge needed or allowed)?
// pre is the game as it was before the play.
export function boothReviews(ruling, pre) {
  return !!ruling && (boothTime(pre) || ruling.scores || !!ruling.call.turnover);
}

// Can side ti throw the challenge flag on this play now?
export function canChallenge(g, rec, ti) {
  if (!rec || rec.done || g.final || g.playNo !== rec.playNo || rec.booth) return false;
  g.challenges ??= [1, 1];
  return (g.challenges[ti] ?? 0) > 0 && (g.timeouts?.[ti] ?? 0) > 0;
}

// Should an AI coach challenge? It sees the replay on the big screen: a call it lost that was
// wrong is challenged most of the time, a close one that was right only now and then.
export function aiWantsChallenge(g, rec, ti) {
  const R = rec?.ruling;
  if (!R || R.against !== ti || !canChallenge(g, rec, ti)) return false;
  return draw(g, 7) < (R.wrong ? 0.7 : 0.12);
}

// Restore the game to the moment before the play was applied, in place (everything else holds
// the same game object).
export function restoreGame(g, pre) {
  for (const k of Object.keys(g)) delete g[k];
  Object.assign(g, structuredClone(pre));
}

// The review's verdict, applied: the ruling stands (or is confirmed), or it is reversed and the
// play is applied again as it really happened. by is the challenging side, or null for the
// booth. replay(g, result) re-applies a result to the restored game and returns its entry.
export function decideReview(g, rec, by, replay) {
  const R = rec.ruling;
  rec.done = true;
  g.challenges ??= [1, 1];
  // (Team names are plural: "the Lavender Haunts challenge".)
  const who = by == null ? 'The booth reviews it' : `${g.teams[by].name} challenge`;
  if (R?.wrong) {
    // Everything after the snap goes back to how it was, then the true result is applied.
    const challenges = [...g.challenges], timeouts = [...g.timeouts];
    restoreGame(g, rec.pre);
    applyDeltas(g, R.deltas, -1);
    g.challenges = challenges; g.timeouts = timeouts;
    if (by != null) g.challenges[by]--;
    const e = replay(g, R.truth);
    if (e) { e.text = `Ruling reversed on review: ${R.really}. ${e.text}`; e.reviewed = 'reversed'; }
    addLog(g, { kind: 'info', head: 'Reversed', review: true, team: by, text: `${who}: the ruling on the field (${R.said}) is reversed. It's ${R.really}.` });
    return { verdict: 'reversed', entry: e, ruling: R };
  }
  if (by != null) { g.challenges[by]--; g.timeouts[by] = Math.max(0, g.timeouts[by] - 1); }
  const said = R?.said ?? 'the ruling on the field';
  const verdict = by == null ? 'confirmed' : 'stands';
  const lost = by != null ? ` They lose a timeout (${g.timeouts[by]} left).` : '';
  addLog(g, { kind: 'info', head: by == null ? 'Call confirmed' : 'Ruling stands', review: true, team: by, text: `${who}: the ruling on the field, ${said}, ${by == null ? 'is confirmed' : 'stands'}.${lost}` });
  return { verdict, entry: null, ruling: R };
}
