// R2 item 6: kitchen faults and serve-fault reasons must actually appear on screen. Each case is staged with the test
// hook (ball/player placement), then played with real touch-button presses; the on-screen #msg text is read and screenshotted.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v3/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const cases = [
    { tag: 'kitchen_volley', want: /廚房區內截擊/, setup: `const p = m.players[s]; p.x = -1.2; p.y = 0.3; m.phase = 'rally'; m.live = true; m.hits = 3; m.rally = 3; m.bounces = 0; m.lastHitTeam = 1; m.lastHitter = 1; Object.assign(m.ball, { x: -0.6, y: 0.3, z: 0.9, vx: -1.2, vy: 0, vz: 0.2 });`, press: 'drive' },
    { tag: 'step_into_kitchen_after_volley', want: /截擊後踏入廚房區/, setup: `const p = m.players[s]; p.x = -2.6; p.y = 0.2; m.phase = 'rally'; m.live = true; m.hits = 3; m.rally = 3; m.bounces = 0; m.lastHitTeam = 1; m.lastHitter = 1; Object.assign(m.ball, { x: -2.1, y: 0.2, z: 0.9, vx: -1.0, vy: 0, vz: 0.2 });`, press: 'drive', after: `const p = m.players[s]; p.x = -1.4;` },
    { tag: 'serve_into_kitchen', want: /發球落在廚房區/, serve: { x: 0.4, z: 0.45, vx: 1.5, vz: -1.0, side: 1 } },
    { tag: 'serve_out', want: /發球出界/, serve: { x: 4.5, z: 0.4, vx: 3, vz: -1.5, y: 3.8 } },
    { tag: 'serve_wrong_diagonal', want: /對角/, serve: { x: 4.2, z: 0.4, vx: 2, vz: -1.5, side: -1 } },
    { tag: 'serve_into_net', want: /發球未過網|發球掛網/, serve: { x: -0.6, z: 0.3, vx: 4, vz: -1.2 } },
  ];
  for (const vp of [{ w: 390, h: 844, n: 'portrait_iphone14' }, { w: 844, h: 390, n: 'landscape_iphone14' }]) for (const cs of cases) {
    if (vp.w > vp.h && !['kitchen_volley', 'serve_into_kitchen'].includes(cs.tag)) continue; // landscape: two samples are enough
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.fill('#nick', '峻慶'); await p.tap('#bS1');
    await p.waitForFunction(() => __pb.m && __pb.m.phase === 'serve', null, { timeout: 10000 });
    await p.evaluate(() => { const m = __pb.m; if (m.server !== __pb.seat) { m.servingTeam = m.players[__pb.seat].team; PB.setupPoint(m); } });
    await p.waitForFunction(() => __pb.m.phaseT > 1.0, null, { timeout: 10000 });
    if (cs.serve) {
      await p.tap('#tbDrive'); await p.waitForFunction(() => __pb.m.phase === 'rally', null, { timeout: 3000, polling: 10 });
      await p.evaluate((sv) => { const m = __pb.m, b = m.ball, srv = m.players[m.server]; const ys = PB.sideSign(srv.team, m.sides[srv.i]); // server's own side sign
        b.x = sv.x; b.z = sv.z; b.vx = sv.vx; b.vz = sv.vz; b.vy = 0; b.y = sv.y != null ? sv.y : -ys * 1.4 * (sv.side || 1); }, cs.serve);
    } else {
      await p.evaluate(`(() => { const m = __pb.m, s = __pb.seat; ${cs.setup} })()`);
      await p.tap('#tbDrive'); if (cs.after) await p.evaluate(`(() => { const m = __pb.m, s = __pb.seat; ${cs.after} })()`);
    }
    let seen = '', shot = false;
    for (let i = 0; i < 30 && !shot; i++) { const t = await p.evaluate(() => { const e = document.getElementById('msg'); return e.classList.contains('hide') ? '' : document.getElementById('msgA').textContent + ' / ' + document.getElementById('msgB').textContent; });
      if (t && cs.want.test(t)) { seen = t; await p.waitForTimeout(250); await p.screenshot({ path: SHOT + `fault_${cs.tag}_${vp.n}.png` }); shot = true; } else { if (t) seen = t; await p.waitForTimeout(60); } }
    ok(shot && !errs.length, `[${vp.n}] ${cs.tag}: on screen 「${seen}」 ${errs.join('|')}`);
    await ctx.close();
  }
  console.log(fails ? `FAULT TEXTS: ${fails} FAILED` : 'FAULT TEXTS: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
