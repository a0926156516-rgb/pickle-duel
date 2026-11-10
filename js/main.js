/* 匹克球對決 — renderer, input, audio, UI and online rooms (WebSocket relay shared with 攀岩 peak2d). */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const { C } = PB;
const QS = new URLSearchParams(location.search);
const COARSE = matchMedia('(pointer:coarse)').matches;
const SEAT_COL = ['#2b7bff', '#ff4d5a', '#22c3e6', '#ff9b3d'];
const TEAM_COL = ['#2b7bff', '#ff4d5a'];
const TEAM_GRAD = ['linear-gradient(90deg,#1f5fd6,#2b7bff)', 'linear-gradient(90deg,#ff4d5a,#d6303e)'];
const TEAM_NAME = PB.TEAM_NAME;
// ---------- characters (遊戲模組部門 sprites: 阿岩 / 小攀, base + mask tinted at runtime) ----------
// *_tb / *_tm: base + enlarged recolour mask (vest, chalk bag, gloves + helmet & shoe accents), built by tools_build_masks.py
const CHARS = [{ k: 'ayan', n: '阿岩', base: 'assets/male_tb.png', mask: 'assets/male_tm.png' }, { k: 'xiaopan', n: '小攀', base: 'assets/female_tb.png', mask: 'assets/female_tm.png' }];
const COLS = ['#e8483b', '#2f8fe0', '#3fb85a', '#f2b630'], COLN = ['紅', '藍', '綠', '黃'];
const COLD = ['#b8302a', '#1f6db5', '#2a8a43', '#c98e18'];
const FW = 72, FH = 127, AX = 36, AY = 123, BODY = 107; // frame size, feet anchor, standing body height in px
const IMG = CHARS.map((c) => { const o = { base: new Image(), mask: new Image(), ok: 0 }; o.base.onload = o.mask.onload = () => { o.ok++; }; o.base.src = c.base; o.mask.src = c.mask; return o; });
const TINT = {};
function sheet(ch, co) {
  const key = ch + '_' + co; if (TINT[key]) return TINT[key]; const im = IMG[ch]; if (!im || im.ok < 2) return null;
  const w = im.base.naturalWidth, h = im.base.naturalHeight; if (!w) return null;
  const t = document.createElement('canvas'); t.width = w; t.height = h; const g = t.getContext('2d');
  g.drawImage(im.base, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = COLS[co]; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'destination-in'; g.drawImage(im.mask, 0, 0);
  const o = document.createElement('canvas'); o.width = w; o.height = h; const q = o.getContext('2d'); q.drawImage(im.base, 0, 0); q.drawImage(t, 0, 0);
  return (TINT[key] = o);
}
const teamGrad = (co) => `linear-gradient(90deg,${COLD[co]},${COLS[co]})`;
// colour/character assignment: humans keep their pick when free, CPU fillers take the remaining colours and the other character
function assignLooks(seats) {
  const used = new Set(), L = [];
  seats.forEach((s, i) => { if (s && s.ctrl !== 'ai' && s.co != null) { let c = +s.co; if (!(c >= 0 && c < 4) || used.has(c)) c = [0, 1, 2, 3].find((k) => !used.has(k)); used.add(c); L[i] = { ch: s.ch === 1 ? 1 : 0, co: c }; } });
  seats.forEach((s, i) => { if (L[i]) return; const c = [0, 1, 2, 3].find((k) => !used.has(k)); used.add(c); const ref = L[i ^ 2] || L[i ^ 1] || L[0]; L[i] = { ch: ref ? 1 - ref.ch : i % 2, co: c }; });
  return L;
}
const teamNamesOf = (L) => [COLN[L[0].co] + '隊', COLN[L[1].co] + '隊'];
const myLook = () => ({ ch: opt.ch === 1 ? 1 : 0, co: opt.co >= 0 && opt.co < 4 ? opt.co : 1 });
const SHOT_NAME = { drive: '抽球', dink: '吊小球', lob: '高吊', smash: '殺球', serve: '發球' };
const DIFF_NAME = { easy: '簡單', normal: '普通', hard: '困難' };

// ---------- state ----------
let state = 'menu';        // menu | room | play | end
let role = 'local';        // local | host | client
let m = null;              // match (authoritative for local/host, a mirrored view for clients)
let mySeat = 0, R = 1, paused = false;
let opt = { diff: 'normal', target: 11, mode: 2, ch: 0, co: 1, orient: 'port' };
try { Object.assign(opt, JSON.parse(localStorage.pbOpt || '{}')); if (localStorage.pbOrient) opt.orient = localStorage.pbOrient; } catch (_) {}
if (QS.get('orient') === 'land' || QS.get('orient') === 'port') opt.orient = QS.get('orient');
// 橫向 on a phone held upright (rotation lock / in-app webview): the whole page is rotated 90° with CSS and played sideways.
// App coordinates (W×H, landscape) <-> physical coordinates (portrait): phys = (PW - ay, ax), app = (py, PW - px).
let FORCED = false, PW = 0, PH = 0;
const appXY = (cx, cy) => (FORCED ? [cy, PW - cx] : [cx, cy]);
function appRect(el) { const r = el.getBoundingClientRect(); if (!FORCED) return r; const [x1, y1] = appXY(r.left, r.top), [x2, y2] = appXY(r.right, r.bottom); const l = Math.min(x1, x2), t = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1); return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t }; }
const AUTO = QS.get('auto') === '1' || QS.get('auto') === 'move', AUTO_MOVE = QS.get('auto') === 'move'; // autopilot for testing / demo ('move': it only moves, a test presses)
let lastFrame = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0;

// ---------- canvas & projection ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, F = 1, CX = 0, CY = 0, layer = null, layerR = 0, layerKey = '';
// Two cameras, picked by the screen shape:
//  PORT (phone upright, the primary layout): court laid out vertically, net horizontal across the middle, own team at the bottom,
//        camera behind the own baseline.  view u (screen right) = -R*y, view v (depth) = R*x  (a proper rotation, so each
//        player's right service court is on their right as they face the net).
//  landscape: court horizontal (teams left/right, net vertical), pitched view from the near sideline: u = R*x, v = R*y.
let PORT = true, TH = 1.08, CD = 17, CT = Math.cos(TH), SN = Math.sin(TH); const KZ = 0.8;
// portrait: elevated camera close behind the near baseline -> strong perspective (near court wide, far court narrow)
function setCam(port) { PORT = port; TH = port ? (H < 780 ? 0.86 : 0.92) : 1.08; CD = port ? 12 : 17; CT = Math.cos(TH); SN = Math.sin(TH); }
let PAN = 0, PM = 0; // horizontal camera pan (px) and the layer's pan margin
function g2(X, Y) { const dy = Y + CD * CT, dz = -CD * SN; const depth = Math.max(0.6, dy * CT - dz * SN), up = dy * SN + dz * CT; return [X / depth, up / depth, 1 / depth]; } // depth clamp: points behind the camera never flip
// view-frame projection (u across the screen, v into the screen); used for the arena backdrop
function pv(u, v, z) { const g = g2(u, v), s = F * g[2]; return [CX + PAN + F * g[0], CY - F * g[1] - (z || 0) * s * KZ, s]; }
const toView = (x, y) => (PORT ? [-R * y, R * x] : [R * x, R * y]);
function proj(x, y, z) { const v = toView(x, y); return pv(v[0], v[1], z); }
const depthOf = (x, y) => (PORT ? R * x : R * y);
let touchUI = false;
function safeRect() {
  const land = W >= H, tu = (touchUI || COARSE) && state === 'play';
  if (PORT) { // controls live below the court
    const top = H < 700 ? 106 : 114, bottom = tu ? (H < 780 ? 186 : 214) : 8; // v6: four bigger shot buttons
    return { l: 6, r: W - 6, t: top, b: H - bottom };
  }
  const left = tu ? Math.min(118, W * 0.15) : 8, right = tu ? Math.min(166, W * 0.24) : 8; // right: zig-zag column of 4 shot buttons
  const top = H < 430 ? 46 : 62; void land;
  return { l: left, r: W - right, t: top, b: H - 6 };
}
function resize() {
  setTimeout(() => { if (m && m.practice) updPrac(); }, 80);
  DPR = Math.min(3, window.devicePixelRatio || 1);
  const vv = window.visualViewport;
  PW = Math.max(1, Math.round(vv && vv.width ? Math.min(innerWidth, vv.width) : innerWidth) || 1);
  PH = Math.max(1, Math.round(vv && vv.height ? Math.min(innerHeight, vv.height) : innerHeight) || 1);
  FORCED = opt.orient === 'land' && PH > PW; // a phone that is really sideways just uses the normal landscape layout
  W = FORCED ? PH : PW; H = FORCED ? PW : PH;
  { const ds = document.documentElement.style; ds.setProperty('--aw', W + 'px'); ds.setProperty('--ah', H + 'px'); ds.setProperty('--pw', PW + 'px'); ds.setProperty('--vvt', Math.round(vv && vv.offsetTop || 0) + 'px'); document.body.classList.toggle('forced', FORCED); }
  cv.width = Math.max(1, Math.round(W * DPR)); cv.height = Math.max(1, Math.round(H * DPR));
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  document.documentElement.style.setProperty('--vh', H + 'px');
  try { if (joy.id == null) joyHome(); } catch (_) { /* not created yet during the first resize */ }
  setCam(H >= W * 0.9);
  document.body.classList.toggle('pshort', H >= W * 0.9 && H < 780);
  // fit the court (and players standing on it) into the area not covered by HUD / touch controls
  const S = safeRect(); let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  const pts = [];
  if (PORT) { for (const U of [-C.HW - 0.25, C.HW + 0.25]) for (const V of [-C.K - 0.6, C.HL + 0.25]) pts.push([U, V, 0]); pts.push([0, -C.HL - 0.5, 0]); for (const U of [-C.HW, C.HW]) pts.push([U, C.HL, 2.0]); pts.push([0, C.HL + 0.6, 3.0]); } // far players' heads + name tags stay below the HUD
  else { const bx = touchUI || W < 960 ? 0.4 : 1.3; for (const X of [-C.HL - bx, C.HL + bx]) for (const Y of [-C.HW - 0.5, C.HW + 0.3]) pts.push([X, Y, 0]); /* v10: on big screens a little room behind each baseline; phones keep the big court (the camera slides instead) */ for (const X of [-C.HL, C.HL]) pts.push([X, C.HW + 0.4, 2.1]); }
  for (const [X, Y, z] of pts) { const g = g2(X, Y); const sx = g[0], sy = g[1] + z * g[2] * KZ; minx = Math.min(minx, sx); maxx = Math.max(maxx, sx); miny = Math.min(miny, sy); maxy = Math.max(maxy, sy); }
  const aw = Math.max(40, S.r - S.l), ah = Math.max(40, S.b - S.t);
  F = Math.min(aw / (maxx - minx), ah / (maxy - miny)); if (!(F > 1)) F = Math.max(1, F || 1);
  CX = (S.l + S.r) / 2 - F * (minx + maxx) / 2;
  CY = (S.t + S.b) / 2 + F * (miny + maxy) / 2;
  { const ds = document.documentElement.style, sp = PAN; PAN = 0; // screen rows of the net and both kitchens: prompts go where players are not
    ds.setProperty('--nety', Math.round(pv(0, 0, 0)[1]) + 'px'); ds.setProperty('--nk', Math.round(pv(0, -C.K * 0.55, 0)[1]) + 'px'); ds.setProperty('--fk', Math.round(pv(0, C.K * 0.5, 0)[1]) + 'px');
    const bl = pv(0, -C.HL - 0.35, 0)[1], lo = Math.min(S.b + (H - S.b > 60 ? 4 : 0), H - 30); ds.setProperty('--tipy', Math.round(Math.max(bl + 14, Math.min((bl + lo) / 2, lo - 12))) + 'px'); PAN = sp; } // hints: below my baseline, out of the ball's flight band
  layer = null; requestAnimationFrame(measureHud);
  document.body.classList.toggle('land', W >= H); document.body.classList.toggle('port', W < H);
}
let rzT = 0; const rzSoon = () => { resize(); clearTimeout(rzT); rzT = setTimeout(resize, 250); };
addEventListener('resize', rzSoon); addEventListener('orientationchange', rzSoon);
if (window.visualViewport) visualViewport.addEventListener('resize', rzSoon);
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setTouch(true); }, true);
addEventListener('touchstart', () => setTouch(true), { capture: true, passive: true });
addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) { if (performance.now() - lastTouchAt > 800) setTouch(false); } }, true);
let lastTouchAt = 0;
function setTouch(on) { if (!on && COARSE) return; // phones/tablets keep the touch controls (and the court size) even after a key press
 if (on) lastTouchAt = performance.now(); if (touchUI === on) return; touchUI = on; document.body.classList.toggle('touchui', on); resize(); }

