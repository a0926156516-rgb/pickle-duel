/* 匹克球對決 — core: physics, official rules, scoring, AI. Pure logic (works in browser + Node). */
(function (root) {
'use strict';
const C = {
  HL: 6.705,      // half length (baseline |x|) — court 13.41 m
  HW: 3.05,       // half width (sideline |y|) — court 6.10 m
  K: 2.134,       // non-volley zone (kitchen) depth from net — 7 ft
  NET_C: 0.864, NET_S: 0.914, NET_HALF: 3.35,
  R: 0.037, G: 9.81, REACH: 1.0, BOUNCE: 0.6, FRIC: 0.84,
  PACE: 0.74,     // v5 「球速變慢」: every shot flies at 74% speed. Gravity is scaled by PACE² so each trajectory keeps the same shape (same arcs, bounces, net clearance), just slower.
  SPEED: 5.3, DT: 1 / 120
};
C.G = 9.81 * C.PACE * C.PACE;
const DIFF = {
  easy:   { sig: 0.55, err: 0.09,  speed: 4.3, react: 0.32, skill: 0.45, drive: 10.5, drop: 0.25, tire: 14, smash: 0.2,  sm: { miss: 0.36, err: 0.30, weak: 0.22 } },
  normal: { sig: 0.38, err: 0.05,  speed: 4.9, react: 0.2,  skill: 0.7,  drive: 12,   drop: 0.45, tire: 10, smash: 0.45, sm: { miss: 0.24, err: 0.20, weak: 0.26 } },
  hard:   { sig: 0.25, err: 0.022, speed: 5.4, react: 0.12, skill: 0.9,  drive: 13.5, drop: 0.6, tire: 6,  smash: 0.7,  sm: { miss: 0.13, err: 0.15, weak: 0.28 } }
};
// v7 smash balance: smash = chance to actively 殺球 a high ball; sm = how a CPU copes with a well-placed smash coming at it
// (miss: can't get the racket on it, err: mis-hits it into the net / out, weak: pops up a short, high ball). Scaled by the smash's quality.
const HUMAN = { sig: 0.2, err: 0.012 };
const SMASH_Z = 0.9, SM_LUNGE = +(typeof process !== 'undefined' && process.env && process.env.LUNGE) || 1.6; // 殺球 needs the ball at shoulder height or above
const HUMAN_REACH = { easy: 1.45, normal: 1.3, hard: 1.08 }; // auto-swing radius multiplier for human players (beginner friendly)
const teamSign = (t) => (t === 0 ? -1 : 1);
const sideSign = (t, s) => (t === 0 ? (s === 'R' ? -1 : 1) : (s === 'R' ? 1 : -1));
const netH = (y) => C.NET_C + (C.NET_S - C.NET_C) * Math.min(1, Math.abs(y) / C.HW);
const inKitchen = (p) => Math.abs(p.x) < C.K;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TEAM_NAME = ['藍隊', '紅隊'];

function rng(seed) { let a = seed >>> 0 || 1; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function createMatch(cfg) {
  const mode = cfg.mode === 2 ? 2 : 1;
  const n = mode * 2;
  const m = {
    cfg, mode, target: cfg.target || 11, teamNames: (cfg.teamNames && cfg.teamNames.length === 2) ? cfg.teamNames.slice() : TEAM_NAME.slice(), diff: DIFF[cfg.diff] ? cfg.diff : 'normal',
    r: rng(cfg.seed || (Math.random() * 1e9) | 0),
    t: 0, players: [], score: [0, 0], servingTeam: cfg.firstServe === 1 ? 1 : 0,
    serverNum: mode === 2 ? 2 : 1, server: 0, receiver: 1, sides: [],
    phase: 'serve', phaseT: 0, point: 0, hits: 0, bounces: 0, lastHitTeam: -1, lastHitter: -1,
    ball: { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0 }, live: false, events: [], winner: -1,
    pred: null, msg: '', rally: 0, stats: { faults: {}, rallies: [], points: 0 }, autoServe: cfg.autoServe || 10,
    practice: cfg.practice === 'smash' ? 'smash' : null, // v8 殺球練習: the CPU keeps feeding high balls
    smStats: [0, 1].map(() => ({ n: 0, win: 0, forced: 0, own: 0, ret: 0 })), smTrack: null
  };
  for (let i = 0; i < n; i++) {
    const s = (cfg.seats && cfg.seats[i]) || {};
    m.players.push({
      i, team: i % 2, name: s.name || (s.ctrl === 'ai' || !s.ctrl ? '電腦' : '玩家'), color: s.co != null ? s.co : s.color != null ? s.color : i, co: s.co != null ? s.co : i % 4, ch: s.ch === 1 ? 1 : 0,
      ctrl: s.ctrl || 'ai', x: 0, y: 0, vx: 0, vy: 0, face: i % 2 === 0 ? 1 : -1, swing: 0, swingShot: 'drive', volleyT: -9,
      in: { mx: 0, my: 0, shot: 'drive', shotT: -9, aim: 0, aimOn: false },
      ai: { tx: 0, ty: 0, react: 0, ver: -1, leave: -1, serveAt: 0, resp: false }
    });
  }
  // doubles: seats 0,1 start on the right (even) side
  for (let i = 0; i < n; i++) m.sides[i] = i < 2 ? 'R' : 'L';
  m.server = rightPlayer(m, m.servingTeam);
  setupPoint(m, true);
  return m;
}
const teamPlayers = (m, t) => m.players.filter((p) => p.team === t);
const partner = (m, p) => m.players.find((q) => q.team === p.team && q !== p);
function rightPlayer(m, t) { return teamPlayers(m, t).find((p) => m.sides[p.i] === 'R').i; }
function callText(m) {
  const st = m.servingTeam, a = m.score[st], b = m.score[1 - st];
  return m.mode === 2 ? `${a}-${b}-${m.serverNum}` : `${a}-${b}`;
}
function ev(m, o) { m.events.push(o); }

function formation(m) {
  const st = m.servingTeam, rt = 1 - st, srv = m.players[m.server];
  const side = m.sides[srv.i];
  const pos = [];
  for (const p of m.players) {
    const xs = teamSign(p.team), s = m.sides[p.i];
    let x, y;
    if (p.i === m.server) { x = xs * (C.HL + 0.35); y = sideSign(p.team, s) * 1.4; }
    else if (p.i === m.receiver) { x = xs * (C.HL + 0.45); y = sideSign(p.team, s) * 1.5; }
    else if (p.team === st) { x = xs * (C.HL + 0.2); y = sideSign(p.team, s) * 1.5; }
    else { x = xs * (C.K + 0.35); y = sideSign(p.team, s) * 1.5; }
    pos[p.i] = { x, y };
  }
  void side; void rt;
  return pos;
}

function setupPoint(m, first) {
  const st = m.servingTeam, rt = 1 - st;
  if (m.mode === 1) {
    const s = m.score[st] % 2 === 0 ? 'R' : 'L';
    m.sides[0] = m.sides[1] = s;
    m.server = teamPlayers(m, st)[0].i; m.receiver = teamPlayers(m, rt)[0].i;
  } else {
    const s = m.sides[m.server];
    m.receiver = teamPlayers(m, rt).find((p) => m.sides[p.i] === s).i;
  }
  const pos = formation(m);
  for (const p of m.players) { p.x = pos[p.i].x; p.y = pos[p.i].y; p.vx = p.vy = 0; p.swing = 0; p.volleyT = -9; p.face = p.team === 0 ? 1 : -1; p.ai.leave = -1; p.ai.serveAt = 0.9 + m.r() * 0.8; }
  m.phase = 'serve'; m.phaseT = 0; m.hits = 0; m.bounces = 0; m.lastHitTeam = -1; m.lastHitter = -1; m.live = false; m.rally = 0; m.smFate = null; m.smTrack = null;
  m.point++; m.pred = null; holdBall(m);
  ev(m, { k: 'call', text: callText(m), server: m.server, first: !!first });
}
function holdBall(m) {
  const s = m.players[m.server];
  Object.assign(m.ball, { x: s.x + s.face * 0.35, y: s.y + 0.2, z: 0.75, vx: 0, vy: 0, vz: 0 });
}

// ---- ballistics ----
function launch(from, tx, ty, T, clr) {
  let vx = 0, vy = 0, vz = 0; T /= C.PACE; // flight times are tuned at full pace; slow them all by the same factor
  for (let k = 0; k < 60; k++) {
    vx = (tx - from.x) / T; vy = (ty - from.y) / T; vz = (C.R - from.z + 0.5 * C.G * T * T) / T;
    const tc = (0 - from.x) / vx;
    if (!(tc > 0 && tc < T)) break;
    const zc = from.z + vz * tc - 0.5 * C.G * tc * tc, yc = from.y + vy * tc;
    if (zc >= netH(yc) + clr) break;
    T += 0.035 / C.PACE;
  }
  return { vx, vy, vz };
}
function predict(m) {
  const b = { ...m.ball }; const out = []; let bo = m.bounces; const dt = 1 / 60;
  for (let t = dt; t < 3.5 / C.PACE; t += dt) {
    b.vz -= C.G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= C.R && b.vz < 0) { b.z = C.R; b.vz = -b.vz * C.BOUNCE; b.vx *= C.FRIC; b.vy *= C.FRIC; bo++; if (bo === 1 + m.bounces) out.firstBounce = { x: b.x, y: b.y }; }
    out.push({ t, x: b.x, y: b.y, z: b.z, b: bo });
    if (bo >= 2) break;
  }
  return out;
}
const isOut = (x, y) => Math.abs(x) - C.R > C.HL || Math.abs(y) - C.R > C.HW;

// ---- shots ----
function makeShot(m, p, shot, aimY, aiTarget) {
  const human = p.ctrl !== 'ai';
  const D = DIFF[m.diff], o = 1 - p.team, xs = teamSign(o), b = m.ball, r = m.r;
  const dist = Math.hypot(b.x - p.x, b.y - p.y);
  const stretch = clamp(dist / C.REACH, 0, 1.2);
  const tire = 1 + m.rally / (human ? 14 : D.tire * (m.mode === 2 ? 0.8 : 1) * C.PACE * 0.85); // CPU tires a bit sooner at the slower v5 pace so rallies stay about as long as before // long rallies get harder to sustain (CPU tires faster on hard/doubles so points don't drag)
  let sig = (human ? HUMAN.sig : D.sig) * (0.7 + 0.6 * stretch) * (b.z < 0.25 ? 1.25 : 1) * Math.sqrt(tire);
  let perr = (human ? HUMAN.err : D.err) * (human ? 1 : Math.pow(tire, 1.7));
  const from = { x: b.x, y: b.y, z: Math.max(b.z, 0.12) };
  let tx, ty, T, clr = 0.12;
  if (aiTarget && aiTarget.y != null) ty = aiTarget.y; else if (human && Math.abs(aimY) > 0.2) ty = aimY * 2.5; else ty = -p.y * 0.45;
  let kind = shot, power = 1;
  if (shot === 'drive' && b.z > 1.35 && Math.abs(p.x) < 5.2) kind = 'smash';
  // 殺球 button (v6): a ball at shoulder height or above (z ≥ 0.9 m) is smashed down hard; a lower ball can't be hit downward,
  // so it becomes a flat power drive (20% faster than a drive) that is harder to control.
  // v7: a 殺球 on a ball below 0.9 m can't be hit down — it is a flat, overhit power drive with a big net / out risk
  let low = false;
  if (shot === 'smash') { if (b.z >= SMASH_Z) { kind = 'smash'; sig *= 1.05; } else { kind = 'drive'; low = true; power = 1.3; sig *= 1.6; perr = Math.max(perr * 4, 0.3) + (SMASH_Z - b.z) * 0.35; } }
  p.lowSmash = low;
  // the receiving CPU's fate against this shot (set by an earlier deliberate smash): err = mis-hit, weak = short pop-up
  const fate = m.smFate && m.smFate.rally === m.rally && m.smFate.team === p.team && !human ? m.smFate.f : null;
  if (fate === 'err') perr = 1;
  if (kind === 'smash') {
    if (shot === 'smash') { // deliberate 殺球 (v7): aimed deep and toward the open sideline
      const opp = m.players.filter((q) => q.team === o);
      if (aiTarget && aiTarget.y != null) ty = clamp(aiTarget.y, -1.9, 1.9) * (human ? 1.15 : 1);
      else if (!(human && Math.abs(aimY) > 0.2)) { let bs = -1; for (const y of [-2.3, 2.3]) { const d = Math.min(...opp.map((q) => Math.abs(q.y - y))); if (d > bs) { bs = d; ty = y * (human ? 1 : 0.82); } } }
      tx = xs * (4.9 + r() * 1.25);
    } else tx = xs * (3.6 + r() * 2.2);
    const sp = shot === 'smash' ? 18.5 : 17; // a deliberate 殺球 is hit a bit harder than the automatic overhead
    T = Math.hypot(tx - from.x, ty - from.y) / sp; clr = 0.04; }
  else if (kind === 'drive') { tx = xs * (aiTarget && aiTarget.x ? aiTarget.x : 5.4 + r() * 0.7); const sp = (human ? 12.5 : D.drive) * power; T = Math.hypot(tx - from.x, ty - from.y) / sp; clr = low ? 0.02 : 0.1; }
  else if (kind === 'dink') { tx = xs * (1.05 + r() * 0.75); const d = Math.hypot(tx - from.x, ty - from.y); T = Math.max(0.75, d / 5.8); clr = 0.2; }
  else if (aiTarget && aiTarget.feed) { kind = 'lob'; tx = xs * (3.6 + r() * 1.8); ty = (r() - 0.5) * 3.2; T = 1.3 + r() * 0.3; clr = 0.6; sig *= 0.5; if (fate !== 'err') perr = 0; } // 殺球練習 feed: a high ball into the smash zone
  else { kind = 'lob'; tx = xs * (5.5 + r() * 0.75); T = 1.5 + r() * 0.35; clr = 0.6; }
  p.popUp = fate === 'weak';
  if (fate === 'weak') { kind = 'lob'; tx = xs * (2.6 + r() * 1.4); ty = (r() - 0.5) * 2; T = 1.15 + r() * 0.25; clr = 0.5; sig *= 0.6; } // stabbed it back: a short, high sitter
  tx += gauss(r) * sig * (kind === 'dink' ? 0.45 : 0.75); ty += gauss(r) * sig;
  ty = clamp(ty, -C.HW - 1.2, C.HW + 1.2);
  let v = launch(from, tx, ty, T, clr);
  const mis = r() < perr;
  if (mis) { // mis-hit
    const k = r();
    if (fate === 'err') { // a CPU rushed by a smash frames it: into the net, or flying long
      if (k < 0.5) { v.vz = -0.6; v.vx *= 0.8; } else { const lx = xs * (C.HL + 0.7 + r() * 1.6); v = launch(from, lx, ty, Math.hypot(lx - from.x, ty - from.y) / 11, 0.3); } }
    else if (k < (low ? 0.5 : 0.45)) { v.vz *= 0.55; v.vx *= 0.9; }           // into the net
    else if (k < (low ? 0.9 : 0.75)) { v.vx *= low ? 1.4 : 1.22; v.vy *= 1.1; if (low) v.vz += 0.8; }       // long (an overhit low 殺球 sails)
    else { v.vy += (r() < 0.5 ? -1 : 1) * 2.5 * C.PACE; }          // wide
  }
  b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.z = from.z;
  p.swing = 1; p.swingShot = kind;
  m.smFate = null;
  if (kind === 'smash' && shot === 'smash') { // decide how the CPU on the other side copes with this smash
    const opp = m.players.filter((q) => q.team === o), Dr = DIFF[m.diff].sm;
    const hq = 0.6 + 0.4 * clamp((b.z - SMASH_Z) / 0.9, 0, 1);                       // the higher the contact, the steeper and harder
    const away = Math.min(...opp.map((q) => Math.hypot(q.x - tx, q.y - ty)));       // placed away from the receiver(s)
    const q = hq * clamp(0.45 + away / 4, 0.5, 1) * (mis ? 0 : 1);
    const u = r(); let f = 'ok';
    if (opp.some((q2) => q2.ctrl === 'ai')) { if (u < Dr.miss * q) f = 'miss'; else if (u < (Dr.miss + Dr.err) * q) f = 'err'; else if (u < (Dr.miss + Dr.err + Dr.weak) * q) f = 'weak'; }
    m.smFate = { rally: m.rally + 1, team: o, f, q };
  }
  return kind;
}

// ---- rules ----
// ---- v8 smash outcome tracking (bookkeeping only; does not change any call) ----
// a deliberate 殺球 ends as: win = point/rally over before the other side touched it, forced = the other side touched it and
// that touch was the rally's last (net / out / not over), ret = the other side got it back into play, own = the smash itself faulted.
function smResolve(m, how) {
  const t = m.smTrack; if (!t) return; m.smTrack = null;
  m.smStats[t.team].n++; m.smStats[t.team][how]++;
  ev(m, { k: 'smashend', team: t.team, p: t.p, how });
}
function fault(m, team, reason, who) {
  if (m.phase !== 'rally' && m.phase !== 'serve') return;
  if (m.smTrack) { const t = m.smTrack; smResolve(m, team === t.team ? (t.touched ? 'ret' : 'own') : t.touched ? 'forced' : 'win'); }
  m.phase = 'dead'; m.phaseT = 0; m.live = false;
  m.stats.faults[reason] = (m.stats.faults[reason] || 0) + 1; m.stats.rallies.push(m.rally); m.stats.points++;
  const st = m.servingTeam;
  let out;
  if (team === st) {
    if (m.mode === 2 && m.serverNum === 1) { m.serverNum = 2; m.server = partner(m, m.players[m.server]).i; out = { k: 'second', text: '換第二發球員' }; }
    else { m.servingTeam = 1 - st; m.serverNum = 1; m.server = m.mode === 2 ? rightPlayer(m, m.servingTeam) : teamPlayers(m, m.servingTeam)[0].i; out = { k: 'sideout', text: '換發球（Side Out）', team: m.servingTeam }; }
  } else {
    m.score[st]++;
    if (m.mode === 2) { const tp = teamPlayers(m, st); const a = m.sides[tp[0].i]; m.sides[tp[0].i] = m.sides[tp[1].i]; m.sides[tp[1].i] = a; }
    out = { k: 'point', team: st, text: m.teamNames[st] + ' 得分！' };
  }
  ev(m, { k: 'fault', team, reason, who: who == null ? -1 : who });
  ev(m, out);
  const s = m.score;
  for (const t of [0, 1]) if (s[t] >= m.target && s[t] - s[1 - t] >= 2) { m.winner = t; ev(m, { k: 'win', team: t }); }
  m.msg = reason + '　' + out.text;
}

function onBounce(m) {
  const b = m.ball, half = b.x < 0 ? 0 : 1;
  ev(m, { k: 'bounce', x: b.x, y: b.y });
  if (m.hits === 1 && m.bounces === 0) {
    const rt = 1 - m.servingTeam, ys = sideSign(rt, m.sides[m.server]);
    if (half !== rt) return fault(m, m.servingTeam, '發球未過網', m.server);
    if (Math.abs(b.x) - C.R <= C.K) return fault(m, m.servingTeam, '發球落在廚房區（含廚房線）', m.server);
    if (isOut(b.x, b.y)) return fault(m, m.servingTeam, '發球出界', m.server);
    if (b.y * ys < -C.R) return fault(m, m.servingTeam, '發球未落在對角發球區', m.server);
    m.bounces = 1; m.pred = null; return;
  }
  if (half === m.lastHitTeam) return fault(m, m.lastHitTeam, '球未過網', m.lastHitter);
  if (m.bounces === 0 && isOut(b.x, b.y)) return fault(m, m.lastHitTeam, '出界！', m.lastHitter);
  if (m.smTrack && m.smTrack.touched && half === m.smTrack.team) smResolve(m, 'ret'); // the reply landed in
  m.bounces++; m.pred = null;
  if (m.bounces >= 2) return fault(m, half, '兩次落地（沒接到）', -1);
}

function canReach(m, p) {
  const b = m.ball;
  if (!m.live || m.lastHitTeam === p.team) return false;
  if ((b.x < 0 ? 0 : 1) !== p.team) return false;
  if (b.z < 0.06 || b.z > 2.4) return false;
  const f = m.smFate, lunge = p.ctrl === 'ai' && f && f.rally === m.rally && f.team === p.team && f.f !== 'miss' ? SM_LUNGE : 1; // v7: a CPU that reads the smash lunges for it
  const reach = C.REACH * lunge * (b.z > 1.7 ? 0.8 : 1) * (p.ctrl === 'ai' ? 1 : (HUMAN_REACH[m.diff] || 1));
  return Math.hypot(b.x - p.x, b.y - p.y) <= reach;
}
// returns null if legal, else a fault reason
function illegal(m, p) {
  const volley = m.bounces === 0;
  if (m.mode === 2 && m.hits === 1 && p.i !== m.receiver) return '接發球員錯誤（應由對角球員接發球）';
  if (volley && m.hits < 3) return m.hits === 1 ? '兩跳規則：發球須落地後才能回擊' : '兩跳規則：回發球須落地後才能擊球';
  if (volley && inKitchen(p)) return '廚房區內截擊（非截擊區犯規）';
  return null;
}
function doHit(m, p, shot, aimY, aiTarget) {
  const bad = illegal(m, p);
  if (m.smTrack) { if (p.team !== m.smTrack.team) m.smTrack.touched = 1; else if (m.smTrack.touched) smResolve(m, 'ret'); }
  p.swing = 1; p.swingShot = shot;
  if (bad) { ev(m, { k: 'hit', p: p.i, shot }); return fault(m, p.team, bad, p.i); }
  if (m.bounces === 0) p.volleyT = m.t;
  const kind = makeShot(m, p, shot, aimY, aiTarget);
  m.hits++; m.rally++; m.bounces = 0; m.lastHitTeam = p.team; m.lastHitter = p.i; m.pred = null;
  if (shot === 'smash' && kind === 'smash') m.smTrack = { team: p.team, p: p.i, touched: 0 };
  ev(m, { k: 'hit', p: p.i, shot: kind, volley: p.volleyT === m.t, low: p.lowSmash ? 1 : 0, ds: shot === 'smash' && kind === 'smash' ? 1 : 0, pop: p.popUp ? 1 : 0 });
}
function doServe(m, shot, aimY) {
  const p = m.players[m.server], r = m.r, rt = 1 - m.servingTeam, human = p.ctrl !== 'ai';
  const ys = sideSign(rt, m.sides[p.i]), xs = teamSign(rt);
  const D = DIFF[m.diff], sig = human ? HUMAN.sig : D.sig * 0.75;
  let depth = 5.3, T, clr = 0.15;
  if (shot === 'lob') { depth = 5.8; T = 1.55; clr = 0.7; } else if (shot === 'dink') { depth = 3.3; clr = 0.25; }
  let ty = ys * 1.5 + (human && Math.abs(aimY) > 0.2 ? clamp(aimY, -1, 1) * 1.1 : (r() - 0.5) * 1.2);
  let tx = xs * depth + gauss(r) * sig * 0.6; ty += gauss(r) * sig * 0.7;
  const from = { x: p.x + p.face * 0.35, y: p.y + 0.2, z: 0.55 };
  if (!T) T = Math.hypot(tx - from.x, ty - from.y) / (shot === 'dink' ? 7 : 10.5);
  let v = launch(from, tx, ty, T, clr);
  if (r() < (human ? HUMAN.err : D.err) * 0.6) v.vz *= 0.6;
  Object.assign(m.ball, from, v);
  m.phase = 'rally'; m.phaseT = 0; m.live = true; m.hits = 1; m.rally = 1; m.bounces = 0; m.lastHitTeam = p.team; m.lastHitter = p.i; m.pred = null;
  p.swing = 1; p.swingShot = 'serve';
  ev(m, { k: 'serve', p: p.i, shot });
}

// ---- movement ----
function clampPlayer(m, p) {
  const xs = teamSign(p.team);
  let ax = Math.abs(p.x);
  ax = clamp(ax, 0.3, C.HL + 2.6);
  if (m.phase === 'serve' && p.i === m.server) {
    ax = Math.max(ax, C.HL + 0.12);
    const ss = sideSign(p.team, m.sides[p.i]);
    p.y = ss * clamp(p.y * ss, 0.15, C.HW - 0.1);
  }
  p.x = xs * ax; p.y = clamp(p.y, -C.HW - 1.8, C.HW + 1.8);
}
function movePlayer(m, p, mx, my, speed, dt) {
  const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
  const k = 1 - Math.exp(-dt * 14);
  p.vx += (mx * speed - p.vx) * k; p.vy += (my * speed - p.vy) * k;
  p.x += p.vx * dt; p.y += p.vy * dt;
  clampPlayer(m, p);
  if (p.swing > 0) p.swing = Math.max(0, p.swing - dt * 3.2);
}

// ---- AI ----
function aiResponsible(m, p, pt) {
  if (m.mode === 1) return true;
  const mate = partner(m, p);
  if (m.hits === 1) return p.i === m.receiver;
  const lane = (q) => (q.y < (q === p ? mate.y : p.y) ? -1 : 1);
  const want = pt.y < (p.y + mate.y) / 2 ? -1 : 1;
  // middle balls: whoever is closer in time (forehand-ish tie break)
  const dp = Math.hypot(pt.x - p.x, pt.y - p.y), dm = Math.hypot(pt.x - mate.x, pt.y - mate.y);
  if (Math.abs(pt.y - (p.y + mate.y) / 2) < 0.5) return dp <= dm;
  return lane(p) === want;
}
function aiThink(m, p, dt) {
  const D = DIFF[m.diff], a = p.ai, b = m.ball, xs = teamSign(p.team), o = 1 - p.team;
  let tx, ty;
  if (m.phase === 'serve') {
    const f = formation(m)[p.i]; tx = f.x; ty = f.y;
    if (p.i === m.server && m.phaseT > a.serveAt && !m.practice) { const k = m.r(); doServe(m, k < 0.82 ? 'drive' : k < 0.92 ? 'lob' : 'dink', 0); return; }
  } else {
    // ready position
    const atNet = p.team === m.servingTeam ? m.hits >= 3 || (m.hits >= 2 && m.lastHitTeam === p.team) : m.hits >= 2;
    const netX = C.K + 0.3 + (1 - D.skill) * 0.6;
    tx = xs * (atNet ? netX : C.HL - 0.25);
    if (m.mode === 1) ty = clamp(b.y * 0.5, -1.6, 1.6);
    else { const mate = partner(m, p); const lo = p.y < mate.y || (p.y === mate.y && p.i < mate.i); ty = (lo ? -1.45 : 1.45) + clamp(b.y * 0.3, -0.8, 0.8); }
    if (m.live && m.lastHitTeam === o) {
      if (!m.pred) m.pred = predict(m);
      if (a.ver !== m.rally) { a.ver = m.rally; a.react = m.t + D.react * (0.7 + m.r() * 0.6) * (m.smFate && m.smFate.rally === m.rally && m.smFate.f !== 'miss' ? 0.3 : 1); a.leave = -1; // reads a smash early unless beaten by it
        const fb = m.pred.firstBounce; if (fb && m.bounces === 0 && isOut(fb.x, fb.y) && (fb.x < 0 ? 0 : 1) === p.team && m.r() < D.skill) a.leave = m.rally; }
      if (m.t < a.react) { tx = a.tx; ty = a.ty; }
      else {
        let best = null, last = null;
        for (const q of m.pred) {
          if ((q.x < 0 ? 0 : 1) !== p.team || q.b >= 2) continue;
          const bounced = q.b > 0;
          const ok = bounced ? (q.z >= 0.12 && q.z <= 1.6) : (q.z >= 0.25 && q.z <= 1.9 && canVolley2(m, q));
          if (!ok) continue;
          last = q;
          const need = Math.max(0, Math.hypot(q.x - p.x, q.y - p.y) - C.REACH * 0.55) / D.speed;
          if (need <= q.t) { best = q; break; }
        }
        const q = best || last;
        if (q && a.leave !== m.rally && aiResponsible(m, p, q)) { tx = q.x + xs * 0.25; ty = q.y - 0.3 * Math.sign(q.y || 1) * 0; a.resp = true; }
        else a.resp = false;
        if (a.leave === m.rally) { // get out of the way of an out ball
          const fb = m.pred.firstBounce; if (fb) { const dy = p.y - fb.y; if (Math.abs(dy) < 1.3) ty = p.y + Math.sign(dy || 1) * 1.4; }
        }
      }
    }
  }
  a.tx = tx; a.ty = ty;
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  const sp = d < 0.05 ? 0 : Math.min(1, d / 0.6);
  movePlayer(m, p, d > 0 ? dx / d * sp : 0, d > 0 ? dy / d * sp : 0, D.speed, dt);
  // keep out of the kitchen while the ball is in the air unless chasing a bounced ball
  if (m.phase === 'rally' && !(a.resp && m.pred && m.pred.firstBounce && Math.abs(m.pred.firstBounce.x) < C.K + 0.4) && m.bounces === 0 && Math.abs(p.x) < C.K + 0.05) p.x = xs * (C.K + 0.05);
}
// volley is legal for the NEXT hit once the serve and the return have each bounced, i.e. hits>=3? No: hits counts strokes so far.
// stroke #1 serve (receiver must let it bounce), stroke #2 return (server team must let it bounce) -> stroke #3 onward may be volleyed.
// so the next stroke index is hits+1; volley legal iff hits+1 >= 3 iff hits >= 2... but the 3rd stroke itself must be hit after a bounce,
// hence volley legal iff hits >= 3.
function canVolley2(m, q) { return m.hits >= 3 && Math.abs(q.x) >= C.K + 0.3; }

function aiShot(m, p) {
  const D = DIFF[m.diff], r = m.r, b = m.ball, opp = teamPlayers(m, 1 - p.team);
  const idx = m.hits + 1;
  const oppNet = opp.reduce((s, q) => s + Math.abs(q.x), 0) / opp.length < 3.6;
  let shot;
  if (idx === 2) shot = r() < 0.1 ? 'lob' : 'drive';
  else if (idx === 3) shot = r() < D.drop ? 'dink' : r() < 0.08 ? 'lob' : 'drive';
  else if (b.z >= SMASH_Z + 0.15 && Math.abs(p.x) < 5.4 && r() < D.smash * (b.z > 1.4 ? 1.4 : 1)) shot = 'smash'; // v7: CPU actively smashes high balls (more often on harder levels)
  else if (b.z > 1.4 && Math.abs(p.x) < 5) shot = 'drive';
  else if (oppNet && Math.abs(p.x) < 3.3 && b.z > 0.95 && r() < D.skill) shot = 'drive'; // attack a high dink
  else if (oppNet && Math.abs(p.x) < 3.3) { const k = r(); shot = k < 0.68 ? 'dink' : k < 0.9 ? 'drive' : 'lob'; }
  else if (oppNet) { const k = r(); shot = k < D.drop ? 'dink' : k < 0.92 ? 'drive' : 'lob'; }
  else shot = r() < 0.78 ? 'drive' : 'dink';
  // aim away from opponents
  let by = 0, bs = -1;
  for (const y of [-2.3, -1.2, 0, 1.2, 2.3]) { const s = Math.min(...opp.map((q) => Math.abs(q.y - y))) + r() * 0.8; if (s > bs) { bs = s; by = y; } }
  if (shot === 'dink') by = clamp(-p.y * 0.6 + (r() - 0.5), -2.2, 2.2);
  if (m.practice) return { shot: 'lob', target: { feed: true } };
  return { shot, target: { y: by } };
}

// ---- main step ----
// 殺球練習 (v8): each rep starts mid-rally (both bounces already played, so volleys are legal) with the CPU lifting a high ball
// into the player's smash zone; from there the normal rules decide the point. The CPU keeps answering with feeds.
function practiceFeed(m) {
  const fp = teamPlayers(m, 1)[0], r = m.r; if (!fp) return;
  m.phase = 'rally'; m.phaseT = 0; m.live = true; m.hits = 4; m.rally = 4; m.bounces = 0; m.lastHitTeam = fp.team; m.lastHitter = fp.i; m.pred = null;
  const from = { x: fp.x - 0.3, y: fp.y, z: 0.8 }, tx = -(3.6 + r() * 1.8), ty = (r() - 0.5) * 3.2;
  const v = launch(from, tx, ty, 1.3 + r() * 0.3, 0.6); Object.assign(m.ball, from, v);
  fp.swing = 1; fp.swingShot = 'lob'; ev(m, { k: 'hit', p: fp.i, shot: 'lob', feed: 1 });
}
function step(m, dt) {
  const n = Math.max(1, Math.round(dt / C.DT)); const h = dt / n;
  for (let i = 0; i < n; i++) sub(m, h);
}
function sub(m, dt) {
  m.t += dt; m.phaseT += dt;
  if (m.phase === 'over') return;
  for (const p of m.players) {
    if (p.ctrl === 'ai') aiThink(m, p, dt);
    else if (p.ctrl === 'local' || p.ctrl === 'bot') movePlayer(m, p, p.in.mx, p.in.my, C.SPEED, dt);
    else { clampPlayer(m, p); if (p.swing > 0) p.swing = Math.max(0, p.swing - dt * 3.2); } // remote: position comes from network
  }
  if (m.phase === 'serve' && m.practice) { holdBall(m); if (m.phaseT > 0.8) practiceFeed(m); return; }
  if (m.phase === 'serve') {
    const s = m.players[m.server];
    holdBall(m);
    if (s.ctrl !== 'ai') {
      const pressed = s.in.shotT > m.t - 0.4 && m.phaseT > 0.5 && s.in.shotT > m.t - m.phaseT + 0.45;
      if (pressed || m.phaseT > m.autoServe) doServe(m, s.in.shotT > m.t - 0.4 ? s.in.shot : 'drive', s.in.aimOn ? s.in.aim : 0);
    }
    return;
  }
  const b = m.ball;
  const px = b.x, pz = b.z;
  b.vz -= C.G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  // net
  if ((px < 0) !== (b.x < 0) && Math.abs(b.y) <= C.NET_HALF) {
    const f = px / (px - b.x), zc = pz + (b.z - pz) * f;
    if (zc < netH(b.y)) {
      b.x = px < 0 ? -0.05 : 0.05; b.vx *= -0.12; b.vy *= 0.3; b.vz = Math.min(b.vz, 0) * 0.3; b.z = Math.max(zc, C.R);
      ev(m, { k: 'net' });
      if (m.phase === 'rally' && m.live) fault(m, m.lastHitTeam, m.hits === 1 ? '發球掛網' : '掛網', m.lastHitter);
    }
  }
  if (b.z <= C.R && b.vz < 0) {
    b.z = C.R; b.vz = -b.vz * C.BOUNCE; b.vx *= C.FRIC; b.vy *= C.FRIC;
    if (Math.abs(b.vz) < 0.4) b.vz = 0;
    if (m.phase === 'rally' && m.live) onBounce(m); else if (Math.abs(b.vz) > 0.8) ev(m, { k: 'bounce', x: b.x, y: b.y, dead: 1 });
  }
  if (m.phase === 'rally' && m.live) {
    // stepping into the kitchen right after a volley (momentum)
    for (const p of m.players) if (m.t - p.volleyT < 0.45 && inKitchen(p)) { fault(m, p.team, '截擊後踏入廚房區', p.i); break; }
  }
  if (m.phase === 'rally' && m.live) {
    for (const p of m.players) {
      if (!canReach(m, p)) continue;
      if (p.ctrl === 'ai') {
        if (p.ai.leave === m.rally) continue;
        if (m.smFate && m.smFate.f === 'miss' && m.smFate.rally === m.rally && m.smFate.team === p.team) continue; // beaten by the smash: lunges but can't get a racket on it
        if (m.mode === 2 && m.hits === 1 && p.i !== m.receiver) continue;
        if (illegal(m, p)) continue;
        const s = aiShot(m, p); doHit(m, p, s.shot, 0, s.target); break;
      } else {
        const bad = illegal(m, p);
        const pressed = p.in.shotT > m.t - 0.35;
        if (bad && !pressed) continue; // auto-swing only for legal hits; a deliberate press commits the stroke
        doHit(m, p, p.in.shotT > m.t - 0.7 ? p.in.shot : 'drive', p.in.aimOn ? p.in.aim : 0); break;
      }
    }
    // safety: ball far away & slow
    // (v7 fix: a ball that already bounced in and is running away — e.g. a fast smash past a beaten receiver — is the receiver's miss, not the hitter's out)
    if (m.live && Math.abs(b.x) > 16) { if (m.bounces >= 1) fault(m, b.x < 0 ? 0 : 1, '兩次落地（沒接到）', -1); else fault(m, m.lastHitTeam, '出界！', m.lastHitter); }
  }
  if (m.phase === 'dead') {
    if (b.z <= C.R + 0.001) { b.vx *= 0.96; b.vy *= 0.96; }
    if (m.phaseT > 1.9) { if (m.winner >= 0) { m.phase = 'over'; ev(m, { k: 'over', team: m.winner }); } else setupPoint(m); }
  }
}

const API = { C, DIFF, SMASH_Z, HUMAN_REACH, TEAM_NAME, createMatch, step, setupPoint, callText, movePlayer, clampPlayer, teamSign, sideSign, netH, inKitchen, isOut, predict, formation };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PB = API;
})(typeof self !== 'undefined' ? self : this);
