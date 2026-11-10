// v8: 殺球練習 (?demo=smash and the menu button) with live stats, SMASH! card on a winning smash, deterministic flash / shake
// capture (the frame loop is held on the exact frame the juice fires), and the new 「抽 ▼」 label.
// PRAC=seconds of auto-played practice per difficulty (the in-game autopilot moves the player; it presses 殺球 when the button says 殺球).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v8/';
const PRAC = +(process.env.PRAC || 150);
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q, tag, diff) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`));
    if (diff) await p.addInitScript((d) => { localStorage.pbOpt = JSON.stringify({ diff: d }); }, diff);
    const cdp = await ctx.newCDPSession(p); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(80); };
    await p.goto(BASE + q); return { p, tapEl }; };
  // --- menu button 「殺球練習」
  { const { p, tapEl } = await mk(390, 844, '', 'menu');
    const lab = await p.locator('#bPrac').innerText(), bh = (await p.locator('#bPrac').boundingBox()).height; await p.screenshot({ path: SHOT + 'menu_practice_button_390x844.png' });
    await p.locator('#bPrac').scrollIntoViewIfNeeded(); await tapEl('#bPrac'); await p.waitForFunction(() => __pb.state === 'play', null, { timeout: 4000 }).catch(() => {});
    const g = await p.evaluate(() => ({ pr: __pb.m && __pb.m.practice, vis: !document.getElementById('prac').classList.contains('hide'), txt: document.getElementById('prac').innerText }));
    ok(/殺球練習/.test(lab) && bh >= 24 && g.pr === 'smash' && g.vis && /殺球\s*0/.test(g.txt), `menu 「${lab.replace(/\s+/g, ' ')}」 starts practice, stats panel shown: ${g.txt.replace(/\s+/g, ' ')}`);
    await p.waitForTimeout(2500); const f = await p.evaluate(() => ({ lt: __pb.m.lastHitTeam, ph: __pb.m.phase, z: __pb.m.ball.z }));
    ok(f.ph === 'rally' && f.lt === 1, 'the CPU feeds a ball to me (no serve needed)');
    await p.context().close(); }
  // --- auto-played practice at each difficulty, in parallel (real time, real movement)
  const pages = [];
  for (const diff of ['easy', 'normal', 'hard']) { const tag = 'practice_' + diff; const r = await mk(390, 844, '?demo=smash&auto=1', tag, diff); pages.push({ diff, ...r }); }
  const t0 = Date.now(); let cardShot = false, cardInfo = null;
  // SMASH! card: catch it on the easy page, pause its CSS animation at 300 ms for a deterministic screenshot
  { const p = pages[0].p;
    const got = await p.waitForFunction(() => __pb.cards > 0, null, { timeout: 90000, polling: 'raf' }).then(() => true).catch(() => false);
    if (got) { cardInfo = await p.evaluate(() => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 300; }); const c = document.getElementById('smashCard'); return { cls: c.className, sub: document.getElementById('smashSub').textContent, vis: getComputedStyle(c).visibility, op: getComputedStyle(c).opacity }; });
      await p.screenshot({ path: SHOT + 'smash_card_practice_easy_390x844.png' }); cardShot = true;
      await p.evaluate(() => document.getAnimations().forEach((a) => a.play())); }
    ok(got && cardInfo.vis === 'visible' && +cardInfo.op > 0.5 && /殺球(致勝|逼出失誤)/.test(cardInfo.sub), `「SMASH!」 card shows when a smash wins the rally: 「${cardInfo && cardInfo.sub}」`); }
  await new Promise((r) => setTimeout(r, Math.max(0, PRAC * 1000 - (Date.now() - t0))));
  const P = {};
  for (const { diff, p } of pages) {
    const r = await p.evaluate(() => ({ s: __pb.m.smStats[0], txt: document.getElementById('prac').innerText, secs: __pb.m.t, cards: __pb.cards, fps: __pb.fps, opp: __pb.m.smStats[1] }));
    P[diff] = r; const s = r.s;
    console.log(`practice ${diff.padEnd(6)} ${r.secs.toFixed(0)}s game time: ${s.n} smashes -> outright ${s.win} (${pct(s.win, s.n)}), forced errors ${s.forced} (${pct(s.forced, s.n)}), total ${s.win + s.forced} (${pct(s.win + s.forced, s.n)}); returned ${s.ret} (${pct(s.ret, s.n)}), own errors ${s.own} (${pct(s.own, s.n)}); SMASH! cards ${r.cards}; ${r.fps.toFixed(0)} fps`);
    ok(s.n >= (PRAC >= 120 ? 15 : 3) && new RegExp(`殺球\\s*${s.n}`).test(r.txt) && new RegExp(`致勝\\s*${s.win}`).test(r.txt) && new RegExp(`逼失誤\\s*${s.forced}`).test(r.txt), `[${diff}] on-screen panel matches: ${r.txt.replace(/\s+/g, ' ')}`);
    ok(r.cards === s.win + s.forced, `[${diff}] one SMASH! card per winning smash (${r.cards})`);
    if (diff === 'normal') await p.screenshot({ path: SHOT + 'practice_stats_normal_390x844.png' });
  }
  const tw = (d) => (P[d].s.win + P[d].s.forced) / P[d].s.n;
  ok(tw('easy') > tw('hard'), `practice: smashes win more on easy (${pct(P.easy.s.win + P.easy.s.forced, P.easy.s.n)}) than hard (${pct(P.hard.s.win + P.hard.s.forced, P.hard.s.n)})`);
  for (const { p } of pages) await p.context().close();
  // --- practice panel in landscape and forced 橫向
  for (const [w, h, q, tag] of [[844, 390, '?demo=smash&auto=1', 'landscape_844x390'], [375, 667, '?demo=smash&auto=1&orient=land', 'forced_land_375x667']]) {
    const { p } = await mk(w, h, q, tag); await p.waitForTimeout(6000);
    const g = await p.evaluate(() => { const v = __pb.view, r = __pb.appRect(document.getElementById('prac')), ov = []; for (const id of ['board', 'brand', 'btns', 'joyBase']) { const e = document.getElementById(id); if (!e) continue; const q = __pb.appRect(e); if (q.width && r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom) ov.push(id); } return { on: r.left >= 0 && r.top >= 0 && r.right <= v.W + 1 && r.bottom <= v.H + 1 && r.width > 50, ov }; });
    ok(g.on && !g.ov.length, `[${tag}] practice stats panel on screen, clear of HUD / buttons / joystick ${g.ov.join(',')}`);
    await p.screenshot({ path: SHOT + `practice_${tag}.png` }); await p.context().close();
  }
  // --- deterministic flash / shake capture: hold the frame loop k frames after the smash juice fires
  for (const [w, h, q, tag] of [[390, 844, '', 'portrait_390x844'], [375, 667, '?orient=land', 'forced_land_375x667']]) {
    const { p, tapEl } = await mk(w, h, q, tag); await p.evaluate(() => __pb.startLocal(1)); await p.waitForFunction(() => __pb.state === 'play'); await p.waitForTimeout(800);
    for (const [k, nm] of [[0, 'flash_frame0'], [6, 'shake_frame6']]) {
      await p.evaluate(() => { const m = __pb.m, me = m.players[__pb.seat], o = m.players.find((q) => q.team !== me.team);
        m.phase = 'rally'; m.live = true; m.hits = 5; m.rally = 5; m.bounces = 0; m.lastHitTeam = o.team; m.lastHitter = o.i; me.x = -4.6; me.y = 0; o.x = 4; o.y = 0;
        Object.assign(m.ball, { x: -1.4, y: 0.05, z: 1.7, vx: -3.2, vy: 0, vz: 0.5 }); });
      await p.evaluate((k) => __pb.freezeJuice(k), k); await tapEl('#tbSmash');
      const fz = await (await p.waitForFunction(() => __pb.freeze.frozen && __pb.freeze.shot, null, { timeout: 3000, polling: 'raf' }).catch(() => null))?.jsonValue();
      await p.screenshot({ path: SHOT + `smash_${nm}_${tag}.png` });
      ok(fz && (k === 0 ? fz.flash > 0.25 : Math.hypot(fz.ox, fz.oy) >= 2), `[${tag}] frame ${k} after the smash held: ${fz ? `flash ${fz.flash.toFixed(2)}, shake offset (${fz.ox.toFixed(1)}, ${fz.oy.toFixed(1)}) px of ±${fz.amp}` : 'not frozen'}`);
      await p.evaluate(() => __pb.unfreeze()); await p.waitForTimeout(900);
    }
    await p.context().close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? `V8: ${fails} FAILED` : 'V8: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
