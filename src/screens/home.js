// Home screen: new league setup, the save slots (continue, export, delete), quick game and save import.
import { PLAYERS } from '../ratings.js';
import * as LG from '../league.js';
import { render, setScreen } from '../app.js';
import { S, firstFreeSlot, savedSlots } from '../state.js';
import { P, esc, sprite, teamBadge } from '../ui.js';
import { autoAdvance, difficultyHtml } from './game.js';
import { SCHEMES, SCHEME_KEYS } from '../coach.js';
import { sharedInHtml } from './share.js';
import { LEAGUE_SIZES } from '../geometry.js';
import { quarterText } from '../engine.js';
import { TYPE_COLORS } from '../types.js';
import { lastSeat } from '../net.js';
import { coachTip } from '../ui.js';
import { DIFFICULTY } from '../difficulty.js';

const SWATCHES = ['#c8102e', '#e0702a', '#d9a21b', '#3e9b5a', '#2e7d6b', '#2f6fd6', '#1d3a8a', '#7d5bb5', '#b03a8c', '#2b2f36', '#8a7a5c', '#f2f0e8'];
const SIZE_BLURB = {
  8: '7 weeks. The top 4 reach the playoffs.',
  12: '3 divisions, 14 weeks. 6 teams make the playoffs.',
  16: '4 divisions, 18 weeks. 8 teams make the playoffs.',
};

function resumeScreen(L, game) {
  if (game && !game.final) return 'game';
  return { draft: 'draft', grades: 'grades', offseason: 'offseason', freeagency: 'freeagency' }[L.phase] ?? 'season';
}
export function loadSnapshot(snap) {
  S.league = LG.migrateLeague(snap.league); S.game = LG.replaceRetiredInGame(snap.game ?? null, S.league); S.gameMeta = snap.gameMeta ?? null;
  S.offCuts = null; S.subSel = null; S.resultIdx = null; S.desk = null;
  setScreen(resumeScreen(S.league, S.game));
  if (S.screen === 'game') autoAdvance();
}
export function importSave(text, slot = S.slot) {
  let data;
  try { data = JSON.parse(text); } catch { S.importMsg = 'That is not valid JSON.'; render(); return; }
  if (!Array.isArray(data?.league?.teams) || !data.league.teams.some((t) => t.user)) { S.importMsg = 'No PokeBall league found in that file.'; render(); return; }
  S.importMsg = '';
  S.slot = slot;
  loadSnapshot(data);
}

