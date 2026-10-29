// Home screen: the main menu. A full-screen night stadium (menu3d.js) with the Pokémon lineup
// on the field, the PokeBall title, a console-style menu on the left (Continue franchise, Quick
// play, New franchise, Team builder, Settings) and one featured Pokémon on the right. Each menu
// item opens its panel beside the menu: the franchise saves (continue, export, delete), the
// quick games and online play, the new league setup, the team builder and the settings (with
// save import). Arrow keys, Enter and Escape (or a gamepad's D-pad, A and B) drive it.
import * as LG from '../league.js';
import { render, setScreen } from '../app.js';
import { S, firstFreeSlot, reduceMotion, savedSlots } from '../state.js';
import { P, esc } from '../ui.js';
import { autoAdvance, difficultyHtml } from './game.js';
import { SCHEMES, SCHEME_KEYS } from '../coach.js';
import { sharedInHtml } from './share.js';
import { LEAGUE_SIZES, roundLabel } from '../geometry.js';
import { quarterText } from '../engine.js';
import { TYPE_COLORS } from '../types.js';
import { lastSeat } from '../net.js';
import { inkOn, kitOf, venueName } from '../kits.js';
import { paintEndZone } from '../kitdraw.js';
import { crowdReact, soundOn, ui } from '../audio.js';
import { soundPanelHtml } from './sound.js';
import { LINEUP, menuStage, peekMenu } from '../menu3d.js';

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

// ---------- the menu ----------
const ICONS = {
  continue: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/><circle cx="12" cy="12" r="10.2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  quick: '<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="currentColor"/>',
  new: '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  team: '<path d="M8.5 3 4 5.5 2.5 10l3 1.2V21h13v-9.8l3-1.2L20 5.5 15.5 3c-.6 1.6-1.9 2.5-3.5 2.5S9.1 4.6 8.5 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 12.5h4M12 10.5v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  settings: '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.3 2.8h3.4l.5 2.6 1.8.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.8 2.6.5v3.4l-2.6.5-.8 1.8 1.5 2.2-2.4 2.4-2.2-1.5-1.8.8-.5 2.6h-3.4l-.5-2.6-1.8-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.8-2.6-.5v-3.4l2.6-.5.8-1.8-1.5-2.2 2.4-2.4 2.2 1.5 1.8-.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
};
const icon = (k, cls = 'mm-ico') => `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${ICONS[k]}</svg>`;
// Which Pokémon each item puts in the spotlight; null frames the whole lineup.
const FEATURE = { continue: 445, quick: 448, new: 248, team: null, settings: 135 };
const ITEMS = [
  ['continue', 'Continue franchise'],
  ['quick', 'Quick play'],
  ['new', 'New franchise'],
  ['team', 'Team builder'],
  ['settings', 'Settings'],
];

// The save the menu is showing: the one picked on the franchise panel, else the active slot, else
// the first one with a league in it.
function pickSlot(slots) {
  const has = (n) => slots.find((x) => x.n === n)?.save;
  if (S.menuSlot != null && slots.some((x) => x.n === S.menuSlot)) return S.menuSlot;
  if (has(S.slot)) return S.slot;
  return slots.find((x) => x.save)?.n ?? S.slot;
}
const meOf = (L) => L.teams.find((t) => t.user) ?? L.teams[0];

function itemDesc(k, slots) {
  const n = pickSlot(slots), save = slots.find((x) => x.n === n)?.save;
  switch (k) {
    case 'continue': return save ? `${meOf(save.league).name} · Season ${save.league.season ?? 1} · ${phaseLabel(save.league)}` : 'No franchise saved yet. Start one with New franchise.';
    case 'quick': return S.game && !S.game.final && S.gameMeta?.quick ? `Your quick game is still on: ${quickScore(S.game)}.` : 'Two AI-drafted rosters and kickoff right away. Solo, two players, watch or online.';
    case 'new': return 'Name your team, pick a league size and a scheme, then run the draft.';
    case 'team': return 'Your colors, end-zone wordmark, stadium and chant, plus the depth chart and trades.';
    case 'settings': return 'Difficulty, sound, graphics and your save files.';
    default: return '';
  }
}
const quickScore = (g) => `${g.teams[1].abbr} ${g.score[1]}, ${g.teams[0].abbr} ${g.score[0]} · ${quarterText(g.quarter)}`;

