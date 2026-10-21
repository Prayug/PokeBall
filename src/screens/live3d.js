// The live 3D game: the stage, the play flow state machine, the frame loop, keyboard and touch
// input, the result banner, pause, replay, the controls card and the debug HUD.
import { DEF_PLAYS, OFF_PLAYS, clockText, downText, runLivePlay, spotText } from '../engine.js';
import { DT, createLivePlay, hurry, playSeconds, playState, snap, step as stepLive, swapPads, worldSpots } from '../live.js';
import { measureVersion } from '../body.js';
import { RATES } from '../penalties.js';
import { Stage, webglAvailable } from '../field3d.js';
import { CAMERA_MODES } from '../camera3d.js';
import { render } from '../app.js';
import { S, save, savePrefs, timers } from '../state.js';
import { P, esc } from '../ui.js';
import { sfx } from '../audio.js';
import { POWER_OF, powerLine } from '../powers.js';
import { autoAdvance, doCall, needsUser, playClockOut, setMode, spectating, toggleTakeOver, twoPlayer, userSide, userTimeout } from './game.js';
import { KICK_KEYS, csMove, csTabs, cycleForm, psOptions, quickCalls } from './callsheet.js';
import { SHADES, audibles, cycleShade, flipRun, hotRoute, setDisguise, startMotion } from '../live/presnap.js';
import { REVIEW, aiWantsChallenge, applyDeltas, boothReviews, canChallenge, decideReview, fieldRuling } from '../review.js';
import { FILM, addToReel, clearReel, closeFilm, filmFrame, filmKey, filmReady, openFilm, setReelEntry } from './film.js';
import { boothAfter } from '../broadcast.js';
import { boothAfter as callAfter, boothFlow, boothHush, boothLive, boothReset, boothReview, captionHtml } from './booth.js';
import { afterPlay as broadcastAfter, afterReview as broadcastReview, layersHtml, onCall as broadcastCall, onFlow as broadcastFlow, resetBroadcast } from './broadcast.js';

function keysHelp() {
  return `<div class="keygrid">
    <span><kbd>1</kbd>-<kbd>8</kbd> between plays: call that play on the open page · <kbd>←</kbd> <kbd>→</kbd> turn the page</span>
    <span><kbd>Enter</kbd> between plays: call the play that fits the down · <kbd>R</kbd> call your last call again</span>
    <span><kbd>Space</kbd> after the whistle: skip the result and the walk back to the line</span>
    <span><kbd>C</kbd> change camera (gameplay, tactical, broadcast, player) · <kbd>M</kbd> menu · <kbd>U</kbd> mute · <kbd>Esc</kbd> change the play</span>
    <span><kbd>Space</kbd> snap (hurries everyone to the line), juke with the ball, dive to tackle</span>
    <span><kbd>W A S D</kbd> or arrows: move your player</span>
    <span><kbd>Shift</kbd> sprint</span>
    <span><kbd>1</kbd>-<kbd>5</kbd> throw: tap for touch, hold for a bullet, <kbd>Shift</kbd> + number for a lob</span>
    <span>Hold a direction as you throw to place the ball: up leads him, down brings it back, sideways away from the defender</span>
    <span><kbd>Space</kbd> while the ball is in the air: go up and attack it</span>
    <span><kbd>T</kbd> throw it away</span>
    <span><kbd>E</kbd> truck through a tackler</span>
    <span><kbd>R</kbd> spin move</span>
    <span><kbd>Q</kbd> on defense: switch to the player nearest the ball</span>
    <span>At the line on offense: <kbd>V</kbd> audible, <kbd>B</kbd> hot route (on a run: flip it to the other side), <kbd>N</kbd> motion, then a number to pick</span>
    <span><kbd>B</kbd> on the play sheet or at the line: flip the runs to the other side</span>
    <span>At the line on defense: <kbd>V</kbd> shade the coverage, <kbd>B</kbd> show blitz, <kbd>N</kbd> back out</span>
    <span><kbd>I</kbd> on the play sheet: type edges and their tendencies</span>
    <span><kbd>T</kbd> between plays: call a timeout · the Tempo menu on the call sheet picks no huddle, huddle or bleeding the clock</span>
    <span><kbd>P</kbd> pause during a play · <kbd>Y</kbd> replay the last play · <kbd>?</kbd> this list</span>
    <span><kbd>G</kbd> between plays: challenge the last call (one a half; a lost challenge costs a timeout) · <kbd>J</kbd> the film room</span>
    <span><kbd>O</kbd> in Watch mode: call the next play yourself (press again to hand it back)</span>
    <span>Leave the keys alone and your player runs on autopilot.</span>
  </div>
  <h4>Gamepad</h4>
  <div class="keygrid">
    <span>Left stick or D-pad: move · <kbd>RT</kbd> sprint · <kbd>A</kbd> snap, juke, dive, go up for the ball</span>
    <span><kbd>B</kbd> spin · <kbd>X</kbd> truck · <kbd>Y</kbd> switch defender · right stick click: throw it away</span>
    <span>On a pass, <kbd>A</kbd> <kbd>B</kbd> <kbd>X</kbd> <kbd>Y</kbd> <kbd>RB</kbd> throw to receivers 1-5: tap for touch, hold for a bullet, with <kbd>LB</kbd> held for a lob</span>
    <span><kbd>A</kbd> after the whistle skips to the next call · between plays the D-pad moves between plays and <kbd>A</kbd> calls one · <kbd>LB</kbd> <kbd>RB</kbd> turn the page · <kbd>B</kbd> change the call · <kbd>Start</kbd> pause or menu · <kbd>Back</kbd> camera</span>
  </div>
  <h4>Two players on one screen</h4>
  <div class="keygrid">
    <span>Player 1 (home): <kbd>W A S D</kbd> move · <kbd>Left Shift</kbd> sprint · <kbd>Space</kbd> snap, juke, dive · <kbd>E</kbd> truck · <kbd>R</kbd> spin · <kbd>Q</kbd> switch</span>
    <span>Player 2 (away): arrows move · <kbd>Right Shift</kbd> sprint · <kbd>Enter</kbd> snap, juke, dive · <kbd>L</kbd> truck · <kbd>K</kbd> spin · <kbd>.</kbd> switch</span>
    <span>Whoever has the ball throws with <kbd>1</kbd>-<kbd>5</kbd> and <kbd>T</kbd>. The offense calls its play first, then the defense, and only the offense can snap.</span>
    <span>One gamepad plays for player 2; with two, the first is player 1 and the second player 2.</span>
  </div>`;
}

// ---------- the live 3D game ----------
export const L3 = { lp: null, off: null, def: null, acc: 0, last: 0, deadT: 0, autoSnap: null, keys: new Set(), edges: new Set(), ev: 0, raf: 0, flashT: 0,
  preview: null, spots: null, pclock: 40, pcKey: null, before: null, state: null, flow: null, flowAt: 0, trace: [], resultUntil: 0, resetUntil: 0,
  tickerUntil: 0, scoreFlash: [0, 0], committed: null, hold: 0, banner: null,
  // Player two's keys in a two-player game (the same shape as player one's fields above), and
  // each player's gamepad stick.
  p2in: { keys: new Set(), edges: new Set(), hold: null, lob: null, stick: null, padStick: null }, padStick: null, padAt: 0 };

// Player one is the home team (side 0) in a two-player game; player two the away team.
export function inputFor(ti) { return twoPlayer() && ti === 1 ? L3.p2in : L3; }
export function clearInput(keys = false) {
  for (const src of [L3, L3.p2in]) { src.edges.clear(); if (keys) src.keys.clear(); }
}

