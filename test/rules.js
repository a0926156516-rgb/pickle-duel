// Targeted rule scenarios against core.js
const PB = require('../js/core.js'); const { C } = PB;
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const human = (mode) => PB.createMatch({ mode, seed: 5, seats: Array.from({ length: mode * 2 }, () => ({ ctrl: 'bot' })), autoServe: 99 });
function runUntil(m, pred, secs = 6) { const evs = []; for (let i = 0; i < secs * 120 && !pred(m, evs); i++) { PB.step(m, 1 / 120); evs.push(...m.events); m.events.length = 0; } return evs; }
const faultOf = (evs) => (evs.find((e) => e.k === 'fault') || {}).reason || '';
function serve(m, shot = 'drive') { const s = m.players[m.server]; m.phaseT = 1; s.in.shot = shot; s.in.shotT = m.t; PB.step(m, 1 / 120); m.events.length = 0; }
// place a player right in the ball's predicted path at height z
function intercept(m, p, pred) { const q = PB.predict(m).find(pred); p.x = q.x; p.y = q.y; return q; }

{ const m = human(1); ok(PB.callText(m) === '0-0', 'singles opening call 0-0'); }
// v6 殺球: a high ball pressed with 殺球 is smashed (fast, downward); a low ball becomes a harder, flatter power drive
function rallyShot(z, shot, seed) {
  const m = PB.createMatch({ mode: 1, seed, seats: [{ ctrl: 'bot' }, { ctrl: 'bot' }], autoServe: 99 });
  const p = m.players[0], o = m.players[1];
  m.phase = 'rally'; m.live = true; m.hits = 4; m.bounces = 1; m.lastHitTeam = o.team; m.lastHitter = o.i;
  p.x = -4.5; p.y = 0; Object.assign(m.ball, { x: -4.3, y: 0, z, vx: -0.5, vy: 0, vz: 0.4 });
  p.in.shot = shot; p.in.shotT = m.t; let hit = null;
  for (let i = 0; i < 30 && !hit; i++) { PB.step(m, 1 / 120); hit = m.events.find((e) => e.k === 'hit'); m.events.length = 0; }
  return hit && { kind: hit.shot, v: Math.hypot(m.ball.vx, m.ball.vy), vz: m.ball.vz };
}
{ const S = [], D = [], L = [];
  for (let k = 1; k <= 12; k++) { S.push(rallyShot(1.3, 'smash', k)); D.push(rallyShot(1.0, 'drive', k)); L.push(rallyShot(0.5, 'smash', k)); }
  const avg = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length;
  ok(S.every((h) => h && h.kind === 'smash'), '殺球 on a high ball (z 1.3 m) is a smash');
  ok(avg(S, (h) => h.v) > avg(D, (h) => h.v) * 1.3 && avg(S, (h) => h.vz) < 0.5, `smash is much faster than a drive and flat/downward (${avg(S, (h) => h.v).toFixed(1)} vs ${avg(D, (h) => h.v).toFixed(1)} m/s, vz ${avg(S, (h) => h.vz).toFixed(1)})`);
  ok(L.every((h) => h && h.kind === 'drive') && avg(L, (h) => h.v) > avg(D, (h) => h.v) * 1.05, `殺球 on a low ball (z 0.5 m) is a power drive (${avg(L, (h) => h.v).toFixed(1)} m/s)`);
  ok(D.every((h) => h && h.kind === 'drive'), 'plain 抽球 at z 1.0 m stays a drive');
}
{ // a smash still obeys the kitchen rule
  const m = PB.createMatch({ mode: 1, seed: 3, seats: [{ ctrl: 'bot' }, { ctrl: 'bot' }], autoServe: 99 }); const p = m.players[0], o = m.players[1];
  m.phase = 'rally'; m.live = true; m.hits = 4; m.bounces = 0; m.lastHitTeam = o.team; m.lastHitter = o.i;
  p.x = -1.2; p.y = 0; Object.assign(m.ball, { x: -1.0, y: 0, z: 1.3, vx: -0.5, vy: 0, vz: 0.3 }); p.in.shot = 'smash'; p.in.shotT = m.t;
  const evs = runUntil(m, (mm) => mm.phase !== 'rally', 1); ok(/廚房/.test(faultOf(evs)), 'smash volley from inside the kitchen is still a kitchen fault: ' + faultOf(evs));
}

