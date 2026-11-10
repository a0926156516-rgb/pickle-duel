// R3 item 1: the host goes to the background. (a) visibilitychange -> hidden: the room pauses cleanly, guests see 「等待房主…」,
// coming back resumes without the ball teleporting. (b) host goes silent with no visibility event (socket muted,
// like iOS suspending the app): guests notice the missing frames and show the same notice. (c) single player: hidden -> pause menu.
const { chromium } = require('playwright');
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const BASE = (process.env.BASEURL || 'http://localhost:8077/index.html');
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v4/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
const setVis = (p, hidden) => p.evaluate((h) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
(async () => {
  const b = await chromium.launch(); const errs = []; const P = [];
  for (let i = 0; i < 2; i++) { const c = await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(`[p${i}] ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errs.push(`[p${i}] ${m.text()}`)); await p.goto(BASE + '?auto=1&server=' + encodeURIComponent(SERVER)); await p.fill('#nick', ['房主', '來賓'][i]); P.push(p); }
  const [h, g] = P;
  await h.tap('#segMode button[data-v="1"]').catch(() => {});
  await h.tap('#bHost'); await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
  const code = await h.evaluate(() => document.getElementById('rcode').textContent);
  await g.fill('#code', code); await g.tap('#bJoin'); await h.waitForFunction(() => __pb.roster.length >= 2, null, { timeout: 30000 });
  await h.waitForTimeout(700); await h.tap('#bStart'); await g.waitForFunction(() => __pb.state === 'play', null, { timeout: 30000 });
  await h.waitForFunction(() => __pb.m.phase === 'rally', null, { timeout: 20000, polling: 30 });
  // (a) hidden
  await setVis(h, true);
  await g.waitForFunction(() => !document.getElementById('wait').classList.contains('hide'), null, { timeout: 2000 }).catch(() => {});
  const w1 = await g.evaluate(() => ({ on: !document.getElementById('wait').classList.contains('hide'), txt: document.getElementById('wait').innerText.replace(/\s+/g, ' ') }));
  ok(w1.on && /等待房主/.test(w1.txt), `[visibility hidden] guest shows 「${w1.txt}」`);
  await g.screenshot({ path: SHOT + 'guest_waiting_for_host_375x667.png' });
  const t0 = await h.evaluate(() => ({ t: __pb.m.t, b: { ...__pb.m.ball } })); await h.waitForTimeout(1500); const t1 = await h.evaluate(() => ({ t: __pb.m.t, b: { ...__pb.m.ball } }));
  ok(t1.t === t0.t && t1.b.x === t0.b.x, `[visibility hidden] host match paused cleanly (t ${t0.t.toFixed(2)} -> ${t1.t.toFixed(2)})`);
  const gb0 = await g.evaluate(() => ({ ...__pb.m.ball })); await g.waitForTimeout(600); const gb1 = await g.evaluate(() => ({ ...__pb.m.ball }));
  ok(Math.hypot(gb1.x - gb0.x, gb1.y - gb0.y) < 0.05, '[visibility hidden] guest ball frozen too (no drifting)');
  // back
  await setVis(h, false);
  await g.waitForFunction(() => document.getElementById('wait').classList.contains('hide'), null, { timeout: 2000 }).catch(() => {});
  ok(await g.evaluate(() => document.getElementById('wait').classList.contains('hide')), '[visibility visible] guest notice gone, toast 房主回來了');
  // no teleport: sample host ball every animation frame for 2 s, max per-frame jump must be what the physics allows (<0.5 m)
  const jump = await h.evaluate(() => new Promise((res) => { let last = null, mx = 0, n = 0; const f = () => { const b = __pb.m.ball; if (last && __pb.m.point === last.pt) mx = Math.max(mx, Math.hypot(b.x - last.x, b.y - last.y, b.z - last.z)); last = { x: b.x, y: b.y, z: b.z, pt: __pb.m.point }; if (++n < 120) requestAnimationFrame(f); else res(mx); }; requestAnimationFrame(f); }));
  ok(jump < 0.5, `[resume] no ball teleport on host (max per-frame move ${jump.toFixed(3)} m)`);
  const t2 = await h.evaluate(() => __pb.m.t); ok(t2 > t1.t, '[resume] match running again');
  // (b) frozen page without any event
  // headless Chromium keeps timers running under CDP 'frozen', so emulate a suspended host by silencing its socket
  await h.evaluate(() => { window.__realSend = WebSocket.prototype.send; WebSocket.prototype.send = function () {}; });
  await g.waitForFunction(() => !document.getElementById('wait').classList.contains('hide'), null, { timeout: 4000 }).catch(() => {});
  const w2 = await g.evaluate(() => ({ on: !document.getElementById('wait').classList.contains('hide'), txt: document.getElementById('wait').innerText.replace(/\s+/g, ' ') }));
  ok(w2.on && /等待房主/.test(w2.txt), `[host frozen, no event] guest notices missing frames: 「${w2.txt}」`);
  await g.screenshot({ path: SHOT + 'guest_waiting_no_frames_375x667.png' });
  await h.evaluate(() => { WebSocket.prototype.send = window.__realSend; });
  await g.waitForFunction(() => document.getElementById('wait').classList.contains('hide'), null, { timeout: 4000 }).catch(() => {});
  ok(await g.evaluate(() => document.getElementById('wait').classList.contains('hide')), '[host unfrozen] guest notice gone when frames return');
  const [sh, sg] = await Promise.all([h.evaluate(() => __pb.m.score.join('-') + '/' + __pb.m.point), g.evaluate(() => __pb.m.score.join('-') + '/' + __pb.m.point)]);
  ok(sh === sg, `[after both cases] host and guest agree (${sh} / ${sg})`);
  // (c) single player
  { const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await c.newPage(); await p.goto(BASE); await p.tap('#bS1'); await p.waitForTimeout(800); await setVis(p, true);
    const pz = await p.evaluate(() => !document.getElementById('pause').classList.contains('hide')); ok(pz, '[single player] going to the background opens the pause menu'); await c.close(); }
  ok(!errs.length, 'no console errors ' + errs.join(' | '));
  console.log(fails ? `HOST AWAY: ${fails} FAILED` : 'HOST AWAY: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
