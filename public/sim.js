/* Крышелёт — общая физика и уровни.
   Один и тот же файл работает в браузере (window.Sim) и на сервере (require).
   Сервер перепроигрывает забег по записи нажатий и сам считает время, монеты и финиш,
   поэтому здесь НЕТ Math.sin/cos/exp/atan2 (у разных браузеров они могут отличаться в
   последнем бите) — вместо них свои функции из + − × ÷ и sqrt, они дают одинаковый результат везде. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const hooks = { tr: (k) => k };
const tr = (k) => hooks.tr(k);

/* ---------- детерминированная математика ---------- */
const PI = 3.141592653589793, HALF_PI = PI / 2;
function dsin(x) {
  x = x - 2 * PI * Math.round(x / (2 * PI));          // [-π, π]
  if (x > HALF_PI) x = PI - x; else if (x < -HALF_PI) x = -PI - x;   // [-π/2, π/2]
  const x2 = x * x; let t = x, s = x;
  for (let i = 1; i <= 11; i++) { t *= -x2 / ((2 * i) * (2 * i + 1)); s += t; }
  return s;
}
function dcos(x) { return dsin(x + HALF_PI); }
function dexp(x) {
  let n = 0; while (x > 0.5 || x < -0.5) { x *= 0.5; n++; }
  let t = 1, s = 1; for (let i = 1; i <= 16; i++) { t *= x / i; s += t; }
  while (n-- > 0) s *= s;
  return s;
}
function datanPos(t) {                                   // t >= 0
  let k = 1; while (t > 0.25) { t = t / (1 + Math.sqrt(1 + t * t)); k *= 2; }
  const t2 = t * t; let p = t, s = t;
  for (let i = 1; i <= 12; i++) { p *= -t2; s += p / (2 * i + 1); }
  return s * k;
}
function datan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  let a = ay <= ax ? datanPos(ay / ax) : HALF_PI - datanPos(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

const TAU = Math.PI * 2;
const CFG = { G: 1500, RUN: 250, ACC_G: 2600, ACC_A: 1200, FRIC: 3000, JUMP: 560, PW: 24, PH: 52, L: 38, SWING_G: 800, MAXFALL: 1100, KILLY: 840 };
const PW = CFG.PW, PH = CFG.PH, PK = 1.18;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const wrapAng = (a) => a - TAU * Math.round(a / TAU);

function buildCity() {
  const lv = { solids: [], bars: [], pipes: [], poles: [], coins: [], cps: [], hints: [], pads: [], finish: null };
  const solid = (x, y, w, h, kind) => lv.solids.push({ x, y, w, h: h || 2400, kind: kind || 'roof' });
  const bar = (x, y, w) => lv.bars.push({ kind: 'bar', x, x2: x + w, y });
  const pipe = (x, x2, y) => lv.pipes.push({ kind: 'pipe', x, x2, y });
  const pole = (x, y1, y2) => lv.poles.push({ kind: 'pole', x, y1, y2 });
  const coin = (x, y) => lv.coins.push({ x, y, got: false });
  const arc = (x1, x2, yb, h, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); coin(x1 + (x2 - x1) * t, yb - 4 * h * t * (1 - t)); } };
  const line = (x1, y1, x2, y2, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); coin(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); } };
  const cp = (x, y) => lv.cps.push({ x, y });
  const pad = (x, y, w) => lv.pads.push({ x, y, w, sq: 0 });
  const hint = (x, y, t) => lv.hints.push({ x, y, t });

  // --- 1. Разбег, ящики, пропасть
  cp(90, 460);
  solid(-600, 460, 1500);
  solid(430, 410, 70, 50, 'crate');
  solid(620, 380, 70, 80, 'crate');
  arc(410, 520, 385, 60, 5);
  arc(600, 710, 355, 55, 5);
  arc(900, 1040, 420, 90, 6);
  hint(150, 380, 'Бег · прыжок');
  // --- 2. Шахта: отталкивайся от стен
  cp(1100, 460);
  solid(1040, 460, 710);
  solid(1500, 160, 120, 230, 'stack'); lv.solids[lv.solids.length - 1].floor = 460;
  solid(1750, 160, 300);
  line(1670, 400, 1700, 190, 5);
  hint(1270, 330, 'Шахта: прыгай от стен\nи подтянись на уступ');
  // --- 3. Перекладины
  cp(1990, 160);
  bar(2140, 105, 140);
  bar(2340, 115, 140);
  bar(2540, 125, 140);
  coin(2310, 70); coin(2510, 80); coin(2190, 150); coin(2390, 160); coin(2590, 170);
  hint(2050, 40, 'Перекладины: хват в прыжке\n←→ раскачка · ПРЫЖОК — отпустить');
  // --- 4. Труба
  solid(2720, 210, 440);
  cp(2850, 210);
  pipe(3240, 3620, 130);
  line(3270, 165, 3590, 165, 7);
  hint(3200, 60, 'Труба: ←→ переползать\nПРЫЖОК — спрыгнуть');
  // --- 5. Шесты
  solid(3700, 210, 420);
  cp(3790, 210);
  pole(4230, 40, 460);
  solid(4150, 460, 800);
  pole(4380, 230, 460);
  solid(4410, 240, 150);
  line(4219, 130, 4219, 400, 5);
  line(4369, 290, 4369, 420, 3);
  arc(4420, 4550, 215, 40, 4);
  cp(4300, 460);
  hint(3930, 120, 'Шест: ▲ вверх · ▼ вниз\nПРЫЖОК — спрыгнуть');
  // --- 6. Батут и финальные перекладины
  cp(4590, 460);
  pad(4620, 460, 100);
  line(4670, 360, 4670, 110, 5);
  bar(4650, 80, 120);
  bar(4860, 95, 140);
  bar(5060, 110, 140);
  hint(4560, 330, 'Батут! Держи САЛЬТО\nв воздухе');
  solid(5240, 200, 560);
  lv.finish = { x: 5600, y: 200 };
  return lv;
}

