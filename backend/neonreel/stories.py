# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""The story pipeline: stills, then clips, then one joined video."""

import asyncio
import re
import uuid
from typing import Any

from .availability import get_availability, missing_model_ids, real_models
from .catalog import ASPECTS, CAMERAS, CHARACTER_MODEL_ID, get_model, voice_id
from .config import now_ms
from .errors import RequestError
from .generations import create_generation, decode_data_url, refresh_running, revive_generation
from .net import http
from .render import join_clips, voice_available
from .store import (
    delete_story,
    file_name,
    file_path,
    get_generation,
    get_story,
    insert_story,
    list_stories,
    remove_file,
    save_file,
    update_generation,
    update_story,
)

MIN_SCENES = 2
MAX_SCENES = 20
MAX_SCENE_CHARS = 600
JOIN_TIMEOUT_MS = 5 * 60 * 1000
MAX_MUSIC_BYTES = 20 * 1024 * 1024
MAX_PICTURE_BYTES = 8 * 1024 * 1024
_PICTURE_DATA_URL = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
_MUSIC_DATA_URL = re.compile(r"^data:audio/(mpeg|mp3|wav|x-wav|wave|mp4|x-m4a|aac|ogg);base64,([A-Za-z0-9+/=]+)$")
_MUSIC_EXT = {
    "mpeg": "mp3",
    "mp3": "mp3",
    "wav": "wav",
    "x-wav": "wav",
    "wave": "wav",
    "mp4": "m4a",
    "x-m4a": "m4a",
    "aac": "m4a",
    "ogg": "ogg",
}

#: Camera moves cycled through when the story's camera is "auto".
AUTO_CAMERAS = ["dolly-in", "pan-right", "orbit", "crane-up", "tilt-up", "dolly-out"]

#: Stories being advanced right now, so overlapping polls do not double-submit.
_busy: set[str] = set()
#: Joins in progress. Held here so they are not garbage-collected mid-run.
_joins: set[asyncio.Task] = set()
_ticking = False


def _text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _with_style(prompt: str, style: str) -> str:
    return f"{prompt}. {style}" if style else prompt


def _is_active(story: dict) -> bool:
    return story["status"] in ("running", "joining")


async def _create_character_reference(story: dict) -> dict:
    """Draws the main character alone, as the reference every scene is built from."""
    prompt = (
        f"{story['character']}, full body, standing, centered, "
        "plain light grey studio background, even soft lighting"
    )
    return await create_generation(
        {"modelId": story["imageModelId"], "prompt": _with_style(prompt, story["style"]), "aspect": "1:1"},
        story_id=story["id"],
    )


async def _local_output(gen: dict) -> str:
    """Makes sure a finished generation's output is a local file; returns its name."""
    url = gen.get("outputUrl") or ""
    if url.startswith("/api/files/"):
        return file_name(url)
    res = await http().get(url, timeout=120)
    if res.status_code != 200:
        raise RuntimeError(f"Could not download a scene result ({res.status_code})")
    kind = res.headers.get("content-type", "")
    if gen["kind"] == "video":
        ext = "mp4"
    else:
        ext = "png" if "png" in kind else "webp" if "webp" in kind else "jpg"
    local = save_file(f"{gen['id']}.{ext}", res.content)
    update_generation(gen["id"], {"outputUrl": local})
    return file_name(local)