function quadV(c, pts, fill) { c.beginPath(); pts.forEach((p, i) => { const q = pv(p[0], p[1], p[2] || 0); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.closePath(); c.fillStyle = fill; c.fill(); }
function quad(c, pts, fill) { c.beginPath(); pts.forEach((p, i) => { const q = proj(p[0], p[1], p[2] || 0); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.closePath(); c.fillStyle = fill; c.fill(); }
function lineQ(c, x1, y1, x2, y2, w, col) { // ground line as quad
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy), nx = -dy / l * w / 2, ny = dx / l * w / 2;
  quad(c, [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], col);
}
function buildLayer() {
  // neon arena: dark stadium, purple haze lights, crowd silhouettes, our own banner, mottled purple-grey floor with glowing veins
  PM = PORT ? Math.round(W * 0.35) : Math.round(W * 0.18); const savePan = PAN; PAN = 0;
  const LW = W + 2 * PM, L = document.createElement('canvas'); L.width = Math.round(LW * DPR); L.height = cv.height;
  const c = L.getContext('2d'); c.setTransform(DPR, 0, 0, DPR, PM * DPR, 0);
  const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const x0 = -PM, x1 = W + PM;
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#07051a'); g.addColorStop(0.45, '#151036'); g.addColorStop(1, '#0b0a1c');
  c.fillStyle = g; c.fillRect(x0, 0, LW, H);
  const wy = PORT ? C.HL + 2.4 : 7.6, ny = PORT ? -CD * CT + 0.5 : -14; // floor must stay in front of the camera
  const wallTop = pv(0, wy, 6.5)[1], wallBot = pv(0, wy, 0)[1];
  // stands + crowd silhouettes
  c.fillStyle = '#0c0a22'; c.fillRect(x0, 0, LW, wallBot);
  for (let row = 0; row < 7; row++) for (let k = -30; k < 30; k += 0.42) {
    const q = pv(k + rnd() * 0.25, wy + 0.4 + row * 0.5, 1.6 + row * 0.62), s = q[2];
    c.fillStyle = `rgba(${40 + rnd() * 50 | 0},${30 + rnd() * 30 | 0},${80 + rnd() * 70 | 0},${0.55 + rnd() * 0.35})`;
    c.beginPath(); c.arc(q[0], q[1], Math.max(0, s * 0.13), 0, 7); c.fill(); c.fillRect(q[0] - s * 0.15, q[1] + s * 0.1, Math.max(0, s * 0.3), Math.max(0, s * 0.32));
  }
  // haze lights + beams
  for (let i = 0; i < 7; i++) { const x = x0 + LW * (i + 0.5) / 7, y = wallTop + (wallBot - wallTop) * 0.15;
    const rg = c.createRadialGradient(x, y, 0, x, y, W * 0.32); rg.addColorStop(0, 'rgba(170,120,255,.45)'); rg.addColorStop(0.4, 'rgba(110,70,230,.16)'); rg.addColorStop(1, 'rgba(60,30,160,0)'); c.fillStyle = rg; c.fillRect(x - W * 0.32, y - W * 0.32, W * 0.64, W * 0.64);
    const bg = c.createLinearGradient(x, y, x, wallBot); bg.addColorStop(0, 'rgba(190,160,255,.35)'); bg.addColorStop(1, 'rgba(190,160,255,0)'); c.fillStyle = bg; c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.lineTo(x + 26, wallBot); c.lineTo(x - 26, wallBot); c.closePath(); c.fill(); }
  // back wall + banner board with our own branding
  const BZ = 0.25, BT = 1.1;
  quadV(c, [[-40, wy, 0], [40, wy, 0], [40, wy, 1.25], [-40, wy, 1.25]], '#120e2c');
  if (false) { quadV(c, [[-4.4, wy - 0.02, BZ], [4.4, wy - 0.02, BZ], [4.4, wy - 0.02, BT], [-4.4, wy - 0.02, BT]], '#241a5a');
  const q = pv(0, wy - 0.03, (BZ + BT) / 2 - 0.05); c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `900 ${Math.max(9, q[2] * (PORT ? 0.42 : 0.62))}px sans-serif`; c.shadowColor = '#b48cff'; c.shadowBlur = 12; c.fillStyle = '#f3ecff'; c.fillText('匹克球對決 PICKLE DUEL', q[0], q[1]); c.restore();
    const a = pv(-4.4, wy - 0.03, BT), b = pv(4.4, wy - 0.03, BT); c.strokeStyle = 'rgba(180,140,255,.9)'; c.lineWidth = 2; c.shadowColor = '#a070ff'; c.shadowBlur = 10; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.shadowBlur = 0; } // portrait: the brand lives in the HUD (#brand) so it never sits behind the far players
  // floor: one dark mottled purple-grey surface (court and run-off alike, like a night arena)
  c.fillStyle = '#3a3550'; c.fillRect(x0, pv(0, ny, 0)[1], LW, H); quadV(c, [[-40, ny], [40, ny], [40, wy], [-40, wy]], '#3a3550');
  c.save(); c.beginPath(); { const pts = [[-40, ny], [40, ny], [40, wy], [-40, wy]].map((p) => pv(p[0], p[1], 0)); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); } c.closePath(); c.clip();
  for (let i = 0; i < 520; i++) { const u = (rnd() - 0.5) * 24, v = ny + rnd() * (wy - ny), q = pv(u, v, 0), r = q[2] * (0.25 + rnd() * 0.9);
    c.fillStyle = rnd() < 0.5 ? `rgba(120,108,160,${0.12 + rnd() * 0.16})` : `rgba(12,10,26,${0.14 + rnd() * 0.2})`; c.beginPath(); c.ellipse(q[0], q[1], Math.max(0, r), Math.max(0, r * SN * 0.5), 0, 0, 7); c.fill(); }
  // glowing purple veins (random lightning polylines on the ground)
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (let k = 0; k < 12; k++) { let u = (rnd() - 0.5) * 18, v = -C.HL - 2 + rnd() * (2 * C.HL + 4), a = rnd() * 7; const pts = [];
    for (let n = 0; n < 9; n++) { pts.push(pv(u, v, 0)); a += (rnd() - 0.5) * 1.6; const st = 0.35 + rnd() * 0.5; u += Math.cos(a) * st; v += Math.sin(a) * st * 1.4; }
    for (const [w, col, bl] of [[6, 'rgba(140,90,255,.30)', 16], [1.6, 'rgba(205,180,255,.62)', 8]]) { c.strokeStyle = col; c.lineWidth = w; c.shadowColor = '#8a5cff'; c.shadowBlur = bl; c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke(); } }
  c.shadowBlur = 0; c.restore();
  quad(c, [[-C.HL, -C.HW], [C.HL, -C.HW], [C.HL, C.HW], [-C.HL, C.HW]], 'rgba(52,47,72,.62)'); // veins/texture fainter inside the court so the ball reads
  // court: kitchen tinted, thin bright white lines
  quad(c, [[-C.K, -C.HW], [C.K, -C.HW], [C.K, C.HW], [-C.K, C.HW]], 'rgba(150,110,255,.16)');
  const lw = 0.055, white = '#ffffff';
  c.save(); c.shadowColor = 'rgba(255,255,255,.55)'; c.shadowBlur = 4;
  for (const sx of [-1, 1]) {
    lineQ(c, sx * (C.HL - lw / 2), -C.HW, sx * (C.HL - lw / 2), C.HW, lw, white);
    lineQ(c, sx * (C.K - lw / 2), -C.HW, sx * (C.K - lw / 2), C.HW, lw * 1.5, '#e6dcff');
    lineQ(c, sx * C.K, 0, sx * C.HL, 0, lw, white);
  }
  for (const sy of [-1, 1]) lineQ(c, -C.HL, sy * (C.HW - lw / 2), C.HL, sy * (C.HW - lw / 2), lw, white);
  c.restore();
  for (const sx of [-1, 1]) { const q = proj(sx * C.K / 2, 0, 0); c.save(); c.globalAlpha = 0.33; c.fillStyle = '#d9c8ff'; c.font = `900 ${Math.max(9, q[2] * 0.4)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('廚房', q[0], q[1]); c.restore(); }
  // near vignette
  const vg = c.createLinearGradient(0, H * 0.75, 0, H); vg.addColorStop(0, 'rgba(5,4,14,0)'); vg.addColorStop(1, 'rgba(5,4,14,.55)'); c.fillStyle = vg; c.fillRect(x0, H * 0.75, LW, H * 0.25);
  PAN = savePan;
  layer = L; layerR = R; layerKey = (PORT ? 'P' : 'L') + W + 'x' + H;
}
// ---------- drawing ----------
const fx = []; // effects
const trail = [];
function drawNet(c) {
  const N = 24, top = [], bot = [], sk = PORT ? 0 : 0.22; // sk: draw the net's height slightly to the right so it reads as a band, not an edge-on line
  for (let i = 0; i <= N; i++) { const y = -C.NET_HALF + (2 * C.NET_HALF * i) / N, h = PB.netH(Math.min(Math.abs(y), C.HW) * Math.sign(y)); const g = proj(0, y, 0), t = proj(0, y, h); bot.push(g); top.push([t[0] + h * g[2] * sk, t[1], g[2]]); }
  // shadow on the floor
  const shx = PORT ? 0 : 0.35, shy = PORT ? 0.22 : 0; c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); bot.forEach((q, i) => (i ? c.lineTo(q[0] + q[2] * shx, q[1] + q[2] * shy) : c.moveTo(q[0] + q[2] * shx, q[1] + q[2] * shy))); for (let i = N; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]); c.closePath(); c.fill();
  c.beginPath(); top.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); for (let i = N; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]); c.closePath();
  c.fillStyle = 'rgba(4,4,10,.62)'; c.fill();
  c.strokeStyle = 'rgba(160,160,190,.28)'; c.lineWidth = 1; c.beginPath();
  for (let i = 0; i <= N; i++) { c.moveTo(top[i][0], top[i][1]); c.lineTo(bot[i][0], bot[i][1]); }
  for (let k = 1; k < 5; k++) { for (let i = 0; i <= N; i++) { const x = bot[i][0] + (top[i][0] - bot[i][0]) * k / 5, y = bot[i][1] + (top[i][1] - bot[i][1]) * k / 5; i ? c.lineTo(x, y) : c.moveTo(x, y); } }
  c.stroke();
  c.strokeStyle = '#fff'; c.lineWidth = Math.max(3, top[N >> 1][2] * 0.11); c.lineCap = 'butt'; c.beginPath(); top.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
  for (const i of [0, N]) { const a = bot[i], b = top[i]; c.strokeStyle = '#222'; c.lineWidth = Math.max(3, a[2] * 0.08); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1] - a[2] * 0.06); c.stroke(); }
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
const teamCo = (t) => { if (!m) return t; const q = m.players.find((pp) => pp.team === t); return q && q.co != null ? q.co : t; };
let hudBlock = [], tagRects = [], lastTags = [], fpsY = 0; // screen rects of the scoreboard + brand (name tags are kept below them)
function measureHud() { hudBlock = []; for (const id of ['board', 'brand']) { const e = $(id); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') continue; const r = appRect(e); if (r.width && r.height) hudBlock.push({ l: r.left - 4, r: r.right + 4, b: r.bottom }); } }
function drawPlayer(c, p, me) {
  const PM_ = PORT || H < 430 ? 1.32 : 1, minS = PORT ? (H * 0.066) / (1.72 * KZ * PM_) : 0; // far-court players never shrink below ~6.6% of the screen height
  const pos = p.rp || p; const q = proj(pos.x, pos.y, 0), s = Math.max(q[2], minS), x = q[0], y = q[1];
  const tcol = COLS[teamCo(p.team)]; // team identity: foot ring + name tag in the team colour (outfit/paddle = the player's own colour)
  const co = p.co != null ? p.co : p.i % 4, col = COLS[co], face = PORT ? ((m ? proj(m.ball.x, m.ball.y, 0)[0] : W / 2) >= x ? 1 : -1) : (proj(0, pos.y, 0)[0] >= x ? 1 : -1); // face the net (landscape) / the ball (portrait)
  const spd = Math.hypot(p.vx || 0, p.vy || 0); const now = performance.now() / 1000;
  p.walk = (p.walk || 0) + spd * 0.045;
  // shadow + "me" ring
  c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x, y, Math.max(0, s * 0.36), Math.max(0, s * 0.12), 0, 0, 7); c.fill();
  c.strokeStyle = tcol; c.globalAlpha = 0.95; c.lineWidth = Math.max(2.5, s * 0.06); c.stroke(); c.globalAlpha = 1;
  if (me) { const hot = AID.now, pu = hot ? 0.5 + 0.5 * Math.sin(performance.now() / 55) : 0; c.strokeStyle = hot ? `rgba(255,${80 + 120 * pu | 0},220,1)` : '#ffe14d'; c.lineWidth = Math.max(2, s * (hot ? 0.07 : 0.04)); c.beginPath(); c.ellipse(x, y, Math.max(0, s * (hot ? 0.56 + 0.06 * pu : 0.5)), Math.max(0, s * (hot ? 0.19 + 0.02 * pu : 0.17)), 0, 0, 7); c.stroke(); // v9: the ring pulses magenta at the smash moment
    if (hot && m && m.practice) { c.font = `900 ${Math.max(20, s * 0.42) | 0}px system-ui,sans-serif`; const lf = x > W / 2, tx = x + (lf ? -1 : 1) * s * 0.62, ty = y - s * 0.75; c.textAlign = lf ? 'right' : 'left'; c.lineWidth = 5; c.strokeStyle = 'rgba(90,0,70,.95)'; c.shadowColor = 'rgba(255,80,220,.95)'; c.shadowBlur = 14; c.strokeText('現在！', tx, ty); c.shadowBlur = 0; c.fillStyle = '#fff36b'; c.fillText('現在！', tx, ty); } } // beside the player, clear of the name tag above
  const k = (s * 1.72 * KZ * PM_) / BODY; // sprite px -> screen px (arcade scale-up on phones)
  const sw = p.swing || 0, shot = p.swingShot, t = 1 - sw, ph = sw > 0 ? Math.sin(Math.PI * t) : 0;
  const idle = spd < 0.5 && sw <= 0, bob = idle ? Math.sin(now * 7 + p.i) * 0.015 : 0;
  const sqx = 1 + ph * 0.07 + (idle ? 0.03 : 0), sqy = 1 - ph * 0.1 - (idle ? 0.05 : 0) + bob; // squash on contact, crouched ready stance
  const lunge = ph * 14 * k; // step into the shot
  const sh = sheet(p.ch || 0, co);
  let row = 0, fr = Math.floor(now * 6 + p.i) % 4;
  if (spd > 0.5) { row = 1; fr = Math.floor(p.walk) % 6; }
  c.save(); c.translate(x + face * lunge, y); c.rotate(face * ph * 0.12); c.scale(face * sqx, sqy);
  // paddle arm behind the body when it's swung back
  const ang = sw > 0 ? (shot === 'smash' ? -2.3 + t * 3.4 : shot === 'serve' ? 1.5 - t * 2.3 : shot === 'lob' ? 1.2 - t * 2.6 : -1.5 + t * 2.5) : 0.75 + Math.sin(now * 2.5 + p.i) * 0.05;
  const shx = 1 * k, shy = -71 * k, L = 30 * k;
  const drawArm = () => {
    const hx = shx + Math.cos(ang) * L, hy = shy + Math.sin(ang) * L;
    if (sw > 0) { c.strokeStyle = '#f1c79b'; c.lineCap = 'round'; c.lineWidth = Math.max(1, 6 * k); c.beginPath(); c.moveTo(shx, shy); c.lineTo(hx, hy); c.stroke(); c.fillStyle = col; c.beginPath(); c.arc(hx, hy, Math.max(0, 4.5 * k), 0, 7); c.fill(); }
    const px = hx + Math.cos(ang) * 10 * k, py = hy + Math.sin(ang) * 10 * k;
    c.strokeStyle = '#2b2b2b'; c.lineWidth = Math.max(1, 3.4 * k); c.beginPath(); c.moveTo(hx, hy); c.lineTo(px, py); c.stroke();
    c.save(); c.translate(px + Math.cos(ang) * 9 * k, py + Math.sin(ang) * 9 * k); c.rotate(ang);
    c.fillStyle = '#1d2433'; c.strokeStyle = col; c.lineWidth = Math.max(1, 2.4 * k); c.beginPath(); c.ellipse(0, 0, Math.max(0, 11 * k), Math.max(0, 8.5 * k), 0, 0, 7); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.ellipse(-2 * k, -2 * k, Math.max(0, 5 * k), Math.max(0, 3 * k), 0, 0, 7); c.fill(); c.restore();
  };
  const back = sw > 0 && Math.cos(ang) < -0.2;
  if (back) drawArm();
  if (sh) c.drawImage(sh, fr * FW, row * FH, FW, FH, -AX * k, -AY * k, FW * k, FH * k);
  else { c.fillStyle = col; c.fillRect(-10 * k, -100 * k, 20 * k, 60 * k); c.beginPath(); c.arc(0, -110 * k, Math.max(0, 12 * k), 0, 7); c.fill(); }
  if (!back) drawArm();
  c.restore();
  // label
  const nm = (me ? '▼ ' : '') + p.name;
  c.font = `800 ${Math.max(10, Math.min(14, s * 0.2))}px sans-serif`; c.textAlign = 'center';
  const tw = c.measureText(nm).width + 10; let ly = y - BODY * k * 1.06 - 4;
  const srvTag = m && m.phase === 'serve' && m.server === p.i;
  for (const r of hudBlock) if (x + tw / 2 > r.l && x - tw / 2 < r.r && ly - 13 - (srvTag ? 16 : 0) < r.b + 3) ly = r.b + 3 + 13 + (srvTag ? 16 : 0); // never under the scoreboard / brand
  tagRects.push({ i: p.i, l: x - tw / 2, t: ly - 13 - (srvTag ? 16 : 0), r: x + tw / 2, b: ly + 4 });
  c.fillStyle = me ? 'rgba(255,225,77,.95)' : tcol; c.globalAlpha = me ? 1 : 0.88; rr(c, x - tw / 2, ly - 13, tw, 17, 8); c.fill(); c.globalAlpha = 1;
  c.strokeStyle = tcol; c.lineWidth = 2; c.stroke();
  c.fillStyle = me ? '#13213f' : '#fff'; c.save(); if (!me) { c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 2; } c.fillText(nm, x, ly); c.restore();
  if (m && m.phase === 'serve' && m.server === p.i) { c.fillStyle = '#ffe14d'; c.font = `900 ${Math.max(10, s * 0.18)}px sans-serif`; c.fillText('發球', x, ly - 16); }
}
let lastBallR = 0;
function drawBall(c, b) {
  const q = proj(b.x, b.y, b.z), s = q[2];
  const BS = (PORT || H < 430 ? 1.5 : 1) * (Math.min(W, H) <= 375 ? 1.12 : 1), r = Math.max(BS > 1 ? 4.4 : 3.4, s * C.R * 2.4) * BS; // phones: bigger ball (and never a speck at the far end); a bit more on ≤375px
  lastBallR = r;
  if (trail.length > 1) { // glowing ribbon
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.shadowColor = '#ffe94a'; c.shadowBlur = 12;
    for (let i = 1; i < trail.length; i++) { const a = proj(trail[i - 1].x, trail[i - 1].y, trail[i - 1].z), bq = proj(trail[i].x, trail[i].y, trail[i].z), k = i / trail.length;
      c.strokeStyle = `rgba(255,236,80,${0.55 * k})`; c.lineWidth = Math.max(1, r * 1.5 * k); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(bq[0], bq[1]); c.stroke(); }
    const lq = proj(trail[trail.length - 1].x, trail[trail.length - 1].y, trail[trail.length - 1].z); c.strokeStyle = 'rgba(255,240,90,.6)'; c.lineWidth = r * 1.5; c.beginPath(); c.moveTo(lq[0], lq[1]); c.lineTo(q[0], q[1]); c.stroke(); c.restore();
  }
  c.save(); c.shadowColor = '#fff36a'; c.shadowBlur = 14;
  const gr = c.createRadialGradient(q[0] - r * 0.35, q[1] - r * 0.35, r * 0.1, q[0], q[1], r);
  gr.addColorStop(0, '#ffffd0'); gr.addColorStop(0.6, '#f4f53a'); gr.addColorStop(1, '#c9cf14');
  c.fillStyle = gr; c.beginPath(); c.arc(q[0], q[1], r, 0, 7); c.fill(); c.restore();
  { const lw = Math.max(1.4, r * 0.2); c.strokeStyle = 'rgba(20,12,30,.95)'; c.lineWidth = lw; c.beginPath(); c.arc(q[0], q[1], r + lw * 0.5, 0, 7); c.stroke(); } // thin dark outline outside the yellow (no glow over it)
  c.fillStyle = 'rgba(140,150,10,.55)'; for (const [dx, dy] of [[-0.35, -0.1], [0.25, -0.35], [0.15, 0.35]]) { c.beginPath(); c.arc(q[0] + dx * r, q[1] + dy * r, r * 0.16, 0, 7); c.fill(); }
}
function drawShadow(c, b) {
  const g = proj(b.x, b.y, 0), s = g[2], a = Math.max(0.3, 0.75 - b.z * 0.1), BS = PORT || H < 430 ? 1.5 : 1;
  c.fillStyle = `rgba(0,0,0,${a})`; c.beginPath(); c.ellipse(g[0], g[1], Math.max(4, s * 0.08 * BS), Math.max(2, s * 0.03 * BS), 0, 0, 7); c.fill();
}
function render(dt) {
  let sx = 0, sy = 0;
  if (juice.shake > 0) { juice.shake = Math.max(0, juice.shake - (dt || 0.016)); const a = juice.amp * Math.min(1, juice.shake / 0.2); juice.k = (juice.k || 0) + 1; sx = Math.sin(juice.k * 2.3) * a; sy = Math.cos(juice.k * 3.1) * a; } else juice.k = 0;
  juice.ox = sx; juice.oy = sy;
  if (!m) juice.shake = juice.flash = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); if (sx || sy) { ctx.clearRect(0, 0, W, H); ctx.setTransform(DPR, 0, 0, DPR, sx * DPR, sy * DPR); }
  if (!layer || layerR !== R || layerKey !== (PORT ? 'P' : 'L') + W + 'x' + H) buildLayer();
  if (PORT && m) { // smooth pan to keep the ball (and me) in frame
    const sp = PAN; PAN = 0; const bq = proj(m.ball.x, m.ball.y, 0), mp = m.players[mySeat], mq = mp ? proj(mp.x, mp.y, 0) : bq; PAN = sp;
    const fxp = bq[0] * 0.65 + mq[0] * 0.35, tgt = Math.max(-PM * 0.8, Math.min(PM * 0.8, (W / 2 - fxp) * 0.6));
    PAN += (tgt - PAN) * (1 - Math.exp(-(dt || 0.016) * 3.5));
  } else if (m && m.players[mySeat] && role !== 'spectator') { // v10 landscape: slide the court only when I (feet ring + racket) would leave the screen
    const sp = PAN; PAN = 0; const mp = m.players[mySeat], q = proj(mp.x, mp.y, 0), mg = Math.max(24, q[2] * 0.62); PAN = sp;
    const tgt = Math.max(-PM * 0.9, Math.min(PM * 0.9, q[0] < mg ? mg - q[0] : q[0] > W - mg ? W - mg - q[0] : 0));
    PAN += (tgt - PAN) * (1 - Math.exp(-(dt || 0.016) * 4));
  } else PAN = 0;
  ctx.drawImage(layer, -PM + PAN, 0, W + 2 * PM, H);
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
    if (e.k === 'puff') { e.x += e.vx * dt; e.y += e.vy * dt; e.z = Math.max(0, e.z + e.vz * dt); e.vz -= 6 * dt; const pq = proj(e.x, e.y, e.z), kk = e.t / e.d; ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - kk)})`; ctx.beginPath(); ctx.arc(pq[0], pq[1], Math.max(0.5, pq[2] * 0.035 * (1 - kk * 0.5)), 0, 7); ctx.fill(); continue; }
    const q = proj(e.x, e.y, 0), k = e.t / e.d, s = q[2];
    if (e.k === 'ring') { ctx.strokeStyle = e.out ? `rgba(255,70,70,${1 - k})` : `rgba(255,255,255,${0.8 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(q[0], q[1], Math.max(0, s * (0.1 + k * 0.4)), Math.max(0, s * (0.035 + k * 0.14)), 0, 0, 7); ctx.stroke();
      if (e.out) { ctx.fillStyle = `rgba(255,70,70,${1 - k})`; ctx.font = `900 ${s * 0.3}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('OUT', q[0], q[1] - s * 0.2); } }
  }
  const b = m.ball, bv = { x: b.x + (ballOff.x || 0), y: b.y + (ballOff.y || 0), z: Math.max(C.R, b.z + (ballOff.z || 0)) };
  if (me && role !== 'spectator' && m.diff !== 'hard' && m.phase === 'rally' && m.live && m.lastHitTeam !== me.team && m.bounces === 0) {
    const key = m.point + ':' + m.hits; if (hintKey !== key || !hintPt) { hintKey = key; const pr = PB.predict(m); hintPt = pr.firstBounce || null; }
    if (hintPt && (hintPt.x < 0 ? 0 : 1) === me.team && !PB.isOut(hintPt.x, hintPt.y)) { const q = proj(hintPt.x, hintPt.y, 0), s = q[2], pu = 0.75 + 0.25 * Math.sin(performance.now() / 110);
      ctx.strokeStyle = `rgba(255,225,77,${0.85 * pu})`; ctx.lineWidth = Math.max(2, s * 0.05); ctx.beginPath(); ctx.ellipse(q[0], q[1], Math.max(0, s * 0.42), Math.max(0, s * 0.42 * SN * 0.62), 0, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,225,77,.18)'; ctx.fill(); }
  } else hintPt = null;
  if (AID.spot) { const q = proj(AID.spot.x, AID.spot.y, 0), s = q[2], pu = 0.6 + 0.4 * Math.sin(performance.now() / 120); // 殺球練習: where to stand for the smash
    ctx.strokeStyle = `rgba(255,107,213,${0.9 * pu})`; ctx.setLineDash([6, 5]); ctx.lineWidth = Math.max(2, s * 0.045); ctx.beginPath(); ctx.ellipse(q[0], q[1], Math.max(0, s * 0.45), Math.max(0, s * 0.45 * SN * 0.62), 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ff8be0'; ctx.font = `800 ${Math.max(11, s * 0.17) | 0}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.fillText('殺球點', q[0], q[1] + Math.max(14, s * 0.22)); }
  drawShadow(ctx, bv);
  const objs = m.players.map((p) => ({ k: 'p', p, x: (p.rp || p).x, y: (p.rp || p).y }));
  objs.push({ k: 'b', x: bv.x, y: bv.y });
  objs.sort((a, c) => depthOf(c.x, c.y) - depthOf(a.x, a.y));
  lastTags = tagRects; tagRects = [];
  const draw = (o) => (o.k === 'p' ? drawPlayer(ctx, o.p, o.p.i === mySeat && role !== 'spectator') : drawBall(ctx, bv));
  const farBall = objs.find((o) => o.k === 'b');
  // the net is drawn under everything except objects on the far side of it that are low enough to be hidden by it
  drawNet(ctx); objs.forEach(draw); void farBall;
  if (m.phase === 'rally' || m.phase === 'dead') { trail.push({ ...bv }); if (trail.length > 12) trail.shift(); } else trail.length = 0;
  if (juice.flash > 0) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = `rgba(255,240,250,${Math.min(0.32, juice.flash)})`; ctx.fillRect(0, 0, W, H); juice.flash = Math.max(0, juice.flash - (dt || 0.016) * 1.3); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (QS.get('fps') === '1') { ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'left'; const kb = $('keys'), jh = $('joyHint'), ky = touchUI ? (jh.offsetParent ? Math.min(H - 8, appRect(jh).top - 6) : H - 8) : kb.classList.contains('hide') ? H - 8 : Math.min(H - 8, appRect(kb).top - 6); ctx.fillText(fps.toFixed(0) + ' fps', 8, ky); fpsY = ky; }
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
// v9 smash sound: rendered once into a buffer and played through a pool of 8 voices; when all are busy the oldest is
// cut short so every smash still starts its own sound (counted in juice.sfx; juice.sfxMuted when sound is off / no audio).
let smashBuf = null, smashBufP = null; const VOICES = [];
function renderSmash() {
  if (smashBufP || !AC) return; const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return;
  const sr = AC.sampleRate, o = new OAC(1, Math.ceil(sr * 0.42), sr), T = (f, d, type, vol, f2, delay) => { const t = delay || 0, os = o.createOscillator(), g = o.createGain(); os.type = type; os.frequency.setValueAtTime(f, t); if (f2) os.frequency.exponentialRampToValueAtTime(f2, t + d); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + d); os.connect(g).connect(o.destination); os.start(t); os.stop(t + d + 0.02); };
  const N = (d, vol, fc, delay) => { const t = delay || 0, nb = o.createBuffer(1, Math.ceil(sr * d), sr), a = nb.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; const sN = o.createBufferSource(), f = o.createBiquadFilter(), g = o.createGain(); sN.buffer = nb; f.type = 'bandpass'; f.frequency.value = fc; f.Q.value = 1.2; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); sN.connect(f).connect(g).connect(o.destination); sN.start(t); };
  N(0.09, 0.75, 3400); T(1800, 0.05, 'square', 0.16, 320); T(120, 0.24, 'sine', 0.6, 42); N(0.28, 0.28, 800, 0.03);
  smashBufP = o.startRendering().then((b) => { smashBuf = b; }).catch(() => {});
}
function smashVoice() {
  if (!AC || !sound) { juice.sfxMuted = (juice.sfxMuted || 0) + 1; juice.sfx++; return; }
  renderSmash();
  if (!smashBuf) { juice.sfx++; noise(0.09, 0.75, 3400); tone(1800, 0.05, 'square', 0.16, 320); tone(120, 0.24, 'sine', 0.6, 42); noise(0.28, 0.28, 800, 0.03); return; } // first one, while the buffer renders
  const t = AC.currentTime; let v = VOICES.find((q) => q.end <= t);
  if (!v) { if (VOICES.length < 8) { const g = AC.createGain(); g.connect(AC.destination); v = { g, src: null, end: 0 }; VOICES.push(v); } else { v = VOICES.reduce((a, b) => (a.end < b.end ? a : b)); try { v.src.stop(); } catch (_) {} juice.sfxStolen = (juice.sfxStolen || 0) + 1; } }
  const src = AC.createBufferSource(); src.buffer = smashBuf; src.connect(v.g); v.g.gain.setValueAtTime(1, t); src.onended = () => { juice.sfxEnded = (juice.sfxEnded || 0) + 1; };
  src.start(t); v.src = src; v.end = t + smashBuf.duration; juice.sfx++; juice.voices = VOICES.length;
}
const SFX = {
  hit: (shot) => { const v = shot === 'dink' ? 0.25 : shot === 'smash' ? 0.6 : 0.45; tone(shot === 'dink' ? 1250 : 950, 0.07, 'triangle', v, 500); noise(0.05, v * 0.8, 2200); },
  bounce: () => { tone(260, 0.08, 'sine', 0.3, 120); noise(0.04, 0.15, 700); },
  net: () => { noise(0.2, 0.35, 350); tone(140, 0.15, 'sine', 0.2, 80); },
  whistle: () => { for (let i = 0; i < 2; i++) tone(2400, 0.16, 'square', 0.05, 2300, i * 0.2); },
  point: () => { tone(660, 0.14, 'sine', 0.25); tone(880, 0.22, 'sine', 0.25, null, 0.12); },
  side: () => { tone(520, 0.14, 'triangle', 0.22); tone(390, 0.22, 'triangle', 0.22, null, 0.12); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, null, i * 0.13)); },
  click: () => tone(700, 0.05, 'sine', 0.15),
  smash: () => smashVoice()
};
$('bSound').onclick = () => { sound = !sound; try { localStorage.pbSound = sound ? '1' : '0'; } catch (_) {} $('bSound').textContent = sound ? '🔊' : '🔇'; audio(); };
$('bSound').textContent = sound ? '🔊' : '🔇';

