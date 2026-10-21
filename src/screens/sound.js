// The sound settings, in the game menu and behind the speaker button in the top bar: sound on
// or off, a volume for each part of the mix (the booth, the crowd, the effects, the music), the
// booth's voices and captions, the real Pokémon cries and the menu music. Also picks the music
// for each screen and the button clicks.
import { S, savePrefs } from '../state.js';
import { setMusic, setRealCries, setSound, setVolumes, soundOn, ui } from '../audio.js';
import { stopTalking, talk, voiceNames } from '../speech.js';
import { CREW } from '../commentary.js';
import { applyBoothPrefs } from './booth.js';

export function applySound() {
  setSound(S.sound);
  setVolumes(S.vol);
  setRealCries(S.realCries);
  applyBoothPrefs();
  syncMusic();
}
// The menus get the theme (the war-room version in the draft room); a game has the stadium.
export function syncMusic() {
  setMusic(!S.music || !S.sound || S.screen === 'game' ? null : S.screen === 'draft' ? 'draft' : 'menu');
}

const SLIDERS = [['master', 'Master'], ['booth', 'Commentary'], ['crowd', 'Crowd'], ['fx', 'Effects'], ['music', 'Music']];
export function soundPanelHtml() {
  const v = voiceNames();
  const slider = ([k, label]) => `<label class="snd-row"><span>${label}</span><input type="range" id="snd-${k}" min="0" max="100" step="5" value="${Math.round((S.vol[k] ?? 0) * 100)}" aria-label="${label} volume"><output id="sndv-${k}">${Math.round((S.vol[k] ?? 0) * 100)}</output></label>`;
  const check = (id, on, text) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${text}</label>`;
  return `<div class="snd">
    ${check('g-sound', S.sound, 'Sound on <kbd>U</kbd>')}
    ${SLIDERS.map(slider).join('')}
    ${check('snd-booth', S.booth !== false, `Commentary: ${CREW.pbp.name} and ${CREW.color.name} call the game`)}
    ${check('snd-voice', S.boothVoice !== false, v ? 'Spoken (off: captions only)' : 'Spoken (this browser has no speech voices: captions only)')}
    ${check('snd-captions', S.captions !== false, 'Captions for the booth')}
    ${check('snd-cries', S.realCries !== false, 'Real Pokémon cries (downloaded from PokeAPI as they play)')}
    ${check('snd-music', S.music !== false, 'Menu music')}
    ${v ? `<p class="small muted snd-voices">Voices: ${v.same ? `${v.pbp} (one voice on this device, pitched apart)` : `${v.pbp} and ${v.color}`}</p>` : ''}
    <button class="btn tiny" data-act="sndtest">Test the booth</button>
  </div>`;
}

// A slider moved or a box ticked. Returns whether it was one of these.
export function soundInput(t) {
  const m = /^snd-(master|booth|crowd|fx|music)$/.exec(t.id ?? '');
  if (m) {
    S.vol[m[1]] = Math.max(0, Math.min(1, Number(t.value) / 100));
    const o = document.getElementById(`sndv-${m[1]}`);
    if (o) o.textContent = String(Math.round(S.vol[m[1]] * 100));
    setVolumes(S.vol); applyBoothPrefs(); savePrefs();
    return true;
  }
  const flags = { 'g-sound': 'sound', 'snd-booth': 'booth', 'snd-voice': 'boothVoice', 'snd-captions': 'captions', 'snd-cries': 'realCries', 'snd-music': 'music' };
  const k = flags[t.id];
  if (!k) return false;
  S[k] = t.checked;
  if (k === 'booth' && !S.booth) stopTalking();
  applySound(); savePrefs();
  syncSoundButton();
  return true;
}
// Mute or unmute everything (the U key, the speaker button's long press).
export function toggleMute() {
  S.sound = !S.sound;
  applySound(); savePrefs();
  if (!S.sound) stopTalking();
  syncSoundButton();
  const box = document.getElementById('g-sound');
  if (box) box.checked = S.sound;
}
export function soundTest() {
  stopTalking();
  talk({ who: 'pbp', text: `${CREW.pbp.name} here, checking the levels in the booth.`, pri: 1, hype: 0 });
  talk({ who: 'color', text: `And ${CREW.color.name} with you. Sounds good, Mack!`, pri: 1, hype: 1 });
}

// The speaker button in the top bar: opens the panel; shows a muted speaker with the sound off.
export function soundButtonHtml() {
  return `<div class="sndwrap"><button class="sndbtn ${S.sound ? '' : 'off'}" id="sndbtn" data-act="sound" aria-label="Sound settings" aria-expanded="${!!S.soundOpen}" title="Sound (U mutes)"><svg class="spk" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${S.sound ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg></button>
    ${S.soundOpen ? `<div class="sndpop card" role="dialog" aria-label="Sound">${soundPanelHtml()}</div>` : ''}</div>`;
}
function syncSoundButton() {
  const b = document.getElementById('sndbtn');
  if (!b) return;
  const w = document.createElement('div');
  w.innerHTML = soundButtonHtml();
  b.replaceWith(w.querySelector('#sndbtn'));
}
// A click on a button: a soft tick (the game's own sounds cover the field).
export function clickSound(act) {
  if (!soundOn()) return;
  if (act === 'go' || act === 'gametab' || act === 'cstab') ui('tab');
  else if (act === 'home' || act === 'back' || act === 'closepop') ui('back');
  else ui('click');
}