// The game flow, one state at a time, each with its own controls, camera and UI:
//   PLAY_SELECTION   the call sheet is up; the teams stand at the new spot
//   FORMATION_SETUP  both teams walk into the called formation (no snap yet)
//   PRE_SNAP         set; the formation check has passed; Space snaps
//   SNAP             the exchange from the center
//   LIVE_PLAY        the play runs; the HUD shows only what the play needs
//   PLAY_RESULT      the whistle: the result is applied to the game (score, down, distance,
//                    possession, clock) and shown over a held camera on the tackle or catch
//   RESET_FORMATION  the players get up and jog to the next spot, the camera eases back
// and then PLAY_SELECTION again. Each change is recorded (tests read the trace), clears any
// key presses that belonged to the previous state, and is handed to the stage for the camera.
function setFlow(st) {
  if (L3.flow === st) return;
  L3.flow = st;
  L3.flowAt = performance.now();
  clearInput();
  if (st !== 'PRE_SNAP' && st !== 'FORMATION_SETUP') L3.snapWant = false;
  const g = S.game;
  L3.trace.push({ state: st, at: Math.round(performance.now()), clock: g?.clock, poss: g?.poss, down: g?.down, toGo: g?.toGo, spot: g?.spot, score: g ? [...g.score] : null });
  if (L3.trace.length > 400) L3.trace.shift();
  stage?.setState?.(st);
  broadcastFlow(st, g, stage, L3.lp);
  boothFlow(st, g, L3.lp);
  const d = document.getElementById('dbg-state');
  if (d) d.textContent = st;
}
// Older name kept for the debug hooks.
const setState = setFlow;
export let stage = null;
let stageWrap = null;
// Hooks for the browser tests (test/browser.mjs, test/film.mjs): read-only views of the game's
// state, the foul rates so a test can force a flag, and the officials' miss rates and the film
// room so one can force a missed call and open the tape.
if (typeof window !== 'undefined') window.__pb = { S, L3, get stage() { return stage; }, setState, doCall, doSnap, setMode, setDebug, RATES, REVIEW, FILM, openFilm };

export function ensureStage() {
  if (stage || !webglAvailable()) return;
  try {
    stage = new Stage();
  } catch (e) { console.error("stage", e); stage = null; return; }
  stage.setCameraMode(S.cam);
  stage.setWeatherFx(S.weatherFx);
  stage.rig.setCalibration(S.cal);
  stage.debug = S.debug; stage.showNames = S.names; stage.showPips = !!S.pips;
  if (S.quality !== 'auto') stage.setQuality(S.quality);
  stageWrap = document.createElement('div');
  stageWrap.className = 'stagewrap';
  stageWrap.innerHTML = `<div class="hud"><div class="hud-call" id="hud-call"></div><div class="hud-flash" id="hud-flash"></div><div class="hud-tip" id="hud-tip"></div></div>
    <div class="lower3" id="lower3" aria-live="polite"></div>${captionHtml()}
    ${layersHtml()}
    <div class="ov-badge" id="replay-badge" hidden>Replay</div>
    <div class="hud-acts"><button class="hud-replay" id="chal-btn" data-act="challenge" hidden>Challenge <kbd>G</kbd></button>
      <button class="hud-replay" id="film-btn" data-act="film" hidden>Film room <kbd>J</kbd></button>
      <button class="hud-replay" id="replay-btn" data-act="replay" hidden>Replay <kbd>Y</kbd></button></div>
    <div class="ov-pause" id="pause-ov" hidden><div><b>Paused</b><span>Press <kbd>P</kbd> or <kbd>Esc</kbd> to resume</span><button class="btn" data-act="resume">Resume</button></div></div>
    <div class="ov-help" id="help-ov" hidden><div class="card"><h3>Controls</h3>${keysHelp()}<button class="btn primary" data-act="helpok">Got it</button></div></div>
    <div class="dbg-hud" id="dbg-hud"></div>
    <div class="touch" id="touch" data-mode="idle" aria-hidden="true"><div class="tleft"><button data-key="ShiftLeft" class="t-sprint">Sprint</button><div class="stick" id="stick"><span></span></div></div>
      <div class="tbtns"><span class="trow t-pass"><button data-touch="lob" class="t-lob">Lob</button><button data-key="KeyT">Away</button></span>
      <span class="trow t-pass">${[1, 2, 3, 4, 5].map((n) => `<button data-key="Digit${n}">${n}</button>`).join('')}</span>
      <span class="trow t-run"><button data-key="KeyE">Truck</button><button data-key="KeyR">Spin</button><button data-key="KeyQ">Switch</button></span>
      <button data-key="Space" class="t-main">Snap / Juke / Dive</button></div></div>
    <div class="touch-top" id="touch-top" aria-hidden="true"><button data-touch="pause" class="t-live">Pause</button><button data-touch="camera">Camera</button></div>`;
  stageWrap.prepend(stage.el);
  bindTouch(stageWrap);
  if (!L3.raf) L3.raf = requestAnimationFrame(loop);
}

export function mountStage() {
  const slot = document.getElementById('stage-slot');
  if (!slot || !stageWrap) return;
  slot.prepend(stageWrap);
  fitStage();
  stage.resize();
  // A re-render during the replay (or in the film room) keeps showing it, not the next play lining up.
  if (FILM.open && FILM.lp) stage.setPlay(FILM.lp);
  else if (L3.replay) stage.setPlay(L3.replay.lp);
  else if (!L3.lp) showPreview();
}

// The 3D game fills the viewport under the sticky top bar.
export function fitStage() {
  const top = document.querySelector('.top')?.offsetHeight ?? 0;
  document.documentElement.style.setProperty('--top-h', `${top}px`);
  fitDock();
}

// Keep the line of scrimmage clear of the call sheet: the view shifts up by part of it.
function fitDock() {
  const sheet = FILM.open ? FILM.el : document.querySelector('.game.g3d .callsheet:not(.folded)');
  stage?.setInset(sheet ? sheet.offsetHeight + 10 : 0);
}

// Between plays, both teams get up and jog from where the last play ended to the new spot.
function showPreview() {
  const g = S.game;
  if (!g || !stage) return;
  const us = userSide();
  const key = `${g.playNo}:${g.poss}:${g.spot}:${g.final}`;
  if (L3.preview?.key === key && L3.preview.g === g) { stage.setPlay(L3.preview.lp); return; }
  const saved = g.rng;
  const first = !L3.preview && !L3.spots;
  const lp = createLivePlay(g, g.poss === us ? 'slant' : 'inside_run', 'base', { userSide: us, from: L3.spots ?? undefined });
  g.rng = saved;
  lp.control = null; lp.preview = true;
  L3.preview = { key, lp, g, mv: measureVersion };
  L3.spots = null;
  stage.setPlay(lp);
  if (first) stage.snapCamera();
}

export function startLive(off, def, opts) {
  const g = S.game;
  // Line up from wherever the players are standing in the preview.
  const from = L3.preview?.lp ? worldSpots(L3.preview.lp) : L3.spots ?? undefined;
  markBefore();
  if (FILM.open) closeFilm();
  if (L3.replay) stopReplay();
  broadcastCall(stage);
  // The replay recording: the game as it was before the play (its random seed included) and
  // every simulation step's input, so the play can be run again exactly, step for step.
  // Officials on the field: fouls are called as the contact happens (see penalties.js).
  const o = { flags: true, ...opts, from };
  L3.rec = { g: structuredClone(g), off, def, opts: o, log: [], done: false };
  L3.lp = createLivePlay(g, off, def, o);
  // No huddle: everyone sprints straight to the line.
  if (opts.hurry) hurry(L3.lp);
  L3.paused = false;
  L3.off = off; L3.def = def; L3.acc = 0; L3.deadT = 0; L3.ev = 0; L3.committed = null;
  L3.autoSnap = opts.autoSnap ?? null;
  L3.pclock = Math.max(L3.pclock, 10);
  L3.edges.clear(); L3.hold = null; L3.lob = null;
  S.menuOpen = false; S.psPick = null;
  hideBanner();
  stage.setPlay(L3.lp);
  setFlow(L3.lp.set ? 'PRE_SNAP' : 'FORMATION_SETUP');
  render();
}

// The game as it stands before a call: what the result card, the score flash and the broadcast
// compare the result with.
export function markBefore() {
  const g = S.game;
  if (g) L3.before = { poss: g.poss, down: g.down, toGo: g.toGo, spot: g.spot, score: [...g.score], quarter: g.quarter, logN: g.log.length, drives: g.drives.length };
}

