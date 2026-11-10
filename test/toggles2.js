// v9: reproduce the R7 report — poll __pb.smashLow every 100 ms (like the tester) in portrait 390x844, hard 2v2, several runs, through
// the final seconds and the match end; every change is logged with its context so the cause can be read off.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const DUR = +(process.env.DUR || 70), RUNS = (process.env.RUNS || 'auto,keys,idle,keys2').split(',');
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const runs = [];
  for (const kind of RUNS) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.pbOpt = JSON.stringify({ diff: 'hard', mode: 2, target: +(new URLSearchParams(location.search).get('t') || 11) }); });
    await p.goto(BASE + (kind === 'auto' ? '?auto=1&' : '?') + 't=' + (process.env.T || 11) + (process.env.FEND ? '&fend=1' : '')); await p.evaluate(() => __pb.startLocal(2)); await p.waitForFunction(() => __pb.state === 'play');
    await p.evaluate((kind) => {
      const L = (window.__w = { kind, last: __pb.smashLow, n: 0, log: [], t0: performance.now(), ends: 0, endT: [], keys: {}, mid: 0, lm: null }); let wasEnd = false;
      setInterval(() => { const e = __pb.state === 'end'; if (e && !wasEnd) L.endT.push(+((performance.now() - L.t0) / 1000).toFixed(1)); wasEnd = e; }, 50);
      if (+new URLSearchParams(location.search).get('fend')) setInterval(() => { const m = __pb.m; if (!m || __pb.state !== 'play') return; const T = m.target, hi = Math.max(m.score[0], m.score[1]); if (hi < T - 1) { const w = Math.random() < 0.5 ? 0 : 1; m.score[w] = T - 1; m.score[1 - w] = Math.min(m.score[1 - w], T - 3); } }, 15000); // jump to game point so matches end inside the run
      setInterval(() => { const m = __pb.m; if (!m) return; const me = m.players[__pb.seat];
        const inc = m.live && m.phase === 'rally' && m.lastHitTeam !== me.team, k = (m !== L.lm ? (L.lm = m, ++L.mid) : L.mid) + ':' + m.point + ':' + m.hits; if (inc && !(k in L.keys)) L.keys[k] = 0;
        const v = __pb.smashLow; const pk = L.pk; L.pk = inc ? k : null; let inc2 = inc, k2 = k; if (!inc && pk) { inc2 = true; k2 = pk; } // a change in the last 100 ms before my own stroke belongs to the shot that was coming
        if (v !== L.last) { L.last = v; L.n++; if (inc2) L.keys[k2]++;
          L.log.push({ t: +((performance.now() - L.t0) / 1000).toFixed(1), v: v ? 1 : 0, st: __pb.state, ph: m.phase, pt: m.point, h: m.hits, lh: m.lastHitHack, lt: m.lastHitTeam, lr: m.lastHitter, inc: inc2 ? 1 : 0, late: inc2 && !inc ? 1 : 0, mt: m.mode, sc: m.score.join('-') }); } }, 100);
      if (kind.startsWith('keys')) { // human-ish: wander with WASD toward the ball, mash I / J now and then, like the tester
        const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD']; let held = null;
        setInterval(() => { const m = __pb.m; if (!m) return; const me = m.players[__pb.seat]; const want = m.ball.x < me.x - 0.5 ? 'KeyA' : m.ball.x > me.x + 0.5 ? 'KeyD' : (m.ball.y > me.y ? 'KeyW' : 'KeyS');
          const k = kind === 'keysbad' ? (Math.random() < 0.5 ? 'KeyA' : keys[(Math.random() * 4) | 0]) : Math.random() < 0.7 ? want : keys[(Math.random() * 4) | 0];
          if (held !== k) { if (held) dispatchEvent(new KeyboardEvent('keyup', { code: held })); dispatchEvent(new KeyboardEvent('keydown', { code: k })); held = k; }
          if (Math.random() < (kind === 'keys2' ? 0.5 : 0.25)) { const c = Math.random() < 0.6 ? 'KeyI' : 'KeyJ'; dispatchEvent(new KeyboardEvent('keydown', { code: c })); setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: c })), 60); }
          if (__pb.state === 'end') { window.__w.ends++; document.getElementById('bAgain').click(); } }, 120);
      } else setInterval(() => { if (__pb.state === 'end') { window.__w.ends++; document.getElementById('bAgain').click(); } }, 500);
    }, kind);
    runs.push({ kind, p, i: runs.length });
  }
  await new Promise((r) => setTimeout(r, DUR * 1000));
  let worst = 0;
  for (const r of runs) { const { kind, p } = r;
    const w = await p.evaluate(() => window.__w); const ks = Object.values(w.keys); const last5 = w.log.filter((e) => e.t > DUR - 5).length;
    const gaps = []; for (let i = 1; i < w.log.length; i++) gaps.push(w.log[i].t - w.log[i - 1].t);
    const outside = w.log.filter((e) => !e.inc);
    const maxShot = Math.max(0, ...ks); worst = Math.max(worst, maxShot);
    console.log(`[${kind}] ${DUR}s: ${w.n} changes over ${ks.length} incoming shots (max ${maxShot} per shot, ${outside.length} outside an incoming shot), last 5 s: ${last5}, gaps < 1 s: ${gaps.filter((g) => g < 1).length}, matches ended: ${w.ends}`);
    if (process.env.V) for (const e of w.log) console.log('   ', JSON.stringify(e));
    else for (const e of outside.slice(0, 6)) console.log('    outside:', JSON.stringify(e));
    r.w = w;
    const nearEnd = w.endT.map((t) => w.log.filter((e) => e.t > t - 5 && e.t <= t + 0.5).length); if (w.endT.length) console.log(`    match ends at ${w.endT.join(', ')} s; changes in the 5 s before each end: ${nearEnd.join(', ')}`); r.nearEnd = Math.max(0, ...nearEnd);
  }
  ok(worst <= 1 && runs.every((r) => r.w.log.filter((e) => !e.inc).length === 0), 'at most 1 change per incoming shot, none outside an incoming shot (also around match ends / rematch)');
  ok(runs.every((r) => r.nearEnd <= 3), `changes in the 5 s before a match end: max ${Math.max(...runs.map((r) => r.nearEnd))} (R7 saw 12)`);
  await b.close(); console.log(fails ? `TOGGLES2: ${fails} FAILED` : 'TOGGLES2: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