{ const m = human(2); ok(PB.callText(m) === '0-0-2', 'doubles opening call 0-0-2'); }
{ // serve positions: server behind baseline on right side (even score), diagonal receiver
  const m = human(1); const s = m.players[m.server], r = m.players[m.receiver];
  ok(Math.abs(s.x) > C.HL && Math.abs(r.x) > C.HL, 'server & receiver start behind baselines');
  ok(Math.sign(s.y) !== Math.sign(r.y) || (s.team === 0 ? s.y < 0 && r.y > 0 : s.y > 0 && r.y < 0), 'receiver is diagonal from server');
}
{ // receiver volleys the serve -> two-bounce fault
  const m = human(1); serve(m); const r = m.players[m.receiver];
  r.in.shotT = 1e9; // simulate deliberate press each frame
  intercept(m, r, (q) => (q.x < 0 ? 0 : 1) === r.team && q.b === 0 && q.z > 0.4 && q.z < 1.5);
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/兩跳規則/.test(faultOf(evs)) && m.score[m.servingTeam] === 1, 'volleying the serve = two-bounce fault, server scores: ' + faultOf(evs));
}
{ // without pressing, auto-swing waits for the bounce (no fault)
  const m = human(1); serve(m); const r = m.players[m.receiver];
  intercept(m, r, (q) => (q.x < 0 ? 0 : 1) === r.team && q.b === 0 && q.z > 0.4 && q.z < 1.5);
  const evs = runUntil(m, (mm) => mm.bounces === 1 || mm.phase !== 'rally', 3);
  ok(m.hits === 1 && m.phase === 'rally' && m.bounces === 1 && !faultOf(evs), 'auto-swing does not volley the serve (ball in reach, no press): waits for the bounce');
  const q = PB.predict(m).find((q) => q.z > 0.3 && q.z < 1.1); r.x = q.x; r.y = q.y;
  runUntil(m, (mm) => mm.hits === 2 || mm.phase !== 'rally', 2); ok(m.hits === 2 && m.phase === 'rally', 'then the return after the bounce is legal');
}
{ // serve into kitchen
  const m = human(1); serve(m, 'dink'); const b = m.ball;
  // re-aim the ball into the kitchen
  const s = m.players[m.server]; const tx = PB.teamSign(1 - s.team) * 1.2, ty = -s.y * 0.8; const T = 1.4 / (C.PACE || 1); // same arc at the v5 pace
  b.vx = (tx - b.x) / T; b.vy = (ty - b.y) / T; b.vz = (0 - b.z + 0.5 * C.G * T * T) / T;
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/廚房/.test(faultOf(evs)), 'serve landing in kitchen is a fault: ' + faultOf(evs));
  ok(m.servingTeam !== s.team, 'singles fault by server -> side out');
}
{ // serve to wrong (same-side) box
  const m = human(1); serve(m); const b = m.ball, s = m.players[m.server];
  const tx = PB.teamSign(1 - s.team) * 5, ty = s.y; const T = 1.2; b.vx = (tx - b.x) / T; b.vy = (ty - b.y) / T; b.vz = (0 - b.z + 0.5 * C.G * T * T) / T;
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/對角/.test(faultOf(evs)), 'serve into the non-diagonal box is a fault: ' + faultOf(evs));
}
{ // out ball
  const m = human(1); serve(m); const b = m.ball, s = m.players[m.server];
  const tx = PB.teamSign(1 - s.team) * 7.5, ty = -s.y; const T = 1.3; b.vx = (tx - b.x) / T; b.vy = (ty - b.y) / T; b.vz = (0 - b.z + 0.5 * C.G * T * T) / T;
  for (const p of m.players) if (p.team !== s.team) p.y = 9; // keep the receiver away
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/出界/.test(faultOf(evs)), 'long serve is out: ' + faultOf(evs));
}
{ // into the net
  const m = human(1); serve(m); const b = m.ball; b.vz = -1;
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/掛網|未過網/.test(faultOf(evs)), 'low serve hits net / fails to clear: ' + faultOf(evs));
}
{ // double bounce: receiver doesn't move
  const m = human(1); serve(m); const r = m.players[m.receiver]; r.y = 9; r.x = PB.teamSign(r.team) * 9;
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/兩次落地/.test(faultOf(evs)) && m.score[m.servingTeam] === 1, 'unreturned serve: double bounce, server scores');
}
{ // third-shot volley by server = two-bounce fault; then kitchen volley later
  const m = human(1); serve(m); const r = m.players[m.receiver], s = m.players[m.server];
  intercept(m, r, (q) => (q.x < 0 ? 0 : 1) === r.team && q.b === 1 && q.z > 0.3 && q.z < 1.2);
  runUntil(m, (mm) => mm.hits >= 2 || mm.phase !== 'rally');
  ok(m.hits === 2, 'return of serve made');
  s.in.shotT = 1e9; intercept(m, s, (q) => (q.x < 0 ? 0 : 1) === s.team && q.b === 0 && q.z > 0.4 && q.z < 1.6 && Math.abs(q.x) > 3);
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/回發球須落地/.test(faultOf(evs)), 'volleying the return = two-bounce fault: ' + faultOf(evs));
}
{ // kitchen volley (rally hit #4 by a player standing in the kitchen)
  const m = human(1); serve(m); m.hits = 3; m.bounces = 0; const r = m.players[m.receiver];
  r.in.shotT = 1e9; r.x = PB.teamSign(r.team) * 1.0; const b = m.ball; Object.assign(b, { x: PB.teamSign(r.team) * 0.6, y: r.y, z: 1.0, vx: PB.teamSign(r.team) * 1, vy: 0, vz: 0 }); m.lastHitTeam = 1 - r.team;
  const evs = runUntil(m, (mm) => mm.phase !== 'rally', 1); ok(/廚房區內截擊/.test(faultOf(evs)), 'volley while standing in kitchen: ' + faultOf(evs));
}
{ // same situation but the ball bounces first -> legal to hit in the kitchen
  const m = human(1); serve(m); m.hits = 3; m.bounces = 1; const r = m.players[m.receiver];
  r.x = PB.teamSign(r.team) * 1.0; const b = m.ball; Object.assign(b, { x: PB.teamSign(r.team) * 0.7, y: r.y, z: 0.5, vx: PB.teamSign(r.team) * 1, vy: 0, vz: 0.5 }); m.lastHitTeam = 1 - r.team;
  runUntil(m, (mm) => mm.hits === 4 || mm.phase !== 'rally', 1); ok(m.hits === 4 && m.phase === 'rally', 'hitting a bounced ball inside the kitchen is legal');
}
{ // momentum: legal volley then stepping into the kitchen
  const m = human(1); serve(m); m.hits = 3; m.bounces = 0; const r = m.players[m.receiver]; const xs = PB.teamSign(r.team);
  r.x = xs * 2.4; const b = m.ball; Object.assign(b, { x: xs * 1.9, y: r.y, z: 1.0, vx: xs * 1, vy: 0, vz: 0 }); m.lastHitTeam = 1 - r.team;
  runUntil(m, (mm) => mm.hits === 4 || mm.phase !== 'rally', 1); ok(m.hits === 4, 'legal volley outside the kitchen');
  r.in.mx = -xs; const evs = runUntil(m, (mm) => mm.phase !== 'rally', 0.4); ok(/截擊後踏入廚房區/.test(faultOf(evs)), 'momentum into kitchen after a volley: ' + faultOf(evs));
}
{ // doubles: wrong receiver
  const m = human(2); serve(m); const r = m.players[m.receiver]; const w = m.players.find((p) => p.team === r.team && p !== r);
  r.y = 9; w.in.shotT = 1e9; intercept(m, w, (q) => (q.x < 0 ? 0 : 1) === w.team && q.b === 1 && q.z > 0.2 && q.z < 1.2);
  const evs = runUntil(m, (mm) => mm.phase !== 'rally'); ok(/接發球員錯誤/.test(faultOf(evs)), 'doubles: partner returning the serve: ' + faultOf(evs));
}
{ // doubles rotation sequence through fault() outcomes
  const m = human(2); const st0 = m.servingTeam; const s0 = m.server; const seq = [PB.callText(m)];
  const lose = (team) => { m.phase = 'rally'; m.live = true; require('../js/core.js'); m.events.length = 0; faultTeam(m, team); };
  function faultTeam(mm, team) { // emulate a rally lost by `team`
    mm.ball.x = PB.teamSign(team) * 3; mm.ball.y = 0; mm.ball.z = C.R + 0.001; mm.ball.vx = 0; mm.ball.vy = 0; mm.ball.vz = -1; mm.lastHitTeam = 1 - team; mm.bounces = 1; mm.hits = 3;
    PB.step(mm, 1 / 120); for (let i = 0; i < 260; i++) PB.step(mm, 1 / 120); mm.events.length = 0; }
  const srvSide0 = m.sides[s0];
  lose(1 - st0); seq.push(PB.callText(m)); ok(m.server === s0 && m.sides[s0] !== srvSide0, 'serving team scores -> same server switches sides');
  lose(st0); seq.push(PB.callText(m)); ok(m.servingTeam !== st0 && m.serverNum === 1, 'start-of-game server 2 faults -> side out to server 1');
  const s1 = m.server; ok(m.sides[s1] === 'R', 'first server after side out is the right-side player');
  lose(m.servingTeam); seq.push(PB.callText(m)); ok(m.serverNum === 2 && m.server !== s1 && m.servingTeam !== st0, 'server 1 faults -> partner serves as server 2');
  lose(m.servingTeam); seq.push(PB.callText(m)); ok(m.servingTeam === st0 && m.serverNum === 1, 'server 2 faults -> side out');
  console.log('     call sequence:', seq.join(' → '));
  ok(seq.join(' ') === '0-0-2 1-0-2 0-1-1 0-1-2 1-0-1', 'doubles score calls follow the official sequence');
}
{ // win by 2 at 11
  const m = human(1); m.score = [10, 10]; m.servingTeam = 0; m.server = 0;
  const f = () => { m.phase = 'rally'; m.live = true; m.ball.x = 3; m.ball.z = C.R + 0.001; m.ball.vz = -1; m.ball.vx = m.ball.vy = 0; m.lastHitTeam = 0; m.bounces = 1; m.hits = 3; for (let i = 0; i < 260; i++) PB.step(m, 1 / 120); };
  f(); ok(m.score[0] === 11 && m.winner === -1, '11-10 is not a win (win by 2)');
  m.servingTeam = 0; m.server = 0; f(); ok(m.score[0] === 12 && m.winner === 0, '12-10 wins');
}
console.log(fails ? `\n${fails} RULE TEST(S) FAILED` : '\nALL RULE TESTS PASSED'); process.exit(fails ? 1 : 0);
