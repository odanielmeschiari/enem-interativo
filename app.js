'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString('pt-BR');
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UF_BY_IBGE = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const AREAS = [['NU_NOTA_CN', 'Ciências da Natureza', 1000], ['NU_NOTA_CH', 'Ciências Humanas', 1000], ['NU_NOTA_LC', 'Linguagens e Códigos', 1000], ['NU_NOTA_MT', 'Matemática', 1000], ['NU_NOTA_REDACAO', 'Redação', 1000]];
const SCORES = [...AREAS, ...[1, 2, 3, 4, 5].map((i) => ['NU_NOTA_COMP' + i, 'Redação: competência ' + i, 200])]; // filters only
const GROUPS = [ // categorical filters; labels follow the ENEM data dictionary
  { id: 'pres', title: 'Presença (em todas as provas)', keys: ['TP_PRESENCA_CN', 'TP_PRESENCA_CH', 'TP_PRESENCA_LC', 'TP_PRESENCA_MT'], opts: [[1, 'Presente'], [0, 'Faltou'], [2, 'Eliminado']] },
  { id: 'lin', title: 'Língua estrangeira', keys: ['TP_LINGUA'], opts: [[0, 'Inglês'], [1, 'Espanhol']] },
  { id: 'dep', title: 'Dependência administrativa da escola', keys: ['TP_DEPENDENCIA_ADM_ESC'], opts: [[1, 'Federal'], [2, 'Estadual'], [3, 'Municipal'], [4, 'Privada']] },
  { id: 'loc', title: 'Localização da escola', keys: ['TP_LOCALIZACAO_ESC'], opts: [[1, 'Urbana'], [2, 'Rural']] },
  { id: 'red', title: 'Situação da redação', keys: ['TP_STATUS_REDACAO'], opts: [[1, 'Sem problemas'], [2, 'Anulada'], [3, 'Cópia do texto motivador'], [4, 'Em branco'], [6, 'Fuga ao tema'], [7, 'Fuga do tipo textual'], [8, 'Texto insuficiente'], [9, 'Parte desconectada']] },
];
let worker, seq = 0, timer, t0, munis = [], muniSel = new Map(), ufSel = new Set();
const f1 = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const num = (x) => x === null ? '–' : f1(x);
const compact = (x) => x >= 1e6 ? f1(x / 1e6) + ' mi' : x >= 1e3 ? Math.round(x / 1e3) + ' mil' : String(x);

