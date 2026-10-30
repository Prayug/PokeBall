// Contact sheets from the animation lab: for each species and state, N frames a fixed time
// apart, so a stride, a throw or a tackle can be read at a glance.
//   node test/animshots.mjs <outdir> <ids> <states> [frames=6] [gap=0.12]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const [outDir, idArg, stArg, nArg, gapArg] = process.argv.slice(2);
const out = resolve(outDir ?? 'test-anim-out'); mkdirSync(out, { recursive: true });
const ids = (idArg ?? '445').split(',').map(Number), states = (stArg ?? 'sprint').split(','), N = Number(nArg ?? 6), gap = Number(gapArg ?? 0.12);
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1140, height: 520 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(pathToFileURL(page0).href + '#animlab');
await page.waitForFunction(() => window.__pbLab, null, { timeout: 30000 });
for (const id of ids) {
  await page.evaluate((id) => { window.__pbLab.view.manual = false; window.__pbLab.load(id); }, id);
  await page.waitForFunction(() => window.__pbLab.view.fig, null, { timeout: 60000 });
  for (const st of states) {
    await page.evaluate((st) => { window.__pbLab.setState(st); window.__pbLab.view.fixed = true; }, st);
    const files = [];
    // Step the lab in fixed time: freeze rAF time by advancing manually.
    await page.evaluate(() => { window.__pbLab.view.manual = true; });
    await page.evaluate(() => window.__pbLab.step(0.8));
    for (let k = 0; k < N; k++) {
      await page.evaluate((g) => window.__pbLab.step(g), gap);
      const f = join(out, `${id}-${st}-${k}.png`);
      await page.locator('#lab-view canvas').screenshot({ path: f });
      files.push(f);
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]scale=380:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % 3) * 380}_${Math.floor(i / 3) * 260}`).join('|')}`, join(out, `${id}-${st}.jpg`)]);
    console.log(join(out, `${id}-${st}.jpg`));
  }
}
await browser.close();