export function doSnap() {
  const lp = L3.lp;
  if (!lp || lp.phase !== 'pre') return;
  L3.rec?.log.push({ snap: true, control: lp.control ? [lp.control.side, lp.control.slot] : null });
  // The play as it stands at the snap. Lining up depends on the measured model footprints, which
  // change as models finish loading, so the replay starts from this copy rather than lining up again.
  if (L3.rec) try { L3.rec.atSnap = structuredClone(lp); L3.rec.atSnap.g.log = []; L3.rec.atSnap.g.drives = []; } catch { L3.rec.atSnap = null; }
  // The snap ends the last play's challenge window.
  if (L3.review) L3.review.done = true;
  snap(lp);
  L3.autoSnap = null;
  S.psPick = null;
  render();
}

// ---------- pre-snap adjustments ----------
// Audible: the same formation and the same defense, a new call; the players stay where they stand.
function audible(call) {
  const lp = L3.lp;
  if (!lp || lp.phase !== 'pre' || !audibles(lp, call).includes(call)) return;
  const { from, ...opts } = L3.rec?.opts ?? { userSide: lp.user };
  void from;
  L3.spots = worldSpots(lp); L3.preview = null; L3.lp = null;
  startLive(call, L3.def, { ...opts, formation: lp.formation, defFormation: lp.defFormation });
  flash(`Audible: ${OFF_PLAYS[call].name}`);
}
// One adjustment from the buttons or the keys: open a picker (audible, hot route, motion), take
// a choice from it, or change the defense's look.
export function presnapAct(act, arg) {
  const lp = L3.lp;
  if (!lp || lp.phase !== 'pre' || S.coachDown || lp.user == null) return;
  if (!lp.set && act !== 'open') { flash('Wait until everyone is set', 'muted'); return; }
  const mine = lp.user === lp.o;
  let ok = true, msg = '';
  switch (act) {
    case 'open': if (mine) S.psPick = S.psPick?.kind === arg ? null : { kind: arg }; break;
    case 'aud': S.psPick = null; audible(arg); return;
    case 'hotpick': S.psPick = { kind: 'hot', slot: arg }; break;
    case 'hot': ok = hotRoute(lp, S.psPick?.slot, arg); msg = `Hot route: ${S.psPick?.slot} ${arg}`; S.psPick = null; break;
    case 'motion': ok = startMotion(lp, arg); msg = `${arg} in motion`; S.psPick = null; break;
    case 'flip': ok = flipRun(lp); msg = `Flipped: running ${lp.runSide > 0 ? 'right' : 'left'}`; S.psPick = null; break;
    case 'shade': ok = cycleShade(lp); msg = `Shade: ${SHADES.find(([k]) => k === (lp.shade ?? null))[1]}`; break;
    case 'show': ok = setDisguise(lp, 'show'); msg = lp.disguise === 'show' ? 'Showing blitz' : 'Blitz look off'; break;
    case 'back': ok = setDisguise(lp, 'back'); msg = lp.disguise === 'back' ? 'Backed out' : 'Blitz look back'; break;
    default: return;
  }
  if (msg) flash(ok ? msg : 'Not on this play', ok ? '' : 'muted');
  stage?.drawArt?.();
  render();
}
// The keys at the line: V, B (hot route, or flip on a run) and N, and a number for the open picker.
function presnapKey(code) {
  const lp = L3.lp;
  const mine = lp.user === lp.o;
  const keys = { KeyV: mine ? ['open', 'audible'] : ['shade'], KeyB: mine ? (lp.kind === 'run' ? ['flip'] : ['open', 'hot']) : ['show'], KeyN: mine ? ['open', 'motion'] : ['back'] };
  if (keys[code]) { presnapAct(...keys[code]); return true; }
  const n = /^Digit([1-9])$/.exec(code);
  if (n && S.psPick) {
    const o = psOptions(lp)[Number(n[1]) - 1];
    if (o && !o.off) presnapAct(o.act, o.arg);
    return true;
  }
  return false;
}

// The whistle has blown: the game takes the result now (score, down and distance, possession,
// the clock), while the field holds on the play for a beat.
//
// What goes on the books is the officials' call (see review.js): on a bang-bang spot, goal line
// or fumble it can differ from what really happened. A copy of the game from before it is kept
// for a challenge or the booth to put right.
function commitPlay() {
  const lp = L3.lp, g = S.game, b = L3.before;
  const R = fieldRuling(lp);
  const r = lp.result;
  const reviewable = !!R || (!lp.kick && g.phase === 'play' && !r?.noPlay && !r?.fouls?.length && ['run', 'pass', 'sack'].includes(r?.kind));
  if (R?.wrong) applyDeltas(g, R.deltas, 1);
  const pre = reviewable ? structuredClone(g) : null;
  const secs = playSeconds(lp);
  const entry = runLivePlay(g, L3.off, L3.def, R ? R.call : r, secs);
  L3.committed = entry;
  L3.review = pre ? { ruling: R, pre, playNo: g.playNo, booth: boothReviews(R, pre), done: false, off: L3.off, def: L3.def, secs, before: b, rec: L3.rec } : null;
  if (L3.rec) { L3.rec.done = true; L3.rec.end = endKey(lp); addToReel(L3.rec, L3.rec.g, entry); }
  const big = entry.highlight === 'td' || entry.kind === 'score' || entry.turnover || entry.kind === 'turnover';
  L3.hold = lp.end?.how === 'td' ? 3.2 : big ? 2.6 : lp.end?.how === 'incomplete' ? 1.6 : 2.0;
  L3.tickerUntil = performance.now() + 6500;
  if (b) for (const i of [0, 1]) if (g.score[i] !== b.score[i]) L3.scoreFlash[i] = performance.now() + 2200;
  L3.pclock = 40;
  save();
  render();
  showBanner(resultBanner(entry, lp, b));
  powerFlash(entry, broadcastAfter(g, b, stage));
  callAfter(g, entry, b, lp);
}

// A power switching on is called out over the field as well as on the result card; after the
// broadcast's stinger (`wait` ms) when one is wiping across the middle of the screen.
function powerFlash(entry, wait = 0) {
  const on = (entry?.powers ?? []).find((c) => c.on);
  if (!on) return;
  if (wait) { clearTimeout(timers.power); timers.power = setTimeout(() => powerFlash(entry), wait); return; }
  flash(`${P(on.id).name}: ${POWER_OF[on.id].name}!`, 'power');
  L3.flashT = performance.now() + 2600;
  sfx('power');
}

// The result hold is over: the players get up and walk to the next spot.
function endResult() {
  const lp = L3.lp;
  L3.lp = null;
  L3.spots = worldSpots(lp);
  L3.preview = null;
  L3.before = null;
  L3.committed = null;
  L3.resetUntil = performance.now() + 1300;
  S.coachDown = false;
  hideBanner(1200);
  setFlow('RESET_FORMATION');
  render();
  if (autoReview()) return;
  autoAdvance();
}

// For plays resolved without the live field (punts, field goals): the same result beat.
export function afterLivePlay(entry) {
  const g = S.game, b = L3.before;
  L3.rec = null; L3.review = null;
  L3.before = null;
  L3.pclock = 40;
  const now = performance.now();
  if (stage && entry) { L3.resultUntil = now + 1800; setFlow('PLAY_RESULT'); }
  L3.tickerUntil = now + 6500;
  if (b) for (const i of [0, 1]) if (g.score[i] !== b.score[i]) L3.scoreFlash[i] = now + 2200;
  save();
  render();
  if (!entry || !g) { autoAdvance(); return; }
  // No live play follows to clear it, so the card leaves once the result beat is over.
  if (stage) { showBanner(resultBanner(entry, null, b)); hideBanner(3000); powerFlash(entry, broadcastAfter(g, b, stage)); callAfter(g, entry, b, null); }
  autoAdvance();
}

// A new game: nothing from the last one (its result card, result and reset beats, held keys)
// carries over onto the first call sheet.
export function resetBetweenGames() {
  L3.lp = null; L3.preview = null; L3.spots = null; L3.rec = null; L3.before = null; L3.committed = null; L3.review = null;
  clearReel();
  L3.pclock = 40; L3.paused = false; L3.resultUntil = 0; L3.resetUntil = 0; L3.tickerUntil = 0; L3.scoreFlash = [0, 0];
  L3.deadT = 0; L3.hold = 0; L3.lob = null; L3.snapWant = false; L3.autoSnap = null; L3.keys.clear(); L3.edges.clear();
  if (L3.replay) stopReplay();
  hideBanner();
  resetBroadcast();
  boothReset(S.game);
  clearTimeout(timers.power);
  L3.flow = null;
  if (stage) setFlow('PLAY_SELECTION');
}

