// Franchise kits: a team's second color, its end-zone wordmark, its home stadium, when its home
// games kick off and the chant its crowd sings. Every team has one: the user's comes from the
// kit screen (stored on the team, or in the setup for quick games), the AI teams' from the
// table below. A game takes its venue (stadium, time of day) from the home team's kit.

export const STADIUMS = {
  classic: { name: 'Open bowl', suffix: 'Bowl', blurb: 'The open-air bowl under four light towers. Weather blows straight in.' },
  dome: { name: 'Dome', suffix: 'Dome', blurb: 'A roof overhead and a ring of lights. No rain, hail or sandstorm, unless a Pokémon brings its own.', roof: true },
  mountain: { name: 'Mountain', suffix: 'Summit Field', blurb: 'Snow-capped peaks and pine forest around the bowl, cold blue air.' },
  seaside: { name: 'Seaside', suffix: 'Shoreline Park', blurb: 'Open water past the stands, a lighthouse, and boats out in the bay.' },
  haunted: { name: 'Haunted', suffix: 'Hollow', blurb: 'Gravestones and dead trees outside, will-o’-wisps over the stands, and every game kicks off at dusk or later.' },
};
export const STADIUM_KEYS = Object.keys(STADIUMS);

// When a home game kicks off. Auto lets the schedule decide: playoff games are at night, the
// rest a mix of day, dusk and prime time.
export const KICKOFFS = { auto: 'Schedule decides', day: 'Day games', night: 'Prime time' };
export const TIMES = { day: 'Afternoon', dusk: 'Dusk', night: 'Prime time' };

// End-zone wordmarks.
export const WORDMARKS = {
  block: 'Block',
  outline: 'Outline',
  script: 'Script',
  stripes: 'Block on stripes',
};

// Crowd chants, synthesized in audio.js from these steps. Each step is at a beat (in beats of
// the chant's tempo) and is a clap, a stomp, a drum, an organ note or a shout (a vowel sung by
// the whole section at a pitch).
export const CHANTS = {
  letsgo: { name: 'Let’s go', blurb: 'Clap, clap, clap-clap-clap, and the team’s name.', bpm: 150, beats: 8,
    steps: [['clap', 0], ['clap', 1], ['clap', 2], ['clap', 2.5], ['clap', 3], ['shout', 4, 'eh', 220, 0.5], ['shout', 4.75, 'oh', 247, 0.4], ['shout', 5.5, 'ah', 262, 1.2]] },
  stomp: { name: 'Stomp stomp clap', blurb: 'Two stomps on the bleachers and a clap, over and over.', bpm: 82, beats: 4,
    steps: [['stomp', 0], ['stomp', 1], ['clap', 2], ['stomp', 4], ['stomp', 5], ['clap', 6]] },
  drum: { name: 'War drum', blurb: 'A big drum in the stands and a shout on every fourth beat.', bpm: 120, beats: 8,
    steps: [['drum', 0], ['drum', 1], ['drum', 2], ['shout', 3, 'oh', 147, 0.35], ['drum', 4], ['drum', 5], ['drum', 6], ['shout', 7, 'oh', 165, 0.35]] },
  charge: { name: 'Organ charge', blurb: 'The stadium organ plays the charge and the crowd answers.', bpm: 140, beats: 8,
    steps: [['organ', 0, 392, 0.4], ['organ', 0.5, 523, 0.4], ['organ', 1, 659, 0.4], ['organ', 1.5, 784, 0.9], ['organ', 2.75, 659, 0.3], ['organ', 3, 784, 1.2], ['shout', 5, 'ah', 233, 0.9]] },
  howl: { name: 'Howl', blurb: 'A rising ghostly wail from the whole bowl, cut off by one shout.', bpm: 90, beats: 6,
    steps: [['shout', 0, 'oo', 175, 2.6, 330], ['shout', 0.2, 'oo', 220, 2.4, 392], ['clap', 4], ['shout', 4, 'eh', 247, 0.5]] },
};
export const CHANT_KEYS = Object.keys(CHANTS);

