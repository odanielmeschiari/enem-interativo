# AGENTS.md — ENEM Microdata Explorer

Read this fully before touching anything. Keep it short, keep it simple.

## Goal
Offline, browser-based tool to filter the ENEM 2025 microdata (CSV, ~5M+ rows, 2.1 GB) and see results instantly. It is demoed at a university outreach fair (kids and high-school students watching, a technical presenter operating with keyboard and mouse). Deadline is fixed and tight: **ship the smallest thing that works, then polish.**

## Hard constraints
- **Offline only.** No CDN, no fetch to the internet, no analytics, no web fonts. Everything is local.
- **No dependencies, no build step.** Vanilla HTML + CSS + JS (ES2020). No npm, no frameworks, no chart libraries.
- **The dataset is never in the repo.** Add the data folder/CSV pattern to `.gitignore`. The user picks the file at startup (file picker, optional: remember the handle) and can change it later in settings.
- **Target machine:** Linux laptop, 8 GB RAM, no GPU, Chromium-based browser. Total tool memory should stay under ~1 GB.
- **Exception (approved):** when the user loads the official ZIP, the decompressed `RESULTADOS` CSV is kept as a temporary file in OPFS (disk, never memory) only so candidate details can read one row by byte offset instantly; "Apagar dados" deletes it. No other raw CSV is ever stored.
- **Participant profile (ZIP only):** `PARTICIPANTES_*.csv` is read after `RESULTADOS` into one `Uint8Array` per categorical column (`TP_FAIXA_ETARIA`, `TP_SEXO`, `TP_ESTADO_CIVIL`, `TP_COR_RACA`, `TP_NACIONALIDADE`, `TP_ST_CONCLUSAO`, `TP_ANO_CONCLUIU`, `TP_ENSINO`, `IN_TREINEIRO`, `SG_UF_PROVA`, `Q001..Q0xx`) plus the exam municipality. **It cannot be joined with `RESULTADOS`:** the dictionary says `NU_SEQUENCIAL` is only a row number, not `NU_INSCRICAO`. Treat them as two separate datasets. Category labels come from the dictionary `.xlsx` inside the ZIP (sheet `PARTICIPANTES_*`); a code the dictionary does not list keeps no label. Never invent one.
- **Never keep the database open in the background.** Read the file once as a stream, close it, release the `File`/handle and every temporary buffer. Only compact in-memory columns remain. A "Release data" button must free them.
- **Language:** code, comments, commit messages, docs in **English**. User-facing UI text in **Brazilian Portuguese**.

## Data (semicolon-separated, header in first line, UTF-8; verify encoding and BOM)
Always resolve columns **by header name**, never by index. Empty fields are common (missing scores, no school). Ignore all other columns, especially the long text ones (`TX_RESPOSTAS_*`, `TX_GABARITO_*`) and the `*_AV1..AV4` columns. Exceptions: `TX_RESPOSTAS_*` / `TX_GABARITO_*` are read during the load only to count correct answers, and they (plus the `*_AV1..AV4` scores) are re-read for a single row when a candidate is clicked; none of them is kept in memory.

Keep only:
- Ids: `NU_SEQUENCIAL`, `CO_ESCOLA`, `CO_MUNICIPIO_ESC`, `CO_MUNICIPIO_PROVA`
- Names: `NO_MUNICIPIO_ESC`, `SG_UF_ESC`, `NO_MUNICIPIO_PROVA`, `SG_UF_PROVA`
- Categorical filters: `TP_DEPENDENCIA_ADM_ESC`, `TP_LOCALIZACAO_ESC`, `TP_PRESENCA_CN/CH/LC/MT`, `TP_LINGUA`, `TP_STATUS_REDACAO`
- Scores: `NU_NOTA_CN`, `NU_NOTA_CH`, `NU_NOTA_LC`, `NU_NOTA_MT`, `NU_NOTA_COMP1..5`, `NU_NOTA_REDACAO`

Notes:
- **The map and location filters use the exam location (`*_PROVA`) only.** School location is mostly empty; ignore it for the map.
- Absent candidates have empty scores. Treat empty as "missing" (`NaN`), never as 0. Averages and histograms skip missing values.
- Category code meanings (e.g. administrative dependency 1–4, location 1–2, presence 0–2) come from the ENEM data dictionary. Ask the user for the dictionary if unsure instead of guessing.

## Architecture (follow unless you have a strong reason)
- **Columnar typed arrays**, one per kept column, filled by a **streaming parser in a Web Worker**: `file.stream()` → manual byte-level parsing of `Uint8Array` chunks (no `split`, no per-row objects, no `TextDecoder` per field). Skip unwanted fields by scanning to the next `;`.
  - Scores: `Float32Array` (NaN = missing). Small categories and UF: `Uint8Array`. Municipality: dictionary of unique `code → name`, rows store a `Uint16Array` index. Ids: `Int32Array`.
- **Filtering = one tight loop** over the arrays with simple comparisons, producing in the same pass: match count, per-UF aggregates (count and mean of the selected score), histograms, and the first N matching row indices. Aim for tens of milliseconds over 5M rows. Do not allocate inside the loop.
- **Median/percentiles from histograms** (fixed bins), never by sorting millions of values.
- Run filtering in the worker too, so the UI never freezes. Debounce sliders and inputs; cancel stale runs.
- **Loading** takes a while: show a progress bar (bytes read / file size). The presenter will load the data before the demo; filtering afterwards must be instant. Optional later step: cache the compact columns locally (OPFS/IndexedDB), never the raw CSV.
- Serving: `python3 -m http.server` from the repo root (provide a `run.sh`) or open `index.html` directly. Keep the file layout flat: `index.html`, `app.js`, `worker.js`, `style.css`, `assets/`.

## UI requirements
- Dark, clean, large readable type, projector-friendly. Everything on one screen.
- **Filters panel:** score ranges for all 4 areas + essay + competencies 1–5 (dual sliders with number inputs), presence, language, administrative dependency, school location, essay status, `CO_ESCOLA` / `NU_SEQUENCIAL` exact search, **municipality search** (accent-insensitive autocomplete, multi-select). All filters combine (AND). "Clear all" button.
- **Map:** shown when state filters are in use (always acceptable to show it). The map is the bundled SVG `assets/brazil.svg` (Simplemaps, free for commercial use, attribution kept in the file): one `<path id="BRxx">` per UF plus a `label_points` group with label positions. It is loaded with `fetch` and inlined, so the app must be served over http (`./run.sh`). Clickable multi-select; each UF is colored by the chosen metric (count or mean score).
- **Statistics:** match count and share of total, mean, median, min, max, standard deviation per score, histogram per score (hand-drawn canvas or SVG), ranking of UFs.
- **Individual entries:** paginated cards/table of matching candidates, cleaned for humans: no raw codes or empty fields (show "—" or hide), rounded scores (1 decimal), labeled categories, score bars colored by range, municipality and UF as text. Make it eye-catching but light.
- **Presets:** a few one-click filters (e.g. "Nota 1000 na redação", "Maior nota de Matemática", "Escolas privadas urbanas") to make the demo smooth.

## Workflow rules for AI Agents
1. **Scope and File Selection:** 
   - **Do NOT read the entire codebase or explore unnecessarily before starting.**
   - First, understand the user's specific request and intent.
   - Read `AGENTS.md` to understand constraints and architecture.
   - Identify and open **only** the specific file(s) required for the requested task.
2. **Direct Modification:** 
   - Apply changes directly to the codebase (no patch files needed).
3. **Commit & Steps:** Keep changes minimal, precise, and consistent with the existing style.
