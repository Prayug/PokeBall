// The broadcast package on the 3D field: the scorebug and the strip under it, the open, the
// stingers, the player lower-third, the drive chart, the booth line and the crowd's chants.
// live3d.js calls in at each change of the game flow and after each play; the words and
// numbers come from broadcast.js, the colors and venue from the teams' kits (kits.js).
import { clockText, downText, quarterText, spotText } from '../engine.js';
import * as LG from '../league.js';
import { S, reduceMotion } from '../state.js';
import { esc, sprite, typeChips } from '../ui.js';
import { inkOn, kitOf, venueOf } from '../kits.js';
import { boothBefore, driveLine, driveSegs, openCard, playerToWatch, stingerFor } from '../broadcast.js';
import { chant, crowd, setCrowdBase, stinger as playStinger } from '../audio.js';

// What the package has queued or shown in this game (reset with each new game).
export const BC = { open: false, blimp: false, drive: null, cardAt: null, chantAt: null, timers: {} };
export function resetBroadcast() {
  for (const k of Object.keys(BC.timers)) clearTimeout(BC.timers[k]);
  Object.assign(BC, { open: true, blimp: false, drive: null, cardAt: null, chantAt: null, aired: null, timers: {} });
  for (const id of ['bc-open', 'stinger', 'bc-third', 'bc-drive']) hide(id);
}

// Season records for the scorebug (league games only).
function records(g) {
  const L = S.league;
  if (!L || S.gameMeta?.quick || !L.results) return null;
  const st = LG.standings(L);
  return g.teams.map((t) => { const r = st.find((x) => x.id === t.id); return r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : ''; });
}
const teamVars = (t) => { const k = kitOf(t); return `--team:${t.color};--team2:${k.color2};--team-ink:${inkOn(t.color)}`; };

