// The booth and the stadium on the 3D field: the crew's calls (commentary.js) spoken and
// captioned (speech.js), and the crowd and the Pokémon reacting to the play as it happens
// (audio.js). live3d.js calls in at each change of the game flow, every frame of a live play
// and after each play. Only the real game is called: replays and the film room stay quiet.
import { S } from '../state.js';
import { esc } from '../ui.js';
import { afterLines, createBooth, fillerLine, liveLine, openLines, presnapLines, progressLine, tension } from '../commentary.js';
import { setBooth, stopTalking, talk, talking } from '../speech.js';
import { chant, cry, crowdReact, preloadCries, setCrowdMood, setTension, sfx, stinger } from '../audio.js';

const BT = { B: null, g: null, opened: false, presnapFor: null, seen: 0, lp: null, fillerT: 0, selAt: 0, lastTalk: 0, crowdAt: 0 };

// The settings from the menu (and saved prefs).
export function applyBoothPrefs() {
  setBooth({ on: S.booth !== false, voice: S.boothVoice !== false, captions: S.captions !== false, volume: S.vol?.booth ?? 0.9, onCaption: showCaption });
}

// A new game: a fresh crew memory, nothing left in the queue.
export function boothReset(g) {
  stopTalking();
  clearTimeout(BT.fillerT);
  Object.assign(BT, { B: g ? createBooth(g.seed ?? 1) : null, g, opened: false, presnapFor: null, seen: 0, lp: null, crowdAt: 0 });
  setCrowdMood(null); setTension(0);
  if (g) preloadCries(g.teams.flatMap((t) => Object.values(t.lineup)));
}
const homeOf = (g) => (g.neutral ? null : 0);
// Whether the stands are behind this side (the home team, at a home stadium).
const home = (g, ti) => homeOf(g) != null && ti === homeOf(g);

function send(lines) {
  if (!lines?.length) return;
  for (const ln of lines) if (talk(ln)) BT.lastTalk = performance.now();
}

// ---------- the flow ----------
export function boothFlow(st, g, lp) {
  if (!g || !BT.B || BT.g !== g) boothReset(g);
  if (!g) return;
  clearTimeout(BT.fillerT);
  if (st === 'PLAY_SELECTION') {
    setCrowdMood(null); setTension(0);
    if (!BT.opened && !g.final) { BT.opened = true; send(openLines(BT.B, g)); }
    // The call sheet is up: if the booth goes quiet a while, the analyst fills the gap.
    BT.fillerT = setTimeout(function fill() {
      if (S.screen !== 'game' || BT.g !== g || g.final) return;
      if (talking() || performance.now() - BT.lastTalk < 9000) { BT.fillerT = setTimeout(fill, 3000); return; }
      send([fillerLine(BT.B, g)]);
    }, 9000);
  }
  if ((st === 'FORMATION_SETUP' || st === 'PRE_SNAP') && lp && !lp.preview && BT.presnapFor !== lp) {
    BT.presnapFor = lp; BT.lp = lp; BT.seen = 0;
    send(presnapLines(BT.B, g, lp));
    // The home crowd: quiet for its own offense's cadence, loud for its defense (louder on
    // third and fourth down); either way about even at a neutral site.
    if (homeOf(g) == null || lp.kick) setCrowdMood(null);
    else setCrowdMood(lp.o === homeOf(g) ? 'hush' : 'loud');
  }
  if (st === 'SNAP' || st === 'LIVE_PLAY') setCrowdMood(null);
}

// ---------- during the play ----------
// Every frame of the live play: the new events called and reacted to, the run into the open
// field, and how tense the stadium sounds.
export function boothLive(lp) {
  if (!BT.B || !lp || lp.preview) return;
  if (BT.lp !== lp) { BT.lp = lp; BT.seen = 0; }
  const g = lp.g;
  while (BT.seen < lp.events.length) {
    const e = lp.events[BT.seen++];
    send([liveLine(BT.B, lp, e)]);
    react(g, lp, e);
  }
  send([progressLine(BT.B, lp)]);
  setTension(tension(lp));
}
// The stands and the Pokémon on each live event: the home crowd cheers what goes its team's way
// and groans or boos the rest; the visitors' corner answers.
function react(g, lp, e) {
  const who = e.who, now = performance.now();
  const good = (ti) => (home(g, ti) ? 'home' : homeOf(g) == null ? 'both' : 'away');
  const reactFor = (ti, big = 1) => {
    const side = good(ti);
    if (side === 'home') crowdReact(big >= 1 ? 'cheer' : 'applause', Math.min(1.2, 0.6 + big * 0.4));
    else if (side === 'away') { crowdReact('groan', 0.6 + big * 0.2); crowdReact('away', 0.8); }
    else crowdReact('cheer', 0.7);
  };
  switch (e.kind) {
    case 'catch': if (!lp.kick && lp.thrown && (lp.thrown.target?.x ?? 0) - (lp.off.QB?.x ?? 0) >= 15) reactFor(lp.o, 1); break;
    case 'int': reactFor(lp.d, 1.3); if (who) setTimeout(() => cry(who.id), 500); break;
    case 'incomplete': if (home(g, lp.o)) crowdReact('groan', 0.6); else if (home(g, lp.d)) crowdReact('applause', 0.7); break;
    case 'sack': reactFor(lp.d, 1.2); if (who && now - BT.crowdAt > 1500) { BT.crowdAt = now; setTimeout(() => cry(who.id, 0.9), 350); } break;
    case 'bighit': crowdReact('ooh', 1); if (who && Math.random() < 0.35) setTimeout(() => cry(who.id, 0.8), 300); break;
    case 'broken': if (/trucks|runs over/.test(e.text ?? '')) crowdReact('ooh', 0.8); else if (home(g, who?.ti)) crowdReact('cheer', 0.6); break;
    case 'ghost': crowdReact('ooh', 1); break;
    case 'flag':
      // The home crowd boos a flag on its team (and cheers one on the visitors).
      if (homeOf(g) != null && who) { if (home(g, who.ti)) crowdReact('boo', 1); else crowdReact('cheer', 0.5); }
      break;
    case 'power': if (who) { setTimeout(() => cry(who.id), 250); if (home(g, who.ti)) stinger('charge'); } break;
    case 'punt': case 'fgkick': case 'kickoff': sfx('kick'); break;
    case 'block': reactFor(lp.d, 1.3); break;
    case 'fg_good': reactFor(lp.o, 1); break;
    case 'fg_miss': if (home(g, lp.o)) crowdReact('groan', 1); else if (homeOf(g) != null) crowdReact('roar', 0.7); break;
    case 'fake': crowdReact('ooh', 1); break;
    case 'recover': reactFor(who?.ti ?? lp.o, 1.2); break;
    default: break;
  }
}

