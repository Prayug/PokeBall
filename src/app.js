// PokeBall UI: home, draft room, grades, depth chart, season hub and game screen.
import { PLAYERS, SLOTS, SLOT, SLOT_KEYS, OFF_SLOTS, DEF_SLOTS, ATTRS, BASELINE, autoDepthChart, unitRatings } from './ratings.js';
import { SPRITES } from './sprites.js';
import { TYPE_COLORS, TYPE_TRAITS, ABILITIES, WEATHER } from './types.js';
import { OFF_PLAYS, DEF_PLAYS, runPlay, runLivePlay, aiOffenseCall, aiDefenseCall, simUntil, spotText, downText, clockText,
  quarterText, fgDistance, fgChance, absSpot, createGame } from './engine.js';
import { createLivePlay, snap, step as stepLive, playSeconds, DT } from './live.js';
import { Stage, webglAvailable } from './field3d.js';
import * as LG from './league.js';

const SAVE_KEY = 'pokeball.save.v1';
const PREF_KEY = 'pokeball.prefs.v1';
const app = document.getElementById('app');
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const S = {
  screen: 'home', league: null, game: null, gameMeta: null,
  draft: { search: '', type: '', rate: 'fit', sort: 'fit', sel: null, clock: 60, autoAll: false, needs: false },
  depthSel: null, coach: false, gameTab: 'log', busy: false, setup: { name: 'Pallet Starters', abbr: 'PAL', rounds: 22, legendaries: false, typeCap: true, clock: true },
  banner: null,
};
let timers = { draft: null, clock: null, auto: null };

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ league: S.league, game: S.game, gameMeta: S.gameMeta, screen: S.screen }));
    localStorage.setItem(PREF_KEY, JSON.stringify({ coach: S.coach, setup: S.setup }));
  } catch { /* storage unavailable: play continues unsaved */ }
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
}
function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); if (p) { S.coach = !!p.coach; Object.assign(S.setup, p.setup ?? {}); } } catch { /* ignore */ }
}

