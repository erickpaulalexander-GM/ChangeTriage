"""Checked-in pytest suite: header drift, Lima parse, null preservation,
contract shape, and the ticket-overlap sample run (task 4.1).

All inputs are synthetic (backend.tests.fixtures) — no production rows.
Run: uv run --with pytest --with openpyxl pytest backend/tests
"""

from __future__ import annotations

from datetime import datetime

import pytest

from backend.normalizador import (
    DateParseError,
    normalize_rows,
    parse_lima_datetime,
)
from backend.parser_excel import (
    EXPECTED_COLUMN_COUNT,
    HeaderDriftError,
    map_headers,
    read_workbook,
)
from backend.schema import ROW_KEYS, SchemaError, build_payload, validate_rows
from backend.utils import normalize_header

from .fixtures import (
    CANONICAL,
    RAW_HEADERS,
    SAMPLE_INCIDENT_ISO,
    SAMPLE_WINDOW_FIN,
    SAMPLE_WINDOW_INI,
    synthetic_rows,
    write_workbook,
)


def test_typo08_spacing_collapse_resolves_same_key() -> None:
    """Extra whitespace runs collapse before header-map lookup."""
    assert normalize_header("FEC .HORA.  FIN. IMPL") == "FEC .HORA. FIN. IMPL"
    drifted = list(RAW_HEADERS)
    drifted[7] = "fec   .hora. fin. impl"  # same key, messy spacing/case
    assert map_headers(drifted) == map_headers(RAW_HEADERS)


def test_header_drift_fails_fast() -> None:
    """One unknown header raises; the column count stays strict."""
    assert EXPECTED_COLUMN_COUNT == 34
    drifted = list(RAW_HEADERS)
    drifted[2] = "TIKET DRIFT"
    with pytest.raises(HeaderDriftError, match="header drift"):
        map_headers(drifted)


def test_lima_parse_emits_fixed_offset() -> None:
    """DD/MM/YYYY HH:MM becomes Lima ISO; blanks stay null."""
    assert parse_lima_datetime(SAMPLE_WINDOW_INI, column="c", row_number=2) == (
        "2026-09-14T00:00:00-05:00"
    )
    assert parse_lima_datetime("14/09/2026", column="c", row_number=2) == (
        "2026-09-14T00:00:00-05:00"
    )
    assert parse_lima_datetime("   ", column="c", row_number=2) is None
    assert parse_lima_datetime(None, column="c", row_number=2) is None
    with pytest.raises(DateParseError):
        parse_lima_datetime("not a date", column="c", row_number=2)


def test_null_preservation_including_phantom_column() -> None:
    """Nulls survive; whitespace-only collapses; values are kept."""
    rows = normalize_rows(tuple(synthetic_rows()))
    by_ticket = {row["ticket"]: row for row in rows}
    assert by_ticket["T-1001"]["tipo_cambio2"] is None
    assert by_ticket["T-1003"]["tipo_cambio2"] == "ADICIONAL"
    assert by_ticket["T-1002"]["squad"] is None  # whitespace-only input
    assert by_ticket["T-1002"]["fec_hora_ini_impl"] is None
    assert by_ticket["T-1002"]["fec_hora_fin_impl"] is None


def test_overlap_sample_window_edges_match_incident() -> None:
    """Sample run: T-1001 window edges parse so 03:00 falls inside."""
    rows = normalize_rows(tuple(synthetic_rows()))
    sample = next(row for row in rows if row["ticket"] == "T-1001")
    assert sample["fec_hora_ini_impl"] == "2026-09-14T00:00:00-05:00"
    assert sample["fec_hora_fin_impl"] == "2026-09-14T06:00:00-05:00"
    ini = datetime.fromisoformat(str(sample["fec_hora_ini_impl"]))
    fin = datetime.fromisoformat(str(sample["fec_hora_fin_impl"]))
    incident = datetime.fromisoformat(SAMPLE_INCIDENT_ISO)
    assert ini <= incident <= fin


def test_fixture_workbook_end_to_end(tmp_path) -> None:
    """Synthetic .xlsx -> strict parse -> Lima normalize -> valid payload."""
    table = read_workbook(write_workbook(tmp_path / "synthetic.xlsx"), "Hoja1")
    assert list(table.columns) == CANONICAL
    rows = normalize_rows(table.rows)
    assert len(rows) == 3
    payload = build_payload(rows)
    assert payload["count"] == 3 and len(payload["rows"]) == 3
    assert set(payload.keys()) == {"generated_at", "count", "rows"}


def test_schema_rejects_key_mismatch() -> None:
    """Rows missing a canonical key (or carrying extras) are rejected."""
    rows = synthetic_rows()
    del rows[0]["ticket"]
    with pytest.raises(SchemaError, match="key mismatch"):
        validate_rows(rows)
    assert set(synthetic_rows()[0].keys()) == ROW_KEYS
