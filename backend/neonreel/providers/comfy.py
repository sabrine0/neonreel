# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Local GPU generation through a ComfyUI server. Model files are expected in ComfyUI/models."""

import math
import random
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from ..catalog import (
    CAMERAS,
    CHARACTER_MODEL_ID,
    CUTOUT_MODEL_ID,
    EDIT_MODEL_ID,
    EXTEND_MODEL_ID,
    FAST_VIDEO_MODEL_ID,
    SMOOTH_MODEL_ID,
    UPSCALE_MODEL_ID,
    camera_id,
    get_model,
)
from ..clip import append_clip, last_frame
from ..config import COMFY_URL, now_ms
from ..net import http
from ..store import file_name, file_path, read_file, remove_file, save_file

Workflow = dict[str, dict[str, Any]]

FLUX_CHECKPOINT = "flux1-schnell-fp8.safetensors"
WAN_MODEL = "wan2.2_ti2v_5B_fp16.safetensors"
WAN_TEXT_ENCODER = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
WAN_VAE = "wan2.2_vae.safetensors"
WAN_FAST_LORA = "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors"
WAN_FPS = 24
WAN_NEGATIVE = (
    "blurry, low quality, jpeg artifacts, static frame, watermark, subtitles, text, "
    "deformed, extra limbs, overexposed"
)

KONTEXT_MODEL = "flux1-dev-kontext_fp8_scaled.safetensors"
KONTEXT_CLIP_L = "clip_l.safetensors"
KONTEXT_T5 = "t5xxl_fp8_e4m3fn_scaled.safetensors"
KONTEXT_VAE = "ae.safetensors"

PREFIX = "neonreel"

# About one megapixel, sides a multiple of 16 as FLUX expects.
FLUX_SIZE = {
    "16:9": (1344, 768),
    "9:16": (768, 1344),
    "1:1": (1024, 1024),
    "4:3": (1152, 896),
    "3:4": (896, 1152),
}

# 720p-class sizes, sides a multiple of 32 as the Wan 2.2 5B VAE expects.
WAN_SIZE = {
    "16:9": (1280, 704),
    "9:16": (704, 1280),
    "1:1": (960, 960),
    "4:3": (1088, 832),
    "3:4": (832, 1088),
}

# ComfyUI can stop answering for a while when the graphics card is overloaded.
# A poll gives up after this long and is tried again on the next one, so the
# app's own pages keep loading.
POLL_TIMEOUT = 6.0
# A just-submitted job may not be listed yet; only call it lost after this.
LOST_JOB_GRACE_MS = 60 * 1000
#: Seconds of new video the Extend tool adds.
EXTEND_SECONDS = ((get_model(EXTEND_MODEL_ID) or {}).get("tool") or {}).get("adds", 5)

#: Last successful listing of each model folder, used while ComfyUI is too busy to answer.
_model_files: dict[str, list[str]] = {}
#: Extensions being joined to their source clip right now, so two polls never write one file.
_joining: set[str] = set()


def _seed() -> int:
    return random.randrange(2**53)


# --- Workflows ---------------------------------------------------------------

def _flux_workflow(gen: dict) -> Workflow:
    width, height = FLUX_SIZE[gen["aspect"]]
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": FLUX_CHECKPOINT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": gen["prompt"], "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["1", 1]}},
        "4": {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": _seed(),
                "steps": 4,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
            },
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"filename_prefix": PREFIX, "images": ["6", 0]}},
    }


def _kontext_workflow(gen: dict, reference: str, keep_frame: bool) -> Workflow:
    """Redraws the character in `reference` into the scene described by the prompt.

    The reference is fed as a latent the model attends to, not as the canvas,
    so the output can have a different framing and aspect ratio.
    """
    width, height = FLUX_SIZE[gen["aspect"]]
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": KONTEXT_MODEL, "weight_dtype": "default"}},
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {"clip_name1": KONTEXT_CLIP_L, "clip_name2": KONTEXT_T5, "type": "flux", "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": KONTEXT_VAE}},
        "4": {"class_type": "LoadImage", "inputs": {"image": reference}},
        "5": {"class_type": "FluxKontextImageScale", "inputs": {"image": ["4", 0]}},
        "6": {"class_type": "VAEEncode", "inputs": {"pixels": ["5", 0], "vae": ["3", 0]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": gen["prompt"], "clip": ["2", 0]}},
        "8": {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["7", 0], "latent": ["6", 0]}},
        "9": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["8", 0], "guidance": 2.5}},
        "10": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["7", 0]}},
        "11": {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "12": {
            "class_type": "KSampler",
            "inputs": {
                "seed": _seed(),
                "steps": 20,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["1", 0],
                "positive": ["9", 0],
                "negative": ["10", 0],
                # Editing starts from the picture's own latent, so size and framing are
                # kept. A new scene starts from an empty canvas of the requested shape.
                "latent_image": ["6" if keep_frame else "11", 0],
            },
        },
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["3", 0]}},
        "14": {"class_type": "SaveImage", "inputs": {"filename_prefix": PREFIX, "images": ["13", 0]}},
    }


