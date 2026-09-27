"""Change Triage runner: the pure-Python entry point.

Replaces ``run.bat`` as the way to run the whole pipeline. It exists because
corporate policy on the bank PC refuses to execute ``.bat`` files, and it
calls the same stages in the same order:

1. Resolve the paths from ``config.yaml`` (DEV defaults or absolute PROD
   paths) and refuse to continue when no workbook is staged.
2. ``backend/generar_data.py``  -> ``workspace/output/data.json``.
3. Stage that copy next to the SPA (``frontend/data/data.json``), which is
   the layout the SharePoint folder mode needs.
4. ``backend/bundle_single.py`` -> ``workspace/output/triage.html``.
5. ``pytest backend/tests``.
6. ``node scripts/smoke.mjs``, skipped with a warning when Node is absent.

Any failed stage propagates a non-zero exit code and stops the run. No
server is started: ``triage.html`` is left updated and that single file is
what you upload to the SharePoint library (like ``dashboard.html``).

OFFLINE: ``openpyxl``, ``tzdata`` and ``pytest`` are installed once into the
system Python reached by the ``py`` launcher (see ``Comandos-Prod.txt``).
This script never downloads anything, never shells out to ``cmd``/``.bat``,
and never invokes ``uv``.

Usage::

    py run.py                  # full flow, tests included
    py run.py --skip-tests     # fast production run
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend import bundle_single, generar_data  # noqa: E402
from backend.config import Settings, find_workbook, load_config  # noqa: E402

STAGED_DATA = REPO_ROOT / "frontend" / "data" / "data.json"
TESTS_TARGET = Path("backend") / "tests"
SMOKE_SCRIPT = Path("scripts") / "smoke.mjs"


def _fail(message: str) -> int:
    print(f"[ERROR] {message}")
    return 1


def _spawn(command: list[str]) -> int:
    """Run a child process, mapping a launch failure to a non-zero code."""
    try:
        return subprocess.call(command, cwd=str(REPO_ROOT))
    except OSError as exc:
        print(f"[ERROR] could not run {command[0]}: {exc}")
        return 127


def _stage_pipeline() -> int:
    """Excel -> data.json. Fails fast on header drift or bad dates."""
    print("[1/4] Running pipeline...")
    if generar_data.main() != 0:
        return _fail("Pipeline failed. See output above.")
    return 0


def _stage_bundle_copy(data_file: Path) -> int:
    """Copy data.json next to the SPA (SharePoint folder-mode layout)."""
    STAGED_DATA.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copyfile(data_file, STAGED_DATA)
    except OSError as exc:
        return _fail(f"Could not stage {data_file} into {STAGED_DATA}: {exc}")
    return 0


def _stage_bundle() -> int:
    """Inline css/js/img + data.json into the single-file bundle."""
    print("[2/4] Building single-file bundle...")
    if bundle_single.main() != 0:
        return _fail("Bundle failed. See output above.")
    return 0


def _stage_backend_tests() -> int:
    """Run the checked-in pytest suite.

    ``sys.executable`` is the very interpreter running this script, so the
    suite always runs against the same environment instead of re-resolving
    the ``py`` launcher.
    """
    print("[3/4] Running backend tests...")
    if _spawn([sys.executable, "-m", "pytest", str(TESTS_TARGET), "-q"]) != 0:
        return _fail("Backend tests failed. See output above.")
    return 0


def _stage_frontend_smoke() -> int:
    """Run the frontend smoke, or warn and skip it when Node is missing."""
    if shutil.which("node") is None:
        print("[WARN] 'node' not found. Skipping frontend smoke.")
        return 0
    print("[4/4] Running frontend smoke...")
    if _spawn(["node", str(SMOKE_SCRIPT)]) != 0:
        return _fail("Frontend smoke failed. See output above.")
    return 0


def run_flow(settings: Settings, skip_tests: bool = False) -> int:
    """Run every stage in order, returning the first non-zero exit code."""
    workbook = find_workbook(settings)
    if workbook is None:
        return _fail(
            f"No workbook matching {settings.excel_pattern} in "
            f"{settings.input_dir}.\n"
            "        Copy ControlPases.xlsx into your configured input dir "
            "and retry."
        )

    for stage in (
        _stage_pipeline,
        lambda: _stage_bundle_copy(settings.data_file),
        _stage_bundle,
    ):
        code = stage()
        if code != 0:
            return code

    if skip_tests:
        print("[3/4] Skipped (--skip-tests).")
        print("[4/4] Skipped (--skip-tests).")
        return 0

    for stage in (_stage_backend_tests, _stage_frontend_smoke):
        code = stage()
        if code != 0:
            return code
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="run.py",
        description=(
            "Run the Change Triage pipeline end to end: workbook -> "
            "data.json -> single-file bundle -> tests -> frontend smoke."
        ),
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help=(
            "Skip the backend pytest suite and the frontend smoke, for a "
            "fast production run that only rebuilds the output."
        ),
    )
    args = parser.parse_args(argv)

    settings = Settings.from_config(load_config())
    code = run_flow(settings, skip_tests=args.skip_tests)
    if code != 0:
        print("")
        print("[FAILED] See the error above.")
        return code
    print(
        f"[DONE] Upload {settings.output_dir / 'triage.html'} to the "
        "SharePoint library (single file, like dashboard.html)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
