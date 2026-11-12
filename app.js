'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString('pt-BR');
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UF_BY_IBGE = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const AREAS = [['NU_NOTA_CN', 'Ciências da Natureza', 1000], ['NU_NOTA_CH', 'Ciências Humanas', 1000], ['NU_NOTA_LC', 'Linguagens e Códigos', 1000], ['NU_NOTA_MT', 'Matemática', 1000], ['NU_NOTA_REDACAO', 'Redação', 1000]];
const COMPETENCIES = [1, 2, 3, 4, 5].map((i) => ['NU_NOTA_COMP' + i, 'Competência ' + i, 200]);
const HIT_FILTERS = [['ACERTOS_CN', 'Acertos: Natureza', 45], ['ACERTOS_CH', 'Acertos: Humanas', 45], ['ACERTOS_LC', 'Acertos: Linguagens', 45], ['ACERTOS_MT', 'Acertos: Matemática', 45]];
const TRI_FILTERS = [...AREAS.slice(0, 4), ['MEDIA_SIMPLES', 'Média simples', 1000]];
const ESSAY_FILTERS = [AREAS[4], ...COMPETENCIES];
const HITS_FILTERS = [...HIT_FILTERS, ['ACERTOS_TOTAL', 'Total de acertos', 180]];
const FILTER_FIELDS = [...TRI_FILTERS, ...ESSAY_FILTERS, ...HITS_FILTERS];
const GROUPS = [ // categorical filters; labels follow the ENEM data dictionary
  { id: 'pres', keys: ['TP_PRESENCA_CN', 'TP_PRESENCA_CH', 'TP_PRESENCA_LC', 'TP_PRESENCA_MT'], opts: [[1, 'Presente'], [0, 'Faltou'], [2, 'Eliminado']] },
  { id: 'lin', keys: ['TP_LINGUA'], opts: [[0, 'Inglês'], [1, 'Espanhol']] },
  { id: 'dep', keys: ['TP_DEPENDENCIA_ADM_ESC'], opts: [[1, 'Federal'], [2, 'Estadual'], [3, 'Municipal'], [4, 'Privada']] },
  { id: 'loc', keys: ['TP_LOCALIZACAO_ESC'], opts: [[1, 'Urbana'], [2, 'Rural']] },
  { id: 'red', keys: ['TP_STATUS_REDACAO'], opts: [[1, 'Sem problemas'], [2, 'Anulada'], [3, 'Cópia do texto motivador'], [4, 'Em branco'], [6, 'Fuga ao tema'], [7, 'Fuga do tipo textual'], [8, 'Texto insuficiente'], [9, 'Parte desconectada']] },
];
let worker, seq = 0, timer, t0, munis = [], muniSel = new Map(), ufSel = new Set();
const f1 = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const num = (x) => x === null ? '–' : f1(x);
const compact = (x) => x >= 1e6 ? f1(x / 1e6) + ' mi' : x >= 1e3 ? Math.round(x / 1e3) + ' mil' : String(x);

