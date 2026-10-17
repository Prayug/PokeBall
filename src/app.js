// PokeBall UI entry: picks the screen to render and routes clicks, keys and form input to the
// screens in screens/ (home, draft room and grades, depth chart, season hub, offseason, game).
import { applyGrowth, autoDepthChart } from './ratings.js';
import { createGame, manualSub, simUntil } from './engine.js';
import { worldSpots } from './live.js';
import { initAudio, setSound } from './audio.js';
import { cameraDefaults } from './camera3d.js';
import * as LG from './league.js';
import { S, clearTimers, loadPrefs, loadSaved, reduceMotion, save, savePrefs, snapshot, timers } from './state.js';
import { download, user } from './ui.js';
import { importSave, loadSnapshot, renderHome } from './screens/home.js';
import { boardRowsHtml, detailHtml, draftTick, renderDraft, renderGrades, userDraft } from './screens/draft.js';
import { depthClick, renderDepth } from './screens/depth.js';
import { finishLeagueGame, recapText, renderResult, renderSeason, simPlayoffOthers } from './screens/season.js';
import { renderOffseason } from './screens/offseason.js';
import { autoAdvance, doCall, renderGame, setMode, startGame, userSide, userTimeout } from './screens/game.js';
import { L3, closeHelp, doSnap, ensureStage, fitStage, mountStage, onKey, recall, setCamera, setDebug, stage, startReplay, syncOverlays } from './screens/live3d.js';

const app = document.getElementById('app');

export function setScreen(screen) {
  const changed = S.screen !== screen;
  S.screen = screen;
  clearTimers();
  save();
  render();
  if (changed) window.scrollTo(0, 0);
  if (screen === 'draft') draftTick();
}

// ---------- top bar ----------
function renderTop() {
  const L = S.league;
  const items = [];
  if (L) {
    if (L.phase === 'draft') items.push(['draft', 'Draft room']);
    else if (L.phase === 'offseason') items.push(['offseason', 'Offseason'], ['season', 'Last season']);
    else items.push(['grades', 'Draft grades'], ['depth', 'Depth chart'], ['season', 'Season']);
  }
  if (S.game && !S.game.final) items.push(['game', 'Live game']);
  return `<header class="top">
    <button class="brand" data-act="home" aria-label="Home"><span class="ball" aria-hidden="true"></span>PokeBall</button>
    <nav>${items.map(([k, label]) => `<button class="nav ${S.screen === k ? 'on' : ''}" data-act="go" data-to="${k}">${label}</button>`).join('')}</nav>
  </header>`;
}

