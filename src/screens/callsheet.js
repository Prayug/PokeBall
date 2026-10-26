// The play-call sheet: which calls are on it, their keys and tabs, the formation and front
// picks, and the AI's own formation choices.
import { DEF_PLAYS, OFF_PLAYS, TEMPOS, clockLean, clockText, convertLean, defenseWeights, downText, fgDistance, fgOdds, offenseLean, onsideLean, passWeights, runWeights, xpOdds } from '../engine.js';
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

// The 3D game's play-call panel: a few big cards at a time. Plays sit in categories (runs,
// short passes, deep passes, kicks; on defense fronts, blitzes and coverages) with tabs to
// move between them, so each card has room for readable play art, the name, one line on
// what it does, run or pass, and its key. Every call keeps its number key from any tab, and
// the panel opens on the category of the call that fits the down.
const CS_TABS_OFF = [['run', 'Run', ['inside_run', 'outside_run', 'power', 'counter', 'trap', 'toss', 'sweep', 'dive', 'draw']],
  ['qbrun', 'QB runs', ['read_option', 'qb_power', 'qb_draw', 'qb_sneak']],
  ['short', 'Quick', ['slant', 'out', 'stick', 'curl_flat', 'mesh', 'screen', 'bubble']],
  ['mid', 'Intermediate', ['curl', 'smash', 'dagger', 'levels', 'flood', 'y_cross', 'te_seam']],
  ['deep', 'Shots', ['four_verts', 'post', 'pa_boot', 'pa_deep']], ['clock', 'Clock', ['spike', 'kneel']],
  ['penalty', 'Flag', ['accept', 'decline']], ['kick', 'Special teams', ['punt', 'coffin_punt', 'fake_punt', 'fg', 'fake_fg', 'xp', 'kick_deep', 'onside']]];
