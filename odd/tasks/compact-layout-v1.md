# ODD Feature: Compact Layout v1 (Desktop 100%)

## Objective
Densidad visual para ver ~6-7 cambios sin scroll a 100% (1920×1080): header 110→72px, sin barra gris de métricas (info reubicada), filtros y botones compactos, cards −30%. Cero cambios funcionales.

## Problem
Layout actual aireado: header alto + opbar independiente + filtros 40px+ + cards grandes → pocos resultados visibles por viewport.

## Why
Uso operativo en monitoreo a 100%: ver más cambios sin scroll acelera el triage en bridge.

## Scope
- In: `frontend/index.html` (header, quitar opbar, slots reubicados, count sobre lista, subtítulo ventana, pills), `frontend/assets/css/app.css` (alturas, paddings, pills, cards, responsive), `frontend/assets/js/app.js` (updateOpbar → nuevos slots; formatter `21 Sep · 15:55`; count `12 resultados de 913 cambios`; rango `20 Sep → 21 Sep (2 días)` en módulo ventana), `frontend/assets/js/export.js` (confirmación copyTeams a nuevo slot, lógica intacta), `scripts/smoke.mjs` (solo si algún check toca lo movido — verificar con grep), rebuild bundle.
- Out (prohibido): parser, data.json, drawer, lógica de exportaciones, URL compartible (share.js), temas, branding (logos/títulos permanecen).

## Constraints
- Header ~72px: recortar paddings, logo más chico (proporcional), h1 igual, subtítulo más chico. Debajo de Kyndryl: `🕒 21 Sep · 15:55` (fecha fuente source_modified_at, contrato S1/S2 vigente; SIN la palabra "Actualizado"). Formato día Mes HH:MM con Mes corto Es (reusar MONTHS de daypick si accesible, si no tabla local mínima).
- Opbar eliminada como barra independiente (los 3 items + separadores). Si op-count/op-updated/op-range desaparecen del DOM, actualizar TODAS sus referencias (app.js els + updateOpbar, export.js fallback `op-count||status` → nuevo slot).
- Count encima de la lista: `12 resultados de 913 cambios` (visible/total; con filtros activos refleja filtrados; sin filtros `913 resultados de 913 cambios` o solo total — decidir y documentar en código).
- Rango en módulo ventana bajo el título: `20 Sep → 21 Sep (2 días)` desde computeRange existente (minStart/maxEnd); se actualiza al cargar datos.
- Filtros: inputs 40px altura, toolbar padding 16px, gap vertical 8px. No romper baseline Ticket/App/Tipo vs ventana ni wrap móvil.
- Botones pill compactos: Export CSV, Copy Teams summary, Copiar enlace filtrado (labels intactos, solo estilo: radius 999px, padding menor).
- Cards −30%: recortar padding/meta; mantener ticket destacado, app, estado, horario resumido, recurso (feature anterior) y click→drawer.
- Responsive: primer resultado lo antes posible en móvil (recortar márgenes superiores en breakpoints existentes, sin nuevos breakpoints salvo necesario).
- Solo vars CSS existentes; a11y intacto (foco visible, aria, roles); temas intactos.
- Heurística advisory-only ~400 líneas; forward igual.

## TDD
- Mode: OFF. Source: sin config explícita. Runner: `node --check` + `node scripts/smoke.mjs` + revisión visual manual triage.html a 1920×1080 100% (no automatizable aquí).

## Authorized scope
Spec cliente "Compact Layout v1" transcripta por el usuario. Sin mutación remota, sin push/PR/commit sin orden.

## Delivery
- Strategy: `single-pr` (forecast ~150-220 líneas, mayoría CSS).
- Running: 0. Budget: no excede.

## Tasks
- [x] C1 — Header + reubicación (delegated, done: slot 🕒 bajo Kyndryl, count, window-range, updateOpbar, export confirm).
- [x] C2 — Filtros + pills + cards CSS (delegated, done).
- [x] C3 — Opbar removal + follow-up share.js confirm→results-count (delegated + 1 línea padre).
- [x] C4 — Verify automático (done: checks OK, smoke 200 solo 3 ajenos, bundle js=9 rows=913 results-count×12). Pendiente pase visual usuario.

## Acceptance
- Cliente 1:1: ~6-7 visibles, header bajo, filtros bajos, primer resultado antes, cero regresión funcional (filtros, ventana, presets, drawer, exports, URL, temas).

## Applicable checks (por task)
- `node --check` JS tocados; smoke; bundle; pase visual manual usuario.

## Progress
- 2026-09-22: C1-C4 completados (verificación automática). Pendiente pase visual del usuario a 1920×1080 100%. Sin commit.

## Verification evidence
- node --check share/app/export OK; smoke 200 pass, solo 3 fails pre-existentes ajenos.
- Bundle rebuild js=9 rows=913 errors=0, results-count presente.
- Nota: se eliminó el caso "Hoy" del rango (muestra `20 Sep (1 día)`); share.js solo cambió el target del confirm (lógica URL intacta).

## Next step
- Delegar C1-C3 a writer único, luego C4.
