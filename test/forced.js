// Forced landscape: portrait touch viewports (iPhone Safari, in-app webviews with toolbars, rotation-locked phones)
// get the whole game rotated 90°, played with the phone held sideways. All input goes through real CDP touch events
// at physical (portrait) screen coordinates, so the rotation remap is exercised exactly like on a phone.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v3/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const DEV = [
  { tag: 'iphone14_390x844', w: 390, h: 844, dpr: 3, shots: true },
  { tag: 'inapp_webview_390x750', w: 390, h: 750, dpr: 3, shots: true, note: 'X/Grok-style in-app browser: top bar + bottom toolbar take ~94px' },
  { tag: 'iphoneSE_375x667', w: 375, h: 667, dpr: 2, shots: true },
  { tag: 'iphone15promax_430x932', w: 430, h: 932, dpr: 3 },
  { tag: 'pixel7_412x915', w: 412, h: 915, dpr: 2.625 },
];
(async () => {
  const b = await chromium.launch();
  for (const d of DEV) {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.text()));
    const cdp = await ctx.newCDPSession(p);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    // physical tap at the centre of an element (element boxes are rotated; centre of the bbox is still the centre)
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2; await touch('touchStart', [[x, y]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(120); };
    // app (landscape) coordinates -> physical portrait coordinates: inverse of toApp
    const phys = (ax, ay) => p.evaluate(([ax, ay]) => { for (let sx = 0; sx < 2; sx++); const f = window.__pb.forced; const vw = innerWidth; return f ? [vw - ay, ax] : [ax, ay]; }, [ax, ay]);
    await p.goto(BASE); await p.waitForTimeout(600);
    let v = await p.evaluate(() => ({ forced: __pb.forced, W: __pb.view.W, H: __pb.view.H, rot: !document.getElementById('rot').classList.contains('hide'), cls: document.body.className }));
    ok(v.forced && v.W > v.H && v.W === d.h && v.H === d.w && !v.rot, `[${d.tag}] portrait touch viewport -> forced landscape app ${v.W}x${v.H}, no blocker (${v.cls})`);
    // whole menu fits inside the physical screen
    const mb = await p.locator('#menu .card').boundingBox();
    ok(mb.x >= -1 && mb.y >= -1 && mb.x + mb.width <= d.w + 1 && mb.y + mb.height <= d.h + 1 && mb.height > mb.width, `[${d.tag}] menu card rotated & on screen (${Math.round(mb.width)}x${Math.round(mb.height)} physical)`);
    if (d.shots) await p.screenshot({ path: SHOT + `forced_menu_${d.tag}.png` });
    await p.fill('#nick', '峻慶');
    await tapEl('#bS2'); await p.waitForTimeout(900);
    v = await p.evaluate(() => ({ st: __pb.state, forced: __pb.forced, touch: __pb.view.touchUI }));
    ok(v.st === 'play' && v.forced && v.touch, `[${d.tag}] touch tap on 雙打 (physical coords) started the match, touch UI on`);
    // geometry in app coordinates: court fully visible, buttons outside the court
    const g = await p.evaluate(() => {
      const v = __pb.view, C = PB.C, pr = (x, y) => __pb.proj(x, y, 0);
      const poly = [pr(-C.HL, -C.HW), pr(C.HL, -C.HW), pr(C.HL, C.HW), pr(-C.HL, C.HW)];
      const inPoly = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
      const rects = [...document.querySelectorAll('#btns .tb')].map((e) => __pb.appRect(e)).filter((r) => r.width > 0);
      let overlap = 0, outside = 0; for (const r of rects) { if (r.left < 0 || r.top < 0 || r.left + r.width > v.W + 1 || r.top + r.height > v.H + 1) outside++; for (let i = 0; i <= 6; i++) for (let k = 0; k <= 6; k++) { const x = r.left + r.width * i / 6, y = r.top + r.height * k / 6, dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2); if (dx * dx / (r.width * r.width / 4) + dy * dy / (r.height * r.height / 4) <= 1 && inPoly(x, y)) overlap++; } }
      return { W: v.W, H: v.H, cw: Math.round(Math.max(...xs) - Math.min(...xs)), on: Math.min(...xs) >= 0 && Math.max(...xs) <= v.W && Math.min(...ys) >= 0 && Math.max(...ys) <= v.H, overlap, outside, n: rects.length };
    });
    ok(g.on && g.overlap === 0 && g.outside === 0 && g.n === 3 && g.cw >= g.W * 0.55, `[${d.tag}] court ${g.cw}px wide (of ${g.W}), fully visible, 3 buttons on screen, 0 overlap`);
    // joystick: drag "right" and "up" in the sideways-held frame using physical touch points
    const me = () => p.evaluate(() => { const q = __pb.m.players[__pb.seat]; const s = __pb.proj(q.x, q.y, 0); return { sx: s[0], sy: s[1] }; });
    const drag = async (dx, dy, ms) => { const [x0, y0] = await phys(110, g.H - 90); const [x1, y1] = await phys(110 + dx, g.H - 90 + dy); await touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 5; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5]]); await p.waitForTimeout(20); } await p.waitForTimeout(ms); await touch('touchEnd', []); };
    await p.waitForFunction(() => __pb.m.phase === 'rally' || __pb.m.phase === 'serve', null, { timeout: 5000 });
    let a = await me(); await drag(0, -55, 600); let c = await me();
    ok(c.sy < a.sy - 8, `[${d.tag}] pad drag up (as held sideways) moves player up on the landscape screen (${Math.round(a.sy)} -> ${Math.round(c.sy)})`);
    a = await me(); await drag(0, 55, 600); c = await me();
    ok(c.sy > a.sy + 8, `[${d.tag}] pad drag down moves player down (${Math.round(a.sy)} -> ${Math.round(c.sy)})`);
    a = await me(); await drag(55, 0, 500); c = await me();
    ok(c.sx > a.sx + 4, `[${d.tag}] pad drag right moves player right toward the net (${Math.round(a.sx)} -> ${Math.round(c.sx)})`);
    // shot button by physical tap
    const t0 = await p.evaluate(() => __pb.m.players[__pb.seat].in.shotT);
    await tapEl('#tbDrive'); const t1 = await p.evaluate(() => __pb.m.players[__pb.seat].in.shotT);
    ok(t1 > t0, `[${d.tag}] 抽球 physical tap registered`);
    await tapEl('#tbLob'); const t2 = await p.evaluate(() => [__pb.m.players[__pb.seat].in.shotT, __pb.m.players[__pb.seat].in.shot]);
    ok(t2[0] > t1 && t2[1] === 'lob', `[${d.tag}] 高吊 physical tap registered`);
    if (d.shots) await p.screenshot({ path: SHOT + `forced_play_2v2_${d.tag}.png` });
    // in-app / Safari toolbars showing & hiding
    for (const hh of [d.h - 70, d.h - 120, d.h]) { await p.setViewportSize({ width: d.w, height: hh }); await p.waitForTimeout(350); }
    v = await p.evaluate(() => ({ W: __pb.view.W, H: __pb.view.H, f: __pb.forced, fps: __pb.fps }));
    ok(v.f && v.W === d.h && v.H === d.w, `[${d.tag}] toolbar show/hide: app follows (${v.W}x${v.H})`);
    // the device really rotates (rotation lock off) -> normal landscape, then back to portrait -> forced again
    await p.setViewportSize({ width: d.h, height: d.w }); await p.waitForTimeout(400);
    v = await p.evaluate(() => ({ W: __pb.view.W, H: __pb.view.H, f: __pb.forced, st: __pb.state }));
    ok(!v.f && v.W === d.h && v.st === 'play', `[${d.tag}] real landscape rotation mid-match: unrotated ${v.W}x${v.H}, still playing`);
    await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(400);
    const h0 = await p.evaluate(() => __pb.m.t); await p.waitForTimeout(500);
    v = await p.evaluate(() => ({ W: __pb.view.W, f: __pb.forced, t: __pb.m.t }));
    ok(v.f && v.W === d.h && v.t > h0, `[${d.tag}] back to portrait: forced again, loop alive`);
    // toggle: off -> old prompt shows; turn it back on from the prompt
    await tapEl('#hud #bMenu, #bMenu').catch(() => {}); await p.waitForTimeout(300);
    await p.evaluate(() => { if (__pb.state !== 'menu') { const q = document.getElementById('bQuit'); q && q.click(); } }); await p.waitForTimeout(500);
    if (await p.locator('#menu').isVisible()) {
      await tapEl('#bForce');
      v = await p.evaluate(() => ({ f: __pb.forced, rot: !document.getElementById('rot').classList.contains('hide') }));
      ok(!v.f && v.rot, `[${d.tag}] toggle off -> unrotated, 「請將手機橫放」 prompt with 轉成橫向畫面 button`);
      if (d.shots) await p.screenshot({ path: SHOT + `forced_toggle_off_prompt_${d.tag}.png` });
      await tapEl('#bRotForce'); await p.waitForTimeout(400);
      v = await p.evaluate(() => ({ f: __pb.forced, rot: !document.getElementById('rot').classList.contains('hide') }));
      ok(v.f && !v.rot, `[${d.tag}] 轉成橫向畫面 button re-enables forced landscape`);
    } else ok(false, `[${d.tag}] could not get back to the menu`);
    ok(!errs.length, `[${d.tag}] no console errors/warnings ${errs.join(' | ')}`);
    await ctx.close();
  }
  // autopilot play in forced mode
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '?auto=1'); await p.fill('#nick', '峻慶'); await p.tap('#bS1'); await p.waitForTimeout(12000);
    const s = await p.evaluate(() => ({ f: __pb.forced, hits: Object.values(__pb.hitCount).reduce((a, b) => a + b, 0), sc: __pb.m.score, fps: Math.round(__pb.fps) }));
    ok(s.f && s.hits >= 4 && !errs.length, `[iphone14 forced] 12s 1v1 rally: ${JSON.stringify(s)}`); await p.screenshot({ path: SHOT + 'forced_play_1v1_rally_iphone14_390x844.png' }); await ctx.close(); }
  // desktop narrow window (no touch) must NOT rotate
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); await p.goto(BASE); await p.waitForTimeout(400);
    const f = await p.evaluate(() => __pb.forced); ok(!f, '[desktop narrow window, mouse] not rotated'); await ctx.close(); }
  console.log(fails ? `FORCED LANDSCAPE: ${fails} FAILED` : 'FORCED LANDSCAPE: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
