// Real-phone landscape checks: hasTouch/isMobile/high DPR, several iPhone/Android sizes, rotation before and during a match, address-bar height changes.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const OUT = process.env.OUT || '/workspace/pickleball-shots/v2/';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const DEV = [
  { tag: 'iphone14_844x390', w: 844, h: 390, dpr: 3, ua: UA_IOS, shots: 1 },
  { tag: 'iphoneSE_667x375', w: 667, h: 375, dpr: 2, ua: UA_IOS, shots: 1 },
  { tag: 'iphone15promax_932x430', w: 932, h: 430, dpr: 3, ua: UA_IOS },
  { tag: 'pixel7_915x412', w: 915, h: 412, dpr: 2.625, ua: UA_AND },
  { tag: 'galaxyS8_740x360', w: 740, h: 360, dpr: 3, ua: UA_AND },
];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const geom = (p) => p.evaluate(() => {
  const v = __pb.view, C = PB.C, pr = (x, y) => __pb.proj(x, y, 0);
  const cs = [[-C.HL, -C.HW], [C.HL, -C.HW], [C.HL, C.HW], [-C.HL, C.HW]].map(([x, y]) => pr(x, y));
  const court = { l: Math.min(...cs.map((q) => q[0])), r: Math.max(...cs.map((q) => q[0])), t: Math.min(...cs.map((q) => q[1])), b: Math.max(...cs.map((q) => q[1])) };
  const rects = [...document.querySelectorAll('#btns .tb')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
  // does any visible button overlap the court polygon? sample button rect points against the court trapezoid
  const inPoly = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const a = cs[i], b = cs[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  let overlap = 0; for (const r of rects) for (let i = 0; i <= 6; i++) for (let k = 0; k <= 6; k++) { const x = r.left + r.width * i / 6, y = r.top + r.height * k / 6; const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2); if (dx * dx / (r.width * r.width / 4) + dy * dy / (r.height * r.height / 4) <= 1 && inPoly(x, y)) overlap++; }
  const jb = document.getElementById('joyBase').getBoundingClientRect();
  return { W: v.W, H: v.H, F: +v.F.toFixed(1), touch: v.touchUI, courtW: Math.round(court.r - court.l), courtH: Math.round(court.b - court.t), court, overlap, btns: rects.length, cv: [document.getElementById('cv').width, document.getElementById('cv').height], cssH: document.getElementById('cv').getBoundingClientRect().height, joy: [Math.round(jb.left), Math.round(jb.top)], rot: !document.getElementById('rot').classList.contains('hide'), state: __pb.state };
});
const alive = async (p) => { const a = await p.evaluate(() => __pb.m ? __pb.m.t : performance.now() / 1000); await p.waitForTimeout(400); const b = await p.evaluate(() => __pb.m ? __pb.m.t : performance.now() / 1000); return b > a; };
(async () => {
  const browser = await chromium.launch();
  for (const d of DEV) {
    const errs = [];
    // start in PORTRAIT like a real phone held upright, then rotate
    const ctx = await browser.newContext({ viewport: { width: d.h, height: d.w }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()); });
    await p.goto(BASE + '?fps=1'); await p.waitForTimeout(500);
    let g = await geom(p); ok(g.rot, `[${d.tag}] portrait shows rotate prompt`);
    if (d.shots) await p.screenshot({ path: OUT + `portrait_rotate_prompt_${d.tag}.png` });
    // rotate to landscape (before match)
    await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(400);
    g = await geom(p); ok(!g.rot && g.W === d.w && g.H === d.h, `[${d.tag}] rotated to landscape: prompt hidden, canvas ${g.W}x${g.H} (backing ${g.cv})`);
    if (d.shots) await p.screenshot({ path: OUT + `menu_${d.tag}.png` });
    await p.fill('#nick', '峻慶'); await p.tap('#bS2'); await p.waitForTimeout(1500);
    g = await geom(p);
    ok(g.touch && g.btns === 3, `[${d.tag}] touch controls visible (${g.btns} buttons)`);
    ok(g.overlap === 0, `[${d.tag}] shot buttons do not cover the court (overlap samples ${g.overlap})`);
    ok(g.courtW >= d.w * 0.55, `[${d.tag}] court ${g.courtW}x${g.courtH}px (>=55% of width)`);
    ok(g.court.l > 0 && g.court.r < d.w && g.court.t > 40 && g.court.b < d.h, `[${d.tag}] court fully on screen ${JSON.stringify(g.court, (k, v) => typeof v === 'number' ? Math.round(v) : v)}`);
    if (d.shots) await p.screenshot({ path: OUT + `play_2v2_${d.tag}.png` });
    // play with touch: drag the move pad (touch pointer events) and tap the shot buttons
    const y0 = await p.evaluate(() => __pb.m.players[0].y);
    const jz = await p.$('#joyZone'); const bb = await jz.boundingBox();
    const sx = bb.x + 60, sy = bb.y + bb.height - 70;
    await p.dispatchEvent('#joyZone', 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: sx, clientY: sy, isPrimary: true });
    await p.dispatchEvent('#joyZone', 'pointermove', { pointerId: 7, pointerType: 'touch', clientX: sx, clientY: sy - 50, isPrimary: true });
    await p.waitForTimeout(500);
    await p.dispatchEvent('#joyZone', 'pointerup', { pointerId: 7, pointerType: 'touch', clientX: sx, clientY: sy - 50, isPrimary: true });
    const y1 = await p.evaluate(() => __pb.m.players[0].y);
    ok(Math.abs(y1 - y0) > 0.5, `[${d.tag}] move pad drag moves the player (y ${y0.toFixed(2)} -> ${y1.toFixed(2)})`);
    await p.tap('#tbDrive'); await p.waitForTimeout(300); await p.tap('#tbDink'); await p.tap('#tbLob'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => __pb.m.phase !== undefined), `[${d.tag}] shot buttons tappable`);
    // address bar hide/show: height changes
    for (const hh of [d.h - 50, d.h, d.h - 50, d.h]) { await p.setViewportSize({ width: d.w, height: hh }); await p.waitForTimeout(200); }
    g = await geom(p); ok(g.H === d.h && g.overlap === 0 && Math.abs(g.cssH - d.h) < 1, `[${d.tag}] address-bar show/hide x2: canvas follows (${g.H}px, css ${g.cssH}px)`);
    ok(await alive(p), `[${d.tag}] game loop alive after address-bar changes`);
    // rotate mid-match: landscape -> portrait -> landscape, repeated, plus the tester's 667x375 -> 1888x1030 jump
    for (let k = 0; k < 3; k++) { await p.setViewportSize({ width: d.h, height: d.w }); await p.waitForTimeout(250); await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(250); }
    await p.setViewportSize({ width: 1888, height: 1030 }); await p.waitForTimeout(250); await p.setViewportSize({ width: 300, height: 20 }); await p.waitForTimeout(150); await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(400);
    g = await geom(p); ok(!g.rot && g.overlap === 0 && g.courtW >= d.w * 0.55, `[${d.tag}] after 3 mid-match rotations + extreme resizes: court ${g.courtW}px, no overlap`);
    ok(await alive(p), `[${d.tag}] game loop alive after rotations`);
    if (d.shots) await p.screenshot({ path: OUT + `play_after_rotation_${d.tag}.png` });
    // autopilot match in landscape to confirm the game plays out
    await p.goto(BASE + '?auto=1'); await p.fill('#nick', '峻慶'); await p.tap('#bS1'); await p.waitForTimeout(12000);
    const s = await p.evaluate(() => ({ score: __pb.m.score, rallies: __pb.m.stats.rallies.length, hits: Object.values(__pb.hitCount).reduce((a, b) => a + b, 0) }));
    ok(s.rallies >= 1 && s.hits >= 2, `[${d.tag}] autopilot 1v1 in landscape: ${JSON.stringify(s)}`);
    if (d.shots) await p.screenshot({ path: OUT + `play_1v1_rally_${d.tag}.png` });
    ok(errs.length === 0, `[${d.tag}] no console errors/warnings ${errs.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  console.log(fails ? `LANDSCAPE: ${fails} FAILED` : 'LANDSCAPE: ALL PASSED');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
