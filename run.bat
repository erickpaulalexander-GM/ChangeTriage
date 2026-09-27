@echo off
REM DEPRECATED: thin shim kept for reference and legacy habits only.
REM The bank PC blocks .bat execution by corporate policy, so the entry
REM point is now 'py run.py'. All flow logic lives in run.py; this file
REM only forwards to it (passing any arguments through) so the two can
REM never drift apart.
REM Flow (owned by run.py): stage workbook -> pipeline -> single-file
REM bundle -> backend tests -> frontend smoke. No server is started
REM (prod is static hosting): triage.html is left updated and you upload
REM that single file to the SharePoint library (like dashboard.html).
REM OFFLINE: openpyxl, tzdata and pytest are installed ONCE into the system
REM Python (see Comandos-Prod.txt). Nothing here downloads anything.
setlocal

cd /d "%~dp0"

py --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python launcher 'py' not found. Install Python 3.x and retry.
  exit /b 1
)

REM %* forwards flags, e.g. run.bat --skip-tests
py run.py %*
exit /b %errorlevel%
