// A quick game in a real browser, for screenshots of what a player sees: the call sheet, the
// line before the snap, and frames through each play (Coach mode: you call, the AI plays).
// Fails on page errors. Usage: node test/gameshots.mjs <outdir> [plays=3] [width=1280] [height=760]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const out = resolve(process.argv[2] ?? 'test-game-out'); mkdirSync(out, { recursive: true });
const plays = Number(process.argv[3] ?? 3), W = Number(process.argv[4] ?? 1280), H = Number(process.argv[5] ?? 760);
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
await page.goto(pathToFileURL(page0).href);
await page.waitForTimeout(800);
await page.click('[data-panel="quick"]');
await page.click('[data-act="quick"]');
await page.waitForFunction(() => window.__pb?.stage && window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 120000 });
await page.evaluate(() => { window.__pb.setMode('coach'); const R = window.__pb.RATES; R.falseStart = 0; R.offside = 0; });
if (await page.$('#help-ov:not([hidden])')) await page.click('[data-act="helpok"]').catch(() => {});
const shot = (n) => page.screenshot({ path: join(out, `${n}.png`) });
const OFF = ['slant', 'inside_run', 'post', 'outside_run', 'curl'], DEF = ['base', 'cover2', 'pass_blitz', 'cover3'];
const log = [];
for (let n = 0; n < plays; n++) {
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await shot(`${n}-0-select`);
  const st = await page.evaluate(() => { const g = window.__pb.S.game; return { phase: g.phase, poss: g.poss, down: g.down }; });
  // Kickoffs and tries take their own calls.
  await page.evaluate(([o, d, st]) => {
    const pb = window.__pb;
    if (st.phase === 'kickoff') { pb.doCall('kick_deep'); pb.doCall('kick_deep'); return; }
    if (st.phase === 'pat') { pb.doCall('xp'); pb.doCall('xp'); return; }
    pb.doCall(o); pb.doCall(d);
  }, [OFF[n % OFF.length], DEF[n % DEF.length], st]);
  await page.waitForFunction(() => ['PRE_SNAP', 'SNAP', 'LIVE_PLAY'].includes(window.__pb.L3.flow), null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(`${n}-1-presnap`);
  let k = 0;
  for (let i = 0; i < 400 && k < 6; i++) {
    const f = await page.evaluate(() => window.__pb.L3.flow);
    if (f === 'LIVE_PLAY') { await shot(`${n}-2-live-${k++}`); await page.waitForTimeout(450); } else if (k > 0 && f !== 'SNAP') break; else await page.waitForTimeout(200);
  }
  const r = await page.evaluate(() => window.__pb.L3.lp?.end?.text ?? document.querySelector('#lower3')?.innerText ?? '');
  log.push({ play: n, st, result: r });
  await page.waitForTimeout(900);
  await shot(`${n}-3-result`);
}
writeFileSync(join(out, 'log.json'), JSON.stringify({ log, errors }, null, 1));
console.log(JSON.stringify(log, null, 1)); console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
if (errors.length) process.exit(1);
