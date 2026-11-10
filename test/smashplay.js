// v7: full matches, a scripted human (bot) vs the CPU. The bot chases the ball like the in-game autopilot and presses 殺球
// whenever the ball will be met at ≥ 0.9 m, otherwise 抽球. Every deliberate high-ball smash is followed to its outcome.
const PB = require(process.env.CORE || '../js/core.js'), C = PB.C;
function bot(m, p) {
  const b = m.ball, xs = PB.teamSign(p.team); let tx = xs * (m.hits >= 3 ? C.K + 0.5 : C.HL - 0.3), ty = b.y * 0.4;
  if (m.phase === 'serve') { const f = PB.formation(m)[p.i]; tx = f.x; ty = f.y; if (m.server === p.i && m.phaseT > 1.1) { p.in.shot = 'drive'; p.in.shotT = m.t; } }
  else if (m.live && m.lastHitTeam !== p.team) {
    const key = m.rally + ':' + m.bounces; if (bot.key !== key) { bot.key = key; bot.pred = PB.predict(m); }
    const fb = bot.pred.firstBounce;
    if (m.bounces === 0 && fb && PB.isOut(fb.x, fb.y)) { p.in.mx = 0; p.in.my = Math.abs(p.y - fb.y) < 1.3 ? Math.sign(p.y - fb.y || 1) : 0; p.in.shotT = -9; return; } // let an out ball go
    if (fb && (fb.x < 0 ? 0 : 1) === p.team) { tx = fb.x + xs * 0.6; ty = fb.y; }
    for (const q of bot.pred) {
      if ((q.x < 0 ? 0 : 1) !== p.team || q.b >= 2) continue;
      if (!(q.b >= 1 ? q.z > 0.15 && q.z < 1.3 : m.hits >= 3 && Math.abs(q.x) > C.K + 0.4 && q.z > 0.3 && q.z < 2.2)) continue;
      tx = q.x + xs * 0.2; ty = q.y; if (Math.hypot(q.x - p.x, q.y - p.y) / C.SPEED <= q.t) break;
    }
    if ((m.bounces > 0 || m.hits >= 3) && !(m.bounces === 0 && PB.inKitchen(p))) { p.in.shot = b.z >= 0.95 ? 'smash' : 'drive'; p.in.shotT = m.t; }
  }
  if (m.phase !== 'serve') { const ax = Math.abs(tx); tx = xs * Math.max(0.4, Math.min(C.HL + 1.0, xs * tx > 0 ? ax : 0.4)); ty = Math.max(-C.HW - 0.4, Math.min(C.HW + 0.4, ty)); }
  if (m.phase === 'rally' && m.bounces === 0 && Math.abs(p.x) < C.K + 0.2 && m.lastHitTeam !== p.team) { p.in.mx = xs; p.in.my = 0; return; }
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  p.in.mx = d < 0.08 ? 0 : dx / d * Math.min(1, d / 0.5); p.in.my = d < 0.08 ? 0 : dy / d * Math.min(1, d / 0.5);
}
const FT = {}, QS = [];
function play(diff, seed, mode) {
  const seats = mode === 2 ? [{ ctrl: 'bot' }, { ctrl: 'ai' }, { ctrl: 'ai' }, { ctrl: 'ai' }] : [{ ctrl: 'bot' }, { ctrl: 'ai' }];
  const m = PB.createMatch({ mode, diff, seed, target: 11, seats, autoServe: 4 }); const p = m.players[0];
  const out = { n: 0, winner: 0, forced: 0, own: 0, returned: 0, low: 0, lowErr: 0 }; let cur = null, low = null;
  for (let i = 0; i < 60 * 60 * 40 && m.phase !== 'over'; i++) {
    bot(m, p); PB.step(m, 1 / 60);
    for (const e of m.events) {
      if (e.k === 'hit' && e.p === 0) { if (cur) { out.returned++; cur = null; } if (e.ds || (!('ds' in e) && e.shot === 'smash' && 'volley' in e)) { out.n++; cur = { ai: 0, f: m.smFate && m.smFate.f, q: m.smFate && m.smFate.q }; if (process.env.FATE) { FT[cur.f] = (FT[cur.f] || 0) + 1; QS.push(cur.q); } } if (e.low) { out.low++; low = 1; } }
      else if (e.k === 'hit' && cur) { if (m.players[e.p].team === 1) cur.ai++; }
      else if (e.k === 'hit') low = null;
      if (e.k === 'fault' && cur && process.env.FATE) { const kk = cur.f + ':' + (e.team === 0 ? (cur.ai ? 'ret' : 'own') : cur.ai ? 'forced' : 'win'); FT[kk] = (FT[kk] || 0) + 1; }
      if (e.k === 'fault') { if (cur && process.env.DBG) console.log('  smash->', e.team, e.reason, cur.ai); if (cur) { if (e.team === 0) cur.ai ? out.returned++ : out.own++; else cur.ai ? out.forced++ : out.winner++; cur = null; } if (low && e.team === 0) out.lowErr++; low = null; }
    }
    m.events.length = 0;
    if (cur && cur.ai && m.lastHitTeam === 1 && m.bounces === 1) { out.returned++; cur = null; }
    if (low && m.lastHitTeam === 0 && m.bounces === 1) low = null;
  }
  out.pw = m.score[0]; out.pl = m.score[1]; out.games = 1; out.gw = m.winner === 0 ? 1 : 0;
  return out;
}
function run() {
const res = {};
for (const mode of (process.env.MODES || '1,2').split(',').map(Number)) for (const diff of ['easy', 'normal', 'hard']) {
  const a = { n: 0, winner: 0, forced: 0, own: 0, returned: 0, low: 0, lowErr: 0, pw: 0, pl: 0, games: 0, gw: 0 };
  for (let s = 1; s <= (+process.env.G || 12); s++) { const o = play(diff, s * 131 + mode, mode); for (const k in a) a[k] += o[k]; }
  res[mode + diff] = a; const pc = (x) => (a.n ? (100 * x / a.n).toFixed(0) : '0') + '%';
  console.log(`${mode === 2 ? '2v2' : '1v1'} ${diff.padEnd(6)} smashes ${a.n}: winners ${pc(a.winner)} + forced errors ${pc(a.forced)} = ${pc(a.winner + a.forced)} won | own errors ${pc(a.own)} | returned ${pc(a.returned)}${a.low ? ` | low-ball 殺球 ${a.low}, own error ${(100 * a.lowErr / a.low).toFixed(0)}%` : ''} | bot score ${a.pw}:${a.pl}, games ${a.gw}/${a.games}`);
}
if (process.env.FATE) console.log(FT, 'q avg', (QS.reduce((a, b) => a + b, 0) / QS.length).toFixed(2));
return res;
}
module.exports = { bot, run };
if (require.main === module) run();
