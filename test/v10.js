// v10: 「現在！」 cue never contradicts the label, 慢動作 + feed-on-ready + 預備 (kept press) in practice, lagged-tap check in the browser,
// landscape camera keeps my player in frame, forced-橫向 notice + pause-menu toggle, panel / cue polish.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v10/';
const LAGT = +(process.env.LAGT || 90);
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async (w, h, q, tag, init, touchOn = true) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touchOn, hasTouch: touchOn }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    if (init) await p.addInitScript(init.f, init.a);
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(60); };
    await p.goto(BASE + q); return { p, tapEl, ctx }; };
  // every frame: if the cue is on, the button must read 殺球 (no 'low', no 抽)
  const watch = (p) => p.evaluate(() => { const W = (window.__cw = { frames: 0, cue: 0, bad: 0, ex: null, lowCue: 0 }); const f = () => { const bt = document.getElementById('tbSmash'), cue = !document.getElementById('nowCue').classList.contains('hide') || bt.classList.contains('now') || __pb.AID.now;
      W.frames++; if (cue) { W.cue++; const lab = bt.querySelector('b').textContent; if (lab !== '殺球' || bt.classList.contains('low') || __pb.smashLow) { W.bad++; W.ex = W.ex || { lab, low: bt.className, sl: __pb.smashLow }; } } requestAnimationFrame(f); }; f(); });
  // --- 1. cue vs label: practice (auto) and hard 2v2 matches (auto), in parallel
  { const runs = [];
    for (const [q, tag, start] of [['?demo=smash&auto=1&diff=easy', 'practice easy', null], ['?demo=smash&auto=1&diff=hard', 'practice hard', null], ['?auto=1', 'hard 2v2', 2], ['?auto=1', 'hard 1v1', 1]]) {
      const r = await mk(390, 844, q, tag, { f: () => { localStorage.pbOpt = JSON.stringify({ diff: 'hard', mode: 2, target: 11 }); } }); if (start) await r.p.evaluate((n) => __pb.startLocal(n), start); await watch(r.p); runs.push({ tag, ...r }); }
    await new Promise((r) => setTimeout(r, +(process.env.CUET || 45) * 1000));
    for (const { tag, p, ctx } of runs) { const w = await p.evaluate(() => ({ ...window.__cw, forced: __pb.SL.forced, cues: __pb.AID.cues }));
      ok(w.cue > 20 && w.bad === 0, `[${tag}] 「現在！」 on in ${w.cue} of ${w.frames} frames (${w.cues} cues), label read 殺球 in all of them (contradictions ${w.bad}${w.ex ? ' ' + JSON.stringify(w.ex) : ''}; label put back to 殺球 for the cue ${w.forced}×)`);
      await ctx.close(); } }
  if (!process.env.ONLY) {
  // --- 2. 慢動作: ?slow, the panel switch, game clock rate; feed waits for the player (or a tap)
  { const { p, tapEl, ctx } = await mk(390, 844, '?demo=smash&slow=0.35', 'slow');
    await p.waitForTimeout(300); await tapEl('#tbLob'); /* v12: the first feed waits for the first input */ await p.waitForTimeout(500); const t0 = await p.evaluate(() => ({ g: __pb.m.t, r: performance.now() })); await p.waitForTimeout(3000); const t1 = await p.evaluate(() => ({ g: __pb.m.t, r: performance.now(), s: __pb.slow, hdr: document.getElementById('hdr').textContent, sel: document.querySelector('#prSlow .sel').textContent }));
    const rate = (t1.g - t0.g) / ((t1.r - t0.r) / 1000);
    const tsMin = await p.evaluate(() => new Promise((d) => { let mn = 9; const t0 = performance.now(); const f = () => { mn = Math.min(mn, __pb.ts); if (performance.now() - t0 < 4000) requestAnimationFrame(f); else d(mn); }; f(); })); // v11: slow only while the ball is on my side
    ok(t1.s === 0.35 && rate > 0.33 && rate < 0.95 && tsMin <= 0.36 && /慢動作 0.35×/.test(t1.hdr) && t1.sel === '0.35×', `?slow=0.35: game clock averages ${rate.toFixed(2)}× real time (0.35× while the ball is on my side, min ${tsMin.toFixed(2)}), header 「${t1.hdr}」, panel shows ${t1.sel}`);
    if (await p.evaluate(() => document.getElementById('prac').classList.contains('folded'))) await tapEl('#prSet'); await tapEl('#prSlow button[data-s="0.5"]'); const s2 = await p.evaluate(() => ({ s: __pb.slow, saved: localStorage.pbSlow, st: __pb.state }));
    ok(s2.s === 0.5 && s2.saved === '0.5' && s2.st === 'play', `panel 慢動作 switch: 0.5× (saved ${s2.saved}), still playing`);
    await tapEl('#prSlow button[data-s="1"]');
    // wait for a point to end, then time the next feed
    await p.waitForFunction(() => __pb.m.phase === 'dead', null, { timeout: 30000, polling: 20 }); /* v12: catch the start of the serve phase (it is short now) */
    await p.waitForFunction(() => __pb.m.phase === 'serve' && __pb.PRAC.fed, null, { timeout: 30000, polling: 20 }); const ts = Date.now();
    await p.waitForFunction(() => __pb.m.phase === 'rally', null, { timeout: 15000, polling: 20 }); const gap = (Date.now() - ts) / 1000;
    ok(gap >= 0.9 && gap <= 2, `after a point the next feed waits ${gap.toFixed(1)} s, or less if I press (v9: 0.8 s; v11: 2.5 s; v12: 1.1 s after a 0.9 s pause)`);
    await p.screenshot({ path: SHOT + 'practice_panel_slow_390x844.png' });
    await p.waitForFunction(() => __pb.m.phase === 'serve', null, { timeout: 30000, polling: 20 }); const srv = await p.evaluate(() => document.getElementById('srv').textContent);
    await p.waitForTimeout(500); const ta = Date.now(); await tapEl('#tbDrive'); await p.waitForFunction(() => __pb.m.phase === 'rally', null, { timeout: 5000, polling: 20 }).catch(() => {}); const tg = (Date.now() - ta) / 1000;
    ok(tg < 0.6 && /按任一擊球鍵/.test(srv), `「${srv}」: a tap on 抽球 feeds at once (${tg.toFixed(2)} s)`);
    await ctx.close(); }
  // --- 3. 預備: a 殺球 tap made right after the feed leaves (long before contact) still smashes
  { const { p, tapEl, ctx } = await mk(390, 844, '?demo=smash&auto=move&slow=0.35&diff=easy', 'arm');
    let got = 0, tries = 0, last = '';
    for (let k = 0; k < 4; k++) {
      last = await (await p.waitForFunction((last) => __pb.m.phase === 'rally' && __pb.m.lastHitTeam === 1 && __pb.m.point + ':' + __pb.m.hits !== last && __pb.m.point + ':' + __pb.m.hits, last, { timeout: 30000, polling: 20 })).jsonValue(); tries++;
      const n0 = await p.evaluate(() => __pb.juice.n); await tapEl('#tbSmash'); const a = await p.evaluate(() => __pb.armed);
      if (k === 0) { await p.waitForTimeout(150); await p.screenshot({ path: SHOT + 'practice_armed_badge_390x844.png' }); }
      await p.waitForFunction(() => __pb.m.lastHitTeam === 0 || __pb.m.phase !== 'rally', null, { timeout: 15000, polling: 20 }).catch(() => {}); await p.waitForTimeout(100);
      const n1 = await p.evaluate(() => __pb.juice.n); if (process.env.V) console.log('   try', k, last, 'armed', a, 'n', n0, '->', n1); if (a && n1 > n0) got++; }
    ok(got >= 3, `practice 預備: tapping 殺球 as soon as the feed leaves the CPU smashed ${got} of ${tries} balls (badge 「預備」 shown until contact)`);
    await ctx.close(); }
  // --- 4. lagged taps in the browser: autopilot walks, a script taps 殺球 1–3 s (real) after each feed leaves the CPU
  { const cfgs = [['1×', '?demo=smash&auto=move&diff=easy&slow=1'], ['0.5×', '?demo=smash&auto=move&diff=easy&slow=0.5'], ['0.35×', '?demo=smash&auto=move&diff=easy&slow=0.35']];
    const pages = []; for (const [tag, q] of cfgs) { const r = await mk(390, 844, q, 'lag ' + tag); pages.push({ tag, ...r, balls: 0, taps: 0, key: '' }); }
    const t0 = Date.now(); let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    while (Date.now() - t0 < LAGT * 1000) {
      for (const P of pages) { const s = await P.p.evaluate(() => ({ inc: __pb.m.phase === 'rally' && __pb.m.lastHitTeam === 1, k: __pb.m.point + ':' + __pb.m.hits }));
        if (s.inc && s.k !== P.key) { P.key = s.k; P.balls++; const lag = 1000 + rnd() * 2000; setTimeout(() => { P.taps++; P.tapEl('#tbSmash').catch(() => {}); }, lag); } }
      await new Promise((r) => setTimeout(r, 50)); }
    await new Promise((r) => setTimeout(r, 3500));
    const L = {};
    for (const P of pages) { const s = await P.p.evaluate(() => __pb.m.smStats[0]); L[P.tag] = { ...s, balls: P.balls };
      console.log(`lagged taps (1–3 s) at ${P.tag.padEnd(5)} ${LAGT}s real: ${P.balls} balls, ${s.n} real smashes (${pct(s.n, P.balls)}), won ${s.win + s.forced} (${pct(s.win + s.forced, s.n)} of smashes), smash winners per ball ${pct(s.win + s.forced, P.balls)}`);
      await P.ctx.close(); }
    ok(L['0.35×'].n / L['0.35×'].balls >= 0.5 && L['0.35×'].n / L['0.35×'].balls > L['1×'].n / Math.max(1, L['1×'].balls), `0.35× + 預備: ${pct(L['0.35×'].n, L['0.35×'].balls)} of balls smashed with 1–3 s tap lag (1×: ${pct(L['1×'].n, L['1×'].balls)})`); }
  // --- 5. landscape camera: my player pushed to the very back of the court stays fully on screen
  for (const [w, h, q, tag, tch, Y] of [[1000, 560, '?demo=smash', 'desktop_1000x560', false, -0.8], [1000, 560, '?demo=smash', 'desktop_1000x560_corner', false, -2.6], [844, 390, '?demo=smash', 'landscape_844x390', true, -0.8], [390, 844, '?demo=smash&orient=land', 'forced_land_390x844', true, -2.6]]) {
    const { p, ctx } = await mk(w, h, q, tag, null, tch); await p.waitForTimeout(800);
    const put = (Y) => p.evaluate((Y) => { __pb.m.players[0].x = -9.3; __pb.m.players[0].y = Y; }, Y).catch(() => {}); await put(Y);
    const keep = setInterval(() => put(Y), 60);
    await p.waitForTimeout(1500); clearInterval(keep);
    const g = await p.evaluate(() => { const q = __pb.proj(__pb.m.players[0].x, __pb.m.players[0].y, 0), v = __pb.view; return { l: q[0] - q[2] * 0.5, r: q[0] + q[2] * 0.5, W: v.W, pan: v.pan }; });
    await p.screenshot({ path: SHOT + `camera_back_corner_${tag}.png` });
    ok(g.l >= 0 && g.r <= g.W, `[${tag}] player at the very back (x −9.3 m, y ${Y}): ring ${g.l.toFixed(0)}–${g.r.toFixed(0)} px inside 0–${g.W} (camera slid ${g.pan.toFixed(0)} px)`);
    await ctx.close(); }
  // --- 6. forced 橫向: notice on start, one tap back to 直向 in the pause menu
  { const { p, tapEl, ctx } = await mk(390, 844, '', 'orient', { f: () => { if (!sessionStorage.o) { sessionStorage.o = 1; localStorage.pbOrient = 'land'; } } });
    await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(900);
    const t = await p.evaluate(() => ({ toast: !document.getElementById('toast').classList.contains('hide') && document.getElementById('toast').textContent, forced: document.body.classList.contains('forced') }));
    await p.screenshot({ path: SHOT + 'forced_land_notice_390x844.png' });
    ok(t.forced && /橫向模式/.test(t.toast || ''), `remembered 橫向 on an upright phone is announced: 「${t.toast}」`);
    await tapEl('#bPause'); await p.waitForTimeout(300); const sel = await p.evaluate(() => document.querySelector('#segOrient2 .sel') && document.querySelector('#segOrient2 .sel').textContent);
    await p.screenshot({ path: SHOT + 'pause_orient_toggle_forced_390x844.png' });
    await tapEl('#segOrient2 button[data-v="port"]'); await p.waitForTimeout(500);
    const a = await p.evaluate(() => ({ forced: document.body.classList.contains('forced'), saved: localStorage.pbOrient, port: __pb.view.port }));
    ok(sel === '橫向' && !a.forced && a.saved === 'port' && a.port, `pause menu shows 畫面 ${sel}; one tap on 直向 → portrait layout (saved ${a.saved})`);
    await tapEl('#bResume'); await p.waitForTimeout(400); await p.screenshot({ path: SHOT + 'after_toggle_portrait_390x844.png' }); await ctx.close(); }
  // --- 7. polish: 尚未殺球, larger details, bigger 現在！
  { const { p, ctx } = await mk(390, 844, '?demo=smash&auto=1&diff=easy', 'polish'); await p.waitForTimeout(300);
    const a = await p.evaluate(() => ({ rate: document.getElementById('prRateL').textContent, det: parseFloat(getComputedStyle(document.getElementById('prDet')).fontSize) }));
    ok(/尚未殺球/.test(a.rate) && a.det >= 12.5, `panel before any smash 「${a.rate}」, details ${a.det}px`);
    await p.evaluate(() => __pb.freezeAid()); await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 30000, polling: 100 });
    await p.evaluate(() => document.getAnimations().forEach((x) => { x.pause(); x.currentTime = 160; }));
    const c = await p.evaluate(() => ({ fs: parseFloat(getComputedStyle(document.getElementById('nowCue')).fontSize), lab: document.querySelector('#tbSmash b').textContent }));
    await p.screenshot({ path: SHOT + 'now_cue_portrait_390x844.png' });
    ok(c.fs >= 16 && c.lab === '殺球', `「現在！」 badge ${c.fs}px on a button reading ${c.lab}`);
    await ctx.close(); }
  { const { p, ctx } = await mk(844, 390, '?demo=smash&auto=1&diff=easy', 'polishL'); await p.waitForTimeout(400);
    await p.evaluate(() => __pb.freezeAid()); await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 30000, polling: 100 });
    await p.evaluate(() => document.getAnimations().forEach((x) => { x.pause(); x.currentTime = 160; })); await p.screenshot({ path: SHOT + 'now_cue_landscape_844x390.png' }); await ctx.close(); }
  }
  ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? `V10: ${fails} FAILED` : 'V10: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
