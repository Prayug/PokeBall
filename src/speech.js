// The booth's voices: the lines commentary.js writes, read out loud with the browser's own
// speech synthesis (no files, no server, no keys) and captioned on screen. Two voices, one for
// each of the crew, picked from the voices the device has: the play-by-play a touch quicker and
// brighter, the analyst lower and more relaxed, and both louder and faster when the play is big.
//
// A broadcast can't read every line it is handed: the play moves on. Lines are queued by how
// much they matter (see commentary.js): a touchdown or a pick cuts in over anything, a live call
// that waited too long is dropped, and filler only goes when the booth is quiet. With no speech
// synthesis (or the voices turned off) the captions still run, for as long as the line would
// take to say.
import { CREW } from './commentary.js';
import { duck } from './audio.js';

const SYN = typeof window !== 'undefined' ? window.speechSynthesis ?? null : null;
const Utter = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance ?? null : null;
// How long a line may wait before it is stale, by priority (ms).
const TTL = [9000, 7000, 1800, 3500];
const V = { on: true, voice: true, captions: true, volume: 0.9, onCaption: null };
let queue = [], cur = null, voices = { pbp: null, color: null }, watchdog = 0, captionTimer = 0, kickT = 0, cutAt = 0;

export function setBooth(opts = {}) {
  Object.assign(V, opts);
  if (!V.on || !V.voice) stopTalking();
}
export const boothOn = () => V.on;

// The best two English voices on the device. Neural and online voices first, then the ones
// marked premium or enhanced, then any English voice; two different ones when there are two.
function pickVoices() {
  if (!SYN) return;
  const all = SYN.getVoices?.() ?? [];
  const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (!en.length) { voices = { pbp: all[0] ?? null, color: all[1] ?? all[0] ?? null }; return; }
  const score = (v) => (/natural|neural/i.test(v.name) ? 6 : 0) + (/online/i.test(v.name) ? 3 : 0) + (/premium|enhanced/i.test(v.name) ? 3 : 0)
    + (/google/i.test(v.name) ? 2 : 0) + (/en[-_]US/i.test(v.lang) ? 1 : 0) + (/en[-_]GB/i.test(v.lang) ? 0.5 : 0) + (v.localService === false ? 1 : 0)
    // Novelty voices make a poor broadcast.
    - (/whisper|bells|bad news|boing|bubbles|cellos|zarvox|trinoids|jester|organ|superstar|wobble|albert|bahh|hysterical|deranged|pipe|good news/i.test(v.name) ? 20 : 0);
  const male = /\b(guy|davis|tony|jason|eric|christopher|andrew|brian|roger|steffan|ryan|daniel|alex|tom|aaron|arthur|fred|mark|david|george|james|male|rishi|oliver|evan|nathan)\b/i;
  const ranked = [...en].sort((a, b) => score(b) - score(a));
  const pbp = ranked.find((v) => male.test(v.name)) ?? ranked[0];
  const color = ranked.find((v) => v !== pbp && v.lang.slice(0, 2) === pbp.lang.slice(0, 2) && score(v) >= score(pbp) - 4) ?? ranked.find((v) => v !== pbp) ?? pbp;
  voices = { pbp, color };
}
if (SYN) {
  pickVoices();
  SYN.addEventListener?.('voiceschanged', pickVoices);
}
// What the menu shows: the two voices in use.
export function voiceNames() {
  if (!SYN) return null;
  if (!voices.pbp) pickVoices();
  return { pbp: voices.pbp?.name ?? 'System voice', color: voices.color?.name ?? 'System voice', same: voices.pbp === voices.color };
}

// A line for the booth. Returns whether it was taken (spoken now, or queued).
export function talk(ln) {
  if (!V.on || !ln?.text) return false;
  const now = performance.now();
  const item = { ...ln, at: now, ttl: TTL[ln.pri ?? 1] ?? 6000 };
  if (item.pri >= 3) {
    // The big moment: drop everything less important and cut in.
    queue = queue.filter((q) => q.pri >= 3);
    if (cur && cur.pri < 3) interrupt();
  } else if (item.pri === 2) {
    // A live call: the wrap of the last play and the filler give way to it.
    queue = queue.filter((q) => q.pri >= 2);
    if (cur && cur.pri <= 1) interrupt();
    // Only the latest live calls matter; an older one waiting is already behind the play.
    const live = queue.filter((q) => q.pri === 2);
    if (live.length >= 2) queue.splice(queue.indexOf(live[0]), 1);
  } else if (item.pri === 0 && (cur || queue.length)) return false;
  queue.push(item);
  kick();
  return true;
}
// Everything said and queued comes off (a new game, the film room, the menu turning it off).
export function stopTalking() {
  queue = [];
  clearTimeout(kickT); kickT = 0;
  if (cur) interrupt();
  cur = null;
  caption(null);
  duck(false);
}
export const talking = () => !!cur || queue.length > 0;

// Start the next line once nothing is being said. Right after a cut-in it waits a moment:
// Chrome drops an utterance spoken in the same instant the last one was cancelled.
function kick() {
  if (cur || kickT) return;
  const wait = Math.max(0, 90 - (performance.now() - cutAt));
  kickT = setTimeout(() => { kickT = 0; if (!cur) next(); }, wait);
}
function interrupt() {
  const c = cur;
  cur = null;
  cutAt = performance.now();
  clearTimeout(watchdog);
  if (c?.u) { c.u.onend = c.u.onerror = null; }
  try { SYN?.cancel(); } catch { /* ignore */ }
}

function next() {
  clearTimeout(watchdog);
  const now = performance.now();
  while (queue.length && now - queue[0].at > queue[0].ttl) queue.shift();
  const it = queue.shift();
  if (!it) { cur = null; duck(false); captionTimer = setTimeout(() => caption(null), 1600); return; }
  cur = it;
  clearTimeout(captionTimer);
  caption(it);
  const words = it.text.split(/\s+/).length;
  const est = 600 + words * (it.hype >= 2 ? 300 : 360);
  if (SYN && Utter && V.voice) {
    duck(true);
    const u = new Utter(it.text.replace(/!+/g, '!'));
    const v = voices[it.who] ?? voices.pbp;
    if (v) { u.voice = v; u.lang = v.lang; }
    // One voice for both: the analyst sits lower so the two still sound like two people.
    const same = voices.pbp === voices.color;
    const base = it.who === 'pbp' ? { rate: 1.08, pitch: 1.02 } : { rate: 0.98, pitch: same ? 0.72 : 0.92 };
    u.rate = Math.min(1.6, base.rate + (it.hype ?? 0) * 0.1);
    u.pitch = Math.min(2, base.pitch + (it.hype ?? 0) * 0.09);
    u.volume = Math.max(0, Math.min(1, V.volume * (0.82 + (it.hype ?? 0) * 0.09)));
    it.u = u;
    u.onend = u.onerror = () => { if (cur === it) { cur = null; kick(); } };
    try { SYN.speak(u); } catch { it.u = null; }
    // Some browsers never fire onend for a cancelled or stuck utterance.
    watchdog = setTimeout(() => { if (cur === it) { try { SYN.cancel(); } catch { /* ignore */ } cur = null; cutAt = performance.now(); kick(); } }, est * 2.2 + 2500);
  } else {
    watchdog = setTimeout(() => { if (cur === it) { cur = null; kick(); } }, est);
  }
}

function caption(it) {
  if (!V.onCaption) return;
  V.onCaption(it && V.captions ? { who: it.who, name: CREW[it.who]?.name ?? '', text: it.text, hype: it.hype ?? 0 } : null);
}
