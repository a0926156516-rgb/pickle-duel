// v8: 殺球練習 in Node — the scripted player from smashplay.js (moves like the in-game autopilot, presses 殺球 on any ball it will meet at ≥ 0.9 m)
// against the CPU feeder; also AI-vs-AI deliberate smash outcomes from full matches. Outcomes come from the core's own tracker (m.smStats).
const PB = require('../js/core.js');
const { bot } = require('./smashplay.js');
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
const line = (tag, s) => `${tag} smashes ${s.n}: outright winners ${pct(s.win, s.n)} | forced errors ${pct(s.forced, s.n)} | total won ${pct(s.win + s.forced, s.n)} | returned ${pct(s.ret, s.n)} | own errors ${pct(s.own, s.n)}`;
const out = { practice: {}, ai: {} };
for (const diff of ['easy', 'normal', 'hard']) {
  const tot = { n: 0, win: 0, forced: 0, own: 0, ret: 0 };
  for (let seed = 1; seed <= (+process.env.G || 6); seed++) {
    const m = PB.createMatch({ mode: 1, diff, seed: seed * 977, target: 999, practice: 'smash', seats: [{ ctrl: 'bot' }, { ctrl: 'ai' }] });
    for (let i = 0; i < 60 * 60 * 3; i++) { bot(m, m.players[0]); PB.step(m, 1 / 60); m.events.length = 0; } // 3 minutes of practice
    for (const k in tot) tot[k] += m.smStats[0][k];
  }
  out.practice[diff] = tot; console.log(line(`practice ${diff.padEnd(6)} (scripted player)`, tot));
}
for (const diff of ['easy', 'normal', 'hard']) {
  const tot = { n: 0, win: 0, forced: 0, own: 0, ret: 0 };
  for (const mode of [1, 2]) for (let seed = 1; seed <= (+process.env.G || 6); seed++) {
    const m = PB.createMatch({ mode, diff, seed: seed * 31 + mode, target: 11, seats: [] });
    for (let i = 0; i < 60 * 60 * 30 && m.phase !== 'over'; i++) { PB.step(m, 1 / 60); m.events.length = 0; }
    for (const t of [0, 1]) for (const k in tot) tot[k] += m.smStats[t][k];
  }
  out.ai[diff] = tot; console.log(line(`AI-vs-AI ${diff.padEnd(6)} (1v1+2v2)`, tot));
}
module.exports = out;
