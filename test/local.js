const { chromium, devices } = require('playwright');
const BASE = 'http://localhost:8077/index.html';
const OUT = __dirname + '/shots/';
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const mk = async (opts) => { const ctx = await browser.newContext(opts); const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); return p; };
  // mobile landscape
  const mob = await mk({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mob.goto(BASE + '?fps=1'); await mob.waitForTimeout(800);
  await mob.screenshot({ path: OUT + 'menu_mobile.png' });
  await mob.fill('#nick', '峻慶');
  await mob.goto(BASE + '?auto=1&fps=1'); await mob.fill('#nick', '峻慶');
  await mob.tap('#bS1'); await mob.waitForTimeout(9000);
  await mob.screenshot({ path: OUT + 'play_1v1_mobile.png' });
  let s = await mob.evaluate(() => ({ score: __pb.m.score, phase: __pb.m.phase, t: __pb.m.t, fps: __pb.fps, stats: __pb.m.stats }));
  console.log('1v1 mobile after 9s:', JSON.stringify(s));
  // 2v2 desktop
  const desk = await mk({ viewport: { width: 1280, height: 720 } });
  await desk.goto(BASE + '?auto=1&fps=1'); await desk.waitForTimeout(500);
  await desk.screenshot({ path: OUT + 'menu_desktop.png' });
  await desk.fill('#nick', '峻慶'); await desk.click('#bS2'); await desk.waitForTimeout(1200);
  await desk.screenshot({ path: OUT + 'play_2v2_serve_desktop.png' });
  await desk.waitForTimeout(10000);
  await desk.screenshot({ path: OUT + 'play_2v2_rally_desktop.png' });
  s = await desk.evaluate(() => ({ score: __pb.m.score, call: document.getElementById('call').textContent, fps: __pb.fps, stats: __pb.m.stats }));
  console.log('2v2 desktop after 11s:', JSON.stringify(s));
  // run the 2v2 game to completion quickly using a fast-forward in page (same code path as the game loop step)
  const fin = await desk.evaluate(async () => { const m = __pb.m; let n = 0; while (m.phase !== 'over' && n < 200000) { PB.step(m, 1 / 60); n++; } return { score: m.score, winner: m.winner, n }; });
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: OUT + 'end_desktop.png' });
  console.log('2v2 fast-forward end:', JSON.stringify(fin), 'state=', await desk.evaluate(() => __pb.state));
  // rules overlay
  await desk.goto(BASE); await desk.click('#bRules'); await desk.waitForTimeout(300); await desk.screenshot({ path: OUT + 'rules_desktop.png' });
  // keyboard manual play: serve with J and move
  await desk.click('#bRulesOk'); await desk.click('#bS1'); await desk.waitForTimeout(1500);
  const before = await desk.evaluate(() => ({ ph: __pb.m.phase, srv: __pb.m.server, x: __pb.m.players[0].y }));
  await desk.keyboard.down('KeyW'); await desk.waitForTimeout(400); await desk.keyboard.up('KeyW');
  await desk.keyboard.press('KeyJ'); await desk.waitForTimeout(300);
  const after = await desk.evaluate(() => ({ ph: __pb.m.phase, y: __pb.m.players[0].y, hits: __pb.m.hits }));
  console.log('keyboard test before', JSON.stringify(before), 'after', JSON.stringify(after));
  console.log('console errors/warnings:', errs.length ? errs : 'none');
  await browser.close();
})();