// ---------- messages / HUD ----------
let hintKey = '', hintPt = null;
let msgTimer = 0, lastFault = null, lastReason = ''; const hitCount = {};
// portrait hints: below my baseline (out of the ball's flight band); if I'm standing there, on the far kitchen instead
function placeTip() {
  const e = $('tip'); if (!PORT || e.classList.contains('hide')) { if (e.style.top) e.style.top = ''; return; }
  const me = m.players[mySeat]; if (!me) return; const hh = (e.offsetHeight || 28) / 2 + 4;
  const f = proj(me.x, me.y, 0), hd = proj(me.x, me.y, 2.3), y0 = hd[1] - 22, y1 = f[1] + 8;
  const cs = getComputedStyle(document.documentElement), rows = [parseFloat(cs.getPropertyValue('--tipy')), parseFloat(cs.getPropertyValue('--fk'))].filter((v) => v > 0);
  const clear = (y) => y + hh < y0 || y - hh > y1, cur = parseFloat(e.style.top);
  if (cur && clear(cur)) return; const y = rows.find(clear); e.style.top = Math.round(y != null ? y : rows[rows.length - 1]) + 'px';
}
// prompts turn see-through while the ball flies behind them
function dimOverBall() {
  const q = proj(m.ball.x, m.ball.y, m.ball.z), pad = (lastBallR || 6) + 14;
  for (const id of ['tip', 'msg']) { const e = $(id); if (e.classList.contains('hide')) { e.classList.remove('thru'); continue; }
    const r = appRect(e); e.classList.toggle('thru', q[0] > r.left - pad && q[0] < r.right + pad && q[1] > r.top - pad && q[1] < r.bottom + pad); }
}
// landscape: fault / call box in the strip between the scoreboard and the top-right buttons + brand, never over them
function placeMsgLand() {
  const e = $('msg'), b = appRect($('board')), ic = appRect($('bPause')), br = appRect($('brand'));
  const l = b.right + 8, r = Math.min(ic.left, br.width ? br.left : 1e9) - 8, w = r - l;
  if (w >= 220) { e.style.left = Math.round((l + r) / 2) + 'px'; e.style.maxWidth = Math.round(w) + 'px'; e.style.top = Math.round(6 + (e.offsetHeight || 60) / 2) + 'px'; }
  else { e.style.left = ''; e.style.maxWidth = Math.round(W * 0.6) + 'px'; e.style.top = Math.round(Math.max(b.bottom, br.bottom) + 6 + (e.offsetHeight || 60) / 2) + 'px'; }
}
// portrait: put the call/fault box on a court row that is clear of my own player (near kitchen, near backcourt, far kitchen)
function placeMsg(force) {
  const e = $('msg'); if (e.classList.contains('hide')) return;
  if (!PORT) { if (force) placeMsgLand(); return; }
  if (e.style.left) { e.style.left = ''; e.style.maxWidth = ''; }
  const me = m && m.players[mySeat]; if (!me) return; const hh = (e.offsetHeight || 60) * 0.6 + 8; // room for the pop-in scale
  const f = proj(me.x, me.y, 0), hd = proj(me.x, me.y, 2.3), y0 = hd[1] - 22, y1 = f[1] + 8; // head + name tag .. feet
  const rows = [pv(0, -C.K * 0.55, 0)[1], pv(0, -(C.K + C.HL) * 0.5 - 0.6, 0)[1], pv(0, C.K * 0.5, 0)[1], pv(0, 0, 0)[1] - hh * 0.4];
  const cur = parseFloat(e.style.top); const clear = (y) => y + hh < y0 || y - hh > y1;
  if (!force && cur && clear(cur)) return; let y = rows.find(clear);
  if (y == null) { const ov = (r) => Math.max(0, Math.min(r + hh, y1) - Math.max(r - hh, y0)); y = rows.reduce((a, r) => (ov(r) < ov(a) ? r : a), rows[0]); } // nothing fully clear: least overlap with me
  e.style.top = Math.round(y) + 'px';
}
function showMsg(a, b, cls, dur) { const e = $('msg'); $('msgA').textContent = a; $('msgB').textContent = b || ''; e.className = cls || 'info'; void e.offsetWidth; e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; clearTimeout(msgTimer); msgTimer = setTimeout(() => e.classList.add('hide'), dur || 1700); e.style.top = ''; e.style.left = ''; e.style.maxWidth = ''; placeMsg(true); }
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hide'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hide'), 2600); }
const teamOf = (i) => i % 2;
// ---- v7 smash: screen shake / flash, low-ball 殺球 warning ----
const juice = { shake: 0, flash: 0, n: 0, sfx: 0, amp: 0, ox: 0, oy: 0 };
let lowTipT = 0, smashLowNow = false;
const FREEZE = { armed: false, at: 0, left: -1, frozen: false }; // test hook: hold the exact frame N frames after a smash triggers
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
function smashJuice(ds) { if (FREEZE.armed) { FREEZE.armed = false; FREEZE.left = FREEZE.at; } juice.n++; juice.shake = ds ? 0.32 : 0.22; juice.amp = RM ? 0 : ds ? 7 : 4; juice.flash = ds ? 0.3 : 0.16; SFX.smash(); }
// v8: the 殺球 button's low state follows the PREDICTED contact: only for a ball coming to my side that I can legally reach in
// time; a new state must hold for 0.35 s before it shows, and it changes at most once per incoming shot.
function contactZ(me) { const a = m && me ? PB.smashAid(m, me) : null; return a && a.contact ? a.contact.z : null; } // v10: one prediction for the label and the cue
// v9: the latch is keyed on a monotonic count of incoming strokes (from the hit events, so it can't be fooled by a reset
// point / rally counter, a rematch or my partner's hits), a new state must hold 0.35 s, and any two changes are ≥ 1.2 s apart.
const SL = { want: false, since: 0, seq: 0, key: -1, used: false, toggles: 0, shots: 0, short: 0, forced: 0, lastT: -1e9, log: [] };
const SL_DWELL = 1200;
function setSmashLow(low, now) {
  if (low === smashLowNow) return; smashLowNow = low; SL.toggles++; if (now - SL.lastT < 300) SL.short++; SL.lastT = now; SL.log.push([Math.round(now), low ? 1 : 0, SL.seq]); if (SL.log.length > 200) SL.log.shift();
  const bt = $('tbSmash'); bt.classList.toggle('low', low); bt.querySelector('b').textContent = low ? '抽' : '殺球'; bt.querySelector('small').textContent = low ? '▼' : 'SMASH'; smashAria();
}
// v11: hidden badges carry no text (and are aria-hidden); the button's aria-label always says what a press does now
function badge(id, text, on) { const e = $(id); e.classList.toggle('hide', !on); e.textContent = on ? text : ''; e.setAttribute('aria-hidden', on ? 'false' : 'true'); }
function smashAria() { const bt = $('tbSmash'); bt.setAttribute('aria-label', smashLowNow ? '抽球（球太低，按殺球會改為抽球）' : bt.classList.contains('now') ? '殺球（現在！）' : bt.classList.contains('armed') ? '殺球（已預備，擊球時殺球）' : '殺球'); }
function slIncoming(e) { const me = m && m.players[mySeat]; if (me && e.p != null && m.players[e.p] && m.players[e.p].team !== me.team) SL.seq++; } // an opponent stroke = a new incoming shot
function updSmashBtn() {
  const now = performance.now(), me = m && (state === 'play' || state === 'end') && role !== 'spectator' ? m.players[mySeat] : null;
  if (!me || m.phase !== 'rally' || !m.live || m.lastHitTeam === me.team) return; // only judge a live ball coming my way; otherwise hold
  const c = AID.contact; if (!c) return;                                            // not hittable by me: hold
  if (SL.seq !== SL.key) { SL.key = SL.seq; SL.used = false; SL.shots++; SL.want = smashLowNow; SL.since = now; }
  const low = !c.ok;                                                                // v10: same prediction as the 「現在！」 cue
  if (low !== SL.want) { SL.want = low; SL.since = now; }
  if (AID.now) { if (smashLowNow) { setSmashLow(false, now); SL.used = true; SL.forced++; } SL.want = false; return; } // the cue says smash: the button says 殺球, never 抽
  if (!SL.used && SL.want !== smashLowNow && now - SL.since >= 350 && now - SL.lastT >= SL_DWELL) { setSmashLow(SL.want, now); SL.used = true; }
}
function slReset() { SL.key = -1; SL.used = false; } // new match: keep the label as is (no change outside an incoming shot); the next incoming ball judges it
// v9 timing aid: 「現在！」 when the ball will meet me high enough within 0.45 s (or is in my smash window right now)
const AID = { now: false, onT: 0, cues: 0, spot: null, contact: null };
function updAid() {
  const me = m && state === 'play' && role !== 'spectator' ? m.players[mySeat] : null, a = me ? PB.smashAid(m, me) : null;
  AID.spot = a && m.practice ? a.spot : null; AID.contact = a && a.contact;
  const now = !!(a && a.contact && a.contact.ok && a.contact.t <= 0.45);
  if (now !== AID.now) { AID.now = now; if (now) { AID.onT = performance.now(); AID.cues++; } }
}
// after updSmashBtn: show the cue on the button (the label has already been put on 殺球 for it), and the practice 預備 badge
function showAid() {
  const bt = $('tbSmash'), now = AID.now && !smashLowNow, armed = !now && armedNow();
  if (now !== bt.classList.contains('now')) { bt.classList.toggle('now', now); badge('nowCue', '現在！', now); smashAria(); if (now && FREEZE.aidArm) { FREEZE.aidArm = false; FREEZE.frozen = true; } }
  if (armed !== bt.classList.contains('armed')) { bt.classList.toggle('armed', armed); badge('armCue', '預備', armed); smashAria(); }
}
// v10 practice: a 殺球 press made while the feed is on its way (or before it) is kept until contact — for laggy input and beginners.
// While the ball is high enough the press is renewed every frame (so it smashes at contact); while it is too low it is withheld (plain 抽球).
const ARM = { pt: -1, h: -1, on: false };
function armedNow() { const me = m && m.players[mySeat]; return !!(m && m.practice && me && ARM.pt === m.point && (m.phase === 'serve' || (ARM.h === m.hits && m.live && m.lastHitTeam !== me.team))); }
function armPress() {
  const me = m && m.players[mySeat]; if (!m || !m.practice || !me) return;
  if (m.phase === 'serve') { ARM.pt = m.point; ARM.h = 4; m.feedNow = true; } // tap = 「我準備好了」: feed now, and keep the smash for it
  else if (m.live && m.lastHitTeam !== me.team) { ARM.pt = m.point; ARM.h = m.hits; }
}
function armTick(me) {
  if (!armedNow() || m.phase !== 'rally') { ARM.on = false; return; }
  if (PB.inKitchen(me)) { if (ARM.on) { me.in.shotT = -9; ARM.on = false; } return; } // never commit a kitchen volley for you
  if (m.ball.z >= PB.SMASH_ZH) { me.in.shot = 'smash'; me.in.shotT = m.t; ARM.on = true; }
  else if (ARM.on) { me.in.shotT = -9; ARM.on = false; } // too low right now: let the auto-swing take a normal 抽球
}
function smashCard(e) {
  const c = $('smashCard'), p = m.players[e.p]; if (!c) return;
  const mine = role !== 'spectator' && teamOf(e.p) === teamOf(mySeat);
  $('smashSub').textContent = (p ? p.name + (e.p === mySeat ? '（你）' : '') + ' ' : '') + (e.how === 'win' ? '殺球致勝！' : '殺球逼出失誤！');
  c.className = mine ? 'own' : 'opp'; void c.offsetWidth; c.classList.add('go'); clearTimeout(smashCard.t); smashCard.t = setTimeout(() => c.classList.remove('go'), 1400); smashCard.n = (smashCard.n || 0) + 1;
}
// v9 practice panel: one big 「致勝率 xx%」 line, small details, and a difficulty switch right in the panel
function updPrac() {
  const el = $('prac'); if (!el) return; const on = !!(m && m.practice && state === 'play'); el.classList.toggle('hide', !on); if (!on) return;
  const s = m.smStats[teamOf(mySeat)];
  { const bd = $('board'); if (bd) { const r = appRect(bd); if (r.height) { el.style.setProperty('--pracy', Math.round(r.bottom + 6) + 'px'); el.style.setProperty('--pracw', Math.round(r.width) + 'px'); } } }
  if (!el.firstChild) {
    el.innerHTML = '<div class="pr1"><b>殺球練習</b><span class="rp" id="prRP" title="練習每一球都計分（rally scoring）">你 <i id="prMe">0</i> : <i id="prOp">0</i> 對手</span><button id="prSet" aria-expanded="false" aria-label="練習設定：難度與慢動作">設定 ▾</button></div>'
      + '<div class="prr"><span class="rate" id="prRateL"></span><small class="incl" title="致勝率 =（致勝 + 逼失誤）÷ 殺球">含逼失誤</small></div><div class="pr2" id="prDet"></div>'
      + '<div class="prd" id="prDiff"><button data-d="easy">簡單</button><button data-d="normal">普通</button><button data-d="hard">困難</button></div>'
      + '<div class="prd prs" id="prSlow"><span>慢動作</span><button data-s="1">關</button><button data-s="0.5">0.5×</button><button data-s="0.35">0.35×</button></div>';
    let setT = 0; // a touch tap fires pointerdown and then a click (detail 0 in some browsers): toggle once
    $('prSet').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); setT = performance.now(); togglePracSet(); });
    $('prSet').addEventListener('click', (e) => { if (performance.now() - setT > 600) togglePracSet(); });
    $('prSlow').addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); e.stopPropagation(); setSlow(b.dataset.s); });
    $('prSlow').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail === 0) setSlow(b.dataset.s); });
    $('prDiff').addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); e.stopPropagation(); setPracDiff(b.dataset.d); });
    $('prDiff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail === 0) setPracDiff(b.dataset.d); }); // keyboard
  }
  if (s.n) $('prRateL').innerHTML = `致勝率 <i id="prRate">${Math.round(100 * (s.win + s.forced) / s.n)}%</i>`; else $('prRateL').innerHTML = '<i id="prRate" class="none">尚未殺球</i>';
  const rp = m.rp || [0, 0], mt = teamOf(mySeat); $('prMe').textContent = rp[mt]; $('prOp').textContent = rp[1 - mt];
  $('prDet').innerHTML = `<span>殺球 ${s.n}・致勝 ${s.win}・逼失誤 ${s.forced}</span><span>・被回擊 ${s.ret}・失誤 ${s.own}</span>`;
  el.querySelectorAll('#prDiff button').forEach((b) => b.classList.toggle('sel', b.dataset.d === m.diff));
  el.querySelectorAll('#prSlow button').forEach((b) => b.classList.toggle('sel', +b.dataset.s === SLOW));
  el.classList.toggle('folded', PORT && !pracSetOpen); $('prSet').textContent = pracSetOpen ? '收起 ▴' : `設定 ▾`; $('prSet').setAttribute('aria-expanded', String(!PORT || pracSetOpen));
}
// v10 慢動作: practice runs the game clock at 1× / 0.5× / 0.35× (?slow=0.5 or the panel switch; remembered)
let SLOW = 1, TS = 1; const PRAC = { fed: false };
function slowNow(me) { return SLOW < 1 && me && m.live && m.phase === 'rally' && m.lastHitTeam !== me.team && m.ball.x * PB.teamSign(me.team) > -0.4; } // ball crossing / on my side, coming at me
const SLOWS = [1, 0.5, 0.35];
function slowDefault() { if (QS.has('slow') && /^(|on|true)$/.test(QS.get('slow'))) return 0.5; const q = +QS.get('slow'); if (SLOWS.includes(q)) return q; try { const v = +localStorage.pbSlow; if (SLOWS.includes(v)) return v; } catch (_) {} return 1; }
function setSlow(v) { if (!SLOWS.includes(+v)) return; SLOW = +v; SFX.click(); try { localStorage.pbSlow = String(SLOW); } catch (_) {} hudSig = ''; updPrac(); }
// v11 portrait: the difficulty / 慢動作 rows fold away behind 「設定」 so the panel stays off the far court (landscape always shows them)
let pracSetOpen = false;
function togglePracSet() { pracSetOpen = !pracSetOpen; SFX.click(); updPrac(); }
function pracDiffDefault() { const q = QS.get('diff'); if (PB.DIFF[q]) return q; try { if (PB.DIFF[localStorage.pbPracDiff]) return localStorage.pbPracDiff; } catch (_) {} return 'easy'; }
function setPracDiff(d) {
  if (!m || !m.practice || !PB.DIFF[d]) return; SFX.click(); try { localStorage.pbPracDiff = d; } catch (_) {}
  m.diff = d; m.cfg.diff = d; m.smStats = [0, 1].map(() => ({ n: 0, win: 0, forced: 0, own: 0, ret: 0 })); m.smTrack = null; m.rp = [0, 0]; hudSig = ''; updPrac(); // fresh stats for the new level
}
function lowTip() { lowTipT = performance.now() + 1300; }
function handleEvent(e) {
  if (!m) return;
  switch (e.k) {
    case 'hit': slIncoming(e); if (e.feed) PRAC.fed = true; hitCount[e.p] = (hitCount[e.p] || 0) + 1; if (e.shot === 'smash') smashJuice(e.ds); else SFX.hit(e.shot); if (e.low && e.p === mySeat) lowTip(); if (e.p != null && m.players[e.p]) { m.players[e.p].swing = 1; m.players[e.p].swingShot = e.shot; } break;
    case 'serve': slIncoming(e); SFX.hit('drive'); if (m.players[e.p]) { m.players[e.p].swing = 1; m.players[e.p].swingShot = 'serve'; } break;
    case 'bounce': if (!e.dead) SFX.bounce(); fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, d: 0.9, out: PB.isOut(e.x, e.y) && !e.dead }); for (let n = 0; n < 9; n++) { const a = Math.random() * 7, sp = 0.6 + Math.random() * 1.2; fx.push({ k: 'puff', x: e.x, y: e.y, z: 0.03, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0.8 + Math.random() * 1.4, t: 0, d: 0.45 + Math.random() * 0.25 }); } break;
    case 'net': SFX.net(); break;
    case 'fault': SFX.whistle(); lastFault = e; break;
    case 'point': case 'sideout': case 'second': {
      let mine = role !== 'spectator' && teamOf(mySeat) === (e.k === 'point' ? e.team : (lastFault ? 1 - lastFault.team : -1));
      (e.k === 'point' ? SFX.point : SFX.side)();
      const spec = role === 'spectator', myT = teamOf(mySeat);
      const rel = (i) => (spec ? '' : i === mySeat ? '（你）' : teamOf(i) === myT ? '（隊友）' : '（對手）');
      const side = (t) => (spec ? m.teamNames[t] : t === myT ? '你方' : '對手');
      const who = !lastFault ? '' : lastFault.who >= 0 && m.players[lastFault.who] ? m.players[lastFault.who].name + rel(lastFault.who) + ' 失誤・' : side(lastFault.team) + ' 失誤・';
      let res = e.k === 'point' ? side(e.team) + '得分！' : e.k === 'sideout' ? '換' + side(e.team) + '發球（Side Out）' : e.text;
      if (m.practice && lastFault) { const win = 1 - lastFault.team, rp = m.rp || [0, 0]; mine = win === myT; res = (mine ? '你得 1 分' : '對手得 1 分') + `（你 ${rp[myT]} : ${rp[1 - myT]} 對手）`; updPrac(); } // practice: every rally counts
      showMsg(lastFault ? lastFault.reason : '', who + res, mine ? 'good' : 'bad', 2300);
      lastReason = lastFault ? lastFault.reason : ''; lastFault = null; break; }
    case 'call': if (m.practice) break; { const spec = role === 'spectator', ot = spec ? 0 : teamOf(mySeat);
      showMsg('', (e.first ? '開賽！' : lastReason ? '上一球：' + lastReason + '・' : '') + (m.mode === 2 ? '報分 ' + e.text + '・' : '') + '發球：' + (m.players[e.server] ? m.players[e.server].name : ''), 'info call', lastReason ? 1700 : 1000);
      $('msgA').innerHTML = `<span class="own">${spec ? esc(m.teamNames[0]) : '你'} ${m.score[ot]}</span> – ${m.score[1 - ot]} ${spec ? esc(m.teamNames[1]) : '對手'}`; // own team first, own score highlighted
      lastReason = ''; break; }
    case 'smashend': if (e.how === 'win' || e.how === 'forced') smashCard(e); updPrac(); break;
    case 'win': SFX.win(); break;
    case 'over': endGame(); break;
  }
}
let hudSig = '';
function updHUD() {
  if (!m) return;
  const lt = R === 1 ? 0 : 1, rt = 1 - lt;
  const names = (t) => m.players.filter((p) => p.team === t).map((p) => (p.i === mySeat && role !== 'spectator' ? '★' : '') + esc(p.name)).join('<br>');
  const sig = [m.score.join(), m.servingTeam, m.serverNum, m.server, lt, m.players.map((p) => p.name + p.co).join(), m.practice ? (m.phase === 'serve') + ':' + PRAC.fed + ':' + SLOW : ''].join('|');
  if (sig !== hudSig) {
    hudSig = sig;
    const lead = (t) => { const q = m.players.find((p) => p.team === t); return q ? q.co : t; }; $('tmL').style.background = teamGrad(lead(lt)); $('tmR').style.background = teamGrad(lead(rt));
    $('nmL').innerHTML = names(lt); $('nmR').innerHTML = names(rt);
    $('scL').textContent = m.score[lt]; $('scR').textContent = m.score[rt];
    $('tmL').classList.toggle('serving', m.servingTeam === lt); $('tmR').classList.toggle('serving', m.servingTeam === rt);
    { const ow = m.score[lt], op = m.score[rt]; $('call').innerHTML = `<b class="own">${ow}</b><i>-</i>${op}`; } // own team first, like the rows
    document.body.classList.toggle('pracmode', !!m.practice); // v11: practice hides the pickleball score (rally points are in the panel)
    $('hdr').textContent = m.practice ? `殺球練習・${DIFF_NAME[m.diff] || ''}${SLOW < 1 ? `・慢動作 ${SLOW}×` : ''}` : `${m.mode === 2 ? '雙打' : '單打'}・${DIFF_NAME[m.diff] || ''}・${m.target}分`;
    const sp = m.players[m.server];
    const sw = m.servingTeam === lt && role !== 'spectator' ? '你方' : m.teamNames[m.servingTeam];
    $('srv').textContent = m.practice ? (m.phase === 'serve' && PRAC.fed ? '按任一擊球鍵就餵球' : '電腦一直餵高球') : m.mode === 2 ? `報分 ${PB.callText(m)}・${sw}發球 ${sp ? sp.name : ''}` : `${sw}發球・${sp ? sp.name : ''}`;
    measureHud(); requestAnimationFrame(measureHud); // v9: measure now too, so tags drawn this frame already avoid a resized scoreboard
    if (m.practice) requestAnimationFrame(updPrac);
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
  if (state === 'play' && performance.now() < lowTipT && !warn) { t = '球太低，改為抽球'; warn = true; }
  tip.textContent = t; tip.classList.toggle('hide', !t); tip.classList.toggle('warn', warn);
}

// ---------- input ----------
const keys = {};
const inp = { jx: 0, jy: 0, shot: 'drive', shotT: -9, seq: 0 };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true; audio(); if (!e.repeat && touchUI && performance.now() - lastTouchAt > 800) setTouch(false);
  const map = { KeyJ: 'drive', Space: 'drive', KeyK: 'dink', KeyL: 'lob', KeyI: 'smash', KeyU: 'smash', KeyZ: 'drive', KeyX: 'dink', KeyC: 'lob', KeyV: 'smash' };
  if (map[e.code] && !e.repeat) { press(map[e.code]); e.preventDefault(); }
  if (e.code === 'Escape' && state === 'play') togglePause();
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function press(shot) {
  if (shot === 'smash' && AID.contact && !AID.contact.ok && AID.contact.t < 0.6) lowTip(); // v9: only for the ball actually arriving now (not a stale button state)
  if (m && m.practice && role === 'local') { if (shot === 'smash') armPress(); else if (m.phase === 'serve') m.feedNow = true; } // practice: any stroke key = feed me
  inp.shot = shot; inp.shotT = performance.now(); inp.seq++;
  document.querySelectorAll('.tb').forEach((b) => b.classList.toggle('sel', b.dataset.shot === shot));
  if (role === 'client') sendInput(true);
  else if (m && m.players[mySeat]) { const p = m.players[mySeat]; p.in.shot = shot; p.in.shotT = m.t; }
}
// touch: joystick + buttons
const joy = { id: null, ox: 0, oy: 0 };
const jb = $('joyBase'), jk = $('joyKnob'), jz = $('joyZone');
function joyPos(px, py) { const [cx, cy] = appXY(px, py); const dx = cx - joy.ox, dy = cy - joy.oy, l = Math.hypot(dx, dy), max = 52, k = l > max ? max / l : 1; jk.style.transform = `translate(${dx * k}px,${dy * k}px)`; const n = Math.min(1, l / max); inp.jx = l > 6 ? (dx / l) * n : 0; inp.jy = l > 6 ? (-dy / l) * n : 0; }
jz.addEventListener('pointerdown', (e) => { audio(); setTouch(true); joy.id = e.pointerId; const r = appRect(jz), [ax, ay] = appXY(e.clientX, e.clientY); joy.ox = ax; joy.oy = ay; jb.style.left = ax - r.left + 'px'; jb.style.top = ay - r.top + 'px'; jb.classList.add('on'); joyPos(e.clientX, e.clientY); try { jz.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
jz.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) joyPos(e.clientX, e.clientY); });
const joyHome = () => { jb.style.left = jb.style.top = ''; jk.style.transform = ''; jb.classList.remove('on'); };
const joyEnd = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; inp.jx = inp.jy = 0; joyHome(); };
jz.addEventListener('pointerup', joyEnd); jz.addEventListener('pointercancel', joyEnd);
document.querySelectorAll('.tb').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { audio(); setTouch(true); b.classList.add('on'); press(b.dataset.shot); e.preventDefault(); });
  const up = () => b.classList.remove('on'); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
});
if (matchMedia('(pointer:coarse)').matches) setTouch(true);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

