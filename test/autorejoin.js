// R3 item 6/7: a guest in a match reloads the page (or reopens the ?room= link) -> it rejoins by itself, no tap, same seat,
// same generated nickname, toast in own-team-first order. A fresh visitor with the same link is NOT auto-joined.
const { chromium } = require('playwright');
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const BASE = (process.env.BASEURL || 'http://localhost:8077/index.html');
const SHOT = process.env.SHOT || '/workspace/pickleball-shots/v4/';
let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (tag) => { const c = await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`)); return p; };
  const h = await mk('host'), g = await mk('guest');
  await h.goto(BASE + '?server=' + encodeURIComponent(SERVER)); await h.fill('#nick', '房主');
  await h.tap('#bHost'); await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
  const code = await h.evaluate(() => document.getElementById('rcode').textContent);
  // guest types the code by hand (no ?room in its URL) and leaves the nickname empty -> generated 玩家NNN
  await g.goto(BASE + '?server=' + encodeURIComponent(SERVER)); await g.fill('#nick', ''); await g.fill('#code', code); await g.tap('#bJoin');
  await h.waitForFunction(() => __pb.roster.length >= 2, null, { timeout: 30000 }); await h.waitForTimeout(600);
  await h.tap('#bStart'); await g.waitForFunction(() => __pb.state === 'play', null, { timeout: 30000 });
  const seat0 = await g.evaluate(() => __pb.seat); const nick0 = await h.evaluate((s) => __pb.m.players[s].name, seat0);
  ok(/^玩家\d{3}$/.test(nick0), `guest got generated nickname ${nick0} in seat ${seat0}`);
  // let a point or two happen so the score is not 0-0
  await h.evaluate(() => { __pb.m.score = [3, 5]; });
  await g.waitForTimeout(4500); // markInMatch runs every 4 s
  ok(new URL(g.url()).searchParams.get('room') === code, `guest URL now carries ?room=${code} (${g.url().replace(/^.*\?/, '?')})`);
  await g.reload(); // no taps after this
  await g.waitForFunction(() => __pb.state === 'play', null, { timeout: 20000 }).catch(() => {});
  const r = await g.evaluate(() => ({ st: __pb.state, seat: __pb.seat, toast: document.getElementById('toast').innerText, hud: [...document.querySelectorAll('#hud .rows > *')].map((e) => e.innerText.replace(/\s+/g, ' ')) }));
  ok(r.st === 'play', `reload -> back in the match without tapping (state ${r.st})`);
  ok(r.seat === seat0, `same seat (${seat0} -> ${r.seat})`);
  const nick1 = await h.evaluate((s) => __pb.m.players[s].name, seat0); ok(nick1 === nick0, `same generated nickname (${nick0} -> ${nick1})`);
  const mt = seat0 % 2 === 0 ? 0 : 1; const sc = await h.evaluate(() => __pb.m.score); const tn = await h.evaluate(() => __pb.m.teamNames);
  const want = `${tn[mt]} ${sc[mt]} - ${sc[1 - mt]} ${tn[1 - mt]}`;
  ok(r.toast.includes(want), `toast own-team-first: 「${r.toast.trim()}」 (want …${want})`);
  ok(r.hud[0] && r.hud[0].includes('★'), `scoreboard also shows own team first (${r.hud.join(' | ')})`);
  await g.screenshot({ path: SHOT + 'autorejoin_toast_375x667.png' });
  // reopening the link in a new tab of the same browser also rejoins
  const g2 = await g.context().newPage(); await g.close(); await h.waitForTimeout(1500);
  await g2.goto(BASE + '?room=' + code + '&server=' + encodeURIComponent(SERVER));
  await g2.waitForFunction(() => __pb.state === 'play', null, { timeout: 20000 }).catch(() => {});
  ok(await g2.evaluate(() => __pb.state === 'play' && __pb.seat), `reopened ?room link -> auto-rejoined seat ${await g2.evaluate(() => __pb.seat)}`);
  // a stranger with the link only gets the code pre-filled
  const s = await mk('stranger'); await s.goto(BASE + '?room=' + code + '&server=' + encodeURIComponent(SERVER)); await s.waitForTimeout(2500);
  const ss = await s.evaluate(() => ({ st: __pb.state, code: document.getElementById('code').value }));
  ok(ss.st === 'menu' && ss.code === code, `stranger with the link is not auto-joined (state ${ss.st}, code pre-filled ${ss.code})`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(fails ? `AUTO REJOIN: ${fails} FAILED` : 'AUTO REJOIN: ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