function kit() {
  const lv = { solids: [], bars: [], pipes: [], poles: [], coins: [], cps: [], hints: [], pads: [], finish: null };
  const k = { lv, e: 0, top: 0 };
  k.solid = (x, y, w, kind) => { lv.solids.push({ x, y, w, h: 2400, kind }); k.e = x + w; k.top = y; return x; };
  k.place = (gap, y, w, kind) => k.solid(k.e + gap, y, w, kind);
  k.crate = (x, y, w, h) => lv.solids.push({ x, y, w, h, kind: 'crate' });
  k.stack = (x, y, w, h, floor) => lv.solids.push({ x, y, w, h: Math.max(h, floor - y), kind: 'stack', floor });
  k.bar = (x, y, w) => lv.bars.push({ kind: 'bar', x, x2: x + w, y });
  k.pipe = (x, x2, y) => lv.pipes.push({ kind: 'pipe', x, x2, y });
  k.pole = (x, y1, y2) => lv.poles.push({ kind: 'pole', x, y1, y2 });
  k.coin = (x, y) => lv.coins.push({ x, y, got: false });
  k.arc = (x1, x2, yb, h, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); k.coin(x1 + (x2 - x1) * t, yb - 4 * h * t * (1 - t)); } };
  k.line = (x1, y1, x2, y2, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); k.coin(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); } };
  k.cp = (x, y) => lv.cps.push({ x, y });
  k.pad = (x, y, w) => lv.pads.push({ x, y, w, sq: 0 });
  k.hint = (x, y, t) => lv.hints.push({ x, y, t });
  k.hop = (gap, y, w, kind) => { const a = k.e, pt = k.top, x = k.place(gap, y, w, kind); k.arc(a - 10, x + 20, Math.min(pt, y) - 25, 45, 5); return x; };
  return k;
}
function barsBlock(k, kind, y2) {
  const b = k.e, t = k.top;
  k.hint(b - 0, t - 120, 'Перекладины: хват в прыжке\n←→ раскачка · ПРЫЖОК — отпустить');
  k.bar(b + 90, t - 55, 140); k.bar(b + 290, t - 45, 140); k.bar(b + 490, t - 35, 140);
  for (let i = 0; i < 3; i++) k.coin(b + 140 + 200 * i, t - 10 + i * 10);
  for (let i = 0; i < 2; i++) k.coin(b + 260 + 200 * i, t - 90 + i * 10);
  k.place(670, y2, 440, kind); k.cp(k.e - 330, y2);
}
function pipeBlock(k, kind, y2) {
  const pe = k.e + 80, t = k.top;
  k.hint(pe - 40, t - 150, 'Труба: ←→ переползать\nПРЫЖОК — спрыгнуть');
  k.pipe(pe, pe + 380, t - 80); k.line(pe + 30, t - 45, pe + 350, t - 45, 7);
  k.place(540, y2, 420, kind); k.cp(k.e - 330, y2);
}
function tail(k, gap, y, kind) {
  const x0 = k.place(gap, y, 800, kind);
  k.cp(x0 + 440, y); k.pad(x0 + 470, y, 100);
  k.hint(x0 + 410, y - 130, 'Батут! Держи САЛЬТО\nв воздухе');
  k.line(x0 + 520, y - 100, x0 + 520, y - 350, 5);
  k.bar(x0 + 500, y - 380, 120); k.bar(x0 + 710, y - 365, 140); k.bar(x0 + 910, y - 350, 140);
  const f = k.place(290, y - 260, 560, 'rock'); k.lv.finish = { x: f + 360, y: y - 260 };
  return x0;
}
function buildLake() {
  const k = kit();
  k.cp(90, 440); k.solid(-600, 440, 1100, 'dock'); k.hint(120, 360, 'Бег · прыжок'); k.arc(380, 640, 400, 60, 5);
  k.hop(130, 400, 200, 'rock'); k.hop(130, 400, 240, 'rock'); k.cp(k.e - 100, 400);
  k.hop(130, 400, 260, 'dock'); k.cp(k.e - 130, 400);
  barsBlock(k, 'dock', 450);
  pipeBlock(k, 'dock', 450);
  tail(k, 80, 450, 'dock'); k.lv.killY = 700;
  return k.lv;
}
function buildForest() {
  const k = kit();
  k.cp(90, 440); k.solid(-600, 440, 1000, 'ground'); k.crate(200, 390, 70, 50); k.crate(330, 360, 70, 80); k.hint(100, 360, 'Бег · прыжок');
  k.hop(130, 400, 300, 'ground'); k.cp(k.e - 120, 400);
  const s0 = k.hop(130, 440, 710, 'ground'); k.cp(s0 + 60, 440);
  k.hint(s0 + 130, 330, 'Шахта: прыгай от стен\nи подтянись на уступ');
  k.stack(s0 + 460, 140, 120, 230, 440);
  k.line(s0 + 630, 380, s0 + 660, 170, 5);
  k.place(0, 140, 300, 'ground'); k.cp(k.e - 120, 140);
  barsBlock(k, 'ground', 190);
  pipeBlock(k, 'ground', 190);
  const x0 = tail(k, 30, 440, 'ground');
  k.pole(x0 + 80, 40, 440); k.line(x0 + 69, 130, x0 + 69, 400, 5);
  return k.lv;
}

