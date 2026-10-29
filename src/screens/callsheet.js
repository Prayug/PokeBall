// The play-call sheet: which calls are on it, their keys and tabs, the formation and front
// picks, and the AI's own formation choices.
import { DEF_PLAYS, OFF_PLAYS, SCHEME, TEMPOS, clockLean, clockText, convertLean, defenseWeights, downText, fgDistance, fgOdds, offenseLean, onsideLean, passWeights, runWeights, xpOdds } from '../engine.js';
import { CALL_FRONT, DEF_FORMATIONS, FORMATIONS, PLAY_FORMATION } from '../live.js';
import { formationsFor } from '../formations.js';
import { diagram, formationName, runSideName } from '../playbook.js';
import { render } from '../app.js';
import { S } from '../state.js';
import { edgeRow, esc, powersRow } from '../ui.js';
import { SCHEMES, schemePlay } from '../coach.js';
import { twoPlayer, userSide } from './game.js';
import { tendencyFit, tendencyLines, typeEdges } from '../scout.js';
import { HOT_ROUTES, SHADES, audibles, canFlip, hotCandidates, motionCandidates } from '../live/presnap.js';
import { RECEIVERS } from '../live.js';
import { keyFor } from '../controls.js';

// Play families for the call sheet: a short label and a colored edge per group.
const DEF_GROUPS = [['front', 'Man', ['base', 'cover1_robber', 'cover2_man', 'man_press', 'goal_line']],
  ['cover', 'Zone', ['cover2', 'tampa2', 'cover3', 'cover4', 'prevent']],
  ['blitz', 'Pressure', ['run_blitz', 'pass_blitz', 'mug', 'nickel_blitz', 'fire_zone', 'cover0']]];