// ---------- after the whistle ----------
// The new entries in the game's record since the snap: the wrap of the play and the analyst,
// plus the crowd and the scorer's cry for the big ones. `lp` is the live play (null for a play
// resolved on the spot).
export function boothAfter(g, entry, before, lp = null) {
  if (!BT.B || !g || !before) return;
  setTension(0);
  const fresh = g.log.slice(before.logN ?? g.log.length - 1);
  for (const e of fresh) {
    send(afterLines(BT.B, g, e, before, e === entry ? lp : null));
    const td = (e.highlight === 'td' && !e.conversion) || (e.kind === 'score' && /TOUCHDOWN/.test(e.text ?? ''));
    if (td) {
      const ti = [0, 1].find((i) => g.score[i] - before.score[i] >= 6) ?? e.team ?? g.poss;
      if (home(g, ti)) { crowdReact('roar', 1.2); sfx('horn'); } else if (homeOf(g) == null) crowdReact('roar', 0.9); else { crowdReact('groan', 1); crowdReact('away', 1.2); }
      const sc = e.returner ?? e.scorer ?? e.carrier;
      if (sc != null) setTimeout(() => cry(sc, 1), 700);
    } else if (e.turnover === 'fumble' || (e.kind === 'turnover' && /FUMBLE/.test(e.text ?? ''))) {
      const ti = 1 - (e.team ?? before.poss);
      if (home(g, ti)) crowdReact('roar', 0.9); else if (homeOf(g) != null) crowdReact('groan', 1);
    } else if (e.highlight === 'fg' && e.kind === 'score' && !lp) {
      if (home(g, e.team)) crowdReact('cheer', 1);
    } else if (lp && e === entry && before && g.poss === before.poss && g.down === 1 && (e.yards ?? 0) > 0 && home(g, g.poss)) {
      // A home first down: the stands clap it along.
      crowdReact('applause', 0.8);
    }
    if (e.kind === 'quarter' && g.final && g.winner != null && home(g, g.winner)) crowdReact('roar', 1);
  }
}
// A review settled the last play.
export function boothReview(g, reversed) {
  if (!BT.B || !g) return;
  send([{ who: 'pbp', text: reversed ? 'After further review, the ruling on the field is overturned!' : 'After review, the call on the field stands.', pri: 2, hype: reversed ? 1 : 0 }]);
  if (homeOf(g) != null) crowdReact(reversed ? 'cheer' : 'boo', 0.6);
}
// The replay and the film room: the booth goes quiet.
export function boothHush() { stopTalking(); setTension(0); }
// The home crowd's chant, from the menu's "Get the crowd going" (or a test).
export function rallyCrowd(g) { if (g && !g.neutral) chant('defense', { times: 2, level: 1 }); }

// ---------- captions ----------
export function captionHtml() { return '<div class="booth-cap" id="booth-cap" aria-live="polite" hidden></div>'; }
let capHide = 0;
function showCaption(c) {
  const el = typeof document !== 'undefined' ? document.getElementById('booth-cap') : null;
  if (!el) return;
  clearTimeout(capHide);
  if (!c || S.screen !== 'game') { el.classList.remove('on'); capHide = setTimeout(() => { el.hidden = true; }, 250); return; }
  el.hidden = false;
  el.className = `booth-cap on ${c.who}${c.hype >= 2 ? ' hype' : ''}`;
  el.innerHTML = `<span class="bc-mic" aria-hidden="true"></span><b>${esc(c.name)}</b><span class="bc-say">${esc(c.text)}</span>`;
}
