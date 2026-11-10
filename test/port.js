// Portrait (primary layout since v3a): phone upright, court vertical, net horizontal, own team at the bottom,
// controls below the court. Real CDP touch events at screen coordinates, iPhone/Android/in-app-webview sizes,
// address-bar/toolbar changes, rotation to landscape and back mid-match, and online: every client sees its own team at the bottom.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v4/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const DEV = [
  { tag: 'iphone14_390x844', w: 390, h: 844, dpr: 3, shots: true },
  { tag: 'iphoneSE_375x667', w: 375, h: 667, dpr: 2, shots: true },
  { tag: 'inapp_webview_390x750', w: 390, h: 750, dpr: 3, shots: true },
  { tag: 'iphone15promax_430x932', w: 430, h: 932, dpr: 3 },
  { tag: 'pixel7_412x915', w: 412, h: 915, dpr: 2.625 },
  { tag: 'galaxyS8_360x740', w: 360, h: 740, dpr: 3 },
];
const geom = (p) => p.evaluate(() => {
  const v = __pb.view, C = PB.C, pr = (x, y, z) => __pb.proj(x, y, z || 0);
  const poly = [pr(-C.HL, -C.HW), pr(C.HL, -C.HW), pr(C.HL, C.HW), pr(-C.HL, C.HW)];
  const inPoly = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const xs = poly.map((q) => q[0] - v.pan), ys = poly.map((q) => q[1]); // camera pan removed: the court is framed at rest, the pan follows the ball
  const els = [...document.querySelectorAll('#btns .tb'), document.getElementById('joyBase')].filter((e) => e.offsetParent || e.id === 'joyBase');
  let overlap = 0; for (const e of els) { const r = e.getBoundingClientRect(); for (let i = 0; i <= 8; i++) for (let k = 0; k <= 8; k++) { const x = r.left + r.width * i / 8, y = r.top + r.height * k / 8, dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2); if (dx * dx / (r.width * r.width / 4) + dy * dy / (r.height * r.height / 4) <= 1 && inPoly(x, y)) overlap++; } }
  const hud = document.getElementById('board').getBoundingClientRect();
  const net = pr(0, 0, 0)[1]; const me = __pb.m && __pb.m.players[__pb.seat]; const mine = me ? pr(me.x, me.y)[1] : null;
  const names = [...document.querySelectorAll('#board .nm')].map((e) => e.scrollWidth <= e.clientWidth + 1);
  return { pan: Math.round(v.pan), W: v.W, H: v.H, port: v.port, touch: v.touchUI, cw: Math.round(Math.max(...xs) - Math.min(...xs)), ch: Math.round(Math.max(...ys) - Math.min(...ys)), on: Math.min(...xs) >= 0 && Math.max(...xs) <= v.W && Math.min(...ys) >= hud.bottom - 2 && Math.max(...ys) <= v.H, overlap, n: els.length, netH: Math.abs(poly[0][1] - poly[3][1]) < 1 && Math.abs(poly[1][1] - poly[2][1]) < 1, meBelowNet: mine == null ? null : mine > net, namesFit: names.every(Boolean), cssH: document.getElementById('cv').getBoundingClientRect().height, rot: !!document.getElementById('rot') };
});
(async () => {
  const b = await chromium.launch();
  for (const d of DEV) {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.text()));
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(150); };
    await p.goto(BASE); await p.waitForTimeout(500);
    let g = await geom(p);
    ok(g.port && !g.rot, `[${d.tag}] upright phone: portrait layout, no 「請將手機橫放」 blocker`);
    const mb = await p.locator('#menu .card').boundingBox(); const sc = await p.evaluate(() => { const c = document.querySelector('#menu .card'); return c.scrollHeight <= c.clientHeight + 1; });
    ok(mb.y >= 0 && mb.y + mb.height <= d.h + 1 && sc, `[${d.tag}] menu fits without inner scrolling`);
    if (d.shots) await p.screenshot({ path: SHOT + `portrait_menu_${d.tag}.png` });
    await p.fill('#nick', '峻慶'); await tapEl('#bS2'); await p.waitForTimeout(1000);
    g = await geom(p);
    ok(await p.evaluate(() => __pb.state) === 'play' && g.touch, `[${d.tag}] touch tap on 雙打 starts the match, touch controls shown`);
    ok(g.netH && g.meBelowNet, `[${d.tag}] court vertical: net horizontal, own player below the net`);
    ok(g.on && g.overlap === 0 && g.n === 4, `[${d.tag}] court ${g.cw}x${g.ch}px fully visible under the score bar; pad + 3 buttons never over the court (0 overlap samples) ${g.on && g.overlap === 0 ? '' : JSON.stringify(g)}`);
    ok(g.cw >= d.w * (d.h < 700 ? 0.65 : 0.72), `[${d.tag}] court uses ${Math.round(100 * g.cw / d.w)}% of the width`);
    ok(g.namesFit, `[${d.tag}] score-bar names not truncated`);
    if (d.shots) await p.screenshot({ path: SHOT + `portrait_play_2v2_${d.tag}.png` });
    // move pad: up = toward the net (up the screen), right = right on screen
    const me = () => p.evaluate(() => { const q = __pb.m.players[__pb.seat]; const s = __pb.proj(q.x, q.y, 0); return { sx: s[0], sy: s[1] }; });
    const jb = await p.locator('#joyBase').boundingBox(); const jx = jb.x + jb.width / 2, jy = jb.y + jb.height / 2;
    const drag = async (dx, dy, ms) => { await touch('touchStart', [[jx, jy]]); for (let i = 1; i <= 5; i++) { await touch('touchMove', [[jx + dx * i / 5, jy + dy * i / 5]]); await p.waitForTimeout(20); } await p.waitForTimeout(ms); await touch('touchEnd', []); await p.waitForTimeout(80); };
    let a = await me(); await drag(0, -55, 500); let c = await me(); ok(c.sy < a.sy - 6, `[${d.tag}] pad up -> player moves up the screen toward the net (${Math.round(a.sy)} -> ${Math.round(c.sy)})`);
    a = await me(); await drag(0, 55, 500); c = await me(); ok(c.sy > a.sy + 6, `[${d.tag}] pad down -> player moves down (${Math.round(a.sy)} -> ${Math.round(c.sy)})`);
    a = await me(); await drag(55, 0, 400); c = await me(); ok(c.sx > a.sx + 6, `[${d.tag}] pad right -> player moves right (${Math.round(a.sx)} -> ${Math.round(c.sx)})`);
    a = await me(); await drag(-55, 0, 400); c = await me(); ok(c.sx < a.sx - 6, `[${d.tag}] pad left -> player moves left (${Math.round(a.sx)} -> ${Math.round(c.sx)})`);
    for (const [sel, shot] of [['#tbDrive', 'drive'], ['#tbDink', 'dink'], ['#tbLob', 'lob']]) { const t0 = await p.evaluate(() => __pb.m.players[__pb.seat].in.shotT); await tapEl(sel); const t1 = await p.evaluate(() => [__pb.m.players[__pb.seat].in.shotT, __pb.m.players[__pb.seat].in.shot]); ok(t1[0] > t0 && t1[1] === shot, `[${d.tag}] ${sel} tap registered (${shot})`); }
    // address bar / in-app toolbars showing and hiding
    for (const hh of [d.h - 60, d.h - 110, d.h - 60, d.h]) { await p.setViewportSize({ width: d.w, height: hh }); await p.waitForTimeout(250);
      const q = await geom(p); if (!(q.H === hh && q.on && q.overlap === 0 && Math.abs(q.cssH - hh) < 1)) ok(false, `[${d.tag}] toolbar height ${hh}: ${JSON.stringify(q)}`); }
    g = await geom(p); ok(g.H === d.h && g.on && g.overlap === 0, `[${d.tag}] address-bar/toolbar show/hide x4: court refits, controls stay off the court`);
    // rotate to landscape mid-match (still playable there), back to portrait; extreme sizes
    for (let k = 0; k < 2; k++) { await p.setViewportSize({ width: d.h, height: d.w }); await p.waitForTimeout(300); const q = await geom(p); if (q.port || q.overlap) ok(false, `[${d.tag}] landscape mid-match: ${JSON.stringify(q)}`); await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(300); }
    await p.setViewportSize({ width: 1888, height: 1030 }); await p.waitForTimeout(200); await p.setViewportSize({ width: 300, height: 20 }); await p.waitForTimeout(150); await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(400);
    const t0 = await p.evaluate(() => __pb.m.t); await p.waitForTimeout(500); const t1 = await p.evaluate(() => __pb.m.t);
    g = await geom(p); ok(g.port && g.on && g.overlap === 0 && t1 > t0, `[${d.tag}] after 2 landscape round-trips + extreme resizes: portrait again, loop alive ${g.on && g.overlap === 0 ? '' : JSON.stringify(g)}`);
    ok(!errs.length, `[${d.tag}] no console errors/warnings ${errs.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  // autopilot in portrait
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '?auto=1'); await p.fill('#nick', '峻慶'); await p.tap('#bS1'); await p.waitForTimeout(12000);
    const s = await p.evaluate(() => ({ hits: Object.values(__pb.hitCount).reduce((a, b) => a + b, 0), sc: __pb.m.score, pts: __pb.m.stats.points, fps: Math.round(__pb.fps) }));
    ok(s.hits >= 2 && !errs.length, `[iphone14 portrait] 12s 1v1 autopilot: ${JSON.stringify(s)}`); await p.screenshot({ path: SHOT + 'portrait_play_1v1_rally_iphone14_390x844.png' }); await ctx.close(); }
  // online: host (team 0) and client (team 1) both see their own team at the bottom, same state
  if (!process.env.NONET) { const P = [];
    for (let i = 0; i < 2; i++) { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); await p.goto(BASE + '?auto=1&server=' + encodeURIComponent(SERVER)); await p.fill('#nick', ['峻慶', '阿明'][i]); P.push(p); }
    const [h, c] = P; await h.tap('#segMode button[data-v="1"]').catch(() => {});
    await h.tap('#bHost'); await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
    const code = await h.evaluate(() => document.getElementById('rcode').textContent); await c.fill('#code', code); await c.tap('#bJoin');
    await h.waitForFunction(() => __pb.roster.length >= 2, null, { timeout: 30000 }); await h.waitForTimeout(800); await h.tap('#bStart');
    await c.waitForFunction(() => __pb.state === 'play', null, { timeout: 30000 }); await c.waitForTimeout(3000);
    const gh = await geom(h), gc = await geom(c); const [sh, scl] = await Promise.all([h.evaluate(() => [__pb.m.score.join('-'), __pb.m.server, __pb.seat]), c.evaluate(() => [__pb.m.score.join('-'), __pb.m.server, __pb.seat])]);
    ok(gh.meBelowNet && gc.meBelowNet && sh[2] !== scl[2], `[online portrait] host seat ${sh[2]} and client seat ${scl[2]} each see their own player at the bottom`);
    ok(sh[0] === scl[0] && sh[1] === scl[1], `[online portrait] same score/server on both (${sh[0]} srv ${sh[1]} / ${scl[0]} srv ${scl[1]})`);
    await h.screenshot({ path: SHOT + 'portrait_online_host_iphone14.png' }); await c.screenshot({ path: SHOT + 'portrait_online_client_iphone14.png' }); }
  // landscape device: still renders the landscape layout, never blocked
  { const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); await p.goto(BASE); await p.fill('#nick', '峻慶'); await p.tap('#bS2'); await p.waitForTimeout(1200);
    const g = await geom(p); ok(!g.port && g.on && g.overlap === 0, `[landscape 844x390] landscape layout, playable, no overlap`); await p.screenshot({ path: SHOT + 'landscape_play_2v2_iphone14_844x390.png' }); await ctx.close(); }
  console.log(fails ? `PORTRAIT: ${fails} FAILED` : 'PORTRAIT: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
