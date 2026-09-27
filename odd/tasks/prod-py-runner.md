# Feature: prod-py-runner

Replace the `.bat` entry point with a pure-Python runner and fix the prod
workbook ingestion break caused by the bank dropping Excel Table format.

## Problem

The bank changed three things at once and the prod deployment broke:

1. **Workbook moved** — `ControlPases.xlsx` now lands in
   `...\Team-Legacy - Coordinación\iTop` (was the parent folder).
2. **`uv` disabled** — the bank uninstalled/blocked `uv`. No `uv` invocation
   may remain anywhere in the runtime path.
3. **`.bat` execution blocked** — the corporate policy will refuse to run
   `run.bat`. Every entry point must become `.py`.

Plus the actual root cause of the pipeline failure, which is none of the
three above:

4. **Dirty `dimension` record** — the new export writes
   `<dimension ref="A1:AR596"/>` (44 columns) while the real data ends at
   `AH` (34 columns). `openpyxl` in `read_only=True` trusts that record and
   pads every row with `None` up to 44, so `map_headers` receives 10 empty
   headers and raises `HeaderDriftError`.

## Why this happened

With a real Excel Table (ListObject) present, Excel derives `<dimension>`
from the table ref and emits `<tableParts>`. Dropping the Table and
emitting a plain range let the bank's generator write a stale/oversized
dimension. The parser never depended on Table format — this is purely an
XML-record artifact, which is why the change went unnoticed until prod.

## Scope

In scope:

- Trim trailing empty header cells before strict header mapping.
- New `run.py` at repo root replacing `run.bat` as the entry point.
- Point the prod config instructivo at the `iTop` folder.
- Remove every `uv` reference from the runtime path, docs, and messages.
- Tests covering the dirty-dimension regression and the runner contract.

Out of scope:

- Recursive workbook discovery — the bank confirmed the `.xlsx` lands
  directly in `iTop`, so the non-recursive `glob` stays.
- Any change to parsing, normalization, schema, or frontend behavior.
- Deleting `run.bat` itself (kept as-is for reference; the bank simply
  cannot execute it anymore).

## Constraints

- No network, no downloads, no `uv`, at any point.
- `py` launcher + system Python with `openpyxl`/`tzdata`/`pytest` already
  installed is the only supported environment.
- Fail-fast on real header drift must be preserved: only *trailing* empty
  padding is tolerated.
- Logs carry counts/paths/error classes only, never row values.

## Second defect found during T1 (not in the original report)

Fixing the dirty `dimension` uncovered a second, independent bank regression
that the `HeaderDriftError` had been masking:

- `AF1` (column 32) ships `TIPO CAMBIO` — byte-identical to column 5. The
  34 headers resolve to only 33 distinct canonical keys, so `tipo_cambio2`
  was never populated and every row died on `SchemaError`.
- Evidence that this is an export typo, not a semantic removal: column 32
  is the exact position the pre-Table export used for `TIPO CAMBIO2`; the
  other 33 headers are unchanged in both spelling and position; 31 of the
  595 rows populate it with `Certificado` (18 Cambio Menor, 6 Cambio
  Estandar Automatizado, 4 Cambio Documentario, 3 Cambio Mayor); and every
  one of those 31 rows ALSO carries a primary `TIPO CAMBIO` value, so the
  column is a second classification, not a replacement.
- Data row count is 595, not 596 (`A1:AR596` includes the header row).

## Tasks

- [x] T1 Trim trailing empty header cells in `read_workbook` before
      `map_headers`, so a dirty `dimension` no longer fails the run.
- [x] T2 Add regression tests: dirty-dimension workbook ingests all rows;
      real (non-trailing) drift still raises `HeaderDriftError`.
- [x] T3 Add `run.py` mirroring the `run.bat` flow (config resolve, workbook
      guard, pipeline, bundle stage, bundle build, backend tests, optional
      node smoke) with a skip-tests escape hatch.
- [x] T4 Update `Config-Prod.txt` to the `iTop` input dir.
- [x] T5 Purge `uv` from `Comandos-Prod.txt`, the `parser_excel.py`
      import-error message, and the `test_pipeline.py` docstring.
