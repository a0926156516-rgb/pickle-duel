// v13 飛身撲球: dive only in the band just past the normal reach, a weak high return, recovery / stun, network sync,
// the CPU dives too; smash / practice / rally scoring unchanged. Screenshots of the dive mid-animation.
const PB = require('../js/core.js'); const { C } = PB, DV = PB.DIVE;
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v13/';
const BASE = process.env.BASE || 'http://localhost:8077/index.html';
const RELAY = process.env.RELAY || 'ws://localhost:10077/ws';
const ONLY = process.env.ONLY || '';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const mkM = (seed, diff = 'normal', ctrl = 'local', mode = 1) => PB.createMatch({ mode, diff, target: 11, seed, firstServe: 0, seats: Array.from({ length: mode * 2 }, (_, i) => ({ ctrl: i === 0 ? ctrl : 'ai' })) });
// same set-up as the page's __pb.setupDive: bounced ball on i's side, `extra` m past the normal reach, running away sideways
function setup(m, i, extra = 0.45, z = 0.55, sp = 3.2, o2 = {}) {
  const p = m.players[i], o = 1 - p.team, xs = PB.teamSign(p.team), dy = p.y > 0.3 ? -1 : 1;
  p.x = xs * (o2.px || 5.2); p.y = o2.py || 0; p.vx = p.vy = 0; p.stun = 0; p.dive = 0;
  for (const q of m.players) if (q !== p) { q.x = PB.teamSign(q.team) * 5.5; q.y = q.team === p.team ? -p.y + 2 : 0; }
  m.phase = 'rally'; m.phaseT = 0; m.live = true; m.hits = 5; m.rally += 2; m.bounces = o2.bo == null ? 1 : o2.bo; m.lastHitTeam = o; m.lastHitter = m.players.find((q) => q.team === o).i; m.pred = null; m.smFate = null; m.smTrack = null; m.events.length = 0;
  if (o2.forceAi && p.ai) { p.ai.diveK = m.rally; p.ai.diveOk = true; p.ai.leave = -1; }
  m.ball.z = z; const r = PB.reachOf(m, p) + extra;
  Object.assign(m.ball, { x: p.x + xs * 0.2, y: p.y + dy * Math.sqrt(Math.max(0, r * r - 0.04)), vx: xs * 0.6 * (o2.toward ? -1 : 1), vy: dy * sp * (o2.toward ? -1 : 1), vz: 1.2 });
  if (o2.vx != null) m.ball.vx = o2.vx;
  return p;
}
const hitsOf = (m) => m.events.filter((e) => e.k === 'hit');
async function coreTests() {
  // --- 1. band
  const cases = [['inside normal reach (−0.15 m)', -0.15, {}, 'hit'], ['band +0.3 m', 0.3, {}, 'dive'], ['band +0.85 m', 0.85, {}, 'dive'], ['beyond the band (+1.1 m)', 1.1, {}, 'none'],
    ['band but ball coming closer', 0.5, { toward: 1 }, 'nodive'], ['band but ball too high (1.6 m)', 0.5, { z: 1.6 }, 'nodive'], ['band, not bounced yet, will land out', 0.5, { bo: 0, out: 1 }, 'nodive'], ['band, volley that lands in', 0.5, { bo: 0 }, 'dive']];
  for (const [name, extra, o2, want] of cases) {
    const m = mkM(7); const p = setup(m, 0, extra, o2.z || 0.55, 3.2, o2);
    if (o2.out) { m.ball.vx = PB.teamSign(p.team) * 7; m.ball.vz = 2.5; } else if (o2.bo === 0) { m.ball.vx = 0.2; m.ball.vy *= 0.4; m.ball.vz = 0.5; }
    PB.step(m, C.DT); const h = hitsOf(m), d = h.find((e) => e.dive);
    const got = d ? 'dive' : h.length ? 'hit' : 'none';
    ok(want === 'nodive' ? got !== 'dive' : got === want, `band: ${name} → ${got}${d ? ` (reach ${PB.reachOf(m, p).toFixed(2)} m + band ${DV.EXTRA} m)` : ''}`);
  }
  // --- 2. the dive return: weak, high, mostly in, the other side usually wins the point
  { let n = 0, inn = 0, apex = 0, hs = 0, opp = 0, drv = 0;
    for (let s = 0; s < 300; s++) { const m = mkM(100 + s); setup(m, 0, 0.4); PB.step(m, C.DT); if (!hitsOf(m).some((e) => e.dive)) continue; n++;
      const b = m.ball; hs += Math.hypot(b.vx, b.vy); let top = b.z, res = null;
      for (let t = 0; t < 600 && m.live; t++) { PB.step(m, C.DT); top = Math.max(top, b.z); const f = m.events.find((e) => e.k === 'fault' || (e.k === 'bounce' && !e.dead)); if (f && !res) res = f; m.events.length = 0; if (m.bounces >= 1 && !res) res = { k: 'bounce' }; if (res) break; }
      apex += top; if (res && res.k === 'bounce') inn++; }
    for (let s = 0; s < 100; s++) { const m = mkM(500 + s); setup(m, 0, -0.3); PB.step(m, C.DT); const b = m.ball; drv += Math.hypot(b.vx, b.vy); }
    // AI-vs-AI: rallies after a dive
    let dv = 0, dl = 0, dw = 0;
    for (const diff of ['easy', 'normal']) for (const mode of [1, 2]) for (let g = 0; g < 5; g++) { const m = PB.createMatch({ mode, diff, target: 11, seed: 900 + g, firstServe: 0, seats: Array.from({ length: mode * 2 }, () => ({ ctrl: 'ai' })) }); let dt = -1;
      for (let t = 0; t < 60 * 60 * 8 && m.phase !== 'over'; t++) { PB.step(m, 1 / 60); for (const e of m.events) { if (e.k === 'hit' && e.dive) { dv++; dt = m.players[e.p].team; } if (e.k === 'fault' && dt >= 0) { if (e.team === dt) dl++; else dw++; dt = -1; } } m.events.length = 0; } }
    opp = dl / Math.max(1, dl + dw);
    ok(n >= 280 && inn / n >= 0.7 && apex / n > 2.2 && hs / n < (drv / 100) * 0.75, `dive return: ${n} dives, ${(100 * inn / n).toFixed(0)}% land in, apex ${(apex / n).toFixed(2)} m, ${(hs / n).toFixed(1)} m/s across (a drive ${(drv / 100).toFixed(1)} m/s) — weak and high`);
    ok(dv >= 10 && opp > 0.5, `not overpowered: AI-vs-AI ${dv} dives, the diver's side lost ${dl} of ${dl + dw} rallies (${(100 * opp).toFixed(0)}%)`); }
  // --- 3. recovery
  { const m = mkM(11); const p = setup(m, 0, 0.5); const x0 = p.x, y0 = p.y; PB.step(m, C.DT); const d = hitsOf(m).some((e) => e.dive);
    let t = 0; while (p.dive > 0) { PB.step(m, C.DT); t += C.DT; } const trav = Math.hypot(p.x - x0, p.y - y0);
    // a reachable ball while still recovering is not hit
    const xs = PB.teamSign(p.team); m.live = true; m.phase = 'rally'; m.lastHitTeam = 1 - p.team; m.bounces = 1; m.hits = 5; Object.assign(m.ball, { x: p.x, y: p.y + 0.4, z: 0.6, vx: 0, vy: 0, vz: 0.5 }); m.events.length = 0;
    const st = p.stun; PB.step(m, C.DT); const noHit = !hitsOf(m).length;
    m.live = false; m.phase = 'dead'; m.phaseT = -99; p.in.mx = -xs; const a = p.x; let tt = 0; while (p.stun > 0 && tt < 0.3) { PB.step(m, C.DT); tt += C.DT; } const slow = Math.abs(p.x - a) / tt;
    while (p.stun > 0) PB.step(m, C.DT); p.vx = 0; const a2 = p.x; for (let k = 0; k < 36; k++) PB.step(m, C.DT); const fast = Math.abs(p.x - a2) / (36 * C.DT);
    ok(d && Math.abs(t - DV.T) < 0.02 && trav > 0.45 && trav <= 1.45, `dive: body flies ${trav.toFixed(2)} m toward the ball in ${t.toFixed(2)} s, no steering`);
    ok(st > 0 && noHit && slow < fast * 0.5 && fast > C.SPEED * 0.7, `recovery: ${DV.STUN} s after take-off — no hits while recovering (a ball in reach went by), moves at ${slow.toFixed(1)} m/s, then ${fast.toFixed(1)} m/s again`); }
  // --- 4. the CPU dives
  { let tries = 0, dives = 0; for (let s = 0; s < 400; s++) { const m = mkM(2000 + s, 'normal', 'ai'); setup(m, 1, 0.4, 0.55, 4.5); m.players[1].ai.react = 1e9; PB.step(m, C.DT); tries++; if (hitsOf(m).some((e) => e.dive)) dives++; }
    let sim = 0; for (const diff of ['easy', 'normal', 'hard']) { const m = PB.createMatch({ mode: 1, diff, target: 11, seed: 77, firstServe: 0, seats: [{ ctrl: 'ai' }, { ctrl: 'ai' }] }); for (let t = 0; t < 60 * 60 * 10 && m.phase !== 'over'; t++) { PB.step(m, 1 / 60); m.events.length = 0; } sim += m.dives ? m.dives[0] + m.dives[1] : 0; }
    const rate = dives / tries;
    ok(rate > DV.AI.normal - 0.12 && rate < DV.AI.normal + 0.12 && sim > 0, `CPU dives: ${(100 * rate).toFixed(0)}% of balls in its dive band on normal (chance ${DV.AI.normal * 100}%, decided once per ball), ${sim} dives in 3 AI-vs-AI matches`); }
  // --- 5. practice: nobody dives in 殺球練習 (smash stats and rally lengths unchanged)
  { const m = PB.createMatch({ mode: 1, diff: 'easy', target: 999, seed: 3, firstServe: 1, practice: 'smash', seats: [{ ctrl: 'local' }, { ctrl: 'ai' }] });
    const q = setup(m, 1, 0.4, 0.55, 3.2, { forceAi: 1 }); m.practice = 'smash'; PB.step(m, C.DT); const cpu = hitsOf(m).some((e) => e.dive);
    setup(m, 0, 0.4); PB.step(m, C.DT); const me = hitsOf(m).some((e) => e.dive);
    ok(!cpu && !me && !PB.canDive(m, q), `practice: no dives at all in 殺球練習 (feeder or player), so practice rallies / stats are unchanged`); }
}
async function browserTests() {
  const { chromium } = require('playwright'); const b = await chromium.launch(); const errs = [];
  const mk = async (w, h, q, tag) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`)); await p.goto(BASE + q); return { p, ctx }; };
  // --- 6. dive animation: pose, 「飛撲！」, dust / skid, sound, light shake — screenshots mid-dive
  for (const [w, h, q, tag, seat] of [[390, 844, '', 'portrait_390x844_me', 0], [390, 844, '', 'portrait_390x844_cpu', 1], [844, 390, '', 'landscape_844x390_me', 0], [844, 390, '', 'landscape_844x390_cpu', 1], [390, 844, '?orient=land', 'forced_land_390x844_me', 0]]) {
    const { p, ctx } = await mk(w, h, q, tag); await p.evaluate(() => __pb.startLocal(1)); await p.waitForTimeout(1200);
    await p.evaluate((seat) => { __pb.freezeDive(9); __pb.setupDive(seat); }, seat); const fr = await p.waitForFunction(() => __pb.freezeOn, null, { timeout: 5000 }).then(() => true).catch(() => false);
    const g = await p.evaluate((seat) => { const q = __pb.m.players[seat]; return { dive: q.dive, lbl: q.diveLbl > 0, dives: __pb.juice.dives, sfx: __pb.juice.diveSfx, shake: __pb.freeze.shot ? __pb.freeze.shot.amp : -1, n: __pb.juice.n, team: __pb.m.dives }; }, seat);
    await p.screenshot({ path: SHOT + `dive_${tag}.png` });
    ok(fr && g.dive > 0 && g.lbl && g.dives === 1 && g.sfx === 1 && g.n === 0, `[${tag}] dive mid-animation (${(DV.T - g.dive).toFixed(2)} s in): pose + 「飛撲！」 + dust, 1 dive sound through the voice pool, no SMASH juice — ${SHOT}dive_${tag}.png`);
    await p.evaluate(() => __pb.unfreeze()); await p.waitForTimeout(1600); const g2 = await p.evaluate((seat) => ({ dive: __pb.m.players[seat].dive, stun: __pb.m.players[seat].stun, live: __pb.m.live, lh: __pb.m.lastHitTeam }), seat);
    if (tag.endsWith('_me')) ok(!(g2.dive > 0) && !(g2.stun > 0), `[${tag}] back on the feet after ${DV.STUN} s`);
    await ctx.close(); }
  // --- 7. network: host-authoritative dive, synced to the client (its own player and the host's player)
  { const pages = []; for (let i = 0; i < 2; i++) { const r = await mk(844, 390, '?server=' + encodeURIComponent(RELAY), 'net' + i); await r.p.fill('#nick', ['主機', '來賓'][i]); pages.push(r); }
    const [H, G] = pages.map((x) => x.p); await H.tap('#bHost'); await H.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 60000 });
    const code = await H.evaluate(() => document.getElementById('rcode').textContent); await G.fill('#code', code); await G.tap('#bJoin');
    await H.waitForFunction(() => __pb.roster.length === 2, null, { timeout: 30000 }); await H.tap('#segMode button[data-v="1"]'); await H.waitForTimeout(400); await H.tap('#bStart');
    await G.waitForFunction(() => __pb.state === 'play', null, { timeout: 15000 }); await H.waitForTimeout(1500);
    const gs = await G.evaluate(() => __pb.seat);
    await G.evaluate(() => { const W = (window.__d = { maxDive: [0, 0], maxStun: [0, 0], x0: null, moved: 0 }); const f = () => { if (__pb.m) __pb.m.players.forEach((q, i) => { W.maxDive[i] = Math.max(W.maxDive[i], q.dive || 0); W.maxStun[i] = Math.max(W.maxStun[i], q.stun || 0); }); requestAnimationFrame(f); }; f(); });
    const g0 = await G.evaluate((s) => ({ x: __pb.m.players[s].x, y: __pb.m.players[s].y }), gs);
    await H.evaluate((s) => __pb.setupDive(s), gs); await G.waitForFunction(() => (__pb.juice.dives || 0) >= 1, null, { timeout: 4000 }).catch(() => {}); await G.waitForTimeout(250);
    await G.screenshot({ path: SHOT + 'dive_net_client_own_844x390.png' });
    await G.waitForTimeout(700);
    const g1 = await G.evaluate((s) => ({ x: __pb.m.players[s].x, y: __pb.m.players[s].y, d: { ...window.__d }, jd: __pb.juice.dives }), gs); const hd = await H.evaluate(() => ({ dives: __pb.m.dives, jd: __pb.juice.dives, lh: __pb.m.lastHitTeam }));
    const mv = Math.hypot(g1.x - g0.x, g1.y - g0.y);
    ok(hd.dives && hd.dives[1 - 0] === 1 && g1.jd === 1 && g1.d.maxStun[gs] > 0.5 && mv > 0.35, `net: host decides the guest's dive (host dives ${JSON.stringify(hd.dives)}), guest gets the 飛撲 event + recovery state (stun ${g1.d.maxStun[gs].toFixed(2)} s) and its own body slides ${mv.toFixed(2)} m`);
    await H.waitForTimeout(1500); await H.evaluate(() => __pb.setupDive(0)); await G.waitForFunction(() => (__pb.juice.dives || 0) >= 2, null, { timeout: 4000 }).catch(() => {}); await G.waitForTimeout(200);
    await G.screenshot({ path: SHOT + 'dive_net_client_sees_host_844x390.png' });
    const g2 = await G.evaluate(() => ({ d: window.__d, jd: __pb.juice.dives })); const h2 = await H.evaluate(() => __pb.m.dives);
    ok(h2[0] === 1 && g2.jd === 2 && g2.d.maxDive[0] > 0.2, `net: the host's own dive shows on the guest (snapshot dive ${g2.d.maxDive[0].toFixed(2)} s, event count ${g2.jd})`);
    for (const x of pages) await x.ctx.close(); }
  // --- 8. smash practice still works (rally points add up, smashes count, the feeder never dives)
  { const { p, ctx } = await mk(390, 844, '?demo=smash&auto=1&diff=easy', 'prac'); await p.waitForTimeout(25000);
    const g = await p.evaluate(() => ({ rp: __pb.m.rp, pts: __pb.m.stats.points, n: __pb.juice.n, dv: __pb.m.dives || [0, 0], sc: document.getElementById('scR').textContent }));
    ok(g.rp && g.rp[0] + g.rp[1] === g.pts && g.pts >= 3 && g.n > 0 && !g.dv[1] && g.sc === '', `practice: ${g.pts} rally points (${g.rp}), ${g.n} smashes, CPU dives ${g.dv[1]}, score text hidden`); await ctx.close(); }
  ok(errs.length === 0, 'no page errors ' + errs.join(' | ')); await b.close();
}
(async () => { if (ONLY !== 'browser') await coreTests(); if (ONLY !== 'core') await browserTests(); console.log(fails ? `V13: ${fails} FAILED` : 'V13: ALL PASS'); process.exit(fails ? 1 : 0); })();
