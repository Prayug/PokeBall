// The built game in a real browser: sharing a league, the two-player game and gamepads.
//   - share: draft a league, copy its share link, open the link in a fresh browser and load the
//     draft; both browsers must hold the same rosters, schedule and trade offer
//   - two players: the offense calls, then the defense; player one (WASD) and player two (the
//     arrows) each steer their own Pokémon in the same play, and only the offense snaps
//   - gamepad: a fake pad calls a play with the D-pad and A, snaps with A, runs with the stick
//     and throws with a face button
//   - challenge: after a few games the share link is a challenge; a fresh browser opens it,
//     drafts its own team from the same seed and gets a verdict after as many games
//   - watch: ?watch opens a game the AI plays on both sides with no call sheet, and O takes the
//     next call
// Screenshots go to the output folder with a results.json.
// Usage: node test/twoplayer.mjs <outdir> [share,2p,pad,challenge,watch]   (which parts to run, default all)
// Needs Playwright with Chromium (software WebGL is enough).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const out = resolve(process.argv[2] ?? 'test-twoplayer-out');
mkdirSync(out, { recursive: true });
const parts = (process.argv[3] ?? 'share,2p,pad,challenge,watch').split(',');
const url = pathToFileURL(resolve(fileURLToPath(new URL('../dist/index.html', import.meta.url)))).href;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [], notes = [];
const check = (ok, what) => { (ok ? notes : problems).push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

// A fake gamepad the page reads through navigator.getGamepads(); the test sets its buttons and axes.
const FAKE_PAD = () => {
  const pad = { index: 0, id: 'Test pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__fake = { pad, on: false };
  navigator.getGamepads = () => (window.__fake.on ? [pad] : []);
  window.__press = (i, v) => { pad.buttons[i] = { pressed: v, value: v ? 1 : 0 }; };
  window.__stick = (x, y) => { pad.axes[0] = x; pad.axes[1] = y; };
};

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/models3d|Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) page.errors.push(`console ${m.text()}`); });
  return page;
}
// Holds a button until the page has read the pad a couple of times (software rendering is slow).
const frames = (page) => page.evaluate(() => window.__pbPad.frames);
async function polled(page, n = 2) { const f0 = await frames(page); await page.waitForFunction((f) => window.__pbPad.frames >= f, f0 + n, { timeout: 30000 }); }
const tap = async (page, i, ms = 120) => { await page.evaluate((b) => window.__press(b, true), i); await page.waitForTimeout(ms); await polled(page); await page.evaluate((b) => window.__press(b, false), i); await polled(page); };

