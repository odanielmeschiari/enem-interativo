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
let worker, seq = 0, timer, t0, munis = [], muniSel = new Map(), ufSel = new Set();

function buildFilters() {
  $('scores').innerHTML = SCORES.map(([k, label, max]) =>
    `<div><span>${label}</span><input type="number" id="${k}_lo" min="0" max="${max}" placeholder="0"><input type="number" id="${k}_hi" min="0" max="${max}" placeholder="${max}"></div>`).join('');
  $('groups').innerHTML = GROUPS.map((g) => `<h3>${g.title}</h3><div class="chips" id="g_${g.id}">` +
    g.opts.map(([v, l]) => `<label><input type="checkbox" value="${v}">${l}</label>`).join('') + '</div>').join('');
}
function buildUfs(list) {
  $('ufs').innerHTML = [...list].sort().map((u) => `<label><input type="checkbox" value="${u}">${u}</label>`).join('');
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
  return { ranges, cats, ufs: [...document.querySelectorAll('#ufs input:checked')].map((x) => x.value), muni: [...muniSel.keys()] };
}
function run() { worker.postMessage({ t: 'filter', id: ++seq, ...query() }); }
function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }

function start(file) {
  if (worker) worker.terminate();
  worker = new Worker('worker.js');
  worker.onerror = (e) => { $('bar').hidden = true; $('status').textContent = 'Erro ao iniciar o leitor: ' + (e.message || 'veja o console (F12)'); };
  worker.onmessage = ({ data: m }) => {
    if (m.t === 'progress') {
      $('bar').hidden = false; $('bar').value = m.read / m.size;
      $('status').textContent = `Lendo… ${Math.round(100 * m.read / m.size)}% • ${fmt(m.rows)} linhas • ${Math.round((performance.now() - t0) / 1000)} s`;
    } else if (m.t === 'loaded') {
      munis = m.munis.map(([c, n], i) => ({ key: norm(n), label: `${n} (${UF_BY_IBGE[Math.floor(c / 100000)] || '?'})` }));
      muniSel.clear(); renderMunis(); buildUfs(m.ufs);
      $('bar').hidden = true; $('work').hidden = false; $('release').hidden = false;
      $('status').textContent = `${fmt(m.rows)} linhas carregadas em ${(m.ms / 1000).toFixed(1)} s.`;
      run();
    } else if (m.t === 'result') {
      if (m.id !== seq) return;
      $('count').textContent = fmt(m.count);
      $('pct').textContent = `${(100 * m.count / m.total).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do total`;
      $('ms').textContent = `${fmt(m.total)} no total • filtrado em ${m.ms} ms`;
    } else if (m.t === 'released') {
      $('work').hidden = true; $('release').hidden = true; $('file').value = '';
      $('status').textContent = 'Dados liberados da memória.';
    } else if (m.t === 'error') {
      $('bar').hidden = true; $('status').textContent = 'Erro: ' + m.msg;
    }
  };
  t0 = performance.now();
  $('work').hidden = true; $('bar').hidden = false; $('bar').value = 0; $('status').textContent = 'Lendo… 0%';
  worker.postMessage({ t: 'load', file }); // the worker reads the stream once and drops the file
}

buildFilters();
$('file').onchange = (e) => e.target.files[0] && start(e.target.files[0]);
$('release').onclick = () => worker.postMessage({ t: 'release' });
$('f').addEventListener('input', (e) => { if (e.target.id !== 'mq') schedule(); });
$('mq').addEventListener('input', suggest);
$('mq').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('sug').querySelector('button'); if (b) addMuni(+b.dataset.i); } });
$('sug').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) addMuni(+b.dataset.i); });
$('mchips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { muniSel.delete(+c.dataset.i); renderMunis(); schedule(); } });
$('clear').onclick = () => { $('f').reset(); muniSel.clear(); renderMunis(); $('sug').innerHTML = ''; schedule(); };