const SMALL = new Set(['DF', 'SE', 'AL', 'PB', 'RN', 'ES']); // too small to print a value inside
const SVGNS = 'http://www.w3.org/2000/svg';
let mapEls = null, lastResult = null;
async function buildMap() {
  $('metric').innerHTML = '<option value="-1">Nº de candidatos</option>' + AREAS.map(([, l], k) => `<option value="${k}">Média de ${l}</option>`).join('');
  try {
    const r = await fetch('assets/brazil.svg');
    if (!r.ok) throw new Error(r.status);
    const txt = await r.text();
    $('map').innerHTML = txt.slice(txt.indexOf('<svg')); // our own bundled file: Simplemaps Brazil, one <path id="BRxx"> per UF
  } catch { $('map').innerHTML = '<p class="mut">Mapa indisponível (assets/brazil.svg). Abra o app pelo ./run.sh.</p>'; return; }
  const svg = $('map').firstElementChild;
  svg.setAttribute('viewBox', '0 0 1000 912'); svg.removeAttribute('width'); svg.removeAttribute('height');
  mapEls = {};
  const mk = (cls, u, x, y) => { const t = document.createElementNS(SVGNS, 'text'); t.setAttribute('class', cls); t.setAttribute('x', x); t.setAttribute('y', y); t.dataset.uf = u; svg.appendChild(t); return t; };
  svg.querySelectorAll('#features path').forEach((p) => {
    const u = p.id.slice(2), c = svg.querySelector(`#label_points circle[id="${p.id}"]`);
    if (!c) return;
    const x = +c.getAttribute('cx'), y = +c.getAttribute('cy'), title = document.createElementNS(SVGNS, 'title');
    p.dataset.uf = u; p.appendChild(title);
    mapEls[u] = { p, title, name: c.getAttribute('class'), a: mk('lc', u, x, y - 6), b: mk('lv', u, x, y + 18) };
    mapEls[u].a.textContent = u;
  });
  for (const id of ['points', 'label_points']) svg.querySelector('#' + id)?.remove();
  if (lastResult) renderMap(lastResult);
}
const MPAGE = 10; let muniRows = [], muniPage = 0;
function renderMuniRank() { // [municipality index, candidates, value] sorted by the map metric; the whole list stays here, only one page is drawn
  const m = lastResult;
  if (!m) return;
  const mean = +$('metric').value >= 0, min = Math.max(1, +$('mmin').value || 1);
  muniRows = [];
  m.perMuni.forEach((g, k) => { const c = m.perMuniN[k], v = mean ? m.perMuniMean[k] : c; if (c >= min && v) muniRows.push([g, c, v]); });
  muniRows.sort((a, b) => b[2] - a[2]);
  const pages = Math.max(1, Math.ceil(muniRows.length / MPAGE)); muniPage = Math.min(muniPage, pages - 1);
  const from = muniPage * MPAGE, top = muniRows.length ? muniRows[0][2] : 1;
  $('mrank').innerHTML = muniRows.slice(from, from + MPAGE).map(([g, c, v], j) =>
    `<li data-m="${g}"${muniSel.has(g) ? ' class="sel"' : ''}><b>${from + j + 1}</b><p>${munis[g].label}<span><i style="width:${100 * v / top}%"></i></span></p><em>${mean ? f1(v) + `<small>${fmt(c)} cand.</small>` : fmt(c)}</em></li>`).join('');
  $('mpage').textContent = muniRows.length ? `${from + 1}–${Math.min(from + MPAGE, muniRows.length)} de ${fmt(muniRows.length)} municípios` : 'Nenhum município com esse mínimo de candidatos';
  $('mprev').disabled = muniPage === 0; $('mnext').disabled = muniPage >= pages - 1;
}
const SPAGE = 10; let schools = [], schoolRows = [], schoolPage = 0;
const DEP_NAMES = { 1: 'Federal', 2: 'Estadual', 3: 'Municipal', 4: 'Privada' };
function renderSchoolRank() {
  const m = lastResult;
  if (!m || !schools.length || !m.perSchool || !m.perSchool.length) {
    schoolRows = [];
    $('srank').innerHTML = '';
    $('spage').textContent = !schools.length ? 'Sem dados de escolas carregados' : 'Nenhuma escola com esse filtro';
    $('sprev').disabled = true;
    $('snext').disabled = true;
    return;
  }
  const mean = +$('metric').value >= 0, min = Math.max(1, +$('smin').value || 1);
  schoolRows = [];
  m.perSchool.forEach((s, k) => {
    const c = m.perSchoolN[k], v = mean ? m.perSchoolMean[k] : c;
    if (c >= min && v) schoolRows.push([s, c, v]);
  });
  schoolRows.sort((a, b) => b[2] - a[2]);
  const pages = Math.max(1, Math.ceil(schoolRows.length / SPAGE));
  schoolPage = Math.min(schoolPage, pages - 1);
  const from = schoolPage * SPAGE, top = schoolRows.length ? schoolRows[0][2] : 1;
  const activeSchool = $('CO_ESCOLA').value;
  $('srank').innerHTML = schoolRows.slice(from, from + SPAGE).map(([s, c, v], j) => {
    const sch = schools[s];
    if (!sch) return '';
    const [code, muni, uf, dep] = sch;
    const isSel = activeSchool && activeSchool === String(code);
    const depLabel = DEP_NAMES[dep] ? `Escola ${DEP_NAMES[dep].toLowerCase()}` : '';
    const locText = [muni, uf].filter(Boolean).join(' · ');
    const descText = [locText, depLabel].filter(Boolean).join(' · ');
    return `<li data-s="${code}"${isSel ? ' class="sel"' : ''}><b>${from + j + 1}</b><p>Escola nº ${code}${descText ? ` <small class="mut">(${descText})</small>` : ''}<span><i style="width:${100 * v / top}%"></i></span></p><em>${mean ? f1(v) + `<small>${fmt(c)} cand.</small>` : fmt(c)}</em></li>`;
  }).join('');
  $('spage').textContent = schoolRows.length ? `${from + 1}–${Math.min(from + SPAGE, schoolRows.length)} de ${fmt(schoolRows.length)} escolas` : 'Nenhuma escola com esse mínimo de candidatos';
  $('sprev').disabled = schoolPage === 0;
  $('snext').disabled = schoolPage >= pages - 1;
}
function renderMap(m) {
  lastResult = m;
  if (!mapEls) return;
  const mean = +$('metric').value >= 0, vals = mean ? m.perUfMean : m.perUf, ok = vals.filter((v) => v);
  const lo = Math.min(...ok), hi = Math.max(...ok);
  for (const u in mapEls) {
    const e = mapEls[u], i = m.ufs.indexOf(u), v = i < 0 ? null : vals[i], t = v ? (v - lo) / (hi - lo || 1) : 0;
    e.p.classList.toggle('sel', ufSel.has(u));
    if (ufSel.has(u)) e.p.parentNode.appendChild(e.p); // raise so the highlight border is not hidden by neighbours
    e.p.style.fill = v ? `hsl(135 ${40 + 20 * t}% ${16 + 38 * t}%)` : '#424242';
    e.b.textContent = v && !SMALL.has(u) ? (mean ? Math.round(v) : compact(v)) : '';
    e.title.textContent = `${e.name}: ${v ? (mean ? 'média ' + f1(v) : fmt(v) + ' candidatos') : 'sem dados'}`;
  }
  const top = m.ufs.map((u, i) => [u, vals[i]]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, 10);
  $('rank').innerHTML = top.map(([u, v]) => `<li data-uf="${u}"${ufSel.has(u) ? ' class="sel"' : ''}><b>${u}</b><div><i style="width:${100 * v / top[0][1]}%"></i></div><span>${mean ? f1(v) : fmt(v)}</span></li>`).join('');
  $('legend').innerHTML = ok.length ? `<span>${mean ? Math.round(lo) : compact(lo)}</span><i></i><span>${mean ? Math.round(hi) : compact(hi)}</span>` : '';
}
const PAGE = 12, LBL = (id) => Object.fromEntries(GROUPS.find((g) => g.id === id).opts);
let pageOff = 0, pageTotal = 0;
function requestPage() {
  const [sort, dir] = sortValue.split(':');
  worker.postMessage({ t: 'page', id: seq, sort: sort || null, dir, w: W, offset: pageOff, limit: PAGE, rankKey: $('rankmetric').value });
}
const TILES = [[3, 'Matemática'], [1, 'Humanas'], [2, 'Linguagens'], [0, 'Natureza'], [4, 'Redação']]; // [index in r.n, label]; same order as the weight inputs
const hue = (x) => Math.round(120 * Math.min(1, Math.max(0, (x - 300) / 500))); // 300 or less = red, 800 or more = green
let pageRows = [], W = [1, 1, 1, 1, 1], lastHitStats = [];
let showW = false; // the weighted average exists only while "Mostrar média ponderada" is on
function averages(n) { // a missing score (absence) counts as 0; the weighted one is null only if every weight is 0
  let s = 0, ws = 0, wt = 0;
  for (let i = 0; i < n.length; i++) { const x = n[i] ?? 0; s += x; if (showW) { ws += W[i] * x; wt += W[i]; } }
  return [s / n.length, showW && wt > 0 ? ws / wt : null];
}
function card(r, k) {
  const dep = LBL('dep'), loc = LBL('loc'), lin = LBL('lin'), red = LBL('red'), tags = [];
  if (r.dep !== 255) tags.push(`Escola ${(dep[r.dep] || '').toLowerCase()}`);
  if (r.loc !== 255) tags.push(loc[r.loc] || '');
  if (r.esc > 0) tags.push(`Escola nº ${r.esc}`);
  if (r.lin !== 255) tags.push(lin[r.lin] || '');
  const out = r.pres.filter((p) => p !== 1).length;
  const warn = [];
  if (r.pres.includes(2)) warn.push('Eliminado'); else if (out) warn.push(`Faltou em ${out} prova${out > 1 ? 's' : ''}`);
  if (r.red !== 255 && r.red !== 1) warn.push(`Redação: ${(red[r.red] || 'problema').toLowerCase()}`);
  const [avg, wavg] = averages(r.n);
  const totalHits = r.hits.every((v) => v !== null) ? r.hits.reduce((a, b) => a + b, 0) : null;
  const tile = ([i, l]) => `<div class="tile">${r.n[i] === null ? '<div class="dot off">–</div>' : `<div class="dot" style="--h:${hue(r.n[i])}">${f1(r.n[i])}</div>`}<small>${l}</small></div>`;
  const rank = r.ranks ? `<div class="ranks"><span>ENEM <b>${fmt(r.ranks.all)}º</b></span><span>Estado <b>${fmt(r.ranks.state)}º</b></span><span>Cidade <b>${fmt(r.ranks.city)}º</b></span><span>Escola <b>${r.ranks.school ? fmt(r.ranks.school) + 'º' : '—'}</b></span></div>` : '';
  const hits = [1, 2, 0, 3].map((i) => `<span>${['Natureza', 'Humanas', 'Linguagens', 'Matemática'][i]} <b>${r.hits[i] === null ? '—' : r.hits[i] + '/45'}</b></span>`).join(''); // Humanas, Linguagens / Natureza, Matemática
  return `<div class="cand"${k === undefined ? '' : ` data-k="${k}"`}><div class="head"><b>Candidato ${r.id}</b><span>${r.muni || '—'} · ${r.uf || '—'}</span></div>` +
    `<div class="tags">${tags.filter(Boolean).map((t) => `<i>${t}</i>`).join('')}${warn.map((t) => `<i class="warn">${t}</i>`).join('')}</div>` +
    `<div class="avgs"><div><small>Média simples</small><b>${num(avg)}</b></div>${showW ? `<div><small>Média ponderada</small><b>${num(wavg)}</b></div>` : ''}<div class="hit-total"><small>Acertos totais</small><b>${totalHits === null ? '—' : fmt(totalHits)}</b><em>${totalHits === null ? 'incompleto' : 'de 180'}</em></div></div>` +
    `<div class="tiles">${TILES.map(tile).join('')}</div><div class="hits">${hits}</div>${rank}</div>`;
}
// Candidate detail: the answer sheet and the per-grader essay scores are not kept in memory; one CSV row is read on click.
const kv = (mode, fn) => new Promise((res, rej) => {
  const r = indexedDB.open('enem-cache', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const db = r.result, t = db.transaction('kv', mode); let q; try { q = fn(t.objectStore('kv')); } catch (e) { db.close(); rej(e); return; } t.oncomplete = () => { db.close(); res(q && q.result); }; t.onerror = t.onabort = () => { db.close(); rej(t.error); }; };
  r.onerror = () => rej(r.error);
});
let csvFallback = null; // browsers without showOpenFilePicker (Firefox, Safari): the File picked at load time, kept as a plain reference for this session
function pickCsv() { // classic file input; must be called straight from the click
  return new Promise((res, rej) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.csv'; i.hidden = true; document.body.appendChild(i);
    const done = () => i.remove();
    i.onchange = () => { done(); i.files[0] ? res(i.files[0]) : rej(new DOMException('', 'AbortError')); };
    i.oncancel = () => { done(); rej(new DOMException('', 'AbortError')); };
    i.click();
  });
}
async function csvFile() { // remembered handle: the browser asks permission once per session; the File is used for one read only
  if (!window.showOpenFilePicker) return csvFallback || (csvFallback = await pickCsv());
  const mode = { mode: 'read' };
  const h = await kv('readonly', (s) => s.get('handle')).catch(() => null);
  if (h) try { if (await h.queryPermission(mode) === 'granted' || await h.requestPermission(mode) === 'granted') return await h.getFile(); } catch { /* moved or denied: pick again */ }
  const [nh] = await showOpenFilePicker({ types: [{ description: 'CSV do ENEM', accept: { 'text/csv': ['.csv'] } }] });
  kv('readwrite', (s) => s.put(nh, 'handle')).catch(() => {});
  return nh.getFile();
}
let dseq = 0, dRow = null, hasCopy = false; // hasCopy: the worker keeps a decompressed copy of the results CSV on disk (OPFS), so no file picker is needed
async function openDetail(r) {
  const id = ++dseq; dRow = r;
  $('dbody').innerHTML = card(r) + '<p class="mut">Lendo a linha do arquivo…</p>';
  if (!$('detail').open) $('detail').showModal();
  try { const file = hasCopy ? null : await csvFile(); worker.postMessage({ t: 'detail', id, i: r.i, file }); }
  catch (err) { if (id === dseq) $('dbody').innerHTML = card(r) + `<p class="mut">${err.name === 'AbortError' ? 'Seleção do arquivo cancelada.' : err.message}</p>`; }
}
function renderDetail(m) {
  const r = dRow, top = card(r);
  if (m.error) { csvFallback = null; $('dbody').innerHTML = top + `<p class="mut">${m.error}</p>`; return; } // forget a wrong or stale file so the next click asks again
  const cols = [['Nota final', m.essay.final], ...m.essay.av.map(({ j, v }) => ['Corretor ' + j, v])];
  const cell = (x, max) => x === null ? '<td class="off">—</td>' : `<td style="--p:${100 * x / max}%">${f1(x)}</td>`;
  const rows = [0, 1, 2, 3, 4, 5].map((i) => `<tr${i === 5 ? ' class="tot"' : ''}><th>${i < 5 ? 'Competência ' + (i + 1) : 'Total'}</th>${cols.map(([, v]) => cell(v[i], i < 5 ? 200 : 1000)).join('')}</tr>`).join('');
  const essay = m.essay.final.every((x) => x === null) && !m.essay.av.length ? '<p class="mut">Sem notas de redação.</p>'
    : `<table class="essay"><thead><tr><th></th>${cols.map(([l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  const lin = r.lin !== 255 ? LBL('lin')[r.lin] : null;
  const sheets = m.sheet.map((s, k) => {
    const name = AREAS[k][1];
    if (!s) return `<div><h3>${name}</h3><p class="mut">Sem gabarito nesta área.</p></div>`;
    let hits = 0;
    const qs = [...s.a].map((a, j) => {
      const key = s.k[j], marked = a >= 'A' && a <= 'E', ok = marked && a === key; hits += ok;
      return `<div class="q ${ok ? 'hit' : marked ? 'miss' : 'blank'}" title="Questão ${j + 1}: ${marked ? 'marcou ' + a : 'sem alternativa A–E'} · gabarito ${key}"><small>${j + 1}</small><b>${marked ? a : '·'}</b><em>${ok ? '✓' : key}</em></div>`;
    }).join('');
    return `<div><h3>${name} <small>${hits}/${s.a.length} acertos${k === 2 && lin && s.a.length === 45 ? ` · questões 1–5: ${lin}` : ''}</small></h3><div class="qs">${qs}</div></div>`;
  }).join('');
  $('dbody').innerHTML = top + (m.place ? `<p class="mut">Município e UF da escola: ${m.place}</p>` : '') + `<h3>Redação</h3>${essay}<h3>Gabarito</h3>` +
    '<p class="mut">Cada quadrado mostra o número da questão, a alternativa marcada e, embaixo, ✓ se acertou ou a resposta certa se errou.</p>' + `<div class="sheets">${sheets}</div>`;
}
function renderCards() {
  for (const x of $('weights').querySelectorAll('input')) W[+x.dataset.i] = Math.max(0, +x.value || 0);
  $('cards').innerHTML = pageRows.length ? pageRows.map((r, k) => card(r, k)).join('') : '<p class="mut">Nenhum candidato com esses filtros.</p>';
}
function renderPage(m) {
  pageRows = m.rows; renderCards();
  pageTotal = m.total;
  $('pageinfo').textContent = m.total ? `${fmt(pageOff + 1)}–${fmt(pageOff + m.rows.length)} de ${fmt(m.total)}` : '';
  $('prev').disabled = pageOff === 0; $('next').disabled = pageOff + PAGE >= m.total;
}
const OPS = [['mean', 'Média', 'média'], ['med', 'Mediana', 'mediana'], ['max', 'Maior nota', 'máx'], ['min', 'Menor nota', 'mín'], ['sd', 'Desvio padrão', 'desvio']];
let lastStats = [], lastCount = 0, lastSimpleStats = null;
function renderStats(st, hitStats = lastHitStats, simpleStats = lastSimpleStats) {
  lastStats = st; lastHitStats = hitStats; lastSimpleStats = simpleStats;
  const op = $('statop').value, hi = OPS.find((o) => o[0] === op);
  const [avg, wavg] = averages(st.map((s) => s.n ? s.mean * s.n / lastCount : 0)); // overall: every matching candidate counts, absences as 0
  const summary = `<div class="stats-summary"><div class="summary-copy"><h3>Média geral dos candidatos</h3></div>` +
    `<div class="summary-values"><div><span>Média simples</span><b>${num(avg)}</b></div>${showW ? `<div><span>Média ponderada</span><b>${num(wavg)}</b></div>` : ''}</div></div>`;
  const hitLabels = ['Natureza', 'Humanas', 'Linguagens', 'Matemática', 'Total'];
  const hv = (h, o) => h[o === 'med' ? 'median' : o]; // the hit stats call the median "median"
  const hits = hitStats.map((h, i) => `<article class="stat hitstat"><h4>${hitLabels[i]}</h4><div class="stat-primary">${h.n ? f1(hv(h, op)) : '—'}<small>acertos (${hi[2]})</small></div>` +
    (h.n ? `<div class="hit-details">${OPS.filter((o) => o[0] !== op).map((o) => `<span>${o[2]} <b>${f1(hv(h, o[0]))}</b></span>`).join('')}</div><small class="stat-foot">${fmt(h.n)} candidatos${i === 4 ? ' com as quatro áreas' : ''}</small>` : '<p class="mut">Sem dados completos</p>') + '</article>').join('');
  const scores = [...st, simpleStats].map((s, k) => {
    const isSimple = k === st.length, label = isSimple ? 'Média simples' : AREAS[k][1];
    if (!s || !s.n) return `<article class="stat scorestat${isSimple ? ' simple-average' : ''}"><div class="score-head"><h4>${label}</h4></div><p class="mut">Sem dados</p></article>`;
    const top = Math.max(...s.bins);
    const bars = s.bins.map((b, i) => `<i style="height:${Math.max(3, 100 * b / top)}%" title="${i * s.w}–${i * s.w + s.w - 1}: ${fmt(b)}"></i>`).join('');
    const rest = OPS.filter((o) => o[0] !== op).map((o) => `<span>${o[2]} <b>${f1(s[o[0]])}</b></span>`).join('');
    return `<article class="stat scorestat${isSimple ? ' simple-average' : ''}"><div class="score-head"><h4>${label}</h4><small>${fmt(s.n)} candidatos</small></div>` +
      `<div class="stat-primary">${f1(s[op])}<small>${hi[2]}</small></div><div class="hist">${bars}</div><div class="score-details">${rest}</div></article>`;
  }).join('');
  $('statgrid').innerHTML = summary + `<div class="hitgrid">${hits}</div><div class="scoregrid">${scores}</div>`;
}

const f1z = (x) => x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let hitScore = null; // hitScore[area][hits] = [n, min, mean, max] | null, from the last result
function renderHitScore(h = hitScore) {
  hitScore = h;
  if (!h) return;
  const rows = h[+$('hitarea').value].map((r, a) => r && [a, ...r]).filter(Boolean); // [hits, n, min, mean, max]
  if (!rows.length) { $('hittable').innerHTML = '<p class="mut">Nenhum candidato com acertos e nota nesta área.</p>'; return; }
  const half = Math.ceil(rows.length / 2), tbl = (rs) => `<table><thead><tr><th>Freq.</th><th>Acertos</th><th>Mínima</th><th>Média</th><th>Máxima</th></tr></thead><tbody>` +
    rs.map((r) => `<tr${r[0] % 5 === 0 ? ' class="hl"' : ''}><td>${fmt(r[1])}</td><th data-f="hits" data-v="${r[0]}">${r[0]}</th><td data-f="score" data-v="${r[2]}">${f1z(r[2])}</td><td>${f1z(r[3])}</td><td data-f="score" data-v="${r[4]}">${f1z(r[4])}</td></tr>`).join('') + '</tbody></table>';
  $('hittable').innerHTML = tbl(rows.slice(0, half)) + (rows.length > 1 ? tbl(rows.slice(half)) : '');
}

function buildFilters() {
  const fields = (items) => items.map(([k, label, max]) =>
    `<div><span>${label}</span><input type="number" step="any" id="${k}_lo" min="0" max="${max}" placeholder="0"><input type="number" step="any" id="${k}_hi" min="0" max="${max}" placeholder="${max}"></div>`).join('');
  $('tri').innerHTML = fields(TRI_FILTERS);
  $('essay').innerHTML = fields(ESSAY_FILTERS);
  $('hits').innerHTML = fields(HITS_FILTERS);
  for (const g of GROUPS) $('g_' + g.id).innerHTML = g.opts.map(([v, l]) => `<label><input type="checkbox" value="${v}">${l}</label>`).join('');
}
function countActive() { // how many filters are set in each collapsed section
  for (const d of document.querySelectorAll('#f details')) {
    const n = d.querySelectorAll('input:checked').length + [...d.querySelectorAll('.scores div')].filter((r) => [...r.querySelectorAll('input')].some((x) => x.value !== '')).length + [...d.querySelectorAll(':scope > input')].filter((x) => x.value !== '').length + (d.contains($('mchips')) ? muniSel.size : 0); // a min/max pair counts once
    d.querySelector('.n').textContent = n || '';
  }
}
function renderMunis() {
  $('mchips').innerHTML = [...muniSel].map(([i, l]) => `<span class="chip" data-i="${i}">${l} ✕</span>`).join(''); countActive();
}
function suggest() {
  const q = norm($('mq').value.trim());
  if (q.length < 2) { $('sug').innerHTML = ''; return; }
  const out = [];
  for (let i = 0; i < munis.length && out.length < 8; i++) if (munis[i].key.includes(q)) out.push(i);
  $('sug').innerHTML = out.map((i) => `<button type="button" data-i="${i}">${munis[i].label}</button>`).join('');
}
function addMuni(i) { muniSel.set(i, munis[i].label); $('mq').value = ''; $('sug').innerHTML = ''; renderMunis(); schedule(); }

function query() {
  const ranges = {}, cats = {};
  for (const [k, , max] of FILTER_FIELDS) {
    const lo = +$(k + '_lo').value || 0, hv = $(k + '_hi').value, hi = hv === '' ? max : +hv;
    if (lo > 0 || hi < max) ranges[k] = [lo, hi];
  }
  for (const k of ['NU_SEQUENCIAL', 'CO_ESCOLA']) if ($(k).value !== '') ranges[k] = [+$(k).value, +$(k).value];
  if ($('sch_in').checked !== $('sch_out').checked) { // both or none = everyone; no school is stored as CO_ESCOLA = 0
    const [lo, hi] = ranges.CO_ESCOLA || [0, 2147483647], linked = $('sch_in').checked;
    ranges.CO_ESCOLA = linked ? [Math.max(lo, 1), hi] : [lo, Math.min(hi, 0)];
  }
  for (const g of GROUPS) {
    const v = [...document.querySelectorAll(`#g_${g.id} input:checked`)].map((x) => +x.value);
    if (v.length) for (const k of g.keys) cats[k] = v;
  }
  if ($('nofalta').checked) for (const k of GROUPS.find((g) => g.id === 'pres').keys) cats[k] = (cats[k] || [0, 1, 2]).filter((v) => v !== 0); // no "Faltou" in any exam; ANDs with the presence chips
  for (const x of document.querySelectorAll('#faltou input:checked')) for (const k of x.value.split(',')) cats[k] = (cats[k] || [0, 1, 2]).filter((v) => v === 0); // absent on every checked exam day
  return { ranges, cats, ufs: [...ufSel], muni: [...muniSel.keys()], metric: +$('metric').value };
}
function run() { worker.postMessage({ t: 'filter', id: ++seq, ...query() }); }
function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }

