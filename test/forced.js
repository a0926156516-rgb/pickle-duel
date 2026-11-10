// 橫向 mode (v5): menu 「畫面 直向／橫向」, saved in localStorage. On a phone held upright (rotation lock / in-app webview) the
// landscape layout is drawn rotated 90° with CSS. All input here is real CDP touch at PHYSICAL (portrait) screen coordinates,
// so the touch remapping is exercised exactly like on a phone. Also: toolbar/visualViewport resize, real rotation, online play.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v5/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const DEV = [
  { tag: 'iphone14_390x844', w: 390, h: 844, dpr: 3, shots: true },
  { tag: 'inapp_webview_390x750', w: 390, h: 750, dpr: 3 },
  { tag: 'iphoneSE_375x667', w: 375, h: 667, dpr: 2, shots: true },
  { tag: 'pixel7_412x915', w: 412, h: 915, dpr: 2.625 },
];
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (d, tag) => {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr || 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`)); p.on('console', (m) => (m.type() === 'error') && errs.push(`[${tag}] ${m.text()}`));
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(150); };
    const phys = (ax, ay) => p.evaluate(([ax, ay]) => { const f = __pb.forced, pw = document.documentElement.clientWidth; return f ? [pw - ay, ax] : [ax, ay]; }, [ax, ay]);
    return { ctx, p, touch, tapEl, phys };
  };
  for (const d of DEV) {
    const { p, touch, tapEl, phys } = await mk(d, d.tag);
    await p.goto(BASE); await p.waitForTimeout(400);
    let v = await p.evaluate(() => ({ f: __pb.forced, o: __pb.orient, W: __pb.view.W, H: __pb.view.H }));
    ok(!v.f && v.o === 'port' && v.W === d.w, `[${d.tag}] default is 直向 (not rotated, ${v.W}x${v.H})`);
    await tapEl('#segOrient button[data-v="land"]'); await p.waitForTimeout(500);
    v = await p.evaluate(() => ({ f: __pb.forced, W: __pb.view.W, H: __pb.view.H, ls: localStorage.pbOrient, cls: document.body.className }));
    ok(v.f && v.W === d.h && v.H === d.w && v.ls === 'land', `[${d.tag}] tap 橫向 -> rotated landscape app ${v.W}x${v.H}, saved (pbOrient=${v.ls})`);
    await p.reload(); await p.waitForTimeout(500);
    v = await p.evaluate(() => ({ f: __pb.forced, sel: document.querySelector('#segOrient .sel').dataset.v }));
    ok(v.f && v.sel === 'land', `[${d.tag}] after reload still 橫向 (button ${v.sel})`);
    const mb = await p.locator('#menu .card').boundingBox();
    ok(mb.x >= -1 && mb.y >= -1 && mb.x + mb.width <= d.w + 1 && mb.y + mb.height <= d.h + 1 && mb.height > mb.width, `[${d.tag}] menu rotated and fully on screen (${mb.width | 0}x${mb.height | 0} physical)`);
    if (d.shots) await p.screenshot({ path: SHOT + `landscape_mode_menu_${d.tag}.png` });
    await p.fill('#nick', '峻慶'); await tapEl('#bS2'); await p.waitForTimeout(900);
    v = await p.evaluate(() => ({ st: __pb.state, tu: __pb.view.touchUI, port: __pb.view.port }));
    ok(v.st === 'play' && v.tu && !v.port, `[${d.tag}] physical tap on 雙打 started the match in the landscape layout, touch UI on`);
    const g = await p.evaluate(() => { const v = __pb.view, C = PB.C, pr = (x, y) => __pb.proj(x, y, 0);
      const poly = [pr(-C.HL, -C.HW), pr(C.HL, -C.HW), pr(C.HL, C.HW), pr(-C.HL, C.HW)], xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
      const rects = [...document.querySelectorAll('.tb')].map((e) => __pb.appRect(e)).filter((r) => r.width > 0);
      const out = rects.filter((r) => r.left < 0 || r.top < 0 || r.right > v.W + 1 || r.bottom > v.H + 1).length;
      return { cw: Math.round(Math.max(...xs) - Math.min(...xs)), on: Math.min(...xs) >= 0 && Math.max(...xs) <= v.W && Math.min(...ys) >= 0 && Math.max(...ys) <= v.H, n: rects.length, out, W: v.W }; });
    ok(g.on && g.n === 4 && g.out === 0 && g.cw >= g.W * 0.55, `[${d.tag}] court ${g.cw}px of ${g.W} fully visible, 4 buttons on screen`);
    if (d.shots) { await p.waitForTimeout(1500); await p.screenshot({ path: SHOT + `landscape_mode_play_2v2_${d.tag}.png` }); }
    // joystick drags in the sideways-held frame (app directions), sent as physical touches
    const me = () => p.evaluate(() => { const q = __pb.m.players[__pb.seat]; const s = __pb.proj(q.x, q.y, 0); return { sx: s[0], sy: s[1] }; });
    const jc = await p.evaluate(() => { const r = __pb.appRect(document.getElementById('joyBase')); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const drag = async (dx, dy, ms) => { const [x0, y0] = await phys(jc[0], jc[1]); const [x1, y1] = await phys(jc[0] + dx, jc[1] + dy); await touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 5; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5]]); await p.waitForTimeout(20); } await p.waitForTimeout(ms); await touch('touchEnd', []); await p.waitForTimeout(150); };
    for (const [dx, dy, name, chk] of [[0, -55, 'up', (a, c) => c.sy < a.sy - 8], [0, 55, 'down', (a, c) => c.sy > a.sy + 8], [55, 0, 'right', (a, c) => c.sx > a.sx + 4], [-55, 0, 'left', (a, c) => c.sx < a.sx - 4]]) {
      const a = await me(); await drag(dx, dy, 550); const c = await me();
      ok(chk(a, c), `[${d.tag}] joystick ${name} (as held sideways) moves the player ${name} on the landscape screen (${a.sx | 0},${a.sy | 0} -> ${c.sx | 0},${c.sy | 0})`);
    }
    const jr = await p.evaluate(() => { const r = __pb.appRect(document.getElementById('joyBase')), v = __pb.view; return r.left >= 0 && r.top >= 0 && r.right <= v.W && r.bottom <= v.H && r.width > 60; });
    ok(jr, `[${d.tag}] joystick ring back home on screen after the drags`);
    const s0 = await p.evaluate(() => __pb.m.players[__pb.seat].in.shotT); await tapEl('#tbLob');
    const s1 = await p.evaluate(() => ({ t: __pb.m.players[__pb.seat].in.shotT, s: __pb.m.players[__pb.seat].in.shot }));
    ok(s1.t !== s0 && s1.s === 'lob', `[${d.tag}] physical tap on 高吊 registers a lob`);
    // in-app toolbar appears / disappears (visualViewport height change) without reload
    await p.setViewportSize({ width: d.w, height: d.h - 94 }); await p.waitForTimeout(600);
    v = await p.evaluate(() => ({ f: __pb.forced, W: __pb.view.W, H: __pb.view.H, ok: (() => { const r = __pb.appRect(document.getElementById('tbDrive')); return r.right <= __pb.view.W + 1 && r.bottom <= __pb.view.H + 1; })() }));
    ok(v.f && v.W === d.h - 94 && v.H === d.w && v.ok, `[${d.tag}] toolbar shown (viewport ${d.w}x${d.h - 94}) -> app re-fits ${v.W}x${v.H}, buttons on screen`);
    await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(600);
    // phone really turned sideways: no rotation, plain landscape layout
    await p.setViewportSize({ width: d.h, height: d.w }); await p.waitForTimeout(600);
    v = await p.evaluate(() => ({ f: __pb.forced, W: __pb.view.W, H: __pb.view.H, cls: document.body.classList.contains('forced') }));
    ok(!v.f && !v.cls && v.W === d.h, `[${d.tag}] device actually landscape -> normal landscape, no CSS rotation (${v.W}x${v.H})`);
    const a2 = await me(); { const jc2 = await p.evaluate(() => { const r = document.getElementById('joyBase').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await touch('touchStart', [[jc2[0], jc2[1]]]); for (let i = 1; i <= 5; i++) { await touch('touchMove', [[jc2[0], jc2[1] - 11 * i]]); await p.waitForTimeout(20); } await p.waitForTimeout(500); await touch('touchEnd', []); }
    const c2 = await me(); ok(c2.sy < a2.sy - 8, `[${d.tag}] unrotated landscape joystick up still moves up (${a2.sy | 0} -> ${c2.sy | 0})`);
    await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(600);
    ok(await p.evaluate(() => __pb.forced && __pb.state === 'play'), `[${d.tag}] back upright -> rotated again, match still running`);
    // back to 直向 from the pause menu path: go to menu and tap 直向
    await p.evaluate(() => { localStorage.pbOrient = 'port'; }); await p.reload(); await p.waitForTimeout(400);
    ok(await p.evaluate(() => !__pb.forced && __pb.view.port), `[${d.tag}] 直向 again -> normal portrait layout`);
    await p.context().close();
  }
  // online: host plays in 橫向 on an upright phone, guest in 直向; touch input from the rotated host reaches the match
  { const H = await mk({ w: 390, h: 844, dpr: 3 }, 'host'), G = await mk({ w: 390, h: 844, dpr: 3 }, 'guest');
    await H.p.goto(BASE + '?orient=land&server=' + encodeURIComponent(SERVER)); await H.p.fill('#nick', '橫房主');
    await G.p.goto(BASE + '?server=' + encodeURIComponent(SERVER)); await G.p.fill('#nick', '直來賓');
    await H.tapEl('#bHost'); await H.p.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
    const code = await H.p.evaluate(() => document.getElementById('rcode').textContent);
    await H.p.screenshot({ path: SHOT + 'landscape_mode_room_host_390x844.png' });
    await G.p.fill('#code', code); await G.tapEl('#bJoin'); await H.p.waitForFunction(() => __pb.roster.length >= 2, null, { timeout: 30000 }); await H.p.waitForTimeout(600);
    await H.tapEl('#bStart'); await G.p.waitForFunction(() => __pb.state === 'play', null, { timeout: 30000 });
    const hv = await H.p.evaluate(() => ({ f: __pb.forced, port: __pb.view.port })), gv = await G.p.evaluate(() => ({ f: __pb.forced, port: __pb.view.port }));
    ok(hv.f && !hv.port && !gv.f && gv.port, `[online] host rotated landscape, guest normal portrait`);
    // guest (portrait, joystick) and host (rotated) both move with touch
    const meH = () => H.p.evaluate(() => { const q = __pb.m.players[__pb.seat]; return { x: q.x, y: q.y }; });
    await H.p.waitForFunction(() => __pb.m.phase === 'rally' || __pb.m.phase === 'serve', null, { timeout: 10000 });
    const jc = await H.p.evaluate(() => { const r = __pb.appRect(document.getElementById('joyBase')); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const a = await meH(); const [x0, y0] = await H.phys(jc[0], jc[1]); const [x1, y1] = await H.phys(jc[0], jc[1] - 55);
    await H.touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 5; i++) { await H.touch('touchMove', [[x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5]]); await H.p.waitForTimeout(20); } await H.p.waitForTimeout(600); await H.touch('touchEnd', []);
    const c = await meH(); ok(Math.hypot(c.x - a.x, c.y - a.y) > 0.4, `[online] rotated host moves with the joystick (${a.x.toFixed(2)},${a.y.toFixed(2)} -> ${c.x.toFixed(2)},${c.y.toFixed(2)})`);
    await H.p.waitForTimeout(1500);
    const [sh, sg] = await Promise.all([H.p.evaluate(() => { const q = __pb.m.players[__pb.seat]; return [q.x, q.y]; }), G.p.evaluate((s) => { const q = __pb.m.players[s]; return [q.x, q.y]; }, await H.p.evaluate(() => __pb.seat))]);
    ok(Math.hypot(sh[0] - sg[0], sh[1] - sg[1]) < 0.6, `[online] guest sees the rotated host where the host is (${sh.map((v) => v.toFixed(2))} vs ${sg.map((v) => v.toFixed(2))})`);
    await H.p.waitForTimeout(6000);
    const [ph, pg] = await Promise.all([H.p.evaluate(() => __pb.m.score.join('-') + '/' + __pb.m.point), G.p.evaluate(() => __pb.m.score.join('-') + '/' + __pb.m.point)]);
    ok(ph === pg, `[online] score agrees (${ph} / ${pg})`);
    await H.p.screenshot({ path: SHOT + 'landscape_mode_online_host_390x844.png' }); await G.p.screenshot({ path: SHOT + 'landscape_mode_online_guest_portrait_390x844.png' });
  }
  ok(!errs.length, 'no console errors ' + errs.join(' | '));
  console.log(fails ? `LANDSCAPE MODE: ${fails} FAILED` : 'LANDSCAPE MODE: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