export function csTabs(g) {
  const { onOff, groups, fit, why } = callSheet(g);
  const byCall = new Map(groups.flatMap(([fam, , cs]) => cs.map((c) => [c.call, { ...c, fam }])));
  const tabs = (onOff ? CS_TABS_OFF : DEF_GROUPS).map(([k, label, calls]) => [k, label, calls.filter((c) => byCall.has(c)).map((c) => byCall.get(c))])
    .filter(([, , cs]) => cs.length);
  // Anything not placed in a tab (new plays) lands in the last one.
  const placed = new Set(tabs.flatMap(([, , cs]) => cs.map((c) => c.call)));
  for (const c of byCall.values()) if (!placed.has(c.call)) tabs[tabs.length - 1][2].push(c);
  // Number keys count from 1 within each tab (kicks keep their letters), like a playbook page.
  for (const [, , cs] of tabs) {
    let n = 0;
    for (const c of cs) { const key = KICK_KEYS[c.call] && onOff ? KICK_KEYS[c.call] : CALL_KEYS[n++]; c.code = key?.[0]; c.label = key?.[1]; }
  }
  const fitTab = tabs.find(([, , cs]) => cs.some((c) => c.call === fit))?.[0] ?? tabs[0][0];
  const cur = tabs.some(([k]) => k === S.csTab) ? S.csTab : fitTab;
  return { onOff, tabs, fit, why, cur };
}
export function callSheetHtml(g) {
  const { onOff, tabs, fit, why, cur } = csTabs(g);
  const fg = fgDistance(g);
  const side = onOff ? 'off' : 'def';
  const curCalls = new Set(tabs.find(([k]) => k === cur)[2].map((c) => c.call));
  // Plays the user's scheme is built around get a tag (see coach.js).
  const coach = g.teams[userSide()].coach;
  const card = ({ call, label: key, fam }) => {
    const label = curCalls.has(call) || KICK_KEYS[call] ? key : null;
    const p = onOff ? OFF_PLAYS[call] : DEF_PLAYS[call];
    const kind = onOff ? p.kind : fam;
    const extra = call === 'fg' && onOff ? `${fg} yards · ${Math.round(fgOdds(g) * 100)}%` : call === 'xp' ? `33 yards · ${Math.round(xpOdds(g) * 100)}%`
      : call === 'accept' ? g.pending?.acceptText ?? p.blurb : call === 'decline' ? g.pending?.declineText ?? p.blurb : p.blurb;
    const tag = onOff ? { run: 'Run', pass: 'Pass', punt: 'Kick', fg: 'Kick', xp: 'Kick', kickoff: 'Kick', spike: 'Clock', kneel: 'Clock', penalty: 'Flag' }[kind] : { front: 'Man', blitz: 'Blitz', cover: 'Zone' }[kind];
    // After a flag each card says what it leaves: the down and spot, or the play's result.
    const form = kind === 'penalty' ? extra : onOff ? formationName(call, formFor(call)) : DEF_FORMATIONS[frontFor(call)]?.short ?? '';
    // A run says which way it goes (flipped with U).
    const way = onOff && kind === 'run' ? runSideName(g, call, formFor(call), !!S.runFlip) : '';
    return `<button class="pcard k-${kind} ${call === fit ? 'fit' : ''}" data-act="call" data-call="${call}" title="${esc(extra)}" aria-label="${esc(p.name)}: ${esc(extra)}${label ? `, key ${label}` : ''}">
      <span class="pc-art">${diagram(g, call, side, onOff ? formFor(call) : frontFor(call), onOff && kind === 'run' && !!S.runFlip)}${label ? `<kbd>${label}</kbd>` : ''}${call === fit ? '<em class="fittag">Fits</em>' : ''}</span>
      <span class="pname">${p.name}</span>
      <span class="pc-top"><em class="pc-kind">${tag}</em>${schemePlay(coach, call) ? `<em class="pc-scheme" title="${esc(SCHEMES[coach].name)} plays get a small edge">${esc(SCHEMES[coach].name)}</em>` : ''}${form ? `<span class="pc-form">${esc(form)}${way ? ` · <b class="pc-way">${way === 'Left' ? '◀ Left' : 'Right ▶'}</b>` : ''}</span>` : ''}</span>
      <span class="pblurb">${esc(extra)}</span></button>`;
  };
  const us = userSide();
  const who = g.phase === 'penalty' ? (twoPlayer() ? `Player ${us + 1} · ${esc(g.teams[us].abbr)}: your call` : 'Your call') : twoPlayer() ? `Player ${us + 1} · ${esc(g.teams[us].abbr)} ${onOff ? 'offense' : 'defense'}${onOff ? '' : ' (the offense has called its play)'}` : onOff ? 'Your ball' : `${esc(g.teams[g.poss].abbr)} ball`;
  const head = `<div class="cs-head"><b>${downText(g)}</b><span class="cs-who">${who}</span>
      <div class="cs-tabs" role="tablist">${tabs.map(([k, label, cs]) => `<button role="tab" class="cs-tab ${k === cur && !S.csAll ? 'on' : ''}" aria-selected="${k === cur}" data-act="cstab" data-tab="${k}">${label}<span>${cs.length}</span></button>`).join('')}</div>
      ${edgesChip(g)}
      ${g.phase === 'play' ? formSelect(onOff) : ''}
      ${onOff && g.phase !== 'kickoff' && g.phase !== 'penalty' ? `<button class="btn tiny cs-flip" data-act="csflip" aria-pressed="${!!S.runFlip}" title="Run the runs to the other side">Flip runs <kbd>B</kbd></button>` : ''}
      <button class="btn tiny cs-all" data-act="csall" aria-pressed="${!!S.csAll}">${S.csAll ? 'Fewer' : 'All plays'} <kbd>X</kbd></button>
      <button class="btn tiny cs-fold" data-act="csfold" aria-expanded="${!S.csFold}">${S.csFold ? 'Show plays' : 'Hide'} <kbd>H</kbd></button></div>
    ${why ? `<p class="cs-fit"><em class="fittag">Fits</em> <b>${esc((onOff ? OFF_PLAYS : DEF_PLAYS)[fit].name)}</b> ${esc(why)}</p>` : ''}
    ${S.csScout && !S.csFold ? scoutPanel(g) : ''}`;
  // The strip: the plays of one category in a row, each a real play diagram with its name.
  // The expanded playbook (X): every category at once.
  const body = S.csAll
    ? `<div class="cs-book">${tabs.map(([k, label, cs]) => `<section><h4>${label}</h4><div class="cs-cards">${cs.map(card).join('')}</div></section>`).join('')}</div>`
    : `<div class="cs-cards">${tabs.find(([k]) => k === cur)[2].map(card).join('')}</div>`;
  return `<div class="callsheet${S.csFold ? ' folded' : ''}${S.csAll ? ' all' : ''}" role="dialog" aria-label="Play call">${head}${clockRow(g, onOff, quickHtml(g, onOff))}${powersRow(g, us)}${body}</div>`;
}

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
export function csMove(d) {
  const g = S.game;
  if (!g) return;
  const { tabs, cur } = csTabs(g);
  const i = tabs.findIndex(([k]) => k === cur);
  S.csTab = tabs[(i + d + tabs.length) % tabs.length][0];
  S.csPage = 0;
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
    row = b('shade', `Shade: ${shade}`, 'V', { on: !!lp.shade })
      + b('show', 'Show blitz', 'B', { on: lp.disguise === 'show' })
      + b('back', 'Back out', 'N', { on: lp.disguise === 'back', off: !lp.blitz.length });
  }
  const opts = psOptions(lp);
  const pick = opts.length ? `<div class="ps-pick" role="group" aria-label="Pick one">${opts.map((o, i) => `<button class="btn tiny ${o.on ? 'on' : ''} ${o.fit ? 'fit' : ''}" data-act="ps" data-ps="${o.act}" data-arg="${o.arg}" ${o.off ? 'disabled' : ''}>${o.fit ? '<em class="fittag">Fits</em> ' : ''}${esc(o.label)} <kbd>${i + 1}</kbd></button>`).join('')}</div>` : '';
  return `<div class="ps-bar" role="toolbar" aria-label="Pre-snap adjustments">${row}</div>${pick}`;
}
