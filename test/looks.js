// Online colour/character sync: host picks 阿岩/藍, client picks 小攀/藍 (clash -> must get a different colour), 2v2 with 2 CPU fillers.
const { chromium } = require('playwright');
const SERVER = process.env.SERVER || 'ws://localhost:10077/ws';
const BASE = (process.env.BASEURL || 'http://localhost:8077/index.html') + '?auto=1&server=' + encodeURIComponent(SERVER);
(async () => {
  const b = await chromium.launch(); const errs = []; const P = [];
  for (let i = 0; i < 2; i++) { const c = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); await p.goto(BASE); await p.fill('#nick', ['峻慶', '阿明'][i]); P.push(p); }
  const [h, c] = P;
  await h.tap('#segChar button[data-v="0"]'); await h.tap('#segCol button[data-v="1"]');
  await c.tap('#segChar button[data-v="1"]'); await c.tap('#segCol button[data-v="1"]');
  await h.tap('#segMode button[data-v="2"]').catch(() => {});
  await h.tap('#bHost'); await h.waitForFunction(() => /^\d{4}$/.test(document.getElementById('rcode').textContent), null, { timeout: 90000 });
  const code = await h.evaluate(() => document.getElementById('rcode').textContent);
  await c.fill('#code', code); await c.tap('#bJoin');
  await h.waitForFunction(() => window.__pb.roster.length >= 2, null, { timeout: 30000 });
  await c.waitForTimeout(1500);
  const dots = await c.evaluate(() => [...document.querySelectorAll('.seat[data-seat]')].sort((a, b) => a.dataset.seat - b.dataset.seat).map((s) => s.dataset.seat + ':' + s.querySelector('.dot').style.background));
  const opts = await h.evaluate(() => ({ inRoom: !!document.querySelector('#roomOpts #segDiff'), dup: !!document.getElementById('segDiff2') }));
  await h.screenshot({ path: (process.env.SHOT || '/workspace/pickleball-shots/v2/') + 'room_looks_host_i14.png' });
  await h.tap('#bStart');
  await c.waitForFunction(() => window.__pb.state === 'play', null, { timeout: 30000 }); await c.waitForTimeout(2500);
  const L = (p) => p.evaluate(() => ({ seat: window.__pb.seat, teams: window.__pb.m.teamNames, pl: window.__pb.m.players.map((q) => q.name + ':' + q.ch + '/' + q.co + ':' + q.ctrl) }));
  const lh = await L(h), lc = await L(c);
  console.log('room seat dots (client view):', dots.join(' | '));
  console.log('room options moved into #roomOpts:', opts.inRoom, ' duplicate segDiff2 present:', opts.dup);
  console.log('host  :', JSON.stringify(lh)); console.log('client:', JSON.stringify(lc));
  const same = JSON.stringify(lh.pl.map((s) => s.split(':').slice(0, 2))) === JSON.stringify(lc.pl.map((s) => s.split(':').slice(0, 2)));
  const cos = lh.pl.map((s) => s.split(':')[1].split('/')[1]); const uniq = new Set(cos).size === cos.length;
  const hostOk = lh.pl[0].includes(':0/1:'), cliOk = lh.pl[1].split(':')[1].startsWith('1/');
  await c.screenshot({ path: (process.env.SHOT || '/workspace/pickleball-shots/v2/') + 'online_2v2_client_i14.png' });
  console.log('looks identical host/client:', same, ' colours unique:', uniq, ' host kept 阿岩/藍:', hostOk, ' client kept 小攀 (colour reassigned):', cliOk, ' teamNames match:', JSON.stringify(lh.teams) === JSON.stringify(lc.teams));
  console.log('console errors:', errs.length ? errs : 'none');
  const dotOk = dots[1].includes('232, 72, 59') && dots[0].includes('47, 143, 224'); console.log('room preview matches game colours:', dotOk);
  const ok = dotOk && same && uniq && hostOk && cliOk && !opts.dup && opts.inRoom && !errs.length; console.log(ok ? 'LOOKS SYNC PASS' : 'LOOKS SYNC FAIL'); await b.close(); process.exit(ok ? 0 : 1);
})();
