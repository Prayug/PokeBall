// Team logos: an original vector crest for every franchise, drawn as inline SVG so it stays
// sharp from a 16px table badge to the midfield logo on the 3D turf. Each crest is built from
// the team's own colors (its primary, the kit's second color and a light accent), so a user's
// team keeps its colors whichever crest it wears, and an AI team's crest matches its kit.
//
// teamLogo(team) is the one entry point: it picks the crest (the kit's choice, else the team's
// own by name or abbreviation, else a monogram shield with the team's initial) and returns the
// SVG string. logoDataUrl() is the same crest as an image URL for canvas painting.
import { kitOf, shade, luma } from './kits.js';

const INK = '#0c1117';
// One outline weight for every crest, so they read as one family side by side.
const O = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;
const o = (w = 2.5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

// The crests. Each draws in a 100 x 100 box from a palette: p the primary, s the second (dark)
// color, l a light tint of the primary, a an accent that suits the crest, w off-white.
const CRESTS = {
  // Pewter Boulders: a faceted boulder titan, brow down, jaw set. Power and toughness.
  boulder: {
    name: 'Boulder titan', accent: '#d9d2c0',
    draw: ({ p, s, l, w }) => `
      <path d="M50 5 L81 15 L95 43 L88 77 L58 95 L22 90 L6 61 L15 22 Z" fill="${p}" ${O}/>
      <path d="M50 5 L15 22 L30 36 L50 26 Z" fill="${l}"/>
      <path d="M81 15 L95 43 L76 44 L68 28 Z" fill="${s}" opacity=".55"/>
      <path d="M88 77 L58 95 L62 74 L80 66 Z" fill="${s}" opacity=".7"/>
      <path d="M6 61 L22 90 L36 76 L20 60 Z" fill="${s}" opacity=".45"/>
      <path d="M20 39 L50 49 L80 39 L80 47 L50 57 L20 47 Z" fill="${s}" ${o(2.5)}/>
      <path d="M27 52 L44 57 L42 63 L28 59 Z" fill="${w}" ${o(2)}/>
      <path d="M73 52 L56 57 L58 63 L72 59 Z" fill="${w}" ${o(2)}/>
      <path d="M34 74 L42 70 L50 74 L58 70 L66 74" fill="none" ${o(3)}/>
      <path d="M50 26 L50 34 M68 28 L60 36" fill="none" ${o(2)} opacity=".6"/>`,
  },
  // Fuchsia Shadows: a pinwheel shuriken around a masked ninja's eyes. Stealth and speed.
  shuriken: {
    name: 'Shadow shuriken', accent: '#f4c8e6',
    draw: ({ p, s, l, w }) => `
      <path d="M56 3 L63 37 L97 56 L62 63 L44 97 L37 62 L3 44 L38 37 Z" fill="${p}" ${O}/>
      <path d="M56 3 L63 37 L50 50 Z M97 56 L62 63 L50 50 Z M44 97 L37 62 L50 50 Z M3 44 L38 37 L50 50 Z" fill="${l}" opacity=".55"/>
      <circle cx="50" cy="50" r="20" fill="${s}" ${O}/>
      <path d="M30 45 Q50 39 70 45 L70 55 Q50 50 30 55 Z" fill="${INK}"/>
      <path d="M36 50 L47 47 L45 52 Z" fill="${w}"/>
      <path d="M64 50 L53 47 L55 52 Z" fill="${w}"/>
      <path d="M69 46 L82 40 L76 48 Z" fill="${INK}"/>`,
  },
  // Celadon Bloom: a sharp botanical shield, three leaves fanned over a bud. Growth, precision.
  bloom: {
    name: 'Bloom crest', accent: '#e8f5c8',
    draw: ({ p, s, l, w }) => `
      <path d="M50 4 L90 16 L87 56 Q82 82 50 96 Q18 82 13 56 L10 16 Z" fill="${s}" ${O}/>
      <path d="M50 12 L82 22 L80 55 Q76 76 50 88 Q24 76 20 55 L18 22 Z" fill="none" stroke="${l}" stroke-width="2" opacity=".5"/>
      <path d="M48 80 Q20 72 19 40 Q42 50 48 80 Z" fill="${p}" ${o(3)}/>
      <path d="M52 80 Q80 72 81 40 Q58 50 52 80 Z" fill="${p}" ${o(3)}/>
      <path d="M50 18 Q68 44 50 80 Q32 44 50 18 Z" fill="${l}" ${o(3)}/>
      <path d="M50 28 L50 74 M50 44 L42 36 M50 44 L58 36 M50 58 L40 48 M50 58 L60 48" fill="none" stroke="${s}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M26 46 Q38 58 46 74 M74 46 Q62 58 54 74" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round" opacity=".7"/>`,
  },
  // Cerulean Surf: a breaking wave curled inside a roundel. Fluid and fast.
  wave: {
    name: 'Breaking wave', accent: '#dff1ff',
    draw: ({ p, s, l, w }) => `
      <circle cx="50" cy="50" r="45" fill="${s}" ${O}/>
      <path d="M8 66 Q20 34 52 26 Q86 20 92 50 Q80 38 66 44 Q52 52 62 64 Q70 70 84 64 Q76 84 50 92 Q24 92 10 76 Z" fill="${p}" ${o(3.5)}/>
      <path d="M52 26 Q78 22 88 42 Q74 34 62 40 Q56 30 52 26 Z" fill="${l}"/>
      <path d="M66 44 Q56 52 62 62 Q66 52 76 48 Z" fill="${w}" opacity=".9"/>
      <path d="M12 74 Q30 66 46 74 Q62 82 84 70" fill="none" stroke="${w}" stroke-width="3" stroke-linecap="round"/>
      <path d="M16 84 Q32 78 46 84 Q60 90 74 82" fill="none" stroke="${l}" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>
      <circle cx="80" cy="30" r="3" fill="${w}"/><circle cx="88" cy="38" r="2" fill="${w}"/><circle cx="72" cy="24" r="2" fill="${w}"/>`,
  },
  // Vermilion Volts: a lightning bolt flying on swept wings. Explosive.
  volt: {
    name: 'Winged bolt', accent: '#ffd23f',
    draw: ({ p, s, a, w }) => `
      <circle cx="50" cy="50" r="45" fill="${s}" ${O}/>
      <path d="M40 42 L4 26 L10 36 L3 41 L13 47 L7 53 L19 57 L12 63 L38 60 Z" fill="${p}" ${o(3)}/>
      <path d="M60 42 L96 26 L90 36 L97 41 L87 47 L93 53 L81 57 L88 63 L62 60 Z" fill="${p}" ${o(3)}/>
      <path d="M60 4 L28 54 L47 54 L36 96 L74 39 L54 39 L68 4 Z" fill="${a}" ${O}/>
      <path d="M60 4 L68 4 L54 39 L48 39 Z" fill="${w}" opacity=".55"/>`,
  },
  // Viridian Rangers: an evergreen guardian, angular tiers with watchful eyes. Endurance.
  ranger: {
    name: 'Forest guardian', accent: '#cfe9b4',
    draw: ({ p, s, l, w }) => `
      <path d="M50 4 L88 18 L88 52 Q86 80 50 96 Q14 80 12 52 L12 18 Z" fill="${s}" ${O}/>
      <path d="M50 12 L74 40 L62 40 L80 60 L64 60 L82 80 L18 80 L36 60 L20 60 L38 40 L26 40 Z" fill="${p}" ${o(3)}/>
      <path d="M50 12 L26 40 L38 40 L20 60 L36 60 L18 80 L50 80 Z" fill="${l}" opacity=".35"/>
      <path d="M36 50 L46 53 L45 57 L37 55 Z M64 50 L54 53 L55 57 L63 55 Z" fill="${w}" ${o(1.5)}/>
      <rect x="45" y="80" width="10" height="9" fill="${INK}"/>`,
  },
  // Pallet Starters: three swirling segments, leaf, flame and wave, around one center. Beginnings.
  starters: {
    name: 'Starter triad', accent: '#ffffff',
    draw: ({ p, w }) => {
      const seg = (fill, rot) => `<path transform="rotate(${rot} 50 50)" d="M50 50 Q38 30 50 6 A44 44 0 0 1 88.1 72 Q66 66 50 50 Z" fill="${fill}" ${o(3)}/>`;
      return `<circle cx="50" cy="50" r="47" fill="${p}" ${O}/>
        ${seg('#5cb85c', 0)}${seg('#f0782f', 120)}${seg('#3d8fe0', 240)}
        <circle cx="50" cy="50" r="13" fill="${w}" ${O}/><circle cx="50" cy="50" r="5" fill="${p}" ${o(2)}/>`;
    },
  },
  // Cinnabar Blaze: a volcano erupting a flame from its crater. Heat and aggression.
  volcano: {
    name: 'Volcano flame', accent: '#ffcf4a',
    draw: ({ p, s, a, w }) => `
      <circle cx="50" cy="50" r="45" fill="${s}" ${O}/>
      <path d="M50 4 Q66 20 60 34 Q68 30 66 18 Q80 34 68 50 L32 50 Q20 34 34 18 Q32 30 40 34 Q34 20 50 4 Z" fill="${p}" ${o(3)}/>
      <path d="M50 22 Q58 32 54 42 Q60 40 60 34 Q66 44 58 50 L42 50 Q36 42 42 34 Q44 40 47 41 Q44 30 50 22 Z" fill="${a}"/>
      <path d="M8 74 L34 44 L42 50 L58 50 L66 44 L92 74 Q86 88 70 94 L30 94 Q14 88 8 74 Z" fill="${INK}"/>
      <path d="M34 44 L42 50 L58 50 L66 44 L76 56 L56 58 L50 76 L44 58 L24 56 Z" fill="${p}" opacity=".85"/>
      <path d="M50 58 L47 70 L52 82" fill="none" stroke="${a}" stroke-width="2.5" stroke-linecap="round"/>`,
  },
  // Lavender Haunts: a ghost drifting out of a crescent moon. Eerie.
  ghost: {
    name: 'Ghost crescent', accent: '#efe6ff',
    draw: ({ p, s, l, w }) => `
      <circle cx="50" cy="50" r="45" fill="${s}" ${O}/>
      <path d="M58 9 A42 42 0 1 0 58 91 A34 34 0 1 1 58 9 Z" fill="${l}" ${o(3)}/>
      <path d="M50 36 Q50 20 66 20 Q82 20 82 36 L82 72 L76 66 L70 72 L64 66 L58 72 L52 66 L50 68 Z" fill="${w}" ${o(3.5)}/>
      <ellipse cx="61" cy="38" rx="3.6" ry="5.5" fill="${p}"/><ellipse cx="73" cy="38" rx="3.6" ry="5.5" fill="${p}"/>
      <path d="M60 52 Q67 58 74 52" fill="none" stroke="${p}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M88 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="${w}"/><circle cx="84" cy="84" r="2" fill="${w}"/>`,
  },
  // Saffron Seers: a third eye radiating light. Sees the play coming.
  seer: {
    name: 'Seer eye', accent: '#fff3c4',
    draw: ({ p, s, l, w }) => `
      <path d="M50 3 L91 27 L91 73 L50 97 L9 73 L9 27 Z" fill="${s}" ${O}/>
      <path d="M50 12 L50 22 M26 22 L32 30 M74 22 L68 30 M14 40 L22 44 M86 40 L78 44" fill="none" stroke="${p}" stroke-width="4" stroke-linecap="round"/>
      <path d="M12 56 Q50 18 88 56 Q50 92 12 56 Z" fill="${w}" ${o(3.5)}/>
      <circle cx="50" cy="56" r="17" fill="${p}" ${o(3)}/>
      <circle cx="50" cy="56" r="7.5" fill="${INK}"/><circle cx="45" cy="51" r="3" fill="${w}"/>`,
  },
  // Goldenrod Gears: a gear around a radio tower. Machine-built.
  gear: {
    name: 'Tower gear', accent: '#fff0b8',
    draw: ({ p, s, l, w }) => {
      const n = 10, R = 46, r = 38;
      let d = '';
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, step = (Math.PI * 2) / n;
        const pts = [[a0 - step * 0.18, R], [a0 + step * 0.18, R], [a0 + step * 0.3, r], [a0 + step * 0.7, r]];
        d += pts.map(([a, rad], k) => `${i === 0 && k === 0 ? 'M' : 'L'}${(50 + Math.sin(a) * rad).toFixed(1)} ${(50 - Math.cos(a) * rad).toFixed(1)}`).join(' ') + ' ';
      }
      return `<path d="${d}Z" fill="${p}" ${O}/>
        <circle cx="50" cy="50" r="27" fill="${s}" ${o(3)}/>
        <path d="M50 28 L60 72 L40 72 Z" fill="none" stroke="${w}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M44 50 L56 50 M42 60 L58 60" stroke="${w}" stroke-width="3"/>
        <circle cx="50" cy="28" r="4" fill="${l}" ${o(1.5)}/>
        <path d="M38 22 Q34 28 38 34 M62 22 Q66 28 62 34" fill="none" stroke="${l}" stroke-width="2.5" stroke-linecap="round"/>`;
    },
  },
  // Ecruteak Embers: a tiered pagoda under a rising ember. Old fire.
  pagoda: {
    name: 'Ember tower', accent: '#ffc35a',
    draw: ({ p, s, a, w }) => `
      <path d="M50 4 L90 16 L87 56 Q82 82 50 96 Q18 82 13 56 L10 16 Z" fill="${s}" ${O}/>
      <path d="M50 8 Q60 18 56 26 Q62 24 60 16 Q70 28 58 36 L42 36 Q32 28 40 18 Q40 24 44 26 Q42 16 50 8 Z" fill="${a}" ${o(2)}/>
      <path d="M22 46 Q36 44 50 36 Q64 44 78 46 L70 50 L30 50 Z" fill="${p}" ${o(2.5)}/>
      <rect x="35" y="50" width="30" height="8" fill="${w}" ${o(2)}/>
      <path d="M16 64 Q34 62 50 54 Q66 62 84 64 L74 68 L26 68 Z" fill="${p}" ${o(2.5)}/>
      <rect x="31" y="68" width="38" height="9" fill="${w}" ${o(2)}/>
      <path d="M12 84 Q32 82 50 74 Q68 82 88 84 L76 88 L24 88 Z" fill="${p}" ${o(2.5)}/>
      <rect x="46" y="70" width="8" height="7" fill="${INK}"/>`,
  },
  // Olivine Tides: a lighthouse beaming over the tide. Steady.
  lighthouse: {
    name: 'Lighthouse', accent: '#fff2a8',
    draw: ({ p, s, l, a, w }) => `
      <circle cx="50" cy="50" r="45" fill="${s}" ${O}/>
      <path d="M50 26 L8 14 L8 32 Z M50 26 L92 14 L92 32 Z" fill="${a}" opacity=".55"/>
      <path d="M41 32 L59 32 L64 80 L36 80 Z" fill="${w}" ${o(3)}/>
      <path d="M39.5 46 L60.5 46 L62 60 L38 60 Z" fill="${p}"/>
      <rect x="40" y="20" width="20" height="12" fill="${a}" ${o(2.5)}/>
      <path d="M38 20 L50 10 L62 20 Z" fill="${p}" ${o(2.5)}/>
      <path d="M8 76 Q22 68 36 76 Q50 84 64 76 Q78 68 92 76 L88 86 Q70 96 50 95 Q30 96 12 86 Z" fill="${p}" ${o(3)}/>
      <path d="M16 84 Q30 78 44 84 Q58 90 76 82" fill="none" stroke="${l}" stroke-width="2.5" stroke-linecap="round"/>`,
  },
  // Mahogany Frost: a six-armed ice crystal in a hexagon. Cold-blooded.
  frost: {
    name: 'Ice crystal', accent: '#eaf8ff',
    draw: ({ p, s, l, w }) => {
      const arm = (rot) => `<g transform="rotate(${rot} 50 50)"><path d="M50 50 L50 14 M50 26 L42 18 M50 26 L58 18 M50 38 L41 31 M50 38 L59 31" fill="none" stroke="${w}" stroke-width="5" stroke-linecap="round"/></g>`;
      return `<path d="M50 3 L91 27 L91 73 L50 97 L9 73 L9 27 Z" fill="${s}" ${O}/>
        <path d="M50 11 L84 31 L84 69 L50 89 L16 69 L16 31 Z" fill="${p}" opacity=".9"/>
        <path d="M50 11 L84 31 L50 50 Z M16 69 L50 89 L50 50 Z" fill="${l}" opacity=".35"/>
        ${[0, 60, 120, 180, 240, 300].map(arm).join('')}
        <path d="M50 42 L57 50 L50 58 L43 50 Z" fill="${s}" stroke="${w}" stroke-width="2.5"/>`;
    },
  },
  // Blackthorn Wyverns: an angular wyvern's head, horns swept back. Dragon pride.
  wyvern: {
    name: 'Wyvern head', accent: '#ffd36b',
    draw: ({ p, s, l, a, w }) => `
      <path d="M50 4 L90 16 L87 56 Q82 82 50 96 Q18 82 13 56 L10 16 Z" fill="${s}" ${O}/>
      <path d="M18 74 L28 46 L14 14 L40 30 L58 28 L86 37 L92 46 L72 50 L88 57 L85 64 L62 63 L50 82 L38 78 Z" fill="${p}" ${o(3)}/>
      <path d="M28 46 L14 14 L40 30 Z" fill="${l}" opacity=".7"/>
      <path d="M40 30 L58 28 L86 37 L92 46 L60 42 Z" fill="${l}" opacity=".3"/>
      <path d="M48 37 L62 39 L54 45 Z" fill="${a}" ${o(1.8)}/>
      <circle cx="83" cy="41" r="1.8" fill="${INK}"/>
      <path d="M72 50 L77 54 L80 51 M64 52 L68 57" fill="none" stroke="${w}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M28 46 L36 58 L38 78" fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`,
  },
  // Azalea Swarm: a striped bee on a honeycomb hex. Many hands.
  swarm: {
    name: 'Hive bee', accent: '#ffd84a',
    draw: ({ p, s, a, w }) => `
      <path d="M50 3 L91 27 L91 73 L50 97 L9 73 L9 27 Z" fill="${p}" ${O}/>
      <path d="M50 18 L64 26 L64 42 L50 50 L36 42 L36 26 Z M24 46 L36 53 L36 68 L24 75 L12 68 L12 53 Z M76 46 L88 53 L88 68 L76 75 L64 68 L64 53 Z" fill="${s}" opacity=".55"/>
      <ellipse cx="36" cy="44" rx="14" ry="9" transform="rotate(-30 36 44)" fill="${w}" ${o(2.5)} opacity=".95"/>
      <ellipse cx="64" cy="44" rx="14" ry="9" transform="rotate(30 64 44)" fill="${w}" ${o(2.5)} opacity=".95"/>
      <ellipse cx="50" cy="62" rx="14" ry="20" fill="${a}" ${o(3)}/>
      <path d="M37 56 L63 56 M36 66 L64 66 M40 75 L60 75" stroke="${INK}" stroke-width="5"/>
      <circle cx="50" cy="40" r="8" fill="${INK}"/>
      <path d="M46 34 Q42 26 36 26 M54 34 Q58 26 64 26" fill="none" ${o(2.2)}/>`,
  },
};
export const CREST_KEYS = Object.keys(CRESTS);

