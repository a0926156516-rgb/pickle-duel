// v7: 殺球 dims to 「抽」 + 「球太低，改為抽球」 on a low ball, smash shake / flash / sound, forced-橫向 joystick held in 4 directions.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v7/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q, tag) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(60); };
    const phys = (ax, ay) => p.evaluate(([ax, ay]) => (__pb.forced ? [document.documentElement.clientWidth - ay, ax] : [ax, ay]), [ax, ay]);
    await p.goto(BASE + q); await p.evaluate(() => __pb.startLocal(1)); await p.waitForFunction(() => __pb.state === 'play'); await p.waitForTimeout(800); return { p, touch, tapEl, phys }; };
  // incoming ball for me (seat 0, left/near half) at a chosen height; the CPU is parked so the point does not move on
  const incoming = (p, z, vz) => p.evaluate(([z, vz]) => { const m = __pb.m, me = m.players[__pb.seat], o = m.players.find((q) => q.team !== me.team);
    m.phase = 'rally'; m.live = true; m.hits = 5; m.rally = 5; m.bounces = 0; m.lastHitTeam = o.team; m.lastHitter = o.i; me.x = -4.6; me.y = 0; o.x = 4; o.y = 0;
    Object.assign(m.ball, { x: -0.6, y: 0.05, z, vx: -4, vy: 0, vz }); }, [z, vz]);
  for (const [w, h, q, tag] of [[390, 844, '', 'portrait_390x844'], [375, 667, '?orient=land', 'forced_land_375x667'], [844, 390, '', 'landscape_844x390']]) {
    const { p, tapEl } = await mk(w, h, q, tag);
    // low ball: button turns into 「抽」 before the hit, the tap shows the hint, the stroke is a power drive
    await incoming(p, 0.5, 0.5); await p.waitForTimeout(450);
    const lo = await p.evaluate(() => ({ low: __pb.smashLow, z: __pb.contactZ(), lab: document.querySelector('#tbSmash b').textContent, sm: document.querySelector('#tbSmash small').textContent, cls: document.getElementById('tbSmash').classList.contains('low'), op: getComputedStyle(document.getElementById('tbSmash')).opacity }));
    ok(lo.low && lo.cls && lo.lab === '抽' && lo.sm === '▼' && +lo.op < 0.8, `[${tag}] ball coming in low (meets me at ${lo.z && lo.z.toFixed(2)} m) -> 殺球 dims and reads 「抽 ▼」 (debounced) (opacity ${lo.op})`);
    if (tag !== 'landscape_844x390') { await p.screenshot({ path: SHOT + `smash_button_low_${tag}.png` }); await incoming(p, 0.5, 0.5); await p.waitForTimeout(450); }
    const h0 = await p.evaluate(() => __pb.hitCount[__pb.seat] || 0);
    await tapEl('#tbSmash'); await p.waitForTimeout(150);
    const tp = await p.evaluate(() => ({ t: document.getElementById('tip').textContent, hid: document.getElementById('tip').classList.contains('hide'), warn: document.getElementById('tip').classList.contains('warn') }));
    ok(!tp.hid && tp.t === '球太低，改為抽球' && tp.warn, `[${tag}] tapping 殺球 on the low ball shows 「${tp.t}」`);
    await p.waitForFunction((h0) => (__pb.hitCount[__pb.seat] || 0) > h0, h0, { timeout: 3000 }).catch(() => {});
    const sw = await p.evaluate(() => __pb.m.players[__pb.seat].swingShot);
    ok(sw === 'drive', `[${tag}] the low 殺球 is played as a (power) drive: ${sw}`);
    if (tag !== 'landscape_844x390') await p.screenshot({ path: SHOT + `low_ball_hint_${tag}.png` });
    // high ball: label back to 殺球, a real smash with shake + flash + smash sound
    await p.waitForTimeout(400); await incoming(p, 1.75, 0.6); await p.evaluate(() => { const m = __pb.m; m.bounces = 0; Object.assign(m.ball, { x: -1.4, z: 1.7, vx: -3.2, vz: 0.5 }); m.hits++; }); await p.waitForTimeout(420);
    const hi = await p.evaluate(() => ({ lab: document.querySelector('#tbSmash b').textContent, low: __pb.smashLow, z: __pb.contactZ() }));
    const j0 = await p.evaluate(() => ({ n: __pb.juice.n, s: __pb.juice.sfx }));
    await tapEl('#tbSmash');
    const j = await (await p.waitForFunction((n) => __pb.juice.n > n && { n: __pb.juice.n, s: __pb.juice.sfx, sh: __pb.juice.shake, fl: __pb.juice.flash, amp: __pb.juice.amp, sw: __pb.m.players[__pb.seat].swingShot }, j0.n, { timeout: 2500, polling: 'raf' }).catch(() => null))?.jsonValue() || {};
    await p.waitForTimeout(50);
    if (tag !== 'landscape_844x390') await p.screenshot({ path: SHOT + `smash_flash_shake_${tag}.png` });
    ok(hi.lab === '殺球' && !hi.low, `[${tag}] high ball (meets me at ${hi.z && hi.z.toFixed(2)} m) -> button reads 殺球 again`);
    ok(j.sw === 'smash' && j.n === j0.n + 1 && j.s === j0.s + 1 && j.sh > 0 && j.fl > 0 && j.amp >= 6, `[${tag}] smash hit -> screen shake (${j.amp}px, ${(j.sh || 0).toFixed(2)}s left), flash ${(j.fl || 0).toFixed(2)}, smash sound played`);
    await p.waitForTimeout(500); const after = await p.evaluate(() => ({ sh: __pb.juice.shake, fl: __pb.juice.flash }));
    ok(after.sh === 0 && after.fl < 0.05, `[${tag}] shake and flash settle within half a second`);
    await p.context().close();
  }
  // --- forced 橫向 (375x667 held upright, 橫向 chosen): joystick held with a real touch in each direction, screenshots as proof
  { const { p, touch, phys } = await mk(375, 667, '?orient=land', 'forced');
    ok(await p.evaluate(() => __pb.forced && __pb.view.W === 667 && __pb.view.H === 375), 'forced 橫向 active (app 667x375 on a 375x667 portrait screen)');
    const park = () => p.evaluate(() => { const m = __pb.m, me = m.players[__pb.seat]; m.phase = 'dead'; m.phaseT = -120; m.live = false; m.winner = -1; me.x = -3.6; me.y = 0; Object.assign(m.ball, { x: 5, y: 2.5, z: 0.04, vx: 0, vy: 0, vz: 0 });
      for (const q of m.players) if (q !== me) { q.x = 4.5; q.y = 1.5; } });
    const me = () => p.evaluate(() => { const q = __pb.m.players[__pb.seat], s = __pb.proj(q.x, q.y, 0); return { sx: s[0], sy: s[1], x: q.x, y: q.y }; });
    const jc = await p.evaluate(() => { const r = __pb.appRect(document.getElementById('joyBase')); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const label = (txt, a) => p.evaluate(([txt, a]) => { let d = document.getElementById('t7'); if (!d) { d = document.createElement('div'); d.id = 't7'; d.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:99;background:rgba(0,0,0,.75);color:#ffe14d;font:700 13px sans-serif;padding:4px 10px;border-radius:8px;pointer-events:none;white-space:nowrap'; document.body.appendChild(d); }
      d.textContent = txt; let s = document.getElementById('t7s'); if (!s) { s = document.createElement('div'); s.id = 't7s'; s.style.cssText = 'position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border:3px solid #ffe14d;border-radius:50%;z-index:98;pointer-events:none'; document.body.appendChild(s); } s.style.left = a.sx + 'px'; s.style.top = a.sy + 'px'; }, [txt, a]);
    for (const [dx, dy, nm, arrow, chk] of [[0, -55, 'up', '↑', (a, c) => c.sy < a.sy - 25], [0, 55, 'down', '↓', (a, c) => c.sy > a.sy + 25], [55, 0, 'right', '→', (a, c) => c.sx > a.sx + 25], [-55, 0, 'left', '←', (a, c) => c.sx < a.sx - 25]]) {
      await park(); await p.waitForTimeout(150); const a = await me();
      const [x0, y0] = await phys(jc[0], jc[1]), [x1, y1] = await phys(jc[0] + dx, jc[1] + dy);
      await touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6]]); await p.waitForTimeout(16); }
      // held: keep the finger down (repeat the same touch point) for ~0.45 s, then screenshot while still held
      for (let k = 0; k < 9; k++) { await touch('touchMove', [[x1, y1 + (k % 2 ? 0.5 : 0)]]); await p.waitForTimeout(50); }
      const mid = await me(); const knob = await p.evaluate(() => document.getElementById('joyKnob').style.transform);
      await label(`搖桿按住 ${arrow}（橫向拿手機的${{ up: '上', down: '下', left: '左', right: '右' }[nm]}） 玩家 (${a.sx | 0},${a.sy | 0}) → (${mid.sx | 0},${mid.sy | 0})`, a);
      await p.screenshot({ path: SHOT + `joystick_forced_land_held_${nm}_375x667.png` });
      for (let k = 0; k < 4; k++) { await touch('touchMove', [[x1, y1]]); await p.waitForTimeout(50); }
      const c = await me(); await touch('touchEnd', []); await p.waitForTimeout(200); const e = await me();
      ok(chk(a, mid) && chk(a, c) && knob && knob !== 'translate(0px, 0px)', `[forced 橫向] joystick held ${nm} ${arrow}: player moves ${nm} on the landscape screen the whole time (${a.sx | 0},${a.sy | 0} -> held ${mid.sx | 0},${mid.sy | 0} -> ${c.sx | 0},${c.sy | 0}); knob ${knob}`);
      ok(Math.hypot(e.sx - c.sx, e.sy - c.sy) < 12, `[forced 橫向] released ${nm}: player stops (${c.sx | 0},${c.sy | 0} -> ${e.sx | 0},${e.sy | 0})`);
    }
    await p.evaluate(() => { for (const id of ['t7', 't7s']) { const d = document.getElementById(id); d && d.remove(); } });
    await p.context().close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? `V7: ${fails} FAILED` : 'V7: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