// The broadcast lower third after the whistle: what happened, the yards, who did it, the next
// down, and anything a Pokémon's type or ability changed. Built from the game's own record.
function resultBanner(e, lp, before) {
  const g = S.game;
  if (!e || !g) return null;
  const b = before ?? { poss: g.poss, down: 1 };
  const how = lp?.end?.how;
  const yd = e.yards ?? 0;
  const kickKind = lp?.kick ? lp.kind : ['punt', 'fg'].includes(OFF_PLAYS[e.off]?.kind) && !OFF_PLAYS[e.off]?.fake ? OFF_PLAYS[e.off].kind : null;
  const yds = how === 'incomplete' || e.kind === 'punt' || e.kind === 'fg' || kickKind || e.head || e.conversion ? '' : yd === 0 ? 'No gain' : `${yd > 0 ? '+' : '−'}${Math.abs(yd)} yd${Math.abs(yd) === 1 ? '' : 's'}`;
  const changed = g.poss !== b.poss && !g.final;
  let head = '', tone = '';
  const td = e.highlight === 'td' || (e.kind === 'score' && before && g.score.some((v, i) => v - before.score[i] >= 6));
  if (td) { head = 'Touchdown'; tone = 'td'; }
  else if (e.kind === 'score') { head = /safety/i.test(e.text) ? 'Safety' : 'Field goal'; tone = 'td'; }
  else if (e.turnover === 'int' || /INTERCEPT/i.test(e.text)) { head = 'Interception'; tone = 'to'; }
  else if (e.turnover === 'fumble' || /FUMBLE!/.test(e.text) && changed) { head = 'Fumble'; tone = 'to'; }
  else if (changed && ['run', 'pass', 'sack'].includes(e.kind)) { head = 'Turnover on downs'; tone = 'to'; }
  else if (kickKind === 'punt') head = how === 'blocked' ? 'Blocked punt' : 'Punt';
  else if (kickKind === 'fg') { head = how === 'blocked' ? 'Blocked field goal' : 'Field goal no good'; tone = 'to'; }
  else if (e.kind === 'punt') head = 'Punt';
  else if (e.kind === 'fg') { head = 'Field goal no good'; tone = 'to'; }
  else if (how === 'incomplete') { head = 'Incomplete'; tone = 'muted'; }
  else if (e.kind === 'sack' || how === 'sack') { head = 'Sack'; tone = 'to'; }
  else if (!changed && g.down === 1 && b.down >= 1 && yd > 0) { head = 'First down'; tone = 'big'; }
  else if (how === 'out') head = 'Out of bounds';
  else head = yd < 0 ? 'Loss' : 'Tackle';
  // The engine names some results itself: the try, kickoffs, the clock (quarter ends, the
  // two-minute warning, timeouts).
  if (e.head) {
    head = e.head;
    tone = e.highlight === 'miss' ? 'to' : e.kind === 'score' ? 'td' : e.highlight === 'turnover' ? 'to' : e.kind === 'quarter' || e.kind === 'info' || e.kind === 'timeout' ? 'muted' : e.highlight === 'flag' ? 'flag' : '';
  }
  // Why it happened, when a Pokémon's type, ability or size, or the weather, decided part of the play.
  // Powers: a Pokémon zoning in or losing its power on this play leads; then what a power,
  // type, ability, size or the weather decided.
  const changes = (e.powers ?? []).map((c) => ({ kind: c.on ? 'power' : 'powerOff', text: powerLine(c) }));
  const notes = [...changes, ...(lp?.notes ?? []).filter((n) => ['power', 'type', 'ability', 'size', 'weather'].includes(n.kind)).map((n) => ({ kind: n.kind, text: n.text }))].slice(0, 3);
  const next = g.final ? 'Final' : g.phase === 'penalty' ? 'Accept or decline the penalty' : `${changed ? `${g.teams[g.poss].abbr} ball · ` : ''}${downText(g)} at ${spotText(g)}`;
  const clock = !g.final && g.phase === 'play' && !changed && !td && e.down ? (g.clockRunning ? '' : 'Clock stopped') : '';
  const booth = boothAfter(g, e, before, lp?.notes ?? []);
  return { head, tone, yds, text: e.text.replace(/ It's super effective!/, ''), next, notes, clock, possession: changed, booth };
}
function showBanner(B) {
  const el = document.getElementById('lower3');
  if (!el || !B) return;
  clearTimeout(timers.banner);
  L3.banner = B;
  el.className = `lower3 on ${B.tone}${B.possession ? ' poss' : ''}`;
  el.innerHTML = `<div class="l3-head"><b>${esc(B.head)}</b>${B.yds ? `<span class="l3-yds">${esc(B.yds)}</span>` : ''}${B.clock ? `<span class="l3-clock">${B.clock}</span>` : ''}</div>
    <p class="l3-text">${esc(B.text)}</p>${B.notes.map((n) => `<p class="l3-note"><span class="l3-tag ${n.kind}">${{ type: 'Type', ability: 'Ability', size: 'Size', weather: 'Weather', power: 'Power', powerOff: 'Power lost' }[n.kind] ?? ''}</span>${esc(n.text)}</p>`).join('')}${B.booth ? `<p class="l3-booth"><span class="l3-mic" aria-hidden="true"></span>${esc(B.booth)}</p>` : ''}<p class="l3-next">${esc(B.next)}</p>`;
}
function hideBanner(after = 0) {
  clearTimeout(timers.banner);
  const go = () => { const el = document.getElementById('lower3'); if (el) el.className = 'lower3'; L3.banner = null; };
  if (after) timers.banner = setTimeout(go, after); else go();
}

function flash(text, tone = '') {
  const el = document.getElementById('hud-flash');
  if (!el || !text) return;
  el.textContent = text;
  el.className = `hud-flash on ${tone}`;
  L3.flashT = performance.now() + 1200;
}

// One player's input for a step: from L3 (player one) or L3.p2in (player two).
function readInput(lp, src = L3) {
  const k = src.keys, e = src.edges;
  const up = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) + (src.stick?.up ?? 0) + (src.padStick?.up ?? 0);
  const right = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) + (src.stick?.right ?? 0) + (src.padStick?.right ?? 0);
  const m = stage.toPlayFrame(up, right);
  // Throws: tap a receiver's number for a touch pass, hold it for a bullet, Shift with it for a
  // lob. The stick at release places the ball.
  const shift = k.has('ShiftLeft') || k.has('ShiftRight');
  const pressed = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].find((d) => e.has(d));
  let throwKey = null, throwType = null;
  if (pressed) {
    if (shift || src.lob === pressed) { throwKey = pressed; throwType = 'lob'; src.hold = null; src.lob = null; }
    else src.hold = { key: pressed, t0: performance.now() };
  }
  if (src.hold && !throwKey) {
    const held = performance.now() - src.hold.t0;
    if (!k.has(src.hold.key)) { throwKey = src.hold.key; throwType = 'touch'; src.hold = null; }
    else if (held >= 220) { throwKey = src.hold.key; throwType = 'bullet'; src.hold = null; }
  }
  const inp = {
    mx: m.mx, my: m.my, sprint: shift && !throwKey,
    juke: e.has('Space'), dive: e.has('Space'), truck: e.has('KeyE'), spin: e.has('KeyR'),
    throwTo: throwKey ? ['WR1', 'WR2', 'WR3', 'TE', 'RB'][Number(throwKey.slice(5)) - 1] : null, throwType,
    throwAway: e.has('KeyT'), switchTo: e.has('KeyQ') || e.has('Tab') ? 'ball' : null,
  };
  e.clear();
  return inp;
}

