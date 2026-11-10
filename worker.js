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
};
const TYPES = [null, Int32Array, Uint8Array, Float32Array, Uint8Array, null, Uint16Array];
const dec = new TextDecoder('utf-8', { fatal: true }), lat = new TextDecoder('windows-1252');

let cols = null, n = 0, cap = 0, plan = [], maxF = 0, ready = false;
let ufLut, ufNames, dicts, cur;

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
}
function setup(headerLine) {
  const names = text(headerLine, 0, headerLine.length).replace(/^\uFEFF/, '').split(';');
  cap = 1 << 20; n = 0; plan = []; maxF = 0;
  ufLut = new Uint8Array(65536).fill(255); ufNames = [];
  dicts = [0, 1].map(() => ({ map: new Map(), names: [], codes: [] })); cur = [NaN, NaN];
  names.forEach((raw, i) => {
    const w = WANT[raw.trim().replace(/"/g, '')];
    if (!w) return;
    plan[i] = { name: raw.trim().replace(/"/g, ''), k: w[0], g: w[1], a: w[0] === 5 ? null : new TYPES[w[0]](cap) };
    maxF = i;
  });
  if (plan.length === 0) throw new Error('Cabeçalho inválido: nenhuma coluna conhecida');
}
function addRow(b, p, le) {
  if (n === cap) grow();
  let s = p;
  for (let f = 0; f <= maxF; f++) {
    let e = b.indexOf(59, s);
    if (e < 0 || e > le) e = le;
    const pl = plan[f];
    if (pl) {
      switch (pl.k) {
        case 1: { const v = num(b, s, e); pl.a[n] = v === v ? v : 0; break; }
        case 2: { const v = num(b, s, e); pl.a[n] = v === v && v < 255 ? v : 255; break; }
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
  n++;
}
function lines(b, end) { // b[0..end) holds only complete lines
  let p = 0;
  while (p < end) {
    const nl = b.indexOf(10, p);
    let le = nl < 0 || nl > end ? end : nl;
    const next = le + 1;
    if (le > p && b[le - 1] === 13) le--;
    if (le > p) addRow(b, p, le);
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
    let end = b.lastIndexOf(10) + 1;
    if (end === 0) {
      if (b.length > 8e6) throw new Error('Nenhuma quebra de linha encontrada nos primeiros 8 MB: arquivo inválido?');
      carry = b; continue;
    }
    let start = 0;
    if (!header) { const nl = b.indexOf(10); setup(b.subarray(0, nl)); header = true; start = nl + 1; }
    lines(start ? b.subarray(start) : b, end - start);
    carry = b.slice(end);
    const now = performance.now();
    if (now - last > 100) { last = now; postMessage({ t: 'progress', read, size: file.size, rows: n }); }
  }
  if (carry.length) lines(carry, carry.length);
  cols = {};
  for (const p of plan) if (p && p.a) cols[p.name] = p.a.slice(0, n);
  plan = []; // free the grown buffers: only the trimmed columns remain
  ready = true;
  announce(Math.round(performance.now() - t0), false);
  try { postMessage({ t: 'saving' }); await saveCache(file); postMessage({ t: 'saved' }); }
  catch (err) { postMessage({ t: 'savefail', msg: String(err && err.message || err) }); }
}
function announce(ms, cached) {
  postMessage({ t: 'loaded', rows: n, ufs: ufNames, munis: dicts[1].codes.map((c, i) => [c, dicts[1].names[i]]), ms, cached });
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
    const meta = { v: 1, rows: n, cols: Object.keys(cols), ufNames, dicts: dicts.map((d) => ({ names: d.names, codes: d.codes })),
      file: { name: file.name, size: file.size }, savedAt: Date.now() };
    await tx(db, 'readwrite', (s) => s.put(meta, 'meta')); // written last: a partial save is never used
  } finally { db.close(); }
}
async function loadCache() {
  const t0 = performance.now(), db = await idb();
  try {
    const meta = await tx(db, 'readonly', (s) => s.get('meta'));
    if (!meta) throw new Error('Nenhum dado salvo.');
    const c = {};
    for (const k of meta.cols) c[k] = await tx(db, 'readonly', (s) => s.get('col:' + k));
    cols = c; n = meta.rows; ufNames = meta.ufNames; dicts = meta.dicts; ready = true;
  } finally { db.close(); }
  announce(Math.round(performance.now() - t0), true);
}
async function cacheMeta() {
  const db = await idb();
  try { const m = await tx(db, 'readonly', (s) => s.get('meta')); return m && { rows: m.rows, file: m.file, savedAt: m.savedAt }; }
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
  const mcol = q.metric >= 0 ? sa[q.metric] : null; // per-UF metric: counts/means ignore the UF filter itself, so the map stays informative
  const uf = cols.SG_UF_PROVA, pc = new Uint32Array(32), ps = new Float64Array(32), pn = new Uint32Array(32);
  const nr = rc.length, nc = cc.length;
  if (!matchIdx || matchIdx.length < n) matchIdx = new Int32Array(n);
  let count = 0;
  outer: for (let i = 0; i < n; i++) {
    for (let k = 0; k < nr; k++) { const v = rc[k][i]; if (!(v >= lo[k] && v <= hi[k])) continue outer; } // NaN fails
    for (let k = 0; k < nc; k++) { const m = cc[k][i]; if (m > 30 || !((cm[k] >>> m) & 1)) continue outer; }
    if (mset && !mset[mc[i]]) continue;
    const u = uf[i];
    if (u < 32) { pc[u]++; if (mcol) { const x = mcol[i]; if (x === x) { ps[u] += x; pn[u]++; } } }
    if (ufm && (u > 30 || !((ufm >>> u) & 1))) continue;
    matchIdx[count++] = i;
    for (let k = 0; k < ns; k++) {
      const x = sa[k][i];
      if (x === x) { sum[k] += x; sq[k] += x * x; cn[k]++; if (x < mn[k]) mn[k] = x; if (x > mx[k]) mx[k] = x; hist[k * 1001 + Math.min(1000, (x + 0.5) | 0)]++; }
    }
  }
  matchN = count;
  const nu = ufNames.length;
  postMessage({ t: 'result', id: q.id, count, total: n, ms: +(performance.now() - t0).toFixed(1), ufs: ufNames,
    perUf: Array.from(pc.subarray(0, nu)), perUfMean: Array.from(ps.subarray(0, nu), (s, u) => (pn[u] ? s / pn[u] : null)),
    stats: SK.map((_, k) => summarize(k, sum, sq, cn, mn, mx, hist)) });
}
function row(i) {
  const g = (k) => cols[k][i], nm = dicts[1].names[g('NO_MUNICIPIO_PROVA')];
  return { id: g('NU_SEQUENCIAL'), esc: g('CO_ESCOLA'), uf: ufNames[g('SG_UF_PROVA')] || null, muni: nm === undefined ? null : nm,
    dep: g('TP_DEPENDENCIA_ADM_ESC'), loc: g('TP_LOCALIZACAO_ESC'), lin: g('TP_LINGUA'), red: g('TP_STATUS_REDACAO'),
    pres: ['CN', 'CH', 'LC', 'MT'].map((a) => g('TP_PRESENCA_' + a)), n: SK.map((k) => { const x = g(k); return x === x ? Math.round(x * 10) / 10 : null; }) };
}
function scorer(q) { // value to sort by: a score column, or the simple/weighted average (NaN if a needed score is missing; weight 0 skips a score)
  if (cols[q.sort]) { const c = cols[q.sort]; return (i) => c[i]; }
  const a = SK.map((k) => cols[k]), w = q.sort === 'wavg' ? q.w : [1, 1, 1, 1, 1];
  return (i) => {
    let s = 0, t = 0;
    for (let k = 0; k < a.length; k++) if (w[k] > 0) { const x = a[k][i]; if (x !== x) return NaN; s += w[k] * x; t += w[k]; }
    return t ? s / t : NaN;
  };
}
function page(q) { // unsorted: file order, any page; sorted: top 200 by one score or average
  let idx;
  if (!q.sort) idx = matchIdx.subarray(q.offset, Math.min(matchN, q.offset + q.limit));
  else {
    const val = scorer(q), s = q.dir === 'asc' ? -1 : 1, K = Math.min(matchN, 200, q.offset + q.limit), tv = [], ti = [];
    for (let j = 0; j < matchN; j++) {
      const i = matchIdx[j], x = val(i);
      const v = x !== x ? -Infinity : s * x; // candidates without the score go last in either direction, so every match stays reachable
      if (tv.length === K && v <= tv[K - 1]) continue;
      let p = tv.length < K ? tv.length : K - 1;
      while (p > 0 && tv[p - 1] < v) { tv[p] = tv[p - 1]; ti[p] = ti[p - 1]; p--; }
      tv[p] = v; ti[p] = i;
    }
    idx = ti.slice(q.offset, q.offset + q.limit);
  }
  postMessage({ t: 'page', id: q.id, total: matchN, rows: Array.from(idx, row) });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.t === 'load') await load(data.file);
    else if (data.t === 'filter' && ready) filter(data);
    else if (data.t === 'page' && ready) page(data);
    else if (data.t === 'init') { let meta = null; try { meta = await cacheMeta(); } catch {} postMessage({ t: meta ? 'cache' : 'nocache', meta }); }
    else if (data.t === 'usecache') await loadCache();
    else if (data.t === 'clearcache') { await clearCache(); postMessage({ t: 'cleared' }); }
    else if (data.t === 'release') { cols = null; matchIdx = null; n = 0; ready = false; postMessage({ t: 'released' }); }
  } catch (err) { postMessage({ t: 'error', msg: String(err.message || err) }); }
};