async def _submit_stills(story: dict) -> None:
    """Submits the still for every scene that lacks one.

    With a character reference, stills wait until it is drawn and are then derived from it.
    """
    missing = [scene for scene in story["scenes"] if not scene.get("imageGenId")]
    if not missing:
        return

    reference: str | None = None
    if story.get("characterFile"):
        reference = file_name(story["characterFile"])
    elif story.get("characterGenId"):
        drawn = get_generation(story["characterGenId"])
        if drawn is None or drawn["status"] == "failed":
            raise RuntimeError(f"The character reference failed. {(drawn or {}).get('error', '')}".strip())
        if drawn["status"] != "done":
            return
        reference = await _local_output(drawn)

    for scene in missing:
        if reference and scene.get("withCharacter") is not False:
            prompt = (
                "Place the exact same character or characters from the reference image into a new scene: "
                f"{scene['prompt']}. "
                "Keep their faces, hair, design, colours, proportions and clothing identical to the reference. "
                "Change the pose, the background and the lighting to fit the scene"
            )
            image = await create_generation(
                {"modelId": CHARACTER_MODEL_ID, "prompt": _with_style(prompt, story["style"]), "aspect": story["aspect"]},
                ref_file=reference,
                story_id=story["id"],
            )
        else:
            image = await create_generation(
                {
                    "modelId": story["imageModelId"],
                    "prompt": _with_style(scene["prompt"], story["style"]),
                    "aspect": story["aspect"],
                },
                story_id=story["id"],
            )
        scene["imageGenId"] = image["id"]
        # Saved after every still, so a failure part-way does not submit the earlier ones twice.
        update_story(story["id"], {"scenes": story["scenes"]})


async def create_story(data: dict[str, Any]) -> dict:
    narrations = data.get("narrations") if isinstance(data.get("narrations"), list) else []
    character_scenes = data.get("characterScenes") if isinstance(data.get("characterScenes"), list) else []
    drafted = []
    for i, raw in enumerate(data.get("scenes") if isinstance(data.get("scenes"), list) else []):
        prompt = _text(raw, MAX_SCENE_CHARS)
        if not prompt:
            continue
        drafted.append({
            "prompt": prompt,
            "narration": _text(narrations[i] if i < len(narrations) else None, 300),
            "withCharacter": not (i < len(character_scenes) and character_scenes[i] is False),
        })
    if not MIN_SCENES <= len(drafted) <= MAX_SCENES:
        raise RequestError(f"A story needs {MIN_SCENES} to {MAX_SCENES} scenes.")

    available = await get_availability()
    missing = await missing_model_ids(available)
    image_models = real_models("image", available, missing)
    video_models = real_models("video", available, missing)
    if not image_models or not video_models:
        raise RequestError("Story mode needs a real image and video model. Start ComfyUI first.")
    image_model = image_models[0]
    video_model = next((m for m in video_models if m["id"] == data.get("videoModelId")), video_models[0])

    aspect = data.get("aspect") if data.get("aspect") in ASPECTS else "16:9"
    durations = video_model.get("durations", [5])
    try:
        asked = float(data.get("duration"))
    except (TypeError, ValueError):
        asked = None
    duration = int(asked) if asked in durations else durations[0]
    fixed_camera = data.get("cameraId") if data.get("cameraId") in CAMERAS else None
    style = _text(data.get("style"), 200)

    voice = voice_id(data.get("voiceId"))
    has_lines = any(scene["narration"] for scene in drafted)
    narrated = voice is not None and has_lines
    if narrated and not voice_available():
        raise RequestError("The voice engine is not installed (.tts folder is missing).")
    subtitles = data.get("subtitles") is True and has_lines
    # The lines are kept whenever something will use them: a voice, subtitles, or both.
    keep_lines = narrated or subtitles

    character = _text(data.get("character"), 400)
    own_picture: tuple[str, bytes] | None = None
    if isinstance(data.get("characterImage"), str) and data["characterImage"]:
        decoded = decode_data_url(data["characterImage"], _PICTURE_DATA_URL)
        if decoded is None:
            raise RequestError("The character picture must be a JPEG, PNG or WebP.")
        if len(decoded[1]) > MAX_PICTURE_BYTES:
            raise RequestError("The character picture is too large.")
        own_picture = ("jpg" if decoded[0] == "jpeg" else decoded[0], decoded[1])
    if (character or own_picture) and (not available["comfy"] or CHARACTER_MODEL_ID in missing):
        raise RequestError("Consistent characters need the FLUX Kontext model, which is not installed.")

    story_id = str(uuid.uuid4())
    story: dict[str, Any] = {
        "id": story_id,
        "title": _text(data.get("title"), 120) or drafted[0]["prompt"][:60],
        "style": style,
        "aspect": aspect,
        "duration": duration,
        "imageModelId": image_model["id"],
        "videoModelId": video_model["id"],
        "scenes": [],
        "status": "running",
        "createdAt": now_ms(),
    }
    for i, draft in enumerate(drafted):
        scene: dict[str, Any] = {
            "prompt": draft["prompt"],
            "cameraId": fixed_camera or AUTO_CAMERAS[i % len(AUTO_CAMERAS)],
        }
        if keep_lines:
            scene["narration"] = draft["narration"]
        if not draft["withCharacter"]:
            scene["withCharacter"] = False
        story["scenes"].append(scene)
    if narrated:
        story["voiceId"] = voice
    if subtitles:
        story["subtitles"] = True
    if data.get("fade") is True:
        story["fade"] = True
    if character:
        story["character"] = character

    if isinstance(data.get("music"), str) and data["music"]:
        decoded = decode_data_url(data["music"], _MUSIC_DATA_URL)
        if decoded is None:
            raise RequestError("The music must be an MP3, WAV, M4A or OGG file.")
        if len(decoded[1]) > MAX_MUSIC_BYTES:
            raise RequestError("The music file is larger than 20 MB.")
        story["musicFile"] = save_file(f"{story_id}-music.{_MUSIC_EXT[decoded[0]]}", decoded[1])
    if own_picture:
        story["characterFile"] = save_file(f"{story_id}-character.{own_picture[0]}", own_picture[1])

    # With the user's own picture there is nothing to draw: it is the reference.
    if story.get("character") and not story.get("characterFile"):
        story["characterGenId"] = (await _create_character_reference(story))["id"]
    insert_story(story)

    # Queue the stills up front where possible: the backend then renders all of
    # them before any video, so it swaps between models as little as possible.
    await _submit_stills(story)
    return story