let lastPanel = null;
export function renderHome() {
  const slots = savedSlots();
  const any = slots.some((x) => x.save);
  // A failed import opens the save files; a failed online request opens quick play.
  if (S.importMsg && !S.menuPanel) S.menuPanel = 'settings';
  if (S.netMsg && !S.menuPanel) S.menuPanel = 'quick';
  if (!S.menuSel || !FEATURE.hasOwnProperty(S.menuSel)) S.menuSel = any ? 'continue' : 'new';
  const panel = S.menuPanel;
  const fresh = panel && panel !== lastPanel;
  lastPanel = panel;
  const items = ITEMS.map(([k, label]) => {
    const dim = k === 'continue' && !any;
    return `<li><button class="mm-item ${S.menuSel === k ? 'sel' : ''} ${panel === k ? 'open' : ''} ${k === 'continue' ? 'primary' : ''} ${dim ? 'dim' : ''}" data-act="menupanel" data-panel="${k}" data-sel="${k}" aria-expanded="${panel === k}" aria-describedby="mm-d-${k}">
      ${icon(k)}<span class="mm-label">${label}</span><span class="mm-desc" id="mm-d-${k}">${esc(itemDesc(k, slots))}</span></button></li>`;
  }).join('');
  return `<section class="mm ${panel ? 'has-panel' : ''}" id="mm" data-panel="${panel ?? ''}">
    <div class="mm-scene" id="menu3d" aria-hidden="true"><div class="mm-fallback"></div></div>
    <div class="mm-shade" aria-hidden="true"></div>
    <header class="mm-title">${titleHtml()}</header>
    <nav class="mm-nav" aria-label="Main menu"><ul class="mm-list">${items}</ul></nav>
    ${panel ? `<div class="mm-panel ${fresh ? 'fresh' : ''}" role="region" aria-label="${esc(ITEMS.find(([k]) => k === panel)?.[1] ?? '')}">${panelHtml(panel, slots)}</div>` : ''}
    <aside class="mm-plate" id="mm-plate" aria-live="polite">${plateHtml(featureOf())}</aside>
    <div class="mm-hud">
      <button class="mm-mute ${S.sound ? '' : 'off'}" data-act="mute" aria-pressed="${!S.sound}" aria-label="${S.sound ? 'Mute sound' : 'Unmute sound'}" title="Sound (U)">${speaker(S.sound)}<span>${S.sound ? 'Sound on' : 'Muted'}</span></button>
    </div>
    <footer class="mm-hints" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Back</span><span><kbd>U</kbd> Mute</span></footer>
    ${S.shareIn ? `<div class="mm-share">${sharedInHtml()}</div>` : ''}
  </section>`;
}