// ---------- home ----------
export function renderHome() {
  const slots = savedSlots();
  const target = firstFreeSlot() ?? S.slot;
  const showcase = [130, 248, 135, 65, 448, 445].filter((id) => PLAYERS[id]);
  const cont = continueSlot(slots);
  return `<section class="title-screen">
    ${sharedInHtml()}
    ${coachTip('home', 'Continue a franchise, start a new one, or jump straight into a game.')}
    <div class="title-hero">
      <div class="title-stage" aria-hidden="true"><span class="title-glow"></span><span class="title-yard"></span>
        <div class="showcase">${showcase.map((id) => `<figure style="--tc:${TYPE_COLORS[P(id).types[0]]}">${sprite(id, 'lg')}<figcaption>${esc(P(id).name)}<b>${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</b></figcaption></figure>`).join('')}</div>
      </div>
      <div class="title-brand"><span class="hero-ball" aria-hidden="true"></span><p class="eyebrow">Pokémon football</p><h1>PokeBall</h1></div>
    </div>
    <nav class="title-menu" aria-label="Main menu">
      ${resumeQuickHtml()}
      ${cont ? `<button class="btn primary xl" data-act="continue" data-slot="${cont.n}">Continue · ${esc(cont.name)}</button>` : ''}
      <button class="btn ${cont ? '' : 'primary'} xl" data-act="wizopen">New franchise</button>
      <button class="btn xl" data-act="quick">Quick play</button>
      <button class="btn xl" data-act="go" data-to="kit">Team studio</button>
      <button class="btn xl" data-act="sound">Settings</button>
    </nav>
    ${S.wizOpen ? wizardHtml(slots, target) : ''}
    <div class="title-lower">
      <div class="card title-saves"><h2>Franchises</h2><ul class="saveslots">${slots.map(slotRow).join('')}</ul></div>
      <details class="card title-more" ${S.importMsg || S.netMsg ? 'open' : ''}><summary>More ways to play</summary>
        <div class="actions"><button class="btn" data-act="quick2">Two players, one screen</button>
          <button class="btn" data-act="watchgame">Watch a game</button>
          <button class="btn" data-act="onlinequick">Quick match online</button>
          <button class="btn" data-act="onlineh2h" title="You and a friend draft against each other, then play">Head-to-head draft</button></div>
        <div class="actions"><input id="net-code" maxlength="8" placeholder="Room code" aria-label="Room code"><button class="btn" data-act="onlinejoin">Join</button></div>
        ${rejoinHtml()}
        ${S.netMsg ? `<p class="small bad">${esc(S.netMsg)}</p>` : ''}
        <p class="small muted">Two players share one keyboard (WASD and the arrows) or use gamepads. Watch mode lets the AI play both sides. Add <code>?watch</code> to the address and each final rolls into the next game.</p>
        <hr>
        <p class="small muted">Import an exported save, a league code, or a share link.</p>
        <label>Load into${slotSelect('i-slot', slots, target)}</label>
        <input type="file" id="import-file" accept="application/json,.json">
        <textarea id="import-text" rows="3" placeholder="Paste save JSON, a league code, or a link"></textarea>
        <button class="btn" data-act="importpaste">Load what I pasted</button>
        ${S.importMsg ? `<p class="small bad">${esc(S.importMsg)}</p>` : ''}
      </details>
    </div>
  </section>`;
}
function continueSlot(slots) {
  const hit = slots.find((s) => s.n === S.slot && s.save) ?? slots.find((s) => s.save);
  if (!hit?.save) return null;
  const me = hit.save.league.teams.find((t) => t.user) ?? hit.save.league.teams[0];
  return { n: hit.n, name: me.name };
}
function wizardHtml(slots, target) {
  const st = S.setup;
  const step = Math.max(0, Math.min(4, S.wiz ?? 0));
  const labels = ['League', 'Draft', 'Difficulty', 'Identity', 'Review'];
  const show = (n) => (step === n ? '' : 'hidden');
  const color = st.color || '#c8102e';
  return `<form class="card wizard" id="setup-form">
    <div class="wiz-top"><p class="eyebrow">New franchise · ${labels[step]}</p><button type="button" class="btn tiny ghost" data-act="wizclose">Close</button></div>
    <ol class="wiz-progress">${labels.map((l, i) => `<li><button type="button" class="${i === step ? 'on' : ''}" data-act="wizgo" data-step="${i}" ${i > step ? 'disabled' : ''}>${i + 1}. ${l}</button></li>`).join('')}</ol>
    <fieldset ${show(0)}><legend>How big is the league?</legend>
      <div class="choice-grid">${LEAGUE_SIZES.map((n) => `<label class="choice"><input type="radio" name="teams" value="${n}" ${(st.teams ?? 8) === n ? 'checked' : ''}><b>${n} teams</b><span>${SIZE_BLURB[n] ?? ''}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset ${show(1)}><legend>How do you draft?</legend>
      <div class="choice-grid">
        <label class="choice"><input type="radio" name="rounds" value="24" ${st.rounds === 24 ? 'checked' : ''}><b>24 rounds</b><span>Starters, kicker, and punter. No bench, so an injury puts a starter on both sides of the ball.</span></label>
        <label class="choice"><input type="radio" name="rounds" value="28" ${st.rounds === 28 ? 'checked' : ''}><b>28 rounds</b><span>Four players on the bench. A 16-team league without legendaries stays at 24: the pool runs short.</span></label>
      </div>
      <label class="check"><input type="checkbox" id="f-typecap" ${st.typeCap ? 'checked' : ''}> At most 4 Pokémon of one primary type</label>
      <label class="check"><input type="checkbox" id="f-legend" ${st.legendaries ? 'checked' : ''}> Include legendaries, Ultra Beasts, and Paradox Pokémon</label>
      <label class="check"><input type="checkbox" id="f-clock" ${st.clock ? 'checked' : ''}> 60-second pick clock</label>
    </fieldset>
    <div class="wiz-step" ${show(2)}><h2>Difficulty</h2>${difficultyHtml()}</div>
    <fieldset ${show(3)}><legend>Your club</legend>
      <div class="row2">
        <label>Team name<input id="f-name" maxlength="22" value="${esc(st.name)}"></label>
        <label class="short">Abbreviation<input id="f-abbr" maxlength="3" value="${esc(st.abbr)}"></label>
      </div>
      <div class="swatches" role="group" aria-label="Team color">${SWATCHES.map((c) => `<button type="button" class="swatch ${c === color.toLowerCase() ? 'on' : ''}" style="--sw:${c}" data-act="wizcolor" data-v="${c}" aria-label="Color ${c}" aria-pressed="${c === color.toLowerCase()}"></button>`).join('')}</div>
      <div class="choice-grid schemes">${SCHEME_KEYS.map((k) => `<label class="choice"><input type="radio" name="scheme" value="${k}" ${(st.scheme ?? 'balanced') === k ? 'checked' : ''}><b>${esc(SCHEMES[k].name)}</b><span>${esc(SCHEMES[k].blurb)}</span></label>`).join('')}</div>
      <label>Round 1 slot<select id="f-pick"><option value="" ${st.pick == null ? 'selected' : ''}>Random</option>${Array.from({ length: LG.MAX_TEAMS }, (_, i) => `<option value="${i}" ${st.pick === i ? 'selected' : ''} ${i >= (st.teams ?? 8) ? 'hidden' : ''}>Pick ${i + 1}</option>`).join('')}</select></label>
      <p class="small muted">Snake draft: pick 1 also picks last in round 2.</p>
      <label>Save to${slotSelect('f-slot', slots, target)}</label>
    </fieldset>
    <div class="wiz-step" ${show(4)}>
      <h2>Ready to draft</h2>
      <ul class="wiz-review">
        <li><b>${st.teams ?? 8} teams</b><span>${SIZE_BLURB[st.teams ?? 8] ?? ''}</span></li>
        <li><b>${st.rounds} rounds</b><span>${st.clock ? '60-second clock' : 'No clock'} · ${st.typeCap ? 'type cap on' : 'no type cap'} · ${st.legendaries ? 'legendaries in' : 'legendaries out'}</span></li>
        <li><b>${esc(DIFFICULTY[S.difficulty]?.name ?? 'Pro')}</b><span>${esc(DIFFICULTY[S.difficulty]?.blurb ?? '')}. Your games only.</span></li>
        <li><b style="color:${esc(color)}">${esc(st.name)} (${esc((st.abbr || 'PAL').toUpperCase())})</b><span>${esc(SCHEMES[st.scheme ?? 'balanced']?.name ?? '')} · ${st.pick == null ? 'random slot' : `pick ${st.pick + 1}`}</span></li>
      </ul>
    </div>
    <div class="actions">
      ${step > 0 ? '<button type="button" class="btn" data-act="wizback">Back</button>' : ''}
      ${step < 4 ? '<button type="button" class="btn primary" data-act="wiznext">Next</button>' : '<button class="btn primary" type="submit">Start the draft</button><button class="btn" type="button" data-act="onlineleague">Online league</button>'}
    </div>
  </form>`;
}
// A quick game left for the home screen is still on: one button goes back to it.
function resumeQuickHtml() {
  const g = S.game;
  if (!g || g.final || !S.gameMeta?.quick) return '';
  return `<div class="actions"><button class="btn primary" data-act="go" data-to="game">Back to your game: ${esc(g.teams[1].abbr)} ${g.score[1]}, ${esc(g.teams[0].abbr)} ${g.score[0]} · ${quarterText(g.quarter)}</button></div>`;
}
function slotRow({ n, save }) {
  if (!save) return `<li class="sslot empty"><span class="sn">${n}</span><span class="muted">Empty slot</span></li>`;
  const L = save.league, me = L.teams.find((t) => t.user) ?? L.teams[0];
  const actions = S.confirmDelete === n
    ? `<span class="small">Delete this league for good?</span><button class="btn tiny danger" data-act="slotdelete" data-slot="${n}">Delete</button><button class="btn tiny" data-act="slotkeep">Keep</button>`
    : `<button class="btn tiny primary" data-act="continue" data-slot="${n}">Continue</button><button class="btn tiny" data-act="exportsave" data-slot="${n}">Export</button><button class="btn tiny ghost" data-act="slotconfirm" data-slot="${n}" aria-label="Delete the league in slot ${n}">Delete</button>`;
  return `<li class="sslot ${n === S.slot && S.league ? 'on' : ''}"><span class="sn">${n}</span>
    <span class="si"><b>${teamBadge(me)} ${esc(me.name)}</b><span class="small muted">Season ${L.season ?? 1} · ${phaseLabel(L)}</span></span>
    <span class="actions">${actions}</span></li>`;
}
function slotSelect(id, slots, target) {
  return `<select id="${id}">${slots.map(({ n, save }) => {
    const me = save?.league.teams.find((t) => t.user);
    return `<option value="${n}" ${n === target ? 'selected' : ''}>Slot ${n} · ${me ? `replaces ${esc(me.name)}, season ${save.league.season ?? 1}` : 'empty'}</option>`;
  }).join('')}</select>`;
}
function phaseLabel(L) {
  if (L.phase === 'draft') return `Draft, pick ${L.pickIndex + 1} of ${L.picks.length}`;
  if (L.phase === 'grades') return 'Draft complete';
  if (L.phase === 'season') return `Week ${L.week + 1} of ${L.schedule.length}`;
  if (L.phase === 'playoffs') return 'Playoffs';
  if (L.phase === 'offseason') return 'Offseason';
  if (L.phase === 'freeagency') return `Free agency, round ${(L.fa?.round ?? 0) + 1}`;
  return 'Season over';
}

// The last online room this browser holds a seat in: one click takes the seat back.
function rejoinHtml() {
  if (S.online) return '';
  const seat = lastSeat();
  if (!seat?.code) return '';
  return `<div class="actions"><button class="btn primary" data-act="onlinerejoin" data-code="${esc(seat.code)}">Rejoin ${seat.mode === 'league' ? 'online league' : 'room'} ${esc(seat.code)}</button></div>`;
}
