// v14: more dives (CPU wide drives that wrong-foot a CPU receiver; slightly wider band), 飛撲練習 (?demo=dive + menu),
// one-time dive tip, 「飛撲！」 never over the diver's name tag, keyboard-portrait baseline diver fully visible,
// save trail + 「救球成功！/救球失敗」 popups. Smash / practice / net unchanged.
const PB = require('../js/core.js'); const { C } = PB;
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v14/';
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const RELAY = process.env.RELAY || 'ws://localhost:10077/ws';
const ONLY = process.env.ONLY || '', G = +(process.env.G || 10);
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const ovl = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
function coreTests() {
  // --- 1. dives per (game) minute, AI vs AI
  const R = {};
  for (const diff of ['easy', 'normal', 'hard']) { let dives = 0, t = 0, dl = 0, dw = 0;
    for (const mode of [1, 2]) for (let g = 0; g < G; g++) {
      const m = PB.createMatch({ mode, diff, target: 11, seed: 4242 + g * 7, firstServe: g % 2, seats: Array.from({ length: mode * 2 }, () => ({ ctrl: 'ai' })) }); let dt = -1, d0 = 0, t0 = 0;
      for (let k = 0; k < 60 * 60 * 15 && m.phase !== 'over'; k++) { PB.step(m, 1 / 60); t0 += 1 / 60;
        for (const e of m.events) { if (e.k === 'hit' && e.dive) { d0++; dt = m.players[e.p].team; } if (e.k === 'fault' && dt >= 0) { if (e.team === dt) dl++; else dw++; dt = -1; } } m.events.length = 0; }
      dives += d0; t += t0; R[`${mode}v${mode} ${diff}`] = (R[`${mode}v${mode} ${diff}`] || []).concat([[d0, t0]]); }
    R[diff] = { pm: dives / (t / 60), lost: dl / Math.max(1, dl + dw), n: dl + dw, dives, min: t / 60 }; }
  for (const k of Object.keys(R).filter((k) => k.includes('v'))) { const d = R[k].reduce((a, x) => a + x[0], 0), t = R[k].reduce((a, x) => a + x[1], 0); console.log(`  ${k.padEnd(10)} ${(d / (t / 60)).toFixed(2)} dives/min (${d} in ${(t / 60).toFixed(0)} min)`); }
  for (const diff of ['easy', 'normal', 'hard']) console.log(`  ${diff.padEnd(6)} all: ${R[diff].pm.toFixed(2)} dives/min, diver's side lost ${(100 * R[diff].lost).toFixed(0)}% of ${R[diff].n} dive rallies`);
  ok(R.normal.pm >= 0.9 && R.normal.pm <= 2.5 && R.hard.pm >= 0.9 && R.hard.pm <= 2.5, `dives per minute: normal ${R.normal.pm.toFixed(2)}, hard ${R.hard.pm.toFixed(2)} (target ≈1–2; v13: normal 0.30/0.05, hard 0.07/0.08)`);
  ok(R.hard.pm >= R.easy.pm, `hard (${R.hard.pm.toFixed(2)}/min) dives at least as often as easy (${R.easy.pm.toFixed(2)}/min)`);
  ok(['easy', 'normal', 'hard'].every((d) => R[d].lost > 0.5), `still balanced: the diver's side loses most dive rallies (${['easy', 'normal', 'hard'].map((d) => (100 * R[d].lost).toFixed(0) + '%').join(' / ')})`);
  // --- 2. 飛撲練習 core: feeds land in the player's dive band; the feeder never dives or plays the save
  for (const diff of ['easy', 'normal', 'hard']) {
    const m = PB.createMatch({ mode: 1, diff, target: 999, seed: 31, firstServe: 1, practice: 'dive', seats: [{ ctrl: 'local' }, { ctrl: 'ai' }] }); let cpuHit = 0;
    for (let k = 0; k < 60 * 150; k++) { if (m.phase === 'serve') m.feedWait = 1.1; PB.step(m, 1 / 60); for (const e of m.events) if (e.k === 'hit' && !e.feed && m.players[e.p].team === 1) cpuHit++; m.events.length = 0; }
    const d = m.dvStats, done = d.saves + d.fails + d.miss + d.reach;
    ok(d.feeds >= 15 && d.dives >= 0.85 * done && d.saves >= 0.7 * done && !cpuHit && !(m.dives && m.dives[1]) && m.rp[0] === d.saves + d.reach && m.rp[1] === d.fails + d.miss,
      `飛撲練習 ${diff} (player standing still): ${d.feeds} feeds → ${d.dives} dives, ${d.saves} saves, ${d.fails} failed, ${d.miss} missed; feeder never dives / hits; rally points ${m.rp} match`); }
}
async function browserTests() {
  const { chromium } = require('playwright'); const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q, tag, touch = true, clean = true) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    if (clean) await p.addInitScript(() => { if (!sessionStorage.c) { sessionStorage.c = 1; ['pbSlow', 'pbPracDiff', 'pbOrient', 'pbDiveTip'].forEach((k) => localStorage.removeItem(k)); } });
    const cdp = await ctx.newCDPSession(p); const tch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await tch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await tch('touchEnd', []); await p.waitForTimeout(60); };
    await p.goto(BASE + q); return { p, ctx, tapEl }; };
  // label / tag watcher: every frame while 「飛撲！」 shows, the diver's own name tag must not be drawn (or overlap it)
  const watch = (p) => p.evaluate(() => { const W = (window.__lt = { frames: 0, lbl: 0, bad: 0, ex: null }); const f = () => { const m = __pb.m; if (m) { const now = performance.now() / 1000;
    for (const q of m.players) if (q.diveLbl && now - q.diveLbl < 0.9 && q.diveLblR) { W.lbl++; const t = __pb.view.tagsNow.find((r) => r.i === q.i); if (t && t.l < q.diveLblR.r && q.diveLblR.l < t.r && t.t < q.diveLblR.b && q.diveLblR.t < t.b) { W.bad++; W.ex = W.ex || [t, q.diveLblR]; } else if (t) { W.bad++; W.ex = W.ex || ['tag drawn', t]; } } }
    W.frames++; requestAnimationFrame(f); }; f(); });
  // --- 3. 飛撲練習 in the browser (?demo=dive, autopilot waits at the ready spot) + the menu entry
  for (const [w, h, q, tag] of [[390, 844, '', 'portrait_390x844'], [844, 390, '', 'landscape_844x390']]) {
    const { p, ctx } = await mk(w, h, '?demo=dive&auto=1&diff=normal' + q, tag); await p.waitForTimeout(26000);
    const g = await p.evaluate(() => ({ pr: __pb.m.practice, d: __pb.m.dvStats, rp: __pb.m.rp, hdr: document.getElementById('hdr').textContent, txt: document.getElementById('prac').innerText.replace(/\s+/g, ' '), cpu: (__pb.m.dives || [0, 0])[1], n: __pb.juice.n }));
    await p.screenshot({ path: SHOT + `dive_practice_${tag}.png` });
    ok(g.pr === 'dive' && /^飛撲練習/.test(g.hdr) && g.d.dives >= 2 && g.d.saves >= 1 && /飛撲練習/.test(g.txt) && /救回率 \d+%/.test(g.txt) && new RegExp(`飛撲 ${g.d.dives}・救回 ${g.d.saves}`).test(g.txt) && !g.cpu && g.rp[0] + g.rp[1] === g.d.saves + g.d.fails + g.d.miss + g.d.reach,
      `[${tag}] ?demo=dive: 「${g.hdr}」, ${g.d.feeds} feeds → ${g.d.dives} dives / ${g.d.saves} saves; panel 「${g.txt.slice(0, 70)}…」; CPU dives ${g.cpu}`);
    await ctx.close(); }
  { const { p, ctx, tapEl } = await mk(390, 844, '?diff=easy', 'menu'); await p.waitForTimeout(500); await p.screenshot({ path: SHOT + 'menu_dive_practice_390x844.png' }); await tapEl('#bDivePrac');
    await p.waitForFunction(() => __pb.m && __pb.m.practice === 'dive' && __pb.PRAC.fed, null, { timeout: 6000 }).catch(() => {}); const g = await p.evaluate(() => ({ pr: __pb.m && __pb.m.practice, fed: __pb.PRAC.fed, d: __pb.m && __pb.m.dvStats }));
    ok(g.pr === 'dive' && g.fed, `menu 「🤸 飛撲練習」 next to 殺球練習 starts it and feeds at once (feeds ${g.d && g.d.feeds})`); await ctx.close(); }
  { const { p, ctx } = await mk(390, 844, '?demo=dive', 'prompt'); await p.waitForTimeout(1500); const g = await p.evaluate(() => ({ msg: document.getElementById('msg').innerText.replace(/\s+/g, ' '), feeds: __pb.m.dvStats.feeds }));
    ok(/球太遠時會自動飛身撲球/.test(g.msg) && /按任一鍵開始/.test(g.msg) && g.feeds === 0, `?demo=dive waits for the first input: 「${g.msg}」`); await ctx.close(); }
  // --- 4. one-time tip (localStorage), and label vs name tag in forced landscape
  { const { p, ctx } = await mk(390, 844, '?orient=land', 'tip'); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(1500); await watch(p);
    await p.evaluate(() => { __pb.freezeDive(12); __pb.setupDive(0); }); await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 5000 }).catch(() => {});
    const g1 = await p.evaluate(() => ({ tip: __pb.juice.diveTip, toast: document.getElementById('toast').classList.contains('hide') ? '' : document.getElementById('toast').textContent, ls: localStorage.pbDiveTip }));
    await p.screenshot({ path: SHOT + 'dive_tip_label_forced_land_390x844.png' }); await p.evaluate(() => __pb.unfreeze()); await p.waitForTimeout(2500);
    await p.evaluate(() => __pb.setupDive(0)); await p.waitForTimeout(1200); const g2 = await p.evaluate(() => ({ tip: __pb.juice.diveTip, dives: __pb.juice.dives, lt: window.__lt }));
    ok(g1.tip === 1 && g1.toast === '球太遠時會自動飛身撲球！' && g1.ls === '1' && g2.tip === 1 && g2.dives === 2, `one-time tip: first dive shows 「${g1.toast}」 and saves pbDiveTip=1; the second dive shows nothing`);
    ok(g2.lt.lbl > 10 && g2.lt.bad === 0, `forced landscape: over ${g2.lt.lbl} label frames the diver's name tag is never drawn under 「飛撲！」 ${g2.lt.ex ? JSON.stringify(g2.lt.ex) : ''}`);
    await p.reload(); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(1200); await p.evaluate(() => __pb.setupDive(0)); await p.waitForTimeout(600);
    const g3 = await p.evaluate(() => ({ tip: __pb.juice.diveTip || 0, dives: __pb.juice.dives }));
    ok(g3.tip === 0 && g3.dives === 1, `after a reload the tip stays off (saved in localStorage)`); await ctx.close(); }
  // --- 5. keyboard (non-touch) portrait 390×844: a baseline diver is fully on screen, the key help is below it
  { const { p, ctx } = await mk(390, 844, '', 'desk', false); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(1500);
    await p.evaluate(() => { const q = __pb.m.players[0]; q.x = -7.2; q.y = -1.6; __pb.freezeDive(10); __pb.setupDive(0); }); await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 5000 }).catch(() => {});
    const g = await p.evaluate(() => { const q = __pb.m.players[0], a = __pb.proj(q.x, q.y, 0), k = document.getElementById('keys').getBoundingClientRect(); return { foot: a.map(Math.round), keysTop: Math.round(k.top), keysVis: getComputedStyle(document.getElementById('keys')).display !== 'none', H: innerHeight, touch: __pb.view.touchUI }; });
    await p.screenshot({ path: SHOT + 'dive_baseline_desktop_portrait_390x844.png' });
    const body = g.foot[2] * 0.5; // lying body thickness below the feet line (generous)
    ok(!g.touch && g.keysVis && g.foot[1] + body <= g.keysTop && g.foot[1] + body <= g.H, `keyboard portrait: diver at the baseline (feet y ${g.foot[1]}, body to ${Math.round(g.foot[1] + body)}) stays above the key help (top ${g.keysTop}) and the screen bottom (${g.H})`);
    await ctx.close(); }
  // --- 6. trail + 救球 popups
  { const { p, ctx } = await mk(844, 390, '', 'trail'); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(1500);
    await p.evaluate(() => { __pb.freezeDive(40); __pb.setupDive(0); }); await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 6000 }).catch(() => {});
    const t1 = await p.evaluate(() => __pb.saveTrail.pts.length); await p.screenshot({ path: SHOT + 'dive_save_trail_landscape_844x390.png' }); await p.evaluate(() => __pb.unfreeze());
    await p.waitForFunction(() => __pb.pops.length > 0, null, { timeout: 12000 }).catch(() => {}); await p.evaluate(() => __pb.hold()); const g = await p.evaluate(() => { const o = __pb.pops[0], t = o && __pb.view.tagsNow.find((r) => r.i === o.i); return { pops: __pb.pops.map((q) => q.text), sp: __pb.juice.savePops, faults: __pb.m.stats.points, hit: !!(o && o.r && t && o.r.l < t.r && t.l < o.r.r && o.r.t < t.b && t.t < o.r.b) }; });
    await p.screenshot({ path: SHOT + 'dive_save_popup_landscape_844x390.png' }); await p.evaluate(() => __pb.unfreeze());
    ok(t1 > 15, `save trail: ${t1} points of the dive return's arc drawn (faint, dashed)`);
    ok(g.pops.length === 1 && /^(救球成功！|救球失敗)$/.test(g.pops[0]) && g.sp && g.sp.ok + g.sp.fail === 1 && !g.hit, `popup after the dive rally: 「${g.pops[0]}」 (${JSON.stringify(g.sp)}), above the diver's name tag`);
    // many dives: both outcomes, matching who won the rally
    let okN = 0, failN = 0, wrong = 0; for (let i = 0; i < 6; i++) { await p.waitForTimeout(2200); const r = await p.evaluate(() => new Promise((res) => { const pts0 = __pb.m.stats.points, sp0 = { ...(__pb.juice.savePops || { ok: 0, fail: 0 }) }; let lf = null; const iv = setInterval(() => { if (__pb.m.stats.points > pts0) { clearInterval(iv); const sp = __pb.juice.savePops; res({ ok: sp.ok - sp0.ok, fail: sp.fail - sp0.fail, rp: __pb.m.stats.faults }); } }, 50); __pb.setupDive(0); })); okN += r.ok; failN += r.fail; if (r.ok + r.fail !== 1) wrong++; }
    ok(wrong === 0 && okN + failN === 6, `6 more dive rallies → ${okN} 救球成功！ / ${failN} 救球失敗, exactly one popup each`); await ctx.close(); }
  // --- 7. net guest: label never on the guest's name tag
  { const pages = []; for (let i = 0; i < 2; i++) { const r = await mk(844, 390, '?server=' + encodeURIComponent(RELAY), 'net' + i); await r.p.fill('#nick', ['主機', '來賓'][i]); pages.push(r); }
    const [H, Gp] = pages.map((x) => x.p); await H.tap('#bHost'); await H.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 60000 });
    const code = await H.evaluate(() => document.getElementById('rcode').textContent); await Gp.fill('#code', code); await Gp.tap('#bJoin');
    await H.waitForFunction(() => __pb.roster.length === 2, null, { timeout: 30000 }); await H.tap('#segMode button[data-v="1"]'); await H.waitForTimeout(400); await H.tap('#bStart');
    await Gp.waitForFunction(() => __pb.state === 'play', null, { timeout: 15000 }); await H.waitForTimeout(1500); await watch(Gp);
    const gs = await Gp.evaluate(() => __pb.seat); await H.evaluate((s) => __pb.setupDive(s), gs); await Gp.waitForFunction(() => (__pb.juice.dives || 0) >= 1, null, { timeout: 4000 }).catch(() => {}); await Gp.waitForTimeout(200);
    await Gp.screenshot({ path: SHOT + 'dive_label_net_guest_844x390.png' }); await Gp.waitForTimeout(900);
    const g = await Gp.evaluate(() => ({ lt: window.__lt, tip: __pb.juice.diveTip, trails: __pb.juice.trails }));
    ok(g.lt.lbl > 10 && g.lt.bad === 0 && g.tip === 1 && g.trails === 1, `net guest: the guest's own dive — 「飛撲！」 shown ${g.lt.lbl} frames, never on ▼來賓; tip + trail on the guest too ${JSON.stringify(g)}`);
    for (const x of pages) await x.ctx.close(); }
  // --- 8. smash practice unchanged
  { const { p, ctx } = await mk(390, 844, '?demo=smash&auto=1&diff=easy', 'smash'); await p.waitForTimeout(22000);
    const g = await p.evaluate(() => ({ pr: __pb.m.practice, rp: __pb.m.rp, pts: __pb.m.stats.points, n: __pb.juice.n, dv: __pb.m.dives || [0, 0], hdr: document.getElementById('hdr').textContent, txt: document.getElementById('prac').innerText }));
    ok(g.pr === 'smash' && g.rp && g.rp[0] + g.rp[1] === g.pts && g.pts >= 3 && g.n > 0 && !g.dv[0] && !g.dv[1] && /^殺球練習/.test(g.hdr) && /致勝率|尚未殺球/.test(g.txt), `殺球練習 unchanged: ${g.pts} rally points (${g.rp}), ${g.n} smashes, no dives, 「${g.hdr}」`); await ctx.close(); }
  ok(errs.length === 0, 'no page errors ' + errs.join(' | ')); await b.close();
}
(async () => { if (ONLY !== 'browser') coreTests(); if (ONLY !== 'core') await browserTests(); console.log(fails ? `V14: ${fails} FAILED` : 'V14: ALL PASS'); process.exit(fails ? 1 : 0); })();