// The AI teams' kits, by abbreviation. Teams not listed get one from their name.
const DEFAULT_KITS = {
  CER: { stadium: 'seaside', chant: 'letsgo', style: 'script' },
  PEW: { stadium: 'mountain', chant: 'stomp', style: 'block' },
  SAF: { stadium: 'dome', chant: 'charge', style: 'outline' },
  VER: { stadium: 'classic', chant: 'drum', style: 'stripes' },
  CEL: { stadium: 'classic', chant: 'letsgo', style: 'script' },
  FUC: { stadium: 'seaside', chant: 'drum', style: 'outline' },
  CIN: { stadium: 'mountain', chant: 'drum', style: 'block' },
  LAV: { stadium: 'haunted', chant: 'howl', style: 'outline' },
  VIR: { stadium: 'classic', chant: 'stomp', style: 'stripes' },
  PAL: { stadium: 'classic', chant: 'letsgo', style: 'block' },
};

const HEX = /^#[0-9a-f]{6}$/i;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// A darker shade of a color, for the second color when a team has not picked one.
export function shade(hex, k) {
  if (!HEX.test(hex ?? '')) return '#1b2430';
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
}
// Relative luminance (0 black .. 1 white), to pick text that reads on a color.
export function luma(hex) {
  if (!HEX.test(hex ?? '')) return 0.2;
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export const inkOn = (hex) => (luma(hex) > 0.45 ? '#10161c' : '#ffffff');

export function defaultKit(team = {}) {
  const d = DEFAULT_KITS[team.abbr] ?? (() => {
    const h = hash(team.name ?? team.abbr ?? '');
    return { stadium: ['classic', 'classic', 'dome', 'mountain', 'seaside'][h % 5], chant: CHANT_KEYS[(h >> 3) % 4], style: ['block', 'outline', 'script', 'stripes'][(h >> 6) % 4] };
  })();
  return { color2: shade(team.color, -0.55), wordmark: '', kickoff: 'auto', ...d };
}

// A kit with every field valid: unknown values fall back to the team's defaults.
export function cleanKit(k, team = {}) {
  const d = defaultKit(team);
  const o = k && typeof k === 'object' ? k : {};
  return {
    color2: HEX.test(o.color2 ?? '') ? o.color2.toLowerCase() : d.color2,
    wordmark: typeof o.wordmark === 'string' ? o.wordmark.replace(/\s+/g, ' ').trim().slice(0, 18) : '',
    style: WORDMARKS[o.style] ? o.style : d.style,
    stadium: STADIUMS[o.stadium] ? o.stadium : d.stadium,
    kickoff: KICKOFFS[o.kickoff] ? o.kickoff : d.kickoff,
    chant: CHANTS[o.chant] ? o.chant : d.chant,
  };
}
// The kit a team plays in: its own color, and its kit (or the defaults) for the rest.
export function kitOf(team = {}) {
  return { color: HEX.test(team.color ?? '') ? team.color : '#c8102e', ...cleanKit(team.kit, team) };
}
// What goes in the end zone: the wordmark, or the team's name.
export function wordmarkOf(team) {
  return (kitOf(team).wordmark || team.name || team.abbr || '').toUpperCase();
}
// "Cerulean Shoreline Park": the first word of the team's name and the stadium's own.
export function venueName(team, stadium = kitOf(team).stadium) {
  const city = String(team.name ?? team.abbr ?? 'Home').trim().split(/\s+/)[0];
  return `${city} ${STADIUMS[stadium]?.suffix ?? 'Bowl'}`;
}

// A game's venue, from the home team's kit: the stadium, its name, the time of day and whether
// there is a roof. Neutral-site games are in an open bowl. The time comes from the game's seed
// (not its random stream, so a kit never changes how a game plays out): playoff games are at
// night, the haunted hollow never sees the afternoon, the rest are mostly day games.
export function venueFor(home, { seed = 0, playoff = false, neutral = false } = {}) {
  const kit = kitOf(home);
  const stadium = neutral ? 'classic' : kit.stadium;
  const r = (hash(`${seed}:time`) % 1000) / 1000;
  let time = r < 0.45 ? 'day' : r < 0.65 ? 'dusk' : 'night';
  if (playoff) time = 'night';
  else if (!neutral && kit.kickoff === 'day') time = 'day';
  else if (!neutral && kit.kickoff === 'night') time = 'night';
  if (stadium === 'haunted' && time === 'day') time = r < 0.5 ? 'dusk' : 'night';
  return { stadium, time, roof: !!STADIUMS[stadium].roof, name: neutral ? 'Neutral site' : venueName(home, stadium) };
}
// The venue of a game; games saved before kits get one now.
export function venueOf(g) {
  if (!g.venue) g.venue = venueFor(g.teams[0], { seed: g.seed, playoff: g.playoff, neutral: g.neutral });
  return g.venue;
}
