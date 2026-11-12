# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""What an AI can do in Neonreel.

The same tools serve the built-in assistant and outside AI apps over MCP.
"""

import logging
from typing import Any

from .availability import language_model
from .catalog import (
    ASPECTS,
    CAMERAS,
    FAST_VIDEO_MODEL_ID,
    IMAGE_MODEL_ID,
    STYLES,
    VOICES,
    get_model,
    voice_id,
)
from .errors import RequestError
from .generations import create_generation
from .store import file_name, get_generation, get_story, list_generations, list_stories
from .stories import MAX_SCENES, MIN_SCENES, create_story
from .writer import chat, plan_story

log = logging.getLogger("neonreel")

TOOLS: list[dict[str, Any]] = [
    {
        "name": "create_image",
        "description": "Start generating one or more pictures from a text description. Takes about 30 seconds each. Returns the ids to check with get_status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "What the picture shows, in English, in detail."},
                "aspect": {"type": "string", "enum": ASPECTS, "description": "Shape of the picture. Default 16:9."},
                "style": {"type": "string", "enum": list(STYLES), "description": "Optional look."},
                "count": {"type": "integer", "minimum": 1, "maximum": 4, "description": "How many versions. Default 1."},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "create_video",
        "description": "Start generating a short video clip. Give image_id to animate a finished picture from the library (best quality), or only a prompt to make a clip from text. Takes about 2 minutes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "What moves and how, in English."},
                "image_id": {"type": "string", "description": "Id of a finished picture to animate."},
                "camera": {"type": "string", "enum": list(CAMERAS), "description": "Camera move. Default static."},
                "duration": {"type": "integer", "enum": [3, 5], "description": "Seconds. Default 5."},
                "aspect": {"type": "string", "enum": ASPECTS, "description": "Used only without image_id. Default 16:9."},
            },
        },
    },
    {
        "name": "create_story",
        "description": "Write and start rendering a narrated multi-scene story video from one idea. Writing takes up to a few minutes, rendering about 2.5 minutes per scene. Returns the story id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "idea": {"type": "string", "description": "The story idea: who, where, what happens, how it ends."},
                "scenes": {
                    "type": "integer",
                    "minimum": MIN_SCENES,
                    "maximum": MAX_SCENES,
                    "description": "Number of 5-second scenes. Default 4.",
                },
                "voice": {"type": "string", "enum": list(VOICES), "description": "Narrator voice. Default af_heart."},
                "aspect": {"type": "string", "enum": ASPECTS, "description": "Default 16:9. Use 9:16 for phones."},
                "subtitles": {"type": "boolean", "description": "Burn the lines into the picture. Default true."},
            },
            "required": ["idea"],
        },
    },
    {
        "name": "list_library",
        "description": "List the most recent pictures, clips and stories with their ids, status and links.",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Default 10."}},
        },
    },
    {
        "name": "get_status",
        "description": "Check one picture, clip or story by id: running with progress, done with its link, or failed.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
    },
]

ASSISTANT_SYSTEM = """You are the assistant inside Neonreel, an app that makes pictures, short video clips and narrated story videos on the user's own computer.
- When the user wants something made, call a tool.
- Tool prompts must ALWAYS be written in English with added visual detail. If the user writes in another language, translate their idea to English for the tool.
- Only use an image_id that a tool gave you in this conversation. Never make one up.
- A picture must exist before it can be animated: to animate a new idea, call create_image first and tell the user to ask for the animation when the picture is ready, or call create_video with only a prompt.
- Tools only start the work. After calling one, say in one or two short sentences what was started and how long it takes. Never invent links or ids.
- For questions, answer in at most three short sentences.
- Reply in the user's language, in plain text: no Markdown, no asterisks, no lists."""

MAX_ROUNDS = 4
MAX_MESSAGES = 20