function box(k, x, y, w, h, kind) { k.lv.solids.push({ x, y, w, h, kind }); k.e = x + w; k.top = y; }
function tree(k, x, g, n) { // ствол + лестница из веток слева
  const top = g - 70 * (n + 1); box(k, x, top, 90, g - top, 'trunk');
  for (let i = 1; i <= n; i++) { const y = g - 70 * i; if (i % 2) box(k, x - 120, y, 120, 14, 'branch'); else box(k, x - 235, y, 105, 14, 'branch'); k.coin(i % 2 ? x - 60 : x - 180, y - 32); }
  k.e = x + 90; k.top = top; return top;
}
function buildForest2() {
  const k = kit(), L = k.lv;
  k.cp(90, 440); k.solid(-600, 440, 1400, 'ground'); k.crate(220, 390, 70, 50); k.crate(360, 360, 70, 80); k.hint(100, 360, 'Бег · прыжок');
  k.hint(480, 330, 'Ветки — как лестница:\nпрыгай вверх по веткам');
  const tA = tree(k, 700, 440, 3); k.cp(745, tA);
  k.hint(850, tA - 110, 'Верёвочный мост\n(с дырами!)');
  box(k, 840, tA, 200, 12, 'plank'); box(k, 1200, tA, 200, 12, 'plank'); box(k, 1560, tA + 25, 160, 12, 'plank');
  k.arc(1040, 1200, tA - 20, 60, 3); k.arc(1400, 1560, tA - 20, 60, 3);
  box(k, 1870, 150, 120, 14, 'branch'); box(k, 2130, 200, 100, 14, 'branch'); box(k, 2370, 140, 80, 14, 'branch');
  k.arc(1720, 1880, 120, 60, 3); k.arc(1970, 2130, 130, 60, 3); k.arc(2210, 2370, 110, 60, 3);
  box(k, 2610, 140, 90, 2400, 'trunk'); box(k, 2700, 140, 190, 2400, 'house'); k.cp(2760, 140);
  k.pole(3030, 60, 360); k.pole(3200, 40, 340); k.pole(3380, 70, 350); k.line(3019, 120, 3019, 320, 4); k.line(3189, 100, 3189, 300, 4); k.line(3369, 130, 3369, 310, 4);
  k.solid(3540, 440, 900, 'ground'); k.cp(3600, 440);
  k.hint(3640, 340, 'Высокое дерево:\nне оступись');
  const tC = tree(k, 3900, 440, 5); k.cp(3945, tC);
  box(k, 4150, tC, 110, 14, 'branch'); box(k, 4400, tC - 50, 80, 14, 'branch'); box(k, 4640, tC, 80, 14, 'branch');
  k.arc(3990, 4150, tC - 30, 60, 3); k.arc(4240, 4400, tC - 80, 60, 3); k.arc(4480, 4640, tC - 30, 60, 3);
  k.bar(4890, tC - 60, 140); k.bar(5120, tC - 50, 140); k.bar(5350, tC - 40, 140); k.bar(5580, tC - 50, 140);
  for (let i = 0; i < 4; i++) k.coin(4960 + i * 230, tC - 100 + (i % 2) * 8);
  box(k, 5840, tC + 40, 500, 2400, 'ground'); k.cp(5900, tC + 40); L.finish = { x: 6200, y: tC + 40 };
  return L;
}
function buildMountain() {
  const k = kit(), L = k.lv; L.killY = 760;
  k.cp(90, 440); k.solid(-600, 440, 1000, 'snow'); k.hint(100, 360, 'Бег · прыжок');
  k.hop(135, 380, 140, 'snow'); k.hop(135, 320, 120, 'snow'); k.hop(135, 260, 110, 'snow'); k.cp(k.e - 60, 260);
  let e = k.e; k.hint(e + 10, 160, 'Шахта: прыгай от стен\nи подтянись на уступ');
  k.solid(e, 260, 250, 'snow'); box(k, e + 30, 60, 100, 200, 'cliff'); k.solid(e + 250, 20, 315, 'snow'); k.line(e + 190, 230, e + 200, 60, 5); k.cp(e + 400, 20); k.e = e + 565;
  const f = k.e; const ys = [20, -20, 10, -40, -10, -60];
  ys.forEach((y, i) => { box(k, f + 160 + i * 250, y, 110, 18, 'ice'); k.arc(f + 160 + i * 250 - 160, f + 160 + i * 250, Math.min(y, i ? ys[i - 1] : 20) - 30, 50, 3); });
  k.cp(f + 160 + 5 * 250 + 50, -60);
  const m = f + 160 + 5 * 250 + 110; k.hint(m + 60, -230, 'Перекладины над бездной');
  const by = [-170, -160, -150, -160, -170]; by.forEach((y, i) => { k.bar(m + 150 + i * 230, y, 140); k.coin(m + 220 + i * 230, y - 40); });
  const n = m + 150 + 4 * 230 + 140 + 150; box(k, n, -40, 260, 12, 'plank'); box(k, n + 420, -40, 260, 12, 'plank'); k.arc(n + 260, n + 420, -70, 50, 3);
  const q = n + 840; k.solid(q, -40, 260, 'snow'); k.cp(q + 60, -40); k.hint(q, -140, 'Вторая шахта');
  box(k, q + 30, -280, 100, 240, 'cliff'); k.solid(q + 250, -290, 300, 'snow'); k.line(q + 190, -80, q + 200, -250, 5); k.cp(q + 400, -290);
  const r = q + 550; [-330, -365, -330].forEach((y, i) => box(k, r + 160 + i * 250, y, 100, 18, 'ice'));
  const z = r + 900; box(k, z, -380, 500, 2400, 'snow'); L.finish = { x: z + 350, y: -380 };
  return L;
}
function buildSpace() {
  const k = kit(), L = k.lv; L.grav = 0.45; L.killY = 1000;
  k.cp(120, 440); box(k, -600, 440, 1100, 60, 'station'); k.hint(100, 360, 'Бег · прыжок'); k.hint(560, 330, 'Космос: малая гравитация,\nпрыжки очень высокие');
  box(k, 850, 420, 110, 40, 'asteroid'); box(k, 1280, 360, 110, 40, 'asteroid'); box(k, 1700, 270, 110, 40, 'asteroid');
  k.arc(500, 850, 340, 130, 4); k.arc(960, 1280, 300, 130, 4); k.arc(1390, 1700, 230, 130, 4);
  box(k, 2150, 200, 300, 50, 'station'); k.cp(2200, 200); k.hint(2160, 100, 'Станция: от стены вверх,\nрельсы — перекладины');
  box(k, 2550, -80, 70, 2400, 'pylon');
  const bys = [-150, -140, -130, -140, -150]; bys.forEach((y, i) => { k.bar(2800 + i * 230, y, 140); k.coin(2870 + i * 230, y - 40); });
  box(k, 4050, -100, 300, 50, 'station'); k.cp(4100, -100);
  [[4650, -200], [5060, -120], [5470, -220], [5880, -140]].forEach(([x, y], i, A) => { box(k, x, y, 100, 40, 'asteroid'); k.arc(i ? A[i - 1][0] + 100 : 4350, x, Math.min(y, i ? A[i - 1][1] : -100) - 50, 110, 4); });
  k.cp(5900, -140);
  box(k, 6320, -100, 600, 60, 'station'); L.finish = { x: 6650, y: -100 };
  return L;
}
function buildOcean() {
  const k = kit(), L = k.lv; L.grav = 0.4; L.maxfall = 480; L.killY = 900;
  k.cp(100, 520); k.solid(-600, 520, 1400, 'sand'); k.hint(100, 440, 'Бег · прыжок'); k.hint(420, 400, 'Под водой: плавные прыжки,\nвсё медленнее');
  box(k, 1130, 440, 100, 2400, 'coral'); box(k, 1560, 360, 100, 2400, 'coral'); box(k, 1990, 300, 90, 2400, 'coral'); k.cp(2020, 300);
  k.arc(800, 1130, 360, 100, 4); k.arc(1230, 1560, 300, 100, 4); k.arc(1660, 1990, 240, 100, 4);
  k.hint(2200, 120, 'Водоросли: перелезай\nс одной на другую');
  k.pole(2330, 120, 520); k.pole(2600, 100, 520); k.pole(2870, 130, 520); [2330, 2600, 2870].forEach(x => k.line(x - 11, 170, x - 11, 400, 4));
  box(k, 3140, 380, 280, 2400, 'wreck'); k.cp(3200, 380);
  const bys = [250, 240, 230, 240, 250]; bys.forEach((y, i) => { k.bar(3560 + i * 230, y, 140); k.coin(3630 + i * 230, y - 40); });
  [[4850, 300], [5230, 230], [5610, 300], [5990, 230]].forEach(([x, y]) => box(k, x, y, 90, 2400, 'coral')); k.cp(5260, 230);
  box(k, 6400, 280, 500, 2400, 'coral'); L.finish = { x: 6700, y: 280 };
  return L;
}


function newState(lv) {
  resetLevel(lv);
  const S = {
    lv, t: 0, time: 0, score: 0, coins: 0, combo: 0, comboT: 0, bestCombo: 0, tricks: 0, deaths: 0, bonus: 0,
    done: false, doneT: 0, autoGrab: false, cpIndex: 0, fade: 0, shake: 0, popups: [], parts: [], onSfx: null,
    inp: { left: false, right: false, up: false, down: false, jump: false, jumpPressed: false, grab: false, flip: false, flipBack: false },
    p: null,
  };
  spawn(S);
  return S;
}

function spawn(S) {
  const c = S.lv.cps[S.cpIndex];
  S.p = {
    x: c.x - PW / 2, y: c.y - PH, prevY: c.y - PH, vx: 0, vy: 0, face: 1, ground: true, mode: 'free',
    rot: 0, rotV: 0, flipMax: 0, air: 0, coyote: 0, jbuf: 0, regrab: 0, ignore: null, ignoreT: 0, stun: 0, roll: 0,
    cutOK: false, padCD: 0, hang: null, pole: null, ledge: null, mt: 0, mx0: 0, my0: 0, mx1: 0, my1: 0,
    wallDir: 0, lastBarT: -9, chain: 0, anim: 0,
  };
}

const sfx = (S, n) => { if (S.onSfx) S.onSfx(n); };
function popup(S, text, kind) { if (S.noFx) return; S.popups.push({ text, kind: kind || 'good', x: S.p.x + PW / 2, y: S.p.y - 14, t: 0 }); }
function burst(S, x, y, n, color, sp) {
  if (S.noFx) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = (0.3 + Math.random() * 0.7) * sp;
    S.parts.push({ x, y, vx: dcos(a) * v, vy: dsin(a) * v - sp * 0.3, t: 0, life: 0.4 + Math.random() * 0.4, c: color });
  }
}
function trick(S, name, pts) {
  S.combo++; S.comboT = 5; S.tricks++;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  const mult = Math.min(1 + 0.25 * (S.combo - 1), 4);
  const add = Math.round(pts * mult);
  S.score += add;
  popup(S, name + (mult > 1 ? ' x' + (Math.round(mult * 100) / 100) : '') + ' +' + add, 'trick');
  sfx(S, 'trick');
}