def _fail(story: dict, error: str) -> None:
    update_story(story["id"], {"status": "failed", "error": error})


async def _advance(story: dict) -> None:
    """Moves one story forward: submits scene videos as stills finish, then joins."""
    if story["id"] in _busy:
        return
    _busy.add(story["id"])
    try:
        if story["status"] == "joining":
            # A join normally takes seconds; restart one orphaned by a server restart.
            if now_ms() - story.get("joinStartedAt", 0) > JOIN_TIMEOUT_MS and not _join_running(story["id"]):
                await _join(story)
            return

        await _submit_stills(story)

        finished = True
        for i, scene in enumerate(story["scenes"]):
            if not scene.get("imageGenId"):
                # Still waiting for the character reference.
                finished = False
                continue
            image = get_generation(scene["imageGenId"])
            if image is None or image["status"] == "failed":
                return _fail(story, f"Scene {i + 1} image failed. {(image or {}).get('error', '')}".strip())
            if image["status"] != "done":
                finished = False
                continue

            if not scene.get("videoGenId"):
                video = await create_generation(
                    {
                        "modelId": story["videoModelId"],
                        "prompt": _with_style(scene["prompt"], story["style"]),
                        "aspect": story["aspect"],
                        "duration": story["duration"],
                        "cameraId": scene["cameraId"],
                    },
                    ref_file=await _local_output(image),
                    story_id=story["id"],
                )
                scene["videoGenId"] = video["id"]
                update_story(story["id"], {"scenes": story["scenes"]})
                finished = False
                continue

            video = get_generation(scene["videoGenId"])
            if video is None or video["status"] == "failed":
                return _fail(story, f"Scene {i + 1} video failed. {(video or {}).get('error', '')}".strip())
            if video["status"] != "done":
                finished = False

        if finished:
            await _join(story)
    except Exception as err:  # noqa: BLE001 - shown on the story card, with Resume beside it
        _fail(story, getattr(err, "message", None) or str(err) or err.__class__.__name__)
    finally:
        _busy.discard(story["id"])


