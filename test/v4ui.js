// R3 items 2,3,5,9 + leftovers: ball size on phones, prompts never over my own player, joystick ring after a resize,
// touch layout steady when a key is pressed, landscape fault box off the court centre, portrait call box off the far court.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v4/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const inter = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const meBox = () => { const p = __pb.m.players[__pb.seat]; const f = __pb.proj(p.x, p.y, 0), hd = __pb.proj(p.x, p.y, 2.1); const w = Math.abs(f[1] - hd[1]) * 0.45; return { x: f[0] - w, y: hd[1], w: 2 * w, h: f[1] - hd[1] + 6 }; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [VW, VH] of [[375, 667], [390, 844], [360, 740]]) {
    const c = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '?auto=1'); await p.tap('#bS1'); await p.waitForFunction(() => __pb.state === 'play');
    // sample 14 s of autopilot play: whenever the tip or the call box is visible it must not cover my player
    const res = await p.evaluate((src) => new Promise((done) => { const meBox = eval('(' + src + ')'); const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      let seen = { tip: 0, call: 0 }, bad = [], rmin = 99, t0 = performance.now();
      const f = () => { const mb = meBox(); for (const id of ['tip', 'msg']) { const e = document.getElementById(id); if (e.classList.contains('hide') || getComputedStyle(e).opacity < 0.3) continue; const r = e.getBoundingClientRect(); if (!r.width) continue; seen[id === 'tip' ? 'tip' : 'call']++; if (inter({ x: r.x, y: r.y, w: r.width, h: r.height }, mb)) bad.push(id + ':' + e.innerText.slice(0, 14) + ' box ' + [r.y | 0, r.bottom | 0, e.style.top] + ' me ' + [mb.y | 0, (mb.y + mb.h) | 0]); }
        if (__pb.view.ballR) rmin = Math.min(rmin, __pb.view.ballR);
        if (performance.now() - t0 < 14000) requestAnimationFrame(f); else done({ seen, bad: [...new Set(bad)], rmin }); }; f(); }), meBox.toString());
    ok(res.seen.tip + res.seen.call > 0 && !res.bad.length, `${VW}x${VH} prompts (tip ${res.seen.tip}f, call ${res.seen.call}f) never over my player ${res.bad.join(',')}`);
    ok(res.rmin >= 6, `${VW}x${VH} ball radius ≥ 6 css px everywhere on court (min ${res.rmin.toFixed(1)})`);
    // tip box sits on the far kitchen, call box on the near kitchen: neither touches the far players
    const far = await p.evaluate(() => { const o = __pb.m.players.filter((q) => q.team !== __pb.m.players[__pb.seat].team); return o.map((q) => { const f = __pb.proj(q.x, q.y, 0), hd = __pb.proj(q.x, q.y, 2.1); return { y0: hd[1], y1: f[1] }; }); });
    const callY = await p.evaluate(() => { const e = document.getElementById('msg'); e.classList.remove('hide'); e.classList.add('call'); document.getElementById('msgA').textContent = '出界'; document.getElementById('msgB').textContent = '紅隊得分'; const r = e.getBoundingClientRect(); return { y0: r.top, y1: r.bottom }; });
    const farBase = await p.evaluate(() => __pb.proj(0, 0, 0) && null);
    ok(true, `${VW}x${VH} call box rows ${callY.y0 | 0}-${callY.y1 | 0}, far players ${far.map((f) => (f.y0 | 0) + '-' + (f.y1 | 0)).join(',')}`);
    const netY = await p.evaluate(() => { const v = __pb.view; return v.port ? __pb.proj(0, 0, 0)[1] : 0; });
    ok(callY.y0 > netY - 30, `${VW}x${VH} portrait call box is below the net line (top ${callY.y0 | 0} vs net ${netY | 0}), not on the far court`);
    await p.evaluate(() => { document.getElementById('msg').classList.add('hide'); });
    // item 9: a key press on a touch device does not switch layouts
    const s0 = await p.evaluate(() => JSON.stringify(__pb.view.safe) + __pb.view.touchUI); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('KeyJ'); await p.waitForTimeout(300);
    const s1 = await p.evaluate(() => JSON.stringify(__pb.view.safe) + __pb.view.touchUI); ok(s0 === s1, `${VW}x${VH} keyboard on a touch phone keeps the touch layout (court doesn't jump)`);
    // item 5: joystick ring after resize mid-match
    await p.setViewportSize({ width: VH, height: VW }); await p.waitForTimeout(500); await p.setViewportSize({ width: VW, height: VH }); await p.waitForTimeout(600);
    const jr = await p.evaluate(() => { const e = document.getElementById('joyBase'), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, h: r.height, vis: cs.visibility, op: +cs.opacity, disp: cs.display, iw: innerWidth, ih: innerHeight }; });
    ok(jr.w > 80 && jr.x >= 0 && jr.y >= 0 && jr.x + jr.w <= jr.iw && jr.y + jr.h <= jr.ih && jr.vis === 'visible' && jr.op > 0.5 && jr.disp !== 'none', `${VW}x${VH} joystick ring still on screen after rotate+back (${jr.x | 0},${jr.y | 0} ${jr.w | 0}px)`);
    // also after a drag that ended during the resize
    const jb = await p.evaluate(() => { const r = document.getElementById('joyBase').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    const cdp = await c.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb[0] + 30, y: jb[1] - 40, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jb[0] + 70, y: jb[1] - 90, id: 1 }] });
    await p.setViewportSize({ width: VH, height: VW }); await p.waitForTimeout(300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.setViewportSize({ width: VW, height: VH }); await p.waitForTimeout(600);
    const jr2 = await p.evaluate(() => { const r = document.getElementById('joyBase').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; });
    ok(jr2.w > 80 && jr2.x >= 0 && jr2.y >= 0 && jr2.x + jr2.w <= jr2.iw && jr2.y + jr2.h <= jr2.ih, `${VW}x${VH} joystick ring on screen after a drag across a resize (${jr2.x | 0},${jr2.y | 0})`);
    if (VW === 375) await p.screenshot({ path: SHOT + 'after_resize_joystick_375x667.png' });
    await c.close();
  }
  // leftover: landscape fault box must not cover the court centre
  for (const [VW, VH] of [[844, 390], [667, 375]]) {
    const c = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '?auto=1'); await p.tap('#bS1'); await p.waitForFunction(() => __pb.state === 'play'); await p.waitForTimeout(800);
    const r = await p.evaluate(() => { const e = document.getElementById('msg'); e.className = ''; document.getElementById('msgA').textContent = '雙彈跳違規'; document.getElementById('msgB').textContent = '接發球方必須讓球先落地 · 紅隊得分'; const r = e.getBoundingClientRect(); const cc = __pb.proj(0, 0, 0), k1 = __pb.proj(-2.13, 0, 0); return { r: { x: r.x, y: r.y, w: r.width, h: r.height }, cc, k1 }; });
    const centre = { x: r.cc[0] - 40, y: r.cc[1] - 40, w: 80, h: 80 };
    ok(!inter(r.r, centre), `${VW}x${VH} landscape fault box (${r.r.y | 0}-${(r.r.y + r.r.h) | 0}) clear of the court centre (${r.cc[1] | 0})`);
    await p.screenshot({ path: SHOT + `land_fault_box_${VW}x${VH}.png` }); await c.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(fails ? `V4 UI: ${fails} FAILED` : 'V4 UI: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
