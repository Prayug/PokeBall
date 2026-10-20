// The film room and replay review in the built game, in a real browser:
//   - a missed call is reviewed (your challenge, theirs or the booth's) with the replay on the
//     field, and the verdict puts the play on the books as it really happened
//   - the film room opens on the last play, scrubs, steps, changes camera, stars a play and
//     marks a moment; Esc closes it back to the call sheet
//   - a play saves as a clip file that loads back and plays to the same end, and records as a
//     video file
// The officials are made to miss nearly every play near the line to gain so a review comes up
// in a few snaps. Screenshots, the clip, the video and results.json go to the output folder.
// Usage: node test/film.mjs <outdir> [plays=8]
// Needs Playwright with Chromium (software WebGL is enough).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const out = resolve(process.argv[2] ?? 'test-film-out');
const plays = Number(process.argv[3] ?? 8);
mkdirSync(out, { recursive: true });
const page0 = resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [], problems = [], notes = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const pb = (f, arg) => page.evaluate(f, arg);

await page.goto(pathToFileURL(page0).href);
await page.waitForTimeout(800);
await page.click('[data-act="quick"]');
await page.waitForFunction(() => window.__pb?.stage && window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 90000 });
await pb(() => {
  const P = window.__pb;
  P.setMode('coach');
  P.RATES.falseStart = 0; P.RATES.offside = 0;
  // Officials who miss almost everything near the line to gain or the goal line.
  Object.assign(P.REVIEW, { spotWindow: 12, goalWindow: 12, miss: 3, fumbleClose: 1, fumbleMiss: 1 });
});
await page.waitForSelector('#help-ov:not([hidden])', { timeout: 10000 });
await page.click('[data-act="helpok"]');

// ---------- a review ----------
const OFF = ['inside_run', 'slant', 'outside_run', 'curl'], DEF = ['base', 'cover2', 'cover3', 'man_press'];
// Until your own challenge has been decided (the first review by anyone counts too).
let review = null, mine = null;
for (let n = 0; n < plays && !mine; n++) {
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION' && !window.__pb.L3.replay, null, { timeout: 180000 });
  await page.waitForTimeout(400);
  await pb(([o, d]) => { window.__pb.doCall(o); window.__pb.doCall(d); }, [OFF[n % OFF.length], DEF[n % DEF.length]]);
  // The play, its result and the walk back; then a review by someone, or a challenge for you.
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_RESULT', null, { timeout: 180000 });
  await page.waitForFunction(() => window.__pb.L3.replay?.review || (window.__pb.L3.flow === 'PLAY_SELECTION' && !window.__pb.L3.lp), null, { timeout: 120000 });
  const st = await pb(() => { const L3 = window.__pb.L3, rv = L3.review; return { reviewing: !!L3.replay?.review, wrong: !!rv?.ruling?.wrong, booth: !!rv?.booth, done: !!rv?.done, chal: !document.getElementById('chal-btn').hidden }; });
  notes.push({ play: n + 1, ...st });
  if (!st.reviewing && st.chal && st.wrong) {
    await shot('0-challenge-button');
    await page.keyboard.press('KeyG'); await page.waitForTimeout(300);
    const on = await pb(() => ({ review: !!window.__pb.L3.replay?.review, by: window.__pb.L3.review?.by ?? null, flow: window.__pb.L3.flow, lp: !!window.__pb.L3.lp }));
    notes.push({ pressedG: on });
    if (!on.review) problems.push(`G did not start your challenge (${JSON.stringify(on)})`);
  }
  if (await pb(() => !!window.__pb.L3.replay?.review)) {
    const g0 = await pb(() => { const g = window.__pb.S.game; return { spot: g.spot, down: g.down, poss: g.poss, score: [...g.score], who: window.__pb.L3.review.by ?? 'booth', wrong: window.__pb.L3.review.ruling?.wrong }; });
    await page.waitForTimeout(1200);
    await shot(`1-review-${g0.who}`);
    const banner = await pb(() => document.querySelector('#lower3.on')?.innerText ?? '');
    if (!/review|challenge/i.test(banner)) problems.push(`no review card during the review (${banner})`);
    if (!(await pb(() => document.getElementById('replay-badge').textContent === 'Under review'))) problems.push('the badge does not say Under review');
    await page.waitForFunction(() => !window.__pb.L3.replay, null, { timeout: 240000 });
    await page.waitForTimeout(400);
    await shot(`2-verdict-${g0.who}`);
    const after = await pb(() => { const g = window.__pb.S.game, e = g.log[g.log.length - 1]; return { spot: g.spot, down: g.down, poss: g.poss, score: [...g.score], head: e.head, text: e.text, banner: document.getElementById('lower3')?.textContent ?? '', challenges: [...g.challenges], timeouts: [...g.timeouts] }; });
    review ??= { before: g0, after };
    if (g0.who === (await pb(() => window.__pb.S.game.teams[0].id === (window.__pb.S.gameMeta?.userTeamId ?? 0) ? 0 : 1))) mine = { before: g0, after };
    if (g0.wrong && after.head !== 'Reversed') problems.push(`a wrong call was not reversed (${after.head}: ${after.text})`);
    if (g0.wrong && JSON.stringify([g0.spot, g0.down, g0.poss, g0.score]) === JSON.stringify([after.spot, after.down, after.poss, after.score])) problems.push('the reversal did not change the down, spot or score');
    if (!after.banner) problems.push('no verdict card');
  }
}
if (!review) problems.push(`no review came up in ${plays} plays`);
if (!mine) notes.push(`your own challenge did not come up in ${plays} plays`);

