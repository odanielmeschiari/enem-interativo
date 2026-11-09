'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString('pt-BR');
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UF_BY_IBGE = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const SCORES = [['NU_NOTA_CN', 'Ciências da Natureza', 1000], ['NU_NOTA_CH', 'Ciências Humanas', 1000], ['NU_NOTA_LC', 'Linguagens e Códigos', 1000], ['NU_NOTA_MT', 'Matemática', 1000], ['NU_NOTA_REDACAO', 'Redação', 1000],
  ...[1, 2, 3, 4, 5].map((i) => ['NU_NOTA_COMP' + i, 'Competência ' + i, 200])];
const GROUPS = [ // categorical filters; labels follow the ENEM data dictionary
  { id: 'pres', title: 'Presença (em todas as provas)', keys: ['TP_PRESENCA_CN', 'TP_PRESENCA_CH', 'TP_PRESENCA_LC', 'TP_PRESENCA_MT'], opts: [[1, 'Presente'], [0, 'Faltou'], [2, 'Eliminado']] },
  { id: 'lin', title: 'Língua estrangeira', keys: ['TP_LINGUA'], opts: [[0, 'Inglês'], [1, 'Espanhol']] },
  { id: 'dep', title: 'Dependência administrativa da escola', keys: ['TP_DEPENDENCIA_ADM_ESC'], opts: [[1, 'Federal'], [2, 'Estadual'], [3, 'Municipal'], [4, 'Privada']] },
  { id: 'loc', title: 'Localização da escola', keys: ['TP_LOCALIZACAO_ESC'], opts: [[1, 'Urbana'], [2, 'Rural']] },
  { id: 'red', title: 'Situação da redação', keys: ['TP_STATUS_REDACAO'], opts: [[1, 'Sem problemas'], [2, 'Anulada'], [3, 'Cópia do texto motivador'], [4, 'Em branco'], [6, 'Fuga ao tema'], [7, 'Fuga do tipo textual'], [8, 'Texto insuficiente'], [9, 'Parte desconectada']] },
];
const TILES = { RR: [2, 0], AP: [4, 0], AM: [1, 1], PA: [3, 1], MA: [4, 1], PI: [5, 1], CE: [6, 1], RN: [7, 1], AC: [0, 2], RO: [1, 2], MT: [2, 2], TO: [3, 2], BA: [5, 2], PE: [6, 2], PB: [7, 2],
  MS: [2, 3], GO: [3, 3], DF: [4, 3], MG: [5, 3], AL: [6, 3], SE: [7, 3], PR: [3, 4], SP: [4, 4], RJ: [5, 4], ES: [6, 4], SC: [3, 5], RS: [3, 6] }; // stylized tile map: col,row
let worker, seq = 0, timer, t0, munis = [], muniSel = new Map(), ufSel = new Set();
const f1 = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const compact = (x) => x >= 1e6 ? f1(x / 1e6) + ' mi' : x >= 1e3 ? Math.round(x / 1e3) + ' mil' : String(x);

