// Game sound, synthesized with the Web Audio API (no files to load): the crowd's murmur that
// swells on big plays and leans in when a runner breaks loose, its cheers, groans, "ooh"s and
// boos (for the home team, against the visitors), the referee's whistle, the quarterback's
// cadence, pads popping on contact, the ball into the hands, the boot of a kick, a horn for a
// home touchdown; the broadcast's stingers (brass and the stadium organ), the crowd's chants
// (claps, stomps, a drum and a whole section's voices), the menus' theme music and clicks, and
// the Pokémon's cries (the real ones from PokeAPI's cry archive when the device can play them,
// otherwise a cry synthesized for each species from its size).
//
// Everything runs through four buses with their own volume (effects, crowd, music, and the
// master), and the crowd and music dip while the booth is talking (see speech.js).
// Browsers only allow sound after the player has pressed a key or clicked, so the context
// starts on the first input.
import { CHANTS } from './kits.js';
import { PLAYERS } from './ratings.js';

let ctx = null, master = null, noiseBuf = null;
let fxBus = null, crowdBus = null, musicBus = null, OUT = null;
let crowdGain = null, crowdFilter = null, crowdHi = null, crowdHiGain = null;
let enabled = true, excite = 0, crowdBase = 0.05, tense = 0, mood = 1, ducked = false;
const VOL = { master: 0.8, fx: 0.8, crowd: 0.8, music: 0.5 };
const CRY = { real: true, cache: new Map() };

function start() {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { ctx = new AC(); } catch { ctx = null; return; }
  master = ctx.createGain();
  master.gain.value = enabled ? VOL.master : 0;
  // A gentle limiter so a touchdown's roar, the horn and a cry together never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);
  fxBus = ctx.createGain(); fxBus.gain.value = VOL.fx; fxBus.connect(master);
  crowdBus = ctx.createGain(); crowdBus.gain.value = VOL.crowd; crowdBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = VOL.music; musicBus.connect(master);
  OUT = fxBus;
  // Two seconds of pink-ish noise, reused by every sound that needs breath or rumble.
  const n = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  // The crowd: noise through a band of voices, always on, louder with excitement; and a
  // brighter layer of shouts and whistles on top that only comes up when the stadium is on
  // its feet.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  crowdFilter = ctx.createBiquadFilter(); crowdFilter.type = 'bandpass'; crowdFilter.frequency.value = 700; crowdFilter.Q.value = 0.6;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0.05;
  src.connect(crowdFilter).connect(crowdGain).connect(crowdBus);
  const src2 = ctx.createBufferSource();
  src2.buffer = noiseBuf; src2.loop = true; src2.playbackRate.value = 1.13;
  crowdHi = ctx.createBiquadFilter(); crowdHi.type = 'bandpass'; crowdHi.frequency.value = 2100; crowdHi.Q.value = 1.4;
  crowdHiGain = ctx.createGain(); crowdHiGain.gain.value = 0;
  src2.connect(crowdHi).connect(crowdHiGain).connect(crowdBus);
  src.start(); src2.start(0, 0.7);
  if (musicWant) startMusic(musicWant);
}

export function initAudio() {
  if (typeof window === 'undefined') return;
  const go = () => { start(); if (ctx?.state === 'suspended') ctx.resume(); };
  window.addEventListener('keydown', go, { capture: true });
  window.addEventListener('pointerdown', go, { capture: true });
}

