"""Generate ``workspace/output/data.json`` from the staged workbook.

Pipeline: find workbook -> strict parse -> Lima normalize -> validate ->
atomic emit. Exits non-zero on header drift, bad dates, or a missing
workbook, and never writes partial output. Logs carry counts, paths, and
error classes only — never row values.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import Settings, find_workbook, load_config  # noqa: E402
from backend.normalizador import DateParseError, LIMA_TZ, normalize_rows  # noqa: E402
from backend.parser_excel import HeaderDriftError, RawTable, read_workbook  # noqa: E402
from backend.schema import SchemaError, build_payload, write_payload  # noqa: E402
from backend.utils import log_error, log_info  # noqa: E402


def resolve_source_modified(
    workbook_path: Path, raw_table: RawTable
) -> tuple[datetime, str]:
    """Resolve the source timestamp and its provenance.

    Precedence: the workbook's internal ``properties.modified`` (survives
    copy/upload/zip) -> filesystem ``st_mtime``. Returns an aware Lima
    datetime plus ``"internal"`` or ``"filesystem"``.
    """
    internal = raw_table.source_modified_utc
    if internal is not None:
        aware = internal if internal.tzinfo else internal.replace(tzinfo=timezone.utc)
        return aware.astimezone(LIMA_TZ), "internal"
    mtime = workbook_path.stat().st_mtime
    resolved = datetime.fromtimestamp(mtime, tz=timezone.utc).astimezone(LIMA_TZ)
    return resolved, "filesystem"


def run(settings: Settings) -> int:
    workbook_path = find_workbook(settings)
    if workbook_path is None:
        log_error(
            f"no workbook matching {settings.excel_pattern!r} "
            f"in {settings.input_dir} (rows=0)"
        )
        return 2
    log_info(f"workbook={workbook_path.name} sheet={settings.excel_sheet}")
    try:
        table = read_workbook(workbook_path, settings.excel_sheet)
        source_modified_at, provenance = resolve_source_modified(
            workbook_path, table
        )
        log_info(
            f"source={workbook_path.name} "
            f"modified={source_modified_at.isoformat()} provenance={provenance}"
        )
        rows = normalize_rows(table.rows)
        payload = build_payload(
            rows,
            source_file=workbook_path.name,
            source_modified_at=source_modified_at,
        )
    except (HeaderDriftError, DateParseError, SchemaError) as exc:
        log_error(f"{type(exc).__name__}: {exc} (rows=0, output=none)")
        return 1
    write_payload(payload, settings.data_file)
    log_info(
        f"done rows={payload['count']} output={settings.data_file} errors=0"
    )
    return 0


def main() -> int:
    settings = Settings.from_config(load_config())
    for directory in (
        settings.output_dir,
        settings.bundle_dir,
        settings.logs_dir,
        settings.cache_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    return run(settings)


if __name__ == "__main__":
    raise SystemExit(main())