function solidAt(S, x, y, w, h) {
  const a = S.lv.solids;
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) return s;
  }
  return null;
}
function moveX(S, p, dx) {
  p.x += dx;
  const s = solidAt(S, p.x, p.y, PW, PH);
  if (s) { if (dx > 0) p.x = s.x - PW; else if (dx < 0) p.x = s.x + s.w; p.vx = 0; return s; }
  return null;
}
function moveY(S, p, dy) {
  p.y += dy;
  const s = solidAt(S, p.x, p.y, PW, PH);
  if (s) {
    if (dy > 0) { p.y = s.y - PH; return { hit: s, down: true }; }
    if (dy < 0) { p.y = s.y + s.h; return { hit: s, down: false }; }
  }
  return null;
}

function onLand(S, impact) {
  const p = S.p;
  const dev = p.rot - Math.round(p.rot / TAU) * TAU;
  const spinning = Math.abs(p.rot) > 0.5 || Math.abs(p.rotV) > 1;
  const bad = spinning && Math.abs(dev) > 1.05;
  const flips = Math.abs(Math.round(p.rot / TAU));
  const dirHeld = S.inp.left || S.inp.right;
  if (bad) {
    p.stun = 0.55; p.vx *= 0.25; S.combo = 0; S.comboT = 0; S.shake = 6;
    popup(S, tr('Неудачное приземление'), 'bad'); sfx(S, 'bad');
  } else {
    if (flips > 0) { S.flipLog = (S.flipLog || []).filter(t => S.t - t < 25); const fp = Math.round(flips * 150 / (1 + S.flipLog.length * 1.5)); S.flipLog.push(S.t); if (fp >= 20) trick(S, tr(flips === 1 ? 'Сальто' : flips === 2 ? 'Двойное сальто' : 'Тройное сальто!'), fp); }
    if (impact > 700) {
      if (dirHeld) { p.roll = 0.4; trick(S, tr('Перекат'), 25); }
      else if (impact > 880) { p.stun = 0.3; p.vx = 0; S.shake = 4; }
    }
  }
  if (impact > 300) { burst(S, p.x + PW / 2, p.y + PH, 6, '#d9dce8', 120); sfx(S, 'land'); }
  p.rot = 0; p.rotV = 0; p.flipMax = 0; p.air = 0;
}

function tryGrab(S) {
  const p = S.p, lv = S.lv;
  if (p.ground || p.regrab > 0 || p.stun > 0) return false;
  if (!(S.autoGrab || S.inp.grab)) return false;
  const hx = p.x + PW / 2, hy = p.y - 10, hy0 = p.prevY - 10;
  const lo = Math.min(hy, hy0) - 8, hi = Math.max(hy, hy0) + 8;
  const test = (o) => !(o === p.ignore && p.ignoreT > 0) && hx >= o.x - 6 && hx <= o.x2 + 6 && o.y >= lo && o.y <= hi;
  let o = null;
  for (let i = 0; i < lv.bars.length && !o; i++) if (test(lv.bars[i])) o = lv.bars[i];
  for (let i = 0; i < lv.pipes.length && !o; i++) if (test(lv.pipes[i])) o = lv.pipes[i];
  if (o) { startHang(S, o); return true; }
  for (let i = 0; i < lv.poles.length; i++) {
    const q = lv.poles[i];
    if (q === p.ignore && p.ignoreT > 0) continue;
    const py = p.y - 6;
    if (Math.abs(hx - q.x) < 12 && py > q.y1 - 4 && py < q.y2 - 20) { startPole(S, q); return true; }
  }
  return false;
}

function startHang(S, o) {
  const p = S.p;
  const hx = p.x + PW / 2, cx = hx, cy = p.y + PH / 2;
  const px = clamp(hx, o.x + 4, o.x2 - 4), py = o.y;
  let th = 0, om = 0;
  if (o.kind === 'bar') {
    const dx = cx - px, dy = cy - py;
    th = dx * dx + dy * dy < 64 ? 0 : datan2(dx, dy);
    om = clamp((p.vx * dcos(th) - p.vy * dsin(th)) / CFG.L, -10, 10);
    if (S.t - p.lastBarT < 1.5) { p.chain++; if (!o.hopped) { o.hopped = true; trick(S, tr('Перелёт'), 100 * Math.min(p.chain, 3)); } } else p.chain = 0;
  } else { om = clamp(p.vx / CFG.L * 0.3, -2, 2); }
  p.mode = 'hang';
  p.hang = { o, px, py, th, om, rev: 0, t0: S.t };
  p.vx = 0; p.vy = 0; p.rotV = 0; p.rot = -th; p.ground = false; p.air = 0; p.flipMax = 0;
  sfx(S, 'grab');
}

function startPole(S, o) {
  const p = S.p;
  const cx = p.x + PW / 2;
  const side = sgn(o.x - cx) || p.face;
  p.mode = 'pole'; p.pole = { o, side }; p.face = side;
  p.vx = 0; p.vy = 0; p.rot = 0; p.rotV = 0; p.ground = false; p.flipMax = 0; p.air = 0;
  p.x = o.x - side * 13 - PW / 2;
  p.y = Math.max(p.y, o.y1 + 6);
  sfx(S, 'grab');
}

function tryLedge(S, dir) {
  const p = S.p;
  if (p.ground || p.regrab > 0 || p.stun > 0 || p.vy < -150) return false;
  const f = p.face;
  if (!(dir === f || Math.abs(p.vx) > 20 && sgn(p.vx) === f || p.wallDir === f)) return false;
  const px = f > 0 ? p.x + PW : p.x - 1;
  const s = solidAt(S, px, p.y + 2, 1, 8);
  if (!s) return false;
  if (!(s.y > p.y - 18 && s.y < p.y + 10)) return false;
  if (solidAt(S, px, s.y - 4, 1, 3)) return false;
  const ex = f > 0 ? s.x + 2 : s.x + s.w - PW - 2;
  if (solidAt(S, ex, s.y - PH, PW, PH - 1)) return false;
  p.mode = 'ledge'; p.ledge = { s, f };
  p.x = f > 0 ? s.x - PW : s.x + s.w;
  p.y = s.y + 10;
  p.vx = 0; p.vy = 0; p.rot = 0; p.rotV = 0; p.flipMax = 0; p.air = 0;
  sfx(S, 'grab');
  return true;
}

