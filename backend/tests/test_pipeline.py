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


# --- Tolerant unknown columns (prod: the bank inserted "TRANVERSAL") ---


def test_unknown_header_is_tolerated_and_logged(capsys) -> None:
    """An extra bank column is logged and dropped, not fatal.

    The unknown spelling stands in for any future column the bank adds
    without notice; the real 2026-10 shape (TRANVERSAL) is now mapped and
    covered by test_prod_2026_10_shape_maps_transversal below.
    """
    assert EXPECTED_COLUMN_COUNT == 35
    drifted = [*RAW_HEADERS[:33], "XTRA", *RAW_HEADERS[33:]]
    keys = map_headers(drifted)
    assert len(keys) == 36
    assert keys[33] is None
    assert [key for key in keys if key is not None] == CANONICAL
    out = capsys.readouterr().err
    assert "[info] unknown headers (1), values dropped: XTRA" in out
    assert "[error]" not in out


def test_prod_2026_10_shape_maps_transversal(tmp_path) -> None:
    """The real 2026-10 export layout parses strictly, TRANVERSAL kept.

    BANK_2026_HEADERS now reproduces the prod header row exactly: the
    duplicated TIPO CAMBIO at 1-based column 32 and TRANVERSAL at column
    34, between REQUIERE USUARIO ROOT and ESTADO ACTUAL. The dirty
    <dimension> pad completes the real file shape (45 declared columns).
    """
    sheet_rows = [[row[key] for key in CANONICAL] for row in synthetic_rows()]
    path = write_workbook_with_headers(
        tmp_path / "prod-2026-10.xlsx",
        BANK_2026_HEADERS,
        sheet_rows,
        DIRTY_DIMENSION_EXTRA_COLUMNS,
    )
    table = read_workbook(path, "Hoja1")
    assert list(table.columns) == CANONICAL
    assert len(table.columns) == EXPECTED_COLUMN_COUNT
    rows = normalize_rows(table.rows)
    assert [row["ticket"] for row in rows] == ["T-1001", "T-1002", "T-1003"]
    assert [row["transversal"] for row in rows] == ["NO", "NO", "SI"]


def test_unknown_and_missing_headers_logged_then_raise(capsys) -> None:
    """A renamed required header is both a drift note and a fatal missing."""
    drifted = list(RAW_HEADERS)
    drifted[2] = "TIKET DRIFT"
    with pytest.raises(HeaderDriftError) as excinfo:
        map_headers(drifted)
    message = str(excinfo.value)
    assert message == "header drift: missing required column(s): ticket"
    out = capsys.readouterr().err
    assert "[info] unknown headers (1), values dropped: TIKET DRIFT" in out


def test_empty_header_row_lists_all_missing(capsys) -> None:
    """An all-empty header row fails naming the full required set."""
    with pytest.raises(HeaderDriftError, match="header drift"):
        map_headers([None] * 10)
    out = capsys.readouterr().err
    assert "[info] unknown headers (10), values dropped: <empty>" in out


@pytest.mark.parametrize("pos", range(EXPECTED_COLUMN_COUNT + 1))
def test_extra_column_at_any_position_keeps_alignment(tmp_path, pos: int) -> None:
    """Regression (verify probe): an extra column at ANY position never shifts.

    Every cell is uniquely valued, so a silent positional zip shift — the
    worst case here, corrupt data without an error — would be observable.
    """
    headers = [*RAW_HEADERS]
    headers.insert(pos, "COLUMNA EXTRA")
    sheet_rows, expected = [], []
    for row in range(3):
        cells = [f"v-{row}-{col}" for col in range(EXPECTED_COLUMN_COUNT)]
        cells.insert(pos, f"SENTINEL-{row}")
        sheet_rows.append(cells)
        expected.append(
            {key: f"v-{row}-{col}" for col, key in enumerate(CANONICAL)}
        )
    path = write_workbook_with_headers(
        tmp_path / f"extra-{pos}.xlsx", headers, sheet_rows
    )
    table = read_workbook(path, "Hoja1")
    assert list(table.columns) == CANONICAL
    for index, row in enumerate(table.rows):
        assert set(row) == set(CANONICAL)
        assert all(row[key] == value for key, value in expected[index].items())
        assert not isinstance(row.get("tribu"), str) or not row["tribu"].startswith(
            "SENTINEL"
        )
        assert all(
            not isinstance(value, str) or not value.startswith("SENTINEL")
            for value in row.values()
        )