// Number keys for the visible calls in order; kicks get letters.
const CALL_KEYS = [['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'],
  ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-']];
export const KICK_KEYS = { punt: ['KeyP', 'P'], fg: ['KeyF', 'F'] };  // the other kicks take number keys on their page

// The calls on the sheet right now, grouped, each with its key. Also marks the one that fits:
// what the other team's tendencies on downs like this point to (with why), or, until there is
// enough of a pattern, the heaviest weight in the AI's own tables, read without rolling g.rng.
export function callSheet(g) {
  const pen = g.phase === 'penalty';
  // After a flag the side it was against picks; the call sheet is theirs on either side of the ball.
  const onOff = pen ? g.pending?.offended === userSide() : g.poss === userSide();
  const heaviest = (w, keys) => keys.filter((k) => w[k] > 0).sort((x, y) => w[y] - w[x])[0];
  let groups, fit;
  if (pen) {
    groups = onOff ? [['penalty', 'Flag', ['accept', 'decline']]] : [];
    fit = g.pending?.aiAccept ? 'accept' : 'decline';
  } else if (onOff && g.phase === 'pat') {
    // The try: kick the extra point, or any run or pass from the 2 for two.
    const kind = (k) => OFF_PLAYS[k].kind;
    const runs = Object.keys(OFF_PLAYS).filter((k) => kind(k) === 'run'), passes = Object.keys(OFF_PLAYS).filter((k) => kind(k) === 'pass');
    groups = [['kick', 'Try', ['xp']], ['run', 'Run for two', runs], ['pass', 'Pass for two', passes]];
    fit = convertLean(g) === 'xp' ? 'xp' : heaviest(passWeights(g), passes);
  } else if (onOff && g.phase === 'kickoff') {
    groups = [['kick', 'Kickoff', ['kick_deep', 'onside']]];
    fit = onsideLean(g, g.kick?.kicker ?? g.poss) ? 'onside' : 'kick_deep';
  } else if (onOff) {
    const fg = fgDistance(g);
    const kind = (k) => OFF_PLAYS[k].kind;
    const shown = Object.keys(OFF_PLAYS).filter((k) => !['xp', 'kickoff'].includes(kind(k)) && ((kind(k) !== 'punt' && kind(k) !== 'fg') || g.down === 4 || (kind(k) === 'fg' && fg <= 60)));
    groups = [['run', 'Run', shown.filter((k) => kind(k) === 'run')], ['pass', 'Pass', shown.filter((k) => kind(k) === 'pass')],
      ['kick', 'Kicking', shown.filter((k) => kind(k) === 'punt' || kind(k) === 'fg')], ['clock', 'Clock', shown.filter((k) => kind(k) === 'spike' || kind(k) === 'kneel')]];
    const lean = offenseLean(g), cl = clockLean(g);
    if (cl) fit = cl;
    else if (typeof lean === 'string') fit = shown.includes(lean) ? lean : null;
    else fit = lean >= 0.5 ? heaviest(passWeights(g), groups[1][2]) : heaviest(runWeights(g), groups[0][2]);
  } else {
    groups = DEF_GROUPS;
    fit = heaviest(defenseWeights(g), Object.keys(DEF_PLAYS));
  }
  const shown = new Set(groups.flatMap(([, , ks]) => ks));
  const tf = tendencyFit(g, userSide());
  const why = tf && shown.has(tf.call) ? tf.why : null;
  if (why) fit = tf.call;
  let n = 0;
  const keyed = groups.filter(([, , ks]) => ks.length).map(([fam, label, ks]) => [fam, label, ks.map((k) => {
    const key = KICK_KEYS[k] && onOff ? KICK_KEYS[k] : CALL_KEYS[n++];
    return { call: k, code: key?.[0], label: key?.[1] };
  })]);
  return { onOff, groups: keyed, fit, why };
}

// The two calls a key away on the sheet: the one that fits the down (Enter) and your last call
// from this side of the ball (R), each only when it is on the sheet now.
export function quickCalls(g) {
  const { onOff, groups, fit } = callSheet(g);
  const on = new Set(groups.flatMap(([, , cs]) => cs.map((c) => c.call)));
  const again = g.phase === 'play' ? S.lastCall?.[`${userSide()}:${onOff ? 'off' : 'def'}`] : null;
  return { fit: on.has(fit) ? fit : null, again: again && on.has(again) ? again : null };
}
// Clock and field-position shortcuts for your offense: backed up inside your own 5, a safe call
// (the sneak, straight ahead behind the center) and the kneel, which never loses more than a
// yard and so can't take a safety; with the clock running late in a half, the spike.
export function clockShortcuts(g) {
  if (g.phase !== 'play' || g.poss !== userSide() || twoPlayer()) return [];
  const out = [];
  if (g.spot <= 5) out.push({ call: 'qb_sneak', label: 'Safe call: QB Sneak', title: 'Backed up: a sneak behind the center rarely loses ground' });
  const late = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 120;
  if (g.spot <= 5 || late) out.push({ call: 'kneel', label: 'Kneel', key: 'K', title: 'Take a knee: a yard at most, never a safety, and the clock runs' });
  if (late && g.clockRunning && g.down < 4) out.push({ call: 'spike', label: 'Spike', title: 'Stop the clock (it costs the down)' });
  return out;
}
function quickHtml(g, onOff) {
  const { fit, again } = quickCalls(g);
  const name = (c) => esc((onOff ? OFF_PLAYS : DEF_PLAYS)[c]?.name ?? '');
  const kbd = (k) => (twoPlayer() ? '' : ` <kbd>${k}</kbd>`);
  const clock = onOff ? clockShortcuts(g).filter((c) => c.call !== fit) : [];
  if (!fit && !again && !clock.length) return '';
  return `<span class="cs-quicks">${fit ? `<button class="btn tiny cs-quick fit" data-act="call" data-call="${fit}" title="Call the play that fits this down">Fits: ${name(fit)}${kbd('Enter')}</button>` : ''}${again && again !== fit ? `<button class="btn tiny cs-quick" data-act="call" data-call="${again}" title="Call your last call again">Again: ${name(again)}${kbd('R')}</button>` : ''}${clock.map((c) => `<button class="btn tiny cs-quick clock" data-act="call" data-call="${c.call}" title="${esc(c.title)}">${esc(c.label)}${c.key ? kbd(c.key) : ''}</button>`).join('')}</span>`;
}

// Formations: the offense picks one for its call (or leaves it to the play's own), the defense
// picks its front (or leaves it to the call's). An AI side mixes its looks.
export function formFor(call) {
  const ok = formationsFor(call);
  if (!ok.length) return null;
  return S.formPick && ok.includes(S.formPick) ? S.formPick : PLAY_FORMATION[call];
}
export function frontFor(call) { return S.frontPick ?? CALL_FRONT[call] ?? '43'; }
// The AI's pick is a fixed function of the game and the play number (not Math.random), so a
// game started from the same seed lines up the same way every time.
function aiRoll(call) {
  const g = S.game;
  let h = ((g?.seed ?? 1) ^ Math.imul((g?.playNo ?? 0) + 1, 0x9E3779B1)) >>> 0;
  for (let i = 0; i < call.length; i++) h = Math.imul(h ^ call.charCodeAt(i), 0x85EBCA6B) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0xC2B2AE35) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 2 ** 32;
}
export function aiFormation(call) {
  const ok = formationsFor(call);
  if (!ok.length) return null;
  const r = aiRoll(call);
  return r < 0.6 ? PLAY_FORMATION[call] : ok[Math.floor(((r - 0.6) / 0.4) * ok.length) % ok.length];
}
export function aiFront(call) {
  if (call === 'goal_line') return 'goal';
  const r = aiRoll(call);
  return r < 0.7 ? CALL_FRONT[call] : ['43', 'nickel'][Math.floor(((r - 0.7) / 0.3) * 2) % 2];
}
export function cycleForm(onOff) {
  const keys = [null, ...Object.keys(onOff ? FORMATIONS : DEF_FORMATIONS)];
  const k = onOff ? 'formPick' : 'frontPick';
  S[k] = keys[(keys.indexOf(S[k] ?? null) + 1) % keys.length];
  render();
}