// ---------- small view helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = (id) => PLAYERS[id];
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
    if (L.phase !== 'draft') items.push(['grades', 'Draft grades'], ['depth', 'Depth chart'], ['season', 'Season']);
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
          <label class="pill"><input type="radio" name="rounds" value="22" ${st.rounds === 22 ? 'checked' : ''}> 22 rounds, starters only</label>
          <label class="pill"><input type="radio" name="rounds" value="26" ${st.rounds === 26 ? 'checked' : ''}> 26 rounds, with 4 bench</label>
        </fieldset>
        <label class="check"><input type="checkbox" id="f-typecap" ${st.typeCap ? 'checked' : ''}> At most 4 Pokémon of one primary type</label>
        <label class="check"><input type="checkbox" id="f-legend" ${st.legendaries ? 'checked' : ''}> Include legendaries, Ultra Beasts and Paradox Pokémon (one per team)</label>
        <label class="check"><input type="checkbox" id="f-clock" ${st.clock ? 'checked' : ''}> 60-second pick clock</label>
        <button class="btn primary" type="submit">Start the draft</button>
      </form>
      <div class="card side">
        ${saved?.league ? `<h2>Continue</h2><p>${esc(saved.league.teams[0].name)} · ${phaseLabel(saved.league)}</p>
          <button class="btn" data-act="continue">Continue league</button><hr>` : ''}
        <h2>Quick game</h2>
        <p>Two AI-drafted rosters, kickoff right away. You coach the home side.</p>
        <button class="btn" data-act="quick">Play a quick game</button>
      </div>
    </div>
  </section>`;
}
function phaseLabel(L) {
  if (L.phase === 'draft') return `Draft, pick ${L.pickIndex + 1} of ${L.picks.length}`;
  if (L.phase === 'grades') return 'Draft complete';
  if (L.phase === 'season') return `Week ${L.week + 1} of ${L.schedule.length}`;
  if (L.phase === 'playoffs') return 'Playoffs';
  return 'Season over';
}

// ---------- draft ----------
function boardIds() {
  const L = S.league, me = user(), d = S.draft;
  const q = d.search.trim().toLowerCase();
  let ids = LG.available(L).filter((id) => (!q || P(id).name.toLowerCase().includes(q)) && (!d.type || P(id).types.includes(d.type)) && (!d.gen || P(id).gen === Number(d.gen)));
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
  if (!rows.length) return `<tr><td colspan="13" class="empty">No Pokémon match. Clear the search, type or generation filter.</td></tr>`;
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
        <p class="eyebrow">Round ${pk?.round ?? '-'} of ${L.settings.rounds} · Pick ${L.pickIndex + 1} of ${L.picks.length}</p>
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
            ${head('spd', 'SPD')}${head('str', 'STR')}${head('blk', 'BLK')}${head('rush', 'RSH')}${head('arm', 'ARM')}${head('acc', 'ACC')}${head('hnd', 'HND')}${head('cov', 'COV')}${head('tkl', 'TKL')}${head('sta', 'STA')}<th></th></tr></thead>
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
  return `<div class="slots"><ul>${col(OFF_SLOTS)}</ul><ul>${col(DEF_SLOTS)}</ul></div>
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
    <div class="actions">
      <button class="btn" data-act="go" data-to="depth">Edit depth chart</button>
      ${L.phase === 'grades' ? '<button class="btn primary" data-act="startseason">Start the season</button>' : '<button class="btn primary" data-act="go" data-to="season">Go to season</button>'}
    </div>
  </section>`;
}

// ---------- depth chart ----------
const OFF_ROWS = [['WR1', 'WR3', 'LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR2'], ['QB'], ['RB']];
const DEF_ROWS = [['FS'], ['CB1', 'CB3', 'SS', 'CB2'], ['OLB', 'MLB'], ['DE', 'DT2', 'DT1', 'LE']];
function renderDepth() {
  const me = user();
  const u = unitRatings(me.lineup);
  const cell = (k) => {
    const id = me.lineup[k];
    const p = P(id);
    const misfit = p.best[0] !== k && p.ovr[p.best[0]] - p.ovr[k] >= 6;
    return `<button class="dslot ${S.depthSel === k ? 'sel' : ''}" data-act="dslot" data-slot="${k}">
      <span class="slot">${k}</span>${sprite(id, 'md')}<span class="dn">${esc(p.name)}</span>${ovr(p.ovr[k])}
      ${misfit ? `<span class="fitnote">Best at ${p.best[0]} ${p.ovr[p.best[0]]}</span>` : ''}</button>`;
  };
  const rows = (R) => R.map((r) => `<div class="frow">${r.map(cell).join('')}</div>`).join('');
  return `<section class="depth">
    <p class="eyebrow">${esc(me.name)}</p>
    <h1>Depth chart</h1>
    <p class="lede">Tap a slot, then tap another slot or a bench Pokémon to swap them. Overalls update for the new position.</p>
    <div class="unitbar">${[['Pass offense', u.passOff], ['Run offense', u.runOff], ['Pass rush', u.passRush], ['Coverage', u.coverage], ['Run defense', u.runDef]]
      .map(([l, v]) => `<div><span class="muted small">${l}</span><b>${Math.round(v)}</b></div>`).join('')}</div>
    <div class="formations">
      <div class="card form off"><h3>Offense</h3>${rows(OFF_ROWS)}<div class="los" aria-hidden="true"></div></div>
      <div class="card form def"><h3>Defense</h3>${rows(DEF_ROWS)}</div>
    </div>
    <div class="card"><h3>Bench</h3><div class="benchrow">${me.bench.length ? me.bench.map((id) => `<button class="dslot bench" data-act="dbench" data-id="${id}">${sprite(id, 'md')}<span class="dn">${esc(P(id).name)}</span>
      ${S.depthSel ? ovr(P(id).ovr[S.depthSel]) : `<span class="slot">${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</span>`}</button>`).join('') : '<p class="muted">No bench. Draft 26 rounds to carry 4 backups.</p>'}</div></div>
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
      <p class="eyebrow">Week ${L.week + 1} of ${L.schedule.length}</p>
      <div class="vs">${teamBlock(L.teams[gm.away])}<span class="at">at</span>${teamBlock(L.teams[gm.home])}</div>
      <p class="muted">${esc(opp.name)} coach: ${esc(opp.coachName)}</p>
      <div class="actions"><button class="btn primary" data-act="playweek">Play the game</button><button class="btn" data-act="simweek">Simulate it</button></div>
    </div>`;
  } else if (L.phase === 'playoffs') {
    const P_ = L.playoffs;
    const mine = P_.games.find((g) => g.home === me.id || g.away === me.id);
    main = `<div class="card matchup"><p class="eyebrow">${P_.round === 0 ? 'Semifinals' : 'Championship'}</p>
      ${P_.games.map((g) => `<div class="vs small">${teamBlock(L.teams[g.away])}<span class="at">at</span>${teamBlock(L.teams[g.home])}</div>`).join('')}
      <div class="actions">${mine ? '<button class="btn primary" data-act="playweek">Play your playoff game</button><button class="btn" data-act="simweek">Simulate it</button>'
        : '<p class="muted">You missed this round. Watch it play out.</p><button class="btn primary" data-act="simweek">Simulate the round</button>'}</div></div>`;
  } else if (L.phase === 'done') {
    const champ = L.teams[L.champion];
    main = `<div class="card matchup champ"><p class="eyebrow">Season complete</p><h2>${esc(champ.name)} are champions</h2>
      <div class="champrow">${Object.values(champ.lineup).slice(0, 6).map((id) => sprite(id, 'md')).join('')}</div>
      <div class="actions"><button class="btn primary" data-act="newleague">Start a new league</button></div></div>`;
  }
  const recent = L.results.slice(-4).reverse();
  return `<section class="season">
    <h1>${esc(me.name)} · ${record(st.find((r) => r.id === me.id))}</h1>
    <div class="season-grid">
      <div class="col">${main}
        <div class="card"><h3>Recent results</h3>${recent.length ? `<ul class="results">${recent.map(resultLine).join('')}</ul>` : '<p class="muted">No games played yet.</p>'}</div>
      </div>
      <div class="col">
        <div class="card"><h3>Standings</h3><div class="tablewrap"><table class="stand"><thead><tr><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th></tr></thead>
          <tbody>${st.map((r, i) => { const t = L.teams[r.id]; return `<tr class="${t.user ? 'me' : ''} ${i === 3 ? 'cut' : ''}"><td>${teamBadge(t)} ${esc(t.name)}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${r.pf}</td><td class="num">${r.pa}</td><td class="num">${r.pf - r.pa > 0 ? '+' : ''}${r.pf - r.pa}</td></tr>`; }).join('')}</tbody></table></div>
          <p class="small muted">Top 4 make the playoffs.</p></div>
        <div class="card"><h3>League leaders</h3><div class="leaders">${Object.entries(lead).map(([k, rows]) => `<div><h4>${k}</h4><ol>${rows.slice(0, 3).map((r) => `<li>${sprite(r.id, 'xs')}<span>${esc(P(r.id).name)}</span><em>${L.teams[r.team].abbr}</em><b>${statFor(k, r)}</b></li>`).join('') || '<li class="muted">None yet</li>'}</ol></div>`).join('')}</div></div>
      </div>
    </div>
  </section>`;
}
function statFor(k, r) { return { 'Passing yards': r.py, 'Rushing yards': r.ry, 'Receiving yards': r.rcy, Sacks: r.dsk, Interceptions: r.dint, Tackles: r.tk }[k]; }
function record(r) { return r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '0-0'; }
function teamBlock(t) { return `<div class="tblock" style="--team:${t.color}"><span class="tabbr">${esc(t.abbr)}</span><span>${esc(t.name)}</span></div>`; }
function resultLine(r) {
  const L = S.league, h = L.teams[r.home], a = L.teams[r.away];
  return `<li>${r.playoff ? '<em class="po">Playoffs</em>' : `<em>Wk ${r.week + 1}</em>`}${teamBadge(a)} <b class="${r.winner === a.id ? 'won' : ''}">${r.score[1]}</b> at ${teamBadge(h)} <b class="${r.winner === h.id ? 'won' : ''}">${r.score[0]}</b></li>`;
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

function playCards(g) {
  const us = userSide();
  const onOff = g.poss === us;
  if (onOff) {
    const fg = fgDistance(g);
    const keys = Object.keys(OFF_PLAYS).filter((k) => (k !== 'punt' && k !== 'fg') || g.down === 4 || (k === 'fg' && fg <= 60));
    return `<div class="callhead"><h3>Call your offense</h3><span class="muted">${downText(g)} at ${spotText(g)}</span></div>
      <div class="plays">${keys.map((k) => {
        const p = OFF_PLAYS[k];
        const extra = k === 'fg' ? `${fg} yards · ${Math.round(fgChance(fg) * 100)}%` : p.blurb;
        return `<button class="play ${p.kind}" data-act="call" data-call="${k}"><b>${p.name}</b><span>${extra}</span></button>`;
      }).join('')}</div>`;
  }
  return `<div class="callhead"><h3>Call your defense</h3><span class="muted">${esc(g.teams[g.poss].abbr)} ball, ${downText(g)} at ${spotText(g)}</span></div>
    <div class="plays">${Object.entries(DEF_PLAYS).map(([k, p]) => `<button class="play def" data-act="call" data-call="${k}"><b>${p.name}</b><span>${p.blurb}</span></button>`).join('')}</div>`;
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
  const decide = !g.final && needsUser(g) && !S.busy && !L3.lp;
  let controls;
  if (g.final) {
    controls = `<div class="card final"><h2>${g.winner == null ? 'Tie game' : g.teams[g.winner].id === (S.gameMeta?.userTeamId ?? 0) ? 'You win' : 'You lose'}, ${Math.max(...g.score)} to ${Math.min(...g.score)}</h2>
      <div class="actions">${S.gameMeta?.quick ? '<button class="btn primary" data-act="quick">Play another quick game</button><button class="btn" data-act="home">Home</button>'
        : '<button class="btn primary" data-act="finishgame">Back to the season</button>'}</div></div>`;
  } else {
    let head;
    if (L3.lp) {
      const lp = L3.lp;
      const mine = lp.user === lp.o ? OFF_PLAYS[L3.off].name : DEF_PLAYS[L3.def].name;
      head = `<div class="callhead"><h3>${lp.phase === 'pre' ? `Lined up: ${esc(mine)}` : 'Play in progress'}</h3><span class="muted">${downText(g)} at ${spotText(g)}</span></div>
        ${lp.phase === 'pre' ? `<div class="actions"><button class="btn primary" data-act="snap">${lp.user === lp.o ? 'Snap the ball' : 'Start the play'} <kbd>Space</kbd></button>
        ${S.coachDown ? '' : '<button class="btn" data-act="recall">Change play</button>'}</div>` : ''}`;
    } else if (decide) head = playCards(g);
    else head = `<div class="callhead"><h3>${S.busy ? 'Play in progress' : 'AI calling this down'}</h3><span class="muted">Coach mode hands you 3rd and 4th downs and the last two minutes</span></div>`;
    controls = `<div class="card callcard">${head}
      <div class="simrow">
        <label class="check"><input type="checkbox" id="g-coach" ${S.coach ? 'checked' : ''}> Coach mode</label>
        <button class="btn" data-act="sim" data-stop="drive" ${L3.lp && L3.lp.phase !== 'pre' ? 'disabled' : ''}>Sim drive</button>
        <button class="btn" data-act="sim" data-stop="quarter" ${L3.lp && L3.lp.phase !== 'pre' ? 'disabled' : ''}>Sim quarter</button>
        <button class="btn" data-act="sim" data-stop="game" ${L3.lp && L3.lp.phase !== 'pre' ? 'disabled' : ''}>Sim to the end</button>
      </div></div>`;
  }
  const field = live3d ? `<div class="stage-slot" id="stage-slot"></div>${keysHelp()}` : `<div class="fieldwrap">${renderField(g)}</div>`;
  return `<section class="game ${live3d ? 'g3d' : ''}">
    ${scoreboard(g)}
    ${field}
    ${lastPlayHtml(g)}
    ${controls}
    <div class="tabs" role="tablist">${[['log', 'Play-by-play'], ['box', 'Box score'], ['drives', 'Drives']].map(([k, l]) => `<button role="tab" aria-selected="${S.gameTab === k}" class="tab ${S.gameTab === k ? 'on' : ''}" data-act="gtab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="card tabbody">${S.gameTab === 'log' ? logHtml(g) : S.gameTab === 'box' ? boxHtml(g) : drivesHtml(g)}</div>
    <p class="small muted">You coach ${esc(g.teams[us].name)}. ${WEATHER[g.weather].name}: ${WEATHER[g.weather].text}.</p>
  </section>`;
}

function keysHelp() {
  return `<details class="keys"><summary>Controls</summary><div class="keygrid">
    <span><kbd>Space</kbd> snap, juke with the ball, dive to tackle</span>
    <span><kbd>W A S D</kbd> or arrows: move your player</span>
    <span><kbd>Shift</kbd> sprint</span>
    <span><kbd>1</kbd>-<kbd>5</kbd> throw to that receiver</span>
    <span><kbd>T</kbd> throw it away</span>
    <span><kbd>E</kbd> truck through a tackler</span>
    <span><kbd>R</kbd> spin move</span>
    <span><kbd>Q</kbd> on defense: switch to the player nearest the ball</span>
    <span>Leave the keys alone and your player runs on autopilot.</span>
  </div></details>`;
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
  const us = userSide();
  const off = g.poss === us ? call : aiOffenseCall(g);
  const def = g.poss === us ? aiDefenseCall(g) : call;
  S.coachDown = false;
  if (stage && ['run', 'pass'].includes(OFF_PLAYS[off].kind)) { startLive(off, def, { userSide: us, autoSnap: g.poss === us ? null : 1.6 }); return; }
  S.busy = true;
  const entry = runPlay(g, off, def);
  if (stage) { S.busy = false; afterLivePlay(entry); return; }
  animatePlay(entry, () => { S.busy = false; save(); render(); autoAdvance(); });
}

// Coach mode: the AI calls downs until a decision is yours. On the 3D field you still
// play them; leave the keys alone and the AI plays your Pokémon too.
function autoAdvance() {
  clearTimeout(timers.auto);
  const g = S.game;
  if (!g || g.final || S.screen !== 'game' || !S.coach || needsUser(g) || L3.lp) return;
  timers.auto = setTimeout(() => {
    if (!S.game || S.game.final || S.screen !== 'game' || L3.lp) return;
    const off = aiOffenseCall(g), def = aiDefenseCall(g);
    if (stage && ['run', 'pass'].includes(OFF_PLAYS[off].kind)) {
      S.coachDown = true;
      startLive(off, def, { userSide: userSide(), autoQB: true, autoSnap: 1.4 });
      return;
    }
    S.busy = true;
    render();
    const entry = runPlay(g, off, def);
    if (stage) { S.busy = false; afterLivePlay(entry); return; }
    animatePlay(entry, () => { S.busy = false; save(); render(); autoAdvance(); });
  }, stage ? 900 : 650);
}

// ---------- the live 3D game ----------
const L3 = { lp: null, off: null, def: null, acc: 0, last: 0, deadT: 0, autoSnap: null, keys: new Set(), edges: new Set(), ev: 0, raf: 0, flashT: 0, preview: null };
let stage = null;
let stageWrap = null;

function ensureStage() {
  if (stage || !webglAvailable()) return;
  try {
    stage = new Stage();
  } catch { stage = null; return; }
  stageWrap = document.createElement('div');
  stageWrap.className = 'stagewrap';
  stageWrap.innerHTML = `<div class="hud"><div class="hud-call" id="hud-call"></div><div class="hud-flash" id="hud-flash"></div><div class="hud-tip" id="hud-tip"></div></div>
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
  slot.appendChild(stageWrap);
  stage.resize();
  if (!L3.lp) showPreview();
}

// Between plays, line both teams up at the new spot.
function showPreview() {
  const g = S.game;
  if (!g || !stage) return;
  const us = userSide();
  const key = `${g.playNo}:${g.poss}:${g.spot}:${g.final}`;
  if (L3.preview?.key === key && L3.preview.g === g) { stage.setPlay(L3.preview.lp); return; }
  const saved = g.rng;
  const lp = createLivePlay(g, g.poss === us ? 'slant' : 'inside_run', 'base', { userSide: us });
  g.rng = saved;
  lp.control = null; lp.preview = true;
  L3.preview = { key, lp, g };
  stage.setPlay(lp);
  stage.snapCamera();
}

function startLive(off, def, opts) {
  const g = S.game;
  L3.lp = createLivePlay(g, off, def, opts);
  L3.off = off; L3.def = def; L3.acc = 0; L3.deadT = 0; L3.ev = 0;
  L3.autoSnap = opts.autoSnap ?? null;
  L3.edges.clear();
  stage.setPlay(L3.lp);
  render();
  const top = stageWrap?.getBoundingClientRect().top;
  if (top != null && (top < 60 || top > window.innerHeight * 0.4)) window.scrollTo({ top: Math.max(0, window.scrollY + top - 70), behavior: reduceMotion ? 'auto' : 'smooth' });
}

function doSnap() {
  const lp = L3.lp;
  if (!lp || lp.phase !== 'pre') return;
  snap(lp);
  L3.autoSnap = null;
  render();
}

function finishLive() {
  const lp = L3.lp, g = S.game;
  L3.lp = null;
  const entry = runLivePlay(g, L3.off, L3.def, lp.result, playSeconds(lp));
  S.coachDown = false;
  afterLivePlay(entry);
}

function afterLivePlay(entry) {
  save();
  render();
  if (entry) flash(entry.highlight === 'td' || entry.kind === 'score' ? 'TOUCHDOWN' : '', entry.highlight === 'td' ? 'td' : '');
  autoAdvance();
}

function flash(text, tone = '') {
  const el = document.getElementById('hud-flash');
  if (!el || !text) return;
  el.textContent = text;
  el.className = `hud-flash on ${tone}`;
  L3.flashT = performance.now() + 1400;
}

const FLASH = { int: ['INTERCEPTED!', 'to'], sack: ['SACK!', 'to'], broken: ['Broken tackle!', ''], juke: ['Juke!', ''], ghost: ['Phased through!', 'big'],
  catch: ['Caught!', ''], incomplete: ['Incomplete', 'muted'], scramble: ['Scramble!', ''], truck: ['Truck stick!', ''], spin: ['Spin move!', ''] };

function readInput(lp) {
  const k = L3.keys, e = L3.edges;
  const up = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) + (L3.stick?.up ?? 0);
  const right = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) + (L3.stick?.right ?? 0);
  const m = stage.toPlayFrame(up, right);
  const throwKey = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].find((d) => e.has(d));
  const inp = {
    mx: m.mx, my: m.my, sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
    juke: e.has('Space'), dive: e.has('Space'), truck: e.has('KeyE'), spin: e.has('KeyR'),
    throwTo: throwKey ? ['WR1', 'WR2', 'WR3', 'TE', 'RB'][Number(throwKey.slice(5)) - 1] : null,
    throwAway: e.has('KeyT'), switchTo: e.has('KeyQ') || e.has('Tab') ? 'ball' : null,
  };
  e.clear();
  return inp;
}

function hudTip(lp) {
  if (!lp) return S.game && !S.game.final ? 'Call a play below' : '';
  const c = lp.control;
  if (lp.phase === 'pre') return lp.user === lp.o ? `Space to snap${lp.kind === 'pass' ? ' · then 1-5 to throw' : ''}` : 'Q to pick a defender · Space to start';
  if (lp.phase === 'dead') return '';
  if (!c) return 'Watching';
  if (c.side === 'off' && c.slot === 'QB' && lp.kind === 'pass' && !lp.thrown && lp.qbState !== 'run') return '1-5 throw · T throw away · Arrows move · Space spin';
  if (c.carrier) return 'Arrows run · Shift sprint · Space juke · R spin · E truck';
  if (c.side !== lp.carrierTeam || c.side === 'def') return 'Arrows move · Space dive · Q switch to the ball';
  return 'Arrows move';
}

function loop(now) {
  L3.raf = requestAnimationFrame(loop);
  if (!stage || S.screen !== 'game' || !document.getElementById('stage-slot')) { L3.last = now; return; }
  const dt = Math.min(0.1, (now - (L3.last || now)) / 1000);
  L3.last = now;
  const lp = L3.lp;
  if (lp) {
    if (lp.phase === 'pre') {
      stepLive(lp, null);
      if (L3.edges.has('Space')) { L3.edges.clear(); doSnap(); }
      else if (L3.edges.has('KeyQ') || L3.edges.has('Tab')) {
        L3.edges.clear();
        if (lp.user === lp.d) {
          const order = ['MLB', 'OLB', 'SS', 'FS', 'CB1', 'CB2', 'CB3', 'LE', 'DE', 'DT1', 'DT2'].map((k) => lp.def[k]).filter(Boolean);
          lp.control = order[(order.indexOf(lp.control) + 1) % order.length];
        }
      } else L3.edges.clear();
      if (L3.autoSnap != null) { L3.autoSnap -= dt; if (L3.autoSnap <= 0) doSnap(); }
    } else {
      L3.acc += dt;
      while (L3.acc >= DT) {
        stepLive(lp, lp.phase === 'live' ? readInput(lp) : null);
        L3.acc -= DT;
      }
      while (L3.ev < lp.events.length) {
        const e = lp.events[L3.ev++];
        const f = FLASH[e.kind];
        if (f && !(e.kind === 'catch' && lp.user == null)) flash(f[0], f[1]);
      }
      if (lp.phase === 'dead') {
        L3.deadT += dt;
        if (L3.deadT > 1.5) { finishLive(); return; }
      }
    }
  }
  const tip = document.getElementById('hud-tip');
  const t = hudTip(L3.lp);
  if (tip && tip.textContent !== t) tip.textContent = t;
  const call = document.getElementById('hud-call');
  const ct = L3.lp ? `${OFF_PLAYS[L3.off].name} vs ${DEF_PLAYS[L3.def].name}` : '';
  if (call && call.textContent !== ct) call.textContent = ct;
  if (L3.flashT && now > L3.flashT) { L3.flashT = 0; const f = document.getElementById('hud-flash'); if (f) f.className = 'hud-flash'; }
  stage.frame(now);
}

function onKey(e, down) {
  if (S.screen !== 'game' || !stage || !S.game) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const code = e.code;
  const game = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyR', 'KeyQ', 'KeyT', 'Tab',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(code);
  if (!game) return;
  if (!L3.lp) { if (code === 'Space' && down && e.target === document.body) e.preventDefault(); return; }
  e.preventDefault();
  if (down) { if (!L3.keys.has(code)) L3.edges.add(code); L3.keys.add(code); } else L3.keys.delete(code);
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
  S.game = game; S.gameMeta = meta; S.gameTab = 'log'; S.busy = false;
  L3.lp = null; L3.preview = null;
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
    case 'home': S.game = S.gameMeta?.quick ? null : S.game; setScreen('home'); break;
    case 'go': setScreen(el.dataset.to); break;
    case 'continue': {
      const saved = loadSaved();
      if (saved?.league) {
        S.league = saved.league; S.game = saved.game; S.gameMeta = saved.gameMeta;
        setScreen(S.game && !S.game.final ? 'game' : saved.league.phase === 'draft' ? 'draft' : saved.league.phase === 'grades' ? 'grades' : 'season');
        if (S.screen === 'game') autoAdvance();
      }
      break;
    }
    case 'quick': {
      const seed = Math.floor(Math.random() * 2 ** 31);
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
    case 'snap': doSnap(); break;
    case 'recall': if (L3.lp?.phase === 'pre') { L3.lp = null; render(); } break;
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
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'd-type') { S.draft.type = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id === 'd-gen') { S.draft.gen = t.value; document.getElementById('board-body').innerHTML = boardRowsHtml(); }
  if (t.id === 'd-rate') { S.draft.rate = t.value; S.draft.sort = 'fit'; render(); }
  if (t.id === 'g-coach') { S.coach = t.checked; save(); render(); autoAdvance(); }
}
function onSubmit(e) {
  if (e.target.id !== 'setup-form') return;
  e.preventDefault();
  const f = e.target;
  S.setup = {
    name: f.querySelector('#f-name').value.trim() || 'Pallet Starters',
    abbr: (f.querySelector('#f-abbr').value.trim() || 'PAL').toUpperCase().slice(0, 3),
    rounds: Number(f.querySelector('input[name="rounds"]:checked')?.value ?? 22),
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
  let body;
  switch (S.screen) {
    case 'draft': body = S.league ? renderDraft() : renderHome(); break;
    case 'grades': body = renderGrades(); break;
    case 'depth': body = renderDepth(); break;
    case 'season': body = renderSeason(); break;
    case 'game': ensureStage(); body = renderGame(); break;
    default: body = renderHome();
  }
  const y = window.scrollY;
  const boardScroll = document.querySelector('.board .tablewrap')?.scrollTop;
  const focusId = document.activeElement?.id;
  app.innerHTML = renderTop() + `<main>${body}</main>`;
  if (S.screen === 'game') mountStage();
  if (S.screen === 'draft' && boardScroll != null) { const b = document.querySelector('.board .tablewrap'); if (b) b.scrollTop = boardScroll; }
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  window.scrollTo(0, y);
}

function start(data) {
  loadPrefs();
  const snap = data?.state;
  if (snap?.league || snap?.game) {
    S.league = snap.league; S.game = snap.game; S.gameMeta = snap.gameMeta; S.screen = snap.screen ?? 'home';
  }
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
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