def test_extra_column_above_col32_shifts_duplicate_off_alias_cover() -> None:
    """Regression (verify probe): the alias only repairs col-32 duplicates.

    An extra column at a sheet position <= 32 (1-based) moves the duplicated
    "TIPO CAMBIO" off the aliased position, so the run fails fast with the
    duplicate error instead of tolerating; from position 33 on the repair
    still fires and the extra column is dropped.
    """
    for pos in range(32):
        headers = [*BANK_2026_HEADERS]
        headers.insert(pos, "COLUMNA EXTRA")
        with pytest.raises(HeaderDriftError, match="duplicate column 'tipo_cambio'"):
            map_headers(headers)
    headers = [*BANK_2026_HEADERS]
    headers.insert(32, "COLUMNA EXTRA")
    keys = map_headers(headers)
    # 0-based: the duplicate sits at 31 (1-based 32, alias-covered) and the
    # inserted extra column lands right after it at index 32.
    assert keys[32] is None and keys[31] == "tipo_cambio2"
    assert [key for key in keys if key is not None] == CANONICAL


def test_empty_and_extra_nontrailing_headers_drop_values(capsys) -> None:
    """Regression (verify probe): non-trailing blanks and extras are dropped."""
    entries = map_headers(["XTRA_A", *RAW_HEADERS, None, "XTRA_B"])
    assert entries[0] is None and entries[36] is None and entries[37] is None
    assert [key for key in entries if key is not None] == CANONICAL
    out = capsys.readouterr().err
    assert "[info] unknown headers (3), values dropped: XTRA_A, <empty>, XTRA_B" in out


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


def test_dirty_dimension_still_rejects_missing_required_header(tmp_path) -> None:
    """Trailing padding is tolerated; missing required headers still fail.

    A renamed header (TIKET DRIFT stands in for TICKET) is unmapped, so the
    required set loses ``ticket`` and the run still fails fast even though
    unknown columns are otherwise tolerated.
    """
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
    """A trimmed row below the required width fails on the missing check."""
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
    drifted[4] = "ESTADO ACTUAL"  # duplicates column 35; position 5 is not aliased
    with pytest.raises(HeaderDriftError) as excinfo:
        map_headers(drifted)
    message = str(excinfo.value)
    assert "duplicate column 'estado_actual'" in message
    assert "positions 5 and 35" in message
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
    # Pin the mtime older than the workbook's own internal save stamp so the
    # precedence assertion below is deterministic (a just-written file would
    # race the two clocks).
    old = datetime(2026, 9, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp()
    os.utime(path, (old, old))
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


def test_resolve_source_modified_uses_the_later_timestamp(tmp_path) -> None:
    """The later of the internal stamp and the filesystem mtime wins.

    The bank generator stamps a stale internal date on fresh drops, so a
    fixed precedence either way lies in one direction; max() matches the
    Explorer in the stale-template case and still surfaces genuinely new
    content on mtime-preserving copies.
    """
    path = tmp_path / "synthetic.xlsx"
    path.write_bytes(b"placeholder")
    mtime = datetime(2026, 9, 16, 23, 0, 0, tzinfo=timezone.utc).timestamp()
    os.utime(path, (mtime, mtime))
    # Stale internal (the observed bank case): the mtime wins.
    stale = datetime(2026, 8, 25, 22, 56, 12, tzinfo=timezone.utc)
    resolved, provenance = resolve_source_modified(
        path, RawTable(columns=(), rows=(), source_modified_utc=stale)
    )
    assert (provenance, resolved.isoformat()) == (
        "filesystem", "2026-09-16T18:00:00-05:00")
    # Fresh internal on a preserved copy: the internal stamp wins.
    fresh = datetime(2026, 9, 17, 10, 0, 0, tzinfo=timezone.utc)
    resolved, provenance = resolve_source_modified(
        path, RawTable(columns=(), rows=(), source_modified_utc=fresh)
    )
    assert (provenance, resolved.isoformat()) == (
        "internal", "2026-09-17T05:00:00-05:00")


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