def _join_running(story_id: str) -> bool:
    return any(task.get_name() == f"join-{story_id}" and not task.done() for task in _joins)


async def _join(story: dict) -> None:
    """Joins the scene clips (and narration, if any) into one MP4 in the background."""
    clips = []
    for scene in story["scenes"]:
        video = get_generation(scene["videoGenId"]) if scene.get("videoGenId") else None
        if video is None:
            return _fail(story, "A scene clip was deleted before the story was joined.")
        clips.append(file_path(await _local_output(video)))

    update_story(story["id"], {"status": "joining", "joinStartedAt": now_ms()})
    out_name = f"{story['id']}-story.mp4"

    async def work() -> None:
        try:
            await join_clips(
                clips,
                file_path(out_name),
                lines=[scene.get("narration") or "" for scene in story["scenes"]],
                voice=story.get("voiceId"),
                subtitles=bool(story.get("subtitles")),
                fade=bool(story.get("fade")),
                music=file_path(file_name(story["musicFile"])) if story.get("musicFile") else None,
            )
        except Exception as err:  # noqa: BLE001
            update_story(story["id"], {"status": "failed", "error": str(err) or err.__class__.__name__})
        else:
            update_story(story["id"], {"status": "done", "outputUrl": f"/api/files/{out_name}"})

    # Not awaited: speech and encoding can take a while, and polls must stay fast.
    task = asyncio.create_task(work(), name=f"join-{story['id']}")
    _joins.add(task)
    task.add_done_callback(_joins.discard)


def _estimate_eta(story: dict) -> int | None:
    """Remaining render time in seconds, from how long this story's finished clips took."""
    if story["status"] != "running":
        return None
    stamps = []
    done = 0
    for scene in story["scenes"]:
        video = get_generation(scene["videoGenId"]) if scene.get("videoGenId") else None
        if video is None or video["status"] != "done":
            continue
        done += 1
        if video.get("finishedAt"):
            stamps.append(video["finishedAt"])
    stamps.sort()
    if len(stamps) >= 2:
        per_clip = (stamps[-1] - stamps[0]) / (len(stamps) - 1)
    else:
        # Per-clip render time used until two clips of this story have been timed.
        per_clip = story["duration"] * (get_model(story["videoModelId"]) or {}).get("speed", 100) * 1000
    since_last = now_ms() - stamps[-1] if stamps else 0
    remaining = (len(story["scenes"]) - done) * per_clip - min(since_last, per_clip * 0.9)
    return max(60, int(remaining / 1000 + 0.5))


def _view(story: dict) -> dict:
    """A story as sent to the browser, with scene state resolved."""
    steps = 0
    scenes = []
    for scene in story["scenes"]:
        image = get_generation(scene["imageGenId"]) if scene.get("imageGenId") else None
        video = get_generation(scene["videoGenId"]) if scene.get("videoGenId") else None
        image_done = image is not None and image["status"] == "done"
        video_done = video is not None and video["status"] == "done"
        steps += int(image_done) + int(video_done)
        failed = (image or {}).get("status") == "failed" or (video or {}).get("status") == "failed"
        item = {
            "prompt": scene["prompt"],
            "withCharacter": scene.get("withCharacter") is not False,
            "cameraId": scene["cameraId"],
            "stage": "failed" if failed else "done" if video_done else "video" if image_done else "image",
        }
        if scene.get("narration") is not None:
            item["narration"] = scene["narration"]
        if image_done and image.get("outputUrl"):
            item["imageUrl"] = image["outputUrl"]
        if video_done and video.get("outputUrl"):
            item["videoUrl"] = video["outputUrl"]
        scenes.append(item)

    reference = get_generation(story["characterGenId"]) if story.get("characterGenId") else None
    character_url = story.get("characterFile") or (
        reference.get("outputUrl") if reference is not None and reference["status"] == "done" else None
    )
    view = {
        "id": story["id"],
        "title": story["title"],
        "characterUrl": character_url,
        "consistent": bool(story.get("characterGenId") or story.get("characterFile")),
        "aspect": story["aspect"],
        "duration": story["duration"],
        "status": story["status"],
        "voiced": bool(story.get("voiceId")),
        "subtitled": bool(story.get("subtitles")),
        "faded": bool(story.get("fade")),
        "scored": bool(story.get("musicFile")),
        "style": story.get("style", ""),
        "character": story.get("character"),
        "voiceId": story.get("voiceId"),
        "videoModelId": story["videoModelId"],
        "progress": 1 if story["status"] == "done" else steps / (len(story["scenes"]) * 2 + 1),
        "etaSeconds": _estimate_eta(story),
        "outputUrl": story.get("outputUrl"),
        "error": story.get("error"),
        "createdAt": story["createdAt"],
        "scenes": scenes,
    }
    # Unset fields are left out, as the interface expects.
    return {key: value for key, value in view.items() if value is not None}