// ---------- share a league ----------
if (parts.includes('share')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await newPage(ctx);
  await page.goto(url);
  await page.click('[data-panel="new"]');
  await page.fill('#f-name', 'Share Testers');
  await page.click('#setup-form button[type="submit"]');
  await page.click('[data-act="autodraft"]');
  await page.waitForSelector('.grades', { timeout: 120000 });
  await page.click('[data-act="share"]');
  const link = await page.inputValue('#share-link');
  await page.screenshot({ path: join(out, 'share-0-grades.png') });
  const mine = await page.evaluate(() => JSON.stringify({ t: window.__pb.S.league.teams.map((t) => [t.name, t.roster, t.lineup]), s: window.__pb.S.league.schedule, tr: window.__pb.S.league.trade }));
  check(/#league=[A-Za-z0-9_-]{100,}$/.test(link), `share link carries the league code (${link.length} characters)`);
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const friend = await newPage(ctx2);
  // The link points at the deployed page; open the same code on the local build.
  await friend.goto(url + link.slice(link.indexOf('#')));
  await friend.waitForSelector('.card.shared', { timeout: 20000 });
  await friend.screenshot({ path: join(out, 'share-1-friend-home.png') });
  await friend.click('[data-act="shareload"][data-replay="1"]');
  await friend.waitForSelector('.grades', { timeout: 20000 });
  const theirs = await friend.evaluate(() => JSON.stringify({ t: window.__pb.S.league.teams.map((t) => [t.name, t.roster, t.lineup]), s: window.__pb.S.league.schedule, tr: window.__pb.S.league.trade }));
  check(mine === theirs, 'the friend loads the same draft: rosters, lineups, schedule and trade offer');
  check(!/#league=/.test(friend.url()), 'the code is dropped from the address after loading');
  // Draft it yourself: the same order and AI drafters, the user's own picks.
  await friend.goto('about:blank');
  await friend.goto(url + link.slice(link.indexOf('#')));
  await friend.waitForSelector('.card.shared');
  await friend.click('[data-act="shareload"][data-replay="0"]');
  await friend.waitForSelector('.draft', { timeout: 20000 });
  const fresh = await friend.evaluate(() => ({ idx: window.__pb.S.league.pickIndex, seed: window.__pb.S.league.seed, order: window.__pb.S.league.picks.slice(0, 8).map((p) => p.team) }));
  const orig = await page.evaluate(() => ({ seed: window.__pb.S.league.seed, order: window.__pb.S.league.picks.slice(0, 8).map((p) => p.team) }));
  check(fresh.seed === orig.seed && fresh.order.join() === orig.order.join(), 'draft it yourself: same seed and draft order, a fresh draft');
  for (const p of [page, friend]) if (p.errors.length) check(false, `page errors: ${p.errors.slice(0, 3).join(' | ')}`);
  await ctx.close(); await ctx2.close();
}

// ---------- two players, one keyboard ----------
if (parts.includes('2p')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await newPage(ctx);
  await page.goto(url);
  await page.click('[data-panel="quick"]');
  await page.click('[data-act="quick2"]');
  await page.waitForFunction(() => window.__pb?.stage && window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 90000 });
  await page.waitForSelector('#help-ov:not([hidden])', { timeout: 10000 });
  await page.screenshot({ path: join(out, '2p-0-controls.png') });
  await page.click('[data-act="helpok"]');
  // Play two downs so both teams have the ball at least once if the first ends in a change.
  for (let n = 0; n < 2; n++) {
    await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION' && document.querySelector('.callsheet'), null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const poss = await page.evaluate(() => window.__pb.S.game.poss);
    const who1 = await page.textContent('.cs-who');
    check(who1.includes(`Player ${poss + 1}`) && who1.includes('offense'), `down ${n + 1}: the offense (player ${poss + 1}) calls first: "${who1.trim()}"`);
    await page.screenshot({ path: join(out, `2p-${n + 1}-1-offense-call.png`) });
    // A pass on the Quick page, then the defense's first call.
    await page.evaluate(() => window.__pb.doCall('slant'));
    const who2 = await page.textContent('.cs-who');
    check(who2.includes(`Player ${2 - poss}`) && who2.includes('defense'), `down ${n + 1}: then the defense (player ${2 - poss}) calls: "${who2.trim()}"`);
    await page.screenshot({ path: join(out, `2p-${n + 1}-2-defense-call.png`) });
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => window.__pb.L3.lp?.set && window.__pb.L3.flow === 'PRE_SNAP', null, { timeout: 60000 });
    const lp0 = await page.evaluate(() => { const lp = window.__pb.L3.lp; return { p2: !!lp.p2, c1: lp.control?.side, c2: lp.p2?.control?.side, o: lp.o }; });
    check(lp0.p2 && lp0.c1 && lp0.c2 && lp0.c1 !== lp0.c2, `down ${n + 1}: each player controls a Pokémon on their own side (P1 ${lp0.c1}, P2 ${lp0.c2})`);
    await page.waitForTimeout(400);
    // The defense's key doesn't snap; the offense's does.
    await page.keyboard.press(lp0.o === 0 ? 'Enter' : 'Space');
    await page.waitForTimeout(700);
    check(await page.evaluate(() => window.__pb.L3.lp.phase === 'pre'), `down ${n + 1}: the defense can't snap`);
    await page.screenshot({ path: join(out, `2p-${n + 1}-3-presnap.png`) });
    await page.keyboard.press(lp0.o === 0 ? 'Space' : 'Enter');
    await page.waitForFunction(() => window.__pb.L3.lp?.phase === 'live', null, { timeout: 20000 });
    // Both players steer at once: P1 holds D (right), P2 holds the left arrow.
    await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowLeft');
    // Hold until the play itself has run half a second (software rendering is slow).
    const t0 = await page.evaluate(() => window.__pb.L3.lp?.t ?? 0);
    await page.waitForFunction((t) => !window.__pb.L3.lp || window.__pb.L3.lp.phase !== 'live' || window.__pb.L3.lp.t > t + 0.5, t0, { timeout: 30000 });
    const live = await page.evaluate(() => { const lp = window.__pb.L3.lp; return { m1: lp.manual, m2: lp.p2?.manual, phase: lp.phase }; });
    await page.screenshot({ path: join(out, `2p-${n + 1}-4-live.png`) });
    await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowLeft');
    check(live.m1 && live.m2 || live.phase !== 'live', `down ${n + 1}: both players steer their own Pokémon in the same play (P1 ${live.m1}, P2 ${live.m2})`);
    // Throw with 1 (whoever has the ball) if it is still in the quarterback's hands.
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_RESULT' || window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `2p-${n + 1}-5-result.png`) });
  }
  if (page.errors.length) check(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// ---------- a gamepad, one player ----------
if (parts.includes('pad')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.addInitScript(FAKE_PAD);
  const page = await newPage(ctx);
  await page.goto(url);
  await page.evaluate(() => { window.__fake.on = true; window.dispatchEvent(new Event('gamepadconnected')); });
  // Menus: the D-pad moves focus, A presses. Walk to the quick game button.
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    await tap(page, 13);
    found = await page.evaluate(() => document.activeElement?.dataset?.act === 'quick');
  }
  check(found, 'D-pad moves focus through the home screen to the quick game button');
  await tap(page, 0);
  await page.waitForFunction(() => window.__pb?.stage && window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 90000 });
  await page.waitForSelector('#help-ov:not([hidden])', { timeout: 10000 });
  await tap(page, 0);
  check(await page.evaluate(() => document.getElementById('help-ov').hidden), 'A closes the controls card');
  // Make sure the user has the ball: if not, call a defense and let the play run first.
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_SELECTION' && document.querySelector('.callsheet'), null, { timeout: 120000 });
  const onOff = await page.evaluate(() => window.__pb.S.game.poss === 0);
  // Call sheet: RB turns the page, the D-pad picks a card, A calls it.
  const tab0 = await page.evaluate(() => document.querySelector('.cs-tab.on')?.dataset.tab);
  await tap(page, 5);
  const tab1 = await page.evaluate(() => document.querySelector('.cs-tab.on')?.dataset.tab);
  check(tab0 !== tab1, `RB turns the call sheet page (${tab0} to ${tab1})`);
  if (onOff) {
    // Find the Quick page with passes.
    for (let i = 0; i < 6 && (await page.evaluate(() => document.querySelector('.cs-tab.on')?.dataset.tab)) !== 'short'; i++) await tap(page, 5);
  }
  await tap(page, 15);
  const focused = await page.evaluate(() => document.activeElement?.dataset?.call ?? null);
  check(!!focused, `the D-pad focuses a play card (${focused})`);
  await tap(page, 0);
  await page.waitForFunction(() => window.__pb.L3.lp, null, { timeout: 30000 });
  const called = await page.evaluate(() => (window.__pb.S.game.poss === 0 ? window.__pb.L3.off : window.__pb.L3.def));
  check(called === focused, `A calls the focused play (${called})`);
  await page.waitForFunction(() => window.__pb.L3.lp?.set && window.__pb.L3.flow === 'PRE_SNAP', null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await tap(page, 0);
  await page.waitForFunction(() => window.__pb.L3.lp?.phase === 'live', null, { timeout: 20000 }).catch(() => {});
  check(await page.evaluate(() => window.__pb.L3.lp?.phase !== 'pre'), 'A snaps the ball');
  const tip = await page.textContent('#hud-tip');
  check(!/Space|Shift/.test(tip ?? ''), `the tips name the pad's buttons: "${tip}"`);
  // The stick steers the user's Pokémon.
  await page.evaluate(() => window.__stick(0.9, 0));
  await page.waitForTimeout(800);
  await polled(page, 6);
  check(await page.evaluate(() => window.__pb.L3.lp?.manual || window.__pb.L3.lp?.phase !== 'live'), 'the left stick takes over the user\'s Pokémon');
  await page.evaluate(() => window.__stick(0, 0));
  await page.screenshot({ path: join(out, 'pad-1-live.png') });
  if (onOff && called && (await page.evaluate(() => window.__pb.L3.lp?.kind === 'pass'))) {
    // B is receiver 2 while the quarterback has the ball.
    await tap(page, 1, 60);
    await page.waitForTimeout(600);
    const thrown = await page.evaluate(() => window.__pb.L3.lp?.thrown?.target?.slot ?? window.__pb.L3.committed?.text ?? null);
    check(!!thrown, `a face button throws (${thrown})`);
  }
  await page.waitForFunction(() => window.__pb.L3.flow === 'PLAY_RESULT' || window.__pb.L3.flow === 'PLAY_SELECTION', null, { timeout: 60000 });
  await page.screenshot({ path: join(out, 'pad-2-result.png') });
  if (page.errors.length) check(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// ---------- a challenge code ----------
if (parts.includes('challenge')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await newPage(ctx);
  await page.goto(url);
  await page.click('[data-panel="new"]');
  await page.fill('#f-name', 'Challengers');
  await page.click('#setup-form button[type="submit"]');
  await page.click('[data-act="autodraft"]');
  await page.waitForSelector('.grades', { timeout: 120000 });
  await page.click('[data-act="startseason"]');
  for (let i = 0; i < 2; i++) { await page.click('[data-act="simweek"]'); await page.waitForSelector('[data-act="simweek"]'); }
  await page.click('[data-act="share"]');
  const link = await page.inputValue('#share-link');
  check(/challenge/i.test(await page.textContent('.sharebox')), 'after two games the share box offers a challenge');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await newPage(ctx2);
  await page2.goto(url + link.slice(link.indexOf('#')));
  await page2.waitForSelector('.challenge-in');
  check(/Challengers \(PAL\) challenges you to beat .* through 2 games/.test(await page2.textContent('.challenge-in h2')), 'the challenge card names the sharer and their mark');
  await page2.screenshot({ path: join(out, 'challenge-0-card.png') });
  await page2.click('[data-act="shareload"][data-replay="0"]');
  await page2.click('[data-act="autodraft"]');
  await page2.waitForSelector('.grades', { timeout: 120000 });
  await page2.click('[data-act="startseason"]');
  check(/Their mark/.test(await page2.textContent('.card.challenge')), 'the season screen shows the challenge');
  for (let i = 0; i < 2; i++) { await page2.click('[data-act="simweek"]'); await page2.waitForSelector('[data-act="simweek"]'); }
  const done = await page2.evaluate(() => window.__pb.S.league.challenge.done?.state ?? null);
  check(['won', 'lost', 'tied'].includes(done) && (await page2.$('.card.challenge .verdict')) != null, `two games in, the challenge has a verdict (${done})`);
  await page2.locator('.card.challenge').screenshot({ path: join(out, 'challenge-1-verdict.png') });
  for (const p of [page, page2]) if (p.errors.length) check(false, `page errors: ${p.errors.slice(0, 3).join(' | ')}`);
  await ctx.close(); await ctx2.close();
}

// ---------- watch mode ----------
if (parts.includes('watch')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await newPage(ctx);
  await page.goto(`${url}?watch&seed=42`);
  await page.waitForFunction(() => window.__pb?.stage && window.__pb.S.gameMeta?.spectate, null, { timeout: 120000 });
  check(await page.evaluate(() => document.getElementById('help-ov')?.hidden !== false), 'watch: no controls card');
  let sheet = false;
  await page.waitForFunction(() => window.__pb.S.game.log.length >= 2 && window.__pb.L3.flow === 'LIVE_PLAY', null, { timeout: 240000 })
    .finally(async () => { sheet = await page.$('.callsheet') != null; });
  check(!sheet && (await page.$('.game.spectate .pill.spec')) != null, 'watch: plays run with no call sheet, under the Watching chip');
  await page.screenshot({ path: join(out, 'watch-0-live.png') });
  await page.keyboard.press('KeyO');
  await page.waitForSelector('.callsheet', { timeout: 240000 });
  await page.screenshot({ path: join(out, 'watch-1-takeover.png') });
  check(true, 'watch: O brings up the call sheet for the next down');
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => !window.__pb.S.takeOver && !document.querySelector('.callsheet'), null, { timeout: 30000 });
  check(true, 'watch: after the call the AI takes over again');
  if (page.errors.length) check(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify({ when: new Date().toISOString(), problems, notes }, null, 2));
console.log(`${notes.length} of ${notes.length + problems.length} checks passed`);
process.exit(problems.length ? 1 : 0);
