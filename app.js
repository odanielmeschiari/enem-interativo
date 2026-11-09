'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString('pt-BR');
let worker, seq = 0, timer, t0;

function start(file) {
  if (worker) worker.terminate();
  worker = new Worker('worker.js');
  worker.onmessage = ({ data: m }) => {
    if (m.t === 'progress') {
      $('bar').hidden = false; $('bar').value = m.read / m.size;
      $('status').textContent = `Lendo… ${Math.round(100 * m.read / m.size)}% • ${fmt(m.rows)} linhas • ${Math.round((performance.now() - t0) / 1000)} s`;
    } else if (m.t === 'loaded') {
      $('bar').hidden = true; $('work').hidden = false; $('release').hidden = false;
      $('status').textContent = `${fmt(m.rows)} linhas carregadas em ${(m.ms / 1000).toFixed(1)} s.`;
      run();
    } else if (m.t === 'result') {
      if (m.id !== seq) return;
      $('count').textContent = fmt(m.count);
      $('ms').textContent = `${fmt(m.total)} no total • filtrado em ${m.ms} ms`;
    } else if (m.t === 'released') {
      $('work').hidden = true; $('release').hidden = true; $('file').value = '';
      $('status').textContent = 'Dados liberados da memória.';
    } else if (m.t === 'error') {
      $('bar').hidden = true; $('status').textContent = 'Erro: ' + m.msg;
    }
  };
  worker.onerror = (e) => { $('bar').hidden = true; $('status').textContent = 'Erro ao iniciar o leitor: ' + (e.message || 'veja o console (F12)'); };
  t0 = performance.now();
  $('work').hidden = true; $('bar').hidden = false; $('bar').value = 0; $('status').textContent = 'Lendo… 0%';
  worker.postMessage({ t: 'load', file }); // the worker reads the stream once and drops the file
}
function run() {
  const ranges = {};
  const red = +$('minRed').value, mt = +$('minMt').value;
  if (red > 0) ranges.NU_NOTA_REDACAO = [red, 1000];
  if (mt > 0) ranges.NU_NOTA_MT = [mt, 1000];
  worker.postMessage({ t: 'filter', id: ++seq, ranges });
}
$('file').onchange = (e) => e.target.files[0] && start(e.target.files[0]);
$('release').onclick = () => worker.postMessage({ t: 'release' });
for (const id of ['minRed', 'minMt']) $(id).oninput = () => { clearTimeout(timer); timer = setTimeout(run, 120); };
