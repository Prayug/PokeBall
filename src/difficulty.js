// Difficulty: Rookie, Pro and Legend. Pro plays exactly the way the game always has; the others
// tune three things for games the user coaches:
//   aiRead     how quickly the AI side reads the play: its quarterback's beat per read and how
//              long its defenders take to react to cuts and to a thrown ball (above 1 is slower)
//   catchReach yards added to how far the user's receivers reach for a pass (in the fast sim,
//              the completion rate it is worth: see doPass)
//   form       how far the per-game form roll swings (see PARITY in parity.js; 1 = as is)
//   edge       a rating multiplier for the user's side on top of form (0.04 means 4%)
// AI-against-AI games never carry a difficulty, so the rest of the league plays as before.
export const DIFFICULTY = {
  rookie: { name: 'Rookie', blurb: 'Slower AI reads, a bigger catch radius, luck leans your way', aiRead: 1.3, catchReach: 0.35, form: 1.25, edge: 0.03 },
  pro: { name: 'Pro', blurb: 'The game as designed', aiRead: 1, catchReach: 0, form: 1, edge: 0 },
  legend: { name: 'Legend', blurb: 'Quicker AI reads, a tighter catch radius, no help from luck', aiRead: 0.8, catchReach: -0.15, form: 0.75, edge: -0.025 },
};
export const DIFFICULTY_LEVELS = Object.keys(DIFFICULTY);
export const DEFAULT_DIFFICULTY = 'pro';

// Marks a game as the user's, at a level: g.diff = { level, user } where user is the side index.
export function applyDifficulty(g, level, userTeamId) {
  if (!g) return;
  const user = g.teams[0].id === userTeamId ? 0 : 1;
  g.diff = { level: DIFFICULTY[level] ? level : DEFAULT_DIFFICULTY, user };
}
// The game's level (Pro when it has none).
export function diffOf(g) { return DIFFICULTY[g?.diff?.level] ?? DIFFICULTY.pro; }
// The user's side of a game, or null for an AI-only game.
export function diffUser(g) { return g?.diff ? g.diff.user : null; }
