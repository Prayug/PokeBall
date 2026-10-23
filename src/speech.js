// The booth's voices. Names and yard lines stay on the browser's speech synthesis, which works
// offline. Each line goes out as one utterance, so the voice keeps its own phrasing through the
// commas and the sentences: chopping a line into clauses and restarting the voice on each one
// is what made the crew sound robotic. Mack and Dee keep different bases and only lean on the
// rate and pitch a little when they get excited (neural voices warble when pushed far), with a
// touch of drift from line to line so no two calls come out the same. Committed neural hits
// (touchdown, pick, sack, and the rest) play through the Web Audio ducking when the files are
// there; only then is a line split, around the clip. Captions still show the full line.
//
// A broadcast can't read every line it is handed: the play moves on. Lines are queued by how
// much they matter (see commentary.js): a touchdown or a pick cuts in over anything, a live call
// that waited too long is dropped, and filler only goes when the booth is quiet. Between lines
// there is a beat, a little longer when the other voice picks it up. With no speech synthesis
// (or the voices turned off) the captions still run, for as long as the line would take to say.
import { CREW } from './commentary.js';
import { boothClipOn, duck, hasBoothHit, loadBoothClips, playBoothHit } from './audio.js';

const SYN = typeof window !== 'undefined' ? window.speechSynthesis ?? null : null;
const Utter = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance ?? null : null;
// How long a line may wait before it is stale, by priority (ms).
const TTL = [9000, 7000, 1800, 3500];
const V = { on: true, voice: true, captions: true, volume: 0.9, onCaption: null };
let queue = [], cur = null, voices = { pbp: null, color: null }, watchdog = 0, captionTimer = 0, kickT = 0, cutAt = 0, endAt = 0, lastWho = null;

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
loadBoothClips();