async def list_stories_with_advance() -> list[dict]:
    active = [s for s in list_stories() if _is_active(s)]
    if active:
        await refresh_running()
        await asyncio.gather(*(_advance(s) for s in active))
    return [_view(s) for s in list_stories()]


def story_view(story_id: str) -> dict | None:
    story = get_story(story_id)
    return _view(story) if story else None


async def resume_story(story_id: str) -> bool:
    """Restarts a failed story from where it stopped.

    Finished scenes are kept; jobs the backend still has are picked up again,
    the rest are resubmitted.
    """
    story = get_story(story_id)
    if story is None:
        return False
    if story["status"] != "failed":
        return True

    if story.get("characterGenId") and not await revive_generation(story["characterGenId"]):
        story["characterGenId"] = (await _create_character_reference(story))["id"]
    # Dead jobs are cleared; the next advance submits fresh ones.
    for scene in story["scenes"]:
        if scene.get("imageGenId") and not await revive_generation(scene["imageGenId"]):
            scene.pop("imageGenId", None)
            scene.pop("videoGenId", None)
        elif scene.get("videoGenId") and not await revive_generation(scene["videoGenId"]):
            scene.pop("videoGenId", None)

    update_story(story_id, {
        "characterGenId": story.get("characterGenId"),
        "scenes": story["scenes"],
        "status": "running",
        "error": None,
    })
    return True


def redo_scene(story_id: str, index: int) -> str:
    """Remakes one scene of a finished story: a new still, a new clip, then a new join.

    The other scenes are reused as they are. Returns "ok", "missing" or "busy".
    """
    story = get_story(story_id)
    if story is None or not 0 <= index < len(story["scenes"]):
        return "missing"
    if story["status"] not in ("done", "failed"):
        return "busy"

    scene = story["scenes"][index]
    scene.pop("imageGenId", None)
    scene.pop("videoGenId", None)
    if story.get("outputUrl"):
        remove_file(file_name(story["outputUrl"]))
    update_story(story_id, {
        "scenes": story["scenes"],
        "status": "running",
        "outputUrl": None,
        "error": None,
        "joinStartedAt": None,
    })
    return "ok"


def remove_story(story_id: str) -> bool:
    """Deletes the story and its joined video. Scene clips stay in the library."""
    story = get_story(story_id)
    if story is None:
        return False
    for key in ("outputUrl", "musicFile", "characterFile"):
        if story.get(key):
            remove_file(file_name(story[key]))
    return delete_story(story_id)


async def tick() -> None:
    """Collects finished jobs and advances every active story, once.

    Called every few seconds by the server's own timer, so rendering continues
    with no browser open.
    """
    global _ticking
    if _ticking:
        return
    _ticking = True
    try:
        # Single images and clips are collected here too, not only story scenes,
        # so a result is saved even if the page that asked for it was closed.
        await refresh_running()
        active = [s for s in list_stories() if _is_active(s)]
        if active:
            await asyncio.gather(*(_advance(s) for s in active))
    finally:
        _ticking = False
