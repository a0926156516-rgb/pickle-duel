/* 匹克球對決 — renderer, input, audio, UI and online rooms (WebSocket relay shared with 攀岩 peak2d). */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const { C } = PB;
const QS = new URLSearchParams(location.search);
const SEAT_COL = ['#2b7bff', '#ff4d5a', '#22c3e6', '#ff9b3d'];
const TEAM_COL = ['#2b7bff', '#ff4d5a'];
const TEAM_GRAD = ['linear-gradient(90deg,#1f5fd6,#2b7bff)', 'linear-gradient(90deg,#ff4d5a,#d6303e)'];
const TEAM_NAME = PB.TEAM_NAME;
const SHOT_NAME = { drive: '抽球', dink: '吊小球', lob: '高吊', smash: '殺球', serve: '發球' };
const DIFF_NAME = { easy: '簡單', normal: '普通', hard: '困難' };

// ---------- state ----------
let state = 'menu';        // menu | room | play | end
let role = 'local';        // local | host | client
let m = null;              // match (authoritative for local/host, a mirrored view for clients)
let mySeat = 0, R = 1, paused = false;
let opt = { diff: 'normal', target: 11, mode: 2 };
try { Object.assign(opt, JSON.parse(localStorage.pbOpt || '{}')); } catch (_) {}
const AUTO = QS.get('auto') === '1';   // autopilot for testing / demo
let lastFrame = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0;

// ---------- canvas & projection ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, F = 1, CX = 0, HZ = 0, layer = null, layerR = 0;
const D0 = 10.5, HC = 8.5, XC = 2.6;
function proj(x, y, z) { const X = R * x, Y = R * y, s = F / (Y + D0); return [CX + (X - XC) * s, HZ + (HC - z) * s, s]; }
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const X of [-8.4, 8.4]) for (const Y of [-4.4, 4.6]) for (const z of [0, 2.2]) {
    const sx = (X - XC) / (Y + D0), sy = (HC - z) / (Y + D0);
    minx = Math.min(minx, sx); maxx = Math.max(maxx, sx); miny = Math.min(miny, sy); maxy = Math.max(maxy, sy);
  }
  const top = 58, bot = 6;
  F = Math.min((W - 10) / (maxx - minx), (H - top - bot) / (maxy - miny));
  CX = W / 2 - F * (minx + maxx) / 2;
  HZ = top + (H - top - bot - F * (maxy - miny)) / 2 - F * miny;
  layer = null;
  const portrait = H > W * 1.05 && matchMedia('(pointer:coarse)').matches;
  $('rot').classList.toggle('hide', !portrait || rotDismissed);
}
let rotDismissed = false;
addEventListener('resize', resize);
$('bRotOk').onclick = () => { rotDismissed = true; resize(); };