export function setSound(on) {
  enabled = !!on;
  if (master) master.gain.setTargetAtTime(enabled ? VOL.master : 0, ctx.currentTime, 0.05);
}
export const soundOn = () => enabled;
// Volumes, 0..1 each: master, fx, crowd, music (the booth's own is in speech.js).
export function setVolumes(v = {}) {
  for (const k of Object.keys(VOL)) if (typeof v[k] === 'number' && Number.isFinite(v[k])) VOL[k] = Math.max(0, Math.min(1, v[k]));
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(enabled ? VOL.master : 0, t, 0.05);
  fxBus.gain.setTargetAtTime(VOL.fx, t, 0.05);
  setDuckedGains(t);
}
function setDuckedGains(t) {
  crowdBus.gain.setTargetAtTime(VOL.crowd * (ducked ? 0.62 : 1), t, ducked ? 0.08 : 0.4);
  musicBus.gain.setTargetAtTime(VOL.music * (ducked ? 0.45 : 1), t, ducked ? 0.08 : 0.4);
}
// The booth is talking: the crowd and the music sit under the voices.
export function duck(on) {
  if (ducked === !!on) return;
  ducked = !!on;
  if (ctx) setDuckedGains(ctx.currentTime);
}
// One-shot booth hits (touchdown, pick, sack, and the rest). Files are optional: a missing
// clip is skipped and speech synthesis says the line. Two voices, brighter play-by-play and
// a lower analyst, played on the master bus so the crowd and music still duck under them.
const BOOTH_HITS = ['touchdown', 'pick', 'sack', 'fumble', 'good', 'nogood', 'kickaway', 'break', 'house'];
const boothRaw = { pbp: {}, color: {} };
let boothVoices = 0, boothAsked = false;
export const boothClipOn = () => boothVoices > 0;
// Whether a committed clip is there for this hit (either voice can carry it).
export const hasBoothHit = (who, id) => !!(boothRaw[who]?.[id] ?? boothRaw.pbp?.[id]);
export function loadBoothClips() {
  // A page opened from disk can't fetch files next to it; synthesis carries every line then.
  if (boothAsked || typeof window === 'undefined' || typeof fetch !== 'function' || window.location?.protocol === 'file:') return;
  boothAsked = true;
  for (const who of ['pbp', 'color']) {
    for (const id of BOOTH_HITS) {
      const url = `booth/${who}-${id}.mp3`;
      fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => { if (buf) boothRaw[who][id] = buf; }).catch(() => {});
    }
  }
}
function startBoothBuffer(buf) {
  duck(true);
  boothVoices++;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.95;
  src.connect(g).connect(master);
  src.onended = () => { boothVoices = Math.max(0, boothVoices - 1); };
  src.start();
}
// Play a committed hit for this voice if the file decoded. Returns false when there is no clip.
export function playBoothHit(who, id) {
  const slot = boothRaw[who]?.[id] ? who : boothRaw.pbp?.[id] ? 'pbp' : null;
  if (!slot || !ready()) return false;
  const held = boothRaw[slot][id];
  if (held instanceof AudioBuffer) { startBoothBuffer(held); return true; }
  const copy = held.slice(0);
  ctx.decodeAudioData(copy).then((buf) => { boothRaw[slot][id] = buf; startBoothBuffer(buf); }).catch(() => {});
  return true;
}
export function setRealCries(on) { CRY.real = !!on; }

// The crowd's level follows the game: 0 calm .. 1 a touchdown.
export function crowd(k) {
  excite = Math.max(excite, k);
}
// A prime-time crowd hums louder between plays (0 a day game .. 1 under the lights).
export function setCrowdBase(night) { crowdBase = 0.05 + night * 0.03; }
// How the crowd sits before the snap: quiet for its own offense ('hush'), loud and rising for
// its defense ('loud'), or neither.
export function setCrowdMood(m) { mood = m === 'hush' ? 0.45 : m === 'loud' ? 1.9 : 1; }
// The play in progress: 0 nothing happening .. 1 a runner loose with the end zone ahead.
export function setTension(k) { tense = Math.max(0, Math.min(1, k || 0)); }
export function tickAudio(dt) {
  if (!ctx || !crowdGain) return;
  excite = Math.max(0, excite - dt * 0.25);
  const t = ctx.currentTime;
  const lift = Math.max(excite, tense * 0.8);
  crowdGain.gain.setTargetAtTime(crowdBase * mood + lift * 0.22, t, 0.15);
  crowdFilter.frequency.setTargetAtTime(700 + lift * 600 + (mood > 1 ? 250 : 0), t, 0.2);
  crowdHiGain.gain.setTargetAtTime(Math.max(0, lift - 0.25) * 0.1 + (mood > 1 ? 0.012 : 0), t, 0.2);
}

