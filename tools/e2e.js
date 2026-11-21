// Сквозной тест настоящего клиента в Chromium против настоящего сервера:
// запись нажатий → отправка → проверка сервером → награда; сохранение/загрузка; магазин; скриншоты новых карт.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const PORT = 3998, BASE = 'http://127.0.0.1:' + PORT, DATA = '' + require('os').tmpdir() + '/krysholet-e2e.json', ADMIN = 'e2e-admin-key-123456';
const SHOTS = path.join(require('os').tmpdir(), 'krysholet-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL:', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rep = (m) => JSON.parse(fs.readFileSync(path.join(__dirname, 'replays', m + '.json'))).masks;
const RES = 1024;
const HOOK = `window.__e2e = {
  get S() { return S; }, get mode() { return mode; }, get REC() { return REC; }, get ME() { return ME; }, get wallet() { return wallet; },
  setMap, startGame, readSave, openSkins, openLB, goTitle, toCheckpoint,
  feed(masks, from, to) {
    for (let i = from; i < Math.min(to, masks.length); i++) {
      const m = masks[i];
      if (m & ${RES}) { Sim.resumeAtCp(S); pendFlag |= M.RES; }
      if (m & M.CP) toCheckpoint();
      Sim.applyMask(S, m & ~(M.CP | M.RES));
      snapPrev(); stepRec(); onStep();
      if (S.done) return i + 1;
    }
    return Math.min(to, masks.length);
  },
};
onlineInit();
/* ---------- старт ---------- */`;

(async () => {
  try { fs.unlinkSync(DATA); } catch (e) {}
  const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT, DATA_FILE: DATA, ADMIN_KEY: ADMIN }) });
  let slog = ''; proc.stdout.on('data', (d) => { slog += d; }); proc.stderr.on('data', (d) => { slog += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) {} await sleep(100); }
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.includes('google')) return route.abort();   // шрифты не нужны
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const r = await route.fetch(); let body = await r.text();
      const marker = 'onlineInit();\n/* ---------- старт ---------- */'; if (!body.includes(marker)) throw new Error('marker');
      body = body.replace(marker, HOOK);
      return route.fulfill({ response: r, body });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security/i.test(m.text())) errors.push('console: ' + m.text()); });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const skipSplash = async () => { await page.click('#splash', { force: true }).catch(() => {}); await page.waitForFunction(() => document.getElementById('splash').hidden, null, { timeout: 5000 }); };
  try {
    await page.goto(BASE + '/');
    await page.waitForFunction(() => window.__e2e && window.__e2e.ME, null, { timeout: 8000 });
    await skipSplash();
    console.log('— аккаунт');
    ok(await E(() => !!localStorage.getItem('pk_tok')), 'токен сохранён в браузере');
    ok(await E(() => /^Игрок\d{4}$/.test(window.__e2e.ME.name)), 'имя по умолчанию');
    ok(await E(() => typeof Sim.VERSION === 'string' && Sim.VERSION.length === 12), 'sim.js получил версию от сервера');

    console.log('— забег на карте «город» (запись → проверка сервером)');
    const city = rep('city');
    await E(() => { window.__e2e.setMap('city'); window.__e2e.startGame(false); });
    const used = await E((m) => window.__e2e.feed(m, 0, 1e9), city);
    ok(used > 100, 'клиент прошёл карту, тиков: ' + used);
    ok(await E(() => window.__e2e.S.done), 'клиент видит финиш');
    ok(await E(() => window.__e2e.REC.length) >= used, 'записаны все тики забега');
    await page.waitForFunction(() => { const e = document.getElementById('resNet'); return e && /🪙|Сервер|Нет связи|Вышла/.test(e.textContent); }, null, { timeout: 15000 });
    const rn = await E(() => document.getElementById('resNet').textContent);
    console.log('   резюме:', rn);
    ok(/^\+\d+ 🪙/.test(rn), 'сервер принял и показал награду');
    ok(/первое/.test(rn), 'первое прохождение отмечено');
    const w1 = await E(() => window.__e2e.wallet); ok(w1 > 20, 'копилка пополнилась: ' + w1);
    const me = await E(async () => (await (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.pk_tok } })).json()).me);
    ok(me.claimed.city.won && me.times.city > 0, 'сервер хранит время: ' + me.times.city);
    ok(Math.abs(me.times.city - (await E(() => +window.__e2e.S.time.toFixed(2)))) < 0.02, 'время клиента = время сервера');

    console.log('— сохранение и загрузка (чекпоинт → перезагрузка страницы → продолжение)');
    await sleep(2800);
    const lake = rep('lake'); const r1 = lake.findIndex((m) => m & RES);
    await E(() => { window.__e2e.setMap('lake'); window.__e2e.startGame(false); });
    await E((a) => window.__e2e.feed(a[0], 0, a[1]), [lake, r1]);
    const sv = await E(() => { const d = localStorage.getItem('pk_save_lake'); return d ? JSON.parse(d) : null; });
    ok(sv && sv.v === 2 && sv.cp >= 1 && typeof sv.rp === 'string', 'автосохранение v2 на чекпоинте (cp=' + (sv && sv.cp) + ')');
    await page.reload();
    await page.waitForFunction(() => window.__e2e && window.__e2e.ME, null, { timeout: 8000 });
    await skipSplash();
    await E(() => { window.__e2e.setMap('lake'); });
    ok(await E(() => !!window.__e2e.readSave()), 'сохранение читается после перезагрузки');
    await E(() => window.__e2e.startGame(true));
    ok(await E(() => window.__e2e.S.cpIndex) >= 1, 'продолжили с чекпоинта');
    await E((a) => window.__e2e.feed(a[0], a[1], 1e9), [lake, r1]);
    ok(await E(() => window.__e2e.S.done), 'карта пройдена после загрузки');
    await page.waitForFunction(() => { const e = document.getElementById('resNet'); return e && /🪙|Сервер|Нет связи|Вышла/.test(e.textContent); }, null, { timeout: 15000 });
    const rn2 = await E(() => document.getElementById('resNet').textContent); console.log('   резюме:', rn2);
    ok(/^\+\d+ 🪙/.test(rn2), 'сервер подтвердил забег с загрузкой (воспроизведение сошлось)');

    console.log('— магазин в интерфейсе');
    await sleep(3000);
    await page.reload();
    await page.waitForFunction(() => window.__e2e && window.__e2e.ME, null, { timeout: 8000 });
    await skipSplash();
    const id = await E(() => window.__e2e.ME.id);
    await fetch(BASE + '/api/admin/grant', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN }, body: JSON.stringify({ id, amount: 20000 }) });
    await E(() => { window.__e2e.goTitle(); });
    await page.waitForFunction(() => !document.getElementById('title').hidden || true);
    await E(() => window.__e2e.openSkins());
    await page.waitForSelector('#skList .sk >> nth=3');
    ok((await page.$$('#skList .sk')).length >= 13, 'в магазине все предметы: ' + (await page.$$('#skList .sk')).length);
    await page.screenshot({ path: SHOTS + '/shop.png' });
    const before = await E(() => window.__e2e.wallet);
    await page.click('button[data-buy="skin4"]');
    await page.waitForFunction(() => document.getElementById('skMsg') && /Куплено/.test(document.getElementById('skMsg').textContent), null, { timeout: 5000 });
    ok(await E(() => window.__e2e.wallet) < before, 'покупка списала монеты');
    await page.click('button[data-buy="skin9"]'); await page.waitForTimeout(800);
    const left = await E(async () => (await (await fetch('/api/shop')).json()).items.find((i) => i.id === 'skin9').left);
    ok(left === 3, 'лимитированный скин: осталось 3 из 4');
    await page.screenshot({ path: SHOTS + '/shop2.png' });
    const eq = await E(() => window.__e2e.ME.skin); ok(eq === 9, 'скин надет и хранится на сервере');
    await E(() => document.getElementById('kClose').click());
    await E(() => window.__e2e.openLB()); await page.waitForTimeout(600);
    ok(/Игрок\d{4}/.test(await page.innerText('.md')), 'рейтинг показывает игрока');
    await page.screenshot({ path: SHOTS + '/lb.png' });
    await page.keyboard.press('Escape'); await page.mouse.click(5, 5);

    console.log('— скриншоты новых карт');
    for (const map of ['factory', 'desert', 'volcano', 'sky', 'tower', 'city']) {
      const m = rep(map); const n = map === 'tower' ? 700 : map === 'city' ? 500 : 900;
      await E((mp) => { document.querySelectorAll('.md').forEach((x) => x.remove()); window.__e2e.setMap(mp); window.__e2e.startGame(false); }, map);
      await E((a) => window.__e2e.feed(a[0], 0, a[1]), [m, n]);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: SHOTS + '/' + map + '.png' });
    }
  } catch (e) { fail++; console.log('  ✗ EXCEPTION', e.message.slice(0, 300)); }
  const bad = errors.filter((e) => !/fonts\.g|ERR_FAILED|net::ERR|429/.test(e));
  ok(bad.length === 0, 'нет ошибок в консоли / CSP' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
  await browser.close(); proc.kill('SIGTERM');
  if (fail) console.log(slog.slice(-1500));
  console.log(`\n${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
