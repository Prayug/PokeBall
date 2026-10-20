// The film room: every live play of this game on a reel, played back from the recording
// (see film.js) at any speed, from any of the cameras, a step at a time, forward or back. Plays
// can be starred and moments marked in them; a play saves as a clip file that loads back here,
// and records as a video of whatever the camera shows.
import { DEF_PLAYS, OFF_PLAYS, clockText, downText } from '../engine.js';
import { DT } from '../live.js';
import { CAMERA_MODES } from '../camera3d.js';
import { S } from '../state.js';
import { download, esc } from '../ui.js';
import { advance, clipFromJson, clipJson, makeTape, seekTape, tapeSeconds } from '../film.js';
import { L3, stage, stopReplay } from './live3d.js';
import { render } from '../app.js';

// The reel holds this game's plays (newest last); starred ones are kept when it is trimmed.
const REEL_MAX = 80;
export const FILM = { open: false, reel: [], cur: -1, tape: null, lp: null, i: 0, acc: 0, playing: false, speed: 0.5, cam: 'broadcast', starOnly: false, rec: null, el: null, n: 0 };
const SPEEDS = [[0.25, '¼×'], [0.5, '½×'], [1, '1×']];

// A finished live play joins the reel. g is the game before the play, entry the game's record
// of it (it changes if a review reverses the call: see setReelEntry).
export function addToReel(rec, g, entry) {
  if (!rec?.atSnap || !rec.log?.some((e) => e?.snap)) return;
  // (The reel keeps only what plays the tape, not the copy of the whole game before the play.)
  const item = { id: ++FILM.n, src: rec, rec: { off: rec.off, def: rec.def, log: rec.log, atSnap: rec.atSnap, end: rec.end, done: true }, entry, star: false, marks: [], label: g ? `${g.quarter <= 4 ? `Q${g.quarter}` : 'OT'} ${clockText(Math.round(g.clock))} · ${downText(g)}` : 'Clip' };
  FILM.reel.push(item);
  while (FILM.reel.length > REEL_MAX) {
    const k = FILM.reel.findIndex((x) => !x.star && x !== FILM.reel[FILM.cur]);
    if (k < 0) break;
    FILM.reel.splice(k, 1);
    if (FILM.cur > k) FILM.cur--;
  }
}
export function setReelEntry(rec, entry) { const it = FILM.reel.find((x) => x.src === rec); if (it) it.entry = entry; }
export function clearReel() { if (FILM.open) closeFilm(); FILM.reel = []; FILM.cur = -1; }
export const filmReady = () => !!stage && FILM.reel.length > 0 && !L3.lp && !FILM.open;

const playName = (it) => (it.rec.off ? `${OFF_PLAYS[it.rec.off]?.name ?? it.rec.off} vs ${DEF_PLAYS[it.rec.def]?.name ?? it.rec.def}` : '');

export function openFilm(k = FILM.reel.length - 1) {
  if (!stage || L3.lp || !FILM.reel.length) return;
  if (L3.replay) stopReplay();
  FILM.open = true;
  S.menuOpen = false;
  document.body.classList.add('pb-film');
  stage.setCameraMode(FILM.cam);
  ensurePanel();
  load(k);
  // (The play is framed above the panel, as it is above the call sheet: see fitDock.)
  render();
}
export function closeFilm() {
  if (!FILM.open) return;
  stopRecording(true);
  FILM.open = false; FILM.playing = false; FILM.tape = null; FILM.lp = null;
  document.body.classList.remove('pb-film');
  if (FILM.el) FILM.el.hidden = true;
  stage?.setCameraMode(S.cam);
  // Back to the field as it stands between plays.
  if (L3.preview?.lp) stage?.setPlay(L3.preview.lp);
  stage?.snapCamera();
  render();
}

// Put play k of the reel on the screen, at the snap, rolling.
function load(k) {
  const it = FILM.reel[k];
  if (!it) return;
  const tape = makeTape(it.rec);
  if (!tape) return;
  FILM.cur = k; FILM.tape = tape; FILM.playing = true; FILM.acc = 0;
  show(0, true);
  draw();
}
// Show step i of the current tape.
function show(i, cut = false) {
  const T = FILM.tape;
  if (!T) return;
  FILM.i = Math.max(0, Math.min(T.n, Math.round(i)));
  FILM.lp = seekTape(T, FILM.i);
  stage.setPlay(FILM.lp);
  // A seek shows where everyone is; the sounds and flags already behind it don't go off again.
  stage.evSeen = FILM.lp.events.length;
  if (FILM.lp.phase === 'dead') stage.whistled = FILM.lp;
  if (cut) stage.snapCamera();
  sync();
}