function noise(t0, dur, type, freq, q, peak, attack = 0.005, out = OUT) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
}
function tone(t0, dur, freq, peak, type = 'sine', to = null, out = OUT) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
const ready = () => ctx && enabled && ctx.state === 'running';

export function sfx(kind) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01;
  OUT = fxBus;
  switch (kind) {
    case 'whistle': {
      // A pea whistle: a bright tone warbling fast.
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
      const lg = ctx.createGain(); lg.gain.value = 140; lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + 0.32); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
      o.connect(g).connect(fxBus); o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
      break;
    }
    case 'snap': noise(t, 0.12, 'bandpass', 420, 1.2, 0.35); tone(t, 0.12, 180, 0.08, 'triangle', 120); break;
    case 'hit': noise(t, 0.22, 'lowpass', 500, 0.8, 0.55); tone(t, 0.2, 95, 0.3, 'sine', 45); noise(t, 0.05, 'bandpass', 2400, 2, 0.12); break;
    case 'bighit': noise(t, 0.35, 'lowpass', 700, 0.8, 0.8); tone(t, 0.3, 80, 0.45, 'sine', 38); noise(t, 0.06, 'bandpass', 2600, 2, 0.22); noise(t + 0.03, 0.08, 'bandpass', 1700, 1.5, 0.16); crowd(0.5); break;
    case 'catch': noise(t, 0.07, 'bandpass', 1500, 2, 0.3); tone(t, 0.08, 320, 0.08, 'triangle', 220); break;
    case 'throw': noise(t, 0.18, 'highpass', 1800, 0.7, 0.12, 0.04); noise(t + 0.05, 0.35, 'bandpass', 900, 3, 0.05, 0.12); break;
    // The boot of a kick: a deep thump and the leather.
    case 'kick': tone(t, 0.18, 120, 0.5, 'sine', 50); noise(t, 0.09, 'bandpass', 900, 1.2, 0.5); noise(t, 0.04, 'highpass', 3000, 0.7, 0.18); break;
    case 'pads': noise(t, 0.14, 'bandpass', 700, 1.4, 0.18); noise(t + 0.04, 0.1, 'bandpass', 1100, 1.6, 0.12); break;
    case 'juke': noise(t, 0.12, 'highpass', 2500, 0.8, 0.12, 0.02); tone(t, 0.07, 240, 0.05, 'triangle', 380); break;
    case 'cheer': crowdReact('roar'); break;
    case 'groan': crowdReact('groan'); break;
    // Type theater: a rising chime and a big hit for super effective, a dull thud for not very
    // effective, a hollow falling ping for no effect.
    case 'super': noise(t, 0.35, 'lowpass', 700, 0.8, 0.8); tone(t, 0.12, 660, 0.12, 'square', 990); tone(t + 0.09, 0.2, 990, 0.12, 'square', 1480); crowd(0.6); break;
    // A power kicking in: a rising three-note charge over a low swell.
    case 'power': tone(t, 0.14, 440, 0.1, 'square', 660); tone(t + 0.08, 0.14, 660, 0.1, 'square', 880); tone(t + 0.16, 0.3, 880, 0.12, 'triangle', 1760); noise(t, 0.5, 'bandpass', 900, 0.6, 0.25, 0.1); crowd(0.4); break;
    case 'weak': noise(t, 0.18, 'lowpass', 300, 0.8, 0.4); tone(t, 0.18, 140, 0.15, 'sine', 90); break;
    case 'immune': tone(t, 0.35, 880, 0.08, 'sine', 330); tone(t, 0.35, 1320, 0.04, 'triangle', 500); break;
    // The stadium horn for a home touchdown: a big detuned chord.
    case 'horn':
      for (const [f, d] of [[110, 0], [138.6, 4], [164.8, -4], [220, 7]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.05); g.gain.setValueAtTime(0.06, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
        o.connect(lp).connect(g).connect(crowdBus); o.start(t); o.stop(t + 1.7);
      }
      break;
    default: break;
  }
}

