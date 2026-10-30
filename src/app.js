// PokeBall UI entry: picks the screen to render and routes clicks, keys and form input to the
// screens in screens/ (home, draft room and grades, depth chart, season hub, offseason, game).
import { startLab } from './animlab.js';
import { applyGrowth, autoDepthChart } from './ratings.js';
import { createGame, manualSub, simUntil } from './engine.js';
import { worldSpots } from './live.js';
import { cry, initAudio, ui } from './audio.js';
import { applySound, clickSound, soundButtonHtml, soundInput, soundTest, syncMusic, toggleMute } from './screens/sound.js';
import { cameraDefaults } from './camera3d.js';
import * as LG from './league.js';
import { S, clearTimers, deleteSlot, loadPrefs, loadSaved, migrateStorage, reduceMotion, save, savePrefs, snapshot, timers } from './state.js';
import { download, esc, teamBadge, teamMark, user } from './ui.js';
import { afterHomeRender, homeAct, homeKey, homeLaunch, importSave, initHome, loadSnapshot, renderHome } from './screens/home.js';
import { boardRowsHtml, detailHtml, draftSkip, draftSwap, draftTick, moveQueue, queueTop, renderDraft, renderGrades, toggleQueue, userDraft } from './screens/draft.js';
import { depthClick, renderDepth } from './screens/depth.js';
import { finishLeagueGame, recapText, renderResult, renderSeason, simPlayoffOthers } from './screens/season.js';
import { renderOffseason } from './screens/offseason.js';
import { initPads } from './screens/pad.js';
import { copyShare, loadShared, openSharedText, readShareFromUrl } from './screens/share.js';
import { renderFreeAgency } from './screens/freeagency.js';
import { renderRecords } from './screens/records.js';
import { drawKitPreview, kitAct, kitInput, renderKit } from './screens/kit.js';
import { cleanKit, inkOn, kitOf } from './kits.js';
import { deskClear, deskCounter, deskPick, deskPropose, deskTeam, deskToggle, deskUseCounter, renderTrades } from './screens/trades.js';
import * as TR from './trades.js';
import * as FA from './freeagency.js';
import { autoAdvance, doCall, renderGame, setDifficulty, setMode, startGame, toggleTakeOver, userSide, userTimeout } from './screens/game.js';
import { applyDifficulty } from './difficulty.js';
import { L3, clearInput, closeHelp, doSnap, ensureStage, fitStage, mountStage, onKey, presnapAct, recall, resetBetweenGames, setCamera, setDebug, stage, startReplay, syncOverlays, toggleDetails, userChallenge } from './screens/live3d.js';
import { renderLobby } from './screens/lobby.js';
import { bindUI, create as netCreate, join as netJoin, joinFromHash, leave as netLeave, roomLink, send as netSend, setName as netSetName } from './net.js';
import { openFilm } from './screens/film.js';
import { csBack, csBook, csMove, csOpen } from './screens/callsheet.js';
import { beginTutorial, endTutorial, restartTutorial, skipExercise } from './screens/tutorial.js';

const app = document.getElementById('app');

export function setScreen(screen) {
  const changed = S.screen !== screen;
  S.screen = screen;
  clearTimers();
  save();
  render();
  if (changed) window.scrollTo(0, 0);
  if (screen === 'draft') draftTick();
  // Leaving the game cleared its timers: coming back picks up an AI call that was waiting.
  if (screen === 'game' && changed) autoAdvance();
}