// Every franchise's own crest and a line on who it is.
export const IDENTITY = {
  PEW: { crest: 'boulder', tag: 'Power, defense, toughness' },
  FUC: { crest: 'shuriken', tag: 'Stealth and speed' },
  CEL: { crest: 'bloom', tag: 'Growth and precision' },
  CER: { crest: 'wave', tag: 'Fluid and fast' },
  VER: { crest: 'volt', tag: 'Electric and explosive' },
  VIR: { crest: 'ranger', tag: 'Nature and endurance' },
  PAL: { crest: 'starters', tag: 'Tradition and beginnings' },
  CIN: { crest: 'volcano', tag: 'Heat and aggression' },
  LAV: { crest: 'ghost', tag: 'Eerie and unpredictable' },
  SAF: { crest: 'seer', tag: 'Vision and composure' },
  GLD: { crest: 'gear', tag: 'Built and relentless' },
  ECR: { crest: 'pagoda', tag: 'Old fire, rising' },
  OLV: { crest: 'lighthouse', tag: 'Steady as the tide' },
  MAH: { crest: 'frost', tag: 'Cold and calculated' },
  BLK: { crest: 'wyvern', tag: 'Dragon pride' },
  AZA: { crest: 'swarm', tag: 'Strength in numbers' },
};
const BY_NAME = {
  'pewter boulders': 'PEW', 'fuchsia shadows': 'FUC', 'celadon bloom': 'CEL', 'cerulean surf': 'CER', 'vermilion volts': 'VER',
  'viridian rangers': 'VIR', 'pallet starters': 'PAL', 'cinnabar blaze': 'CIN', 'lavender haunts': 'LAV', 'saffron seers': 'SAF',
  'goldenrod gears': 'GLD', 'ecruteak embers': 'ECR', 'olivine tides': 'OLV', 'mahogany frost': 'MAH', 'blackthorn wyverns': 'BLK', 'azalea swarm': 'AZA',
};
// A custom team with no crest of its own still gets one that fits its name, when a word in
// it points at one; otherwise the monogram shield.
const WORDS = [[/rock|stone|boulder|titan|golem|granite/, 'boulder'], [/shadow|ninja|night|stealth|dark/, 'shuriken'], [/bloom|leaf|grass|flower|petal|forest|vine/, 'bloom'],
  [/surf|wave|tide|sea|ocean|water|splash/, 'wave'], [/volt|bolt|thunder|spark|electric|storm|zap/, 'volt'], [/ranger|guard|pine|wood/, 'ranger'],
  [/starter|rookie|pallet/, 'starters'], [/blaze|fire|flame|ember|heat|inferno|volcano|magma/, 'volcano'], [/haunt|ghost|spirit|phantom|spook/, 'ghost'],
  [/seer|psychic|mind|eye|oracle/, 'seer'], [/gear|steel|iron|machine|metal|robot/, 'gear'], [/frost|ice|snow|blizzard|freeze|glacier/, 'frost'],
  [/dragon|wyvern|drake|wyrm/, 'wyvern'], [/swarm|bee|bug|hive|sting/, 'swarm'], [/light|beacon|harbor|harbour/, 'lighthouse']];

