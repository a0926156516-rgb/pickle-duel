// v8: how often the 殺球 button flips between 殺球 and 抽 — v7 build vs v8 build, hard 2v2, same length as the R6 tester's window.
// Every animation frame records __pb.smashLow; an "incoming shot" is each opponent stroke (point:hits key) while live.
const { chromium } = require('playwright');
const DUR = +(process.env.DUR || 128), OLD = process.env.OLD || 'http://localhost:8078/index.html', NEW = process.env.BASE || 'http://localhost:8077/index.html';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const runs = [];
  for (const [tag, url, q] of [['v7 auto-player', OLD, '?auto=1'], ['v8 auto-player', NEW, '?auto=1'], ['v7 idle player', OLD, ''], ['v8 idle player', NEW, '']]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.pbOpt = JSON.stringify({ diff: 'hard', mode: 2 }); });
    await p.goto(url + q); await p.evaluate(() => __pb.startLocal(2)); await p.waitForFunction(() => __pb.state === 'play');
    await p.evaluate(() => { const L = (window.__tl = { tr: [], keys: {}, cur: '', last: __pb.smashLow, t0: performance.now() });
      const tick = () => { const m = __pb.m; if (m) { const me = m.players[__pb.seat];
          if (m.live && m.phase === 'rally' && m.lastHitTeam !== me.team) { const k = m.point + ':' + m.hits; if (!(k in L.keys)) L.keys[k] = 0; L.cur = k; } else L.cur = '';
          const v = __pb.smashLow; if (v !== L.last) { L.last = v; L.tr.push(performance.now()); if (L.cur) L.keys[L.cur]++; else L.between = (L.between || 0) + 1; } }
        requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    runs.push({ tag, p });
  }
  await new Promise((r) => setTimeout(r, DUR * 1000));
  const res = {};
  for (const { tag, p } of runs) {
    const r = await p.evaluate(() => { const L = window.__tl, d = []; for (let i = 1; i < L.tr.length; i++) d.push(L.tr[i] - L.tr[i - 1]); const ks = Object.values(L.keys);
      return { secs: (performance.now() - L.t0) / 1000, toggles: L.tr.length, toLow: Math.ceil(L.tr.length / 2), shots: ks.length, maxPerShot: Math.max(0, ...ks), shotsOver1: ks.filter((x) => x > 1).length, shortest: d.length ? Math.min(...d) : null, under300: d.filter((x) => x < 300).length, between: L.between || 0, fps: __pb.fps }; });
    res[tag] = r;
    console.log(`${tag.padEnd(15)} ${r.secs.toFixed(0)}s: ${r.toggles} changes (${r.toLow} to 抽) over ${r.shots} incoming shots; max ${r.maxPerShot} per shot (${r.between} outside an incoming shot), ${r.shotsOver1} shots with >1; ${r.under300} states shorter than 0.3 s (shortest ${r.shortest == null ? '—' : (r.shortest / 1000).toFixed(2) + ' s'}); ${r.fps.toFixed(0)} fps`);
  }
  for (const t of ['v8 auto-player', 'v8 idle player']) ok(res[t].maxPerShot <= 1 && res[t].under300 === 0, `${t}: ≤ 1 change per incoming shot, no flicker under 0.3 s`);
  ok(res['v8 auto-player'].toggles < res['v7 auto-player'].toggles / 2, 'v8 changes far less often than v7');
  await b.close(); console.log(fails ? `TOGGLES: ${fails} FAILED` : 'TOGGLES: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
