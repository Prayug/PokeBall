// The practice field: an interactive tutorial in six short exercises, played on the real 3D
// field with real plays. One instruction at a time, the key it needs lit up in the control
// strip, and the next instruction only once the player has done it. Every key it names comes
// from the control registry (controls.js), so the tutorial never teaches a key that does
// something else. Started from Quick play, the controls card or the game menu; skippable,
// replayable, and it never touches a league.
import { S, savePrefs } from '../state.js';
import { render } from '../app.js';
import { esc } from '../ui.js';
import { keyFor } from '../controls.js';
import { L3, recall } from './live3d.js';
import { doCall, userSide } from './game.js';

export const TUT = { on: false, ex: 0, sub: 0, prepped: -1, msg: '', msgUntil: 0, nextAt: 0, ctl0: null, holdT: 0, done: false, playNo: -1, callAt: 0 };

const k = (id) => `<kbd>${esc(keyFor(id))}</kbd>`;
// Each exercise: which side of the ball, the call lined up for you (none: you pick it), and its
// steps. A step's `done(lp, T)` says when the player has done it; `fail(lp)` sends the exercise
// back to the start with a word on why.
const EXERCISES = [
  { title: 'Call a play and snap', side: 'off', call: null, steps: [
    { text: () => `Pick a play: press a number for a category, then one for a play. Or press ${k('fits')} for the play that fits.`, keys: ['pick', 'fits'], done: (lp) => !!lp && !lp.kick },
    { text: () => `You are lined up. Press ${k('action')} to snap the ball.`, keys: ['action'], done: (lp) => lp && lp.phase !== 'pre' },
    { text: () => 'Watch the play through. The strip at the bottom always shows the keys that work right now.', keys: [], done: (lp) => !lp || lp.phase === 'dead' },
  ] },
  { title: 'Move the ball carrier', side: 'off', call: 'inside_run', steps: [
    { text: () => `A run is lined up for you. Press ${k('action')} to snap.`, keys: ['action'], done: (lp) => lp && lp.phase !== 'pre' },
    { text: () => `Take the handoff and steer the runner with ${k('move')} (or the arrows). Hold ${k('sprint')} to sprint.`, keys: ['move', 'sprint'],
      done: (lp, T, dt) => { const c = lp?.control; if (c?.carrier && lp.manual) T.holdT += dt; return T.holdT > 1.2; }, fail: (lp) => lp?.phase === 'dead' && 'The play ended before you took the wheel. Snap and steer this time.' },
  ] },
  { title: 'Throw to a receiver', side: 'off', call: 'slant', steps: [
    { text: () => `A pass play is lined up. Press ${k('action')} to snap.`, keys: ['action'], done: (lp) => lp && lp.phase !== 'pre' },
    { text: () => `Each receiver has a number over his head. Press ${k('throw')} to throw to him: tap for a soft pass, hold for a bullet.`, keys: ['throw'],
      done: (lp) => !!lp?.thrown && !lp.thrown.away, fail: (lp) => lp?.phase === 'dead' && !lp.thrown && 'No throw that time. Snap and press a receiver’s number.' },
    { text: () => 'Nice throw. Let the play finish.', keys: [], done: (lp) => !lp || lp.phase === 'dead' },
  ] },
  { title: 'Switch defenders', side: 'def', call: 'cover3', steps: [
    { text: () => `You are on defense, controlling the ringed player. Press ${k('switch')} (or click a defender) to take over another one.`, keys: ['switch'],
      done: (lp, T) => { if (!lp) return false; if (T.ctl0 == null && lp.control) T.ctl0 = lp.control; return !!lp.control && T.ctl0 != null && lp.control !== T.ctl0; } },
    { text: () => `Now press ${k('action')} to start the play. During it, ${k('switch')} jumps to the defender nearest the ball.`, keys: ['action', 'switch'], done: (lp) => lp && lp.phase !== 'pre' },
    { text: () => 'Play it out.', keys: [], done: (lp) => !lp || lp.phase === 'dead' },
  ] },
  { title: 'Make a tackle', side: 'def', call: 'base', steps: [
    { text: () => `Press ${k('action')} to start the play.`, keys: ['action'], done: (lp) => lp && lp.phase !== 'pre' },
    { text: () => `Chase the ball carrier with ${k('move')}, press ${k('switch')} to jump closer, and ${k('action')} to dive at him.`, keys: ['move', 'switch', 'action'],
      done: (lp) => lp?.phase === 'dead' && !!lp.end?.tackler && lp.end.tackler === lp.control,
      fail: (lp) => lp?.phase === 'dead' && !(lp.end?.tackler && lp.end.tackler === lp.control) && (lp.end?.tackler ? 'A teammate made that tackle. Get there first this time.' : 'He got away. Try again.') },
  ] },
  { title: 'Use a special move', side: 'off', call: 'inside_run', steps: [
    { text: () => `Press ${k('action')} to snap.`, keys: ['action'], done: (lp) => lp && lp.phase !== 'pre' },
    { text: () => `With the ball, beat a tackler with a move: ${k('action')} jukes, ${k('spin')} spins, ${k('truck')} trucks through him. Big, heavy Pokémon truck best; quick ones juke.`, keys: ['action', 'spin', 'truck'],
      done: (lp) => !!lp?.control?.carrier && lp.manual && lp.events.some((e) => ['juke', 'spin', 'truck'].includes(e.kind) && e.who === lp.control),
      fail: (lp) => lp?.phase === 'dead' && 'No move that time. Snap, take the ball and press one of the move keys.' },
  ] },
];
export const TUT_STEPS = EXERCISES.length;

