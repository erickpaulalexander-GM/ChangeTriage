"""Strict Excel ingestion for the Change Triage pipeline.

Reads the workbook with ``openpyxl`` and maps every raw header through a
validated normalized header map. Any unknown header fails fast with a
non-zero exit and no partial output is ever written.
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
        "openpyxl is required (install with: py -m uv run --with openpyxl --with tzdata ...)"
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
    # Phantom column: present in the workbook, always null so far. Kept as
    # a nullable field and never dropped.
    "TIPO CAMBIO2": "tipo_cambio2",
    "REQUIERE USUARIO ROOT": "requiere_usuario_root",
    "ESTADO ACTUAL": "estado_actual",
}

EXPECTED_COLUMN_COUNT = len(HEADER_MAP)


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
    if len(canonical) != EXPECTED_COLUMN_COUNT:
        raise HeaderDriftError(
            f"header drift: expected {EXPECTED_COLUMN_COUNT} columns, "
            f"got {len(canonical)}"
        )
    return canonical


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
        columns = map_headers(raw_headers)
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