const speaker = (on) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${on ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;

// The title: the emblem (a Poké Ball whose band is a football's laces) and the wordmark.
export function emblemSvg(cls = 'mm-emblem') {
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="emb-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2414b"/><stop offset="1" stop-color="#b3121f"/></linearGradient>
      <linearGradient id="emb-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d1de"/></linearGradient></defs>
    <path d="M4 50a46 46 0 0 1 92 0z" fill="url(#emb-r)"/><path d="M4 50a46 46 0 0 0 92 0z" fill="url(#emb-w)"/>
    <rect x="4" y="44" width="92" height="12" fill="#0b1a33"/>
    <g fill="#f5f7fb">${[-30, -21, -12, 12, 21, 30].map((d) => `<rect x="${48.6 + d}" y="40.5" width="2.8" height="19" rx="1"/>`).join('')}</g>
    <circle cx="50" cy="50" r="15" fill="#0b1a33"/><circle cx="50" cy="50" r="9" fill="#f5f7fb"/><circle cx="50" cy="50" r="4.5" fill="none" stroke="#c9d1de" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="46" fill="none" stroke="#0b1a33" stroke-width="4"/>
    <path d="M18 26a40 40 0 0 1 22-14" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}
function titleHtml() {
  return `<div class="mm-brand">${emblemSvg()}<div class="mm-word"><h1 class="mm-logo" aria-label="PokeBall"><span>Poke</span><span>Ball</span></h1>
    <p class="mm-tag"><span>Pro Football</span><i aria-hidden="true"></i><span>Gen 1 to 9</span></p></div></div>`;
}

// The featured Pokémon's nameplate: name, the spot it is posed at with its real rating there,
// its types and a line about it.
function featureOf() {
  if (S.menuPanel === 'team') return S.menuTeamPick ?? null;
  return FEATURE[S.menuSel] ?? null;
}
function plateHtml(id) {
  if (id == null) {
    return `<p class="mp-kicker">Starting lineup</p><p class="mp-name">The Six</p>
      <p class="mp-line">${LINEUP.map((a) => esc(P(a.id).name)).join(' · ')}</p>`;
  }
  const L = LINEUP.find((a) => a.id === id), p = P(id);
  const state = peekMenu()?.modelState(id);
  return `<p class="mp-kicker" style="--tc:${TYPE_COLORS[p.types[0]]}">${p.types.map((t) => `<span class="mp-type" style="--tc:${TYPE_COLORS[t]}">${t}</span>`).join('')}</p>
    <p class="mp-name">${esc(p.name)}</p>
    <p class="mp-rate"><b>${L.role}</b><span>${p.ovr[L.role]}</span><small>OVR</small></p>
    <p class="mp-line">${esc(L.line)}${state === 'loading' ? ' <em class="mp-load">3D model loading</em>' : state === 'missing' ? ' <em class="mp-load">3D model not downloaded: run npm run models</em>' : ''}</p>`;
}

// ---------- panels ----------
function panelHtml(k, slots) {
  const head = (title, sub = '') => `<header class="mp-head"><div><h2>${title}</h2>${sub ? `<p class="small muted">${sub}</p>` : ''}</div>
    <button class="mp-back" data-act="menuclose" aria-label="Back to the menu"><kbd>Esc</kbd> Back</button></header>`;
  switch (k) {
    case 'continue': return head('Continue franchise') + franchiseHtml(slots);
    case 'quick': return head('Quick play') + quickHtml();
    case 'new': return head('New franchise', 'A snake draft against AI general managers, then the season.') + setupHtml(slots);
    case 'team': return head('Team builder') + teamHtml(slots);
    case 'settings': return head('Settings') + settingsHtml(slots);
    default: return '';
  }
}

// The franchise saves: a tab per slot, and the picked one as a card in its team's colors.
function franchiseHtml(slots) {
  const n = pickSlot(slots);
  const tabs = slots.map(({ n: k, save }) => {
    const me = save && meOf(save.league);
    return `<button class="fr-tab ${k === n ? 'on' : ''} ${save ? '' : 'empty'}" data-act="menuslot" data-slot="${k}" role="tab" aria-selected="${k === n}" ${me ? `style="--team:${me.color}"` : ''}>
      <span class="fr-tn">${k}</span>${me ? `<span class="fr-tt"><b>${esc(me.abbr)}</b><small>${esc(shortPhase(save.league))}</small></span>` : '<span class="fr-tt"><b>Empty</b><small>New franchise</small></span>'}</button>`;
  }).join('');
  const save = slots.find((x) => x.n === n)?.save;
  return `<div class="fr-tabs" role="tablist" aria-label="Save slots">${tabs}</div>${save ? franchiseCard(n, save) : emptyCard(n)}`;
}
function emptyCard(n) {
  return `<div class="fr-empty"><svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <p><b>Slot ${n} is open.</b> Draft a roster of Pokémon and take them through a season.</p>
    <button class="btn primary mm-cta" data-act="menupanel" data-panel="new" data-slot="${n}">Start a new franchise here</button></div>`;
}
// What the save says about where the franchise stands: its record, its place in the standings
// and its next game (or its next pick in the draft). Nothing here is made up: a part the save
// has no data for is left out.
function franchiseFacts(L) {
  const me = meOf(L), facts = [];
  const rec = LG.teamSeason(L, me.id);
  const recText = (s) => `${s.w}-${s.l}${s.t ? `-${s.t}` : ''}`;
  let next = null;
  if (L.phase === 'draft') {
    const i = L.picks.findIndex((p, j) => j >= L.pickIndex && p.team === me.id);
    facts.push(['Draft', `Pick ${L.pickIndex + 1} of ${L.picks.length}`]);
    if (i >= 0) facts.push(['Your next pick', i === L.pickIndex ? 'On the clock' : `No. ${i + 1}, in ${i - L.pickIndex}`]);
    facts.push(['Roster', `${me.roster.length} Pokémon`]);
    return { facts, next };
  }
  if (rec.gp) facts.push(['Record', recText(rec)]);
  if (L.results.some((r) => !r.playoff && r.season === (L.season ?? 1)) && ['season', 'playoffs'].includes(L.phase)) {
    const st = LG.standings(L), at = st.findIndex((r) => r.id === me.id);
    if (at >= 0) facts.push(['Standing', `${ordinal(at + 1)} of ${st.length}`]);
  }
  if (rec.gp) facts.push(['Points', `${rec.pf} for, ${rec.pa} against`]);
  let gm = null, label = '';
  if (L.phase === 'season' || L.phase === 'grades') {
    const wk = L.phase === 'grades' ? 0 : L.week;
    gm = (L.schedule[wk] ?? []).find((g) => g.home === me.id || g.away === me.id);
    label = `Week ${wk + 1}`;
  } else if (L.phase === 'playoffs' && L.playoffs) {
    gm = L.playoffs.games.find((g) => g.home === me.id || g.away === me.id);
    label = roundLabel(L, L.playoffs.round);
  }
  if (gm) {
    const opp = L.teams[gm.home === me.id ? gm.away : gm.home], os = LG.teamSeason(L, opp.id);
    next = { label, home: gm.home === me.id, opp, rec: os.gp ? recText(os) : '' };
  }
  if (L.champion === me.id) facts.unshift(['Title', 'Champions']);
  return { facts, next };
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
function crest(team, cls = 'fr-crest') {
  const kit = kitOf(team), ink = inkOn(team.color);
  return `<svg class="${cls}" viewBox="0 0 64 72" aria-hidden="true"><path d="M32 3 6 11v22c0 17 11 29 26 36 15-7 26-19 26-36V11z" fill="${team.color}" stroke="${kit.color2}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M6 33h52" stroke="${kit.color2}" stroke-width="3" opacity=".55"/>
    <text x="32" y="${team.abbr.length > 2 ? 30 : 31}" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="${team.abbr.length > 2 ? 19 : 23}" fill="${ink}">${esc(team.abbr)}</text>
    <circle cx="32" cy="50" r="7" fill="none" stroke="${ink}" stroke-width="2.4" opacity=".85"/><path d="M25 50h14" stroke="${ink}" stroke-width="2.4" opacity=".85"/></svg>`;
}
function franchiseCard(n, save) {
  const L = save.league, me = meOf(L), kit = kitOf(me), ink = inkOn(me.color);
  const { facts, next } = franchiseFacts(L);
  const more = S.menuMore === n;
  const confirm = S.confirmDelete === n;
  return `<article class="fr-card" style="--team:${me.color};--team2:${kit.color2};--team-ink:${ink}">
    <canvas class="fr-art" data-art-slot="${n}" width="720" height="230" aria-hidden="true"></canvas>
    <div class="fr-head">${crest(me)}
      <div class="fr-id"><p class="fr-venue">${esc(venueName(me))}</p><h3 class="fr-name">${esc(me.name)}</h3><p class="fr-phase">Season ${L.season ?? 1} · ${esc(phaseLabel(L))}</p></div>
      <div class="fr-morebox"><button class="fr-morebtn" data-act="menumore" data-slot="${n}" aria-haspopup="menu" aria-expanded="${more}" aria-label="Save options for slot ${n}">⋯</button>
        ${more ? `<div class="fr-menu" role="menu">${confirm
    ? `<p class="small">Delete ${esc(me.name)} for good?</p><button class="fr-mi danger" role="menuitem" data-act="slotdelete" data-slot="${n}">Delete</button><button class="fr-mi" role="menuitem" data-act="slotkeep">Keep it</button>`
    : `<button class="fr-mi" role="menuitem" data-act="exportsave" data-slot="${n}">Export save file</button><button class="fr-mi" role="menuitem" data-act="slotgo" data-slot="${n}" data-to="kit">Edit franchise kit</button><button class="fr-mi danger" role="menuitem" data-act="slotconfirm" data-slot="${n}">Delete franchise…</button>`}</div>` : ''}</div>
    </div>
    <dl class="fr-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${next ? `<div class="fr-next" style="--opp:${next.opp.color}"><span class="fr-nl">Next · ${esc(next.label)}</span>
      <span class="fr-nv">${next.home ? 'vs' : 'at'}</span>${crest(next.opp, 'fr-ocrest')}<span class="fr-on"><b>${esc(next.opp.name)}</b>${next.rec ? `<small>${next.rec}</small>` : ''}</span></div>` : ''}
    <button class="fr-go" data-act="continue" data-slot="${n}"><span>Continue</span><small>${esc(continueHint(L))}</small>${icon('continue', 'fr-goi')}</button>
  </article>`;
}
function continueHint(L) {
  if (L.phase === 'draft') return 'Back to the draft room';
  if (L.phase === 'grades') return 'Draft grades, then the season';
  if (L.phase === 'season') return `Week ${L.week + 1} of ${L.schedule.length}`;
  if (L.phase === 'playoffs') return 'The playoffs';
  return phaseLabel(L);
}
function shortPhase(L) {
  if (L.phase === 'draft') return `Draft · ${L.pickIndex + 1}/${L.picks.length}`;
  if (L.phase === 'season') return `S${L.season ?? 1} · Wk ${L.week + 1}`;
  if (L.phase === 'playoffs') return `S${L.season ?? 1} · Playoffs`;
  return `S${L.season ?? 1} · ${phaseLabel(L)}`;
}

// The card's artwork: the team's own end zone (the one painted on the field in its games, by
// kitdraw.js) seen from above, with the field running down from it under the lights.
function paintFranchiseArt(canvas, team) {
  const W = canvas.width, H = canvas.height, PX = W / 53.3, yards = Math.ceil(H / PX) + 1;
  const o = document.createElement('canvas'); o.width = Math.ceil(yards * PX); o.height = W;
  const x = o.getContext('2d');
  for (let i = 0; i * 5 < yards; i++) { x.fillStyle = i % 2 ? '#2f7c40' : '#2a733b'; x.fillRect(i * 5 * PX, 0, 5 * PX, W); }
  paintEndZone(x, 0, W, PX, team, true, -1);
  x.fillStyle = 'rgba(250,252,248,0.92)';
  x.fillRect(10 * PX - 1, 0, 3, W);
  for (let yd = 15; yd < yards; yd += 5) x.fillRect(yd * PX - 1, 0, 2, W);
  for (let yd = 11; yd < yards; yd++) if (yd % 5) for (const z of [W * 0.33, W * 0.67]) x.fillRect(yd * PX - 1, z - 4, 2, 8);
  const c = canvas.getContext('2d');
  c.setTransform(0, 1, -1, 0, W, 0);
  c.drawImage(o, 0, 0);
  c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createRadialGradient(W * 0.75, -H * 0.2, 10, W * 0.75, -H * 0.2, W * 0.9);
  g.addColorStop(0, 'rgba(255,248,220,0.28)'); g.addColorStop(1, 'rgba(255,248,220,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}

function quickHtml() {
  const g = S.game;
  const resume = g && !g.final && S.gameMeta?.quick
    ? `<button class="qp-resume" data-act="go" data-to="game">${icon('continue')}<span><b>Back to your game</b><small>${esc(quickScore(g))}</small></span></button>` : '';
  const seat = !S.online && lastSeat();
  return `${resume}
    <div class="qp-grid">
      <button class="qp-tile big" data-act="quick">${icon('quick')}<b>Play now</b><span>You coach the home side. Two AI-drafted rosters, kickoff right away.</span></button>
      <button class="qp-tile" data-act="quick2"><b>Two players, one screen</b><span>Player 1 on WASD, player 2 on the arrows, or two gamepads. Each side calls its own plays.</span></button>
      <button class="qp-tile" data-act="watchgame"><b>Watch a game</b><span>The AI plays both sides under a big scoreboard. Press O to call the next play yourself.</span></button>
    </div>
    <h3 class="mp-sub">Online</h3>
    <div class="qp-online">
      <button class="btn" data-act="onlinequick">Quick match online</button>
      <button class="btn" data-act="onlineh2h" title="You and a friend draft against each other, then play">Head-to-head draft</button>
      <span class="qp-join"><input id="net-code" maxlength="8" placeholder="Room code" aria-label="Room code"><button class="btn" data-act="onlinejoin">Join</button></span>
    </div>
    ${seat?.code ? `<div class="actions"><button class="btn primary" data-act="onlinerejoin" data-code="${esc(seat.code)}">Rejoin ${seat.mode === 'league' ? 'online league' : 'room'} ${esc(seat.code)}</button></div>` : ''}
    ${S.netMsg ? `<p class="small bad">${esc(S.netMsg)}</p>` : ''}
    <h3 class="mp-sub">Difficulty</h3>
    ${difficultyHtml()}
    <p class="small muted">For a stream, open the game with <code>?watch</code> on the address and every final rolls into the next game.</p>`;
}

function setupHtml(slots) {
  const st = S.setup;
  const target = S.menuNewSlot ?? firstFreeSlot() ?? S.slot;
  return `<form class="nf" id="setup-form">
    <div class="nf-grid">
      <div class="nf-col">
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
        <label>Your draft slot<select id="f-pick">
          <option value="" ${st.pick == null ? 'selected' : ''}>Random</option>
          ${Array.from({ length: LG.MAX_TEAMS }, (_, i) => `<option value="${i}" ${st.pick === i ? 'selected' : ''} ${i >= (st.teams ?? 8) ? 'hidden' : ''}>Pick ${i + 1} in round 1</option>`).join('')}
        </select><span class="small muted">A snake draft: pick 1 also picks last in round 2.</span></label>
        <label class="check"><input type="checkbox" id="f-typecap" ${st.typeCap ? 'checked' : ''}> At most 4 Pokémon of one primary type</label>
        <label class="check"><input type="checkbox" id="f-legend" ${st.legendaries ? 'checked' : ''}> Include legendaries, Ultra Beasts and Paradox Pokémon</label>
        <label class="check"><input type="checkbox" id="f-clock" ${st.clock ? 'checked' : ''}> 60-second pick clock</label>
      </div>
      <fieldset class="schemes nf-col"><legend>Your scheme</legend>
        ${SCHEME_KEYS.map((k) => `<label class="schemepick"><input type="radio" name="scheme" value="${k}" ${(st.scheme ?? 'balanced') === k ? 'checked' : ''}><b>${esc(SCHEMES[k].name)}</b><span class="small muted">${esc(SCHEMES[k].blurb)}</span></label>`).join('')}
      </fieldset>
    </div>
    <div class="nf-foot">
      <label>Save to${slotSelect('f-slot', slots, target)}</label>
      <button class="btn primary mm-cta" type="submit">Start the draft</button>
      <button class="btn" type="button" data-act="onlineleague">Online league</button>
    </div>
  </form>`;
}
function slotSelect(id, slots, target) {
  return `<select id="${id}">${slots.map(({ n, save }) => {
    const me = save?.league.teams.find((t) => t.user);
    return `<option value="${n}" ${n === target ? 'selected' : ''}>Slot ${n} · ${me ? `replaces ${esc(me.name)}, season ${save.league.season ?? 1}` : 'empty'}</option>`;
  }).join('')}</select>`;
}

// The lineup on the field (pointing at one puts it in the spotlight) and the franchise's own
// identity and roster screens.
function teamHtml(slots) {
  const n = pickSlot(slots), save = slots.find((x) => x.n === n)?.save, me = save && meOf(save.league), L = save?.league;
  const roster = LINEUP.map((a) => {
    const p = P(a.id);
    return `<button class="tb-mon ${S.menuTeamPick === a.id ? 'on' : ''}" data-act="menufeature" data-id="${a.id}" style="--tc:${TYPE_COLORS[p.types[0]]}">
      <span class="tb-n">${esc(p.name)}</span><span class="tb-r">${a.role} <b>${p.ovr[a.role]}</b></span><span class="tb-t">${p.types.join(' / ')}</span></button>`;
  }).join('');
  const go = (to, title, text, ok = true) => `<button class="tb-tile" ${save ? `data-act="slotgo" data-slot="${n}"` : 'data-act="go"'} data-to="${to}" ${ok ? '' : 'disabled'}><b>${title}</b><span>${text}</span></button>`;
  return `<p class="small muted">Every rating comes from real base stats: Speed makes receivers, Defense and HP make linemen, Sp. Atk makes quarterbacks. Type matchups decide the trenches.</p>
    <div class="tb-roster" role="group" aria-label="The lineup on the field">${roster}</div>
    <h3 class="mp-sub">${me ? `${esc(me.name)} · slot ${n}` : 'Your next franchise'}</h3>
    <div class="tb-tiles">
      ${go('kit', 'Franchise kit', me ? 'Colors, end-zone wordmark, home stadium, kickoff time and crowd chant.' : 'Colors, wordmark, stadium and chant for quick games and your next league.')}
      ${me ? go('depth', 'Depth chart', 'Set your starters and the bench.', L.phase !== 'draft') : ''}
      ${me ? go('trades', 'Trade desk', 'Offer Pokémon and picks to the other general managers.', L.schedule.length > 0) : ''}
      ${me ? go('records', 'Records', 'League and franchise record book.') : ''}
    </div>`;
}

function settingsHtml(slots) {
  const target = firstFreeSlot() ?? S.slot;
  const q = S.quality ?? 'auto';
  return `<h3 class="mp-sub">Difficulty</h3>${difficultyHtml()}
    <h3 class="mp-sub">Graphics</h3>
    <div class="gm-row seg" role="radiogroup" aria-label="Graphics quality">${[['auto', 'Auto'], ['high', 'High'], ['low', 'Low']].map(([k, l]) => `<button class="btn tiny ${q === k ? 'on' : ''}" data-act="quality" data-q="${k}" role="radio" aria-checked="${q === k}">${l}</button>`).join('')}</div>
    <h3 class="mp-sub">Sound</h3>${soundPanelHtml()}
    <h3 class="mp-sub">Save files</h3>
    <details class="importbox" ${S.importMsg ? 'open' : ''}><summary>Import a save or a shared league</summary>
      <p class="small muted">Load a league from an exported file, or paste its contents, a league code or a share link, into the slot you pick.</p>
      <label>Load into${slotSelect('i-slot', slots, target)}</label>
      <input type="file" id="import-file" accept="application/json,.json">
      <textarea id="import-text" rows="3" placeholder="Paste save JSON, a league code or a link"></textarea>
      <button class="btn" data-act="importpaste">Load what I pasted</button>
      ${S.importMsg ? `<p class="small bad">${esc(S.importMsg)}</p>` : ''}
    </details>
    <p class="small muted">Export or delete a franchise from its ⋯ menu under Continue franchise.</p>`;
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

// ---------- after a render: the scene, the card art, focus ----------
let wantFocus = null;
export function afterHomeRender() {
  const host = document.getElementById('menu3d');
  if (!host) { peekMenu()?.unmount(); return; }
  const m = menuStage();
  document.getElementById('mm')?.classList.toggle('no3d', !m);
  if (m) {
    m.setQuality(S.quality ?? 'auto');
    m.mount(host);
    m.setPanel(S.menuPanel);
    m.setFeature(featureOf());
    m.setBoardInfo(boardInfo());
  }
  for (const c of document.querySelectorAll('canvas[data-art-slot]')) {
    const save = savedSlots().find((x) => x.n === Number(c.dataset.artSlot))?.save;
    if (save) paintFranchiseArt(c, meOf(save.league));
  }
  if (wantFocus) {
    const el = document.querySelector(wantFocus);
    wantFocus = null;
    el?.focus({ preventScroll: true });
  }
}
// The franchise on the video board: the save the menu is showing.
function boardInfo() {
  const slots = savedSlots(), save = slots.find((x) => x.n === pickSlot(slots))?.save;
  if (!save) return null;
  const L = save.league, me = meOf(L), rec = LG.teamSeason(L, me.id);
  return { name: me.name, color: me.color, ink: inkOn(me.color), big: rec.gp ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}` : `SEASON ${L.season ?? 1}`, small: `SEASON ${L.season ?? 1}  ·  ${phaseLabel(L).toUpperCase()}` };
}

// Hovering or focusing a menu item selects it: it lights up, its line shows, a tick plays and
// the camera finds its Pokémon. No re-render, so the pointer never loses its place.
function select(k) {
  if (!k || S.menuSel === k) return;
  S.menuSel = k;
  for (const b of document.querySelectorAll('.mm-item')) b.classList.toggle('sel', b.dataset.sel === k);
  if (soundOn()) ui('tab');
  if (S.menuPanel !== 'team') {
    peekMenu()?.setFeature(featureOf());
    const plate = document.getElementById('mm-plate');
    if (plate) plate.innerHTML = plateHtml(featureOf());
  }
}
function featurePick(id) {
  if (S.menuTeamPick === id) return;
  S.menuTeamPick = id;
  for (const b of document.querySelectorAll('.tb-mon')) b.classList.toggle('on', Number(b.dataset.id) === id);
  if (soundOn()) ui('tab');
  peekMenu()?.setFeature(id);
  const plate = document.getElementById('mm-plate');
  if (plate) plate.innerHTML = plateHtml(id);
}

// Menu clicks (app.js routes these here). Returns whether it was one.
export function homeAct(act, el) {
  switch (act) {
    case 'menupanel': {
      const k = el.dataset.panel;
      if (k === 'continue' && !savedSlots().some((x) => x.save)) { openPanel('new'); return true; }
      if (el.dataset.slot) S.menuNewSlot = Number(el.dataset.slot);
      if (S.menuPanel === k && el.classList.contains('mm-item')) { closePanel(); return true; }
      openPanel(k);
      return true;
    }
    case 'menuclose': closePanel(); return true;
    case 'menuslot': S.menuSlot = Number(el.dataset.slot); S.menuMore = null; S.confirmDelete = null; wantFocus = `.fr-tab[data-slot="${S.menuSlot}"]`; render(); return true;
    case 'menumore': S.menuMore = S.menuMore === Number(el.dataset.slot) ? null : Number(el.dataset.slot); S.confirmDelete = null; wantFocus = S.menuMore ? '.fr-menu .fr-mi' : '.fr-morebtn'; render(); return true;
    case 'menufeature': featurePick(Number(el.dataset.id)); peekMenu()?.react(Number(el.dataset.id)); return true;
    default: return false;
  }
}
function openPanel(k) {
  S.menuPanel = k; S.menuSel = k; S.menuMore = null; S.confirmDelete = null;
  if (k !== 'new') S.menuNewSlot = null;
  if (soundOn()) { ui('click'); crowdReact('cheer', 0.35); }
  wantFocus = { continue: '.fr-go, .fr-empty .btn', quick: '.qp-resume, .qp-tile', new: '#f-name', team: '.tb-mon', settings: '.mm-panel .diffs .btn.on' }[k];
  render();
}
function closePanel() {
  const k = S.menuPanel;
  S.menuPanel = null; S.menuMore = null; S.confirmDelete = null; S.importMsg = ''; S.netMsg = '';
  wantFocus = k ? `.mm-item[data-sel="${k}"]` : null;
  render();
}

// A cinematic cut into the game: the camera pushes in on the field and the screen flashes to
// white, then the game takes over. Straight in with reduced motion.
let launching = false;
export function homeLaunch(fn) {
  const root = document.getElementById('mm');
  if (!root || reduceMotion) { fn(); return; }
  if (launching) return;
  launching = true;
  root.classList.add('launch');
  peekMenu()?.launch();
  if (soundOn()) crowdReact('roar', 0.6);
  setTimeout(() => { launching = false; fn(); }, 480);
}

// Keys on the home screen: up and down move through the menu, right steps into the open panel,
// left and Escape step back out. Returns whether it used the key.
export function homeKey(e) {
  if (S.screen !== 'home' || !document.getElementById('mm') || e.ctrlKey || e.metaKey || e.altKey) return false;
  const typing = e.target.closest?.('input, select, textarea');
  const code = e.code;
  const items = [...document.querySelectorAll('.mm-item')];
  const inMenu = e.target.closest?.('.mm-nav');
  const inPanel = e.target.closest?.('.mm-panel');
  if (code === 'Escape') {
    if (S.menuMore) { S.menuMore = null; S.confirmDelete = null; wantFocus = '.fr-morebtn'; render(); return true; }
    if (S.menuPanel) { e.preventDefault(); closePanel(); return true; }
    return false;
  }
  if (typing) return false;
  if ((code === 'ArrowDown' || code === 'ArrowUp') && (inMenu || !inPanel)) {
    e.preventDefault();
    const cur = Math.max(0, items.findIndex((b) => b.dataset.sel === S.menuSel));
    const next = items[(cur + (code === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next.focus();
    return true;
  }
  if (code === 'ArrowRight' && inMenu) {
    e.preventDefault();
    if (!S.menuPanel || S.menuPanel !== S.menuSel) { openPanel(S.menuSel); return true; }
    document.querySelector('.mm-panel button, .mm-panel input')?.focus();
    return true;
  }
  if (inPanel && (code === 'ArrowLeft' || code === 'ArrowRight') && e.target.classList?.contains('fr-tab')) {
    e.preventDefault();
    const tabs = [...document.querySelectorAll('.fr-tab')], i = tabs.indexOf(e.target);
    tabs[(i + (code === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
    return true;
  }
  if (inPanel && (code === 'ArrowUp' || code === 'ArrowDown') && !e.target.closest('.sndwrap, .snd')) {
    // Through the panel's buttons in order.
    const all = [...document.querySelectorAll('.mm-panel button:not([disabled]), .mm-panel summary')].filter((b) => b.offsetParent !== null);
    const i = all.indexOf(e.target);
    if (i < 0) return false;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, i + (code === 'ArrowDown' ? 1 : -1)))].focus();
    return true;
  }
  if (code === 'ArrowLeft' && inPanel) {
    e.preventDefault();
    document.querySelector(`.mm-item[data-sel="${S.menuPanel}"]`)?.focus();
    return true;
  }
  return false;
}

// Hover and focus select, once for the page.
export function initHome() {
  const pick = (e) => {
    if (S.screen !== 'home') return;
    const item = e.target.closest?.('.mm-item');
    if (item) { select(item.dataset.sel); return; }
    const mon = e.target.closest?.('.tb-mon');
    if (mon) featurePick(Number(mon.dataset.id));
  };
  document.addEventListener('pointerover', pick);
  document.addEventListener('focusin', pick);
  // A click outside the save menu closes it.
  document.addEventListener('pointerdown', (e) => {
    if (S.screen !== 'home' || !S.menuMore || e.target.closest?.('.fr-morebox')) return;
    S.menuMore = null; S.confirmDelete = null;
    document.querySelector('.fr-menu')?.remove();
    document.querySelector('.fr-morebtn')?.setAttribute('aria-expanded', 'false');
  });
}
