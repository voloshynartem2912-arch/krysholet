// Магазин и экономика. Все цифры здесь — меняй под себя.
// limit — сколько штук ВСЕГО на весь сервер (null = без ограничения). Один игрок может купить предмет только один раз.
const ITEMS = [
  // обычные скины
  { id: 'skin1', kind: 'skin', skin: 1, n: 'Бирюза', price: 60 },
  { id: 'skin2', kind: 'skin', skin: 2, n: 'Лесник', price: 100 },
  { id: 'skin3', kind: 'skin', skin: 3, n: 'Ниндзя', price: 160 },
  { id: 'skin4', kind: 'skin', skin: 4, n: 'Золото', price: 250 },
  { id: 'skin5', kind: 'skin', skin: 5, n: 'Неон', price: 400 },
  // лимитированные скины
  { id: 'skin6', kind: 'skin', skin: 6, n: 'Призрак', price: 1500, limit: 30 },
  { id: 'skin7', kind: 'skin', skin: 7, n: 'Магма', price: 3000, limit: 15 },
  { id: 'skin8', kind: 'skin', skin: 8, n: 'Радуга', price: 6000, limit: 8 },
  { id: 'skin9', kind: 'skin', skin: 9, n: 'Космонавт «Зенит»', price: 12000, limit: 4 },
  // лимитированные значки (видны в рейтинге и над призраком в игре вместе)
  { id: 'badge1', kind: 'badge', badge: '🚀', n: 'Значок «Ракета»', price: 2500, limit: 20 },
  { id: 'badge2', kind: 'badge', badge: '⚡', n: 'Значок «Молния»', price: 4500, limit: 10 },
  { id: 'badge3', kind: 'badge', badge: '👑', n: 'Значок «Корона»', price: 20000, limit: 2 },
];
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const BADGES = ITEMS.filter((i) => i.kind === 'badge').map((i) => i.badge);

const ECON = {
  coin: 1,                 // за каждую монету, подобранную впервые (на каждой карте)
  firstWin: 20,            // за первое прохождение карты
  repeatBase: 10,          // за каждое следующее прохождение: base + perChapter * номер главы (0..)
  repeatPerChapter: 4,
  repeatMinSeconds: 15,    // слишком короткие забеги не оплачиваются
  repeatPerHour: 24,       // не больше стольких оплачиваемых прохождений в час
  maxTicks: 60 * 60 * 10,  // самый длинный забег — 10 минут
  runGapMs: 2500,          // не чаще одной отправки забега в 2.5 с на игрока
  runsPerHour: 240,
};
const repeatReward = (chapterIndex) => ECON.repeatBase + ECON.repeatPerChapter * Math.max(0, chapterIndex);

module.exports = { ITEMS, BY_ID, BADGES, ECON, repeatReward };
