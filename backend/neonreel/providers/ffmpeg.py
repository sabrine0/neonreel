# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Clip tools that need no graphics card.

A short clip takes a second or two, so the work is done while the job is
submitted and is finished on the first poll.
"""

from ..catalog import LOOP_MODEL_ID, REVERSE_MODEL_ID, SLOW_MODEL_ID
from ..clip import loop_clip, reverse_clip, slow_clip
from ..store import file_name, file_path

_TOOLS = {LOOP_MODEL_ID: loop_clip, REVERSE_MODEL_ID: reverse_clip, SLOW_MODEL_ID: slow_clip}


async def submit(gen: dict, model: dict) -> dict:
    tool = _TOOLS.get(gen["modelId"])
    clip = file_name(gen["refImage"]) if gen.get("refImage") else ""
    if tool is None or not clip:
        raise RuntimeError("The clip to work on is missing.")
    out = f"{gen['id']}.mp4"
    await tool(file_path(clip), file_path(out))
    return {"file": out}


async def check(gen: dict, model: dict) -> dict:
    return {"status": "done", "outputUrl": f"/api/files/{gen['job']['file']}", "outputType": "video"}
