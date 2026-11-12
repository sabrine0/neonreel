# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Single-user JSON file store.

Good enough for local use; swap for a real database (and per-user rows) before
deploying this anywhere shared. Records are plain dicts with the same field
names the interface uses (camelCase), so they go to the browser unchanged.

All functions here are synchronous and must be called from the server's event
loop thread only: each one reads, changes and writes the file in one go, which
is what keeps two requests from overwriting each other's changes.
"""

import json
import os
import re
from pathlib import Path
from typing import Any

from .config import DATA, DB, FILES

Record = dict[str, Any]

STARTING_CREDITS = 500
_SAFE_NAME = re.compile(r"^[a-z0-9-]+\.(svg|jpg|png|webp|mp4|mp3|wav|m4a|ogg)$")


def _load() -> Record:
    try:
        db = json.loads(DB.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"credits": STARTING_CREDITS, "generations": [], "stories": []}
    db.setdefault("generations", [])
    db.setdefault("stories", [])
    return db


def _save(db: Record) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    # Written beside the real file and swapped in, so a crash cannot leave half a library.
    temp = DB.with_suffix(".tmp")
    temp.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, DB)


def _apply(record: Record, patch: Record) -> None:
    """Merges a patch into a record. A value of None removes the field."""
    for key, value in patch.items():
        if value is None:
            record.pop(key, None)
        else:
            record[key] = value


def _newest_first(records: list[Record]) -> list[Record]:
    return sorted(records, key=lambda r: r.get("createdAt", 0), reverse=True)


# --- Generations -------------------------------------------------------------

def list_generations() -> list[Record]:
    return _newest_first(_load()["generations"])


def get_generation(gen_id: Any) -> Record | None:
    return next((g for g in _load()["generations"] if g["id"] == gen_id), None)


def insert_generation(gen: Record) -> None:
    db = _load()
    db["generations"].append(gen)
    _save(db)


def update_generation(gen_id: str, patch: Record) -> None:
    db = _load()
    gen = next((g for g in db["generations"] if g["id"] == gen_id), None)
    if gen is None:
        return
    _apply(gen, patch)
    _save(db)


def delete_generation(gen_id: str) -> bool:
    db = _load()
    kept = [g for g in db["generations"] if g["id"] != gen_id]
    removed = len(kept) < len(db["generations"])
    db["generations"] = kept
    _save(db)
    return removed


# --- Stories -----------------------------------------------------------------

def list_stories() -> list[Record]:
    return _newest_first(_load()["stories"])


def get_story(story_id: Any) -> Record | None:
    return next((s for s in _load()["stories"] if s["id"] == story_id), None)


def insert_story(story: Record) -> None:
    db = _load()
    db["stories"].append(story)
    _save(db)


def update_story(story_id: str, patch: Record) -> None:
    db = _load()
    story = next((s for s in db["stories"] if s["id"] == story_id), None)
    if story is None:
        return
    _apply(story, patch)
    _save(db)


def delete_story(story_id: str) -> bool:
    db = _load()
    kept = [s for s in db["stories"] if s["id"] != story_id]
    removed = len(kept) < len(db["stories"])
    db["stories"] = kept
    _save(db)
    return removed


# --- Credits -----------------------------------------------------------------

def get_credits() -> int:
    return _load().get("credits", STARTING_CREDITS)


def add_credits(delta: int) -> int:
    db = _load()
    db["credits"] = db.get("credits", STARTING_CREDITS) + delta
    _save(db)
    return db["credits"]


# --- Media files -------------------------------------------------------------

def file_name(url: str) -> str:
    """The stored file name inside an app URL such as /api/files/abc.png."""
    return url[url.rfind("/") + 1 :]


def is_safe_name(name: str) -> bool:
    return bool(_SAFE_NAME.match(name))


def file_path(name: str) -> Path:
    """Absolute path of a stored file, for tools that need one (FFmpeg)."""
    if not is_safe_name(name):
        raise ValueError("Invalid file name")
    FILES.mkdir(parents=True, exist_ok=True)
    return FILES / name


def save_file(name: str, data: bytes | str) -> str:
    path = file_path(name)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_bytes(data)
    return f"/api/files/{name}"


def read_file(name: str) -> bytes | None:
    if not is_safe_name(name):
        return None
    try:
        return (FILES / name).read_bytes()
    except OSError:
        return None


def remove_file(name: str) -> None:
    if is_safe_name(name):
        (FILES / name).unlink(missing_ok=True)
