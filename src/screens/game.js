// Game screen: scoreboard, the 2D field, the play cards, the game menu and the panels under
// the field (pre-snap board, tendencies, subs, play-by-play, box score, drives), and calling plays.
import { DEF_SLOTS, OFF_SLOTS, SLOTS, ST_SLOTS } from '../ratings.js';
import { WEATHER, bestMultiplier, effectLabel } from '../types.js';
import { DEF_PLAYS, OFF_PLAYS, absSpot, aiDefenseCall, aiOffenseCall, aiTempo, aiTimeouts, callTimeout, clockText, delayOfGame, downText, fgDistance, fgOdds, quarterText, runPlay, snapClock, spotText, xpOdds } from '../engine.js';
import { DEF_FORMATIONS, FORMATIONS, liveKick, worldSpots } from '../live.js';
import { CAMERA_LIMITS, CAMERA_MODES, CAMERA_SHOTS } from '../camera3d.js';
import * as LG from '../league.js';
import { render, setScreen } from '../app.js';
import { S, reduceMotion, save, savePrefs, timers } from '../state.js';
import { P, edgeRow, esc, ovr, sprite, teamBadge, typeChips } from '../ui.js';
import { adjustHtml, aiFormation, aiFront, callSheet, callSheetHtml, clockRow, formFor, frontFor } from './callsheet.js';
import { DIFFICULTY, DIFFICULTY_LEVELS, applyDifficulty } from '../difficulty.js';
import { tendencyLines, typeEdges } from '../scout.js';
import { L3, afterLivePlay, replayReady, stage, startLive, stopReplay } from './live3d.js';

// ---------- game ----------
// A two-player quick game: player one has the home team, player two the away team, and each
// calls and plays their own side. The side "the user" means at any moment is the side calling:
// the offense first, then (once S.p2Call holds the offense's call) the defense.
export function twoPlayer() { return !!S.gameMeta?.twoPlayer; }
export function userSide() {
  if (!S.game) return 0;
  if (twoPlayer()) return S.p2Call ? 1 - S.game.poss : S.game.poss;
  const uid = S.gameMeta?.userTeamId ?? 0;
  return S.game.teams[0].id === uid ? 0 : 1;
}
export function needsUser(g) {
  if (g.final) return false;
  if (twoPlayer()) return true;
  // The try and the kickoff are yours when your side kicks (in Auto, only in the 4th quarter).
  // After a flag, the call is yours when the foul was against you (in Auto, only in the 4th quarter).
  if (g.phase === 'penalty') return g.pending?.offended != null && !!g.manual?.[g.pending.offended] && (!S.coach || g.quarter >= 4);
  if (g.phase === 'pat' || g.phase === 'kickoff') return !!g.manual?.[g.poss] && (!S.coach || g.quarter >= 4);
  if (!S.coach) return true;
  return g.down >= 3 || ((g.quarter === 2 || g.quarter >= 4) && g.clock <= 120) || g.quarter >= 5;
}