// The 3D game's play-call panel, in three steps like a console football game:
//   1. a category (Recommended, Run, Short pass, ... Special teams, Recent): big tiles, only the
//      ones this down can use; Enter still calls the play that fits right away
//   2. a play: four large cards of that category at a time, each with its diagram, formation,
//      type, what it does and what it beats; the arrows turn the page and move on to the next
//      category, Esc goes back to the categories
//   3. the play lined up at the line (adjustHtml and the lined-up card in game.js)
// X opens every play at once (the expanded grid). Every call keeps a key: number keys pick a
// category on the first step and a card on the second; P and F punt and kick on any step.
export const CS_PAGE = 4;
const CS_TABS_OFF = [['run', 'Run', ['inside_run', 'outside_run', 'power', 'counter', 'trap', 'toss', 'sweep', 'dive', 'draw']],
  ['qbrun', 'QB run', ['read_option', 'qb_power', 'qb_draw', 'qb_sneak']],
  ['short', 'Short pass', ['slant', 'out', 'stick', 'curl_flat', 'mesh', 'screen', 'bubble']],
  ['mid', 'Medium pass', ['curl', 'smash', 'dagger', 'levels', 'flood', 'y_cross', 'te_seam', 'pa_boot']],
  ['deep', 'Deep pass', ['four_verts', 'post', 'pa_deep']], ['clock', 'Clock', ['spike', 'kneel']],
  ['penalty', 'Flag', ['accept', 'decline']], ['kick', 'Special teams', ['punt', 'coffin_punt', 'fake_punt', 'fg', 'fake_fg', 'xp', 'kick_deep', 'onside']]];
const CS_TABS_DEF = [['front', 'Man coverage', DEF_GROUPS[0][2]], ['cover', 'Zone coverage', DEF_GROUPS[1][2]], ['blitz', 'Pressure', DEF_GROUPS[2][2]]];
// What each category is for, on its tile.
const CAT_HINT = { rec: 'Picked for this down', recent: 'Your last calls', run: 'Hand it off', qbrun: 'The quarterback keeps it', short: 'Quick throws, 0 to 9 yards',
  mid: 'Throws of 10 to 18 yards', deep: 'Shots downfield', clock: 'Spike or kneel', penalty: 'Take it or leave it', kick: 'Punt, field goal and fakes',
  front: 'Lock onto receivers', cover: 'Defend areas of the field', blitz: 'Send extra rushers' };
const recentKey = (onOff) => `${userSide()}:${onOff ? 'off' : 'def'}`;
// Remember a call for the Recent category (most recent first, four at most).
export function noteRecent(call, onOff) {
  const k = recentKey(onOff), list = ((S.recentCalls ??= {})[k] ??= []);
  const i = list.indexOf(call);
  if (i >= 0) list.splice(i, 1);
  list.unshift(call);
  list.length = Math.min(list.length, 4);
}

// What a play is good and bad against, from the engine's own coverage table (SCHEME): the
// defenses that give its route depth (or its run lanes) the most room, and the ones that take
// it away. A defensive call gets the same from its own row: what it takes away and gives up.
const DEPTH_WORD = { screen: 'screens', short: 'short passes', mid: 'medium passes', deep: 'deep passes', run: 'runs' };
const schemeRow = (k) => SCHEME[k] ?? SCHEME[DEF_PLAYS[k]?.sim] ?? SCHEME[DEF_PLAYS[k]?.like] ?? null;
export function playGuide(call, onOff) {
  if (onOff) {
    const p = OFF_PLAYS[call];
    if (!p || !['run', 'pass'].includes(p.kind)) return null;
    const col = p.kind === 'run' ? 'run' : p.depth;
    const rows = Object.keys(DEF_PLAYS).filter((k) => k !== 'goal_line').map((k) => [k, schemeRow(k)?.[col] ?? 0]);
    const beats = rows.filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => DEF_PLAYS[k].name);
    const risky = rows.filter(([, v]) => v <= -2).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => DEF_PLAYS[k].name);
    return { good: beats.length ? `Beats ${beats.join(', ')}` : '', bad: risky.length ? `Risky vs ${risky.join(', ')}` : '' };
  }
  const r = schemeRow(call);
  if (!r) return null;
  const cols = ['run', 'screen', 'short', 'mid', 'deep'].map((c) => [c, r[c]]);
  const stops = cols.filter(([, v]) => v <= -2).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([c]) => DEPTH_WORD[c]);
  const gives = cols.filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => DEPTH_WORD[c]);
  if (!stops.length && !gives.length) return { good: 'Balanced: no weak spot, no strength', bad: '' };
  return { good: stops.length ? `Takes away ${stops.join(' and ')}` : '', bad: gives.length ? `Gives up ${gives.join(' and ')}` : '' };
}

