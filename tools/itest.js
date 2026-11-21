// Интеграционный тест сервера: аккаунты, проверка забегов, взломы, магазин, гонки, WebSocket, сохранение.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), WebSocket = require('../node_modules/ws');
const Sim = require('../public/sim.js');
const PORT = 3999, BASE = 'http://127.0.0.1:' + PORT, DATA = '' + require('os').tmpdir() + '/krysholet-itest.json', ADMIN = 'test-admin-key-123456';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL:', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let proc;
async function start(env) {
  proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT, DATA_FILE: DATA, ADMIN_KEY: ADMIN }, env) });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', (d) => { if (process.env.V) process.stderr.write(d); });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch (e) {} await sleep(100); }
  throw new Error('server did not start');
}
const stop = () => new Promise((r) => { proc.once('exit', r); proc.kill('SIGTERM'); });
let ipn = 0;
async function api(method, url, body, tok, extra) {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.' + (extra && extra.ip || 0) + '.1' };
  if (tok) h.Authorization = 'Bearer ' + tok; if (extra && extra.admin) h['x-admin-key'] = ADMIN;
  const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j };
}
const join = async (name) => { const r = await api('POST', '/api/join', { name }, null, { ip: ++ipn }); return Object.assign({ tok: r.j.id + '.' + r.j.token }, r.j); };
const rep = (m) => JSON.parse(fs.readFileSync(path.join(__dirname, 'replays', m + '.json'))).masks;