let cacheInfo = null, base = '', lastProfile = null, lastProfileVars = [];
const setStatus = (s) => { base = s; $('status').textContent = s; };
const showCache = () => { $('delcache').hidden = !cacheInfo && $('work').hidden; }; // deleting is offered while data is loaded or saved
const busy = (txt) => { t0 = performance.now(); $('work').hidden = true; $('bar').hidden = false; $('bar').removeAttribute('value'); setStatus(txt); };

// Profile labels for fields that need a human-readable name even without a dictionary
const PROFILE_LABELS = {
  TP_FAIXA_ETARIA: 'Faixa etária',
  TP_SEXO: 'Sexo',
  TP_ESTADO_CIVIL: 'Estado civil',
  TP_COR_RACA: 'Cor/Raça',
  TP_NACIONALIDADE: 'Nacionalidade',
  TP_ST_CONCLUSAO: 'Situação do ensino médio',
  TP_ANO_CONCLUIU: 'Ano de conclusão',
  TP_ENSINO: 'Tipo de ensino',
  IN_TREINEIRO: 'Candidato treineiro',
  Q001: 'Escolaridade do pai',
  Q002: 'Escolaridade da mãe',
  Q003: 'Ocupação do pai',
  Q004: 'Ocupação da mãe',
};

function getProfileLabel(v) {
  if (v.name === 'IN_TREINEIRO') return 'Candidato treineiro';
  if (v.name === 'Q001') return 'Escolaridade do pai';
  if (v.name === 'Q002') return 'Escolaridade da mãe';
  if (v.name === 'Q003') return 'Ocupação do pai';
  if (v.name === 'Q004') return 'Ocupação da mãe';
  if (v.desc) {
    const nd = norm(v.desc.trim());
    if (nd.includes('treinar seus conhecimentos')) return 'Candidato treineiro';
    if (nd.includes('serie seu pai') || (nd.includes('homem responsavel') && nd.includes('estudou'))) return 'Escolaridade do pai';
    if (nd.includes('serie sua mae') || (nd.includes('mulher responsavel') && nd.includes('estudou'))) return 'Escolaridade da mãe';
    if (nd.includes('ocupacao') && (nd.includes('seu pai') || nd.includes('homem responsavel'))) return 'Ocupação do pai';
    if (nd.includes('ocupacao') && (nd.includes('sua mae') || nd.includes('mulher responsavel'))) return 'Ocupação da mãe';
    return v.desc.trim();
  }
  if (PROFILE_LABELS[v.name]) return PROFILE_LABELS[v.name];
  if (/^Q\d{3}$/.test(v.name)) return 'Questão soc. ' + v.name.slice(1).replace(/^0+/, '');
  return v.name;
}

