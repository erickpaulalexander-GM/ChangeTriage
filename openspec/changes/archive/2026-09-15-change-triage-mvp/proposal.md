# Proposal: Change Triage MVP

## Intent
Replace manual remote + Excel lookup with a seconds-long query: did a prod change overlap an incident window? Opened from SharePoint/Teams: search Ticket/App/Recurso, review window, judge overlap, share.

## Scope
### In Scope
- Folder bootstrap: `backend/`, `frontend/`, `workspace/`, `docs/`
- Python pipeline: `ControlPases.xlsx` (457x34, Lima-naive DD/MM/YYYY HH:MM) -> `workspace/output/data.json` (Lima ISO)
- Static vanilla SPA: instant search, Ticket/App/Tipo/Fecha filters, incident mode (`impl_ini <= incident <= impl_fin`), 6-group detail drawer, empty-state page
- Exports: CSV + copy Teams-summary
- Header normalization, null-preservation, `.gitignore` for input/cache

### Out of Scope
- PDF/print export
- List virtualization (unneeded at 457 rows)
- Timeline polish and animations

## Capabilities
### New Capabilities
- `data-pipeline`: Excel parse, header normalization, Lima-TZ dates, data.json contract
- `change-search`: instant search, filters, incident-overlap query
- `change-detail`: 6-group drawer, empty-state page
- `change-export`: CSV download, Teams-summary copy

### Modified Capabilities
- None (greenfield; `openspec/specs/` empty)

## Approach
MVP slice: bootstrap with relative Linux paths, parser/normalizer with header-map validation, static SPA reading only `data.json`. Ship in 400-line PRs: (1) bootstrap+pipeline, (2) frontend base, (3) search/export.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `backend/*.py` | New | Parser, normalizer, data.json generator |
| `frontend/index.html, assets/` | New | SPA, dark theme, drawer, exports |
| `workspace/input, output/data/data.json, logs, cache` | New | Excel staging, publishable output |
| `config.yaml`, `.gitignore` | New | Relative paths, exclude input/cache |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Header drift (typo-08, phantom TIPO CAMBIO2) | High | Normalized header map + validation errors |
| TZ-naive Lima dates vs incident time | Med | Parse all as America/Lima ISO; compare in Lima TZ |
| Production data leak via logs/repo | Med | Never log full rows; gitignore input/cache |
| SharePoint static-hosting limits | Med | Validate upload/size/MIME during design/verify |
| openpyxl missing (uv only) | Low | Install via uv; pin version |

## Rollback Plan
Keep prior `data.json` + frontend bundle; revert = republish previous SharePoint version. Pipeline makes no prod writes; rerun on fixed input. No migrations.

## Distribution Impact
Static SPA + `data.json` on SharePoint; no backend. Publish = upload/sync folder; Teams tab links URL. Validate: size limits, JSON MIME, relative paths, cache invalidation.

## Dependencies
- `openpyxl` via uv; Python 3.x
- `ControlPases.xlsx` provided out-of-band; `BCP.png`, `Kyndryl.png` moved to `frontend/assets/images/`

## Success Criteria
- [ ] Query Ticket/App overlap answered in <10s from SharePoint link
- [ ] Incident-mode overlap matches manual Excel verdict on sample tickets
- [ ] CSV + Teams-summary exports work from results view
- [ ] Republish rollback verified with prior bundle
