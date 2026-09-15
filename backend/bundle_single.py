"""Bundle the SPA into a single self-contained ``triage.html``.

Reads ``frontend/index.html`` plus its linked CSS/JS files, ``<img>`` files,
and ``workspace/output/data.json``; emits ``workspace/output/triage.html``
with styles/scripts inlined, images as base64 data URIs, and the data
payload injected as ``window.TRIAGE_DATA`` before ``app.js``.

The output works both opened from a SharePoint library and via local
double-click (``file://``): zero ``fetch``/XHR dependency at runtime.

Standard library only. Exits non-zero with a clear message if any input is
missing, and never leaves partial output (temp file + atomic replace).
Logs carry counts/paths only — never row values.
"""

from __future__ import annotations

import base64
import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import REPO_ROOT, Settings, load_config  # noqa: E402
from backend.utils import log_error, log_info  # noqa: E402

TAG_LINK = re.compile(
    r'<link\b[^>]*\bhref="(?P<href>[^"]+)"[^>]*>', re.IGNORECASE
)
TAG_SCRIPT_SRC = re.compile(
    r'<script\b[^>]*\bsrc="(?P<src>[^"]+)"[^>]*>\s*</script>',
    re.IGNORECASE,
)
TAG_IMG_SRC = re.compile(
    r'<img\b[^>]*\bsrc="(?P<src>[^"]+)"', re.IGNORECASE
)
REMAINING_LOCAL_REF = re.compile(
    r'<(?:link|script|img)\b[^>]*(?:src|href)="(?!(?:data:|https?://|#))',
    re.IGNORECASE,
)

MIME_BY_SUFFIX = {
    ".css": "text/css",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}


def _fail(message: str) -> int:
    log_error(f"[bundle-single] {message}")
    return 1


def _read_text(path: Path, label: str) -> str | None:
    if not path.is_file():
        log_error(f"[bundle-single] missing {label}: {path} (rows=0, output=none)")
        return None
    return path.read_text(encoding="utf-8")


def _read_bytes(path: Path, label: str) -> bytes | None:
    if not path.is_file():
        log_error(f"[bundle-single] missing {label}: {path} (rows=0, output=none)")
        return None
    return path.read_bytes()


def _guard_no_closing_tag(source: str, tag: str, path: Path) -> bool:
    """Refuse to inline code that would terminate its host element early."""
    if re.search(r"</" + tag + r"[\s>]", source, re.IGNORECASE):
        log_error(
            f"[bundle-single] {path} contains a literal '</{tag}' sequence; "
            "refusing to inline (rows=0, output=none)"
        )
        return False
    return True


