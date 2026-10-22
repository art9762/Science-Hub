#!/usr/bin/env python3
"""Start the local Science Hub server: uv run python run.py."""

import argparse
import json
import os
import threading
import webbrowser
from pathlib import Path
from urllib.request import urlopen

from dotenv import load_dotenv
import uvicorn


def main():
    load_dotenv(Path(__file__).parent / ".env")
    parser = argparse.ArgumentParser(description="Science Hub — локальная инженерная AI-среда")
    parser.add_argument("--port", type=int, default=int(os.getenv("SCIENCE_HUB_PORT", "8765")))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--reload", action="store_true", help="Reload Python files in development")
    args = parser.parse_args()
    os.environ["SCIENCE_HUB_PORT"] = str(args.port)
    if not args.reload:
        try:
            with urlopen(f"http://127.0.0.1:{args.port}/api/health", timeout=1) as response:
                running = json.load(response).get("application") == "science-hub"
        except Exception:
            running = False
        if running:
            print(f"Science Hub уже запущен: http://127.0.0.1:{args.port}")
            if not args.no_browser:
                webbrowser.open(f"http://127.0.0.1:{args.port}")
            return
    if not args.no_browser:
        timer = threading.Timer(1.4, webbrowser.open, args=(f"http://127.0.0.1:{args.port}",))
        timer.daemon = True
        timer.start()
    uvicorn.run("backend.app:create_app", factory=True, host="127.0.0.1", port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
