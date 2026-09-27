"""Strict Excel ingestion for the Change Triage pipeline.

Reads the workbook with ``openpyxl`` and maps every raw header through a
validated normalized header map. Any unknown header fails fast with a
non-zero exit and no partial output is ever written.

One file-format tolerance is applied at the boundary: ``openpyxl`` in
``read_only`` mode trusts the worksheet ``<dimension>`` record, so a
stale/oversized range pads every row with ``None`` up to the declared
width. Only *trailing* empty header cells are trimmed; an empty or
unknown header in any non-trailing position still fails fast.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .utils import log_error, normalize_header

try:
    import openpyxl
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "openpyxl is required. It is installed once into the system Python "
        "reached by the 'py' launcher; run 'py Install-Dependencias.py' or "
        "follow Comandos-Prod.txt. This project never downloads at runtime."
    ) from exc

# Normalized header (whitespace-collapsed, uppercased) -> canonical snake_case key.
HEADER_MAP: dict[str, str] = {
    "TRIBU": "tribu",
    "SQUAD": "squad",
    "TICKET": "ticket",
    "NOMBRE APP": "nombre_app",
    "TIPO CAMBIO": "tipo_cambio",
    "DESCRIPCIÓN DEL CAMBIO": "descripcion_cambio",
    "FEC. HORA. INI. IMPL": "fec_hora_ini_impl",
    # Typo-08: source ships "FEC .HORA. FIN. IMPL" (extra space); the
    # whitespace collapse in normalize_header unifies both spellings here.
    "FEC .HORA. FIN. IMPL": "fec_hora_fin_impl",
    "FEC. HORA. INI. RATI": "fec_hora_ini_rati",
    "FEC. HORA. FIN. RATI": "fec_hora_fin_rati",
    "FEC. HORA. FIN. RATI. TOTAL": "fec_hora_fin_rati_total",
    "TIEMPO REVERSION": "tiempo_reversion",
    "FEC_HOR_INI_REVERSION": "fec_hor_ini_reversion",
    "FEC_HOR_FIN_REVERSION": "fec_hor_fin_reversion",
    "TIEMPO_RATIFICACION_REVERSION": "tiempo_ratificacion_reversion",
    "FEC_HOR_INI_RATI_REVE": "fec_hor_ini_rati_reve",
    "FEC_HOR_FIN_RATI_REVE": "fec_hor_fin_rati_reve",
    "CANALES/APP IMPACTADAS SEGÚN CVT": "canales_app_impactadas_segun_cvt",
    "COMPONENTES IMPACTADOS": "componentes_impactados",
    "CANALES/APP IMPACTADAS SEGÚN SQUAD": "canales_app_impactadas_segun_squad",
    "CANALES/APP A RATIFICAR": "canales_app_a_ratificar",
    "VISOR INCIDENTE": "visor_incidente",
    "FORMATOS EJE.": "formatos_eje",
    "NOMB/CELL CONTACTO IMPL": "nomb_cell_contacto_impl",
    "NOMB/CELL CONTACTO RATI": "nomb_cell_contacto_rati",
    "RECURSO": "recurso",
    "RECURSO ASIGNADO": "recurso_asignado",
    "FECHA DE REGISTRO": "fecha_registro",
    "TORRES REQUERIDAS": "torres_requeridas",
    "TORRES COORDINADAS": "torres_coordinadas",
    "IMPACTA OOR": "impacta_oor",
    # Second classification column. Shipped as "TIPO CAMBIO2" by the
    # pre-Table export; kept as a nullable field and never dropped. The
    # 2026-09 export repeats "TIPO CAMBIO" in this slot instead, which is
    # repaired positionally via POSITIONAL_HEADER_ALIASES. No longer always
    # null: 31 of 595 rows carry "Certificado" here.
    "TIPO CAMBIO2": "tipo_cambio2",
    "REQUIERE USUARIO ROOT": "requiere_usuario_root",
    "ESTADO ACTUAL": "estado_actual",
}

EXPECTED_COLUMN_COUNT = len(HEADER_MAP)

# 1-based column position -> the header spelling the export SHOULD have used.
#
# HEADER_MAP is name-keyed, so a duplicated header name cannot be repaired
# with a plain dict entry: the 2026-09 export writes "TIPO CAMBIO" in
# column 32, byte-identical to column 5. Evidence that this is an export
# typo rather than a semantic removal:
#   * column 32 is the exact position the pre-Table export used for
#     "TIPO CAMBIO2", and the other 33 headers are unchanged in both
#     spelling and position;
#   * 31 of the 595 rows populate it with "Certificado" (18 Cambio Menor,
#     6 Cambio Estandar Automatizado, 4 Cambio Documentario, 3 Cambio Mayor);
#   * every one of those 31 rows ALSO carries a primary "TIPO CAMBIO"
#     value, so the column is a second classification, not a replacement.
#
# Deliberately a single-position table, not a general aliasing framework:
# every new entry needs the same position-and-coexistence evidence.
POSITIONAL_HEADER_ALIASES: dict[int, str] = {
    32: "TIPO CAMBIO2",
}


class HeaderDriftError(ValueError):
    """Raised when the workbook headers do not match the strict map."""


@dataclass(frozen=True)
class RawTable:
    columns: tuple[str, ...]
    rows: tuple[dict[str, object], ...]
    # Workbook ``dcterms:modified`` core property, naive UTC as openpyxl
    # exposes it. ``None`` when the metadata is absent or unreadable; the
    # caller is responsible for the timezone tag and any fallback.
    source_modified_utc: datetime | None = None


def _resolve_duplicate_headers(
    raw_headers: list[object], canonical: list[str]
) -> list[str]:
    """Repair aliased duplicate headers, or raise on an unrepairable one.

    ``HEADER_MAP`` is name-keyed, so two header cells spelled the same way
    collapse onto one canonical key. Left alone, ``dict(zip(...))`` would
    silently drop one of them and surface two layers down as a confusing
    ``SchemaError: key mismatch``. Here a duplicate is repaired only when
    its column position is covered by :data:`POSITIONAL_HEADER_ALIASES` and
    the alias target is not already taken; anything else fails fast here,
    at the header layer, with the positions and raw values named.

    ``raw_headers`` and ``canonical`` are index-aligned: the caller rejects
    unknown headers before calling, so every raw cell produced a key.
    """
    positions: dict[str, list[int]] = {}
    for index, key in enumerate(canonical):
        positions.setdefault(key, []).append(index + 1)

    resolved = list(canonical)
    # Canonical keys already claimed by a unique column, so an alias can
    # never steal one.
    taken = {key for key, columns in positions.items() if len(columns) == 1}

    for key, columns in positions.items():
        if len(columns) < 2:
            continue
        first, *rest = columns
        taken.add(key)
        for position in rest:
            spelling = POSITIONAL_HEADER_ALIASES.get(position)
            alias_key = (
                None if spelling is None else HEADER_MAP.get(normalize_header(spelling))
            )
            if alias_key is None or alias_key in taken:
                raise HeaderDriftError(
                    f"header drift: duplicate column {key!r} at positions "
                    f"{first} and {position} "
                    f"(raw: {raw_headers[first - 1]!r} and "
                    f"{raw_headers[position - 1]!r}); expected {key!r} only once"
                )
            resolved[position - 1] = alias_key
            taken.add(alias_key)
    return resolved


def map_headers(raw_headers: list[object]) -> list[str]:
    """Map raw headers to canonical keys; raise on any drift."""
    canonical: list[str] = []
    unknown: list[str] = []
    for header in raw_headers:
        normalized = normalize_header(header)
        key = HEADER_MAP.get(normalized)
        if key is None:
            unknown.append(normalized or "<empty>")
        else:
            canonical.append(key)
    if unknown:
        log_error(f"unmapped headers ({len(unknown)}): {', '.join(unknown)}")
        raise HeaderDriftError(
            f"header drift: {len(unknown)} unmapped header(s): "
            + ", ".join(unknown)
        )
    # Unknown headers are rejected above, so this keeps index alignment.
    canonical = _resolve_duplicate_headers(raw_headers, canonical)
    if len(canonical) != EXPECTED_COLUMN_COUNT:
        raise HeaderDriftError(
            f"header drift: expected {EXPECTED_COLUMN_COUNT} columns, "
            f"got {len(canonical)}"
        )
    return canonical


def _trim_trailing_empty_headers(raw_headers: list[object]) -> list[object]:
    """Return ``raw_headers`` without its trailing empty cells.

    ``openpyxl``'s ``read_only`` reader trusts the worksheet
    ``<dimension>`` record rather than recomputing the used range, so an
    oversized dimension pads the header row (and every data row) with
    ``None`` out to the declared width. A cell counts as empty when
    :func:`normalize_header` yields ``""``, which covers both ``None``
    (padding) and whitespace-only cells.

    Only the *trailing* run is removed. An empty or unknown cell at any
    non-trailing position survives the trim and is still rejected by
    :func:`map_headers`, so genuine header drift keeps failing fast.
    """
    end = len(raw_headers)
    while end > 0 and normalize_header(raw_headers[end - 1]) == "":
        end -= 1
    return raw_headers[:end]


def _read_source_modified(workbook: object) -> datetime | None:
    """Return the workbook's internal ``properties.modified`` (naive UTC).

    openpyxl surfaces the ``dcterms:modified`` core property as a naive
    datetime in UTC. Missing or malformed metadata yields ``None`` so the
    caller can fall back to the filesystem mtime.
    """
    try:
        modified = workbook.properties.modified
    except Exception:  # pragma: no cover - openpyxl property guard
        return None
    return modified if isinstance(modified, datetime) else None


def read_workbook(path: Path, sheet: str) -> RawTable:
    """Read rows keyed by canonical header; fail fast on drift."""
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        if sheet not in workbook.sheetnames:
            raise HeaderDriftError(
                f"sheet {sheet!r} not found (sheets: {', '.join(workbook.sheetnames)})"
            )
        source_modified = _read_source_modified(workbook)
        worksheet = workbook[sheet]
        iterator = worksheet.iter_rows(values_only=True)
        raw_headers = list(next(iterator, []))
        # Boundary tolerance only: drop a dirty-dimension trailing pad, then
        # map strictly. ``columns`` is trimmed, so the padded data rows are
        # truncated by ``strict=False`` in the zip below.
        columns = map_headers(_trim_trailing_empty_headers(raw_headers))
        rows = [
            dict(zip(columns, values, strict=False)) for values in iterator
        ]
    finally:
        workbook.close()
    return RawTable(
        columns=tuple(columns),
        rows=tuple(rows),
        source_modified_utc=source_modified,
    )