const SMALL = new Set(['DF', 'SE', 'AL', 'PB', 'RN', 'ES']); // too small to print a value inside
const SVGNS = 'http://www.w3.org/2000/svg';
let mapEls = null, lastResult = null;
async function buildMap() {
  $('metric').innerHTML = '<option value="-1">Colorir por: nº de candidatos</option>' + AREAS.map(([, l], k) => `<option value="${k}">Colorir por: média de ${l}</option>`).join('');
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
const ALL = ['CN', 'CH', 'LC', 'MT', 'REDACAO'], atLeast = (n, ks = ALL) => Object.fromEntries(ks.map((k) => ['NU_NOTA_' + k, [n, '']]));
const PRESETS = [
  ['Redação nota 1000', { ranges: { NU_NOTA_REDACAO: [1000, ''] } }],
  ['Redação ≥ 900', { ranges: { NU_NOTA_REDACAO: [900, ''] } }],
  ['Matemática ≥ 850', { ranges: { NU_NOTA_MT: [850, ''] } }],
  ['Natureza e Matemática ≥ 800', { ranges: atLeast(800, ['CN', 'MT']) }],
  ['Todas as notas ≥ 700', { ranges: atLeast(700) }],
  ['Todas as notas ≥ 800', { ranges: atLeast(800) }],
  ['Escolas federais', { groups: { dep: [1] } }],
  ['Escolas públicas', { groups: { dep: [1, 2, 3] } }],
  ['Escolas públicas com redação ≥ 900', { ranges: { NU_NOTA_REDACAO: [900, ''] }, groups: { dep: [1, 2, 3] } }],
  ['Escolas privadas urbanas', { groups: { dep: [4], loc: [1] } }],
  ['Escolas rurais', { groups: { loc: [2] } }],
  ['Fez prova de espanhol', { groups: { lin: [1] } }],
  ['Redação zerada (presentes)', { ranges: { NU_NOTA_REDACAO: [0, 0] }, groups: { pres: [1] } }],
  ['Redação anulada ou em branco', { groups: { red: [2, 4] } }],
  ['Faltou em todas as provas', { groups: { pres: [0] } }],
  ['Eliminados', { groups: { pres: [2] } }],
];
let pageOff = 0, pageTotal = 0;
const active = new Set(); // indexes of the selected presets
const markPresets = () => document.querySelectorAll('#presets button').forEach((b) => b.setAttribute('aria-pressed', active.has(+b.dataset.i)));
function togglePreset(i) { // the form becomes the merge of all selected presets: score ranges intersect, chips of one group add up (OR, like the chips themselves)
  active.has(i) ? active.delete(i) : active.add(i);
  const kept = [...document.querySelectorAll('input.keep')], was = kept.map((x) => x.checked), R = {}, G = {};
  $('f').reset(); kept.forEach((x, n) => { x.checked = was[n]; }); // the absence filters survive a preset change
  for (const j of active) {
    const p = PRESETS[j][1];
    for (const [k, [lo, hi]] of Object.entries(p.ranges || {})) {
      const r = R[k], his = [r && r[1], hi].filter((x) => x !== '' && x !== undefined);
      R[k] = [Math.max(r ? r[0] : 0, lo), his.length ? Math.min(...his) : ''];
    }
    for (const [id, vals] of Object.entries(p.groups || {})) G[id] = [...new Set([...(G[id] || []), ...vals])];
  }
  for (const [k, [lo, hi]] of Object.entries(R)) { $(k + '_lo').value = lo; $(k + '_hi').value = hi; }
  for (const [id, vals] of Object.entries(G)) for (const x of document.querySelectorAll(`#g_${id} input`)) x.checked = vals.includes(+x.value);
  markPresets(); schedule();
}
function requestPage() {
  const [sort, dir] = $('sort').value.split(':');
  worker.postMessage({ t: 'page', id: seq, sort: sort || null, dir, w: W, offset: pageOff, limit: PAGE, rankKey: $('rankmetric').value });
}
const TILES = [[3, 'Matemática'], [1, 'Humanas'], [2, 'Linguagens'], [0, 'Natureza'], [4, 'Redação']]; // [index in r.n, label]; same order as the weight inputs
const hue = (x) => Math.round(120 * Math.min(1, Math.max(0, (x - 300) / 500))); // 300 or less = red, 800 or more = green
let pageRows = [], W = [1, 1, 1, 1, 1], lastHitStats = [];
function averages(n) { // a missing score (absence) counts as 0; the weighted one is null only if every weight is 0
  let s = 0, ws = 0, wt = 0;
  for (let i = 0; i < n.length; i++) { const x = n[i] ?? 0; s += x; ws += W[i] * x; wt += W[i]; }
  return [s / n.length, wt > 0 ? ws / wt : null];
}
function card(r) {
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
  const hits = r.hits.map((v, i) => `<span>${['Natureza', 'Humanas', 'Linguagens', 'Matemática'][i]} <b>${v === null ? '—' : v + '/45'}</b></span>`).join('');
  return `<div class="cand"><div class="head"><b>Candidato ${r.id}</b><span>${r.muni || '—'} · ${r.uf || '—'}</span></div>` +
    `<div class="tags">${tags.filter(Boolean).map((t) => `<i>${t}</i>`).join('')}${warn.map((t) => `<i class="warn">${t}</i>`).join('')}</div>` +
    `<div class="avgs"><div><small>Média simples</small><b>${num(avg)}</b></div><div><small>Média ponderada</small><b>${num(wavg)}</b></div><div class="hit-total"><small>Acertos totais</small><b>${totalHits === null ? '—' : fmt(totalHits)}</b><em>${totalHits === null ? 'incompleto' : 'de 180'}</em></div></div>` +
    `<div class="tiles">${TILES.map(tile).join('')}</div><div class="hits"><small>Acertos por área (sobre 45 questões)</small>${hits}</div>${rank}</div>`;
}
function renderCards() {
  for (const x of $('weights').querySelectorAll('input')) W[+x.dataset.i] = Math.max(0, +x.value || 0);
  $('cards').innerHTML = pageRows.length ? pageRows.map(card).join('') : '<p class="mut">Nenhum candidato com esses filtros.</p>';
}
function renderPage(m) {
  const avail = $('sort').value ? Math.min(m.total, 200) : m.total;
  pageRows = m.rows; renderCards();
  pageTotal = avail;
  $('pageinfo').textContent = avail ? `${fmt(pageOff + 1)}–${fmt(pageOff + m.rows.length)} de ${fmt(avail)}` : '';
  $('prev').disabled = pageOff === 0; $('next').disabled = pageOff + PAGE >= avail;
}
const OPS = [['mean', 'Média', 'média'], ['med', 'Mediana', 'mediana'], ['max', 'Maior nota', 'máx'], ['min', 'Menor nota', 'mín'], ['p25', '1º quartil', '1º quartil'], ['p75', '3º quartil', '3º quartil'], ['sd', 'Desvio padrão', 'desvio']];
let lastStats = [], lastCount = 0, lastSimpleStats = null;
function renderStats(st, hitStats = lastHitStats, simpleStats = lastSimpleStats) {
  lastStats = st; lastHitStats = hitStats; lastSimpleStats = simpleStats;
  const op = $('statop').value, hi = OPS.find((o) => o[0] === op);
  const [avg, wavg] = averages(st.map((s) => s.n ? s.mean * s.n / lastCount : 0)); // overall: every matching candidate counts, absences as 0
  const summary = `<div class="stats-summary"><div class="summary-copy"><small>RESUMO DO RECORTE</small><h3>Média geral dos candidatos</h3><p>Considera as cinco áreas. Ausências contam como nota zero.</p></div>` +
    `<div class="summary-values"><div><span>Média simples</span><b>${num(avg)}</b></div><div><span>Média ponderada</span><b>${num(wavg)}</b></div></div></div>`;
  const hitLabels = ['Natureza', 'Humanas', 'Linguagens', 'Matemática', 'Total'];
  const hits = hitStats.map((h, i) => `<article class="stat hitstat"><h4>${hitLabels[i]}</h4><div class="stat-primary">${h.n ? f1(h.mean) : '—'}<small>média de acertos</small></div>` +
    (h.n ? `<div class="hit-details"><span>Mediana <b>${h.median}</b></span><span>Faixa <b>${h.min}–${h.max}</b></span></div><small class="stat-foot">${fmt(h.n)} candidatos${i === 4 ? ' com as quatro áreas' : ''}</small>` : '<p class="mut">Sem dados completos</p>') + '</article>').join('');
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

function buildFilters() {
  $('scores').innerHTML = SCORES.map(([k, label, max]) =>
    `<div><span>${label}</span><input type="number" id="${k}_lo" min="0" max="${max}" placeholder="0"><input type="number" id="${k}_hi" min="0" max="${max}" placeholder="${max}"></div>`).join('') +
    ['CN', 'CH', 'LC', 'MT'].map((a, i) => `<div><span>Acertos: ${['Natureza', 'Humanas', 'Linguagens', 'Matemática'][i]}</span><input type="number" id="ACERTOS_${a}_lo" min="0" max="45" placeholder="0"><input type="number" id="ACERTOS_${a}_hi" min="0" max="45" placeholder="45"></div>`).join('');
  $('groups').innerHTML = GROUPS.map((g) => `<h3>${g.title}</h3><div class="chips" id="g_${g.id}">` +
    g.opts.map(([v, l]) => `<label><input type="checkbox" value="${v}">${l}</label>`).join('') + '</div>').join('');
}
function renderMunis() {
  $('mchips').innerHTML = [...muniSel].map(([i, l]) => `<span class="chip" data-i="${i}">${l} ✕</span>`).join('');
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
  for (const [k, , max] of [...SCORES, ...['CN', 'CH', 'LC', 'MT'].map((a) => ['ACERTOS_' + a, '', 45])]) {
    const lo = +$(k + '_lo').value || 0, hv = $(k + '_hi').value, hi = hv === '' ? max : +hv;
    if (lo > 0 || hi < max) ranges[k] = [lo, hi];
  }
  for (const k of ['NU_SEQUENCIAL', 'CO_ESCOLA']) if ($(k).value !== '') ranges[k] = [+$(k).value, +$(k).value];
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
function edit() { active.clear(); markPresets(); schedule(); } // a manual change to the form ends the preset highlight

let cacheInfo = null, base = '';
const setStatus = (s) => { base = s; $('status').textContent = s; };
const showCache = () => { $('usecache').hidden = $('delcache').hidden = !cacheInfo; };
const busy = (txt) => { t0 = performance.now(); $('work').hidden = true; $('bar').hidden = false; $('bar').removeAttribute('value'); setStatus(txt); };

function initWorker() {
  worker = new Worker('worker.js');
  worker.onerror = (e) => { $('bar').hidden = true; setStatus('Erro ao iniciar o leitor: ' + (e.message || 'veja o console (F12)')); };
  worker.onmessage = ({ data: m }) => {
    if (m.t === 'precompute') {
      $('bar').hidden = false; $('bar').removeAttribute('value');
      setStatus(`Calculando posições padrão para ${fmt(m.rows)} candidatos…`);
    } else if (m.t === 'progress') {
      $('bar').hidden = false; $('bar').value = m.read / m.size;
      $('status').textContent = `Lendo… ${Math.round(100 * m.read / m.size)}% • ${fmt(m.rows)} linhas • ${Math.round((performance.now() - t0) / 1000)} s`;
    } else if (m.t === 'loaded') {
      munis = m.munis.map(([c, n]) => ({ key: norm(n), label: `${n} (${UF_BY_IBGE[Math.floor(c / 100000)] || '?'})` }));
      muniSel.clear(); ufSel.clear(); renderMunis();
      $('bar').hidden = true; $('work').hidden = false; $('release').hidden = false;
      setStatus(`${fmt(m.rows)} linhas carregadas ${m.cached ? 'dos dados salvos' : ''} em ${(m.ms / 1000).toFixed(1)} s.`);
      run();
    } else if (m.t === 'result') {
      if (m.id !== seq) return;
      $('count').textContent = fmt(m.count);
      $('pct').textContent = `${(100 * m.count / m.total).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do total`;
      $('ms').textContent = `${fmt(m.total)} no total • filtrado em ${m.ms} ms`;
      lastCount = m.count; renderStats(m.stats, m.hitStats, m.simpleStats); renderMap(m); muniPage = 0; renderMuniRank();
      pageOff = 0; requestPage();
    } else if (m.t === 'page') {
      if (m.id === seq) renderPage(m);
    } else if (m.t === 'cache') {
      cacheInfo = m.meta; showCache(); busy(`Dados salvos encontrados (${m.meta.file.name}). Carregando…`);
      worker.postMessage({ t: 'usecache' });
    } else if (m.t === 'saving') $('status').textContent = base + ' Salvando para a próxima vez…';
    else if (m.t === 'saved') { cacheInfo = { saved: true }; showCache(); $('status').textContent = base + ' Salvo para a próxima vez.'; }
    else if (m.t === 'savefail') $('status').textContent = base + ' (não foi possível salvar: ' + m.msg + ')';
    else if (m.t === 'cleared') { cacheInfo = null; showCache(); setStatus('Dados salvos apagados.'); }
    else if (m.t === 'released') { $('work').hidden = true; $('release').hidden = true; $('file').value = ''; setStatus('Dados liberados da memória.'); }
    else if (m.t === 'error') { $('bar').hidden = true; setStatus('Erro: ' + m.msg); }
  };
  worker.postMessage({ t: 'init' });
}
function start(file) {
  busy('Lendo… 0%'); $('bar').value = 0;
  worker.postMessage({ t: 'load', file }); // the worker reads the stream once and drops the file
}

buildFilters(); buildMap();
$('presets').innerHTML = PRESETS.map(([l], i) => `<button type="button" data-i="${i}">${l}</button>`).join('');
$('presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) togglePreset(+b.dataset.i); });
$('sort').innerHTML = '<option value="">Ordem do arquivo</option>' + [['avg', 'média simples'], ['wavg', 'média ponderada'], ...AREAS.map(([k, l]) => [k, l]), ['ACERTOS_CN', 'acertos em Natureza'], ['ACERTOS_CH', 'acertos em Humanas'], ['ACERTOS_LC', 'acertos em Linguagens'], ['ACERTOS_MT', 'acertos em Matemática'], ['ACERTOS_TOTAL', 'acertos totais']].flatMap(([k, l]) => [`<option value="${k}:desc">Maior ${l}</option>`, `<option value="${k}:asc">Menor ${l}</option>`]).join('');
$('weights').innerHTML = '<div class="weight-heading"><b>Pesos da média ponderada</b><small>Faltas contam como nota zero.</small></div><div class="weight-inputs">' + TILES.map(([i, l]) => `<label><span>${l}</span><input type="number" min="0" step="any" value="1" data-i="${i}"></label>`).join('') + '</div><label class="rank-control" for="rankmetric"><span>Posições dos candidatos por</span><select id="rankmetric"><option value="avg">Média simples</option><option value="wavg">Média ponderada</option>' + AREAS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('') + '</select></label>';
$('weights').addEventListener('input', () => {
  renderCards(); if (lastStats.length) renderStats(lastStats);
  if ($('sort').value.startsWith('wavg') || $('rankmetric').value === 'wavg') { pageOff = 0; requestPage(); } // order and ranks depend on the weights
});
$('statop').innerHTML = OPS.map(([v, l]) => `<option value="${v}">Destaque: ${l}</option>`).join('');
$('statop').onchange = () => renderStats(lastStats);
$('sort').onchange = () => { pageOff = 0; requestPage(); };
$('rankmetric').onchange = () => { pageOff = 0; requestPage(); };
$('prev').onclick = () => { pageOff = Math.max(0, pageOff - PAGE); requestPage(); };
$('next').onclick = () => { pageOff += PAGE; requestPage(); };
for (const id of ['map', 'rank']) $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-uf]'); if (!b) return; const u = b.dataset.uf; ufSel.has(u) ? ufSel.delete(u) : ufSel.add(u); schedule(); });
$('metric').onchange = schedule;
$('mmin').oninput = () => { muniPage = 0; renderMuniRank(); };
$('mprev').onclick = () => { muniPage--; renderMuniRank(); };
$('mnext').onclick = () => { muniPage++; renderMuniRank(); };
$('mrank').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; const g = +li.dataset.m; muniSel.has(g) ? muniSel.delete(g) : muniSel.set(g, munis[g].label); renderMunis(); schedule(); });
$('file').onchange = (e) => e.target.files[0] && start(e.target.files[0]);
$('release').onclick = () => worker.postMessage({ t: 'release' });
$('usecache').onclick = () => { busy('Carregando dados salvos…'); worker.postMessage({ t: 'usecache' }); };
$('delcache').onclick = () => worker.postMessage({ t: 'clearcache' });
initWorker();
$('f').addEventListener('input', (e) => { if (e.target.classList.contains('keep')) schedule(); else if (e.target.id !== 'mq') edit(); });
$('mq').addEventListener('input', suggest);
$('mq').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('sug').querySelector('button'); if (b) addMuni(+b.dataset.i); } });
$('sug').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) addMuni(+b.dataset.i); });
$('mchips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { muniSel.delete(+c.dataset.i); renderMunis(); schedule(); } });
$('clear').onclick = () => { $('f').reset(); muniSel.clear(); ufSel.clear(); renderMunis(); $('sug').innerHTML = ''; edit(); };
