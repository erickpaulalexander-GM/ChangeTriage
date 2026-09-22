"""data.json contract: validation and atomic emission.

Contract: ``{generated_at, count, rows[]}`` where row keys are the
canonical snake_case headers, dates are Lima ISO-8601 (or null), and
nulls are preserved. Optional ``source_file`` / ``source_modified_at``
describe the workbook the data came from; ``generated_at`` stays the
build (run) timestamp. Nothing here logs row values.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from .normalizador import DATE_COLUMNS, LIMA_TZ
from .parser_excel import HEADER_MAP

ROW_KEYS = frozenset(HEADER_MAP.values())

_ISO_OFFSET_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$")


class SchemaError(ValueError):
    """Raised when normalized rows violate the data.json contract."""


def validate_rows(rows: list[dict[str, object]]) -> None:
    """Validate the full row set; raise on the first violation found."""
    for index, row in enumerate(rows):
        row_number = index + 2  # Excel row (header = 1)
        keys = set(row)
        if keys != ROW_KEYS:
            missing = sorted(ROW_KEYS - keys)
            extra = sorted(keys - ROW_KEYS)
            raise SchemaError(
                f"row {row_number}: key mismatch "
                f"(missing={missing or 'none'}, extra={extra or 'none'})"
            )
        for column in DATE_COLUMNS:
            value = row[column]
            if value is not None and not (
                isinstance(value, str) and _ISO_OFFSET_RE.match(value)
            ):
                raise SchemaError(
                    f"row {row_number}: column {column!r} is not Lima ISO-8601"
                )


def _to_lima_iso(value: datetime) -> str:
    """Serialize a datetime as Lima ISO-8601, assuming UTC when naive."""
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(LIMA_TZ).isoformat()


def build_payload(
    rows: list[dict[str, object]],
    source_file: str | None = None,
    source_modified_at: datetime | None = None,
) -> dict[str, object]:
    validate_rows(rows)
    payload: dict[str, object] = {
        "generated_at": datetime.now(tz=LIMA_TZ).isoformat(),
        "count": len(rows),
        "rows": rows,
    }
    if source_file is not None:
        payload["source_file"] = source_file
    if source_modified_at is not None:
        payload["source_modified_at"] = _to_lima_iso(source_modified_at)
    return payload


def write_payload(payload: dict[str, object], path: Path) -> None:
    """Write atomically (temp file + rename) so failures leave no partial output."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)
