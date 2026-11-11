// Run: node test/smoke.js [file.csv]  — loads the CSV with worker.js, checks the cache, runs a few filters.
const fs = require('fs'), path = require('path'), assert = require('assert'), zlib = require('zlib');
const store = new Map(); // minimal in-memory IndexedDB fake (get/put/clear on one store)
global.indexedDB = { open() {
  const r = {};
  setTimeout(() => { r.result = { createObjectStore() {}, close() {}, transaction() {
    const t = {}, req = (f) => { const q = {}; setTimeout(() => { q.result = f(); setTimeout(() => t.oncomplete && t.oncomplete()); }); return q; };
    t.objectStore = () => ({ put: (v, k) => req(() => store.set(k, structuredClone(v))), get: (k) => req(() => store.get(k)), clear: () => req(() => store.clear()) });
    return t; } }; r.onsuccess && r.onsuccess(); });
  return r; } };
const opfsFiles = new Map(); // minimal OPFS fake: one directory of named files with sync write handles
Object.defineProperty(navigator, 'storage', { value: { getDirectory: async () => ({
  getFileHandle: async (name, o) => {
    if (!opfsFiles.has(name) && !(o && o.create)) throw new Error('NotFound');
    if (!opfsFiles.has(name)) opfsFiles.set(name, Buffer.alloc(0));
    return { getFile: async () => new File([opfsFiles.get(name)], name), createSyncAccessHandle: async () => ({ flush() {}, close() {}, truncate: () => opfsFiles.set(name, Buffer.alloc(0)),
      write(b, { at }) { const old = opfsFiles.get(name), nb = Buffer.alloc(Math.max(old.length, at + b.length)); old.copy(nb); Buffer.from(b).copy(nb, at); opfsFiles.set(name, nb); } }) };
  },
  removeEntry: async (name) => { opfsFiles.delete(name); } }) } });