function shouldSkipProfileVar(v) {
  if (v.name === 'SG_UF_PROVA') return true;
  if (v.desc) {
    const nd = norm(v.desc);
    if (nd.includes('sigla da unidade da federacao') || nd.includes('uf da aplicacao da prova')) return true;
  }
  return false;
}

function openProfileDetail(k) {
  const v = lastProfileVars[k];
  if (!v || !lastProfile) return;
  const label = getProfileLabel(v);
  const total = lastProfile.rows;
  const sorted = [...v.opts].sort((a, b) => b[3] - a[3]);
  const topCount = sorted[0]?.[3] || 1;
  const totalAnswered = sorted.reduce((sum, opt) => sum + (opt[3] || 0), 0);

  const rows = sorted.map(([, code, lbl, count]) => {
    const display = (lbl && lbl.trim()) ? lbl : code;
    const pct = total ? count / total : 0;
    const barW = Math.round(100 * count / topCount);
    return `<div class="pbar-row"><span class="pbar-name" title="${display}">${display}${lbl && code ? ` <small class="mut">(${code})</small>` : ''}</span>` +
      `<span class="pbar-wrap"><i class="pbar-fill" style="width:${barW}%"></i></span>` +
      `<span class="pbar-val">${fmt(count)}<small>${(100 * pct).toFixed(1)}%</small></span></div>`;
  }).join('');

  const descHtml = v.desc && v.desc.trim() !== label ? `<p class="mut" style="font-size:16px;margin:4px 0 12px">${v.desc}</p>` : '';
  const metaHtml = `<div class="tags" style="justify-content:flex-start;margin-bottom:14px">` +
    `<i>${fmt(totalAnswered)} respostas</i>` +
    `<i>${v.opts.length} categorias</i>` +
    `<i>${fmt(total)} participantes no total</i>` +
    `</div>`;

  $('pdbody').innerHTML = `<h3>${label}</h3>${descHtml}${metaHtml}<div class="pdetail-list">${rows}</div>`;
  if (!$('pdetail').open) $('pdetail').showModal();
}

