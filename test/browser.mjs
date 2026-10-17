// The built game in a real browser: plays a few snaps of a quick game in Coach mode (you call
// the plays, the AI plays them), records the session and checks what a player would see:
//   - the game-flow states run PLAY_SELECTION > PRE_SNAP > SNAP > LIVE_PLAY > PLAY_RESULT >
//     RESET_FORMATION > PLAY_SELECTION for every snap
//   - the camera keeps the ball in frame during the play (its aim point within reach of the ball)
//   - the result card appears only after the whistle, and the scoreboard's down and distance
//     match the game state once the next play is up
//   - no errors in the page
// Screenshots and a video go to the output folder with a results.json.
// Usage: node test/browser.mjs <outdir> [plays=3]
// Needs Playwright with Chromium (software WebGL is enough; it runs slowly but in step).
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const out = resolve(process.argv[2] ?? 'test-browser-out');
const plays = Number(process.argv[3] ?? 3);
mkdirSync(out, { recursive: true });
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, recordVideo: { dir: out, size: { width: 1280, height: 760 } } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
await page.goto(pathToFileURL(page0).href);
await page.waitForTimeout(800);
await page.click('[data-act="quick"]');
await page.waitForFunction(() => window.__pb?.stage && window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 90000 });
await page.evaluate(() => window.__pb.setMode('coach'));
// The first game opens with the controls card; it pauses play until it is dismissed.
await page.waitForSelector('#help-ov:not([hidden])', { timeout: 10000 });
await page.click('[data-act="helpok"]');