// The quarterback at the line: "Set!" then "Hut!", one voice through the vowel's formants.
export function bark(word = 'hut', level = 1) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01;
  const [f1, f2, dur, f0] = word === 'set' ? [530, 1840, 0.22, 150] : word === 'blue' ? [325, 900, 0.26, 140] : [640, 1190, 0.14, 165];
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.16 * level, t + 0.02); out.gain.setValueAtTime(0.16 * level, t + dur * 0.6); out.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  const bands = [[f1, 7, 1], [f2, 9, 0.45]].map(([f, q, w]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const bg = ctx.createGain(); bg.gain.value = w; b.connect(bg).connect(out); return b; });
  for (const d of [-8, 8]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.08, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.86, t + dur); o.detune.value = d;
    for (const b of bands) o.connect(b);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // The consonant: a breath on the front of the word.
  noise(t, 0.04, 'highpass', word === 'set' ? 4200 : 1800, 0.8, 0.05 * level, 0.003, fxBus);
  out.connect(fxBus);
}

// ---------- the crowd ----------
// A crowd's reaction. `kind`: 'roar' (a score), 'cheer' (a good play), 'ooh' (a big hit, a near
// miss), 'groan' (a bad one), 'boo' (a flag on the home team, a call it doesn't like),
// 'applause', 'away' (the visitors' fans in one corner of the stadium).
export function crowdReact(kind, level = 1) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  OUT = crowdBus;
  switch (kind) {
    case 'roar':
      crowd(1);
      noise(t, 2.6, 'bandpass', 1300, 0.5, 0.28 * level, 0.25);
      noise(t + 0.1, 2.2, 'bandpass', 2600, 1.2, 0.07 * level, 0.3);
      for (let i = 0; i < 4; i++) whistleFan(t + 0.3 + Math.random() * 1.6, level);
      shout(t + 0.05, 'ah', 210, 1.8, 0.09 * level, 260);
      break;
    case 'cheer': crowd(0.6); noise(t, 1.4, 'bandpass', 1200, 0.5, 0.17 * level, 0.15); shout(t, 'eh', 220, 0.9, 0.05 * level, 260); if (Math.random() < 0.5) whistleFan(t + 0.4, level * 0.7); break;
    case 'ooh': crowd(0.4); shout(t, 'oo', 180, 0.9, 0.12 * level, 150); noise(t, 0.8, 'bandpass', 500, 0.8, 0.07 * level, 0.1); break;
    case 'groan': crowd(0.3); shout(t, 'oh', 175, 1.0, 0.07 * level, 120); noise(t, 1.0, 'lowpass', 400, 0.7, 0.16 * level, 0.15); break;
    case 'boo': crowd(0.35); shout(t, 'oo', 128, 1.6, 0.13 * level, 112); shout(t + 0.15, 'oo', 112, 1.4, 0.09 * level, 100); break;
    case 'applause': {
      crowd(0.25);
      const n = Math.round(26 * level);
      for (let i = 0; i < n; i++) noise(t + Math.random() * 1.4, 0.07, 'bandpass', 1200 + Math.random() * 1300, 1.2, 0.05 * level, 0.002);
      break;
    }
    case 'away': noise(t, 1.2, 'bandpass', 1600, 0.9, 0.06 * level, 0.15); shout(t, 'eh', 240, 0.7, 0.025 * level, 270); break;
    default: break;
  }
  OUT = fxBus;
}
// One fan's two-finger whistle.
function whistleFan(t0, level) {
  const f = 1900 + Math.random() * 900;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * 1.25, t0 + 0.25); o.frequency.linearRampToValueAtTime(f * 1.1, t0 + 0.5);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.022 * level, t0 + 0.05); g.gain.setValueAtTime(0.022 * level, t0 + 0.4); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.55);
  o.connect(g).connect(crowdBus); o.start(t0); o.stop(t0 + 0.6);
}

