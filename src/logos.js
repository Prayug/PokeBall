// CPU emblems are the identity itself: a ghost, a leaf, a wave, a mountain. No plate and no initials.
// A franchise the player named gets a shield, because that club has no town.
import { inkOn, luma } from './kits.js';
import { clubOf } from './league.js';

const hex = (c, d) => (/^#[0-9a-fA-F]{6}$/.test(c ?? '') ? c : d);
const safe = (s) => String(s ?? '').replace(/[<>&"']/g, '').slice(0, 3);

function svg(body) {
  return `<svg class="tlogo" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
}
// A near-black jersey color disappears at badge size, so the shape takes the lighter identity color.
function pair(color, accent) {
  const fill = hex(color, '#c8102e');
  const second = hex(accent, '#ffffff');
  if (luma(fill) < 0.12) return [second, fill];
  return [fill, second];
}

const DRAW = {
  wave: (b, d) => svg(`<path fill="${b}" d="M2 38c8-14 14-14 22 0s14 14 22 0 14-14 16 0v20H2z"/><path fill="none" stroke="${d}" stroke-width="6" stroke-linecap="round" d="M4 28c7-10 13-10 20 0s13 10 20 0 13-10 16 0"/><circle cx="48" cy="14" r="6" fill="${d}"/>`),
  mountain: (b, d) => svg(`<path fill="${b}" d="M2 60L22 16l12 20L46 6l16 54z"/><path fill="${d}" d="M16 28l6-12 6 12zM40 18l6-12 6 12z"/>`),
  eye: (b, d) => svg(`<path fill="${b}" d="M2 32C14 12 50 12 62 32 50 52 14 52 2 32z"/><circle cx="32" cy="32" r="11" fill="${d}"/><circle cx="32" cy="32" r="4.5" fill="#140C1C"/>`),
  bolt: (b, d) => svg(`<path fill="${b}" stroke="${d}" stroke-width="3" stroke-linejoin="round" d="M38 2L14 36h14L22 62l30-36H36z"/>`),
  leaf: (b, d) => svg(`<path fill="${b}" d="M34 4C14 18 6 36 12 50c8 6 16 2 18 10 2-8 12-4 20-10 8-16-2-32-16-46z"/><path fill="none" stroke="${d}" stroke-width="4" stroke-linecap="round" d="M30 16c2 14 4 28 8 40M26 30c-8 4-14 10-16 16M38 36c8 2 14 8 16 16"/>`),
  shuriken: (b, d) => svg(`<path fill="${b}" stroke="${d}" stroke-width="2" stroke-linejoin="round" d="M32 2l5 18 18-8-10 16 18 8-18 4 2 20-15-14-15 14 2-20-18-4 18-8L9 12l18 8z"/>`),
  flame: (b, d) => svg(`<path fill="${b}" d="M34 4c6 12-8 16-4 30 3 10 12 14 12 24 0 8-8 12-16 12s-16-6-14-16c2-12 8-16 8-26 0-6-4-10-2-18 4 6 10 8 12 6 0-6 2-10 4-12z"/><path fill="${d}" d="M34 38c5 6 3 12-2 16 6-1 9-8 6-14-1 1-4 0-4-2z"/>`),
  ghost: (b, d) => svg(`<path fill="${b}" d="M32 4C16 4 8 18 8 32v26l7-8 6 8 7-10 4 10 7-8 6 8 5-6V32C50 18 46 4 32 4z"/><circle cx="24" cy="30" r="4" fill="${d}"/><circle cx="40" cy="30" r="4" fill="${d}"/><ellipse cx="32" cy="42" rx="4" ry="6" fill="${d}"/>`),
  pine: (b, d) => svg(`<path fill="${b}" d="M32 2l16 22h-8l14 20H10l14-20h-8z"/><path fill="${d}" d="M28 44h8v16h-8z"/>`),
  gear: (b, d) => svg(`<path fill="${b}" d="M36 4h-8l-1.4 7.2a18 18 0 0 0-4.6 1.8L15.2 8.6 9.6 14.2l4.4 6.8a18 18 0 0 0-1.8 4.6L4 27v8l7.2 1.4a18 18 0 0 0 1.8 4.6l-4.4 6.8 5.6 5.6 6.8-4.4a18 18 0 0 0 4.6 1.8L28 60h8l1.4-7.2a18 18 0 0 0 4.6-1.8l6.8 4.4 5.6-5.6-4.4-6.8a18 18 0 0 0 1.8-4.6L60 35v-8l-7.2-1.4a18 18 0 0 0-1.8-4.6l4.4-6.8-5.6-5.6-6.8 4.4a18 18 0 0 0-4.6-1.8z"/><circle cx="32" cy="32" r="8" fill="${d}"/>`),
  tower: (b, d) => svg(`<path fill="${b}" d="M32 2l14 16h-6v36H24V18h-6z"/><path fill="${d}" d="M29 28h6v10h-6zM30 6h4v6h-4z"/>`),
  beacon: (b, d) => svg(`<path fill="${d}" d="M6 20L32 2l26 18H44L32 12 20 20z"/><path fill="${b}" d="M26 20h12l3 34H23z"/><path fill="${b}" d="M18 54h28v6H18z"/>`),
  flake: (b, d) => svg(`<path d="M32 4v56M8 16l48 32M8 48L56 16" fill="none" stroke="${luma(d) > luma(b) ? d : b}" stroke-width="8" stroke-linecap="round"/>`),
  wing: (b, d) => svg(`<path fill="${b}" stroke="${d}" stroke-width="3" stroke-linejoin="round" d="M4 40C16 16 36 10 60 16c-8 6-14 8-16 16 12-2 18 2 20 8-16 8-32 16-48 14-4-2-8-8-12-14z"/>`),
  bug: (b, d) => svg(`<ellipse cx="32" cy="40" rx="14" ry="16" fill="${b}"/><circle cx="32" cy="20" r="8" fill="${b}"/><path d="M24 16L12 6M40 16l12-10M16 40H4M48 40h12" fill="none" stroke="${b}" stroke-width="5" stroke-linecap="round"/><circle cx="29" cy="19" r="1.8" fill="${d}"/><circle cx="35" cy="19" r="1.8" fill="${d}"/>`),
};

function shield(t) {
  const fill = hex(t.color, '#c8102e');
  return svg(`<path fill="${fill}" d="M32 4l22 8v16c0 16-10 26-22 32C20 54 10 44 10 28V12z"/><text x="32" y="38" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-size="16" font-weight="700" fill="${inkOn(fill)}">${safe(t.abbr)}</text>`);
}

// The emblem for a team. CPU clubs draw their town's shape. A named franchise draws a shield.
export function teamLogo(t = {}) {
  const canon = clubOf(t);
  const draw = canon && DRAW[canon.mark];
  if (!draw) return shield(t);
  const [body, detail] = pair(canon.color, canon.accent);
  return draw(body, detail);
}
