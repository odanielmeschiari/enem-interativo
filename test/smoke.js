// Run: node test/smoke.js [file.csv]  — loads the CSV with worker.js and runs a few filters.
const fs = require('fs'), path = require('path');
const out = []; let waiting = null;
global.self = {}; global.postMessage = (m) => { if (m.t === 'progress') return; if (waiting) waiting(m); out.push(m); };
require('../worker.js');
const send = (d) => new Promise((r) => { waiting = r; self.onmessage({ data: d }); });
(async () => {
  const f = process.argv[2] || path.join(__dirname, '../sample/sample.csv');
  const file = new File([fs.readFileSync(f)], 'x.csv');
  console.log(await send({ t: 'load', file }));
  const q = async (x) => { const r = await send({ t: 'filter', ...x }); console.log(JSON.stringify(x), '->', r.count, '/', r.total, r.ms + 'ms', r.perUf.join(',')); return r; };
  await q({});
  await q({ ranges: { NU_NOTA_REDACAO: [800, 1000] } });
  await q({ ranges: { NU_NOTA_MT: [500, 1000] }, ufs: ['SP', 'RJ'] });
  await q({ cats: { TP_PRESENCA_MT: [1], TP_LINGUA: [1] } });
  await q({ ranges: { NU_NOTA_MT: [0, 1000] } }); // excludes absent (NaN)
})();
