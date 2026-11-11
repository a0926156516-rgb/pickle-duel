// v12: practice ready latch (a press while a point is being scored / between points feeds at once), shorter dead time,
// first feed waits for the first input (with a prompt), forced-landscape practice panel folded and clear of the court,
// ?fps=1 readout clear of the joystick hint, no pickleball score text in practice (no 0-1 flash).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v12/';
const RT = +(process.env.RT || 36000);
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const av = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const hit = (r, [x, y]) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
const ovl = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q, tag) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    await p.addInitScript(() => { if (!sessionStorage.c) { sessionStorage.c = 1; ['pbSlow', 'pbPracDiff', 'pbOrient'].forEach((k) => localStorage.removeItem(k)); } });
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(60); };
    await p.goto(BASE + q); return { p, ctx, tapEl }; };
  const geo = () => { const ar = (el) => { const r = __pb.appRect(el); return [r.left, r.top, r.right, r.bottom].map(Math.round); }; const HL = 6.705, HW = 3.05;
    const c = [[HL, HW], [HL, -HW], [-HL, HW], [-HL, -HW]].map(([x, y]) => __pb.proj(x, y, 0).slice(0, 2).map(Math.round)); const jh = document.getElementById('joyHint'), pr = document.getElementById('prac');
    return { pr: ar(pr), c, folded: pr.classList.contains('folded'), set: getComputedStyle(document.getElementById('prSet')).display, prd: getComputedStyle(pr.querySelector('.prd')).display, jh: jh.offsetParent ? ar(jh) : null, fpsR: __pb.view.fpsR }; };
  // --- 1: ready latch + dead time (0.5×, autopilot smashes on 「現在！」; one page also presses 殺球 0.3 s after each point)
  { const runs = [];
    for (const [ready, tag] of [[0, 'no_press'], [1, 'press_after_point']]) { const r = await mk(844, 390, '?demo=smash&auto=1&diff=easy&slow=0.5', tag); runs.push({ ready, tag, ...r });
      await r.p.evaluate((ready) => { const W = (window.__w = { cue: [], fc: [], s2f: [], s2c: [], opp: 0, oppFast: 0 }); let ph = null, now = false, tDead = -1, pressed = false;
        const f = () => { const m = __pb.m; if (m) { const t = performance.now() / 1000, me = m.players[0];
          if (m.phase !== ph) { if (m.phase === 'dead') { tDead = t; pressed = false; } if (ph === 'serve' && m.phase !== 'serve' && tDead > 0) W.s2f.push(t - tDead); ph = m.phase; }
          if (ready && m.phase === 'dead' && !pressed && t - tDead > 0.3) { pressed = true; __pb.press('smash'); }
          if (m.live && Math.sign(m.ball.x) !== Math.sign(me.x) && Math.abs(m.ball.x) > 2 && m.lastHitTeam === me.team) { W.opp++; if (__pb.ts > 0.9) W.oppFast++; }
          const n = !!__pb.AID.now; if (n && !now) { W.cue.push(t); if (tDead > 0) { W.s2c.push(t - tDead); W.fc.push(t); tDead = -1; } } now = n; }
          requestAnimationFrame(f); }; f(); }, ready); }
    await new Promise((r) => setTimeout(r, RT)); const res = {};
    for (const { tag, p, ctx } of runs) { const w = await p.evaluate(() => ({ ...window.__w, rp: __pb.m.rp, pts: __pb.m.stats.points }));
      const gaps = w.cue.slice(1).map((t, i) => t - w.cue[i]).filter((g) => g > 3); res[tag] = w;
      console.log(`  [${tag}] score→feed ${av(w.s2f).toFixed(2)} s, score→「現在！」 ${av(w.s2c).toFixed(2)} s [${w.s2c.map((x) => x.toFixed(2)).join(' ')}], point-to-point 「現在！」 gap median ${med(gaps).toFixed(2)} s [${gaps.map((x) => x.toFixed(1)).join(' ')}], rally points ${w.rp} / ${w.pts}`);
      w.med = med(gaps);
      ok(w.rp && w.rp[0] + w.rp[1] === w.pts && w.pts >= 4, `[${tag}] rally points still add up (${w.rp} = ${w.pts} rallies)`);
      ok(w.opp > 0 && w.oppFast / w.opp > 0.6, `[${tag}] slow motion stays on my side: ball going away on the far side at ≥0.9× in ${(100 * w.oppFast / w.opp).toFixed(0)}% of ${w.opp} frames`);
      await ctx.close(); }
    const n = res.no_press, y = res.press_after_point;
    ok(av(y.s2c) < av(n.s2c) - 0.8 && av(y.s2f) < 1.0, `ready latch: press 0.3 s after the point → feed ${av(y.s2f).toFixed(2)} s / 「現在！」 ${av(y.s2c).toFixed(2)} s after the point, vs ${av(n.s2f).toFixed(2)} / ${av(n.s2c).toFixed(2)} s without (v11 ≈ 3.1 / 4.0 s either way)`);
    ok(av(n.s2c) <= 3.6, `shorter dead time: score→「現在！」 ${av(n.s2c).toFixed(2)} s without pressing (v11 ≈ 4.0 s)`);
    ok(n.med >= 3.5 && n.med <= 6.3 && y.med <= n.med, `0.5×: one-smash point-to-point 「現在！」 gap ${n.med.toFixed(2)} s (target 5–6 s; v11 measured 9.7 s by the tester), ${y.med.toFixed(2)} s with the ready press`); }
  // --- 2: first feed waits for the first input, with a prompt
  { const { p, ctx, tapEl } = await mk(390, 844, '?demo=smash&diff=easy', 'first'); await p.waitForTimeout(5000);
    const g = await p.evaluate(() => ({ ph: __pb.m.phase, hits: __pb.m.hits, rp: __pb.m.rp || [0, 0], pts: __pb.m.stats.points, msg: document.getElementById('msg').classList.contains('hide') ? '' : document.getElementById('msg').innerText.replace(/\s+/g, ' '), srv: document.getElementById('srv').textContent, st: __pb.PRAC.started }));
    await p.screenshot({ path: SHOT + 'first_feed_prompt_390x844.png' });
    ok(g.ph === 'serve' && !g.hits && g.pts === 0 && !g.st && /看到「現在！」就按殺球/.test(g.msg) && /按任一鍵開始/.test(g.msg) && /按任一鍵開始/.test(g.srv), `first feed waits: 5 s after load still ${g.ph}, ${g.pts} points (no 0:3 drift), prompt 「${g.msg}」, status 「${g.srv}」`);
    const t0 = Date.now(); await tapEl('#tbSmash'); await p.waitForFunction(() => __pb.m.phase !== 'serve', null, { timeout: 4000 }).catch(() => {});
    const g2 = await p.evaluate(() => ({ ph: __pb.m.phase, hidden: document.getElementById('msg').classList.contains('hide'), st: __pb.PRAC.started })); const dt = Date.now() - t0;
    ok(g2.ph !== 'serve' && g2.st && g2.hidden && dt < 1500, `first tap on 殺球 starts it: fed after ${dt} ms, prompt gone`);
    await ctx.close();
    const r2 = await mk(390, 844, '?diff=easy', 'menu'); await r2.p.waitForTimeout(600); await r2.tapEl('#bPrac'); await r2.p.waitForTimeout(2500);
    const g3 = await r2.p.evaluate(() => ({ ph: __pb.m && __pb.m.phase, st: __pb.PRAC.started, fed: __pb.PRAC.fed }));
    ok(g3.st && g3.fed, `from the menu (the 殺球練習 tap is the input): feeds without another tap (phase ${g3.ph})`); await r2.ctx.close(); }
  // --- 3: forced landscape 390×844: panel folded with 「設定 ▾」, clear of the court corners while the camera pans; fps readout clear of the joystick hint
  { const { p, ctx, tapEl } = await mk(390, 844, '?demo=smash&auto=1&diff=easy&orient=land&fps=1', 'forced'); await p.waitForTimeout(1500);
    await p.evaluate((geoS) => { const geo = eval(geoS); const W = (window.__g = { n: 0, bad: 0, ex: null, fpsBad: 0 }); const ovl = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
      const f = () => { const g = geo(); W.n++; const top = Math.min(...g.c.map((q) => q[1]));
        if (g.c.some(([x, y]) => x >= g.pr[0] && x <= g.pr[2] && y >= g.pr[1] && y <= g.pr[3]) || g.pr[3] > top - 4) { W.bad++; W.ex = W.ex || g; }
        if (g.fpsR && g.jh && ovl(g.fpsR, [g.jh[0] - 4, g.jh[1] - 4, g.jh[2] + 4, g.jh[3] + 4])) W.fpsBad++;
        if (W.n < 2000) requestAnimationFrame(f); }; f(); }, `(${geo.toString()})`);
    await p.waitForTimeout(8000); const g = await p.evaluate((geoS) => ({ ...eval(geoS)(), w: window.__g }), `(${geo.toString()})`);
    await p.screenshot({ path: SHOT + 'forced_land_practice_390x844.png' });
    ok(g.folded && g.set !== 'none' && g.prd === 'none', `forced landscape: practice panel folded (${g.pr[2] - g.pr[0]}×${g.pr[3] - g.pr[1]} px) with 「設定 ▾」 shown, settings rows hidden`);
    ok(g.w.bad === 0 && g.w.n > 50, `forced landscape: panel ${JSON.stringify(g.pr)} never covers a court corner / the far baseline over ${g.w.n} frames of play with camera pan (corners ${JSON.stringify(g.c)}) ${g.w.ex ? JSON.stringify(g.w.ex) : ''}`);
    ok(g.fpsR && g.jh && g.w.fpsBad === 0, `forced landscape ?fps=1: readout ${JSON.stringify(g.fpsR)} never overlaps 按住拖曳移動 ${JSON.stringify(g.jh)}`);
    await tapEl('#prSet'); await p.waitForTimeout(200); const o = await p.evaluate((geoS) => eval(geoS)(), `(${geo.toString()})`); await p.screenshot({ path: SHOT + 'forced_land_settings_open_390x844.png' });
    await tapEl('#prSet'); await p.waitForTimeout(200); const c2 = await p.evaluate((geoS) => eval(geoS)(), `(${geo.toString()})`);
    ok(!o.folded && o.prd !== 'none' && c2.folded, `forced landscape: 「設定 ▾」 opens the settings rows (${o.pr[3] - o.pr[1]} px tall) and folds them again (${c2.pr[3] - c2.pr[1]} px)`);
    await ctx.close(); }
  { const { p, ctx } = await mk(844, 390, '?demo=smash&auto=1&diff=easy&fps=1', 'land'); await p.waitForTimeout(1200);
    await p.evaluate((geoS) => { const geo = eval(geoS); const W = (window.__g = { n: 0, bad: 0 }); const f = () => { const g = geo(); W.n++; if (g.c.some(([x, y]) => x >= g.pr[0] && x <= g.pr[2] && y >= g.pr[1] && y <= g.pr[3])) W.bad++; if (W.n < 2000) requestAnimationFrame(f); }; f(); }, `(${geo.toString()})`);
    await p.waitForTimeout(6000); const g = await p.evaluate((geoS) => ({ ...eval(geoS)(), w: window.__g }), `(${geo.toString()})`);
    ok(g.w.bad === 0 && g.fpsR && g.jh && !ovl(g.fpsR, g.jh), `true landscape 844×390: panel never covers a court corner over ${g.w.n} frames; fps readout clear of the joystick hint`);
    await p.screenshot({ path: SHOT + 'landscape_practice_844x390.png' }); await ctx.close(); }
  // --- 4: no pickleball score text in practice at any frame (the 0-1 flash), still there in a normal match
  { const { p, ctx } = await mk(390, 844, '?demo=smash&auto=1&diff=easy', 'flash');
    await p.evaluate(() => { const W = (window.__f = { n: 0, bad: 0, ex: null }); const f = () => { const t = ['scL', 'scR', 'call'].map((id) => document.getElementById(id).textContent.trim()); W.n++;
      if (t.some((x) => x)) { W.bad++; W.ex = W.ex || t; } requestAnimationFrame(f); }; f(); });
    await p.waitForFunction(() => __pb.m && __pb.m.stats.points >= 3, null, { timeout: 30000 }).catch(() => {});
    const g = await p.evaluate(() => ({ ...window.__f, pts: __pb.m.stats.points })); ok(g.bad === 0 && g.pts >= 3, `practice: #scL/#scR/#call empty in all ${g.n} frames through ${g.pts} points ${g.ex ? JSON.stringify(g.ex) : ''}`);
    await p.evaluate(() => __pb.startLocal(1)); await p.waitForFunction(() => __pb.m && !__pb.m.practice && __pb.m.stats.points >= 1, null, { timeout: 30000 }).catch(() => {});
    const g2 = await p.evaluate(() => ({ s: [document.getElementById('scL').textContent, document.getElementById('scR').textContent], call: document.getElementById('call').textContent, pm: document.body.classList.contains('pracmode') }));
    ok(g2.s.every((x) => /^\d+$/.test(x)) && /\d.*-.*\d/.test(g2.call) && !g2.pm, `normal match still shows its score ${g2.s.join(':')} / call 「${g2.call}」`);
    await ctx.close(); }
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? `V12: ${fails} FAILED` : 'V12: ALL PASS'); process.exit(fails ? 1 : 0);
})();
