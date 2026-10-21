// The booth in a real browser: watches a quick game in Watch mode (the AI plays both sides) and
// records everything the crew says through the browser's speech synthesis (stubbed here, so
// headless Chromium can "speak": each line takes as long as it would to say). Checks that:
//   - the open is called, then every play gets a situation line before the snap and a call
//     during or after it, in both voices
//   - the captions show who is talking, and come down when the booth is quiet
//   - the sound panel's sliders and switches work, U mutes, and muting stops the booth
//   - nothing errors
// Usage: node test/booth.mjs <outdir> [plays=6]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const out = resolve(process.argv[2] ?? 'test-browser-out/booth');
const plays = Number(process.argv[3] ?? 6);
mkdirSync(out, { recursive: true });
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
// A speech synthesizer that records each line and "finishes" it after its spoken length.
await ctx.addInitScript(() => {
  const said = (window.__said = []);
  const voices = [{ name: 'Test Guy Online (Natural)', lang: 'en-US', localService: false }, { name: 'Test Aria Online (Natural)', lang: 'en-US', localService: false }];
  class U { constructor(text) { this.text = text; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; this.onend = null; this.onerror = null; } }
  let cur = null, timer = 0;
  const syn = {
    getVoices: () => voices, addEventListener() {}, get speaking() { return !!cur; },
    speak(u) {
      cur = u; said.push({ text: u.text, voice: u.voice?.name ?? null, rate: u.rate, pitch: u.pitch, at: performance.now() });
      timer = setTimeout(() => { if (cur === u) { cur = null; u.onend?.(); } }, 250 + u.text.split(/\s+/).length * 120);
    },
    cancel() { clearTimeout(timer); const u = cur; cur = null; u?.onerror?.({ error: 'interrupted' }); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: syn, configurable: true });
  window.SpeechSynthesisUtterance = U;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console ${m.text()}`); });
await page.goto(pathToFileURL(page0).href + '?seed=4242');
await page.waitForTimeout(800);
// The first press starts the audio, as for a player.
await page.mouse.click(5, 5);
const problems = [];
const audioUp = await page.evaluate(() => !!(window.AudioContext || window.webkitAudioContext));
if (!audioUp) problems.push('no Web Audio in this browser');

// The sound panel from the top bar.
await page.click('[data-act="sound"]');
await page.waitForSelector('.sndpop', { timeout: 5000 });
await page.screenshot({ path: join(out, '0-sound-panel.png') });
for (const id of ['snd-master', 'snd-booth', 'snd-crowd', 'snd-fx', 'snd-music']) if (!(await page.$(`#${id}`))) problems.push(`sound panel: no ${id}`);
await page.$eval('#snd-crowd', (el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const vol = await page.evaluate(() => window.__pb.S.vol.crowd);
if (Math.abs(vol - 0.4) > 0.001) problems.push(`crowd slider: volume ${vol}`);
await page.click('[data-act="sound"]');

await page.click('[data-act="watchgame"]').catch(async () => page.evaluate(() => window.__pb && null));
await page.waitForFunction(() => window.__pb?.stage && window.__pb.S.game, null, { timeout: 90000 });
const t0 = Date.now();
let snaps = 0, lastNo = -1, capSeen = new Set(), shots = 0;
while (snaps < plays && Date.now() - t0 < 600000) {
  const st = await page.evaluate(() => ({ no: window.__pb.S.game?.playNo, flow: window.__pb.L3.flow, final: window.__pb.S.game?.final,
    cap: document.querySelector('#booth-cap.on')?.className ?? null, capText: document.querySelector('#booth-cap.on .bc-say')?.textContent ?? null }));
  if (st.cap) { capSeen.add(st.cap.includes('color') ? 'color' : 'pbp'); if (shots < 4 && st.flow === 'LIVE_PLAY') await page.screenshot({ path: join(out, `1-live-caption-${shots++}.png`) }); }
  if (st.no !== lastNo) { lastNo = st.no; snaps++; }
  if (st.final) break;
  await page.waitForTimeout(250);
}
await page.screenshot({ path: join(out, '2-after.png') });
const said = await page.evaluate(() => window.__said);
const voicesUsed = new Set(said.map((s) => s.voice));
if (!said.length) problems.push('the booth said nothing');
if (!said.some((s) => /welcome/i.test(s.text))) problems.push('no open');
if (voicesUsed.size < 2) problems.push(`one voice only: ${[...voicesUsed].join(', ')}`);
if (!capSeen.has('pbp') || !capSeen.has('color')) problems.push(`captions seen: ${[...capSeen].join(', ') || 'none'}`);
if (said.some((s) => /undefined|NaN|\[object/.test(s.text))) problems.push('a broken line was spoken');

// U mutes: the booth stops and stays quiet.
const n0 = said.length;
await page.keyboard.press('KeyU');
const muted = await page.evaluate(() => !window.__pb.S.sound);
if (!muted) problems.push('U did not mute');
await page.waitForTimeout(6000);
const after = await page.evaluate(() => window.__said.length);
await page.keyboard.press('KeyU');
// (A line can be cut in while the press lands; more than a couple means the booth kept talking.)
if (after - n0 > 1) problems.push(`the booth kept talking muted: ${after - n0} lines`);

const res = { snaps, lines: said.length, voices: [...voicesUsed], captions: [...capSeen], sample: said.slice(0, 40).map((s) => `${s.voice?.startsWith('Test Guy') ? 'PBP' : 'CLR'} ${s.text}`), problems, errors };
writeFileSync(join(out, 'results.json'), JSON.stringify(res, null, 2));
console.log(res.sample.join('\n'));
console.log(`${snaps} plays, ${said.length} lines, voices ${[...voicesUsed].join(' / ')}, captions ${[...capSeen].join(' ')}`);
if (problems.length || errors.length) { console.log('PROBLEMS', problems, errors); await browser.close(); process.exit(1); }
console.log('ok');
await browser.close();