function freeStep(S, dir, dt) {
  const p = S.p, inp = S.inp, lv = S.lv;
  const stunned = p.stun > 0;
  const d = stunned ? 0 : dir;
  p.wallDir = 0;
  if (!p.ground) {
    if (solidAt(S, p.x - 2, p.y + 6, 2, PH - 12)) p.wallDir = -1;
    else if (solidAt(S, p.x + PW, p.y + 6, 2, PH - 12)) p.wallDir = 1;
  }
  if (p.ground) p.coyote = 0.1; else p.coyote -= dt;
  if (d && p.roll <= 0) p.face = d;

  // горизонталь
  if (p.roll > 0 && p.ground) {
    p.vx = p.face * Math.max(Math.abs(p.vx), CFG.RUN * 1.05);
  } else if (p.ground) {
    p.vx = approach(p.vx, d * CFG.RUN, (d ? CFG.ACC_G : CFG.FRIC) * dt);
  } else if (d && sgn(p.vx) === d && Math.abs(p.vx) >= CFG.RUN) {
    /* сохраняем импульс */
  } else if (d) p.vx = approach(p.vx, d * CFG.RUN, CFG.ACC_A * dt);
  else p.vx = approach(p.vx, 0, 120 * dt);

  // прыжок
  if (p.jbuf > 0 && !stunned) {
    if (p.coyote > 0) {
      p.vy = -CFG.JUMP; p.ground = false; p.coyote = 0; p.jbuf = 0; p.cutOK = true; p.air = 0;
      sfx(S, 'jump'); burst(S, p.x + PW / 2, p.y + PH, 4, '#d9dce8', 80);
    } else if (!p.ground && p.wallDir !== 0) {
      p.vx = -p.wallDir * 270; p.vy = -560; p.face = -p.wallDir; p.jbuf = 0; p.cutOK = true; p.regrab = 0.1;
      sfx(S, 'jump'); burst(S, p.x + PW / 2 + p.wallDir * 10, p.y + PH / 2, 4, '#d9dce8', 80);
    }
  }
  // скольжение по стене
  if (!p.ground && p.wallDir !== 0 && p.vy > 0 && d === p.wallDir) p.vy = Math.min(p.vy, 90);

  // сальто
  if (!p.ground) {
    p.air += dt;
    const fd = stunned ? 0 : inp.flip ? p.face : inp.flipBack ? -p.face : 0;
    if (fd) p.rotV = approach(p.rotV, fd * 10.5, 80 * dt);
    else {
      p.rotV *= dexp(-2.5 * dt);
      if (Math.abs(p.rotV) < 3.5) { const n = Math.round(p.rot / TAU) * TAU; p.rot += (n - p.rot) * Math.min(1, 7 * dt); }
    }
    p.rot += p.rotV * dt;
    const idx = Math.abs(Math.round(p.rot / TAU));
    if (idx > p.flipMax) { p.flipMax = idx; sfx(S, 'flip'); }
  }

  // гравитация
  p.vy = Math.min(p.vy + CFG.G * (lv.grav || 1) * dt, lv.maxfall || CFG.MAXFALL);
  if (p.cutOK && !inp.jump && p.vy < -220) p.vy = -220;

  moveX(S, p, p.vx * dt);
  const wasAir = !p.ground;
  p.ground = false;
  const r = moveY(S, p, p.vy * dt);
  if (r) {
    if (r.down) { const impact = p.vy; p.ground = true; p.vy = 0; if (wasAir) onLand(S, impact); }
    else p.vy = 0;
  }
  if (p.ground) p.anim += dt * Math.max(0.3, Math.abs(p.vx) / CFG.RUN);

  // батут
  if (p.ground && p.padCD <= 0) {
    const cx = p.x + PW / 2;
    for (const pd of lv.pads) {
      if (cx >= pd.x && cx <= pd.x + pd.w && Math.abs(p.y + PH - pd.y) < 3) {
        p.vy = inp.jump ? -1150 : -1020; p.ground = false; p.coyote = 0; p.cutOK = false; p.padCD = 0.3; p.air = 0; pd.sq = 0.35;
        sfx(S, 'boing'); burst(S, cx, p.y + PH, 8, '#ef476f', 140);
      }
    }
  }

  // хваты
  if (!p.ground) {
    if (tryGrab(S)) return;
    if (tryLedge(S, d)) return;
  } else if (inp.up && !stunned && p.regrab <= 0) {
    const cx = p.x + PW / 2;
    for (const q of lv.poles) {
      if (Math.abs(cx - q.x) < 16 && p.y + PH > q.y1 + 20 && p.y + PH <= q.y2 + 2) { startPole(S, q); return; }
    }
  }
}

function releaseHang(S, boost) {
  const p = S.p, h = p.hang, o = h.o, inp = S.inp;
  let vx = 0, vy = 0;
  if (o.kind === 'bar') {
    const sp = CFG.L * h.om;
    vx = sp * dcos(h.th); vy = -sp * dsin(h.th);
    if (boost) { vx *= 1.1; vy = vy * 1.1 - 230; }
    p.rotV = -h.om * 0.6;
    p.lastBarT = S.t;
  } else {
    const d = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (boost) { vx = d ? d * 230 : p.face * 60; vy = -540; }
    p.rotV = 0;
  }
  p.vx = vx; p.vy = vy;
  if (Math.abs(vx) > 40) p.face = sgn(vx);
  p.rot = wrapAng(-h.th);
  p.flipMax = Math.abs(Math.round(p.rot / TAU));
  p.hang = null; p.mode = 'free'; p.ground = false; p.coyote = 0; p.regrab = 0.3; p.ignore = o; p.ignoreT = 0.7;
  p.cutOK = false; p.air = 0; p.jbuf = 0;
  sfx(S, boost ? 'jump' : 'release');
}

function hangStep(S, dir, dt) {
  const p = S.p, h = p.hang, o = h.o;
  const prevTh = h.th, prevPx = h.px;
  if (o.kind === 'bar') {
    let acc = -(CFG.SWING_G / CFG.L) * dsin(h.th);
    if (dir) { const same = sgn(h.om) === dir || Math.abs(h.om) < 0.5; acc += dir * (same ? 15 : 6); }
    h.om += acc * dt; h.om *= 1 - 0.1 * dt; h.om = clamp(h.om, -11.5, 11.5);
    h.th += h.om * dt;
    h.rev += h.om * dt;
    if (Math.abs(h.rev) >= TAU) { h.rev -= sgn(h.rev) * TAU; h.o.paid = (h.o.paid || 0) + 1; if (h.o.paid <= 3) trick(S, tr('Большой оборот'), [0, 200, 100, 60][h.o.paid]); }
    if (Math.abs(h.om) > 0.8) p.face = sgn(h.om);
  } else {
    h.px = clamp(h.px + dir * 115 * dt, o.x + 2, o.x2 - 2);
    const lean = dir * 0.28;
    h.om += ((lean - h.th) * 70 - h.om * 9) * dt;
    h.th += h.om * dt;
    if (dir) p.face = dir;
  }
  let nx = h.px + CFG.L * dsin(h.th) - PW / 2, ny = h.py + CFG.L * dcos(h.th) - PH / 2;
  if (S.t - h.t0 > 0.12 && solidAt(S, nx + 3, ny + 4, PW - 6, PH - 8)) {
    h.th = prevTh; h.px = prevPx; h.om = -h.om * 0.3;
    nx = h.px + CFG.L * dsin(h.th) - PW / 2; ny = h.py + CFG.L * dcos(h.th) - PH / 2;
  }
  p.x = nx; p.y = ny; p.rot = -h.th;
  if (p.jbuf > 0) { releaseHang(S, true); return; }
  if (S.inp.down || !(S.autoGrab || S.inp.grab)) releaseHang(S, false);
}