function renderProfile(profile) {
  lastProfile = profile;
  const sec = $('profile-section');
  if (!profile || !profile.vars || !profile.vars.length) {
    lastProfileVars = [];
    sec.hidden = true;
    updateToc();
    return;
  }
  lastProfileVars = profile.vars.filter((v) => !shouldSkipProfileVar(v) && v.opts && v.opts.length);
  if (!lastProfileVars.length) { sec.hidden = true; updateToc(); return; }
  sec.hidden = false;
  $('profile-count').textContent = `${fmt(profile.rows)} participantes`;
  $('profile-grid').innerHTML = lastProfileVars.map((v, k) => {
    const label = getProfileLabel(v);
    const sorted = [...v.opts].sort((a, b) => b[3] - a[3]);
    const topCount = sorted[0]?.[3] || 1;
    const lead = sorted[0];
    const leadDisplay = (lead[2] && lead[2].trim()) ? lead[2] : lead[1];
    const leadPct = profile.rows ? lead[3] / profile.rows : 0;
    const previewBars = sorted.slice(0, 2).map(([, code, lbl, count]) => {
      const display = (lbl && lbl.trim()) ? lbl : code;
      const pct = profile.rows ? count / profile.rows : 0;
      const barW = Math.round(100 * count / topCount);
      return `<div class="pbar-row mini"><span class="pbar-name" title="${display}">${display}</span>` +
        `<span class="pbar-wrap"><i class="pbar-fill" style="width:${barW}%"></i></span>` +
        `<span class="pbar-val">${(100 * pct).toFixed(1)}%</span></div>`;
    }).join('');
    return `<div class="cand pcard" data-k="${k}">` +
      `<div class="head"><b>${label}</b><span>${v.opts.length} opções</span></div>` +
      `<div class="pcard-dominant"><small>Mais frequente</small><div class="pcard-lead"><span class="pcard-lead-name" title="${leadDisplay}">${leadDisplay}</span><b>${(100 * leadPct).toFixed(1)}%</b></div></div>` +
      `<div class="pcard-bars">${previewBars}</div>` +
      `<div class="pcard-foot"><small>Ver todas as opções (${v.opts.length}) →</small></div>` +
      `</div>`;
  }).join('');
  updateToc();
}