// ---------- events ----------
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const L = S.league;
  switch (act) {
    case 'skip': S.skipOpen = !S.skipOpen; render(); break;
    case 'home': S.game = S.gameMeta?.quick ? null : S.game; setScreen('home'); break;
    case 'go': setScreen(el.dataset.to); break;
    case 'continue': {
      const saved = loadSaved();
      if (saved?.league) loadSnapshot(saved);
      break;
    }
    case 'exportsave': {
      const data = S.league ? snapshot() : loadSaved();
      if (!data?.league) break;
      const name = data.league.teams.find((t) => t.user)?.abbr ?? 'league';
      download(`pokeball-${name.toLowerCase()}-season${data.league.season ?? 1}.json`, JSON.stringify(data), 'application/json');
      break;
    }
    case 'importpaste': importSave(document.getElementById('import-text')?.value ?? ''); break;
    case 'recap': if (L) download(`pokeball-season${L.season ?? 1}-recap.txt`, recapText(L), 'text/plain'); break;
    case 'openresult': S.resultIdx = Number(el.dataset.i); setScreen('result'); break;
    case 'tradeyes': if (LG.acceptTrade(L)) { save(); render(); } break;
    case 'tradeno': if (L.trade) { L.trade.status = 'declined'; save(); render(); } break;
    case 'offseason': LG.startOffseason(L); S.offCuts = null; setScreen('offseason'); break;
    case 'suggestcuts': S.offCuts = new Set(L.offseason.cuts[user().id]); render(); break;
    case 'finishoffseason': {
      LG.finishOffseason(L, [...(S.offCuts ?? [])]);
      S.offCuts = null;
      S.draft = { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false };
      setScreen('draft');
      break;
    }
    case 'subslot': S.subSel = S.subSel === el.dataset.slot ? null : el.dataset.slot; render(); break;
    case 'subcancel': S.subSel = null; render(); break;
    case 'subin': case 'subback': {
      const g = S.game;
      if (!g || g.final || S.busy || L3.lp) break;
      if (act === 'subin' && S.subSel) manualSub(g, userSide(), S.subSel, Number(el.dataset.id));
      if (act === 'subback') manualSub(g, userSide(), el.dataset.slot, null);
      S.subSel = null; if (L3.preview) L3.spots = worldSpots(L3.preview.lp); L3.preview = null;
      save(); render();
      break;
    }
    case 'quick': {
      applyGrowth({});
      // ?seed=N in the address replays the same quick game (rosters, weather, coin toss): the
      // screenshot tests compare builds on exactly the same game state.
      let seed = Math.floor(Math.random() * 2 ** 31);
      try { const m = /[?&#]seed=(\d+)/.exec(location.search + location.hash); if (m) seed = Number(m[1]); } catch { /* no location */ }
      const Q = LG.quickRosters(seed);
      const [a, b] = Q.teams;
      a.name = S.setup.name || 'Pallet Starters'; a.abbr = (S.setup.abbr || 'PAL').toUpperCase();
      const game = createGame({ home: LG.teamForGame(a), away: LG.teamForGame(b), seed });
      startGame(game, { quick: true, userTeamId: a.id });
      break;
    }
    case 'newleague': S.league = null; S.game = null; setScreen('home'); break;
    case 'select': {
      if (e.target.closest('[data-act="draftbtn"]')) return;
      S.draft.sel = Number(el.dataset.id);
      document.getElementById('detail').innerHTML = detailHtml();
      document.querySelectorAll('#board-body tr.sel').forEach((r) => r.classList.remove('sel'));
      el.classList.add('sel');
      break;
    }
    case 'draftbtn': userDraft(Number(el.dataset.id), null); break;
    case 'draftsel': userDraft(S.draft.sel, document.getElementById('d-slot')?.value ?? null); break;
    case 'sort': S.draft.sort = el.dataset.key; render(); break;
    case 'autodraft': S.draft.autoAll = !S.draft.autoAll; render(); draftTick(); break;
    case 'startseason': L.phase = 'season'; setScreen('season'); break;
    case 'dslot': case 'dbench': depthClick(el); break;
    case 'autodepth': {
      const me = user();
      const { lineup, bench } = autoDepthChart(me.roster);
      me.lineup = lineup; me.bench = bench; S.depthSel = null; save(); render();
      break;
    }
    case 'playweek': case 'simweek': {
      const me = user();
      const playoff = L.phase === 'playoffs';
      const gm = playoff ? L.playoffs.games.find((g) => g.home === me.id || g.away === me.id) : LG.userGame(L);
      if (!gm) { // eliminated: sim the round
        simPlayoffOthers(L, -1); LG.advancePlayoffs(L); save(); render(); break;
      }
      const game = LG.startLeagueGame(L, gm.home, gm.away, playoff);
      const meta = { playoff, userTeamId: me.id };
      if (act === 'simweek') { S.game = game; S.gameMeta = meta; simUntil(game, 'game'); finishLeagueGame(); }
      else startGame(game, meta);
      break;
    }
    case 'finishgame': finishLeagueGame(); break;
    case 'call': doCall(el.dataset.call); break;
    case 'timeout': userTimeout(); break;
    case 'cstab': S.csTab = el.dataset.tab; S.csPage = 0; S.csAll = false; render(); break;
    case 'calshot': S.calShot = el.dataset.k; render(); break;
    case 'calreset': S.cal = cameraDefaults(); stage?.rig.setCalibration(S.cal); savePrefs(); render(); break;
    case 'snap': doSnap(); break;
    case 'recall': recall(); break;
    case 'menu': S.menuOpen = !S.menuOpen; render(); break;
    case 'cam': setCamera(el.dataset.cam); break;
    case 'help': S.menuOpen = false; S.helpOpen = true; render(); break;
    case 'helpok': closeHelp(); break;
    case 'resume': L3.paused = false; syncOverlays(); break;
    case 'replay': startReplay(); break;
    case 'mode': setMode(el.dataset.mode); break;
    case 'csfold': S.csFold = !S.csFold; render(); break;
    case 'csall': S.csAll = !S.csAll; S.csFold = false; render(); break;
    case 'formpick': { const k = el.dataset.k || null; if (S.game && S.game.poss === userSide()) S.formPick = k; else S.frontPick = k; render(); break; }
    case 'quality': S.quality = el.dataset.q; stage?.setQuality(S.quality); savePrefs(); render(); break;
    case 'details': S.menuOpen = false; render(); document.querySelector('.game.g3d .below')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); break;
    case 'sim': {
      const g = S.game;
      if (!g || S.busy || (L3.lp && L3.lp.phase !== 'pre')) return;
      L3.lp = null;
      clearTimeout(timers.auto);
      simUntil(g, el.dataset.stop);
      save(); render(); autoAdvance();
      break;
    }
    case 'gtab': S.gameTab = el.dataset.tab; render(); break;
    default: break;
  }
}

