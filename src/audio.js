// Game sound, synthesized with the Web Audio API (no files to load): the crowd's murmur that
// swells on big plays, the referee's whistle, the snap count, pads popping on contact, the
// ball into the hands, and a roar for touchdowns; the broadcast's stingers (brass and the
// stadium organ) and the crowd's chants (claps, stomps, a drum and a whole section's voices).
// Browsers only allow sound after the player has pressed a key or clicked, so the context
// starts on the first input.
import { CHANTS } from './kits.js';

let ctx = null, master = null, crowdGain = null, crowdFilter = null, noiseBuf = null;
let enabled = true, excite = 0, crowdBase = 0.05;

function start() {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { ctx = new AC(); } catch { ctx = null; return; }
  master = ctx.createGain();
  master.gain.value = enabled ? 0.7 : 0;
  master.connect(ctx.destination);
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
  // The crowd: noise through a band of voices, always on, louder with excitement.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  crowdFilter = ctx.createBiquadFilter(); crowdFilter.type = 'bandpass'; crowdFilter.frequency.value = 700; crowdFilter.Q.value = 0.6;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0.05;
  src.connect(crowdFilter).connect(crowdGain).connect(master);
  src.start();
}

export function initAudio() {
  if (typeof window === 'undefined') return;
  const go = () => { start(); if (ctx?.state === 'suspended') ctx.resume(); };
  window.addEventListener('keydown', go, { capture: true });
  window.addEventListener('pointerdown', go, { capture: true });
}

export function setSound(on) {
  enabled = !!on;
  if (master) master.gain.setTargetAtTime(enabled ? 0.7 : 0, ctx.currentTime, 0.05);
}

// The crowd's level follows the game: 0 calm .. 1 a touchdown.
export function crowd(k) {
  excite = Math.max(excite, k);
}
// A prime-time crowd hums louder between plays (0 a day game .. 1 under the lights).
export function setCrowdBase(night) { crowdBase = 0.05 + night * 0.03; }
export function tickAudio(dt) {
  if (!ctx || !crowdGain) return;
  excite = Math.max(0, excite - dt * 0.25);
  crowdGain.gain.setTargetAtTime(crowdBase + excite * 0.22, ctx.currentTime, 0.15);
  crowdFilter.frequency.setTargetAtTime(700 + excite * 600, ctx.currentTime, 0.2);
}

function noise(t0, dur, type, freq, q, peak, attack = 0.005) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
}
function tone(t0, dur, freq, peak, type = 'sine', to = null) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export function sfx(kind) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'whistle': {
      // A pea whistle: a bright tone warbling fast.
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
      const lg = ctx.createGain(); lg.gain.value = 140; lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + 0.32); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
      o.connect(g).connect(master); o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
      break;
    }
    case 'snap': noise(t, 0.12, 'bandpass', 420, 1.2, 0.35); tone(t, 0.12, 180, 0.08, 'triangle', 120); break;
    case 'hit': noise(t, 0.22, 'lowpass', 500, 0.8, 0.55); tone(t, 0.2, 95, 0.3, 'sine', 45); break;
    case 'bighit': noise(t, 0.35, 'lowpass', 700, 0.8, 0.8); tone(t, 0.3, 80, 0.45, 'sine', 38); crowd(0.5); break;
    case 'catch': noise(t, 0.07, 'bandpass', 1500, 2, 0.3); tone(t, 0.08, 320, 0.08, 'triangle', 220); break;
    case 'throw': noise(t, 0.18, 'highpass', 1800, 0.7, 0.12, 0.04); break;
    case 'cheer': crowd(1); noise(t, 2.2, 'bandpass', 1300, 0.5, 0.25, 0.25); break;
    case 'groan': crowd(0.35); noise(t, 1.0, 'lowpass', 400, 0.7, 0.18, 0.15); break;
    // Type theater: a rising chime and a big hit for super effective, a dull thud for not very
    // effective, a hollow falling ping for no effect.
    case 'super': noise(t, 0.35, 'lowpass', 700, 0.8, 0.8); tone(t, 0.12, 660, 0.12, 'square', 990); tone(t + 0.09, 0.2, 990, 0.12, 'square', 1480); crowd(0.6); break;
    // A power kicking in: a rising three-note charge over a low swell.
    case 'power': tone(t, 0.14, 440, 0.1, 'square', 660); tone(t + 0.08, 0.14, 660, 0.1, 'square', 880); tone(t + 0.16, 0.3, 880, 0.12, 'triangle', 1760); noise(t, 0.5, 'bandpass', 900, 0.6, 0.25, 0.1); crowd(0.4); break;
    case 'weak': noise(t, 0.18, 'lowpass', 300, 0.8, 0.4); tone(t, 0.18, 140, 0.15, 'sine', 90); break;
    case 'immune': tone(t, 0.35, 880, 0.08, 'sine', 330); tone(t, 0.35, 1320, 0.04, 'triangle', 500); break;
    default: break;
  }
}

