# Feature: hide-rechazados

Hide rows with `ESTADO ACTUAL = Rechazado` by default so they don't show
at first glance, with a visible way to show them again.

## Problem

Rejected changes (`estado_actual = Rechazado`) render mixed with the
operational list on first load. The user wants them filtered out by
default.

## Why this approach

A default-on exclusion with an explicit opt-in checkbox (instead of
deleting rows or a backend change) keeps the data intact, stays shareable
via URL, and degrades safely: rows missing `estado_actual` (old payloads,
synthetic fixtures) always pass.

## Scope

In scope:

- Toolbar checkbox `Mostrar rechazados` (unchecked = hidden, the default).
- `search.js` exclusion logic (case-insensitive, trimmed, exact match).
- Share URL round-trip of the flag + active-filter chip.
- Teams summary header reflecting the exclusion (CSV already exports
  only visible rows via `getVisible()`).

Out of scope:

- Any backend change (parser, schema, pipeline, `data.json` shape).
- Any change to parsing, normalization, or badge rendering.
- Deleting or recoloring rows; `app.js` card/drawer logic untouched
  (the `Show all changes` empty-state reset still bypasses filters and
  shows everything, as its label promises).

## Constraints

- No network, no new dependencies, no `uv`.
- Only rows whose normalized `estado_actual` is exactly `rechazado`
  are excluded; missing/blank/other states always pass.
- `Limpiar filtros` returns to the default (hidden).
- Logs carry counts only, never row values (production-data rule).

## Tasks

- [x] T1 Toolbar checkbox in `frontend/index.html` (`id="f-show-rejected"`,
      unchecked by default, Spanish label + aria-label, inside `.filters`
      after the `#f-tipo` select).
- [x] T2 Exclusion in `frontend/assets/js/search.js`: `getCriteria`
      reads the checkbox, `matchesFilters` drops exact-`rechazado` rows
      unless shown, `resetFilters` restores unchecked, `init` wires the
      `change` event to `applyFilters`.
- [x] T3 Share state in `frontend/assets/js/share.js`: `buildParams`
      emits the flag only when showing (default-hide keeps URLs clean),
      `parseParams`/`hasPending`/`restoreOnce` round-trip it,
      `collectChips`/`removeChip` handle its chip.
- [x] T4 Teams header in `frontend/assets/js/export.js`: `headerLines`
      names the exclusion when active so `Sin filtros (vista completa)`
      is never shown while rechazados are hidden.

## Route

Delegated writer (single `general` agent): 4 frontend files, past the
2-file inline threshold. Route: delegated direct. No SDD artifacts.

## TDD

Mode: standard (tests alongside the change, not strict RED-first).
Source: no `strict_tdd` configured; existing convention is checked-in
pytest + node smoke harness.
Runner(s): `py -m pytest backend/tests -q`, `node scripts/smoke.mjs`.

## Acceptance criteria

1. Fresh load hides every row with `estado_actual = Rechazado`
   (any case/whitespace); all other rows show.
2. Checking `Mostrar rechazados` shows them; unchecking hides them.
3. `Limpiar filtros` returns to hidden.
4. A copied link with the flag restores the shown state on open.
5. Teams summary names the exclusion; CSV contains only visible rows.
6. `node scripts/smoke.mjs` passes (221 checks, or more if extended);
   `py -m pytest backend/tests -q` passes (24 tests).
7. Rows without `estado_actual` still show.

## Applicable checks

- `py -m pytest backend/tests -q`
- `node scripts/smoke.mjs`
- `py run.py --skip-tests` (bundle rebuild against real workbook)
- grep for stale `run.bat`/`uv` user-facing instructions (must stay zero)

## Progress

T1–T4 implemented by one delegated writer and gate-checked by the
orchestrator (diff read back hunk by hunk: no drift, no hallucination).

## Verification evidence

Writer run + orchestrator spot re-run (independent):

- `py -m pytest backend/tests -q`: `24 passed` (backend untouched).
- `node scripts/smoke.mjs`: `pass=223 fail=0` (baseline 221 + 2 new
  T4 checks pinning `• Rechazados: ocultos`).
- Throwaway probes (uncommitted): hide `[false,false,true,true,true]`
  for Rechazado/`  RECHAZADO `/Aprobado/missing/blank; show all-true;
  `buildParams` `""` vs `"mostrar_rechazados=1"`; parse first-wins;
  tolerant non-`1` → false; `resetFilters` unchecks.
- `git grep run\.bat` over runtime files: empty. No `uv` added.
- `py run.py`: not run (rewrites outputs); bundle unaffected
  (no bundle-input shape change).

## Work-unit commits

- `913f4b8` feat(frontend): hide rechazados by default with opt-in
  checkbox (6 files, +79/−16, not pushed).

Plus this doc commit (below). Branch first: created
`feature/hide-rechazados-default` off default `chore/py-m-uv-prod`
before the first write and committed there (Conventional Commits,
no AI attribution).
Push/PR stay the user's decision under ordinary repository policy.

## Native review outcome (RDD)

Not run for this candidate: small frontend-only slice on an unpushed
feature branch; functional proof above is the verification of record.
Previous session's native review defect (`gentle-ai#4655`,
receipt unavailable) is on record in `odd/tasks/prod-py-runner.md`.

## Next step

Eyeball the toolbar checkbox in a browser, then push the feature
branch / open a PR when ready.
