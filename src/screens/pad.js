// Gamepads, through the browser's Gamepad API (standard mapping). On the field: the left stick
// or the D-pad moves, RT sprints, A snaps, jukes, dives and goes up for the ball, B spins, X
// trucks, Y switches defenders. On a pass play, A B X Y and RB throw to receivers 1-5 (tap for
// touch, hold for a bullet, LB held for a lob) and a right stick click throws it away. Start
// pauses (or opens the game menu between plays), Back changes the camera. Between plays and on
// every other screen the D-pad moves between buttons and A presses one; on the call sheet LB and
// RB turn the page and B changes a lined-up call.
//
// Each button becomes the key it stands for in the player's input (screens/live3d.js), so the
// game reads a gamepad exactly like the keyboard. In a one-player game every pad is the user's;
// in a two-player game a single pad is player two's, and with two pads the first is player one's.
import { render } from '../app.js';
import { S } from '../state.js';
import { L3, closeHelp, cycleCamera, inputFor, padKey, recall, stage, stopReplay, togglePause } from './live3d.js';
import { csMove } from './callsheet.js';
import { twoPlayer } from './game.js';

const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, BACK = 8, START = 9, RS = 11, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const DEAD = 0.25;
const state = new Map(); // pad index -> { pressed: [], codes: Map(button -> key code), nav: {} }
let raf = 0, frames = 0;

export function initPads() {
  if (typeof window === 'undefined' || !navigator.getGamepads) return;
  window.addEventListener('gamepadconnected', start);
  window.addEventListener('gamepaddisconnected', (e) => { releaseAll(e.gamepad.index); state.delete(e.gamepad.index); });
  start();
}
function pads() {
  try { return [...navigator.getGamepads()].filter((p) => p && p.connected); } catch { return []; }
}
function start() { if (!raf && pads().length) raf = requestAnimationFrame(tick); }

// Which player a pad plays for: 0, 1, or null (a third pad in a two-player game).
function playerOf(n, count) {
  if (!twoPlayer()) return 0;
  if (count === 1) return 1;
  return n < 2 ? n : null;
}

function tick() {
  const list = pads();
  if (!list.length) { raf = 0; return; }
  raf = requestAnimationFrame(tick);
  frames++;
  for (const p of [L3, L3.p2in]) p.padStick = null;
  list.forEach((gp, n) => poll(gp, playerOf(n, list.length)));
}