// ---------- the broadcast ----------
// A brass section: two detuned saws through a filter that opens as the note swells.
function brass(t0, freq, dur, peak = 0.07) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(freq * 1.5, t0); f.frequency.linearRampToValueAtTime(freq * 6, t0 + 0.08); f.frequency.exponentialRampToValueAtTime(freq * 2.5, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.04); g.gain.setValueAtTime(peak * 0.85, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  for (const d of [-6, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d;
    o.connect(f); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  f.connect(g).connect(master);
}
// The stadium organ: a few drawbars of sine harmonics and a slow tremolo.
function organ(t0, freq, dur, peak = 0.05) {
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
  g.connect(master);
}
const N = (semi) => 261.63 * 2 ** (semi / 12); // semitones from middle C

// The stingers the broadcast cuts to: its open, a touchdown, a takeaway, a field goal, the
// end of a quarter and the final.
export function stinger(kind) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.02;
  switch (kind) {
    case 'open':
      [[0, 0, 0.18], [0.18, 7, 0.18], [0.36, 12, 0.18], [0.54, 16, 0.5]].forEach(([d, n, l]) => brass(t + d, N(n - 12), l));
      [0, 4, 7, 12].forEach((n) => brass(t + 1.1, N(n - 12), 1.3, 0.045));
      noise(t + 1.1, 0.6, 'highpass', 6000, 0.7, 0.05, 0.01);
      break;
    case 'td':
      [0, 4, 7, 12, 16].forEach((n, i) => brass(t + i * 0.09, N(n - 5), 0.2));
      [0, 4, 7, 12].forEach((n) => brass(t + 0.5, N(n - 5), 1.1, 0.05));
      noise(t + 0.5, 0.9, 'highpass', 5000, 0.7, 0.07, 0.01);
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
      break;
    default: break;
  }
}

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
  out.connect(master);
}
// The home crowd's "DEE-FENSE", clap clap.
const DEFENSE = { bpm: 128, beats: 4, steps: [['shout', 0, 'ee', 196, 0.32], ['shout', 0.75, 'eh', 165, 0.55], ['clap', 2], ['clap', 2.5]] };
let chantUntil = 0;
// A chant from kits.js (or the defense chant), sung `times` times through. One at a time: a
// chant asked for while another is going is skipped.
export function chant(key, { times = 2, level = 1 } = {}) {
  if (!ctx || !enabled || ctx.state !== 'running') return false;
  const c = key === 'defense' ? DEFENSE : CHANTS[key];
  if (!c || ctx.currentTime < chantUntil) return false;
  const beat = 60 / c.bpm, t0 = ctx.currentTime + 0.05, peak = 0.1 * level;
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
  chantUntil = t0 + times * c.beats * beat;
  crowd(0.3);
  return true;
}
