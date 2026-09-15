"""Row normalization: America/Lima timestamps with null preservation.

Naive ``DD/MM/YYYY HH:MM`` cells are interpreted in America/Lima and
emitted as ISO-8601 with the ``-05:00`` offset (Lima has no DST, so the
offset is stable). Nulls — including the phantom ``tipo_cambio2`` column —
stay null; unparseable non-empty dates raise instead of guessing.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

LIMA_TZ = ZoneInfo("America/Lima")

# Columns interpreted as Lima datetimes. Reversion ``FEC_HOR_*`` cells and
# ``fecha_registro`` ship as date strings in the same format.
DATE_COLUMNS = frozenset(
    {
        "fec_hora_ini_impl",
        "fec_hora_fin_impl",
        "fec_hora_ini_rati",
        "fec_hora_fin_rati",
        "fec_hora_fin_rati_total",
        "fec_hor_ini_reversion",
        "fec_hor_fin_reversion",
        "fec_hor_ini_rati_reve",
        "fec_hor_fin_rati_reve",
        "fecha_registro",
    }
)

_DATETIME_RE = re.compile(
    r"^(?P<d>\d{1,2})/(?P<m>\d{1,2})/(?P<y>\d{4})"
    r"(?:[ T](?P<H>\d{1,2}):(?P<M>\d{2})(?::(?P<S>\d{2}))?)?$"
)


class DateParseError(ValueError):
    """Raised for a non-empty cell that is not a valid Lima datetime."""


def parse_lima_datetime(value: object, *, column: str, row_number: int) -> str | None:
    """Parse one cell to Lima ISO-8601, preserving nulls.

    ``row_number`` is the 1-based Excel row (header = 1) and is only used
    for error context — never logged with the cell value.
    """
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        match = _DATETIME_RE.match(text)
        if not match:
            raise DateParseError(
                f"row {row_number}: column {column!r} is not DD/MM/YYYY HH:MM"
            )
        parts = {k: int(v) if v is not None else 0 for k, v in match.groupdict().items()}
        try:
            parsed = datetime(
                parts["y"], parts["m"], parts["d"],
                parts["H"], parts["M"], parts["S"],
                tzinfo=LIMA_TZ,
            )
        except ValueError as exc:
            raise DateParseError(
                f"row {row_number}: column {column!r} holds an invalid date"
            ) from exc
        return parsed.isoformat()
    if isinstance(value, datetime):
        localized = value if value.tzinfo else value.replace(tzinfo=LIMA_TZ)
        return localized.astimezone(LIMA_TZ).isoformat()
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=LIMA_TZ).isoformat()
    raise DateParseError(
        f"row {row_number}: column {column!r} has unsupported type "
        f"{type(value).__name__}"
    )


def _clean_scalar(value: object) -> object:
    """Preserve nulls; collapse whitespace-only strings to None."""
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def normalize_row(
    row: dict[str, object], *, row_number: int
) -> dict[str, object]:
    """Normalize one raw row keyed by canonical header."""
    normalized: dict[str, object] = {}
    for column, value in row.items():
        if column in DATE_COLUMNS:
            normalized[column] = parse_lima_datetime(
                value, column=column, row_number=row_number
            )
        else:
            normalized[column] = _clean_scalar(value)
    return normalized


def normalize_rows(rows: tuple[dict[str, object], ...]) -> list[dict[str, object]]:
    """Normalize all rows; Excel row numbers start at 2 (after the header)."""
    return [
        normalize_row(row, row_number=index + 2) for index, row in enumerate(rows)
    ]
