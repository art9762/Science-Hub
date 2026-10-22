"""Create a portable source + built UI archive; never include keys or user data."""

from pathlib import Path
import os
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_FILES = {
    "README.md",
    "API_CONTRACT.md",
    "pyproject.toml",
    "uv.lock",
    ".env.example",
    ".gitignore",
    "run.py",
    "setup.py",
    "Start Science Hub.command",
    "start.bat",
}
ALLOWED_DIRS = {"backend", "frontend", "docs", "scripts", "tests"}
BLOCKED_PARTS = {"node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", ".venv", ".git"}


def package():
    output = ROOT / "artifacts" / "ScienceHub.zip"
    output.parent.mkdir(exist_ok=True)
    if not (ROOT / "frontend/dist/index.html").exists():
        raise SystemExit("Build frontend first")
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for directory, subdirs, files in os.walk(ROOT):
            current = Path(directory)
            subdirs[:] = sorted(
                name
                for name in subdirs
                if name not in BLOCKED_PARTS
                and (current != ROOT or name in ALLOWED_DIRS)
                and not (current / name).is_symlink()
            )
            for name in sorted(files):
                path = current / name
                relative = path.relative_to(ROOT)
                if path.is_symlink() or name == ".DS_Store":
                    continue
                if name.startswith(".env") and relative != Path(".env.example"):
                    continue
                if current == ROOT and name not in ALLOWED_FILES:
                    continue
                if path.suffix not in {".pyc", ".log", ".tsbuildinfo"}:
                    archive.write(path, Path("ScienceHub") / relative)
    print(output)


if __name__ == "__main__":
    package()
