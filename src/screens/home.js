// Home screen: new league setup, continue, quick game and save import.
import { PLAYERS } from '../ratings.js';
import * as LG from '../league.js';
import { render, setScreen } from '../app.js';
import { S, loadSaved } from '../state.js';
import { P, esc, sprite } from '../ui.js';
import { autoAdvance } from './game.js';
import { SCHEMES, SCHEME_KEYS } from '../coach.js';

function resumeScreen(L, game) {
  if (game && !game.final) return 'game';
  return { draft: 'draft', grades: 'grades', offseason: 'offseason' }[L.phase] ?? 'season';
}
export function loadSnapshot(snap) {
  S.league = LG.migrateLeague(snap.league); S.game = snap.game ?? null; S.gameMeta = snap.gameMeta ?? null;
  S.offCuts = null; S.subSel = null; S.resultIdx = null;
  setScreen(resumeScreen(S.league, S.game));
  if (S.screen === 'game') autoAdvance();
}
export function importSave(text) {
  let data;
  try { data = JSON.parse(text); } catch { S.importMsg = 'That is not valid JSON.'; render(); return; }
  if (!Array.isArray(data?.league?.teams) || !data.league.teams.some((t) => t.user)) { S.importMsg = 'No PokeBall league found in that file.'; render(); return; }
  S.importMsg = '';
  loadSnapshot(data);
}

// ---------- home ----------
export function renderHome() {
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
        <fieldset class="schemes"><legend>Your scheme</legend>
          ${SCHEME_KEYS.map((k) => `<label class="schemepick"><input type="radio" name="scheme" value="${k}" ${(st.scheme ?? 'balanced') === k ? 'checked' : ''}><b>${esc(SCHEMES[k].name)}</b><span class="small muted">${esc(SCHEMES[k].blurb)}</span></label>`).join('')}
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