function initWorker() {
  worker = new Worker('worker.js');
  worker.onerror = (e) => { $('bar').hidden = true; setStatus('Erro ao iniciar o leitor: ' + (e.message || 'veja o console (F12)')); };
  worker.onmessage = ({ data: m }) => {
    if (m.t === 'precompute') {
      $('bar').hidden = false; $('bar').removeAttribute('value');
      setStatus(`Calculando posições padrão para ${fmt(m.rows)} candidatos…`);
    } else if (m.t === 'progress') {
      $('bar').hidden = false; $('bar').value = m.read / m.size;
      $('status').textContent = `Lendo ${m.what}… ${Math.round(100 * m.read / m.size)}% • ${fmt(m.rows)} linhas • ${Math.round((performance.now() - t0) / 1000)} s`;
    } else if (m.t === 'loaded') {
      munis = m.munis.map(([c, n]) => ({ key: norm(n), label: `${n} (${UF_BY_IBGE[Math.floor(c / 100000)] || '?'})` }));
      schools = m.schools || [];
      muniSel.clear(); ufSel.clear(); renderMunis(); hasCopy = m.copy;
      $('bar').hidden = true; $('work').hidden = false; showCache();
      setStatus(`${fmt(m.rows)} linhas carregadas ${m.cached ? 'dos dados salvos' : ''} em ${(m.ms / 1000).toFixed(1)} s.${m.profile ? ` Perfil: ${fmt(m.profile.rows)} participantes.` : ''}${m.notes.length ? ' ' + m.notes.join(' ') : ''}`);
      renderProfile(m.profile || null);
      triItems = m.items || null; renderTriAnalysis();
      updateToc();
      run();
    } else if (m.t === 'result') {
      if (m.id !== seq) return;
      $('count').textContent = fmt(m.count);
      $('pct').textContent = `${(100 * m.count / m.total).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do total`;
      $('ms').textContent = `${fmt(m.total)} no total • filtrado em ${m.ms} ms`;
      lastCount = m.count; renderStats(m.stats, m.hitStats, m.simpleStats); renderMap(m); renderHitScore(m.hitScore); muniPage = 0; renderMuniRank(); schoolPage = 0; renderSchoolRank();
      pageOff = 0; requestPage();
    } else if (m.t === 'page') {
      if (m.id === seq) renderPage(m);
    } else if (m.t === 'detail') {
      if (m.id === dseq) renderDetail(m);
    } else if (m.t === 'cache') {
      cacheInfo = m.meta; showCache(); busy(`Dados salvos encontrados (${m.meta.file.name}). Carregando…`);
      worker.postMessage({ t: 'usecache' });
    } else if (m.t === 'saving') $('status').textContent = base + ' Salvando para a próxima vez…';
    else if (m.t === 'saved') { cacheInfo = { saved: true }; showCache(); $('status').textContent = base + ' Salvo para a próxima vez.'; }
    else if (m.t === 'savefail') $('status').textContent = base + ' (não foi possível salvar: ' + m.msg + ')';
    else if (m.t === 'cleared') { cacheInfo = null; showCache(); setStatus('Dados salvos apagados.'); }
    else if (m.t === 'released') { csvFallback = null; hasCopy = false; $('detail').close(); $('work').hidden = true; showCache(); $('file').value = ''; setStatus('Dados liberados da memória.'); renderProfile(null); triItems = null; renderTriAnalysis(); schools = []; schoolRows = []; $('srank').innerHTML = ''; updateToc(); }
    else if (m.t === 'error') { $('bar').hidden = true; setStatus('Erro: ' + m.msg); }
  };
  worker.postMessage({ t: 'init' });
}
function start(file) {
  if (!window.showOpenFilePicker && /\.csv$/i.test(file.name)) csvFallback = file;
  busy('Lendo… 0%'); $('bar').value = 0;
  worker.postMessage({ t: 'load', file }); // the worker reads the stream once and drops the file
}

