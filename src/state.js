// Shared UI state: the screen and settings object, timers, and the save and preference storage.
import { CAMERA_ALIASES, CAMERA_MODES, CAMERA_SHOTS, cameraDefaults } from './camera3d.js';
import * as LG from './league.js';

// Leagues live in numbered save slots. The key carries no data version (the league's own
// `version` field does, and migrateLeague upgrades it); a save from before slots, under the old
// single key, moves into the first free slot on load.
export const SAVE_SLOTS = 3;
const slotKey = (n) => `pokeball.league.${n}`;
const OLD_SAVE_KEY = 'pokeball.save.v1';
const PREF_KEY = 'pokeball.prefs.v1';
export const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const S = {
  screen: 'home', league: null, game: null, gameMeta: null,
  draft: { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false, needs: false },
  depthSel: null, coach: false, gameTab: 'log', busy: false, setup: { name: 'Pallet Starters', abbr: 'PAL', teams: 8, rounds: 24, legendaries: false, typeCap: true, clock: true, scheme: 'balanced' },
  banner: null, subSel: null, resultIdx: null, offCuts: null, importMsg: '',
  menuOpen: false, cam: 'gameplay', weatherFx: true, quality: 'auto',
  names: false, debug: false, csTab: null, cal: cameraDefaults(), calShot: 'gameplay',
  sound: true, vol: { master: 0.8, booth: 0.9, crowd: 0.8, fx: 0.8, music: 0.45 }, booth: true, boothVoice: true, captions: true, realCries: true, music: true, soundOpen: false,
  seenHelp: false, helpOpen: false, difficulty: 'pro', slot: 1, confirmDelete: null,
  online: false, net: null, netMsg: '',
};
export const timers = { draft: null, clock: null, auto: null, banner: null };
// A game the server plays (online, against a person). A league game against the AI is played on
// this machine like an offline one, and only its final goes to the server.
export const netGame = () => !!(S.online && S.gameMeta?.online && !S.gameMeta?.local);

// ---------- persistence ----------
function writeSlot(n, snap) {
  if (snap.league) LG.trimBoxScores(snap.league);
  localStorage.setItem(slotKey(n), JSON.stringify(snap));
}
export function save() {
  // An online league lives on the server. The three local slots stay as they were.
  if (S.online && S.gameMeta?.online) { S.netSave?.(); savePrefs(); return; }
  const snap = snapshot();
  if (snap.league) {
    try { writeSlot(S.slot, snap); } catch {
      // Storage is full: keep only this season's box scores and try once more. If that fails
      // too, play continues unsaved.
      try { LG.trimBoxScores(snap.league, 1); writeSlot(S.slot, snap); } catch { /* storage unavailable */ }
    }
  }
  savePrefs();
}
export function loadSaved(n = S.slot) {
  try {
    const s = JSON.parse(localStorage.getItem(slotKey(n)) || 'null');
    if (!s?.league) return null;
    LG.migrateLeague(s.league);
    LG.replaceRetiredInGame(s.game, s.league);
    return s;
  } catch { return null; }
}
// Every slot, with its saved league or null when empty.
export function savedSlots() {
  return Array.from({ length: SAVE_SLOTS }, (_, i) => ({ n: i + 1, save: loadSaved(i + 1) }));
}
export function firstFreeSlot() {
  return savedSlots().find((x) => !x.save)?.n ?? null;
}
export function deleteSlot(n) {
  try { localStorage.removeItem(slotKey(n)); } catch { /* ignore */ }
  if (n === S.slot) { S.league = null; if (!S.gameMeta?.quick) { S.game = null; S.gameMeta = null; } }
}
// Moves a save written before slots existed into the first free slot, and makes it the active one.
export function migrateStorage() {
  try {
    const old = localStorage.getItem(OLD_SAVE_KEY);
    if (old == null) return;
    const parsed = JSON.parse(old);
    if (!parsed?.league) { localStorage.removeItem(OLD_SAVE_KEY); return; }
    const free = firstFreeSlot();
    if (free == null) return;
    localStorage.setItem(slotKey(free), old);
    localStorage.removeItem(OLD_SAVE_KEY);
    S.slot = free;
    savePrefs();
  } catch { /* storage unavailable or the old save is unreadable: leave it */ }
}
export function snapshot() {
  if (S.league && !S.gameMeta?.quick) return { league: S.league, game: S.game, gameMeta: S.gameMeta, screen: S.screen };
  // S.league stays null until Continue, and quick games are never persisted, so keep the stored league and its game.
  const prev = loadSaved();
  const keep = prev?.gameMeta && !prev.gameMeta.quick;
  return { league: S.league ?? prev?.league ?? null, game: keep ? prev.game : null, gameMeta: keep ? prev.gameMeta : null, screen: keep ? prev.screen : 'home' };
}
export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (p) {
      S.coach = !!p.coach; S.watch = p.watch ?? S.coach; S.spectate = !!p.spectate; Object.assign(S.setup, p.setup ?? {});
      // Version 2 cameras: the old behind-the-offense "broadcast" is now "gameplay", the old
      // sideline shot is "broadcast" and behind-the-QB is "player focus".
      const cam = p.camV >= 2 ? p.cam : p.cam === 'broadcast' ? 'gameplay' : CAMERA_ALIASES[p.cam] ?? p.cam;
      if (CAMERA_MODES.some(([k]) => k === cam)) S.cam = cam;
      if (p.weatherFx != null) S.weatherFx = !!p.weatherFx;
      if (['auto', 'high', 'low'].includes(p.quality)) S.quality = p.quality;
      if (p.names != null) S.names = !!p.names;
      if (p.pips != null) S.pips = !!p.pips;
      if (p.sound != null) S.sound = !!p.sound;
      // The sound settings: the volumes, the booth (voices and captions), the cries, the music.
      if (p.vol && typeof p.vol === 'object') for (const k of Object.keys(S.vol)) if (typeof p.vol[k] === 'number' && p.vol[k] >= 0 && p.vol[k] <= 1) S.vol[k] = p.vol[k];
      for (const k of ['booth', 'boothVoice', 'captions', 'realCries', 'music']) if (p[k] != null) S[k] = !!p[k];
      if (p.seenHelp) S.seenHelp = true;
      if (['rookie', 'pro', 'legend'].includes(p.difficulty)) S.difficulty = p.difficulty;
      if (p.slot >= 1 && p.slot <= SAVE_SLOTS) S.slot = p.slot;
      // Lens settings saved before version 5 belong to the older framing and are dropped.
      if (p.camShots && p.camV === 5) for (const [k] of CAMERA_SHOTS) Object.assign(S.cal[k], p.camShots[k]);
    }
  } catch { /* ignore */ }
}
export function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ coach: S.coach, watch: S.watch, spectate: !!S.spectate, setup: S.setup, cam: S.cam, camV: 5, weatherFx: S.weatherFx, quality: S.quality, names: S.names, pips: !!S.pips, sound: S.sound, vol: S.vol, booth: S.booth, boothVoice: S.boothVoice, captions: S.captions, realCries: S.realCries, music: S.music, seenHelp: S.seenHelp, difficulty: S.difficulty, slot: S.slot, camShots: S.cal })); } catch { /* ignore */ }
}
export function clearTimers() {
  for (const k of Object.keys(timers)) { clearTimeout(timers[k]); clearInterval(timers[k]); timers[k] = null; }
}
