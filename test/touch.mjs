// The touch pad in a real browser on a phone-sized touch screen: a quick game in Play mode,
// three pass plays thrown from the pad, checking what a phone player would get:
//   - the pad is hidden while the call sheet is up and shows Snap before the snap
//   - while the quarterback can throw it shows 1-5, Lob and Away; a tapped number throws a
//     touch pass, a held one a bullet, and Lob then a number a lob
//   - Pause pauses the play and Camera changes the camera
//   - no errors in the page
// Screenshots go to the output folder. Usage: node test/touch.mjs <outdir>
// Needs Playwright with Chromium, like test/browser.mjs.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium, devices } = await import(pathToFileURL(PW).href);
const out = resolve(process.argv[2] ?? 'test-touch-out');
mkdirSync(out, { recursive: true });
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
const page = await ctx.newPage();
const errors = [], problems = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
// The 3D models are a release download; a local copy without them logs a missing file for each.
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FILE_NOT_FOUND')) errors.push(`console ${m.text()}`); });
await page.goto(pathToFileURL(page0).href);
await page.waitForTimeout(800);
await page.click('[data-panel="quick"]');
await page.click('[data-act="quick"]');
await page.waitForFunction(() => window.__pb?.stage && window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 90000 });
await page.evaluate(() => window.__pb.setMode('play'));
await page.waitForSelector('#help-ov:not([hidden])', { timeout: 10000 });
await page.click('[data-act="helpok"]');

const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const mode = () => page.evaluate(() => document.getElementById('touch').dataset.mode);
const shown = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null; }, sel);
// Pointer events straight on a button, so a hold lasts exactly as long as asked.
const press = (sel) => page.dispatchEvent(sel, 'pointerdown', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
const release = (sel) => page.dispatchEvent(sel, 'pointerup', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
// Hand the ball to the user's side: call defense on the AI's snaps until we have it.
async function toOffense() {
  for (let i = 0; i < 40; i++) {
    await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 180000 });
    const ours = await page.evaluate(() => { const pb = window.__pb, g = pb.S.game; return g.poss === (g.teams[0].id === (pb.S.gameMeta?.userTeamId ?? 0) ? 0 : 1); });
    if (ours) return;
    await page.evaluate(() => { window.__pb.doCall('cover3'); });
    await page.waitForFunction(() => window.__pb.L3.lp?.phase === 'pre', null, { timeout: 180000 });
    await page.evaluate(() => window.__pb.doSnap?.());
    await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 180000 });
  }
  throw new Error('never got the ball');
}

const THROWS = [['touch', async () => { await press('#touch [data-key="Digit1"]'); await page.waitForTimeout(60); await release('#touch [data-key="Digit1"]'); }],
  // Held until the throw starts (software WebGL can take longer than a bullet's hold per frame).
  ['bullet', async () => { await press('#touch [data-key="Digit2"]'); await page.waitForFunction(() => window.__pb.L3.lp?.windup || window.__pb.L3.lp?.thrown, null, { timeout: 8000 }).catch(() => {}); await release('#touch [data-key="Digit2"]'); }],
  ['lob', async () => { await press('#touch [data-touch="lob"]'); await press('#touch [data-key="Digit1"]'); await release('#touch [data-key="Digit1"]'); }]];
for (const [n, [want, act]] of THROWS.entries()) {
  await toOffense();
  await page.waitForTimeout(400);
  if ((await mode()) !== 'idle' || (await shown('#touch .t-main'))) problems.push(`${want}: pad showing on the call sheet`);
  if (n === 0) await shot('0-selection');
  await page.evaluate(() => window.__pb.doCall('four_verts'));
  await page.waitForFunction(() => window.__pb.L3.flow === 'PRE_SNAP', null, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('touch').dataset.mode === 'pre', null, { timeout: 5000 }).catch(() => {});
  if ((await mode()) !== 'pre' || !(await shown('#touch .t-main'))) problems.push(`${want}: no Snap button before the snap`);
  if (n === 0) await shot('1-presnap');
  await page.tap('#touch .t-main');
  await page.waitForFunction(() => document.getElementById('touch').dataset.mode === 'pass', null, { timeout: 60000 }).catch(() => problems.push(`${want}: pad never offered the throw`));
  if (!(await shown('#touch [data-key="Digit1"]')) || !(await shown('#touch [data-touch="lob"]')) || !(await shown('#touch [data-key="KeyT"]'))) problems.push(`${want}: throw buttons hidden`);
  if (n === 0) {
    // Pause stops the play; Resume carries on. Camera cycles the camera.
    await page.tap('#touch-top [data-touch="pause"]');
    const t0 = await page.evaluate(() => window.__pb.L3.lp.t);
    await page.waitForTimeout(1200);
    const p = await page.evaluate(() => ({ t: window.__pb.L3.lp.t, ov: !document.getElementById('pause-ov').hidden }));
    if (p.t !== t0 || !p.ov) problems.push(`pause button: play time ${t0} -> ${p.t}, overlay ${p.ov}`);
    await shot('2-paused');
    await page.tap('[data-act="resume"]');
    const c0 = await page.evaluate(() => window.__pb.S.cam);
    await page.tap('#touch-top [data-touch="camera"]');
    if (c0 === (await page.evaluate(() => window.__pb.S.cam))) problems.push('camera button did not change the camera');
    await page.tap('#touch-top [data-touch="camera"]'); await page.tap('#touch-top [data-touch="camera"]'); await page.tap('#touch-top [data-touch="camera"]');
    await shot('3-pass');
  }
  await act();
  const kind = await page.waitForFunction(() => window.__pb.L3.lp?.windup?.kind ?? window.__pb.L3.lp?.thrown?.kind ?? null, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
  if (kind !== want) problems.push(`${want}: the pad threw ${kind ?? 'nothing'}`);
  console.log(`${kind === want ? 'ok  ' : 'FAIL'} ${want} pass from the pad`);
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION' || window.__pb.S.game.final, null, { timeout: 180000 });
}
if (errors.length) problems.push(...errors.slice(0, 8));
for (const p of problems) console.log(`  ${p}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
