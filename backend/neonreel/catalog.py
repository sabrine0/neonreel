# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Models, camera moves, voices and looks.

The interface has its own copy of this list in frontend/src/lib/catalog.ts.
When you add or change a model here, make the same change there.
"""

import re
from typing import Any

Model = dict[str, Any]

ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4"]

ASPECT_SIZE = {
    "16:9": (1280, 720),
    "9:16": (720, 1280),
    "1:1": (1024, 1024),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
}

#: Image-editing model that redraws one reference character into new scenes.
CHARACTER_MODEL_ID = "kontext-local"
#: The same editing model, offered in Create to change a picture you supply.
EDIT_MODEL_ID = "kontext-edit-local"
UPSCALE_MODEL_ID = "upscale-local"
CUTOUT_MODEL_ID = "cutout-local"
SMOOTH_MODEL_ID = "smooth-local"
EXTEND_MODEL_ID = "extend-local"
REVERSE_MODEL_ID = "reverse-local"
LOOP_MODEL_ID = "loop-local"
SLOW_MODEL_ID = "slow-local"
IMAGE_MODEL_ID = "flux-schnell-local"
FAST_VIDEO_MODEL_ID = "wan22-fast-local"

_KONTEXT_FILE = {"folder": "diffusion_models", "name": "flux1-dev-kontext_fp8_scaled.safetensors"}
_FAST_LORA_FILE = {"folder": "loras", "name": "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors"}

# Keys:
#   provider       "mock" | "fal" | "comfy" | "ffmpeg"
#   cost           credits per image, or per second of video
#   endpoint       provider endpoint id (fal models only)
#   file           a model file that must exist in the ComfyUI models folder
#   internal       used by features but not offered in the Create picker
#   tool           applied to an existing result rather than a prompt:
#                  factor = result is this many times as long, adds = this many
#                  seconds longer, repeatable = can run again on its own result
#   speed          rough render seconds per second of video, for time estimates
MODELS: list[Model] = [
    {
        "id": IMAGE_MODEL_ID,
        "name": "FLUX.1 schnell (local GPU)",
        "kind": "image",
        "provider": "comfy",
        "cost": 0,
    },
    {
        "id": CHARACTER_MODEL_ID,
        "name": "FLUX Kontext (local GPU)",
        "kind": "image",
        "provider": "comfy",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "file": _KONTEXT_FILE,
    },
    {
        "id": EDIT_MODEL_ID,
        "name": "FLUX Kontext Edit (local GPU)",
        "kind": "image",
        "provider": "comfy",
        "cost": 0,
        "requiresImage": True,
        "file": _KONTEXT_FILE,
    },
    {
        "id": UPSCALE_MODEL_ID,
        "name": "Upscale 2x (local GPU)",
        "kind": "image",
        "provider": "comfy",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {},
        "file": {"folder": "upscale_models", "name": "RealESRGAN_x4plus.safetensors"},
    },
    {
        "id": CUTOUT_MODEL_ID,
        "name": "Remove background (local GPU)",
        "kind": "image",
        "provider": "comfy",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {},
        "file": {"folder": "background_removal", "name": "birefnet.safetensors"},
    },
    {
        "id": SMOOTH_MODEL_ID,
        "name": "Smooth motion (local GPU)",
        "kind": "video",
        "provider": "comfy",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {},
        "file": {"folder": "frame_interpolation", "name": "film_net_fp16.safetensors"},
    },
    {
        "id": EXTEND_MODEL_ID,
        "name": "Extend clip (local GPU)",
        "kind": "video",
        "provider": "comfy",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {"adds": 5, "repeatable": True},
        "file": _FAST_LORA_FILE,
        "speed": 20,
    },
    {
        "id": LOOP_MODEL_ID,
        "name": "Loop",
        "kind": "video",
        "provider": "ffmpeg",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {"factor": 2},
    },
    {
        "id": REVERSE_MODEL_ID,
        "name": "Reverse",
        "kind": "video",
        "provider": "ffmpeg",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {},
    },
    {
        "id": SLOW_MODEL_ID,
        "name": "Slow motion",
        "kind": "video",
        "provider": "ffmpeg",
        "cost": 0,
        "requiresImage": True,
        "internal": True,
        "tool": {"factor": 2},
    },
    {
        "id": FAST_VIDEO_MODEL_ID,
        "name": "Wan 2.2 5B Fast (local GPU)",
        "kind": "video",
        "provider": "comfy",
        "cost": 0,
        "durations": [3, 5],
        "file": _FAST_LORA_FILE,
        "speed": 20,
    },
    {
        "id": "wan22-local",
        "name": "Wan 2.2 5B High quality (local GPU)",
        "kind": "video",
        "provider": "comfy",
        "cost": 0,
        "durations": [3, 5],
        "speed": 100,
    },
    {"id": "demo-image", "name": "Sketch (demo)", "kind": "image", "provider": "mock", "cost": 1},
    {
        "id": "demo-video",
        "name": "Animatic (demo)",
        "kind": "video",
        "provider": "mock",
        "cost": 2,
        "durations": [3, 5, 8],
    },
    {
        "id": "flux-dev",
        "name": "FLUX.1 dev",
        "kind": "image",
        "provider": "fal",
        "endpoint": "fal-ai/flux/dev",
        "cost": 4,
    },
    {
        "id": "kling-i2v",
        "name": "Kling 2.1 Standard",
        "kind": "video",
        "provider": "fal",
        "endpoint": "fal-ai/kling-video/v2.1/standard/image-to-video",
        "cost": 8,
        "requiresImage": True,
        "durations": [5, 10],
    },
]


def get_model(model_id: Any) -> Model | None:
    return next((m for m in MODELS if m["id"] == model_id), None)


def cost_of(model: Model, duration: int) -> int:
    return model["cost"] * duration if model["kind"] == "video" else model["cost"]


#: Camera moves: id -> text appended to the prompt sent to real video models.
CAMERAS: dict[str, str] = {
    "static": "static camera, locked-off tripod shot",
    "dolly-in": "camera slowly dollies in toward the subject",
    "dolly-out": "camera slowly dollies out, revealing the wider scene",
    "pan-left": "smooth camera pan to the left",
    "pan-right": "smooth camera pan to the right",
    "tilt-up": "camera tilts upward",
    "tilt-down": "camera tilts downward",
    "crane-up": "crane shot rising up and away from the subject",
    "crash-zoom": "fast crash zoom into the subject",
    "orbit": "camera orbits in an arc around the subject",
    "dutch-roll": "camera rolls slowly on its axis, dutch angle",
    "handheld": "handheld camera with natural subtle shake",
}


def camera_id(value: Any) -> str:
    """A valid camera id: the one given, or the first (static) one."""
    return value if isinstance(value, str) and value in CAMERAS else "static"


#: Looks offered in Create: id -> text added to the end of the prompt.
STYLES: dict[str, str] = {
    "cinematic": "cinematic 35mm film still, shallow depth of field, dramatic natural light",
    "photo": "realistic photograph, sharp focus, natural colours, 50mm lens",
    "anime": "anime style, clean line art, soft cel shading, detailed painted background",
    "3d": "3D animated film style, soft global illumination, expressive rounded shapes",
    "neon": "neon noir, wet streets, cyan and magenta glow, deep shadows, light haze",
    "watercolor": "delicate watercolour painting, visible paper texture, soft bleeding edges",
    "oil": "classical oil painting, visible brush strokes, rich warm palette",
    "comic": "comic book illustration, bold ink outlines, halftone shading, vivid flat colours",
    "pixel": "detailed pixel art, limited colour palette, crisp pixels",
    "clay": "stop-motion claymation, handmade clay figures, miniature set, soft studio light",
    "vintage": "1970s film photograph, faded colours, heavy grain, soft halation",
}

#: Kokoro voices: id -> language.
VOICES: dict[str, str] = {
    "af_heart": "English (US)",
    "af_bella": "English (US)",
    "am_michael": "English (US)",
    "am_fenrir": "English (US)",
    "bf_emma": "English (UK)",
    "bm_george": "English (UK)",
    "ff_siwis": "French",
    "ef_dora": "Spanish",
    "em_alex": "Spanish",
    "if_sara": "Italian",
    "im_nicola": "Italian",
    "pf_dora": "Portuguese",
    "pm_alex": "Portuguese",
}


def voice_id(value: Any) -> str | None:
    """The voice id if it is one this app offers, else None."""
    return value if isinstance(value, str) and value in VOICES else None


def narration_words(duration: float) -> int:
    """How many narration words fit comfortably in a scene of this length."""
    return max(4, int(duration * 2.2))


# Voices for spoken parts, per narration language. The first one that differs from the narrator is used.
_CAST = {
    "English (US)": {"he": ["am_michael", "am_fenrir"], "she": ["af_bella", "af_heart"], "child": ["af_sky"]},
    "English (UK)": {"he": ["bm_george", "bm_daniel"], "she": ["bf_emma", "bf_lily"], "child": ["bf_alice"]},
    "French": {"he": ["ff_siwis"], "she": ["ff_siwis"], "child": ["ff_siwis"]},
    "Spanish": {"he": ["em_alex"], "she": ["ef_dora"], "child": ["ef_dora"]},
    "Italian": {"he": ["im_nicola"], "she": ["if_sara"], "child": ["if_sara"]},
    "Portuguese": {"he": ["pm_alex"], "she": ["pf_dora"], "child": ["pf_dora"]},
}

_SPEAKER_TAG = re.compile(r"\b(narrator|he|she|child)\s*:\s*", re.IGNORECASE)


def split_dialogue(line: str, narrator_voice: str) -> list[dict[str, str]]:
    """Splits a narration line into parts by speaker tag, so a scene can hold dialogue.

    "He: Stay with me. She: Always." Untagged text is the narrator.
    Returns [{"voiceId", "text"}, ...].
    """
    cast = _CAST.get(VOICES.get(narrator_voice, ""), _CAST["English (US)"])

    def voice_for(speaker: str) -> str:
        if speaker == "narrator":
            return narrator_voice
        options = cast[speaker]
        return next((v for v in options if v != narrator_voice), options[0])

    parts: list[dict[str, str]] = []
    speaker = "narrator"
    cursor = 0

    def push(end: int) -> None:
        text = line[cursor:end].strip()
        if text:
            parts.append({"voiceId": voice_for(speaker), "text": text})

    for match in _SPEAKER_TAG.finditer(line):
        push(match.start())
        speaker = match.group(1).lower()
        cursor = match.end()
    push(len(line))
    return parts


#: Where a finished video can be published, and the shape each place wants.
PLATFORMS: dict[str, dict[str, Any]] = {
    "tiktok": {
        "name": "TikTok",
        "width": 1080,
        "height": 1920,
        "uploadUrl": "https://www.tiktok.com/upload",
        "captionHint": "a short, catchy TikTok caption under 120 characters",
    },
    "reels": {
        "name": "Instagram Reels",
        "width": 1080,
        "height": 1920,
        "uploadUrl": "https://www.instagram.com/",
        "captionHint": "a warm Instagram Reels caption of one or two sentences",
    },
    "shorts": {
        "name": "YouTube Shorts",
        "width": 1080,
        "height": 1920,
        "uploadUrl": "https://www.youtube.com/upload",
        "captionHint": "a YouTube Shorts title under 90 characters",
    },
    "youtube": {
        "name": "YouTube",
        "width": 1920,
        "height": 1080,
        "uploadUrl": "https://www.youtube.com/upload",
        "captionHint": "a clear YouTube title, then a two-sentence description on the next line",
    },
    "x": {
        "name": "X",
        "width": 1280,
        "height": 720,
        "uploadUrl": "https://x.com/compose/post",
        "captionHint": "a post for X under 200 characters",
    },
}