export function tutorialOn() { return TUT.on && !!S.gameMeta?.tutorial; }
export function beginTutorial() {
  Object.assign(TUT, { on: true, ex: 0, sub: 0, prepped: -1, msg: '', msgUntil: 0, nextAt: 0, ctl0: null, holdT: 0, done: false, playNo: -1 });
}
export function endTutorial() { TUT.on = false; S.seenTutorial = true; savePrefs(); }
export function skipExercise() { if (!TUT.on) return; advance(true); }
export function restartTutorial() { beginTutorial(); render(); }

// The practice situation for an exercise: 1st and 10 at your own 35, your side on offense or
// defense, the clock stopped and plenty of it, and (when the exercise has one) the play called.
function prepare() {
  const g = S.game, ex = EXERCISES[TUT.ex];
  if (!g || !ex) return;
  const us = userSide();
  Object.assign(g, { phase: 'play', kick: null, pending: null, down: 1, toGo: 10, spot: 35, poss: ex.side === 'off' ? us : 1 - us, quarter: 1, clock: 900, clockRunning: false, final: false });
  L3.preview = null; L3.spots = null; L3.pclock = 40;
  S.csTab = null; S.csBook = false; S.csAll = false; S.csFold = false; S.psPick = null;
  TUT.prepped = TUT.ex; TUT.sub = 0; TUT.ctl0 = null; TUT.holdT = 0; TUT.playNo = g.playNo;
  TUT.callAt = performance.now() + 450;
  render();
}
function say(msg, ms = 2200) { TUT.msg = msg; TUT.msgUntil = performance.now() + ms; }
function advance(skipped = false) {
  TUT.ex++; TUT.sub = 0; TUT.prepped = -1;
  if (TUT.ex >= EXERCISES.length) { TUT.done = true; TUT.ex = EXERCISES.length; S.seenTutorial = true; savePrefs(); }
  else if (!skipped) say('Done! Next exercise…', 1400);
  render();
}

// Called every frame by the game loop: set up the exercise between plays, then watch for each
// step, and move on (or start the exercise over) when the play has settled.
export function tutorialTick(dt, now) {
  if (!tutorialOn() || TUT.done) return;
  const lp = L3.lp, ex = EXERCISES[TUT.ex];
  if (!ex) return;
  if (TUT.nextAt) { if (now < TUT.nextAt) return; TUT.nextAt = 0; advance(); return; }
  // A play still lined up from the exercise before (skipped at the line): send it back first.
  if (lp?.phase === 'pre' && TUT.prepped !== TUT.ex) { recall(); return; }
  // Between plays, at the call sheet: line up this exercise's situation once.
  if (!lp && L3.flow === 'PLAY_SELECTION' && TUT.prepped !== TUT.ex) { prepare(); return; }
  // A play that ended with the exercise unfinished: run it again.
  if (!lp && L3.flow === 'PLAY_SELECTION' && TUT.prepped === TUT.ex && S.game.playNo !== TUT.playNo && TUT.sub > 0) {
    say(TUT.failMsg || 'Let’s run that again.');
    TUT.failMsg = '';
    TUT.prepped = -1;
    return;
  }
  // The exercise's play, called for the player once the field is ready for it (doCall waits
  // out the players walking back to the line, so keep offering it until it takes).
  if (ex.call && !lp && TUT.sub === 0 && TUT.prepped === TUT.ex && L3.flow === 'PLAY_SELECTION' && now >= TUT.callAt) { TUT.callAt = now + 300; doCall(ex.call); }
  const step = ex.steps[TUT.sub];
  if (!step) return;
  if (step.done(lp, TUT, dt)) {
    TUT.sub++;
    if (TUT.sub >= ex.steps.length) TUT.nextAt = now + 900;
    render();
    return;
  }
  const why = step.fail?.(lp);
  if (why && !TUT.failMsg) TUT.failMsg = why;
}

// The keys the current step teaches, lit up in the control strip.
export function tutorialKeys() {
  if (!tutorialOn() || TUT.done) return [];
  return EXERCISES[TUT.ex]?.steps[TUT.sub]?.keys ?? [];
}

// The coach's card under the scoreboard: the exercise, its one instruction, the progress, and
// skip / replay / leave.
export function tutorialHtml() {
  if (!tutorialOn()) return '';
  if (TUT.done) {
    return `<div class="tut card" role="status"><span class="tut-eyebrow">Practice complete</span><b class="tut-title">You know the controls</b>
      <p class="tut-text">Every key you need is in the strip at the bottom of the screen, and ${k('help')} opens the full list.</p>
      <div class="actions"><button class="btn primary" data-act="tutquick">Play a real game</button><button class="btn" data-act="tutrestart">Practice again</button><button class="btn" data-act="tutexit">Home</button></div></div>`;
  }
  const ex = EXERCISES[TUT.ex], step = ex.steps[Math.min(TUT.sub, ex.steps.length - 1)];
  const msg = TUT.msg && performance.now() < TUT.msgUntil ? TUT.msg : '';
  const dots = EXERCISES.map((_, i) => `<i class="${i < TUT.ex ? 'done' : i === TUT.ex ? 'on' : ''}"></i>`).join('');
  return `<div class="tut card" role="status" aria-live="polite">
    <span class="tut-eyebrow">Practice ${TUT.ex + 1} of ${EXERCISES.length}<span class="tut-dots" aria-hidden="true">${dots}</span></span>
    <b class="tut-title">${esc(ex.title)}</b>
    ${msg ? `<p class="tut-msg">${esc(msg)}</p>` : ''}<p class="tut-text">${TUT.sub >= ex.steps.length ? 'Done!' : step.text()}</p>
    <div class="tut-acts"><button class="btn tiny" data-act="tutskip">Skip</button><button class="btn tiny" data-act="tutexit">Leave practice</button></div></div>`;
}