// Which crest a team wears: its kit's pick, its own, one its name suggests, or the monogram.
export function crestOf(team = {}) {
  const pick = kitOf(team).logo;
  if (pick && (CRESTS[pick] || pick === 'monogram')) return pick;
  const own = IDENTITY[BY_NAME[String(team.name ?? '').toLowerCase().trim()]]?.crest
    ?? (!team.user ? IDENTITY[team.abbr]?.crest : null);
  if (own) return own;
  const n = String(team.name ?? '').toLowerCase();
  return WORDS.find(([re]) => re.test(n))?.[1] ?? 'monogram';
}
export function identityOf(team = {}) {
  const key = BY_NAME[String(team.name ?? '').toLowerCase().trim()] ?? (!team.user ? team.abbr : null);
  return IDENTITY[key] ?? null;
}
export function crestName(k) { return k === 'monogram' ? 'Monogram shield' : CRESTS[k]?.name ?? 'Crest'; }

function palette(team, crest) {
  const kit = kitOf(team);
  const p = kit.color;
  // The second color goes behind the crest: when it is too close to the primary in brightness
  // the crest would blur together, so it is pushed darker.
  let s = kit.color2;
  if (Math.abs(luma(s) - luma(p)) < 0.06) s = shade(p, -0.6);
  return { p, s, l: shade(p, 0.45), a: CRESTS[crest]?.accent ?? '#ffffff', w: '#f7f8f2' };
}