// The Recommended category: the call that fits the down first, then the best of the others by
// the AI's own weights for this situation, and your scheme's plays; each with why.
function recommended(g, onOff, byCall, fit, why) {
  const out = [], seen = new Set();
  const add = (call, reason) => { if (call && byCall.has(call) && !seen.has(call) && out.length < CS_PAGE) { seen.add(call); out.push({ ...byCall.get(call), reason }); } };
  add(fit, why ? `Fits: ${why}` : 'Fits the down');
  const heaviest = (w, keys) => keys.filter((k) => byCall.has(k) && w[k] > 0).sort((x, y) => w[y] - w[x]);
  if (onOff && g.phase === 'play') {
    const lean = offenseLean(g);
    const passFirst = typeof lean === 'number' && lean >= 0.5;
    const runs = heaviest(runWeights(g), Object.keys(OFF_PLAYS)), passes = heaviest(passWeights(g), Object.keys(OFF_PLAYS));
    const [first, second] = passFirst ? [passes, runs] : [runs, passes];
    add(first[0], 'Strong call for this down');
    add(second[0], `Best ${passFirst ? 'run' : 'pass'} here`);
    const coach = g.teams[userSide()].coach;
    for (const c of byCall.keys()) if (schemePlay(coach, c)) add(c, `${SCHEMES[coach].name} play`);
    add(first[1], 'Also fits');
  } else if (!onOff) {
    const w = defenseWeights(g);
    for (const c of heaviest(w, Object.keys(DEF_PLAYS))) add(c, 'Strong call against this down');
  }
  return out;
}

// The sheet's categories and where you are in it. level 1 is the category tiles, 2 a
// category's cards (S.csTab), 'all' the expanded grid. Keys: digits on the tiles at level 1,
// digits 1-4 on the open page at level 2, letters for the kicks at any level.
export function csTabs(g) {
  const { onOff, groups, fit, why } = callSheet(g);
  const byCall = new Map(groups.flatMap(([fam, , cs]) => cs.map((c) => [c.call, { ...c, fam }])));
  const tabs = (onOff ? CS_TABS_OFF : CS_TABS_DEF).map(([k, label, calls]) => [k, label, calls.filter((c) => byCall.has(c)).map((c) => byCall.get(c))])
    .filter(([, , cs]) => cs.length);
  // Anything not placed in a tab (new plays) lands in the last one.
  const placed = new Set(tabs.flatMap(([, , cs]) => cs.map((c) => c.call)));
  for (const c of byCall.values()) if (!placed.has(c.call)) tabs[tabs.length - 1][2].push(c);
  // The clock calls only get a tile late in a half or backed up (they stay in the full grid).
  const late = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 120;
  if (!S.csAll && !late && g.spot > 5) { const i = tabs.findIndex(([k]) => k === 'clock'); if (i >= 0 && tabs.length > 1) tabs.splice(i, 1); }
  // Recommended leads and Recent ends the list, when there is more than one category to choose from.
  if (tabs.length > 1 || (tabs[0]?.[2].length ?? 0) > CS_PAGE) {
    const rec = recommended(g, onOff, byCall, fit, why);
    if (rec.length > 1) tabs.unshift(['rec', 'Recommended', rec]);
    const recent = (S.recentCalls?.[recentKey(onOff)] ?? []).filter((c) => byCall.has(c)).map((c) => byCall.get(c));
    if (g.phase === 'play' && recent.length) tabs.push(['recent', 'Recent', recent]);
  }
  const single = tabs.length === 1;
  const cur = single ? tabs[0][0] : tabs.some(([k]) => k === S.csTab) ? S.csTab : null;
  const level = S.csAll ? 'all' : cur ? 2 : 1;
  const calls = cur ? tabs.find(([k]) => k === cur)[2] : [];
  const pages = Math.max(1, Math.ceil(calls.length / CS_PAGE));
  const page = Math.min(Math.max(0, S.csPage ?? 0), pages - 1);
  const pageCalls = calls.slice(page * CS_PAGE, page * CS_PAGE + CS_PAGE)
    .map((c, i) => ({ ...c, code: KICK_KEYS[c.call] && onOff ? KICK_KEYS[c.call][0] : CALL_KEYS[i][0], label: KICK_KEYS[c.call] && onOff ? KICK_KEYS[c.call][1] : CALL_KEYS[i][1] }));
  const catKeys = tabs.map(([k], i) => ({ tab: k, code: CALL_KEYS[i]?.[0], label: CALL_KEYS[i]?.[1] }));
  const kicks = onOff ? [...byCall.values()].filter((c) => KICK_KEYS[c.call]).map((c) => ({ ...c, code: KICK_KEYS[c.call][0], label: KICK_KEYS[c.call][1] })) : [];
  return { onOff, tabs, fit, why, cur, level, single, page, pages, pageCalls, catKeys, kicks };
}
// The key that does something on the call sheet right now: a category, a card, or a kick.
export function csKey(g, code) {
  const T = csTabs(g);
  const kick = T.kicks.find((c) => c.code === code);
  if (kick) return { call: kick.call };
  if (T.level === 1) { const c = T.catKeys.find((k) => k.code === code); return c ? { tab: c.tab } : null; }
  if (T.level === 2) { const c = T.pageCalls.find((k) => k.code === code); return c ? { call: c.call } : null; }
  return null;
}
export function csOpen(tab) { S.csTab = tab; S.csPage = 0; S.csAll = false; S.csFold = false; render(); }
// Back to the categories from a category's cards (Esc, Backspace, B on a gamepad).
export function csBack() {
  const g = S.game;
  if (!g) return false;
  const T = csTabs(g);
  if (T.level === 'all') { S.csAll = false; render(); return true; }
  if (T.level !== 2 || T.single) return false;
  S.csTab = null; S.csPage = 0; render();
  return true;
}

