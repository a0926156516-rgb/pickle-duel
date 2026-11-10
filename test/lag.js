// v10: lagged-input player in 殺球練習 — every input (movement and the 殺球 press) reaches the game 1–3 s (real time) after the player
// decides, like the R8 tester's remote desktop. Game time runs at the 慢動作 scale, so a lag of L real seconds is L × scale game seconds.
//  feed: when the CPU's feed leaves its racket, the player starts walking to the 殺球點 ring and presses 殺球 once (both arrive L later)
//  cue:  walks the same way, but presses when the 「現在！」 cue lights (arrives L later)
// arm = the v10 practice 預備 rule (a 殺球 press during the incoming ball is kept until contact while the ball is high enough).
const PB = require('../js/core.js'), C = PB.C;
const MIN = +(process.env.MIN || 8);  // real minutes per config
function rnd(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }
function run({ scale, arm, how, diff, seed, lo = 1, hi = 3 }) {
  const m = PB.createMatch({ mode: 1, diff, seed, target: 999, practice: 'smash', seats: [{ ctrl: 'bot' }, { ctrl: 'ai' }] });
  const p = m.players[0], R = rnd(seed * 31 + 5), H = { key: '' }, A = { k: null, on: false }, st = { feeds: 0, pressed: 0, smash: 0, low: 0, late: 0, missed: 0 };
  let cur = null, fed = false; const dtR = 1 / 60; let TS = 1, rt = 0; // real frame / real clock; v11: slow only while the ball is on my side coming at me
  for (let i = 0; i < 60 * 60 * MIN; i++) {
    m.feedWait = fed ? 2.5 : 0.8; const b = m.ball; p.in.mx = p.in.my = 0;
    { const tgt = scale < 1 && m.live && m.phase === 'rally' && m.lastHitTeam !== p.team && b.x < 0.4 ? scale : 1; TS += (tgt - TS) * (1 - Math.exp(-dtR * (tgt < TS ? 14 : 6))); if (Math.abs(TS - tgt) < 0.01) TS = tgt; } const dt = dtR * TS;
    const incoming = m.live && m.phase === 'rally' && m.lastHitTeam !== p.team, key = m.point + ':' + m.hits;
    if (incoming) {
      if (H.key !== key) { if (cur && !cur.hit) st.missed++; H.key = key; const L = lo + R() * (hi - lo); H.go = rt + L; H.L = L; H.ex = gauss(R) * 0.45; H.ey = gauss(R) * 0.45; const sa = PB.smashAid(m, p); H.spot = sa && sa.spot; H.press = how === 'feed' ? rt + L : null; cur = { hit: false, pressed: false }; st.feeds++; }
      if (!H.spot) { const sa = PB.smashAid(m, p); if (sa && sa.spot) H.spot = sa.spot; }
      if (how === 'cue' && H.press == null) { const sa = PB.smashAid(m, p); if (sa && sa.contact && sa.contact.ok && sa.contact.t <= 0.45) H.press = rt + H.L; }
      if (rt >= H.go && H.spot) { const tx = Math.min(-C.K - 0.3, H.spot.x + H.ex), ty = H.spot.y + H.ey, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); if (d > 0.1) { p.in.mx = dx / d * Math.min(1, d / 0.4); p.in.my = dy / d * Math.min(1, d / 0.4); } }
      if (H.press != null && rt >= H.press && !cur.pressed) { p.in.shot = 'smash'; p.in.shotT = m.t; cur.pressed = true; st.pressed++; if (arm) A.k = key; }
      if (arm && A.k === key) { if (PB.inKitchen(p)) { if (A.on) { p.in.shotT = -9; A.on = false; } } else if (b.z >= PB.SMASH_ZH) { p.in.shot = 'smash'; p.in.shotT = m.t; A.on = true; } else if (A.on) { p.in.shotT = -9; A.on = false; } }
    } else { A.on = false; const dx = -4.6 - p.x, dy = -p.y, d = Math.hypot(dx, dy); if (d > 0.2 && m.phase !== 'rally') { p.in.mx = dx / d * 0.6; p.in.my = dy / d * 0.6; } }
    PB.step(m, dt); rt += dtR;
    for (const e of m.events) { if (e.feed) fed = true; if (e.k === 'hit' && e.p === 0 && cur && !cur.hit) { cur.hit = true; if (e.ds) st.smash++; else if (e.low) st.low++; else st.late++; } }
    m.events.length = 0;
  }
  const s = m.smStats[0]; return { ...st, n: s.n, win: s.win, forced: s.forced };
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
const out = {};
const CFG = [['1× (v9: no 預備)', 1, false, 'feed'], ['1× + 預備', 1, true, 'feed'], ['0.5× + 預備', 0.5, true, 'feed'], ['0.35× no 預備', 0.35, false, 'feed'], ['0.35× + 預備', 0.35, true, 'feed'], ['0.35× + 預備, press on 現在！', 0.35, true, 'cue']];
for (const diff of (process.env.DIFFS || 'easy,normal').split(',')) for (const [tag, scale, arm, how] of CFG) {
  const a = {}; for (const seed of [3, 4, 5]) { const r = run({ scale, arm, how, diff, seed }); for (const k in r) a[k] = (a[k] || 0) + r[k]; }
  out[diff + '|' + tag] = a;
  console.log(`${diff.padEnd(6)} lag 1–3 s ${tag.padEnd(28)} balls ${String(a.feeds).padStart(4)}: real 殺球 ${pct(a.smash, a.feeds).padStart(4)} | 抽 instead ${pct(a.late + a.low, a.feeds).padStart(4)} | missed ${pct(a.missed, a.feeds).padStart(4)} | smashes won ${pct(a.win + a.forced, a.n).padStart(4)} | smash winners per ball ${pct(a.win + a.forced, a.feeds)}`);
}
module.exports = out;
if (require.main === module) {
  const g = (k) => out[k], r = (k) => g(k).smash / g(k).feeds;
  let fails = 0; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails++; };
  ok(r('easy|0.35× + 預備') >= 0.6, `0.35× + 預備: ${pct(g('easy|0.35× + 預備').smash, g('easy|0.35× + 預備').feeds)} of balls become real smashes despite 1–3 s lag (target ≥ 60%)`);
  ok(r('easy|0.35× + 預備') > 2 * r('easy|1× (v9: no 預備)'), 'far better than v9 at full speed');
  console.log(fails ? `LAG: ${fails} FAILED` : 'LAG: ALL PASSED'); process.exit(fails ? 1 : 0);
}