function poll(gp, who) {
  let st = state.get(gp.index);
  if (!st) state.set(gp.index, (st = { pressed: [], codes: new Map(), nav: {} }));
  const now = performance.now();
  const pressed = gp.buttons.map((b) => b.pressed || b.value > 0.5);
  const was = st.pressed;
  const down = (i) => pressed[i] && !was[i];
  const up = (i) => !pressed[i] && was[i];
  const ax = (i) => (Math.abs(gp.axes[i] ?? 0) > DEAD ? gp.axes[i] : 0);
  // The stick (or the D-pad) as up and right, -1 to 1.
  const right = Math.max(-1, Math.min(1, ax(0) + (pressed[RIGHT] ? 1 : 0) - (pressed[LEFT] ? 1 : 0)));
  const upv = Math.max(-1, Math.min(1, -ax(1) + (pressed[UP] ? 1 : 0) - (pressed[DOWN] ? 1 : 0)));
  const any = pressed.some(Boolean) || right || upv;
  st.pressed = pressed;
  if (who == null) return;
  const src = who === 0 ? L3 : L3.p2in;
  if (any) src.padAt = now;
  // A button let go releases the key it pressed, whatever it would mean now.
  for (const [i, code] of st.codes) if (up(i)) { padKey(src, code, false); st.codes.delete(i); }

  const inGame = S.screen === 'game' && stage && S.game;
  if (S.helpOpen) { if (down(A) || down(B) || down(START)) closeHelp(); return; }
  if (inGame && L3.replay) { if (down(A) || down(B) || down(START)) stopReplay(); return; }
  if (inGame && down(BACK)) cycleCamera();
  const lp = inGame ? L3.lp : null;
  if (down(START)) {
    if (lp && lp.phase !== 'dead') togglePause();
    else if (inGame) { S.menuOpen = !S.menuOpen; render(); }
  }
  if (lp && !L3.paused) {
    src.padStick = { up: upv, right };
    const ti = twoPlayer() ? who : lp.user;
    // A pass not yet thrown, by this player's quarterback: the face buttons pick the receiver.
    const throwing = lp.phase === 'live' && lp.kind === 'pass' && !lp.thrown && !lp.windup && lp.qbState !== 'run' && lp.ball.holder === lp.off.QB && ti === lp.o;
    const map = throwing ? { [A]: 'Digit1', [B]: 'Digit2', [X]: 'Digit3', [Y]: 'Digit4', [RB]: 'Digit5', [RS]: 'KeyT' }
      : { [A]: 'Space', [B]: 'KeyR', [X]: 'KeyE', [Y]: 'KeyQ', [RS]: 'KeyT' };
    // Before the snap, B goes back to the call sheet (one-player games).
    if (lp.phase === 'pre' && down(B) && !twoPlayer() && !S.coachDown) { recall(); return; }
    for (const [i, code] of Object.entries(map)) {
      if (!down(Number(i))) continue;
      // The throw keys belong to whoever has the ball (two players share them on the keyboard).
      const into = code.startsWith('Digit') || code === 'KeyT' ? inputFor(lp.o) : src;
      if (code.startsWith('Digit') && pressed[LB]) into.lob = code;
      padKey(into, code, true);
      st.codes.set(Number(i), code);
    }
    for (const t of [RT, LT]) {
      if (down(t)) { padKey(src, 'ShiftLeft', true); st.codes.set(t, 'ShiftLeft'); }
    }
    return;
  }
  // Off the field (or between plays): move between buttons and press them.
  if (inGame && !lp && document.querySelector('.callsheet')) {
    if (down(LB)) { csMove(-1); return; }
    if (down(RB)) { csMove(1); return; }
  }
  if (inGame && lp?.phase === 'pre' && down(B) && !S.coachDown) { recall(); return; }
  navigate(st, upv, right, now, down(A));
}

// Focus moves through the buttons in page order (the call sheet's cards when it is up);
// A presses the focused one, or the highlighted play on the call sheet.
function navigate(st, upv, right, now, press) {
  const dir = Math.abs(upv) > 0.6 ? (upv > 0 ? -1 : 1) : Math.abs(right) > 0.6 ? (right > 0 ? 1 : -1) : 0;
  const N = st.nav;
  let step = 0;
  if (dir && (dir !== N.dir || now >= N.next)) { step = dir; N.next = now + (dir === N.dir ? 140 : 380); }
  N.dir = dir;
  const scope = document.querySelector('.callsheet:not(.folded)') ?? document.getElementById('app');
  if (!scope) return;
  const items = [...scope.querySelectorAll('button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), summary')]
    .filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const cur = items.indexOf(document.activeElement);
  if (step) {
    // On the call sheet the first press lands on the play that fits the down (or the first play).
    const first = scope.querySelector('.pcard.fit') ?? scope.querySelector('.pcard');
    const i = cur < 0 ? Math.max(0, items.indexOf(first)) : (cur + step + items.length) % items.length;
    items[i].focus();
    items[i].scrollIntoView?.({ block: 'nearest' });
  }
  if (press) {
    const el = cur >= 0 ? items[cur] : scope.querySelector('.pcard.fit') ?? scope.querySelector('.pcard');
    el?.click();
  }
}

function releaseAll(index) {
  const st = state.get(index);
  if (!st) return;
  for (const [, code] of st.codes) for (const src of [L3, L3.p2in]) padKey(src, code, false);
}

// Exposed for the browser test: a fake pad's buttons go through the same mapping.
if (typeof window !== 'undefined') window.__pbPad = { get frames() { return frames; } };