(async () => {
  try { fs.unlinkSync(DATA); } catch (e) {}
  await start();
  const cfg = (await api('GET', '/api/config')).j, sv = cfg.simVersion;
  console.log('sim version', sv, '· карт:', cfg.maps.length);

  console.log('\n[аккаунты]');
  const A = await join('Алиса <b>'); ok(A.me.name === 'Алиса b', 'имя очищено от <>');
  ok((await api('GET', '/api/me', undefined, A.id + '.wrong')).s === 401, 'неверный токен → 401');
  ok((await api('GET', '/api/me')).s === 401, 'без токена → 401');
  ok((await api('POST', '/api/login', { code: A.tok }, null, { ip: 50 })).j.ok, 'вход по коду');

  console.log('\n[забег: честный]');
  let r = await api('POST', '/api/run', { map: 'city', sv, replay: Sim.encodeReplay(rep('city')) }, A.tok);
  const nCoins = r.j.coins;
  ok(r.s === 200 && r.j.done && r.j.firstWin, 'city пройден и подтверждён сервером (' + r.j.time + ' с, счёт ' + r.j.score + ', монет ' + nCoins + ', verify ' + r.j.verifyMs + ' мс)');
  ok(r.j.wallet === nCoins + 20, 'кошелёк = монеты + 20 за первое прохождение (' + r.j.wallet + ')');
  await sleep(2600);
  r = await api('POST', '/api/run', { map: 'city', sv, replay: Sim.encodeReplay(rep('city')) }, A.tok);
  ok(r.j.newCoins === 0 && !r.j.firstWin && r.j.repeatReward === 10, 'повтор: новых монет нет, награда за повтор = 10');
  ok(r.j.wallet === nCoins + 30, 'кошелёк вырос только на награду за повтор');
  ok((await api('POST', '/api/run', { map: 'city', sv, replay: Sim.encodeReplay(rep('city')) }, A.tok)).s === 429, 'отправка чаще 1 раза в 2.5 с → 429');

  console.log('\n[забег: подделки]');
  await sleep(2600);
  const B = await join('Боб');
  ok((await api('POST', '/api/run', { map: 'city', sv: 'old', replay: 'AAAA' }, B.tok)).s === 409, 'старая версия физики → 409');
  await sleep(2600);
  // «читер» присылает пустые нажатия — финиша нет, наград нет
  r = await api('POST', '/api/run', { map: 'city', sv, replay: Sim.encodeReplay(new Array(1800).fill(Sim.M.AUTO | Sim.M.R)) }, B.tok);
  ok(r.s === 200 && !r.j.done && r.j.earned < 10, 'бег вправо без прыжков не финиширует (' + r.j.earned + ' монет)');
  await sleep(2600);
  // подделка: берём честную запись и обрываем на середине, потом пытаемся «дописать» финиш — сервер сам считает, финиша нет
  const half = rep('forest').slice(0, 900);
  r = await api('POST', '/api/run', { map: 'forest', sv, replay: Sim.encodeReplay(half) }, B.tok);
  ok(r.s === 200 && !r.j.done && !r.j.time, 'обрезанная запись не засчитывается как финиш');
  await sleep(2600);
  // подделка: портим середину записи — траектория меняется, финиш не достигается
  const bad = rep('city').slice(); for (let i = 300; i < 420; i++) bad[i] = Sim.M.AUTO;
  r = await api('POST', '/api/run', { map: 'city', sv, replay: Sim.encodeReplay(bad) }, B.tok);
  ok(r.s === 200 && !r.j.done, 'испорченная запись не доходит до финиша');
  await sleep(2600);
  r = await api('POST', '/api/run', { map: 'city', sv, replay: '!!!not-base64!!!' }, B.tok);
  ok(r.s === 400, 'мусор вместо записи → 400 и страйк');
  await sleep(2600);
  r = await api('POST', '/api/run', { map: 'city', sv, time: 1, wallet: 99999, replay: Sim.encodeReplay(new Array(40).fill(0)) }, B.tok);
  ok(r.s === 200 && r.j.earned === 0, 'лишние поля «time/wallet» от клиента игнорируются');
  await sleep(2600);
  r = await api('POST', '/api/run', { map: '__proto__', sv, replay: 'AAAA' }, B.tok);
  ok(r.s === 400, 'левая карта отклонена');
  const me = (await api('GET', '/api/me', undefined, B.tok)).j.me;
  ok(!me.claimed.city.won && !me.claimed.forest.won && me.wallet === me.claimed.city.coins + me.claimed.forest.coins, 'у читера только реально подобранные монеты, бонуса за финиш нет (' + me.wallet + ')');

  console.log('\n[рейтинг]');
  let lb = (await api('GET', '/api/lb?tab=time&map=city')).j.rows;
  ok(lb.length === 1 && lb[0].name === 'Алиса b' && lb[0].v > 8, 'в рейтинге по времени только честный игрок');
  ok(!JSON.stringify((await api('GET', '/api/lb')).j).includes(A.token), 'токены в рейтинге не светятся');

  console.log('\n[магазин]');
  r = await api('POST', '/api/shop/buy', { item: 'skin9' }, B.tok); ok(r.s === 402, 'без денег купить нельзя (402)');
  r = await api('POST', '/api/shop/buy', { item: 'nope' }, B.tok); ok(r.s === 404, 'несуществующий товар → 404');
  r = await api('POST', '/api/shop/equip', { skin: 9 }, B.tok); ok(r.s === 403, 'надеть чужой скин нельзя');
  // гонка: 10 игроков с деньгами одновременно хотят skin9 (всего 4 штуки)
  const racers = []; for (let i = 0; i < 10; i++) { const P = await join('Гонщик' + i); racers.push(P); await api('POST', '/api/admin/grant', { id: P.id, amount: 13000 }, null, { admin: true, ip: 90 }); }
  const res = await Promise.all(racers.map((P) => api('POST', '/api/shop/buy', { item: 'skin9' }, P.tok)));
  const won = res.filter((x) => x.s === 200).length, sold = res.filter((x) => x.j.reason === 'soldout').length;
  ok(won === 4 && sold === 6, 'лимит 4 шт: купили ровно ' + won + ', «распродано» у ' + sold);
  const sh = (await api('GET', '/api/shop', undefined, racers[0].tok)).j; const it = sh.items.find((x) => x.id === 'skin9');
  ok(it.left === 0 && it.limit === 4, 'витрина показывает 0 осталось');
  r = await api('POST', '/api/shop/buy', { item: 'skin9' }, racers.find((_, i) => res[i].s === 200).tok); ok(r.s === 409, 'повторная покупка того же → 409');
  const winner = racers[res.findIndex((x) => x.s === 200)];
  const mw = (await api('GET', '/api/me', undefined, winner.tok)).j.me; ok(mw.wallet === 1000 && mw.skin === 9, 'деньги списаны (13000−12000), скин надет');
  // двойной клик: тот же игрок шлёт 5 покупок сразу
  const D = await join('Дабл'); await api('POST', '/api/admin/grant', { id: D.id, amount: 3000 }, null, { admin: true, ip: 90 });
  const dd = await Promise.all([1, 2, 3, 4, 5].map(() => api('POST', '/api/shop/buy', { item: 'skin7' }, D.tok)));
  ok(dd.filter((x) => x.s === 200).length === 1 && (await api('GET', '/api/me', undefined, D.tok)).j.me.wallet === 0, 'пять одновременных кликов — спишется один раз');
  ok((await api('POST', '/api/admin/grant', { id: D.id, amount: 5 }, null, { ip: 91 })).s === 403, 'админка без ключа → 403');

  console.log('\n[WebSocket]');
  const wsOpen = (room, tok) => new Promise((res, rej) => { const w = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?room=' + room + (tok ? '&t=' + tok : ''), { headers: { 'x-forwarded-for': '10.9.9.9' } }); w.msgs = []; w.on('message', (d) => w.msgs.push(JSON.parse(d))); w.on('open', () => res(w)); w.on('error', rej); });
  const w1 = await wsOpen('map-city', A.tok), w2 = await wsOpen('map-city', winner.tok);
  w1.send(JSON.stringify({ t: 'presence', data: { x: 10, y: 20, k: 'city', n: 'ВЗЛОМЩИК' } }));
  await sleep(150);
  const got = w2.msgs.find((m) => m.t === 'join'); ok(got && got.presence.n === 'Алиса b', 'имя в комнате берётся с сервера, а не от клиента');
  w1.send('null'); w1.send('[]'); w1.send('{"t":"emit","topic":"coin","data":null}'); w1.send('{"t":"presence","data":null}'); w1.send('{"t":"emit"}');
  await sleep(150);
  ok((await api('GET', '/api/health')).s === 200, 'мусорные WS-сообщения сервер не роняют');
  w1.send(JSON.stringify({ t: 'emit', topic: 'coin', data: { i: 3, k: 'city' } })); await sleep(100);
  ok(w2.msgs.some((m) => m.t === 'emit' && m.data.i === 3), 'монеты ретранслируются');
  w1.close(); w2.close();

  console.log('\n[уровни редактора]');
  r = await api('POST', '/api/levels', { name: 'Мой', items: [{ t: 'p', x: 0, y: 440 }, { t: 's', x: 0, y: 440, w: 500, h: 60 }, { t: 'f', x: 400, y: 440 }] }, A.tok); ok(r.j.ok, 'свой уровень публикуется');
  r = await api('POST', '/api/levels', { name: 'X', items: [{ t: 's', x: 1e12, y: 0, w: 1, h: 1 }] }, A.tok); ok(r.s === 400, 'уровень с огромными числами отклонён');
  r = await api('POST', '/api/levels', { name: 'X', items: [{ t: '__proto__' }] }, A.tok); ok(r.s === 400, 'уровень с чужим типом объекта отклонён');
  ok((await api('GET', '/api/levels/' + A.id)).j.items.length === 3, 'уровень читается по id владельца');

  console.log('\n[защита от флуда и больших запросов]');
  const big = 'A'.repeat(200000); r = await api('POST', '/api/run', { map: 'city', sv, replay: big }, A.tok); ok(r.s === 413 || r.s === 429, 'огромное тело отклоняется (' + r.s + ')');
  let n429 = 0; for (let i = 0; i < 300; i++) { const x = await api('GET', '/api/lb', undefined, null, { ip: 77 }); if (x.s === 429) n429++; } ok(n429 > 0, 'с одного IP больше ~240 запросов в минуту режутся (' + n429 + ')');
  ok((await fetch(BASE + '/..%2f..%2fetc/passwd')).status !== 200 && (await fetch(BASE + '/%2e%2e/server.js')).status !== 200, 'выход из папки public закрыт');
  ok((await fetch(BASE + '/data.json')).status === 404, 'файл базы по HTTP недоступен');
  ok((await fetch(BASE + '/api/col?name=lb')).status === 401 || (await fetch(BASE + '/api/col?name=lb')).status === 404, 'старый открытый API /api/col больше не работает');

  console.log('\n[сохранение после перезапуска]');
  await sleep(2500); await stop(); await start();
  const me2 = (await api('GET', '/api/me', undefined, A.tok)).j.me;
  ok(me2 && me2.wallet === nCoins + 30 && me2.times.city > 8, 'после рестарта кошелёк и рекорд на месте (' + me2.wallet + ')');
  ok((await api('GET', '/api/shop', undefined, A.tok)).j.items.find((x) => x.id === 'skin9').left === 0, 'остатки магазина тоже сохранились');
  console.log('\n[экспорт и восстановление после стирания]');
  await api('POST', '/api/admin/grant', { id: A.id, amount: 1500 }, null, { admin: true, ip: 91 });
  ok((await api('POST', '/api/shop/buy', { item: 'skin6' }, A.tok)).j.ok, 'Алиса покупает лимитку skin6 перед экспортом');
  const walletBefore = (await api('GET', '/api/me', undefined, A.tok)).j.me.wallet;
  const ex = await api('GET', '/api/export', undefined, A.tok); ok(ex.s === 200 && ex.j.file && ex.j.file.sig, 'экспорт отдаёт подписанный файл');
  ok((await api('GET', '/api/export')).s === 401, 'экспорт без токена → 401');
  const file = ex.j.file;
  await stop(); try { fs.unlinkSync(DATA); } catch (e) {} await start();   // «Render уснул и стёр диск»
  ok((await api('GET', '/api/me', undefined, A.tok)).s === 401, 'после стирания аккаунта нет');
  const C = await join('Чужой');
  ok((await api('POST', '/api/restore', { file, code: C.tok }, null, { ip: 90 })).s === 403, 'чужой код входа файл не открывает (нельзя поделиться)');
  ok((await api('POST', '/api/restore', { file, code: '' }, null, { ip: 90 })).s === 403, 'без кода файл не работает');
  const forged = Object.assign({}, file, { data: file.data.replace(/"wallet":\d+/, '"wallet":999999') });
  ok((await api('POST', '/api/restore', { file: forged, code: A.tok }, null, { ip: 90 })).s === 400, 'правка файла (кошелёк) ломает подпись');
  ok((await api('POST', '/api/restore', { file: { f: 'krysholet-backup', data: '{}', sig: 'x' }, code: A.tok }, null, { ip: 90 })).s === 400, 'мусорная подпись отклонена');
  r = await api('POST', '/api/restore', { file, code: A.tok }, null, { ip: 90 });
  ok(r.s === 200 && r.j.me.wallet === walletBefore && r.j.me.owned.includes('skin6') && r.j.me.times.city > 8 && r.j.token === A.token, 'с верным кодом аккаунт вернулся: кошелёк и рекорд на месте');
  ok((await api('GET', '/api/me', undefined, A.tok)).s === 200, 'старый код входа снова работает');
  ok((await api('GET', '/api/shop', undefined, A.tok)).j.items.find((x) => x.id === 'skin6').left === 29, 'лимитка снова посчитана как купленная (осталось 29 из 30)');
  ok((await api('POST', '/api/restore', { file, code: A.tok }, null, { ip: 90 })).s === 409, 'повторное восстановление не создаёт копию (409)');
  await stop();
  console.log('\n' + (fail ? 'ПРОВАЛЕНО: ' + fail : 'ВСЕ ПРОВЕРКИ ПРОШЛИ') + ' (' + pass + ' ок)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { proc.kill(); } catch (_) {} process.exit(1); });
