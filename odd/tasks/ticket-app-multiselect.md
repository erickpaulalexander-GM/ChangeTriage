# ODD Feature: Ticket App Multi-select Chips

## Objective
Permitir escoger más de una opción en filtros Ticket y App con chips removibles y sugerencias con check, sin tocar pipeline ni lógica de ventana.

## Problem
Hoy `f-ticket` y `f-app` son combobox single-value: cada pick pisa `input.value`. Operativa necesita filtrar AVPL + VPLU (u N tickets) a la vez. `search.js:matchesFilters` hace substring AND sobre un solo string por campo.

## Why
Incidentes con varias apps/tickets relacionados se triagean juntos; pedir uno por uno frena y obliga a exportar y unir a mano.

## Scope
- In: `frontend/index.html` (combos ticket/app), `frontend/assets/js/filters.js` (estado multi + chips + sugerencias), `frontend/assets/js/search.js` (getCriteria/matchesFilters/reset), `frontend/assets/css/app.css` (chips + check states), bundle `triage.html` si aplica.
- Out: backend parser/normalizador, lógica overlap Desde/Hasta, Tipo (sigue single), export/presets/drawer salvo reset necesario.

## Constraints
- OR dentro del mismo filtro, AND entre filtros (decisión usuario 2026-09-21).
- Free text sigue permitido: Enter agrega valor libre como chip; "Todas" limpia App.
- Sin imports, stdlib-free, bundle-safe (sin `</` literales en JS).
- Solo vars CSS existentes, light + dark, responsive sin scroll horizontal.
- A11y: `role=listbox/option`, `aria-selected`, `aria-expanded`, Escape cierra, flechas + Enter eligen, Backspace borra último chip con input vacío, foco visible.
- Heurística advisory-only: ~400 authored changed lines por task como guía, no cap, no split artificial, no borrar espacios/comentarios, no omitir tests. Forward a subagentes igual.

## TDD
- Mode: OFF. Source: sin config explícita (tests presentes no habilitan TDD). Runner: `pytest backend/tests/test_pipeline.py` + `node --check` frontend + carga manual con `data.json`.
- Forward a cada delegación: TDD OFF, ordinary functional checks.

## Authorized scope
Exploración read-only completa. Implementación autorizada por pedido explícito "hay q realizar una mejora, los filtros Ticket y App debe permitir escoger mas de una opción" + answers Chips multi-select / OR-dentro-AND-fuera. Sin mutación remota, sin push/PR sin orden.

## Delivery
- Strategy: `single-pr` (forecast <400 authored lines, slice único).
- Forecast: ~180-250 líneas (filters ~120, search ~40, css ~50, html ~20).
- Running: 0. Budget: no excede.

## Tasks
- [x] T1 — filters.js multi-select + chips: estado `selected {ticket:[], app:[]}`, render chips removibles, sugerencias con check + `aria-selected`, pick hace toggle (no pisa), "Todas" limpia app, Backspace borra último, click fuera/Escape cierra. Route: delegated (writer trigger 2+ files, preparación incluida).
- [x] T2 — search.js OR-dentro/AND-fuera: `getCriteria` expone arrays, `matchesFilters` OR case-insensitive por campo (vacío = sin filtro), compat con valor libre viejo, `resetFilters` limpia chips + inputs. Route: delegated mismo writer T1 (una sola hebra).
- [x] T3 — HTML+CSS chips: markup contenedor chips por combo, estilos check/chip/foco en ambos temas, placeholders intactos, responsive. Route: delegated mismo writer.
- [x] T4 — Verificación: `node --check` 3 JS OK, smoke filtros actualizado al contrato multi-select (17 checks nuevos/actualizados pass), harness OR/AND/legacy pass, bundle `triage.html` rebuild OK (913 rows). 3 fails restantes son pre-existentes y ajenos (ver evidencia). Route: writer self-verify + parent spot check.

## Acceptance
- Ticket y App permiten N opciones visibles como chips, remover individual + limpiar todo.
- AVPL+VPLU filtra unión; Ticket A+B filtra unión; Ticket+App filtra intersección; "Todas"/vacío = sin filtro app.
- Sin regresión ventana Lima, Tipo, buscador global, header, temas, responsive, a11y teclado.
- `Limpiar filtros` deja estado vacío inicial.

## Applicable checks (por task)
- `node --check frontend/assets/js/filters.js frontend/assets/js/search.js frontend/assets/js/app.js`
- Harness conteo + `Limpiar` + Hoy/Ayer/Toda + drawer + Light/Dark + 1400/640px.
- `pytest backend/tests/test_pipeline.py` solo si se toca backend.

## Progress
- 2026-09-21: T1-T4 completados y verificados. Feature lista, sin commit (decisión de entrega del usuario pendiente).

## Verification evidence
- `node --check` filters.js + search.js + app.js → CHECK_OK (parent spot check replica writer).
- Harness parent (stubs): OR-app true/true/false, AND-fail false, empty-pass true, legacy-str true.
- `node scripts/smoke.mjs` → SMOKE_DONE 17/17, THEME 73/73, FILTERS 135 pass con 1 fail pre-existente, WINDOW 153 pass con 1 fail pre-existente (2 checks dentro).
- Pre-existentes ajenos (diff propio con 0 reglas `.window-block` y sin tocar labels ventana/tipo): `filters-window-grouped`, `window-labels`, `window-themed` — expectativas stales del redesign compact-bar (ux-polish), no de este feature.
- Stale corregido al pasar (misma suite): `filters-tipo-*` esperaba "Tipo (Todos)", el código dice "TIPO CAMBIO" desde antes (HTML + populateTipo intactos).
- Bundle: `python3 backend/bundle_single.py` → css=1 js=8 img=2 rows=913 errors=0.
- Backend no tocado → pytest no requerido.

## Next step
- Probar `workspace/output/triage.html` (doble clic) con AVPL+VPLU y multi-ticket; commit a decisión del usuario (hay otros cambios pre-existentes sin commitear en el worktree: backend, README, app.js).
