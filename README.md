# ENEM Microdata Explorer

Offline web tool to filter the ENEM 2025 microdata (CSV, millions of rows) with instant results.
Runs entirely in the browser; nothing leaves the machine. The dataset is **not** part of this repo.

## Requirements
- Linux, `python3` (only used as a tiny local file server)
- A Chromium-based browser (Chrome, Chromium, Edge, Brave)
- The ENEM 2025 CSV file (about 2 GB). Free RAM: at least 2 GB.

## Run
```
./run.sh
```
The browser opens at http://localhost:8000. Then:
1. Click the file field and select the ENEM CSV (the file, not the folder).
2. Wait for the progress bar (the data is read once, then the file is closed).
3. Use the filters; the count updates instantly.
4. "Liberar dados da memória" frees the data; reload the page to start over.

Stop the server with `Ctrl+C` in the terminal. If port 8000 is busy, edit `run.sh`.
After the first load the compact columns are saved in the browser (IndexedDB), so next time the app loads them in a few seconds without picking the file again. Use "Apagar dados salvos" to delete the copy. The saved copy is local to this browser profile and port (localhost:8000); keep the same browser and port.
Tip: load the data a few minutes before presenting.

## Test without a browser
```
node test/smoke.js                 # uses sample/sample.csv
node test/smoke.js /path/to/enem.csv
```

## Layout
- `index.html`, `style.css`, `app.js`: UI (Portuguese)
- `worker.js`: streaming CSV parser and filter loop (Web Worker)
- `sample/sample.csv`: tiny fake sample for tests
- `AGENTS.md`: rules for AI agents working on this repo
- Changes are delivered as patch files: `git apply 000N-name.patch`
