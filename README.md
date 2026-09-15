# Change Triage MVP

Static triage portal: a Python pipeline converts `ControlPases.xlsx` into
`workspace/output/data.json`, and a vanilla HTML/CSS/JS SPA serves instant
search, incident-overlap query, a 6-group detail drawer, and CSV/Teams
exports from that JSON. No framework, no backend runtime.

## Pipeline rerun

1. Stage the workbook: copy `ControlPases*.xlsx` into `workspace/input/`.
2. Run (dependencies resolve via uv; Python ships without them):
   `uv run --with openpyxl python backend/generar_data.py`
3. Output: `workspace/output/data.json` (`{generated_at, count, rows[]}`).
   Dates are America/Lima ISO (`-05:00`); nulls are preserved.
   The run fails non-zero on header drift or bad dates and writes nothing.

## SPA serve

Serve the repo root (the app resolves `../workspace/output/data.json`
first, then co-located `./data.json` / `./data/data.json`):

`python3 -m http.server 8000` then open `/frontend/`.

## Tests

- Backend suite (synthetic rows only, incl. a null-window row):
  `uv run --with pytest --with openpyxl pytest backend/tests`
- Frontend smoke (real `search.js`/`export.js` on synthetic rows):
  `node scripts/smoke.mjs`

## E2E checklist (task 4.2 — DEFERRED, no browser in this environment)

> WARNING: never executed in a real browser here (no Chromium/Firefox or
> Playwright in this environment). Run before final accept.

1. Serve `workspace/output`, open the SPA, run a Ticket query (<10s).
2. Open a row: drawer shows 6 groups; close returns focus.
3. Set an incident datetime: overlapping rows flag, null-window rows never do.
4. CSV download matches the filtered set; Teams copy pastes one line per row.
5. SharePoint bundle check: size, JSON MIME, relative paths, cache refresh.

## SharePoint publish

Upload `frontend/` plus `workspace/output/data.json` co-located as
`frontend/data/data.json` (or `frontend/data.json`); keep relative paths.

> WARNING: SharePoint static-hosting limits (folder size, JSON MIME type,
> cache invalidation) are UNVALIDATED — confirm on first publish (design
> open question; verify-report W-item carried).

## Rollback

Keep the prior `data.json` + frontend bundle; republish the previous
SharePoint version. The pipeline makes no production writes.

## Production-data rule

Logs carry counts/errors only — never row values. `*.xlsx`, `workspace`
outputs, logs, and cache are gitignored; fixtures are synthetic.
