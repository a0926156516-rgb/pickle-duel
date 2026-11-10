// Host goes to the background. For 1v1 and 2v2: (a) visibilitychange -> hidden: the room pauses cleanly, guests see 「等待房主…」;
// the host's tab is then stalled (no frames for 2.5 s, like a real background tab) and comes back: the ball continues from exactly where it
// stopped, frame by frame, on host AND guest (no teleport). (b) host goes silent with no visibility event (socket muted, like iOS
// suspending the app): guests notice the missing frames. (c) single player: hidden -> pause menu.
const { chromium } = require('playwright');
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const BASE = (process.env.BASEURL || 'http://localhost:8077/index.html');
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v5/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const setVis = (p, hidden) => p.evaluate((h) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
// per-frame ball samples (x,y,z,point) for ms milliseconds
const sample = (p, ms) => p.evaluate((ms) => new Promise((res) => { const out = [], t0 = performance.now(); const f = () => { const m = __pb.m, b = m.ball; out.push([b.x, b.y, b.z, m.point, m.phase]); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); }), ms);
const maxJump = (s) => { let mx = 0; for (let i = 1; i < s.length; i++) if (s[i][3] === s[i - 1][3] && s[i][4] === 'rally' && s[i - 1][4] === 'rally') mx = Math.max(mx, Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1], s[i][2] - s[i - 1][2])); return mx; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const mode of [1, 2]) {
    const tag = mode === 2 ? '2v2' : '1v1'; const P = [];
    for (let i = 0; i < 2; i++) { const c = await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(`[${tag} p${i}] ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errs.push(`[${tag} p${i}] ${m.text()}`)); await p.goto(BASE + '?auto=1&server=' + encodeURIComponent(SERVER)); await p.fill('#nick', ['房主', '來賓'][i]); P.push(p); }
    const [h, g] = P;
    await h.tap('#bHost'); await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
    await h.tap(`#segMode button[data-v="${mode}"]`); await h.waitForTimeout(300);
    const code = await h.evaluate(() => document.getElementById('rcode').textContent);
    await g.fill('#code', code); await g.tap('#bJoin'); await h.waitForFunction(() => __pb.roster.length >= 2, null, { timeout: 30000 });
    await h.waitForTimeout(700); await h.tap('#bStart'); await g.waitForFunction(() => __pb.state === 'play', null, { timeout: 30000 });
    ok(await h.evaluate((n) => __pb.m.players.length === n, mode * 2), `[${tag}] match has ${mode * 2} players`);
    // go hidden mid-flight
    await h.waitForFunction(() => __pb.m.phase === 'rally' && __pb.m.ball.z > 0.4, null, { timeout: 30000, polling: 16 });
    await setVis(h, true);
    await g.waitForFunction(() => !document.getElementById('wait').classList.contains('hide'), null, { timeout: 2000 }).catch(() => {});
    const w1 = await g.evaluate(() => ({ on: !document.getElementById('wait').classList.contains('hide'), txt: document.getElementById('wait').innerText.replace(/\s+/g, ' ') }));
    ok(w1.on && /等待房主/.test(w1.txt), `[${tag} hidden] guest shows 「${w1.txt}」`);
    if (mode === 2) await g.screenshot({ path: SHOT + 'guest_waiting_for_host_2v2_375x667.png' });
    const t0 = await h.evaluate(() => ({ t: __pb.m.t, b: { ...__pb.m.ball }, pt: __pb.m.point }));
    // stall the host tab completely for 2.5 s (a background tab gets no frames), then show it again
    await h.evaluate(() => { const t = Date.now(); while (Date.now() - t < 2500); });
    const t1 = await h.evaluate(() => ({ t: __pb.m.t, b: { ...__pb.m.ball } }));
    ok(t1.t === t0.t && t1.b.x === t0.b.x && t1.b.z === t0.b.z, `[${tag} hidden] host match paused cleanly (t ${t0.t.toFixed(2)} -> ${t1.t.toFixed(2)})`);
    const gb0 = await g.evaluate(() => ({ ...__pb.m.ball })); await g.waitForTimeout(500); const gb1 = await g.evaluate(() => ({ ...__pb.m.ball }));
    ok(Math.hypot(gb1.x - gb0.x, gb1.y - gb0.y, gb1.z - gb0.z) < 0.05, `[${tag} hidden] guest ball frozen too`);
    // resume and record every frame on both sides
    const [hs, gs] = await Promise.all([sample(h, 2200), (async () => { await setVis(h, false); return null; })().then(() => sample(g, 2000))]);
    const first = hs.find((s) => s[3] === t0.pt) || hs[0];
    const d0 = Math.hypot(first[0] - t0.b.x, first[1] - t0.b.y, first[2] - t0.b.z);
    ok(d0 < 0.3, `[${tag} resume] host ball continues from where it stopped (first frame ${d0.toFixed(3)} m away)`);
    const jh = maxJump(hs), jg = maxJump(gs);
    ok(jh < 0.45, `[${tag} resume] host ball continuous frame by frame (${hs.length} frames, max step ${jh.toFixed(3)} m)`);
    ok(jg < 0.6, `[${tag} resume] guest ball continuous frame by frame (${gs.length} frames, max step ${jg.toFixed(3)} m)`);
    ok(await g.evaluate(() => document.getElementById('wait').classList.contains('hide')), `[${tag} resume] guest notice gone`);
    const t2 = await h.evaluate(() => __pb.m.t); ok(t2 > t1.t, `[${tag} resume] match running again`);
    // (b) silent host
    await h.evaluate(() => { window.__realSend = WebSocket.prototype.send; WebSocket.prototype.send = function () {}; });
    await g.waitForFunction(() => !document.getElementById('wait').classList.contains('hide'), null, { timeout: 4000 }).catch(() => {});
    const w2 = await g.evaluate(() => ({ on: !document.getElementById('wait').classList.contains('hide'), txt: document.getElementById('wait').innerText.replace(/\s+/g, ' ') }));
    ok(w2.on && /等待房主/.test(w2.txt), `[${tag} silent host] guest notices missing frames: 「${w2.txt}」`);
    await h.evaluate(() => { WebSocket.prototype.send = window.__realSend; });
    await g.waitForFunction(() => document.getElementById('wait').classList.contains('hide'), null, { timeout: 4000 }).catch(() => {});
    ok(await g.evaluate(() => document.getElementById('wait').classList.contains('hide')), `[${tag} silent host] notice gone when frames return`);
    await h.waitForTimeout(400);
    const [sh, sg] = await Promise.all([h.evaluate(() => __pb.m.score.join('-') + '/' + __pb.m.point), g.evaluate(() => __pb.m.score.join('-') + '/' + __pb.m.point)]);
    ok(sh === sg, `[${tag}] host and guest agree afterwards (${sh} / ${sg})`);
    await h.context().close(); await g.context().close();
  }
  { const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await c.newPage(); await p.goto(BASE); await p.tap('#bS1'); await p.waitForTimeout(800); await setVis(p, true);
    ok(await p.evaluate(() => !document.getElementById('pause').classList.contains('hide')), '[single player] going to the background opens the pause menu'); await c.close(); }
  ok(!errs.length, 'no console errors ' + errs.join(' | '));
  console.log(fails ? `HOST AWAY: ${fails} FAILED` : 'HOST AWAY: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
