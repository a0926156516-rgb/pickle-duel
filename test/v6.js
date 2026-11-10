// v6: 殺球 button + bigger shot buttons (portrait, short portrait, landscape, forced 橫向), smash over the network,
// duplicate nicknames get (2), room-code placeholder not cut off, fps label clear of 「按住拖曳移動」,
// forced-橫向 joystick directions + host-background pause while the host plays 橫向.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v6/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const V5 = { tall: { drive: 96, small: 76 }, short: { drive: 84, small: 66 }, land: { drive: 92, small: 72 } };
const setVis = (p, hidden) => p.evaluate((h) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q = '', tag = '') => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(120); };
    const phys = (ax, ay) => p.evaluate(([ax, ay]) => (__pb.forced ? [document.documentElement.clientWidth - ay, ax] : [ax, ay]), [ax, ay]);
    await p.goto(BASE + q); return { p, touch, tapEl, phys }; };
  // --- button layout on every layout
  for (const [w, h, q, kind, tag] of [[390, 844, '?auto=1', 'tall', 'portrait_390x844'], [430, 932, '?auto=1', 'tall', 'portrait_430x932'], [375, 667, '?auto=1', 'short', 'portrait_375x667'], [360, 740, '?auto=1', 'short', 'portrait_360x740'], [320, 568, '?auto=1', 'short', 'portrait_320x568'],
    [844, 390, '?auto=1', 'land', 'landscape_844x390'], [667, 375, '?auto=1', 'land', 'landscape_667x375'], [390, 844, '?auto=1&orient=land', 'land', 'forced_land_390x844'], [375, 667, '?auto=1&orient=land', 'land', 'forced_land_375x667']]) {
    const { p, tapEl } = await mk(w, h, q, tag); await p.locator('#bS2').scrollIntoViewIfNeeded().catch(() => {}); await tapEl('#bS2'); await p.waitForTimeout(300); if (await p.evaluate(() => __pb.state !== 'play')) await p.evaluate(() => document.getElementById('bS2').click()); await p.waitForFunction(() => __pb.state === 'play'); await p.waitForTimeout(1500);
    const g = await p.evaluate(() => { const v = __pb.view, C = PB.C, pr = (x, y) => __pb.proj(x, y, 0);
      const poly = [pr(-C.HL, -C.HW), pr(C.HL, -C.HW), pr(C.HL, C.HW), pr(-C.HL, C.HW)];
      const inPoly = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      const R = {}; for (const id of ['tbDrive', 'tbDink', 'tbLob', 'tbSmash', 'joyBase']) R[id] = __pb.appRect(document.getElementById(id));
      const ids = ['tbDrive', 'tbDink', 'tbLob', 'tbSmash']; let ov = [], out = [], onCourt = [];
      for (let i = 0; i < ids.length; i++) { const a = R[ids[i]]; if (a.left < 0 || a.top < 0 || a.right > v.W + 1 || a.bottom > v.H + 1) out.push(ids[i]);
        for (let j = i + 1; j < ids.length; j++) { const c = R[ids[j]], ra = a.width / 2, rc = c.width / 2; if (Math.hypot(a.left + ra - c.left - rc, a.top + ra - c.top - rc) < ra + rc - 1) ov.push(ids[i] + '/' + ids[j]); }
        const jb = R.joyBase; if (a.left < jb.right && jb.left < a.right && a.top < jb.bottom && jb.top < a.bottom) ov.push(ids[i] + '/joystick');
        const r = a.width / 2, cx = a.left + r, cy = a.top + r; for (let k = 0; k < 12; k++) { const t = k / 12 * Math.PI * 2; if (inPoly(cx + Math.cos(t) * r * 0.92, cy + Math.sin(t) * r * 0.92)) { onCourt.push(ids[i]); break; } } }
      return { d: R.tbDrive.width, s: Math.min(R.tbDink.width, R.tbLob.width, R.tbSmash.width), ov, out, onCourt: [...new Set(onCourt)], smash: document.querySelector('#tbSmash b').innerText }; });
    const base = V5[kind], kd = g.d / base.drive, ks = g.s / base.small;
    ok((g.smash === '殺球' || g.smash === '抽') && kd >= 1.09 && kd <= 1.17 && ks >= 1.09 && ks <= 1.17, `[${tag}] 4 buttons incl. 殺球; drive ${g.d | 0}px (+${Math.round(kd * 100 - 100)}%), others ${g.s | 0}px (+${Math.round(ks * 100 - 100)}%)`);
    ok(!g.ov.length && !g.out.length, `[${tag}] buttons don't overlap each other or the joystick, all on screen ${g.ov.concat(g.out).join(',')}`);
    ok(!g.onCourt.length, `[${tag}] buttons stay off the court ${g.onCourt.join(',')}`);
    // tap 殺球 with a real touch where it is drawn
    await tapEl('#tbSmash'); const s = await p.evaluate(() => ({ shot: __pb.m.players[__pb.seat].in.shot, sel: document.getElementById('tbSmash').classList.contains('sel') }));
    ok(s.shot === 'smash' && s.sel, `[${tag}] touching 殺球 selects a smash`);
    if (['portrait_375x667', 'portrait_390x844', 'landscape_844x390', 'forced_land_390x844'].includes(tag)) await p.screenshot({ path: SHOT + `buttons_${tag}.png` });
    await p.context().close();
  }
  // --- keyboard I = smash (desktop)
  { const c = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await c.newPage(); await p.goto(BASE); await p.click('#bS1'); await p.waitForTimeout(500); await p.keyboard.press('KeyI');
    ok(await p.evaluate(() => __pb.m.players[__pb.seat].in.shot === 'smash'), 'keyboard I = 殺球');
    ok(/I 殺球/.test(await p.evaluate(() => document.getElementById('keys').innerText)), 'key help lists I 殺球'); await c.close(); }
  // --- smash actually played in a match: wait for a high ball, press 殺球
  { const { p } = await mk(390, 844, '?', 'play'); await p.locator('#bS1').tap(); await p.waitForFunction(() => __pb.state === 'play');
    const n = await p.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const orig = __pb.m; const f = () => { const m = __pb.m, me = m.players[__pb.seat]; me.x += 0; // let the human seat be driven by the test: put me under high balls on my side
        if (m.phase === 'serve' && m.server === __pb.seat) __pb.press('drive');
        if (m.phase === 'rally' && m.live && m.lastHitTeam !== me.team && (m.ball.x < 0) === (me.team === 0) && m.ball.z > 1.0 && m.hits >= 2) { me.x = m.ball.x - 0.3 * Math.sign(m.ball.x); me.y = m.ball.y; if (Math.abs(me.x) < 2.3) me.x = Math.sign(me.x || -1) * 2.4; __pb.press('smash'); }
        if (m.lastHitter === __pb.seat && me.swingShot === 'smash' && m.hits !== orig.lastCount) { orig.lastCount = m.hits; n++; } // (events are consumed by the game loop)
        if (n < 1 && performance.now() - t0 < 60000) requestAnimationFrame(f); else done(n); }; f(); }));
    ok(n >= 1, `smash played in a real rally (${n} smash${n === 1 ? '' : 'es'} by me)`); await p.screenshot({ path: SHOT + 'smash_in_play_390x844.png' }); await p.context().close(); }
  // --- online: duplicate nicknames + guest smash reaches host + forced-橫向 host goes to background
  { const H = await mk(390, 844, '?orient=land&server=' + encodeURIComponent(SERVER), 'host'), G = await mk(375, 667, '?server=' + encodeURIComponent(SERVER), 'guest');
    await H.p.fill('#nick', '峻慶'); await G.p.fill('#nick', '峻慶');
    await H.tapEl('#bHost'); await H.p.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
    await H.tapEl('#segMode button[data-v="1"]');
    const code = await H.p.evaluate(() => document.getElementById('rcode').textContent);
    await G.p.fill('#code', code); await G.tapEl('#bJoin'); await H.p.waitForFunction(() => __pb.roster.length >= 2, null, { timeout: 30000 }); await H.p.waitForTimeout(800);
    const seatsH = await H.p.evaluate(() => [...document.querySelectorAll('#seats .seat')].map((e) => e.innerText.replace(/\s+/g, ' ')).join(' | '));
    const seatsG = await G.p.evaluate(() => [...document.querySelectorAll('#seats .seat')].map((e) => e.innerText.replace(/\s+/g, ' ')).join(' | '));
    ok(/峻慶 👑/.test(seatsH) && /峻慶\(2\)/.test(seatsH) && /峻慶\(2\)（你）/.test(seatsG), `same nickname -> 峻慶 / 峻慶(2) (host: ${seatsH}; guest: ${seatsG})`);
    await G.p.screenshot({ path: SHOT + 'duplicate_nickname_room_375x667.png' });
    await H.tapEl('#bStart'); await G.p.waitForFunction(() => __pb.state === 'play', null, { timeout: 30000 }); await H.p.waitForTimeout(800);
    const names = await G.p.evaluate(() => __pb.m.players.map((q) => q.name)); ok(names.includes('峻慶') && names.includes('峻慶(2)'), `in the match: ${names.join(', ')}`);
    await G.tapEl('#tbSmash'); await H.p.waitForTimeout(400);
    const hs = await H.p.evaluate(() => __pb.m.players.find((q) => q.ctrl === 'remote').in.shot); ok(hs === 'smash', `guest 殺球 reaches the host (${hs})`);
    // forced-橫向 host: joystick directions once more, online
    const me = () => H.p.evaluate(() => { const q = __pb.m.players[__pb.seat]; const s = __pb.proj(q.x, q.y, 0); return { sx: s[0], sy: s[1] }; });
    const jc = await H.p.evaluate(() => { const r = __pb.appRect(document.getElementById('joyBase')); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const drag = async (dx, dy) => { const [x0, y0] = await H.phys(jc[0], jc[1]), [x1, y1] = await H.phys(jc[0] + dx, jc[1] + dy); await H.touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 5; i++) { await H.touch('touchMove', [[x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5]]); await H.p.waitForTimeout(20); } await H.p.waitForTimeout(450); await H.touch('touchEnd', []); await H.p.waitForTimeout(120); };
    for (const [dx, dy, nm, chk] of [[0, -55, 'up', (a, c) => c.sy < a.sy - 6], [0, 55, 'down', (a, c) => c.sy > a.sy + 6], [55, 0, 'right', (a, c) => c.sx > a.sx + 4], [-55, 0, 'left', (a, c) => c.sx < a.sx - 4]]) {
      const a = await me(); await drag(dx, dy); const c = await me(); ok(chk(a, c), `[forced 橫向 host, online] joystick ${nm} moves ${nm} (${a.sx | 0},${a.sy | 0} -> ${c.sx | 0},${c.sy | 0})`); }
    await H.p.waitForFunction(() => __pb.m.phase === 'rally', null, { timeout: 20000, polling: 20 }).catch(() => {});
    await setVis(H.p, true);
    await G.p.waitForFunction(() => !document.getElementById('wait').classList.contains('hide'), null, { timeout: 2000 }).catch(() => {});
    const w = await G.p.evaluate(() => !document.getElementById('wait').classList.contains('hide'));
    const t0 = await H.p.evaluate(() => __pb.m.t); await H.p.evaluate(() => { const t = Date.now(); while (Date.now() - t < 1500); }); const t1 = await H.p.evaluate(() => __pb.m.t);
    ok(w && t0 === t1 && await H.p.evaluate(() => __pb.forced), `[forced 橫向 host] background -> guest 「等待房主…」, host match paused (t ${t0.toFixed(2)} -> ${t1.toFixed(2)})`);
    await G.p.screenshot({ path: SHOT + 'guest_waiting_forced_land_host_375x667.png' });
    await setVis(H.p, false); await G.p.waitForFunction(() => document.getElementById('wait').classList.contains('hide'), null, { timeout: 3000 }).catch(() => {}); await H.p.waitForTimeout(1500);
    const t2 = await H.p.evaluate(() => __pb.m.t); ok(t2 > t1 && await G.p.evaluate(() => document.getElementById('wait').classList.contains('hide')), `[forced 橫向 host] back -> guest notice gone, match running`);
    await H.p.screenshot({ path: SHOT + 'forced_land_host_online_390x844.png' });
    await H.p.context().close(); await G.p.context().close(); }
  // --- placeholder + fps label
  for (const [w, h] of [[375, 667], [320, 568], [390, 844]]) {
    const { p } = await mk(w, h, '?fps=1', 'ui'); await p.waitForTimeout(300);
    const ph = await p.evaluate(() => { const e = document.getElementById('code'), cs = getComputedStyle(e, '::placeholder'), c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const ls = parseFloat(cs.letterSpacing) || 0; const tw = c.measureText(e.placeholder).width + ls * e.placeholder.length; const avail = e.clientWidth - parseFloat(getComputedStyle(e).paddingLeft) - parseFloat(getComputedStyle(e).paddingRight); return { t: e.placeholder, tw: Math.round(tw), avail: Math.round(avail) }; });
    ok(ph.tw <= ph.avail, `${w}x${h} room-code placeholder 「${ph.t}」 fits (${ph.tw}px text in ${ph.avail}px)`);
    if (w === 375) await p.screenshot({ path: SHOT + 'menu_placeholder_375x667.png' });
    await p.locator('#bS1').tap(); await p.waitForTimeout(900);
    const f = await p.evaluate(() => { const r = document.getElementById('joyHint').getBoundingClientRect(); return { fy: __pb.view.fpsY, top: r.top, left: r.left }; });
    ok(f.fy <= f.top - 2, `${w}x${h} fps label (baseline ${f.fy | 0}) sits above 「按住拖曳移動」 (top ${f.top | 0})`);
    if (w === 375) await p.screenshot({ path: SHOT + 'fps_label_375x667.png' });
    await p.context().close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(fails ? `V6: ${fails} FAILED` : 'V6: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
