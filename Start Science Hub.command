#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ ! -x .venv/bin/python || ! -f .venv/.science-hub-ready || ! -f frontend/dist/index.html ]]; then
  python3 setup.py
fi
exec .venv/bin/python run.py
