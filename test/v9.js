// v9: smash timing aid (「現在！」 on the button + pulsing foot ring + practice 殺球點), 0.25 s smash window, smash voice pool,
// bigger practice panel with a difficulty switch, practice default level (easy / its own saved level, never the match level).
const PB = require('../js/core.js'), C = PB.C;
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v9/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
// ---- core: the smash window (no browser)
function windowTrial(pressAfter) {
  const m = PB.createMatch({ mode: 1, diff: 'normal', seed: 5, seats: [{ ctrl: 'human' }, { ctrl: 'ai' }], autoServe: 99 });
  const p = m.players[0], o = m.players[1];
  m.phase = 'rally'; m.live = true; m.hits = 5; m.rally = 5; m.lastHitTeam = 1; m.lastHitter = 1; m.bounces = 0;
  p.x = -3.2; p.y = 0; o.x = 3; o.y = 0; p.in.shotT = -9;
  Object.assign(m.ball, { x: -1.9, y: 0, z: 1.35, vx: -2.2, vy: 0, vz: 0.6 });
  let hit = null; const t0 = m.t;
  for (let i = 0; i < 240 && !hit; i++) {
    p.in.mx = 0; p.in.my = 0; if (pressAfter != null && m.t - t0 >= pressAfter && p.in.shotT < t0) { p.in.shot = 'smash'; p.in.shotT = m.t; }
    PB.step(m, 1 / 120); for (const e of m.events) if (e.k === 'hit' && e.p === 0) hit = { shot: e.shot, t: m.t - t0, z: m.ball.z }; m.events.length = 0;
  }
  return hit || {};
}
{ const a = windowTrial(null), first = windowTrial(0);
  ok(a.shot === 'drive' && first.shot === 'smash', `no press: auto 抽球 at t=${(a.t || 0).toFixed(2)}s; early press: 殺球 at t=${(first.t || 0).toFixed(2)}s`);
  const reachT = first.t; const late = windowTrial(reachT + 0.15), tooLate = windowTrial(reachT + 0.6);
  ok(late.shot === 'smash' && late.t <= reachT + PB.SMASH_WAIT + 0.02, `press 0.15 s after the ball reached me still smashes (window ${PB.SMASH_WAIT}s): ${late.shot} at t=${(late.t || 0).toFixed(2)}s`);
  ok(tooLate.shot === 'drive', `a press 0.6 s late is too late: ${tooLate.shot} (the ball never escapes, it is auto-hit)`);
  ok(PB.SMASH_ZH < PB.SMASH_Z, `players' smash bar ${PB.SMASH_ZH} m is lower than the CPU's ${PB.SMASH_Z} m`); }
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const mk = async (w, h, q, tag, init) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    if (init) await p.addInitScript(init.f, init.a);
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(60); };
    const tapXY = async (x, y) => { await touch('touchStart', [[x, y]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(60); };
    await p.goto(BASE + q); return { p, tapEl, tapXY }; };
  // --- practice default level: the match level left in pbOpt (here 困難) must not leak into practice
  { const { p, tapEl } = await mk(390, 844, '', 'default', { f: () => { if (!sessionStorage.v9) { sessionStorage.v9 = 1; localStorage.clear(); localStorage.pbOpt = JSON.stringify({ diff: 'hard', mode: 1, target: 11 }); } } });
    await p.locator('#bPrac').scrollIntoViewIfNeeded(); await tapEl('#bPrac'); await p.waitForFunction(() => __pb.state === 'play', null, { timeout: 4000 }).catch(() => {});
    const g = await p.evaluate(() => ({ d: __pb.m.diff, sel: document.querySelector('#prDiff .sel') && document.querySelector('#prDiff .sel').textContent, txt: document.getElementById('prac').innerText }));
    ok(g.d === 'easy' && g.sel === '簡單', `practice from the menu with the match level 困難 saved: starts on ${g.d} (${g.sel})`);
    // the switch inside practice
    await p.waitForTimeout(4000); await tapEl('#prDiff button[data-d="hard"]');
    const s = await p.evaluate(() => ({ d: __pb.m.diff, saved: localStorage.pbPracDiff, n: __pb.m.smStats[0].n, sel: document.querySelector('#prDiff .sel').textContent, rate: document.getElementById('prRate').textContent, st: __pb.state }));
    ok(s.d === 'hard' && s.saved === 'hard' && s.sel === '困難' && s.n === 0 && s.rate === '尚未殺球' && s.st === 'play', `tap 困難 in the panel: level ${s.d}, saved ${s.saved}, stats reset (致勝率 ${s.rate}), still playing`);
    await p.reload(); await p.evaluate(() => __pb.startPractice()); await p.waitForTimeout(300);
    ok(await p.evaluate(() => __pb.m.diff) === 'hard', 'practice remembers its own level (困難) next time');
    await p.goto(BASE + '?demo=smash&diff=normal'); await p.waitForTimeout(500);
    ok(await p.evaluate(() => __pb.m.diff) === 'normal', '?demo=smash&diff=normal overrides it');
    await p.context().close(); }
  // --- big panel + aid cue held on the exact frame 「現在！」 lights up
  for (const [w, h, q, tag] of [[390, 844, '?demo=smash&auto=1&diff=easy', 'portrait_390x844'], [844, 390, '?demo=smash&auto=1&diff=easy', 'landscape_844x390'], [375, 667, '?demo=smash&auto=1&diff=easy&orient=land', 'forced_land_375x667']]) {
    const { p } = await mk(w, h, q, tag); await p.waitForTimeout(7000);
    const pn = await p.evaluate(() => { const r = __pb.appRect(document.getElementById('prac')), ov = []; for (const id of ['board', 'brand', 'btns', 'joyBase']) { const e = document.getElementById(id); if (!e) continue; const o = __pb.appRect(e); if (o.width && r.left < o.right - 1 && r.right > o.left + 1 && r.top < o.bottom - 1 && r.bottom > o.top + 1) ov.push(id); }
      const big = parseFloat(getComputedStyle(document.querySelector('#prRate')).fontSize), small = parseFloat(getComputedStyle(document.querySelector('#prDet')).fontSize); return { ov, big, small, txt: document.getElementById('prac').innerText.replace(/\s+/g, ' '), v: __pb.view, r }; });
    ok(/(致勝率\s*\d+%|尚未殺球)/.test(pn.txt) && pn.big >= 20 && pn.big >= 1.6 * pn.small && !pn.ov.length && pn.r.left >= 0 && pn.r.right <= pn.v.W + 1, `[${tag}] panel 「${pn.txt}」 big line ${pn.big}px (details ${pn.small}px), clear of ${pn.ov.length ? pn.ov.join(',') : 'HUD / buttons / joystick'}`);
    await p.screenshot({ path: SHOT + `practice_panel_${tag}.png` });
    await p.evaluate(() => __pb.freezeAid()); const got = await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 30000, polling: 100 }).then(() => true).catch(() => false);
    await p.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 160; }));
    const a = await p.evaluate(() => ({ now: __pb.AID.now, cls: document.getElementById('tbSmash').className, cue: !document.getElementById('nowCue').classList.contains('hide'), spot: !!__pb.AID.spot, c: __pb.AID.contact }));
    ok(got && a.now && /\bnow\b/.test(a.cls) && a.cue, `[${tag}] 「現在！」 lights the 殺球 button (${a.cls}) when the ball will be smashable at reach in ${a.c ? a.c.t.toFixed(2) : '?'}s (z ${a.c ? a.c.z.toFixed(2) : '?'} m)`);
    await p.screenshot({ path: SHOT + `aid_now_${tag}.png` });
    if (tag === 'portrait_390x844') { // also the 殺球點 ring a moment before the cue
      await p.evaluate(() => { document.getAnimations().forEach((a) => a.play()); __pb.unfreeze(); });
      const sp = await p.waitForFunction(() => __pb.AID.spot && !__pb.AID.now && __pb.m.lastHitTeam === 1 && __pb.AID.spot.t > 0.5, null, { timeout: 30000, polling: 'raf' }).then(() => true).catch(() => false);
      if (sp) { await p.evaluate(() => __pb.hold()); await p.waitForTimeout(80); await p.screenshot({ path: SHOT + 'aid_spot_ring_portrait_390x844.png' }); }
      ok(sp, 'practice shows the 殺球點 ring where the ball will be smashable');
      await p.evaluate(() => __pb.unfreeze()); }
    const cues = await p.evaluate(() => __pb.AID.cues); ok(cues >= 1, `[${tag}] cue fired ${cues}×`);
    await p.context().close();
  }
  // --- aid in a normal match too (not just practice)
  { const { p } = await mk(390, 844, '?auto=1', 'match'); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(20000);
    const g = await p.evaluate(() => ({ cues: __pb.AID.cues, spot: __pb.AID.spot }));
    ok(g.cues >= 1 && !g.spot, `1v1 match: 「現在！」 cue also fires (${g.cues}×), the 殺球點 ring is practice-only`); await p.context().close(); }
  // --- voice pool: a burst of smashes, every one gets a sound
  { const { p, tapEl } = await mk(390, 844, '', 'sfx', { f: () => { localStorage.pbSound = '1'; } }); await p.locator('#bS1').scrollIntoViewIfNeeded(); await tapEl('#bS1'); await p.waitForFunction(() => __pb.state === 'play', null, { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(600);
    await p.evaluate(() => __pb.fireSmash(1)); await p.waitForTimeout(400); // first one renders the buffer
    const r = await p.evaluate(async () => { const j = __pb.juice, n0 = j.n, s0 = j.sfx; for (let i = 0; i < 40; i++) { __pb.fireSmash(1); await new Promise((r) => setTimeout(r, i % 4 ? 15 : 60)); } return { dn: j.n - n0, ds: j.sfx - s0, voices: j.voices, stolen: j.sfxStolen || 0, muted: j.sfxMuted || 0, ac: typeof AudioContext }; });
    await p.waitForTimeout(1500); const ended = await p.evaluate(() => __pb.juice.sfxEnded || 0);
    ok(r.dn === 40 && r.ds === 40 && r.muted === 0 && r.voices <= 8 && ended >= 20, `40 smashes in ~1.1 s: ${r.ds} smash sounds started (n ${r.dn}), pool ${r.voices} voices, ${r.stolen} cut short for a newer one, ${ended} ended, muted ${r.muted}`);
    await p.context().close(); }
  ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? `V9: ${fails} FAILED` : 'V9: ALL PASSED'); process.exit(fails ? 1 : 0);
})();