function onInput(e) {
  const t = e.target;
  if (t.id === 'd-search') { S.draft.search = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id?.startsWith('cal-')) {
    const k = t.id.slice(4);
    S.cal[S.calShot][k] = Number(t.value);
    stage?.rig.setCalibration(S.cal);
    const o = document.getElementById(`calv-${k}`);
    if (o) o.textContent = `${S.cal[S.calShot][k]}${k === 'pitch' || k === 'fov' ? '°' : '×'}`;
    savePrefs();
  }
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'd-type') { S.draft.type = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id === 'd-gen') { S.draft.gen = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id === 'd-rate') { S.draft.rate = t.value; S.draft.sort = 'fit'; render(); }
  if (t.id === 'g-coach') { S.coach = t.checked; save(); render(); autoAdvance(); }
  if (t.id === 'cs-tempo') { S.tempo = t.value; t.blur(); render(); }
  if (t.id === 'cs-form') { const v = t.value || null; if (S.game?.poss === userSide()) S.formPick = v; else S.frontPick = v; t.blur(); render(); }
  if (t.id === 'g-sound') { S.sound = t.checked; setSound(S.sound); savePrefs(); }
  if (t.id === 'g-wx') { S.weatherFx = t.checked; stage?.setWeatherFx(S.weatherFx); savePrefs(); }
  if (t.id === 'g-names') { S.names = t.checked; if (stage) stage.showNames = S.names; savePrefs(); }
  if (t.id === 'g-pips') { S.pips = t.checked; if (stage) stage.showPips = S.pips; savePrefs(); }
  if (t.id === 'g-debug') setDebug(t.checked);
  if (t.id === 'import-file' && t.files?.[0]) t.files[0].text().then(importSave);
  if (t.dataset?.cut) {
    const id = Number(t.dataset.cut);
    S.offCuts ??= new Set();
    if (t.checked) S.offCuts.add(id); else S.offCuts.delete(id);
    render();
  }
}
function onSubmit(e) {
  if (e.target.id !== 'setup-form') return;
  e.preventDefault();
  const f = e.target;
  S.setup = {
    name: f.querySelector('#f-name').value.trim() || 'Pallet Starters',
    abbr: (f.querySelector('#f-abbr').value.trim() || 'PAL').toUpperCase().slice(0, 3),
    rounds: Number(f.querySelector('input[name="rounds"]:checked')?.value ?? 24),
    typeCap: f.querySelector('#f-typecap').checked,
    legendaries: f.querySelector('#f-legend').checked,
    clock: f.querySelector('#f-clock').checked,
  };
  S.league = LG.createLeague({ teamName: S.setup.name, abbr: S.setup.abbr, rounds: S.setup.rounds, legendaries: S.setup.legendaries,
    typeCap: S.setup.typeCap, seed: Math.floor(Math.random() * 2 ** 31) });
  S.game = null; S.gameMeta = null;
  S.draft = { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false };
  setScreen('draft');
}

// ---------- render ----------
export function render() {
  applyGrowth(S.screen === 'game' && S.gameMeta?.quick ? {} : S.league?.growth ?? {});
  let body;
  const L = S.league;
  switch (S.screen) {
    case 'draft': body = L?.phase === 'draft' ? renderDraft() : renderHome(); break;
    case 'grades': body = L ? renderGrades() : renderHome(); break;
    case 'depth': body = L && L.phase !== 'draft' ? renderDepth() : renderHome(); break;
    case 'season': body = L && L.schedule.length ? renderSeason() : renderHome(); break;
    case 'result': body = L ? renderResult() : renderHome(); break;
    case 'offseason': body = L?.phase === 'offseason' ? renderOffseason() : renderHome(); break;
    case 'game': ensureStage(); body = renderGame(); break;
    default: body = renderHome();
  }
  const y = window.scrollY;
  const boardScroll = document.querySelector('.board .tablewrap')?.scrollTop;
  const focusId = document.activeElement?.id;
  app.innerHTML = renderTop() + `<main>${body}</main>`;
  document.body.classList.toggle('g3d-on', S.screen === 'game' && !!stage);
  if (S.screen === 'game') mountStage();
  if (S.screen === 'draft' && boardScroll != null) { const b = document.querySelector('.board .tablewrap'); if (b) b.scrollTop = boardScroll; }
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  window.scrollTo(0, y);
}

function start(data) {
  loadPrefs();
  initAudio();
  setSound(S.sound);
  try { if (/[?&#]debug\b/.test(location.search + location.hash)) S.debug = true; } catch { /* no location */ }
  const snap = data?.state;
  if (snap?.league || snap?.game) {
    S.league = LG.migrateLeague(snap.league); S.game = snap.game; S.gameMeta = snap.gameMeta; S.screen = snap.screen ?? 'home';
  }
  document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('presnap')) S.presnapClosed = !e.target.open; }, true);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('resize', () => { if (S.screen === 'game' && stage) fitStage(); });
  document.addEventListener('submit', onSubmit);
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => L3.keys.clear());
  render();
  if (S.screen === 'draft') draftTick();
  if (S.screen === 'game') autoAdvance();
  window.claude?.hot?.snapshot?.(() => ({ state: { league: S.league, game: S.game, gameMeta: S.gameMeta, screen: S.screen } }));
}

if (window.claude?.hot?.ready) window.claude.hot.ready(start); else start(window.claude?.hot?.data ?? {});
