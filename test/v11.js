// v11: practice rally points (score hidden), panel rows fixed (no jump), smash-button badges/aria, 「含逼失誤」, faster slow-mo feeds,
// plus screenshots: tap-to-feed, camera at the far left, 「現在！」 in a normal match.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html', OLD = process.env.OLD || 'http://localhost:8079/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v11/';
const FT = +(process.env.FT || 90);
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q, tag, init, touchOn = true, base = BASE) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touchOn, hasTouch: touchOn }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    if (init) await p.addInitScript(init.f, init.a);
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(60); };
    await p.goto(base + q); return { p, tapEl, ctx }; };
  const clean = { f: () => { if (!sessionStorage.c) { sessionStorage.c = 1; localStorage.removeItem('pbSlow'); localStorage.removeItem('pbPracDiff'); } } };
  // --- 1+2+3+4: rally points, fixed panel, badges / aria (auto practice, three layouts in parallel)
  { const runs = [];
    for (const [w, h, q, tag] of [[390, 844, '', 'portrait_390x844'], [844, 390, '', 'landscape_844x390'], [390, 844, '&orient=land', 'forced_land_390x844']]) {
      const r = await mk(w, h, '?demo=smash&auto=1&diff=easy' + q, tag, clean); runs.push({ tag, ...r });
      await r.p.evaluate(() => { const W = (window.__v = { h0: null, hs: new Set(), pr1: new Set(), frames: 0, txtBad: 0, ariaBad: 0, ex: null, states: {} }); const el = document.getElementById('prac');
        const f = () => { if (!el.classList.contains('hide') && el.offsetHeight) { W.hs.add(el.offsetHeight); W.pr1.add(el.querySelector('.pr1').offsetHeight); }
          const bt = document.getElementById('tbSmash'), t = bt.textContent, a = bt.getAttribute('aria-label'), now = bt.classList.contains('now'), arm = bt.classList.contains('armed'), low = __pb.smashLow; W.frames++;
          const st = low ? 'low' : now ? 'now' : arm ? 'armed' : 'idle'; W.states[st] = (W.states[st] || 0) + 1;
          if ((!now && /現在/.test(t)) || (!arm && /預備/.test(t))) { W.txtBad++; W.ex = W.ex || t; }
          const want = low ? /^抽球/ : now ? /現在/ : arm ? /預備/ : /^殺球$/; if (!want.test(a || '')) { W.ariaBad++; W.ex = W.ex || st + ':' + a; }
          requestAnimationFrame(f); }; f(); }); }
    await new Promise((r) => setTimeout(r, 60000));
    for (const { tag, p, ctx } of runs) {
      const g = await p.evaluate(() => { const m = __pb.m, s = m.smStats[0], el = document.getElementById('prac'); return { rp: m.rp, pts: m.stats.points, s, txt: el.innerText.replace(/\s+/g, ' '), hs: [...window.__v.hs], pr1: [...window.__v.pr1], v: window.__v, sc: getComputedStyle(document.getElementById('scL')).visibility, call: getComputedStyle(document.getElementById('call')).visibility, incl: el.querySelector('.incl') && el.querySelector('.incl').title }; });
      ok(g.rp && g.rp[0] + g.rp[1] === g.pts && g.rp[0] >= g.s.win + g.s.forced && new RegExp(`你\\s*${g.rp[0]}\\s*:\\s*${g.rp[1]}\\s*對手`).test(g.txt) && g.sc === 'hidden' && g.call === 'hidden',
        `[${tag}] rally points 你 ${g.rp && g.rp[0]} : ${g.rp && g.rp[1]} 對手 = ${g.pts} rallies; smash winners ${g.s.win} + forced ${g.s.forced} all scored for me; pickleball score hidden`);
      ok(g.hs.length === 1 && g.pr1.length === 1 && g.s.n > 0, `[${tag}] panel height constant ${g.hs.join('/')} px before and after 致勝率 appears (title row ${g.pr1.join('/')} px, one line)`);
      ok(/含逼失誤/.test(g.txt) && /致勝 \+ 逼失誤/.test(g.incl || ''), `[${tag}] 「含逼失誤」 label (title 「${g.incl}」)`);
      ok(g.v.txtBad === 0 && g.v.ariaBad === 0 && (g.v.states.now || 0) > 0 && (g.v.states.idle || 0) > 0, `[${tag}] smash button over ${g.v.frames} frames ${JSON.stringify(g.v.states)}: hidden badges never in its text, aria-label matches the state every frame ${g.v.ex ? JSON.stringify(g.v.ex) : ''}`);
      await p.screenshot({ path: SHOT + `practice_panel_${tag}.png` }); await ctx.close(); } }
  { const { p, tapEl, ctx } = await mk(390, 844, '?demo=smash&diff=easy', 'fold', clean); await p.waitForSelector('#prSet', { state: 'visible', timeout: 8000 }).catch(() => {}); await p.waitForTimeout(300);
    const h0 = await p.evaluate(() => ({ f: document.getElementById('prac').classList.contains('folded'), h: document.getElementById('prac').offsetHeight }));
    await tapEl('#prSet'); await p.waitForTimeout(150); const h1 = await p.evaluate(() => ({ f: document.getElementById('prac').classList.contains('folded'), h: document.getElementById('prac').offsetHeight, st: __pb.state }));
    await p.screenshot({ path: SHOT + 'practice_settings_open_390x844.png' });
    await tapEl('#prDiff button[data-d="normal"]'); const d = await p.evaluate(() => __pb.m.diff);
    ok(h0.f && !h1.f && h1.h > h0.h + 30 && d === 'normal' && h1.st === 'play', `portrait: settings folded (${h0.h}px) → tap 設定 → difficulty / 慢動作 rows (${h1.h}px), switch works (${d})`); await ctx.close(); }
  // low state aria (match): force a low incoming ball
  { const { p, ctx } = await mk(390, 844, '', 'aria'); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(1200);
    const lows = await p.evaluate(() => new Promise((done) => { const t0 = performance.now(), seen = []; const f = () => { const bt = document.getElementById('tbSmash'); if (__pb.smashLow) seen.push([bt.getAttribute('aria-label'), bt.textContent]); if (performance.now() - t0 < 25000 && seen.length < 3) requestAnimationFrame(f); else done(seen.slice(0, 1)); }; f(); }));
    ok(!lows.length || (/^抽球/.test(lows[0][0]) && lows[0][1] === '抽▼'), `抽 ▼ state: aria-label 「${lows[0] && lows[0][0]}」, text 「${lows[0] && lows[0][1]}」 (no hidden 現在／預備 text)`); await ctx.close(); }
  // --- 5. time per feed: v10 (constant slow) vs v11 (slow only on my side), autopilot playing
  { const cfg = []; for (const [ver, base] of [['v10', OLD], ['v11', BASE]]) for (const sl of ['1', '0.5', '0.35']) cfg.push({ ver, sl, base });
    const pages = []; for (const c of cfg) { const r = await mk(390, 844, `?demo=smash&auto=1&diff=easy&slow=${c.sl}`, c.ver + c.sl, null, true, c.base); pages.push({ ...c, ...r }); }
    for (const P of pages) await P.p.evaluate(() => { window.__f = { n: 0, key: '', t: [] }; setInterval(() => { const m = __pb.m; if (!m) return; const k = m.point + ':' + m.hits; if (m.phase === 'rally' && m.lastHitTeam === 1 && k !== window.__f.key) { window.__f.key = k; window.__f.n++; window.__f.t.push(performance.now()); } }, 20); });
    await new Promise((r) => setTimeout(r, FT * 1000)); const R = {};
    for (const P of pages) { const f = await P.p.evaluate(() => window.__f); const per = f.n > 1 ? (f.t[f.t.length - 1] - f.t[0]) / 1000 / (f.n - 1) : 99; R[P.ver + P.sl] = per;
      const pt = await P.p.evaluate(() => __pb.m.stats.points); console.log(`${P.ver} slow ${P.sl.padEnd(4)}: ${f.n} balls in ${FT}s → ${per.toFixed(1)} s per ball; ${pt} rallies → ${(FT / Math.max(1, pt)).toFixed(1)} s per rally`); await P.ctx.close(); }
    ok(R['v110.35'] <= 10 && R['v110.35'] < R['v100.35'] * 0.75, `0.35×: ${R['v110.35'].toFixed(1)} s per ball (v10 ${R['v100.35'].toFixed(1)} s; target ≤ 8–10 s)`);
    ok(R['v110.5'] < R['v100.5'], `0.5×: ${R['v110.5'].toFixed(1)} s per ball (v10 ${R['v100.5'].toFixed(1)} s)`); }
  // slow default
  { const { p, ctx } = await mk(390, 844, '?demo=smash&slow', 'slowon', clean); await p.waitForTimeout(400); const s = await p.evaluate(() => __pb.slow); ok(s === 0.5, `?slow (on) defaults to ${s}×`); await ctx.close(); }
  // --- 6a. a shot-button tap feeds at once (screenshots before / after)
  { const { p, tapEl, ctx } = await mk(390, 844, '?demo=smash&diff=easy', 'tapfeed', clean);
    await p.waitForTimeout(500); await tapEl('#tbLob'); // v12: the first feed waits for the first input
    await p.waitForFunction(() => __pb.m.phase === 'serve' && __pb.PRAC.fed, null, { timeout: 40000, polling: 20 }); await p.waitForTimeout(600);
    await p.screenshot({ path: SHOT + 'tap_feed_1_waiting_390x844.png' }); const srv = await p.evaluate(() => document.getElementById('srv').textContent);
    const t0 = Date.now(); await tapEl('#tbDrive'); await p.waitForFunction(() => __pb.m.phase === 'rally' && __pb.m.lastHitTeam === 1, null, { timeout: 4000, polling: 10 }).catch(() => {}); const dt = (Date.now() - t0) / 1000;
    await p.waitForTimeout(250); await p.screenshot({ path: SHOT + 'tap_feed_2_fed_390x844.png' });
    ok(dt < 0.5 && /按任一擊球鍵/.test(srv), `「${srv}」 → tap 抽球 → feed in ${dt.toFixed(2)} s`); await ctx.close(); }
  // --- 6b. camera follows me at the far left (practice, live play)
  for (const [w, h, q, tag, tch] of [[1000, 560, '?demo=smash', 'desktop_1000x560', false], [844, 390, '?demo=smash', 'landscape_844x390', true], [390, 844, '?demo=smash&orient=land', 'forced_land_390x844', true]]) {
    const { p, ctx } = await mk(w, h, q, tag, clean, tch); await p.waitForTimeout(600);
    const put = () => p.evaluate(() => { const q = __pb.m.players[0]; q.x = -9.3; q.y = -1.6; }).catch(() => {}); await put(); const k = setInterval(put, 50); await p.waitForTimeout(1500); clearInterval(k);
    const g = await p.evaluate(() => { const q = __pb.proj(__pb.m.players[0].x, __pb.m.players[0].y, 0), v = __pb.view; return { l: q[0] - q[2] * 0.5, r: q[0] + q[2] * 0.5, W: v.W, pan: v.pan }; });
    await p.screenshot({ path: SHOT + `camera_far_left_${tag}.png` });
    ok(g.l >= 0 && g.r <= g.W, `[${tag}] far left (x −9.3 m): my ring ${g.l.toFixed(0)}–${g.r.toFixed(0)} px within 0–${g.W} (camera slid ${g.pan.toFixed(0)} px)`); await ctx.close(); }
  // --- 6c. 「現在！」 in a normal match (frame held when the cue lights)
  for (const [w, h, tag, n] of [[390, 844, 'portrait_390x844_1v1', 1], [844, 390, 'landscape_844x390_2v2', 2]]) {
    const { p, ctx } = await mk(w, h, '?auto=1', tag); await p.evaluate((n) => __pb.startLocal(n), n);
    await p.evaluate(() => __pb.freezeAid()); const got = await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 60000, polling: 100 }).then(() => true).catch(() => false);
    await p.evaluate(() => document.getAnimations().forEach((x) => { x.pause(); x.currentTime = 160; }));
    const g = await p.evaluate(() => ({ pr: !!__pb.m.practice, lab: document.querySelector('#tbSmash b').textContent, cue: document.getElementById('nowCue').textContent, aria: document.getElementById('tbSmash').getAttribute('aria-label') }));
    await p.screenshot({ path: SHOT + `now_cue_match_${tag}.png` });
    ok(got && !g.pr && g.cue === '現在！' && g.lab === '殺球' && /現在/.test(g.aria), `[${tag}] normal match: 「${g.cue}」 on a button reading ${g.lab} (aria 「${g.aria}」)`); await ctx.close(); }
  ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? `V11: ${fails} FAILED` : 'V11: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
