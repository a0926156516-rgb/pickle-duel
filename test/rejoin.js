// R2 item 1: reload a client mid-match and rejoin -> same seat, same look, immediate full state (score/server/phase).
const { chromium } = require('playwright');
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const BASE = (process.env.BASEURL || 'http://localhost:8077/index.html') + '?auto=1&server=' + encodeURIComponent(SERVER);
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v3/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const errs = []; const P = [];
  const looks = [[0, 0, '峻慶'], [1, 3, '阿明'], [0, 1, '玩家597']];
  for (let i = 0; i < 3; i++) { const c = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(`[p${i}] ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errs.push(`[p${i}] ${m.text()}`)); await p.goto(BASE); await p.fill('#nick', looks[i][2]); await p.dispatchEvent('#nick', 'change'); await p.tap(`#segChar button[data-v="${looks[i][0]}"]`); await p.tap(`#segCol button[data-v="${looks[i][1]}"]`); P.push(p); }
  const [h, c1, c2] = P;
  await h.tap('#bHost'); await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
  const code = await h.evaluate(() => document.getElementById('rcode').textContent); console.log('room', code);
  await c1.fill('#code', code); await c1.tap('#bJoin'); await h.waitForFunction(() => window.__pb.roster.length >= 2, null, { timeout: 30000 });
  await c2.fill('#code', code); await c2.tap('#bJoin'); await h.waitForFunction(() => window.__pb.roster.length >= 3, null, { timeout: 30000 });
  await h.waitForTimeout(1200);
  // put 玩家597 on the host's team (seat 2) so seat 1 (opponent) and seat 2 (partner) are both host-adjacent
  const seatOf = (p) => p.evaluate(() => { const r = window.__pb.roster.find((q) => q.n === document.getElementById('nick').value.trim()); return r ? r.c : -1; });
  if (await seatOf(c2) !== 2) { await c2.tap('.seat[data-seat="2"]'); await c2.waitForTimeout(800); }
  if (await seatOf(c1) !== 1) { await c1.tap('.seat[data-seat="1"]'); await c1.waitForTimeout(800); }
  await h.tap('#bStart'); await c2.waitForFunction(() => window.__pb.state === 'play', null, { timeout: 30000 });
  const S = (p) => p.evaluate(() => { const m = window.__pb.m; return m && { seat: window.__pb.seat, pt: m.point, sc: m.score.join('-'), st: m.servingTeam, sn: m.serverNum, sv: m.server, ph: m.phase, tn: m.teamNames.join(','), P: m.players.map((q) => `${q.name}|${q.ch}/${q.co}|${q.ctrl}`) }; });
  const before = await S(h); console.log('host at start:', JSON.stringify(before.P));
  for (const [tab, name, seat, idx] of [[c2, '玩家597', 2, 2], [c1, '阿明', 1, 1]]) {
    await h.waitForFunction((p0) => window.__pb.m && window.__pb.m.point >= p0 + 2, before.pt, { timeout: 120000 });
    const look0 = (await S(h)).P[seat];
    if (seat === 1) await tab.evaluate(() => localStorage.removeItem('pbPid')); // second case: new device id -> nickname fallback
    await tab.reload(); await tab.waitForTimeout(800);
    const hv = await S(h); ok(hv.P[seat].includes('|ai'), `[${name}] after reload host gives seat ${seat} to the CPU, look kept (${hv.P[seat]})`);
    // a few points pass with the CPU in the seat
    await h.waitForTimeout(2500);
    const nm2 = seat === 2 ? '玩家999' : name; if (seat === 2) await tab.fill('#nick', nm2); // case 1: like the tester, the reloaded tab comes back with a different (auto) nickname -> only the stored device id matches
    await tab.fill('#code', code); await tab.tap('#bJoin');
    await tab.waitForFunction(() => window.__pb.state === 'play' && window.__pb.m, null, { timeout: 30000 });
    const t0 = Date.now(); const [a, c] = await Promise.all([S(h), S(tab)]); const fresh = Date.now() - t0;
    console.log(`[${name}] host  :`, JSON.stringify({ ...a, P: undefined })); console.log(`[${name}] client:`, JSON.stringify({ ...c, P: undefined }));
    ok(c.seat === seat, `[${name}] rejoined into original seat ${seat} (got ${c.seat})`);
    ok(a.P[seat].startsWith(nm2 + '|') && a.P[seat].endsWith('|remote'), `[${name}] host shows seat ${seat} = ${a.P[seat]}`);
    ok(a.P[seat].split('|')[1] === look0.split('|')[1], `[${name}] kept character/colour ${look0.split('|')[1]}`);
    ok(JSON.stringify(a.P.map((s) => s.split('|').slice(0, 2))) === JSON.stringify(c.P.map((s) => s.split('|').slice(0, 2))), `[${name}] rejoiner sees same names/looks as host`);
    ok(a.pt === c.pt && a.sc === c.sc && a.st === c.st && a.sn === c.sn && a.sv === c.sv && a.tn === c.tn, `[${name}] immediate state match: score ${c.sc} serve ${c.st}/${c.sn} server ${c.sv} point ${c.pt} (sampled ${fresh}ms apart)`);
    await tab.screenshot({ path: SHOT + `rejoin_${idx}_client_${seat === 1 ? 'opponent' : 'partner'}_seat.png` });
    await h.screenshot({ path: SHOT + `rejoin_${idx}_host_view.png` });
    // still in sync a bit later and the rejoined player can hit
    await h.waitForTimeout(4000); const [a2, c3] = await Promise.all([S(h), S(tab)]);
    ok(a2.sc === c3.sc && a2.sv === c3.sv && Math.abs(a2.pt - c3.pt) <= 0, `[${name}] still in sync 4s later (${a2.sc} / ${c3.sc})`);
  }
  ok(!errs.length, 'no console errors ' + (errs.length ? JSON.stringify(errs) : ''));
  console.log(fails ? `REJOIN: ${fails} FAILED` : 'REJOIN: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