// One frame of the film room for the game loop: the play advanced at the chosen speed. Returns
// the play to draw and how far between steps it is.
export function filmFrame(dt) {
  const T = FILM.tape, lp = FILM.lp;
  if (!T || !lp) return { lp: null, alpha: 1 };
  if (FILM.playing) {
    FILM.acc += dt * FILM.speed;
    while (FILM.acc >= DT && FILM.i < T.n) { advance(T, lp, FILM.i++); FILM.acc -= DT; }
    if (FILM.i >= T.n) {
      // Hold on the whistle for a beat, then stop (or, while recording, finish the video).
      FILM.tail = (FILM.tail ?? 0) + dt;
      if (FILM.tail > 1.2) { FILM.playing = false; FILM.tail = 0; FILM.acc = 0; if (FILM.rec) stopRecording(); draw(); }
    }
    sync();
  }
  return { lp, alpha: FILM.playing && FILM.i < T.n ? Math.min(1, FILM.acc / DT) : 1 };
}

// ---------- the panel ----------
function ensurePanel() {
  const wrap = stage?.el?.parentElement;
  if (!wrap) return;
  if (!FILM.el || !wrap.contains(FILM.el)) {
    FILM.el = document.createElement('div');
    FILM.el.className = 'film card';
    FILM.el.id = 'film';
    FILM.el.setAttribute('role', 'dialog');
    FILM.el.setAttribute('aria-label', 'Film room');
    FILM.el.addEventListener('click', onClick);
    FILM.el.addEventListener('input', (e) => { if (e.target.id === 'film-scrub') { FILM.playing = false; show(Number(e.target.value)); } });
    FILM.el.addEventListener('change', onFile);
    wrap.appendChild(FILM.el);
  }
  FILM.el.hidden = false;
}

