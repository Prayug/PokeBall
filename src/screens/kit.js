// Franchise kit: your team's colors, end-zone wordmark, home stadium, kickoff time and crowd
// chant. With a league open it edits your team in it (from the next game on); without one, the
// kit for quick games and the next league you start.
import { render } from '../app.js';
import { S, save, savePrefs } from '../state.js';
import { esc } from '../ui.js';
import { CHANTS, CHANT_KEYS, KICKOFFS, STADIUMS, STADIUM_KEYS, WORDMARKS, cleanKit, inkOn, kitOf, shade, venueName } from '../kits.js';
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

// A small postcard of each stadium: its sky at the kit's kickoff and its skyline.
function postcard(st, time = 'day') {
  const sky = { day: ['#4f8fd6', '#cfe5f5'], dusk: ['#2b2f6e', '#f39a5f'], night: ['#05070f', '#1b2440'] }[st === 'haunted' && time === 'day' ? 'dusk' : time];
  const land = {
    classic: '<rect x="0" y="40" width="120" height="20" fill="#3f6b3c"/><path d="M6 40 v-9 h6 v9 M16 40 v-14 h7 v14 M88 40 v-11 h6 v11 M97 40 v-17 h8 v17 M108 40 v-8 h6 v8" fill="#5f6b7a"/>',
    dome: '<rect x="0" y="40" width="120" height="20" fill="#3a3f47"/><path d="M14 44 Q60 4 106 44 Z" fill="#c9ced6"/><path d="M14 44 Q60 4 106 44" fill="none" stroke="#8b939f" stroke-width="1.5"/><path d="M36 28 L36 44 M60 21 L60 44 M84 28 L84 44" stroke="#8b939f"/>',
    mountain: '<path d="M0 44 L22 14 L38 30 L58 6 L80 32 L96 18 L120 44 Z" fill="#59626e"/><path d="M52 14 L58 6 L64 14 Z M18 20 L22 14 L26 20 Z M92 23 L96 18 L100 23 Z" fill="#eef3f7"/><rect x="0" y="42" width="120" height="18" fill="#3c5541"/>',
    seaside: '<rect x="0" y="38" width="120" height="22" fill="#1d5f86"/><path d="M0 46 Q20 42 40 46 T80 46 T120 46 V60 H0 Z" fill="#d8c79b"/><rect x="92" y="14" width="5" height="24" fill="#f4f2ec"/><rect x="92" y="20" width="5" height="4" fill="#c8352b"/><rect x="92" y="30" width="5" height="4" fill="#c8352b"/><path d="M20 36 l0 -9 l7 9 z" fill="#fff"/>',
    haunted: '<rect x="0" y="40" width="120" height="20" fill="#2b2633"/><path d="M14 40 V24 M14 30 L8 24 M14 28 L20 21 M100 40 V20 M100 27 L93 21 M100 25 L107 18" stroke="#241d29" stroke-width="2.5"/><path d="M40 40 v-6 a3 3 0 0 1 6 0 v6 M56 40 v-8 a3 3 0 0 1 6 0 v8 M72 40 v-5 a3 3 0 0 1 6 0 v5" fill="#6d6a75"/><circle cx="30" cy="20" r="2.5" fill="#9d7bff"/><circle cx="84" cy="14" r="2" fill="#5ef0ff"/>',
  }[st];
  const stars = time === 'night' || st === 'haunted' ? '<circle cx="12" cy="8" r=".8" fill="#fff"/><circle cx="48" cy="5" r=".7" fill="#fff"/><circle cx="76" cy="10" r=".8" fill="#fff"/><circle cx="110" cy="6" r=".7" fill="#fff"/><circle cx="96" cy="12" r="4" fill="#f3f1e6"/>' : '';
  return `<svg viewBox="0 0 120 60" class="postcard" aria-hidden="true"><defs><linearGradient id="sky-${st}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
    <rect width="120" height="60" fill="url(#sky-${st})"/>${st === 'dome' ? '' : stars}${land}</svg>`;
}

export function renderKit() {
  const { team, league } = target();
  const kit = kitOf(team);
  const seg = (field, opts, cur) => `<div class="gm-row seg">${Object.entries(opts).map(([k, l]) => `<button class="btn tiny ${cur === k ? 'on' : ''}" data-act="kit" data-k="${field}" data-v="${k}" aria-pressed="${cur === k}">${esc(l)}</button>`).join('')}</div>`;
  const time = kit.kickoff === 'night' ? 'night' : kit.kickoff === 'day' ? 'day' : 'dusk';
  return `<section class="kitscreen">
    <div class="kit-head">
      <div><h1>Franchise kit</h1><p class="muted">${league ? `${esc(team.name)} wear this from your next game on, home and away; your home games are played in your stadium.` : 'For quick games and the next league you start.'}</p></div>
      <div class="kit-bug" style="--team:${team.color};--team2:${kit.color2};--team-ink:${inkOn(team.color)}"><span class="kb-abbr">${esc(team.abbr)}</span><span class="kb-name">${esc(team.name)}</span></div>
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
  if (t.id === 'k-word') { drawKitPreview(); return true; }
  render();
  return true;
}