def _upscale_workflow(source: str) -> Workflow:
    """Enlarges 4x with Real-ESRGAN, then halves the result: a clean 2x."""
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": source}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "RealESRGAN_x4plus.safetensors"}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "ImageScaleBy", "inputs": {"image": ["3", 0], "upscale_method": "area", "scale_by": 0.5}},
        "5": {"class_type": "SaveImage", "inputs": {"filename_prefix": PREFIX, "images": ["4", 0]}},
    }


def _cutout_workflow(source: str) -> Workflow:
    """Finds the subject with BiRefNet and saves the picture with everything else transparent."""
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": source}},
        "2": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": "birefnet.safetensors"}},
        "3": {"class_type": "RemoveBackground", "inputs": {"bg_removal_model": ["2", 0], "image": ["1", 0]}},
        # JoinImageWithAlpha treats its mask as "what to hide", so the subject mask is inverted first.
        "4": {"class_type": "InvertMask", "inputs": {"mask": ["3", 0]}},
        "5": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["1", 0], "alpha": ["4", 0]}},
        "6": {"class_type": "SaveImage", "inputs": {"filename_prefix": PREFIX, "images": ["5", 0]}},
    }


def _save_video(source: str) -> dict:
    # "auto" writes H.264 in an MP4 container. Nested options use dotted keys.
    return {
        "class_type": "SaveVideo",
        "inputs": {"video": [source, 0], "filename_prefix": PREFIX, "format": "auto", "format.codec": "auto"},
    }


def _smooth_workflow(source: str) -> Workflow:
    """Adds an in-between frame after every frame with FILM: 24 to 48 frames a second."""
    return {
        "1": {"class_type": "LoadVideo", "inputs": {"file": source}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "FrameInterpolationModelLoader", "inputs": {"model_name": "film_net_fp16.safetensors"}},
        "4": {"class_type": "FrameInterpolate", "inputs": {"interp_model": ["3", 0], "images": ["2", 0], "multiplier": 2}},
        "5": {"class_type": "CreateVideo", "inputs": {"images": ["4", 0], "fps": WAN_FPS * 2}},
        "6": _save_video("5"),
    }


def _wan_workflow(gen: dict, start_image: str | None, fast: bool, seconds: int | None = None) -> Workflow:
    width, height = WAN_SIZE[gen["aspect"]]
    camera = CAMERAS[camera_id(gen.get("cameraId"))]
    prompt = ". ".join(part for part in (gen["prompt"], camera) if part)
    latent: dict[str, Any] = {
        "vae": ["3", 0],
        "width": width,
        "height": height,
        # Wan needs 4n+1 frames.
        "length": (seconds or gen["duration"]) * WAN_FPS + 1,
        "batch_size": 1,
    }
    workflow: Workflow = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": WAN_MODEL, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": WAN_TEXT_ENCODER, "type": "wan", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": WAN_VAE}},
        "4": {"class_type": "ModelSamplingSD3", "inputs": {"shift": 8, "model": ["13" if fast else "1", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": WAN_NEGATIVE, "clip": ["2", 0]}},
        "7": {"class_type": "Wan22ImageToVideoLatent", "inputs": latent},
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "seed": _seed(),
                # The distilled LoRA needs no guidance, so each step also costs half as much.
                "steps": 4 if fast else 20,
                "cfg": 1 if fast else 5,
                "sampler_name": "uni_pc",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["4", 0],
                "positive": ["5", 0],
                "negative": ["6", 0],
                "latent_image": ["7", 0],
            },
        },
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "CreateVideo", "inputs": {"images": ["9", 0], "fps": WAN_FPS}},
        "11": _save_video("10"),
    }
    if fast:
        workflow["13"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": ["1", 0], "lora_name": WAN_FAST_LORA, "strength_model": 1},
        }
    if start_image:
        workflow["12"] = {"class_type": "LoadImage", "inputs": {"image": start_image}}
        latent["start_image"] = ["12", 0]
    return workflow