function readMove() {
  let x = inp.jx, y = inp.jy;
  if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y += 1; if (keys.KeyS || keys.ArrowDown) y -= 1;
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  return PORT ? { mx: R * y, my: -R * x } : { mx: R * x, my: R * y }; // screen -> world (inverse of toView)
}
// autopilot (testing / demo): steer toward the predicted hitting spot
let apPred = null, apKey = '', apServeT = 0, apLazy = false, apSpot = false;
function autopilot(p) {
  const b = m.ball, xs = PB.teamSign(p.team);
  const mate0 = m.players.find((q) => q.team === p.team && q !== p);
  let tx = xs * (m.hits >= 3 ? C.K + 0.5 : C.HL - 0.3), ty = b.y * 0.4;
  if (mate0) ty = (p.y < mate0.y || (p.y === mate0.y && p.i < mate0.i) ? -1.45 : 1.45) + Math.max(-0.8, Math.min(0.8, b.y * 0.3));
  if (m.phase === 'serve') { const f = PB.formation(m)[p.i]; tx = f.x; ty = f.y; if (m.server === p.i && m.phaseT > 1.1 && apServeT !== m.point) { apServeT = m.point; press('drive'); } }
  else if (m.live && m.lastHitTeam !== p.team) {
    const key = m.rally + ':' + m.bounces; if (key !== apKey || !apPred) { if (!apKey.startsWith(m.rally + ':')) apLazy = Math.random() < 0.05; apKey = key; apPred = PB.predict(m); }
    if (apLazy && !m.practice) return { mx: 0, my: 0 }; // autopilot occasionally misses so points get decided
    if (m.practice && AID.now && !AUTO_MOVE) press('smash'); // practice: smash on the 「現在！」 cue
    if (m.practice && AID.spot) { tx = AID.spot.x; ty = AID.spot.y; apSpot = true; } else apSpot = false;
    let mate = m.players.find((q) => q.team === p.team && q !== p);
    const fb = apPred.firstBounce; if (!apSpot && fb && (fb.x < 0 ? 0 : 1) === p.team) { tx = fb.x + xs * 0.6; ty = fb.y; } // at least chase the landing spot
    if (!apSpot) for (const q of apPred) {
      if ((q.x < 0 ? 0 : 1) !== p.team || q.b >= 2) continue;
      if (!(q.b >= 1 ? q.z > 0.15 && q.z < 1.3 : m.hits >= 3 && Math.abs(q.x) > C.K + 0.4 && q.z > 0.3 && q.z < 1.6)) continue;
      if (mate && m.mode === 2 && (m.hits === 1 ? m.receiver !== p.i : Math.hypot(q.x - mate.x, q.y - mate.y) < Math.hypot(q.x - p.x, q.y - p.y) - 0.3)) break;
      tx = q.x + xs * 0.2; ty = q.y; if (Math.hypot(q.x - p.x, q.y - p.y) / C.SPEED <= q.t) break;
    }
  }
  if (m.phase !== 'serve') { const ax = Math.abs(tx); tx = xs * Math.max(0.4, Math.min(C.HL + 1.0, xs * tx > 0 ? ax : 0.4)); ty = Math.max(-C.HW - 0.4, Math.min(C.HW + 0.4, ty)); } // stay on our half, near the court
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
  for (let i = 0; i < n; i++) s.push(i === 0 ? { name: myName(), ctrl: 'local', ...myLook() } : { name: '', ctrl: 'ai' });
  const L = assignLooks(s); s.forEach((q, i) => { q.ch = L[i].ch; q.co = L[i].co; if (i) q.name = (i % 2 === 0 ? '隊友' : '') + CHARS[q.ch].n + (i % 2 === 0 ? '' : mode === 1 ? '' : i === 1 ? '甲' : '乙'); });
  return s;
}
const myPid = (() => { try { let v = localStorage.pbPid; if (!v) { v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.pbPid = v; } return v; } catch (_) { return 'x' + Math.random().toString(36).slice(2, 10); } })();
function myName() { const v = $('nick').value.trim(); return (v || autoNick).slice(0, 8); }
const autoNick = (() => { try { let v = localStorage.pbAutoNick; if (!v) { v = '玩家' + ((Math.random() * 900 + 100) | 0); localStorage.pbAutoNick = v; } return v; } catch (_) { return '玩家' + ((Math.random() * 900 + 100) | 0); } })(); // generated once per device, kept across reloads
function startLocal(mode) {
  role = 'local'; mySeat = 0; R = 1;
  const seats = seatsLocal(mode); const cfg = { mode, diff: opt.diff, target: opt.target, seats, teamNames: teamNamesOf(seats), firstServe: Math.random() < 0.5 ? 0 : 1 };
  beginMatch(cfg);
}
function startPractice() {
  role = 'local'; mySeat = 0; R = 1;
  PRAC.fed = false; SLOW = slowDefault(); ARM.pt = -1;
  const seats = seatsLocal(1); beginMatch({ mode: 1, diff: pracDiffDefault(), target: 999, seats, teamNames: teamNamesOf(seats), firstServe: 1, practice: 'smash' }); updPrac();
}
function beginMatch(cfg) {
  if (FORCED) setTimeout(() => toast('橫向模式（手機直拿）・☰ 暫停選單可切回直向'), 400); // v10: remembered forced 橫向 is announced
  m = PB.createMatch(cfg); hudSig = ''; slReset(); setTimeout(updPrac, 0); fx.length = 0; trail.length = 0; paused = false;
  for (const p of m.players) { p.rp = { x: p.x, y: p.y }; }
  state = 'play';
  ['menu', 'room', 'end', 'pause', 'rules'].forEach((i) => $(i).classList.add('hide'));
  ['hud', 'touch', 'keys'].forEach((i) => $(i).classList.remove('hide'));
  if (role !== 'client') { const evs = m.events.splice(0); evs.forEach(handleEvent); if (role === 'host') outbox.push(...evs); }
  updHUD(); resize();
}
function endGame() {
  if (!m) return; state = 'end';
  const w = m.winner, s = m.score; const mine = role !== 'spectator' && teamOf(mySeat) === w;
  $('endT').textContent = (mine ? '🏆 你贏了！' : role === 'spectator' ? '🏆 ' : '再接再厲！') + ' ' + m.teamNames[w] + '獲勝';
  $('endS').textContent = `${s[0]} : ${s[1]}`;
  const st = m.stats || {}; const rl = st.rallies && st.rallies.length ? (st.rallies.reduce((a, b) => a + b, 0) / st.rallies.length).toFixed(1) : '-';
  $('endSub').textContent = `${m.teamNames[0]} ${s[0]} － ${m.teamNames[1]} ${s[1]}` + (role !== 'client' ? `・平均每回合 ${rl} 拍` : '');
  $('bAgain').classList.toggle('hide', role === 'client' || role === 'spectator');
  $('bMenu').textContent = role === 'local' ? '回主選單' : role === 'host' ? '回到房間' : '離開房間';
  if (role === 'client' || role === 'spectator') $('endSub').textContent += '　等待房主開始下一局…';
  $('end').classList.remove('hide'); $('touch').classList.add('hide');
}
function toMenu(msg) {
  showWait(false); hostAway = false; hostAwayMsg = false;
  state = 'menu'; m = null; role = 'local'; R = 1; layer = null;
  ['room', 'end', 'pause', 'hud', 'touch', 'keys', 'tip', 'msg', 'prac'].forEach((i) => $(i).classList.add('hide'));
  optHome(); $('menu').classList.remove('hide'); st(msg || ''); resize();
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
syncs.push(seg('segDiff', 'diff', () => hostCfg()), seg('segTarget', 'target', () => hostCfg()), seg('segMode', 'mode', () => hostCfg()), seg('segChar', 'ch', () => drawPrev()), seg('segCol', 'co', () => drawPrev()), seg('segOrient', 'orient', () => { try { localStorage.pbOrient = opt.orient; } catch (_) {} rzSoon(); }), seg('segOrient2', 'orient', () => { try { localStorage.pbOrient = opt.orient; } catch (_) {} rzSoon(); })); // v10: also one tap away in the pause menu
document.querySelectorAll('#segCol button').forEach((b) => { b.style.setProperty('--c', COLS[+b.dataset.v]); });
syncAll();
try { $('nick').value = localStorage.pbNick || ''; } catch (_) {}
$('nick').addEventListener('change', () => { try { localStorage.pbNick = $('nick').value.trim(); } catch (_) {} });
$('bS1').onclick = () => { audio(); SFX.click(); startLocal(1); };
$('bS2').onclick = () => { audio(); SFX.click(); startLocal(2); };
$('bPrac').onclick = () => { audio(); SFX.click(); startPractice(); };
function drawPrev() { const cv2 = $('lookPrev'); if (!cv2) return; const g = cv2.getContext('2d'); const L = myLook(); g.clearRect(0, 0, cv2.width, cv2.height); const sh = sheet(L.ch, L.co); if (sh) { const fr = Math.floor(performance.now() / 166) % 4, k = cv2.height / FH; g.drawImage(sh, fr * FW, 0, FW, FH, (cv2.width - FW * k) / 2, 0, FW * k, FH * k); } $('lookName').textContent = CHARS[L.ch].n + '・' + COLN[L.co]; }
setInterval(() => { if (state === 'menu') drawPrev(); }, 166);
const showRules = () => $('rules').classList.remove('hide');
$('bRules').onclick = showRules; $('bRules2').onclick = showRules; $('bRulesOk').onclick = () => $('rules').classList.add('hide');
$('code').addEventListener('input', () => { $('code').value = $('code').value.replace(/\D/g, '').slice(0, 4); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
if (QS.get('room')) { $('code').value = QS.get('room').replace(/\D/g, '').slice(0, 4); }
// auto-rejoin: a guest that was in a match in this room within the last 10 minutes joins again by itself after a reload
const lastMatch = { get() { try { return JSON.parse(localStorage.pbLast || 'null'); } catch (_) { return null; } }, set(v) { try { if (v) localStorage.pbLast = JSON.stringify(v); else localStorage.removeItem('pbLast'); } catch (_) {} } };
function markInMatch() { if (role === 'client' && roomCode && state === 'play') { lastMatch.set({ room: roomCode, t: Date.now() });
  try { const u = new URL(location.href); if (u.searchParams.get('room') !== roomCode) { u.searchParams.set('room', roomCode); history.replaceState(null, '', u); } } catch (_) {} } } // a reload of this tab rejoins by itself
setInterval(markInMatch, 4000);
setTimeout(() => { const lm = lastMatch.get(), rc = $('code').value; if (lm && rc && lm.room === rc && Date.now() - lm.t < 10 * 60 * 1000 && state === 'menu') { st('自動重新加入比賽…'); join(rc); } }, 300);

// ---------- networking (same WebSocket relay protocol as 攀岩 peak2d: create / join / msg, host-authoritative) ----------
const RELAY_URL = QS.get('server') || 'wss://panjian-peak2d.onrender.com/ws';
const HTTP_URL = RELAY_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/');
try { fetch(HTTP_URL, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (_) {} // wake the free-tier server early
let ws = null, net = false, isHost = false, myId = '', roomCode = '', roster = [], connGen = 0, joinTimer = 0, cfgTimer = 0, lastAction = null;
let room = { mode: opt.mode, diff: opt.diff, target: opt.target };
let prefs = {}, seatPid = [], seatNick = []; let outbox = [], sendAcc = 0, inAcc = 0, remoteIn = {}, seatIds = [], lastSnapAt = 0;
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
    if (msg.t === 'roster') { roster = dedupeNames(msg.pl); renderSeats(); if (isHost) hostRosterChanged(); return; }
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
function optHome() { $('menuOpts').appendChild($('optCore')); ['segDiff', 'segTarget'].forEach((id) => $(id).classList.remove('dis')); }
function showMenuOnly() { optHome(); $('room').classList.add('hide'); $('menu').classList.remove('hide'); state = 'menu'; }
function leaveRoom() { lastMatch.set(null); connGen++; wsend({ t: 'leave' }); const w = ws; ws = null; net = false; try { w && w.close(); } catch (_) {} isHost = false; toMenu(); }
$('bLeave').onclick = leaveRoom;
function openRoom() {
  state = 'room'; m = null; R = 1; layer = null;
  ['menu', 'end', 'pause', 'hud', 'touch', 'keys', 'tip', 'msg'].forEach((i) => $(i).classList.add('hide'));
  $('room').classList.remove('hide'); $('rcode').textContent = roomCode; st('');
  $('bStart').classList.toggle('hide', !isHost);
  $('roomOpts').appendChild($('optCore')); ['segMode', 'segDiff', 'segTarget'].forEach((id) => $(id).classList.toggle('dis', !isHost));
  $('roomNote').textContent = isHost ? '點選座位換位置；空位由電腦補上。把房號告訴朋友，最多 4 人。' : '點選座位換位置；等待房主開始比賽…';
  if (isHost) hostCfg(); else renderSeats();
}
// same nickname twice in a room -> 峻慶, 峻慶(2), … (in join order; the original nickname is still used for rejoin matching)
function dedupeNames(pl) { const cnt = {}; for (const p of pl || []) { const k = String(p.n || '玩家'); cnt[k] = (cnt[k] || 0) + 1; p.dn = cnt[k] > 1 ? `${k}(${cnt[k]})` : k; } return pl || []; }
function renderSeats() {
  const n = room.mode * 2; const by = {}; for (const p of roster) by[p.c] = p;
  const seat = (i) => { const p = by[i], on = i < n, me = p && p.id === myId;
    return `<button class="seat${me ? ' me' : ''}${!p ? ' ai' : ''}${on ? '' : ' off'}" data-seat="${i}"><span class="dot" style="background:${room.L && room.L[i] ? COLS[room.L[i].co] : '#888'}"></span>${room.L && room.L[i] && on ? `<span class="cn">${CHARS[room.L[i].ch].n}</span>` : ''}${p ? esc(p.dn || p.n) + (p.h ? ' 👑' : '') + (me ? '（你）' : '') : on ? '🤖 電腦' : '（單打不使用）'}</button>`; };
  $('seats').innerHTML = [0, 1].map((t) => `<div class="team t${t}"><h3>${room.L && room.L[t] ? COLN[room.L[t].co] + '隊' : TEAM_NAME[t]}</h3>${seat(t)}${room.mode === 2 || roster.some((p) => p.c === t + 2) ? seat(t + 2) : ''}</div>`).join('');
  const out = roster.filter((p) => p.c >= n); $('roomNote').textContent = out.length ? `${out.map((p) => p.dn || p.n).join('、')} 目前在單打不使用的座位，會變成觀戰。` : (isHost ? '點選座位換位置；空位由電腦補上。把房號告訴朋友，最多 4 人。' : '點選座位換位置；等待房主開始比賽…');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('seats').addEventListener('click', (e) => { const b = e.target.closest('.seat'); if (!b) return; const i = +b.dataset.seat; if (roster.some((p) => p.c === i && p.id !== myId)) return toast('這個座位已經有人'); SFX.click(); wsend({ t: 'pickColor', c: i }); });
$('rcode').onclick = $('bCopy').onclick = async () => { const u = location.origin + location.pathname + '?room=' + roomCode; try { await navigator.clipboard.writeText(u); toast('已複製邀請連結'); } catch (_) { prompt('邀請連結', u); } };

// host
function host() {
  audio(); isHost = true; role = 'host'; lastAction = host; roster = []; prefs = {}; room = { mode: opt.mode, diff: opt.diff, target: opt.target };
  connect({ t: 'create', name: myName(), g: 'm', c: 0 }, (msg) => {
    if (msg.t === 'created') { clearTimeout(joinTimer); myId = msg.id; roomCode = msg.code; net = true; remoteIn = {}; openRoom(); }
    else if (msg.t === 'peer-join') { /* wait for hello */ }
    else if (msg.t === 'peer-leave') { const i = seatIds.indexOf(msg.id); if (m && i >= 0 && state !== 'room') { const p = m.players[i]; toast(`${p.name} 離線了，由電腦接手`); p.ctrl = 'ai'; p.name = CHARS[p.ch || 0].n + '（電腦）'; seatIds[i] = null; sendLooks(); } }
    else if (msg.t === 'msg') hostHandle(msg.from, msg.d);
  });
}
function roomSeats() { const n = room.mode * 2, out = []; for (let i = 0; i < n; i++) { const p = roster.find((q) => q.c === i); const pf = p ? (p.id === myId ? myLook() : prefs[p.id] || {}) : null; out.push(p ? { ctrl: 'h', ch: pf.ch, co: pf.co, id: p.id, name: p.dn || p.n } : { ctrl: 'ai' }); } return out; }
function hostCfg() { if (!isHost) return; room = { mode: opt.mode, diff: opt.diff, target: opt.target }; room.L = assignLooks(roomSeats()); renderSeats(); toAll({ t: 'cfg', room }); }
function hostRosterChanged() { if (state === 'room') hostCfg(); }
function hostHandle(from, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    if (d.game !== 'pickleball') { wsend({ t: 'kick', id: from }); return; }
    prefs[from] = { ch: d.ch === 1 ? 1 : 0, co: d.co >= 0 && d.co < 4 ? d.co | 0 : null, pid: typeof d.pid === 'string' ? d.pid.slice(0, 24) : '', n: String(d.n || '').slice(0, 8) };
    if (state === 'room') hostCfg(); else toPeer(from, { t: 'cfg', room });
    if (m && (state === 'play' || state === 'end')) { // joined mid-game: take over an AI seat if possible
      const rp = roster.find((p) => p.id === from), pf = prefs[from], nick = rp ? rp.n : pf.n || '玩家';
      const free = (i) => i >= 0 && i < m.players.length && !seatIds[i] && i !== mySeat && m.players[i].ctrl === 'ai';
      // rejoin: same persistent id -> same seat; else same nickname; else any CPU seat (own team of the old seat first)
      let i = seatPid.findIndex((q, k) => q && q === pf.pid && free(k)), back = i >= 0;
      if (i < 0) { i = seatNick.findIndex((q, k) => q && q === nick && free(k)); back = i >= 0; }
      if (i < 0) i = m.players.findIndex((p) => free(p.i));
      if (i >= 0) { const p = m.players[i]; p.ctrl = 'remote'; p.name = (() => { let k = 1, nm = nick; while (m.players.some((q) => q.i !== i && q.name === nm)) nm = `${nick}(${++k})`; return nm; })(); seatIds[i] = from; seatPid[i] = pf.pid; seatNick[i] = nick;
        if (!back) { p.ch = pf.ch; if (pf.co != null && !m.players.some((q) => q !== p && q.co === pf.co)) p.co = pf.co; }
        sendLooks(); toast(`${p.name} ${back ? '回到比賽' : '加入比賽'}`); }
      toPeer(from, { t: 'start', cfg: netCfg(), seat: i, mid: 1, snap: snapshot(true) });
    }
  } else if (d.t === 'in') {
    const i = seatIds.indexOf(from); if (!m || i < 0) return; const p = m.players[i]; if (p.ctrl !== 'remote') return;
    const prev = remoteIn[from] || {}; remoteIn[from] = d;
    p.in.mx = +d.mx || 0; p.in.my = +d.my || 0; p.in.aim = +d.aim || 0; p.in.aimOn = !!d.ao;
    if (prev.s !== undefined && d.s !== prev.s) { p.in.shot = ['drive', 'dink', 'lob', 'smash'].includes(d.sh) ? d.sh : 'drive'; p.in.shotT = m.t; }
    if (d.pt === m.point && Number.isFinite(d.x) && Number.isFinite(d.y)) { p.vx = (d.x - p.x) * 30; p.vy = (d.y - p.y) * 30; p.x = d.x; p.y = d.y; PB.clampPlayer(m, p); }
  }
}
function sendLooks() { hudSig = ''; toAll({ t: 'looks', n: m.players.map((q) => q.name), ch: m.players.map((q) => q.ch), co: m.players.map((q) => q.co), tn: m.teamNames }); }
function netCfg() { return { mode: m.mode, diff: m.diff, target: m.target, teamNames: m.teamNames, seats: m.players.map((p) => ({ name: p.name, ctrl: p.ctrl === 'ai' ? 'ai' : 'h', ch: p.ch, co: p.co })) }; }
function hostStart() {
  audio(); const n = room.mode * 2; seatIds = []; const seats = [];
  const RS = roomSeats(), L = assignLooks(RS);
  seatPid = []; seatNick = [];
  for (let i = 0; i < n; i++) { const p = roster.find((q) => q.c === i); seatIds[i] = p ? p.id : null; seatPid[i] = p ? (p.id === myId ? myPid : (prefs[p.id] || {}).pid || '') : ''; seatNick[i] = p ? p.n : ''; seats.push(p ? { name: p.dn || p.n, ctrl: p.id === myId ? 'local' : 'remote', ch: L[i].ch, co: L[i].co } : { name: CHARS[L[i].ch].n + '（電腦）', ctrl: 'ai', ch: L[i].ch, co: L[i].co }); }
  const me = seatIds.indexOf(myId); mySeat = me; role = 'host';
  if (me < 0) toast('你坐在單打不使用的座位，本局觀戰（主持）');
  R = me >= 0 && teamOf(me) === 1 ? -1 : 1; layer = null;
  const cfg = { mode: room.mode, diff: room.diff, target: room.target, seats, teamNames: teamNamesOf(L), firstServe: Math.random() < 0.5 ? 0 : 1 };
  remoteIn = {}; outbox = [];
  beginMatch(cfg);
  wsend({ t: 'started' });
  for (const p of roster) if (p.id !== myId) toPeer(p.id, { t: 'start', cfg: netCfg(), seat: seatIds.indexOf(p.id) });
}
function hostBackToRoom() { wsend({ t: 'lobbyBack' }); toAll({ t: 'room' }); m = null; openRoom(); }
const r3 = (v) => Math.round(v * 1000) / 1000, r2 = (v) => Math.round(v * 100) / 100;
function snapshot(full) {
  const b = m.ball;
  return { t: 's', pt: m.point, ph: m.phase, pT: r2(m.phaseT), mt: r2(m.t), b: [r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz)], P: m.players.map((p) => [r2(p.x), r2(p.y), r2(p.swing), p.swingShot]), sc: m.score, st: m.servingTeam, sn: m.serverNum, sv: m.server, rv: m.receiver, sd: m.sides.join(''), h: m.hits, bo: m.bounces, lh: m.lastHitTeam, lv: m.live ? 1 : 0, w: m.winner, rl: m.rally, ev: full ? [] : outbox.splice(0) };
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
    if (msg.t === 'joined') { clearTimeout(joinTimer); myId = msg.id; net = true; toHost({ t: 'hello', game: 'pickleball', n: myName(), pid: myPid, ...myLook() }); st(msg.started ? '加入進行中的比賽…' : '');
      clearTimeout(cfgTimer); cfgTimer = setTimeout(() => { if (state === 'menu' && net) { failNet('這個房號不是匹克球房間'); wsend({ t: 'leave' }); } }, 6000);
      if (!msg.started) openRoom(); }
    else if (msg.t === 'host-left') { lastMatch.set(null); net = false; toMenu('房主離開了，房間已關閉'); toast('房主離開了，房間已關閉'); try { ws && ws.close(); } catch (_) {} ws = null; }
    else if (msg.t === 'msg') clientHandle(msg.d);
  });
}
function clientHandle(d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'cfg') { clearTimeout(cfgTimer); room = d.room; opt.mode = room.mode; syncAll(); if (state === 'room') renderSeats(); else if (state === 'menu') openRoom(); }
  else if (d.t === 'start') {
    clearTimeout(cfgTimer);
    const seat = d.seat; const cfg = { ...d.cfg, seats: d.cfg.seats.map((s, i) => ({ name: s.name, ctrl: i === seat ? 'local' : 'net', ch: s.ch, co: s.co })) };
    role = seat >= 0 ? 'client' : 'spectator'; mySeat = seat >= 0 ? seat : -1;
    R = seat >= 0 && teamOf(seat) === 1 ? -1 : 1; layer = null;
    beginMatch(cfg); m.events.length = 0; markInMatch(); if (d.snap) { applySnap(d.snap); m.pred = null; for (const p of m.players) { p.rp = { x: p.x = p.tx != null ? p.tx : p.x, y: p.y = p.ty != null ? p.ty : p.y }; } hudSig = ''; updHUD(); $('msg').classList.add('hide'); if (d.mid) { const mt = seat >= 0 ? teamOf(seat) : 0; toast(`已回到比賽：${m.teamNames[mt]} ${m.score[mt]} - ${m.score[1 - mt]} ${m.teamNames[1 - mt]}`); } }
    if (role === 'spectator') { $('touch').classList.add('hide'); toast('觀戰中'); }
    if (role === 'spectator') role = 'spectator';
  }
  else if (d.t === 's') applySnap(d);
  else if (d.t === 'looks') { if (m) { m.players.forEach((p, i) => { if (d.n[i] != null) p.name = d.n[i]; if (d.ch[i] != null) p.ch = d.ch[i]; if (d.co[i] != null) p.co = d.co[i]; }); if (d.tn) m.teamNames = d.tn; } hudSig = ''; }
  else if (d.t === 'names') { if (m) d.n.forEach((n, i) => { if (m.players[i]) m.players[i].name = n; }); hudSig = ''; }
  else if (d.t === 'room') { m = null; showWait(false); openRoom(); }
  else if (d.t === 'away') { hostAwayMsg = true; showWait(true, '房主暫時離開（切到背景）'); }
  else if (d.t === 'back') { hostAwayMsg = false; showWait(false); toast('房主回來了，比賽繼續'); }
}
const ballOff = { x: 0, y: 0, z: 0 };
function applySnap(d) {
  if (!m) return; lastSnapAt = performance.now(); if (waitOn && !hostAwayMsg) showWait(false);
  const newPoint = d.pt !== m.point;
  m.point = d.pt; m.phase = d.ph; m.phaseT = d.pT; m.t = d.mt; m.score = d.sc; m.servingTeam = d.st; m.serverNum = d.sn; m.server = d.sv; m.receiver = d.rv; m.sides = d.sd.split('');
  m.hits = d.h; m.bounces = d.bo; m.lastHitTeam = d.lh; m.live = !!d.lv; m.winner = d.w; if (d.rl != null) m.rally = d.rl;
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
// ---- host away (app switched / tab hidden): the room pauses cleanly and guests see 「等待房主…」 ----
let hostAway = false, hostResumeT = 0, hostAwayMsg = false, waitOn = false;
function showWait(on, sub) { waitOn = on; $('wait').classList.toggle('hide', !on); if (on) $('waitSub').textContent = sub || '連線停頓中…'; }
function onVis() {
  const hidden = document.visibilityState === 'hidden';
  if (!hidden) lastFrame = performance.now(); // no huge dt after coming back (the frame dt is capped as well)
  if (isHost && net && m && (state === 'play' || state === 'end')) {
    if (hidden && !hostAway) { hostAway = true; outbox.length = 0; toAll(snapshot()); toAll({ t: 'away' }); }
    else if (!hidden && hostAway) { hostAway = false; hostResumeT = 0.9; toAll({ t: 'back' }); showMsg('繼續比賽', '', 'info call', 900); }
  } else if (hidden && role === 'local' && state === 'play' && $('pause').classList.contains('hide')) togglePause();
}
document.addEventListener('visibilitychange', onVis); addEventListener('pagehide', () => { if (document.visibilityState !== 'hidden') return; onVis(); });
function clientTick(dt) {
  if (state === 'play' && !waitOn && performance.now() - lastSnapAt > 1600) showWait(true, '沒有收到房主的畫面，等待中…'); // host frozen without a visibility event (e.g. iOS)
  // own movement (client-side prediction), others interpolate, ball dead-reckoning
  for (const p of m.players) {
    if (p.i === mySeat && role === 'client') { const mv = localInput(p); PB.movePlayer(m, p, mv.mx, mv.my, C.SPEED, dt); p.rp = { x: p.x, y: p.y }; continue; }
    if (p.tx == null) continue; const k = 1 - Math.exp(-dt * 16);
    const nx = p.rp.x + (p.tx - p.rp.x) * k, ny = p.rp.y + (p.ty - p.rp.y) * k;
    p.vx = (nx - p.rp.x) / dt; p.vy = (ny - p.rp.y) / dt; p.rp = { x: nx, y: ny }; p.x = nx; p.y = ny;
    if (p.swing > 0) p.swing = Math.max(0, p.swing - dt * 3.2);
  }
  if (m.phase !== 'serve' && !waitOn && performance.now() - lastSnapAt < 400) {
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
  try { frameBody(now); } catch (err) { if (!frame.w2) { frame.w2 = 1; console.warn('frame recovered', err && err.message); } }
}
function frameBody(now) {
  if (FREEZE.frozen) { lastFrame = now; return; }
  let dt = (now - lastFrame) / 1000; lastFrame = now; if (!(dt > 0)) dt = 1 / 60; dt = Math.min(dt, 0.05);
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (m && (state === 'play' || state === 'end')) {
    if (role === 'local' || role === 'host') {
      const me = m.players[mySeat]; if (me && me.ctrl === 'local') localInput(me);
      if (hostResumeT > 0) hostResumeT -= dt;
      if (m.practice) { m.feedWait = PRAC.fed ? 2.5 : 0.8; armTick(me); } // practice: next feed 2.5 s after a point (dead time runs at full speed), or at once on a tap
      if (m.practice) { const tgt = slowNow(me) ? SLOW : 1; TS += (tgt - TS) * (1 - Math.exp(-dt * (tgt < TS ? 14 : 6))); if (Math.abs(TS - tgt) < 0.01) TS = tgt; } else TS = 1;
      if (!paused && !hostAway && !(role === 'host' && hostResumeT > 0)) PB.step(m, dt * TS); // v10/v11: 慢動作 only while the ball is on my side coming at me
      const k = 1 - Math.exp(-dt * 18);
      for (const p of m.players) { if (p.ctrl === 'remote') { p.rp = p.rp ? { x: p.rp.x + (p.x - p.rp.x) * k, y: p.rp.y + (p.y - p.rp.y) * k } : { x: p.x, y: p.y }; } else p.rp = null; }
      const evs = m.events.splice(0); evs.forEach(handleEvent); if (role === 'host') { outbox.push(...evs); hostTick(dt); }
    } else clientTick(dt);
    updAid(); updSmashBtn(); showAid(); updHUD(); placeMsg(false); placeTip(); dimOverBall();
  }
  try { render(dt); } catch (err) { layer = null; if (!frame.warned) { frame.warned = 1; console.warn('render recovered', err && err.message); } }
  if (FREEZE.left >= 0) { if (FREEZE.left === 0) { FREEZE.frozen = true; FREEZE.shot = { ox: juice.ox, oy: juice.oy, flash: juice.flash, shake: juice.shake, amp: juice.amp }; } FREEZE.left--; }
}
resize();
function loop(now) { frame(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// test hooks
window.__pb = { looks: () => ({ room, prefs, rs: roomSeats() }), get m() { return m; }, proj, get view() { return { W, H, F, touchUI, port: PORT, pan: PAN, safe: safeRect(), ballR: lastBallR, tags: lastTags, hud: hudBlock, fpsY }; }, showMsg, get state() { return state; }, get role() { return role; }, get room() { return roomCode; }, get roster() { return roster; }, get net() { return net; }, get fps() { return fps; }, get seat() { return mySeat; }, get forced() { return FORCED; }, appRect, appXY, get orient() { return opt.orient; }, hitCount, startLocal, press, juice, get smashLow() { return smashLowNow; }, contactZ: () => contactZ(m && m.players[mySeat]), get lowTipT() { return lowTipT; }, SL, AID, startPractice, setPracDiff, togglePracSet, setSlow, get slow() { return SLOW; }, get ts() { return TS; }, get armed() { return armedNow(); }, ARM, PRAC, fireSmash: (k) => { for (let i = 0; i < k; i++) smashJuice(1); }, freezeJuice: (k) => { FREEZE.armed = true; FREEZE.at = k | 0; FREEZE.left = -1; FREEZE.frozen = false; }, unfreeze: () => { FREEZE.frozen = false; FREEZE.left = -1; FREEZE.armed = false; FREEZE.aidArm = false; }, hold: () => { FREEZE.frozen = true; }, freezeAid: () => { FREEZE.aidArm = true; }, get freezeOn() { return FREEZE.frozen; }, get freeze() { return FREEZE; }, get cards() { return smashCard.n || 0; } };
if (QS.get('demo') === 'smash') startPractice(); // ?demo=smash opens 殺球練習 directly
})();
