# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Paths and settings. Everything can be overridden with environment variables."""

import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_env_file(name: str) -> None:
    """Reads KEY=value lines from a file next to the project, without overriding real variables."""
    try:
        lines = (ROOT / name).read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_file(".env.local")
_load_env_file(".env")

# The library: one JSON file plus the media files. Single user, no login.
DATA = Path(os.environ.get("NEONREEL_DATA") or ROOT / ".data")
FILES = DATA / "files"
DB = DATA / "db.json"

#: The built user interface (see frontend/).
FRONTEND = ROOT / "frontend" / "dist"

PORT = int(os.environ.get("PORT") or 4000)
COMFY_URL = (os.environ.get("COMFY_URL") or "http://127.0.0.1:8188").rstrip("/")
OLLAMA_URL = (os.environ.get("OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL") or ""
FAL_KEY = os.environ.get("FAL_KEY") or ""


def now_ms() -> int:
    """Current time in milliseconds, the unit every timestamp in the library uses."""
    return int(time.time() * 1000)
