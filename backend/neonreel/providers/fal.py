# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Hosted models through fal.ai. Experimental: never run against the real service."""

import base64

from ..catalog import CAMERAS, camera_id
from ..config import FAL_KEY, now_ms
from ..net import http
from ..store import file_name, read_file

_QUEUE = "https://queue.fal.run/"

_IMAGE_SIZE = {
    "16:9": "landscape_16_9",
    "9:16": "portrait_16_9",
    "1:1": "square_hd",
    "4:3": "landscape_4_3",
    "3:4": "portrait_4_3",
}
_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def _headers() -> dict[str, str]:
    return {"Authorization": f"Key {FAL_KEY}", "Content-Type": "application/json"}


def _ref_as_data_uri(gen: dict) -> str | None:
    """fal accepts data URIs for image inputs, so local uploads need no public URL."""
    if not gen.get("refImage"):
        return None
    name = file_name(gen["refImage"])
    data = read_file(name)
    if data is None:
        return None
    mime = _MIME.get(name.rsplit(".", 1)[-1], "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _build_input(gen: dict) -> dict:
    """Input fields differ per fal model. These cover the two in the catalog."""
    if gen["kind"] == "image":
        return {"prompt": gen["prompt"], "image_size": _IMAGE_SIZE[gen["aspect"]], "num_images": 1}
    camera = CAMERAS[camera_id(gen.get("cameraId"))]
    return {
        "prompt": ". ".join(part for part in (gen["prompt"], camera) if part),
        "image_url": _ref_as_data_uri(gen),
        "duration": str(gen["duration"]),
    }


def _error_text(res) -> str:
    return f"{res.status_code} {res.text[:300]}".strip()


async def submit(gen: dict, model: dict) -> dict:
    res = await http().post(_QUEUE + model["endpoint"], headers=_headers(), json=_build_input(gen), timeout=60)
    if res.status_code >= 400:
        raise RuntimeError(_error_text(res))
    data = res.json()
    status_url, response_url = data.get("status_url", ""), data.get("response_url", "")
    if not status_url.startswith(_QUEUE) or not response_url.startswith(_QUEUE):
        raise RuntimeError("Unexpected queue response.")
    return {"statusUrl": status_url, "responseUrl": response_url}


async def check(gen: dict, model: dict) -> dict:
    status_res = await http().get(gen["job"]["statusUrl"], headers=_headers(), timeout=20)
    if status_res.status_code >= 400:
        raise RuntimeError(_error_text(status_res))
    if status_res.json().get("status") != "COMPLETED":
        # fal reports no percentage; show an estimate that never reaches 100%.
        import math

        elapsed = (now_ms() - gen["createdAt"]) / 1000
        expected = 10 if gen["kind"] == "image" else 120
        return {"status": "running", "progress": 1 - math.exp(-elapsed / expected)}

    res = await http().get(gen["job"]["responseUrl"], headers=_headers(), timeout=30)
    if res.status_code >= 400:
        return {"status": "failed", "error": _error_text(res)}
    data = res.json()
    if gen["kind"] == "video":
        url = (data.get("video") or {}).get("url")
    else:
        url = ((data.get("images") or [{}])[0] or {}).get("url")
    if not url:
        return {"status": "failed", "error": "Model returned no output."}
    return {"status": "done", "outputUrl": url, "outputType": gen["kind"]}