function zip(entries, z64) { // deflated ZIP builder; z64 = every size and offset in ZIP64 extra fields
  const parts = [], cds = []; let off = 0;
  for (const [name, data] of entries) {
    const raw = zlib.deflateRawSync(data), nm = Buffer.from(name), big = 0xFFFFFFFF, w = (b, o, v) => b.writeBigUInt64LE(BigInt(v), o);
    const lx = Buffer.alloc(z64 ? 20 : 0), cx = Buffer.alloc(z64 ? 28 : 0), lh = Buffer.alloc(30), cd = Buffer.alloc(46);
    if (z64) { lx.writeUInt16LE(1, 0); lx.writeUInt16LE(16, 2); w(lx, 4, data.length); w(lx, 12, raw.length); cx.writeUInt16LE(1, 0); cx.writeUInt16LE(24, 2); w(cx, 4, data.length); w(cx, 12, raw.length); w(cx, 20, off); }
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(z64 ? big : raw.length, 18); lh.writeUInt32LE(z64 ? big : data.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(lx.length, 28);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(z64 ? big : raw.length, 20); cd.writeUInt32LE(z64 ? big : data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt16LE(cx.length, 30); cd.writeUInt32LE(z64 ? big : off, 42);
    const piece = Buffer.concat([lh, nm, lx, raw]); parts.push(piece); cds.push(cd, nm, cx); off += piece.length;
  }
  const cdb = Buffer.concat(cds), eo = Buffer.alloc(22), tail = [];
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(z64 ? 0xFFFF : entries.length, 8); eo.writeUInt16LE(z64 ? 0xFFFF : entries.length, 10); eo.writeUInt32LE(z64 ? 0xFFFFFFFF : cdb.length, 12); eo.writeUInt32LE(z64 ? 0xFFFFFFFF : off, 16);
  if (z64) { const r = Buffer.alloc(56), l = Buffer.alloc(20); r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4); r.writeBigUInt64LE(BigInt(entries.length), 24); r.writeBigUInt64LE(BigInt(entries.length), 32); r.writeBigUInt64LE(BigInt(cdb.length), 40); r.writeBigUInt64LE(BigInt(off), 48);
    l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cdb.length), 8); l.writeUInt32LE(1, 16); tail.push(r, l); }
  return Buffer.concat([...parts, cdb, ...tail, eo]);
}
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
  const allStats = await q({});
  const cards = await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page');
  assert.deepStrictEqual(cards.rows[0].hits, [5, 5, 45, 5]);
  const scoreOf = (r) => r.n.reduce((sum, x) => sum + (x === null ? 0 : x), 0) / 5;
  assert(Math.abs(allStats.simpleStats.mean - cards.rows.reduce((sum, r) => sum + scoreOf(r), 0) / cards.rows.length) < 0.01);
  assert.strictEqual(allStats.simpleStats.n, allStats.count);
  const first = cards.rows[0], cell = (k) => allStats.hitScore[k][first.hits[k]]; // [n, min, mean, max]
  for (let k = 0; k < 4; k++) if (first.n[k] !== null) assert(cell(k)[0] >= 1 && cell(k)[1] - 0.1 <= first.n[k] && first.n[k] <= cell(k)[3] + 0.1);
  for (let k = 0; k < 4; k++) assert(allStats.hitScore[k].reduce((s, c) => s + (c ? c[0] : 0), 0) <= allStats.stats[k].n);
  for (const r of cards.rows) {
    const score = scoreOf(r);
    assert.strictEqual(r.ranks.all, 1 + cards.rows.filter((x) => scoreOf(x) > score).length);
    assert.strictEqual(r.ranks.state, 1 + cards.rows.filter((x) => x.uf === r.uf && scoreOf(x) > score).length);
    assert.strictEqual(r.ranks.city, 1 + cards.rows.filter((x) => x.muni === r.muni && scoreOf(x) > score).length);
    assert.strictEqual(r.ranks.school, r.esc > 0 ? 1 + cards.rows.filter((x) => x.esc === r.esc && scoreOf(x) > score).length : null);
  }
  const checkDetail = async (rows, fl = file) => { // one CSV row re-read on demand must agree with what the load computed
    for (const r of rows) {
      const d = await send({ t: 'detail', id: r.i, i: r.i, file: fl }, 'detail');
      assert(!d.error, d.error);
      d.sheet.forEach((s, k) => { if (s) assert.strictEqual([...s.a].filter((a, j) => a >= 'A' && a <= 'E' && a === s.k[j]).length, r.hits[k]); });
      assert.strictEqual(d.essay.final.length, 6);
    }
    if (fl) { const bad = await send({ t: 'detail', id: 99, i: 0, file: new File([fs.readFileSync(f).subarray(0, 300)], 'y.csv') }, 'detail');
    assert(bad.error, 'a different file must be rejected'); }
  };
  await checkDetail(cards.rows); console.log('detail ok', JSON.stringify((await send({ t: 'detail', id: 1, i: cards.rows[0].i, file }, 'detail')).essay));
  const hitFilter = await q({ ranges: { ACERTOS_CN: [5, 5] } });
  assert(hitFilter.count > 0);
  const combinedFilter = await q({ ranges: { MEDIA_SIMPLES: [595, 596], ACERTOS_TOTAL: [60, 60] } });
  assert.strictEqual(combinedFilter.count, 1);
  const competencyFilter = await q({ ranges: { NU_NOTA_COMP1: [120, 120] } });
  assert(competencyFilter.count > 0);
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
  await checkDetail((await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page')).rows); // also works after loading from the cache
  const cachedRanks = await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page');
  assert.deepStrictEqual(cachedRanks.rows.map((r) => r.ranks), cards.rows.map((r) => r.ranks));
  await q({ ranges: { NU_NOTA_REDACAO: [800, 1000] } }); await q({ muni: [0] });
  const csv = fs.readFileSync(f);
  for (const z64 of [false, true]) { // the official ZIP, then ZIP64: the CSV is streamed out of the archive; details come from the temporary OPFS copy, no file needed
    const zf = new File([zip([['DADOS/PARTICIPANTES_2024.csv', Buffer.from('NU_INSCRICAO;Q001\n1;A\n')], ['DADOS/RESULTADOS_2024.csv', csv]], z64)], 'enem.zip');
    const savedZip = wait('saved');
    const lz = await send({ t: 'load', file: zf }, 'loaded'); await savedZip;
    assert(lz.copy && lz.rows === allStats.total, 'zip rows');
    assert(opfsFiles.get('resultados.csv').equals(csv), 'OPFS copy equals the CSV');
    assert.deepStrictEqual(await q({}).then((r) => r.stats), allStats.stats);
    await checkDetail((await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page')).rows, null);
    await send({ t: 'release' }, 'released'); await send({ t: 'init' }, 'cache');
    assert((await send({ t: 'usecache' }, 'loaded')).copy);
    await q({}); await checkDetail((await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page')).rows, null); // after the cache too
    console.log('zip ok', z64 ? '(ZIP64)' : '');
  }
  await send({ t: 'clearcache' }, 'cleared'); assert(!opfsFiles.has('resultados.csv'), 'copy deleted'); console.log('after clear:', (await send({ t: 'init' }, 'nocache')).t);
})();
