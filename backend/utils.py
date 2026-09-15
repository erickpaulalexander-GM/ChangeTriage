"""Shared helpers: header normalization and count-only logging.

Production-data rule: helpers here never log cell values. Log messages
carry counts, paths, and error classes only.
"""

from __future__ import annotations

import re
import sys

_WHITESPACE_RUN = re.compile(r"\s+")


def normalize_header(value: object) -> str:
    """Collapse whitespace runs and uppercase for header-map lookup.

    This collapses the known typo-08 spacing drift (``FEC .HORA. FIN. IMPL``)
    so it resolves to the same canonical key as the correctly spaced form.
    """
    text = "" if value is None else str(value)
    return _WHITESPACE_RUN.sub(" ", text.strip()).upper()


def log_info(message: str) -> None:
    print(f"[info] {message}", file=sys.stderr)


def log_error(message: str) -> None:
    print(f"[error] {message}", file=sys.stderr)
