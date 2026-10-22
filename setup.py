#!/usr/bin/env python3
"""Bootstrap a local checkout or release archive without installing global packages."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def run(command, cwd=ROOT):
    subprocess.run(command, cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser(description="Установка Science Hub")
    parser.add_argument("--rebuild", action="store_true", help="Пересобрать веб-интерфейс")
    args = parser.parse_args()
    os.chdir(ROOT)
    if sys.version_info < (3, 11):
        raise SystemExit("Нужен Python 3.11 или новее.")
    uv = shutil.which("uv")
    if uv:
        run([uv, "sync", "--frozen"])
    else:
        environment = ROOT / ".venv"
        if not environment.exists():
            venv.create(environment, with_pip=True)
        python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        # pyproject is the dependency source; no packaging/build step is required.
        import tomllib

        dependencies = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]
        run([str(python), "-m", "pip", "install", *dependencies])
    if args.rebuild or not (ROOT / "frontend/dist/index.html").exists():
        npm = shutil.which("npm")
        if not npm:
            raise SystemExit(
                "Для сборки интерфейса установите Node.js 22+ или используйте архив с готовым frontend/dist."
            )
        run([npm, "ci"], ROOT / "frontend")
        run([npm, "run", "build"], ROOT / "frontend")
    if not (ROOT / ".env").exists():
        shutil.copyfile(ROOT / ".env.example", ROOT / ".env")
        os.chmod(ROOT / ".env", 0o600)
    (ROOT / ".venv" / ".science-hub-ready").write_text("0.1.0\n")
    print("Science Hub установлен. Запуск: .venv/bin/python run.py (Windows: .venv\\Scripts\\python run.py)")


if __name__ == "__main__":
    main()
