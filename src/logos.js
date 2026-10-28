// Team marks drawn as SVG from each club's colors. CPU clubs use a mark from the town
// the name already belongs to. A franchise the player named gets a shield with its abbreviation.
import { kitOf } from './kits.js';

const hex = (c, d) => (/^#[0-9a-fA-F]{6}$/.test(c ?? '') ? c : d);
const safe = (s) => String(s ?? '').replace(/[<>&"']/g, '').slice(0, 3);

// name -> mark. Order matches the clubs the league already owns.
const MARK = {
  'Cerulean Surf': 'wave',
  'Pewter Boulders': 'rock',
  'Saffron Seers': 'eye',
  'Vermilion Volts': 'bolt',
  'Celadon Bloom': 'leaf',
  'Fuchsia Shadows': 'shuriken',
  'Cinnabar Blaze': 'flame',
  'Lavender Haunts': 'ghost',
  'Viridian Rangers': 'pine',
  'Goldenrod Gears': 'gear',
  'Ecruteak Embers': 'tower',
  'Olivine Tides': 'tide',
  'Mahogany Frost': 'flake',
  'Blackthorn Wyverns': 'wing',
  'Azalea Swarm': 'bug',
};

function svg(body) {
  return `<svg class="tlogo" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}
function plate(fill) {
  return `<rect width="32" height="32" rx="7" fill="${fill}"/>`;
}

const DRAW = {
  wave: (f, a) => svg(`${plate(f)}<path d="M3 20c3.2-4 6.2-4 9.2 0s6 4 9.2 0 6-4 9.2 0" fill="none" stroke="${a}" stroke-width="2.4" stroke-linecap="round"/><circle cx="23" cy="10" r="3.2" fill="${a}"/>`),
  rock: (f, a) => svg(`${plate(f)}<path d="M8 24l3-8 4 3 3-9 6 5 1 9z" fill="${a}"/>`),
  eye: (f, a) => svg(`${plate(f)}<ellipse cx="16" cy="16" rx="11" ry="7" fill="${a}"/><circle cx="16" cy="16" r="3.4" fill="${f}"/>`),
  bolt: (f, a) => svg(`${plate(f)}<path d="M18 4l-8 13h6l-2 11 10-14h-6z" fill="${a}"/>`),
  leaf: (f, a) => svg(`${plate(f)}<path d="M8 22c8-16 16-12 16-12s2 10-6 16c-6 4-10 2-10-4z" fill="${a}"/>`),
  shuriken: (f, a) => svg(`${plate(f)}<path d="M16 3l2.2 8.2L26 9l-4.6 6.8L29 20l-8.4-1.2L18 28l-2.4-8.6L7 22l5.2-5.6L6 10l8.2 1.4z" fill="${a}"/>`),
  flame: (f, a) => svg(`${plate(f)}<path d="M16 4c2 6-2 8-2 12a6 6 0 1 0 10-4c0 4-2 6-2 6s6-2 6-10c-4 2-6 2-8 0-1-2-2-4-4-4z" fill="${a}"/>`),
  ghost: (f, a) => svg(`${plate(f)}<path d="M9 15a7 7 0 0 1 14 0v10l-2.4-2.2L16 26l-4.6-3.2L9 25z" fill="${a}"/><circle cx="13" cy="15" r="1.4" fill="${f}"/><circle cx="19" cy="15" r="1.4" fill="${f}"/>`),
  pine: (f, a) => svg(`${plate(f)}<path d="M16 4l7 9h-3l5 7H7l5-7H9z" fill="${a}"/><rect x="14.2" y="20" width="3.6" height="6" fill="${a}"/>`),
  gear: (f, a) => svg(`${plate(f)}<path d="M16 7l1.6 2.6 3-.6.8 2.8 2.6 1.4-1 2.8 1 2.8-2.6 1.4-.8 2.8-3-.6L16 25l-1.6-2.6-3 .6-.8-2.8-2.6-1.4 1-2.8-1-2.8 2.6-1.4.8-2.8 3 .6z" fill="${a}"/><circle cx="16" cy="16" r="3.2" fill="${f}"/>`),
  tower: (f, a) => svg(`${plate(f)}<path d="M12 26V12l4-6 4 6v14z" fill="${a}"/><rect x="14.4" y="16" width="3.2" height="4" fill="${f}"/>`),
  tide: (f, a) => svg(`${plate(f)}<path d="M4 14h6l2-6 2 6h14v3H4z" fill="${a}"/><path d="M4 22c3-3 5-3 8 0s5 3 8 0 5-3 8 0" fill="none" stroke="${a}" stroke-width="2" stroke-linecap="round"/>`),
  flake: (f, a) => svg(`${plate(f)}<path d="M16 4v24M6 10l20 12M6 22L26 10" stroke="${a}" stroke-width="2.2" stroke-linecap="round"/>`),
  wing: (f, a) => svg(`${plate(f)}<path d="M6 18c6-8 12-8 16-4 2 2 4 2 6 0-2 6-8 10-16 10-2 0-4-2-6-6z" fill="${a}"/>`),
  bug: (f, a) => svg(`${plate(f)}<ellipse cx="16" cy="18" rx="6" ry="7" fill="${a}"/><circle cx="16" cy="10" r="3.2" fill="${a}"/><path d="M10 8l-4-3M22 8l4-3M8 18H4M28 18h-4" stroke="${a}" stroke-width="1.8" stroke-linecap="round"/>`),
};

function club(t, fill, accent) {
  return svg(`${plate(fill)}<path d="M16 5l8 3v8c0 6-4.2 9.2-8 11-3.8-1.8-8-5-8-11V8z" fill="${accent}"/><text x="16" y="19" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-size="8" font-weight="700" fill="${fill}">${safe(t.abbr)}</text>`);
}

// The mark for a team: a lore icon when the name is one the league owns, otherwise a shield.
export function teamLogo(t = {}) {
  const fill = hex(t.color, '#c8102e');
  const accent = hex(kitOf(t).color2, '#ffffff');
  const draw = DRAW[MARK[t.name]];
  return draw ? draw(fill, accent) : club(t, fill, accent);
}
