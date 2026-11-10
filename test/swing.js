// Captures procedural swing poses (arm + paddle rotation + squash) on the 遊戲模組部門 sprites.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); const p = await c.newPage();
  await p.goto('http://localhost:8077/index.html?auto=1'); await p.fill('#nick', '峻慶'); await p.tap('#segChar button[data-v="1"]'); await p.tap('#segCol button[data-v="3"]'); await p.tap('#bS1');
  let n = 0; for (let i = 0; i < 600 && n < 3; i++) {
    const sw = await p.evaluate(() => { const m = window.__pb.m; if (!m) return null; const q = m.players.find((x) => x.swing > 0.35 && x.swing < 0.75); if (!q) return null; const v = window.__pb.proj(q.x, q.y, 0); return { x: v[0], y: v[1], shot: q.swingShot, name: q.name }; });
    if (sw) { n++; await p.screenshot({ path: `/workspace/pickleball-shots/v2/swing_${n}_${sw.shot}_i14.png`, clip: { x: Math.max(0, sw.x - 110), y: Math.max(0, sw.y - 150), width: 220, height: 180 } }); console.log('swing', n, sw.name, sw.shot); await p.waitForTimeout(700); }
    else await p.waitForTimeout(16);
  }
  await b.close();
})();
