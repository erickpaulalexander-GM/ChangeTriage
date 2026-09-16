# Tasks: Change Triage MVP

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes (resolved: chained PRs, feature-branch-chain)
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pipeline emits data.json | PR 1 | `uv run pytest backend/tests` | `uv run backend/generar_data.py` on workbook copy | Remove `backend/`, `workspace/output/data.json` |
| 2 | SPA shell + 6-group drawer | PR 2 | Serve output + drawer open/close checklist | Open row, verify 6 groups, close, empty state | Revert `frontend/index.html`, `frontend/assets/css/app.css`, `frontend/assets/js/app.js`, `frontend/assets/js/drawer.js` |
| 3 | Search, overlap, CSV/Teams export | PR 3 | Search/export manual checklist | Ticket query, incident datetime, CSV + Teams copy | Revert `frontend/assets/js/search.js`, `frontend/assets/js/export.js` |

## Phase 1: Pipeline Foundation

- [x] 1.1 Create `backend/config.py`, `backend/utils.py`, `config.yaml`, `.gitignore` with relative Linux paths; gitignore input/cache
- [x] 1.2 Create `backend/parser_excel.py` with strict normalized header map (typo-08 spacing collapse); fail non-zero, no partial output
- [x] 1.3 Create `backend/normalizador.py` parsing DD/MM/YYYY HH:MM as America/Lima ISO with `-05:00`; preserve nulls incl. `tipo_cambio2`
- [x] 1.4 Create `backend/schema.py` + `backend/generar_data.py` emitting `{generated_at, count, rows[]}` to `workspace/output/data.json`; logs counts/errors only
- [x] 1.5 Create `workspace/input/`, `workspace/output/data/`, `workspace/logs/`, `workspace/cache/` staging directories

## Phase 2: Frontend Base and Detail

- [x] 2.1 Create `frontend/index.html` + `frontend/assets/css/app.css` dark-theme shell per tokens; relative paths only
- [x] 2.2 Create `frontend/assets/js/app.js` fetching `data.json` and rendering results list with empty-state + reset action
- [x] 2.3 Create `frontend/assets/js/drawer.js` showing 6 groups (Resumen, Implementacion, Reversion, Impacto, Responsables, Gobernanza); close returns focus
- [x] 2.4 Move `BCP.png`, `Kyndryl.png` to `frontend/assets/images/`; wire logos into shell

## Phase 3: Search and Export

- [x] 3.1 Create `frontend/assets/js/search.js` with instant Ticket/App/Recurso substring + Ticket/App/Tipo/Fecha filters (AND semantics)
- [x] 3.2 Add incident mode to `frontend/assets/js/search.js`: flag `impl_ini <= incident <= impl_fin` in Lima TZ; null window never matches
- [x] 3.3 Create `frontend/assets/js/export.js` CSV download of current result set; headers-only when empty
- [x] 3.4 Add Teams-summary copy to `frontend/assets/js/export.js`: one Ticket/App/window line per row + inline fallback when clipboard blocked

## Phase 4: Testing and Publish

- [x] 4.1 Add `backend/tests/` pytest unit tests: header drift, Lima parse, null preservation; verify ticket-overlap sample run
- [x] 4.2 Verify E2E: serve `workspace/output`, <10s query, drawer, CSV/Teams, SharePoint size/MIME/relative-path/cache check
- [x] 4.3 Create `README.md` with pipeline rerun, SPA serve, and republish-rollback notes