def run(settings: Settings) -> int:
    frontend_dir = REPO_ROOT / "frontend"
    index_path = frontend_dir / "index.html"
    html = _read_text(index_path, "entry page")
    if html is None:
        return 1

    data_text = _read_text(settings.data_file, "data payload")
    if data_text is None:
        return 1
    try:
        payload = json.loads(data_text)
    except json.JSONDecodeError as exc:
        return _fail(f"data.json is not valid JSON: {exc} (rows=0, output=none)")
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return _fail("data.json contract violation: expected {generated_at, count, rows[]} (rows=0, output=none)")
    row_count = len(payload["rows"])

    css_count = js_count = img_count = 0

    def _inline_css(match: re.Match[str]) -> str:
        nonlocal css_count
        href = match.group("href")
        if href.startswith(("http://", "https://", "data:")):
            return match.group(0)
        css_path = (frontend_dir / href).resolve()
        if frontend_dir.resolve() not in css_path.parents:
            raise _BundleError(f"CSS reference escapes frontend/: {href!r}")
        text = _read_text(css_path, "stylesheet")
        if text is None:
            raise _BundleError(f"missing stylesheet: {css_path}")
        if not _guard_no_closing_tag(text, "style", css_path):
            raise _BundleError(f"unsafe stylesheet content: {css_path}")
        css_count += 1
        return "<style>\n" + text + "\n</style>"

    def _inline_img(match: re.Match[str]) -> str:
        nonlocal img_count
        full_tag = match.group(0)
        src = match.group("src")
        if src.startswith(("http://", "https://", "data:")):
            return full_tag
        img_path = (frontend_dir / src).resolve()
        if frontend_dir.resolve() not in img_path.parents:
            raise _BundleError(f"image reference escapes frontend/: {src!r}")
        raw = _read_bytes(img_path, "image")
        if raw is None:
            raise _BundleError(f"missing image: {img_path}")
        mime = MIME_BY_SUFFIX.get(img_path.suffix.lower(), "application/octet-stream")
        encoded = base64.b64encode(raw).decode("ascii")
        img_count += 1
        return full_tag.replace(src, f"data:{mime};base64,{encoded}", 1)

    # Inline images first so <img> tags inside later replacements stay intact.
    try:
        html = TAG_IMG_SRC.sub(_inline_img, html)
        html = TAG_LINK.sub(_inline_css, html)
    except _BundleError as exc:
        return _fail(f"{exc} (rows=0, output=none)")

    # Scripts are inlined in document order so execution order is preserved;
    # the data payload goes immediately BEFORE the app.js block.
    data_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # `</` only occurs inside JSON string literals, where `\/` is a valid
    # escape for `/`, so this cannot corrupt the payload structure.
    data_json = data_json.replace("</", "<\\/")
    data_block = "<script>\nwindow.TRIAGE_DATA = " + data_json + ";\n</script>"

    scripts = list(TAG_SCRIPT_SRC.finditer(html))
    if not scripts:
        return _fail("no <script src> tags found in index.html (rows=0, output=none)")
    app_hits = [m for m in scripts if m.group("src").lower().endswith("app.js")]
    if not app_hits:
        return _fail("app.js <script src> not found in index.html (rows=0, output=none)")

    def _inline_js(match: re.Match[str]) -> str:
        nonlocal js_count
        src = match.group("src")
        if src.startswith(("http://", "https://", "data:")):
            return match.group(0)
        js_path = (frontend_dir / src).resolve()
        if frontend_dir.resolve() not in js_path.parents:
            raise _BundleError(f"script reference escapes frontend/: {src!r}")
        text = _read_text(js_path, "script")
        if text is None:
            raise _BundleError(f"missing script: {js_path}")
        if not _guard_no_closing_tag(text, "script", js_path):
            raise _BundleError(f"unsafe script content: {js_path}")
        js_count += 1
        block = "<script>\n" + text + "\n</script>"
        if src.lower().endswith("app.js"):
            block = data_block + "\n  " + block
        return block

    try:
        html = TAG_SCRIPT_SRC.sub(_inline_js, html)
    except _BundleError as exc:
        return _fail(f"{exc} (rows=0, output=none)")

    leftover = REMAINING_LOCAL_REF.search(html)
    if leftover:
        return _fail(
            "unresolved local src/href reference remains after inlining "
            f"(near: {leftover.group(0)[:80]!r}) (rows=0, output=none)"
        )

    output_path = settings.output_dir / "triage.html"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(output_path.parent),
            prefix="triage-",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(html)
        Path(tmp_path).replace(output_path)
    except OSError as exc:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        return _fail(f"could not write {output_path}: {exc} (rows=0, output=none)")

    size = output_path.stat().st_size
    log_info(
        f"[bundle-single] done css={css_count} js={js_count} img={img_count} "
        f"rows={row_count} bytes={size} output={output_path} errors=0"
    )
    return 0


class _BundleError(Exception):
    """Internal control flow: abort the bundle with a clear message."""


def main() -> int:
    settings = Settings.from_config(load_config())
    return run(settings)


if __name__ == "__main__":
    raise SystemExit(main())