// ---------- the film room ----------
await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION' && !window.__pb.L3.replay && !window.__pb.L3.lp, null, { timeout: 180000 });
await page.waitForTimeout(400);
if (await pb(() => document.getElementById('film-btn').hidden)) problems.push('no Film room button between plays');
await page.keyboard.press('KeyJ');
await page.waitForTimeout(500);
const f0 = await pb(() => { const F = window.__pb.FILM; return { open: F.open, n: F.tape?.n ?? 0, reel: F.reel.length, panel: !document.getElementById('film').hidden, drawn: window.__pb.stage.lp === F.lp }; });
if (!f0.open || !f0.panel) problems.push('O did not open the film room');
if (f0.reel < 1) problems.push(`the reel has ${f0.reel} plays`);
if (!f0.drawn) problems.push('the field does not show the film room tape');
await page.waitForTimeout(1500);
await shot('3-film-playing');
// Scrub to the middle, then step.
await pb(() => { const el = document.getElementById('film-scrub'); el.value = Math.round(window.__pb.FILM.tape.n / 2); el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(300);
const mid = await pb(() => window.__pb.FILM.i);
if (Math.abs(mid - Math.round(f0.n / 2)) > 1) problems.push(`scrub landed at ${mid}, wanted ${Math.round(f0.n / 2)}`);
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
if ((await pb(() => window.__pb.FILM.i)) !== mid + 1) problems.push('the step keys did not move one step at a time');
for (const cam of ['tactical', 'player', 'gameplay', 'broadcast']) {
  await page.click(`[data-film="cam"][data-cam="${cam}"]`);
  await page.waitForTimeout(700);
  await shot(`4-film-${cam}`);
}
await page.keyboard.press('KeyS');
await page.keyboard.press('KeyK');
const fm = await pb(() => { const F = window.__pb.FILM, it = F.reel[F.cur]; return { star: it.star, marks: it.marks, ui: document.querySelectorAll('.film-mark').length }; });
if (!fm.star || fm.marks.length !== 1 || fm.ui !== 1) problems.push(`star/mark: ${JSON.stringify(fm)}`);
// Save the clip, then load it back.
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[data-film="save"]')]);
const clipPath = join(out, dl.suggestedFilename());
await dl.saveAs(clipPath);
const want = await pb(() => { const F = window.__pb.FILM; return F.reel[F.cur].rec.end; });
await page.setInputFiles('#film-file', clipPath);
await page.waitForFunction((k) => window.__pb.FILM.reel.length > k, f0.reel, { timeout: 20000 }).catch(() => problems.push('the clip did not load'));
await pb(() => { const F = window.__pb.FILM; const el = document.getElementById('film-scrub'); el.value = F.tape.n; el.dispatchEvent(new Event('input', { bubbles: true })); });
const got = await pb(() => { const lp = window.__pb.FILM.lp; return `${lp.end?.how ?? lp.phase}@${(lp.spotX ?? lp.ball.x).toFixed(2)},${lp.ball.y.toFixed(2)}`; });
if (got !== want) problems.push(`the loaded clip ends at ${got}, the play at ${want}`);
await shot('5-film-clip');
// A video of the play.
const canRec = await pb(() => !document.querySelector('[data-film="video"]').disabled);
if (canRec) {
  await pb(() => { window.__pb.FILM.speed = 1; });
  const [vd] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click('[data-film="video"]')]);
  const vp = join(out, vd.suggestedFilename());
  await vd.saveAs(vp);
  notes.push({ video: vd.suggestedFilename() });
} else problems.push('this browser cannot record video');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const closed = await pb(() => ({ open: window.__pb.FILM.open, sheet: !!document.querySelector('.callsheet'), flow: window.__pb.L3.flow, drawn: window.__pb.stage.lp === window.__pb.L3.preview?.lp }));
if (closed.open || !closed.sheet) problems.push(`Esc did not close the film room back to the call sheet (${JSON.stringify(closed)})`);
await shot('6-closed');

const res = { problems, errors: errors.filter((e) => !/ERR_FILE_NOT_FOUND/.test(e) || !/models3d/.test(e)), review, mine, notes, film: f0 };
writeFileSync(join(out, 'results.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await browser.close();
process.exit(problems.length || errors.length ? 1 : 0);