// Shouts a committed clip can carry. Order matters: "no good" before "good", "to the house"
// and "pick" before a plain touchdown.
const HITS = [
  { id: 'nogood', re: /no good/i },
  { id: 'house', re: /to the house/i },
  { id: 'pick', re: /\bpick(?:ed(?: off)?| six)?\b|\bintercept/i },
  { id: 'sack', re: /\bsack/i },
  { id: 'fumble', re: /\bfumble/i },
  { id: 'kickaway', re: /kick is away|punt is away/i },
  { id: 'break', re: /breaks? (?:a |the )?tackle/i },
  { id: 'good', re: /it'?s good|\bit is good\b|\bis good\b/i },
  { id: 'touchdown', re: /\btouchdown\b/i },
];
export function clausesOf(text) {
  const parts = String(text ?? '').match(/[^.!?;—]+[.!?;—]+|[^.!?;—]+$/g);
  return (parts ?? [String(text ?? '')]).map((s) => s.trim()).filter(Boolean);
}
function hitIn(clause) {
  for (const h of HITS) {
    const m = h.re.exec(clause);
    if (!m) continue;
    const before = clause.slice(0, m.index).replace(/[,—\s]+$/, '').trim();
    const after = clause.slice(m.index + m[0].length).replace(/^[,.\s!—-]+/, '').trim();
    return { id: h.id, before, after };
  }
  return null;
}
// How a voice reads a line: its own base, lifted a little with the hype, and a small drift so
// back-to-back calls don't land on the same note. A same-voice analyst sits lower to tell the
// two apart.
function voiceOf(who, hype, same) {
  const b = who === 'pbp' ? { rate: 1.06, pitch: 1.0 } : { rate: 0.98, pitch: same ? 0.86 : 0.96 };
  const lift = [0, 0.06, 0.12][Math.max(0, Math.min(2, hype | 0))];
  const drift = () => (Math.random() - 0.5) * 0.04;
  return { rate: +(b.rate + lift + drift()).toFixed(3), pitch: +(b.pitch + lift * 0.7 + drift()).toFixed(3), volume: 0.88 + 0.06 * (hype | 0) };
}
// What the synthesizer is handed: the caption without the marks it reads badly. Dashes become
// commas (a breath), stacked marks one.
export function speakable(text) {
  return String(text ?? '').replace(/([.!?])\s*—\s*/g, '$1 ').replace(/\s*—\s*/g, ', ').replace(/!+/g, '!').replace(/\?+/g, '?').replace(/\.{4,}/g, '...').replace(/\s+/g, ' ').trim();
}
// The line as one utterance, unless a committed clip can carry its shout: then the words before
// the hit, the clip (with the name after it), and the rest.
function segmentsOf(it) {
  const parts = clausesOf(it.text);
  let at = -1, hit = null;
  for (let i = 0; i < parts.length && !hit; i++) {
    const h = hitIn(parts[i]);
    if (h && hasBoothHit(it.who, h.id)) { at = i; hit = h; }
  }
  if (!hit) return [{ say: it.text }];
  const before = [...parts.slice(0, at), hit.before].filter(Boolean).join(' ');
  const after = parts.slice(at + 1).join(' ');
  return [before && { say: before }, { clip: hit.id, say: hit.after, full: parts[at] }, after && { gap: 120 }, after && { say: after }].filter(Boolean);
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
  const now = performance.now(), nx = queue[0];
  // A beat between lines, as two people talking leave: longer when the other voice answers,
  // none when the big moment cuts in.
  const beat = !nx || nx.pri >= 3 ? 0 : nx.who !== lastWho ? 280 : 150;
  const wait = Math.max(0, 90 - (now - cutAt), beat - (now - endAt));
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

function finishLine(it) {
  if (cur !== it) return;
  cur = null;
  endAt = performance.now(); lastWho = it.who;
  const rest = () => {
    if (cur) return;
    if (boothClipOn()) { watchdog = setTimeout(rest, 120); return; }
    if (!queue.length) duck(false);
    kick();
  };
  rest();
}
function speakChunk(it, text, set, done) {
  if (!(SYN && Utter && V.voice) || !text) return false;
  duck(true);
  const u = new Utter(speakable(text));
  const v = voices[it.who] ?? voices.pbp;
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = set.rate;
  u.pitch = set.pitch;
  u.volume = Math.max(0, Math.min(1, V.volume * set.volume));
  it.u = u;
  u.onend = u.onerror = () => { if (cur === it) done(); };
  try { SYN.speak(u); } catch { it.u = null; return false; }
  const est = 420 + text.split(/\s+/).length * (set.rate > 1.3 ? 240 : 320);
  watchdog = setTimeout(() => { if (cur === it) { try { SYN.cancel(); } catch { /* ignore */ } done(); } }, est * 2.2 + 1800);
  return true;
}
function playSeg(it) {
  if (cur !== it) return;
  const seg = it.segs[it.si++];
  if (!seg) { finishLine(it); return; }
  if (seg.gap) { watchdog = setTimeout(() => playSeg(it), seg.gap); return; }
  if (seg.clip && playBoothHit(it.who, seg.clip)) {
    // The hit is the clip. Synthesis only fills the name or the yardage after it.
    if (seg.say && speakChunk(it, seg.say, it.set, () => playSeg(it))) return;
    watchdog = setTimeout(() => playSeg(it), 680);
    return;
  }
  const text = seg.say || seg.full || '';
  if (speakChunk(it, text, it.set, () => playSeg(it))) return;
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  watchdog = setTimeout(() => playSeg(it), 260 + words * (it.hype >= 2 ? 240 : 300));
}
function next() {
  clearTimeout(watchdog);
  const now = performance.now();
  while (queue.length && now - queue[0].at > queue[0].ttl) queue.shift();
  const it = queue.shift();
  if (!it) { cur = null; if (!boothClipOn()) duck(false); captionTimer = setTimeout(() => caption(null), 1600); return; }
  cur = it;
  clearTimeout(captionTimer);
  caption(it);
  it.segs = segmentsOf(it);
  it.set = voiceOf(it.who, it.hype ?? 0, voices.pbp === voices.color);
  it.si = 0;
  playSeg(it);
}

function caption(it) {
  if (!V.onCaption) return;
  V.onCaption(it && V.captions ? { who: it.who, name: CREW[it.who]?.name ?? '', text: it.text, hype: it.hype ?? 0 } : null);
}
