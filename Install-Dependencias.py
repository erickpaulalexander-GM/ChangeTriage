"""Verifica las dependencias de Change Triage en Windows.

Reemplaza a Install-Dependencias.ps1 (eliminado: PowerShell bloquea los
.ps1 en la PC del banco/prod). Uso desde la raiz del repo:

    py Install-Dependencias.py

Pasos:
- [1/3] Python 3.x (requerido para el pipeline y el bundle).
- [2/3] Reporta el estado de openpyxl/tzdata/pytest en el Python del sistema
        al que apunta el launcher 'py'. NO descarga nada: si falta algun
        paquete, indica seguir Comandos-Prod.txt, que es la unica via
        soportada (el banco bloqueo uv y la carpeta 'wheels' esta en
        .gitignore, asi que nunca llega a la PC del banco).
- [3/3] Node.js LTS (opcional, solo para el smoke de frontend).
"""

from __future__ import annotations

import shutil
import subprocess
import sys

PACKAGES = ["openpyxl", "tzdata", "pytest"]


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


def check_installed() -> list[str]:
    """Return the package names not importable in the default 'py' Python."""
    missing = []
    for pkg in PACKAGES:
        code, _ = capture(["py", "-c", "import %s" % pkg])
        if code != 0:
            missing.append(pkg)
    return missing


def report_missing(missing: list[str]) -> None:
    """Point the user at Comandos-Prod.txt; never download from here."""
    label = ", ".join(missing)
    print("  FALTAN: %s" % label)
    print("  Este script no descarga nada. Segui Comandos-Prod.txt:")
    print("    py -c \"import openpyxl, tzdata, pytest; print('deps OK')\"")
    print("    py -m pip install -r requirements.txt")
    print("  Si la red/proxy del banco bloquea PyPI, pedi a TI que los")
    print("  instale. No hay carpeta 'wheels' en la PC del banco (esta en")
    print("  .gitignore), y uv esta bloqueado: no los uses.")


def main() -> int:
    failures = 0

    print("[1/3] Python...")
    if has_cmd("py"):
        _, version = capture(["py", "--version"])
        print("  OK: %s" % (version or "py disponible"))
    elif has_cmd("python"):
        _, version = capture(["python", "--version"])
        print("  OK: %s (ojo: run.py usa el launcher 'py')"
              % (version or "python disponible"))
    else:
        print("  Python no encontrado. Intentando instalar Python 3.12...")
        if not winget_install("Python.Python.3.12", "Python 3.12"):
            failures += 1

    print("[2/3] Paquetes openpyxl/tzdata/pytest...")
    missing = check_installed() if has_cmd("py") else PACKAGES
    if not missing:
        print("  OK: ya estan importables en el Python de 'py'.")
    else:
        report_missing(missing)
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
            print("  Omitido: run.py saltea el smoke si no hay Node.")

    print("")
    next_step = "copia ControlPases.xlsx a workspace\\input y corre py run.py"
    if failures:
        print("[PENDIENTE] Revisa lo de arriba. Luego: %s" % next_step)
        return 1
    print("[DONE] Siguiente paso: %s" % next_step)
    return 0


if __name__ == "__main__":
    sys.exit(main())