function draw() {
  if (!FILM.el) return;
  const it = FILM.reel[FILM.cur];
  const T = FILM.tape;
  const canRec = typeof MediaRecorder !== 'undefined' && !!stage?.renderer?.domElement?.captureStream;
  const items = FILM.reel.map((x, k) => [x, k]).filter(([x]) => !FILM.starOnly || x.star).reverse();
  FILM.el.innerHTML = `<div class="film-head"><b>Film room</b><span class="film-what">${it ? esc(`${it.label} · ${playName(it)}`) : ''}</span>
      <button class="btn tiny" data-film="close" aria-label="Close the film room">Close <kbd>Esc</kbd></button></div>
    <p class="film-text">${it?.entry?.text ? esc(it.entry.text) : it?.meta?.text ? esc(it.meta.text) : ''}</p>
    <div class="film-scrub"><div class="film-track"><input type="range" id="film-scrub" min="0" max="${T?.n ?? 0}" value="${FILM.i}" aria-label="Scrub through the play">
      <div class="film-marks">${(it?.marks ?? []).map((m) => `<button class="film-mark" style="left:${T?.n ? (100 * m) / T.n : 0}%" data-film="goto" data-i="${m}" title="Moment at ${tapeSeconds(m).toFixed(1)}s" aria-label="Go to the moment at ${tapeSeconds(m).toFixed(1)} seconds"></button>`).join('')}</div></div>
      <output id="film-time">${timeText()}</output></div>
    <div class="film-ctl">
      <span class="gm-row"><button class="btn tiny" data-film="prev" title="Previous play ([)">⏮</button><button class="btn tiny" data-film="back" title="Back a step (←)">◀︎</button>
      <button class="btn tiny" data-film="play" id="film-play" title="Play or pause (Space)">${FILM.playing ? '❚❚' : '▶'}</button>
      <button class="btn tiny" data-film="fwd" title="Forward a step (→)">▶︎</button><button class="btn tiny" data-film="next" title="Next play (])">⏭</button></span>
      <span class="gm-row seg">${SPEEDS.map(([v, l]) => `<button class="btn tiny ${FILM.speed === v ? 'on' : ''}" data-film="speed" data-v="${v}" aria-pressed="${FILM.speed === v}">${l}</button>`).join('')}</span>
      <span class="gm-row seg">${CAMERA_MODES.map(([k, l]) => `<button class="btn tiny ${FILM.cam === k ? 'on' : ''}" data-film="cam" data-cam="${k}" aria-pressed="${FILM.cam === k}">${l}</button>`).join('')}</span>
    </div>
    <div class="film-ctl">
      <span class="gm-row"><button class="btn tiny ${it?.star ? 'on' : ''}" data-film="star" aria-pressed="${!!it?.star}" title="Star this play (S)">${it?.star ? '★ Starred' : '☆ Star'}</button>
      <button class="btn tiny" data-film="mark" title="Mark this moment (K)">Mark moment</button>
      ${it?.marks?.length ? `<button class="btn tiny" data-film="unmark" title="Remove the marks">Clear marks</button>` : ''}</span>
      <span class="gm-row"><button class="btn tiny" data-film="save" title="Download this play as a clip file">Save clip</button>
      <label class="btn tiny film-load">Load clip<input type="file" id="film-file" accept=".json,application/json" hidden></label>
      <button class="btn tiny ${FILM.rec ? 'on rec' : ''}" data-film="video" ${canRec ? '' : 'disabled title="This browser can\'t record the field"'}>${FILM.rec ? '● Stop recording' : 'Record video'}</button></span>
    </div>
    <div class="film-reelhead"><b>This game</b><label class="check small"><input type="checkbox" data-film="staronly" ${FILM.starOnly ? 'checked' : ''}> Starred only</label></div>
    <ol class="film-reel">${items.map(([x, k]) => `<li><button class="${k === FILM.cur ? 'on' : ''}" data-film="pick" data-k="${k}">${x.star ? '<span class="star">★</span>' : ''}<span class="lbl">${esc(x.label)}</span><span class="txt">${esc(x.entry?.text ?? x.meta?.text ?? playName(x))}</span></button></li>`).join('') || '<li class="muted small">No starred plays yet.</li>'}</ol>`;
}
// The moving parts only: the scrubber, the clock and the play button (cheap enough for every frame).
function sync() {
  const el = FILM.el;
  if (!el) return;
  const sc = el.querySelector('#film-scrub');
  if (sc && Number(sc.value) !== FILM.i && document.activeElement !== sc) sc.value = FILM.i;
  const t = el.querySelector('#film-time'), txt = timeText();
  if (t && t.textContent !== txt) t.textContent = txt;
  const b = el.querySelector('#film-play'), p = FILM.playing ? '❚❚' : '▶';
  if (b && b.textContent !== p) b.textContent = p;
}
const timeText = () => `${tapeSeconds(FILM.i).toFixed(1)}s / ${tapeSeconds(FILM.tape?.n ?? 0).toFixed(1)}s`;

function act(a, el = null) {
  const T = FILM.tape, it = FILM.reel[FILM.cur];
  switch (a) {
    case 'close': closeFilm(); return;
    case 'play':
      if (!T) return;
      if (FILM.i >= T.n) show(0, true);
      FILM.playing = !FILM.playing; FILM.tail = 0; sync(); return;
    case 'back': FILM.playing = false; show(FILM.i - 1); return;
    case 'fwd': FILM.playing = false; show(FILM.i + 1); return;
    case 'back10': FILM.playing = false; show(FILM.i - 15); return;
    case 'fwd10': FILM.playing = false; show(FILM.i + 15); return;
    case 'prev': case 'next': {
      // Along the reel as it is listed (the starred plays only, when filtered).
      const ks = FILM.reel.map((x, k) => [x, k]).filter(([x]) => !FILM.starOnly || x.star || x === it).map(([, k]) => k);
      const at = ks.indexOf(FILM.cur), to = ks[at + (a === 'prev' ? -1 : 1)];
      if (to != null) load(to);
      return;
    }
    case 'pick': load(Number(el.dataset.k)); return;
    case 'goto': FILM.playing = false; show(Number(el.dataset.i)); return;
    case 'speed': FILM.speed = Number(el.dataset.v); break;
    case 'cam': FILM.cam = el.dataset.cam; stage.setCameraMode(FILM.cam); stage.snapCamera(); break;
    case 'star': if (it) it.star = !it.star; break;
    case 'mark': if (it && !it.marks.includes(FILM.i)) { it.marks.push(FILM.i); it.marks.sort((x, y) => x - y); } break;
    case 'unmark': if (it) it.marks = []; break;
    case 'staronly': FILM.starOnly = !FILM.starOnly; break;
    case 'save': if (it) saveClip(it); return;
    case 'video': if (FILM.rec) stopRecording(); else startRecording(); break;
    default: return;
  }
  draw();
}
function onClick(e) {
  const el = e.target.closest('[data-film]');
  if (!el || el.disabled) return;
  if (el.tagName === 'INPUT') { act(el.dataset.film, el); return; }
  e.preventDefault();
  act(el.dataset.film, el);
}

