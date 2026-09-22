# ODD Feature: Shareable Filter State

## Objective
Todos los filtros compartibles por URL: serializar (q, ticket[], app[], tipo, desde, hasta), restaurar al abrir con auto-búsqueda, chips de filtros activos sobre resultados, botón copiar enlace, y header de filtros en Teams summary. Sin backend, estático, SharePoint + file://.

## Problem
El portal tiene estado solo en memoria: imposible compartir una vista filtrada en un bridge. El cliente (Monitoring) pide URL + contexto en Teams.

## Why
Pasar de "mirá el cambio HI49" a un link que abre la vista exacta + un Teams pegado que ya explica el contexto sin abrir nada.

## Scope
- In: nuevo `frontend/assets/js/share.js` (codec URL puro + restore + active-chips bar + copy-link), `frontend/index.html` (botón `#copy-link`, div `#active-filters` sobre `#results`), `frontend/assets/js/filters.js` (exponer remoción por valor), `frontend/assets/js/search.js` (hook post-apply para refrescar URL + chips, sin cambiar matching), `frontend/assets/js/export.js` (header filtros en Teams), `frontend/assets/css/app.css` (chips activos + botón, vars existentes), `scripts/smoke.mjs` (actualizar teams-* + checks codec), rebuild bundle.
- Out: matching/overlap, presets, daypick, backend, pipeline, drawer.

## Constraints
- Schema URL (ejemplo cliente, normativo): `?q=&ticket=A&ticket=B&app=HI49&app=YAPE&tipo=Mayor&desde=2026-09-20T00:00&hasta=2026-09-20T01:00`. Repetir clave por valor (getAll). `desde/hasta` = `YYYY-MM-DDTHH:MM` wall Lima; al restaurar se parten en date + time inputs. Valores con encodeURIComponent; parse tolerante (ignora params desconocidos/vacíos).
- Restore DESPUÉS de cargar data.json (opciones derivan de rows): pending-parse en init + hook en cadena `TriageSearch.refresh` (mismo patrón que filters/daypick/presets). Restore setea: q, selected ticket/app (+chips visibles + labels), tipo select, hidden dates + times + `syncFromInputs`/`syncTimeHints`, preset desactivado; luego `applyFilters` (auto-búsqueda).
- URL viva con `history.replaceState` (no pushState: evita spam de historial) en try/catch — si file:// lo rechaza, se omite en silencio; el botón copiar construye la URL desde el estado, no desde location.
- Chips de control se MUEVEN debajo del input (spec cliente §2, hoy están arriba). Chips activos sobre resultados: uno por valor app/ticket + tipo + ventana + q; cada × quita solo ese filtro y re-aplica; "Limpiar todo" = `resetFilters` + apply. Barra oculta cuando no hay filtros activos.
- Ventana chip label: `20 Sep · 00:00–01:00` (reusar `formatDay`/lógica de daypick; parcial si un solo bound).
- Teams header (formato cliente, normativo):
  ```
  Change Triage
  Filtros aplicados:
  • Apps: HI49, YAPE
  • Tipo: Cambio Mayor
  • Ventana: 20 Sep · 00:00–01:00
  Resultados: 8 cambios encontrados.
  <filas…>
  ```
  Solo secciones con filtro activo (+Tickets: y +Búsqueda: si aplican); sin filtros: `Sin filtros (vista completa).` + conteo. Requiere actualizar smoke `teams-lines`/`teams-first-line`.
- share.js expone codec puro (`buildParams(criteria)`, `parseParams(search)`) para smoke. Bundle-safe, stdlib-free, a11y (buttons reales, aria-labels, foco visible), responsive, light/dark con vars existentes.
- Heurística advisory-only ~400 líneas por task; forward igual.

## TDD
- Mode: OFF. Source: sin config explícita. Runner: `node --check` + `node scripts/smoke.mjs` + carga manual triage.html (incl. abrir con ?params en file://).
- Forward: TDD OFF, ordinary functional checks.

## Authorized scope
Spec cliente "Filtros compartibles" + "yes" explícito del usuario. Sin mutación remota, sin push/PR/commit sin orden.

## Delivery
- Strategy: `single-pr` (forecast ~300 líneas).
- Running: 0. Budget: no excede.

## Tasks
- [x] S1 — share.js codec + restore + URL viva (delegated, done: buildParams/parseParams, one-shot restore en refresh-chain, replaceState try/catch).
- [x] S2 — Active-chips bar (delegated, done: chip por valor/tipo/ventana/q, × quirúrgico, Limpiar todo, hidden si vacío).
- [x] S3 — Chips bajo el control + CSS (delegated, done).
- [x] S4 — Copiar enlace (delegated, done: URL desde estado, clipboard + fallback + confirm op-count).
- [x] S5 — Teams header + smoke + verify (delegated + parent spot check: 200 pass, solo 3 fails pre-existentes ajenos).

## Acceptance
- Aceptación cliente 1:1: multiselect ✓ (hecho), chips control ✓ + resultados ✓, URL conserva estado ✓, restore + auto-búsqueda ✓, copiar enlace ✓, Teams con filtros ✓, compat estática ✓.

## Applicable checks (por task)
- `node --check` de cada JS tocado; `node scripts/smoke.mjs`; triage.html con y sin params; Hoy/Ayer/Toda + Limpiar sin regresión.

## Progress
- 2026-09-22: S1-S5 completados y verificados automáticamente. Pendiente solo el pase manual del usuario (abrir triage.html con params). Sin commit.

## Verification evidence
- `node --check` share/search/filters/export → CHECK_OK (writer + parent).
- Smoke 168→200 pass (+32 share); únicos fails los 3 pre-existentes ajenos.
- Integración writer en /tmp 16/16 (restore, 6 chips+clear, × quirúrgico, copy-link, one-shot).
- Bundle rebuild js=9 rows=913.
- PENDIENTE manual ~~(no automatizable aquí): triage.html?app=HI49&tipo=Mayor&desde=…&hasta=… en file:// + copiar + pegar en Teams + Hoy/Ayer/Toda/Limpiar.~~ → ✅ Confirmado por usuario 2026-09-22: restore por URL funciona ("funciona el click url").

## Next step
- Delegar S1-S5 a un writer único, luego spot check + bundle.