// A quick game: two AI-drafted rosters. Two players: player one takes the home team, player two
// the away team. Spectate: the AI calls and plays both (Watch mode for this game only).
export function quickGame({ twoPlayer = false, spectate = false, tutorial = false } = {}) {
  applyGrowth({});
  // ?seed=N in the address replays the same quick game (rosters, weather, coin toss): the
  // screenshot tests compare builds on exactly the same game state. A streamer's later games
  // move on from it.
  let seed = Math.floor(Math.random() * 2 ** 31);
  try { const m = /[?&#]seed=(\d+)/.exec(location.search + location.hash); if (m && !(S.streamer && S.game)) seed = Number(m[1]); } catch { /* no location */ }
  const Q = LG.quickRosters(seed);
  const [a, b] = Q.teams;
  if (!spectate) {
    a.name = S.setup.name || 'Pallet Starters'; a.abbr = (S.setup.abbr || 'PAL').toUpperCase();
    // Your quick-game team wears your franchise kit (the kit screen without a league open).
    if (S.setup.color) a.color = S.setup.color;
    if (S.setup.kit) a.kit = cleanKit(S.setup.kit, a);
  }
  // The opening kickoff waits to be played out on the field like every later one.
  const game = createGame({ home: LG.teamForGame(a), away: LG.teamForGame(b), seed, liveKicks: true });
  const meta = { quick: true, userTeamId: a.id, twoPlayer };
  if (spectate) meta.spectate = true;
  // The practice field (tutorial.js): you play every snap yourself.
  if (tutorial) { meta.tutorial = true; S.coach = false; S.watch = false; S.spectate = false; beginTutorial(); } else endTutorial();
  startGame(game, meta);
}

// ---------- top bar ----------
function renderTop() {
  const L = S.league;
  const items = [];
  if (L) {
    if (L.phase === 'draft') items.push(['draft', 'Draft room']);
    else if (L.phase === 'offseason') items.push(['offseason', 'Offseason'], ['season', 'Last season']);
    else if (L.phase === 'freeagency') items.push(['freeagency', 'Free agency']);
    else items.push(['grades', 'Draft grades'], ['depth', 'Depth chart'], ['season', 'Season'], ['trades', 'Trade desk']);
    items.push(['records', 'Records'], ['kit', 'Franchise']);
  }
  if (S.game && !S.game.final) items.push(['game', 'Live game']);
  const me = L && user();
  return `<header class="top">
    <button class="brand" data-act="home" aria-label="Home"><span class="ball" aria-hidden="true"></span>PokeBall</button>
    <nav>${items.map(([k, label]) => `<button class="nav ${S.screen === k ? 'on' : ''}" data-act="go" data-to="${k}">${label}</button>`).join('')}</nav>
    ${me ? `<span class="top-team">${teamMark(me, 38, 'top-crest')}<span><b>${esc(me.name)}</b><small>Season ${L.season ?? 1}</small></span></span>` : ''}
    ${S.online && S.net?.code ? `<span class="top-team"><b>#${S.net.mode === 'league' ? 'online' : 'play'}=${esc(S.net.code)}</b><small id="net-ping">${S.netDown ? 'reconnecting…' : S.net.ping != null ? `${S.net.ping} ms` : '…'}</small></span>` : ''}
    ${soundButtonHtml()}
  </header>`;
}

// ---------- events ----------
// Into a game or a franchise from the main menu: a short cut first (see homeLaunch).
const launch = (fn) => (S.screen === 'home' ? homeLaunch(fn) : fn());
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const L = S.league;
  clickSound(act);
  // A click anywhere else closes the sound panel.
  if (S.soundOpen && act !== 'sound' && act !== 'sndtest' && !el.closest('.sndpop')) S.soundOpen = false;
  if (homeAct(act, el)) return;
  switch (act) {
    case 'onlinequick': netCreate('quick', { name: 'Home' }); break;
    case 'onlineleague': netCreate('league', setupFromForm()); break;
    case 'onlinejoin': netJoin((document.getElementById('net-code')?.value || '').trim().toUpperCase()); break;
    case 'onlinerejoin': netJoin(el.dataset.code); break;
    case 'onlineready': netSend({ t: 'readygame' }); break;
    case 'onlineforfeit': netSend({ t: 'forfeit' }); break;
    case 'onlinerematch': netSend({ t: 'rematch' }); break;
    case 'onlinesim': netSend({ t: 'sim' }); break;
    case 'onlinesimmine': netSend({ t: 'simmine' }); break;
    case 'onlineh2h': netCreate('league', { ...setupFromForm(), h2h: true }); break;
    case 'startdraft': netSend({ t: 'startdraft' }); break;
    case 'onlineautodraft': netSend({ t: 'autodraft', on: !S.net?.autoDraft }); break;
    case 'setname': netSetName(document.getElementById('net-name')?.value); el.textContent = 'Saved'; break;
    case 'netcopy': navigator.clipboard?.writeText(roomLink()); el.textContent = 'Copied'; break;
    case 'claimteam': netSend({ t: 'claim', team: Number(el.dataset.team) }); break;
    case 'sound': S.soundOpen = !S.soundOpen; if (S.soundOpen) S.menuOpen = false; render(); break;
    case 'sndtest': soundTest(); break;
    case 'skip': S.skipOpen = !S.skipOpen; render(); break;
    case 'kit': case 'kitchant': kitAct(act, el); break;
    // A quick game in progress stays open: the home screen and the top bar take you back to it.
    // Home leaves an online room (Rejoin on the home screen, or the room's link, takes the seat back).
    case 'home': S.menuPanel = null; S.menuMore = null; if (S.online) netLeave({ keepScreen: true }); if (S.game?.final && S.gameMeta?.quick) { S.game = null; S.gameMeta = null; } setScreen('home'); break;
    case 'go': setScreen(el.dataset.to); break;
    case 'continue': {
      const n = Number(el.dataset.slot ?? S.slot);
      const saved = loadSaved(n);
      if (!saved?.league) break;
      launch(() => {
        // Leaving the home screen saved the league in memory; drop any quick game and switch.
        if (S.gameMeta?.quick) { S.game = null; S.gameMeta = null; }
        S.slot = n; S.confirmDelete = null; S.menuPanel = null;
        loadSnapshot(saved);
      });
      break;
    }
    // From the menu straight to one of a saved franchise's screens (the team builder's tiles).
    case 'slotgo': {
      const n = Number(el.dataset.slot), saved = loadSaved(n), to = el.dataset.to;
      if (!saved?.league) break;
      if (S.gameMeta?.quick) { S.game = null; S.gameMeta = null; }
      S.slot = n; S.confirmDelete = null; S.menuPanel = null; S.menuMore = null;
      loadSnapshot(saved);
      if (to && to !== S.screen && S.screen !== 'game') setScreen(to);
      break;
    }
    case 'mute': toggleMute(); render(); break;
    case 'slotconfirm': S.confirmDelete = Number(el.dataset.slot); render(); break;
    case 'slotkeep': S.confirmDelete = null; render(); break;
    case 'slotdelete': deleteSlot(Number(el.dataset.slot)); S.confirmDelete = null; S.menuMore = null; render(); break;
    case 'exportsave': {
      const data = el.dataset.slot ? loadSaved(Number(el.dataset.slot)) : S.league ? snapshot() : loadSaved();
      if (!data?.league) break;
      const name = data.league.teams.find((t) => t.user)?.abbr ?? 'league';
      download(`pokeball-${name.toLowerCase()}-season${data.league.season ?? 1}.json`, JSON.stringify(data), 'application/json');
      break;
    }
    case 'importpaste': {
      const text = document.getElementById('import-text')?.value ?? '';
      // A league code or share link opens the shared league card; anything else is a save file.
      if (!text.trim().startsWith('{') && openSharedText(text)) break;
      importSave(text, importSlot());
      break;
    }
    case 'share': S.shareOpen = !S.shareOpen; S.shareMsg = ''; render(); break;
    case 'sharecopy': if (L) copyShare(L, el.dataset.what); break;
    case 'shareload': loadShared(el.dataset.replay === '1', el.dataset.challenge === '1'); break;
    case 'sharedismiss': S.shareIn = null; S.shareErr = ''; render(); break;
    case 'recap': if (L) download(`pokeball-season${L.season ?? 1}-recap.txt`, recapText(L), 'text/plain'); break;
    case 'openresult': S.resultIdx = Number(el.dataset.i); setScreen('result'); break;
    case 'tradeyes': if (S.online) { netSend({ t: 'tradeyes' }); break; } TR.acceptTrade(L); save(); render(); break;
    case 'tradeno': if (S.online) { netSend({ t: 'tradeno' }); break; } TR.declineTrade(L); save(); render(); break;
    case 'deskpick': deskPick(el.dataset.side, el.dataset.key); break;
    case 'deskteam': deskTeam(Number(el.dataset.team)); window.scrollTo(0, 0); break;
    case 'deskclear': deskClear(); break;
    case 'deskcounter': deskCounter(); break;
    case 'deskusecounter': deskUseCounter(); break;
    case 'deskpropose': deskPropose(); break;
    case 'offseason': LG.startOffseason(L); S.offCuts = null; setScreen('offseason'); break;
    case 'suggestcuts': S.offCuts = new Set(L.offseason.cuts[user().id]); render(); break;
    case 'finishoffseason': {
      LG.finishOffseason(L, [...(S.offCuts ?? [])]);
      S.offCuts = null; S.faSel = null; S.faRelease = null; S.faAmount = null;
      setScreen(L.phase === 'freeagency' ? 'freeagency' : 'draft');
      break;
    }
    case 'fasel': S.faSel = Number(el.dataset.id); S.faAmount = null; render(); break;
    case 'fabid': case 'fapass': case 'faskip': {
      if (L?.phase !== 'freeagency') break;
      if (act === 'faskip') FA.skipFreeAgency(L);
      else FA.runFaRound(L, act === 'fabid' ? { id: S.faSel, release: S.faRelease, amount: S.faAmount } : null);
      S.faSel = null; S.faRelease = null; S.faAmount = null;
      if (L.phase === 'freeagency') { save(); render(); break; }
      S.draft = { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false, needs: false, queueAuto: false };
      setScreen(L.phase === 'draft' ? 'draft' : 'grades');
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
    case 'quick': launch(() => quickGame()); break;
    case 'tutorial': S.helpOpen = false; S.menuOpen = false; launch(() => quickGame({ tutorial: true })); break;
    case 'tutskip': skipExercise(); break;
    case 'tutrestart': restartTutorial(); break;
    case 'tutquick': endTutorial(); launch(() => quickGame()); break;
    case 'tutexit': endTutorial(); S.game = null; S.gameMeta = null; S.menuPanel = null; setScreen('home'); break;
    case 'quick2': launch(() => quickGame({ twoPlayer: true })); break;
    case 'watchgame': launch(() => quickGame({ spectate: true })); break;
    case 'takeover': toggleTakeOver(); break;
    case 'newleague': S.league = null; S.game = null; setScreen('home'); break;
    case 'select': {
      if (e.target.closest('[data-act="draftbtn"]')) return;
      S.draft.sel = Number(el.dataset.id);
      const card = document.getElementById('detail');
      card.innerHTML = detailHtml();
      document.querySelectorAll('#board-body tr.sel').forEach((r) => r.classList.remove('sel'));
      document.querySelector(`#board-body tr[data-id="${S.draft.sel}"]`)?.classList.add('sel');
      // Bring the card out from under the sticky top bar (scroll-margin-top keeps it clear).
      const bar = document.querySelector('.top')?.getBoundingClientRect().bottom ?? 0;
      if (card.getBoundingClientRect().top < bar) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      break;
    }
    case 'draftbtn': { const id = Number(el.dataset.id); const n = L?.pickIndex; userDraft(id, null); if (L?.pickIndex !== n) { ui('pick'); cry(id); } break; }
    case 'draftsel': { const id = S.draft.sel, n = L?.pickIndex; userDraft(id, document.getElementById('d-slot')?.value ?? null); if (L?.pickIndex !== n) { ui('pick'); cry(id); } break; }
    case 'sort': S.draft.sort = el.dataset.key; render(); break;
    case 'draftskip': draftSkip(); break;
    case 'queue': toggleQueue(Number(el.dataset.id)); render(); if (S.draft.queueAuto) draftTick(); break;
    case 'queueup': case 'queuedown': moveQueue(Number(el.dataset.id), act === 'queueup' ? -1 : 1); render(); break;
    case 'draftqueue': { const id = queueTop(), n = L?.pickIndex; if (id == null) break; userDraft(id, null); if (L?.pickIndex !== n) { ui('pick'); cry(id); } break; }
    case 'draftswap': draftSwap(Number(el.dataset.team)); break;
    case 'needslot': S.draft.needs = S.draft.needs === el.dataset.slot ? false : el.dataset.slot; render(); break;
    case 'autodraft': S.draft.autoAll = !S.draft.autoAll; render(); draftTick(); break;
    case 'startseason': if (S.online) { netSend({ t: 'startseason' }); break; } L.phase = 'season'; setScreen('season'); break;
    case 'dslot': case 'dbench': depthClick(el); break;
    case 'autodepth': {
      const me = user();
      const { lineup, bench } = autoDepthChart(me.roster);
      me.lineup = lineup; me.bench = bench; S.depthSel = null; save(); render();
      break;
    }
    case 'playweek': case 'simweek': {
      if (S.online) { netSend({ t: act === 'playweek' ? 'readygame' : 'sim' }); break; }
      // The league game already under way: resume it, or sim the rest of it from the score it is at.
      if (S.game && !S.game.final && S.gameMeta && !S.gameMeta.quick) {
        if (act === 'playweek') { setScreen('game'); break; }
        resetBetweenGames(); S.p2Call = null;
        simUntil(S.game, 'game'); finishLeagueGame();
        break;
      }
      const me = user();
      const playoff = L.phase === 'playoffs';
      const gm = playoff ? L.playoffs.games.find((g) => g.home === me.id || g.away === me.id) : LG.userGame(L);
      if (!gm) { // eliminated: sim the round
        simPlayoffOthers(L, -1); LG.advancePlayoffs(L); save(); render(); break;
      }
      // A week you play kicks off on the field; a simmed week kicks off in the simulator.
      const game = LG.startLeagueGame(L, gm.home, gm.away, playoff, act !== 'simweek');
      const meta = { playoff, userTeamId: me.id };
      if (act === 'simweek') { applyDifficulty(game, S.difficulty, me.id); S.game = game; S.gameMeta = meta; simUntil(game, 'game'); finishLeagueGame(); }
      else startGame(game, meta);
      break;
    }
    case 'simseason': {
      // Sim every week left in the regular season, then show the playoff picture.
      if (L?.phase !== 'season' || (S.game && !S.game.final && !S.gameMeta?.quick)) break;
      const me = user();
      if (S.gameMeta?.quick) { S.game = null; S.gameMeta = null; }
      while (L.phase === 'season') {
        const gm = LG.userGame(L);
        if (!gm) { LG.simWeekOthers(L, me.id); LG.advanceWeek(L); continue; }
        const game = LG.startLeagueGame(L, gm.home, gm.away, false);
        applyDifficulty(game, S.difficulty, me.id); S.game = game; S.gameMeta = { playoff: false, userTeamId: me.id };
        simUntil(game, 'game'); finishLeagueGame({ go: false });
      }
      setScreen('season');
      break;
    }
    case 'finishgame': finishLeagueGame(); break;
    case 'call': doCall(el.dataset.call); break;
    case 'timeout': userTimeout(); break;
    case 'cstab': csOpen(el.dataset.tab); break;
    case 'csback': csBack(); break;
    case 'psswitch': L3.edges.add('KeyQ'); break;
    case 'cspage': csMove(Number(el.dataset.d)); break;
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
    case 'film': S.menuOpen = false; openFilm(); break;
    case 'challenge': S.menuOpen = false; userChallenge(); break;
    case 'mode': setMode(el.dataset.mode); break;
    case 'difficulty': setDifficulty(el.dataset.level); break;
    case 'csscout': S.csScout = !S.csScout; render(); break;
    case 'ps': presnapAct(el.dataset.ps, el.dataset.arg); break;
    case 'csfold': S.csFold = !S.csFold; savePrefs(); render(); break;
    case 'csbook': csBook(true); break;
    case 'csmore': S.csMore = !S.csMore; render(); break;
    case 'csall': S.csAll = !S.csAll; S.csFold = false; render(); break;
    case 'csflip': S.runFlip = !S.runFlip; render(); break;
    case 'formpick': { const k = el.dataset.k || null; if (S.game && S.game.poss === userSide()) S.formPick = k; else S.frontPick = k; render(); break; }
    case 'quality': S.quality = el.dataset.q; stage?.setQuality(S.quality); savePrefs(); render(); break;
    case 'details': toggleDetails(); break;
    case 'sim': {
      const g = S.game;
      if (!g || S.busy || (L3.lp && L3.lp.phase !== 'pre')) return;
      L3.lp = null; S.p2Call = null;
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
  if (t.type === 'range' && t.id?.startsWith('snd-')) { soundInput(t); return; }
  if (t.id === 'k-word') { kitInput(t); return; }
  if (t.id === 'fa-amount') {
    S.faAmount = Math.round(Number(t.value));
    const pos = t.selectionStart;
    render();
    const el = document.getElementById('fa-amount');
    try { el?.setSelectionRange(pos, pos); } catch { /* number inputs have no selection */ }
  }
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
  if (t.id === 'k-color' || t.id === 'k-color2') { kitInput(t); return; }
  if (t.id === 'fa-release') { S.faRelease = Number(t.value); render(); }
  if (t.id === 'desk-team') deskTeam(Number(t.value));
  if (t.dataset?.desk) deskToggle(t.dataset.desk, Number(t.value), t.checked);
  if (t.id === 'rec-team') { S.recTeam = t.value === 'league' ? 'league' : Number(t.value); render(); }
  if (t.id === 'd-type') { S.draft.type = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id === 'd-gen') { S.draft.gen = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id === 'd-rate') { S.draft.rate = t.value; render(); }
  if (t.id === 'd-needs') { S.draft.needs = t.checked; render(); }
  if (t.id === 'd-qauto') { S.draft.queueAuto = t.checked; render(); if (t.checked) draftTick(); }
  if (t.name === 'teams' && t.form?.id === 'setup-form') {
    const n = Number(t.value), sel = document.getElementById('f-pick');
    for (const o of sel?.options ?? []) o.hidden = o.value !== '' && Number(o.value) >= n;
    if (sel && sel.value !== '' && Number(sel.value) >= n) sel.value = String(n - 1);
  }
  if (t.id === 'g-coach') { S.coach = t.checked; save(); render(); autoAdvance(); }
  if (t.id === 'cs-tempo') { S.tempo = t.value; t.blur(); render(); }
  if (t.id === 'cs-form') { const v = t.value || null; if (S.game?.poss === userSide()) S.formPick = v; else S.frontPick = v; t.blur(); render(); }
  if (soundInput(t)) return;
  if (t.id === 'g-hl') { S.highlights = t.checked; savePrefs(); }
  if (t.id === 'g-wx') { S.weatherFx = t.checked; stage?.setWeatherFx(S.weatherFx); savePrefs(); }
  if (t.id === 'g-names') { S.names = t.checked; if (stage) stage.showNames = S.names; savePrefs(); }
  if (t.id === 'g-pips') { S.pips = t.checked; if (stage) stage.showPips = S.pips; savePrefs(); }
  if (t.id === 'g-debug') setDebug(t.checked);
  if (t.id === 'import-file' && t.files?.[0]) { const n = importSlot(); t.files[0].text().then((text) => importSave(text, n)); }
  if (t.dataset?.cut) {
    const id = Number(t.dataset.cut);
    S.offCuts ??= new Set();
    if (t.checked) S.offCuts.add(id); else S.offCuts.delete(id);
    render();
  }
}
const importSlot = () => Number(document.getElementById('i-slot')?.value ?? S.slot);

function onSubmit(e) {
  if (e.target.id !== 'setup-form') return;
  e.preventDefault();
  const f = e.target;
  S.setup = {
    name: f.querySelector('#f-name').value.trim() || 'Pallet Starters',
    abbr: (f.querySelector('#f-abbr').value.trim() || 'PAL').toUpperCase().slice(0, 3),
    rounds: Number(f.querySelector('input[name="rounds"]:checked')?.value ?? 24),
    teams: Number(f.querySelector('input[name="teams"]:checked')?.value ?? 8),
    typeCap: f.querySelector('#f-typecap').checked,
    legendaries: f.querySelector('#f-legend').checked,
    clock: f.querySelector('#f-clock').checked,
    scheme: f.querySelector('input[name="scheme"]:checked')?.value ?? 'balanced',
    pick: f.querySelector('#f-pick')?.value ? Number(f.querySelector('#f-pick').value) : null,
  };
  if (S.setup.pick != null) S.setup.pick = Math.max(0, Math.min(S.setup.teams - 1, S.setup.pick));
  S.slot = Number(f.querySelector('#f-slot')?.value ?? S.slot); S.confirmDelete = null; S.menuPanel = null; S.menuNewSlot = null;
  S.league = LG.createLeague({ teamName: S.setup.name, abbr: S.setup.abbr, rounds: S.setup.rounds, legendaries: S.setup.legendaries,
    typeCap: S.setup.typeCap, scheme: S.setup.scheme, numTeams: S.setup.teams, userPick: S.setup.pick ?? null, seed: Math.floor(Math.random() * 2 ** 31), ...(S.setup.color ? { userColor: S.setup.color } : {}) });
  if (S.setup.kit) S.league.teams[0].kit = cleanKit(S.setup.kit, S.league.teams[0]);
  S.game = null; S.gameMeta = null; S.desk = null;
  S.draft = { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false, needs: false, queueAuto: false };
  setScreen('draft');
}

// ---------- render ----------
let lastScreen = null;
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
    case 'freeagency': body = L?.phase === 'freeagency' ? renderFreeAgency() : renderHome(); break;
    case 'records': body = L ? renderRecords() : renderHome(); break;
    case 'kit': body = renderKit(); break;
    case 'trades': body = L && L.schedule.length ? renderTrades() : renderHome(); break;
    case 'game': ensureStage(); body = renderGame(); break;
    case 'lobby': body = renderLobby(); break;
    default: body = renderHome();
  }
  const y = window.scrollY;
  const boardScroll = document.querySelector('.board .tablewrap')?.scrollTop;
  const focusId = document.activeElement?.id;
  // A box being typed in keeps its text and caret through a re-render (an online pick, a ping).
  const typing = document.activeElement?.tagName === 'INPUT' && /^(text|search)$/.test(document.activeElement.type) ? document.activeElement : null;
  const caret = typing && { v: typing.value, a: typing.selectionStart, b: typing.selectionEnd };
  // The franchise's colors theme every screen: the top bar's stripe, the panels' edge, the active tab.
  const team = user() ?? { color: S.setup.color || '#e5402b', kit: S.setup.kit, name: S.setup.name, abbr: S.setup.abbr };
  const kit = kitOf(team), root = document.documentElement.style;
  root.setProperty('--me', kit.color); root.setProperty('--me2', kit.color2); root.setProperty('--me-ink', inkOn(kit.color));
  // A new screen slides in; a re-render of the same screen (a draft pick, a toggle) does not.
  const enter = S.screen !== lastScreen && S.screen !== 'game';
  lastScreen = S.screen;
  const menu = body.startsWith('<section class="mm');
  app.innerHTML = (menu ? '' : renderTop()) + `<main class="scr-${menu ? 'home' : S.screen}${enter ? ' enter' : ''}">${body}</main>`;
  document.body.classList.toggle('g3d-on', S.screen === 'game' && !!stage);
  document.body.classList.toggle('mm-on', menu);
  afterHomeRender();
  syncMusic();
  if (S.screen === 'game') mountStage();
  if (S.screen === 'kit') drawKitPreview();
  if (S.screen === 'draft') document.documentElement.style.setProperty('--top-h', `${document.querySelector('.top')?.offsetHeight ?? 0}px`);
  if (S.screen === 'draft' && boardScroll != null) { const b = document.querySelector('.board .tablewrap'); if (b) b.scrollTop = boardScroll; }
  if (focusId) {
    const el = document.getElementById(focusId);
    el?.focus({ preventScroll: true });
    if (el && caret) { el.value = caret.v; try { el.setSelectionRange(caret.a, caret.b); } catch { /* not a text box */ } }
  }
  // On a narrow screen the call sheet's tab row scrolls: keep the open tab in view.
  const tab = document.querySelector('.cs-tab.on'), row = tab?.parentElement;
  if (row && row.scrollWidth > row.clientWidth) {
    const t = tab.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - 8;
  }
  window.scrollTo(0, y);
}