- [x] T6 Update `README.md` rerun steps to the `run.py` entry point.
- [x] T7 Repair the duplicated `AF1` header via a single-position alias
      table, and add a strict duplicate-canonical-key guard in
      `map_headers` so this class of defect can never again surface as a
      misleading `SchemaError` two layers down.
- [x] T8 Make every entry point `.py`-only: `Install-Dependencias.py` no
      longer instructs `run.bat` and can no longer trigger a download,
      `run.bat` becomes a shim delegating to `run.py`, `.codegraph/`
      gitignored.

## Route

Delegated writer (single `general` agent) for T1–T8: eight files with
non-trivial edits, well past the 2-file inline threshold. The orchestrator
independently re-ran every verification and confirmed the writer's
duplicate-header finding, which contradicted the initial diagnosis.

## TDD

Mode: standard (tests authored alongside the change, not strict RED-first).
Source: no `strict_tdd` configured for this project; existing convention is
a checked-in pytest suite with synthetic fixtures.
Runner: `py -m pytest backend/tests -q`

## Acceptance criteria

1. `py run.py` on the bank workbook produces `workspace/output/triage.html`
   and `workspace/output/data.json` with a non-zero row count.
2. `py -m pytest backend/tests -q` passes.
3. `node scripts/smoke.mjs` passes (221 checks).
4. A workbook with an unknown header in any non-trailing position still
   fails non-zero with `HeaderDriftError` and writes no output.
5. No `uv` invocation remains in the runtime path or docs.
6. `Config-Prod.txt` points `input_dir` at the `iTop` folder.
7. A duplicated canonical key outside `POSITIONAL_HEADER_ALIASES` fails
   with `HeaderDriftError` naming both positions and both raw values.

## Applicable checks

- `py -m pytest backend/tests -q`
- `node scripts/smoke.mjs`
- `py backend/generar_data.py` against the real bank workbook
- `py run.py` (full flow, exit code observed)
- `py run.py --skip-tests`
- grep for `uv` and for `run.bat` user-facing instructions

## Progress

T1–T8 implemented and verified. Prod pipeline is green again: 595 rows,
34 canonical keys per row, no mislabeled data.

## Verification evidence

Independently re-run by the orchestrator (not taken on the writer's word):

- `py -m pytest backend/tests -q`: `24 passed`, exit 0.
- `py backend/generar_data.py` on the real bank workbook: exit 0.
- `py run.py`: all 4 stages, `[DONE]`, exit 0.
- `py run.py --skip-tests`: stages 3/4 skipped, exit 0.
- `node scripts/smoke.mjs`: `SMOKE_SHARE_DONE pass=221 fail=0`.
- `workspace/output/data.json`: `count=595`, `len(rows)=595`, every row has
  exactly 34 keys. `tipo_cambio2` distribution: 564 null + 31 `Certificado`.
  Rows whose primary `tipo_cambio` is `Certificado`: **0** — nothing
  mislabeled.
- grep: zero `uv` invocation patterns (`uv run|pip|tool|sync`, `py -m uv`,
  `where uv`, `astral.sh`). Remaining `run.bat` mentions are non-directive
  (`run.py` docstring, README note, this doc).
- `ruff check backend run.py`: **NOT RUN — ruff is not installed**, neither
  in PATH nor as a module. Verified `py -m ruff --version` fails with
  `No module named ruff`. The repo declares no lint config, so no
  line-length target exists. A dead `SAMPLE_WINDOW_FIN` import (F401) was
  found and removed.

## Work-unit commits

- `fix(parse): tolerate trailing empty header padding from dirty xlsx dimension`
- `fix(parse): repair duplicated TIPO CAMBIO header and guard duplicate keys`
- `feat(prod): add pure-Python run.py entry point (no .bat, no uv)`
- `chore(prod): make every entry point .py-only and drop dead uv/wheels refs`
- `docs(prod): repoint input dir to iTop and purge uv references`

## Next step

Push the branch, then on the bank PC: replace `config.yaml` with the
`Config-Prod.txt` block (now pointing at `iTop`) and run `py run.py`. Keep
`run.bat` until the first successful prod run is confirmed.

**Open item requiring bank confirmation:** the `AF1` → `tipo_cambio2`
positional alias is an evidence-backed inference about their export. It
should be confirmed with the bank, who can also fix the header at source
so the alias becomes unnecessary.
