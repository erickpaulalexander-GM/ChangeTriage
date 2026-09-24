"""Instala/verifica las dependencias de Change Triage en Windows.

Port de Install-Dependencias.ps1 para la PC del banco (prod), donde
PowerShell bloquea la ejecucion de .ps1. Uso desde la raiz del repo:

    py Install-Dependencias.py

Pasos:
- [1/3] Python 3.x (requerido para el pipeline y el bundle).
- [2/3] uv via 'py -m uv' (resuelve openpyxl/tzdata/pytest al correr run.bat).
- [3/3] Node.js LTS (opcional, solo para el smoke de frontend).
"""

from __future__ import annotations

import shutil
import subprocess
import sys


def has_cmd(name: str) -> bool:
    return shutil.which(name) is not None


def capture(cmd: list[str]) -> tuple[int, str]:
    """Run a command, return (exit_code, first output line)."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        return 127, ""
    out = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    first = out.splitlines()[0].strip() if out else ""
    return proc.returncode, first


def winget_install(package: str, label: str) -> bool:
    if not has_cmd("winget"):
        print("  [ERROR] 'winget' no disponible; instala %s a mano." % label)
        return False
    print("  Instalando %s con winget..." % label)
    code, _ = capture([
        "winget", "install", "--exact", "--silent",
        "--accept-source-agreements", "--accept-package-agreements",
        package,
    ])
    if code != 0:
        print("  [ERROR] winget no pudo instalar %s. Probalo a mano." % label)
        return False
    print("  Listo. Cerra y reabri la terminal para que tome el PATH.")
    return True


def main() -> int:
    failures = 0

    print("[1/3] Python...")
    if has_cmd("py"):
        _, version = capture(["py", "--version"])
        print("  OK: %s" % (version or "py disponible"))
    elif has_cmd("python"):
        _, version = capture(["python", "--version"])
        print("  OK: %s (ojo: run.bat usa el launcher 'py')" % (version or "python disponible"))
    else:
        print("  Python no encontrado. Intentando instalar Python 3.12...")
        if not winget_install("Python.Python.3.12", "Python 3.12"):
            failures += 1

    print("[2/3] uv (via py -m uv)...")
    if has_cmd("py"):
        code, version = capture(["py", "-m", "uv", "--version"])
        if code == 0:
            print("  OK: %s" % version)
        else:
            print("  Instalando uv como modulo Python...")
            code, _ = capture(["py", "-m", "pip", "install", "uv"])
            if code != 0:
                print("  [ERROR] 'py -m pip install uv' fallo. Corre la terminal como Administrador y reintenta.")
                failures += 1
            else:
                print("  Listo.")
    else:
        print("  [ERROR] Sin 'py' no se puede verificar ni instalar uv.")
        failures += 1

    print("[3/3] Node.js (opcional)...")
    if has_cmd("node"):
        _, version = capture(["node", "--version"])
        print("  OK: %s" % (version or "node disponible"))
    else:
        print("  Node no encontrado (opcional: solo para scripts/smoke.mjs).")
        try:
            answer = input("  Instalar Node LTS con winget? [S/n] ").strip().lower()
        except EOFError:
            answer = "n"
        if answer in ("", "s", "y"):
            winget_install("OpenJS.NodeJS.LTS", "Node LTS")
        else:
            print("  Omitido: run.bat saltea el smoke si no hay Node.")

    print("")
    if failures:
        print("[PENDIENTE] Revisa los errores de arriba. Luego: copia ControlPases.xlsx a workspace\\input y corre run.bat")
        return 1
    print("[DONE] Siguiente paso: copia ControlPases.xlsx a workspace\\input y corre run.bat")
    return 0


if __name__ == "__main__":
    sys.exit(main())
