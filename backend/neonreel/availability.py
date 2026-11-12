# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""What can be used right now: backends, model files, the language model."""

import asyncio
from typing import Any

import httpx

from .catalog import CHARACTER_MODEL_ID, MODELS
from .config import FAL_KEY, OLLAMA_MODEL, OLLAMA_URL
from .net import http
from .providers import comfy
from .render import voice_available

#: Hosted video models are not timed here; assume a typical queue-plus-render.
HOSTED_SPEED = 28


async def get_availability() -> dict[str, bool]:
    """Which generation backends can be used right now."""
    return {
        "mock": True,
        "fal": bool(FAL_KEY),
        "comfy": await comfy.available(),
        # Checked when a tool runs; FFmpeg is already required for stories.
        "ffmpeg": True,
    }


async def missing_model_ids(available: dict[str, bool]) -> list[str]:
    """Ids of local models whose files have not been downloaded into ComfyUI."""
    if not available["comfy"]:
        return []
    wanted = [m for m in MODELS if m["provider"] == "comfy" and m.get("file")]
    folders = sorted({m["file"]["folder"] for m in wanted})
    listings = dict(zip(folders, await asyncio.gather(*(comfy.model_files(f) for f in folders))))
    # A folder that could not be listed says nothing: only a real listing can show a file is missing.
    return [
        m["id"]
        for m in wanted
        if listings[m["file"]["folder"]] is not None and m["file"]["name"] not in listings[m["file"]["folder"]]
    ]


def real_models(kind: str, available: dict[str, bool], missing: list[str]) -> list[dict]:
    """Models of a kind that produce real media files and can be used right now."""
    return [
        m
        for m in MODELS
        if m["kind"] == kind
        and m["provider"] != "mock"
        and not m.get("internal")
        and available[m["provider"]]
        and m["id"] not in missing
    ]


async def ollama_models() -> list[str]:
    """Names of the models the local Ollama server has, or [] when it is not running."""
    try:
        res = await http().get(f"{OLLAMA_URL}/api/tags", timeout=1.5)
        if res.status_code != 200:
            return []
        return [m["name"] for m in res.json().get("models") or [] if m.get("name")]
    except (httpx.HTTPError, ValueError):
        return []


async def language_model() -> str | None:
    """The Ollama model to use, or None when Ollama is not running."""
    if OLLAMA_MODEL:
        return OLLAMA_MODEL
    models = await ollama_models()
    return models[0] if models else None


async def ollama_placement() -> dict[str, Any]:
    """Extra Ollama options for a request made right now.

    While pictures or video are rendering, the graphics card is full: loading
    the language model onto it as well can freeze the render, so it runs on
    the processor instead (slower).
    """
    return {"num_gpu": 0} if await comfy.busy() else {}


async def status() -> dict[str, Any]:
    """Everything the pages need to know before they render."""
    available, models = await asyncio.gather(get_availability(), ollama_models())
    missing = await missing_model_ids(available)
    image_models = real_models("image", available, missing)
    video_models = real_models("video", available, missing)
    return {
        "available": available,
        "missing": missing,
        "ollama": bool(models),
        "voice": voice_available(),
        "characterReady": available["comfy"] and CHARACTER_MODEL_ID not in missing,
        "storyReady": bool(image_models and video_models),
        "imageModelName": image_models[0]["name"] if image_models else None,
        "videoModels": [
            {
                "id": m["id"],
                "name": m["name"],
                "durations": m.get("durations", [5]),
                "speed": m.get("speed", 100) if m["provider"] == "comfy" else HOSTED_SPEED,
            }
            for m in video_models
        ],
    }
