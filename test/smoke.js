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
function zip(entries, z64, d64) { // deflated ZIP builder; z64 = every size and offset in ZIP64 extra fields; d64 = method 9 (literal-only Huffman is valid Deflate64 too)
  const parts = [], cds = []; let off = 0;
  for (const [name, data] of entries) {
    const raw = zlib.deflateRawSync(data, d64 ? { strategy: zlib.constants.Z_HUFFMAN_ONLY } : {}), nm = Buffer.from(name), big = 0xFFFFFFFF, w = (b, o, v) => b.writeBigUInt64LE(BigInt(v), o);
    const lx = Buffer.alloc(z64 ? 20 : 0), cx = Buffer.alloc(z64 ? 28 : 0), lh = Buffer.alloc(30), cd = Buffer.alloc(46);
    if (z64) { lx.writeUInt16LE(1, 0); lx.writeUInt16LE(16, 2); w(lx, 4, data.length); w(lx, 12, raw.length); cx.writeUInt16LE(1, 0); cx.writeUInt16LE(24, 2); w(cx, 4, data.length); w(cx, 12, raw.length); w(cx, 20, off); }
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(d64 ? 9 : 8, 8); lh.writeUInt32LE(z64 ? big : raw.length, 18); lh.writeUInt32LE(z64 ? big : data.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(lx.length, 28);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(d64 ? 9 : 8, 10); cd.writeUInt32LE(z64 ? big : raw.length, 20); cd.writeUInt32LE(z64 ? big : data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt16LE(cx.length, 30); cd.writeUInt32LE(z64 ? big : off, 42);
    const piece = Buffer.concat([lh, nm, lx, raw]); parts.push(piece); cds.push(cd, nm, cx); off += piece.length;
  }
  const cdb = Buffer.concat(cds), eo = Buffer.alloc(22), tail = [];
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(z64 ? 0xFFFF : entries.length, 8); eo.writeUInt16LE(z64 ? 0xFFFF : entries.length, 10); eo.writeUInt32LE(z64 ? 0xFFFFFFFF : cdb.length, 12); eo.writeUInt32LE(z64 ? 0xFFFFFFFF : off, 16);
  if (z64) { const r = Buffer.alloc(56), l = Buffer.alloc(20); r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4); r.writeBigUInt64LE(BigInt(entries.length), 24); r.writeBigUInt64LE(BigInt(entries.length), 32); r.writeBigUInt64LE(BigInt(cdb.length), 40); r.writeBigUInt64LE(BigInt(off), 48);
    l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cdb.length), 8); l.writeUInt32LE(1, 16); tail.push(r, l); }
  return Buffer.concat([...parts, cdb, ...tail, eo]);
}
const PART = Buffer.from('NU_INSCRICAO;NU_ANO;TP_FAIXA_ETARIA;TP_SEXO;TP_ESTADO_CIVIL;TP_COR_RACA;TP_NACIONALIDADE;TP_ST_CONCLUSAO;TP_ANO_CONCLUIU;TP_ENSINO;IN_TREINEIRO;CO_MUNICIPIO_PROVA;NO_MUNICIPIO_PROVA;CO_UF_PROVA;SG_UF_PROVA;' + Array.from({ length: 23 }, (_, i) => 'Q' + String(i + 1).padStart(3, '0')).join(';') + '\n' + [
  '210062064233;2024;5;F;1;1;1;1;3;;0;4314902;Porto Alegre;43;RS;F;F;C;D;4;B;C;A;C;D;C;B;B;A;B;B;B;D;A;B;B;E;A',
  '210062064234;2024;11;F;1;1;1;1;10;;0;4318903;São Luiz Gonzaga;43;RS;B;C;A;D;2;B;E;A;B;B;B;B;B;A;A;A;A;B;A;B;A;C;A',
  '210062064235;2024;11;F;1;1;1;1;9;;0;4314902;Porto Alegre;43;RS;H;F;F;D;5;B;J;A;C;D;B;B;C;A;B;B;B;D;B;B;A;D;A',
  '210062064236;2024;3;F;1;3;1;2;0;1;0;3550308;São Paulo;35;SP;B;B;B;B;6;A;C;A;B;C;B;A;B;A;B;A;A;A;A;B;A;D;A',
  '210062064267;2024;1;M;1;1;1;3;0;;1;3550308;São Paulo;35;SP;G;F;E;D;3;A;D;A;B;C;B;A;B;A;B;B;A;B;B;B;B;D;D',
  '210062064381;2024;11;F;0;0;1;1;9;;0;4314902;Porto Alegre;43;RS;D;B;B;F;3;A;A;A;B;B;A;A;B;A;B;A;A;B;A;B;A;D;A'].join('\n') + '\n');