const OFF = ['slant', 'inside_run', 'post', 'outside_run', 'curl'], DEF = ['base', 'cover2', 'pass_blitz', 'cover3', 'man_press'];
const shot = async (name) => page.screenshot({ path: join(out, `${name}.png`) });
const state = () => page.evaluate(() => {
  const pb = window.__pb, lp = pb.L3.lp, st = pb.stage, g = pb.S.game;
  let camToBall = null;
  if (lp && st) { const w = st.world(lp.ball.x, lp.ball.y); camToBall = Math.hypot(st.rig.look.x - w.x, st.rig.look.z - w.z); }
  return { flow: pb.L3.flow, t: lp?.t ?? null, phase: lp?.phase ?? null, cam: st?.rig.shot ?? null, camToBall,
    banner: document.querySelector('#lower3.on')?.innerText ?? null,
    downCell: document.querySelector('.bc-down')?.textContent ?? null, down: g.down, toGo: g.toGo, poss: g.poss, score: [...g.score], phase: g.phase ?? 'play' };
});
const results = [];
for (let n = 0; n < plays; n++) {
  const r = { play: n + 1, problems: [], samples: [] };
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 120000 });
  await page.waitForTimeout(600);
  const before = await state();
  await shot(`${n + 1}-0-selection`);
  const traceAt = await page.evaluate(() => window.__pb.L3.trace.length);
  r.call = await page.evaluate(([o, d]) => { window.__pb.doCall(o); window.__pb.doCall(d); return { off: window.__pb.L3.off, def: window.__pb.L3.def }; }, [OFF[n % OFF.length], DEF[n % DEF.length]]);
  await page.waitForFunction(() => ['PRE_SNAP', 'SNAP', 'LIVE_PLAY'].includes(window.__pb.L3.flow), null, { timeout: 180000 });
  await shot(`${n + 1}-1-presnap`);
  // Through the play: sample the camera against the ball.
  let k = 0;
  for (;;) {
    const s = await state();
    if (s.flow === 'LIVE_PLAY' && n === 1 && !r.pauseChecked) {
      // Pause: P stops the play and its clock; P again resumes it.
      r.pauseChecked = true;
      await page.keyboard.press('KeyP');
      const t0 = await page.evaluate(() => window.__pb.L3.lp.t);
      await page.waitForTimeout(2500);
      const t1 = await page.evaluate(() => ({ t: window.__pb.L3.lp.t, ov: !document.getElementById('pause-ov').hidden }));
      if (t1.t !== t0 || !t1.ov) r.problems.push(`pause: play time ${t0} -> ${t1.t}, overlay ${t1.ov}`);
      await shot(`${n + 1}-2-paused`);
      await page.keyboard.press('KeyP');
    }
    if (s.flow === 'LIVE_PLAY') {
      r.samples.push({ t: s.t, cam: s.cam, camToBall: s.camToBall });
      if (s.banner) r.problems.push(`result card showing during the play at t=${s.t?.toFixed(2)}`);
      if (k < 4) { await shot(`${n + 1}-2-live-${k}-${s.cam}`); k++; }
    }
    if (s.flow === 'PLAY_RESULT' || s.flow === 'RESET_FORMATION' || s.flow === 'PLAY_SELECTION') break;
    await page.waitForTimeout(700);
  }
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_RESULT', null, { timeout: 30000 }).catch(() => {});
  const res = await state();
  r.result = res.banner;
  if (!res.banner) r.problems.push('no result card at PLAY_RESULT');
  await shot(`${n + 1}-3-result`);
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION' || window.__pb.S.game.final, null, { timeout: 120000 });
  const after = await state();
  if (n === 0) {
    // Instant replay: Y re-runs the play from the recording, and it must end where it did.
    await page.keyboard.press('KeyY');
    const on = await page.evaluate(() => !!window.__pb.L3.replay && !document.getElementById('replay-badge').hidden);
    if (!on) r.problems.push('Y did not start the replay');
    // The field must draw the replay, not the next play lining up behind it.
    await page.waitForTimeout(1500);
    if (!(await page.evaluate(() => !window.__pb.L3.replay || window.__pb.stage.lp === window.__pb.L3.replay.lp))) r.problems.push('the field shows the next play instead of the replay');
    await shot(`${n + 1}-4-replay`);
    await page.waitForFunction(() => !window.__pb.L3.replay, null, { timeout: 240000 }).catch(() => r.problems.push('replay did not finish'));
    const rp = await page.evaluate(() => window.__pb.L3.lastReplay);
    if (!rp || rp.end !== rp.want) r.problems.push(`replay ended at ${rp?.end} but the play ended at ${rp?.want}`);
  }
  r.trace = await page.evaluate((i) => window.__pb.L3.trace.slice(i).map((x) => x.state), traceAt);
  const want = ['PRE_SNAP', 'SNAP', 'LIVE_PLAY', 'PLAY_RESULT', 'RESET_FORMATION', 'PLAY_SELECTION'];
  const seen = r.trace.filter((s) => want.includes(s));
  if (seen.join() !== want.join()) r.problems.push(`flow ${r.trace.join(' > ')}`);
  // The scoreboard shows the game's down and distance for the next snap (or Try, Kickoff or Flag
  // between downs).
  const dn = { pat: 'Try', kickoff: 'Kickoff', penalty: 'Flag' }[after.phase] ?? ['1st', '2nd', '3rd', '4th'][after.down - 1];
  if (after.downCell && !after.downCell.toLowerCase().includes(dn.toLowerCase())) r.problems.push(`scoreboard says "${after.downCell}" but it should say ${dn}`);
  // Camera: the aim point stays with the ball (deep passes lean ahead of it, so allow room).
  const far = r.samples.filter((s) => s.camToBall != null && s.camToBall > 22);
  if (far.length) r.problems.push(`camera ${far[0].camToBall.toFixed(1)} yd from the ball at t=${far[0].t?.toFixed(2)}`);
  r.before = { down: before.down, toGo: before.toGo, poss: before.poss, score: before.score };
  r.after = { down: after.down, toGo: after.toGo, poss: after.poss, score: after.score, scoreboard: after.downCell };
  results.push(r);
  console.log(`${r.problems.length ? 'FAIL' : 'ok  '} play ${n + 1} ${r.call.off}/${r.call.def}: ${(r.result ?? '').replace(/\s+/g, ' ').slice(0, 90)}`);
  for (const p of r.problems) console.log(`       ${p}`);
}
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
await page.close();
await ctx.close();
await browser.close();
// Name the recording.
for (const f of readdirSync(out)) if (f.endsWith('.webm') && f !== 'session.webm') renameSync(join(out, f), join(out, 'session.webm'));
const failed = results.filter((r) => r.problems.length).length + (errors.length ? 1 : 0);
writeFileSync(join(out, 'results.json'), JSON.stringify({ when: new Date().toISOString(), plays: results, errors }, null, 2));
console.log(`${results.length - results.filter((r) => r.problems.length).length} of ${results.length} plays passed${errors.length ? `, ${errors.length} page errors` : ''}`);
process.exit(failed ? 1 : 0);