const CAT_ICON = {
  rec: '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z"/>',
  recent: '<path d="M12 4a8 8 0 1 1-7.4 5" fill="none" stroke-width="2.4"/><path d="M3 4v6h6" fill="none" stroke-width="2.4"/><path d="M12 8v5l3 2" fill="none" stroke-width="2.4"/>',
  run: '<path d="M4 20 C8 14 10 10 12 4" fill="none" stroke-width="3"/><path d="M8 5l4-2 3 4" fill="none" stroke-width="3"/>',
  qbrun: '<circle cx="12" cy="17" r="3"/><path d="M12 14V4M8 8l4-4 4 4" fill="none" stroke-width="2.6"/>',
  short: '<path d="M4 18h6l6-6" fill="none" stroke-width="3"/><path d="M13 9h5v5" fill="none" stroke-width="3"/>',
  mid: '<path d="M5 20V10l10-5" fill="none" stroke-width="3"/><path d="M11 3l5 2-2 5" fill="none" stroke-width="3"/>',
  deep: '<path d="M6 21V3" fill="none" stroke-width="3"/><path d="M2 7l4-4 4 4" fill="none" stroke-width="3"/><path d="M16 21V8" fill="none" stroke-width="3" opacity=".6"/><path d="M12 12l4-4 4 4" fill="none" stroke-width="3" opacity=".6"/>',
  kick: '<path d="M5 20l7-16 7 16" fill="none" stroke-width="2.6"/><path d="M8 13h8" fill="none" stroke-width="2.6"/>',
  clock: '<circle cx="12" cy="12" r="8" fill="none" stroke-width="2.6"/><path d="M12 7v5h4" fill="none" stroke-width="2.6"/>',
  penalty: '<path d="M6 21V3" fill="none" stroke-width="2.4"/><path d="M6 4h12l-3 4 3 4H6z"/>',
  front: '<path d="M5 5l6 6M11 5l-6 6" fill="none" stroke-width="2.6"/><circle cx="17" cy="17" r="3.5" fill="none" stroke-width="2.4"/><path d="M10 12l5 3" fill="none" stroke-width="2" stroke-dasharray="2 2"/>',
  cover: '<ellipse cx="12" cy="10" rx="9" ry="6" opacity=".4"/><path d="M9 16l6 6M15 16l-6 6" fill="none" stroke-width="2.6"/>',
  blitz: '<path d="M4 4l6 6M10 4l-6 6" fill="none" stroke-width="2.6"/><path d="M9 11l9 9" fill="none" stroke-width="3"/><path d="M13 20h6v-6" fill="none" stroke-width="3"/>',
};

