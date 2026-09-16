# Design: Change Triage MVP

## Technical Approach

Greenfield static triage portal: Python batch pipeline converts `ControlPases.xlsx` (457x34) to `workspace/output/data.json`; vanilla SPA (no framework) serves search, incident-overlap query, 6-group drawer, and exports from that JSON. Implements proposal slice in three 400-line PRs: pipeline, frontend base, search/export.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Single `generate.py` vs split `parser_excel/normalizador/schema/config/utils` | Single is shorter; split matches blueprint and isolates header/TZ logic for unit tests | Split per blueprint `backend/` layout |
| Strict header map (fail on unknown) vs fuzzy match | Fuzzy hides drift; strict surfaces typo-08 class errors early | Strict normalized map, exit non-zero, no partial output |
| `zoneinfo America/Lima` ISO `-05:00` vs naive string compare | Naive breaks incident boundary semantics; Lima has no DST so fixed offset is safe | Parse `DD/MM/YYYY HH:MM` as Lima-naive, emit ISO with offset; compare in Lima TZ |
| Single-file SPA vs `index.html` + `assets/css|js` modules | Single file simplifies SharePoint upload; modules keep PRs reviewable | `index.html` + `assets/css/app.css` + `assets/js/{app,search,drawer,export}.js`, relative paths only |

Drawer taxonomy (from `DATA_DICTIONARY.md`): Resumen, Implementacion, Reversion, Impacto, Responsables, Gobernanza. Overlap semantics: inclusive both ends (`impl_ini <= incident <= impl_fin`); rows with null window never match. `TIPO CAMBIO2` kept as nullable field, never dropped.

## Data Flow

```
ControlPases.xlsx ──→ parser_excel ──→ normalizador ──→ data.json ──→ SPA ──→ drawer/CSV/Teams
  (workspace/input)      (headers)       (Lima ISO)      (output/data)   (fetch, in-memory filter)
```

Header normalization (non-obvious pattern):

```python
CANON = {"FEC .HORA. FIN. IMPL": "fec_hora_fin_impl", "TIPO CAMBIO2": "tipo_cambio2", ...}
key = re.sub(r"\s+", " ", h.strip()).upper()  # collapses typo-08 spacing before lookup
```

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/{config,parser_excel,normalizador,schema,generar_data,utils}.py` | Create | Config (relative Linux paths), parse, normalize, validate, emit |
| `frontend/index.html`, `frontend/assets/{css/app.css,js/app,search,drawer,export.js}` | Create | Dark-theme SPA per `design-tokens.json`/`layout.json` |
| `frontend/assets/images/{BCP,Kyndryl}.png` | Move | Logos from repo root |
| `workspace/{input,output/data/data.json,logs,cache}/` | Create | Excel staging, publishable output, gitignored cache |
| `config.yaml`, `.gitignore`, `README.md` | Create | Relative paths, exclude input/cache, publish notes |

## Interfaces / Contracts

`data.json`: `{generated_at, count, rows[]}`; row keys are snake_case canonical headers; dates are Lima ISO (`2026-09-14T00:00:00-05:00`) or null; nulls preserved; logs carry counts/errors only.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Header map (typo-08, phantom col), Lima date parse, null preservation | `pytest` on `normalizador`/`schema` with fixture workbook |
| Integration | Full run Excel→`data.json`; incident-overlap verdict vs manual Excel sample | `uv run generar_data.py` on copy; script asserts sample tickets |
| E2E | <10s query from static bundle, drawer groups, CSV/Teams export, empty state | Serve `workspace/output`, manual checklist + SharePoint MIME/size check |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Pipeline uses `openpyxl` library calls; SPA fetches same-origin `data.json`.

## Migration / Rollout

No migration. Rollback: keep prior `data.json` + bundle; republish previous SharePoint version. Publish validation (verify phase): folder upload size, JSON MIME, relative paths, cache invalidation.

## Open Questions

- [ ] SharePoint static-hosting limits (size/MIME/cache) — validate in verify, not blocking build.
