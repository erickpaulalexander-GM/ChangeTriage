"""Synthetic fixtures for the Change Triage test suite.

Every row here is invented (tickets T-1001/T-1002/T-1003) — no production
data. Timestamps mirror scripts/smoke.mjs so the backend suite and the
frontend smoke script assert the same overlap sample.
"""

from __future__ import annotations

import re
import zipfile
from collections.abc import Sequence
from pathlib import Path

from backend.parser_excel import HEADER_MAP

# Raw header spellings that normalize to the strict map (already collapsed
# uppercase; the typo-08 "FEC .HORA. FIN. IMPL" spacing is kept verbatim).
RAW_HEADERS: list[str] = list(HEADER_MAP)
CANONICAL: list[str] = [HEADER_MAP[header] for header in RAW_HEADERS]

# The bank's export declares <dimension ref="A1:AR596"/> while the real data
# ends at column AH (34 real headers). AR is column 44, i.e. 10 extra.
DIRTY_DIMENSION_EXTRA_COLUMNS = 10

# The bank's export uses the 1-based column position, so the duplicated
# spelling sits at 0-based index 31 (column 32, sheet column AF).
DUPLICATED_HEADER_COLUMN = 32
DUPLICATED_HEADER_INDEX = DUPLICATED_HEADER_COLUMN - 1

# The 2026-09 bank export: column 32 repeats column 5's "TIPO CAMBIO"
# spelling instead of shipping the distinct "TIPO CAMBIO2". Every other
# header is unchanged, so this reproduces the prod header row exactly.
BANK_2026_HEADERS: list[str] = [
    RAW_HEADERS[4] if index == DUPLICATED_HEADER_INDEX else header
    for index, header in enumerate(RAW_HEADERS)
]

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


def _synthetic_sheet_rows() -> list[list[object]]:
    """Materialize the synthetic rows in canonical column order."""
    return [[row[key] for key in CANONICAL] for row in synthetic_rows()]


# <dimension ref="A1:AH4"/> — the XML-record openpyxl's writer emits.
_DIMENSION_RE = re.compile(
    r'(?P<head><dimension\s+ref=")'
    r'(?P<start>[A-Z]+\d+):(?P<end_col>[A-Z]+)(?P<end_row>\d+)'
    r'(?P<tail>")'
)
_SHEET_XML_PREFIX = "xl/worksheets/sheet"


def _widen_dimension(path: Path, extra_columns: int) -> None:
    """Rewrite the sheet ``<dimension>`` in place to a wider range.

    ``openpyxl``'s writer always emits a dimension that matches the cells it
    wrote, so a plain fixture cannot reproduce the prod break: in
    ``read_only`` mode the reader trusts that record and pads every row out
    to it. This rewrites the sheet XML inside the zip so the declared range
    overshoots the real data, exactly as the bank export does now that it
    no longer carries an Excel Table (ListObject) to derive it from.
    """
    from openpyxl.utils import column_index_from_string, get_column_letter

    with zipfile.ZipFile(path) as archive:
        entries = [
            (info, archive.read(info.filename)) for info in archive.infolist()
        ]
    sheet_names = [
        info.filename
        for info, _ in entries
        if info.filename.startswith(_SHEET_XML_PREFIX)
    ]
    if len(sheet_names) != 1:
        raise AssertionError(
            f"expected exactly one worksheet entry, found {sheet_names!r}"
        )
    sheet_name = sheet_names[0]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for info, payload in entries:
            if info.filename == sheet_name:
                xml = payload.decode("utf-8")
                match = _DIMENSION_RE.search(xml)
                if match is None:
                    raise AssertionError(
                        f"no <dimension> record in {sheet_name} to widen"
                    )
                end_col = column_index_from_string(match.group("end_col"))
                widened = get_column_letter(end_col + extra_columns)
                xml = (
                    xml[: match.start()]
                    + f"{match.group('head')}{match.group('start')}:"
                    + f"{widened}{match.group('end_row')}{match.group('tail')}"
                    + xml[match.end():]
                )
                payload = xml.encode("utf-8")
            archive.writestr(info, payload)


def _write_sheet(
    path: Path,
    headers: Sequence[object],
    rows: Sequence[Sequence[object]],
    extra_dimension_columns: int = 0,
) -> Path:
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Hoja1"
    sheet.append(list(headers))
    for row in rows:
        sheet.append(list(row))
    workbook.save(path)
    if extra_dimension_columns:
        _widen_dimension(path, extra_dimension_columns)
    return path


def write_workbook(path: Path) -> Path:
    """Write the synthetic rows as an .xlsx workbook (test-only)."""
    return _write_sheet(path, RAW_HEADERS, _synthetic_sheet_rows())


def write_workbook_with_headers(
    path: Path,
    headers: Sequence[object],
    rows: Sequence[Sequence[object]] = (),
    extra_columns: int = 0,
) -> Path:
    """Write an arbitrary header row (plus optional data rows) as a workbook."""
    return _write_sheet(path, headers, rows, extra_columns)


def write_header_only_workbook(
    path: Path, headers: Sequence[object], extra_columns: int = 0
) -> Path:
    """Write a header row with no data rows, to exercise drift detection."""
    return write_workbook_with_headers(path, headers, (), extra_columns)


def write_workbook_with_dirty_dimension(
    path: Path, extra_columns: int = DIRTY_DIMENSION_EXTRA_COLUMNS
) -> Path:
    """Same workbook, but with the oversized ``<dimension>`` of the prod file.

    Reproduces the bank export: 34 real headers plus a trailing pad that the
    ``read_only`` reader materializes as ``None`` for the header row and for
    every data row.
    """
    return _write_sheet(
        path, RAW_HEADERS, _synthetic_sheet_rows(), extra_columns
    )


def write_header_only_workbook(
    path: Path, headers: Sequence[object], extra_columns: int = 0
) -> Path:
    """Write a header row with no data rows, to exercise drift detection."""
    return _write_sheet(path, headers, [], extra_columns)
