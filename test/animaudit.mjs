// Animation audit in a real browser: loads species into the animation lab (#animlab) and
// measures, on the rendered skinned mesh, how much each body part moves in each state, where
// the feet are against the turf and how much they slide (src/animlab.js, Meter).
//   node test/animaudit.mjs [ids|all] [states] [out.json] [--strict]
// ids: comma-separated dex numbers, or "all". --strict fails on the acceptance checks below.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const strict = process.argv.includes('--strict');
const KEY = [445, 248, 473, 6, 68, 448, 59, 405, 18, 635, 150, 65, 384, 95, 706, 149, 815, 658, 143, 130, 94, 25];
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(page0).href + '#animlab');
await page.waitForFunction(() => window.__pbLab, null, { timeout: 30000 });
const ids = args[0] === 'all' ? await page.evaluate(() => window.__pbLab.ALL) : args[0] ? args[0].split(',').map(Number) : KEY;
const states = args[1] ? args[1].split(',') : ['idle', 'jog', 'sprint', 'block', 'throw', 'tackled'];
const res = [];
for (let i = 0; i < ids.length; i += 8) {
  res.push(...await page.evaluate(([ids, states]) => window.__pbLab.audit(ids, states), [ids.slice(i, i + 8), states]));
}
await browser.close();
if (args[2]) writeFileSync(args[2], JSON.stringify(res, null, 1));
// The acceptance checks: limbs move while running, feet stay on the turf, nothing glides.
const fails = [];
const f2 = (v) => (v == null ? '  -  ' : v.toFixed(2).padStart(5));
console.log('id   name          style    legs arms clip(sprint)  arm   leg   body  head  tail  wing | ground  slide drift');
for (const r of res) {
  if (r.failed) { console.log(r.id, 'failed to load'); continue; }
  const S = r.states.sprint ?? r.states.jog, m = S.motion;
  console.log(String(r.id).padEnd(4), (r.name ?? '').slice(0, 13).padEnd(13), r.style.padEnd(8), String(r.legs).padEnd(4), String(r.arms).padEnd(4), String(S.clip).padEnd(13),
    f2(m.arm), f2(m.leg), f2(m.body), f2(m.head ?? m.neck), f2(m.tail), f2(m.wing), '|', f2(S.ground.median), f2(S.slide), f2(S.drift));
  if (r.style === 'biped' && r.arms >= 2 && !(m.arm > 0.08)) fails.push(`${r.name}: arms barely move at a sprint (${m.arm})`);
  if ((r.style === 'biped' || r.style === 'quad') && r.legs >= 2 && !(m.leg > 0.1)) fails.push(`${r.name}: legs barely move at a sprint (${m.leg})`);
  if (Math.abs(r.states.idle?.ground.median ?? 0) > 0.05 && r.style !== 'flyer' && r.style !== 'floater') fails.push(`${r.name}: standing ${r.states.idle.ground.median} of its height off the turf`);
  if (r.warn.length) console.log('     ', r.warn.join(' | '));
}
if (errors.length) { console.log('page errors:', errors.slice(0, 5)); fails.push('page errors'); }
console.log(fails.length ? `\n${fails.length} problems:\n  ${fails.join('\n  ')}` : '\nall checks pass');
if (strict && fails.length) process.exit(1);