def _str(value: Any, limit: int = 2000) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _int(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = round(float(value))
    except (TypeError, ValueError):
        number = 0
    return min(high, max(low, number or default))


def _describe(origin: str, item_id: str) -> str | None:
    gen = get_generation(item_id)
    if gen is not None:
        if gen["status"] == "done":
            state = f"done: {origin}{gen.get('outputUrl')}"
        elif gen["status"] == "failed":
            state = f"failed: {gen.get('error') or 'unknown error'}"
        else:
            state = f"running, {round(gen.get('progress', 0) * 100)}%"
        return f"{gen['kind']} {gen['id']} | {state} | {gen['prompt'][:80]}"
    story = get_story(item_id)
    if story is not None:
        if story["status"] == "done":
            state = f"done: {origin}{story.get('outputUrl')}"
        elif story["status"] == "failed":
            state = f"failed: {story.get('error') or 'unknown error'}"
        else:
            state = f"rendering {len(story['scenes'])} scenes, watch it at {origin}/story"
        return f"story {story['id']} | {state} | {story['title']}"
    return None


def _local_model(model_id: str) -> dict:
    """The local model for a kind of result.

    ComfyUI is not asked whether it is up: while it renders (or the language
    model holds the graphics card) it can take many seconds to answer, and
    submitting the job reports a real outage anyway.
    """
    model = get_model(model_id)
    if model is None:
        raise RequestError("No local model is set up.")
    return model


async def _create_image(args: dict, origin: str) -> dict:
    prompt = _str(args.get("prompt"))
    if not prompt:
        raise RequestError("A prompt is needed.")
    style = STYLES.get(args.get("style")) if isinstance(args.get("style"), str) else None
    model = _local_model(IMAGE_MODEL_ID)
    count = _int(args.get("count"), 1, 1, 4)
    ids = []
    for _ in range(count):
        gen = await create_generation({
            "modelId": model["id"],
            "prompt": f"{prompt}, {style}" if style else prompt,
            "aspect": args.get("aspect"),
        })
        ids.append(gen["id"])
    plural = "" if count == 1 else "s"
    return {"text": f"Started {count} picture{plural} (about 30 seconds each). Ids: {', '.join(ids)}", "generationIds": ids}


async def _create_video(args: dict, origin: str) -> dict:
    prompt = _str(args.get("prompt"))
    image_id = _str(args.get("image_id"), 80)
    source = get_generation(image_id) if image_id else None
    if image_id and (
        source is None or source["kind"] != "image" or source["status"] != "done" or not source.get("outputUrl")
    ):
        raise RequestError("image_id must be the id of a finished picture.")
    if not prompt and source is None:
        raise RequestError("Give a prompt, an image_id, or both.")
    model = _local_model(FAST_VIDEO_MODEL_ID)
    gen = await create_generation(
        {
            "modelId": model["id"],
            "prompt": prompt,
            "aspect": source["aspect"] if source else args.get("aspect"),
            "duration": args.get("duration", 5),
            "cameraId": args.get("camera"),
        },
        ref_file=file_name(source["outputUrl"]) if source else None,
    )
    wait = max(1, round(gen["duration"] * model.get("speed", 100) / 60))
    return {
        "text": f"Started a {gen['duration']}-second clip (about {wait} minutes). Id: {gen['id']}",
        "generationIds": [gen["id"]],
    }


async def _create_story(args: dict, origin: str) -> dict:
    idea = _str(args.get("idea"), 4000)
    if not idea:
        raise RequestError("A story idea is needed.")
    voice = voice_id(args.get("voice")) or "af_heart"
    count = _int(args.get("scenes"), 4, MIN_SCENES, MAX_SCENES)
    plan = await plan_story({"idea": idea, "count": count, "duration": 5, "voiceId": voice})
    story = await create_story({
        **plan,
        "voiceId": voice,
        "subtitles": args.get("subtitles") is not False,
        "aspect": args.get("aspect"),
        "duration": 5,
        "videoModelId": FAST_VIDEO_MODEL_ID,
    })
    minutes = round(len(story["scenes"]) * 2.5)
    return {
        "text": f'Started the story "{story["title"]}" with {len(story["scenes"])} scenes (about {minutes} minutes). '
        f"Id: {story['id']}. Watch it at {origin}/story",
        "storyId": story["id"],
    }


async def _list_library(args: dict, origin: str) -> dict:
    limit = _int(args.get("limit"), 10, 1, 30)
    stories = [_describe(origin, s["id"]) for s in list_stories()[:5]]
    items = [_describe(origin, g["id"]) for g in [g for g in list_generations() if not g.get("storyId")][:limit]]
    lines = [line for line in stories + items if line]
    return {"text": "\n".join(lines) if lines else "The library is empty."}


async def _get_status(args: dict, origin: str) -> dict:
    line = _describe(origin, _str(args.get("id"), 80))
    return {"text": line} if line else {"text": "Nothing has that id.", "isError": True}


_RUNNERS = {
    "create_image": _create_image,
    "create_video": _create_video,
    "create_story": _create_story,
    "list_library": _list_library,
    "get_status": _get_status,
}


async def run_tool(name: str, args: Any, origin: str) -> dict:
    """Runs one tool. Problems come back as an error result, never as an exception.

    Returns {"text", "isError"?, "generationIds"?, "storyId"?}.
    """
    runner = _RUNNERS.get(name)
    if runner is None:
        return {"text": f"Unknown tool: {name}", "isError": True}
    try:
        return await runner(args if isinstance(args, dict) else {}, origin)
    except RequestError as err:
        log.warning("Tool %s refused: %s", name, err.message)
        return {"text": err.message, "isError": True}
    except Exception as err:  # noqa: BLE001
        log.exception("Tool %s failed", name)
        return {"text": str(err) or "The tool failed.", "isError": True}


async def assistant_reply(data: dict[str, Any], origin: str) -> dict:
    """One chat turn: the local language model answers and may start work through tools."""
    history = [
        {"role": m["role"], "content": m["content"][:4000]}
        for m in (data.get("messages") if isinstance(data.get("messages"), list) else [])
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and isinstance(m.get("content"), str)
        and m["content"].strip()
    ][-MAX_MESSAGES:]
    if not history or history[-1]["role"] != "user":
        raise RequestError("Write a message first.")

    model = await language_model()
    if model is None:
        raise RequestError("The assistant needs Ollama running on this computer.", 503)

    messages: list[dict] = [{"role": "system", "content": ASSISTANT_SYSTEM}, *history]
    tools = [
        {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}}
        for t in TOOLS
    ]
    generation_ids: list[str] = []
    story_id: str | None = None

    def answer(text: str) -> dict:
        reply: dict[str, Any] = {"reply": text, "generationIds": generation_ids}
        if story_id:
            reply["storyId"] = story_id
        return reply

    try:
        for _ in range(MAX_ROUNDS):
            reply = await chat(model, messages, temperature=0.4, timeout=240, tools=tools)
            calls = reply.get("tool_calls") or []
            if not calls:
                return answer((reply.get("content") or "").strip() or "Done.")
            messages.append(reply)
            for call in calls:
                function = call.get("function") or {}
                outcome = await run_tool(str(function.get("name") or ""), function.get("arguments"), origin)
                generation_ids.extend(outcome.get("generationIds") or [])
                story_id = outcome.get("storyId") or story_id
                messages.append({
                    "role": "tool",
                    "content": f"Error: {outcome['text']}" if outcome.get("isError") else outcome["text"],
                })
    except Exception as err:  # noqa: BLE001
        raise RequestError(f"The assistant could not answer: {str(err) or err.__class__.__name__}", 502) from None
    return answer("I started that for you.")