export function callSheetHtml(g) {
  const T = csTabs(g);
  const { onOff, tabs, fit, why, cur, level } = T;
  const fg = fgDistance(g);
  const side = onOff ? 'off' : 'def';
  // Plays the user's scheme is built around get a tag (see coach.js).
  const coach = g.teams[userSide()].coach;
  const card = ({ call, label: key, fam, reason }, big = false) => {
    const p = onOff ? OFF_PLAYS[call] : DEF_PLAYS[call];
    const kind = onOff ? p.kind : fam === 'rec' || fam === 'recent' ? defFam(call) : fam;
    const extra = call === 'fg' && onOff ? `${fg} yards · ${Math.round(fgOdds(g) * 100)}% from here` : call === 'xp' ? `33 yards · ${Math.round(xpOdds(g) * 100)}%`
      : call === 'accept' ? g.pending?.acceptText ?? p.blurb : call === 'decline' ? g.pending?.declineText ?? p.blurb : p.blurb;
    const tag = onOff ? { run: 'Run', pass: 'Pass', punt: 'Kick', fg: 'Kick', xp: 'Kick', kickoff: 'Kick', spike: 'Clock', kneel: 'Clock', penalty: 'Flag' }[kind] : { front: 'Man', blitz: 'Blitz', cover: 'Zone' }[kind];
    const depth = onOff && kind === 'pass' ? { screen: 'Screen', short: 'Short', mid: 'Medium', deep: 'Deep' }[p.depth] : '';
    // After a flag each card says what it leaves: the down and spot, or the play's result.
    const form = kind === 'penalty' ? '' : onOff ? formationName(call, formFor(call)) : DEF_FORMATIONS[frontFor(call)]?.short ?? '';
    // A run says which way it goes (flipped with B).
    const way = onOff && kind === 'run' ? runSideName(g, call, formFor(call), !!S.runFlip) : '';
    const guide = big || S.csAll ? playGuide(call, onOff) : null;
    const rtag = reason ?? (call === fit ? 'Fits the down' : '');
    return `<button class="pcard k-${kind} ${call === fit ? 'fit' : ''} ${big ? 'big' : ''}" data-act="call" data-call="${call}" aria-label="${esc(p.name)}: ${esc(extra)}${key ? `, key ${key}` : ''}">
      <span class="pc-art">${diagram(g, call, side, onOff ? formFor(call) : frontFor(call), onOff && kind === 'run' && !!S.runFlip)}${key ? `<kbd>${key}</kbd>` : ''}${rtag ? `<em class="fittag ${call === fit ? '' : 'alt'}">${esc(rtag.split(':')[0])}</em>` : ''}</span>
      <span class="pname">${esc(p.name)}</span>
      <span class="pc-top"><em class="pc-kind">${tag}${depth ? ` · ${depth}` : ''}</em>${schemePlay(coach, call) ? `<em class="pc-scheme" title="${esc(SCHEMES[coach].name)} plays get a small edge">${esc(SCHEMES[coach].name)}</em>` : ''}${form ? `<span class="pc-form">${esc(form)}${way ? ` · <b class="pc-way">${way === 'Left' ? '◀ Left' : 'Right ▶'}</b>` : ''}</span>` : ''}</span>
      <span class="pblurb">${esc(extra)}</span>
      ${guide ? `<span class="pc-guide">${guide.good ? `<span class="good">${esc(guide.good)}</span>` : ''}${guide.bad ? `<span class="bad">${esc(guide.bad)}</span>` : ''}</span>` : ''}
      ${big && reason && reason.includes(':') ? `<span class="pc-why">${esc(reason.split(': ').slice(1).join(': '))}</span>` : ''}</button>`;
  };
  const us = userSide();
  const who = g.phase === 'penalty' ? (twoPlayer() ? `Player ${us + 1} · ${esc(g.teams[us].abbr)}: your call` : 'Your call') : twoPlayer() ? `Player ${us + 1} · ${esc(g.teams[us].abbr)} ${onOff ? 'offense' : 'defense'}${onOff ? '' : ' (the offense has called its play)'}` : onOff ? 'Your ball' : `${esc(g.teams[g.poss].abbr)} ball`;
  const curLabel = cur ? tabs.find(([k]) => k === cur)?.[1] : '';
  const steps = `<ol class="cs-steps" aria-label="Play call steps"><li class="${level === 1 ? 'on' : 'done'}">${level === 1 || T.single ? 'Category' : `<button class="cs-crumb" data-act="csback">Category</button>`}</li><li class="${level === 2 ? 'on' : ''}">${level === 2 && curLabel ? esc(curLabel) : 'Play'}</li><li>Snap</li></ol>`;
  const head = `<div class="cs-head"><b>${downText(g)}</b><span class="cs-who">${who}</span>
      ${level === 'all' ? '<span class="cs-steps-all">Every play</span>' : steps}
      ${edgesChip(g)}
      ${g.phase === 'play' ? formSelect(onOff) : ''}
      ${onOff && g.phase !== 'kickoff' && g.phase !== 'penalty' ? `<button class="btn tiny cs-flip" data-act="csflip" aria-pressed="${!!S.runFlip}" title="Run the runs to the other side">Flip runs <kbd>B</kbd></button>` : ''}
      <button class="btn tiny cs-all" data-act="csall" aria-pressed="${!!S.csAll}">${S.csAll ? 'Back' : 'All plays'} <kbd>X</kbd></button>
      <button class="btn tiny cs-fold" data-act="csfold" aria-expanded="${!S.csFold}">${S.csFold ? 'Show plays' : 'Hide'} <kbd>H</kbd></button></div>
    ${S.csScout && !S.csFold ? scoutPanel(g) : ''}`;
  let body;
  if (level === 'all') {
    body = `<div class="cs-book">${tabs.filter(([k]) => k !== 'rec' && k !== 'recent').map(([k, label, cs]) => `<section><h4>${label}</h4><div class="cs-cards">${cs.map((c) => card(c)).join('')}</div></section>`).join('')}</div>`;
  } else if (level === 1) {
    const name = (c) => esc((onOff ? OFF_PLAYS : DEF_PLAYS)[c.call]?.name ?? '');
    body = `<div class="cs-cats" role="list">${tabs.map(([k, label, cs], i) => {
      const key = T.catKeys[i]?.label;
      const sample = k === 'rec' ? `<b>${name(cs[0])}</b>${why ? ` · ${esc(why)}` : ''}` : k === 'recent' ? `Last: <b>${name(cs[0])}</b>` : cs.slice(0, 3).map(name).join(' · ');
      return `<button class="cs-cat c-${k}" role="listitem" data-act="cstab" data-tab="${k}"><span class="cc-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${CAT_ICON[k] ?? ''}</svg></span>
        <span class="cc-txt"><b>${esc(label)}</b><span class="cc-hint">${esc(CAT_HINT[k] ?? '')}</span><span class="cc-sample">${sample}</span></span>
        <span class="cc-n">${cs.length}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    }).join('')}</div>`;
  } else {
    const back = T.single ? '' : `<button class="cs-back" data-act="csback" aria-label="Back to the categories"><span aria-hidden="true">‹</span> Categories <kbd>Esc</kbd></button>`;
    const pager = T.pages > 1 ? `<span class="cs-pager"><button class="btn tiny" data-act="cspage" data-d="-1" aria-label="Previous page">‹</button><span>${T.page + 1} / ${T.pages}</span><button class="btn tiny" data-act="cspage" data-d="1" aria-label="Next page">›</button></span>` : '';
    body = `<div class="cs-l2"><div class="cs-l2head">${back}<h4>${esc(curLabel ?? '')}</h4>${pager}<span class="cs-l2keys">${T.pages > 1 || tabs.length > 1 ? '<kbd>←</kbd><kbd>→</kbd> more plays' : ''}</span></div>
      <div class="cs-cards big">${T.pageCalls.map((c) => card(c, true)).join('')}</div></div>`;
  }
  return `<div class="callsheet lvl-${level}${S.csFold ? ' folded' : ''}${S.csAll ? ' all' : ''}" role="dialog" aria-label="Play call">${head}${clockRow(g, onOff, `<span class="cs-acts"></span>${quickHtml(g, onOff)}`)}${powersRow(g, us)}${body}</div>`;
}
// The family a defensive call sits in, for its card color on Recommended and Recent.
const defFam = (call) => DEF_GROUPS.find(([, , ks]) => ks.includes(call))?.[0] ?? 'front';

// The clock between plays: running or stopped, your timeouts with the button to call one, and
// (on offense) the tempo to the next snap. Shared by the 3D call sheet and the 2D play cards.
export function clockRow(g, onOff, extra = '') {
  if (g.phase === 'penalty') return `<div class="cs-clock cs-flag"><span class="flagtxt">${esc(g.pending?.text ?? 'Flag on the play')}</span>${extra}</div>`;
  if (g.phase !== 'play') {
    const what = g.phase === 'pat' ? 'Kick the extra point, or run or pass from the 2 for two points' : 'Kick it deep, or onside to try to get the ball back';
    return `<div class="cs-clock"><span class="muted">${what}</span>${extra}</div>`;
  }
  const us = userSide(), left = g.timeouts?.[us] ?? 0;
  const state = g.clockRunning ? `<span class="clk run" title="The clock runs until the snap">Clock running · ${clockText(g.clock)}</span>` : '<span class="clk">Clock stopped</span>';
  const tempo = onOff ? `<label class="cs-formsel cs-tempo"><span>Tempo</span><select id="cs-tempo" aria-label="Tempo">${TEMPOS.map(([k, l]) => `<option value="${k}" ${(S.tempo ?? 'auto') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
  return `<div class="cs-clock">${state}<span class="tos" aria-label="${left} timeouts left">${[0, 1, 2].map((i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}</span>
    <button class="btn tiny" data-act="timeout" ${left > 0 ? '' : 'disabled'}>Timeout <kbd>T</kbd></button>${tempo}${extra}</div>`;
}
// The formation (offense) or front (defense) for the call, as one compact control.
function formSelect(onOff) {
  const opts = onOff ? Object.entries(FORMATIONS).map(([k, f]) => [k, f.short]) : Object.entries(DEF_FORMATIONS).map(([k, f]) => [k, f.short]);
  const cur = (onOff ? S.formPick : S.frontPick) ?? '';
  return `<label class="cs-formsel"><span>${onOff ? 'Formation' : 'Front'} <kbd>Z</kbd></span><select id="cs-form" aria-label="${onOff ? 'Formation' : 'Front'}">
    <option value="" ${cur === '' ? 'selected' : ''}>Play default</option>${opts.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
// The arrows (and LB/RB on a gamepad): on the categories, open the first (or last); on a
// category's cards, turn the page, and past the last page move on to the next category.
export function csMove(d) {
  const g = S.game;
  if (!g) return;
  const T = csTabs(g);
  if (T.level === 'all') return;
  const i = T.tabs.findIndex(([k]) => k === T.cur);
  if (T.level === 1) { csOpen(T.tabs[d > 0 ? 0 : T.tabs.length - 1][0]); return; }
  const p = T.page + d;
  if (p >= 0 && p < T.pages) { S.csPage = p; render(); return; }
  if (T.single) return;
  const next = T.tabs[(i + d + T.tabs.length) % T.tabs.length];
  S.csTab = next[0];
  S.csPage = d > 0 ? 0 : Math.ceil(next[2].length / CS_PAGE) - 1;
  render();
}

// ---------- scouting on the call sheet ----------
// The type edges for this down as one compact chip (I opens the board: the biggest edges both
// ways and the other team's tendencies so far).
function edgesChip(g) {
  const { good, bad } = typeEdges(g, userSide());
  return `<button class="cs-chip" data-act="csscout" aria-expanded="${!!S.csScout}" title="Type edges on the field this down: ${good} for you, ${bad} for them">
    Edges <b class="good">${good}</b><span aria-hidden="true">–</span><b class="bad">${bad}</b> <kbd>I</kbd></button>`;
}
function scoutPanel(g) {
  const us = userSide();
  const { rows } = typeEdges(g, us);
  const best = rows.filter((r) => r.edge > 0).sort((a, b) => b.edge - a.edge).slice(0, 3);
  const worst = rows.filter((r) => r.edge < 0).sort((a, b) => a.edge - b.edge).slice(0, 3);
  const lines = tendencyLines(g, us);
  return `<div class="cs-scout">
    <div><h4>Your edges</h4>${best.length ? `<ul>${best.map(edgeRow).join('')}</ul>` : '<p class="small muted">None this down.</p>'}</div>
    <div><h4>Their edges</h4>${worst.length ? `<ul>${worst.map(edgeRow).join('')}</ul>` : '<p class="small muted">None this down.</p>'}</div>
    <div class="tend"><h4>${esc(g.teams[1 - us].abbr)} tendencies</h4>${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : '<p class="small muted">They show up after a few drives.</p>'}</div></div>`;
}

// ---------- pre-snap adjustments at the line ----------
// The choices in the open picker, in number-key order (receivers keep their throw numbers).
// Each is { label, act, arg, on, off }; the same list drives the buttons and the keys.
export function psOptions(lp) {
  const P = S.psPick;
  if (!P || !lp) return [];
  if (P.kind === 'audible') {
    const fit = tendencyFit(S.game, userSide())?.call;
    return audibles(lp, fit).map((c) => ({ label: OFF_PLAYS[c].name, act: 'aud', arg: c, fit: c === fit }));
  }
  if (P.kind === 'hot' && !P.slot) {
    const ok = new Set(hotCandidates(lp));
    return RECEIVERS.map((k) => ({ label: `${k} · ${routeLabel(lp.off[k])}`, act: 'hotpick', arg: k, off: !ok.has(k) }));
  }
  if (P.kind === 'hot') return HOT_ROUTES.map(([k, l]) => ({ label: l, act: 'hot', arg: k, on: lp.off[P.slot]?.routeName === k }));
  if (P.kind === 'motion') {
    const ok = new Set(motionCandidates(lp));
    return RECEIVERS.map((k) => ({ label: k, act: 'motion', arg: k, off: !ok.has(k) }));
  }
  return [];
}
function routeLabel(p) {
  if (!p) return '—';
  if (p.role === 'passblock') return 'Block';
  if (p.role === 'stalk') return 'Stalk';
  return HOT_ROUTES.find(([k]) => k === p.routeName)?.[1] ?? (p.routeName ?? '').replace(/^\w/, (c) => c.toUpperCase());
}
export function adjustHtml(lp) {
  if (!lp || lp.phase !== 'pre' || lp.kick || lp.user == null) return '';
  const b = (act, label, key, { on = false, off = false, arg = '' } = {}) => `<button class="btn tiny ${on ? 'on' : ''}" data-act="ps" data-ps="${act}" data-arg="${arg}" ${off ? 'disabled' : ''} aria-pressed="${on}">${label} <kbd>${key}</kbd></button>`;
  let row;
  if (lp.user === lp.o) {
    const P = S.psPick;
    const moving = lp.motion ? `In motion: ${lp.motion}` : 'Motion';
    row = b('open', 'Audible', 'V', { arg: 'audible', on: P?.kind === 'audible' })
      // On a run, B flips it to the other side instead (there are no routes to change).
      + (lp.kind === 'run' ? b('flip', `${lp.runSide > 0 ? 'Run right ▶' : '◀ Run left'} · Flip`, 'B', { on: !!lp.flipped, off: !canFlip(lp) })
        : b('open', P?.kind === 'hot' && P.slot ? `Hot route: ${P.slot}` : 'Hot route', 'B', { arg: 'hot', on: P?.kind === 'hot', off: lp.kind !== 'pass' }))
      + b('open', moving, 'N', { arg: 'motion', on: P?.kind === 'motion', off: !!lp.motion });
  } else {
    const shade = SHADES.find(([k]) => k === (lp.shade ?? null))[1];
    row = `<button class="btn tiny" data-act="psswitch" title="Take over another defender (or click one on the field)">Switch player <kbd>${keyFor('switch')}</kbd></button>`
      + b('shade', `Shade: ${shade}`, 'V', { on: !!lp.shade })
      + b('show', 'Show blitz', 'B', { on: lp.disguise === 'show' })
      + b('back', 'Back out', 'N', { on: lp.disguise === 'back', off: !lp.blitz.length });
  }
  const opts = psOptions(lp);
  const pick = opts.length ? `<div class="ps-pick" role="group" aria-label="Pick one">${opts.map((o, i) => `<button class="btn tiny ${o.on ? 'on' : ''} ${o.fit ? 'fit' : ''}" data-act="ps" data-ps="${o.act}" data-arg="${o.arg}" ${o.off ? 'disabled' : ''}>${o.fit ? '<em class="fittag">Fits</em> ' : ''}${esc(o.label)} <kbd>${i + 1}</kbd></button>`).join('')}</div>` : '';
  return `<div class="ps-bar" role="toolbar" aria-label="Pre-snap adjustments">${row}</div>${pick}`;
}
