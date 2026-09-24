@echo off
REM Change Triage MVP runner (Windows).
REM Flow: stage workbook -^> pipeline -^> single-file bundle -^> backend tests -^> frontend smoke.
REM No server is started (prod is static hosting): triage.html is left updated
REM and you upload that single file to the SharePoint library (like dashboard.html).
setlocal enabledelayedexpansion

REM Use the Windows system certificate store (corporate TLS-inspection proxies
REM sign with an internal root that uv would otherwise reject as UnknownIssuer).
set UV_SYSTEM_CERTS=true

cd /d "%~dp0"

py -m uv --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 'py -m uv' not found. Install it with 'py -m pip install uv' ^(or https://docs.astral.sh/uv/^) and retry.
  goto :fail
)
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 'python' not found on PATH. Install Python 3.x and retry.
  goto :fail
)

REM 0. Resolve paths from config.yaml (DEV defaults or absolute PROD paths).
REM    backend.config is stdlib-only, so plain python needs no downloads.
for /f "delims=" %%P in ('py -m uv run python -c "from backend.config import load_config,Settings; print(Settings.from_config(load_config()).input_dir)"') do set INPUT_DIR=%%P
if errorlevel 1 (
  echo [ERROR] Could not read paths.input_dir from config.yaml.
  goto :fail
)
for /f "delims=" %%P in ('py -m uv run python -c "from backend.config import load_config,Settings; print(Settings.from_config(load_config()).excel_pattern)"') do set EXCEL_PATTERN=%%P
for /f "delims=" %%P in ('py -m uv run python -c "from backend.config import load_config,Settings; print(Settings.from_config(load_config()).data_file)"') do set DATA_FILE=%%P
for /f "delims=" %%P in ('py -m uv run python -c "from backend.config import load_config,Settings; print(Settings.from_config(load_config()).output_dir)"') do set OUTPUT_DIR=%%P

REM 1. Workbook must be staged (never committed; *.xlsx is gitignored).
if not exist "%INPUT_DIR%\%EXCEL_PATTERN%" (
  echo [ERROR] No workbook matching %EXCEL_PATTERN% in %INPUT_DIR%.
  echo         Copy ControlPases.xlsx into your configured input dir and retry.
  goto :fail
)

REM 2. Pipeline: Excel -^> workspace\output\data.json (America/Lima ISO, fails fast on drift).
echo [1/4] Running pipeline...
py -m uv run --with openpyxl --with tzdata python backend\generar_data.py
if errorlevel 1 (
  echo [ERROR] Pipeline failed. See output above.
  goto :fail
)

REM 2b. Stage the bundle copy next to the SPA (same layout SharePoint folder mode needs).
if not exist "frontend\data" mkdir "frontend\data"
copy /y "%DATA_FILE%" "frontend\data\data.json" >nul
if errorlevel 1 (
  echo [ERROR] Could not stage %DATA_FILE% into frontend\data.
  goto :fail
)

REM 3. Bundle: inline css/js/img + data.json into workspace\output\triage.html
REM    (stdlib only, so plain python; works from the SharePoint library and file://).
echo [2/4] Building single-file bundle...
py -m uv run python backend\bundle_single.py
if errorlevel 1 (
  echo [ERROR] Bundle failed. See output above.
  goto :fail
)

echo [3/4] Running backend tests...
py -m uv run --with pytest --with openpyxl --with tzdata pytest backend\tests -q
if errorlevel 1 (
  echo [ERROR] Backend tests failed. See output above.
  goto :fail
)

REM 5. Frontend smoke (real search.js/export.js on synthetic rows).
where node >nul 2>nul
if errorlevel 1 (
  echo [WARN] 'node' not found. Skipping frontend smoke.
) else (
  echo [4/4] Running frontend smoke...
  node scripts\smoke.mjs
  if errorlevel 1 (
    echo [ERROR] Frontend smoke failed. See output above.
    goto :fail
  )
)

echo [DONE] Upload %OUTPUT_DIR%\triage.html to the SharePoint library (single file, like dashboard.html).
pause
exit /b 0

:fail
echo.
echo [FAILED] See the error above. The window stays open so you can read it.
pause
exit /b 1
