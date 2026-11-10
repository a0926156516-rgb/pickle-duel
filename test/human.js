// v9: human-like player model in 殺球練習 — reacts 0.3 s late, positions with ±0.45 m error, presses 殺球 after a 0.1–0.8 s lag.
//  naive: runs to where the lob comes down and presses when the ball gets close, whatever its height (what the R7 tester did)
//  aid:   steps to the v9 smash spot and presses when the 「現在！」 cue lights (contact smashable and ≤ 0.45 s away)
// Compares the v8 core (no window, 0.9 m bar) with the v9 core (0.25 s smash window, 0.8 m bar for players).
const MIN = +(process.env.MIN || 10);
function rnd(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }
function run(corePath, aid, diff, seed) {
  delete require.cache[require.resolve(corePath)]; const PB = require(corePath), C = PB.C;
  const m = PB.createMatch({ mode: 1, diff, seed, target: 999, practice: 'smash', seats: [{ ctrl: 'bot' }, { ctrl: 'ai' }] });
  const p = m.players[0], R = rnd(seed * 13 + 7), H = { key: '' };
  const st = { feeds: 0, pressed: 0, smash: 0, low: 0, late: 0, missed: 0, cue: 0 };
  let cur = null;
  const lag = () => Math.min(0.8, Math.max(0.1, 0.3 + gauss(R) * 0.12));
  for (let i = 0; i < 60 * 60 * MIN; i++) {
    const b = m.ball; p.in.mx = p.in.my = 0;
    if (m.live && m.phase === 'rally' && m.lastHitTeam !== p.team) {
      const key = m.point + ':' + m.hits;
      if (H.key !== key) { if (cur) st.missed += cur.hit ? 0 : 1; H.key = key; H.react = m.t + Math.max(0.15, 0.3 + gauss(R) * 0.08); H.ex = gauss(R) * 0.45; H.ey = gauss(R) * 0.45; H.pressAt = null; cur = { hit: false, pressed: false }; st.feeds++; }
      let tx = p.x, ty = p.y;
      const sa = aid && PB.smashAid ? PB.smashAid(m, p) : null;
      if (sa && sa.spot) { tx = sa.spot.x; ty = sa.spot.y; }
      else { const pr = PB.predict(m); const fb = pr.firstBounce; if (fb && fb.x < 0) { tx = fb.x; ty = fb.y; } }
      tx = Math.min(-C.K - 0.3, tx + H.ex); ty += H.ey;
      if (m.t >= H.react) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); if (d > 0.1) { p.in.mx = dx / d * Math.min(1, d / 0.4); p.in.my = dy / d * Math.min(1, d / 0.4); } }
      if (H.pressAt == null && m.t >= H.react) {
        if (aid && sa && sa.contact && sa.contact.ok && sa.contact.t <= 0.45) { H.pressAt = m.t + lag(); st.cue++; }
        else if (!aid && Math.hypot(b.x - p.x, b.y - p.y) < 2.4) H.pressAt = m.t + lag(); // presses when the ball arrives, whatever its height
      }
      if (H.pressAt != null && m.t >= H.pressAt && !cur.pressed) { p.in.shot = 'smash'; p.in.shotT = m.t; cur.pressed = true; st.pressed++; }
    } else { const dx = -4.6 - p.x, dy = -p.y, d = Math.hypot(dx, dy); if (d > 0.2) { p.in.mx = dx / d * 0.6; p.in.my = dy / d * 0.6; } }
    PB.step(m, 1 / 60);
    for (const e of m.events) if (e.k === 'hit' && e.p === 0 && cur && !cur.hit) { cur.hit = true; if (e.ds) st.smash++; else if (e.low) st.low++; else if (!cur.pressed) st.late++; }
    m.events.length = 0;
  }
  const s = m.smStats[0]; return { ...st, n: s.n, win: s.win, forced: s.forced };
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
const out = {};
for (const diff of (process.env.DIFFS || 'easy,normal,hard').split(',')) for (const [tag, core, aid] of [['v8 core, naive', '/tmp/core_v8.js', false], ['v9 core, naive (window + 0.8 m)', '../js/core.js', false], ['v9 core + 現在！ aid', '../js/core.js', true]]) {
  const a = {}; for (const seed of [11, 22, 33]) { const r = run(require('path').resolve(__dirname, core), aid, diff, seed); for (const k in r) a[k] = (a[k] || 0) + r[k]; }
  out[diff + '|' + tag] = a;
  console.log(`${diff.padEnd(6)} ${tag.padEnd(32)} feeds ${a.feeds}: pressed 殺球 on ${pct(a.pressed, a.feeds)}; of presses -> real smash ${pct(a.smash, a.pressed)}, too low ${pct(a.low, a.pressed)}, press came after contact ${pct(a.pressed - a.smash - a.low, a.pressed)} | smashes ${a.n}: outright ${pct(a.win, a.n)}, forced ${pct(a.forced, a.n)}, total ${pct(a.win + a.forced, a.n)} | smash wins per feed ${pct(a.win + a.forced, a.feeds)}`);
}
module.exports = out;