function buildMap() {
  $('map').innerHTML = Object.entries(TILES).map(([u, [c, r]]) => `<button type="button" data-uf="${u}" style="left:${c * 12.5}%;top:${r * 14.2857}%"><b>${u}</b><small></small></button>`).join('');
  $('metric').innerHTML = '<option value="-1">Colorir por: nº de candidatos</option>' + SCORES.map(([, l], k) => `<option value="${k}">Colorir por: média de ${l}</option>`).join('');
}
function renderMap(m) {
  const mean = +$('metric').value >= 0, vals = mean ? m.perUfMean : m.perUf, ok = vals.filter((v) => v);
  const lo = Math.min(...ok), hi = Math.max(...ok);
  for (const b of $('map').children) {
    const i = m.ufs.indexOf(b.dataset.uf), v = i < 0 ? null : vals[i];
    b.classList.toggle('sel', ufSel.has(b.dataset.uf));
    b.style.background = v ? `hsl(140 ${50 + 15 * ((v - lo) / (hi - lo || 1))}% ${14 + 34 * ((v - lo) / (hi - lo || 1))}%)` : '#21262d';
    b.lastChild.textContent = v ? (mean ? Math.round(v) : compact(v)) : '–';
  }
  $('legend').innerHTML = ok.length ? `<span>${mean ? Math.round(lo) : compact(lo)}</span><i></i><span>${mean ? Math.round(hi) : compact(hi)}</span>` : '';
}
const PAGE = 12, LBL = (id) => Object.fromEntries(GROUPS.find((g) => g.id === id).opts);
const PRESETS = [
  ['Redação nota 1000', { ranges: { NU_NOTA_REDACAO: [1000, ''] } }],
  ['Matemática ≥ 850', { ranges: { NU_NOTA_MT: [850, ''] } }],
  ['Todas as notas ≥ 700', { ranges: Object.fromEntries(['CN', 'CH', 'LC', 'MT', 'REDACAO'].map((k) => ['NU_NOTA_' + k, [700, '']])) }],
  ['Escolas federais', { groups: { dep: [1] } }],
  ['Escolas privadas urbanas', { groups: { dep: [4], loc: [1] } }],
  ['Redação zerada (presentes)', { ranges: { NU_NOTA_REDACAO: [0, 0] }, groups: { pres: [1] } }],
  ['Norte', { ufs: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'] }], ['Nordeste', { ufs: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'] }],
  ['Centro-Oeste', { ufs: ['DF', 'GO', 'MT', 'MS'] }], ['Sudeste', { ufs: ['ES', 'MG', 'RJ', 'SP'] }], ['Sul', { ufs: ['PR', 'RS', 'SC'] }],
];
let pageOff = 0, pageTotal = 0;
function applyPreset(p) {
  $('f').reset(); muniSel.clear(); renderMunis(); ufSel = new Set(p.ufs || []);
  for (const [k, [lo, hi]] of Object.entries(p.ranges || {})) { $(k + '_lo').value = lo; $(k + '_hi').value = hi; }
  for (const [id, vals] of Object.entries(p.groups || {})) for (const x of document.querySelectorAll(`#g_${id} input`)) x.checked = vals.includes(+x.value);
  schedule();
}
function requestPage() {
  const [sort, dir] = $('sort').value.split(':');
  worker.postMessage({ t: 'page', id: seq, sort: sort || null, dir, offset: pageOff, limit: PAGE });
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
  const bar = (abbr, x) => x === null ? `<div class="bar"><span>${abbr}</span><div></div><b>–</b></div>`
    : `<div class="bar"><span>${abbr}</span><div><i style="width:${x / 10}%;background:hsl(${Math.round(x * 0.13)} 70% 48%)"></i></div><b>${f1(x)}</b></div>`;
  const comps = r.n.slice(5).map((x, i) => x === null ? '' : `<small>C${i + 1}: ${x}</small>`).join(' ');
  return `<div class="cand"><div class="head"><b>Candidato ${r.id}</b><span>${r.muni || '—'} · ${r.uf || '—'}</span></div>` +
    `<div class="tags">${tags.filter(Boolean).map((t) => `<i>${t}</i>`).join('')}${warn.map((t) => `<i class="warn">${t}</i>`).join('')}</div>` +
    ['CN', 'CH', 'LC', 'MT'].map((a, k) => bar(a, r.n[k])).join('') +
    `<div class="red"><div><small>Redação</small><div class="bigscore">${r.n[4] === null ? '–' : r.n[4]}</div></div><div>${comps}</div></div></div>`;
}
function renderPage(m) {
  const avail = $('sort').value ? Math.min(m.total, 200) : m.total;
  $('cards').innerHTML = m.rows.length ? m.rows.map(card).join('') : '<p class="mut">Nenhum candidato com esses filtros.</p>';
  pageTotal = avail;
  $('pageinfo').textContent = avail ? `${fmt(pageOff + 1)}–${fmt(pageOff + m.rows.length)} de ${fmt(avail)}` : '';
  $('prev').disabled = pageOff === 0; $('next').disabled = pageOff + PAGE >= avail;
}
function renderStats(st) {
  $('statgrid').innerHTML = st.map((s, k) => {
    const label = SCORES[k][1];
    if (!s.n) return `<div class="stat"><h4>${label}</h4><p class="mut">Sem dados</p></div>`;
    const top = Math.max(...s.bins);
    const bars = s.bins.map((b, i) => `<i style="height:${Math.max(3, 100 * b / top)}%" title="${i * s.w}–${i * s.w + s.w - 1}: ${fmt(b)}"></i>`).join('');
    return `<div class="stat"><h4>${label}</h4><div class="mean">${f1(s.mean)}</div><div class="hist">${bars}</div>` +
      `<p>mediana ${s.med} • mín ${f1(s.min)} • máx ${f1(s.max)}<br>quartis ${s.p25}–${s.p75} • desvio ${f1(s.sd)}<br>${fmt(s.n)} notas</p></div>`;
  }).join('');
}