# --- Talking to ComfyUI ------------------------------------------------------

async def available() -> bool:
    try:
        res = await http().get(f"{COMFY_URL}/queue", timeout=httpx.Timeout(2.5, connect=1.0))
        return res.status_code == 200
    except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout):
        # It accepted the connection but is too busy rendering to answer: it is running.
        return True
    except httpx.HTTPError:
        # Refused or unreachable: it is not running.
        return False


async def busy() -> bool:
    """True while ComfyUI is rendering or has work waiting (or is too busy to say)."""
    try:
        res = await http().get(f"{COMFY_URL}/queue", timeout=2)
        if res.status_code != 200:
            return False
        queue = res.json()
        return len(queue.get("queue_running") or []) + len(queue.get("queue_pending") or []) > 0
    except httpx.TimeoutException:
        return True
    except (httpx.HTTPError, ValueError):
        return False


async def model_files(folder: str) -> list[str] | None:
    """Names of the model files ComfyUI has in one of its folders.

    None means it could not be asked right now and has never answered, so
    nothing is known about that folder.
    """
    try:
        res = await http().get(f"{COMFY_URL}/models/{folder}", timeout=3)
        if res.status_code == 200:
            _model_files[folder] = res.json()
    except (httpx.HTTPError, ValueError):
        pass
    return _model_files.get(folder)


async def _is_queued(prompt_id: str) -> bool:
    """True while ComfyUI still has the job waiting or running."""
    res = await http().get(f"{COMFY_URL}/queue", timeout=POLL_TIMEOUT)
    res.raise_for_status()
    queue = res.json()
    # Each queue item is [number, prompt_id, ...].
    items = (queue.get("queue_running") or []) + (queue.get("queue_pending") or [])
    return any(len(item) > 1 and item[1] == prompt_id for item in items)


async def _history(prompt_id: str) -> dict | None:
    res = await http().get(f"{COMFY_URL}/history/{quote(prompt_id, safe='')}", timeout=POLL_TIMEOUT)
    res.raise_for_status()
    return res.json().get(prompt_id)


async def _upload(name: str) -> str | None:
    """Copies a stored file into ComfyUI's input folder; returns its name there."""
    data = read_file(name)
    if data is None:
        return None
    res = await http().post(
        f"{COMFY_URL}/upload/image",
        files={"image": (name, data)},
        data={"overwrite": "true"},
        timeout=120,
    )
    if res.status_code != 200:
        raise RuntimeError(f"Reference upload failed ({res.status_code})")
    body = res.json()
    return f"{body['subfolder']}/{body['name']}" if body.get("subfolder") else body["name"]


def _reference_name(gen: dict) -> str | None:
    """Name of the stored reference file (a picture, or the clip a tool works on)."""
    return file_name(gen["refImage"]) if gen.get("refImage") else None


def _find_output(entry: dict) -> dict | None:
    files = [
        item
        for node in (entry.get("outputs") or {}).values()
        for value in node.values()
        if isinstance(value, list)
        for item in value
        if isinstance(item, dict) and isinstance(item.get("filename"), str)
    ]
    # Loader nodes also report the file they read (type "input") as a preview.
    # The result is the file a save node wrote.
    return next((f for f in files if f.get("type") == "output"), None) or next(
        (f for f in files if f.get("type") != "input"), None
    )


def _error_from(entry: dict) -> str:
    for message in (entry.get("status") or {}).get("messages") or []:
        if message and message[0] == "execution_error":
            text = (message[1] or {}).get("exception_message")
            if isinstance(text, str):
                return text.strip()[:300]
    return "ComfyUI reported an error."


def _describe_connection(err: Exception) -> str:
    if isinstance(err, (httpx.ConnectError, httpx.ConnectTimeout)):
        return f"ComfyUI is not reachable at {COMFY_URL}. Start it, then try again."
    if isinstance(err, httpx.TimeoutException):
        return "ComfyUI did not answer in time. It may be overloaded; try again in a moment."
    return str(err) or err.__class__.__name__