function quad(c, pts, fill) { c.beginPath(); pts.forEach((p, i) => { const q = proj(p[0], p[1], p[2] || 0); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.closePath(); c.fillStyle = fill; c.fill(); }
function lineQ(c, x1, y1, x2, y2, w, col) { // ground line as quad
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy), nx = -dy / l * w / 2, ny = dx / l * w / 2;
  quad(c, [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], col);
}
function buildLayer() {
  const L = document.createElement('canvas'); L.width = cv.width; L.height = cv.height;
  const c = L.getContext('2d'); c.setTransform(DPR, 0, 0, DPR, 0, 0);
  // sky / arena
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1730'); g.addColorStop(0.5, '#1a2c55'); g.addColorStop(1, '#0d1b33');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) { const x = W * (i + 0.5) / 6, rg = c.createRadialGradient(x, 8, 0, x, 8, W * 0.18); rg.addColorStop(0, 'rgba(255,250,220,.35)'); rg.addColorStop(1, 'rgba(255,250,220,0)'); c.fillStyle = rg; c.fillRect(0, 0, W, H * 0.5); }
  // back wall + crowd
  const wy = 7.2;
  quad(c, [[-40, wy, 0], [40, wy, 0], [40, wy, 4.2], [-40, wy, 4.2]].map((p) => [R * p[0], R * p[1], p[2]]), '#16234a');
  const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const crowd = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f8f9fa', '#ff9f1c', '#c77dff'];
  for (let row = 0; row < 5; row++) for (let k = -38; k < 38; k += 0.55) {
    const z = 1.5 + row * 0.55, q = proj(R * (k + rnd() * 0.3), R * wy, z), s = q[2];
    c.fillStyle = crowd[(rnd() * crowd.length) | 0]; c.globalAlpha = 0.55 + rnd() * 0.3;
    c.beginPath(); c.arc(q[0], q[1], s * 0.17, 0, 7); c.fill();
    c.fillRect(q[0] - s * 0.17, q[1] + s * 0.12, s * 0.34, s * 0.3);
  }
  c.globalAlpha = 1;
  // ad board
  quad(c, [[-40, wy - 0.05, 0], [40, wy - 0.05, 0], [40, wy - 0.05, 1.0], [-40, wy - 0.05, 1.0]].map((p) => [R * p[0], R * p[1], p[2]]), '#0e7c5a');
  c.fillStyle = 'rgba(255,255,255,.9)'; c.textAlign = 'center';
  for (const k of [-9, 0, 9]) { const q = proj(R * k, R * wy, 0.32); c.font = `900 ${Math.max(9, q[2] * 0.55)}px sans-serif`; c.fillText('PICKLE DUEL  匹克球對決', q[0], q[1]); }
  // floor
  quad(c, [[-40, -8.5], [40, -8.5], [40, wy], [-40, wy]].map((p) => [R * p[0], R * p[1]]), '#2a8a5e');
  const fg = c.createLinearGradient(0, proj(0, R * wy, 0)[1], 0, H); fg.addColorStop(0, 'rgba(0,0,0,.25)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = fg; c.fillRect(0, proj(0, R * wy, 0)[1], W, H);
  // run-off and court
  quad(c, [[-9.1, -5.0], [9.1, -5.0], [9.1, 5.0], [-9.1, 5.0]], '#2f7d4f');
  quad(c, [[-C.HL, -C.HW], [C.HL, -C.HW], [C.HL, C.HW], [-C.HL, C.HW]], '#2563b6');
  quad(c, [[-C.K, -C.HW], [C.K, -C.HW], [C.K, C.HW], [-C.K, C.HW]], '#3d86d8');
  c.font = `800 ${F * 0.03}px sans-serif`;
  const lw = 0.07, white = '#f4f7fb';
  for (const sx of [-1, 1]) {
    lineQ(c, sx * (C.HL - lw / 2), -C.HW, sx * (C.HL - lw / 2), C.HW, lw, white);
    lineQ(c, sx * (C.K - lw / 2), -C.HW, sx * (C.K - lw / 2), C.HW, lw, white);
    lineQ(c, sx * C.K, 0, sx * C.HL, 0, lw, white);
    lineQ(c, sx * (C.HL - 0.02), 0, sx * (C.HL + 0.0), 0, 0.3, white);
    // kitchen label
    const q = proj(sx * C.K / 2, 0, 0);
    c.save(); c.globalAlpha = 0.28; c.fillStyle = '#fff'; c.font = `900 ${q[2] * 0.42}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('廚房', q[0], q[1]); c.restore();
  }
  for (const sy of [-1, 1]) lineQ(c, -C.HL, sy * (C.HW - lw / 2), C.HL, sy * (C.HW - lw / 2), lw, white);
  layer = L; layerR = R;
}

// ---------- drawing ----------
const fx = []; // effects
const trail = [];
function drawNet(c) {
  const N = 28, top = [], bot = [];
  for (let i = 0; i <= N; i++) { const y = -C.NET_HALF + (2 * C.NET_HALF * i) / N; top.push(proj(0, y, PB.netH(Math.min(Math.abs(y), C.HW) * Math.sign(y)))); bot.push(proj(0, y, 0.04)); }
  c.beginPath(); top.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); for (let i = N; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]); c.closePath();
  c.fillStyle = 'rgba(15,20,30,.38)'; c.fill();
  c.strokeStyle = 'rgba(230,235,245,.28)'; c.lineWidth = 1;
  c.beginPath(); for (let i = 0; i <= N; i++) { c.moveTo(top[i][0], top[i][1]); c.lineTo(bot[i][0], bot[i][1]); }
  for (let k = 1; k < 6; k++) { for (let i = 0; i <= N; i++) { const x = bot[i][0] + (top[i][0] - bot[i][0]) * k / 6, y = bot[i][1] + (top[i][1] - bot[i][1]) * k / 6; i ? c.lineTo(x, y) : c.moveTo(x, y); } }
  c.stroke();
  c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, top[N >> 1][2] * 0.07); c.beginPath(); top.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
  for (const y of [-C.NET_HALF, C.NET_HALF]) { const a = proj(0, y, 0), b = proj(0, y, C.NET_S + 0.05); c.strokeStyle = '#222'; c.lineWidth = Math.max(3, a[2] * 0.09); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawPlayer(c, p, me) {
  const pos = p.rp || p; const q = proj(pos.x, pos.y, 0), s = q[2], x = q[0], y = q[1];
  const col = SEAT_COL[p.i], face = R * (p.team === 0 ? 1 : -1);
  const spd = Math.hypot(p.vx || 0, p.vy || 0); p.walk = (p.walk || 0) + spd * 0.12;
  const leg = Math.sin(p.walk) * Math.min(1, spd / 3) * 0.22;
  // shadow
  c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x, y, s * 0.38, s * 0.12, 0, 0, 7); c.fill();
  if (me) { c.strokeStyle = '#ffe14d'; c.lineWidth = Math.max(2, s * 0.04); c.beginPath(); c.ellipse(x, y, s * 0.5, s * 0.17, 0, 0, 7); c.stroke(); }
  const Y = (z) => y - z * s;
  // legs
  c.strokeStyle = '#2a2f3a'; c.lineCap = 'round'; c.lineWidth = s * 0.11;
  c.beginPath(); c.moveTo(x - s * 0.08, Y(0.85)); c.lineTo(x - s * 0.1 + leg * s, Y(0.04)); c.moveTo(x + s * 0.08, Y(0.85)); c.lineTo(x + s * 0.1 - leg * s, Y(0.04)); c.stroke();
  c.fillStyle = '#fff'; for (const k of [-1, 1]) { c.beginPath(); c.ellipse(x + k * (s * 0.1) + (k < 0 ? leg : -leg) * s + face * s * 0.04, Y(0.03), s * 0.09, s * 0.045, 0, 0, 7); c.fill(); }
  // shorts + shirt
  c.fillStyle = '#1d2433'; rr(c, x - s * 0.2, Y(1.0), s * 0.4, s * 0.22, s * 0.05); c.fill();
  c.fillStyle = col; rr(c, x - s * 0.22, Y(1.5), s * 0.44, s * 0.55, s * 0.12); c.fill();
  c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x - s * 0.22, Y(1.22), s * 0.44, s * 0.05);
  // head
  c.fillStyle = '#f1c79b'; c.beginPath(); c.arc(x, Y(1.66), s * 0.13, 0, 7); c.fill();
  c.fillStyle = col; c.beginPath(); c.arc(x, Y(1.7), s * 0.135, Math.PI, 0); c.fill();
  c.fillRect(x + (face > 0 ? 0 : -s * 0.22), Y(1.72), s * 0.22, s * 0.04);
  // arm + paddle
  const sw = p.swing || 0, shot = p.swingShot;
  let ang; // radians, 0 = pointing forward
  if (sw > 0) { const t = 1 - sw; ang = shot === 'smash' ? (-2.2 + t * 3.2) : shot === 'serve' ? (1.3 - t * 2.4) : (-1.4 + t * 2.4); }
  else ang = 0.35 + Math.sin(performance.now() / 400 + p.i) * 0.05;
  const sh = [x + face * s * 0.16, Y(1.4)], L = s * 0.5;
  const hx = sh[0] + face * Math.cos(ang) * L * 0.55, hy = sh[1] + Math.sin(ang) * L * 0.55 + s * 0.12;
  c.strokeStyle = '#f1c79b'; c.lineWidth = s * 0.08; c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(hx, hy); c.stroke();
  const px = hx + face * Math.cos(ang) * s * 0.22, py = hy + Math.sin(ang) * s * 0.22;
  c.strokeStyle = '#333'; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(hx, hy); c.lineTo(px, py); c.stroke();
  c.save(); c.translate(px + face * Math.cos(ang) * s * 0.1, py + Math.sin(ang) * s * 0.1); c.rotate(face > 0 ? ang : Math.PI - ang);
  c.fillStyle = p.team === 0 ? '#ffd23f' : '#9bff6a'; c.strokeStyle = '#1a1a1a'; c.lineWidth = Math.max(1, s * 0.02);
  c.beginPath(); c.ellipse(0, 0, s * 0.16, s * 0.12, 0, 0, 7); c.fill(); c.stroke(); c.restore();
  // label
  const nm = (me ? '▼ ' : '') + p.name;
  c.font = `800 ${Math.max(10, Math.min(15, s * 0.2))}px sans-serif`; c.textAlign = 'center';
  const tw = c.measureText(nm).width + 10, ly = Y(2.05);
  c.fillStyle = me ? 'rgba(255,225,77,.92)' : 'rgba(0,0,0,.55)'; rr(c, x - tw / 2, ly - 14, tw, 18, 8); c.fill();
  c.fillStyle = me ? '#13213f' : '#fff'; c.fillText(nm, x, ly);
  if (m && m.phase === 'serve' && m.server === p.i) { c.fillStyle = '#ffe14d'; c.font = `900 ${Math.max(10, s * 0.18)}px sans-serif`; c.fillText('發球', x, ly - 18); }
}
function drawBall(c, b) {
  const q = proj(b.x, b.y, b.z), g = proj(b.x, b.y, 0), s = q[2];
  const r = Math.max(3.2, s * C.R * 2.2);
  for (let i = 0; i < trail.length; i++) { const t = trail[i], tq = proj(t.x, t.y, t.z); c.fillStyle = `rgba(240,250,120,${(i / trail.length) * 0.35})`; c.beginPath(); c.arc(tq[0], tq[1], r * (0.4 + 0.6 * i / trail.length), 0, 7); c.fill(); }
  const gr = c.createRadialGradient(q[0] - r * 0.35, q[1] - r * 0.35, r * 0.1, q[0], q[1], r);
  gr.addColorStop(0, '#fcffb0'); gr.addColorStop(0.7, '#e3ee2c'); gr.addColorStop(1, '#a5b012');
  c.fillStyle = gr; c.beginPath(); c.arc(q[0], q[1], r, 0, 7); c.fill();
  c.fillStyle = 'rgba(120,130,10,.6)'; for (const [dx, dy] of [[-0.35, -0.1], [0.25, -0.35], [0.15, 0.35]]) { c.beginPath(); c.arc(q[0] + dx * r, q[1] + dy * r, r * 0.16, 0, 7); c.fill(); }
  void g;
}
function drawShadow(c, b) {
  const g = proj(b.x, b.y, 0), s = g[2], a = Math.max(0.12, 0.5 - b.z * 0.08);
  c.fillStyle = `rgba(0,0,0,${a})`; c.beginPath(); c.ellipse(g[0], g[1], Math.max(3, s * 0.07), Math.max(1.5, s * 0.025), 0, 0, 7); c.fill();
}
function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!layer || layerR !== R) buildLayer();
  ctx.drawImage(layer, 0, 0, W, H);
  if (!m) { // menu backdrop: idle ball
    const t = performance.now() / 1000; const b = { x: Math.sin(t * 0.9) * 5, y: Math.cos(t * 0.5) * 2, z: 0.3 + Math.abs(Math.sin(t * 2.6)) * 2 };
    drawShadow(ctx, b); drawNet(ctx); drawBall(ctx, b); return;
  }
  // kitchen warning tint
  const me = m.players[mySeat];
  if (me && state === 'play' && PB.inKitchen(me)) { const sx = PB.teamSign(me.team); ctx.globalAlpha = 0.22 + 0.1 * Math.sin(performance.now() / 120); quad(ctx, [[0, -C.HW], [sx * C.K, -C.HW], [sx * C.K, C.HW], [0, C.HW]], '#ff3b3b'); ctx.globalAlpha = 1; }
  // effects on ground
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.t += dt; if (e.t > e.d) { fx.splice(i, 1); continue; }
    const q = proj(e.x, e.y, 0), k = e.t / e.d, s = q[2];
    if (e.k === 'ring') { ctx.strokeStyle = e.out ? `rgba(255,70,70,${1 - k})` : `rgba(255,255,255,${0.8 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(q[0], q[1], s * (0.1 + k * 0.4), s * (0.035 + k * 0.14), 0, 0, 7); ctx.stroke();
      if (e.out) { ctx.fillStyle = `rgba(255,70,70,${1 - k})`; ctx.font = `900 ${s * 0.3}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('OUT', q[0], q[1] - s * 0.2); } }
  }
  const b = m.ball, bv = { x: b.x + (ballOff.x || 0), y: b.y + (ballOff.y || 0), z: Math.max(C.R, b.z + (ballOff.z || 0)) };
  drawShadow(ctx, bv);
  const objs = m.players.map((p) => ({ k: 'p', p, x: (p.rp || p).x, y: (p.rp || p).y }));
  objs.push({ k: 'b', x: bv.x, y: bv.y });
  const left = objs.filter((o) => R * o.x < 0).sort((a, c) => R * c.y - R * a.y);
  const right = objs.filter((o) => R * o.x >= 0).sort((a, c) => R * c.y - R * a.y);
  const draw = (o) => (o.k === 'p' ? drawPlayer(ctx, o.p, o.p.i === mySeat && role !== 'spectator') : drawBall(ctx, bv));
  left.forEach(draw); drawNet(ctx); right.forEach(draw);
  if (m.phase === 'rally') { trail.push({ ...bv }); if (trail.length > 9) trail.shift(); } else trail.length = 0;
  if (QS.get('fps') === '1') { ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.fillText(fps.toFixed(0) + ' fps', 8, H - 8); }
}

// ---------- audio ----------
let AC = null, sound = true; try { sound = localStorage.pbSound !== '0'; } catch (_) {}
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } if (AC && AC.state === 'suspended') AC.resume(); }
function tone(f, d, type, vol, f2, delay) {
  if (!AC || !sound) return; const t = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
}
let noiseBuf = null;
function noise(d, vol, fc, delay) {
  if (!AC || !sound) return; const t = AC.currentTime + (delay || 0);
  if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate); const a = noiseBuf.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; }
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = fc; f.Q.value = 1.2;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); s.connect(f).connect(g).connect(AC.destination); s.start(t); s.stop(t + d + 0.02);
}
const SFX = {
  hit: (shot) => { const v = shot === 'dink' ? 0.25 : shot === 'smash' ? 0.6 : 0.45; tone(shot === 'dink' ? 1250 : 950, 0.07, 'triangle', v, 500); noise(0.05, v * 0.8, 2200); },
  bounce: () => { tone(260, 0.08, 'sine', 0.3, 120); noise(0.04, 0.15, 700); },
  net: () => { noise(0.2, 0.35, 350); tone(140, 0.15, 'sine', 0.2, 80); },
  whistle: () => { for (let i = 0; i < 2; i++) tone(2400, 0.16, 'square', 0.05, 2300, i * 0.2); },
  point: () => { tone(660, 0.14, 'sine', 0.25); tone(880, 0.22, 'sine', 0.25, null, 0.12); },
  side: () => { tone(520, 0.14, 'triangle', 0.22); tone(390, 0.22, 'triangle', 0.22, null, 0.12); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, null, i * 0.13)); },
  click: () => tone(700, 0.05, 'sine', 0.15)
};
$('bSound').onclick = () => { sound = !sound; try { localStorage.pbSound = sound ? '1' : '0'; } catch (_) {} $('bSound').textContent = sound ? '🔊' : '🔇'; audio(); };
$('bSound').textContent = sound ? '🔊' : '🔇';

// ---------- messages / HUD ----------
let msgTimer = 0, lastFault = null; const hitCount = {};
function showMsg(a, b, cls, dur) { const e = $('msg'); $('msgA').textContent = a; $('msgB').textContent = b || ''; e.className = cls || 'info'; void e.offsetWidth; e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; clearTimeout(msgTimer); msgTimer = setTimeout(() => e.classList.add('hide'), dur || 1700); }
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hide'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hide'), 2600); }
const teamOf = (i) => i % 2;
function handleEvent(e) {
  if (!m) return;
  switch (e.k) {
    case 'hit': hitCount[e.p] = (hitCount[e.p] || 0) + 1; SFX.hit(e.shot); if (e.p != null && m.players[e.p]) { m.players[e.p].swing = 1; m.players[e.p].swingShot = e.shot; } break;
    case 'serve': SFX.hit('drive'); if (m.players[e.p]) { m.players[e.p].swing = 1; m.players[e.p].swingShot = 'serve'; } break;
    case 'bounce': if (!e.dead) SFX.bounce(); fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, d: 0.9, out: PB.isOut(e.x, e.y) && !e.dead }); break;
    case 'net': SFX.net(); break;
    case 'fault': SFX.whistle(); lastFault = e; break;
    case 'point': case 'sideout': case 'second': {
      const mine = role !== 'spectator' && teamOf(mySeat) === (e.k === 'point' ? e.team : (lastFault ? 1 - lastFault.team : -1));
      (e.k === 'point' ? SFX.point : SFX.side)();
      const who = lastFault && lastFault.who >= 0 && m.players[lastFault.who] ? m.players[lastFault.who].name + ' 失誤・' : '';
      showMsg(lastFault ? lastFault.reason : '', who + e.text, mine ? 'good' : 'bad', 1800);
      lastFault = null; break; }
    case 'call': showMsg(e.text, (e.first ? '開賽！' : '') + '發球：' + (m.players[e.server] ? m.players[e.server].name : ''), 'info', 1300); break;
    case 'win': SFX.win(); break;
    case 'over': endGame(); break;
  }
}
let hudSig = '';
function updHUD() {
  if (!m) return;
  const lt = R === 1 ? 0 : 1, rt = 1 - lt;
  const names = (t) => m.players.filter((p) => p.team === t).map((p) => (p.i === mySeat && role !== 'spectator' ? '★' : '') + p.name).join('<br>');
  const sig = [m.score.join(), m.servingTeam, m.serverNum, m.server, lt, m.players.map((p) => p.name).join()].join('|');
  if (sig !== hudSig) {
    hudSig = sig;
    $('tmL').style.background = TEAM_GRAD[lt]; $('tmR').style.background = TEAM_GRAD[rt];
    $('nmL').innerHTML = names(lt); $('nmR').innerHTML = names(rt);
    $('scL').textContent = m.score[lt]; $('scR').textContent = m.score[rt];
    $('tmL').classList.toggle('serving', m.servingTeam === lt); $('tmR').classList.toggle('serving', m.servingTeam === rt);
    $('call').textContent = PB.callText(m);
    const sp = m.players[m.server];
    $('srv').textContent = `${TEAM_NAME[m.servingTeam]}發球${m.mode === 2 ? '・第' + m.serverNum + '發球員' : ''}・${sp ? sp.name : ''}`;
  }
  // rule tips
  const tip = $('tip'); let t = '', warn = false; const me = m.players[mySeat];
  if (state === 'play' && me && role !== 'spectator') {
    if (m.phase === 'serve' && m.server === mySeat) t = '輪到你發球：按擊球鍵（對角發球）';
    else if (m.phase === 'rally' && m.live && m.lastHitTeam !== me.team) {
      if (m.hits < 3 && m.bounces === 0) t = '⬇ 兩跳規則：這球要先落地再打';
      else if (m.bounces === 0 && PB.inKitchen(me)) { t = '⚠ 你在廚房區，不能截擊！退後或等球落地'; warn = true; }
    }
  }
  tip.textContent = t; tip.classList.toggle('hide', !t); tip.classList.toggle('warn', warn);
}

// ---------- input ----------
const keys = {};
const inp = { jx: 0, jy: 0, shot: 'drive', shotT: -9, seq: 0 };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true; audio();
  const map = { KeyJ: 'drive', Space: 'drive', KeyK: 'dink', KeyL: 'lob', KeyZ: 'drive', KeyX: 'dink', KeyC: 'lob' };
  if (map[e.code] && !e.repeat) { press(map[e.code]); e.preventDefault(); }
  if (e.code === 'Escape' && state === 'play') togglePause();
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function press(shot) {
  inp.shot = shot; inp.shotT = performance.now(); inp.seq++;
  document.querySelectorAll('.tb').forEach((b) => b.classList.toggle('sel', b.dataset.shot === shot));
  if (role === 'client') sendInput(true);
  else if (m && m.players[mySeat]) { const p = m.players[mySeat]; p.in.shot = shot; p.in.shotT = m.t; }
}
// touch: joystick + buttons
const joy = { id: null, ox: 0, oy: 0 };
const jb = $('joyBase'), jk = $('joyKnob'), jz = $('joyZone');
function joyPos(cx, cy) { const dx = cx - joy.ox, dy = cy - joy.oy, l = Math.hypot(dx, dy), max = 52, k = l > max ? max / l : 1; jk.style.transform = `translate(${dx * k}px,${dy * k}px)`; const n = Math.min(1, l / max); inp.jx = l > 6 ? (dx / l) * n : 0; inp.jy = l > 6 ? (-dy / l) * n : 0; }
jz.addEventListener('pointerdown', (e) => { audio(); document.body.classList.add('touchui'); joy.id = e.pointerId; const r = jz.getBoundingClientRect(); joy.ox = e.clientX; joy.oy = e.clientY; jb.style.left = e.clientX - r.left + 'px'; jb.style.top = e.clientY - r.top + 'px'; jb.classList.add('on'); joyPos(e.clientX, e.clientY); try { jz.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
jz.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) joyPos(e.clientX, e.clientY); });
const joyEnd = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; inp.jx = inp.jy = 0; jk.style.transform = ''; jb.classList.remove('on'); };
jz.addEventListener('pointerup', joyEnd); jz.addEventListener('pointercancel', joyEnd);
document.querySelectorAll('.tb').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { audio(); document.body.classList.add('touchui'); b.classList.add('on'); press(b.dataset.shot); e.preventDefault(); });
  const up = () => b.classList.remove('on'); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
});
if (matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touchui');
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

function readMove() {
  let x = inp.jx, y = inp.jy;
  if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y += 1; if (keys.KeyS || keys.ArrowDown) y -= 1;
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  return { mx: R * x, my: R * y }; // screen -> world (view may be rotated 180°)
}
// autopilot (testing / demo): steer toward the predicted hitting spot
let apPred = null, apKey = '', apServeT = 0, apLazy = false;
function autopilot(p) {
  const b = m.ball, xs = PB.teamSign(p.team);
  const mate0 = m.players.find((q) => q.team === p.team && q !== p);
  let tx = xs * (m.hits >= 3 ? C.K + 0.5 : C.HL - 0.3), ty = b.y * 0.4;
  if (mate0) ty = (p.y < mate0.y || (p.y === mate0.y && p.i < mate0.i) ? -1.45 : 1.45) + Math.max(-0.8, Math.min(0.8, b.y * 0.3));
  if (m.phase === 'serve') { const f = PB.formation(m)[p.i]; tx = f.x; ty = f.y; if (m.server === p.i && m.phaseT > 1.1 && apServeT !== m.point) { apServeT = m.point; press('drive'); } }
  else if (m.live && m.lastHitTeam !== p.team) {
    const key = m.rally + ':' + m.bounces; if (key !== apKey || !apPred) { if (!apKey.startsWith(m.rally + ':')) apLazy = Math.random() < 0.12; apKey = key; apPred = PB.predict(m); }
    if (apLazy) return { mx: 0, my: 0 }; // autopilot occasionally misses so points get decided
    let mate = m.players.find((q) => q.team === p.team && q !== p);
    for (const q of apPred) {
      if ((q.x < 0 ? 0 : 1) !== p.team || q.b >= 2) continue;
      if (!(q.b >= 1 ? q.z > 0.15 && q.z < 1.3 : m.hits >= 3 && Math.abs(q.x) > C.K + 0.4 && q.z > 0.3 && q.z < 1.6)) continue;
      if (mate && m.mode === 2 && (m.hits === 1 ? m.receiver !== p.i : Math.hypot(q.x - mate.x, q.y - mate.y) < Math.hypot(q.x - p.x, q.y - p.y) - 0.3)) break;
      tx = q.x + xs * 0.2; ty = q.y; if (Math.hypot(q.x - p.x, q.y - p.y) / C.SPEED <= q.t) break;
    }
  }
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (m.phase === 'rally' && m.bounces === 0 && Math.abs(p.x) < C.K + 0.2 && m.lastHitTeam !== p.team) return { mx: xs, my: 0 };
  return d < 0.08 ? { mx: 0, my: 0 } : { mx: dx / d * Math.min(1, d / 0.5), my: dy / d * Math.min(1, d / 0.5) };
}
function localInput(p) {
  const mv = AUTO ? autopilot(p) : readMove();
  p.in.mx = mv.mx; p.in.my = mv.my; p.in.aim = mv.my; p.in.aimOn = Math.abs(mv.my) > 0.3 && !AUTO;
  return mv;
}

// ---------- game flow ----------
function seatsLocal(mode) {
  const n = mode * 2, s = [];
  for (let i = 0; i < n; i++) s.push(i === 0 ? { name: myName(), ctrl: 'local' } : { name: i % 2 === 0 ? '電腦隊友' : '電腦' + (i === 1 ? '甲' : '乙'), ctrl: 'ai' });
  if (mode === 1) s[1].name = '電腦';
  return s;
}
function myName() { const v = $('nick').value.trim(); return (v || autoNick).slice(0, 8); }
const autoNick = '玩家' + ((Math.random() * 900 + 100) | 0);
function startLocal(mode) {
  role = 'local'; mySeat = 0; R = 1;
  const cfg = { mode, diff: opt.diff, target: opt.target, seats: seatsLocal(mode), firstServe: Math.random() < 0.5 ? 0 : 1 };
  beginMatch(cfg);
}
function beginMatch(cfg) {
  m = PB.createMatch(cfg); hudSig = ''; fx.length = 0; trail.length = 0; paused = false;
  for (const p of m.players) { p.rp = { x: p.x, y: p.y }; }
  state = 'play';
  ['menu', 'room', 'end', 'pause', 'rules'].forEach((i) => $(i).classList.add('hide'));
  ['hud', 'touch', 'keys'].forEach((i) => $(i).classList.remove('hide'));
  if (role !== 'client') { const evs = m.events.splice(0); evs.forEach(handleEvent); if (role === 'host') outbox.push(...evs); }
  updHUD();
}
function endGame() {
  if (!m) return; state = 'end';
  const w = m.winner, s = m.score; const mine = role !== 'spectator' && teamOf(mySeat) === w;
  $('endT').textContent = (mine ? '🏆 你贏了！' : role === 'spectator' ? '🏆 ' : '再接再厲！') + ' ' + TEAM_NAME[w] + '獲勝';
  $('endS').textContent = `${s[0]} : ${s[1]}`;
  const st = m.stats || {}; const rl = st.rallies && st.rallies.length ? (st.rallies.reduce((a, b) => a + b, 0) / st.rallies.length).toFixed(1) : '-';
  $('endSub').textContent = `藍隊 ${s[0]} － 紅隊 ${s[1]}` + (role !== 'client' ? `・平均每回合 ${rl} 拍` : '');
  $('bAgain').classList.toggle('hide', role === 'client' || role === 'spectator');
  $('bMenu').textContent = role === 'local' ? '回主選單' : role === 'host' ? '回到房間' : '離開房間';
  if (role === 'client' || role === 'spectator') $('endSub').textContent += '　等待房主開始下一局…';
  $('end').classList.remove('hide'); $('touch').classList.add('hide');
}
function toMenu(msg) {
  state = 'menu'; m = null; role = 'local'; R = 1; layer = null;
  ['room', 'end', 'pause', 'hud', 'touch', 'keys', 'tip', 'msg'].forEach((i) => $(i).classList.add('hide'));
  $('menu').classList.remove('hide'); st(msg || '');
}
function togglePause() {
  if (state !== 'play') return;
  if ($('pause').classList.contains('hide')) { $('pause').classList.remove('hide'); paused = role === 'local'; $('bResume').textContent = role === 'local' ? '繼續' : '回到比賽'; }
  else { $('pause').classList.add('hide'); paused = false; }
}
$('bPause').onclick = togglePause; $('bResume').onclick = togglePause;
$('bQuit').onclick = () => { paused = false; if (role === 'local') toMenu(); else leaveRoom(); };
$('bAgain').onclick = () => { SFX.click(); if (role === 'local') beginMatch({ ...m.cfg, firstServe: Math.random() < 0.5 ? 0 : 1, seed: 0 }); else if (role === 'host') hostStart(); };
$('bMenu').onclick = () => { SFX.click(); if (role === 'local') toMenu(); else if (role === 'host') hostBackToRoom(); else leaveRoom(); };

// ---------- menu ----------
function seg(id, key, cb) {
  const el = $(id);
  const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', String(opt[key]) === b.dataset.v));
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v; opt[key] = /^\d+$/.test(v) ? +v : v; try { localStorage.pbOpt = JSON.stringify(opt); } catch (_) {} syncAll(); SFX.click(); cb && cb(); });
  return sync;
}
const syncs = [];
const syncAll = () => syncs.forEach((f) => f());
syncs.push(seg('segDiff', 'diff'), seg('segTarget', 'target'), seg('segDiff2', 'diff', () => hostCfg()), seg('segTarget2', 'target', () => hostCfg()), seg('segMode', 'mode', () => hostCfg()));
syncAll();
try { $('nick').value = localStorage.pbNick || ''; } catch (_) {}
$('nick').addEventListener('change', () => { try { localStorage.pbNick = $('nick').value.trim(); } catch (_) {} });
$('bS1').onclick = () => { audio(); SFX.click(); startLocal(1); };
$('bS2').onclick = () => { audio(); SFX.click(); startLocal(2); };
const showRules = () => $('rules').classList.remove('hide');
$('bRules').onclick = showRules; $('bRules2').onclick = showRules; $('bRulesOk').onclick = () => $('rules').classList.add('hide');
$('code').addEventListener('input', () => { $('code').value = $('code').value.replace(/\D/g, '').slice(0, 4); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
if (QS.get('room')) { $('code').value = QS.get('room').replace(/\D/g, '').slice(0, 4); }

// ---------- networking (same WebSocket relay protocol as 攀岩 peak2d: create / join / msg, host-authoritative) ----------
const RELAY_URL = QS.get('server') || 'wss://panjian-peak2d.onrender.com/ws';
const HTTP_URL = RELAY_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/');
try { fetch(HTTP_URL, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (_) {} // wake the free-tier server early
let ws = null, net = false, isHost = false, myId = '', roomCode = '', roster = [], connGen = 0, joinTimer = 0, cfgTimer = 0, lastAction = null;
let room = { mode: opt.mode, diff: opt.diff, target: opt.target };
let outbox = [], sendAcc = 0, inAcc = 0, remoteIn = {}, seatIds = [], lastSnapAt = 0;
const ERR = { notfound: '找不到這個房間，請確認房號', full: '房間已滿（最多 4 人）', nocode: '目前沒有空房號，請稍後再試', bad: '房號格式錯誤' };
const st = (t) => { $('status').textContent = t; $('rstatus').textContent = t; };
const wsend = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const toPeer = (id, d) => wsend({ t: 'msg', to: id, d });
const toAll = (d) => wsend({ t: 'msg', d });
const toHost = (d) => wsend({ t: 'msg', d });
function failNet(msg) { clearTimeout(joinTimer); connGen++; st(msg); $('bRetry').classList.remove('hide'); const w = ws; ws = null; net = false; try { w && w.close(); } catch (_) {} }
$('bRetry').onclick = () => { $('bRetry').classList.add('hide'); lastAction && lastAction(); };
function connect(first, onMsg, dl, gen) {
  try { ws && ws.close(); } catch (_) {}
  if (!dl) {
    dl = Date.now() + 75000; gen = ++connGen; clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (gen === connGen && !net) failNet('無法連上伺服器，請稍後再試'); }, 75000);
    $('bRetry').classList.add('hide'); st('連線伺服器中…');
    setTimeout(() => { if (gen === connGen && !net) st('伺服器喚醒中，約需 30–60 秒…'); }, 2500);
  }
  if (gen !== connGen) return;
  let s; try { s = new WebSocket(RELAY_URL); } catch (e) { failNet('無法連上伺服器'); return; }
  ws = s;
  s.onopen = () => { if (ws === s) wsend(first); };
  s.onmessage = (e) => {
    if (ws !== s) return; let msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.t === 'ping') return wsend({ t: 'pong' });
    if (msg.t === 'roster') { roster = msg.pl; renderSeats(); if (isHost) hostRosterChanged(); return; }
    if (msg.t === 'colorTaken') { toast(`這個座位已被 ${msg.by} 坐走`); return; }
    if (msg.t === 'error') { net = false; failNet(ERR[msg.e] || '錯誤：' + msg.e); if (state === 'room') showMenuOnly(); return; }
    try { onMsg(msg); } catch (err) { console.warn('net handler', err); }
  };
  s.onclose = () => {
    if (ws !== s) return; ws = null; const was = net; net = false;
    if (!was) { if (gen === connGen && Date.now() < dl - 3000) { st('伺服器喚醒中，約需 30–60 秒…'); fetch(HTTP_URL, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); setTimeout(() => connect(first, onMsg, dl, gen), 3000); } else if (gen === connGen) failNet('無法連上伺服器，請稍後再試'); return; }
    toMenu('與伺服器斷線'); toast('與伺服器斷線');
  };
}
function showMenuOnly() { $('room').classList.add('hide'); $('menu').classList.remove('hide'); state = 'menu'; }
function leaveRoom() { connGen++; wsend({ t: 'leave' }); const w = ws; ws = null; net = false; try { w && w.close(); } catch (_) {} isHost = false; toMenu(); }
$('bLeave').onclick = leaveRoom;
function openRoom() {
  state = 'room'; m = null; R = 1; layer = null;
  ['menu', 'end', 'pause', 'hud', 'touch', 'keys', 'tip', 'msg'].forEach((i) => $(i).classList.add('hide'));
  $('room').classList.remove('hide'); $('rcode').textContent = roomCode; st('');
  $('bStart').classList.toggle('hide', !isHost);
  ['segMode', 'segDiff2', 'segTarget2'].forEach((id) => $(id).classList.toggle('dis', !isHost));
  $('roomNote').textContent = isHost ? '點選座位換位置；空位由電腦補上。把房號告訴朋友，最多 4 人。' : '點選座位換位置；等待房主開始比賽…';
  renderSeats();
}
function renderSeats() {
  const n = room.mode * 2; const by = {}; for (const p of roster) by[p.c] = p;
  const seat = (i) => { const p = by[i], on = i < n, me = p && p.id === myId;
    return `<button class="seat${me ? ' me' : ''}${!p ? ' ai' : ''}${on ? '' : ' off'}" data-seat="${i}"><span class="dot" style="background:${SEAT_COL[i]}"></span>${p ? esc(p.n) + (p.h ? ' 👑' : '') + (me ? '（你）' : '') : on ? '🤖 電腦' : '（單打不使用）'}</button>`; };
  $('seats').innerHTML = [0, 1].map((t) => `<div class="team t${t}"><h3>${TEAM_NAME[t]}</h3>${seat(t)}${room.mode === 2 || roster.some((p) => p.c === t + 2) ? seat(t + 2) : ''}</div>`).join('');
  const out = roster.filter((p) => p.c >= n); $('roomNote').textContent = out.length ? `${out.map((p) => p.n).join('、')} 目前在單打不使用的座位，會變成觀戰。` : (isHost ? '點選座位換位置；空位由電腦補上。把房號告訴朋友，最多 4 人。' : '點選座位換位置；等待房主開始比賽…');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('seats').addEventListener('click', (e) => { const b = e.target.closest('.seat'); if (!b) return; const i = +b.dataset.seat; if (roster.some((p) => p.c === i && p.id !== myId)) return toast('這個座位已經有人'); SFX.click(); wsend({ t: 'pickColor', c: i }); });
$('rcode').onclick = $('bCopy').onclick = async () => { const u = location.origin + location.pathname + '?room=' + roomCode; try { await navigator.clipboard.writeText(u); toast('已複製邀請連結'); } catch (_) { prompt('邀請連結', u); } };

// host
function host() {
  audio(); isHost = true; role = 'host'; lastAction = host; roster = []; room = { mode: opt.mode, diff: opt.diff, target: opt.target };
  connect({ t: 'create', name: myName(), g: 'm', c: 0 }, (msg) => {
    if (msg.t === 'created') { clearTimeout(joinTimer); myId = msg.id; roomCode = msg.code; net = true; remoteIn = {}; openRoom(); }
    else if (msg.t === 'peer-join') { /* wait for hello */ }
    else if (msg.t === 'peer-leave') { const i = seatIds.indexOf(msg.id); if (m && i >= 0 && state !== 'room') { const p = m.players[i]; toast(`${p.name} 離線了，由電腦接手`); p.ctrl = 'ai'; p.name = '電腦'; seatIds[i] = null; toAll({ t: 'names', n: m.players.map((q) => q.name) }); } }
    else if (msg.t === 'msg') hostHandle(msg.from, msg.d);
  });
}
function hostCfg() { if (!isHost) return; room = { mode: opt.mode, diff: opt.diff, target: opt.target }; renderSeats(); toAll({ t: 'cfg', room }); }
function hostRosterChanged() { if (state === 'room') toAll({ t: 'cfg', room }); }
function hostHandle(from, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    if (d.game !== 'pickleball') { wsend({ t: 'kick', id: from }); return; }
    toPeer(from, { t: 'cfg', room });
    if (m && (state === 'play' || state === 'end')) { // joined mid-game: take over an AI seat if possible
      const rp = roster.find((p) => p.id === from); let i = rp && rp.c < m.players.length && m.players[rp.c].ctrl === 'ai' ? rp.c : m.players.findIndex((p) => p.ctrl === 'ai' && p.i !== mySeat);
      if (i >= 0) { const p = m.players[i]; p.ctrl = 'remote'; p.name = rp ? rp.n : '玩家'; seatIds[i] = from; toAll({ t: 'names', n: m.players.map((q) => q.name) }); toast(`${p.name} 加入比賽`); }
      toPeer(from, { t: 'start', cfg: netCfg(), seat: i, mid: 1 });
    }
  } else if (d.t === 'in') {
    const i = seatIds.indexOf(from); if (!m || i < 0) return; const p = m.players[i]; if (p.ctrl !== 'remote') return;
    const prev = remoteIn[from] || {}; remoteIn[from] = d;
    p.in.mx = +d.mx || 0; p.in.my = +d.my || 0; p.in.aim = +d.aim || 0; p.in.aimOn = !!d.ao;
    if (prev.s !== undefined && d.s !== prev.s) { p.in.shot = ['drive', 'dink', 'lob'].includes(d.sh) ? d.sh : 'drive'; p.in.shotT = m.t; }
    if (d.pt === m.point && Number.isFinite(d.x) && Number.isFinite(d.y)) { p.vx = (d.x - p.x) * 30; p.vy = (d.y - p.y) * 30; p.x = d.x; p.y = d.y; PB.clampPlayer(m, p); }
  }
}
function netCfg() { return { mode: m.mode, diff: m.diff, target: m.target, seats: m.players.map((p) => ({ name: p.name, ctrl: p.ctrl === 'ai' ? 'ai' : 'h' })) }; }
function hostStart() {
  audio(); const n = room.mode * 2; seatIds = []; const seats = [];
  for (let i = 0; i < n; i++) { const p = roster.find((q) => q.c === i); seatIds[i] = p ? p.id : null; seats.push(p ? { name: p.n, ctrl: p.id === myId ? 'local' : 'remote' } : { name: '電腦' + '甲乙丙丁'[i], ctrl: 'ai' }); }
  const me = seatIds.indexOf(myId); mySeat = me; role = 'host';
  if (me < 0) toast('你坐在單打不使用的座位，本局觀戰（主持）');
  R = me >= 0 && teamOf(me) === 1 ? -1 : 1; layer = null;
  const cfg = { mode: room.mode, diff: room.diff, target: room.target, seats, firstServe: Math.random() < 0.5 ? 0 : 1 };
  remoteIn = {}; outbox = [];
  beginMatch(cfg);
  wsend({ t: 'started' });
  for (const p of roster) if (p.id !== myId) toPeer(p.id, { t: 'start', cfg: netCfg(), seat: seatIds.indexOf(p.id) });
}
function hostBackToRoom() { wsend({ t: 'lobbyBack' }); toAll({ t: 'room' }); m = null; openRoom(); }
const r3 = (v) => Math.round(v * 1000) / 1000, r2 = (v) => Math.round(v * 100) / 100;
function snapshot() {
  const b = m.ball;
  return { t: 's', pt: m.point, ph: m.phase, pT: r2(m.phaseT), mt: r2(m.t), b: [r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz)], P: m.players.map((p) => [r2(p.x), r2(p.y), r2(p.swing), p.swingShot]), sc: m.score, st: m.servingTeam, sn: m.serverNum, sv: m.server, rv: m.receiver, sd: m.sides.join(''), h: m.hits, bo: m.bounces, lh: m.lastHitTeam, lv: m.live ? 1 : 0, w: m.winner, ev: outbox.splice(0) };
}
function hostTick(dt) {
  sendAcc += dt; if (sendAcc < 1 / 30) return; sendAcc = 0;
  if (roster.length > 1) toAll(snapshot()); else outbox.length = 0;
}
// client
function join(code) {
  audio(); code = String(code || '').replace(/\D/g, ''); if (code.length !== 4) { st('請輸入 4 位數房號'); return; }
  isHost = false; role = 'client'; roomCode = code; roster = []; lastAction = () => join(code);
  connect({ t: 'join', code, name: myName(), g: 'm', c: 0 }, (msg) => {
    if (msg.t === 'joined') { clearTimeout(joinTimer); myId = msg.id; net = true; toHost({ t: 'hello', game: 'pickleball', n: myName() }); st(msg.started ? '加入進行中的比賽…' : '');
      clearTimeout(cfgTimer); cfgTimer = setTimeout(() => { if (state === 'menu' && net) { failNet('這個房號不是匹克球房間'); wsend({ t: 'leave' }); } }, 6000);
      if (!msg.started) openRoom(); }
    else if (msg.t === 'host-left') { net = false; toMenu('房主離開了，房間已關閉'); toast('房主離開了，房間已關閉'); try { ws && ws.close(); } catch (_) {} ws = null; }
    else if (msg.t === 'msg') clientHandle(msg.d);
  });
}
function clientHandle(d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'cfg') { clearTimeout(cfgTimer); room = d.room; opt.mode = room.mode; syncAll(); if (state === 'room') renderSeats(); else if (state === 'menu') openRoom(); }
  else if (d.t === 'start') {
    clearTimeout(cfgTimer);
    const seat = d.seat; const cfg = { ...d.cfg, seats: d.cfg.seats.map((s, i) => ({ name: s.name, ctrl: i === seat ? 'local' : 'net' })) };
    role = seat >= 0 ? 'client' : 'spectator'; mySeat = seat >= 0 ? seat : -1;
    R = seat >= 0 && teamOf(seat) === 1 ? -1 : 1; layer = null;
    beginMatch(cfg); m.events.length = 0; if (role === 'spectator') { $('touch').classList.add('hide'); toast('觀戰中'); }
    if (role === 'spectator') role = 'spectator';
  }
  else if (d.t === 's') applySnap(d);
  else if (d.t === 'names') { if (m) d.n.forEach((n, i) => { if (m.players[i]) m.players[i].name = n; }); hudSig = ''; }
  else if (d.t === 'room') { m = null; openRoom(); }
}
const ballOff = { x: 0, y: 0, z: 0 };
function applySnap(d) {
  if (!m) return; lastSnapAt = performance.now();
  const newPoint = d.pt !== m.point;
  m.point = d.pt; m.phase = d.ph; m.phaseT = d.pT; m.t = d.mt; m.score = d.sc; m.servingTeam = d.st; m.serverNum = d.sn; m.server = d.sv; m.receiver = d.rv; m.sides = d.sd.split('');
  m.hits = d.h; m.bounces = d.bo; m.lastHitTeam = d.lh; m.live = !!d.lv; m.winner = d.w;
  const b = m.ball, pb = { x: b.x + ballOff.x, y: b.y + ballOff.y, z: b.z + ballOff.z };
  Object.assign(b, { x: d.b[0], y: d.b[1], z: d.b[2], vx: d.b[3], vy: d.b[4], vz: d.b[5] });
  const jump = Math.hypot(pb.x - b.x, pb.y - b.y, pb.z - b.z);
  if (jump < 1.2 && d.ph === 'rally') { ballOff.x = pb.x - b.x; ballOff.y = pb.y - b.y; ballOff.z = pb.z - b.z; } else ballOff.x = ballOff.y = ballOff.z = 0;
  d.P.forEach((q, i) => { const p = m.players[i]; if (!p) return;
    if (i === mySeat && role === 'client') { if (newPoint || Math.hypot(p.x - q[0], p.y - q[1]) > 2) { p.x = q[0]; p.y = q[1]; p.vx = p.vy = 0; p.rp = { x: p.x, y: p.y }; } return; }
    p.tx = q[0]; p.ty = q[1]; if (newPoint || !p.rp) p.rp = { x: q[0], y: q[1] };
    if (q[2] > p.swing + 0.3) { p.swing = q[2]; p.swingShot = q[3]; } });
  for (const e of d.ev || []) handleEvent(e);
  if (d.ph === 'over' && state === 'play') endGame();
}
function clientTick(dt) {
  // own movement (client-side prediction), others interpolate, ball dead-reckoning
  for (const p of m.players) {
    if (p.i === mySeat && role === 'client') { const mv = localInput(p); PB.movePlayer(m, p, mv.mx, mv.my, C.SPEED, dt); p.rp = { x: p.x, y: p.y }; continue; }
    if (p.tx == null) continue; const k = 1 - Math.exp(-dt * 16);
    const nx = p.rp.x + (p.tx - p.rp.x) * k, ny = p.rp.y + (p.ty - p.rp.y) * k;
    p.vx = (nx - p.rp.x) / dt; p.vy = (ny - p.rp.y) / dt; p.rp = { x: nx, y: ny }; p.x = nx; p.y = ny;
    if (p.swing > 0) p.swing = Math.max(0, p.swing - dt * 3.2);
  }
  if (m.phase !== 'serve' && performance.now() - lastSnapAt < 400) {
    const b = m.ball, h = dt / 4;
    for (let i = 0; i < 4; i++) { const px = b.x; b.vz -= C.G * h; b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      if ((px < 0) !== (b.x < 0) && Math.abs(b.y) < C.NET_HALF && b.z < PB.netH(b.y)) { b.x = px; b.vx *= -0.12; }
      if (b.z <= C.R && b.vz < 0) { b.z = C.R; b.vz = -b.vz * C.BOUNCE; b.vx *= C.FRIC; b.vy *= C.FRIC; } }
  }
  const k = Math.exp(-dt * 10); ballOff.x *= k; ballOff.y *= k; ballOff.z *= k;
  inAcc += dt; if (inAcc >= 1 / 30) { inAcc = 0; sendInput(false); }
}
function sendInput(isPress) {
  if (role !== 'client' || !m || mySeat < 0) return; const p = m.players[mySeat];
  toHost({ t: 'in', x: r2(p.x), y: r2(p.y), mx: r2(p.in.mx), my: r2(p.in.my), aim: r2(p.in.aim), ao: p.in.aimOn ? 1 : 0, s: inp.seq, sh: inp.shot, pt: m.point });
  void isPress;
}
$('bHost').onclick = () => { SFX.click(); host(); };
$('bJoin').onclick = () => { SFX.click(); join($('code').value); };
$('bStart').onclick = () => { SFX.click(); hostStart(); };

// ---------- main loop ----------
function frame(now) {
  let dt = (now - lastFrame) / 1000; lastFrame = now; if (!(dt > 0)) dt = 1 / 60; dt = Math.min(dt, 0.05);
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (m && (state === 'play' || state === 'end')) {
    if (role === 'local' || role === 'host') {
      const me = m.players[mySeat]; if (me && me.ctrl === 'local') localInput(me);
      if (!paused) PB.step(m, dt);
      const k = 1 - Math.exp(-dt * 18);
      for (const p of m.players) { if (p.ctrl === 'remote') { p.rp = p.rp ? { x: p.rp.x + (p.x - p.rp.x) * k, y: p.rp.y + (p.y - p.rp.y) * k } : { x: p.x, y: p.y }; } else p.rp = null; }
      const evs = m.events.splice(0); evs.forEach(handleEvent); if (role === 'host') { outbox.push(...evs); hostTick(dt); }
    } else clientTick(dt);
    updHUD();
  }
  render(dt);
  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);
// test hooks
window.__pb = { get m() { return m; }, get state() { return state; }, get role() { return role; }, get room() { return roomCode; }, get roster() { return roster; }, get net() { return net; }, get fps() { return fps; }, get seat() { return mySeat; }, hitCount, startLocal, press };
})();
