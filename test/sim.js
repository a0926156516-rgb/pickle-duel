// Headless AI-vs-AI matches: checks rules/scoring invariants.
const PB = require('../js/core.js');
let fails = 0; const assert = (c, msg) => { if (!c) { fails++; console.log('ASSERT FAIL:', msg); } };
function run(mode, diff, seed) {
  const m = PB.createMatch({ mode, diff, seed, target: 11, seats: [] });
  const calls = []; let lastScore = [0, 0], lastServing = m.servingTeam, steps = 0;
  assert(calls.length === 0 && PB.callText(m) === (mode === 2 ? '0-0-2' : '0-0'), 'opening call ' + PB.callText(m));
  while (m.phase !== 'over' && steps < 60 * 60 * 60) {
    PB.step(m, 1 / 60); steps++;
    for (const e of m.events) {
      if (e.k === 'call') calls.push(e.text);
      if (e.k === 'point') { assert(e.team === lastServing, 'only serving team scores'); }
    }
    m.events.length = 0;
    for (const v of [m.ball.x, m.ball.y, m.ball.z]) assert(Number.isFinite(v), 'finite ball');
    if (m.score[0] !== lastScore[0] || m.score[1] !== lastScore[1]) {
      assert(m.score[0] + m.score[1] === lastScore[0] + lastScore[1] + 1, 'score +1');
      lastScore = m.score.slice();
    }
    if (m.phase === 'serve') lastServing = m.servingTeam;
  }
  const s = m.score; const w = m.winner;
  assert(m.phase === 'over', 'match finished');
  assert(s[w] >= 11 && s[w] - s[1 - w] >= 2, 'win by 2 to 11: ' + s);
  const avg = m.stats.rallies.reduce((a, b) => a + b, 0) / m.stats.rallies.length;
  return { s, w, mins: (m.t / 60).toFixed(1), pts: m.stats.points, avg: avg.toFixed(1), calls: calls.slice(0, 8).join(' '), faults: m.stats.faults };
}
const agg = {};
for (const mode of [1, 2]) for (const diff of ['easy', 'normal', 'hard']) for (let k = 1; k <= 3; k++) {
  const r = run(mode, diff, k * 7919 + mode * 31);
  console.log(`${mode === 2 ? '2v2' : '1v1'} ${diff.padEnd(6)} ${r.s.join(':')} time ${r.mins}min rallies ${r.pts} avgLen ${r.avg} | ${r.calls}`);
  for (const f in r.faults) agg[f] = (agg[f] || 0) + r.faults[f];
}
console.log('fault reasons:', agg);
console.log(fails ? `FAILED ${fails}` : 'ALL SIM CHECKS PASSED');
process.exit(fails ? 1 : 0);