async def _build(gen: dict) -> Workflow:
    model_id = gen["modelId"]

    if model_id == EXTEND_MODEL_ID:
        # Extending starts a new clip from the last frame of the old one.
        clip = _reference_name(gen)
        if not clip:
            raise RuntimeError("The clip to extend is missing.")
        frame = f"{gen['id']}-last.png"
        await last_frame(file_path(clip), file_path(frame))
        try:
            reference = await _upload(frame)
        finally:
            remove_file(frame)
        if not reference:
            raise RuntimeError("The last frame of the clip could not be read.")
        return _wan_workflow(gen, reference, fast=True, seconds=EXTEND_SECONDS)

    name = _reference_name(gen)
    reference = await _upload(name) if name else None

    tool = {UPSCALE_MODEL_ID: _upscale_workflow, CUTOUT_MODEL_ID: _cutout_workflow, SMOOTH_MODEL_ID: _smooth_workflow}.get(model_id)
    if tool:
        if not reference:
            raise RuntimeError("The picture or clip to work on is missing.")
        return tool(reference)
    if gen["kind"] == "video":
        return _wan_workflow(gen, reference, fast=model_id == FAST_VIDEO_MODEL_ID)
    if model_id in (CHARACTER_MODEL_ID, EDIT_MODEL_ID):
        if not reference:
            raise RuntimeError("The reference picture is missing.")
        return _kontext_workflow(gen, reference, keep_frame=model_id == EDIT_MODEL_ID)
    return _flux_workflow(gen)


async def submit(gen: dict, model: dict) -> dict:
    try:
        workflow = await _build(gen)
        res = await http().post(f"{COMFY_URL}/prompt", json={"prompt": workflow, "client_id": PREFIX}, timeout=120)
    except httpx.HTTPError as err:
        raise RuntimeError(_describe_connection(err)) from None

    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code != 200 or not body.get("prompt_id"):
        node = next(iter((body.get("node_errors") or {}).values()), {})
        first = ((node.get("errors") or [{}])[0]) if isinstance(node, dict) else {}
        detail = ": ".join(part for part in (first.get("message"), first.get("details")) if part)
        raise RuntimeError(detail or (body.get("error") or {}).get("message") or f"ComfyUI returned {res.status_code}")
    return {"promptId": body["prompt_id"]}


async def check(gen: dict, model: dict) -> dict:
    prompt_id = gen["job"]["promptId"]
    entry = await _history(prompt_id)
    elapsed = now_ms() - gen["createdAt"]

    if entry is None and elapsed > LOST_JOB_GRACE_MS and not await _is_queued(prompt_id):
        # Not in the queue either. It may have finished between the two questions,
        # so look at the history once more before calling it lost.
        entry = await _history(prompt_id)
        if entry is None:
            return {"status": "failed", "error": "ComfyUI lost this job (was it restarted?)."}

    if entry is None:
        # No history yet: the job is still queued or running.
        # ComfyUI reports no percentage over HTTP; estimate, never reaching 100%.
        speed = model.get("speed", 100)
        seconds = EXTEND_SECONDS if gen["modelId"] == EXTEND_MODEL_ID else gen["duration"]
        expected = 40_000 if gen["kind"] == "image" else seconds * speed * 600
        return {"status": "running", "progress": 1 - math.exp(-elapsed / expected)}

    if (entry.get("status") or {}).get("status_str") == "error":
        return {"status": "failed", "error": _error_from(entry)}
    output = _find_output(entry)
    if output is None:
        return {"status": "failed", "error": "ComfyUI finished without an output file."}

    query = urlencode({
        "filename": output["filename"],
        "subfolder": output.get("subfolder") or "",
        "type": output.get("type") or "output",
    })
    media = await http().get(f"{COMFY_URL}/view?{query}", timeout=60)
    if media.status_code != 200:
        raise RuntimeError(f"Could not fetch the result ({media.status_code})")
    data = media.content

    if gen["modelId"] == EXTEND_MODEL_ID:
        # The new part is joined onto the end of the clip it continues.
        clip = _reference_name(gen)
        if not clip:
            return {"status": "failed", "error": "The clip to extend is missing."}
        if gen["id"] in _joining:
            return {"status": "running", "progress": 0.99}
        _joining.add(gen["id"])
        part = f"{gen['id']}-part.mp4"
        try:
            save_file(part, data)
            await append_clip(file_path(clip), file_path(part), file_path(f"{gen['id']}.mp4"))
        except Exception as err:  # noqa: BLE001 - shown to the user on the tile
            return {"status": "failed", "error": str(err)}
        finally:
            remove_file(part)
            _joining.discard(gen["id"])
        return {"status": "done", "outputUrl": f"/api/files/{gen['id']}.mp4", "outputType": "video"}

    ext = "png" if gen["kind"] == "image" else "mp4"
    return {"status": "done", "outputUrl": save_file(f"{gen['id']}.{ext}", data), "outputType": gen["kind"]}
