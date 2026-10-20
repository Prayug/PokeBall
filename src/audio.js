// Game sound, synthesized with the Web Audio API (no files to load): the crowd's murmur that
// swells on big plays, the referee's whistle, the snap count, pads popping on contact, the
// ball into the hands, and a roar for touchdowns. Browsers only allow sound after the player
// has pressed a key or clicked, so the context starts on the first input.
let ctx = null, master = null, crowdGain = null, crowdFilter = null, noiseBuf = null;
let enabled = true, excite = 0;

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
export function tickAudio(dt) {
  if (!ctx || !crowdGain) return;
  excite = Math.max(0, excite - dt * 0.25);
  crowdGain.gain.setTargetAtTime(0.05 + excite * 0.22, ctx.currentTime, 0.15);
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