// Keys while the film room is open (it takes them all, so nothing reaches the call sheet).
export function filmKey(e) {
  const k = { Escape: 'close', KeyO: 'close', Space: 'play', KeyK: 'mark', KeyS: 'star', BracketLeft: 'prev', BracketRight: 'next' }[e.code]
    ?? (e.code === 'ArrowLeft' ? (e.shiftKey ? 'back10' : 'back') : e.code === 'ArrowRight' ? (e.shiftKey ? 'fwd10' : 'fwd') : null);
  if (e.code === 'KeyC') {
    const i = CAMERA_MODES.findIndex(([c]) => c === FILM.cam);
    act('cam', { dataset: { cam: CAMERA_MODES[(i + 1) % CAMERA_MODES.length][0] } });
    e.preventDefault();
    return true;
  }
  if (!k) return false;
  e.preventDefault();
  act(k);
  return true;
}

// ---------- clips ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
function saveClip(it) {
  const meta = { label: it.label, text: it.entry?.text ?? it.meta?.text ?? '', marks: it.marks, teams: it.rec.atSnap?.g?.teams?.map((t) => t.abbr) };
  download(`pokeball-clip-${slug(`${meta.teams?.join('-') ?? ''} ${it.label}`) || 'play'}.json`, clipJson(it.rec, meta), 'application/json');
}
function onFile(e) {
  if (e.target.id !== 'film-file') return;
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  f.text().then((txt) => {
    let c;
    try { c = clipFromJson(txt); } catch (err) { flashFilm(`That file isn't a PokeBall clip (${err.message}).`); return; }
    const item = { id: ++FILM.n, rec: c.rec, entry: null, meta: c.meta, star: true, marks: [...(c.meta.marks ?? [])], label: `Clip: ${c.meta.label ?? f.name}` };
    FILM.reel.push(item);
    load(FILM.reel.length - 1);
  });
}
function flashFilm(text) {
  const p = FILM.el?.querySelector('.film-text');
  if (p) p.textContent = text;
}

// ---------- video ----------
// The field's own canvas, recorded as the play runs from the snap at the chosen speed and from
// the chosen camera, and handed over as a video file when the play ends (or on Stop).
function startRecording() {
  const canvas = stage?.renderer?.domElement, it = FILM.reel[FILM.cur];
  if (!canvas?.captureStream || typeof MediaRecorder === 'undefined' || !FILM.tape || !it) return;
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
  let mr;
  try { mr = new MediaRecorder(canvas.captureStream(60), type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined); } catch { flashFilm("This browser can't record the field."); return; }
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    if (FILM.recDiscard) { FILM.recDiscard = false; return; }
    const blob = new Blob(chunks, { type: mr.mimeType || 'video/webm' });
    const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    download(`pokeball-${slug(`${it.rec.atSnap?.g?.teams?.map((t) => t.abbr).join('-') ?? ''} ${it.label}`) || 'play'}.${ext}`, blob, blob.type);
  };
  FILM.rec = mr;
  show(0, true);
  FILM.playing = true; FILM.tail = 0; FILM.acc = 0;
  mr.start(250);
}
function stopRecording(discard = false) {
  const mr = FILM.rec;
  if (!mr) return;
  FILM.rec = null;
  FILM.recDiscard = discard;
  try { mr.stop(); } catch { /* already stopped */ }
  if (!discard) draw();
}
