# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Single pictures and clips: starting them, polling them, removing them."""

import asyncio
import base64
import logging
import re
import uuid
from typing import Any

from .catalog import ASPECTS, camera_id, cost_of, get_model
from .config import FAL_KEY, now_ms
from .errors import RequestError
from .providers import provider_for
from .store import (
    add_credits,
    delete_generation,
    file_name,
    get_credits,
    get_generation,
    insert_generation,
    list_generations,
    read_file,
    remove_file,
    save_file,
    update_generation,
)

log = logging.getLogger("neonreel")

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
_DATA_URL = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")


def decode_data_url(value: str, pattern: re.Pattern[str]) -> tuple[str, bytes] | None:
    """Splits a base64 data URL into its subtype and bytes, or None if it does not match."""
    match = pattern.match(value)
    if not match:
        return None
    try:
        return match.group(1), base64.b64decode(match.group(2), validate=True)
    except ValueError:
        return None


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def create_generation(
    data: dict[str, Any],
    *,
    ref_file: str | None = None,
    story_id: str | None = None,
) -> dict:
    """Starts one picture or clip.

    `data` comes from a request: modelId, prompt, aspect, duration, cameraId,
    refImage (a data URL) and sourceId (a finished result for a tool to work on).
    `ref_file` and `story_id` are only ever set by server code: the name of an
    already stored file to use as the reference, and the story this belongs to.
    """
    model = get_model(data.get("modelId"))
    if model is None:
        raise RequestError("Unknown model.")

    # A tool works on one of the user's own finished results, named by id.
    source = None
    if isinstance(data.get("sourceId"), str):
        source = get_generation(data["sourceId"])
        output = (source or {}).get("outputUrl") or ""
        if source is None or source["status"] != "done" or not output.startswith("/api/files/"):
            raise RequestError("That result is not available to work on.")
        if source["kind"] != model["kind"]:
            raise RequestError(f"{model['name']} works on {model['kind']}s only.")
        if model["kind"] == "video" and not output.endswith(".mp4"):
            raise RequestError(f"{model['name']} needs a real video clip.")
        ref_file = file_name(output)
        data = {**data, "prompt": source["prompt"], "aspect": source["aspect"], "cameraId": source["cameraId"]}

    if model["provider"] == "fal" and not FAL_KEY:
        raise RequestError("This model needs FAL_KEY set in .env.local.")

    prompt = data["prompt"].strip()[:2000] if isinstance(data.get("prompt"), str) else ""
    aspect = data.get("aspect") if data.get("aspect") in ASPECTS else "16:9"

    duration = 0
    if model["kind"] == "video":
        allowed = model.get("durations", [5])
        asked = _number(data.get("duration"))
        duration = int(asked) if asked in allowed else allowed[0]
        if source is not None:
            tool = model.get("tool") or {}
            # Rounded half up, as the interface does when it shows the length.
            duration = int(source["duration"] * tool.get("factor", 1) + tool.get("adds", 0) + 0.5)

    gen_id = str(uuid.uuid4())
    upload: tuple[str, bytes] | None = None
    ref_image = data.get("refImage")
    if isinstance(ref_image, str) and ref_image:
        decoded = decode_data_url(ref_image, _DATA_URL)
        if decoded is None:
            raise RequestError("Reference image must be a JPEG, PNG or WebP.")
        kind, content = decoded
        if len(content) > MAX_UPLOAD_BYTES:
            raise RequestError("Reference image is too large.")
        upload = ("jpg" if kind == "jpeg" else kind, content)
    elif ref_file:
        content = read_file(ref_file)
        if content is None:
            raise RequestError("Reference frame is missing.")
        upload = (ref_file.rsplit(".", 1)[-1], content)

    if model.get("requiresImage") and upload is None:
        raise RequestError(f"{model['name']} needs a reference image.")
    if not prompt and upload is None:
        raise RequestError("Write a prompt first.")

    cost = cost_of(model, duration)
    if get_credits() < cost:
        raise RequestError("Not enough credits.", 402)

    gen: dict[str, Any] = {
        "id": gen_id,
        "kind": model["kind"],
        "modelId": model["id"],
        "prompt": prompt,
        "aspect": aspect,
        "duration": duration,
        "cameraId": camera_id(data.get("cameraId")),
        "status": "running",
        "progress": 0,
        "cost": cost,
        "createdAt": now_ms(),
        "job": {},
    }
    if upload is not None:
        gen["refImage"] = save_file(f"{gen_id}-ref.{upload[0]}", upload[1])
    if story_id:
        gen["storyId"] = story_id

    try:
        gen["job"] = await provider_for(model).submit(gen, model)
    except Exception as err:  # noqa: BLE001 - any provider failure is reported the same way
        if gen.get("refImage"):
            remove_file(file_name(gen["refImage"]))
        raise RequestError(f"Provider rejected the job: {err}", 502) from None

    add_credits(-cost)
    insert_generation(gen)
    return gen


def _settle(gen_id: str, patch: dict) -> None:
    """Applies a terminal state once, refunding credits on failure."""
    current = get_generation(gen_id)
    if current is None or current["status"] != "running":
        return
    update_generation(gen_id, {**patch, "finishedAt": now_ms()})
    if patch.get("status") == "failed":
        add_credits(current["cost"])


async def _refresh(gen: dict) -> None:
    """Polls the provider for one running job and persists the outcome."""
    model = get_model(gen["modelId"])
    if model is None:
        _settle(gen["id"], {"status": "failed", "error": "Model no longer exists."})
        return
    try:
        result = await provider_for(model).check(gen, model)
    except Exception as err:  # noqa: BLE001
        # Transient polling errors (network blips, a busy ComfyUI) are retried on the next poll.
        log.warning("Polling %s failed: %s", gen["id"], err or err.__class__.__name__)
        return
    if result["status"] == "running":
        update_generation(gen["id"], {"progress": min(0.99, result["progress"])})
    elif result["status"] == "done":
        _settle(gen["id"], {**result, "progress": 1})
    else:
        _settle(gen["id"], result)


async def refresh_running() -> None:
    """Polls every running job once."""
    running = [g for g in list_generations() if g["status"] == "running"]
    await asyncio.gather(*(_refresh(g) for g in running))


async def revive_generation(gen_id: str) -> bool:
    """Gives a failed job a second look: marks it running and polls the provider again.

    Returns True if the provider still has it (running or finished).
    """
    gen = get_generation(gen_id)
    if gen is None:
        return False
    if gen["status"] != "failed":
        return True
    # Failing refunded the cost, so take it again while the job is live.
    add_credits(-gen["cost"])
    update_generation(gen_id, {"status": "running", "error": None, "finishedAt": None})
    revived = get_generation(gen_id)
    if revived is not None:
        await _refresh(revived)
    return (get_generation(gen_id) or {}).get("status") != "failed"


async def list_with_refresh() -> dict:
    await refresh_running()
    return {"credits": get_credits(), "generations": [public_view(g) for g in list_generations()]}


def remove_generation(gen_id: str) -> bool:
    gen = get_generation(gen_id)
    if gen is None:
        return False
    for url in (gen.get("refImage"), gen.get("outputUrl")):
        if url and url.startswith("/api/files/"):
            remove_file(file_name(url))
    return delete_generation(gen_id)


def public_view(gen: dict) -> dict:
    """Strips provider job handles before sending a generation to the browser."""
    return {**gen, "job": {}}
