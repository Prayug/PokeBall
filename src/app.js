// PokeBall UI: home, draft room, grades, depth chart, season hub and game screen.
import { PLAYERS, SLOTS, SLOT, SLOT_KEYS, OFF_SLOTS, DEF_SLOTS, ST_SLOTS, ATTRS, BASELINE, autoDepthChart, unitRatings, applyGrowth } from './ratings.js';
import { SPRITES } from './sprites.js';
import { TYPE_COLORS, TYPE_TRAITS, ABILITIES, WEATHER, effectLabel, bestMultiplier } from './types.js';
import { OFF_PLAYS, DEF_PLAYS, runPlay, runLivePlay, aiOffenseCall, aiDefenseCall, simUntil, spotText, downText, clockText,
  quarterText, fgDistance, fgChance, fgOdds, absSpot, createGame, offenseLean, passWeights, runWeights, defenseWeights, manualSub } from './engine.js';
import { createLivePlay, snap, hurry, step as stepLive, playSeconds, worldSpots, playState, DT, FORMATIONS, DEF_FORMATIONS, PLAY_FORMATION, CALL_FRONT } from './live.js';
import { formationsFor } from './formations.js';
import { measureVersion } from './body.js';
import { Stage, webglAvailable } from './field3d.js';
import { initAudio, setSound } from './audio.js';
import { CAMERA_MODES, CAMERA_SHOTS, CAMERA_LIMITS, CAMERA_ALIASES, cameraDefaults } from './camera3d.js';
import { diagram, formationName } from './playbook.js';
import * as LG from './league.js';

const SAVE_KEY = 'pokeball.save.v1';
const PREF_KEY = 'pokeball.prefs.v1';
const app = document.getElementById('app');
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const S = {
  screen: 'home', league: null, game: null, gameMeta: null,
  draft: { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false, needs: false },
  depthSel: null, coach: false, gameTab: 'log', busy: false, setup: { name: 'Pallet Starters', abbr: 'PAL', rounds: 24, legendaries: false, typeCap: true, clock: true },
  banner: null, subSel: null, resultIdx: null, offCuts: null, importMsg: '',
  menuOpen: false, cam: 'gameplay', weatherFx: true, quality: 'auto',
  names: false, debug: false, csTab: null, cal: cameraDefaults(), calShot: 'gameplay',
  sound: true, seenHelp: false, helpOpen: false,
};
let timers = { draft: null, clock: null, auto: null, banner: null };

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
    savePrefs();
  } catch { /* storage unavailable: play continues unsaved */ }
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s?.league) LG.migrateLeague(s.league);
    return s;
  } catch { return null; }
}
function snapshot() {
  if (S.league && !S.gameMeta?.quick) return { league: S.league, game: S.game, gameMeta: S.gameMeta, screen: S.screen };
  // S.league stays null until Continue, and quick games are never persisted, so keep the stored league and its game.
  const prev = loadSaved();
  const keep = prev?.gameMeta && !prev.gameMeta.quick;
  return { league: S.league ?? prev?.league ?? null, game: keep ? prev.game : null, gameMeta: keep ? prev.gameMeta : null, screen: keep ? prev.screen : 'home' };
}
function resumeScreen(L, game) {
  if (game && !game.final) return 'game';
  return { draft: 'draft', grades: 'grades', offseason: 'offseason' }[L.phase] ?? 'season';
}
function loadSnapshot(snap) {
  S.league = LG.migrateLeague(snap.league); S.game = snap.game ?? null; S.gameMeta = snap.gameMeta ?? null;
  S.offCuts = null; S.subSel = null; S.resultIdx = null;
  setScreen(resumeScreen(S.league, S.game));
  if (S.screen === 'game') autoAdvance();
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importSave(text) {
  let data;
  try { data = JSON.parse(text); } catch { S.importMsg = 'That is not valid JSON.'; render(); return; }
  if (!Array.isArray(data?.league?.teams) || !data.league.teams.some((t) => t.user)) { S.importMsg = 'No PokeBall league found in that file.'; render(); return; }
  S.importMsg = '';
  loadSnapshot(data);
}
function loadPrefs() {
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
      // Lens settings saved before version 3 belong to the older framing and are dropped.
      if (p.camShots && p.camV === 4) for (const [k] of CAMERA_SHOTS) Object.assign(S.cal[k], p.camShots[k]);
    }
  } catch { /* ignore */ }
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ coach: S.coach, watch: S.watch, setup: S.setup, cam: S.cam, camV: 4, weatherFx: S.weatherFx, quality: S.quality, names: S.names, pips: !!S.pips, sound: S.sound, seenHelp: S.seenHelp, camShots: S.cal })); } catch { /* ignore */ }
}

// ---------- small view helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = (id) => PLAYERS[id];
const ATTR_SHORT = { spd: 'SPD', acl: 'ACL', agi: 'AGI', str: 'STR', blk: 'BLK', rush: 'RSH', arm: 'THR', acc: 'ACC', hnd: 'CTH', cov: 'COV', tkl: 'TKL', awr: 'AWR', sta: 'STA', kpw: 'KPW', kac: 'KAC' };
function sprite(id, cls = '') {
  return `<img class="spr ${cls}" src="${SPRITES[id]}" alt="${esc(P(id).name)}" loading="lazy" draggable="false">`;
}
function typeChips(types) {
  return types.map((t) => `<span class="type" style="--tc:${TYPE_COLORS[t]}">${t}</span>`).join('');
}
function ovrTone(v) { return v >= 90 ? 'elite' : v >= 78 ? 'good' : v >= 62 ? 'ok' : 'low'; }
function ovr(v) { return `<span class="ovr ${ovrTone(v)}">${v}</span>`; }
function teamBadge(t) { return `<span class="tbadge" style="--team:${t.color}">${esc(t.abbr)}</span>`; }
function user() { return S.league?.teams.find((t) => t.user); }
function abilityText(id) { const a = ABILITIES[P(id).ability]; return a ? a.text : 'No football effect'; }
function bar(v) { return `<span class="bar"><span style="width:${Math.max(4, v)}%"></span></span>`; }

