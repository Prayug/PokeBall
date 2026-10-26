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
  const st = S.setup;
  const showcase = [130, 248, 135, 65, 448, 445].filter((id) => PLAYERS[id]);
  return `<section class="home">
    ${sharedInHtml()}
    <div class="hero"><span class="hero-ball" aria-hidden="true"></span>
      <p class="eyebrow">Gen 1 to 9 · 22 positions · 8 to 16-team leagues</p>
      <h1>Draft Pokémon. Coach football.</h1>
      <p class="lede">Every rating comes from real base stats: Speed makes receivers, Defense and HP make linemen, Sp. Atk makes quarterbacks. Type matchups decide the trenches.</p>
      <div class="showcase">${showcase.map((id) => `<figure style="--tc:${TYPE_COLORS[P(id).types[0]]}">${sprite(id)}<figcaption>${esc(P(id).name)}<b>${P(id).best[0]} ${P(id).ovr[P(id).best[0]]}</b></figcaption></figure>`).join('')}</div>
    </div>
    <div class="cards">
      <form class="card setup" id="setup-form">
        <h2>New league</h2>
        <div class="row2">
          <label>Team name<input id="f-name" maxlength="22" value="${esc(st.name)}"></label>
          <label class="short">Abbreviation<input id="f-abbr" maxlength="3" value="${esc(st.abbr)}"></label>
        </div>
        <fieldset><legend>League size</legend>
          ${LEAGUE_SIZES.map((n) => `<label class="pill"><input type="radio" name="teams" value="${n}" ${(st.teams ?? 8) === n ? 'checked' : ''}> ${n} teams${n === 8 ? ', 7 weeks, top 4 in the playoffs' : n === 12 ? ', 3 divisions, 14 weeks, 6 in the playoffs' : ', 4 divisions, 18 weeks, 8 in the playoffs'}</label>`).join('')}
        </fieldset>
        <fieldset><legend>Draft length</legend>
          <label class="pill"><input type="radio" name="rounds" value="24" ${st.rounds === 24 ? 'checked' : ''}> 24 rounds, starters, kicker and punter. No bench: an injury puts a starter on both sides of the ball</label>
          <label class="pill"><input type="radio" name="rounds" value="28" ${st.rounds === 28 ? 'checked' : ''}> 28 rounds, with 4 bench</label>
          <span class="small muted">A 16-team league without legendaries drafts 24 rounds: the pool runs short at 28.</span>
        </fieldset>
        <fieldset class="schemes"><legend>Your scheme</legend>
          ${SCHEME_KEYS.map((k) => `<label class="schemepick"><input type="radio" name="scheme" value="${k}" ${(st.scheme ?? 'balanced') === k ? 'checked' : ''}><b>${esc(SCHEMES[k].name)}</b><span class="small muted">${esc(SCHEMES[k].blurb)}</span></label>`).join('')}
        </fieldset>
        <label class="check"><input type="checkbox" id="f-typecap" ${st.typeCap ? 'checked' : ''}> At most 4 Pokémon of one primary type</label>
        <label class="check"><input type="checkbox" id="f-legend" ${st.legendaries ? 'checked' : ''}> Include legendaries, Ultra Beasts and Paradox Pokémon</label>
        <label class="check"><input type="checkbox" id="f-clock" ${st.clock ? 'checked' : ''}> 60-second pick clock</label>
        <label>Save to${slotSelect('f-slot', slots, target)}</label>
        <button class="btn primary" type="submit">Start the draft</button>
        <button class="btn" type="button" data-act="onlineleague">Online league</button>
      </form>
      <div class="card side ${slots.some((x) => x.save) ? 'has-saves' : ''}">
        <h2>Your leagues</h2>
        <ul class="saveslots">${slots.map(slotRow).join('')}</ul>
        <hr>
        <h2>Difficulty</h2>
        ${difficultyHtml()}
        <hr>
        <h2>Quick game</h2>
        <p>Two AI-drafted rosters, kickoff right away. You coach the home side.</p>
        ${resumeQuickHtml()}
        <div class="actions"><button class="btn" data-act="quick">Play a quick game</button>
          <button class="btn" data-act="quick2">Two players, one screen</button>
          <button class="btn" data-act="watchgame">Watch a game</button>
          <button class="btn" data-act="onlinequick">Quick match online</button>
          <button class="btn" data-act="onlineh2h" title="You and a friend draft against each other, then play">Head-to-head draft online</button>
          <button class="btn ghost" data-act="go" data-to="kit">Franchise kit</button></div>
        <div class="actions"><input id="net-code" maxlength="8" placeholder="Room code" aria-label="Room code"><button class="btn" data-act="onlinejoin">Join</button></div>
        ${rejoinHtml()}
        ${S.netMsg ? `<p class="small bad">${esc(S.netMsg)}</p>` : ''}
        <p class="small muted">Two players: one keyboard (WASD and the arrows) or gamepads. Player 1 has the home team, player 2 the away team, and each of you calls and plays your own side.</p>
        <p class="small muted">Watch: the AI calls and plays both sides, under a big scoreboard. Press O to call the next play yourself. For a stream, open the game with <code>?watch</code> on the address and every final rolls into the next game.</p>
        <hr>
        <details class="importbox" ${S.importMsg ? 'open' : ''}><summary>Import a save or a shared league</summary>
          <p class="small muted">Load a league from an exported file, or paste its contents, a league code or a share link, into the slot you pick.</p>
          <label>Load into${slotSelect('i-slot', slots, target)}</label>
          <input type="file" id="import-file" accept="application/json,.json">
          <textarea id="import-text" rows="3" placeholder="Paste save JSON, a league code or a link"></textarea>
          <button class="btn" data-act="importpaste">Load what I pasted</button>
          ${S.importMsg ? `<p class="small bad">${esc(S.importMsg)}</p>` : ''}
        </details>
      </div>
    </div>
  </section>`;
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