// ---------- the broadcast ----------
// A brass section: two detuned saws through a filter that opens as the note swells.
function brass(t0, freq, dur, peak = 0.07, out = OUT) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(freq * 1.5, t0); f.frequency.linearRampToValueAtTime(freq * 6, t0 + 0.08); f.frequency.exponentialRampToValueAtTime(freq * 2.5, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.04); g.gain.setValueAtTime(peak * 0.85, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  for (const d of [-6, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d;
    o.connect(f); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  f.connect(g).connect(out);
}
// The stadium organ: a few drawbars of sine harmonics and a slow tremolo.
function organ(t0, freq, dur, peak = 0.05, out = OUT) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.015); g.gain.setValueAtTime(peak, t0 + Math.max(0.02, dur - 0.05)); g.gain.linearRampToValueAtTime(0, t0 + dur);
  const trem = ctx.createOscillator(); trem.frequency.value = 6.2;
  const tg = ctx.createGain(); tg.gain.value = peak * 0.18; trem.connect(tg).connect(g.gain);
  for (const [h, w] of [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * h;
    const og = ctx.createGain(); og.gain.value = w * 0.5;
    o.connect(og).connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  trem.start(t0); trem.stop(t0 + dur + 0.05);
  g.connect(out);
}
const N = (semi) => 261.63 * 2 ** (semi / 12); // semitones from middle C

// The stingers the broadcast cuts to: its open, a touchdown, a takeaway, a field goal, the
// end of a quarter and the final.
export function stinger(kind) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  OUT = musicBus;
  switch (kind) {
    case 'open':
      [[0, 0, 0.18], [0.18, 7, 0.18], [0.36, 12, 0.18], [0.54, 16, 0.5]].forEach(([d, n, l]) => brass(t + d, N(n - 12), l));
      [0, 4, 7, 12].forEach((n) => brass(t + 1.1, N(n - 12), 1.3, 0.045));
      noise(t + 1.1, 0.6, 'highpass', 6000, 0.7, 0.05, 0.01);
      [0, 0.18, 0.36, 0.54].forEach((d) => kickDrum(t + d, 0.5));
      break;
    case 'td':
      [0, 4, 7, 12, 16].forEach((n, i) => brass(t + i * 0.09, N(n - 5), 0.2));
      [0, 4, 7, 12].forEach((n) => brass(t + 0.5, N(n - 5), 1.1, 0.05));
      noise(t + 0.5, 0.9, 'highpass', 5000, 0.7, 0.07, 0.01);
      kickDrum(t + 0.5, 0.8);
      break;
    case 'to':
      [[0, 7], [0.16, 6], [0.32, 3]].forEach(([d, n]) => organ(t + d, N(n), 0.15, 0.06));
      [0, 3, 7].forEach((n) => organ(t + 0.5, N(n - 12), 0.7, 0.045));
      break;
    case 'fg': organ(t, N(12), 0.14, 0.05); organ(t + 0.16, N(16), 0.14, 0.05); organ(t + 0.32, N(19), 0.5, 0.05); break;
    case 'quarter': [[0, 16], [0.35, 12], [0.7, 7]].forEach(([d, n]) => tone(t + d, 0.9, N(n), 0.06, 'sine')); break;
    case 'final':
      [[0, 0], [0.2, 4], [0.4, 7], [0.6, 12]].forEach(([d, n]) => brass(t + d, N(n - 12), 0.22));
      [0, 4, 7, 12, 16].forEach((n) => brass(t + 0.9, N(n - 12), 1.8, 0.04));
      kickDrum(t + 0.9, 0.8);
      break;
    // The stadium organ's "charge!" for a big home moment.
    case 'charge':
      [[0, 7], [0.14, 12], [0.28, 16], [0.42, 19], [0.7, 16], [0.84, 19]].forEach(([d, n], i) => organ(t + d, N(n), i === 5 ? 0.5 : 0.12, 0.05));
      break;
    default: break;
  }
  OUT = fxBus;
}
function kickDrum(t0, peak, out = OUT) { tone(t0, 0.3, 110, 0.3 * peak, 'sine', 45, out); noise(t0, 0.05, 'lowpass', 900, 0.8, 0.12 * peak, 0.002, out); }
function snare(t0, peak, out = OUT) { noise(t0, 0.16, 'bandpass', 1800, 0.8, 0.16 * peak, 0.002, out); tone(t0, 0.08, 190, 0.06 * peak, 'triangle', 140, out); }
function hat(t0, peak, out = OUT) { noise(t0, 0.035, 'highpass', 7000, 0.7, 0.05 * peak, 0.001, out); }

// ---------- chants ----------
// A crowd's clap: a dozen hands a few milliseconds apart.
function clap(t0, peak) { for (let i = 0; i < 6; i++) noise(t0 + Math.random() * 0.03, 0.09, 'bandpass', 1300 + Math.random() * 900, 1.1, peak * 0.4, 0.002); }
function stomp(t0, peak) { noise(t0, 0.3, 'lowpass', 180, 0.8, peak * 1.2, 0.01); tone(t0, 0.25, 70, peak * 0.8, 'sine', 45); }
function drum(t0, peak) { tone(t0, 0.45, 95, peak * 1.1, 'sine', 52); noise(t0, 0.18, 'lowpass', 400, 0.8, peak * 0.6); }
// A section of voices on one vowel: detuned saws through the vowel's two formants.
const VOWELS = { ah: [800, 1150], eh: [530, 1840], oh: [450, 800], oo: [325, 700], ee: [270, 2300] };
function shout(t0, vowel, freq, dur, peak, to = null) {
  const [f1, f2] = VOWELS[vowel] ?? VOWELS.ah;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(peak, t0 + 0.06); out.gain.setValueAtTime(peak, t0 + Math.max(0.07, dur - 0.08)); out.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
  const bands = [[f1, 6, 1], [f2, 8, 0.5]].map(([f, q, w]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const bg = ctx.createGain(); bg.gain.value = w; b.connect(bg).connect(out); return b; });
  for (let i = 0; i < 7; i++) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = freq * (1 + (Math.random() - 0.5) * 0.04) * (i % 3 === 2 ? 2 : 1);
    o.frequency.setValueAtTime(f0, t0);
    if (to) o.frequency.exponentialRampToValueAtTime((to / freq) * f0, t0 + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 4 + Math.random() * 2; const vg = ctx.createGain(); vg.gain.value = f0 * 0.012; vib.connect(vg).connect(o.frequency);
    for (const b of bands) o.connect(b);
    const st = t0 + Math.random() * 0.05;
    o.start(st); vib.start(st); o.stop(t0 + dur + 0.1); vib.stop(t0 + dur + 0.1);
  }
  out.connect(crowdBus);
}
// The home crowd's "DEE-FENSE", clap clap.
const DEFENSE = { bpm: 128, beats: 4, steps: [['shout', 0, 'ee', 196, 0.32], ['shout', 0.75, 'eh', 165, 0.55], ['clap', 2], ['clap', 2.5]] };
let chantUntil = 0;
// A chant from kits.js (or the defense chant), sung `times` times through. One at a time: a
// chant asked for while another is going is skipped.
export function chant(key, { times = 2, level = 1 } = {}) {
  if (!ready()) return false;
  const c = key === 'defense' ? DEFENSE : CHANTS[key];
  if (!c || ctx.currentTime < chantUntil) return false;
  const beat = 60 / c.bpm, t0 = ctx.currentTime + 0.05, peak = 0.1 * level;
  OUT = crowdBus;
  for (let r = 0; r < times; r++) {
    const base = t0 + r * c.beats * beat;
    for (const [kind, at, a, b, c2, d] of c.steps) {
      const t = base + at * beat;
      if (kind === 'clap') clap(t, peak);
      else if (kind === 'stomp') stomp(t, peak);
      else if (kind === 'drum') drum(t, peak);
      else if (kind === 'organ') organ(t, a, b * beat, peak * 0.5);
      else if (kind === 'shout') shout(t, a, b, c2 * beat, peak * 0.55, d ?? null);
    }
  }
  OUT = fxBus;
  chantUntil = t0 + times * c.beats * beat;
  crowd(0.3);
  return true;
}

// ---------- cries ----------
// A Pokémon's cry: the real one, from PokeAPI's archive of the games' cries (fetched once and
// kept), when the device can decode it; otherwise one synthesized from the species: its size
// sets the pitch (a Snorlax rumbles, a Flabébé chirps), its number shapes the syllables, so
// every species keeps its own call.
const CRY_URL = (id) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
function loadCry(id) {
  if (!CRY.real || typeof fetch === 'undefined' || !ctx) return Promise.resolve(null);
  if (!CRY.cache.has(id)) {
    CRY.cache.set(id, fetch(CRY_URL(id)).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (buf ? new Promise((res) => { try { ctx.decodeAudioData(buf, res, () => res(null)); } catch { res(null); } }) : null))
      .catch(() => null));
  }
  return CRY.cache.get(id);
}
// Fetch the cries of a game's lineups ahead of time, so the big moments don't wait on the network.
export function preloadCries(ids) {
  if (!ctx || !CRY.real) return;
  for (const id of new Set(ids)) if (PLAYERS[id]) loadCry(id);
}
let lastCry = 0;
export function cry(id, level = 1) {
  if (!ready() || !PLAYERS[id]) return;
  const now = ctx.currentTime;
  if (now - lastCry < 0.6) return;
  lastCry = now;
  const p = loadCry(id);
  let done = false;
  // A cry that isn't in hand within a beat isn't worth waiting for: the moment has passed.
  const fallback = setTimeout(() => { if (!done) { done = true; synthCry(id, level); } }, 450);
  p.then((buf) => {
    if (done) return;
    done = true; clearTimeout(fallback);
    if (!buf) { synthCry(id, level); return; }
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.42 * level;
    s.connect(g).connect(fxBus); s.start(ctx.currentTime + 0.01);
  });
}
function synthCry(id, level) {
  if (!ready()) return;
  const P = PLAYERS[id];
  let seed = id * 2654435761 >>> 0;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const kgW = Math.max(0.1, P.weight / 10);
  const f0 = Math.max(90, Math.min(1100, 1100 / Math.pow(kgW, 0.28)));
  const t0 = ctx.currentTime + 0.01;
  const n = 1 + Math.floor(r() * 3);
  let t = t0;
  for (let i = 0; i < n; i++) {
    const dur = 0.1 + r() * 0.22 + (i === n - 1 ? 0.15 : 0);
    const a = f0 * (0.8 + r() * 0.5), b = a * (0.6 + r() * 1.1);
    const o = ctx.createOscillator(); o.type = r() < 0.5 ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + dur);
    const fm = ctx.createOscillator(); fm.frequency.value = 20 + r() * 50;
    const fg = ctx.createGain(); fg.gain.value = a * (0.03 + r() * 0.12); fm.connect(fg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = a * (2 + r() * 2); f.Q.value = 1.5 + r() * 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13 * level, t + 0.02); g.gain.setValueAtTime(0.12 * level, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(f).connect(g).connect(fxBus);
    o.start(t); fm.start(t); o.stop(t + dur + 0.05); fm.stop(t + dur + 0.05);
    t += dur + 0.03 + r() * 0.05;
  }
}