function poleStep(S, dir, dt) {
  const p = S.p, o = p.pole.o, side = p.pole.side, inp = S.inp;
  p.rot = 0; p.face = side;
  let v = 70;
  if (inp.up) v = -125; else if (inp.down) v = 260;
  p.x = o.x - side * 13 - PW / 2;
  if (p.jbuf > 0) {
    p.jbuf = 0;
    p.mode = 'free'; p.pole = null; p.ground = false; p.coyote = 0; p.regrab = 0.25; p.ignore = o; p.ignoreT = 0.5;
    if (dir) { p.vx = dir * 270; p.face = dir; } else p.vx = -side * 90;
    p.vy = -540; p.cutOK = false; p.air = 0;
    sfx(S, 'jump');
    return;
  }
  if (!(S.autoGrab || inp.grab) && !inp.up && !inp.down) {
    /* без автохвата нужно держать GRAB */
    p.mode = 'free'; p.pole = null; p.regrab = 0.3; p.ignore = o; p.ignoreT = 0.5; p.vx = 0; p.vy = 0; p.ground = false;
    return;
  }
  const r = moveY(S, p, v * dt);
  if (p.y - 6 < o.y1) p.y = o.y1 + 6;
  if (r && r.down) {
    p.mode = 'free'; p.pole = null; p.ground = true; p.vy = 0; p.regrab = 0.2; p.ignore = o; p.ignoreT = 0.4; sfx(S, 'land');
    return;
  }
  if (p.y + PH >= o.y2 - 0.5) {
    p.y = o.y2 - PH;
    p.mode = 'free'; p.pole = null; p.ground = false; p.vy = 0; p.regrab = 0.3; p.ignore = o; p.ignoreT = 0.5;
  }
}

function ledgeStep(S, dir, dt) {
  const p = S.p, L = p.ledge, inp = S.inp;
  p.rot = 0; p.face = L.f;
  if (p.jbuf > 0 && dir === -L.f) {
    p.jbuf = 0; p.mode = 'free'; p.ledge = null; p.ground = false; p.regrab = 0.3;
    p.vx = -L.f * 270; p.vy = -540; p.face = -L.f; p.cutOK = false; p.air = 0; sfx(S, 'jump');
    return;
  }
  if (p.jbuf > 0 || inp.up) {
    p.jbuf = 0; p.mode = 'mantle'; p.mt = 0;
    p.mx0 = p.x; p.my0 = p.y;
    p.mx1 = L.f > 0 ? L.s.x + 2 : L.s.x + L.s.w - PW - 2;
    p.my1 = L.s.y - PH;
    return;
  }
  if (dir === -L.f || inp.down) {
    p.mode = 'free'; p.ledge = null; p.ground = false; p.regrab = 0.3; p.vx = -L.f * 40; p.vy = 0; p.air = 0;
  }
}

function mantleStep(S, dt) {
  const p = S.p;
  p.mt += dt;
  const u = Math.min(1, p.mt / 0.3);
  p.y = p.my0 + (p.my1 - p.my0) * Math.min(1, u / 0.65);
  p.x = p.mx0 + (p.mx1 - p.mx0) * Math.max(0, (u - 0.45) / 0.55);
  if (u >= 1) {
    const lg = p.ledge; p.mode = 'free'; p.ledge = null; p.ground = true; p.vx = 0; p.vy = 0; p.x = p.mx1; p.y = p.my1; p.regrab = 0.1;
    const ls = lg && lg.s; if (!ls || typeof ls !== 'object') trick(S, tr('Подтяг'), 25); else if (!ls.paid) { ls.paid = true; trick(S, tr('Подтяг'), 25); }
  }
}

function die(S) {
  S.deaths++; S.combo = 0; S.comboT = 0; S.fade = 1; sfx(S, 'fall');
  spawn(S);
}

function step(S, dt) {
  const p = S.p, inp = S.inp, lv = S.lv;
  S.t += dt;
  if (!S.done) S.time += dt; else S.doneT += dt;
  if (S.fade > 0) S.fade = Math.max(0, S.fade - dt * 2);
  if (S.shake > 0) S.shake = Math.max(0, S.shake - 40 * dt);
  if (S.done) { inp.left = inp.right = inp.up = inp.down = inp.jump = inp.jumpPressed = inp.flip = inp.flipBack = false; }
  p.prevY = p.y;
  p.jbuf = inp.jumpPressed ? 0.13 : p.jbuf - dt;
  p.regrab -= dt; p.ignoreT -= dt; p.stun -= dt; p.padCD -= dt;
  if (p.roll > 0) p.roll -= dt;
  if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  switch (p.mode) {
    case 'free': freeStep(S, dir, dt); break;
    case 'hang': hangStep(S, dir, dt); break;
    case 'pole': poleStep(S, dir, dt); break;
    case 'ledge': ledgeStep(S, dir, dt); break;
    case 'mantle': mantleStep(S, dt); break;
  }
  inp.jumpPressed = false;

  const cx = p.x + PW / 2, cy = p.y + PH / 2;
  for (const [ci, c] of lv.coins.entries()) {
    if (!c.got && Math.abs(c.x - cx) < 24 && Math.abs(c.y - cy) < 28) {
      c.got = true; S.coins++; S.score += 10; sfx(S, 'coin'); if (S.onCoin) S.onCoin(ci); burst(S, c.x, c.y, 5, '#ffd166', 120);
    }
  }
  for (let i = S.cpIndex + 1; i < lv.cps.length; i++) {
    const c = lv.cps[i];
    if (Math.abs(cx - c.x) < 40 && Math.abs(p.y + PH - c.y) < 160) { S.cpIndex = i; sfx(S, 'cp'); popup(S, tr('Чекпоинт'), 'good'); }
  }
  for (const pd of lv.pads) if (pd.sq > 0) pd.sq -= dt;
  if (!S.done && cx > lv.finish.x) {
    S.done = true; S.doneT = 0;
    S.bonus = Math.max(0, Math.round(6000 - S.time * 15));
    S.score += S.bonus; sfx(S, 'win'); if (S.onFinish) S.onFinish();
  }
  if (p.x < -570) { p.x = -570; if (p.vx < 0) p.vx = 0; }
  const mx = lv.maxX || 5770; if (p.x > mx) { p.x = mx; if (p.vx > 0) p.vx = 0; }
  if (p.y > (lv.killY || CFG.KILLY)) die(S);

  for (let i = S.popups.length - 1; i >= 0; i--) { const q = S.popups[i]; q.t += dt; q.y -= 28 * dt; if (q.t > 1.6) S.popups.splice(i, 1); }
  for (let i = S.parts.length - 1; i >= 0; i--) {
    const q = S.parts[i]; q.t += dt; q.vy += 700 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.t > q.life) S.parts.splice(i, 1);
  }
}

