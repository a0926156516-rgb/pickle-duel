// R4 checks: far name tags clear of the scoreboard, own-team-first score popups + HUD, hints never on top of the ball,
// landscape fault box clear of scoreboard/brand/buttons, fps label vs key help, brand top-right everywhere, ball size ≤375px,
// fault attribution (who faulted + which side gets the serve).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v5/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const inter = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (w, h, q, touch = true) => { const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto(BASE + (q || '?auto=1')); return p; };
  // --- portrait 2v2: tags vs HUD, hint vs ball, popups own-team-first, ball size
  for (const [W, H] of [[375, 667], [390, 844], [360, 740], [320, 568]]) {
    const p = await open(W, H); await p.tap('#bS2'); await p.waitForFunction(() => __pb.state === 'play');
    const r = await p.evaluate(() => new Promise((done) => { const t0 = performance.now(); let tagBad = [], tipBad = 0, tipSeen = 0, calls = [], rmin = 99, hudBad = [];
      const last = { a: '' };
      const f = () => { const v = __pb.view, m = __pb.m;
        for (const t of v.tags) for (const h of v.hud) if (t.l < h.r && h.l < t.r && t.t < h.b + 2) tagBad.push(t.i + '@' + (t.t | 0) + '<' + (h.b | 0));
        const tip = document.getElementById('tip'); if (!tip.classList.contains('hide')) { tipSeen++; const q = __pb.proj(m.ball.x, m.ball.y, m.ball.z), rr = tip.getBoundingClientRect(), pad = v.ballR;
          if (q[0] > rr.left - pad && q[0] < rr.right + pad && q[1] > rr.top - pad && q[1] < rr.bottom + pad && +getComputedStyle(tip).opacity > 0.3) tipBad++; }
        const e = document.getElementById('msg'); if (e.classList.contains('call') && !e.classList.contains('hide')) { const a = document.getElementById('msgA').innerText; if (a !== last.a) { last.a = a; const own = __pb.m.score[__pb.seat % 2], op = __pb.m.score[1 - __pb.seat % 2]; calls.push({ a, own, op, hl: !!document.querySelector('#msgA .own') }); } }
        const own = __pb.m.score[__pb.seat % 2], op = __pb.m.score[1 - __pb.seat % 2], c = document.getElementById('call').innerText.replace(/\s/g, ''), scL = document.getElementById('scL').innerText;
        if (c !== own + '-' + op || +scL !== own || !document.querySelector('#call .own')) hudBad.push(c + '/' + scL + ' vs ' + own + '-' + op);
        rmin = Math.min(rmin, v.ballR || 99);
        if (performance.now() - t0 < 40000) requestAnimationFrame(f); else done({ tagBad: [...new Set(tagBad)].slice(0, 5), tipBad, tipSeen, calls, rmin, hudBad: [...new Set(hudBad)].slice(0, 3) }); };
      f(); }));
    ok(!r.tagBad.length, `${W}x${H} 2v2 far name tags always below the scoreboard/brand ${r.tagBad.join(',')}`);
    ok(r.tipBad === 0, `${W}x${H} hint never covers the ball at full opacity (hint ${r.tipSeen} frames, ${r.tipBad} bad)`);
    const callsOk = r.calls.length >= 1 && r.calls.every((c) => c.hl && c.a.replace(/\s/g, '').startsWith('你' + c.own + '–' + c.op + '對手'));
    ok(callsOk, `${W}x${H} score popups own team first 「你 x – y 對手」 + own highlighted: ${r.calls.map((c) => c.a.replace(/\s+/g, ' ')).join(' | ')}`);
    ok(!r.hudBad.length, `${W}x${H} HUD centre score own team first, same as the rows ${r.hudBad.join(',')}`);
    if (W <= 375) ok(r.rmin >= 7, `${W}x${H} ball radius ≥ 7 px on ≤375px screens (min ${r.rmin.toFixed(1)})`);
    if (W === 375) await p.screenshot({ path: SHOT + 'portrait_2v2_375x667.png' });
    await p.context().close();
  }
  // --- receive-score popup screenshot: wait for a call while my team is receiving and the opponents lead
  { const p = await open(375, 667); await p.tap('#bS1'); await p.waitForFunction(() => __pb.state === 'play');
    await p.waitForTimeout(1500);
    // opponent serving at 2-5 (me on team 0 = 2): start that point through the real setupPoint -> 'call' event -> popup
    await p.evaluate(() => { const m = __pb.m, me = __pb.seat % 2, op = 1 - me; m.score[me] = 2; m.score[op] = 5; m.servingTeam = op; m.server = m.players.find((q) => q.team === op).i; PB.setupPoint(m); });
    await p.waitForFunction(() => { const e = document.getElementById('msg'); return e.classList.contains('call') && !e.classList.contains('hide') && __pb.m.servingTeam !== __pb.seat % 2 && __pb.m.point > 0; }, null, { timeout: 15000, polling: 30 }).catch(() => {});
    await p.waitForTimeout(0); const t = await p.evaluate(() => ({ a: document.getElementById('msgA').innerText, s: __pb.m.score, me: __pb.seat % 2, srv: __pb.m.servingTeam }));
    ok(/^你 \d+ – \d+ 對手$/.test(t.a.trim()) && t.srv !== t.me && t.a.includes(`你 ${t.s[t.me]} – ${t.s[1 - t.me]}`), `receiving: popup 「${t.a.trim()}」 own first even though the opponent serves (score ${t.s})`);
    await p.waitForTimeout(280); await p.screenshot({ path: SHOT + 'receive_score_popup_375x667.png' });
    { const h = await p.evaluate(() => document.getElementById('hdr').innerText); ok(/^單打・普通・11分$/.test(h), `HUD header shows mode/difficulty/target 「${h}」`); } await p.context().close(); }
  // --- fault attribution (local 1v1): CPU serve into the net vs my serve into the net
  for (const mine of [false, true]) {
    const p = await open(390, 844, '?'); await p.tap('#bS1'); await p.waitForFunction(() => __pb.state === 'play');
    await p.waitForFunction((mine) => __pb.m.phase === 'serve' && (__pb.m.server === __pb.seat) === mine, mine, { timeout: 60000, polling: 50 }).catch(() => {});
    if (mine) await p.evaluate(() => __pb.press('drive'));
    await p.waitForFunction(() => __pb.m.phase === 'rally', null, { timeout: 20000, polling: 10 });
    const who = await p.evaluate(() => { const b = __pb.m.ball; b.vz = -1; b.vx *= 0.6; return __pb.m.players[__pb.m.lastHitter].name; }); // straight into the net
    await p.waitForFunction(() => !document.getElementById('msg').classList.contains('hide') && /掛網|未過網/.test(document.getElementById('msgA').innerText), null, { timeout: 8000, polling: 20 }).catch(() => {});
    const t = await p.evaluate(() => document.getElementById('msgA').innerText + ' / ' + document.getElementById('msgB').innerText);
    const want = mine ? new RegExp(`${who}（你） 失誤・換對手發球`) : new RegExp(`${who}（對手） 失誤・換你方發球`);
    ok(want.test(t), `${mine ? 'my' : 'CPU'} serve into the net is blamed on the server: 「${t}」`);
    await p.context().close();
  }
  // --- landscape + desktop: fault box clear of scoreboard / brand / buttons; brand top-right; fps vs key help
  for (const [W, H, touch, tag] of [[667, 375, true, 'land_667x375'], [844, 390, true, 'land_844x390'], [1280, 720, false, 'desktop_1280x720'], [1920, 1080, false, 'desktop_1920x1080']]) {
    const p = await open(W, H, '?auto=1&fps=1', touch); await p.tap('#bS2').catch(() => p.click('#bS2')); await p.waitForFunction(() => __pb.state === 'play'); await p.waitForTimeout(1200);
    const res = [];
    for (const [a, bb] of [['廚房區內截擊（非截擊區犯規）', '峻慶（你） 失誤・換對手發球（Side Out）'], ['發球未落在對角發球區', '小攀甲（對手） 失誤・你方得分！'], ['你 3 – 7 對手', '報分 7-3-1・發球：小攀甲']]) {
      await p.evaluate(([a, bb]) => __pb.showMsg(a, bb, 'bad', 4000), [a, bb]); await p.waitForTimeout(450);
      const r = await p.evaluate(([a, bb]) => { const g = (id) => document.getElementById(id).getBoundingClientRect(); const m = g('msg'), o = {}; for (const id of ['board', 'brand', 'bPause', 'bSound']) o[id] = g(id); return { m, o, W: innerWidth }; }, [a, bb]);
      const hit = Object.entries(r.o).filter(([k, v]) => v.width && inter(R(r.m), R(v))).map(([k]) => k);
      res.push(hit.length ? a + '→' + hit.join('+') : ''); if (a.startsWith('廚房')) await p.screenshot({ path: SHOT + `fault_${tag}.png` });
      ok(!hit.length && r.m.width <= Math.max(460, r.W * 0.6), `${tag} fault box (${r.m.width | 0}px wide) clear of scoreboard/brand/buttons: ${a}${hit.length ? ' overlaps ' + hit.join('+') : ''}`);
    }
    const br = await p.evaluate(() => { const r = document.getElementById('brand').getBoundingClientRect(); return { r: r.right, t: r.top, W: innerWidth }; });
    ok(br.r > br.W - 30 && br.t < 110, `${tag} brand at top-right (right edge ${br.r | 0} of ${br.W}, top ${br.t | 0})`);
    if (!touch) { await p.keyboard.press('KeyA'); await p.waitForTimeout(300);
      const k = await p.evaluate(() => { const r = document.getElementById('keys').getBoundingClientRect(); return { kt: r.top, kl: r.left, fy: __pb.view.fpsY, vis: !document.getElementById('keys').classList.contains('hide') }; });
      ok(!k.vis || k.fy < k.kt || k.kl > 70, `${tag} fps label (baseline ${k.fy}) clear of the key help (top ${k.kt | 0}, left ${k.kl | 0})`);
      await p.evaluate(() => document.getElementById('msg').classList.add('hide')); await p.waitForTimeout(200);
      if (W === 1280) await p.screenshot({ path: SHOT + 'desktop_1280x720.png' }); }
    await p.context().close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(fails ? `V5 UI: ${fails} FAILED` : 'V5 UI: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
