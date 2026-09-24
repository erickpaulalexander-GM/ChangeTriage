# Feature: py-m-uv-prod

## Objective
Cambiar todas las invocaciones `uv` a `py -m uv` para la PC del banco (prod).

## Problem
En prod (Windows banco) `uv.exe` no está en PATH; `uv` como módulo Python vía `py -m uv` sí funciona.

## Why
`run.bat` e `Install-Dependencias.ps1` fallan en prod con `[ERROR] 'uv' not found`.

## Scope
- `run.bat` (7 invocaciones: where/check + 4x `uv run python -c` + pipeline + bundle + tests)
- `Install-Dependencias.ps1` (check `Test-Cmd "uv"` + `uv --version` + install)
- Docs/comentarios: `README.md` (2x), `backend/parser_excel.py:20`, `backend/tests/test_pipeline.py:5`

## Constraints
- Solo Windows prod usa `py` launcher; no cambiar lógica del pipeline.
- `irm https://astral.sh/uv/install.ps1` se mantiene como fallback solo si `py -m uv` tampoco existe (documentado en T2).
- No tocar `config.yaml`, rutas input/output ni bundle.

## Authorized scope
Pedido explícito del usuario: "hay q cambiar todo para que use uv por py -m uv". Cubre los 5 archivos de arriba, nada más.

## Acceptance criteria
- `grep -Rn` no deja `uv run` / `where uv` / `Test-Cmd "uv"` con `uv` pelado (se permite `astral.sh/uv`, `install.ps1`, historial).
- `run.bat` usa `py -m uv` en check + las 7 invocaciones.
- `Install-Dependencias.ps1` chequea `py -m uv --version` e instala vía `py -m pip install uv` o deja fallback documentado.
- Readback de los 5 archivos OK.

## Applicable checks
- `grep -Rn "uv"` de verificación + readback visual.
- Sin pytest (cambio mecánico, sin lógica). TDD mode: unknown (sin registro `sdd-init/changetriage`); se usan checks funcionales ordinarios.

## Delivery strategy
`ask-on-risk` (default). Forecast: ~15 líneas autoradas, muy bajo 400. Sin chained PR.

## Route declaration (por tarea)
- T1 run.bat: inline (1 archivo mecánico ya mapeado; delegation intentada, transporte `task` no disponible en este entorno free-tier).
- T2 Install-Dependencias.ps1: inline (mismo motivo).
- T3 docs/comments: inline (3 edits mecánicos ya leídos).

## Checklist
- [x] T1 run.bat -> `py -m uv` (check + 7 invocaciones)
- [x] T2 Install-Dependencias.ps1 -> check/install vía `py -m uv`
- [x] T3 docs/comments (README, parser_excel.py, test_pipeline.py)
- [x] Verificación final grep + readback + work-unit commit(s)

## Progress
- 2026-09-24: doc creado, mapa completo (21 matches). T1-T3 implementados inline.
- Verificación: grep 33 matches, todos `py -m uv` o prosa/URL (sin `uv run` pelado, sin `where uv`, sin `Test-Cmd "uv"`); readback run.bat:1-23 + ps1:27-39 OK; diff 5 files +26/-21.
- Engram mirror: pendiente (mem_save falló por múltiples sesiones runtime activas; reintentar al cierre).
- Next: commit work-unit + cierre.
- Work-unit commit: b1be862 chore(prod): use py -m uv instead of uv binary (6 files, +79/-21).