function setScreen(screen) {
  const changed = S.screen !== screen;
  S.screen = screen;
  clearTimers();
  save();
  render();
  if (changed) window.scrollTo(0, 0);
  if (screen === 'draft') draftTick();
}
function clearTimers() {
  for (const k of Object.keys(timers)) { clearTimeout(timers[k]); clearInterval(timers[k]); timers[k] = null; }
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

// ---------- home ----------
function renderHome() {
  const saved = loadSaved();
  const st = S.setup;
  const showcase = [130, 248, 135, 65, 448, 445].filter((id) => PLAYERS[id]);
  return `<section class="home">
    <div class="hero">
      <p class="eyebrow">Gen 1 to 9 · 22 positions · 8-team league</p>
      <h1>Draft Pokémon. Coach football.</h1>
      <p class="lede">Every rating comes from real base stats: Speed makes receivers, Defense and HP make linemen, Sp. Atk makes quarterbacks. Type matchups decide the trenches.</p>
      <div class="showcase">${showcase.map((id) => `<figure>${sprite(id)}<figcaption>${esc(P(id).name)}<b>${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</b></figcaption></figure>`).join('')}</div>
    </div>
    <div class="cards">
      <form class="card setup" id="setup-form">
        <h2>New league</h2>
        <div class="row2">
          <label>Team name<input id="f-name" maxlength="22" value="${esc(st.name)}"></label>
          <label class="short">Abbreviation<input id="f-abbr" maxlength="3" value="${esc(st.abbr)}"></label>
        </div>
        <fieldset><legend>Draft length</legend>
          <label class="pill"><input type="radio" name="rounds" value="24" ${st.rounds === 24 ? 'checked' : ''}> 24 rounds, starters, kicker and punter</label>
          <label class="pill"><input type="radio" name="rounds" value="28" ${st.rounds === 28 ? 'checked' : ''}> 28 rounds, with 4 bench</label>
        </fieldset>
        <label class="check"><input type="checkbox" id="f-typecap" ${st.typeCap ? 'checked' : ''}> At most 4 Pokémon of one primary type</label>
        <label class="check"><input type="checkbox" id="f-legend" ${st.legendaries ? 'checked' : ''}> Include legendaries, Ultra Beasts and Paradox Pokémon</label>
        <label class="check"><input type="checkbox" id="f-clock" ${st.clock ? 'checked' : ''}> 60-second pick clock</label>
        <button class="btn primary" type="submit">Start the draft</button>
      </form>
      <div class="card side">
        ${saved?.league ? `<h2>Continue</h2><p>${esc(saved.league.teams[0].name)} · Season ${saved.league.season ?? 1} · ${phaseLabel(saved.league)}</p>
          <div class="actions"><button class="btn" data-act="continue">Continue league</button><button class="btn" data-act="exportsave">Export save</button></div><hr>` : ''}
        <h2>Quick game</h2>
        <p>Two AI-drafted rosters, kickoff right away. You coach the home side.</p>
        <button class="btn" data-act="quick">Play a quick game</button>
        <hr>
        <details class="importbox" ${S.importMsg ? 'open' : ''}><summary>Import a save</summary>
          <p class="small muted">Load a league from an exported file, or paste its contents. This replaces the league saved in this browser.</p>
          <input type="file" id="import-file" accept="application/json,.json">
          <textarea id="import-text" rows="3" placeholder="Paste save JSON"></textarea>
          <button class="btn" data-act="importpaste">Load pasted save</button>
          ${S.importMsg ? `<p class="small bad">${esc(S.importMsg)}</p>` : ''}
        </details>
      </div>
    </div>
  </section>`;
}
function phaseLabel(L) {
  if (L.phase === 'draft') return `Draft, pick ${L.pickIndex + 1} of ${L.picks.length}`;
  if (L.phase === 'grades') return 'Draft complete';
  if (L.phase === 'season') return `Week ${L.week + 1} of ${L.schedule.length}`;
  if (L.phase === 'playoffs') return 'Playoffs';
  if (L.phase === 'offseason') return 'Offseason';
  return 'Season over';
}

// ---------- draft ----------
function boardIds() {
  const L = S.league, me = user(), d = S.draft;
  const q = d.search.trim().toLowerCase();
  // Drafted Pokémon leave the board, and so do ones this team can't take (type cap).
  let ids = LG.available(L).filter((id) => !LG.blockReason(L, me, id) && (!q || P(id).name.toLowerCase().includes(q)) && (!d.type || P(id).types.includes(d.type)) && (!d.gen || P(id).gen === Number(d.gen)));
  const open = LG.openSlots(me);
  const fit = (id) => {
    if (d.rate !== 'fit') return { slot: d.rate, v: P(id).ovr[d.rate] };
    const slots = open.length ? open : SLOT_KEYS;
    const s = slots.reduce((a, b) => (SLOT[b].value * (P(id).ovr[b] - BASELINE[b]) > SLOT[a].value * (P(id).ovr[a] - BASELINE[a]) ? b : a));
    return { slot: s, v: P(id).ovr[s], score: SLOT[s].value * (P(id).ovr[s] - BASELINE[s]) };
  };
  const rows = ids.map((id) => ({ id, fit: fit(id) }));
  const key = d.sort;
  rows.sort((a, b) => key === 'fit' ? (b.fit.score ?? b.fit.v) - (a.fit.score ?? a.fit.v) || b.fit.v - a.fit.v
    : key === 'name' ? P(a.id).name.localeCompare(P(b.id).name) : P(b.id).attrs[key] - P(a.id).attrs[key]);
  return rows;
}

function boardRowsHtml() {
  const L = S.league, me = user();
  const myTurn = LG.currentPick(L)?.team === me.id;
  const rows = boardIds();
  if (!rows.length) return `<tr><td colspan="16" class="empty">No Pokémon match. Clear the search, type or generation filter.</td></tr>`;
  return rows.map(({ id, fit }) => {
    const p = P(id);
    const block = LG.blockReason(L, me, id);
    return `<tr class="${S.draft.sel === id ? 'sel' : ''}" data-act="select" data-id="${id}">
      <td class="pk">${sprite(id, 'sm')}<span><b>${esc(p.name)}</b>${p.legendary ? '<i class="leg">Legendary</i>' : ''}<span class="types">${typeChips(p.types)}</span></span></td>
      <td class="fit"><span class="slot">${fit.slot}</span>${ovr(fit.v)}</td>
      ${Object.keys(ATTRS).map((k) => `<td class="num a-${k}">${p.attrs[k]}</td>`).join('')}
      <td><button class="btn tiny ${myTurn && !block ? 'primary' : ''}" data-act="draftbtn" data-id="${id}" ${myTurn && !block ? '' : 'disabled'} title="${block ? esc(block) : ''}">${block ? 'Blocked' : 'Draft'}</button></td>
    </tr>`;
  }).join('');
}

function renderDraft() {
  const L = S.league, me = user(), d = S.draft;
  const pk = LG.currentPick(L);
  const onClock = pk ? L.teams[pk.team] : null;
  const myTurn = onClock?.id === me.id;
  const types = Object.keys(TYPE_COLORS);
  const head = (k, label) => `<th class="num a-${k}"><button class="sort ${d.sort === k ? 'on' : ''}" data-act="sort" data-key="${k}" title="${ATTRS[k] ?? ''}">${label}</button></th>`;
  const recent = L.picks.slice(0, L.pickIndex).slice(-10).reverse();
  return `<section class="draft">
    <div class="draft-head">
      <div>
        <p class="eyebrow">${(L.season ?? 1) > 1 ? `Season ${L.season} rookie draft · ` : ''}Round ${pk?.round ?? '-'} of ${L.picks[L.picks.length - 1].round} · Pick ${L.pickIndex + 1} of ${L.picks.length}</p>
        <h1>${myTurn ? 'You are on the clock' : `${esc(onClock?.name ?? '')} are picking`}</h1>
      </div>
      <div class="clockbox ${myTurn ? 'live' : ''}">
        ${myTurn && S.setup.clock && !d.autoAll ? `<span class="clocknum" id="pick-clock">${d.clock}</span><span>seconds, then auto-pick</span>` : myTurn ? '<span>Take your time</span>' : '<span class="dots">AI drafting</span>'}
      </div>
      <div class="head-actions">
        <button class="btn" data-act="autodraft">${d.autoAll ? 'Stop auto-draft' : 'Auto-draft the rest'}</button>
      </div>
    </div>
    <div class="draft-grid">
      <div class="board card">
        <div class="filters">
          <input id="d-search" type="search" placeholder="Search Pokémon" value="${esc(d.search)}" aria-label="Search Pokémon">
          <select id="d-type" aria-label="Type filter"><option value="">All types</option>${types.map((t) => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="d-gen" aria-label="Generation filter"><option value="">All gens</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${String(d.gen ?? '') === String(n) ? 'selected' : ''}>Gen ${n}</option>`).join('')}</select>
          <select id="d-rate" aria-label="Rate at position"><option value="fit" ${d.rate === 'fit' ? 'selected' : ''}>Best open slot</option>${SLOT_KEYS.map((k) => `<option value="${k}" ${d.rate === k ? 'selected' : ''}>Rate at ${k}</option>`).join('')}</select>
        </div>
        <div class="tablewrap">
          <table class="board-table">
            <thead><tr><th><button class="sort ${d.sort === 'name' ? 'on' : ''}" data-act="sort" data-key="name">Pokémon</button></th>
            <th><button class="sort ${d.sort === 'fit' ? 'on' : ''}" data-act="sort" data-key="fit">Fit</button></th>
            ${Object.keys(ATTRS).map((k) => head(k, ATTR_SHORT[k])).join('')}<th></th></tr></thead>
            <tbody id="board-body">${boardRowsHtml()}</tbody>
          </table>
        </div>
      </div>
      <aside class="draft-side">
        <div class="card detail" id="detail">${detailHtml()}</div>
        <div class="card">
          <h3>Your roster <span class="muted">${me.roster.length} of ${L.settings.rounds}</span></h3>
          ${rosterSlotsHtml(me)}
        </div>
        <div class="card">
          <h3>Recent picks</h3>
          <ol class="feed">${recent.map((p) => `<li>${teamBadge(L.teams[p.team])}${sprite(p.player, 'xs')}<span>${esc(P(p.player).name)}</span><em>${p.slot}</em></li>`).join('') || '<li class="muted">No picks yet</li>'}</ol>
        </div>
      </aside>
    </div>
  </section>`;
}

function rosterSlotsHtml(team) {
  const col = (keys) => keys.map((k) => {
    const id = team.slots[k];
    return `<li><span class="slot">${k}</span>${id ? `${sprite(id, 'xs')}<span>${esc(P(id).name)}</span>${ovr(P(id).ovr[k])}` : '<span class="muted">Open</span>'}</li>`;
  }).join('');
  return `<div class="slots"><ul>${col(OFF_SLOTS)}</ul><ul>${col(DEF_SLOTS)}${col(ST_SLOTS)}</ul></div>
    ${team.bench.length ? `<p class="muted small">Bench: ${team.bench.map((id) => esc(P(id).name)).join(', ')}</p>` : ''}`;
}

function detailHtml() {
  const id = S.draft.sel;
  if (id == null || !PLAYERS[id]) return `<p class="muted">Select a Pokémon on the board to see its positions, ability and type matchups.</p>`;
  const L = S.league, me = user(), p = P(id);
  const taken = !LG.available(L).includes(id);
  const myTurn = LG.currentPick(L)?.team === me.id;
  const block = LG.blockReason(L, me, id);
  const open = LG.openSlots(me);
  const bestOpen = LG.bestOpenSlot(me, id);
  const edge = LG.rivalEdge(L, id);
  const s = p.stats;
  return `<div class="dhead">${sprite(id, 'lg')}<div><h3>${esc(p.name)}</h3><div class="types">${typeChips(p.types)}</div>
      <p class="small muted">Gen ${p.gen} · ${(p.height / 10).toFixed(1)} m · ${(p.weight / 10).toFixed(1)} kg</p></div></div>
    <p class="small"><b>${esc(p.ability)}.</b> ${esc(abilityText(id))}</p>
    ${p.types.map((t) => `<p class="small"><b>${t} trait.</b> ${TYPE_TRAITS[t].text}</p>`).join('')}
    <p class="small">Super effective against <b>${edge.n}</b> of ${edge.total} Pokémon on rival rosters.</p>
    <h4>Best positions</h4>
    <ul class="best">${p.best.slice(0, 3).map((k) => `<li><span class="slot">${k}</span>${bar(p.ovr[k])}${ovr(p.ovr[k])}</li>`).join('')}</ul>
    <p class="small muted mono">HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · SpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}</p>
    ${taken ? '<p class="muted">Already drafted.</p>' : `<div class="draftto">
      <select id="d-slot" aria-label="Draft into slot">${open.map((k) => `<option value="${k}" ${k === bestOpen ? 'selected' : ''}>${k} · ${p.ovr[k]}</option>`).join('')}${open.length === 0 ? '<option value="BENCH">Bench</option>' : ''}</select>
      <button class="btn primary" data-act="draftsel" ${myTurn && !block ? '' : 'disabled'}>${block ? esc(block) : myTurn ? `Draft ${esc(p.name)}` : 'Wait for your pick'}</button>
    </div>`}`;
}

function draftTick() {
  clearTimers();
  const L = S.league;
  if (!L || L.phase !== 'draft' || S.screen !== 'draft') return;
  const pk = LG.currentPick(L);
  const mine = L.teams[pk.team].user;
  if (!mine || S.draft.autoAll) {
    timers.draft = setTimeout(() => {
      const c = LG.aiChoosePick(L, pk.team);
      LG.makePick(L, c.id, c.slot);
      afterPick();
    }, mine ? 120 : 260);
    return;
  }
  S.draft.clock = 60;
  if (S.setup.clock) {
    timers.clock = setInterval(() => {
      S.draft.clock--;
      const el = document.getElementById('pick-clock');
      if (el) el.textContent = S.draft.clock;
      if (S.draft.clock <= 0) {
        clearInterval(timers.clock);
        const c = LG.aiChoosePick(L, pk.team);
        LG.makePick(L, c.id, c.slot);
        afterPick();
      }
    }, 1000);
  }
}
function afterPick() {
  save();
  if (S.league.phase !== 'draft') { S.draft.autoAll = false; setScreen('grades'); return; }
  if (S.draft.sel != null && !LG.available(S.league).includes(S.draft.sel)) { /* keep showing as drafted */ }
  render();
  draftTick();
}

// ---------- grades ----------
function renderGrades() {
  const L = S.league;
  const grades = LG.draftGrades(L);
  const units = [['passOff', 'Pass offense'], ['runOff', 'Run offense'], ['passRush', 'Pass rush'], ['coverage', 'Coverage'], ['runDef', 'Run defense']];
  const order = L.teams.map((t, i) => ({ t, g: grades[i] }));
  return `<section class="grades">
    <p class="eyebrow">Draft complete</p>
    <h1>Draft grades</h1>
    <p class="lede">Each unit is graded against the other seven teams. Starters only; your bench subs in as starters tire.</p>
    <div class="tablewrap card"><table class="gtable">
      <thead><tr><th>Team</th><th>Coach</th>${units.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${order.map(({ t, g }) => `<tr class="${t.user ? 'me' : ''}"><td>${teamBadge(t)} ${esc(t.name)}</td><td class="muted">${esc(t.coachName)}${t.favTypes ? ` (${t.favTypes.join(', ')})` : ''}</td>
        ${units.map(([k]) => `<td><span class="grade g-${g[k].grade[0]}">${g[k].grade}</span><span class="muted small"> ${g[k].value}</span></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${tradeCardHtml(L)}
    <div class="actions">
      <button class="btn" data-act="go" data-to="depth">Edit depth chart</button>
      ${L.phase === 'grades' ? '<button class="btn primary" data-act="startseason">Start the season</button>' : '<button class="btn primary" data-act="go" data-to="season">Go to season</button>'}
    </div>
  </section>`;
}

function tradeCardHtml(L) {
  const T = L.trade;
  if (!T) return '';
  const from = L.teams[T.team];
  if (T.status === 'accepted') {
    const me = user(), slot = Object.keys(me.lineup).find((k) => me.lineup[k] === T.youGet);
    const fit = slot && P(T.youGet).best[0] !== slot;
    return `<div class="card trade done"><h3>Trade</h3><p>You sent ${esc(P(T.youSend).name)} to ${esc(from.name)} for ${esc(P(T.youGet).name)}.</p>
      ${fit ? `<p class="small muted">${esc(P(T.youGet).name)} took ${esc(P(T.youSend).name)}'s spot at ${slot}. Auto-arrange the depth chart to get the full gain.</p>
      <div class="actions"><button class="btn" data-act="go" data-to="depth">Open the depth chart</button></div>` : ''}</div>`;
  }
  if (!LG.tradeOpen(L)) return '';
  const card = (id, label) => {
    const p = P(id), k = p.best[0];
    return `<div class="tside"><span class="muted small">${label}</span>${sprite(id, 'md')}<b>${esc(p.name)}</b><span class="types">${typeChips(p.types)}</span><span><span class="slot">${k}</span>${ovr(p.ovr[k])}</span></div>`;
  };
  return `<div class="card trade"><h3>Trade offer <span class="muted">${teamBadge(from)} ${esc(from.coachName)}</span></h3>
    <div class="tswap">${card(T.youGet, 'You get')}<span class="at">for</span>${card(T.youSend, 'You send')}</div>
    <p class="small muted">${esc(from.name)} want ${esc(P(T.youSend).name)}. By overall, your best lineup improves by ${T.gain} points. The offer stands until your first game.</p>
    <div class="actions"><button class="btn primary" data-act="tradeyes">Accept</button><button class="btn" data-act="tradeno">Decline</button></div></div>`;
}

function conditionTag(id) {
  const c = S.league?.condition?.[id];
  if (!c) return '';
  return c.out ? '<span class="cond out">Out this week</span>' : `<span class="cond sore">Sore ${c.energy}%</span>`;
}

// ---------- depth chart ----------
// [slot, column, row] on an 11-column field seen from behind the offense; row 4 is the line of scrimmage.
const FORMATION = [
  ['FS', 4, 1], ['SS', 8, 1],
  ['CB1', 1, 2], ['CB3', 2, 2], ['MLB', 6, 2], ['OLB', 9, 2], ['CB2', 11, 2],
  ['DE', 3, 3], ['DT2', 5, 3], ['DT1', 7, 3], ['LE', 9, 3],
  ['WR1', 1, 5], ['LT', 4, 5], ['LG', 5, 5], ['C', 6, 5], ['RG', 7, 5], ['RT', 8, 5], ['TE', 9, 5], ['WR2', 11, 5],
  ['WR3', 2, 6], ['QB', 6, 6],
  ['RB', 6, 7], ['K', 3, 7], ['P', 9, 7],
];
function renderDepth() {
  const me = user();
  const u = unitRatings(me.lineup);
  const cell = ([k, col, row]) => {
    const id = me.lineup[k];
    if (id == null) return `<button class="dslot ${S.depthSel === k ? 'sel' : ''}" style="grid-column:${col};grid-row:${row}" data-act="dslot" data-slot="${k}"><span class="slot">${k}</span><span class="dn muted">Open</span></button>`;
    const p = P(id);
    const misfit = p.best[0] !== k && p.ovr[p.best[0]] - p.ovr[k] >= 6;
    return `<button class="dslot ${S.depthSel === k ? 'sel' : ''}" style="grid-column:${col};grid-row:${row}" data-act="dslot" data-slot="${k}">
      <span class="slot">${k}</span>${sprite(id, 'md')}<span class="dn">${esc(p.name)}</span>${ovr(p.ovr[k])}
      ${misfit ? `<span class="fitnote">Best at ${p.best[0]} ${p.ovr[p.best[0]]}</span>` : ''}${conditionTag(id)}</button>`;
  };
  return `<section class="depth">
    <p class="eyebrow">${esc(me.name)}</p>
    <h1>Depth chart</h1>
    <p class="lede">Tap a slot, then tap another slot or a bench Pokémon to swap them. Overalls update for the new position.</p>
    <div class="unitbar">${[['Pass offense', u.passOff], ['Run offense', u.runOff], ['Pass rush', u.passRush], ['Coverage', u.coverage], ['Run defense', u.runDef]]
      .map(([l, v]) => `<div><span class="muted small">${l}</span><b>${Math.round(v)}</b></div>`).join('')}</div>
    <div class="gridwrap"><div class="gridiron">
      <span class="gside def">Defense</span><span class="gside off">Offense</span>
      <div class="los" aria-hidden="true"></div>
      ${FORMATION.map(cell).join('')}
    </div></div>
    <div class="card"><h3>Bench</h3><div class="benchrow">${me.bench.length ? me.bench.map((id) => `<button class="dslot bench" data-act="dbench" data-id="${id}">${sprite(id, 'md')}<span class="dn">${esc(P(id).name)}</span>
      ${S.depthSel ? ovr(P(id).ovr[S.depthSel]) : `<span class="slot">${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</span>`}${conditionTag(id)}</button>`).join('') : '<p class="muted">No bench. Draft 28 rounds to carry 4 backups.</p>'}</div></div>
    ${Object.keys(S.league.condition ?? {}).length ? '<p class="small muted">Sore Pokémon start the next game below full energy, and the bench subs in as they tire. A Pokémon who is out sits the next game when the bench can cover him; with no bench he plays hurt.</p>' : ''}
    <div class="actions"><button class="btn" data-act="autodepth">Auto-arrange for best overall</button>
    <button class="btn primary" data-act="go" data-to="${S.league.phase === 'grades' ? 'grades' : 'season'}">Done</button></div>
  </section>`;
}

// ---------- season ----------
function renderSeason() {
  const L = S.league;
  const me = user();
  const st = LG.standings(L);
  const lead = LG.leaders(L);
  let main = '';
  if (L.phase === 'season') {
    const gm = LG.userGame(L);
    const opp = L.teams[gm.home === me.id ? gm.away : gm.home];
    main = `<div class="card matchup">
      <p class="eyebrow">Season ${L.season ?? 1} · Week ${L.week + 1} of ${L.schedule.length}</p>
      <div class="vs">${teamBlock(L.teams[gm.away])}<span class="at">at</span>${teamBlock(L.teams[gm.home])}</div>
      <p class="muted">${esc(opp.name)} coach: ${esc(opp.coachName)}</p>
      <div class="actions"><button class="btn primary" data-act="playweek">Play the game</button><button class="btn" data-act="simweek">Simulate it</button></div>
    </div>${scoutHtml(L, me.id, opp.id)}${tradeCardHtml(L)}`;
  } else if (L.phase === 'playoffs') {
    const P_ = L.playoffs;
    const mine = P_.games.find((g) => g.home === me.id || g.away === me.id);
    main = `<div class="card matchup"><p class="eyebrow">${P_.round === 0 ? 'Semifinals' : 'Championship'}</p>
      ${bracketHtml(L)}
      <div class="actions">${mine ? '<button class="btn primary" data-act="playweek">Play your playoff game</button><button class="btn" data-act="simweek">Simulate it</button>'
        : '<p class="muted">You missed this round. Watch it play out.</p><button class="btn primary" data-act="simweek">Simulate the round</button>'}</div></div>
      ${mine ? scoutHtml(L, me.id, mine.home === me.id ? mine.away : mine.home) : ''}`;
  } else if (L.phase === 'done') {
    main = championHtml(L, st);
  } else if (L.phase === 'offseason') {
    main = `<div class="card matchup"><p class="eyebrow">Season ${L.season} offseason</p><h2>Training camp is open</h2>
      <div class="actions"><button class="btn primary" data-act="go" data-to="offseason">Make your cuts</button></div></div>`;
  }
  const results = L.results.map((r, i) => ({ r, i })).reverse();
  return `<section class="season">
    <h1>${esc(me.name)} · ${record(st.find((r) => r.id === me.id))}</h1>
    <div class="season-grid">
      <div class="col">${main}
        <div class="card"><h3>Results ${results.length ? '<span class="muted small">Open a game for its box score</span>' : ''}</h3>${results.length ? `<ul class="results scroll">${results.map(({ r, i }) => resultLine(r, i)).join('')}</ul>` : '<p class="muted">No games played yet.</p>'}</div>
        ${historyHtml(L)}
      </div>
      <div class="col">
        <div class="card"><h3>Standings</h3><div class="tablewrap"><table class="stand"><thead><tr><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th></tr></thead>
          <tbody>${st.map((r, i) => { const t = L.teams[r.id]; return `<tr class="${t.user ? 'me' : ''} ${i === 3 ? 'cut' : ''}"><td>${teamBadge(t)} ${esc(t.name)}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${r.pf}</td><td class="num">${r.pa}</td><td class="num">${r.pf - r.pa > 0 ? '+' : ''}${r.pf - r.pa}</td></tr>`; }).join('')}</tbody></table></div>
          <p class="small muted">Top 4 make the playoffs.</p></div>
        <div class="card"><h3>League leaders</h3><div class="leaders">${Object.entries(lead).map(([k, rows]) => `<div><h4>${k}</h4><ol>${rows.slice(0, 3).map((r) => `<li>${sprite(r.id, 'xs')}<span>${esc(P(r.id).name)}</span><em>${L.teams[r.team].abbr}</em><b>${statFor(k, r)}</b></li>`).join('') || '<li class="muted">None yet</li>'}</ol></div>`).join('')}</div></div>
        <div class="card"><h3>Your save</h3><p class="small muted">Download the league to keep it safe or move it to another browser. Import it from the home screen.</p>
          <div class="actions"><button class="btn" data-act="exportsave">Export save</button><button class="btn" data-act="recap">Download recap</button></div></div>
      </div>
    </div>
  </section>`;
}

function edgeRow(e) {
  const [mySlot, myId, thSlot, thId] = e.mine === 'off' ? [e.oSlot, e.oId, e.dSlot, e.dId] : [e.dSlot, e.dId, e.oSlot, e.oId];
  const [myMult, thMult] = e.mine === 'off' ? [e.oMult, e.dMult] : [e.dMult, e.oMult];
  const tag = (m) => (effectLabel(m) ? `<span class="eff ${m > 1 ? 'se' : m === 0 ? 'ne' : 'nve'}">${effectLabel(m)}</span>` : '<span class="eff">neutral</span>');
  return `<li class="edge ${e.edge > 0 ? 'good' : e.edge < 0 ? 'bad' : ''}">
    <span class="eside"><span class="slot">${mySlot}</span>${sprite(myId, 'xs')}<span class="en">${esc(P(myId).name)}</span>${tag(myMult)}</span>
    <span class="vsx">vs</span>
    <span class="eside"><span class="slot">${thSlot}</span>${sprite(thId, 'xs')}<span class="en">${esc(P(thId).name)}</span>${tag(thMult)}</span></li>`;
}

function scoutHtml(L, myId, oppId) {
  const R = LG.scoutReport(L, myId, oppId);
  const opp = L.teams[oppId];
  const lineupRow = (slots) => slots.map((k) => `<span class="sl" title="${esc(P(R.opp.lineup[k]).name)} (${k})">${sprite(R.opp.lineup[k], 'sm')}<em>${k}</em></span>`).join('');
  const W = WEATHER;
  const weather = R.weather.length ? R.weather.map((w) => `<li>${sprite(w.id, 'xs')} ${esc(P(w.id).name)} (${w.side === 'you' ? 'yours' : 'theirs'}) brings ${W[w.weather].name.toLowerCase()} most games: ${esc(W[w.weather].text)}.</li>`).join('')
    : '<li class="muted">No weather setters in either lineup. Expect clear skies most weeks.</li>';
  const health = R.health.length ? `<h4>Your health</h4><ul class="health">${R.health.map((h) => `<li>${sprite(h.id, 'xs')} ${esc(P(h.id).name)} ${h.out ? '<span class="cond out">Out this week</span>' : `<span class="cond sore">Starts at ${h.energy}%</span>`}</li>`).join('')}</ul>` : '';
  return `<div class="card scout"><h3>Scouting report <span class="muted">${teamBadge(opp)} ${esc(opp.name)}</span></h3>
    <p class="plan"><b>Game plan.</b> ${esc(R.plan)} ${esc(R.lean)}</p>
    <p class="small muted">${esc(R.coachNote)}</p>
    <div class="opprow"><span class="muted small">Their offense</span>${lineupRow(OFF_SLOTS)}</div>
    <div class="opprow"><span class="muted small">Their defense</span>${lineupRow(DEF_SLOTS)}</div>
    <div class="opprow"><span class="muted small">Their kickers</span>${lineupRow(ST_SLOTS)}</div>
    <div class="edges"><div><h4>Your best type edges</h4>${R.best.length ? `<ul>${R.best.map(edgeRow).join('')}</ul>` : '<p class="muted small">None this week.</p>'}</div>
    <div><h4>Where they have the edge</h4>${R.worst.length ? `<ul>${R.worst.map(edgeRow).join('')}</ul>` : '<p class="muted small">Nothing to worry about.</p>'}</div></div>
    <h4>Weather</h4><ul class="weather">${weather}</ul>
    ${health}
  </div>`;
}

function bracketHtml(L) {
  const B = LG.bracket(L);
  if (!B) return '';
  const side = (id, seed, score, winner) => id == null ? '<div class="bteam tbd">To be decided</div>'
    : `<div class="bteam ${winner === id ? 'won' : winner != null ? 'lost' : ''} ${L.teams[id].user ? 'me' : ''}"><em>${seed}</em>${teamBadge(L.teams[id])}<span>${esc(L.teams[id].name)}</span><b>${score ?? ''}</b></div>`;
  const game = (g) => `<div class="bgame">${side(g.home, g.seeds[0], g.homeScore, g.winner)}${side(g.away, g.seeds[1], g.awayScore, g.winner)}</div>`;
  return `<div class="bracket"><div class="bround"><h4>Semifinals</h4>${B.semis.map(game).join('')}</div>
    <div class="bround"><h4>Championship</h4>${game(B.final)}</div>
    <div class="bround champcol"><h4>Champion</h4>${B.champion != null ? `<div class="bteam won">${teamBadge(L.teams[B.champion])}<span>${esc(L.teams[B.champion].name)}</span></div>` : '<div class="bteam tbd">To be decided</div>'}</div></div>`;
}

function seasonFinish(L, id) {
  if (L.champion === id) return 'Won the championship';
  const B = LG.bracket(L);
  if (!B) return 'Missed the playoffs';
  if (B.final.home === id || B.final.away === id) return 'Lost in the championship';
  if (B.semis.some((g) => g.home === id || g.away === id)) return 'Lost in the semifinals';
  return 'Missed the playoffs';
}

function awardsHtml(L, list) {
  if (!list.length) return '';
  return `<ul class="awards">${list.map((a) => `<li>${sprite(a.id, 'md')}<span><em>${esc(a.label)}</em><b>${esc(P(a.id).name)}</b> ${teamBadge(L.teams[a.team])}<span class="small muted">${esc(a.line)}</span></span></li>`).join('')}</ul>`;
}

function championHtml(L, st) {
  const champ = L.teams[L.champion], me = user();
  const mine = st.find((r) => r.id === me.id);
  const myStats = Object.entries(L.seasonStats).filter(([, s]) => s.team === me.id);
  const star = myStats.length ? myStats.reduce((a, b) => (LG.impact(b[1]) > LG.impact(a[1]) ? b : a)) : null;
  return `<div class="card matchup champ"><p class="eyebrow">Season ${L.season ?? 1} complete</p><h2>${esc(champ.name)} are champions</h2>
    <div class="champrow">${Object.values(champ.lineup).slice(0, 6).map((id) => sprite(id, 'md')).join('')}</div>
    <h4>Your season</h4>
    <p>${esc(me.name)} went ${record(mine)}, scored ${mine.pf} and allowed ${mine.pa}. ${seasonFinish(L, me.id)}.
      ${star ? ` Team star: ${esc(P(Number(star[0])).name)}, ${esc(LG.statLine(star[1]))}.` : ''}</p>
    <h4>Awards</h4>${awardsHtml(L, LG.awards(L))}
    <h4>Playoff bracket</h4>${bracketHtml(L)}
    <div class="actions"><button class="btn primary" data-act="offseason">Start the offseason</button><button class="btn" data-act="recap">Download recap</button><button class="btn" data-act="newleague">Start a new league</button></div>
    <p class="small muted">The offseason keeps all eight rosters. Pokémon who played a lot of snaps develop, every team cuts ${LG.CUTS}, and a rookie draft refills the roster, worst record first.</p></div>`;
}

function historyHtml(L) {
  if (!L.history?.length) return '';
  return `<div class="card"><h3>League history</h3><ul class="history">${L.history.slice().reverse().map((h) => {
    const mvp = h.awards.find((a) => a.key === 'mvp');
    const mine = h.records.find((r) => L.teams[r.id].user);
    return `<li><em>Season ${h.season}</em>${teamBadge(L.teams[h.champion])}<span>${esc(L.teams[h.champion].name)} won it all.${mvp ? ` MVP ${esc(P(mvp.id).name)}.` : ''}</span><span class="muted small">You: ${record(mine)}</span></li>`;
  }).join('')}</ul></div>`;
}

function recapText(L) {
  const st = LG.standings(L);
  const lines = [`PokeBall · ${user().name} · Season ${L.season ?? 1}`, ''];
  if (L.champion != null) lines.push(`Champion: ${L.teams[L.champion].name}`, '');
  lines.push('Standings');
  st.forEach((r, i) => lines.push(`${i + 1}. ${L.teams[r.id].name} ${record(r)} (PF ${r.pf}, PA ${r.pa})`));
  const B = LG.bracket(L);
  if (B) {
    lines.push('', 'Playoffs');
    for (const g of [...B.semis, B.final]) {
      if (g.home == null) continue;
      lines.push(`${L.teams[g.away].name} ${g.awayScore ?? '-'} at ${L.teams[g.home].name} ${g.homeScore ?? '-'}`);
    }
  }
  const aw = LG.awards(L);
  if (aw.length) {
    lines.push('', 'Awards');
    for (const a of aw) lines.push(`${a.label}: ${P(a.id).name} (${L.teams[a.team].abbr}), ${a.line}`);
  }
  lines.push('', 'Results');
  for (const r of L.results) {
    lines.push(`${r.playoff ? 'Playoffs' : `Week ${r.week + 1}`}: ${L.teams[r.away].abbr} ${r.score[1]} at ${L.teams[r.home].abbr} ${r.score[0]}`);
  }
  return lines.join('\n');
}

// ---------- stored box score ----------
const STAT_KEYS = ['pa', 'pc', 'py', 'ptd', 'pint', 'sk', 'ra', 'ry', 'rtd', 'rlong', 'fum', 'tg', 'rc', 'rcy', 'rctd', 'rclong', 'tk', 'dsk', 'dint', 'pd', 'ff', 'sn'];
const fullStats = (s) => Object.fromEntries(STAT_KEYS.map((k) => [k, s[k] ?? 0]));

function renderResult() {
  const L = S.league, r = L?.results[S.resultIdx];
  if (!r?.box) return `<section><p>That game has no box score.</p><button class="btn" data-act="go" data-to="season">Back to the season</button></section>`;
  const teams = [L.teams[r.home], L.teams[r.away]];
  const g = {
    score: r.score, qs: r.quarters,
    teams: teams.map((t, i) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, team: r.box.team[i],
      stats: Object.fromEntries(Object.entries(r.box.stats[i]).map(([id, s]) => [id, fullStats(s)])) })),
  };
  const winner = r.winner == null ? 'Tie game' : `${L.teams[r.winner].name} win`;
  return `<section class="result">
    <p class="eyebrow">${r.playoff ? (r.round === 0 ? 'Semifinal' : 'Championship') : `Week ${r.week + 1}`} · ${WEATHER[r.weather].name}</p>
    <h1>${esc(teams[1].abbr)} ${r.score[1]}, ${esc(teams[0].abbr)} ${r.score[0]}</h1>
    <p class="lede">${esc(winner)}. ${esc(teams[1].name)} at ${esc(teams[0].name)}.</p>
    <div class="card"><h3>Scoring plays</h3>${r.box.scoring.length ? `<ol class="pbp scoring">${r.box.scoring.map((e) => `<li><span class="when">${quarterText(e.q)} ${clockText(e.clock)}</span><span class="sit">${teamBadge(teams[e.team])}</span><span class="txt">${esc(e.text)}</span></li>`).join('')}</ol>` : '<p class="muted">No points scored.</p>'}</div>
    <div class="card">${boxHtml(g)}</div>
    <div class="actions"><button class="btn primary" data-act="go" data-to="season">Back to the season</button></div>
  </section>`;
}

// ---------- offseason ----------
function renderOffseason() {
  const L = S.league, me = user(), O = L.offseason;
  if (!O) return '<section><p>No offseason in progress.</p></section>';
  const need = Math.min(LG.CUTS, me.roster.length);
  S.offCuts ??= new Set(O.cuts[me.id]);
  const cuts = S.offCuts;
  const mineCamp = O.camp.filter((c) => c.team === me.id);
  const gainText = (g) => Object.entries(g).map(([k, v]) => `+${v} ${ATTRS[k]}`).join(', ');
  const slotOf = (id) => Object.keys(me.lineup).find((k) => me.lineup[k] === id);
  const rows = me.roster.slice().sort((a, b) => {
    const sa = slotOf(a), sb = slotOf(b);
    return (sa ? SLOT_KEYS.indexOf(sa) : 99) - (sb ? SLOT_KEYS.indexOf(sb) : 99);
  });
  const others = L.teams.filter((t) => !t.user);
  return `<section class="offseason">
    <p class="eyebrow">Season ${L.season} offseason</p>
    <h1>Training camp and cuts</h1>
    <p class="lede">Pokémon who played the most snaps last season developed. Now cut exactly ${need} to make room for the rookie draft. Cut Pokémon go back into the draft pool.</p>
    <div class="season-grid">
      <div class="col">
        <div class="card"><h3>Your camp report</h3>${mineCamp.length ? `<ul class="camp">${mineCamp.map((c) => `<li>${sprite(c.id, 'sm')}<span><b>${esc(P(c.id).name)}</b> <span class="slot">${c.slot}</span>${ovr(P(c.id).ovr[c.slot])}</span><span class="small good">${gainText(c.gains)}</span></li>`).join('')}</ul>` : '<p class="muted">Nobody played enough snaps to develop.</p>'}
          <p class="small muted">Each ${LG.SNAPS_PER_POINT} snaps is worth +2 to a rating the Pokémon's position uses, up to +8 a season and +${LG.GROWTH_CAP} in a career.</p></div>
        <div class="card"><h3>Your roster <span class="muted">${cuts.size} of ${need} cut</span></h3>
          <ul class="cutlist">${rows.map((id) => {
            const k = slotOf(id) ?? P(id).best[0];
            return `<li><label class="check ${cuts.has(id) ? 'cut' : ''}"><input type="checkbox" data-cut="${id}" ${cuts.has(id) ? 'checked' : ''}>
              <span class="slot">${slotOf(id) ?? 'BN'}</span>${sprite(id, 'xs')}<span class="cn">${esc(P(id).name)}</span>${ovr(P(id).ovr[k])}</label></li>`;
          }).join('')}</ul>
          <div class="actions"><button class="btn primary" data-act="finishoffseason" ${cuts.size === need ? '' : 'disabled'}>Confirm cuts and start the rookie draft</button>
          <button class="btn" data-act="suggestcuts">Use suggested cuts</button></div></div>
      </div>
      <div class="col">
        <div class="card"><h3>Around the league</h3><ul class="leaguecuts">${others.map((t) => `<li>${teamBadge(t)}<span>Cutting ${O.cuts[t.id].map((id) => esc(P(id).name)).join(', ')}</span></li>`).join('')}</ul></div>
        <div class="card"><h3>Top developers</h3><ul class="camp">${O.camp.slice().sort((a, b) => Object.values(b.gains).reduce((x, y) => x + y, 0) - Object.values(a.gains).reduce((x, y) => x + y, 0)).slice(0, 8)
          .map((c) => `<li>${sprite(c.id, 'xs')}<span>${esc(P(c.id).name)} ${teamBadge(L.teams[c.team])}</span><span class="small good">${gainText(c.gains)}</span></li>`).join('')}</ul></div>
      </div>
    </div>
  </section>`;
}
function statFor(k, r) { return { 'Passing yards': r.py, 'Rushing yards': r.ry, 'Receiving yards': r.rcy, Sacks: r.dsk, Interceptions: r.dint, Tackles: r.tk }[k]; }
function record(r) { return r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '0-0'; }
function teamBlock(t) { return `<div class="tblock" style="--team:${t.color}"><span class="tabbr">${esc(t.abbr)}</span><span>${esc(t.name)}</span></div>`; }
function resultLine(r, i) {
  const L = S.league, h = L.teams[r.home], a = L.teams[r.away];
  const inner = `${r.playoff ? '<em class="po">Playoffs</em>' : `<em>Wk ${r.week + 1}</em>`}${teamBadge(a)} <b class="${r.winner === a.id ? 'won' : ''}">${r.score[1]}</b> at ${teamBadge(h)} <b class="${r.winner === h.id ? 'won' : ''}">${r.score[0]}</b>`;
  const mine = a.user || h.user ? 'mine' : '';
  return r.box ? `<li class="${mine}"><button class="resline" data-act="openresult" data-i="${i}">${inner}<span class="open">Box score</span></button></li>` : `<li class="${mine}">${inner}</li>`;
}

// ---------- game ----------
function userSide() {
  if (!S.game) return 0;
  const uid = S.gameMeta?.userTeamId ?? 0;
  return S.game.teams[0].id === uid ? 0 : 1;
}
function needsUser(g) {
  if (g.final) return false;
  if (!S.coach) return true;
  return g.down >= 3 || ((g.quarter === 2 || g.quarter >= 4) && g.clock <= 120) || g.quarter >= 5;
}

function renderField(g) {
  const dir = g.poss === 0 ? 1 : -1;
  const los = absSpot(g.poss, g.spot);
  const first = g.spot + g.toGo < 100 ? absSpot(g.poss, g.spot + g.toGo) : null;
  const X = (yd) => ((yd + 10) / 120) * 100;
  const Y = (y) => ((26.65 + y) / 53.3) * 100;
  const players = [];
  for (const [ti, side] of [[g.poss, 'off'], [1 - g.poss, 'def']]) {
    const t = g.teams[ti];
    for (const s of SLOTS.filter((x) => x.side === side)) {
      const id = t.lineup[s.key];
      const x = clampN(los + dir * s.x, -9, 109), y = s.y * dir;
      players.push(`<span class="fp ${side}" data-pid="${id}" style="left:${X(x)}%;top:${Y(clampN(y, -25, 25))}%;--team:${t.color}" title="${esc(P(id).name)} (${s.key})">${sprite(id)}</span>`);
    }
  }
  const yardLines = [];
  for (let yd = 10; yd <= 90; yd += 10) yardLines.push(`<span class="yl" style="left:${X(yd)}%"><em>${yd <= 50 ? yd : 100 - yd}</em></span>`);
  return `<div class="field" id="field">
    <div class="ez left" style="--team:${g.teams[1].color}"><span>${esc(g.teams[1].abbr)}</span></div>
    <div class="ez right" style="--team:${g.teams[0].color}"><span>${esc(g.teams[0].abbr)}</span></div>
    ${yardLines.join('')}
    <span class="losline" style="left:${X(los)}%"></span>
    ${first != null ? `<span class="firstline" style="left:${X(first)}%"></span>` : ''}
    ${players.join('')}
    <span class="football" id="football" style="left:${X(los)}%;top:50%"></span>
  </div>`;
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

function scoreboard(g) {
  const [H, A] = g.teams;
  const pos = (i) => (g.poss === i && !g.final ? '<span class="possdot" title="Has the ball"></span>' : '');
  return `<div class="scoreboard">
    <div class="sb-team" style="--team:${A.color}"><span class="sb-abbr">${esc(A.abbr)}</span>${pos(1)}<span class="sb-score">${g.score[1]}</span></div>
    <div class="sb-mid"><span class="sb-q">${g.final ? 'FINAL' : quarterText(g.quarter)}</span><span class="sb-clock">${g.final ? '' : clockText(g.clock)}</span></div>
    <div class="sb-team home" style="--team:${H.color}"><span class="sb-score">${g.score[0]}</span>${pos(0)}<span class="sb-abbr">${esc(H.abbr)}</span></div>
    <div class="sb-info">${g.final ? `${esc(g.teams[g.winner ?? 0].name)} ${g.winner == null ? 'tie' : 'win'}` : `${downText(g)} · Ball on ${spotText(g)}`} · ${WEATHER[g.weather].name}</div>
  </div>`;
}

// Play families for the call sheet: a short label and a colored edge per group.
const DEF_GROUPS = [['front', 'Man', ['base', 'cover1_robber', 'cover2_man', 'man_press', 'goal_line']],
  ['cover', 'Zone', ['cover2', 'tampa2', 'cover3', 'cover4', 'prevent']],
  ['blitz', 'Pressure', ['run_blitz', 'pass_blitz', 'mug', 'nickel_blitz', 'fire_zone', 'cover0']]];
// Number keys for the visible calls in order; kicks get letters.
const CALL_KEYS = [['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'],
  ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-']];
const KICK_KEYS = { punt: ['KeyP', 'P'], fg: ['KeyF', 'F'] };  // the other kicks take number keys on their page

// The calls on the sheet right now, grouped, each with its key. Also marks the one that fits
// the down: the heaviest weight in the AI's own tables, read without rolling g.rng.
function callSheet(g) {
  const onOff = g.poss === userSide();
  const heaviest = (w, keys) => keys.filter((k) => w[k] > 0).sort((x, y) => w[y] - w[x])[0];
  let groups, fit;
  if (onOff) {
    const fg = fgDistance(g);
    const kind = (k) => OFF_PLAYS[k].kind;
    const shown = Object.keys(OFF_PLAYS).filter((k) => (kind(k) !== 'punt' && kind(k) !== 'fg') || g.down === 4 || (kind(k) === 'fg' && fg <= 60));
    groups = [['run', 'Run', shown.filter((k) => kind(k) === 'run')], ['pass', 'Pass', shown.filter((k) => kind(k) === 'pass')],
      ['kick', 'Kicking', shown.filter((k) => kind(k) === 'punt' || kind(k) === 'fg')]];
    const lean = offenseLean(g);
    if (typeof lean === 'string') fit = shown.includes(lean) ? lean : null;
    else fit = lean >= 0.5 ? heaviest(passWeights(g), groups[1][2]) : heaviest(runWeights(g), groups[0][2]);
  } else {
    groups = DEF_GROUPS;
    fit = heaviest(defenseWeights(g), Object.keys(DEF_PLAYS));
  }
  let n = 0;
  const keyed = groups.filter(([, , ks]) => ks.length).map(([fam, label, ks]) => [fam, label, ks.map((k) => {
    const key = KICK_KEYS[k] && onOff ? KICK_KEYS[k] : CALL_KEYS[n++];
    return { call: k, code: key?.[0], label: key?.[1] };
  })]);
  return { onOff, groups: keyed, fit };
}

// Formations: the offense picks one for its call (or leaves it to the play's own), the defense
// picks its front (or leaves it to the call's). An AI side mixes its looks.
function formFor(call) {
  const ok = formationsFor(call);
  if (!ok.length) return null;
  return S.formPick && ok.includes(S.formPick) ? S.formPick : PLAY_FORMATION[call];
}
function frontFor(call) { return S.frontPick ?? CALL_FRONT[call] ?? '43'; }
// The AI's pick is a fixed function of the game and the play number (not Math.random), so a
// game started from the same seed lines up the same way every time.
function aiRoll(call) {
  const g = S.game;
  let h = ((g?.seed ?? 1) ^ Math.imul((g?.playNo ?? 0) + 1, 0x9E3779B1)) >>> 0;
  for (let i = 0; i < call.length; i++) h = Math.imul(h ^ call.charCodeAt(i), 0x85EBCA6B) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0xC2B2AE35) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 2 ** 32;
}
function aiFormation(call) {
  const ok = formationsFor(call);
  if (!ok.length) return null;
  const r = aiRoll(call);
  return r < 0.6 ? PLAY_FORMATION[call] : ok[Math.floor(((r - 0.6) / 0.4) * ok.length) % ok.length];
}
function aiFront(call) {
  if (call === 'goal_line') return 'goal';
  const r = aiRoll(call);
  return r < 0.7 ? CALL_FRONT[call] : ['43', 'nickel'][Math.floor(((r - 0.7) / 0.3) * 2) % 2];
}
function cycleForm(onOff) {
  const keys = [null, ...Object.keys(onOff ? FORMATIONS : DEF_FORMATIONS)];
  const k = onOff ? 'formPick' : 'frontPick';
  S[k] = keys[(keys.indexOf(S[k] ?? null) + 1) % keys.length];
  render();
}

// The 3D game's play-call panel: a few big cards at a time. Plays sit in categories (runs,
// short passes, deep passes, kicks; on defense fronts, blitzes and coverages) with tabs to
// move between them, so each card has room for readable play art, the name, one line on
// what it does, run or pass, and its key. Every call keeps its number key from any tab, and
// the panel opens on the category of the call that fits the down.
const CS_TABS_OFF = [['run', 'Run', ['inside_run', 'outside_run', 'power', 'counter', 'toss', 'dive', 'draw']],
  ['qbrun', 'QB runs', ['read_option', 'qb_power', 'qb_draw', 'qb_sneak']],
  ['short', 'Quick', ['slant', 'out', 'stick', 'curl_flat', 'mesh', 'screen', 'bubble']],
  ['mid', 'Intermediate', ['curl', 'smash', 'dagger', 'levels', 'flood', 'y_cross', 'te_seam']],
  ['deep', 'Shots', ['four_verts', 'post', 'pa_boot', 'pa_deep']], ['kick', 'Special teams', ['punt', 'coffin_punt', 'fake_punt', 'fg', 'fake_fg']]];
function csTabs(g) {
  const { onOff, groups, fit } = callSheet(g);
  const byCall = new Map(groups.flatMap(([fam, , cs]) => cs.map((c) => [c.call, { ...c, fam }])));
  const tabs = (onOff ? CS_TABS_OFF : DEF_GROUPS).map(([k, label, calls]) => [k, label, calls.filter((c) => byCall.has(c)).map((c) => byCall.get(c))])
    .filter(([, , cs]) => cs.length);
  // Anything not placed in a tab (new plays) lands in the last one.
  const placed = new Set(tabs.flatMap(([, , cs]) => cs.map((c) => c.call)));
  for (const c of byCall.values()) if (!placed.has(c.call)) tabs[tabs.length - 1][2].push(c);
  // Number keys count from 1 within each tab (kicks keep their letters), like a playbook page.
  for (const [, , cs] of tabs) {
    let n = 0;
    for (const c of cs) { const key = KICK_KEYS[c.call] && onOff ? KICK_KEYS[c.call] : CALL_KEYS[n++]; c.code = key?.[0]; c.label = key?.[1]; }
  }
  const fitTab = tabs.find(([, , cs]) => cs.some((c) => c.call === fit))?.[0] ?? tabs[0][0];
  const cur = tabs.some(([k]) => k === S.csTab) ? S.csTab : fitTab;
  return { onOff, tabs, fit, cur };
}
function callSheetHtml(g) {
  const { onOff, tabs, fit, cur } = csTabs(g);
  const fg = fgDistance(g);
  const side = onOff ? 'off' : 'def';
  const curCalls = new Set(tabs.find(([k]) => k === cur)[2].map((c) => c.call));
  const card = ({ call, label: key, fam }) => {
    const label = curCalls.has(call) || KICK_KEYS[call] ? key : null;
    const p = onOff ? OFF_PLAYS[call] : DEF_PLAYS[call];
    const kind = onOff ? p.kind : fam;
    const extra = call === 'fg' && onOff ? `${fg} yards · ${Math.round(fgOdds(g) * 100)}%` : p.blurb;
    const tag = onOff ? { run: 'Run', pass: 'Pass', punt: 'Kick', fg: 'Kick' }[kind] : { front: 'Man', blitz: 'Blitz', cover: 'Zone' }[kind];
    const form = onOff ? formationName(call, formFor(call)) : DEF_FORMATIONS[frontFor(call)]?.short ?? '';
    return `<button class="pcard k-${kind} ${call === fit ? 'fit' : ''}" data-act="call" data-call="${call}" title="${esc(extra)}" aria-label="${esc(p.name)}: ${esc(extra)}${label ? `, key ${label}` : ''}">
      <span class="pc-art">${diagram(g, call, side, onOff ? formFor(call) : frontFor(call))}${label ? `<kbd>${label}</kbd>` : ''}${call === fit ? '<em class="fittag">Fits</em>' : ''}</span>
      <span class="pname">${p.name}</span>
      <span class="pc-top"><em class="pc-kind">${tag}</em>${form ? `<span class="pc-form">${esc(form)}</span>` : ''}</span>
      <span class="pblurb">${esc(extra)}</span></button>`;
  };
  const who = onOff ? 'Your ball' : `${esc(g.teams[g.poss].abbr)} ball`;
  const head = `<div class="cs-head"><b>${downText(g)}</b><span class="cs-who">${who}</span>
      <div class="cs-tabs" role="tablist">${tabs.map(([k, label, cs]) => `<button role="tab" class="cs-tab ${k === cur && !S.csAll ? 'on' : ''}" aria-selected="${k === cur}" data-act="cstab" data-tab="${k}">${label}<span>${cs.length}</span></button>`).join('')}</div>
      ${formSelect(onOff)}
      <button class="btn tiny cs-all" data-act="csall" aria-pressed="${!!S.csAll}">${S.csAll ? 'Fewer' : 'All plays'} <kbd>X</kbd></button>
      <button class="btn tiny cs-fold" data-act="csfold" aria-expanded="${!S.csFold}">${S.csFold ? 'Show plays' : 'Hide'} <kbd>H</kbd></button></div>`;
  // The strip: the plays of one category in a row, each a real play diagram with its name.
  // The expanded playbook (X): every category at once.
  const body = S.csAll
    ? `<div class="cs-book">${tabs.map(([k, label, cs]) => `<section><h4>${label}</h4><div class="cs-cards">${cs.map(card).join('')}</div></section>`).join('')}</div>`
    : `<div class="cs-cards">${tabs.find(([k]) => k === cur)[2].map(card).join('')}</div>`;
  return `<div class="callsheet${S.csFold ? ' folded' : ''}${S.csAll ? ' all' : ''}" role="dialog" aria-label="Play call">${head}${body}</div>`;
}
// The formation (offense) or front (defense) for the call, as one compact control.
function formSelect(onOff) {
  const opts = onOff ? Object.entries(FORMATIONS).map(([k, f]) => [k, f.short]) : Object.entries(DEF_FORMATIONS).map(([k, f]) => [k, f.short]);
  const cur = (onOff ? S.formPick : S.frontPick) ?? '';
  return `<label class="cs-formsel"><span>${onOff ? 'Formation' : 'Front'} <kbd>Z</kbd></span><select id="cs-form" aria-label="${onOff ? 'Formation' : 'Front'}">
    <option value="" ${cur === '' ? 'selected' : ''}>Play default</option>${opts.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
function csMove(d) {
  const g = S.game;
  if (!g) return;
  const { tabs, cur } = csTabs(g);
  const i = tabs.findIndex(([k]) => k === cur);
  S.csTab = tabs[(i + d + tabs.length) % tabs.length][0];
  S.csPage = 0;
  render();
}

function playCards(g, { keys = false } = {}) {
  const { onOff, groups, fit } = callSheet(g);
  const fg = fgDistance(g);
  const card = ({ call, label }, fam) => {
    const p = onOff ? OFF_PLAYS[call] : DEF_PLAYS[call];
    const extra = call === 'fg' && onOff ? `${fg} yards · ${Math.round(fgOdds(g) * 100)}%` : p.blurb;
    return `<button class="play f-${fam} ${call === fit ? 'fit' : ''}" data-act="call" data-call="${call}">
      <b>${p.name}</b><span>${extra}</span>${call === fit ? '<em class="fittag">Fits this down</em>' : ''}${keys && label ? `<kbd>${label}</kbd>` : ''}</button>`;
  };
  const head = onOff ? `<div class="callhead"><h3>${downText(g)} at ${spotText(g)}</h3><span class="muted">Call your offense</span></div>`
    : `<div class="callhead"><h3>${downText(g)} at ${spotText(g)}</h3><span class="muted">${esc(g.teams[g.poss].abbr)} ball · call your defense</span></div>`;
  return `${head}<div class="playgroups">${groups.map(([fam, label, cs]) => `<div class="pgroup"><h4>${label}</h4>
    <div class="plays">${cs.map((c) => card(c, fam)).join('')}</div></div>`).join('')}</div>`;
}

function lastPlayHtml(g) {
  const e = [...g.log].reverse().find((x) => x.kind !== 'sub');
  if (!e) return '';
  const tone = e.highlight === 'td' || e.kind === 'score' ? 'td' : e.highlight === 'turnover' || e.kind === 'turnover' ? 'to' : e.highlight === 'sack' ? 'sack' : e.highlight === 'big' ? 'big' : '';
  const calls = e.off ? `<span class="calls">${OFF_PLAYS[e.off].name} vs ${DEF_PLAYS[e.def]?.name ?? ''}</span>` : '';
  return `<div class="lastplay ${tone}">${calls}<p>${esc(e.text).replace('It&#39;s super effective!', '<mark>It&#39;s super effective!</mark>')}</p></div>`;
}

function renderGame() {
  const g = S.game;
  if (!g) return `<section><p>No game in progress.</p></section>`;
  const us = userSide();
  const live3d = !!stage;
  const now = performance.now();
  // The call sheet only comes up once the result has been shown and the teams have reset.
  const decide = !g.final && needsUser(g) && !S.busy && !L3.lp && !(L3.resultUntil > now) && !(L3.resetUntil > now && !L3.preview?.lp?.set);
  const simOff = L3.lp && L3.lp.phase !== 'pre' ? 'disabled' : '';
  const simBtns = `<button class="btn" data-act="sim" data-stop="drive" ${simOff}>Sim drive</button>
        <button class="btn" data-act="sim" data-stop="quarter" ${simOff}>Sim quarter</button>
        <button class="btn" data-act="sim" data-stop="game" ${simOff}>Sim to the end</button>`;
  const coachBox = modeHtml();
  // On the 3D field the sims tuck into a Skip disclosure on the Coach mode row.
  const simrow = live3d ? `<div class="simrow">${coachBox}${S.skipOpen ? simBtns : ''}<button class="btn skip" id="g-skip" data-act="skip" aria-expanded="${!!S.skipOpen}">${S.skipOpen ? 'Hide' : 'Skip'}</button></div>`
    : `<div class="simrow">${coachBox}${simBtns}</div>`;
  let controls, dock = 'call';
  if (g.final) {
    dock = 'final';
    controls = `<div class="card final callcard"><h2>${g.winner == null ? 'Tie game' : g.teams[g.winner].id === (S.gameMeta?.userTeamId ?? 0) ? 'You win' : 'You lose'}, ${Math.max(...g.score)} to ${Math.min(...g.score)}</h2>
      <div class="actions">${S.gameMeta?.quick ? '<button class="btn primary" data-act="quick">Play another quick game</button><button class="btn" data-act="home">Home</button>'
        : '<button class="btn primary" data-act="finishgame">Back to the season</button>'}</div></div>`;
  } else {
    let head;
    if (L3.lp) {
      const lp = L3.lp;
      const mine = (lp.user === lp.o ? OFF_PLAYS[L3.off]?.name : DEF_PLAYS[L3.def]?.name) ?? '';
      dock = lp.phase === 'pre' ? 'lined' : 'live';
      head = `<div class="callhead"><h3>${lp.phase === 'pre' ? `Lined up: ${esc(mine)}` : 'Play in progress'}</h3><span class="muted">${downText(g)} at ${spotText(g)}</span></div>
        ${lp.phase === 'pre' ? `<div class="actions"><button class="btn primary" data-act="snap">${lp.user === lp.o ? 'Snap the ball' : 'Start the play'} <kbd>Space</kbd></button>
        ${S.coachDown ? '' : '<button class="btn" data-act="recall">Change play</button>'}</div>` : ''}`;
    } else if (decide) head = playCards(g, { keys: live3d }) + (live3d ? '' : presnapHtml(g) + tendenciesHtml(g));
    else {
      dock = 'wait';
      head = `<div class="callhead"><h3>${S.busy ? 'Play in progress' : 'AI calling this down'}</h3><span class="muted">Coach mode hands you 3rd and 4th downs and the last two minutes</span></div>`;
    }
    controls = `<div class="card callcard">${head}${simrow}</div>`;
  }
  if (live3d) {
    // The 3D game fills the screen: a broadcast scoreboard on top, a menu in the corner, the
    // call sheet only between plays, and the game details below the fold.
    let overlay = '';
    if (g.final) overlay = controls.replace('class="card ', 'class="card ov-final ');
    else if (L3.lp) {
      const lp = L3.lp;
      const offTxt = `${FORMATIONS[lp.formation]?.name ?? ''}`, defTxt = `${DEF_FORMATIONS[lp.defFormation]?.name ?? ''}`;
      const mine = lp.user === lp.o ? `${offTxt} · ${OFF_PLAYS[L3.off].name}` : `${defTxt} · ${DEF_PLAYS[L3.def].name}`;
      const theirs = lp.user === lp.o ? `vs ${defTxt}` : `vs ${offTxt}`;
      if (lp.phase === 'pre') overlay = `<div class="pill lined"><span class="pl-play">${esc(mine)}<small>${esc(theirs)}</small></span>
        <button class="btn primary" data-act="snap">${lp.user === lp.o ? 'Snap' : 'Start'} <kbd>Space</kbd></button>
        ${S.coachDown ? '' : '<button class="btn" data-act="recall">Change <kbd>Esc</kbd></button>'}</div>`;
    } else if (decide) overlay = callSheetHtml(g);
    else if (L3.resultUntil > performance.now()) overlay = '';
    else overlay = `<div class="pill wait"><span>${S.busy ? 'Play in progress' : 'AI calling this down'}</span></div>`;
    return `<section class="game g3d">
    <div class="stage-slot" id="stage-slot">
      ${broadcastBar(g)}
      <button class="menubtn" data-act="menu" aria-expanded="${!!S.menuOpen}" aria-label="Game menu"><span aria-hidden="true">☰</span> Menu <kbd>M</kbd></button>
      ${S.menuOpen ? menuHtml(g, simBtns, coachBox) : ''}
      ${!L3.lp || L3.lp.phase === 'pre' ? tickerHtml(g) : ''}
      ${S.debug ? debugHtml() : ''}
      ${overlay}
    </div>
    <div class="below">
      ${decide ? `<div class="card scoutpanel">${presnapHtml(g)}${tendenciesHtml(g)}</div>` : ''}
      <div class="tabs" role="tablist">${[['log', 'Play-by-play'], ['box', 'Box score'], ['drives', 'Drives'], ['lineup', 'Lineup and subs']].map(([k, l]) => `<button role="tab" aria-selected="${S.gameTab === k}" class="tab ${S.gameTab === k ? 'on' : ''}" data-act="gtab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="card tabbody">${S.gameTab === 'log' ? logHtml(g) : S.gameTab === 'box' ? boxHtml(g) : S.gameTab === 'lineup' ? lineupHtml(g) : drivesHtml(g)}</div>
      <p class="small muted">You coach ${esc(g.teams[us].name)}. ${WEATHER[g.weather].name}: ${WEATHER[g.weather].text}.</p>
    </div>
  </section>`;
  }
  return `<section class="game">
    ${scoreboard(g)}
    <div class="fieldwrap">${renderField(g)}</div>
    ${lastPlayHtml(g)}
    ${controls}
    <div class="tabs" role="tablist">${[['log', 'Play-by-play'], ['box', 'Box score'], ['drives', 'Drives'], ['lineup', 'Lineup and subs']].map(([k, l]) => `<button role="tab" aria-selected="${S.gameTab === k}" class="tab ${S.gameTab === k ? 'on' : ''}" data-act="gtab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="card tabbody">${S.gameTab === 'log' ? logHtml(g) : S.gameTab === 'box' ? boxHtml(g) : S.gameTab === 'lineup' ? lineupHtml(g) : drivesHtml(g)}</div>
    <p class="small muted">You coach ${esc(g.teams[us].name)}. ${WEATHER[g.weather].name}: ${WEATHER[g.weather].text}.</p>
  </section>`;
}

// Broadcast scoreboard: both teams, possession, quarter, clock, down and distance, the play
// clock and the ball spot, in one strip.
function broadcastBar(g) {
  const [H, A] = g.teams;
  const scored = (i) => (L3.scoreFlash?.[i] ?? 0) > performance.now() ? 'scored' : '';
  const team = (t, i) => `<div class="bc-team ${g.poss === i && !g.final ? 'has' : ''} ${scored(i)}" style="--team:${t.color}"><span class="bc-abbr">${esc(t.abbr)}</span><span class="bc-score">${g.score[i]}</span>${g.poss === i && !g.final ? '<span class="bc-poss" title="Has the ball" aria-label="Has the ball"></span>' : ''}</div>`;
  const info = g.final ? `<div class="bc-cell bc-down">FINAL</div>` : `<div class="bc-cell bc-q" title="Quarter">${g.quarter <= 4 ? `${['1st', '2nd', '3rd', '4th'][g.quarter - 1].toUpperCase()}<small>QTR</small>` : quarterText(g.quarter)}</div><div class="bc-cell bc-clock" id="gclock">${clockText(g.clock)}</div>
    <div class="bc-cell bc-down">${downText(g)}</div><div class="bc-cell bc-pc" id="pclock" title="Play clock">:${String(Math.ceil(L3.pclock ?? 40)).padStart(2, '0')}</div>
    <div class="bc-cell bc-spot">${spotText(g)}</div>`;
  return `<div class="bcast" id="bcast">${team(A, 1)}${team(H, 0)}${info}</div>`;
}

function tickerHtml(g) {
  const e = [...g.log].reverse().find((x) => x.kind !== 'sub');
  if (!e) return '';
  const tone = e.highlight === 'td' || e.kind === 'score' ? 'td' : e.highlight === 'turnover' || e.kind === 'turnover' ? 'to' : e.highlight === 'sack' ? 'sack' : e.highlight === 'big' ? 'big' : '';
  return `<div class="ticker ${tone} ${(L3.tickerUntil ?? 0) > performance.now() ? '' : 'gone'}" id="ticker"><span class="tk-label">Last play</span><p>${esc(e.text).replace('It&#39;s super effective!', '<mark>It&#39;s super effective!</mark>')}</p></div>`;
}

// Who runs the game: Play (you call every play and control your Pokémon), Coach (you call
// every play and the AI plays it out) or Auto (the AI also calls routine downs; 3rd and 4th
// downs and the last two minutes of a half are yours).
const MODES = [['play', 'Play', 'You call the plays and control your Pokémon'], ['coach', 'Coach', 'You call the plays, the AI plays them'], ['auto', 'Auto', 'The AI calls routine downs too']];
const modeOf = () => (S.coach ? 'auto' : S.watch ? 'coach' : 'play');
function modeHtml() {
  const cur = modeOf();
  return `<div class="gm-row seg modes" role="radiogroup" aria-label="Mode">${MODES.map(([k, l, d]) => `<button class="btn tiny ${cur === k ? 'on' : ''}" data-act="mode" data-mode="${k}" role="radio" aria-checked="${cur === k}" title="${d}">${l}</button>`).join('')}</div>
    <p class="small muted mode-note">${MODES.find(([k]) => k === cur)[2]}.</p>`;
}
function setMode(k) {
  S.coach = k === 'auto'; S.watch = k !== 'play';
  savePrefs(); render(); autoAdvance();
}

function menuHtml(g, simBtns, coachBox) {
  const simOff = L3.lp && L3.lp.phase !== 'pre';
  return `<div class="gmenu card" role="menu">
    <h4>Mode</h4>${coachBox}
    <h4>Skip ahead</h4><div class="gm-row">${simOff ? simBtns.replaceAll('data-act="sim"', 'data-act="sim" disabled') : simBtns}</div>
    <h4>Camera <kbd>C</kbd></h4><div class="gm-row seg">${CAMERA_MODES.map(([k, l]) => `<button class="btn tiny ${S.cam === k ? 'on' : ''}" data-act="cam" data-cam="${k}" aria-pressed="${S.cam === k}">${l}</button>`).join('')}</div>
    <h4>Graphics</h4><div class="gm-row seg">${[['auto', 'Auto'], ['high', 'High'], ['low', 'Fast']].map(([k, l]) => `<button class="btn tiny ${S.quality === k ? 'on' : ''}" data-act="quality" data-q="${k}" aria-pressed="${S.quality === k}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="g-sound" ${S.sound ? 'checked' : ''}> Sound: crowd, whistle and hits</label>
    <label class="check"><input type="checkbox" id="g-wx" ${S.weatherFx ? 'checked' : ''}> Weather effects (${WEATHER[g.weather].name})</label>
    <label class="check"><input type="checkbox" id="g-names" ${S.names ? 'checked' : ''}> Name and position over your player</label>
    <label class="check"><input type="checkbox" id="g-pips" ${S.pips ? 'checked' : ''}> Team markers under every player</label>
    <label class="check"><input type="checkbox" id="g-debug" ${S.debug ? 'checked' : ''}> Debug view: position labels, formation check, camera calibration <kbd>\`</kbd></label>
    <div class="gm-row"><button class="btn tiny" data-act="help">Controls <kbd>?</kbd></button><button class="btn tiny" data-act="replay" ${replayReady() ? '' : 'disabled'}>Replay last play <kbd>Y</kbd></button></div>
    <button class="btn tiny" data-act="details">Box score and play-by-play</button>
  </div>`;
}

// Type matchups for the down about to be played, from the lineups on the field now.
// Debug view: the play state, the formation check for the play on the field, and the broadcast
// camera's calibration sliders. Off in normal play (menu or the ` key turns it on).
function debugHtml() {
  const lp = L3.lp ?? L3.preview?.lp;
  const issues = lp?.formationIssues ?? [];
  const slider = (k, label, unit) => {
    const [lo, hi] = CAMERA_LIMITS[k];
    const v = S.cal[S.calShot][k];
    return `<label class="cal"><span>${label}</span><input type="range" id="cal-${k}" min="${lo}" max="${hi}" step="${k === 'zoom' ? 0.05 : 0.5}" value="${v}"><output id="calv-${k}">${v}${unit}</output></label>`;
  };
  return `<div class="dbg card" aria-label="Debug view">
    <h4>Debug <span class="muted" id="dbg-state">${L3.flow ?? ''}</span></h4>
    <p class="small ${issues.length ? 'bad' : 'good'}">${lp ? (issues.length ? `Formation: ${issues.length} problem${issues.length === 1 ? '' : 's'}: ${esc(issues.slice(0, 3).join('; '))}` : 'Formation check passed: 11 on 11, 7 on the line, no overlaps') : 'No formation on the field'}</p>
    <h4>Camera lenses</h4>
    <div class="gm-row">${CAMERA_SHOTS.map(([k, n]) => `<button class="btn tiny${S.calShot === k ? ' on' : ''}" data-act="calshot" data-k="${k}">${n}</button>`).join('')}</div>
    ${slider('pitch', 'Pitch', '°')}${slider('fov', 'Field of view', '°')}${slider('zoom', 'Zoom out', '×')}
    <button class="btn tiny" data-act="calreset">Reset camera</button>
  </div>`;
}

function presnapHtml(g) {
  const us = userSide(), them = 1 - us;
  const onOff = g.poss === us;
  const ms = onOff ? LG.matchups(g.teams[us].lineup, g.teams[them].lineup) : LG.matchups(g.teams[them].lineup, g.teams[us].lineup);
  const rows = ms.map((m) => ({ ...m, mine: onOff ? 'off' : 'def', edge: onOff ? m.net : -m.net }));
  const good = rows.filter((r) => r.edge > 0).length, bad = rows.filter((r) => r.edge < 0).length;
  const group = (key, title) => `<div><h4>${title}</h4><ul>${rows.filter((r) => r.group === key).map(edgeRow).join('')}</ul></div>`;
  return `<details class="presnap" ${S.presnapClosed ? '' : 'open'}><summary>Pre-snap board <span class="muted small">${good} type edge${good === 1 ? '' : 's'} for you, ${bad} for them</span></summary>
    <div class="edges">${group('trench', onOff ? 'Your line vs their front' : 'Your front vs their line')}${group('cover', onOff ? 'Your receivers vs their coverage' : 'Your coverage vs their receivers')}</div></details>`;
}

function tendenciesHtml(g) {
  const us = userSide(), them = 1 - us;
  const plays = g.log.filter((e) => e.off && e.def && e.down && ['run', 'pass'].includes(OFF_PLAYS[e.off]?.kind));
  const theirOff = plays.filter((e) => e.team === them), theirDef = plays.filter((e) => e.team === us);
  const pct = (list, f) => Math.round((100 * list.filter(f).length) / list.length);
  const isRun = (e) => OFF_PLAYS[e.off].kind === 'run';
  const lines = [];
  const first = theirOff.filter((e) => e.down === 1);
  if (first.length >= 3) lines.push(`Run on 1st down ${pct(first, isRun)}% of the time, inside runs ${pct(first, (e) => e.off === 'inside_run')}% (${first.length} plays).`);
  const third = theirOff.filter((e) => e.down === 3);
  if (third.length >= 3) lines.push(`Pass on 3rd down ${pct(third, (e) => !isRun(e))}% (${third.length} plays).`);
  const long3 = theirDef.filter((e) => e.down >= 3 && e.toGo >= 7);
  if (long3.length >= 3) lines.push(`Blitz on 3rd and long ${pct(long3, (e) => e.def.endsWith('blitz'))}% (${long3.length} plays).`);
  const fav = (list, key, names) => {
    const counts = {};
    for (const e of list) counts[e[key]] = (counts[e[key]] ?? 0) + 1;
    const [k, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return `${names[k].name} ${Math.round((100 * c) / list.length)}%`;
  };
  if (theirOff.length >= 6) lines.push(`Favorite call on offense: ${fav(theirOff, 'off', OFF_PLAYS)}.`);
  if (theirDef.length >= 6) lines.push(`Favorite call on defense: ${fav(theirDef, 'def', DEF_PLAYS)}.`);
  if (!lines.length) return '<p class="small muted tend">Their tendencies show up here after a few drives.</p>';
  return `<div class="tend"><h4>${esc(g.teams[them].abbr)} tendencies this game</h4><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`;
}

// Coach's substitutions: pick a slot, then a bench Pokémon.
function lineupHtml(g) {
  const us = userSide(), t = g.teams[us], opp = g.teams[1 - us];
  const can = !g.final && !S.busy && !L3.lp;
  const sel = S.subSel;
  const onField = new Set(Object.values(t.lineup));
  const bench = t.roster.filter((id) => !onField.has(id));
  const across = {};
  for (const [o, d] of LG.MATCHUP_PAIRS) { across[o] ??= d; across[d] ??= o; }
  const slotRow = (k) => {
    const id = t.lineup[k], e = Math.round(t.energy[id] ?? 100);
    const locked = t.locks?.[k] != null, starter = t.starters[k];
    return `<li class="${sel === k ? 'sel' : ''}"><button class="subslot" data-act="subslot" data-slot="${k}" ${can ? '' : 'disabled'}>
      <span class="slot">${k}</span>${sprite(id, 'xs')}<span class="cn">${esc(P(id).name)}</span>${ovr(P(id).ovr[k])}<span class="en ${e < 60 ? 'low' : ''}">${e}%</span>
      ${locked ? '<span class="lock">Coach</span>' : id !== starter ? '<span class="lock auto">Auto sub</span>' : ''}</button>
      ${locked ? `<button class="btn tiny" data-act="subback" data-slot="${k}" ${can ? '' : 'disabled'}>Starter back</button>` : ''}</li>`;
  };
  let pickList = '';
  if (sel) {
    const foe = opp.lineup[across[sel]];
    pickList = `<div class="card subpick"><h4>Sub in at ${sel}${foe ? ` · across from ${esc(P(foe).name)} (${P(foe).types.join('/')})` : ''}</h4>
      ${bench.length ? `<ul>${bench.map((id) => {
        const m = foe ? bestMultiplier(P(id), P(foe)) : 1;
        const lbl = effectLabel(m);
        return `<li><button class="subslot" data-act="subin" data-id="${id}" ${can ? '' : 'disabled'}>${sprite(id, 'xs')}<span class="cn">${esc(P(id).name)}</span><span class="types">${typeChips(P(id).types)}</span>${ovr(P(id).ovr[sel])}
          <span class="en">${Math.round(t.energy[id] ?? 100)}%</span>${lbl ? `<span class="eff ${m > 1 ? 'se' : m === 0 ? 'ne' : 'nve'}">${lbl}</span>` : ''}</button></li>`;
      }).join('')}</ul>` : '<p class="muted small">Nobody on the bench. A 28-round league carries four backups.</p>'}
      <button class="btn tiny" data-act="subcancel">Cancel</button></div>`;
  }
  return `<p class="small muted">Pick a slot, then a bench Pokémon. Your subs stay in until you send the starter back, and the auto-sub leaves those slots alone.${can ? '' : ' Subs wait until the play is over.'}</p>
    <div class="subgrid"><div><h4>Offense</h4><ul class="sublist">${OFF_SLOTS.map(slotRow).join('')}</ul></div>
    <div><h4>Defense</h4><ul class="sublist">${DEF_SLOTS.map(slotRow).join('')}</ul><h4>Special teams</h4><ul class="sublist">${ST_SLOTS.map(slotRow).join('')}</ul></div></div>${pickList}`;
}

function keysHelp() {
  return `<div class="keygrid">
    <span><kbd>1</kbd>-<kbd>8</kbd> between plays: call that play on the open page · <kbd>←</kbd> <kbd>→</kbd> turn the page</span>
    <span><kbd>C</kbd> change camera (gameplay, tactical, broadcast, player) · <kbd>M</kbd> menu · <kbd>Esc</kbd> change the play</span>
    <span><kbd>Space</kbd> snap (hurries everyone to the line), juke with the ball, dive to tackle</span>
    <span><kbd>W A S D</kbd> or arrows: move your player</span>
    <span><kbd>Shift</kbd> sprint</span>
    <span><kbd>1</kbd>-<kbd>5</kbd> throw: tap for touch, hold for a bullet, <kbd>Shift</kbd> + number for a lob</span>
    <span>Hold a direction as you throw to place the ball: up leads him, down brings it back, sideways away from the defender</span>
    <span><kbd>Space</kbd> while the ball is in the air: go up and attack it</span>
    <span><kbd>T</kbd> throw it away</span>
    <span><kbd>E</kbd> truck through a tackler</span>
    <span><kbd>R</kbd> spin move</span>
    <span><kbd>Q</kbd> on defense: switch to the player nearest the ball</span>
    <span><kbd>P</kbd> pause during a play · <kbd>Y</kbd> replay the last play · <kbd>?</kbd> this list</span>
    <span>Leave the keys alone and your player runs on autopilot.</span>
  </div>`;
}

function logHtml(g) {
  const rows = g.log.slice(-80).reverse();
  return `<ol class="pbp">${rows.map((e) => {
    const t = g.teams[e.poss];
    const sit = e.down ? `${['', '1st', '2nd', '3rd', '4th'][e.down]} & ${e.spotBefore + e.toGo >= 100 ? 'Goal' : e.toGo}` : '';
    return `<li class="k-${e.kind} ${e.highlight ? `h-${e.highlight}` : ''}"><span class="when">${quarterText(e.q)} ${clockText(e.clock)}</span>
      ${e.down ? `<span class="sit">${teamBadge(t)} ${sit}</span>` : ''}<span class="txt">${esc(e.text).replace('It&#39;s super effective!', '<mark>It&#39;s super effective!</mark>')}</span></li>`;
  }).join('')}</ol>`;
}

function boxHtml(g) {
  const qs = [0, 1].map((i) => g.qs[i]);
  const nQ = Math.max(4, qs[0].length, qs[1].length);
  const line = `<table class="linescore"><thead><tr><th></th>${Array.from({ length: nQ }, (_, i) => `<th class="num">${i < 4 ? i + 1 : 'OT'}</th>`).join('')}<th class="num">T</th></tr></thead>
    <tbody>${[1, 0].map((i) => `<tr><td>${teamBadge(g.teams[i])}</td>${Array.from({ length: nQ }, (_, q) => `<td class="num">${qs[i][q] ?? 0}</td>`).join('')}<td class="num"><b>${g.score[i]}</b></td></tr>`).join('')}</tbody></table>`;
  const T = (i) => g.teams[i].team;
  const fmtTop = (s) => clockText(s);
  const rowsT = [['First downs', (i) => T(i).fd], ['Total yards', (i) => T(i).yds], ['Passing', (i) => T(i).passYds], ['Rushing', (i) => T(i).rushYds],
    ['Sacks allowed', (i) => T(i).sacks], ['Turnovers', (i) => T(i).to], ['3rd down', (i) => `${T(i).third[1]}/${T(i).third[0]}`], ['Possession', (i) => fmtTop(T(i).top)]];
  const team = `<table class="teamstats"><thead><tr><th></th><th class="num">${esc(g.teams[1].abbr)}</th><th class="num">${esc(g.teams[0].abbr)}</th></tr></thead>
    <tbody>${rowsT.map(([l, f]) => `<tr><td>${l}</td><td class="num">${f(1)}</td><td class="num">${f(0)}</td></tr>`).join('')}</tbody></table>`;
  const players = [1, 0].map((i) => {
    const t = g.teams[i];
    const ents = Object.entries(t.stats).map(([id, s]) => ({ id: Number(id), s }));
    const sect = (title, filter, cols) => {
      const rs = ents.filter(({ s }) => filter(s));
      if (!rs.length) return '';
      return `<h4>${title}</h4><table class="pstats"><thead><tr><th></th>${cols.map(([h]) => `<th class="num">${h}</th>`).join('')}</tr></thead>
        <tbody>${rs.map(({ id, s }) => `<tr><td>${sprite(id, 'xs')}${esc(P(id).name)}</td>${cols.map(([, f]) => `<td class="num">${f(s)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    };
    return `<div class="pcol"><h3>${teamBadge(t)} ${esc(t.name)}</h3>
      ${sect('Passing', (s) => s.pa > 0, [['C/ATT', (s) => `${s.pc}/${s.pa}`], ['YDS', (s) => s.py], ['TD', (s) => s.ptd], ['INT', (s) => s.pint], ['SK', (s) => s.sk]])}
      ${sect('Rushing', (s) => s.ra > 0, [['CAR', (s) => s.ra], ['YDS', (s) => s.ry], ['TD', (s) => s.rtd], ['LNG', (s) => s.rlong]])}
      ${sect('Receiving', (s) => s.tg > 0, [['REC', (s) => s.rc], ['TGT', (s) => s.tg], ['YDS', (s) => s.rcy], ['TD', (s) => s.rctd]])}
      ${sect('Defense', (s) => s.tk + s.dsk + s.dint + s.pd > 0, [['TKL', (s) => s.tk], ['SK', (s) => s.dsk], ['INT', (s) => s.dint], ['PD', (s) => s.pd]])}
    </div>`;
  }).join('');
  return `<div class="tablewrap">${line}</div><div class="tablewrap">${team}</div><div class="pgrid">${players}</div>`;
}

function drivesHtml(g) {
  const ds = [...g.drives].reverse();
  if (!ds.length) return '<p class="muted">No completed drives yet.</p>';
  return `<div class="tablewrap"><table class="drives"><thead><tr><th>Team</th><th>Start</th><th class="num">Plays</th><th class="num">Yards</th><th>Result</th></tr></thead>
    <tbody>${ds.map((d) => `<tr><td>${teamBadge(g.teams[d.team])}</td><td>${quarterText(d.q)} ${clockText(d.clock)}</td><td class="num">${d.plays}</td><td class="num">${d.yards}</td><td>${d.result}</td></tr>`).join('')}</tbody></table></div>`;
}

// Animate the ball carrier to the play's end spot, then redraw.
function animatePlay(entry, done) {
  const field = document.getElementById('field');
  if (!field || reduceMotion || !entry || entry.to == null || entry.from == null) { done(); return; }
  const X = (yd) => ((clampN(yd, -9, 109) + 10) / 120) * 100;
  const ball = document.getElementById('football');
  const carrier = entry.carrier != null ? field.querySelector(`[data-pid="${entry.carrier}"]`) : null;
  field.classList.add('running');
  requestAnimationFrame(() => {
    if (ball) ball.style.left = `${X(entry.to)}%`;
    if (carrier) { carrier.classList.add('carrier'); carrier.style.left = `${X(entry.to)}%`; carrier.style.top = '50%'; if (ball) ball.style.top = '50%'; }
  });
  setTimeout(done, 750);
}

function doCall(call) {
  const g = S.game;
  if (!g || g.final || S.busy || L3.lp) return;
  if (stage && L3.flow !== 'PLAY_SELECTION' && L3.flow != null) return;
  const us = userSide();
  // A call from the wrong side's sheet (a stale click, a script) is ignored.
  if (!(g.poss === us ? OFF_PLAYS : DEF_PLAYS)[call]) return;
  const off = g.poss === us ? call : aiOffenseCall(g);
  const def = g.poss === us ? aiDefenseCall(g) : call;
  S.coachDown = false;
  S.csTab = null; S.csPage = 0;
  // Coach mode: you call it, the AI plays it (and snaps it after a beat).
  const formation = g.poss === us ? formFor(off) : aiFormation(off), defFormation = g.poss === us ? aiFront(def) : frontFor(def);
  if (stage && ['run', 'pass'].includes(OFF_PLAYS[off].kind)) { startLive(off, def, { userSide: us, watch: !!S.watch, autoQB: !!S.watch, autoSnap: S.watch || g.poss !== us ? 1.6 : null, formation, defFormation }); return; }
  S.busy = true;
  if (stage && L3.preview) { L3.spots = worldSpots(L3.preview.lp); L3.preview = null; }
  const entry = runPlay(g, off, def);
  if (stage) { S.busy = false; afterLivePlay(entry); return; }
  animatePlay(entry, () => { S.busy = false; save(); render(); autoAdvance(); });
}

// Auto mode: the AI calls downs until a decision is yours, and plays them out.
function autoAdvance() {
  clearTimeout(timers.auto);
  const g = S.game;
  if (!g || g.final || S.screen !== 'game' || !S.coach || needsUser(g) || L3.lp) return;
  timers.auto = setTimeout(() => {
    if (!S.game || S.game.final || S.screen !== 'game' || L3.lp) return;
    if (stage && L3.flow !== 'PLAY_SELECTION') { autoAdvance(); return; }
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    if (stage && ['run', 'pass'].includes(OFF_PLAYS[off].kind)) {
      S.coachDown = true;
      startLive(off, def, { userSide: userSide(), watch: true, autoQB: true, autoSnap: 1.4, formation: aiFormation(off), defFormation: aiFront(def) });
      return;
    }
    S.busy = true;
    render();
    const entry = runPlay(g, off, def);
    if (stage) { S.busy = false; afterLivePlay(entry); return; }
    animatePlay(entry, () => { S.busy = false; save(); render(); autoAdvance(); });
  }, stage ? 700 : 650);
}

// ---------- the live 3D game ----------
const L3 = { lp: null, off: null, def: null, acc: 0, last: 0, deadT: 0, autoSnap: null, keys: new Set(), edges: new Set(), ev: 0, raf: 0, flashT: 0,
  preview: null, spots: null, pclock: 40, pcKey: null, before: null, state: null, flow: null, flowAt: 0, trace: [], resultUntil: 0, resetUntil: 0,
  tickerUntil: 0, scoreFlash: [0, 0], committed: null, hold: 0, banner: null };

// The game flow, one state at a time, each with its own controls, camera and UI:
//   PLAY_SELECTION   the call sheet is up; the teams stand at the new spot
//   FORMATION_SETUP  both teams walk into the called formation (no snap yet)
//   PRE_SNAP         set; the formation check has passed; Space snaps
//   SNAP             the exchange from the center
//   LIVE_PLAY        the play runs; the HUD shows only what the play needs
//   PLAY_RESULT      the whistle: the result is applied to the game (score, down, distance,
//                    possession, clock) and shown over a held camera on the tackle or catch
//   RESET_FORMATION  the players get up and jog to the next spot, the camera eases back
// and then PLAY_SELECTION again. Each change is recorded (tests read the trace), clears any
// key presses that belonged to the previous state, and is handed to the stage for the camera.
function setFlow(st) {
  if (L3.flow === st) return;
  L3.flow = st;
  L3.flowAt = performance.now();
  L3.edges.clear();
  if (st !== 'PRE_SNAP' && st !== 'FORMATION_SETUP') L3.snapWant = false;
  const g = S.game;
  L3.trace.push({ state: st, at: Math.round(performance.now()), clock: g?.clock, poss: g?.poss, down: g?.down, toGo: g?.toGo, spot: g?.spot, score: g ? [...g.score] : null });
  if (L3.trace.length > 400) L3.trace.shift();
  stage?.setState?.(st);
  const d = document.getElementById('dbg-state');
  if (d) d.textContent = st;
}
// Older name kept for the debug hooks.
const setState = setFlow;
let stage = null;
let stageWrap = null;
// Hooks for the browser tests (test/browser.mjs): read-only views of the game's state.
if (typeof window !== 'undefined') window.__pb = { S, L3, get stage() { return stage; }, setState, doCall, doSnap, setMode, setDebug };

function ensureStage() {
  if (stage || !webglAvailable()) return;
  try {
    stage = new Stage();
  } catch (e) { console.error("stage", e); stage = null; return; }
  stage.setCameraMode(S.cam);
  stage.setWeatherFx(S.weatherFx);
  stage.rig.setCalibration(S.cal);
  stage.debug = S.debug; stage.showNames = S.names; stage.showPips = !!S.pips;
  if (S.quality !== 'auto') stage.setQuality(S.quality);
  stageWrap = document.createElement('div');
  stageWrap.className = 'stagewrap';
  stageWrap.innerHTML = `<div class="hud"><div class="hud-call" id="hud-call"></div><div class="hud-flash" id="hud-flash"></div><div class="hud-tip" id="hud-tip"></div></div>
    <div class="lower3" id="lower3" aria-live="polite"></div>
    <div class="ov-badge" id="replay-badge" hidden>Replay</div>
    <button class="hud-replay" id="replay-btn" data-act="replay" hidden>Replay <kbd>Y</kbd></button>
    <div class="ov-pause" id="pause-ov" hidden><div><b>Paused</b><span>Press <kbd>P</kbd> or <kbd>Esc</kbd> to resume</span><button class="btn" data-act="resume">Resume</button></div></div>
    <div class="ov-help" id="help-ov" hidden><div class="card"><h3>Controls</h3>${keysHelp()}<button class="btn primary" data-act="helpok">Got it</button></div></div>
    <div class="dbg-hud" id="dbg-hud"></div>
    <div class="touch" id="touch" aria-hidden="true"><div class="stick" id="stick"><span></span></div>
      <div class="tbtns"><button data-key="Space">Snap / Juke / Dive</button><button data-key="KeyE">Truck</button><button data-key="KeyR">Spin</button><button data-key="KeyQ">Switch</button>
      <span class="trow">${[1, 2, 3, 4, 5].map((n) => `<button data-key="Digit${n}">${n}</button>`).join('')}</span></div></div>`;
  stageWrap.prepend(stage.el);
  bindTouch(stageWrap);
  if (!L3.raf) L3.raf = requestAnimationFrame(loop);
}

function mountStage() {
  const slot = document.getElementById('stage-slot');
  if (!slot || !stageWrap) return;
  slot.prepend(stageWrap);
  fitStage();
  stage.resize();
  if (!L3.lp) showPreview();
}

// The 3D game fills the viewport under the sticky top bar.
function fitStage() {
  const top = document.querySelector('.top')?.offsetHeight ?? 0;
  document.documentElement.style.setProperty('--top-h', `${top}px`);
  fitDock();
}

// Keep the line of scrimmage clear of the call sheet: the view shifts up by part of it.
function fitDock() {
  const sheet = document.querySelector('.game.g3d .callsheet:not(.folded)');
  stage?.setInset(sheet ? sheet.offsetHeight + 10 : 0);
}

// Between plays, both teams get up and jog from where the last play ended to the new spot.
function showPreview() {
  const g = S.game;
  if (!g || !stage) return;
  const us = userSide();
  const key = `${g.playNo}:${g.poss}:${g.spot}:${g.final}`;
  if (L3.preview?.key === key && L3.preview.g === g) { stage.setPlay(L3.preview.lp); return; }
  const saved = g.rng;
  const first = !L3.preview && !L3.spots;
  const lp = createLivePlay(g, g.poss === us ? 'slant' : 'inside_run', 'base', { userSide: us, from: L3.spots ?? undefined });
  g.rng = saved;
  lp.control = null; lp.preview = true;
  L3.preview = { key, lp, g, mv: measureVersion };
  L3.spots = null;
  stage.setPlay(lp);
  if (first) stage.snapCamera();
}

function startLive(off, def, opts) {
  const g = S.game;
  // Line up from wherever the players are standing in the preview.
  const from = L3.preview?.lp ? worldSpots(L3.preview.lp) : L3.spots ?? undefined;
  L3.before = { poss: g.poss, down: g.down, toGo: g.toGo, spot: g.spot, score: [...g.score] };
  if (L3.replay) stopReplay();
  // The replay recording: the game as it was before the play (its random seed included) and
  // every simulation step's input, so the play can be run again exactly, step for step.
  L3.rec = { g: structuredClone(g), off, def, opts: { ...opts, from }, log: [], done: false };
  L3.lp = createLivePlay(g, off, def, { ...opts, from });
  L3.paused = false;
  L3.off = off; L3.def = def; L3.acc = 0; L3.deadT = 0; L3.ev = 0; L3.committed = null;
  L3.autoSnap = opts.autoSnap ?? null;
  L3.pclock = Math.max(L3.pclock, 10);
  L3.edges.clear(); L3.hold = null; L3.lob = null;
  S.menuOpen = false;
  hideBanner();
  stage.setPlay(L3.lp);
  setFlow(L3.lp.set ? 'PRE_SNAP' : 'FORMATION_SETUP');
  render();
}

function doSnap() {
  const lp = L3.lp;
  if (!lp || lp.phase !== 'pre') return;
  L3.rec?.log.push({ snap: true, control: lp.control ? [lp.control.side, lp.control.slot] : null });
  // The play as it stands at the snap. Lining up depends on the measured model footprints, which
  // change as models finish loading, so the replay starts from this copy rather than lining up again.
  if (L3.rec) try { L3.rec.atSnap = structuredClone(lp); } catch { L3.rec.atSnap = null; }
  snap(lp);
  L3.autoSnap = null;
  render();
}

// The whistle has blown: the game takes the result now (score, down and distance, possession,
// the clock), while the field holds on the play for a beat.
function commitPlay() {
  const lp = L3.lp, g = S.game, b = L3.before;
  const entry = runLivePlay(g, L3.off, L3.def, lp.result, playSeconds(lp));
  L3.committed = entry;
  if (L3.rec) { L3.rec.done = true; L3.rec.end = endKey(lp); }
  const big = entry.highlight === 'td' || entry.kind === 'score' || entry.turnover || entry.kind === 'turnover';
  L3.hold = lp.end?.how === 'td' ? 3.2 : big ? 2.6 : lp.end?.how === 'incomplete' ? 1.6 : 2.0;
  L3.tickerUntil = performance.now() + 6500;
  if (b) for (const i of [0, 1]) if (g.score[i] !== b.score[i]) L3.scoreFlash[i] = performance.now() + 2200;
  L3.pclock = 40;
  save();
  render();
  showBanner(resultBanner(entry, lp, b));
}

// The result hold is over: the players get up and walk to the next spot.
function endResult() {
  const lp = L3.lp;
  L3.lp = null;
  L3.spots = worldSpots(lp);
  L3.preview = null;
  L3.before = null;
  L3.committed = null;
  L3.resetUntil = performance.now() + 1300;
  S.coachDown = false;
  hideBanner(1200);
  setFlow('RESET_FORMATION');
  render();
  autoAdvance();
}

// For plays resolved without the live field (punts, field goals): the same result beat.
function afterLivePlay(entry) {
  const g = S.game, b = L3.before;
  L3.rec = null;
  L3.before = null;
  L3.pclock = 40;
  const now = performance.now();
  if (stage && entry) { L3.resultUntil = now + 1800; setFlow('PLAY_RESULT'); }
  L3.tickerUntil = now + 6500;
  if (b) for (const i of [0, 1]) if (g.score[i] !== b.score[i]) L3.scoreFlash[i] = now + 2200;
  save();
  render();
  if (!entry || !g) { autoAdvance(); return; }
  if (stage) showBanner(resultBanner(entry, null, b));
  autoAdvance();
}

// The broadcast lower third after the whistle: what happened, the yards, who did it, the next
// down, and anything a Pokémon's type or ability changed. Built from the game's own record.
function resultBanner(e, lp, before) {
  const g = S.game;
  if (!e || !g) return null;
  const b = before ?? { poss: g.poss, down: 1 };
  const how = lp?.end?.how;
  const yd = e.yards ?? 0;
  const yds = how === 'incomplete' || e.kind === 'punt' || e.kind === 'fg' ? '' : yd === 0 ? 'No gain' : `${yd > 0 ? '+' : '−'}${Math.abs(yd)} yd${Math.abs(yd) === 1 ? '' : 's'}`;
  const changed = g.poss !== b.poss && !g.final;
  let head = '', tone = '';
  const td = e.highlight === 'td' || (e.kind === 'score' && before && g.score.some((v, i) => v - before.score[i] >= 6));
  if (td) { head = 'Touchdown'; tone = 'td'; }
  else if (e.kind === 'score') { head = /safety/i.test(e.text) ? 'Safety' : 'Field goal'; tone = 'td'; }
  else if (e.turnover === 'int' || /INTERCEPT/i.test(e.text)) { head = 'Interception'; tone = 'to'; }
  else if (e.turnover === 'fumble' || /FUMBLE!/.test(e.text) && changed) { head = 'Fumble'; tone = 'to'; }
  else if (changed && ['run', 'pass', 'sack'].includes(e.kind)) { head = 'Turnover on downs'; tone = 'to'; }
  else if (e.kind === 'punt') head = 'Punt';
  else if (e.kind === 'fg') { head = 'Field goal no good'; tone = 'to'; }
  else if (how === 'incomplete') { head = 'Incomplete'; tone = 'muted'; }
  else if (e.kind === 'sack' || how === 'sack') { head = 'Sack'; tone = 'to'; }
  else if (!changed && g.down === 1 && b.down >= 1 && yd > 0) { head = 'First down'; tone = 'big'; }
  else if (how === 'out') head = 'Out of bounds';
  else head = yd < 0 ? 'Loss' : 'Tackle';
  // Why it happened, when a Pokémon's type, ability or size decided part of the play.
  const notes = (lp?.notes ?? []).filter((n) => n.kind === 'type' || n.kind === 'ability' || n.kind === 'size').slice(0, 2).map((n) => ({ kind: n.kind, text: n.text }));
  const next = g.final ? 'Final' : `${changed ? `${g.teams[g.poss].abbr} ball · ` : ''}${downText(g)} at ${spotText(g)}`;
  const clock = e.clockStop && !td ? 'Clock stopped' : '';
  return { head, tone, yds, text: e.text.replace(/ It's super effective!/, ''), next, notes, clock, possession: changed };
}
function showBanner(B) {
  const el = document.getElementById('lower3');
  if (!el || !B) return;
  clearTimeout(timers.banner);
  L3.banner = B;
  el.className = `lower3 on ${B.tone}${B.possession ? ' poss' : ''}`;
  el.innerHTML = `<div class="l3-head"><b>${esc(B.head)}</b>${B.yds ? `<span class="l3-yds">${esc(B.yds)}</span>` : ''}${B.clock ? `<span class="l3-clock">${B.clock}</span>` : ''}</div>
    <p class="l3-text">${esc(B.text)}</p>${B.notes.map((n) => `<p class="l3-note"><span class="l3-tag ${n.kind}">${{ type: 'Type', ability: 'Ability', size: 'Size' }[n.kind] ?? ''}</span>${esc(n.text)}</p>`).join('')}<p class="l3-next">${esc(B.next)}</p>`;
}
function hideBanner(after = 0) {
  clearTimeout(timers.banner);
  const go = () => { const el = document.getElementById('lower3'); if (el) el.className = 'lower3'; L3.banner = null; };
  if (after) timers.banner = setTimeout(go, after); else go();
}

function flash(text, tone = '') {
  const el = document.getElementById('hud-flash');
  if (!el || !text) return;
  el.textContent = text;
  el.className = `hud-flash on ${tone}`;
  L3.flashT = performance.now() + 1200;
}

function readInput(lp) {
  const k = L3.keys, e = L3.edges;
  const up = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) + (L3.stick?.up ?? 0);
  const right = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) + (L3.stick?.right ?? 0);
  const m = stage.toPlayFrame(up, right);
  // Throws: tap a receiver's number for a touch pass, hold it for a bullet, Shift with it for a
  // lob. The stick at release places the ball.
  const shift = k.has('ShiftLeft') || k.has('ShiftRight');
  const pressed = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].find((d) => e.has(d));
  let throwKey = null, throwType = null;
  if (pressed) {
    if (shift || L3.lob === pressed) { throwKey = pressed; throwType = 'lob'; L3.hold = null; L3.lob = null; }
    else L3.hold = { key: pressed, t0: performance.now() };
  }
  if (L3.hold && !throwKey) {
    const held = performance.now() - L3.hold.t0;
    if (!k.has(L3.hold.key)) { throwKey = L3.hold.key; throwType = 'touch'; L3.hold = null; }
    else if (held >= 220) { throwKey = L3.hold.key; throwType = 'bullet'; L3.hold = null; }
  }
  const inp = {
    mx: m.mx, my: m.my, sprint: shift && !throwKey,
    juke: e.has('Space'), dive: e.has('Space'), truck: e.has('KeyE'), spin: e.has('KeyR'),
    throwTo: throwKey ? ['WR1', 'WR2', 'WR3', 'TE', 'RB'][Number(throwKey.slice(5)) - 1] : null, throwType,
    throwAway: e.has('KeyT'), switchTo: e.has('KeyQ') || e.has('Tab') ? 'ball' : null,
  };
  e.clear();
  return inp;
}

// The one line of controls for the moment, at the bottom of the screen.
function hudTip(lp) {
  const f = L3.flow;
  if (!lp) return f === 'PLAY_SELECTION' && S.game && !S.game.final && needsUser(S.game) && !S.busy ? 'Pick a play · number keys · ← → categories' : '';
  const c = lp.control;
  if (f === 'FORMATION_SETUP') return 'Lining up…';
  if (lp.phase === 'pre') {
    if (!c) return 'Coach mode · Space to snap now · Esc to change the call';
    return lp.user === lp.o ? `Space snap${lp.kind === 'pass' ? ' · then 1-5 throw' : ''} · Esc change call` : 'Space start · Q pick a defender';
  }
  if (lp.phase === 'dead') return '';
  if (!c) return 'Watching the AI run your call';
  if (c.side === 'off' && c.slot === 'QB' && lp.kind === 'pass' && !lp.thrown && !lp.windup && lp.qbState !== 'run') return '1-5 tap touch · hold bullet · Shift lob · arrows place the ball · T away';
  if (lp.thrown && lp.ball.state === 'air' && lp.thrown.target === c) return 'Ball in the air · arrows adjust · Space go up for it';
  if (c.carrier) return 'Arrows run · Shift sprint · Space juke · R spin · E truck';
  if (c.side === 'def') return 'Arrows move · Shift sprint · Space dive/tackle · Q switch to the ball';
  return 'Arrows move · Shift sprint';
}

function flowNow(now) {
  const lp = L3.lp;
  if (lp) {
    if (lp.phase === 'pre') return lp.set ? 'PRE_SNAP' : 'FORMATION_SETUP';
    if (lp.phase === 'dead') return 'PLAY_RESULT';
    return playState(lp) === 'SNAP' ? 'SNAP' : 'LIVE_PLAY';
  }
  if (L3.resultUntil > now) return 'PLAY_RESULT';
  if (L3.resetUntil > now && !(L3.preview?.lp?.set)) return 'RESET_FORMATION';
  return 'PLAY_SELECTION';
}

function loop(now) {
  L3.raf = requestAnimationFrame(loop);
  if (!stage || S.screen !== 'game' || !document.getElementById('stage-slot')) { L3.last = now; return; }
  const dt = Math.min(0.1, (now - (L3.last || now)) / 1000);
  L3.last = now;
  const lp = L3.lp;
  const g = S.game;
  let sim = null;
  const hold = isPaused();
  if (lp && hold) {
    // Paused: the play stands still (the clocks with it) until it is resumed.
    sim = lp;
    L3.acc = 0;
  } else if (lp) {
    sim = lp;
    if (lp.phase === 'pre') {
      // Fixed-step the walk to the line, like the live play.
      L3.acc += dt;
      while (L3.acc >= DT) { stepLive(lp, null); L3.rec?.log.push(null); L3.acc -= DT; }
      if (lp.phase !== 'pre') render();
      // Snap only once set, and only on a press made in this state (no carried-over keys).
      // A press while the line is still settling is kept and snaps the moment it is set.
      const ready = lp.set && now - L3.flowAt > 250;
      if (L3.edges.has('Space')) { L3.snapWant = true; if (!lp.set) hurry(lp); }
      if (L3.snapWant && ready) { L3.edges.clear(); L3.snapWant = false; doSnap(); }
      else if (L3.edges.has('KeyQ') || L3.edges.has('Tab')) {
        L3.edges.clear();
        if (lp.user === lp.d && lp.control) {
          const order = ['MLB', 'OLB', 'SS', 'FS', 'CB1', 'CB2', 'CB3', 'LE', 'DE', 'DT1', 'DT2'].map((k) => lp.def[k]).filter(Boolean);
          lp.control = order[(order.indexOf(lp.control) + 1) % order.length];
        }
      } else L3.edges.clear();
      if (L3.autoSnap != null && lp.set) { L3.autoSnap -= dt; if (L3.autoSnap <= 0) doSnap(); }
      // Play clock: when it runs out on a lined-up play, the ball is snapped.
      if (lp.set && L3.autoSnap == null) { L3.pclock = Math.max(0, L3.pclock - dt); if (L3.pclock <= 0) doSnap(); }
    } else {
      L3.acc += dt;
      while (L3.acc >= DT) {
        const inp = lp.phase === 'live' ? readInput(lp) : null;
        stepLive(lp, inp);
        L3.rec?.log.push(inp);
        L3.acc -= DT;
      }
      if (lp.phase === 'dead') {
        if (!L3.committed) commitPlay();
        L3.deadT += dt;
        if (L3.deadT > L3.hold) { endResult(); sim = null; }
      }
    }
  } else if (L3.resultUntil > now) {
    // A kick or field goal result: hold the field for a beat.
    L3.acc = 0;
  } else if (L3.replay) {
    // The replay: the recorded steps again, at half speed, from the broadcast camera.
    const R = L3.replay, log = L3.rec.log;
    sim = R.lp;
    R.acc += dt * 0.5;
    while (R.acc >= DT && R.i < log.length) { stepLive(R.lp, log[R.i++]); R.acc -= DT; }
    if (R.i >= log.length) {
      R.end = (R.end ?? 0) + dt;
      // The tests check the replay ends exactly where the play did.
      if (R.end > 1.6) { L3.lastReplay = { end: endKey(R.lp), want: L3.rec.end }; stopReplay(); sim = null; }
    }
    L3.acc = R.acc;
  } else if (L3.preview?.lp) {
    if (L3.resultUntil) { L3.resultUntil = 0; render(); }
    // Between plays: the teams get up and walk to the new spot.
    const pv = L3.preview.lp;
    sim = pv;
    L3.acc += dt;
    while (L3.acc >= DT) { stepLive(pv, null); L3.acc -= DT; }
    if (L3.resetUntil && (pv.set || now > L3.resetUntil)) { L3.resetUntil = 0; render(); }
    // Models that finished loading report their real size: line the preview up again by it
    // (they walk the last steps over), so the spacing is by what is actually drawn.
    if (L3.preview.mv !== measureVersion && L3.flow === 'PLAY_SELECTION' && now - (L3.preview.rebuilt ?? 0) > 1500) {
      const spots = worldSpots(pv), mv = measureVersion;
      L3.preview = null; L3.spots = spots;
      showPreview();
      if (L3.preview) { L3.preview.mv = mv; L3.preview.rebuilt = now; }
    }
    if (g && !g.final && needsUser(g) && !S.busy && !S.helpOpen && L3.flow === 'PLAY_SELECTION') L3.pclock = Math.max(0, L3.pclock - dt);
  }
  if (g && !g.final) setFlow(flowNow(now));
  // The game clock runs during the play and stops on the whistle.
  const gc = document.getElementById('gclock');
  if (gc && g && !g.final) {
    const live = L3.lp && L3.lp.phase === 'live' ? L3.lp.t : 0;
    const txt = clockText(Math.max(0, Math.round(g.clock - live)));
    if (gc.textContent !== txt) gc.textContent = txt;
  }
  const tk = document.getElementById('ticker');
  if (tk && now > L3.tickerUntil && !tk.classList.contains('gone')) tk.classList.add('gone');
  const pc = document.getElementById('pclock');
  if (pc) {
    const txt = `:${String(Math.min(40, Math.ceil(L3.pclock))).padStart(2, "0")}`;
    if (pc.textContent !== txt) { pc.textContent = txt; pc.classList.toggle('low', L3.pclock <= 5); }
  }
  const tip = document.getElementById('hud-tip');
  const t = hudTip(L3.lp);
  if (tip && tip.textContent !== t) tip.textContent = t;
  const call = document.getElementById('hud-call');
  const ct = L3.lp && L3.lp.phase === 'live' ? `${OFF_PLAYS[L3.off].name} vs ${DEF_PLAYS[L3.def].name}` : '';
  if (call && call.textContent !== ct) call.textContent = ct;
  if (L3.flashT && now > L3.flashT) { L3.flashT = 0; const f = document.getElementById('hud-flash'); if (f) f.className = 'hud-flash'; }
  syncOverlays();
  stage.frame(now, sim && sim.phase !== undefined && !hold ? Math.min(1, L3.acc / DT) : 1);
  if (S.debug) debugHud();
}

// ---------- pause, replay and the controls card ----------
function endKey(lp) { return `${lp.end?.how ?? lp.phase}@${(lp.spotX ?? lp.ball.x).toFixed(2)},${lp.ball.y.toFixed(2)}`; }
function isPaused() { return !!L3.lp && L3.lp.phase !== 'dead' && (L3.paused || S.helpOpen || (S.menuOpen && L3.lp.phase === 'live')); }
function togglePause() {
  if (!L3.lp || L3.lp.phase === 'dead') return;
  L3.paused = !L3.paused;
  L3.keys.clear(); L3.edges.clear();
}
function replayReady() { return !!(stage && L3.rec?.done && !L3.lp && !L3.replay && L3.rec.log.some((e) => e?.snap)); }
function startReplay() {
  if (!replayReady()) return;
  const r = L3.rec;
  let i = 0;
  while (i < r.log.length && !r.log[i]?.snap) i++;
  const m = r.log[i++];
  let lp;
  if (r.atSnap) lp = structuredClone(r.atSnap);
  else {
    // Walk to the line instantly; the replay starts at the snap.
    lp = createLivePlay(structuredClone(r.g), r.off, r.def, r.opts);
    for (let k = 0; k < i - 1; k++) stepLive(lp, null);
  }
  lp.preview = true;
  lp.control = m?.control ? lp[m.control[0]]?.[m.control[1]] ?? null : null;
  snap(lp);
  L3.replay = { lp, i, acc: 0 };
  S.menuOpen = false;
  document.body.classList.add('pb-replay');
  stage.setPlay(lp);
  stage.setCameraMode('broadcast');
  stage.snapCamera();
  render();
  syncOverlays();
}
function stopReplay() {
  if (!L3.replay) return;
  L3.replay = null;
  document.body.classList.remove('pb-replay');
  stage.setCameraMode(S.cam);
  if (L3.preview?.lp) stage.setPlay(L3.preview.lp); else showPreview();
  stage.snapCamera();
  render();
}
function closeHelp() { S.helpOpen = false; S.seenHelp = true; savePrefs(); syncOverlays(); }
function syncOverlays() {
  const set = (id, show) => { const el = document.getElementById(id); if (el && el.hidden === show) el.hidden = !show; };
  set('pause-ov', !!L3.lp && L3.paused && L3.lp.phase !== 'dead');
  set('replay-badge', !!L3.replay);
  set('replay-btn', replayReady() && L3.flow === 'PLAY_SELECTION');
  set('help-ov', !!S.helpOpen);
}

// Developer-only diagnostics, drawn over the field while the debug view is on: the flow
// state, the play clock of the simulation, the ball, the camera, every player's action,
// contact state, assignment and speed, and the play's event timeline.
function debugHud() {
  const el = document.getElementById('dbg-hud');
  if (!el) return;
  L3.dbgN = (L3.dbgN ?? 0) + 1;
  if (L3.dbgN % 6) return;
  const lp = L3.lp ?? L3.preview?.lp;
  const f = (v, n = 1) => (v == null ? '–' : Number(v).toFixed(n));
  const rows = [];
  rows.push(`<b>${L3.flow ?? ''}</b> · sim ${lp ? `${lp.phase} t=${f(lp.t, 2)}` : '—'} · camera ${stage.rig.shot ?? stage.rig.mode} pos ${f(stage.rig.pos.x)},${f(stage.rig.pos.y)},${f(stage.rig.pos.z)} → ${f(stage.rig.look.x)},${f(stage.rig.look.z)}`);
  if (lp) {
    const b = lp.ball;
    rows.push(`ball ${b.state}${b.holder ? ` (${b.holder.slot})` : ''} at ${f(b.x)}, ${f(b.y)}, h ${f(b.z, 2)}${lp.thrown ? ` · thrown to ${lp.thrown.target?.slot ?? 'away'} T=${f(lp.thrown.T, 2)}s` : ''}${lp.tackle ? ` · tackle ${lp.tackle.q.slot}→${lp.tackle.c.slot} fp ${f(lp.tackle.fp)}` : ''}`);
    const tgt = (p) => p.eng ? `eng ${p.eng.slot}` : p.aim ? `→${p.aim.slot ?? ''}` : p.man ? `man ${p.man.slot}` : p.zone ? `zone ${f(p.zone.x, 0)},${f(p.zone.y, 0)}` : p.route ? `route ${p.routeName ?? ''} ${p.wp}/${p.route.length}` : '';
    const tbl = lp.players.map((p) => `<tr class="${p.side}"><td>${p.slot}</td><td>${p.act}</td><td>${p.contact ?? ''}</td><td>${p.role}</td><td>${f(Math.hypot(p.vx, p.vy))}</td><td>${tgt(p)}</td></tr>`).join('');
    rows.push(`<table>${tbl}</table>`);
    const ev = lp.events.slice(-10).map((e) => `<li>${f(e.t, 2)} ${e.kind} ${e.who?.slot ?? ''}${e.other ? `→${e.other.slot}` : ''} ${e.text ? `<span>${esc(e.text)}</span>` : ''}</li>`).join('');
    rows.push(`<ol>${ev}</ol>`);
  }
  el.innerHTML = rows.map((r) => (r.startsWith('<') ? r : `<p>${r}</p>`)).join('');
}

// Back to the call sheet from a lined-up play; the players stay where they are.
function recall() {
  if (L3.lp?.phase !== 'pre') return;
  L3.spots = worldSpots(L3.lp); L3.preview = null; L3.lp = null;
  render();
}

function cycleCamera() {
  const i = CAMERA_MODES.findIndex(([k]) => k === S.cam);
  setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length][0]);
  flash(CAMERA_MODES.find(([k]) => k === S.cam)[1], 'muted');
}
function setDebug(on) {
  S.debug = on;
  if (stage) stage.debug = on;
  if (!on) { const el = document.getElementById('dbg-hud'); if (el) el.innerHTML = ''; }
  render();
}
function setCamera(k) { S.cam = k; stage?.setCameraMode(k); savePrefs(); if (S.menuOpen) render(); }

function onKey(e, down) {
  // A release always counts, whatever is on screen: a key let go between plays (the dive held
  // through the whistle) would otherwise stay "held" and its next press would never register.
  if (!down) L3.keys.delete(e.code);
  if (S.screen !== 'game' || !stage || !S.game) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const code = e.code;
  if (down && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (S.helpOpen) {
      if (code === 'Escape' || code === 'Enter' || code === 'Space' || code === 'Slash') { e.preventDefault(); closeHelp(); }
      return;
    }
    if (code === 'Slash') { e.preventDefault(); S.helpOpen = true; syncOverlays(); return; }
    if (L3.replay && (code === 'Escape' || code === 'KeyY' || code === 'Space')) { e.preventDefault(); stopReplay(); return; }
    if (code === 'KeyY') { e.preventDefault(); startReplay(); return; }
    if (code === 'KeyP') { e.preventDefault(); togglePause(); return; }
    if (code === 'KeyC') { e.preventDefault(); cycleCamera(); return; }
    if (code === 'KeyM') { e.preventDefault(); S.menuOpen = !S.menuOpen; render(); return; }
    if (code === 'Backquote') { e.preventDefault(); setDebug(!S.debug); return; }
    if (code === 'KeyH' && !L3.lp) { e.preventDefault(); S.csFold = !S.csFold; render(); return; }
    if (code === 'KeyX' && !L3.lp) { e.preventDefault(); S.csAll = !S.csAll; S.csFold = false; render(); return; }
    if (code === 'Escape') {
      if (S.menuOpen) { S.menuOpen = false; render(); return; }
      if (L3.paused || L3.lp?.phase === 'live') { e.preventDefault(); togglePause(); return; }
      if (L3.lp?.phase === 'pre' && !S.coachDown) { recall(); return; }
    }
  }
  // Call keys on the play sheet, only while no play is lined up or live.
  if (!L3.lp && down && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const g = S.game;
    if (!g.final && needsUser(g) && !S.busy) {
      const { tabs, cur } = csTabs(g);
      const hit = (tabs.find(([k]) => k === cur)?.[2] ?? []).find((c) => c.code === code)
        ?? tabs.flatMap(([, , cs]) => cs).find((c) => KICK_KEYS[c.call] && c.code === code);
      if (hit) { e.preventDefault(); doCall(hit.call); return; }
      if (code === 'ArrowLeft' || code === 'ArrowRight') { e.preventDefault(); csMove(code === 'ArrowLeft' ? -1 : 1); return; }
      if (code === 'KeyZ') { e.preventDefault(); cycleForm(g.poss === userSide()); return; }
    }
  }
  const game = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyR', 'KeyQ', 'KeyT', 'Tab',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(code);
  if (!game) return;
  if (isPaused()) { e.preventDefault(); return; }
  if (!L3.lp) { if (code === 'Space' && down && e.target === document.body) e.preventDefault(); return; }
  e.preventDefault();
  if (down) { if (!L3.keys.has(code) || !e.repeat) L3.edges.add(code); L3.keys.add(code); }
  // Shift held as a number goes down: a lob (remembered, in case Shift is let go first).
  if (down && code.startsWith('Digit') && e.shiftKey) L3.lob = code;
}

function bindTouch(root) {
  const stick = root.querySelector('#stick');
  let origin = null;
  stick.addEventListener('pointerdown', (e) => { origin = { x: e.clientX, y: e.clientY, id: e.pointerId }; stick.setPointerCapture(e.pointerId); });
  stick.addEventListener('pointermove', (e) => {
    if (!origin || e.pointerId !== origin.id) return;
    const dx = (e.clientX - origin.x) / 40, dy = (e.clientY - origin.y) / 40;
    L3.stick = { up: Math.max(-1, Math.min(1, -dy)), right: Math.max(-1, Math.min(1, dx)) };
    stick.firstElementChild.style.transform = `translate(${Math.max(-1, Math.min(1, dx)) * 22}px, ${Math.max(-1, Math.min(1, dy)) * 22}px)`;
  });
  const end = () => { origin = null; L3.stick = null; stick.firstElementChild.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); L3.edges.add(b.dataset.key); }));
}

function startGame(game, meta) {
  S.game = game; S.gameMeta = meta; S.gameTab = 'log'; S.busy = false; S.subSel = null;
  L3.lp = null; L3.preview = null; L3.spots = null; L3.pclock = 40; L3.rec = null; L3.paused = false;
  if (L3.replay) stopReplay();
  // The first game shows the controls once.
  if (!S.seenHelp) S.helpOpen = true;
  setScreen('game');
  autoAdvance();
}

function finishLeagueGame() {
  const L = S.league, g = S.game, meta = S.gameMeta;
  if (!g?.final || !meta) return;
  if (meta.playoff) {
    LG.recordResult(L, g, { playoff: true, round: L.playoffs.round });
    simPlayoffOthers(L, meta.userTeamId);
    LG.advancePlayoffs(L);
  } else {
    LG.recordResult(L, g, { week: L.week });
    LG.simWeekOthers(L, meta.userTeamId);
    LG.advanceWeek(L);
  }
  S.game = null; S.gameMeta = null;
  setScreen('season');
}
function simPlayoffOthers(L, skip) {
  for (const gm of L.playoffs.games) {
    if (gm.home === skip || gm.away === skip) continue;
    const g = LG.startLeagueGame(L, gm.home, gm.away, true);
    simUntil(g, 'game');
    LG.recordResult(L, g, { playoff: true, round: L.playoffs.round });
  }
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

function userDraft(id, slot) {
  const L = S.league;
  if (id == null || L.phase !== 'draft') return;
  const pk = LG.currentPick(L);
  const me = user();
  if (pk.team !== me.id || LG.blockReason(L, me, id) || !LG.available(L).includes(id)) return;
  clearTimers();
  LG.makePick(L, id, slot && slot !== 'BENCH' && me.slots[slot] == null ? slot : null);
  afterPick();
}

function depthClick(el) {
  const me = user();
  if (el.dataset.act === 'dslot') {
    const k = el.dataset.slot;
    if (!S.depthSel) { S.depthSel = k; render(); return; }
    if (S.depthSel !== k) { [me.lineup[S.depthSel], me.lineup[k]] = [me.lineup[k], me.lineup[S.depthSel]]; }
    S.depthSel = null;
  } else {
    if (!S.depthSel) return;
    const id = Number(el.dataset.id);
    const out = me.lineup[S.depthSel];
    me.lineup[S.depthSel] = id;
    me.bench = me.bench.map((x) => (x === id ? out : x));
    S.depthSel = null;
  }
  save(); render();
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
function render() {
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