function start(data) {
  // Developer only: #animlab opens the animation lab instead of the game.
  try { if (/[?&#]animlab\b/.test(location.search + location.hash)) { startLab(document.body); return; } } catch { /* no location */ }
  loadPrefs();
  migrateStorage();
  initAudio();
  applySound();
  try { if (/[?&#]debug\b/.test(location.search + location.hash)) S.debug = true; } catch { /* no location */ }
  // Streamer mode: ?watch in the address opens straight into a game the AI plays on both sides,
  // and each final rolls into the next game. Your saved league and mode are left as they were.
  try { if (/[?&#]watch\b/.test(location.search + location.hash)) S.streamer = true; } catch { /* no location */ }
  readShareFromUrl();
  const snap = data?.state;
  if (snap?.league || snap?.game) {
    S.league = LG.migrateLeague(snap.league); S.game = LG.replaceRetiredInGame(snap.game, S.league); S.gameMeta = snap.gameMeta; S.screen = snap.screen ?? 'home';
  }
  document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('presnap')) S.presnapClosed = !e.target.open; }, true);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('resize', () => { if (S.screen === 'game' && stage) fitStage(); });
  document.addEventListener('submit', onSubmit);
  window.addEventListener('keydown', (e) => {
    // U mutes and unmutes the game on any screen.
    if (e.code === 'KeyU' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, select, textarea')) { e.preventDefault(); toggleMute(); if (S.screen === 'home') render(); return; }
    if (homeKey(e)) return;
    onKey(e, true);
  });
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => clearInput(true));
  initPads();
  initHome();
  if (S.shareIn) S.screen = 'home';
  if (S.streamer && !S.shareIn) { quickGame({ spectate: true }); return; }
  joinFromHash();
  render();
  if (S.screen === 'draft') draftTick();
  if (S.screen === 'game') autoAdvance();
  window.claude?.hot?.snapshot?.(() => ({ state: { league: S.league, game: S.game, gameMeta: S.gameMeta, screen: S.screen } }));
}

function setupFromForm() {
  const f = document.getElementById('setup-form');
  if (!f) return { name: S.setup.name, abbr: S.setup.abbr, rounds: S.setup.rounds, legendaries: S.setup.legendaries, typeCap: S.setup.typeCap, clock: S.setup.clock, scheme: S.setup.scheme };
  return {
    name: f.querySelector('#f-name')?.value.trim() || 'Pallet Starters',
    abbr: (f.querySelector('#f-abbr')?.value.trim() || 'PAL').toUpperCase().slice(0, 3),
    rounds: Number(f.querySelector('input[name="rounds"]:checked')?.value ?? 24),
    legendaries: !!f.querySelector('#f-legend')?.checked,
    typeCap: !!f.querySelector('#f-typecap')?.checked,
    clock: !!f.querySelector('#f-clock')?.checked,
    scheme: f.querySelector('input[name="scheme"]:checked')?.value ?? 'balanced',
    pick: f.querySelector('#f-pick')?.value ? Number(f.querySelector('#f-pick').value) : null,
  };
  if (S.setup.pick != null) S.setup.pick = Math.max(0, Math.min(S.setup.teams - 1, S.setup.pick));
}
bindUI({
  render, setScreen,
  // A league game against the AI: played here like an offline game; its final goes to the server.
  startLocal(msg, saved) {
    startGame(saved || msg.g, { online: true, local: true, league: true, quick: true, key: msg.key, playoff: !!msg.meta?.playoff, userTeamId: msg.team });
  },
  tradeResult(msg) {
    const D = S.desk || {};
    S.desk = msg.ok ? { team: D.team, send: [], get: [], sendPicks: [], getPicks: [], msg: msg.text, ok: true, entry: msg.entry, counter: null } : { ...D, msg: msg.text, ok: false };
    render();
  },
});
if (window.claude?.hot?.ready) window.claude.hot.ready(start); else start(window.claude?.hot?.data ?? {});
