// Run: node test/smoke.js [file.csv]  — loads the CSV with worker.js, checks the cache, runs a few filters.
const fs = require('fs'), path = require('path'), assert = require('assert');
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
  const cards = await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page');
  assert.deepStrictEqual(cards.rows[0].hits, [5, 5, 45, 5]);
  const scoreOf = (r) => r.n.reduce((sum, x) => sum + (x === null ? 0 : x), 0) / 5;
  for (const r of cards.rows) {
    const score = scoreOf(r);
    assert.strictEqual(r.ranks.all, 1 + cards.rows.filter((x) => scoreOf(x) > score).length);
    assert.strictEqual(r.ranks.state, 1 + cards.rows.filter((x) => x.uf === r.uf && scoreOf(x) > score).length);
    assert.strictEqual(r.ranks.city, 1 + cards.rows.filter((x) => x.muni === r.muni && scoreOf(x) > score).length);
    assert.strictEqual(r.ranks.school, r.esc > 0 ? 1 + cards.rows.filter((x) => x.esc === r.esc && scoreOf(x) > score).length : null);
  }
  const hitFilter = await q({ ranges: { ACERTOS_CN: [5, 5] } });
  assert(hitFilter.count > 0);
  const languageFilter = await q({ ranges: { ACERTOS_LC: [45, 45] } });
  assert.strictEqual(languageFilter.count, 2);
  await q({ ranges: { NU_SEQUENCIAL: [1461268, 1461268] } });
  const spanish = await send({ t: 'page', offset: 0, limit: 1, rankKey: 'avg' }, 'page');
  assert.strictEqual(spanish.rows[0].hits[2], 45);
  await q({});
  const lcSorted = await send({ t: 'page', offset: 0, limit: 3, sort: 'ACERTOS_LC', dir: 'desc', rankKey: 'wavg', w: [1, 1, 1, 1, 1] }, 'page');
  assert.strictEqual(lcSorted.rows[0].hits[2], 45);
  assert(Number.isInteger(lcSorted.rows[0].ranks.all));
  const r0 = await send({ t: 'filter', metric: 3 }, 'result');
  console.log('per municipality (idx:n:meanMT)', r0.perMuni.map((g, k) => g + ':' + r0.perMuniN[k] + ':' + (r0.perMuniMean[k] && +r0.perMuniMean[k].toFixed(1))).join(' '));
  console.log('stats redacao', JSON.stringify(r0.stats[4]), '\nmean MT per UF', r0.ufs.join(','), r0.perUfMean.map((x) => x && +x.toFixed(1)).join(','));
  await q({ ranges: { NU_NOTA_REDACAO: [800, 1000] } });
  await q({ ranges: { NU_NOTA_MT: [500, 1000] }, ufs: ['SP', 'RJ'] });
  await q({ cats: { TP_PRESENCA_MT: [1], TP_LINGUA: [1] } });
  await q({ muni: [0] }); // first municipality seen (Rio de Janeiro)
  await q({ ranges: { NU_SEQUENCIAL: [3148322, 3148322] } }); // exact id
  await q({ ranges: { NU_NOTA_MT: [0, 1000] } }); // excludes absent (NaN)
  await q({ ranges: { NU_NOTA_MT: [0, 1000] } });
  const pg = async (x) => { const r = await send({ t: 'page', limit: 3, offset: 0, ...x }, 'page'); console.log('page', JSON.stringify(x), r.total, r.rows.map((y) => y.id + ':' + y.n[4]).join(' ')); };
  await pg({}); await pg({ sort: 'ACERTOS_LC', dir: 'desc' }); await pg({ sort: 'ACERTOS_TOTAL', dir: 'desc' }); await pg({ sort: 'NU_NOTA_REDACAO', dir: 'desc' }); await pg({ sort: 'NU_NOTA_REDACAO', dir: 'asc', offset: 1 });
  await q({}); await pg({ sort: 'avg', dir: 'desc', w: [1, 1, 1, 1, 1], limit: 6 }); // all 6 rows: those without scores go last await pg({ sort: 'wavg', dir: 'desc', w: [0, 0, 0, 1, 0] }); await pg({ sort: 'wavg', dir: 'asc', w: [1, 1, 1, 3, 1] });
  await send({ t: 'release' }, 'released');
  console.log('cache meta:', (await send({ t: 'init' }, 'cache')).meta.rows, 'rows');
  const l = await send({ t: 'usecache' }, 'loaded'); console.log('from cache:', l.rows, l.cached, l.ufs.join(','), l.munis.length, 'munis');
  await q({});
  const cachedRanks = await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page');
  assert.deepStrictEqual(cachedRanks.rows.map((r) => r.ranks), cards.rows.map((r) => r.ranks));
  await q({ ranges: { NU_NOTA_REDACAO: [800, 1000] } }); await q({ muni: [0] });
  const savedMeta = store.get('meta');
  for (const k of ['RANK_AVG_ALL', 'RANK_AVG_STATE', 'RANK_AVG_CITY', 'RANK_AVG_SCHOOL']) { store.delete('col:' + k); }
  store.set('meta', { ...savedMeta, v: 3, cols: savedMeta.cols.filter((k) => !k.startsWith('RANK_AVG_')) });
  await send({ t: 'release' }, 'released');
  await send({ t: 'init' }, 'cache');
  const migrated = await send({ t: 'usecache' }, 'loaded');
  assert(migrated.cached && store.get('meta').v === 4);
  await q({});
  const migratedRanks = await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page');
  assert.deepStrictEqual(migratedRanks.rows.map((r) => r.ranks), cards.rows.map((r) => r.ranks));
  await send({ t: 'clearcache' }, 'cleared'); console.log('after clear:', (await send({ t: 'init' }, 'nocache')).t);
})();
