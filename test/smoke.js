// Run: node test/smoke.js [file.csv]  — loads the CSV with worker.js, checks the cache, runs a few filters.
const fs = require('fs'), path = require('path');
const store = new Map(); // minimal in-memory IndexedDB fake (get/put/clear on one store)
global.indexedDB = { open() {
  const r = {};
  setTimeout(() => { r.result = { createObjectStore() {}, close() {}, transaction() {
    const t = {}, req = (f) => { const q = {}; setTimeout(() => { q.result = f(); setTimeout(() => t.oncomplete && t.oncomplete()); }); return q; };
    t.objectStore = () => ({ put: (v, k) => req(() => store.set(k, structuredClone(v))), get: (k) => req(() => store.get(k)), clear: () => req(() => store.clear()) });
    return t; } }; r.onsuccess && r.onsuccess(); });
  return r; } };
const waiters = [];
global.self = {}; global.postMessage = (m) => { if (m.t === 'error') console.log(m); for (const w of waiters.filter((x) => x.t === m.t)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } };
require('../worker.js');
const wait = (t) => new Promise((res) => waiters.push({ t, res }));
const send = (d, t) => { const p = wait(t); self.onmessage({ data: d }); return p; };
(async () => {
  const f = process.argv[2] || path.join(__dirname, '../sample/sample.csv');
  const file = new File([fs.readFileSync(f)], 'x.csv');
  const saved = wait('saved');
  console.log(await send({ t: 'load', file }, 'loaded')); await saved;
  const q = async (x) => { const r = await send({ t: 'filter', ...x }, 'result'); console.log(JSON.stringify(x), '->', r.count, '/', r.total, r.ms + 'ms', r.perUf.join(',')); return r; };
  await q({});
  const r0 = await send({ t: 'filter', metric: 3 }, 'result');
  console.log('stats redacao', JSON.stringify(r0.stats[4]), '\nmean MT per UF', r0.ufs.join(','), r0.perUfMean.map((x) => x && +x.toFixed(1)).join(','));
  await q({ ranges: { NU_NOTA_REDACAO: [800, 1000] } });
  await q({ ranges: { NU_NOTA_MT: [500, 1000] }, ufs: ['SP', 'RJ'] });
  await q({ cats: { TP_PRESENCA_MT: [1], TP_LINGUA: [1] } });
  await q({ muni: [0] }); // first municipality seen (Rio de Janeiro)
  await q({ ranges: { NU_SEQUENCIAL: [3148322, 3148322] } }); // exact id
  await q({ ranges: { NU_NOTA_MT: [0, 1000] } }); // excludes absent (NaN)
  await q({ ranges: { NU_NOTA_MT: [0, 1000] } });
  const pg = async (x) => { const r = await send({ t: 'page', limit: 3, offset: 0, ...x }, 'page'); console.log('page', JSON.stringify(x), r.total, r.rows.map((y) => y.id + ':' + y.n[4]).join(' ')); };
  await pg({}); await pg({ sort: 'NU_NOTA_REDACAO', dir: 'desc' }); await pg({ sort: 'NU_NOTA_REDACAO', dir: 'asc', offset: 1 });
  await q({}); await pg({ sort: 'avg', dir: 'desc', w: [1, 1, 1, 1, 1], limit: 6 }); // all 6 rows: those without scores go last await pg({ sort: 'wavg', dir: 'desc', w: [0, 0, 0, 1, 0] }); await pg({ sort: 'wavg', dir: 'asc', w: [1, 1, 1, 3, 1] });
  await send({ t: 'release' }, 'released');
  console.log('cache meta:', (await send({ t: 'init' }, 'cache')).meta.rows, 'rows');
  const l = await send({ t: 'usecache' }, 'loaded'); console.log('from cache:', l.rows, l.cached, l.ufs.join(','), l.munis.length, 'munis');
  await q({ ranges: { NU_NOTA_REDACAO: [800, 1000] } }); await q({ muni: [0] });
  await send({ t: 'clearcache' }, 'cleared'); console.log('after clear:', (await send({ t: 'init' }, 'nocache')).t);
})();
