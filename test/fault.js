// R1 item 4: a serve fault triggered from the touch 抽球 button must show its reason (and the reason stays visible into the next call).
const { chromium } = require('playwright');
const URL = process.env.BASEURL || 'http://localhost:8077/index.html';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.fill('#nick', '峻慶'); await p.tap('#bS1');
  await p.waitForFunction(() => window.__pb.m && window.__pb.m.phase === 'serve', null, { timeout: 10000 });
  await p.evaluate(() => { const m = window.__pb.m; if (m.server !== window.__pb.seat) { m.servingTeam = m.players[window.__pb.seat].team; PB.setupPoint(m); } }); // give the serve to the human
  await p.waitForFunction(() => { const m = window.__pb.m; return m && m.phase === 'serve' && m.server === window.__pb.seat && m.phaseT > 0.7; }, null, { timeout: 90000, polling: 50 });
  await p.tap('[data-shot="drive"]');
  await p.waitForFunction(() => window.__pb.m.phase === 'rally', null, { timeout: 3000, polling: 10 });
  await p.evaluate(() => { const b = window.__pb.m.ball; b.vz = -2; b.vx = Math.sign(b.vx) * 6; }); // force this serve into the net
  const seen = []; for (let i = 0; i < 40; i++) { const t = await p.evaluate(() => { const e = document.getElementById('msg'); return e.classList.contains('hide') ? '' : document.getElementById('msgA').textContent + ' / ' + document.getElementById('msgB').textContent; }); if (t && seen[seen.length - 1] !== t) seen.push(t); if (i === 6) await p.screenshot({ path: '/workspace/pickleball-shots/v2/serve_fault_reason_i14.png' }); await p.waitForTimeout(100); }
  console.log('messages:', seen);
  const ok = seen.some((s) => /發球/.test(s.split(' / ')[0]) && /掛網|未過網|出界|廚房|對角/.test(s)) && seen.some((s) => /上一球/.test(s)) && !errs.length;
  console.log('errors:', errs.length ? errs : 'none'); console.log(ok ? 'SERVE FAULT REASON PASS' : 'SERVE FAULT REASON FAIL'); await b.close(); process.exit(ok ? 0 : 1);
})();