// The one line of controls for the moment, at the bottom of the screen (a line per player in a
// two-player game, each with that player's own keys or gamepad buttons).
const KEY_NAMES = {
  p1: { Arrows: 'WASD', arrows: 'WASD', Shift: 'Left Shift' },
  p2: { Space: 'Enter', Shift: 'Right Shift', Q: '.', R: 'K', E: 'L' },
  pad: { Space: 'A', Arrows: 'Stick', arrows: 'stick', Shift: 'RT', Q: 'Y', R: 'B', E: 'X', T: 'RS', '1-5': 'A B X Y RB', Esc: 'B' },
};
// A lob is either Shift on the keyboard (LB on a pad); only the sprint has a side.
const renameKeys = (t, names) => t.replace(/\b(Space|Esc|Shift|Arrows|arrows|Q|R|E|T|1-5)\b( lob)?/g, (m, k, lob) => (lob ? (names === KEY_NAMES.pad ? 'LB lob' : m) : names[k] ?? k));
function tipText(lp) {
  if (!twoPlayer() || !lp?.p2) {
    const t = hudTip(lp);
    return padRecent(0) ? renameKeys(t, KEY_NAMES.pad) : t;
  }
  const g = S.game, line = (n, t) => (t ? `P${n + 1} ${g.teams[n].abbr} · ${renameKeys(t, padRecent(n) ? KEY_NAMES.pad : KEY_NAMES[`p${n + 1}`])}` : '');
  const t1 = hudTip(lp);
  swapPads(lp);
  let t2;
  try { t2 = hudTip(lp); } finally { swapPads(lp); }
  return [line(0, t1), line(1, t2)].filter(Boolean).join('\n');
}
// Has this player used a gamepad in the last few seconds (its buttons go in the tips)?
function padRecent(n) { return performance.now() - ((n === 0 ? L3 : L3.p2in).padAt ?? 0) < 8000; }
function hudTip(lp) {
  const f = L3.flow;
  if (!lp) {
    if (!(f === 'PLAY_SELECTION' && S.game && !S.game.final && needsUser(S.game) && !S.busy)) return '';
    if (twoPlayer()) { const s = userSide(); return `Player ${s + 1} (${S.game.teams[s].abbr}): ${S.game.phase === 'penalty' ? 'accept or decline the penalty' : `call your ${S.game.poss === s ? 'offense' : 'defense'}`} · number keys · ← → categories`; }
    return padRecent(0) ? 'Pick a play · D-pad and A · LB RB categories' : 'Pick a play · number keys · Enter the play that fits · ← → categories';
  }
  const c = lp.control;
  // Two players: the defense waits for the offense to snap.
  if (lp.p2 && lp.phase === 'pre' && lp.user === lp.d) return lp.kick ? (c && c === lp.kick.returner ? 'You are back to return it' : '') : 'Q pick a defender · the offense snaps';
  if (f === 'FORMATION_SETUP') return 'Lining up…';
  if (lp.kick) {
    if (lp.phase === 'pre') return lp.user === lp.o ? `Space ${lp.kick.ko ? 'kick off' : 'snap'} · the kick goes on its own · Esc change call` : lp.kick.returner && c === lp.kick.returner ? 'Space start · you are back to return it' : 'Space start';
    if (lp.phase === 'dead') return '';
    if (c && c === lp.kick.returner && !c.carrier) return 'Get under it · arrows move · Shift sprint';
    if (c && !c.carrier && c.side === 'off') return 'Cover the kick · arrows move · Shift sprint · Space dive';
    if (!c) return lp.kick.kickedAt != null ? 'Kick away' : lp.kick.ko ? 'The kicker runs up…' : 'The long snap…';
  }
  if (lp.phase === 'pre') {
    if (!c) return 'Coach mode · Space to snap now · Esc to change the call';
    return lp.user === lp.o ? `Space snap${lp.kind === 'pass' ? ' · then 1-5 throw' : ''} · V audible · B hot route · N motion · Esc change call` : 'Space start · Q pick a defender · V shade · B show blitz · N back out';
  }
  if (lp.phase === 'dead') return '';
  if (!c) return 'Watching the AI run your call';
  if (c.side === 'off' && c.slot === 'QB' && lp.kind === 'pass' && !lp.thrown && !lp.windup && lp.qbState !== 'run') return '1-5 tap touch · hold bullet · Shift lob · arrows place the ball · T away';
  if (lp.thrown && lp.ball.state === 'air' && lp.thrown.target === c) return 'Ball in the air · arrows adjust · Space go up for it';
  if (c.carrier) return 'Arrows run · Shift sprint · Space juke · R spin · E truck';
  if (c.side === 'def') return 'Arrows move · Shift sprint · Space dive/tackle · Q switch to the ball';
  return 'Arrows move · Shift sprint';
}

function flowNow(now) {
  const lp = L3.lp;
  if (lp) {
    if (lp.phase === 'pre') return lp.set ? 'PRE_SNAP' : 'FORMATION_SETUP';
    if (lp.phase === 'dead') return 'PLAY_RESULT';
    return playState(lp) === 'SNAP' ? 'SNAP' : 'LIVE_PLAY';
  }
  if (L3.resultUntil > now) return 'PLAY_RESULT';
  if (L3.resetUntil > now && !(L3.preview?.lp?.set)) return 'RESET_FORMATION';
  return 'PLAY_SELECTION';
}

