# ODD Feature: Source freshness timestamp in the status bar

## Objective
The status bar must show the **source workbook's** date instead of the pipeline run time, so viewers can tell whether the data they are looking at is actually updated.

## Problem
`app.js` renders `data.json → generated_at`, which is `datetime.now(Lima)` at pipeline run time (`schema.py:52`). Rebuilding the SPA without a new workbook reports "Actualizado: <now>", which is false confidence: the number describes the build, not the data.

Evidence:
- `workspace/input/ControlPases.xlsx` filesystem mtime: `2026-09-16 17:59:20 -05:00`
- Workbook internal `docProps/core.xml` `dcterms:modified`: `2026-09-16T22:55:15Z` → Lima `2026-09-16T17:55:15-05:00`
- `data.json.generated_at`: pipeline run time `2026-09-16T18:10` (bundle mtime `Sep 16 18:10`)

## Why
Trust signal. The header exists so a viewer knows the view is fresh; today it measures the wrong event.

## Scope
- In: `backend/parser_excel.py` (`RawTable` + `read_workbook` expose workbook metadata), `backend/generar_data.py` (resolve source timestamp + fallback), `backend/schema.py` (`build_payload` accepts and serializes source fields), `frontend/assets/js/app.js` (header render + meta), `backend/bundle_single.py` (contract message text), `backend/tests/test_pipeline.py` + `backend/tests/fixtures.py`, `README.md`.
- Out: row normalization, overlap/filter logic, timezone wall-string contract, `generated_at` semantics (kept as build provenance), drawer/export.

## Constraints
- `source_modified_at` is emitted as Lima ISO-8601 with `-05:00` offset (same shape as row dates) so the frontend `toLimaWall` slice keeps working — no new date parsing in the browser.
- Precedence: workbook internal `properties.modified` (survives copy/upload/zip) → fallback to filesystem `st_mtime`. Precedence is resolved in one place (`generar_data.py`) and logged; the contract stays lean (2 new fields, no provenance field).
- Backward compatible: a `data.json` without the new fields must still render (fallback to `generated_at`).
- openpyxl returns `properties.modified` as a **naive UTC** datetime — must be tagged `timezone.utc` before `.astimezone(LIMA_TZ)`. Verified empirically: `2026-09-16 22:55:15` → `2026-09-16T17:55:15-05:00`.
- Tests are synthetic only — never commit production rows.
- Advisory-only: ~400 authored changed lines per task is a planning guide, not a cap; no artificial splits, no cosmetic line savings, no omitted tests.

## TDD
- Mode: OFF (no explicit project config; existing tests do not enable it). Source: repo convention.
- Runner: `uv run --with pytest --with openpyxl --with tzdata pytest backend/tests` (plain `python3` has no pytest/openpyxl).
- Frontend checks: `node --check` + node harness reading `workspace/output/data.json`; browser load stays a manual step for the user.

## Authorized scope
Implementation authorized by explicit user request. Local only: no remote mutation, no push, no PR.

## Tasks
- [x] S1 — Backend contract: `RawTable.source_modified_utc`, `build_payload(rows, source_file, source_modified_at)`, precedencia internal→mtime en `resolve_source_modified`. Verificado: 12 passed.
- [x] S2 — Tests actualizados + 5 nuevos (Lima ISO, backward-compat, precedencia, fallback mtime, naive→UTC).
- [x] S3 — Frontend: `app.js` meta gains `sourceModifiedAt`/`sourceFile`; header shows source date, `generated_at` moves to the `title` tooltip; graceful fallback for old payloads.
- [x] S4 — `bundle_single.py` contract message + `README.md` contract line; regenerate `workspace/output/data.json` and `triage.html` and verify the rendered value.

## Acceptance
- Header shows the workbook's date (`16/09/2026 17:55 (Lima)` for the current source), not the build time.
- Build time still discoverable via tooltip.
- Old `data.json` without the new fields renders without breaking.
- `data.json` remains valid for the SPA and the single-file bundle.

## Applicable checks (per task)
- `uv run --with pytest --with openpyxl --with tzdata pytest backend/tests`
- `uv run --with openpyxl --with tzdata python3 -m backend.generar_data`
- `uv run --with tzdata python3 -m backend.bundle_single`
- `node --check frontend/assets/js/app.js` + node harness asserting the header string
- Manual browser check (user): status bar reads the source date.

## Progress
- 2026-09-16: exploration complete (parser/schema/config/generar_data/bundle_single/app.js/search.js/tests/README + empirical openpyxl property check). Doc created, 4 tasks. No writes yet.
- 2026-09-22: S1/S2 verified in tree (12 passed); S3/S4 found already implemented in working tree (app.js fmtUpdated+provenanceTitle+fallback, bundle_single contract, README lines 15-18, data.json + triage.html regenerated 11:58). Route: delegated-direct verification only, no new writer needed (trigger evidence: code present, only close-out required).

## Verification evidence
- `uv run --with pytest --with openpyxl --with tzdata pytest backend/tests`: 12 passed.
- `node --check frontend/assets/js/app.js`: syntax OK.
- Node harness: header `🕒 22 Sep · 11:58` from source_modified_at; legacy payload falls back to build time; tooltip `Fuente: ControlPases.xlsx · Build: 22/09/2026 11:58 (Lima)`.
- `workspace/output/data.json`: keys {count, generated_at, rows, source_file, source_modified_at}, source `2026-09-22T11:58:23-05:00` (internal 16:58:23Z, provenance internal), build `2026-09-22T11:58:38-05:00`.
- `workspace/output/triage.html`: contains TRIAGE_DATA with source_modified_at + inlined fmtUpdated.

## Next step
- Backend unit committed as `60e574d` on `chore/triage-single-file`. Frontend S3 code (app.js header slots) rides on compact-layout C1 + index.html/css — stays uncommitted as its own unit with its ODD docs.