const DICT = (() => { // minimal .xlsx: shared strings, numeric codes, a footnote mark, an XML entity, a self-closing cell, a section title, and a second sheet that must be ignored
  const S = ['TP_FAIXA_ETARIA', 'Faixa etária', 'Menor de 17 anos', '17 anos', 'TP_SEXO', 'Sexo2', 'M', 'Masculino', 'F', 'Feminino', 'Q007', 'Renda &amp; família', 'A', 'Nenhuma Renda', 'C', 'De R$ 1.412,01 até R$ 2.118,00.', 'DADOS DO PARTICIPANTE', '1. Referente ao Enem 2024', 'ERRADO'];
  const c = (r, v, t) => `<c r="${r}"${t === 's' ? ' t="s"' : ''}><v>${v}</v></c>`, str = (r, i) => c(r, i, 's');
  const sheet1 = '<worksheet><sheetData>' + [
    `<row r="5">${str('A5', 16)}<c r="B5" s="1"/></row>`, `<row r="6">${str('A6', 0)}${str('B6', 1)}${c('C6', 1)}${str('D6', 2)}</row>`, `<row r="7">${c('C7', 2)}${str('D7', 3)}</row>`,
    `<row r="8">${str('A8', 4)}${str('B8', 5)}${str('C8', 6)}${str('D8', 7)}</row>`, `<row r="9">${str('C9', 8)}${str('D9', 9)}</row>`,
    `<row r="10">${str('A10', 10)}${str('B10', 11)}${str('C10', 12)}${str('D10', 13)}</row>`, `<row r="11">${str('C11', 14)}${str('D11', 15)}</row>`, `<row r="12">${str('A12', 17)}${str('C12', 12)}${str('D12', 18)}</row>`].join('') + '</sheetData></worksheet>';
  const sheet2 = `<worksheet><sheetData><row r="6">${str('A6', 10)}${str('C6', 12)}${str('D6', 18)}</row></sheetData></worksheet>`;
  return zip([['[Content_Types].xml', Buffer.from('<Types/>')], ['xl/workbook.xml', Buffer.from('<workbook><sheets><sheet name="RESULTADOS_2024" sheetId="2" r:id="rId2"/><sheet name="PARTICIPANTES_2024" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Type="x" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>')],
    ['xl/sharedStrings.xml', Buffer.from('<sst>' + S.map((x) => `<si><t>${x}</t></si>`).join('') + '</sst>')], ['xl/worksheets/sheet1.xml', Buffer.from(sheet1)], ['xl/worksheets/sheet2.xml', Buffer.from(sheet2)]], false);
})();
const waiters = [];
global.self = {}; global.postMessage = (m) => { if (m.t === 'error') console.log(m); for (const w of waiters.filter((x) => x.t === m.t)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } };
require('../worker.js');
const wait = (t) => new Promise((res) => waiters.push({ t, res }));
const send = (d, t) => { const p = wait(t); self.onmessage({ data: d }); return p; };
(async () => {
  const f = process.argv[2] || path.join(__dirname, '../sample/sample.csv');
  const file = new File([fs.readFileSync(f)], 'x.csv');
  const saved = wait('saved');
  const csvLoad = await send({ t: 'load', file }, 'loaded'); await saved; console.log(csvLoad);
  assert.strictEqual(csvLoad.profile, null, 'a plain CSV has no profile');
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
    const zf = new File([zip([['microdados_enem_2024/DADOS/PARTICIPANTES_2024.csv', PART], ['microdados_enem_2024/DICION\u00c1RIO/Dicion\u00e1rio_Microdados_Enem_2024.xlsx', DICT], ['microdados_enem_2024/DADOS/RESULTADOS_2024.csv', csv]], z64)], 'enem.zip');
    const savedZip = wait('saved');
    const lz = await send({ t: 'load', file: zf }, 'loaded'); await savedZip;
    assert(lz.copy && lz.rows === allStats.total, 'zip rows');
    assert(opfsFiles.get('resultados.csv').equals(csv), 'OPFS copy equals the CSV');
    assert.deepStrictEqual(await q({}).then((r) => r.stats), allStats.stats);
    assert.deepStrictEqual(lz.notes, []); assert.strictEqual(lz.profile.rows, 6);
    const v = (name) => lz.profile.vars.find((x) => x.name === name), col = (name) => [...store.get('pcol:' + name)];
    assert.deepStrictEqual(v('TP_SEXO').opts.map(([, k, l]) => k + ':' + l), ['M:Masculino', 'F:Feminino'], 'dictionary order, footnote mark removed');
    assert.strictEqual(v('TP_SEXO').desc, 'Sexo'); assert.strictEqual(v('Q007').desc, 'Renda & família');
    const lab = (name) => v(name).opts.map(([, k, l]) => k + ':' + l); // listed codes first, in dictionary order; unlisted ones after, as first seen, unlabeled
    assert.deepStrictEqual(lab('Q007'), ['A:Nenhuma Renda', 'C:De R$ 1.412,01 até R$ 2.118,00.', 'E:null', 'J:null', 'D:null']);
    assert.deepStrictEqual(lab('TP_FAIXA_ETARIA'), ['1:Menor de 17 anos', '5:null', '11:null', '3:null']);
    assert.deepStrictEqual(col('TP_SEXO'), [0, 0, 0, 0, 1, 0]); assert.deepStrictEqual(col('TP_ENSINO'), [255, 255, 255, 0, 255, 255], 'empty = 255');
    assert.deepStrictEqual(col('TP_FAIXA_ETARIA'), [0, 1, 1, 2, 3, 1]); assert.deepStrictEqual(col('SG_UF_PROVA'), [0, 0, 0, 1, 1, 0]);
    assert.deepStrictEqual(col('NO_MUNICIPIO_PROVA'), [0, 1, 0, 2, 2, 0]);
    await checkDetail((await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page')).rows, null);
    await send({ t: 'release' }, 'released'); await send({ t: 'init' }, 'cache');
    const lc = await send({ t: 'usecache' }, 'loaded'); assert(lc.copy); assert.deepStrictEqual(lc.profile, lz.profile, 'the profile survives the cache');
    await q({}); await checkDetail((await send({ t: 'page', offset: 0, limit: 6, rankKey: 'avg' }, 'page')).rows, null); // after the cache too
    console.log('zip ok', z64 ? '(ZIP64)' : '');
  }
  const noPart = new File([zip([['microdados_enem_2024/DADOS/RESULTADOS_2024.csv', csv]], false)], 'enem.zip'); // a ZIP without profile or dictionary still loads the results
  const lp = await send({ t: 'load', file: noPart }, 'loaded'); assert.strictEqual(lp.profile, null); assert(lp.notes.length === 2, lp.notes.join('|')); assert.strictEqual(lp.rows, allStats.total);
  const noDict = await send({ t: 'load', file: new File([zip([['microdados_enem_2024/DADOS/PARTICIPANTES_2024.csv', PART], ['microdados_enem_2024/DADOS/RESULTADOS_2024.csv', csv]], false)], 'enem.zip') }, 'loaded');
  assert.strictEqual(noDict.profile.rows, 6); assert(noDict.notes.length === 1 && noDict.profile.vars.every((x) => x.desc === null && x.opts.every((o) => o[2] === null)), 'no dictionary: codes stay unlabeled');
  console.log('profile ok');
  const d9 = await send({ t: 'load', file: new File([zip([['microdados_enem_2024/DADOS/RESULTADOS_2024.csv', csv]], false, true)], 'enem.zip') }, 'loaded'); assert.strictEqual(d9.rows, allStats.total, 'deflate64 rows'); console.log('deflate64 ok');
  // item statistics: hits are attributed per (exam, position); LC keeps English and Spanish apart
  const H = fs.readFileSync(f, 'utf8').split('\n')[0].replace(/^\uFEFF/, '').split(';');
  const csvRow = (i, lang, cn = '9001') => { // 45-char answers; the CN exam code varies so two colours can be tested
    const v = H.map(() => ''), put = (k, x) => { v[H.indexOf(k)] = x; };
    put('NU_SEQUENCIAL', String(9000 + i));
    for (const k of ['TP_PRESENCA_CN', 'TP_PRESENCA_CH', 'TP_PRESENCA_LC', 'TP_PRESENCA_MT']) put(k, '1');
    for (const k of ['CO_PROVA_CH', 'CO_PROVA_LC', 'CO_PROVA_MT']) put(k, '9001');
    put('CO_PROVA_CN', cn);
    put('TP_LINGUA', String(lang));
    put('TX_RESPOSTAS_CN', 'A'.repeat(45)); put('TX_GABARITO_CN', 'A'.repeat(45));
    put('TX_RESPOSTAS_CH', 'A'.repeat(45)); put('TX_GABARITO_CH', 'B'.repeat(45));
    put('TX_RESPOSTAS_MT', 'A'.repeat(45)); put('TX_GABARITO_MT', 'A'.repeat(45));
    put('TX_RESPOSTAS_LC', 'A'.repeat(45));
    put('TX_GABARITO_LC', 'A'.repeat(5) + 'B'.repeat(5) + 'A'.repeat(40)); // 5 English + 5 Spanish + 40 common
    return v.join(';');
  };
  const itens = ['CO_POSICAO;SG_AREA;CO_ITEM;TX_GABARITO;CO_HABILIDADE;IN_ITEM_ABAN;TX_MOTIVO_ABAN;NU_PARAM_A;NU_PARAM_B;NU_PARAM_C;TX_COR;CO_PROVA;TP_LINGUA;IN_ITEM_ADAPTADO'];
  const BASE = { LC: 0, CH: 45, CN: 90, MT: 135 }; // CO_POSICAO is the question number in the whole exam, not inside the area
  const posOf = (area, p) => BASE[area] + p;
  const item = (area, pos, id, gab, lang, cp = 9001) => `${pos};${area};${id};${gab};1;0;;1.2;0.3;0.2;AZUL;${cp};${lang};0`;
  for (let p = 1; p <= 45; p++) {
    itens.push(item('CN', posOf('CN', p), 1000 + p, 'A', ''), item('CH', posOf('CH', p), 2000 + p, 'B', ''), item('MT', posOf('MT', p), 3000 + p, 'A', ''));
    itens.push(p <= 5 ? item('LC', posOf('LC', p), 4000 + p, 'A', '0') : item('LC', posOf('LC', p), 4200 + p, 'A', ''));
    if (p <= 5) itens.push(item('LC', posOf('LC', p), 4100 + p, 'B', '1'));
  }
  itens.push(item('CN', posOf('CN', 2), 1001, 'A', '', 9002)); // the same item in a second colour, at another position
  const li = await send({ t: 'load', file: new File([zip([['microdados_enem_2024/DADOS/RESULTADOS_2024.csv',
    Buffer.from([H.join(';'), csvRow(0, 0), csvRow(1, 0, '9002'), csvRow(2, 1, '9002')].join('\n') + '\n')],
    ['microdados_enem_2024/DADOS/ITENS_PROVA_2024.csv', Buffer.from(itens.join('\n') + '\n')]], false)], 'enem-itens.zip') }, 'loaded');
  const by = (area, id) => li.items[area].find((x) => x.id === id);
  assert.strictEqual(li.items.CN.length, 45); assert.strictEqual(li.items.LC.length, 50); // 40 common + 5 English + 5 Spanish
  assert.strictEqual(by('CN', 1001).pct, 1); assert.strictEqual(by('CN', 1001).answered, 3);
  assert.deepStrictEqual(by('CN', 1001).exams.map((e) => [e.cp, e.pos, e.answered, e.hits]), [[9001, 91, 1, 1], [9002, 92, 2, 2]]); // per-colour breakdown
  assert.strictEqual(by('MT', 3007).pct, 1); assert.strictEqual(by('MT', 3007).answered, 3); // every area is counted, not only the one that starts at position 1
  assert.strictEqual(by('MT', 3007).exams.length, 1); assert.strictEqual(by('MT', 3007).exams[0].pos, 142);
  assert.strictEqual(by('CN', 1002).exams.length, 1);
  assert.strictEqual(by('CH', 2001).pct, 0); // everyone answered, nobody got it
  assert.strictEqual(by('LC', 4001).pct, 1); assert.strictEqual(by('LC', 4001).answered, 2); // English item: English candidates only
  assert.strictEqual(by('LC', 4001).exams.length, 1); assert.strictEqual(by('LC', 4001).exams[0].lang, 0);
  assert.strictEqual(by('LC', 4101).pct, 0); assert.strictEqual(by('LC', 4101).answered, 1); // Spanish item: Spanish candidate only
  assert.strictEqual(by('LC', 4210).pct, 1); assert.strictEqual(by('LC', 4210).answered, 3); // common item: both languages
  assert.deepStrictEqual(by('LC', 4210).exams.map((e) => [e.lang, e.answered]), [[0, 2], [1, 1]]); // and it is broken down per language
  console.log('items ok');
  await send({ t: 'clearcache' }, 'cleared'); assert(!opfsFiles.has('resultados.csv'), 'copy deleted'); console.log('after clear:', (await send({ t: 'init' }, 'nocache')).t);
})();
