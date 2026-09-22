# ODD Feature: UX Polish v3 — Barra temporal compacta

## Objective
Compactar Ventana de implementación a barra temporal operativa (-30/40% altura) + formato premium tarjeta `Mar 14 Sep · 00:00–00:30`, manteniendo drawer largo.

## Problem
Módulo actual con 2 tarjetas grandes, triple capa borde-sobre-borde, placeholders `Seleccionar día` / `--:--` nativo, presets visualmente separados, baseline Ticket/App/Tipo vs Ventana divergente.

## Why
Herramienta operativa legible: ojo distingue día + ventana sin procesar fechas repetidas. No tocar filtrado ni pipeline.

## Scope
- In: `frontend/index.html` (60-96, 42-59, tarjeta, drawer ids), `frontend/assets/css/app.css` (196-359, 134-160, temas, responsive), `frontend/assets/js/daypick.js` (deriveDays/formatDay/syncButton/notify), `search.js` (parseWindowBound/matchesWindow/getCriteria/reset), `presets.js` (setWindow/limaToday/windowBounds), `app.js` (windowLabel/opbar), `drawer.js` (formatDate intacto), `export.js` (solo si se decide Teams).
- Out: lógica solapamiento, timezone wall-string Lima, backend parser/normalizador, cambio de contratos datos.

## Constraints
- Mantener hidden `YYYY-MM-DD` + eventos `input`/`change` + `parseWindowBound` (vacío=Día completo).
- Todo comparación en wall-string, weekday solo vía `weekdayShort`/`limaToday` auditados. Nada de `new Date` naive.
- Solo vars CSS (`--bg/--surface/--border/...`), sin hardcode. Preservar `focus-within`, `:focus-visible`, `role=listbox/option`, `aria-expanded/controls/pressed/labelledby`, Escape/flechas/Enter.
- Responsive 1100px/640px sin scroll horizontal. Light + Dark Comfort.
- Heurística advisory-only: ~400 authored changed lines por task como guía, no cap, no split artificial, no borrar espacios/comentarios, no omitir tests.

## TDD
- Mode: OFF. Source: sin config explícita (tests presentes no habilitan TDD). Runner: `pytest backend/tests/test_pipeline.py` + carga manual `frontend/index.html` con `data.json` + checklist keyboard/screen.
- Forward a cada delegación: TDD OFF, ordinary functional checks.

## Authorized scope
Exploración read-only completa. Implementación autorizada por pedido explícito UX Polish v3 + premium. Sin mutación remota, sin push/PR sin orden.

## Tasks
- [x] T1 — Formato corto tarjeta: `TriageDaypick.formatWindowShort` en daypick.js + `app.js:windowLabel` solo tarjeta. Drawer/export intactos. Verificado node: Lun 14 Sep · 00:00–00:30.
- [x] T2 — Barra compacta HTML+CSS lista (-39% estimado, un contenedor, sr-only, presets integrados, ids intactos).
- [x] T3 — Baseline misma fila desktop (grid start, 1fr 1fr 0.7fr 2.9fr, parche #f-tipo eliminado).
- [x] T4 — Horas overlay visual 00:00/23:59 (value vacío=Día completo preserved).
- [x] T5 — Presets compactos integrados (solo CSS, aria-pressed + N días intactos).
- [x] T6 — A11y/regression pass (11 checks, 1 fix Enter/Space daypick keyboard).
- [ ] T7 (opcional) — Teams: decidir largo vs corto en `export.js:windowLabel`.
- [x] T8 — Altura 170→118px (grid 2-col Desde|Hasta + presets full-row, solo CSS).

## Acceptance
- Altura módulo -30/40%, dropdown días con semana visible dinámico, horas útiles, presets integrados, misma baseline, sin regresión solapamiento/Lima/header/temas/responsive/a11y, tarjeta corta + drawer largo.

## Applicable checks (por task)
- `pytest backend/tests/test_pipeline.py` si se toca backend (no previsto).
- Carga frontend + conteo filtros + `Limpiar` + Hoy/Ayer/Toda + drawer open/Escape + Light/Dark + 1400/1100/640px.

## Progress
- T1-T6 + T8 completados y verificados. Solo T7 opcional Teams pendiente.

## Verification evidence
- T1 node: Lun 14 Sep · 00:00–00:30 success. T2 14/15 asserts + -39% altura. T3 baseline inspección 1400 OK. T4 178/178/457 conteos OK. T5 Hoy 192/Ayer 138/Toda 457 + N=4 OK. T6 11 checks pass (1 fix keyboard) + node --check 4 JS. pytest unavailable (sin pytest), navegador headless unavailable (inspección + harness).

## Next step
- Push manual desde entorno autenticado: `git push -u origin chore/triage-single-file`. Commits locales: d6eacee feat frontend, 9dd8c11 fix pipeline, 97df3e9 docs specs. data.json (1.2MB) excluido a propósito.
