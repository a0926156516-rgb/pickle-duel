// v7 smash balance: Monte-Carlo of deliberate 殺球 against each CPU level, low-ball 殺球 risk, CPU smash frequency, full-match autoplay.
const PB = require('../js/core.js'), C = PB.C;
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const N = +process.env.N || 600;
function rnd(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
// one smash (or shot) from player 0 at a ball of height z, then play the point out with the CPU receiving
function trial(diff, seed, z, shot, mode) {
  const R = rnd(seed * 7 + 3); mode = mode || 1;
  const seats = mode === 2 ? [{ ctrl: 'bot' }, { ctrl: 'ai' }, { ctrl: 'ai' }, { ctrl: 'ai' }] : [{ ctrl: 'bot' }, { ctrl: 'ai' }];
  const m = PB.createMatch({ mode, diff, seed, seats, autoServe: 99 });
  const p = m.players[0], opp = m.players.filter((q) => q.team === 1);
  m.phase = 'rally'; m.live = true; m.hits = 5; m.rally = 5; m.lastHitTeam = 1; m.lastHitter = opp[0].i;
  p.x = -(2.6 + R() * 2.0); p.y = (R() - 0.5) * 3; m.bounces = z > 1.0 ? 0 : 1;
  if (mode === 2) { const mate = m.players[2]; mate.x = -3; mate.y = -p.y || 1.4; }
  opp.forEach((q, k) => { const net = R() < 0.5; q.x = net ? 2.35 + R() * 0.6 : 5.6 + R() * 1.0; q.y = mode === 2 ? (k ? 1.4 : -1.4) + (R() - 0.5) : (R() - 0.5) * 2.4; });
  Object.assign(m.ball, { x: p.x + 0.2, y: p.y + 0.1, z, vx: -0.6, vy: 0, vz: 0.2 });
  p.in.shot = shot; p.in.shotT = m.t;
  let hit = null, aiHits = 0, res = null, kind = null, fate = null;
  for (let i = 0; i < 120 * 8 && !res; i++) {
    p.in.mx = 0; p.in.my = 0; if (!hit) { p.in.shotT = m.t; } else p.in.shotT = -9;
    PB.step(m, 1 / 120);
    for (const e of m.events) {
      if (e.k === 'hit' && e.p === 0 && !hit) { hit = e; kind = e.shot; fate = m.smFate && m.smFate.f; }
      else if (e.k === 'hit' && e.p !== 0 && hit) { if (m.players[e.p].team === 1) aiHits++; else if (aiHits) res = 'returned'; }
      else if (e.k === 'fault' && hit && !res) res = e.team === 0 ? (aiHits ? 'returned' : 'own error') : aiHits ? 'forced error' : 'winner';
    }
    m.events.length = 0;
    if (!res && hit && aiHits && m.lastHitTeam === 1 && m.bounces === 1) res = 'returned'; // CPU's reply landed in: rally goes on
  }
  return { res: res || (hit ? 'returned' : 'no hit'), kind, fate };
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
// full matches: scripted human that smashes every high ball it meets vs each CPU level (see smashplay.js)
process.env.G = process.env.G || '20';
const P = require('./smashplay.js').run(), r = (k) => (P[k].winner + P[k].forced) / P[k].n;
ok(r('1easy') >= 0.4 && r('1easy') <= 0.62, `1v1 easy: high-ball 殺球 wins ${(r('1easy') * 100).toFixed(0)}% outright / forced error (target 40–60%)`);
ok(r('1hard') >= 0.19 && r('1hard') <= 0.32, `1v1 hard: high-ball 殺球 wins ${(r('1hard') * 100).toFixed(0)}% (target ≈25%)`);
ok(r('1easy') > r('1normal') && r('1normal') > r('1hard') && r('2easy') > r('2hard'), 'winner rate falls with difficulty (1v1 and 2v2)');
ok(P['1easy'].winner / P['1easy'].n >= 0.15, `easy CPU is beaten outright by ${(100 * P['1easy'].winner / P['1easy'].n).toFixed(0)}% of smashes (v6: ~5%)`);
// low ball: 殺球 below 0.9 m vs a plain 抽球 at the same height
{ const L = { n: 0, f: 0 }, D = { n: 0, f: 0 };
  for (let s = 1; s <= N; s++) { const z = 0.3 + (s % 6) / 10;
    const a = trial('normal', s, z, 'smash'); if (a.kind) { L.n++; if (a.res === 'own error') L.f++; }
    const b = trial('normal', s, z, 'drive'); if (b.kind) { D.n++; if (b.res === 'own error') D.f++; } }
  console.log(`low ball (z 0.3–0.8 m): 殺球 → power drive own-error (net/out) ${pct(L.f, L.n)} vs plain 抽球 ${pct(D.f, D.n)}`);
  ok(L.f / L.n >= 0.33 && L.f / L.n >= 2.5 * D.f / D.n, `low-ball 殺球 is clearly riskier (${pct(L.f, L.n)} vs ${pct(D.f, D.n)})`); }
// CPU actively smashes high balls, more on harder levels; full AI-vs-AI matches
{ const fr = {};
  for (const diff of ['easy', 'normal', 'hard']) { let hi = 0, sm = 0;
    for (let seed = 1; seed <= 6; seed++) { const m = PB.createMatch({ mode: 1, diff, seed, target: 11, seats: [] }); let pz = null;
      for (let i = 0; i < 60 * 60 * 30 && m.phase !== 'over'; i++) { pz = m.ball.z; PB.step(m, 1 / 60);
        for (const e of m.events) if (e.k === 'hit') { const hz = m.ball.z; if (hz >= 1.05) { hi++; if (e.ds) sm++; } } m.events.length = 0; } }
    fr[diff] = sm / (hi || 1); console.log(`CPU ${diff.padEnd(6)}: deliberate 殺球 on ${sm} of ${hi} balls hit at ≥1.05 m (${pct(sm, hi)})`); }
  ok(fr.easy < fr.normal && fr.normal < fr.hard && fr.hard > 0.3, 'CPU smashes high balls, more often on harder levels'); }
console.log(fails ? `SMASH: ${fails} FAILED` : 'SMASH: ALL PASSED');
process.exit(fails ? 1 : 0);
