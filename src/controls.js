// Controls: the one registry of every binding in the 3D game. The input handlers (live3d.js),
// the on-screen control strip, the controls card, the tutorial and the game menu all read their
// keys from here, so a key named on screen is always the key that does it.
//
// A binding: `codes` (KeyboardEvent.code values that trigger it for player one), `kb` the key as
// printed, `pad` the gamepad button (see screens/pad.js), `p2` player two's key in a two-player
// game (null where player two shares player one's key), and `does` a short default label.
export const BIND = {
  move: { codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], kb: 'WASD', pad: 'Stick', p2: 'Arrows', does: 'Move' },
  sprint: { codes: ['ShiftLeft', 'ShiftRight'], kb: 'Shift', pad: 'RT', p2: 'Right Shift', does: 'Sprint' },
  action: { codes: ['Space'], kb: 'Space', pad: 'A', p2: 'Enter', does: 'Snap' },
  truck: { codes: ['KeyE'], kb: 'E', pad: 'X', p2: 'L', does: 'Truck' },
  spin: { codes: ['KeyR'], kb: 'R', pad: 'B', p2: 'K', does: 'Spin' },
  switch: { codes: ['KeyQ', 'Tab'], kb: 'Q', pad: 'Y', p2: '.', does: 'Switch player' },
  throw: { codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'], kb: '1-5', pad: 'A B X Y RB', p2: null, does: 'Throw to that receiver' },
  lob: { codes: [], kb: 'Shift + 1-5', pad: 'LB + button', p2: null, does: 'Lob' },
  away: { codes: ['KeyT'], kb: 'T', pad: 'RS', p2: null, does: 'Throw it away' },
  fair: { codes: ['KeyF'], kb: 'F', pad: 'Y', p2: null, does: 'Fair catch' },
  audible: { codes: ['KeyV'], kb: 'V', pad: null, p2: null, does: 'Audible' },
  hot: { codes: ['KeyB'], kb: 'B', pad: null, p2: null, does: 'Hot route' },
  motion: { codes: ['KeyN'], kb: 'N', pad: null, p2: null, does: 'Motion' },
  change: { codes: ['Escape'], kb: 'Esc', pad: 'B', p2: null, does: 'Change play' },
  fits: { codes: ['Enter', 'NumpadEnter'], kb: 'Enter', pad: null, p2: null, does: 'Call the play that fits' },
  again: { codes: ['KeyR'], kb: 'R', pad: null, p2: null, does: 'Call your last play again' },
  pick: { codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'], kb: '1-9', pad: 'D-pad + A', p2: '1-9', does: 'Pick' },
  page: { codes: ['ArrowLeft', 'ArrowRight'], kb: '← →', pad: 'LB RB', p2: '← →', does: 'More plays' },
  back: { codes: ['Escape', 'Backspace'], kb: 'Esc', pad: 'B', p2: 'Esc', does: 'Back to categories' },
  formation: { codes: ['KeyZ'], kb: 'Z', pad: null, p2: null, does: 'Change formation' },
  flip: { codes: ['KeyB'], kb: 'B', pad: null, p2: null, does: 'Flip the runs' },
  all: { codes: ['KeyX'], kb: 'X', pad: null, p2: null, does: 'Every play at once' },
  fold: { codes: ['KeyH'], kb: 'H', pad: null, p2: null, does: 'Hide or show the call sheet' },
  scout: { codes: ['KeyI'], kb: 'I', pad: null, p2: null, does: 'Type edges and tendencies' },
  timeout: { codes: ['KeyT'], kb: 'T', pad: null, p2: null, does: 'Timeout' },
  kneel: { codes: ['KeyK'], kb: 'K', pad: null, p2: null, does: 'Take a knee' },
  skip: { codes: ['Space'], kb: 'Space', pad: 'A', p2: 'Enter', does: 'Next play' },
  replay: { codes: ['KeyY'], kb: 'Y', pad: null, p2: null, does: 'Replay' },
  challenge: { codes: ['KeyG'], kb: 'G', pad: null, p2: null, does: 'Challenge' },
  film: { codes: ['KeyJ'], kb: 'J', pad: null, p2: null, does: 'Film room' },
  pause: { codes: ['KeyP'], kb: 'P', pad: 'Start', p2: null, does: 'Pause' },
  menu: { codes: ['KeyM'], kb: 'M', pad: 'Start', p2: null, does: 'Menu' },
  camera: { codes: ['KeyC'], kb: 'C', pad: 'Back', p2: null, does: 'Camera' },
  details: { codes: ['KeyL'], kb: 'L', pad: null, p2: null, does: 'Box score' },
  help: { codes: ['Slash'], kb: '?', pad: null, p2: null, does: 'Controls' },
  mute: { codes: ['KeyU'], kb: 'U', pad: null, p2: null, does: 'Mute' },
  next: { codes: ['Enter', 'NumpadEnter'], kb: 'Enter', pad: 'A', p2: null, does: 'Continue' },
  takeover: { codes: ['KeyO'], kb: 'O', pad: null, p2: null, does: 'Call the next play yourself' },
};
// Does this key code trigger the binding?
export const isKey = (id, code) => BIND[id].codes.includes(code);

// The controls for each moment of play, in the order they are shown. Each entry is a binding
// and what it does right then. live3d.js decides which moment it is (controlContext).
export const CONTEXTS = {
  select: [['pick', 'Pick'], ['fits', 'Play that fits'], ['page', 'More plays'], ['back', 'Back']],
  select1: [['pick', 'Pick a category'], ['fits', 'Play that fits'], ['all', 'All plays']],
  selectAll: [['pick', 'Pick'], ['all', 'Back'], ['fits', 'Play that fits']],
  select2p: [['pick', 'Pick'], ['page', 'More plays'], ['back', 'Back']],
  lining: [['action', 'Hurry to the line']],
  preOff: [['action', 'Snap'], ['audible', 'Audible'], ['hot', 'Hot route'], ['motion', 'Motion'], ['change', 'Change play']],
  preOffRun: [['action', 'Snap'], ['audible', 'Audible'], ['flip', 'Flip the run'], ['motion', 'Motion'], ['change', 'Change play']],
  preDef: [['action', 'Start'], ['switch', 'Switch player'], ['audible', 'Shade coverage'], ['hot', 'Show blitz'], ['motion', 'Back out'], ['change', 'Change play']],
  preKick: [['action', 'Snap'], ['change', 'Change play']],
  preKickoff: [['action', 'Kick off'], ['change', 'Change play']],
  preReturn: [['action', 'Start']],
  preCoach: [['action', 'Snap now'], ['change', 'Change play']],
  preDef2p: [['switch', 'Pick a defender']],
  qb: [['throw', 'Throw (tap touch, hold bullet)'], ['lob', 'Lob'], ['move', 'Place the ball'], ['away', 'Throw away']],
  air: [['move', 'Adjust'], ['action', 'Go up for it']],
  carrier: [['move', 'Run'], ['sprint', 'Sprint'], ['action', 'Juke'], ['spin', 'Spin'], ['truck', 'Truck']],
  carrierQB: [['move', 'Run'], ['sprint', 'Sprint'], ['action', 'Juke'], ['spin', 'Spin'], ['truck', 'Truck'], ['away', 'Slide']],
  defense: [['move', 'Pursue'], ['sprint', 'Sprint'], ['action', 'Dive / tackle'], ['switch', 'Switch to the ball']],
  returner: [['move', 'Get under it'], ['sprint', 'Sprint'], ['fair', 'Fair catch']],
  kickReturner: [['move', 'Get under it'], ['sprint', 'Sprint']],
  coverKick: [['move', 'Cover'], ['sprint', 'Sprint'], ['action', 'Dive']],
  blocker: [['move', 'Move'], ['sprint', 'Sprint']],
  dead: [['skip', 'Next play']],
  final: [['next', 'Continue'], ['details', 'Box score']],
};

// A binding's key as printed for a device: 'kb' (player one's keyboard), 'pad' or 'p2'.
export function keyFor(id, device = 'kb') {
  const b = BIND[id];
  if (!b) return '';
  if (device === 'pad') return b.pad ?? b.kb;
  if (device === 'p2') return b.p2 ?? b.kb;
  return b.kb;
}
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// One line of key chips: [key] what it does. Bindings with no key on this device are left out
// (a gamepad has no audible button, so the strip does not offer one).
// hl: bindings to light up (the tutorial's current step).
export function chips(ctx, device = 'kb', hl = []) {
  return (CONTEXTS[ctx] ?? []).filter(([id]) => device !== 'pad' || BIND[id].pad).map(([id, label]) => `<span class="kc${hl.includes(id) ? ' hl' : ''}"><kbd>${escH(keyFor(id, device))}</kbd>${escH(label)}</span>`).join('');
}
// The same line as text (for screen readers and tests).
export function chipsText(ctx, device = 'kb') {
  return (CONTEXTS[ctx] ?? []).filter(([id]) => device !== 'pad' || BIND[id].pad).map(([id, label]) => `${keyFor(id, device)} ${label}`).join(' · ');
}

// The controls card (? and the game menu): every binding, by the moment it works in, with the
// keyboard, gamepad and player-two keys side by side.
const SECTIONS = [
  ['Calling a play', ['pick', 'fits', 'page', 'back', 'again', 'all', 'formation', 'flip', 'scout', 'fold', 'timeout', 'kneel']],
  ['At the line', [['action', 'Snap (on defense: start)'], ['audible', 'Audible (defense: shade the coverage)'], ['hot', 'Hot route; flip a run (defense: show blitz)'], ['motion', 'Motion (defense: back out)'], ['switch', 'Pick a defender'], ['change', 'Change the play']]],
  ['Throwing', ['throw', 'lob', ['move', 'Hold a direction to place the ball'], 'away', ['action', 'Go up for a ball in the air']]],
  ['With the ball', [['move', 'Run'], 'sprint', ['action', 'Juke'], 'spin', 'truck', ['away', 'Slide (quarterback)']]],
  ['On defense', [['move', 'Pursue'], ['action', 'Dive to tackle'], ['switch', 'Switch to the player nearest the ball']]],
  ['Kicks', [['fair', 'Fair catch, or take a knee in the end zone'], ['action', 'Kick off or snap']]],
  ['Any time', [['skip', 'After the whistle: next play'], 'pause', 'menu', 'camera', 'replay', 'film', 'challenge', 'details', 'help', 'mute', 'takeover']],
];
export function controlsCardHtml({ twoPlayer = false } = {}) {
  const row = (e) => {
    const [id, label] = Array.isArray(e) ? e : [e, BIND[e].does];
    const b = BIND[id];
    return `<tr><th scope="row">${escH(label)}</th><td><kbd>${escH(b.kb)}</kbd></td><td>${b.pad ? `<kbd>${escH(b.pad)}</kbd>` : '<span class="muted">—</span>'}</td>${twoPlayer ? `<td>${b.p2 ? `<kbd>${escH(b.p2)}</kbd>` : '<span class="muted">shared</span>'}</td>` : ''}</tr>`;
  };
  return `<div class="ctl-sections">${SECTIONS.map(([title, rows]) => `<section><h4>${escH(title)}</h4><table class="ctl-table"><thead><tr><th></th><th>Keyboard</th><th>Gamepad</th>${twoPlayer ? '<th>Player 2</th>' : ''}</tr></thead><tbody>${rows.map(row).join('')}</tbody></table></section>`).join('')}</div>`;
}
