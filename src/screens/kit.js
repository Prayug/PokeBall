// Franchise kit: your team's colors, end-zone wordmark, home stadium, kickoff time and crowd
// chant. With a league open it edits your team in it (from the next game on); without one, the
// kit for quick games and the next league you start.
import { render } from '../app.js';
import { S, save, savePrefs } from '../state.js';
import { esc } from '../ui.js';
import { CHANTS, CHANT_KEYS, KICKOFFS, STADIUMS, STADIUM_KEYS, WORDMARKS, cleanKit, inkOn, kitOf, postcard, shade, venueName } from '../kits.js';
import { paintEndZone } from '../kitdraw.js';
import { chant } from '../audio.js';

const SWATCHES = ['#c8102e', '#e0702a', '#d9a21b', '#3e9b5a', '#2e7d6b', '#2f6fd6', '#1d3a8a', '#7d5bb5', '#b03a8c', '#2b2f36', '#8a7a5c', '#f2f0e8'];

// The team being dressed: your league team, or the quick-game setup.
function target() {
  const t = S.league?.teams.find((x) => x.user);
  if (t) return { team: t, league: true };
  const st = S.setup;
  return { team: { name: st.name || 'Pallet Starters', abbr: (st.abbr || 'PAL').toUpperCase(), color: st.color ?? '#c8102e', kit: st.kit ?? null }, league: false };
}
// A new main color; a second color that was only the old one's dark shade follows it.
function setColor(team, c) {
  const k = kitOf(team);
  if (k.color2 === shade(team.color, -0.55).toLowerCase()) team.kit = { ...k, color2: shade(c, -0.55) };
  team.color = c;
}
function commit(team, league) {
  team.kit = cleanKit(team.kit, team);
  if (league) save();
  else { S.setup.color = team.color; S.setup.kit = team.kit; savePrefs(); }
}

export function renderKit() {
  const { team, league } = target();
  const kit = kitOf(team);
  const seg = (field, opts, cur) => `<div class="gm-row seg">${Object.entries(opts).map(([k, l]) => `<button class="btn tiny ${cur === k ? 'on' : ''}" data-act="kit" data-k="${field}" data-v="${k}" aria-pressed="${cur === k}">${esc(l)}</button>`).join('')}</div>`;
  const time = kit.kickoff === 'night' ? 'night' : kit.kickoff === 'day' ? 'day' : 'dusk';
  return `<section class="kitscreen">
    <div class="kit-head">
      <div><h1>Franchise kit</h1><p class="muted">${league ? `${esc(team.name)} wear this from your next game on, home and away; your home games are played in your stadium.` : 'For quick games and the next league you start.'}</p></div>
      <div class="kit-live" style="--team:${team.color};--team2:${kit.color2};--team-ink:${inkOn(team.color)}">
        <div class="jersey" aria-hidden="true"><span class="jersey-stripe"></span><b>${esc(team.abbr)}</b><span class="jersey-word">${esc(kit.wordmark || team.name)}</span></div>
        <div class="kit-bug"><span class="kb-abbr">${esc(team.abbr)}</span><span class="kb-name">${esc(team.name)}</span></div>
      </div>
    </div>
    <div class="kit-grid">
      <div class="card kit-form">
        <h2>Colors</h2>
        <div class="kit-colors">
          <label>Main color<input type="color" id="k-color" value="${team.color}"></label>
          <label>Second color<input type="color" id="k-color2" value="${kit.color2}"></label>
        </div>
        <div class="swatches" role="group" aria-label="Main color presets">${SWATCHES.map((c) => `<button class="swatch ${c === team.color.toLowerCase() ? 'on' : ''}" style="--sw:${c}" data-act="kit" data-k="color" data-v="${c}" aria-label="Main color ${c}"></button>`).join('')}</div>
        <h2>End zone</h2>
        <label>Wordmark<input id="k-word" maxlength="18" placeholder="${esc(team.name)}" value="${esc(kit.wordmark)}"></label>
        ${seg('style', WORDMARKS, kit.style)}
        <canvas id="kit-ez" class="kit-ez" width="640" height="120" aria-label="End zone preview"></canvas>
        <h2>Kickoff</h2>
        ${seg('kickoff', KICKOFFS, kit.kickoff)}
        <p class="small muted">Playoff games are always in prime time. ${kit.stadium === 'haunted' ? 'The hollow never plays in daylight.' : ''}</p>
      </div>
      <div class="card kit-form">
        <h2>Home stadium</h2>
        <div class="stadiums">${STADIUM_KEYS.map((k) => `<button class="stadium ${kit.stadium === k ? 'on' : ''}" data-act="kit" data-k="stadium" data-v="${k}" aria-pressed="${kit.stadium === k}">
          ${postcard(k, time)}<b>${esc(STADIUMS[k].name)}</b><span class="small">${esc(venueName(team, k))}</span><span class="small muted">${esc(STADIUMS[k].blurb)}</span></button>`).join('')}</div>
        <h2>Crowd chant</h2>
        <div class="chants">${CHANT_KEYS.map((k) => `<div class="chant ${kit.chant === k ? 'on' : ''}"><button class="btn tiny ${kit.chant === k ? 'on' : ''}" data-act="kit" data-k="chant" data-v="${k}" aria-pressed="${kit.chant === k}">${esc(CHANTS[k].name)}</button>
          <span class="small muted">${esc(CHANTS[k].blurb)}</span><button class="btn tiny ghost" data-act="kitchant" data-v="${k}" aria-label="Hear ${esc(CHANTS[k].name)}">Play</button></div>`).join('')}</div>
        <p class="small muted">Your home crowd sings it at kickoff, after your scores and takeaways, and on big third downs.</p>
        <div class="actions"><button class="btn" type="button" data-act="sound">Volume and booth</button></div>
      </div>
    </div>
  </section>`;
}

// After each render: the end-zone preview, drawn with the field's own painter.
export function drawKitPreview() {
  const c = document.getElementById('kit-ez');
  if (!c) return;
  const { team } = target();
  const PX = 12, W = 10 * PX, H = Math.round(53.3 * PX);
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  paintEndZone(off.getContext('2d'), 0, H, PX, team, true);
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  // The end zone seen from the field: turned so its wordmark reads left to right.
  x.save(); x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2); x.drawImage(off, -W / 2, -H / 2, W, H); x.restore();
}

export function kitAct(act, el) {
  const { team, league } = target();
  if (act === 'kitchant') { chant(el.dataset.v, { times: 1 }); return; }
  const k = el.dataset.k, v = el.dataset.v;
  if (k === 'color') setColor(team, v);
  else team.kit = { ...kitOf(team), [k]: v };
  commit(team, league);
  render();
}
export function kitInput(t) {
  if (!['k-color', 'k-color2', 'k-word'].includes(t.id)) return false;
  const { team, league } = target();
  if (t.id === 'k-color') setColor(team, t.value);
  else team.kit = { ...kitOf(team), [t.id === 'k-word' ? 'wordmark' : 'color2']: t.value };
  commit(team, league);
  // Typing keeps its place: only the previews redraw.
  if (t.id === 'k-word') {
    drawKitPreview();
    const word = document.querySelector('.jersey-word');
    if (word) word.textContent = t.value || team.name;
    return true;
  }
  render();
  return true;
}
