'use strict';
// Streams the ENEM CSV into compact typed columns (raw text is never kept), then filters them.
// Kinds: 1=int32 2=uint8 3=float32 4=UF code 5=municipality code 6=municipality name (dictionary index)
const WANT = {
  NU_SEQUENCIAL: [1], CO_ESCOLA: [1],
  CO_MUNICIPIO_ESC: [5, 0], NO_MUNICIPIO_ESC: [6, 0], SG_UF_ESC: [4],
  TP_DEPENDENCIA_ADM_ESC: [2], TP_LOCALIZACAO_ESC: [2],
  CO_MUNICIPIO_PROVA: [5, 1], NO_MUNICIPIO_PROVA: [6, 1], SG_UF_PROVA: [4],
  TP_PRESENCA_CN: [2], TP_PRESENCA_CH: [2], TP_PRESENCA_LC: [2], TP_PRESENCA_MT: [2],
  TP_LINGUA: [2], TP_STATUS_REDACAO: [2],
  NU_NOTA_CN: [3], NU_NOTA_CH: [3], NU_NOTA_LC: [3], NU_NOTA_MT: [3],
  NU_NOTA_COMP1: [3], NU_NOTA_COMP2: [3], NU_NOTA_COMP3: [3], NU_NOTA_COMP4: [3], NU_NOTA_COMP5: [3],
  NU_NOTA_REDACAO: [3],
  TX_RESPOSTAS_CN: [8, 0], TX_RESPOSTAS_CH: [8, 1], TX_RESPOSTAS_LC: [8, 2], TX_RESPOSTAS_MT: [8, 3],
  TX_GABARITO_CN: [9, 0], TX_GABARITO_CH: [9, 1], TX_GABARITO_LC: [9, 2], TX_GABARITO_MT: [9, 3],
};
const TYPES = [null, Int32Array, Uint8Array, Float32Array, Uint8Array, null, Uint16Array, null, Uint8Array, null];
const HIT_KEYS = ['ACERTOS_CN', 'ACERTOS_CH', 'ACERTOS_LC', 'ACERTOS_MT'];
const TOTAL_HITS = 'ACERTOS_TOTAL';
const responseSpans = new Int32Array(16).fill(-1);
const dec = new TextDecoder('utf-8', { fatal: true }), lat = new TextDecoder('windows-1252');

let cols = null, n = 0, cap = 0, plan = [], maxF = 0, ready = false;
let ufLut, ufNames, dicts, cur, hitPlan = [], rowLang = 255;
let offs = null, headerText = null; // byte offset of every row (for the candidate detail) and the header line

