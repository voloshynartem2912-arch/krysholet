// Go-Explore бот: ищет последовательность нажатий, которая проходит уровень до финиша.
// Уровень решается по частям — от чекпоинта до чекпоинта (между ними игрок «возрождается» событием RES,
// которое сервер умеет проигрывать), поэтому поиск короткий и надёжный.
// Нужен, чтобы (1) доказать, что новые уровни проходимы, (2) получить настоящие записи для теста античита.
const Sim = require('../public/sim.js');
const { M, STEP } = Sim;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function lvSetOf(lv) {
  const set = new Set();
  for (const k of ['solids', 'bars', 'pipes', 'poles', 'pads', 'coins', 'cps', 'hints']) for (const o of lv[k]) set.add(o);
  set.add(lv); set.add(lv.finish);
  return set;
}
function cloneState(S, set) {
  const cl = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (set.has(v)) return v;
    if (Array.isArray(v)) return v.map(cl);
    const o = {}; for (const k in v) o[k] = cl(v[k]); return o;
  };
  const o = {};
  for (const k in S) {
    if (k === 'lv') o.lv = S.lv; else if (k === 'popups' || k === 'parts') o[k] = []; else if (typeof S[k] === 'function') o[k] = S[k]; else o[k] = cl(S[k]);
  }
  return o;
}

function searchSegment(lv, set, S0, seg, budget, rand) {
  const tgt = seg + 1 < lv.cps.length ? lv.cps[seg + 1] : lv.finish;
  const goal = (S) => S.cpIndex > seg || S.done;
  const prog = (S) => -(Math.abs(S.p.x - tgt.x) + 0.6 * Math.abs(S.p.y - tgt.y)) + (S.p.mode !== 'free' ? 20 : 0);
  const cell = (S) => { const p = S.p; return Math.floor(p.x / 24) + '_' + Math.floor(p.y / 24) + '_' + p.mode + '_' + (p.ground ? 1 : 0) + '_' + Math.sign(Math.round(p.vx / 120)) + '_' + (p.mode === 'hang' ? Math.round(p.hang.om * 1.2) + '_' + Math.round(p.hang.th * 2) : Math.sign(Math.round(p.vy / 200))); };
  const randAct = (S) => {
    let m = M.AUTO; const p = S.p;
    if (p.mode === 'hang' && rand() < 0.7) {
      const om = p.hang.om; m |= Math.abs(om) < 0.4 ? (rand() < 0.5 ? M.L : M.R) : (om > 0 ? M.R : M.L);
      const r2 = rand(); if (r2 < 0.12) m |= M.J | M.JP; else if (r2 < 0.17) m |= M.D; else if (r2 < 0.22) m |= M.F;
      return m;
    }
    const d = rand(); m |= d < 0.12 ? 0 : d < 0.22 ? M.L : M.R;
    const e = rand();
    if (e < 0.3) m |= M.J | M.JP; else if (e < 0.4) m |= M.J; else if (e < 0.5) m |= M.U; else if (e < 0.57) m |= M.D;
    else if (e < 0.66) m |= M.F | (rand() < 0.5 ? M.J | M.JP : 0); else if (e < 0.72) m |= M.FB; else if (e < 0.78) m |= M.U | M.J | M.JP;
    if (rand() < 0.1) m |= M.G;
    return m;
  };
  const root = { S: cloneState(S0, set), tick: 0, prev: null, acts: [], visits: 0, prog: prog(S0) };
  const arch = new Map([[cell(S0), root]]), list = [root];
  let ticks = 0, found = null;
  while (ticks < budget && !found) {
    let node;
    if (rand() < 0.5) { let best = null; for (let t = 0; t < 12; t++) { const c = list[Math.floor(rand() * list.length)]; if (!best || c.prog + rand() * 150 > best.prog) best = c; } node = best; }
    else { let best = null; for (let t = 0; t < 8; t++) { const c = list[Math.floor(rand() * list.length)]; if (!best || c.visits < best.visits) best = c; } node = best; }
    node.visits++;
    const S = cloneState(node.S, set), acts = [], steps = 1 + Math.floor(rand() * 4);
    for (let s = 0; s < steps && !found; s++) {
      let a = randAct(S);
      if (rand() < 0.35 && node.acts.length) a = node.acts[node.acts.length - 1] & ~(M.JP | M.CP | M.RES);
      const KK = 3 + Math.floor(rand() * 7);
      for (let k = 0; k < KK; k++) {
        const m = k === 0 ? a : (a & ~M.JP);
        Sim.applyMask(S, m); Sim.step(S, STEP); acts.push(m); ticks++;
        if (goal(S)) { found = { prev: node, acts: acts.slice() }; break; }
        if (S.deaths > S0.deaths) { break; }
        const c = cell(S), ex = arch.get(c), t = node.tick + acts.length;
        if (!ex || (t < ex.tick - 4 && prog(S) >= ex.prog - 1)) {
          const nn = { S: cloneState(S, set), tick: t, prev: node, acts: acts.slice(), visits: ex ? ex.visits : 0, prog: prog(S) };
          if (!ex) list.push(nn); else list[list.indexOf(ex)] = nn;
          arch.set(c, nn);
        }
      }
      if (S.deaths > S0.deaths) break;
    }
  }
  if (!found) { let bn = list[0]; for (const c of list) if (c.prog > bn.prog) bn = c; return { ok: false, best: bn.S.p, ticks }; }
  const parts = [found.acts]; let n = found.prev;
  while (n && n.prev) { parts.push(n.acts); n = n.prev; }
  parts.reverse();
  return { ok: true, masks: [].concat(...parts), ticks };
}

