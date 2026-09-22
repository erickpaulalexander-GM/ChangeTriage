# ODD Feature: Ops density single bar

## Objective
Densidad operativa agresiva: UNA sola barra de filtros (~40px de alto total), cero duplicidad de chips (solo la barra activa bajo el panel), botones de acción compactos inline. NOC/Monitoring, no formularios.

## Problem
Aun tras Compact v1, medio viewport se va antes del primer resultado: toolbar en varias filas + chips dentro de cada control + chips activos (duplicados) + botones grandes + módulo ventana con presets en dos filas.

## Why
Herramienta NOC: cada píxel vertical antes del primer resultado es costo por consulta, cientos de veces por día.

## Scope
- In: `frontend/index.html` (quitar `#f-ticket-chips`/`#f-app-chips` del combo, toolbar a una fila flex con todo inline, presets como mini-segmentados inline, `#window-range` como micro-texto inline), `frontend/assets/css/app.css` (single bar, inputs 34px, toolbar padding 12px, gaps 6px, botones small, presets mini), `frontend/assets/js/filters.js` (placeholder con conteo `App (2)` / `Ticket (1)`; renderChips queda no-op defensivo), `scripts/smoke.mjs` (ajustar `filters-chip-rendered` + markup check sin chips en combo), rebuild bundle.
- Out: matching, daypick/search/presets/share/export lógica, drawer, backend, temas, branding.

## Constraints
- Una sola fila flex con wrap (search crece, resto compacto): search + ticket + app + tipo + desde(btn+hora) + hasta(btn+hora) + presets(Hoy|Ayer|Toda mini) + acciones (Export/Teams/Copiar/Limpiar small). Nada puede forzar segunda fila a 1400px; en móvil wrap permitido.
- Fuente única de chips: `#active-filters` bajo el panel. Controles muestran conteo en placeholder (`App (Todas)` vacío → `App (2)`); query libre intacta.
- renderChips sin cajas destino debe ser no-op silencioso (ya lo es por `if (!box) return`); NO romper getSelected/clearSelected/toggleValue/removeValue (los usa share.js).
- Smoke: `filters-chip-rendered` hoy aserta DOM de chips en combo → reescribir (lógica getSelected intacta + markup check `f-ticket-chips` ausente + placeholder-count si se expone). Resto del smoke intacto; solo los 3 fails ajenos conocidos.
- A11y intacta (roles/combobox/listbox, aria-expanded, foco visible, teclado); responsive sin scroll horizontal; light/dark por vars.
- Heurística advisory-only ~400; forward igual.

## TDD
- Mode: OFF. Runner: node --check + smoke + visual manual (1400px una fila, 1920 primer resultado inmediato).

## Authorized scope
Pedido usuario "densidad operativa agresiva + single bar + sin duplicidad". Sin commit/push sin orden.

## Delivery
- Strategy: `single-pr` (forecast ~120-180, mayoría CSS).

## Tasks
- [x] B1 — HTML single bar + quitar chips de controles + presets mini + window-range inline (delegated, done).
- [x] B2 — CSS single bar 34px + botones small + placeholder-count (delegated, done: placeholderFor/syncPlaceholder).
- [x] B3 — Smoke + verify (done: 206 pass, solo 3 ajenos; bundle rebuild; cero divs .chips en markup y bundle). Pendiente visual usuario.

## Acceptance
- Toolbar ≈ una fila a 1400px; cero chips duplicados; primer resultado visible sin scroll a 1920×1080 100%; filtros/drawer/exports/URL/temas sin regresión.

## Progress
- 2026-09-22: B1-B3 completados (verificación automática). Pendiente visual usuario. Sin commit.

## Verification evidence
- node --check filters.js OK; smoke 200→206 pass, solo 3 fails pre-existentes ajenos.
- Cero `<div class="chips"` en index.html y triage.html (solo queda el string defensivo en JS).
- Caveats honestos: a 1400px con labels runtime largos (Toda la ventana (N días)) puede envolver a 2ª fila compacta — nada en CSS la fuerza; borrar por control ahora es Backspace/#active-filters (la ✕ del combo ya no existe).

## Next step
- Delegar B1-B2 a writer único, luego B3.
