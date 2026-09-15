"""Synthetic fixtures for the Change Triage test suite.

Every row here is invented (tickets T-1001/T-1002/T-1003) — no production
data. Timestamps mirror scripts/smoke.mjs so the backend suite and the
frontend smoke script assert the same overlap sample.
"""

from __future__ import annotations

from pathlib import Path

from backend.parser_excel import HEADER_MAP

# Raw header spellings that normalize to the strict map (already collapsed
# uppercase; the typo-08 "FEC .HORA. FIN. IMPL" spacing is kept verbatim).
RAW_HEADERS: list[str] = list(HEADER_MAP)
CANONICAL: list[str] = [HEADER_MAP[header] for header in RAW_HEADERS]

# Shared overlap sample: T-1001 window 00:00-06:00, incident 03:00 inside;
# T-1002 has a null window (never matches); T-1003 window 10:00-12:00.
SAMPLE_WINDOW_INI = "14/09/2026 00:00"
SAMPLE_WINDOW_FIN = "14/09/2026 06:00"
SAMPLE_INCIDENT_ISO = "2026-09-14T03:00:00-05:00"


def make_row(**overrides: object) -> dict[str, object]:
    """Build a 34-key canonical row; unspecified fields stay null."""
    row: dict[str, object] = dict.fromkeys(CANONICAL)
    row.update(overrides)
    return row


def synthetic_rows() -> list[dict[str, object]]:
    """Three invented rows: normal window, null window, second window."""
    base = {
        "tribu": "SYNTH",
        "squad": "Synthetic",
        "nombre_app": "Synthetic App",
        "tipo_cambio": "NORMAL",
        "descripcion_cambio": "Synthetic fixture row",
        "estado_actual": "EJECUTADO",
        "recurso": "synthetic.user",
        "fecha_registro": "14/09/2026 00:00",
    }
    return [
        make_row(**{**base, "ticket": "T-1001",
                    "fec_hora_ini_impl": SAMPLE_WINDOW_INI,
                    "fec_hora_fin_impl": SAMPLE_WINDOW_FIN}),
        # Null-window row: incident mode must never match it.
        make_row(**{**base, "ticket": "T-1002", "squad": "   ",
                    "fec_hora_ini_impl": None, "fec_hora_fin_impl": None}),
        make_row(**{**base, "ticket": "T-1003", "tipo_cambio2": "ADICIONAL",
                    "fec_hora_ini_impl": "14/09/2026 10:00",
                    "fec_hora_fin_impl": "14/09/2026 12:00"}),
    ]


def write_workbook(path: Path) -> Path:
    """Write the synthetic rows as an .xlsx workbook (test-only)."""
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Hoja1"
    sheet.append(RAW_HEADERS)
    for row in synthetic_rows():
        sheet.append([row[key] for key in CANONICAL])
    workbook.save(path)
    return path
