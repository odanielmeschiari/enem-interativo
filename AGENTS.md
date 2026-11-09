# AGENTS.md — ENEM Microdata Explorer

Read this fully before touching anything. Keep it short, keep it simple.

## Goal
Offline, browser-based tool to filter the ENEM 2025 microdata (CSV, ~5M+ rows, 2.1 GB) and see results instantly. It is demoed at a university outreach fair (kids and high-school students watching, a technical presenter operating with keyboard and mouse). Deadline is fixed and tight: **ship the smallest thing that works, then polish.**

## Hard constraints
- **Offline only.** No CDN, no fetch to the internet, no analytics, no web fonts. Everything is local.
- **No dependencies, no build step.** Vanilla HTML + CSS + JS (ES2020). No npm, no frameworks, no chart libraries.
- **The dataset is never in the repo.** Add the data folder/CSV pattern to `.gitignore`. The user picks the file at startup (file picker, optional: remember the handle) and can change it later in settings.
- **Target machine:** Linux laptop, 8 GB RAM, no GPU, Chromium-based browser. Total tool memory should stay under ~1 GB.
- **Never keep the database open in the background.** Read the file once as a stream, close it, release the `File`/handle and every temporary buffer. Only compact in-memory columns remain. A "Release data" button must free them.
- **Language:** code, comments, commit messages, docs in **English**. User-facing UI text in **Brazilian Portuguese**.

## Data (semicolon-separated, header in first line, UTF-8; verify encoding and BOM)
Always resolve columns **by header name**, never by index. Empty fields are common (missing scores, no school). Ignore all other columns, especially the long text ones (`TX_RESPOSTAS_*`, `TX_GABARITO_*`) and the `*_AV1..AV4` columns.

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
- **Map:** shown when state filters are in use (always acceptable to show it). Version 1 is a **tile-grid map of the 27 UFs** (one square per state arranged roughly like Brazil): no geometry needed, fully offline, clickable multi-select. Each tile is colored by the chosen metric (count or mean score). If the user later provides a real SVG at `assets/brazil.svg` with one `<path id="SP">` per UF, swap it in without changing the data layer.
- **Statistics:** match count and share of total, mean, median, min, max, standard deviation per score, histogram per score (hand-drawn canvas or SVG), ranking of UFs.
- **Individual entries:** paginated cards/table of matching candidates, cleaned for humans: no raw codes or empty fields (show "—" or hide), rounded scores (1 decimal), labeled categories, score bars colored by range, municipality and UF as text. Make it eye-catching but light.
- **Presets:** a few one-click filters (e.g. "Nota 1000 na redação", "Maior nota de Matemática", "Escolas privadas urbanas") to make the demo smooth.

## Workflow rules
1. Work in tiny steps. Order: (1) file picker + streaming loader with progress, (2) filter loop + count, (3) filters UI, (4) stats and histograms, (5) tile map, (6) cleaned entries view, (7) presets and polish. Each step must leave a working app.
2. **Never rewrite whole files to change a few lines.**
3. **Deliver every change as a patch file** for `git apply` (e.g. `git diff > 0003-short-name.patch`, or `git format-patch` when asked). Check that it applies to the current state of the repo. Do not paste "replace the whole file" instructions.
4. **Commits are short**: one imperative line (≤ 60 chars), one logical change. Example: `Add tile-grid UF map`.
5. Prefer less code. No abstractions, classes or config systems that the demo does not need. No dead code, no TODO piles.
6. Test with the sample rows (first 10 lines of the CSV, kept as `sample/sample.csv`, small enough for git) and, when the user can, the full file. Report load time and filter time honestly.
7. If anything is ambiguous, ask one short question instead of guessing; do not invent data or code meanings.
