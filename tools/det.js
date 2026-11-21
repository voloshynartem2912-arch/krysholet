// Сравнивает прогон записи в Node и в настоящем Chromium: положение игрока на КАЖДОМ тике должно совпасть до последнего бита.
const fs = require('fs'), { chromium } = require('playwright');
const Sim = require('../public/sim.js');
const simSrc = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'sim.js'), 'utf8');
function sumNode(map, masks) {
  let h = 0, n = 0; const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const r = Sim.replay(map, masks, { onTick: (S) => { f[0] = S.p.x; h = (Math.imul(h, 31) + u[0] + u[1]) | 0; f[0] = S.p.y; h = (Math.imul(h, 31) + u[0] + u[1]) | 0; f[0] = S.p.rot; h = (Math.imul(h, 31) + u[0] + u[1]) | 0; } });
  return { h, ticks: r.ticks, done: r.done, score: r.S.score, coins: r.S.coins, time: r.S.time, x: r.S.p.x };
}
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); await pg.setContent('<html></html>'); await pg.addScriptTag({ content: simSrc });
  console.log('browser:', b.version());
  for (const id of Sim.CHAP) {
    const f = 'replays/' + id + '.json'; if (!fs.existsSync(f)) continue;
    const { masks } = JSON.parse(fs.readFileSync(f)); const nodeR = sumNode(id, masks);
    const brR = await pg.evaluate(([map, masks]) => {
      let h = 0; const f = new Float64Array(1), u = new Uint32Array(f.buffer);
      const r = Sim.replay(map, masks, { onTick: (S) => { f[0] = S.p.x; h = (Math.imul(h, 31) + u[0] + u[1]) | 0; f[0] = S.p.y; h = (Math.imul(h, 31) + u[0] + u[1]) | 0; f[0] = S.p.rot; h = (Math.imul(h, 31) + u[0] + u[1]) | 0; } });
      return { h, ticks: r.ticks, done: r.done, score: r.S.score, coins: r.S.coins, time: r.S.time, x: r.S.p.x };
    }, [id, masks]);
    console.log(id.padEnd(9), JSON.stringify(nodeR) === JSON.stringify(brR) ? 'IDENTICAL' : 'DIFFERENT', 'ticks', nodeR.ticks, 'score', nodeR.score, 'hash', nodeR.h, brR.h);
  }
  await b.close();
})();
