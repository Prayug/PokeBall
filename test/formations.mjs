// Every offensive formation against every defensive front, for every team pairing in a drafted
// league and at several field positions: the formation check must pass (11 on 11, seven on
// the line, linemen in order, quarterback and backs where the formation puts them, receivers
// split, nobody offside, everyone facing the right way and no two drawn bodies overlapping),
// and every player must stand on his side of the ball inside the field.
// Usage: node test/formations.mjs [--print]   (exits 1 on failure; --print draws one of each)
import { createLeague, aiChoosePick, makePick, teamForGame } from '../src/league.js';
import { createGame } from '../src/engine.js';
import { createLivePlay, validateFormation, FORMATIONS, DEF_FORMATIONS } from '../src/live.js';
import { formationsFor, positionName } from '../src/formations.js';
import { bodyOf } from '../src/body.js';
import { PLAYERS } from '../src/ratings.js';

const L = createLeague({ seed: 11, rounds: 26 });
L.teams[0].user = false;
while (L.phase === 'draft') { const c = aiChoosePick(L); makePick(L, c.id, c.slot); }
const print = process.argv.includes('--print');
let n = 0, bad = 0;
const calls = { gun_spread: 'slant', gun_trips: 'out', singleback: 'inside_run', iform: 'qb_sneak', pistol: 'te_seam' };
for (const form of Object.keys(FORMATIONS)) for (const front of Object.keys(DEF_FORMATIONS)) for (let t = 0; t < 8; t++) for (const spot of [3, 25, 50, 80, 97]) {
  const g = createGame({ home: teamForGame(L.teams[t]), away: teamForGame(L.teams[(t + 3) % 8]), seed: t + 1, weather: 'clear' });
  g.spot = spot; g.poss = t % 2; g.down = 1; g.toGo = Math.min(10, 100 - spot);
  const call = calls[form];
  if (!formationsFor(call).includes(form)) continue;
  const def = front === 'goal' ? 'goal_line' : front === 'nickel' ? 'cover2' : 'base';
  const lp = createLivePlay(g, call, def, { formation: form, defFormation: front });
  n++;
  const issues = validateFormation(lp);
  for (const p of lp.players) if ((p.side === 'off') !== (p.x < 0)) issues.push(`${p.slot} on the wrong side of the ball`);
  if (lp.formation !== form || lp.defFormation !== front) issues.push(`asked for ${form}/${front}, got ${lp.formation}/${lp.defFormation}`);
  if (issues.length) { bad++; if (bad < 12) console.log(`FAIL ${form} vs ${front} team ${t} spot ${spot}: ${issues.slice(0, 4).join('; ')}`); }
  if (print && t === 0 && spot === 25) {
    console.log(`\n${FORMATIONS[form].name} vs ${DEF_FORMATIONS[front].name}`);
    for (const p of [...lp.players].sort((a, b) => b.x - a.x)) {
      const B = bodyOf(p.id);
      console.log(`  ${p.side} ${positionName(lp, p).padEnd(5)} ${p.slot.padEnd(4)} x ${p.x.toFixed(2).padStart(6)} y ${p.y.toFixed(2).padStart(6)}  ${B.cls.padEnd(6)} r ${B.r.toFixed(2)} side ${B.foot.side.toFixed(2)}  ${PLAYERS[p.id].name}`);
    }
  }
}
console.log(`${n - bad} of ${n} formations clean`);
process.exit(bad ? 1 : 0);