function loop(now) {
  L3.raf = requestAnimationFrame(loop);
  if (!stage || S.screen !== 'game' || !document.getElementById('stage-slot')) { L3.last = now; return; }
  const dt = Math.min(0.1, (now - (L3.last || now)) / 1000);
  L3.last = now;
  const lp = L3.lp;
  const g = S.game;
  let sim = null;
  const hold = isPaused();
  if (lp && hold) {
    // Paused: the play stands still (the clocks with it) until it is resumed.
    sim = lp;
    L3.acc = 0;
  } else if (lp) {
    sim = lp;
    if (lp.phase === 'pre') {
      // Fixed-step the walk to the line, like the live play.
      L3.acc += dt;
      while (L3.acc >= DT) { stepLive(lp, null); L3.rec?.log.push(null); L3.acc -= DT; }
      if (lp.phase !== 'pre') render();
      // Snap only once set, and only on a press made in this state (no carried-over keys).
      // A press while the line is still settling is kept and snaps the moment it is set.
      const ready = lp.set && now - L3.flowAt > 250;
      // Two players: only the offense snaps, and the defense picks its man with its own key.
      const offIn = lp.p2 ? inputFor(lp.o) : L3, defIn = lp.p2 ? inputFor(lp.d) : L3;
      if (offIn.edges.has('Space')) { L3.snapWant = true; if (!lp.set) hurry(lp); }
      if (L3.snapWant && ready) { clearInput(); L3.snapWant = false; doSnap(); }
      else if (defIn.edges.has('KeyQ') || defIn.edges.has('Tab')) {
        clearInput();
        const pad = lp.user === lp.d ? lp : lp.p2?.user === lp.d ? lp.p2 : null;
        if (pad?.control) {
          const order = ['MLB', 'OLB', 'SS', 'FS', 'CB1', 'CB2', 'CB3', 'LE', 'DE', 'DT1', 'DT2'].map((k) => lp.def[k]).filter(Boolean);
          pad.control = order[(order.indexOf(pad.control) + 1) % order.length];
        }
      } else clearInput();
      if (L3.autoSnap != null && lp.set) { L3.autoSnap -= dt; if (L3.autoSnap <= 0) doSnap(); }
      // Play clock: when it runs out on a lined-up play, the ball is snapped.
      if (lp.set && L3.autoSnap == null) { L3.pclock = Math.max(0, L3.pclock - dt); if (L3.pclock <= 0) doSnap(); }
    } else {
      L3.acc += dt;
      while (L3.acc >= DT) {
        const inp = lp.phase === 'live' ? readInput(lp) : null;
        if (inp && lp.p2) inp.p2 = readInput(lp, L3.p2in);
        stepLive(lp, inp);
        L3.rec?.log.push(inp);
        L3.acc -= DT;
      }
      boothLive(lp);
      if (lp.phase === 'dead') {
        if (!L3.committed) commitPlay();
        L3.deadT += dt;
        if (L3.deadT > L3.hold) { endResult(); sim = null; }
      }
    }
  } else if (L3.resultUntil > now) {
    // A kick or field goal result: hold the field for a beat.
    L3.acc = 0;
  } else if (FILM.open) {
    // The film room plays its own tape (see screens/film.js).
    const f = filmFrame(dt);
    sim = f.lp;
    L3.acc = f.alpha * DT;
  } else if (L3.replay) {
    // The replay: the recorded steps again, at half speed, from the broadcast camera.
    const R = L3.replay, log = R.rec.log;
    sim = R.lp;
    R.acc += dt * 0.5;
    while (R.acc >= DT && R.i < log.length) { stepLive(R.lp, log[R.i++]); R.acc -= DT; }
    if (R.i >= log.length) {
      R.end = (R.end ?? 0) + dt;
      // The tests check the replay ends exactly where the play did.
      if (R.end > 1.6) { L3.lastReplay = { end: endKey(R.lp), want: R.rec.end }; stopReplay(); sim = null; }
    }
    L3.acc = R.acc;
  } else if (L3.preview?.lp) {
    if (L3.resultUntil) { L3.resultUntil = 0; render(); }
    // Between plays: the teams get up and walk to the new spot.
    const pv = L3.preview.lp;
    sim = pv;
    L3.acc += dt;
    while (L3.acc >= DT) { stepLive(pv, null); L3.acc -= DT; }
    if (L3.resetUntil && (pv.set || now > L3.resetUntil)) { L3.resetUntil = 0; render(); }
    // Models that finished loading report their real size: line the preview up again by it
    // (they walk the last steps over), so the spacing is by what is actually drawn.
    if (L3.preview.mv !== measureVersion && L3.flow === 'PLAY_SELECTION' && now - (L3.preview.rebuilt ?? 0) > 1500) {
      const spots = worldSpots(pv), mv = measureVersion;
      L3.preview = null; L3.spots = spots;
      showPreview();
      if (L3.preview) { L3.preview.mv = mv; L3.preview.rebuilt = now; }
    }
    // The play clock runs while the call is yours; at :00 it is a delay of game on offense, or
    // the fitting call is made for you (see playClockOut).
    if (g && !g.final && needsUser(g) && !S.busy && !S.helpOpen && !S.menuOpen && !L3.replay && !FILM.open && L3.flow === 'PLAY_SELECTION') {
      L3.pclock = Math.max(0, L3.pclock - dt);
      if (L3.pclock <= 0) { L3.pclock = 40; playClockOut(); }
    }
  }
  // A replay or the film room has the field: the booth lets the tape run without calling it.
  if (FILM.open || L3.replay) { if (!L3.hushed) { L3.hushed = true; boothHush(); } } else L3.hushed = false;
  if (g && !g.final) setFlow(flowNow(now));
  // The game clock runs during the play and stops on the whistle.
  const gc = document.getElementById('gclock');
  if (gc && g && !g.final) {
    const live = L3.lp && L3.lp.phase === 'live' ? L3.lp.t : 0;
    const txt = clockText(Math.max(0, Math.round(g.clock - live)));
    if (gc.textContent !== txt) gc.textContent = txt;
  }
  const tk = document.getElementById('ticker');
  if (tk && now > L3.tickerUntil && !tk.classList.contains('gone')) tk.classList.add('gone');
  const pc = document.getElementById('pclock');
  if (pc) {
    const txt = `:${String(Math.min(40, Math.ceil(L3.pclock))).padStart(2, "0")}`;
    if (pc.textContent !== txt) { pc.textContent = txt; pc.classList.toggle('low', L3.pclock <= 5); }
  }
  const tip = document.getElementById('hud-tip');
  const t = tipText(L3.lp);
  if (tip && tip.textContent !== t) tip.textContent = t;
  const pad = document.getElementById('touch'), mode = touchMode(L3.lp);
  if (pad && pad.dataset.mode !== mode) { pad.dataset.mode = mode; if (mode !== 'pass') pad.classList.remove('lob'); }
  const call = document.getElementById('hud-call');
  const ct = L3.lp && L3.lp.phase === 'live' && !L3.lp.p2 ? `${OFF_PLAYS[L3.off].name} vs ${DEF_PLAYS[L3.def].name}` : '';
  if (call && call.textContent !== ct) call.textContent = ct;
  if (L3.flashT && now > L3.flashT) { L3.flashT = 0; const f = document.getElementById('hud-flash'); if (f) f.className = 'hud-flash'; }
  syncOverlays();
  stage.frame(now, sim && sim.phase !== undefined && !hold ? Math.min(1, L3.acc / DT) : 1);
  if (S.debug) debugHud();
}

// ---------- pause, replay and the controls card ----------
function endKey(lp) { return `${lp.end?.how ?? lp.phase}@${(lp.spotX ?? lp.ball.x).toFixed(2)},${lp.ball.y.toFixed(2)}`; }
function isPaused() { return !!L3.lp && L3.lp.phase !== 'dead' && (L3.paused || S.helpOpen || (S.menuOpen && L3.lp.phase === 'live')); }
export function togglePause() {
  if (!L3.lp || L3.lp.phase === 'dead') return;
  L3.paused = !L3.paused;
  clearInput(true);
}
export function replayReady(r = L3.rec) { return !!(stage && r?.done && !L3.lp && !L3.replay && !FILM.open && r.log.some((e) => e?.snap)); }
// review ({ by, rec }): the replay is a review of the call (see startReview); it ends with the
// verdict. It runs the reviewed play's recording (a play lined up and taken back has its own).
export function startReplay(review = null) {
  const r = review?.rec ?? L3.rec;
  if (!replayReady(r)) return false;
  let i = 0;
  while (i < r.log.length && !r.log[i]?.snap) i++;
  const m = r.log[i++];
  let lp;
  if (r.atSnap) lp = structuredClone(r.atSnap);
  else {
    // Walk to the line instantly; the replay starts at the snap.
    lp = createLivePlay(structuredClone(r.g), r.off, r.def, r.opts);
    for (let k = 0; k < i - 1; k++) stepLive(lp, null);
  }
  lp.preview = true;
  lp.control = m?.control ? lp[m.control[0]]?.[m.control[1]] ?? null : null;
  snap(lp);
  L3.replay = { lp, i, acc: 0, rec: r, review };
  S.menuOpen = false;
  document.body.classList.add('pb-replay');
  document.body.classList.toggle('pb-review', !!review);
  stage.setPlay(lp);
  stage.setCameraMode('broadcast');
  stage.snapCamera();
  render();
  syncOverlays();
  return true;
}
export function stopReplay() {
  if (!L3.replay) return;
  const review = L3.replay.review;
  L3.replay = null;
  document.body.classList.remove('pb-replay', 'pb-review');
  stage.setCameraMode(S.cam);
  if (review) { finishReview(); return; }
  if (L3.preview?.lp) stage.setPlay(L3.preview.lp); else showPreview();
  stage.snapCamera();
  render();
}

