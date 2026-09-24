#Requires -Version 5.1
<#
.SYNOPSIS
  Instala/verifica las dependencias de Change Triage en Windows.
.DESCRIPTION
  - Python 3.x (requerido para el pipeline y el bundle).
  - uv via 'py -m uv' (resuelve openpyxl/tzdata/pytest automaticamente al correr run.bat).
  - Node.js LTS (opcional, solo para el smoke de frontend).
  Ejecutar desde la raiz del repo:
    powershell -ExecutionPolicy Bypass -File .\Install-Dependencias.ps1
#>
$ErrorActionPreference = "Stop"

function Test-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "[1/3] Python..." -ForegroundColor Cyan
if (Test-Cmd "python") {
  Write-Host ("  OK: " + (python --version 2>&1))
} else {
  Write-Host "  Instalando Python 3 con winget..." -ForegroundColor Yellow
  winget install --exact --silent --accept-source-agreements --accept-package-agreements Python.Python.3.12
  Write-Host "  Listo. Cerra y reabri la terminal para que tome el PATH."
}

Write-Host "[2/3] uv (via py -m uv)..." -ForegroundColor Cyan
if (Test-Cmd "py") {
  $uvVersion = (py -m uv --version 2>&1)
  if ($LASTEXITCODE -eq 0) {
    Write-Host ("  OK: " + $uvVersion)
  } else {
    Write-Host "  Instalando uv como modulo Python..." -ForegroundColor Yellow
    py -m pip install uv
    Write-Host "  Listo. Si falla por permisos, corre la terminal como Administrador."
  }
} else {
  Write-Host "  [ERROR] 'py' no encontrado en PATH. Instala Python 3.x primero y reintenta." -ForegroundColor Red
}

Write-Host "[3/3] Node.js (opcional)..." -ForegroundColor Cyan
if (Test-Cmd "node") {
  Write-Host ("  OK: " + (node --version 2>&1))
} else {
  Write-Host "  Node no encontrado (opcional: solo para scripts/smoke.mjs)." -ForegroundColor Yellow
  $answer = Read-Host "  Instalar Node LTS con winget? [S/n]"
  if ($answer -eq "" -or $answer -match "^[SsYy]") {
    winget install --exact --silent --accept-source-agreements --accept-package-agreements OpenJS.NodeJS.LTS
    Write-Host "  Listo. Cerra y reabri la terminal para que tome el PATH."
  } else {
    Write-Host "  Omitido: run.bat saltea el smoke si no hay Node."
  }
}

Write-Host ""
Write-Host "[DONE] Siguiente paso: copia ControlPases.xlsx a workspace\input y corre .\run.bat" -ForegroundColor Green