buildFilters(); buildMap();
const SHORT = ['Natureza', 'Humanas', 'Linguagens', 'Matemática', 'Redação'];
let sortValue = ''; // "<field>:<desc|asc>", or '' for file order
const SORT_LABEL = { '': 'Ordem do arquivo' };
const sortLeaf = (v, t) => `<li><button type="button" data-v="${v}">${t}</button></li>`;
function buildSortMenu() { // "Média ponderada" is offered only while it is switched on
  const menu = [['Médias', [['avg', 'Média simples'], ...(showW ? [['wavg', 'Média ponderada']] : [])]], ['Notas', AREAS.map(([k], i) => [k, SHORT[i]])], ['Acertos', [...HIT_FILTERS.map(([k], i) => [k, SHORT[i]]), ['ACERTOS_TOTAL', 'Total']]]];
  $('sortlist').innerHTML = sortLeaf('', 'Ordem do arquivo') + menu.map(([g, items]) => `<li class="sub"><button type="button" aria-haspopup="true">${g}</button><ul>` + items.map(([k, l]) => {
    SORT_LABEL[k + ':desc'] = `${g} › ${l} › Maior`; SORT_LABEL[k + ':asc'] = `${g} › ${l} › Menor`;
    return `<li class="sub"><button type="button" aria-haspopup="true">${l}</button><ul>${sortLeaf(k + ':desc', 'Maior')}${sortLeaf(k + ':asc', 'Menor')}</ul></li>`;
  }).join('') + '</ul></li>').join('');
  $('sortbtn').textContent = SORT_LABEL[sortValue];
}
buildSortMenu();
$('weights').innerHTML = '<div id="wbox" hidden><div class="weight-heading"><b>Pesos da média ponderada</b></div><div class="weight-inputs">' + TILES.map(([i, l]) => `<label><span>${l}</span><input type="number" min="0" step="any" value="1" data-i="${i}"></label>`).join('') + '</div></div><label class="rank-control" for="rankmetric"><span>Posições dos candidatos por</span><select id="rankmetric"></select></label>';
function buildRankOptions() {
  const cur = $('rankmetric').value;
  $('rankmetric').innerHTML = [['avg', 'Média simples'], ...(showW ? [['wavg', 'Média ponderada']] : []), ...AREAS].map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('rankmetric').value = [...$('rankmetric').options].some((o) => o.value === cur) ? cur : 'avg';
}
buildRankOptions();
$('showw').onchange = () => {
  showW = $('showw').checked; $('wbox').hidden = !showW;
  if (!showW && sortValue.startsWith('wavg')) sortValue = '';
  buildSortMenu(); buildRankOptions(); renderCards(); if (lastStats.length) renderStats(lastStats);
  pageOff = 0; requestPage(); // order and ranks may have changed
};
$('weights').addEventListener('input', () => {
  renderCards(); if (lastStats.length) renderStats(lastStats);
  if (sortValue.startsWith('wavg') || $('rankmetric').value === 'wavg') { pageOff = 0; requestPage(); } // order and ranks depend on the weights
});
$('statop').innerHTML = OPS.map(([v, l]) => `<option value="${v}">Destaque: ${l}</option>`).join('');
$('statop').onchange = () => renderStats(lastStats);
$('hitarea').innerHTML = AREAS.slice(0, 4).map(([, l], k) => `<option value="${k}">${l}</option>`).join(''); $('hitarea').value = 3;
$('hitarea').onchange = () => renderHitScore();
$('hittable').addEventListener('click', (e) => { // a clicked hit count, minimum or maximum becomes a filter on the selected area
  const c = e.target.closest('[data-f]'); if (!c) return;
  const k = +$('hitarea').value, v = +c.dataset.v, hits = c.dataset.f === 'hits';
  const id = hits ? HIT_FILTERS[k][0] : AREAS[k][0], lo = hits ? v : Math.max(0, +(v - 0.05).toFixed(2)), hi = hits ? v : +(v + 0.05).toFixed(2); // scores are stored as float32 with one decimal: match the rounded value
  $(id + '_lo').value = lo; $(id + '_hi').value = hi; countActive(); schedule();
});
$('sortbtn').onclick = () => $('sortmenu').classList.toggle('open');
$('sortlist').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.v === undefined) { b.parentElement.classList.toggle('open'); return; } // a group or field: open its submenu (touch screens)
  sortValue = b.dataset.v; $('sortbtn').textContent = SORT_LABEL[sortValue]; $('sortmenu').classList.remove('open'); pageOff = 0; requestPage();
});
document.addEventListener('click', (e) => { if (!e.target.closest('#sortmenu')) $('sortmenu').classList.remove('open'); });
$('sortmenu').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('sortmenu').classList.remove('open'); $('sortbtn').focus(); } });
$('rankmetric').onchange = () => { pageOff = 0; requestPage(); };
$('prev').onclick = () => { pageOff = Math.max(0, pageOff - PAGE); requestPage(); };
$('next').onclick = () => { pageOff += PAGE; requestPage(); };
for (const id of ['map', 'rank']) $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-uf]'); if (!b) return; const u = b.dataset.uf; ufSel.has(u) ? ufSel.delete(u) : ufSel.add(u); schedule(); });
$('metric').onchange = schedule;
$('mmin').oninput = () => { muniPage = 0; renderMuniRank(); };
$('mprev').onclick = () => { muniPage--; renderMuniRank(); };
$('mnext').onclick = () => { muniPage++; renderMuniRank(); };
$('mrank').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; const g = +li.dataset.m; muniSel.has(g) ? muniSel.delete(g) : muniSel.set(g, munis[g].label); renderMunis(); schedule(); });
$('smin').oninput = () => { schoolPage = 0; renderSchoolRank(); };
$('sprev').onclick = () => { schoolPage--; renderSchoolRank(); };
$('snext').onclick = () => { schoolPage++; renderSchoolRank(); };
$('srank').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const s = li.dataset.s;
  if (!s) return;
  $('CO_ESCOLA').value = $('CO_ESCOLA').value === s ? '' : s;
  countActive();
  schedule();
});
$('file').onchange = (e) => e.target.files[0] && start(e.target.files[0]);
$('cards').addEventListener('click', (e) => { const c = e.target.closest('.cand'); if (c) openDetail(pageRows[+c.dataset.k]); });
$('dclose').onclick = () => $('detail').close();
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) $('detail').close(); }); // click on the backdrop
$('detail').addEventListener('close', () => { dseq++; $('dbody').innerHTML = ''; });
$('profile-grid').addEventListener('click', (e) => {
  const c = e.target.closest('.pcard');
  if (c && lastProfileVars) openProfileDetail(+c.dataset.k);
});
$('pdclose').onclick = () => $('pdetail').close();
$('pdetail').addEventListener('click', (e) => { if (e.target === $('pdetail')) $('pdetail').close(); });
$('pdetail').addEventListener('close', () => { $('pdbody').innerHTML = ''; });
$('delcache').onclick = () => { worker.postMessage({ t: 'release' }); worker.postMessage({ t: 'clearcache' }); }; // frees the memory and deletes the saved copy
initWorker();
let triItems = null;
$('tri-area-select').addEventListener('change', () => renderTriAnalysis());
$('tri-sort').addEventListener('change', () => renderTriAnalysis());
const TRI_SORTS = {
  pos: (x, y) => x.pos - y.pos,
  'pct-desc': (x, y) => (y.pct ?? -1) - (x.pct ?? -1),
  'pct-asc': (x, y) => (x.pct ?? 2) - (y.pct ?? 2),
  'b-asc': (x, y) => (x.b ?? 1e9) - (y.b ?? 1e9),
  'b-desc': (x, y) => (y.b ?? -1e9) - (x.b ?? -1e9),
  'a-desc': (x, y) => (y.a ?? -1e9) - (x.a ?? -1e9),
};
function triHighlight(list, pick, fmtv) { // one extreme item of the area, as a small stat tile
  let best = null;
  for (const it of list) if (pick(it) !== undefined && (best === null || pick(it) > pick(best))) best = it;
  if (!best) return '';
  return `<div class="stat"><h4>${fmtv.label}</h4><p class="mean">${fmtv.value(best)}</p><p>Item ${best.id} • posição ${best.pos} • gabarito ${best.gab || '—'}</p></div>`;
}
function renderTriAnalysis() {
  const box = $('tri-analysis-content');
  if (!triItems) {
    box.innerHTML = '<p class="mut">Os parâmetros das questões vêm do ITENS_PROVA.csv dentro do ZIP oficial do ENEM.</p>';
    return;
  }
  const area = $('tri-area-select').value, list = triItems[area] || [];
  if (!list.length) { box.innerHTML = '<p class="mut">Nenhum item desta área nos dados carregados.</p>'; return; }
  const byPct = (it) => it.pct, byDisc = (it) => it.a;
  const tiles = [
    triHighlight(list, byPct, { label: 'Mais acertada', value: (it) => `${f1(100 * it.pct)}%` }),
    triHighlight(list, (it) => (it.pct === undefined ? undefined : -it.pct), { label: 'Menos acertada', value: (it) => `${f1(100 * it.pct)}%` }),
    triHighlight(list, byDisc, { label: 'Mais discriminativa', value: (it) => `a = ${f1(it.a)}` }),
  ].join('');
  const rows = [...list].sort(TRI_SORTS[$('tri-sort').value] || TRI_SORTS.pos);
  const examName = (e) => (e.cor ? e.cor.charAt(0) + e.cor.slice(1).toLowerCase() : `Prova ${e.cp}`) + (e.lang === 0 ? ' • Inglês' : e.lang === 1 ? ' • Espanhol' : '');
  box.innerHTML = `
    <div class="statgrid">${tiles}</div>
    <p class="mut"><b>${fmt(list.length)}</b> questões nesta área. Abra <b>Detalhe</b> para ver os acertos por cor de prova.</p>
    <div style="overflow-x:auto">
      <table class="tri-table">
        <thead><tr><th>Posição</th><th>Item</th><th>Gabarito</th><th>Dificuldade (b)</th><th>Discriminação (a)</th><th>Acerto ao acaso (c)</th><th>Acertos</th><th>Detalhe</th></tr></thead>
        <tbody>${rows.map((it, i) => `<tr>
          <td>${it.pos}</td><td>${it.id}</td><td><b>${it.gab || '—'}</b></td>
          <td>${it.b === undefined ? '—' : f1(it.b)}</td>
          <td>${it.a === undefined ? '—' : f1(it.a)}</td>
          <td>${it.c === undefined ? '—' : f1(it.c)}</td>
          <td>${it.pct === undefined ? '—' : f1(100 * it.pct) + '%'}</td>
          <td>${it.exams.length ? `<button class="tri-toggle" data-i="${i}" aria-expanded="false" title="Ver a quebra por cor de prova">${it.exams.length}</button>` : '—'}</td>
        </tr>
        <tr class="tri-detail" id="tri-d-${i}" hidden><td colspan="8">
          <table class="tri-table tri-sub">
            <thead><tr><th>Cor da prova</th><th>Posição</th><th>Acertos</th><th>% de acertos</th></tr></thead>
            <tbody>${it.exams.map((e) => `<tr>
              <td>${examName(e)}</td><td>${e.pos}</td><td>${fmt(e.hits)} de ${fmt(e.answered)}</td><td>${f1(100 * e.pct)}%</td>
            </tr>`).join('')}</tbody>
          </table>
        </td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}