// ---------- replay review ----------
// The sides a person calls for: both in a two-player game, otherwise yours.
const humanSides = () => (twoPlayer() ? [0, 1] : [userSide()]);
// Can you challenge the last call now (G, or the Challenge button)?
export function challengeReady(ti = userSide()) {
  return !!stage && !L3.lp && !L3.replay && !FILM.open && !!S.game && humanSides().includes(ti) && canChallenge(S.game, L3.review, ti);
}
export function userChallenge(ti = userSide()) {
  if (!challengeReady(ti)) return;
  startReview(ti);
}
// After the whistle: the booth stops the game for its reviews, and an AI coach may challenge a
// call that went against it. Returns true when a review started (it advances the game itself).
function autoReview() {
  const g = S.game, rv = L3.review;
  if (!stage || !g || g.final || !rv || rv.done || g.playNo !== rv.playNo) return false;
  if (rv.booth) { startReview(null); return true; }
  for (const ti of [0, 1]) if (!humanSides().includes(ti) && aiWantsChallenge(g, rv, ti)) { startReview(ti); return true; }
  return false;
}
// The flag (or the booth's buzzer): the ruling on the field is announced and the play runs again
// at half speed from the broadcast camera. The verdict comes when it ends (or is skipped).
function startReview(by) {
  const g = S.game, rv = L3.review;
  rv.by = by;
  clearTimeout(timers.auto);
  const said = rv.ruling?.said ?? 'the play as called';
  showBanner({ head: by == null ? 'Booth review' : `${g.teams[by].abbr} challenge`, tone: 'flag', yds: '', clock: '', notes: [], possession: false,
    text: `${by == null ? 'The play is under review.' : `${g.teams[by].name} throw the challenge flag.`} The ruling on the field: ${said}.`, next: 'Under review' });
  if (!startReplay({ by, rec: rv.rec })) finishReview();
}
// The verdict: the call stands (or is confirmed), or it is reversed and the play goes on the
// books as it really happened.
function finishReview() {
  const g = S.game, rv = L3.review;
  if (!g || !rv || rv.done) { autoAdvance(); return; }
  const score = [...g.score];
  const out = decideReview(g, rv, rv.by ?? null, (gg, r) => runLivePlay(gg, rv.off, rv.def, r, rv.secs));
  if (out.entry) setReelEntry(rv.rec, out.entry);
  const now = performance.now();
  for (const i of [0, 1]) if (g.score[i] !== score[i]) L3.scoreFlash[i] = now + 2200;
  L3.tickerUntil = now + 6500;
  L3.pclock = 40;
  // The teams walk to the spot the review settled on.
  if (L3.preview?.lp) { L3.spots = worldSpots(L3.preview.lp); L3.preview = null; }
  save();
  render();
  const note = g.log[g.log.length - 1];
  if (out.verdict === 'reversed') {
    const B = resultBanner(out.entry, null, rv.before);
    if (B) showBanner({ ...B, head: `Reversed · ${B.head}`, text: note.text });
    broadcastReview(g, rv.before, stage, true);
    boothReview(g, true);
  } else {
    boothReview(g, false);
    showBanner({ head: note.head, tone: 'muted', yds: '', clock: '', notes: [], possession: false, text: note.text, next: `${downText(g)} at ${spotText(g)}` });
  }
  hideBanner(4500);
  autoAdvance();
}
// Space (Enter for player two, A on a pad) after the whistle: skip the rest of the result beat
// and the walk to the line, and bring the next call up at once. Only a press made a moment after
// the whistle counts, so a juke or dive mashed through the tackle does not skip the result card.
export function skipBeat() {
  const now = performance.now();
  if (!stage || !S.game || S.game.final || L3.replay || FILM.open || now - L3.flowAt < 450) return false;
  if (L3.flow === 'PLAY_RESULT') {
    if (L3.lp?.phase === 'dead') {
      if (!L3.committed) return false;
      endResult();
    } else if (!L3.lp && L3.resultUntil > now) { L3.resultUntil = 1; hideBanner(1200); }
    else return false;
    // A review the booth or the other coach started has the field now.
    if (L3.replay) return true;
  } else if (L3.flow !== 'RESET_FORMATION') return false;
  settlePreview();
  return true;
}
// The teams walk the rest of the way to the line in one go.
function settlePreview() {
  if (!L3.preview?.lp) showPreview();
  const pv = L3.preview?.lp;
  if (pv) for (let i = 0; i < 1200 && !pv.set; i++) stepLive(pv, null);
  L3.resetUntil = 0; L3.acc = 0;
  stage?.snapCamera();
  render();
}

// A replay, a review or the film room has the field: the next play waits for it.
export const fieldBusy = () => !!L3.replay || FILM.open;
export function closeHelp() { S.helpOpen = false; S.seenHelp = true; savePrefs(); syncOverlays(); }
export function syncOverlays() {
  const set = (id, show) => { const el = document.getElementById(id); if (el && el.hidden === show) el.hidden = !show; };
  set('pause-ov', !!L3.lp && L3.paused && L3.lp.phase !== 'dead');
  set('replay-badge', !!L3.replay || FILM.open);
  const badge = document.getElementById('replay-badge'), bt = FILM.open ? 'Film room' : L3.replay?.review ? 'Under review' : 'Replay';
  if (badge && badge.textContent !== bt) badge.textContent = bt;
  set('replay-btn', replayReady() && L3.flow === 'PLAY_SELECTION');
  set('film-btn', filmReady() && !L3.replay && L3.flow === 'PLAY_SELECTION');
  set('chal-btn', challengeReady() && (L3.flow === 'PLAY_SELECTION' || L3.flow === 'RESET_FORMATION'));
  set('help-ov', !!S.helpOpen);
}

// Developer-only diagnostics, drawn over the field while the debug view is on: the flow
// state, the play clock of the simulation, the ball, the camera, every player's action,
// contact state, assignment and speed, and the play's event timeline.
function debugHud() {
  const el = document.getElementById('dbg-hud');
  if (!el) return;
  L3.dbgN = (L3.dbgN ?? 0) + 1;
  if (L3.dbgN % 6) return;
  const lp = L3.lp ?? L3.preview?.lp;
  const f = (v, n = 1) => (v == null ? '–' : Number(v).toFixed(n));
  const rows = [];
  rows.push(`<b>${L3.flow ?? ''}</b> · sim ${lp ? `${lp.phase} t=${f(lp.t, 2)}` : '—'} · camera ${stage.rig.shot ?? stage.rig.mode} pos ${f(stage.rig.pos.x)},${f(stage.rig.pos.y)},${f(stage.rig.pos.z)} → ${f(stage.rig.look.x)},${f(stage.rig.look.z)}`);
  if (lp) {
    const b = lp.ball;
    rows.push(`<b>${lp.possession ?? ''}</b> · ball ${b.state}${b.holder ? ` (${b.holder.slot})` : ''} at ${f(b.x)}, ${f(b.y)}, h ${f(b.z, 2)}${lp.thrown ? ` · thrown to ${lp.thrown.target?.slot ?? 'away'} T=${f(lp.thrown.T, 2)}s` : ''}${lp.tackle ? ` · tackle ${lp.tackle.q.slot}→${lp.tackle.c.slot} fp ${f(lp.tackle.fp)}` : ''}`);
    const tgt = (p) => p.eng ? `eng ${p.eng.slot}` : p.aim ? `→${p.aim.slot ?? ''}` : p.man ? `man ${p.man.slot}` : p.zone ? `zone ${f(p.zone.x, 0)},${f(p.zone.y, 0)}` : p.route ? `route ${p.routeName ?? ''} ${p.wp}/${p.route.length}` : '';
    const tbl = lp.players.map((p) => `<tr class="${p.side}"><td>${p.slot}</td><td>${p.act}</td><td>${p.contact ?? ''}</td><td>${p.role}</td><td>${f(Math.hypot(p.vx, p.vy))}</td><td>${tgt(p)}</td></tr>`).join('');
    rows.push(`<table>${tbl}</table>`);
    const ev = lp.events.slice(-10).map((e) => `<li>${f(e.t, 2)} ${e.kind} ${e.who?.slot ?? ''}${e.other ? `→${e.other.slot}` : ''} ${e.text ? `<span>${esc(e.text)}</span>` : ''}</li>`).join('');
    rows.push(`<ol>${ev}</ol>`);
  }
  el.innerHTML = rows.map((r) => (r.startsWith('<') ? r : `<p>${r}</p>`)).join('');
}

// Back to the call sheet from a lined-up play; the players stay where they are.
export function recall() {
  if (L3.lp?.phase !== 'pre') return;
  S.psPick = null;
  L3.spots = worldSpots(L3.lp); L3.preview = null; L3.lp = null;
  render();
}

export function cycleCamera() {
  const i = CAMERA_MODES.findIndex(([k]) => k === S.cam);
  setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length][0]);
  flash(CAMERA_MODES.find(([k]) => k === S.cam)[1], 'muted');
}
export function setDebug(on) {
  S.debug = on;
  if (stage) stage.debug = on;
  if (!on) { const el = document.getElementById('dbg-hud'); if (el) el.innerHTML = ''; }
  render();
}
export function setCamera(k) { S.cam = k; stage?.setCameraMode(k); savePrefs(); if (S.menuOpen) render(); }