// ---------- the menus ----------
// Clicks for the buttons, a chime for a draft pick or a signing.
export function ui(kind = 'click') {
  if (!ready()) return;
  const t = ctx.currentTime + 0.005;
  switch (kind) {
    case 'click': tone(t, 0.05, 1250, 0.035, 'triangle', 900, fxBus); noise(t, 0.02, 'highpass', 5000, 0.7, 0.02, 0.001, fxBus); break;
    case 'tab': tone(t, 0.06, 700, 0.04, 'triangle', 1050, fxBus); break;
    case 'pick': [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.06, 0.22, N(s + 12), 0.04, 'triangle', null, fxBus)); kickDrum(t, 0.4, fxBus); break;
    case 'back': tone(t, 0.07, 900, 0.035, 'triangle', 600, fxBus); break;
    default: break;
  }
}

// The theme for the menus: a four-bar sports-broadcast loop (drums, a bass line, organ chords
// and a brass hook every other time round), scheduled a little ahead on the audio clock.
// 'menu' is in a major key; 'draft' is the same tune in minor, a little quicker, for the war room.
let musicWant = null, music = null;
const THEMES = {
  menu: { bpm: 104, prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], hook: [7, 9, 12, 14, 12, 9, 7, 4] },
  draft: { bpm: 112, prog: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -2, 2]], hook: [7, 8, 12, 15, 12, 8, 7, 3] },
};
export function setMusic(theme) {
  theme = THEMES[theme] ? theme : null;
  musicWant = theme;
  if (!ctx) return;
  if (!theme) { stopMusic(); return; }
  if (music?.theme === theme) return;
  stopMusic();
  startMusic(theme);
}
function stopMusic() {
  if (!music) return;
  clearInterval(music.iv);
  const g = music.gain;
  g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  setTimeout(() => g.disconnect(), 1500);
  music = null;
}
function startMusic(theme) {
  if (!ctx) return;
  const T = THEMES[theme];
  const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(musicBus);
  gain.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
  const beat = 60 / T.bpm;
  music = { theme, gain, next: ctx.currentTime + 0.1, step: 0, iv: 0 };
  const M = music;
  const sched = () => {
    if (music !== M || !enabled || ctx.state !== 'running') { if (music === M) M.next = ctx.currentTime + 0.1; return; }
    while (M.next < ctx.currentTime + 0.6) {
      const s = M.step, t = M.next, bar = Math.floor(s / 8) % 4, half = s % 8, loop = Math.floor(s / 32);
      const chord = T.prog[bar];
      // Eighth notes: kick on 1 and 3, snare on 2 and 4, hats between.
      if (half % 4 === 0) kickDrum(t, 0.55, gain);
      if (half % 4 === 2) snare(t, 0.55, gain);
      hat(t + beat * 0.25, 0.6, gain); hat(t, 0.4, gain);
      if (half === 0) chord.forEach((n) => organ(t, N(n), beat * 3.6, 0.018, gain));
      // Bass: root on the beat, the fifth on the "and" of two.
      if (half % 2 === 0) tone(t, beat * 0.45, N(chord[0] - 24), 0.07, 'triangle', null, gain);
      if (half === 3) tone(t, beat * 0.4, N(chord[0] - 17), 0.05, 'triangle', null, gain);
      if (loop % 2 === 1 && bar < 2) { const n = T.hook[(bar * 8 + half) % T.hook.length]; if (half % 2 === 0) brass(t, N(n - 12), beat * 0.42, 0.028, gain); }
      M.step++;
      M.next += beat / 2;
    }
  };
  M.iv = setInterval(sched, 150);
  sched();
}