function num(b, s, e) { // "524.1" -> 524.1, empty -> NaN; ignores quotes and stray bytes
  let v = 0, sc = 0, any = false;
  for (let i = s; i < e; i++) {
    const c = b[i];
    if (c >= 48 && c <= 57) { if (sc) { v += (c - 48) / sc; sc *= 10; } else v = v * 10 + c - 48; any = true; }
    else if (c === 46 || c === 44) sc = 10;
  }
  return any ? v : NaN;
}
function text(b, s, e) {
  while (s < e && b[s] === 34) s++;
  while (e > s && b[e - 1] === 34) e--;
  const x = b.subarray(s, e);
  try { return dec.decode(x); } catch { return lat.decode(x); }
}
function grow() {
  cap *= 2;
  for (const p of plan) if (p && p.a) { const t = new p.a.constructor(cap); t.set(p.a); p.a = t; }
  const o = new Float64Array(cap); o.set(offs); offs = o;
}
function setup(headerLine) {
  headerText = text(headerLine, 0, headerLine.length).replace(/^\uFEFF/, '');
  const names = headerText.split(';');
  cap = 1 << 20; n = 0; plan = []; maxF = 0; offs = new Float64Array(cap);
  ufLut = new Uint8Array(65536).fill(255); ufNames = [];
  dicts = [0, 1].map(() => ({ map: new Map(), names: [], codes: [] })); cur = [NaN, NaN];
  names.forEach((raw, i) => {
    const w = WANT[raw.trim().replace(/"/g, '')];
    if (!w) return;
    plan[i] = { name: raw.trim().replace(/"/g, ''), k: w[0], g: w[1], a: [5, 8, 9].includes(w[0]) ? null : new TYPES[w[0]](cap) };
    maxF = i;
  });
  hitPlan = HIT_KEYS.map((name) => ({ name, k: 2, a: new Uint8Array(cap), hit: true }));
  plan.push(...hitPlan);
  if (plan.length === 0) throw new Error('Cabeçalho inválido: nenhuma coluna conhecida');
}
function addRow(b, p, le, abs) { // abs = byte offset of the row in the file
  if (n === cap) grow();
  offs[n] = abs;
  let s = p; rowLang = 255; responseSpans.fill(-1);
  for (let f = 0; f <= maxF; f++) {
    let e = b.indexOf(59, s);
    if (e < 0 || e > le) e = le;
    const pl = plan[f];
    if (pl) {
      if (pl.k === 8 || pl.k === 9) { responseSpans[(pl.k - 8) * 8 + pl.g * 2] = s; responseSpans[(pl.k - 8) * 8 + pl.g * 2 + 1] = e; }
      switch (pl.k) {
        case 1: { const v = num(b, s, e); pl.a[n] = v === v ? v : 0; break; }
        case 2: { const v = num(b, s, e); pl.a[n] = v === v && v < 255 ? v : 255; if (pl.name === 'TP_LINGUA') rowLang = v === v ? v : 255; break; }
        case 3: pl.a[n] = num(b, s, e); break;
        case 4: {
          let x = 0, y = 0;
          for (let i = s; i < e; i++) { const c = b[i]; if (c >= 65) { if (!x) x = c; else { y = c; break; } } }
          if (!x) { pl.a[n] = 255; break; }
          const key = x * 256 + y; let u = ufLut[key];
          if (u === 255) { u = ufNames.length; ufLut[key] = u; ufNames.push(String.fromCharCode(x) + (y ? String.fromCharCode(y) : '')); }
          pl.a[n] = u; break;
        }
        case 5: cur[pl.g] = num(b, s, e); break;
        case 8: case 9: break;
        case 6: {
          const d = dicts[pl.g], code = cur[pl.g];
          if (code !== code) { pl.a[n] = 65535; break; }
          let i = d.map.get(code);
          if (i === undefined) { i = d.names.length; d.map.set(code, i); d.names.push(text(b, s, e)); d.codes.push(code); }
          pl.a[n] = i; break;
        }
      }
    }
    if (e === le) break;
    s = e + 1;
  }
  for (let a = 0; a < 4; a++) {
    const rs = responseSpans[a * 2], re = responseSpans[a * 2 + 1], ks = responseSpans[8 + a * 2], ke = responseSpans[9 + a * 2];
    let hits = 0, valid = rs >= 0 && ks >= 0 && re > rs && ke > ks;
    const rn = re - rs, kn = ke - ks;
    if (valid && a === 2 && rn === 45 && kn === 50) {
      if (rowLang > 1) valid = false;
      else for (let j = 0; j < 45; j++) {
        const keyPos = j < 5 ? j + rowLang * 5 : j + 5;
        const answer = b[rs + j], key = b[ks + keyPos];
        if (answer >= 65 && answer <= 69 && answer === key) hits++;
      }
    } else if (valid) {
      const lim = Math.min(rn, kn);
      for (let j = 0; j < lim; j++) { const answer = b[rs + j], key = b[ks + j]; if (answer >= 65 && answer <= 69 && answer === key) hits++; }
    }
    hitPlan[a].a[n] = valid ? hits : 255;
  }
  n++;
}
function lines(b, end, base) { // b[0..end) holds only complete lines; base = file offset of b[0]
  let p = 0;
  while (p < end) {
    const nl = b.indexOf(10, p);
    let le = nl < 0 || nl > end ? end : nl;
    const next = le + 1;
    if (le > p && b[le - 1] === 13) le--;
    if (le > p) addRow(b, p, le, base + p);
    p = next;
  }
}
async function load(file) {
  ready = false; cols = null;
  const t0 = performance.now(), reader = file.stream().getReader();
  postMessage({ t: 'progress', read: 0, size: file.size, rows: 0 });
  let carry = new Uint8Array(0), read = 0, last = 0, header = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.length;
    let b = value;
    if (carry.length) { b = new Uint8Array(carry.length + value.length); b.set(carry); b.set(value, carry.length); }
    const base = read - b.length; // file offset of b[0]
    let end = b.lastIndexOf(10) + 1;
    if (end === 0) {
      if (b.length > 8e6) throw new Error('Nenhuma quebra de linha encontrada nos primeiros 8 MB: arquivo inválido?');
      carry = b; continue;
    }
    let start = 0;
    if (!header) { const nl = b.indexOf(10); setup(b.subarray(0, nl)); header = true; start = nl + 1; }
    lines(start ? b.subarray(start) : b, end - start, base + start);
    carry = b.slice(end);
    const now = performance.now();
    if (now - last > 100) { last = now; postMessage({ t: 'progress', read, size: file.size, rows: n }); }
  }
  if (carry.length) lines(carry, carry.length, read - carry.length);
  cols = {};
  for (const p of plan) if (p && p.a) cols[p.name] = p.a.slice(0, n);
  cols.ROW_OFFSET = offs.slice(0, n); offs = null;
  plan = []; // free the grown buffers: only the trimmed columns remain
  postMessage({ t: 'precompute', rows: n });
  buildSimpleRanks();
  ready = true;
  announce(Math.round(performance.now() - t0), false);
  try { postMessage({ t: 'saving' }); await saveCache(file); postMessage({ t: 'saved' }); }
  catch (err) { postMessage({ t: 'savefail', msg: String(err && err.message || err) }); }
}
function announce(ms, cached) {
  postMessage({ t: 'loaded', rows: n, ufs: ufNames, munis: dicts[1].codes.map((c, i) => [c, dicts[1].names[i]]), ms, cached });
}
// Precompute exact default simple-average ranks once, then reuse them on every filter and page.
function buildSimpleRanks() {
  const score = new Float64Array(n), totalHits = new Uint8Array(n), order = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, hits = 0, complete = true;
    for (const k of SK) { const x = cols[k][i]; sum += x === x ? x : 0; }
    for (const k of HIT_KEYS) { const h = cols[k][i]; if (h === 255) complete = false; else hits += h; }
    score[i] = sum / SK.length; totalHits[i] = complete ? hits : 255; order[i] = i;
  }
  order.sort((a, b) => score[b] - score[a] || a - b);
  const all = new Uint32Array(n), stateRank = new Uint32Array(n), cityRank = new Uint32Array(n), schoolRank = new Uint32Array(n);
  const states = new Uint32Array(256), cities = new Uint32Array(65536), schools = new Map();
  const state = cols.SG_UF_PROVA, city = cols.NO_MUNICIPIO_PROVA, school = cols.CO_ESCOLA;
  for (let start = 0; start < n;) {
    const value = score[order[start]]; let end = start + 1;
    while (end < n && score[order[end]] === value) end++;
    for (let p = start; p < end; p++) {
      const i = order[p], u = state[i], m = city[i], e = school[i];
      all[i] = start + 1; stateRank[i] = states[u] + 1; cityRank[i] = cities[m] + 1;
      schoolRank[i] = e > 0 ? (schools.get(e) || 0) + 1 : 0;
    }
    for (let p = start; p < end; p++) {
      const i = order[p], u = state[i], m = city[i], e = school[i];
      states[u]++; cities[m]++; if (e > 0) schools.set(e, (schools.get(e) || 0) + 1);
    }
    start = end;
  }
  cols.MEDIA_SIMPLES = score; cols[TOTAL_HITS] = totalHits;
  cols.RANK_AVG_ALL = all; cols.RANK_AVG_STATE = stateRank; cols.RANK_AVG_CITY = cityRank; cols.RANK_AVG_SCHOOL = schoolRank;
}
// Cache: only the compact columns (~300 MB) go to IndexedDB, never the raw CSV.
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('enem-cache', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = (db, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction('kv', mode), rq = fn(t.objectStore('kv'));
  t.oncomplete = () => res(rq && rq.result); t.onerror = t.onabort = () => rej(t.error);
});
async function saveCache(file) {
  const db = await idb();
  try {
    await tx(db, 'readwrite', (s) => s.clear());
    for (const k in cols) await tx(db, 'readwrite', (s) => s.put(cols[k], 'col:' + k));
    const meta = { v: 5, rows: n, cols: Object.keys(cols), ufNames, dicts: dicts.map((d) => ({ names: d.names, codes: d.codes })),
      file: { name: file.name, size: file.size }, header: headerText, savedAt: Date.now() };
    await tx(db, 'readwrite', (s) => s.put(meta, 'meta')); // written last: a partial save is never used
  } finally { db.close(); }
}
async function loadCache() {
  const t0 = performance.now(), db = await idb();
  try {
    const meta = await tx(db, 'readonly', (s) => s.get('meta'));
    if (!meta || ![3, 4, 5].includes(meta.v)) throw new Error('Dados salvos incompatíveis; selecione o CSV novamente.');
    const c = {};
    for (const k of meta.cols) c[k] = await tx(db, 'readonly', (s) => s.get('col:' + k));
    cols = c; n = meta.rows; ufNames = meta.ufNames; dicts = meta.dicts; headerText = meta.header || null; ready = true;
    if (meta.v < 5) {
      postMessage({ t: 'precompute', rows: n }); buildSimpleRanks();
      try { postMessage({ t: 'saving' }); await saveCache(meta.file); postMessage({ t: 'saved' }); }
      catch (err) { postMessage({ t: 'savefail', msg: String(err && err.message || err) }); }
    }
  } finally { db.close(); }
  announce(Math.round(performance.now() - t0), true);
}
async function cacheMeta() {
  const db = await idb();
  try { const m = await tx(db, 'readonly', (s) => s.get('meta')); return m && [3, 4, 5].includes(m.v) ? { rows: m.rows, file: m.file, savedAt: m.savedAt } : null; }
  finally { db.close(); }
}
async function clearCache() { const db = await idb(); try { await tx(db, 'readwrite', (s) => s.clear()); } finally { db.close(); } }
const SK = ['NU_NOTA_CN', 'NU_NOTA_CH', 'NU_NOTA_LC', 'NU_NOTA_MT', 'NU_NOTA_REDACAO']; // essay competencies are filter-only
function summarize(k, sum, sq, cn, mn, mx, hist) { // median/quartiles come from a 1-point histogram, never from sorting
  const c = cn[k];
  if (!c) return { n: 0 };
  const h = hist.subarray(k * 1001, k * 1001 + 1001), mean = sum[k] / c;
  const pct = (p) => { let a = 0; for (let v = 0; v <= 1000; v++) { a += h[v]; if (a >= p * c) return v; } return 1000; };
  const w = 50, nb = 20, bins = new Array(nb).fill(0);
  for (let v = 0; v <= 1000; v++) if (h[v]) bins[Math.min(nb - 1, Math.floor(v / w))] += h[v];
  return { n: c, mean, sd: Math.sqrt(Math.max(0, sq[k] / c - mean * mean)), min: mn[k], max: mx[k], p25: pct(0.25), med: pct(0.5), p75: pct(0.75), bins, w };
}
let matchIdx = null, matchN = 0; // indices of the last result, for paging
function filter(q) {
  const t0 = performance.now();
  const rc = [], lo = [], hi = [], cc = [], cm = [];
  for (const k in q.ranges || {}) if (cols[k]) { rc.push(cols[k]); lo.push(q.ranges[k][0]); hi.push(q.ranges[k][1]); }
  for (const k in q.cats || {}) if (cols[k]) { cc.push(cols[k]); cm.push(q.cats[k].reduce((m, v) => m | (1 << v), 0)); }
  const ufm = q.ufs && q.ufs.length ? q.ufs.reduce((m, u) => m | (1 << ufNames.indexOf(u)), 0) : 0;
  const mset = q.muni && q.muni.length ? new Uint8Array(65536) : null, mc = cols.NO_MUNICIPIO_PROVA;
  if (mset) for (const i of q.muni) mset[i] = 1;
  const sa = SK.map((k) => cols[k]), ns = SK.length;
  const sum = new Float64Array(ns), sq = new Float64Array(ns), cn = new Float64Array(ns);
  const mn = new Float64Array(ns).fill(Infinity), mx = new Float64Array(ns).fill(-Infinity), hist = new Uint32Array(ns * 1001);
  let simpleSum = 0, simpleSq = 0, simpleMin = Infinity, simpleMax = -Infinity;
  const simpleHist = new Uint32Array(1001);
  const mcol = q.metric >= 0 ? sa[q.metric] : null; // per-UF metric: counts/means ignore the UF filter itself, so the map stays informative
  const uf = cols.SG_UF_PROVA, pc = new Uint32Array(32), ps = new Float64Array(32), pn = new Uint32Array(32);
  const mcn = new Uint32Array(65536), mcs = new Float64Array(65536), mcp = new Uint32Array(65536); // per-municipality count / score sum / scored count: ignore the municipality filter itself, respect the UF one
  const hitCols = HIT_KEYS.map((k) => cols[k]), hitN = new Uint32Array(5), hitSum = new Float64Array(5), hitMin = new Uint8Array(5).fill(255), hitMax = new Uint8Array(5);
  const hitHist = new Uint32Array(4 * 46), totalHitHist = new Uint32Array(181);
  const hs = new Uint32Array(4 * 46), hsum = new Float64Array(4 * 46), hmin = new Float64Array(4 * 46).fill(Infinity), hmax = new Float64Array(4 * 46).fill(-Infinity); // score per (area, correct answers)
  const nr = rc.length, nc = cc.length;
  if (!matchIdx || matchIdx.length < n) matchIdx = new Int32Array(n);
  let count = 0;
  outer: for (let i = 0; i < n; i++) {
    for (let k = 0; k < nr; k++) { const v = rc[k][i]; if (!(v >= lo[k] && v <= hi[k])) continue outer; } // NaN fails
    for (let k = 0; k < nc; k++) { const m = cc[k][i]; if (m > 30 || !((cm[k] >>> m) & 1)) continue outer; }
    const u = uf[i], muOk = !mset || mset[mc[i]] === 1, ufOk = !ufm || (u <= 30 && ((ufm >>> u) & 1) === 1);
    if (muOk && u < 32) { pc[u]++; if (mcol) { const x = mcol[i]; if (x === x) { ps[u] += x; pn[u]++; } } }
    if (ufOk) { const g = mc[i]; mcn[g]++; if (mcol) { const x = mcol[i]; if (x === x) { mcs[g] += x; mcp[g]++; } } }
    if (!muOk || !ufOk) continue;
    matchIdx[count++] = i;
    let totalHits = 0, allHits = true;
    for (let k = 0; k < 4; k++) { const h = hitCols[k][i]; if (h === 255) allHits = false; else { hitN[k]++; hitSum[k] += h; hitHist[k * 46 + h]++; if (h < hitMin[k]) hitMin[k] = h; if (h > hitMax[k]) hitMax[k] = h; totalHits += h; } }
    for (let k = 0; k < 4; k++) { const h = hitCols[k][i], x = sa[k][i]; if (h !== 255 && x === x) { const j = k * 46 + h; hs[j]++; hsum[j] += x; if (x < hmin[j]) hmin[j] = x; if (x > hmax[j]) hmax[j] = x; } }
    if (allHits) { hitN[4]++; hitSum[4] += totalHits; totalHitHist[totalHits]++; if (totalHits < hitMin[4]) hitMin[4] = totalHits; if (totalHits > hitMax[4]) hitMax[4] = totalHits; }
    let candidateSum = 0;
    for (let k = 0; k < ns; k++) {
      const x = sa[k][i];
      if (x === x) { sum[k] += x; sq[k] += x * x; cn[k]++; if (x < mn[k]) mn[k] = x; if (x > mx[k]) mx[k] = x; hist[k * 1001 + Math.min(1000, (x + 0.5) | 0)]++; candidateSum += x; }
    }
    const simple = candidateSum / ns; simpleSum += simple; simpleSq += simple * simple;
    if (simple < simpleMin) simpleMin = simple; if (simple > simpleMax) simpleMax = simple;
    simpleHist[Math.min(1000, (simple + 0.5) | 0)]++;
  }
  matchN = count; sortedIdx = null; matchMask = null;
  const nu = ufNames.length, pm = [], pmn = [], pmm = [];
  for (let g = 0; g < dicts[1].names.length; g++) if (mcn[g]) { pm.push(g); pmn.push(mcn[g]); pmm.push(mcp[g] ? mcs[g] / mcp[g] : null); }
  const hitStats = Array.from({ length: 5 }, (_, k) => { const c = hitN[k], hist = k === 4 ? totalHitHist : hitHist, off = k === 4 ? 0 : k * 46, end = k === 4 ? 181 : 46; let med = null, cum = 0; if (c) for (let v = 0; v < end; v++) { cum += hist[off + v]; if (cum >= Math.ceil(c / 2)) { med = v; break; } } let ss = 0; if (c) for (let v = 0; v < end; v++) ss += hist[off + v] * (v - hitSum[k] / c) ** 2; return { n: c, sd: c ? Math.sqrt(ss / c) : null, mean: c ? hitSum[k] / c : null, median: med, min: c ? hitMin[k] : null, max: c ? hitMax[k] : null }; });
  const simpleStats = count ? summarize(0, [simpleSum], [simpleSq], [count], [simpleMin], [simpleMax], simpleHist) : { n: 0 };
  const hitScore = Array.from({ length: 4 }, (_, k) => Array.from({ length: 46 }, (_, h) => { const j = k * 46 + h; return hs[j] ? [hs[j], hmin[j], hsum[j] / hs[j], hmax[j]] : null; })); // [area][hits] -> [n, min, mean, max]
  postMessage({ t: 'result', id: q.id, count, total: n, hitStats, simpleStats, hitScore, ms: +(performance.now() - t0).toFixed(1), ufs: ufNames,
    perMuni: pm, perMuniN: pmn, perMuniMean: pmm, perUf: Array.from(pc.subarray(0, nu)), perUfMean: Array.from(ps.subarray(0, nu), (s, u) => (pn[u] ? s / pn[u] : null)),
    stats: SK.map((_, k) => summarize(k, sum, sq, cn, mn, mx, hist)) });
}
function row(i) {
  const g = (k) => cols[k][i], nm = dicts[1].names[g('NO_MUNICIPIO_PROVA')];
  return { i, id: g('NU_SEQUENCIAL'), esc: g('CO_ESCOLA'), uf: ufNames[g('SG_UF_PROVA')] || null, muni: nm === undefined ? null : nm,
    dep: g('TP_DEPENDENCIA_ADM_ESC'), loc: g('TP_LOCALIZACAO_ESC'), lin: g('TP_LINGUA'), red: g('TP_STATUS_REDACAO'),
    pres: ['CN', 'CH', 'LC', 'MT'].map((a) => g('TP_PRESENCA_' + a)), hits: HIT_KEYS.map((k) => { const x = g(k); return x === 255 ? null : x; }), n: SK.map((k) => { const x = g(k); return x === x ? Math.round(x * 10) / 10 : null; }) };
}
async function detail(q) { // reads ONE row of the CSV on demand (answer sheet, per-grader essay scores); the File is dropped right after
  try {
    if (!cols || !cols.ROW_OFFSET || !headerText) throw new Error('Para ver os detalhes, carregue o CSV de novo: os dados salvos não têm as posições das linhas.');
    const off = cols.ROW_OFFSET[q.i], max = 32768, buf = new Uint8Array(await q.file.slice(off, off + max).arrayBuffer());
    let e = buf.indexOf(10);
    if (e < 0 && buf.length === max) throw new Error('Linha do arquivo longa demais.');
    if (e < 0) e = buf.length;
    if (e > 0 && buf[e - 1] === 13) e--;
    const names = headerText.split(';'), vals = text(buf, 0, e).split(';'), f = {};
    names.forEach((k, j) => { f[k.trim().replace(/"/g, '')] = (vals[j] || '').trim().replace(/"/g, ''); });
    const nv = (k) => { const x = parseFloat((f[k] || '').replace(',', '.')); return x === x ? x : null; };
    if (nv('NU_SEQUENCIAL') !== cols.NU_SEQUENCIAL[q.i]) throw new Error('O arquivo escolhido não é o mesmo que foi carregado.');
    const comps = [1, 2, 3, 4, 5], lang = nv('TP_LINGUA');
    const essay = { final: [...comps.map((c) => nv('NU_NOTA_COMP' + c)), nv('NU_NOTA_REDACAO')],
      av: [1, 2, 3, 4].map((j) => ({ j, v: [...comps.map((c) => nv(`NU_NOTA_COMP${c}_AV${j}`)), nv('NU_NOTA_AV' + j)] })).filter((x) => x.v.some((y) => y !== null)) };
    const sheet = ['CN', 'CH', 'LC', 'MT'].map((a, k) => { // same alignment rule as the hit counter in addRow
      const r = f['TX_RESPOSTAS_' + a] || '', g = f['TX_GABARITO_' + a] || '';
      if (!r || !g) return null;
      if (k === 2 && r.length === 45 && g.length === 50) return lang === 0 || lang === 1 ? { a: r, k: g.slice(lang * 5, lang * 5 + 5) + g.slice(10) } : null;
      const lim = Math.min(r.length, g.length);
      return { a: r.slice(0, lim), k: g.slice(0, lim) };
    });
    postMessage({ t: 'detail', id: q.id, essay, sheet, place: [f.NO_MUNICIPIO_ESC, f.SG_UF_ESC].filter(Boolean).join(' · ') });
  } catch (err) { postMessage({ t: 'detail', id: q.id, error: String(err.message || err) }); }
}
function hitValue(i, k) { const v = cols[k][i]; return v === 255 ? NaN : v; }
function rankValue(i, key, w = [1, 1, 1, 1, 1]) {
  if (key === 'avg') return cols.MEDIA_SIMPLES[i];
  if (key === 'wavg') { let sum = 0, total = 0; for (let k = 0; k < SK.length; k++) { const weight = key === 'wavg' ? w[k] : 1; if (weight > 0) { const x = cols[SK[k]][i]; sum += weight * (x === x ? x : 0); total += weight; } } return total ? sum / total : NaN; }
  return cols[key] ? cols[key][i] : NaN;
}
function scorer(q) { // sort by an exam score, answer count, or mean
  if (q.sort === 'avg' || q.sort === 'MEDIA_SIMPLES') return (i) => cols.MEDIA_SIMPLES[i];
  if (HIT_KEYS.includes(q.sort) || q.sort === TOTAL_HITS) return (i) => hitValue(i, q.sort);
  if (cols[q.sort]) { const c = cols[q.sort]; return (i) => c[i]; }
  const a = SK.map((k) => cols[k]), w = q.sort === 'wavg' ? q.w : [1, 1, 1, 1, 1];
  return (i) => {
    let s = 0, t = 0;
    for (let k = 0; k < a.length; k++) if (w[k] > 0) { const x = a[k][i]; s += w[k] * (x === x ? x : 0); t += w[k]; }
    return t ? s / t : NaN;
  };
}
let sortedKey = '', sortedIdx = null, matchMask = null; // all matches in sort order, reused while paging
// Every sort order is built ONCE for the whole file, in the background, and filtered by a scan when asked for:
// changing the sort never sorts again. Each order is ascending with missing values last; descending reads it backwards.
const orders = new Map(), WARM_KEYS = ['avg', ...SK, ...HIT_KEYS, TOTAL_HITS];
let warmGen = 0, warming = false;
const NB = 1000003, MISSING = NB - 1; // scores are bucketed in 0.001 steps (max 1000 -> 1,000,000)
function buildOrder(val) { // counting sort: O(rows), stable (ties keep file order)
  const keys = new Int32Array(n), start = new Uint32Array(NB + 1);
  let miss = 0;
  for (let i = 0; i < n; i++) { const x = val(i), k = x === x ? Math.min(1000000, Math.round(x * 1000)) : MISSING; keys[i] = k; start[k + 1]++; if (k === MISSING) miss++; }
  for (let b = 0; b < NB; b++) start[b + 1] += start[b];
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[start[keys[i]]++] = i;
  return { order, valid: n - miss };
}
function orderFor(sort, w) {
  const key = sort === 'wavg' ? 'wavg|' + w.join(',') : sort === 'MEDIA_SIMPLES' ? 'avg' : sort;
  let o = orders.get(key);
  if (o) return o;
  if (sort === 'wavg') for (const k of orders.keys()) if (k.startsWith('wavg|')) orders.delete(k); // only the current weights stay cached
  o = buildOrder(scorer({ sort, w })); orders.set(key, o);
  return o;
}
async function warmOrders() { // one order per turn of the event loop, so filtering and paging are never stuck behind it
  if (warming) return;
  warming = true; const gen = warmGen;
  for (const k of WARM_KEYS) { if (gen !== warmGen || !ready) break; orderFor(k); await new Promise((r) => setTimeout(r)); }
  warming = false;
}
function resetOrders() { orders.clear(); sortedIdx = null; sortedKey = ''; matchMask = null; warmGen++; }
function sortedMatches(q) {
  const key = [q.sort, q.dir, q.w].join('|');
  if (key === sortedKey && sortedIdx) return sortedIdx;
  const { order, valid } = orderFor(q.sort, q.w);
  if (!matchMask) { matchMask = new Uint8Array(n); for (let j = 0; j < matchN; j++) matchMask[matchIdx[j]] = 1; }
  const out = new Int32Array(matchN); let c = 0;
  if (q.dir === 'asc') for (let p = 0; p < n; p++) { const i = order[p]; if (matchMask[i]) out[c++] = i; }
  else { for (let p = valid - 1; p >= 0; p--) { const i = order[p]; if (matchMask[i]) out[c++] = i; } for (let p = valid; p < n; p++) { const i = order[p]; if (matchMask[i]) out[c++] = i; } } // missing values stay last
  sortedIdx = out; sortedKey = key;
  return out;
}
function page(q) { // unsorted: file order; sorted: every match ordered by one score, answer count or mean
  const src = q.sort ? sortedMatches(q) : matchIdx, idx = src.subarray(q.offset, Math.min(matchN, q.offset + q.limit));
  const rows = Array.from(idx, row);
  if (q.rankKey === 'avg') {
    for (let r = 0; r < idx.length; r++) { const i = idx[r]; rows[r].ranks = { all: cols.RANK_AVG_ALL[i], state: cols.RANK_AVG_STATE[i], city: cols.RANK_AVG_CITY[i], school: cols.RANK_AVG_SCHOOL[i] || null }; }
  } else if (q.rankKey) {
    const state = cols.SG_UF_PROVA, city = cols.NO_MUNICIPIO_PROVA, school = cols.CO_ESCOLA;
    const target = Array.from(idx, (i) => rankValue(i, q.rankKey, q.w)), ranks = Array.from(idx, () => [1, 1, 1, 1]);
    for (let j = 0; j < n; j++) { const value = rankValue(j, q.rankKey, q.w); if (!(value === value)) continue;
      for (let r = 0; r < idx.length; r++) { const i = idx[r]; if (target[r] === target[r] && value > target[r]) { ranks[r][0]++; if (state[j] === state[i]) ranks[r][1]++; if (city[j] === city[i]) ranks[r][2]++; if (school[i] > 0 && school[j] === school[i]) ranks[r][3]++; } }
    }
    for (let r = 0; r < idx.length; r++) rows[r].ranks = target[r] === target[r] ? { all: ranks[r][0], state: ranks[r][1], city: ranks[r][2], school: school[idx[r]] > 0 ? ranks[r][3] : null } : null;
  }
  postMessage({ t: 'page', id: q.id, total: matchN, rows });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.t === 'load') { resetOrders(); await load(data.file); }
    else if (data.t === 'filter' && ready) filter(data);
    else if (data.t === 'page' && ready) page(data);
    else if (data.t === 'detail') await detail(data);
    else if (data.t === 'init') { let meta = null; try { meta = await cacheMeta(); } catch {} postMessage({ t: meta ? 'cache' : 'nocache', meta }); }
    else if (data.t === 'usecache') { resetOrders(); await loadCache(); }
    else if (data.t === 'clearcache') { await clearCache(); postMessage({ t: 'cleared' }); }
    else if (data.t === 'release') { resetOrders(); cols = null; matchIdx = null; offs = null; headerText = null; n = 0; ready = false; postMessage({ t: 'released' }); }
  } catch (err) { postMessage({ t: 'error', msg: String(err.message || err) }); }
  if (ready) warmOrders(); // idle time goes to pre-building every sort order
};