// ---------- the scorebug ----------
// Both teams (in their kit colors, with timeouts, possession and, in a league, their records),
// the quarter and clock, down and distance, the play clock and the ball's spot, plus a state
// tag (a flag, a timeout, the red zone) and a strip under it with the booth's line for the
// moment. Watch mode grows it from CSS (.game.spectate .bcast).
export function scorebugHtml(g, { pclock = 40, scored = [0, 0], live = false } = {}) {
  const [H, A] = g.teams;
  const rec = records(g);
  const now = performance.now();
  const tos = (ti) => {
    const n = g.timeouts?.[ti] ?? 0;
    return `<span class="tos ${ti === 0 ? 'home' : 'away'}" title="${esc(g.teams[ti].abbr)}: ${n} timeout${n === 1 ? '' : 's'} left">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  };
  const team = (t, i) => `<div class="bc-team ${g.poss === i && !g.final ? 'has' : ''} ${(scored[i] ?? 0) > now ? 'scored' : ''}" style="${teamVars(t)}">
    <span class="bc-abbr">${esc(t.abbr)}${rec?.[i] ? `<small class="bc-rec">${rec[i]}</small>` : ''}</span><span class="bc-score">${g.score[i]}</span>${g.final ? '' : tos(i)}${g.poss === i && !g.final ? '<span class="bc-poss" title="Has the ball" aria-label="Has the ball"></span>' : ''}</div>`;
  const last = [...g.log].reverse().find((e) => e.kind !== 'sub' && e.kind !== 'info');
  const tag = g.final ? '' : g.phase === 'penalty' || (last?.highlight === 'flag' && last.kind === 'penalty' && !live) ? '<div class="bc-cell bc-tag flag">Flag</div>'
    : last?.kind === 'timeout' && !live ? '<div class="bc-cell bc-tag to">Timeout</div>'
    : g.phase === 'play' && g.spot >= 80 ? '<div class="bc-cell bc-tag rz">Red zone</div>' : '';
  const info = g.final ? '<div class="bc-cell bc-down">FINAL</div>'
    : `<div class="bc-cell bc-q" title="Quarter">${g.quarter <= 4 ? `${['1st', '2nd', '3rd', '4th'][g.quarter - 1].toUpperCase()}<small>QTR</small>` : quarterText(g.quarter)}</div><div class="bc-cell bc-clock ${g.clockRunning ? 'run' : ''}" id="gclock" title="${g.clockRunning ? 'Clock running' : 'Clock stopped'}">${clockText(g.clock)}</div>
    <div class="bc-cell bc-down">${downText(g)}</div><div class="bc-cell bc-pc" id="pclock" title="Play clock">:${String(Math.ceil(pclock ?? 40)).padStart(2, '0')}</div>
    <div class="bc-cell bc-spot">${spotText(g)}</div>${tag}`;
  const strip = live || g.final ? '' : boothBefore(g);
  // Two halves that wrap onto two rows when the window is too narrow for one: the score, then
  // the situation.
  return `<div class="bcast" id="bcast"><div class="bc-row"><div class="bc-teams">${team(A, 1)}${team(H, 0)}</div><div class="bc-info">${info}</div></div>${strip ? `<div class="bc-strip">${esc(strip)}</div>` : ''}</div>`;
}

// ---------- the layers over the field ----------
export function layersHtml() {
  return `<div class="bc-open" id="bc-open" hidden></div><div class="stinger" id="stinger" hidden></div>
    <div class="bc-third" id="bc-third" hidden></div><div class="bc-drive" id="bc-drive" hidden></div>`;
}
function show(id, html, secs, cls = '') {
  const el = document.getElementById(id);
  if (!el) return;
  clearTimeout(BC.timers[id]);
  el.innerHTML = html;
  el.className = `${el.id === 'stinger' ? 'stinger' : el.id} ${cls}`;
  el.hidden = false;
  // Restart the entrance animation.
  void el.offsetWidth; el.classList.add('on');
  if (secs) BC.timers[id] = setTimeout(() => hide(id), secs * 1000);
}
function hide(id) {
  const el = document.getElementById(id);
  clearTimeout(BC.timers[id]);
  if (el) { el.classList.remove('on'); el.hidden = true; }
}

// The open: where, when, who, the weather; over an aerial shot of the stadium.
function showOpen(g, stage) {
  const c = openCard(g, records(g));
  const side = (t, i) => `<div class="op-team" style="${teamVars(t)}"><b>${esc(t.name)}</b>${c.records?.[i] ? `<small>${c.records[i]}</small>` : ''}</div>`;
  show('bc-open', `<p class="op-eyebrow">${c.playoff ? 'Playoffs · ' : ''}${esc(c.time)}${c.night ? ' · Under the lights' : ''}</p>
    <h2 class="op-venue">Live from ${esc(c.venue)}</h2>
    <div class="op-match">${side(c.away, 1)}<span class="op-at">at</span>${side(c.home, 0)}</div>
    <p class="op-meta">${esc(c.stadium)} · ${esc(c.weather)}</p>`, 5.5, c.night ? 'night' : '');
  stage?.establish(6);
  playStinger('open');
  const home = g.teams[0];
  if (!g.neutral) BC.timers.openChant = setTimeout(() => chant(kitOf(home).chant, { times: 2, level: 0.8 }), 2600);
}

// The stinger: a band in the team's two colors sweeps across with the word.
function showStinger(st, g) {
  const t = st.ti != null ? g.teams[st.ti] : null;
  const vars = t ? teamVars(t) : '--team:#16221b;--team2:#ffb547;--team-ink:#fff';
  show('stinger', `<div class="st-band" style="${vars}"><span class="st-word">${esc(st.text)}</span>${t ? `<span class="st-team">${esc(t.name)}</span>` : ''}</div>`, reduceMotion ? 1.4 : 1.9, st.kind);
}

// The player lower-third before a drive's first snap.
function showPlayer(info) {
  if (!info) return;
  show('bc-third', `<div class="tw-card" style="${teamVars(info.team)}"><span class="tw-spr">${sprite(info.id)}</span>
    <div class="tw-body"><p class="tw-eyebrow">${esc(info.team.abbr)} · Player to watch</p><b class="tw-name">${esc(info.name)}<span class="tw-slot">${esc(info.slot)}</span></b>
    <p class="tw-line"><span class="tw-types">${typeChips(info.types)}</span>${esc(info.line)}</p></div></div>`, 4.2);
}

// ---------- drive charts ----------
const SEG_COLORS = { run: '#7fdc93', pass: '#4fc3f7', flag: '#ffd23f', sack: '#ff8a7a', to: '#ff8a7a', kick: '#c9c9c9' };
// A drive drawn on a strip of field: the end zones in each team's color, and each snap an arrow
// a row below the last, colored by what it was.
export function driveChartSvg(g, d, { w = 300 } = {}) {
  const segs = driveSegs(g, d);
  const rows = Math.max(1, segs.length), rh = 9, top = 6, h = top * 2 + rows * rh;
  const X = (yd) => 6 + ((yd + 10) / 120) * (w - 12);
  const [H, A] = g.teams;
  const lines = [];
  for (let yd = 0; yd <= 100; yd += 10) lines.push(`<line x1="${X(yd)}" x2="${X(yd)}" y1="2" y2="${h - 2}" stroke="rgba(238,242,230,${yd === 50 ? 0.35 : 0.14})" stroke-width="1"/>`);
  const arrows = segs.map((s, i) => {
    const y = top + i * rh + rh / 2, x1 = X(s.from), x2 = X(s.to), col = SEG_COLORS[s.kind] ?? '#fff';
    const dir = Math.sign(x2 - x1) || (d.team === 0 ? 1 : -1);
    const dash = s.kind === 'kick' ? ' stroke-dasharray="3 2"' : '';
    if (Math.abs(x2 - x1) < 1.5) return `<circle cx="${x1}" cy="${y}" r="2.2" fill="${col}"/>`;
    return `<line x1="${x1}" y1="${y}" x2="${x2 - dir * 3}" y2="${y}" stroke="${col}" stroke-width="2.4"${dash}/><path d="M${x2} ${y} l${-dir * 5} -3.2 v6.4 z" fill="${col}"/>${s.td ? `<circle cx="${x2}" cy="${y}" r="4" fill="none" stroke="#ffd23f" stroke-width="1.5"/>` : ''}`;
  }).join('');
  return `<svg class="drivechart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Drive chart: ${segs.length} snaps">
    <rect x="${X(-10)}" y="0" width="${X(0) - X(-10)}" height="${h}" fill="${H.color}" opacity="0.7"/><rect x="${X(100)}" y="0" width="${X(110) - X(100)}" height="${h}" fill="${A.color}" opacity="0.7"/>
    <rect x="${X(0)}" y="0" width="${X(100) - X(0)}" height="${h}" fill="rgba(47,122,69,0.55)"/>${lines.join('')}${arrows}</svg>`;
}
function showDrive(g, d) {
  const t = g.teams[d.team];
  show('bc-drive', `<div class="dc-head" style="${teamVars(t)}"><b>${esc(t.abbr)} drive</b><span>${esc(d.result ?? '')}</span></div>
    ${driveChartSvg(g, d, { w: 300 })}<p class="dc-line">${esc(driveLine(g, d))}</p>
    <p class="dc-key">${[['run', 'Run'], ['pass', 'Pass'], ['flag', 'Penalty'], ['sack', 'Sack or turnover'], ['kick', 'Kick']].map(([k, l]) => `<span><i style="background:${SEG_COLORS[k]}"></i>${l}</span>`).join('')}</p>`, 7);
}

// ---------- moments ----------
// After a play has gone into the game: the stinger, the board, the music and the crowd.
// `before` is the game as it was at the snap (score, possession, log length, drives). Returns
// how long the stinger holds the middle of the screen, in ms (0 with none).
export function afterPlay(g, before, stage, { aired = null } = {}) {
  if (!g || !before) return 0;
  const fresh = g.log.slice(before.logN ?? g.log.length - 1);
  const rank = { td: 5, to: 4, fg: 3, final: 6, quarter: 2 };
  let best = null;
  for (const e of fresh) { const st = stingerFor(g, e, before); if (st && (!best || rank[st.kind] > rank[best.kind])) best = st; }
  const homeCrowd = g.neutral ? null : 0;
  // (After a review: what already aired for the play isn't shown twice.)
  if (best && best.kind === aired) best = null;
  BC.aired = best?.kind ?? aired;
  if (best) {
    showStinger(best, g);
    playStinger(best.kind);
    if (best.kind !== 'quarter') stage?.stadium.flashBoard(best.text, best.ti != null ? g.teams[best.ti] : null, performance.now());
    // Back from a break on the aerial shot.
    if (best.kind === 'quarter') BC.blimp = true;
    if (best.ti === homeCrowd && ['td', 'to', 'fg'].includes(best.kind)) BC.timers.chant = setTimeout(() => chant(kitOf(g.teams[0]).chant, { times: 2 }), 1700);
    if (best.kind === 'final') crowd(1);
  }
  // A game won in overtime ends on the score, not a quarter break: the final follows.
  if (g.final && best?.kind !== 'final' && aired !== 'final') BC.timers.final = setTimeout(() => { BC.aired = 'final'; showStinger({ kind: 'final', text: 'Final', ti: g.winner }, g); playStinger('final'); }, best ? 2100 : 0); else if (homeCrowd === g.poss && before.poss === g.poss && g.down === 1 && before.down >= 3 && Math.random() < 0.6) {
    // A home third-down conversion gets the chant too.
    BC.timers.chant = setTimeout(() => chant(kitOf(g.teams[0]).chant, { times: 1 }), 900);
  }
  if (g.drives.length > (before.drives ?? g.drives.length)) BC.drive = g.drives[g.drives.length - 1];
  return best ? 1900 : 0;
}

// A review has settled the last play. A reversed call rewinds the game and puts the play on the
// books again as it really happened, so the broadcast follows the corrected record: a drive
// chart queued (or up) for the old result comes down, and the corrected play gets its own
// stinger, board and chant (a touchdown given on review, a fumble ruled a takeaway). A score
// taken away needs no graphic of its own: the result card says it was reversed.
export function afterReview(g, before, stage, reversed) {
  if (!g || !before || !reversed) return;
  BC.drive = null;
  hide('bc-drive');
  clearTimeout(BC.timers.final);
  afterPlay(g, before, stage, { aired: BC.aired });
}

// Each change of the game flow: the open on the first call, the aerial back from a break, the
// drive chart after a drive, the player to watch before a drive's first snap, and the home
// crowd on third down.
export function onFlow(st, g, stage, lp = null) {
  if (!g || g.final) return;
  setCrowdBase(venueOf(g).roof ? 0.6 : venueOf(g).time === 'night' ? 1 : venueOf(g).time === 'dusk' ? 0.4 : 0);
  if (st === 'PLAY_SELECTION') {
    if (BC.open) { BC.open = false; BC.blimp = false; showOpen(g, stage); return; }
    if (BC.blimp) { BC.blimp = false; stage?.establish(4.5); }
    if (BC.drive) { showDrive(g, BC.drive); BC.drive = null; }
  }
  if (st === 'PRE_SNAP' && lp && !lp.kick && g.phase === 'play') {
    const d = g.drive;
    if (d && d.plays === 0 && BC.cardAt !== d.at) { BC.cardAt = d.at; showPlayer(playerToWatch(g)); }
    const key = `${g.playNo}`;
    if (!g.neutral && g.poss === 1 && g.down >= 3 && BC.chantAt !== key) { BC.chantAt = key; chant('defense', { times: 2, level: 0.9 }); }
  }
  if (st === 'LIVE_PLAY' || st === 'SNAP') { hide('bc-third'); hide('bc-open'); }
}
// A call was made: the open and the aerial give way to the game camera.
export function onCall(stage) { hide('bc-open'); hide('bc-drive'); stage?.endEstablish(); }