export function onKey(e, down) {
  // A release always counts, whatever is on screen: a key let go between plays (the dive held
  // through the whistle) would otherwise stay "held" and its next press would never register.
  if (!down) { L3.keys.delete(e.code); L3.p2in.keys.delete(P2_KEYS[e.code] ?? e.code); }
  if (S.screen !== 'game' || !stage || !S.game) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const code = e.code;
  if (down && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (S.helpOpen) {
      if (code === 'Escape' || code === 'Enter' || code === 'Space' || code === 'Slash') { e.preventDefault(); closeHelp(); }
      return;
    }
    if (code === 'Slash') { e.preventDefault(); S.helpOpen = true; syncOverlays(); return; }
    if (code === 'Escape' && S.psPick) { e.preventDefault(); S.psPick = null; render(); return; }
    if (L3.lp?.phase === 'pre' && !S.coachDown && L3.lp.user != null && !L3.lp.kick && presnapKey(code)) { e.preventDefault(); return; }
    if (code === 'KeyI' && !L3.lp) { e.preventDefault(); S.csScout = !S.csScout; S.csFold = false; render(); return; }
    if (FILM.open) { filmKey(e); return; }
    if (L3.replay && (code === 'Escape' || code === 'KeyY' || code === 'Space')) { e.preventDefault(); stopReplay(); return; }
    if ((code === 'Space' || code === 'Enter' || code === 'NumpadEnter') && !e.target.closest?.('button, a, summary') && skipBeat()) { e.preventDefault(); return; }
    // The final whistle: Enter plays another quick game, or goes back to the season.
    if ((code === 'Enter' || code === 'NumpadEnter') && S.game.final && !e.target.closest?.('button, a, summary')) {
      const go = document.querySelector('.ov-final .btn.primary');
      if (go) { e.preventDefault(); go.click(); return; }
    }
    if (code === 'KeyJ' && filmReady() && !L3.replay) { e.preventDefault(); openFilm(); return; }
    if (code === 'KeyG' && !L3.lp && !L3.replay) { e.preventDefault(); userChallenge(); return; }
    if (code === 'KeyY') { e.preventDefault(); startReplay(); return; }
    // P pauses a play on the field; between plays it falls through to the call sheet (Punt).
    if (code === 'KeyP' && L3.lp && L3.lp.phase !== 'dead') { e.preventDefault(); togglePause(); return; }
    if (code === 'KeyO' && spectating()) { e.preventDefault(); toggleTakeOver(); return; }
    if (code === 'KeyC') { e.preventDefault(); cycleCamera(); return; }
    if (code === 'KeyM') { e.preventDefault(); S.menuOpen = !S.menuOpen; render(); return; }
    if (code === 'Backquote') { e.preventDefault(); setDebug(!S.debug); return; }
    if (code === 'KeyH' && !L3.lp) { e.preventDefault(); S.csFold = !S.csFold; render(); return; }
    // Only while the call sheet is up: a T mashed to throw the ball away as the whistle blows
    // must not burn a timeout.
    if (code === 'KeyT' && !L3.lp && !L3.replay) { e.preventDefault(); if (L3.flow === 'PLAY_SELECTION') userTimeout(); return; }
    if (code === 'KeyX' && !L3.lp) { e.preventDefault(); S.csAll = !S.csAll; S.csFold = false; render(); return; }
    if (code === 'KeyB' && !L3.lp) { e.preventDefault(); S.runFlip = !S.runFlip; render(); return; }
    if (code === 'Escape') {
      if (S.menuOpen) { S.menuOpen = false; render(); return; }
      if (L3.paused || L3.lp?.phase === 'live') { e.preventDefault(); togglePause(); return; }
      if (L3.lp?.phase === 'pre' && !S.coachDown) { recall(); return; }
    }
  }
  // Call keys on the play sheet, only while no play is lined up or live.
  if (!L3.lp && !L3.replay && !FILM.open && down && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const g = S.game;
    if (!g.final && needsUser(g) && !S.busy) {
      const { tabs, cur } = csTabs(g);
      const hit = (tabs.find(([k]) => k === cur)?.[2] ?? []).find((c) => c.code === code)
        ?? tabs.flatMap(([, , cs]) => cs).find((c) => KICK_KEYS[c.call] && c.code === code);
      if (hit) { e.preventDefault(); doCall(hit.call); return; }
      // Enter calls the play that fits the down; R calls your last call again.
      // (One player only: in a two-player game these keys belong to the players' moves.)
      if ((code === 'Enter' || code === 'NumpadEnter') && !twoPlayer() && !e.target.closest?.('button, a, summary')) {
        const q = quickCalls(g);
        if (q.fit) { e.preventDefault(); doCall(q.fit); return; }
      }
      if (code === 'KeyR' && !twoPlayer()) {
        const q = quickCalls(g);
        if (q.again) { e.preventDefault(); doCall(q.again); return; }
      }
      if (code === 'ArrowLeft' || code === 'ArrowRight') { e.preventDefault(); csMove(code === 'ArrowLeft' ? -1 : 1); return; }
      if (code === 'KeyZ') { e.preventDefault(); cycleForm(g.poss === userSide()); return; }
    }
  }
  const two = twoPlayer();
  const game = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyR', 'KeyQ', 'KeyT', 'Tab',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(code) || (two && !!P2_KEYS[code]);
  if (!game) return;
  if (isPaused()) { e.preventDefault(); return; }
  if (!L3.lp) { if (code === 'Space' && down && e.target === document.body) e.preventDefault(); return; }
  e.preventDefault();
  // Two players: player two's keys go to their own input as player one's codes; the throw keys
  // belong to whoever has the ball.
  let src = L3, v = code;
  if (two && P2_KEYS[code]) { src = L3.p2in; v = P2_KEYS[code]; }
  else if (two && (/^Digit[1-5]$/.test(code) || code === 'KeyT')) src = inputFor(L3.lp.o);
  if (down) { if (!src.keys.has(v) || !e.repeat) src.edges.add(v); src.keys.add(v); }
  // Shift held as a number goes down: a lob (remembered, in case Shift is let go first).
  if (down && v.startsWith('Digit') && e.shiftKey) src.lob = v;
}
// Player two's keys in a two-player game, as the player-one codes the input reader knows.
const P2_KEYS = { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD', Enter: 'Space', NumpadEnter: 'Space', ShiftRight: 'ShiftLeft',
  Period: 'KeyQ', KeyL: 'KeyE', KeyK: 'KeyR' };

// A gamepad button or stick for one player, as the key code it stands for (see screens/pad.js).
export function padKey(src, v, down) {
  if (!down) { src.keys.delete(v); return; }
  if (!L3.lp || isPaused()) return;
  src.edges.add(v); src.keys.add(v);
}

function bindTouch(root) {
  const stick = root.querySelector('#stick');
  let origin = null;
  stick.addEventListener('pointerdown', (e) => { origin = { x: e.clientX, y: e.clientY, id: e.pointerId }; stick.setPointerCapture(e.pointerId); });
  stick.addEventListener('pointermove', (e) => {
    if (!origin || e.pointerId !== origin.id) return;
    const dx = (e.clientX - origin.x) / 40, dy = (e.clientY - origin.y) / 40;
    L3.stick = { up: Math.max(-1, Math.min(1, -dy)), right: Math.max(-1, Math.min(1, dx)) };
    stick.firstElementChild.style.transform = `translate(${Math.max(-1, Math.min(1, dx)) * 22}px, ${Math.max(-1, Math.min(1, dy)) * 22}px)`;
  });
  const end = () => { origin = null; L3.stick = null; stick.firstElementChild.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  // Each button is held like its key: a receiver's number tapped is a touch pass and held is a
  // bullet, and Sprint runs for as long as it is held. Lob arms the next number as a lob.
  const touchPad = root.querySelector('#touch');
  root.querySelectorAll('[data-key]').forEach((b) => {
    const key = b.dataset.key;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (isPaused()) return;
      try { b.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
      if (key.startsWith('Digit') && touchPad.classList.contains('lob')) { L3.lob = key; touchPad.classList.remove('lob'); }
      L3.edges.add(key); L3.keys.add(key);
    });
    const up = () => L3.keys.delete(key);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  root.querySelectorAll('[data-touch]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const act = b.dataset.touch;
    if (act === 'lob') touchPad.classList.toggle('lob');
    if (act === 'pause') togglePause();
    if (act === 'camera') cycleCamera();
  }));
}

// What the touch pad shows: nothing between plays, only Pause while you watch the AI run your
// call, the throw buttons once the quarterback has the ball and can throw, the ball carrier's
// and defender's moves otherwise.
function touchMode(lp) {
  if (!lp || lp.phase === 'dead') return 'idle';
  const c = lp.control;
  if (lp.phase === 'live' && !c) return 'watch';
  if (lp.phase !== 'pre' && c?.side === 'off' && c.slot === 'QB' && lp.ball.holder === c && lp.kind === 'pass' && !lp.thrown && !lp.windup && lp.qbState !== 'run') return 'pass';
  return lp.phase === 'pre' ? 'pre' : 'run';
}
