"""Project configuration with relative Linux-safe paths.

Reads ``config.yaml`` from the repository root using only the standard
library. All configured paths are relative to the repo root so the
pipeline and the static SPA stay portable (SharePoint upload, CI).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULTS = {
    "paths.input_dir": "workspace/input",
    "paths.output_dir": "workspace/output",
    "paths.data_file": "workspace/output/data.json",
    "paths.bundle_dir": "workspace/output/data",
    "paths.logs_dir": "workspace/logs",
    "paths.cache_dir": "workspace/cache",
    "excel.pattern": "ControlPases*.xlsx",
    "excel.sheet": "Hoja1",
    "app.timezone": "America/Lima",
}


def _parse_simple_yaml(text: str) -> dict[str, str]:
    """Parse a flat ``section.key: value`` subset of YAML (2-space nesting)."""
    values: dict[str, str] = {}
    section = ""
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not raw_line.startswith((" ", "\t")):
            section = line.rstrip(":").strip()
            continue
        if ":" not in line:
            continue
        key, _, value = line.strip().partition(":")
        value = value.strip().strip('"').strip("'")
        values[f"{section}.{key.strip()}"] = value
    return values


def load_config(path: Path | None = None) -> dict[str, str]:
    """Load config values, falling back to defaults for missing keys."""
    config = dict(DEFAULTS)
    config_path = path or REPO_ROOT / "config.yaml"
    if config_path.is_file():
        config.update(_parse_simple_yaml(config_path.read_text(encoding="utf-8")))
    return config


@dataclass(frozen=True)
class Settings:
    input_dir: Path
    output_dir: Path
    data_file: Path
    bundle_dir: Path
    logs_dir: Path
    cache_dir: Path
    excel_pattern: str
    excel_sheet: str
    timezone: str

    @classmethod
    def from_config(cls, config: dict[str, str] | None = None) -> "Settings":
        values = dict(DEFAULTS)
        if config:
            values.update(config)

        def _path(key: str) -> Path:
            raw = values[key].lstrip("/")
            return REPO_ROOT / Path(*Path(raw).parts)

        return cls(
            input_dir=_path("paths.input_dir"),
            output_dir=_path("paths.output_dir"),
            data_file=_path("paths.data_file"),
            bundle_dir=_path("paths.bundle_dir"),
            logs_dir=_path("paths.logs_dir"),
            cache_dir=_path("paths.cache_dir"),
            excel_pattern=values["excel.pattern"],
            excel_sheet=values["excel.sheet"],
            timezone=values["app.timezone"],
        )


def find_workbook(settings: Settings) -> Path | None:
    """Return the first workbook matching the pattern, or None."""
    matches = sorted(settings.input_dir.glob(settings.excel_pattern))
    return matches[0] if matches else None