$('tri-analysis-content').addEventListener('click', (e) => { // expand the per-colour breakdown of one item
  const b = e.target.closest('.tri-toggle');
  if (!b) return;
  const row = $('tri-d-' + b.dataset.i);
  if (!row) return;
  row.hidden = !row.hidden;
  b.setAttribute('aria-expanded', String(!row.hidden));
  b.classList.toggle('open', !row.hidden);
});

// Fixed index on the left: only the sections on screen, with the current one lit.
const tocLinks = () => [...document.querySelectorAll('#toc a')];
function updateToc() {
  const toc = $('toc'), vis = [];
  for (const a of tocLinks()) {
    const el = document.querySelector(a.getAttribute('href'));
    const ok = !!el && el.getClientRects().length > 0; // a hidden section takes its index entry with it
    a.parentElement.hidden = !ok;
    if (ok) vis.push([a, el]);
  }
  toc.hidden = vis.length < 2;
  if (toc.hidden) return;
  let active = vis[0][0], best = -Infinity;
  for (const [a, el] of vis) {
    const top = el.getBoundingClientRect().top;
    if (top <= 150 && top > best) { best = top; active = a; } // equal tops keep the first one (the map and the result share a row)
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) active = vis[vis.length - 1][0]; // the last card may never reach the line
  for (const [a] of vis) a.classList.toggle('active', a === active);
}
let tocFrame = 0;
function queueToc() { if (!tocFrame) tocFrame = requestAnimationFrame(() => { tocFrame = 0; updateToc(); }); }
addEventListener('scroll', queueToc, { passive: true });
addEventListener('resize', queueToc);
updateToc();

$('f').addEventListener('input', (e) => { if (e.target.id !== 'mq') { countActive(); schedule(); } });
$('mq').addEventListener('input', suggest);
$('mq').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('sug').querySelector('button'); if (b) addMuni(+b.dataset.i); } });
$('sug').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) addMuni(+b.dataset.i); });
$('mchips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { muniSel.delete(+c.dataset.i); renderMunis(); schedule(); } });
$('clear').onclick = () => { $('f').reset(); muniSel.clear(); ufSel.clear(); renderMunis(); $('sug').innerHTML = ''; countActive(); schedule(); };
