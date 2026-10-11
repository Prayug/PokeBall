import { PLAYERS, SLOT_KEYS, BASELINE } from '../src/ratings.js';
const ids = Object.keys(PLAYERS).filter((id) => !PLAYERS[id].legendary);
for (const k of SLOT_KEYS) {
  const top = ids.sort((a, b) => PLAYERS[b].ovr[k] - PLAYERS[a].ovr[k]).slice(0, 6);
  console.log(k.padEnd(4), String(BASELINE[k]).padEnd(3), top.map((id) => `${PLAYERS[id].name} ${PLAYERS[id].ovr[k]}`).join(', '));
}