function solve(mapId, opts) {
  opts = opts || {};
  const lv = Sim.buildLevel(mapId), set = lvSetOf(lv), rand = rng(opts.seed || 1);
  const S = Sim.newState(lv); S.noFx = true;
  const all = [], log = [];
  for (let seg = 0; seg < lv.cps.length; seg++) {
    let res = null;
    for (let attempt = 0; attempt < (opts.attempts || 4) && !(res && res.ok); attempt++) {
      const st = cloneState(S, set); st.autoGrab = true;
      if (seg > 0) { Sim.resumeAtCp(st); }
      res = searchSegment(lv, set, st, seg, opts.budget || 150000, rand);
    }
    if (!res.ok) return { ok: false, seg, best: res.best, log };
    const masks = res.masks.slice(); if (seg > 0) masks[0] |= M.RES;
    for (const m of masks) { Sim.applyMask(S, m); Sim.step(S, STEP); }
    all.push(...masks); log.push(masks.length);
  }
  return { ok: true, masks: all, log };
}

module.exports = { solve, cloneState, lvSetOf };

if (require.main === module) {
  const maps = process.argv[2] ? process.argv[2].split(',') : Sim.CHAP;
  for (const id of maps) {
    const t0 = Date.now();
    const res = solve(id, { seed: +process.argv[3] || 1, budget: +process.argv[4] || 150000 });
    if (!res.ok) { console.log(id, 'FAILED at segment', res.seg, 'best', res.best && [Math.round(res.best.x), Math.round(res.best.y), res.best.mode].join(','), 'ms', Date.now() - t0); continue; }
    const r = Sim.replay(id, res.masks);
    console.log(id, r.done ? 'OK' : 'REPLAY-MISMATCH', 'ticks', res.masks.length, 'time', (res.masks.length / 60).toFixed(1) + 's', 'deaths', r.S.deaths, 'coins', r.coins.length + '/' + r.lv.coins.length, 'segs', res.log.join('/'), 'ms', Date.now() - t0);
    if (process.argv[5]) require('fs').writeFileSync(process.argv[5] + '/' + id + '.json', JSON.stringify({ map: id, masks: res.masks }));
  }
}