function renderField(g) {
  const dir = g.poss === 0 ? 1 : -1;
  const los = absSpot(g.poss, g.spot);
  const first = g.spot + g.toGo < 100 ? absSpot(g.poss, g.spot + g.toGo) : null;
  const X = (yd) => ((yd + 10) / 120) * 100;
  const Y = (y) => ((26.65 + y) / 53.3) * 100;
  const players = [];
  for (const [ti, side] of [[g.poss, 'off'], [1 - g.poss, 'def']]) {
    const t = g.teams[ti];
    for (const s of SLOTS.filter((x) => x.side === side)) {
      const id = t.lineup[s.key];
      const x = clampN(los + dir * s.x, -9, 109), y = s.y * dir;
      players.push(`<span class="fp ${side}" data-pid="${id}" style="left:${X(x)}%;top:${Y(clampN(y, -25, 25))}%;--team:${t.color}" title="${esc(P(id).name)} (${s.key})">${sprite(id)}</span>`);
    }
  }
  const yardLines = [];
  for (let yd = 10; yd <= 90; yd += 10) yardLines.push(`<span class="yl" style="left:${X(yd)}%"><em>${yd <= 50 ? yd : 100 - yd}</em></span>`);
  return `<div class="field" id="field">
    <div class="ez left" style="--team:${g.teams[1].color}"><span>${esc(g.teams[1].abbr)}</span></div>
    <div class="ez right" style="--team:${g.teams[0].color}"><span>${esc(g.teams[0].abbr)}</span></div>
    ${yardLines.join('')}
    <span class="losline" style="left:${X(los)}%"></span>
    ${first != null ? `<span class="firstline" style="left:${X(first)}%"></span>` : ''}
    ${players.join('')}
    <span class="football" id="football" style="left:${X(los)}%;top:50%"></span>
  </div>`;
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

function scoreboard(g) {
  const [H, A] = g.teams;
  const pos = (i) => (g.poss === i && !g.final ? '<span class="possdot" title="Has the ball"></span>' : '');
  return `<div class="scoreboard">
    <div class="sb-team" style="--team:${A.color}"><span class="sb-abbr">${esc(A.abbr)}</span>${pos(1)}<span class="sb-score">${g.score[1]}</span>${g.final ? '' : timeoutPips(g, 1)}</div>
    <div class="sb-mid"><span class="sb-q">${g.final ? 'FINAL' : quarterText(g.quarter)}</span><span class="sb-clock ${g.clockRunning ? 'run' : ''}">${g.final ? '' : clockText(g.clock)}</span></div>
    <div class="sb-team home" style="--team:${H.color}">${g.final ? '' : timeoutPips(g, 0)}<span class="sb-score">${g.score[0]}</span>${pos(0)}<span class="sb-abbr">${esc(H.abbr)}</span></div>
    <div class="sb-info">${g.final ? `${esc(g.teams[g.winner ?? 0].name)} ${g.winner == null ? 'tie' : 'win'}` : `${downText(g)} · Ball on ${spotText(g)}`} · ${WEATHER[g.weather].name}</div>
  </div>`;
}

// Timeouts left for a side, as three marks.
function timeoutPips(g, ti) {
  const n = g.timeouts?.[ti] ?? 3;
  return `<span class="tos ${ti === 0 ? 'home' : 'away'}" title="${esc(g.teams[ti].abbr)}: ${n} timeout${n === 1 ? '' : 's'} left">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function playCards(g, { keys = false } = {}) {
  const { onOff, groups, fit, why } = callSheet(g);
  const fg = fgDistance(g);
  const card = ({ call, label }, fam) => {
    const p = onOff ? OFF_PLAYS[call] : DEF_PLAYS[call];
    const extra = call === 'fg' && onOff ? `${fg} yards · ${Math.round(fgOdds(g) * 100)}%` : call === 'xp' ? `33 yards · ${Math.round(xpOdds(g) * 100)}%` : p.blurb;
    return `<button class="play f-${fam} ${call === fit ? 'fit' : ''}" data-act="call" data-call="${call}">
      <b>${p.name}</b><span>${extra}</span>${call === fit ? `<em class="fittag">${why ? esc(`Fits: ${why}`) : 'Fits this down'}</em>` : ''}${keys && label ? `<kbd>${label}</kbd>` : ''}</button>`;
  };
  const head = onOff ? `<div class="callhead"><h3>${downText(g)} at ${spotText(g)}</h3><span class="muted">Call your offense</span></div>`
    : `<div class="callhead"><h3>${downText(g)} at ${spotText(g)}</h3><span class="muted">${esc(g.teams[g.poss].abbr)} ball · call your defense</span></div>`;
  return `${head}${clockRow(g, onOff)}<div class="playgroups">${groups.map(([fam, label, cs]) => `<div class="pgroup"><h4>${label}</h4>
    <div class="plays">${cs.map((c) => card(c, fam)).join('')}</div></div>`).join('')}</div>`;
}

function lastPlayHtml(g) {
  const e = [...g.log].reverse().find((x) => x.kind !== 'sub');
  if (!e) return '';
  const tone = e.highlight === 'td' || e.kind === 'score' ? 'td' : e.highlight === 'turnover' || e.kind === 'turnover' ? 'to' : e.highlight === 'sack' ? 'sack' : e.highlight === 'big' ? 'big' : '';
  const calls = e.off ? `<span class="calls">${OFF_PLAYS[e.off].name} vs ${DEF_PLAYS[e.def]?.name ?? ''}</span>` : '';
  return `<div class="lastplay ${tone}">${calls}<p>${esc(e.text).replace('It&#39;s super effective!', '<mark>It&#39;s super effective!</mark>')}</p></div>`;
}

export function renderGame() {
  const g = S.game;
  if (!g) return `<section><p>No game in progress.</p></section>`;
  const us = userSide();
  const live3d = !!stage;
  const now = performance.now();
  // The call sheet only comes up once the result has been shown and the teams have reset.
  const decide = !g.final && needsUser(g) && !S.busy && !L3.lp && !(L3.resultUntil > now) && !(L3.resetUntil > now && !L3.preview?.lp?.set);
  const simOff = L3.lp && L3.lp.phase !== 'pre' ? 'disabled' : '';
  const simBtns = `<button class="btn" data-act="sim" data-stop="drive" ${simOff}>Sim drive</button>
        <button class="btn" data-act="sim" data-stop="quarter" ${simOff}>Sim quarter</button>
        <button class="btn" data-act="sim" data-stop="game" ${simOff}>Sim to the end</button>`;
  const coachBox = modeHtml();
  // On the 3D field the sims tuck into a Skip disclosure on the Mode row.
  const simrow = live3d ? `<div class="simrow">${coachBox}${S.skipOpen ? simBtns : ''}<button class="btn skip" id="g-skip" data-act="skip" aria-expanded="${!!S.skipOpen}">${S.skipOpen ? 'Hide' : 'Skip'}</button></div>`
    : `<div class="simrow">${coachBox}${simBtns}</div>`;
  let controls, dock = 'call';
  if (g.final) {
    dock = 'final';
    const verdict = g.winner == null ? 'Tie game' : twoPlayer() ? `Player ${g.winner + 1} wins: ${esc(g.teams[g.winner].name)}` : g.teams[g.winner].id === (S.gameMeta?.userTeamId ?? 0) ? 'You win' : 'You lose';
    controls = `<div class="card final callcard"><h2>${verdict}, ${Math.max(...g.score)} to ${Math.min(...g.score)}</h2>
      <div class="actions">${S.gameMeta?.quick ? `<button class="btn primary" data-act="${twoPlayer() ? 'quick2' : 'quick'}">Play another ${twoPlayer() ? 'two-player game' : 'quick game'}</button><button class="btn" data-act="home">Home</button>`
        : '<button class="btn primary" data-act="finishgame">Back to the season</button>'}</div></div>`;
  } else {
    let head;
    if (L3.lp) {
      const lp = L3.lp;
      const mine = (lp.user === lp.o ? OFF_PLAYS[L3.off]?.name : DEF_PLAYS[L3.def]?.name) ?? '';
      dock = lp.phase === 'pre' ? 'lined' : 'live';
      head = `<div class="callhead"><h3>${lp.phase === 'pre' ? `Lined up: ${esc(mine)}` : 'Play in progress'}</h3><span class="muted">${downText(g)} at ${spotText(g)}</span></div>
        ${lp.phase === 'pre' ? `<div class="actions"><button class="btn primary" data-act="snap">${lp.user === lp.o ? 'Snap the ball' : 'Start the play'} <kbd>Space</kbd></button>
        ${S.coachDown ? '' : '<button class="btn" data-act="recall">Change play</button>'}</div>` : ''}`;
    } else if (decide) head = playCards(g, { keys: live3d }) + (live3d ? '' : presnapHtml(g) + tendenciesHtml(g));
    else {
      dock = 'wait';
      head = `<div class="callhead"><h3>${S.busy ? 'Play in progress' : 'AI calling this down'}</h3><span class="muted">Auto mode hands you 3rd and 4th downs and the last two minutes</span></div>`;
    }
    controls = `<div class="card callcard">${head}${simrow}</div>`;
  }
  if (live3d) {
    // The 3D game fills the screen: a broadcast scoreboard on top, a menu in the corner, the
    // call sheet only between plays, and the game details below the fold.
    let overlay = '';
    if (g.final) overlay = controls.replace('class="card ', 'class="card ov-final ');
    else if (L3.lp) {
      const lp = L3.lp;
      const offTxt = `${FORMATIONS[lp.formation]?.name ?? ''}`, defTxt = `${DEF_FORMATIONS[lp.defFormation]?.name ?? ''}`;
      // Two players: each sees only the other's formation, not the call.
      const mine = lp.p2 ? `${g.teams[lp.o].abbr} ${offTxt}` : lp.user === lp.o ? `${offTxt} · ${OFF_PLAYS[L3.off].name}` : `${defTxt} · ${DEF_PLAYS[L3.def].name}`;
      const theirs = lp.p2 ? `vs ${g.teams[lp.d].abbr} ${defTxt}` : lp.user === lp.o ? `vs ${defTxt}` : `vs ${offTxt}`;
      if (lp.phase === 'pre') overlay = `<div class="lined3">${S.coachDown || lp.p2 ? '' : adjustHtml(lp)}<div class="pill lined"><span class="pl-play">${esc(mine)}<small>${esc(theirs)}</small></span>
        <button class="btn primary" data-act="snap">${lp.p2 || lp.user === lp.o ? 'Snap' : 'Start'} <kbd>${lp.p2 && lp.o === 1 ? 'Enter' : 'Space'}</kbd></button>
        ${S.coachDown ? '' : '<button class="btn" data-act="recall">Change <kbd>Esc</kbd></button>'}</div></div>`;
    } else if (decide) overlay = callSheetHtml(g);
    else if (L3.resultUntil > performance.now()) overlay = '';
    else overlay = `<div class="pill wait"><span>${S.busy ? 'Play in progress' : 'AI calling this down'}</span></div>`;
    return `<section class="game g3d">
    <div class="stage-slot" id="stage-slot">
      ${broadcastBar(g)}
      <button class="menubtn" data-act="menu" aria-expanded="${!!S.menuOpen}" aria-label="Game menu"><span aria-hidden="true">☰</span> Menu <kbd>M</kbd></button>
      ${S.menuOpen ? menuHtml(g, simBtns, coachBox) : ''}
      ${!L3.lp || L3.lp.phase === 'pre' ? tickerHtml(g) : ''}
      ${S.debug ? debugHtml() : ''}
      ${overlay}
    </div>
    <div class="below">
      ${decide ? `<div class="card scoutpanel">${presnapHtml(g)}${tendenciesHtml(g)}</div>` : ''}
      <div class="tabs" role="tablist">${[['log', 'Play-by-play'], ['box', 'Box score'], ['drives', 'Drives'], ['lineup', 'Lineup and subs']].map(([k, l]) => `<button role="tab" aria-selected="${S.gameTab === k}" class="tab ${S.gameTab === k ? 'on' : ''}" data-act="gtab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="card tabbody">${S.gameTab === 'log' ? logHtml(g) : S.gameTab === 'box' ? boxHtml(g) : S.gameTab === 'lineup' ? lineupHtml(g) : drivesHtml(g)}</div>
      <p class="small muted">You coach ${esc(g.teams[us].name)}. ${WEATHER[g.weather].name}: ${WEATHER[g.weather].text}.</p>
    </div>
  </section>`;
  }
  return `<section class="game">
    ${scoreboard(g)}
    <div class="fieldwrap">${renderField(g)}</div>
    ${lastPlayHtml(g)}
    ${controls}
    <div class="tabs" role="tablist">${[['log', 'Play-by-play'], ['box', 'Box score'], ['drives', 'Drives'], ['lineup', 'Lineup and subs']].map(([k, l]) => `<button role="tab" aria-selected="${S.gameTab === k}" class="tab ${S.gameTab === k ? 'on' : ''}" data-act="gtab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="card tabbody">${S.gameTab === 'log' ? logHtml(g) : S.gameTab === 'box' ? boxHtml(g) : S.gameTab === 'lineup' ? lineupHtml(g) : drivesHtml(g)}</div>
    <p class="small muted">You coach ${esc(g.teams[us].name)}. ${WEATHER[g.weather].name}: ${WEATHER[g.weather].text}.</p>
  </section>`;
}

// Broadcast scoreboard: both teams, possession, quarter, clock, down and distance, the play
// clock and the ball spot, in one strip.
function broadcastBar(g) {
  const [H, A] = g.teams;
  const scored = (i) => (L3.scoreFlash?.[i] ?? 0) > performance.now() ? 'scored' : '';
  const team = (t, i) => `<div class="bc-team ${g.poss === i && !g.final ? 'has' : ''} ${scored(i)}" style="--team:${t.color}"><span class="bc-abbr">${esc(t.abbr)}</span><span class="bc-score">${g.score[i]}</span>${g.final ? '' : timeoutPips(g, i)}${g.poss === i && !g.final ? '<span class="bc-poss" title="Has the ball" aria-label="Has the ball"></span>' : ''}</div>`;
  const info = g.final ? `<div class="bc-cell bc-down">FINAL</div>` : `<div class="bc-cell bc-q" title="Quarter">${g.quarter <= 4 ? `${['1st', '2nd', '3rd', '4th'][g.quarter - 1].toUpperCase()}<small>QTR</small>` : quarterText(g.quarter)}</div><div class="bc-cell bc-clock ${g.clockRunning ? 'run' : ''}" id="gclock" title="${g.clockRunning ? 'Clock running' : 'Clock stopped'}">${clockText(g.clock)}</div>
    <div class="bc-cell bc-down">${downText(g)}</div><div class="bc-cell bc-pc" id="pclock" title="Play clock">:${String(Math.ceil(L3.pclock ?? 40)).padStart(2, '0')}</div>
    <div class="bc-cell bc-spot">${spotText(g)}</div>`;
  return `<div class="bcast" id="bcast">${team(A, 1)}${team(H, 0)}${info}</div>`;
}

function tickerHtml(g) {
  const e = [...g.log].reverse().find((x) => x.kind !== 'sub');
  if (!e) return '';
  const tone = e.highlight === 'td' || e.kind === 'score' ? 'td' : e.highlight === 'turnover' || e.kind === 'turnover' ? 'to' : e.highlight === 'sack' ? 'sack' : e.highlight === 'big' ? 'big' : '';
  return `<div class="ticker ${tone} ${(L3.tickerUntil ?? 0) > performance.now() ? '' : 'gone'}" id="ticker"><span class="tk-label">Last play</span><p>${esc(e.text).replace('It&#39;s super effective!', '<mark>It&#39;s super effective!</mark>')}</p></div>`;
}

// Who runs the game: Play (you call every play and control your Pokémon), Coach (you call
// every play and the AI plays it out) or Auto (the AI also calls routine downs; 3rd and 4th
// downs and the last two minutes of a half are yours).
const MODES = [['play', 'Play', 'You call the plays and control your Pokémon'], ['coach', 'Coach', 'You call the plays, the AI plays them'], ['auto', 'Auto', 'The AI calls routine downs too; you call 3rd and 4th downs and the last two minutes']];
const modeOf = () => (S.coach ? 'auto' : S.watch ? 'coach' : 'play');
function modeHtml() {
  if (twoPlayer()) return '<p class="small muted mode-note">Two players: each of you calls and plays your own side.</p>';
  const cur = modeOf();
  return `<div class="gm-row seg modes" role="radiogroup" aria-label="Mode">${MODES.map(([k, l, d]) => `<button class="btn tiny ${cur === k ? 'on' : ''}" data-act="mode" data-mode="${k}" role="radio" aria-checked="${cur === k}" title="${d}">${l}</button>`).join('')}</div>
    <p class="small muted mode-note">${MODES.find(([k]) => k === cur)[2]}.</p>`;
}
// Rookie, Pro or Legend: a preference kept between games, and applied to the game in progress
// from the next play.
export function difficultyHtml() {
  const cur = S.difficulty ?? 'pro';
  return `<div class="gm-row seg diffs" role="radiogroup" aria-label="Difficulty">${DIFFICULTY_LEVELS.map((k) => `<button class="btn tiny ${cur === k ? 'on' : ''}" data-act="difficulty" data-level="${k}" role="radio" aria-checked="${cur === k}" title="${esc(DIFFICULTY[k].blurb)}">${DIFFICULTY[k].name}</button>`).join('')}</div>
    <p class="small muted mode-note">${esc(DIFFICULTY[cur].blurb)}.</p>`;
}
export function setDifficulty(k) {
  if (!DIFFICULTY[k]) return;
  S.difficulty = k;
  if (S.game && !S.game.final) applyDifficulty(S.game, k, S.gameMeta?.userTeamId ?? 0);
  savePrefs(); save(); render();
}
export function setMode(k) {
  S.coach = k === 'auto'; S.watch = k !== 'play';
  savePrefs(); render(); autoAdvance();
}

function menuHtml(g, simBtns, coachBox) {
  const simOff = L3.lp && L3.lp.phase !== 'pre';
  return `<div class="gmenu card" role="menu">
    <h4>Mode</h4>${coachBox}
    <h4>Difficulty</h4>${difficultyHtml()}
    <h4>Skip ahead</h4><div class="gm-row">${simOff ? simBtns.replaceAll('data-act="sim"', 'data-act="sim" disabled') : simBtns}</div>
    <h4>Camera <kbd>C</kbd></h4><div class="gm-row seg">${CAMERA_MODES.map(([k, l]) => `<button class="btn tiny ${S.cam === k ? 'on' : ''}" data-act="cam" data-cam="${k}" aria-pressed="${S.cam === k}">${l}</button>`).join('')}</div>
    <h4>Graphics</h4><div class="gm-row seg">${[['auto', 'Auto'], ['high', 'High'], ['low', 'Fast']].map(([k, l]) => `<button class="btn tiny ${S.quality === k ? 'on' : ''}" data-act="quality" data-q="${k}" aria-pressed="${S.quality === k}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="g-sound" ${S.sound ? 'checked' : ''}> Sound: crowd, whistle and hits</label>
    <label class="check"><input type="checkbox" id="g-wx" ${S.weatherFx ? 'checked' : ''}> Weather effects (${WEATHER[g.weather].name})</label>
    <label class="check"><input type="checkbox" id="g-names" ${S.names ? 'checked' : ''}> Name and position over your player</label>
    <label class="check"><input type="checkbox" id="g-pips" ${S.pips ? 'checked' : ''}> Team markers under every player</label>
    <label class="check"><input type="checkbox" id="g-debug" ${S.debug ? 'checked' : ''}> Debug view: position labels, formation check, camera calibration <kbd>\`</kbd></label>
    <div class="gm-row"><button class="btn tiny" data-act="help">Controls <kbd>?</kbd></button><button class="btn tiny" data-act="replay" ${replayReady() ? '' : 'disabled'}>Replay last play <kbd>Y</kbd></button></div>
    <button class="btn tiny" data-act="details">Box score and play-by-play</button>
  </div>`;
}

// Type matchups for the down about to be played, from the lineups on the field now.
// Debug view: the play state, the formation check for the play on the field, and the broadcast
// camera's calibration sliders. Off in normal play (menu or the ` key turns it on).
function debugHtml() {
  const lp = L3.lp ?? L3.preview?.lp;
  const issues = lp?.formationIssues ?? [];
  const slider = (k, label, unit) => {
    const [lo, hi] = CAMERA_LIMITS[k];
    const v = S.cal[S.calShot][k];
    return `<label class="cal"><span>${label}</span><input type="range" id="cal-${k}" min="${lo}" max="${hi}" step="${k === 'zoom' ? 0.05 : 0.5}" value="${v}"><output id="calv-${k}">${v}${unit}</output></label>`;
  };
  return `<div class="dbg card" aria-label="Debug view">
    <h4>Debug <span class="muted" id="dbg-state">${L3.flow ?? ''}</span></h4>
    <p class="small ${issues.length ? 'bad' : 'good'}">${lp ? (issues.length ? `Formation: ${issues.length} problem${issues.length === 1 ? '' : 's'}: ${esc(issues.slice(0, 3).join('; '))}` : 'Formation check passed: 11 on 11, 7 on the line, no overlaps') : 'No formation on the field'}</p>
    <h4>Camera lenses</h4>
    <div class="gm-row">${CAMERA_SHOTS.map(([k, n]) => `<button class="btn tiny${S.calShot === k ? ' on' : ''}" data-act="calshot" data-k="${k}">${n}</button>`).join('')}</div>
    ${slider('pitch', 'Pitch', '°')}${slider('fov', 'Field of view', '°')}${slider('zoom', 'Zoom out', '×')}
    <button class="btn tiny" data-act="calreset">Reset camera</button>
  </div>`;
}

function presnapHtml(g) {
  const us = userSide();
  const onOff = g.poss === us;
  const { rows, good, bad } = typeEdges(g, us);
  const group = (key, title) => `<div><h4>${title}</h4><ul>${rows.filter((r) => r.group === key).map(edgeRow).join('')}</ul></div>`;
  return `<details class="presnap" ${S.presnapClosed ? '' : 'open'}><summary>Pre-snap board <span class="muted small">${good} type edge${good === 1 ? '' : 's'} for you, ${bad} for them</span></summary>
    <div class="edges">${group('trench', onOff ? 'Your line vs their front' : 'Your front vs their line')}${group('cover', onOff ? 'Your receivers vs their coverage' : 'Your coverage vs their receivers')}</div></details>`;
}

function tendenciesHtml(g) {
  const lines = tendencyLines(g, userSide());
  if (!lines.length) return '<p class="small muted tend">Their tendencies show up here after a few drives.</p>';
  return `<div class="tend"><h4>${esc(g.teams[1 - userSide()].abbr)} tendencies this game</h4><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`;
}

// Coach's substitutions: pick a slot, then a bench Pokémon.
function lineupHtml(g) {
  const us = userSide(), t = g.teams[us], opp = g.teams[1 - us];
  const can = !g.final && !S.busy && !L3.lp;
  const sel = S.subSel;
  const onField = new Set(Object.values(t.lineup));
  const bench = t.roster.filter((id) => !onField.has(id) && !t.out?.[id]);
  const hurt = Object.keys(t.out ?? {}).map(Number);
  const across = {};
  for (const [o, d] of LG.MATCHUP_PAIRS) { across[o] ??= d; across[d] ??= o; }
  const slotRow = (k) => {
    const id = t.lineup[k], e = Math.round(t.energy[id] ?? 100);
    const locked = t.locks?.[k] != null, starter = t.starters[k];
    return `<li class="${sel === k ? 'sel' : ''}"><button class="subslot" data-act="subslot" data-slot="${k}" ${can ? '' : 'disabled'}>
      <span class="slot">${k}</span>${sprite(id, 'xs')}<span class="cn">${esc(P(id).name)}</span>${ovr(P(id).ovr[k])}<span class="en ${e < 60 ? 'low' : ''}">${e}%</span>
      ${locked ? '<span class="lock">Coach</span>' : id !== starter ? '<span class="lock auto">Auto sub</span>' : ''}</button>
      ${locked ? `<button class="btn tiny" data-act="subback" data-slot="${k}" ${can ? '' : 'disabled'}>Starter back</button>` : ''}</li>`;
  };
  let pickList = '';
  if (sel) {
    const foe = opp.lineup[across[sel]];
    pickList = `<div class="card subpick"><h4>Sub in at ${sel}${foe ? ` · across from ${esc(P(foe).name)} (${P(foe).types.join('/')})` : ''}</h4>
      ${bench.length ? `<ul>${bench.map((id) => {
        const m = foe ? bestMultiplier(P(id), P(foe)) : 1;
        const lbl = effectLabel(m);
        return `<li><button class="subslot" data-act="subin" data-id="${id}" ${can ? '' : 'disabled'}>${sprite(id, 'xs')}<span class="cn">${esc(P(id).name)}</span><span class="types">${typeChips(P(id).types)}</span>${ovr(P(id).ovr[sel])}
          <span class="en">${Math.round(t.energy[id] ?? 100)}%</span>${lbl ? `<span class="eff ${m > 1 ? 'se' : m === 0 ? 'ne' : 'nve'}">${lbl}</span>` : ''}</button></li>`;
      }).join('')}</ul>` : '<p class="muted small">Nobody on the bench. A 28-round league carries four backups.</p>'}
      <button class="btn tiny" data-act="subcancel">Cancel</button></div>`;
  }
  return `<p class="small muted">Pick a slot, then a bench Pokémon. Your subs stay in until you send the starter back, and the auto-sub leaves those slots alone.${can ? '' : ' Subs wait until the play is over.'}</p>
    ${hurt.length ? `<p class="small"><span class="cond hurt">Injured</span> ${hurt.map((id) => `${esc(P(id).name)} (out ${t.out[id]} weeks)`).join(', ')}. They can't return this game.</p>` : ''}
    <div class="subgrid"><div><h4>Offense</h4><ul class="sublist">${OFF_SLOTS.map(slotRow).join('')}</ul></div>
    <div><h4>Defense</h4><ul class="sublist">${DEF_SLOTS.map(slotRow).join('')}</ul><h4>Special teams</h4><ul class="sublist">${ST_SLOTS.map(slotRow).join('')}</ul></div></div>${pickList}`;
}

function logHtml(g) {
  const rows = g.log.slice(-80).reverse();
  return `<ol class="pbp">${rows.map((e) => {
    const t = g.teams[e.poss];
    const sit = e.down ? `${['', '1st', '2nd', '3rd', '4th'][e.down]} & ${e.spotBefore + e.toGo >= 100 ? 'Goal' : e.toGo}` : '';
    return `<li class="k-${e.kind} ${e.highlight ? `h-${e.highlight}` : ''}"><span class="when">${quarterText(e.q)} ${clockText(e.clock)}</span>
      ${e.down ? `<span class="sit">${teamBadge(t)} ${sit}</span>` : ''}<span class="txt">${esc(e.text).replace('It&#39;s super effective!', '<mark>It&#39;s super effective!</mark>')}</span></li>`;
  }).join('')}</ol>`;
}

export function boxHtml(g) {
  const qs = [0, 1].map((i) => g.qs[i]);
  const nQ = Math.max(4, qs[0].length, qs[1].length);
  const line = `<table class="linescore"><thead><tr><th></th>${Array.from({ length: nQ }, (_, i) => `<th class="num">${i < 4 ? i + 1 : 'OT'}</th>`).join('')}<th class="num">T</th></tr></thead>
    <tbody>${[1, 0].map((i) => `<tr><td>${teamBadge(g.teams[i])}</td>${Array.from({ length: nQ }, (_, q) => `<td class="num">${qs[i][q] ?? 0}</td>`).join('')}<td class="num"><b>${g.score[i]}</b></td></tr>`).join('')}</tbody></table>`;
  const T = (i) => g.teams[i].team;
  const fmtTop = (s) => clockText(s);
  const rowsT = [['First downs', (i) => T(i).fd], ['Total yards', (i) => T(i).yds], ['Passing', (i) => T(i).passYds], ['Rushing', (i) => T(i).rushYds],
    ['Sacks allowed', (i) => T(i).sacks], ['Turnovers', (i) => T(i).to], ['3rd down', (i) => `${T(i).third[1]}/${T(i).third[0]}`],
    ['Penalties', (i) => `${T(i).pen ?? 0}-${T(i).penYds ?? 0}`], ['Possession', (i) => fmtTop(T(i).top)]];
  const team = `<table class="teamstats"><thead><tr><th></th><th class="num">${esc(g.teams[1].abbr)}</th><th class="num">${esc(g.teams[0].abbr)}</th></tr></thead>
    <tbody>${rowsT.map(([l, f]) => `<tr><td>${l}</td><td class="num">${f(1)}</td><td class="num">${f(0)}</td></tr>`).join('')}</tbody></table>`;
  const players = [1, 0].map((i) => {
    const t = g.teams[i];
    const ents = Object.entries(t.stats).map(([id, s]) => ({ id: Number(id), s }));
    const sect = (title, filter, cols) => {
      const rs = ents.filter(({ s }) => filter(s));
      if (!rs.length) return '';
      return `<h4>${title}</h4><table class="pstats"><thead><tr><th></th>${cols.map(([h]) => `<th class="num">${h}</th>`).join('')}</tr></thead>
        <tbody>${rs.map(({ id, s }) => `<tr><td>${sprite(id, 'xs')}${esc(P(id).name)}</td>${cols.map(([, f]) => `<td class="num">${f(s)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    };
    return `<div class="pcol"><h3>${teamBadge(t)} ${esc(t.name)}</h3>
      ${sect('Passing', (s) => s.pa > 0, [['C/ATT', (s) => `${s.pc}/${s.pa}`], ['YDS', (s) => s.py], ['TD', (s) => s.ptd], ['INT', (s) => s.pint], ['SK', (s) => s.sk]])}
      ${sect('Rushing', (s) => s.ra > 0, [['CAR', (s) => s.ra], ['YDS', (s) => s.ry], ['TD', (s) => s.rtd], ['LNG', (s) => s.rlong]])}
      ${sect('Receiving', (s) => s.tg > 0, [['REC', (s) => s.rc], ['TGT', (s) => s.tg], ['YDS', (s) => s.rcy], ['TD', (s) => s.rctd]])}
      ${sect('Defense', (s) => s.tk + s.dsk + s.dint + s.pd > 0, [['TKL', (s) => s.tk], ['SK', (s) => s.dsk], ['INT', (s) => s.dint], ['PD', (s) => s.pd]])}
    </div>`;
  }).join('');
  return `<div class="tablewrap">${line}</div><div class="tablewrap">${team}</div><div class="pgrid">${players}</div>`;
}

function drivesHtml(g) {
  const ds = [...g.drives].reverse();
  if (!ds.length) return '<p class="muted">No completed drives yet.</p>';
  return `<div class="tablewrap"><table class="drives"><thead><tr><th>Team</th><th>Start</th><th class="num">Plays</th><th class="num">Yards</th><th>Result</th></tr></thead>
    <tbody>${ds.map((d) => `<tr><td>${teamBadge(g.teams[d.team])}</td><td>${quarterText(d.q)} ${clockText(d.clock)}</td><td class="num">${d.plays}</td><td class="num">${d.yards}</td><td>${d.result}</td></tr>`).join('')}</tbody></table></div>`;
}

// Animate the ball carrier to the play's end spot, then redraw.
function animatePlay(entry, done) {
  const field = document.getElementById('field');
  if (!field || reduceMotion || !entry || entry.to == null || entry.from == null) { done(); return; }
  const X = (yd) => ((clampN(yd, -9, 109) + 10) / 120) * 100;
  const ball = document.getElementById('football');
  const carrier = entry.carrier != null ? field.querySelector(`[data-pid="${entry.carrier}"]`) : null;
  field.classList.add('running');
  requestAnimationFrame(() => {
    if (ball) ball.style.left = `${X(entry.to)}%`;
    if (carrier) { carrier.classList.add('carrier'); carrier.style.left = `${X(entry.to)}%`; carrier.style.top = '50%'; if (ball) ball.style.top = '50%'; }
  });
  setTimeout(done, 750);
}

export function doCall(call) {
  const g = S.game;
  if (!g || g.final || S.busy || L3.lp) return;
  if (stage && L3.flow !== 'PLAY_SELECTION' && L3.flow != null) return;
  const us = userSide();
  if (twoPlayer()) {
    if (!(g.poss === us ? OFF_PLAYS : DEF_PLAYS)[call]) return;
    twoPlayerCall(g, call); return;
  }
  // A call from the wrong side's sheet (a stale click, a script) is ignored. The try and the
  // kickoff are offense calls for the side that kicks.
  const mine = g.phase === 'penalty' ? (g.pending?.offended === us ? OFF_PLAYS : {}) : g.phase !== 'play' ? (g.poss === us ? OFF_PLAYS : {}) : g.poss === us ? OFF_PLAYS : DEF_PLAYS;
  if (!mine[call] || (g.phase === 'penalty') !== (OFF_PLAYS[call]?.kind === 'penalty')) return;
  if (g.phase === 'penalty') { S.csTab = null; playCall(call, 'base', null, {}); return; }
  // The AI side may stop the clock before the snap.
  if (aiTimeouts(g) != null) flashTimeout(g);
  const off = g.poss === us ? call : aiOffenseCall(g);
  const def = g.poss === us ? aiDefenseCall(g) : call;
  S.coachDown = false;
  S.csTab = null; S.csPage = 0;
  playCall(off, def, g.poss === us ? S.tempo : null, { userSide: us, watch: !!S.watch, autoQB: !!S.watch, autoSnap: S.watch || g.poss !== us ? 1.6 : null,
    formation: g.poss === us ? formFor(off) : aiFormation(off), defFormation: g.poss === us ? aiFront(def) : frontFor(def) });
}

// Run the clock to the snap, then play the call: live on the 3D field for runs, passes and
// kicks, otherwise resolved on the spot. When the clock runs out first, the quarter ends
// instead and the next call is made in the new situation.
function playCall(off, def, tempo, opts) {
  const g = S.game;
  const pace = tempo && tempo !== 'auto' ? tempo : aiTempo(g);
  if (!snapClock(g, pace, off)) {
    if (stage) { if (L3.preview) { L3.spots = worldSpots(L3.preview.lp); L3.preview = null; } afterLivePlay(g.log[g.log.length - 1]); return; }
    save(); render(); autoAdvance();
    return;
  }
  const live = ['run', 'pass'].includes(OFF_PLAYS[off].kind) || liveKick(OFF_PLAYS[off]);
  if (stage && live) { startLive(off, def, { ...opts, hurry: g.phase === 'play' && pace === 'hurry' }); return; }
  S.busy = true;
  if (stage && L3.preview) { L3.spots = worldSpots(L3.preview.lp); L3.preview = null; }
  const entry = runPlay(g, off, def);
  if (stage) { S.busy = false; afterLivePlay(entry); return; }
  animatePlay(entry, () => { S.busy = false; save(); render(); autoAdvance(); });
}

// Two players: the offense's call waits (unseen) for the defense's, then the play lines up
// with player one on the home team and player two on the away team.
function twoPlayerCall(g, call) {
  S.csTab = null; S.csPage = 0;
  if (!S.p2Call) {
    S.p2Call = { off: call, formation: formFor(call) };
    render();
    return;
  }
  const { off, formation } = S.p2Call, def = call;
  S.p2Call = null;
  if (stage && (['run', 'pass'].includes(OFF_PLAYS[off].kind) || liveKick(OFF_PLAYS[off]))) {
    startLive(off, def, { userSide: 0, user2: 1, formation, defFormation: frontFor(def) });
    return;
  }
  S.busy = true;
  if (stage && L3.preview) { L3.spots = worldSpots(L3.preview.lp); L3.preview = null; }
  const entry = runPlay(g, off, def);
  if (stage) { S.busy = false; afterLivePlay(entry); return; }
  animatePlay(entry, () => { S.busy = false; save(); render(); });
}

// The play clock ran out on the call sheet. On offense that is a delay of game (the full play
// clock comes off a running game clock, then 5 yards); otherwise the call that fits is made
// for you, as a coach's default.
export function playClockOut() {
  const g = S.game;
  if (!g || g.final || S.busy || L3.lp) return;
  if (g.phase === 'play' && g.poss === userSide()) {
    if (stage && L3.preview) { L3.spots = worldSpots(L3.preview.lp); L3.preview = null; }
    const e = delayOfGame(g) ?? g.log[g.log.length - 1];
    S.csTab = null;
    if (stage) { afterLivePlay(e); return; }
    save(); render();
    return;
  }
  const { fit } = callSheet(g);
  if (fit) doCall(fit);
}

// Your timeout, from the button or T between plays.
export function userTimeout() {
  const g = S.game;
  if (!g || g.final || S.busy || L3.lp) return;
  if (callTimeout(g, userSide())) { flashTimeout(g); save(); render(); }
}
function flashTimeout(g) {
  if (stage) L3.tickerUntil = performance.now() + 4000;
}

// Auto mode: the AI calls downs until a decision is yours, and plays them out. In either mode
// the other side's own kickoffs and tries are played out on the field the same way.
export function autoAdvance() {
  clearTimeout(timers.auto);
  const g = S.game;
  const kicks = g && (g.phase === 'pat' || g.phase === 'kickoff');
  if (!g || g.final || S.screen !== 'game' || twoPlayer() || !(S.coach || kicks) || needsUser(g) || L3.lp) return;
  timers.auto = setTimeout(() => {
    if (!S.game || S.game.final || S.screen !== 'game' || L3.lp) return;
    if (stage && L3.flow !== 'PLAY_SELECTION') { autoAdvance(); return; }
    aiTimeouts(g);
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    const ours = ['run', 'pass'].includes(OFF_PLAYS[off].kind) || liveKick(OFF_PLAYS[off]);
    if (stage && ours && S.coach) S.coachDown = true;
    else render();
    playCall(off, def, null, { userSide: userSide(), watch: S.coach || !!S.watch, autoQB: true, autoSnap: 1.4, formation: aiFormation(off), defFormation: aiFront(def) });
  }, stage ? 700 : 650);
}

export function startGame(game, meta) {
  applyDifficulty(game, S.difficulty, meta?.userTeamId ?? 0);
  S.game = game; S.gameMeta = meta;
  // Your side's try and kickoff choices wait for your call, and every kickoff and try is played
  // out on the field rather than resolved on the spot.
  const us = game.teams[0].id === (meta?.userTeamId ?? 0) ? 0 : 1;
  game.manual = [us === 0, us === 1]; game.liveKicks = true; S.gameTab = 'log'; S.busy = false; S.subSel = null; S.p2Call = null;
  L3.lp = null; L3.preview = null; L3.spots = null; L3.pclock = 40; L3.rec = null; L3.paused = false;
  if (L3.replay) stopReplay();
  // The first game shows the controls once, and so does the first two-player game.
  if (!S.seenHelp || (meta.twoPlayer && !S.seen2p)) { S.helpOpen = true; if (meta.twoPlayer) S.seen2p = true; }
  setScreen('game');
  autoAdvance();
}