/* ---------- новые главы 7–11 ---------- */
function shaftBlock(k, kind, floorY, topY) {            // платформа, колонна и стена: прыгай от стен вверх
  const s0 = k.hop(130, floorY, 710, kind); k.cp(s0 + 60, floorY);
  k.hint(s0 + 130, floorY - 110, 'Шахта: прыгай от стен\nи подтянись на уступ');
  k.stack(s0 + 460, topY, 120, 230, floorY); k.line(s0 + 630, floorY - 60, s0 + 660, topY + 30, 5);
  k.place(0, topY, 300, kind); k.cp(k.e - 120, topY);
  return s0;
}
function buildFactory() {
  const k = kit(), L = k.lv; L.killY = 780;
  k.cp(90, 440); k.solid(-600, 440, 1200, 'steel'); k.crate(260, 390, 70, 50); k.crate(420, 340, 70, 100);
  k.hint(100, 360, 'Бег · прыжок'); k.hint(300, 250, 'Завод: ящики — ступени,\nвнизу пропасть');
  k.arc(230, 520, 320, 70, 5);
  k.hop(140, 440, 220, 'steel'); k.hop(150, 400, 180, 'steel'); k.cp(k.e - 90, 400); k.hop(150, 440, 200, 'steel');
  pipeBlock(k, 'steel', 440);
  shaftBlock(k, 'steel', 440, 160);
  barsBlock(k, 'steel', 210);
  // батут на высокую балку
  const px = k.e - 140; k.pad(px, 210, 100); k.hint(px - 60, 100, 'Батут — на верхнюю балку');
  k.place(210, -80, 340, 'steel'); k.cp(k.e - 200, -80); k.line(px + 150, 40, px + 300, -120, 5);
  // шесты вниз, потом дорожка
  const e = k.e; k.hint(e + 40, -200, 'Шесты: ▼ вниз');
  k.pole(e + 130, -250, 220); k.pole(e + 310, -250, 220);
  k.solid(e + 60, 240, 560, 'steel'); k.cp(e + 120, 240);
  tail(k, 120, 440, 'steel');
  return L;
}
function buildDesert() {
  const k = kit(), L = k.lv; L.killY = 760;
  k.cp(90, 440); k.solid(-600, 440, 1100, 'sand'); k.hint(100, 360, 'Бег · прыжок'); k.arc(380, 640, 400, 60, 5);
  k.hop(150, 410, 170, 'sand'); k.hop(150, 370, 160, 'sand'); k.cp(k.e - 80, 370); k.hop(150, 410, 170, 'sand'); k.hop(150, 440, 200, 'sand');
  // колонны из песчаника разной высоты
  [[440, 90], [370, 90], [300, 90], [370, 90]].forEach(([y, w], i, A) => { const a = k.e; k.place(150, y, w, 'sandstone'); k.arc(a - 20, k.e - w + 20, Math.min(y, i ? A[i - 1][0] : 440) - 30, 50, 3); });
  k.cp(k.e - 60, 370);
  k.place(150, 440, 260, 'sand');
  // кактусы-шесты: спуск вниз, потом подъём на мезу
  const a = k.e; k.hint(a, 330, 'Кактусы: ▲ вверх · ▼ вниз');
  k.pole(a + 140, 300, 560); k.solid(a + 80, 560, 650, 'sand'); k.cp(a + 150, 560);
  k.pole(a + 700, 290, 560); k.line(a + 689, 350, a + 689, 520, 4);
  box(k, a + 730, 300, 420, 2400 - 300, 'sandstone'); k.cp(a + 800, 300);
  barsBlock(k, 'sand', 350);
  pipeBlock(k, 'sand', 350);
  tail(k, 60, 450, 'sand');
  return L;
}
function buildVolcano() {
  const k = kit(), L = k.lv; L.killY = 600;
  k.cp(90, 440); k.solid(-600, 440, 900, 'basalt'); k.hint(100, 360, 'Бег · прыжок'); k.hint(330, 330, 'Вулкан: внизу лава,\nплатформы всё уже');
  [[380, 130], [340, 110], [380, 100], [300, 100], [350, 90]].forEach(([y, w], i, A) => { const a = k.e; k.place(150, y, w, 'basalt'); k.arc(a - 10, k.e - w + 10, Math.min(y, i ? A[i - 1][0] : 440) - 30, 55, 3); });
  k.cp(k.e - 40, 350);
  k.place(150, 400, 260, 'basalt'); k.cp(k.e - 120, 400);
  // перекладины над лавой
  const b = k.e, t = k.top; k.hint(b, t - 130, 'Перекладины над лавой');
  [0, 1, 2, 3, 4].forEach((i) => { k.bar(b + 90 + i * 220, t - 50 + (i % 2) * 12, 140); k.coin(b + 160 + i * 220, t - 90); });
  k.place(1230, t, 300, 'basalt'); k.cp(k.e - 200, t);
  shaftBlock(k, 'basalt', 400, 110);
  // уступы вверх, затем три шеста над пропастью
  [[60, 100], [20, 90], [60, 90]].forEach(([y, w]) => { const a = k.e; k.place(150, y, w, 'basalt'); k.arc(a, k.e - w, y - 50, 50, 3); });
  k.cp(k.e - 40, 60);
  const tp = k.e; k.hint(tp + 20, -80, 'Шесты над лавой');
  k.pole(tp + 160, -120, 330); k.pole(tp + 330, -120, 330); k.pole(tp + 500, -120, 330);
  k.line(tp + 149, -60, tp + 149, 280, 4);
  k.solid(tp + 600, 330, 700, 'basalt'); k.cp(tp + 680, 330);
  const f = k.solid(k.e + 200, 280, 500, 'basalt'); k.cp(f + 80, 280);
  L.finish = { x: f + 350, y: 280 };
  return L;
}
function buildSky() {
  const k = kit(), L = k.lv; L.grav = 0.7; L.killY = 820;
  k.cp(90, 440); k.solid(-600, 440, 1000, 'island'); k.hint(100, 360, 'Бег · прыжок'); k.hint(380, 320, 'Небо: гравитация меньше,\nострова далеко друг от друга');
  [[420, 180], [380, 160], [340, 170], [390, 150]].forEach(([y, w], i, A) => { const a = k.e; k.place(190, y, w, 'island'); k.arc(a - 10, k.e - w + 10, Math.min(y, i ? A[i - 1][0] : 440) - 40, 80, 4); });
  k.cp(k.e - 60, 390);
  [[330, 90], [290, 90], [250, 90], [290, 90], [330, 90]].forEach(([y, w]) => { const a = k.e; k.place(210, y, w, 'cloud'); k.arc(a, k.e - w, y - 70, 90, 4); });
  k.cp(k.e - 40, 330);
  k.place(210, 380, 300, 'island'); k.cp(k.e - 150, 380);
  // перекладины между островами
  const b = k.e, t = k.top; k.hint(b, t - 150, 'Перекладины над облаками');
  [0, 1, 2, 3, 4, 5].forEach((i) => { k.bar(b + 110 + i * 260, t - 70 - (i % 3) * 14, 140); k.coin(b + 180 + i * 260, t - 120); });
  k.place(1750, t, 320, 'island'); k.cp(k.e - 240, t);
  // батуты вверх
  const px = k.e - 110; k.pad(px, t, 100); k.hint(px - 20, t - 140, 'Батуты вверх!');
  const c0 = px + 330; box(k, c0, t - 290, 90, 18, 'cloud'); k.pad(c0 + 140, t - 290, 0.001); L.pads.pop();
  box(k, c0 + 270, t - 300, 360, 20, 'island'); k.cp(c0 + 340, t - 300);
  k.place(240, t - 120, 600, 'island'); k.cp(k.e - 450, t - 120);
  L.finish = { x: k.e - 200, y: t - 120 };
  return L;
}
function buildTower() {
  const k = kit(), L = k.lv; L.killY = 900;
  k.cp(100, 440); k.solid(-600, 440, 900, 'tower'); k.hint(100, 360, 'Бег · прыжок'); k.hint(330, 330, 'Башня: ты поднимаешься\nвсё выше');
  k.hop(140, 440, 200, 'tower');
  const s0 = shaftBlock(k, 'tower', 440, 140);
  barsBlock(k, 'tower', 190);
  pipeBlock(k, 'tower', 190);
  shaftBlock(k, 'tower', 190, -110);
  const e0 = k.e;
  [[-150, 100], [-190, 90], [-230, 90], [-270, 90]].forEach(([y, w], i, A) => { const a = k.e; k.place(150, y, w, 'tower'); k.arc(a - 10, k.e - w + 10, Math.min(y, i ? A[i - 1][0] : -110) - 30, 55, 3); });
  k.cp(k.e - 40, -270);
  const px = k.e; k.pole(px + 150, -600, -240); k.pole(px + 330, -600, -240); k.solid(px + 450, -600, 400, 'tower'); k.cp(px + 520, -600);
  barsBlock(k, 'tower', -560);
  shaftBlock(k, 'tower', -560, -860);
  tail(k, 120, -860, 'tower');
  return L;
}

