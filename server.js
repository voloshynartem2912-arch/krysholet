// Крышелёт Online — сервер: статика, аккаунты, проверка забегов (античит), магазин, рейтинг, комнаты (WebSocket).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const { WebSocketServer } = require('ws');
const Sim = require('./public/sim.js');
const Shop = require('./lib/shop.js');
const Store = require('./lib/store.js');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PROXY_HOPS = process.env.TRUST_PROXY_HOPS === undefined ? 1 : +process.env.TRUST_PROXY_HOPS;   // сколько прокси стоит перед сервером (Render = 1)
const SIM_SRC = fs.readFileSync(path.join(PUB, 'sim.js'), 'utf8');
const SIM_VERSION = crypto.createHash('sha1').update(SIM_SRC).digest('hex').slice(0, 12);
const MAPS = Sim.CHAP;
const EXPORT_SECRET = process.env.EXPORT_SECRET || (ADMIN_KEY.length >= 12 ? 'exp:' + ADMIN_KEY : '');   // подпись резервных копий; без неё экспорт выключен
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ================= база ================= */
const store = Store.open();
let db = null, dirty = false, saving = false, lastSave = 0;
function fresh() { return { v: 2, players: {}, stock: {}, levels: {} }; }
async function loadDb() {
  let raw = null, err = null;
  for (let i = 0; i < 4; i++) { try { raw = await store.load(); err = null; break; } catch (e) { err = e; await new Promise((r) => setTimeout(r, 1500)); } }
  if (err) { console.error('НЕ УДАЛОСЬ загрузить базу (' + err.message + '). Выходим, чтобы не затереть данные.'); process.exit(1); }
  db = fresh();
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') { db.players = o.players || {}; db.stock = o.stock || {}; db.levels = o.levels || {}; }
    } catch (e) { console.error('база повреждена:', e.message); process.exit(1); }
  }
  console.log('база:', store.name, '· игроков', Object.keys(db.players).length);
}
function touch() { dirty = true; }
async function flush(force) {
  if (!dirty || saving || (!force && now() - lastSave < 4000)) return;
  saving = true; dirty = false;
  try { await store.save(JSON.stringify(db)); lastSave = now(); } catch (e) { dirty = true; console.error('сохранение не удалось:', e.message); }
  saving = false;
}
setInterval(() => flush(false), 2000).unref();
async function shutdown() { try { if (store.saveSync && dirty) store.saveSync(JSON.stringify(db)); else { dirty = true; saving = false; await flush(true); } } catch (e) { console.error(e); } process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled:', e));

/* ================= утилиты ================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
function secHeaders(h) { return Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP }, h || {}); }
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (PROXY_HOPS > 0 && xf.length) return xf[Math.max(0, xf.length - PROXY_HOPS)];
  return req.socket.remoteAddress || '?';
}
// скользящее окно: limit запросов за ms
const buckets = new Map();
function limited(key, limit, ms) {
  const t = now(); let b = buckets.get(key);
  if (!b || t > b.reset) { b = { n: 0, reset: t + ms }; buckets.set(key, b); }
  return ++b.n > limit;
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60000).unref();

function send(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(code, secHeaders(Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra)));
  res.end(body);
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    let dead = false;
    req.on('data', (c) => { if (dead) return; n += c.length; if (n > max) { dead = true; parts.length = 0; req.pause(); reject(Object.assign(new Error('too big'), { code: 413 })); } else parts.push(c); });
    req.on('end', () => { try { const s = Buffer.concat(parts).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
    req.on('error', reject);
  });
}
function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s || 'Игрок';
}
function authOf(req) {
  const h = String(req.headers.authorization || ''); if (!h.startsWith('Bearer ')) return null;
  return authToken(h.slice(7));
}
function authToken(tok) {
  const i = String(tok).indexOf('.'); if (i < 1) return null;
  const id = tok.slice(0, i), p = Object.prototype.hasOwnProperty.call(db.players, id) ? db.players[id] : null;
  if (!p) return null;
  const a = Buffer.from(sha(tok.slice(i + 1))), b = Buffer.from(p.th);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  p.last = now(); return { id, p };
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ================= игроки ================= */
function newPlayer(name) {
  const id = crypto.randomBytes(6).toString('hex'), token = crypto.randomBytes(24).toString('hex');
  db.players[id] = { name: cleanName(name), th: sha(token), created: now(), last: now(), wallet: 0, earned: 0, claimed: {}, owned: [], skin: 0, badge: '', times: {}, scores: {}, payouts: [], runs: [], strikes: 0, banned: false };
  touch(); return { id, token, p: db.players[id] };
}
function meView(id, p) {
  const claimed = {}; for (const m of MAPS) { const c = p.claimed[m]; claimed[m] = { coins: c ? c.coins.length : 0, won: !!(c && c.won) }; }
  const coinTotals = {}; for (const m of MAPS) coinTotals[m] = coinCount(m);
  return { id, name: p.name, wallet: p.wallet, earned: p.earned, owned: p.owned, skin: p.skin, badge: p.badge, times: p.times, scores: p.scores, claimed, coinTotals, banned: p.banned, simVersion: SIM_VERSION, repeatPerHour: Shop.ECON.repeatPerHour, paidLastHour: paidInLastHour(p) };
}
const coinCache = {};
function coinCount(m) { return coinCache[m] || (coinCache[m] = Sim.buildLevel(m).coins.length); }
function paidInLastHour(p) { const t = now() - 3600e3; p.payouts = p.payouts.filter((x) => x > t); return p.payouts.length; }

/* ================= экспорт / восстановление аккаунта =================
   Файл подписан сервером (HMAC) — править его бесполезно — и привязан к коду входа игрока (в файле хеш токена).
   Чужой человек с файлом ничего не сделает: восстановление требует код входа.
   Восстановить можно только аккаунт, которого сейчас нет на сервере (после «засыпания»/стирания),
   поэтому один файл не создаст копий монет и вещей. Лимитки возвращаются в счётчик «раскуплено». */
const hmac = (s) => crypto.createHmac('sha256', EXPORT_SECRET).update(s).digest('hex');
function exportFile(id, p) {
  const data = JSON.stringify({ id, th: p.th, name: p.name, created: p.created, exported: now(), wallet: p.wallet, earned: p.earned, claimed: p.claimed, owned: p.owned, skin: p.skin, badge: p.badge, times: p.times, scores: p.scores });
  return { f: 'krysholet-backup', v: 1, data, sig: hmac(data) };
}
function restoreFile(file, code) {
  if (!EXPORT_SECRET) return { code: 503, out: { ok: false, reason: 'off' } };
  if (!file || typeof file !== 'object' || file.f !== 'krysholet-backup' || typeof file.data !== 'string' || typeof file.sig !== 'string') return { code: 400, out: { ok: false, reason: 'file' } };
  const want = Buffer.from(hmac(file.data)), got = Buffer.from(file.sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { code: 400, out: { ok: false, reason: 'file' } };   // подделка или чужой сервер
  let d; try { d = JSON.parse(file.data); } catch (e) { return { code: 400, out: { ok: false, reason: 'file' } }; }
  const tok = String(code || ''), i = tok.indexOf('.');
  const a = Buffer.from(sha(i < 1 ? '' : tok.slice(i + 1))), b = Buffer.from(String(d.th || ''));
  if (i < 1 || tok.slice(0, i) !== d.id || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { code: 403, out: { ok: false, reason: 'code' } };   // файл не от этого аккаунта
  if (!/^[0-9a-f]{12}$/.test(d.id)) return { code: 400, out: { ok: false, reason: 'file' } };
  if (own(db.players, d.id)) return { code: 409, out: { ok: false, reason: 'exists' } };
  const owned = (Array.isArray(d.owned) ? d.owned : []).filter((x) => own(Shop.BY_ID, x));
  const claimed = {}; for (const m of MAPS) { const c = d.claimed && d.claimed[m]; if (c && Array.isArray(c.coins)) claimed[m] = { coins: c.coins.filter((n) => Number.isInteger(n) && n >= 0 && n < 500), won: !!c.won }; }
  const pick = (o) => { const r = {}; if (o && typeof o === 'object') for (const m of MAPS) if (own(o, m) && isFinite(+o[m]) && +o[m] > 0) r[m] = +o[m]; return r; };
  db.players[d.id] = { name: cleanName(d.name), th: d.th, created: +d.created || now(), last: now(), wallet: Math.max(0, d.wallet | 0), earned: Math.max(0, d.earned | 0), claimed, owned, skin: d.skin | 0, badge: String(d.badge || ''), times: pick(d.times), scores: pick(d.scores), payouts: [], runs: [], strikes: 0, banned: false, restored: now() };
  for (const x of owned) if (Shop.BY_ID[x].limit != null) db.stock[x] = (db.stock[x] || 0) + 1;
  touch();
  return { code: 200, out: { ok: true, id: d.id, token: tok.slice(i + 1), me: meView(d.id, db.players[d.id]) } };
}

/* ================= проверка забега (античит) ================= */
function strike(id, p, why) { p.strikes++; touch(); console.warn('[anticheat] ' + id + ' (' + p.name + ') страйк ' + p.strikes + ': ' + why); if (p.strikes >= 6 && !p.banned) { p.banned = true; console.warn('[anticheat] ' + id + ' заблокирован'); } }
function handleRun(id, p, body) {
  if (p.banned) return { code: 403, out: { ok: false, reason: 'banned' } };
  if (body.sv !== SIM_VERSION) return { code: 409, out: { ok: false, reason: 'version', simVersion: SIM_VERSION } };
  const map = body.map;
  if (typeof map !== 'string' || !MAPS.includes(map)) return { code: 400, out: { ok: false, reason: 'map' } };
  const masks = Sim.decodeReplay(body.replay, Shop.ECON.maxTicks);
  if (!masks || masks.length < 30) { strike(id, p, 'битая запись'); return { code: 400, out: { ok: false, reason: 'replay' } }; }
  const t0 = now();
  const r = Sim.replay(map, masks);
  const ms = now() - t0;
  const c = p.claimed[map] || (p.claimed[map] = { coins: [], won: false });
  const have = new Set(c.coins);
  const newCoins = r.coins.filter((i) => !have.has(i));
  let earned = newCoins.length * Shop.ECON.coin;
  for (const i of newCoins) c.coins.push(i);
  const out = { ok: true, map, done: !!r.done, ticks: r.ticks, coins: r.coins.length, newCoins: newCoins.length, verifyMs: ms };
  if (r.done) {
    const time = Math.round(r.S.time * 100) / 100, score = Math.round(r.S.score);
    out.time = time; out.score = score;
    if (!c.won) { c.won = true; earned += Shop.ECON.firstWin; out.firstWin = true; }
    else if (time >= Shop.ECON.repeatMinSeconds) {
      if (paidInLastHour(p) < Shop.ECON.repeatPerHour) { const rw = Shop.repeatReward(MAPS.indexOf(map)); earned += rw; p.payouts.push(now()); out.repeatReward = rw; }
      else out.capped = true;
    }
    if (time >= 8) {
      if (!p.times[map] || time < p.times[map]) { p.times[map] = time; out.recordTime = true; }
      if (!p.scores[map] || score > p.scores[map]) { p.scores[map] = score; out.recordScore = true; }
    }
  }
  p.wallet += earned; p.earned += earned; out.earned = earned; out.wallet = p.wallet; touch();
  return { code: 200, out };
}

/* ================= магазин ================= */
function shopView(auth) {
  const p = auth && auth.p;
  return {
    items: Shop.ITEMS.map((i) => ({ id: i.id, kind: i.kind, n: i.n, price: i.price, skin: i.skin, badge: i.badge, limit: i.limit == null ? null : i.limit, left: i.limit == null ? null : Math.max(0, i.limit - (db.stock[i.id] || 0)), owned: !!(p && p.owned.includes(i.id)) })),
    wallet: p ? p.wallet : 0, skin: p ? p.skin : 0, badge: p ? p.badge : '',
  };
}
function buy(p, itemId) {
  const it = own(Shop.BY_ID, itemId) ? Shop.BY_ID[itemId] : null;
  if (!it) return { code: 404, out: { ok: false, reason: 'item' } };
  if (p.banned) return { code: 403, out: { ok: false, reason: 'banned' } };
  if (p.owned.includes(it.id)) return { code: 409, out: { ok: false, reason: 'owned' } };
  if (it.limit != null && (db.stock[it.id] || 0) >= it.limit) return { code: 409, out: { ok: false, reason: 'soldout' } };
  if (p.wallet < it.price) return { code: 402, out: { ok: false, reason: 'money', need: it.price - p.wallet } };
  // всё выше и ниже — синхронно, без await: две покупки одновременно не пройдут
  p.wallet -= it.price; p.owned.push(it.id);
  if (it.limit != null) db.stock[it.id] = (db.stock[it.id] || 0) + 1;
  if (it.kind === 'skin') p.skin = it.skin; else if (it.kind === 'badge') p.badge = it.badge;
  touch();
  return { code: 200, out: { ok: true, wallet: p.wallet, left: it.limit == null ? null : it.limit - db.stock[it.id], skin: p.skin, badge: p.badge } };
}
function equip(p, body) {
  if (body.skin !== undefined) {
    const s = body.skin | 0;
    if (s !== 0 && !p.owned.some((id) => Shop.BY_ID[id].kind === 'skin' && Shop.BY_ID[id].skin === s)) return { code: 403, out: { ok: false, reason: 'notowned' } };
    p.skin = s;
  }
  if (body.badge !== undefined) {
    const b = String(body.badge);
    if (b !== '' && !p.owned.some((id) => Shop.BY_ID[id].kind === 'badge' && Shop.BY_ID[id].badge === b)) return { code: 403, out: { ok: false, reason: 'notowned' } };
    p.badge = b;
  }
  touch(); return { code: 200, out: { ok: true, skin: p.skin, badge: p.badge } };
}

/* ================= рейтинг ================= */
function leaderboard(tab, map) {
  const list = Object.entries(db.players).filter(([, p]) => !p.banned);
  let rows;
  if (tab === 'time' && MAPS.includes(map)) rows = list.filter(([, p]) => p.times[map]).map(([id, p]) => ({ id, name: p.name, badge: p.badge, skin: p.skin, v: p.times[map] })).sort((a, b) => a.v - b.v);
  else if (tab === 'score' && MAPS.includes(map)) rows = list.filter(([, p]) => p.scores[map]).map(([id, p]) => ({ id, name: p.name, badge: p.badge, skin: p.skin, v: p.scores[map] })).sort((a, b) => b.v - a.v);
  else rows = list.filter(([, p]) => p.earned > 0).map(([id, p]) => ({ id, name: p.name, badge: p.badge, skin: p.skin, v: p.earned })).sort((a, b) => b.v - a.v);
  return rows.slice(0, 20);
}

/* ================= редактор уровней ================= */
const ITEM_T = { s: ['x', 'y', 'w', 'h'], b: ['x', 'y', 'w'], c: ['x', 'y'], k: ['x', 'y'], p: ['x', 'y'], f: ['x', 'y'] };
function cleanLevel(arr) {
  if (!Array.isArray(arr) || arr.length > 400) return null;
  const out = [];
  for (const o of arr) {
    if (!o || typeof o !== 'object' || !own(ITEM_T, o.t)) return null;
    const r = { t: o.t };
    for (const k of ITEM_T[o.t]) { const v = +o[k]; if (!isFinite(v) || Math.abs(v) > 40000) return null; r[k] = Math.round(v); }
    if ((o.t === 's' && (r.w < 1 || r.h < 1 || r.w > 8000 || r.h > 8000)) || (o.t === 'b' && (r.w < 20 || r.w > 2000))) return null;
    out.push(r);
  }
  return out;
}

/* ================= HTTP ================= */
const gz = new Map();
function serveStatic(req, res) {
  let u; try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (f !== PUB && !f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, secHeaders({ 'Content-Type': 'text/plain' })); return res.end('not found'); }
    const ext = path.extname(f), type = MIME[ext] || 'application/octet-stream';
    const headers = secHeaders({ 'Content-Type': type, 'Cache-Control': ext === '.html' || u === '/sim.js' ? 'no-cache' : 'public, max-age=3600', Vary: 'Accept-Encoding' });
    const compress = /\b(html|js|css|json|svg)\b/.test(ext.slice(1)) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    const key = f + ':' + st.mtimeMs;
    const finish = (buf) => {
      if (u === '/sim.js') buf = Buffer.concat([buf, Buffer.from('\nSim.VERSION=' + JSON.stringify(SIM_VERSION) + ';\n')]);
      if (compress) { let z = gz.get(key); if (!z) { z = zlib.gzipSync(buf); gz.set(key, z); } headers['Content-Encoding'] = 'gzip'; buf = z; }
      headers['Content-Length'] = buf.length; res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : buf);
    };
    fs.readFile(f, (e, buf) => (e ? (res.writeHead(500), res.end()) : finish(buf)));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res);
    }
    const ip = clientIp(req);
    if (limited('ip:' + ip, 240, 60000)) return send(res, 429, { ok: false, reason: 'rate' }, { 'Retry-After': '30' });
    const q = new URL(req.url, 'http://x').searchParams;

    if (url === '/api/health') return send(res, 200, { ok: true });
    if (url === '/api/config') return send(res, 200, { ok: true, simVersion: SIM_VERSION, maps: MAPS });
    if (url === '/api/lb' && req.method === 'GET') return send(res, 200, { ok: true, rows: leaderboard(q.get('tab'), q.get('map')) });
    if (url === '/api/shop' && req.method === 'GET') return send(res, 200, Object.assign({ ok: true }, shopView(authOf(req))));
    if (url === '/api/levels' && req.method === 'GET') {
      return send(res, 200, { ok: true, levels: Object.entries(db.levels).sort((a, b) => b[1].upd - a[1].upd).slice(0, 60).map(([id, l]) => ({ id, name: l.name, by: l.by, items: l.items })) });
    }

    const lm = url.match(/^\/api\/levels\/([0-9a-f]{12})$/);
    if (lm && req.method === 'GET') { const l = own(db.levels, lm[1]) ? db.levels[lm[1]] : null; return l ? send(res, 200, { ok: true, name: l.name, by: l.by, items: l.json }) : send(res, 404, { ok: false }); }

    if (url === '/api/join' && req.method === 'POST') {
      if (limited('join:' + ip, 8, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      const b = await readBody(req, 2000); const r = newPlayer(b.name);
      return send(res, 200, { ok: true, id: r.id, token: r.token, me: meView(r.id, r.p) });
    }
    if (url === '/api/login' && req.method === 'POST') {
      if (limited('login:' + ip, 20, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      const b = await readBody(req, 2000); const a = authToken(String(b.code || ''));
      return a ? send(res, 200, { ok: true, id: a.id, token: String(b.code).slice(a.id.length + 1), me: meView(a.id, a.p) }) : send(res, 401, { ok: false, reason: 'code' });
    }
    if (url === '/api/restore' && req.method === 'POST') {
      if (limited('restore:' + ip, 10, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      const b = await readBody(req, 100000); const r = restoreFile(b.file, b.code); return send(res, r.code, r.out);
    }
    if (url.startsWith('/api/admin/')) return admin(req, res, url, ip);

    // ---- всё ниже требует токен игрока ----
    const a = authOf(req);
    if (!a) return send(res, 401, { ok: false, reason: 'auth' });
    if (limited('p:' + a.id, 120, 60000)) return send(res, 429, { ok: false, reason: 'rate' }, { 'Retry-After': '20' });
    const { id, p } = a;

    if (url === '/api/me' && req.method === 'GET') return send(res, 200, { ok: true, me: meView(id, p) });
    if (url === '/api/export' && req.method === 'GET') {
      if (!EXPORT_SECRET) return send(res, 503, { ok: false, reason: 'off' });
      if (limited('exp:' + id, 10, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      return send(res, 200, { ok: true, file: exportFile(id, p) });
    }
    if (url === '/api/name' && req.method === 'POST') {
      if (limited('name:' + id, 6, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      const b = await readBody(req, 1000); p.name = cleanName(b.name); touch(); return send(res, 200, { ok: true, name: p.name });
    }
    if (url === '/api/shop/buy' && req.method === 'POST') { const b = await readBody(req, 1000); const r = buy(p, String(b.item)); return send(res, r.code, r.out); }
    if (url === '/api/shop/equip' && req.method === 'POST') { const b = await readBody(req, 1000); const r = equip(p, b); return send(res, r.code, r.out); }
    if (url === '/api/run' && req.method === 'POST') {
      const t = now(); if (p.lastRun && t - p.lastRun < Shop.ECON.runGapMs) return send(res, 429, { ok: false, reason: 'rate', retryMs: Shop.ECON.runGapMs - (t - p.lastRun) });
      if (limited('run:' + id, Shop.ECON.runsPerHour, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      if (limited('runglobal', 30, 1000)) return send(res, 503, { ok: false, reason: 'busy' }, { 'Retry-After': '2' });
      p.lastRun = t;
      const b = await readBody(req, 160000); const r = handleRun(id, p, b); return send(res, r.code, r.out);
    }
    if (url === '/api/levels' && req.method === 'POST') {
      if (limited('lvl:' + id, 20, 3600e3)) return send(res, 429, { ok: false, reason: 'rate' });
      const b = await readBody(req, 30000); const items = cleanLevel(b.items);
      if (!items) return send(res, 400, { ok: false, reason: 'level' });
      if (!own(db.levels, id) && Object.keys(db.levels).length >= 80) { const oldest = Object.entries(db.levels).sort((x, y) => x[1].upd - y[1].upd)[0]; delete db.levels[oldest[0]]; }
      db.levels[id] = { name: cleanName(b.name), by: p.name, items: items.length, json: items, upd: now() }; touch();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { ok: false, reason: 'nf' });
  } catch (e) {
    if (e && e.code === 413) { res.on('finish', () => req.destroy()); return send(res, 413, { ok: false, reason: 'big' }, { Connection: 'close' }); }
    if (e && e.code === 400) return send(res, 400, { ok: false, reason: 'json' });
    console.error('api error:', e); try { send(res, 500, { ok: false, reason: 'err' }); } catch (_) {}
  }
});
server.headersTimeout = 15000; server.requestTimeout = 20000; server.maxHeadersCount = 50;

/* ---- админка: ADMIN_KEY в переменных окружения ---- */
async function admin(req, res, url, ip) {
  if (limited('adm:' + ip, 30, 60000)) return send(res, 429, { ok: false });
  const k = String(req.headers['x-admin-key'] || '');
  const good = ADMIN_KEY.length >= 12 && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
  if (!good) return send(res, 403, { ok: false });
  const b = req.method === 'POST' ? await readBody(req, 4000) : {};
  if (url === '/api/admin/stats') return send(res, 200, { ok: true, players: Object.keys(db.players).length, stock: db.stock, banned: Object.entries(db.players).filter(([, p]) => p.banned).map(([id, p]) => id + ':' + p.name), top: leaderboard('wallet') });
  if (url === '/api/admin/restock') { const it = Shop.BY_ID[b.item]; if (!it) return send(res, 404, { ok: false }); db.stock[it.id] = Math.max(0, (db.stock[it.id] || 0) - (b.add | 0)); touch(); return send(res, 200, { ok: true, sold: db.stock[it.id] }); }
  if (url === '/api/admin/grant') { const p = db.players[b.id]; if (!p) return send(res, 404, { ok: false }); p.wallet = Math.max(0, p.wallet + (b.amount | 0)); touch(); return send(res, 200, { ok: true, wallet: p.wallet }); }
  if (url === '/api/admin/ban') { const p = db.players[b.id]; if (!p) return send(res, 404, { ok: false }); p.banned = !!b.banned; if (!b.banned) p.strikes = 0; touch(); return send(res, 200, { ok: true }); }
  return send(res, 404, { ok: false });
}

/* ================= WebSocket: комнаты и призраки ================= */
const wss = new WebSocketServer({ server, maxPayload: 2048, path: '/ws' });
const rooms = new Map(), ipConns = new Map();
const ROOM_RE = /^[a-z0-9_-]{1,40}$/i;
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
wss.on('connection', (ws, req) => {
  const ip = clientIp(req); const c = (ipConns.get(ip) || 0) + 1;
  if (c > 8) { ws.close(1013); return; }
  ipConns.set(ip, c);
  let q; try { q = new URL(req.url, 'http://x').searchParams; } catch (e) { ws.close(); return; }
  let room = String(q.get('room') || 'lobby'); if (!ROOM_RE.test(room)) room = 'lobby';
  const au = authToken(String(q.get('t') || '')); const name = au ? au.p.name : 'Гость'; const badge = au ? au.p.badge : '', skin = au ? au.p.skin : 0;
  const pid = au ? au.id : crypto.randomBytes(4).toString('hex');
  if (!rooms.has(room)) { if (rooms.size > 300) { ws.close(1013); return; } rooms.set(room, new Set()); }
  const set = rooms.get(room); if (set.size >= 20) { ws.close(1013); return; }
  for (const o of set) if (o.pid === pid) { try { o.ws.close(4000); } catch (e) {} set.delete(o); }
  const me = { ws, pid, name, badge, skin, alive: true, n: 0, t0: now(), presence: null }; set.add(me);
  const bcast = (obj, except) => { const s = JSON.stringify(obj); for (const o of set) if (o !== except && o.ws.readyState === 1) o.ws.send(s); };
  ws.send(JSON.stringify({ t: 'hello', id: pid, room, peers: [...set].filter((o) => o !== me && o.presence).map((o) => ({ id: o.pid, presence: o.presence })) }));
  ws.on('pong', () => { me.alive = true; });
  ws.on('message', (raw) => {
    const t = now(); if (t - me.t0 > 1000) { me.t0 = t; me.n = 0; } if (++me.n > 40) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'presence' && m.data && typeof m.data === 'object') {
      const d = m.data, first = !me.presence;
      me.presence = { x: num(d.x, 1e5), y: num(d.y, 1e5), k: String(d.k || '').slice(0, 40), n: me.name, b: me.badge, s: me.skin };   // имя, значок и скин берём с сервера, подделать нельзя
      bcast({ t: first ? 'join' : 'presence', id: pid, presence: me.presence }, me);
    } else if (m.t === 'emit' && m.topic === 'coin' && m.data && typeof m.data === 'object' && Number.isInteger(m.data.i) && m.data.i >= 0 && m.data.i < 500) {
      bcast({ t: 'emit', topic: 'coin', data: { i: m.data.i, k: String(m.data.k || '').slice(0, 40) } }, me);
    }
  });
  ws.on('close', () => { set.delete(me); ipConns.set(ip, Math.max(0, (ipConns.get(ip) || 1) - 1)); if (!set.size) rooms.delete(room); else bcast({ t: 'leave', id: pid }); });
  ws.on('error', () => {});
});
setInterval(() => { for (const set of rooms.values()) for (const o of set) { if (!o.alive) { try { o.ws.terminate(); } catch (e) {} continue; } o.alive = false; try { o.ws.ping(); } catch (e) {} } }, 25000).unref();

loadDb().then(() => server.listen(PORT, '0.0.0.0', () => {
  console.log('Крышелёт на :' + PORT + ' · sim ' + SIM_VERSION + (ADMIN_KEY ? ' · админка включена' : ''));
  if (process.env.RENDER && /^file /.test(store.name) && !/^\/(data|var\/data|mnt)/.test(process.env.DATA_FILE || '')) console.warn('ВНИМАНИЕ: на Render без диска файлы стираются при каждом перезапуске — кошельки и покупки пропадут. Подключи Upstash (см. README) или Render Disk.');
}));
module.exports = { server };
