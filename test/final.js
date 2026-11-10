const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
const LOCAL = 'http://localhost:8077/index.html';
(async () => {
  const browser = await chromium.launch(); const errs = [];
  const mk = async (o, tag) => { const c = await browser.newContext(o || { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(`[${tag}] ${m.text()}`); }); p.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`)); return p; };
  // 1) human-autopilot vs AI balance + fault message screenshot
  const a = await mk(null, 'bal'); await a.goto(LOCAL + '?auto=1'); await a.fill('#nick', '峻慶'); await a.tap('#bS1');
  let shot = false; const t0 = Date.now();
  while (Date.now() - t0 < 60000) { await a.waitForTimeout(150); if (!shot && await a.evaluate(() => { const e = document.getElementById('msg'); return !e.classList.contains('hide') && /bad|good/.test(e.className) && document.getElementById('msgA').textContent.length > 0; })) { await a.screenshot({ path: OUT + 'fault_message_mobile.png' }); shot = true; } }
  console.log('autopilot(human settings) vs normal AI, 60s:', JSON.stringify(await a.evaluate(() => ({ score: __pb.m.score, faults: __pb.m.stats.faults, fps: Math.round(__pb.fps) }))), 'fault screenshot:', shot);
  // 2) portrait hint
  const pt = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'portrait'); await pt.goto(LOCAL); await pt.waitForTimeout(400); await pt.screenshot({ path: OUT + 'portrait_hint.png' });
  console.log('portrait layout (no blocker):', await pt.evaluate(() => __pb.view.port && !document.getElementById('rot')));
  // 3) seat change: 2 humans as teammates vs 2 AI
  const S = '&server=' + encodeURIComponent('ws://localhost:10077/ws');
  const h = await mk(null, 'seatH'), c = await mk(null, 'seatC');
  await h.goto(LOCAL + '?auto=1' + S); await h.fill('#nick', '峻慶'); await h.tap('#bHost');
  await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent));
  const code = await h.evaluate(() => document.getElementById('rcode').textContent);
  await c.goto(LOCAL + '?auto=1' + S); await c.fill('#nick', '隊友'); await c.fill('#code', code); await c.tap('#bJoin');
  await c.waitForFunction(() => __pb.state === 'room' && __pb.roster.length === 2);
  await h.tap('#segMode button[data-v="2"]'); await c.waitForTimeout(300);
  await c.tap('.seat[data-seat="2"]'); await h.waitForFunction(() => __pb.roster.some((p) => p.c === 2));
  await h.waitForTimeout(300); await h.screenshot({ path: OUT + 'room_teammates_host.png' });
  await h.tap('#bStart'); await c.waitForFunction(() => __pb.state === 'play'); await c.waitForTimeout(6000);
  await c.screenshot({ path: OUT + 'play_teammates_client.png' });
  console.log('seat change:', JSON.stringify(await h.evaluate(() => __pb.m.players.map((p) => `${p.i}:${p.ctrl}:${p.name}`))), 'client seat', await c.evaluate(() => __pb.seat));
  // 4) production relay used by 攀岩 (default server, no override): create + join + 1v1 for a few seconds
  const ph = await mk(null, 'liveH'), pc = await mk(null, 'liveC');
  await ph.goto(LOCAL + '?auto=1'); await ph.fill('#nick', '測試主'); await ph.tap('#bHost');
  try {
    await ph.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
    const lc = await ph.evaluate(() => document.getElementById('rcode').textContent);
    await pc.goto(LOCAL + '?auto=1'); await pc.fill('#nick', '測試客'); await pc.fill('#code', lc); await pc.tap('#bJoin');
    await pc.waitForFunction(() => __pb.state === 'room' && __pb.roster.length === 2, null, { timeout: 60000 });
    await ph.tap('#segMode button[data-v="1"]'); await ph.waitForTimeout(300); await ph.tap('#bStart');
    await pc.waitForFunction(() => __pb.state === 'play', null, { timeout: 20000 }); await pc.waitForTimeout(8000);
    const r = await pc.evaluate(() => ({ seat: __pb.seat, point: __pb.m.point, hits: __pb.m.hits, call: document.getElementById('call').textContent }));
    const rh = await ph.evaluate(() => ({ hits: { ...__pb.hitCount } }));
    console.log(`LIVE relay wss://panjian-peak2d.onrender.com/ws: room ${lc} OK, client ${JSON.stringify(r)}, host strokes by seat ${JSON.stringify(rh.hits)}`);
    await ph.evaluate(() => document.getElementById('bQuit').click()); await pc.waitForTimeout(1500);
    console.log('live: client after host left ->', await pc.evaluate(() => __pb.state + ' / ' + document.getElementById('status').textContent));
  } catch (e) { console.log('LIVE relay test failed:', e.message.split('\n')[0], await ph.evaluate(() => document.getElementById('status').textContent)); }
  console.log('console errors/warnings:', errs.length ? errs : 'none');
  await browser.close();
})();
