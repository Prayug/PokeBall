// Coaching schemes: the identity a team plays with. A scheme picks which positions its drafter
// reaches for, leans the AI play caller, and gives the players a small edge on the plays it is
// built around (with a small cost on the ones it isn't). The user picks one at league start;
// the AI franchises keep their drafting styles (Speed Kills, Trench Builder...), which shape
// their play calling the way they always have.
import { OFF_PLAYS, DEF_PLAYS } from './engine.js';

// draft: bonus to a pick's score by position group. pass: shift in the AI's pass rate.
// off/def: attribute changes for the team's players, keyed by the kind of play being run.
export const SCHEMES = {
  balanced: {
    name: 'Balanced', short: 'No lean',
    blurb: 'Best player available in the draft and a call for every down. No edges, no costs.',
    draft: {}, pass: 0,
  },
  airraid: {
    name: 'Air Raid', short: 'Pass first',
    blurb: 'Spread it out and throw. Passers and receivers play up on pass plays, the line gets less push on runs, and the draft reaches for quarterbacks and receivers.',
    draft: { QB: 5, WR: 4, TE: 1.5 }, pass: 0.12,
    off: { pass: { acc: 4, hnd: 3, spd: 1 }, run: { blk: -2 } },
    plays: (call) => OFF_PLAYS[call]?.kind === 'pass',
  },
  ground: {
    name: 'Ground and Pound', short: 'Run first',
    blurb: 'Lean on the run game. The line and the backs play up on runs, the passing game is a little rustier, and the draft reaches for linemen and backs.',
    draft: { OL: 3.5, RB: 4, TE: 2 }, pass: -0.12,
    off: { run: { blk: 4, str: 3 }, pass: { acc: -1.5 } },
    plays: (call) => OFF_PLAYS[call]?.kind === 'run',
  },
  d46: {
    name: '46 Defense', short: 'Pressure',
    blurb: 'Eight in the box and come after the quarterback. Rushers and linebackers play up on blitzes, coverage is a step slower otherwise, and the draft reaches for the front seven.',
    draft: { DL: 3.5, LB: 4, S: 1.5 }, pass: 0,
    def: { blitz: { rush: 4, spd: 2, tkl: 2 }, cover: { cov: -2 } },
    plays: (call) => isBlitz(call),
  },
};
export const SCHEME_KEYS = Object.keys(SCHEMES);
export const schemeOf = (coach) => SCHEMES[coach] ?? null;

const BLITZ_SIMS = new Set(['pass_blitz', 'run_blitz']);
export function isBlitz(defCall) {
  const p = DEF_PLAYS[defCall];
  return !!p && (BLITZ_SIMS.has(defCall) || BLITZ_SIMS.has(p.sim) || defCall === 'fire_zone');
}

// The attribute change a scheme gives one of this team's players on the play being run
// (g.call, set when the play starts).
export function schemeBonus(g, ti, attr) {
  const S = SCHEMES[g.teams[ti].coach];
  const c = g.call;
  if (!S || !c) return 0;
  if (c.o === ti && S.off) {
    const kind = OFF_PLAYS[c.off]?.kind;
    return S.off[kind]?.[attr] ?? 0;
  }
  if (c.o !== ti && S.def && DEF_PLAYS[c.def]) return S.def[isBlitz(c.def) ? 'blitz' : 'cover']?.[attr] ?? 0;
  return 0;
}

// A play the user's scheme is built around (the call sheet marks these).
export function schemePlay(coach, call) { return !!SCHEMES[coach]?.plays?.(call); }

// Extra draft score for a scheme team taking a Pokémon at a slot of this group.
export function schemeDraft(coach, group) { return SCHEMES[coach]?.draft?.[group] ?? 0; }

// How a team's coach reads in tables: the user's scheme, or the AI franchise's style.
export function coachLabel(t) {
  if (!t.user) return t.coachName;
  return t.coach !== 'balanced' && SCHEMES[t.coach] ? `You, ${SCHEMES[t.coach].name}` : 'You';
}