/* ---------- кастомные уровни (редактор) ---------- */
function buildCustom(items) {
  const k = kit(), L = k.lv, it = (items || []).slice().sort((a, b) => (a.t === 'p' ? -1 : 0) - (b.t === 'p' ? -1 : 0)); let fin = null, maxY = 440, hasP = false;
  for (const o of it) { if (o.t === 'p') { k.cp(o.x, o.y); hasP = true; } }
  if (!hasP) { k.cp(100, 440); box(k, -100, 440, 400, 60, 'ground'); }
  for (const o of it) { if (o.t === 's') { box(k, o.x, o.y, o.w, o.h, 'ground'); maxY = Math.max(maxY, o.y); } else if (o.t === 'b') k.bar(o.x, o.y, o.w); else if (o.t === 'c') k.coin(o.x, o.y); else if (o.t === 'k') k.cp(o.x, o.y); else if (o.t === 'f') fin = o; }
  L.finish = fin ? { x: fin.x, y: fin.y } : { x: 400, y: 440 }; L.killY = maxY + 700; return L;
}

/* ---------- реестр уровней ---------- */
const BUILDERS = { city: buildCity, lake: buildLake, forest: buildForest2, mountain: buildMountain, space: buildSpace, ocean: buildOcean, factory: buildFactory, desert: buildDesert, volcano: buildVolcano, sky: buildSky, tower: buildTower };
const NOT_TALL = { city: 1, lake: 1 };
const CHAP = ['city', 'lake', 'forest', 'ocean', 'mountain', 'space', 'factory', 'desert', 'volcano', 'sky', 'tower'];
function buildLevel(id, custom) {
  const lv = id === 'custom' ? buildCustom(custom) : (BUILDERS[id] || buildCity)();
  lv.maxX = lv.finish.x + 170; lv.tall = !NOT_TALL[id]; return lv;
}
function resetLevel(lv) {
  for (const c of lv.coins) c.got = false;
  for (const o of lv.bars) { o.hopped = false; o.paid = 0; }
  for (const o of lv.pipes) { o.hopped = false; o.paid = 0; }
  for (const o of lv.poles) { o.paid = 0; }
  for (const s of lv.solids) { s.paid = false; }
  for (const pd of lv.pads) pd.sq = 0;
}

/* ---------- события, которые меняют состояние вне step() ---------- */
function toCheckpoint(S) { S.deaths++; S.combo = 0; S.comboT = 0; S.fade = 1; spawn(S); }
function resumeAtCp(S) { S.combo = 0; S.comboT = 0; spawn(S); }

/* ---------- запись забега: одно число (16 бит) на каждый тик 1/60 с ---------- */
const STEP = 1 / 60;
const M = { L: 1, R: 2, U: 4, D: 8, J: 16, F: 32, FB: 64, G: 128, JP: 256, CP: 512, RES: 1024, AUTO: 2048 };
function applyMask(S, m) {
  if (m & M.CP) toCheckpoint(S);
  if (m & M.RES) resumeAtCp(S);
  const i = S.inp;
  i.left = !!(m & M.L); i.right = !!(m & M.R); i.up = !!(m & M.U); i.down = !!(m & M.D); i.jump = !!(m & M.J);
  i.flip = !!(m & M.F); i.flipBack = !!(m & M.FB); i.grab = !!(m & M.G); i.jumpPressed = !!(m & M.JP);
  S.autoGrab = !!(m & M.AUTO);
}
function maskOf(S, extra) {
  const i = S.inp;
  return (i.left ? M.L : 0) | (i.right ? M.R : 0) | (i.up ? M.U : 0) | (i.down ? M.D : 0) | (i.jump ? M.J : 0) | (i.flip ? M.F : 0) |
    (i.flipBack ? M.FB : 0) | (i.grab ? M.G : 0) | (i.jumpPressed ? M.JP : 0) | (S.autoGrab ? M.AUTO : 0) | (extra || 0);
}
/* Прогон записи с нуля. Останавливается на тике, где достигнут финиш. */
function replay(mapId, masks, opts) {
  opts = opts || {};
  const lv = buildLevel(mapId, opts.custom), S = newState(lv); S.noFx = true;
  const got = [];
  S.onCoin = (i) => { got.push(i); };
  let n = 0, finishTick = -1;
  for (; n < masks.length; n++) {
    applyMask(S, masks[n]); step(S, STEP);
    if (opts.onTick) opts.onTick(S, n);
    if (S.done) { finishTick = n + 1; n++; break; }
  }
  return { S, ticks: n, done: S.done, finishTick, coins: got, lv };
}

/* base64 без зависимостей от btoa/Buffer */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64enc(b) { let o = ''; for (let i = 0; i < b.length; i += 3) { const a = b[i], c = b[i + 1], d = b[i + 2]; o += B64[a >> 2] + B64[((a & 3) << 4) | ((c || 0) >> 4)] + (i + 1 < b.length ? B64[((c & 15) << 2) | ((d || 0) >> 6)] : '') + (i + 2 < b.length ? B64[d & 63] : ''); } return o; }
function b64dec(s) {
  const t = {}; for (let i = 0; i < 64; i++) t[B64[i]] = i;
  const out = []; let acc = 0, bits = 0;
  for (let i = 0; i < s.length; i++) { const v = t[s[i]]; if (v === undefined) return null; acc = (acc << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; } }
  return out;
}
/* RLE: [маска (2 байта), длина серии (varint)] */
function encodeReplay(masks) {
  const b = []; let i = 0;
  while (i < masks.length) {
    let j = i; while (j < masks.length && masks[j] === masks[i]) j++;
    let len = j - i; b.push(masks[i] & 255, masks[i] >> 8);
    while (len >= 128) { b.push((len & 127) | 128); len >>= 7; } b.push(len);
    i = j;
  }
  return b64enc(b);
}
function decodeReplay(str, maxTicks) {
  if (typeof str !== 'string' || str.length > 400000) return null;
  const b = b64dec(str); if (!b) return null;
  const out = []; let i = 0;
  while (i < b.length) {
    if (i + 3 > b.length) return null;
    const m = b[i] | (b[i + 1] << 8); i += 2; if (m >= 4096) return null;
    let len = 0, sh = 0, c;
    do { if (i >= b.length || sh > 21) return null; c = b[i++]; len |= (c & 127) << sh; sh += 7; } while (c & 128);
    if (len < 1 || out.length + len > maxTicks) return null;
    for (let k = 0; k < len; k++) out.push(m);
  }
  return out;
}

return { hooks, CFG, PW, PH, PK, STEP, M, CHAP, BUILDERS, buildLevel, buildCustom, newState, spawn, step, toCheckpoint, resumeAtCp,
  applyMask, maskOf, replay, encodeReplay, decodeReplay, resetLevel, dsin, dcos, dexp, datan2, clamp, sgn, wrapAng, TAU };
});
