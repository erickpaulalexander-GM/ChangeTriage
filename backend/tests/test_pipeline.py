"""Checked-in pytest suite: header drift, Lima parse, null preservation,
contract shape, and the ticket-overlap sample run (task 4.1).

All inputs are synthetic (backend.tests.fixtures) — no production rows.
Run: py -m pytest backend/tests -q
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from backend.generar_data import resolve_source_modified
from backend.normalizador import (
    DateParseError,
    normalize_rows,
    parse_lima_datetime,
)
from backend.parser_excel import (
    EXPECTED_COLUMN_COUNT,
    POSITIONAL_HEADER_ALIASES,
    HeaderDriftError,
    RawTable,
    _trim_trailing_empty_headers,
    map_headers,
    read_workbook,
)
from backend.schema import ROW_KEYS, SchemaError, build_payload, validate_rows
from backend.utils import normalize_header

from .fixtures import (
    BANK_2026_HEADERS,
    CANONICAL,
    DIRTY_DIMENSION_EXTRA_COLUMNS,
    DUPLICATED_HEADER_COLUMN,
    DUPLICATED_HEADER_INDEX,
    RAW_HEADERS,
    SAMPLE_INCIDENT_ISO,
    SAMPLE_WINDOW_INI,
    synthetic_rows,
    write_header_only_workbook,
    write_workbook,
    write_workbook_with_dirty_dimension,
    write_workbook_with_headers,
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


# --- Dirty <dimension> regression (prod: the bank dropped Excel Table) ---


def test_trim_trailing_empty_headers_drops_only_the_pad() -> None:
    """Only the trailing run goes; inner empties survive for strict mapping."""
    raw = ["TRIBU", None, "   ", "SQUAD", None, None]
    assert _trim_trailing_empty_headers(raw) == ["TRIBU", None, "   ", "SQUAD"]
    # Whitespace-only counts as empty, so an all-blank row trims to nothing.
    assert _trim_trailing_empty_headers([None, "  ", "\t"]) == []
    assert _trim_trailing_empty_headers([]) == []
    assert _trim_trailing_empty_headers(["A", "B"]) == ["A", "B"]


def test_dirty_dimension_fixture_really_pads_the_header_row(tmp_path) -> None:
    """Guard: the fixture must stay dirty, or the tests below prove nothing."""
    import openpyxl

    path = write_workbook_with_dirty_dimension(tmp_path / "dirty.xlsx")
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        raw = list(next(workbook["Hoja1"].iter_rows(values_only=True)))
    finally:
        workbook.close()
    assert DIRTY_DIMENSION_EXTRA_COLUMNS == 10
    assert len(raw) == EXPECTED_COLUMN_COUNT + DIRTY_DIMENSION_EXTRA_COLUMNS
    assert sum(1 for cell in raw if cell is None) == DIRTY_DIMENSION_EXTRA_COLUMNS


def test_dirty_dimension_workbook_parses_every_row(tmp_path) -> None:
    """A stale oversized <dimension> no longer fails the run."""
    path = write_workbook_with_dirty_dimension(tmp_path / "dirty.xlsx")
    table = read_workbook(path, "Hoja1")
    assert list(table.columns) == CANONICAL
    assert len(table.columns) == EXPECTED_COLUMN_COUNT
    # The padded data rows are truncated by the trimmed column tuple.
    assert len(table.rows) == 3
    rows = normalize_rows(table.rows)
    assert [row["ticket"] for row in rows] == ["T-1001", "T-1002", "T-1003"]
    assert rows[2]["tipo_cambio2"] == "ADICIONAL"


def test_dirty_dimension_still_rejects_non_trailing_drift(tmp_path) -> None:
    """Trailing padding is tolerated; a real unknown header still fails."""
    headers = [*RAW_HEADERS, *([None] * DIRTY_DIMENSION_EXTRA_COLUMNS)]
    headers[2] = "TIKET DRIFT"
    path = write_header_only_workbook(
        tmp_path / "drift.xlsx", headers, DIRTY_DIMENSION_EXTRA_COLUMNS
    )
    with pytest.raises(HeaderDriftError, match="header drift"):
        read_workbook(path, "Hoja1")


def test_dirty_dimension_empty_header_row_still_rejected(tmp_path) -> None:
    """An all-empty header row trims to zero columns and still fails."""
    headers = [None] * (EXPECTED_COLUMN_COUNT + DIRTY_DIMENSION_EXTRA_COLUMNS)
    path = write_header_only_workbook(
        tmp_path / "blank.xlsx", headers, DIRTY_DIMENSION_EXTRA_COLUMNS
    )
    with pytest.raises(HeaderDriftError, match="header drift"):
        read_workbook(path, "Hoja1")


def test_short_header_row_still_rejected_by_count(tmp_path) -> None:
    """A trimmed row below the expected width fails on the count check."""
    headers = list(RAW_HEADERS)[:-1] + [None]
    path = write_header_only_workbook(tmp_path / "short.xlsx", headers)
    with pytest.raises(HeaderDriftError, match="header drift"):
        read_workbook(path, "Hoja1")


# --- Duplicated header: the bank repeats column 5's spelling at column 32 ---


def test_bank_2026_headers_repeat_the_column_5_spelling() -> None:
    """The fixture really is a duplicate, and the alias covers that column."""
    assert BANK_2026_HEADERS[DUPLICATED_HEADER_INDEX] == "TIPO CAMBIO"
    assert BANK_2026_HEADERS[DUPLICATED_HEADER_INDEX] == BANK_2026_HEADERS[4]
    assert POSITIONAL_HEADER_ALIASES[DUPLICATED_HEADER_COLUMN] == "TIPO CAMBIO2"


def test_positional_alias_repairs_the_duplicated_header() -> None:
    """The duplicate resolves to tipo_cambio2 instead of colliding."""
    columns = map_headers(BANK_2026_HEADERS)
    assert columns == CANONICAL
    assert len(set(columns)) == EXPECTED_COLUMN_COUNT
    assert columns[DUPLICATED_HEADER_INDEX] == "tipo_cambio2"


def test_positional_alias_workbook_keeps_both_change_types(tmp_path) -> None:
    """End to end: no collapsed key, and the second classification survives."""
    sheet_rows = [[row[key] for key in CANONICAL] for row in synthetic_rows()]
    path = write_workbook_with_headers(
        tmp_path / "bank-2026.xlsx",
        BANK_2026_HEADERS,
        sheet_rows,
        DIRTY_DIMENSION_EXTRA_COLUMNS,
    )
    table = read_workbook(path, "Hoja1")
    assert list(table.columns) == CANONICAL
    assert all(len(row) == EXPECTED_COLUMN_COUNT for row in table.rows)
    rows = normalize_rows(table.rows)
    assert [row["ticket"] for row in rows] == ["T-1001", "T-1002", "T-1003"]
    assert rows[2]["tipo_cambio2"] == "ADICIONAL"
    assert all(row["tipo_cambio"] == "NORMAL" for row in rows)


def test_duplicate_at_non_aliased_position_raises_with_detail() -> None:
    """An uncovered duplicate fails fast naming key, positions and values."""
    drifted = list(RAW_HEADERS)
    drifted[4] = "ESTADO ACTUAL"  # duplicates column 34; position 5 is not aliased
    with pytest.raises(HeaderDriftError) as excinfo:
        map_headers(drifted)
    message = str(excinfo.value)
    assert "duplicate column 'estado_actual'" in message
    assert "positions 5 and 34" in message
    assert "ESTADO ACTUAL" in message


def test_alias_refuses_when_its_target_is_already_taken() -> None:
    """A taken alias target is not stolen; the duplicate still fails fast."""
    drifted = list(RAW_HEADERS)
    drifted[3] = "TIPO CAMBIO2"  # column 4 now claims tipo_cambio2
    drifted[DUPLICATED_HEADER_INDEX] = "TIPO CAMBIO"  # ...and column 32 duplicates
    with pytest.raises(HeaderDriftError) as excinfo:
        map_headers(drifted)
    message = str(excinfo.value)
    assert "duplicate column 'tipo_cambio'" in message
    assert "positions 5 and 32" in message


def test_uncovered_duplicate_workbook_still_fails_fast(tmp_path) -> None:
    """The guard also holds on the read path, not only in map_headers."""
    drifted = list(BANK_2026_HEADERS)
    # Break column 5; the column-32 alias no longer applies.
    drifted[4] = "ESTADO ACTUAL"
    path = write_header_only_workbook(tmp_path / "dup.xlsx", drifted)
    with pytest.raises(HeaderDriftError, match="duplicate column"):
        read_workbook(path, "Hoja1")


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
    path = write_workbook(tmp_path / "synthetic.xlsx")
    table = read_workbook(path, "Hoja1")
    assert list(table.columns) == CANONICAL
    assert table.source_modified_utc is not None
    rows = normalize_rows(table.rows)
    assert len(rows) == 3
    source_modified_at, provenance = resolve_source_modified(path, table)
    payload = build_payload(
        rows,
        source_file=path.name,
        source_modified_at=source_modified_at,
    )
    assert payload["count"] == 3 and len(payload["rows"]) == 3
    assert set(payload.keys()) == {
        "generated_at",
        "count",
        "rows",
        "source_file",
        "source_modified_at",
    }
    assert payload["source_file"] == "synthetic.xlsx"
    assert str(payload["source_modified_at"]).endswith("-05:00")
    assert provenance == "internal"


def test_payload_includes_source_fields_as_lima_iso() -> None:
    """Provided source fields are emitted; aware UTC becomes Lima ISO."""
    rows = normalize_rows(tuple(synthetic_rows()))
    modified = datetime(2026, 9, 16, 22, 55, 15, tzinfo=timezone.utc)
    payload = build_payload(
        rows, source_file="ControlPases.xlsx", source_modified_at=modified
    )
    assert payload["source_file"] == "ControlPases.xlsx"
    assert payload["source_modified_at"] == "2026-09-16T17:55:15-05:00"


def test_payload_without_source_fields_is_backward_compatible() -> None:
    """Omitting source fields keeps the legacy key-set."""
    rows = normalize_rows(tuple(synthetic_rows()))
    payload = build_payload(rows)
    assert set(payload.keys()) == {"generated_at", "count", "rows"}


def test_resolve_source_modified_prefers_internal_property(tmp_path) -> None:
    """Internal workbook metadata wins over the filesystem mtime."""
    path = tmp_path / "synthetic.xlsx"
    path.write_bytes(b"placeholder")
    internal = datetime(2026, 9, 16, 22, 55, 15, tzinfo=timezone.utc)
    table = RawTable(columns=(), rows=(), source_modified_utc=internal)
    resolved, provenance = resolve_source_modified(path, table)
    assert provenance == "internal"
    assert resolved.isoformat() == "2026-09-16T17:55:15-05:00"


def test_resolve_source_modified_falls_back_to_mtime(tmp_path) -> None:
    """A missing internal property falls back to st_mtime, tagged UTC."""
    path = tmp_path / "synthetic.xlsx"
    path.write_bytes(b"placeholder")
    mtime = datetime(2026, 9, 16, 23, 0, 0, tzinfo=timezone.utc).timestamp()
    os.utime(path, (mtime, mtime))
    table = RawTable(columns=(), rows=(), source_modified_utc=None)
    resolved, provenance = resolve_source_modified(path, table)
    assert provenance == "filesystem"
    assert resolved.isoformat() == "2026-09-16T18:00:00-05:00"


def test_naive_source_modified_is_treated_as_utc() -> None:
    """A naive datetime is tagged UTC before the Lima conversion."""
    rows = normalize_rows(tuple(synthetic_rows()))
    naive = datetime(2026, 9, 16, 22, 55, 15)
    payload = build_payload(
        rows, source_file="ControlPases.xlsx", source_modified_at=naive
    )
    assert payload["source_modified_at"] == "2026-09-16T17:55:15-05:00"


def test_schema_rejects_key_mismatch() -> None:
    """Rows missing a canonical key (or carrying extras) are rejected."""
    rows = synthetic_rows()
    del rows[0]["ticket"]
    with pytest.raises(SchemaError, match="key mismatch"):
        validate_rows(rows)
    assert set(synthetic_rows()[0].keys()) == ROW_KEYS
