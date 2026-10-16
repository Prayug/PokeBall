// Shared UI state: the screen and settings object, timers, and the save and preference storage.
import { CAMERA_ALIASES, CAMERA_MODES, CAMERA_SHOTS, cameraDefaults } from './camera3d.js';
import * as LG from './league.js';

const SAVE_KEY = 'pokeball.save.v1';
const PREF_KEY = 'pokeball.prefs.v1';
export const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const S = {
  screen: 'home', league: null, game: null, gameMeta: null,
  draft: { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false, needs: false },
  depthSel: null, coach: false, gameTab: 'log', busy: false, setup: { name: 'Pallet Starters', abbr: 'PAL', rounds: 24, legendaries: false, typeCap: true, clock: true },
  banner: null, subSel: null, resultIdx: null, offCuts: null, importMsg: '',
  menuOpen: false, cam: 'gameplay', weatherFx: true, quality: 'auto',
  names: false, debug: false, csTab: null, cal: cameraDefaults(), calShot: 'gameplay',
  sound: true, seenHelp: false, helpOpen: false, difficulty: 'pro',
};
export const timers = { draft: null, clock: null, auto: null, banner: null };

// ---------- persistence ----------
export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
    savePrefs();
  } catch { /* storage unavailable: play continues unsaved */ }
}
export function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s?.league) LG.migrateLeague(s.league);
    return s;
  } catch { return null; }
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
      S.coach = !!p.coach; S.watch = p.watch ?? S.coach; Object.assign(S.setup, p.setup ?? {});
      // Version 2 cameras: the old behind-the-offense "broadcast" is now "gameplay", the old
      // sideline shot is "broadcast" and behind-the-QB is "player focus".
      const cam = p.camV >= 2 ? p.cam : p.cam === 'broadcast' ? 'gameplay' : CAMERA_ALIASES[p.cam] ?? p.cam;
      if (CAMERA_MODES.some(([k]) => k === cam)) S.cam = cam;
      if (p.weatherFx != null) S.weatherFx = !!p.weatherFx;
      if (['auto', 'high', 'low'].includes(p.quality)) S.quality = p.quality;
      if (p.names != null) S.names = !!p.names;
      if (p.pips != null) S.pips = !!p.pips;
      if (p.sound != null) S.sound = !!p.sound;
      if (p.seenHelp) S.seenHelp = true;
      if (['rookie', 'pro', 'legend'].includes(p.difficulty)) S.difficulty = p.difficulty;
      // Lens settings saved before version 3 belong to the older framing and are dropped.
      if (p.camShots && p.camV === 4) for (const [k] of CAMERA_SHOTS) Object.assign(S.cal[k], p.camShots[k]);
    }
  } catch { /* ignore */ }
}
export function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ coach: S.coach, watch: S.watch, setup: S.setup, cam: S.cam, camV: 4, weatherFx: S.weatherFx, quality: S.quality, names: S.names, pips: !!S.pips, sound: S.sound, seenHelp: S.seenHelp, difficulty: S.difficulty, camShots: S.cal })); } catch { /* ignore */ }
}
export function clearTimers() {
  for (const k of Object.keys(timers)) { clearTimeout(timers[k]); clearInterval(timers[k]); timers[k] = null; }
}
