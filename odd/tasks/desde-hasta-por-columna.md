# ODD Feature: Desde/Hasta por columna

## Objective
Los desplegables de día de Desde y Hasta listan solo los días reales de su columna (Desde ← FEC. HORA. INI. IMPL, Hasta ← FEC. HORA. FIN. IMPL), en vez de la expansión unión ini→fin.

## Problem
`daypick.js:deriveDays` expande cada fila a todos los días entre ini y fin y une ambos lados en una sola lista. Con los datos actuales (ini: 20-22 Sep 2026, fin: hasta 19 Mar 2027) el dropdown muestra 181 días consecutivos donde casi nada empieza ni termina — "no cuadra" con la columna INI para Desde ni con FIN para Hasta.

## Why
Operativa elige el día viendo la columna real: Desde filtra por inicio, Hasta por fin. Una lista de 181 días con scroll es inusable y sugiere días sin datos.

## Scope
- In: `frontend/assets/js/daypick.js` (derivación por lado + estado + header comment), `scripts/smoke.mjs` (sección daypick: por lado + no-expansión), rebuild `workspace/output/triage.html`.
- Out: `search.js` overlap math (intacto), `presets.js` (intacto: Hoy/Ayer/Toda setean hidden directo + syncFromInputs, sin validación contra listas), Tipo/Ticket/App, backend, export/drawer.

## Constraints
- Desde = días únicos ordenados de `fec_hora_ini_impl`; Hasta = días únicos de `fec_hora_fin_impl`; sin expansión, sin unión.
- `refreshDays` valida cada lado contra su propia lista (preset "all": min=ini-day ✓, max=fin-day ✓; Hoy/Ayer van por setWindow directo, sin validación).
- Compat: `deriveDays(rows)` sin lado sigue devolviendo unión (legacy); `getDays()` igual. Bundle-safe, stdlib-free, a11y intacto.
- Overlap math NO se toca: Desde sigue siendo cota sobre fin (fin >= Desde), Hasta cota sobre ini (ini <= Hasta). Solo cambian las opciones ofrecidas.
- Heurística advisory-only: ~400 authored changed lines por task como guía, no cap ni split artificial. Forward igual a subagentes.

## TDD
- Mode: OFF. Source: sin config explícita. Runner: `node --check` + `node scripts/smoke.mjs` + carga manual triage.html.
- Forward: TDD OFF, ordinary functional checks.

## Authorized scope
Exploración read-only completa. Implementación autorizada por reporte explícito "no cuadra en la fecha desde… debería aparecer lo de FEC. HORA. INI. IMPL y hasta… FIN. IMPL". Sin mutación remota, sin push/PR/commit sin orden.

## Delivery
- Strategy: `single-pr` (forecast ~80-120 líneas).
- Running: 0. Budget: no excede.

## Tasks
- [x] D1 — daypick.js por lado (delegated, done: uniqDays + deriveDays(rows,side) + state por lado + header reescrito; MAX_SPAN/addDays eliminados por obsoletos).
- [x] D2 — smoke daypick (delegated, done: 15 checks, fila 14→16 no expande, validación por lado, unión legacy).
- [x] D3 — Verificación (parent spot check: node --check OK, smoke 153→168 pass con solo los 3 fails pre-existentes ajenos, Desde=3/Hasta=5 con datos reales, bundle rebuild rows=913 con uniqDays inlinado ×4).

## Acceptance
- Desde lista 20/21/22 Sep; Hasta lista 20/21/22/23 Sep + 19 Mar 2027 (datos actuales).
- Elegir Desde filtra solape igual que antes; presets y Limpiar sin regresión; teclado/temas intactos.

## Applicable checks (por task)
- `node --check frontend/assets/js/daypick.js`
- `node scripts/smoke.mjs`
- Carga triage.html + presets + bundle rebuild.

## Progress
- 2026-09-22: D1-D3 completados y verificados. Feature lista, sin commit (decisión de entrega del usuario pendiente).

## Verification evidence
- `node --check frontend/assets/js/daypick.js` → CHECK_OK (writer + parent).
- `node scripts/smoke.mjs` → SMOKE_DAYPICK_DONE pass=168 (era 153, +15 nuevos), únicos fails los 3 pre-existentes ajenos (filters-window-grouped, window-labels, window-themed — leen solo app.css/index.html, no tocados).
- Datos reales: Desde=3 (20/21/22 Sep), Hasta=5 (20/21/22/23 Sep + 2027-03-19).
- Bundle rebuild: css=1 js=8 img=2 rows=913 errors=0, uniqDays presente en triage.html.
- Overlap math y presets.js intactos (verificado por diseño + smoke window en verde salvo pre-existentes).

## Next step
- Delegar D1-D2 a un writer único, luego D3 verify.

## Notes
- Dato llamativo (no tocado): una fila termina 2027-03-19, muy lejos del resto (max ini 22 Sep 2026). Posible tema de calidad de datos a revisar con el dueño del Excel.
