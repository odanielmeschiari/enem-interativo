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
  let carry = new Uint8Array(0), read = 0, last = 0, header = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.length;
    let b = value;
    if (carry.length) { b = new Uint8Array(carry.length + value.length); b.set(carry); b.set(value, carry.length); }
    let end = b.lastIndexOf(10) + 1;
    if (end === 0) { carry = b; continue; }
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
  postMessage({ t: 'loaded', rows: n, ufs: ufNames, ms: Math.round(performance.now() - t0) });
}
function filter(q) {
  const t0 = performance.now();
  const rc = [], lo = [], hi = [], cc = [], cm = [];
  for (const k in q.ranges || {}) if (cols[k]) { rc.push(cols[k]); lo.push(q.ranges[k][0]); hi.push(q.ranges[k][1]); }
  for (const k in q.cats || {}) if (cols[k]) { cc.push(cols[k]); cm.push(q.cats[k].reduce((m, v) => m | (1 << v), 0)); }
  if (q.ufs && q.ufs.length) { cc.push(cols.SG_UF_PROVA); cm.push(q.ufs.reduce((m, u) => m | (1 << ufNames.indexOf(u)), 0)); }
  const uf = cols.SG_UF_PROVA, perUf = new Uint32Array(32), nr = rc.length, nc = cc.length;
  let count = 0;
  outer: for (let i = 0; i < n; i++) {
    for (let k = 0; k < nr; k++) { const v = rc[k][i]; if (!(v >= lo[k] && v <= hi[k])) continue outer; } // NaN fails
    for (let k = 0; k < nc; k++) { const m = cc[k][i]; if (m > 30 || !((cm[k] >>> m) & 1)) continue outer; }
    count++; const u = uf[i]; if (u < 32) perUf[u]++;
  }
  postMessage({ t: 'result', id: q.id, count, total: n, ms: +(performance.now() - t0).toFixed(1), perUf: Array.from(perUf.subarray(0, ufNames.length)), ufs: ufNames });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.t === 'load') await load(data.file);
    else if (data.t === 'filter' && ready) filter(data);
    else if (data.t === 'release') { cols = null; n = 0; ready = false; postMessage({ t: 'released' }); }
  } catch (err) { postMessage({ t: 'error', msg: String(err.message || err) }); }
};