function buildFilters() {
  $('scores').innerHTML = SCORES.map(([k, label, max]) =>
    `<div><span>${label}</span><input type="number" id="${k}_lo" min="0" max="${max}" placeholder="0"><input type="number" id="${k}_hi" min="0" max="${max}" placeholder="${max}"></div>`).join('');
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
  for (const [k, , max] of SCORES) {
    const lo = +$(k + '_lo').value || 0, hv = $(k + '_hi').value, hi = hv === '' ? max : +hv;
    if (lo > 0 || hi < max) ranges[k] = [lo, hi];
  }
  for (const k of ['NU_SEQUENCIAL', 'CO_ESCOLA']) if ($(k).value !== '') ranges[k] = [+$(k).value, +$(k).value];
  for (const g of GROUPS) {
    const v = [...document.querySelectorAll(`#g_${g.id} input:checked`)].map((x) => +x.value);
    if (v.length) for (const k of g.keys) cats[k] = v;
  }
  return { ranges, cats, ufs: [...ufSel], muni: [...muniSel.keys()], metric: +$('metric').value };
}
function run() { worker.postMessage({ t: 'filter', id: ++seq, ...query() }); }
function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }

let cacheInfo = null, base = '';
const setStatus = (s) => { base = s; $('status').textContent = s; };
const showCache = () => { $('usecache').hidden = $('delcache').hidden = !cacheInfo; };
const busy = (txt) => { t0 = performance.now(); $('work').hidden = true; $('bar').hidden = false; $('bar').removeAttribute('value'); setStatus(txt); };

function initWorker() {
  worker = new Worker('worker.js');
  worker.onerror = (e) => { $('bar').hidden = true; setStatus('Erro ao iniciar o leitor: ' + (e.message || 'veja o console (F12)')); };
  worker.onmessage = ({ data: m }) => {
    if (m.t === 'progress') {
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
      renderStats(m.stats); renderMap(m);
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
$('presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applyPreset(PRESETS[+b.dataset.i][1]); });
$('sort').innerHTML = '<option value="">Ordem do arquivo</option>' + SCORES.flatMap(([k, l]) => [`<option value="${k}:desc">Maior ${l}</option>`, `<option value="${k}:asc">Menor ${l}</option>`]).join('');
$('sort').onchange = () => { pageOff = 0; requestPage(); };
$('prev').onclick = () => { pageOff = Math.max(0, pageOff - PAGE); requestPage(); };
$('next').onclick = () => { pageOff += PAGE; requestPage(); };
$('map').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const u = b.dataset.uf; ufSel.has(u) ? ufSel.delete(u) : ufSel.add(u); schedule(); });
$('metric').onchange = schedule;
$('file').onchange = (e) => e.target.files[0] && start(e.target.files[0]);
$('release').onclick = () => worker.postMessage({ t: 'release' });
$('usecache').onclick = () => { busy('Carregando dados salvos…'); worker.postMessage({ t: 'usecache' }); };
$('delcache').onclick = () => worker.postMessage({ t: 'clearcache' });
initWorker();
$('f').addEventListener('input', (e) => { if (e.target.id !== 'mq') schedule(); });
$('mq').addEventListener('input', suggest);
$('mq').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('sug').querySelector('button'); if (b) addMuni(+b.dataset.i); } });
$('sug').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) addMuni(+b.dataset.i); });
$('mchips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { muniSel.delete(+c.dataset.i); renderMunis(); schedule(); } });
$('clear').onclick = () => { $('f').reset(); muniSel.clear(); ufSel.clear(); renderMunis(); $('sug').innerHTML = ''; schedule(); };