// The monogram shield: the team's initial in varsity type on a two-tone shield.
function monogram(team, { p, s, l, w }) {
  const ch = String(team.abbr || team.name || '?').trim().charAt(0).toUpperCase();
  return `<path d="M50 4 L90 16 L87 56 Q82 82 50 96 Q18 82 13 56 L10 16 Z" fill="${p}" ${O}/>
    <path d="M50 4 L90 16 L87 56 Q82 82 50 96 Z" fill="${s}" opacity=".45"/>
    <path d="M10 30 L90 30" stroke="${l}" stroke-width="3" opacity=".7"/>
    <text x="50" y="72" text-anchor="middle" font-family="Graduate, Rockwell, Georgia, serif" font-size="46" fill="${w}" stroke="${INK}" stroke-width="3" paint-order="stroke">${ch.replace(/[<&>"]/g, '')}</text>`;
}

// The crest as an SVG string. size in px (the box is square); title for screen readers.
export function teamLogo(team = {}, { size = 32, cls = '', title = true } = {}) {
  const crest = crestOf(team);
  const pal = palette(team, crest);
  const body = crest === 'monogram' ? monogram(team, pal) : CRESTS[crest].draw(pal);
  const name = String(team.name ?? team.abbr ?? 'Team').replace(/[<&>"]/g, '');
  return `<svg class="tlogo ${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" ${title ? `role="img" aria-label="${name} logo"` : 'aria-hidden="true"'} focusable="false">${body}</svg>`;
}
// A crest drawn for a picker: any crest key in this team's colors.
export function crestPreview(team, crest, size = 56) {
  return teamLogo({ ...team, kit: { ...(team.kit ?? {}), logo: crest } }, { size, title: false });
}
// The crest as an image URL, for painting onto canvas (the midfield logo, the video board).
export function logoDataUrl(team, size = 256) {
  const svg = teamLogo(team, { size, title: false }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
