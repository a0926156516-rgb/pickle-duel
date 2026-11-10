// Online rooms: 1 host + N-1 clients through the WebSocket relay; all on autopilot.
const { chromium } = require('playwright');
const SERVER = process.env.RELAY || 'ws://localhost:10077/ws';
const BASE = 'http://localhost:8077/index.html?auto=1&server=' + encodeURIComponent(SERVER);
const OUT = __dirname + '/shots/';
async function run(n, mode, secs, tag) {
  const browser = await chromium.launch();
  const errs = [], pages = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[p${i}] ${m.type()}: ${m.text()}`); }); p.on('pageerror', (e) => errs.push(`[p${i}] pageerror: ${e.message}`));
    await p.goto(BASE); await p.fill('#nick', ['峻慶', '阿明', '小美', '大雄'][i]); pages.push(p);
  }
  const [h, ...cs] = pages;
  await h.tap('#bHost');
  await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
  const code = await h.evaluate(() => document.getElementById('rcode').textContent);
  console.log(`[${tag}] room created: ${code}`);
  for (const c of cs) { await c.fill('#code', code); await c.tap('#bJoin'); }
  await h.waitForFunction((k) => __pb.roster.length === k, n, { timeout: 60000 });
  for (const c of cs) await c.waitForFunction((k) => __pb.state === 'room' && __pb.roster.length === k, n, { timeout: 30000 });
  // host picks mode
  await h.tap(`#segMode button[data-v="${mode}"]`); await h.waitForTimeout(400);
  if (n === 4) { // demonstrate seat change: p1 (阿明) moves to blue team seat 2, p2 swaps to seat 1 later via server assignment
    await cs[0].tap('.seat[data-seat="2"]'); await h.waitForTimeout(500);
  }
  await h.screenshot({ path: OUT + `room_${tag}_host.png` });
  await cs[cs.length - 1].screenshot({ path: OUT + `room_${tag}_client.png` });
  const rost = await h.evaluate(() => __pb.roster.map((p) => `${p.n}@seat${p.c}${p.h ? '(host)' : ''}`));
  console.log(`[${tag}] roster:`, rost.join(', '));
  await h.tap('#bStart');
  for (const c of cs) await c.waitForFunction(() => __pb.state === 'play', null, { timeout: 15000 });
  await h.waitForTimeout(secs * 1000);
  for (let i = 0; i < n; i++) await pages[i].screenshot({ path: OUT + `play_${tag}_p${i}.png` });
  const hs = await h.evaluate(() => ({ score: __pb.m.score.slice(), point: __pb.m.point, ctrl: __pb.m.players.map((p) => p.ctrl + ':' + p.name), hits: { ...__pb.hitCount }, rallies: __pb.m.stats.rallies.slice() }));
  console.log(`[${tag}] host: score ${hs.score} point#${hs.point} seats [${hs.ctrl.join(' | ')}] hitsBySeat ${JSON.stringify(hs.hits)} rallies ${hs.rallies}`);
  for (let i = 0; i < cs.length; i++) {
    const s = await cs[i].evaluate(() => ({ role: __pb.role, seat: __pb.seat, score: __pb.m.score.slice(), point: __pb.m.point, ball: [__pb.m.ball.x, __pb.m.ball.y, __pb.m.ball.z].map((v) => +v.toFixed(2)), call: document.getElementById('call').textContent, fps: Math.round(__pb.fps) }));
    console.log(`[${tag}] client${i + 1}: role ${s.role} seat ${s.seat} score ${s.score} point#${s.point} call ${s.call} ball ${s.ball} fps ${s.fps}`);
  }
  const hb = await h.evaluate(() => [__pb.m.ball.x, __pb.m.ball.y, __pb.m.ball.z].map((v) => +v.toFixed(2)));
  console.log(`[${tag}] host ball ${hb}`);
  const remoteHits = Object.entries(hs.hits).filter(([k]) => hs.ctrl[k] && hs.ctrl[k].startsWith('remote')).reduce((a, [, v]) => a + v, 0);
  console.log(`[${tag}] remote-player strokes registered on host: ${remoteHits}`);
  // host leaves -> clients notified
  await h.evaluate(() => document.getElementById('bQuit').click());
  await cs[0].waitForFunction(() => __pb.state === 'menu', null, { timeout: 10000 }).then(() => console.log(`[${tag}] host-left handled: client back to menu with "${''}"`)).catch(() => console.log(`[${tag}] host-left NOT handled`));
  const stmsg = await cs[0].evaluate(() => document.getElementById('status').textContent); console.log(`[${tag}] client status: ${stmsg}`);
  console.log(`[${tag}] console errors/warnings:`, errs.length ? errs : 'none');
  await browser.close();
}
(async () => { await run(2, 1, +process.env.S1 || 14, '1v1'); await run(4, 2, +process.env.S2 || 16, '2v2'); })();
