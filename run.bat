@echo off
REM Change Triage MVP runner (Windows).
REM Flow: stage workbook -^> pipeline -^> single-file bundle -^> backend tests -^> frontend smoke.
REM No server is started (prod is static hosting): triage.html is left updated
REM and you upload that single file to the SharePoint library (like dashboard.html).
setlocal enabledelayedexpansion

cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 'uv' not found. Install it from https://docs.astral.sh/uv/ and retry.
  goto :fail
)
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 'python' not found on PATH. Install Python 3.x and retry.
  goto :fail
)

REM 1. Workbook must be staged (never committed; *.xlsx is gitignored).
if not exist "workspace\input\ControlPases*.xlsx" (
  echo [ERROR] No workbook found in workspace\input.
  echo         Copy ControlPases.xlsx into workspace\input and retry.
  goto :fail
)

REM 2. Pipeline: Excel -^> workspace\output\data.json (America/Lima ISO, fails fast on drift).
echo [1/4] Running pipeline...
uv run --with openpyxl --with tzdata python backend\generar_data.py
if errorlevel 1 (
  echo [ERROR] Pipeline failed. See output above.
  goto :fail
)

REM 2b. Stage the bundle copy next to the SPA (same layout SharePoint folder mode needs).
if not exist "frontend\data" mkdir "frontend\data"
copy /y "workspace\output\data.json" "frontend\data\data.json" >nul
if errorlevel 1 (
  echo [ERROR] Could not stage data.json into frontend\data.
  goto :fail
)

REM 3. Bundle: inline css/js/img + data.json into workspace\output\triage.html
REM    (stdlib only, so plain python; works from the SharePoint library and file://).
echo [2/4] Building single-file bundle...
python backend\bundle_single.py
if errorlevel 1 (
  echo [ERROR] Bundle failed. See output above.
  goto :fail
)

echo [3/4] Running backend tests...
uv run --with pytest --with openpyxl --with tzdata pytest backend\tests -q
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

echo [DONE] Upload workspace\output\triage.html to the SharePoint library (single file, like dashboard.html).
pause
exit /b 0

:fail
echo.
echo [FAILED] See the error above. The window stays open so you can read it.
pause
exit /b 1
