# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Everything the local language model (Ollama) writes: scenes, prompts, captions."""

import json
import re
from typing import Any

import httpx

from .availability import language_model, ollama_placement
from .catalog import PLATFORMS, VOICES, narration_words, voice_id
from .config import OLLAMA_URL
from .errors import RequestError
from .net import http
from .stories import MAX_SCENES, MIN_SCENES

#: Scenes written per request in step two; small local models lose the plot beyond this.
BATCH = 5

# Step one: the whole plot as one short line per scene. Planning every beat
# before writing any scene is what keeps a long story from stalling halfway
# and repeating itself.
OUTLINE_SYSTEM = """You plan short films. Split the user's idea into a numbered list of story beats, one per scene.

Rules:
- Each beat is one plain sentence saying what happens in that scene.
- Follow the idea's order of events. Beat 1 is the beginning of the idea. The LAST beat is the final event of the idea.
- Every event the idea mentions must appear, including births, deaths and the ending.
- Spread the events evenly. Do not spend most beats on the beginning.
- Every beat is a different moment. Never repeat a beat. If there are more beats than events, add small moments between events (a journey, a quiet look, a change of place).

Also give:
- "title": at most 6 words.
- "style": one short phrase naming a visual style shared by all scenes, such as "cinematic 35mm film, warm golden light".
- "character": the full visual description of the main character in 15 to 30 words (what it is, age, hair, clothing, colours). If the story is about a couple, describe both people together in up to 40 words. Empty string if there is no main character.
Write in English."""

OUTLINE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "style": {"type": "string"},
        "character": {"type": "string"},
        "beats": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "style", "character", "beats"],
}

# Step two: turn a few beats at a time into what is seen and what is heard.
SCENES_SYSTEM = """You write scenes for an AI video generator. You get a story outline and a few numbered beats from it. Write one scene for each beat you are given, in the same order.

Each scene has three parts.

"visual" (always in English):
- One sentence of 20 to 40 words describing what is visible: who, where, what they are doing, the light.
- Each scene is drawn on its own, so describe each person fully every time (age, hair, clothing), using the same words as the character description.
- No dialogue, no on-screen text, no camera directions, no scene numbers.

"narration":
- What is heard over the scene: either a narrator line that tells the story, or a short exchange between the characters.
- Write dialogue with speaker tags, exactly like this: He: I will find a cure. She: I believe you.
- The only tags allowed are He: She: Child: and Narrator: (never use names as tags). In a dialogue scene both people speak, one short sentence each.
- Each beat you are given ends with [narrator] or [dialogue]. Follow it: [narrator] means one narrator line with no tag, [dialogue] means a tagged exchange.
- Count the words. Hard limit of WORDS spoken words for the whole scene. In a dialogue scene that is the total for both speakers, so each person says only 3 to 5 words.
- Written in LANGUAGE.

"showsCharacter": true if the main character or couple is visible in the scene, false if they are not (a scene of only a place, or only other people)."""

SCENES_SCHEMA = {
    "type": "object",
    "properties": {
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "visual": {"type": "string"},
                    "narration": {"type": "string"},
                    "showsCharacter": {"type": "boolean"},
                },
                "required": ["visual", "narration", "showsCharacter"],
            },
        }
    },
    "required": ["scenes"],
}

IMPROVE_SYSTEM = {
    "image": "You improve prompts for an AI image generator. Rewrite the user's prompt as one vivid sentence of 30 to 50 words covering the subject, the setting, the lighting and the visual style. Keep the user's meaning and every detail they gave. Do not add text, logos, brand names or real people's names. Reply with the improved prompt only, in English, with no quotes and no explanation.",
    "video": "You improve prompts for an AI video generator that animates a still picture. Rewrite the user's prompt as one sentence of 25 to 40 words describing what moves and how: the subject's action, motion in the background, and the mood. Keep the user's meaning. Do not mention camera moves, text or logos. Reply with the improved prompt only, in English, with no quotes and no explanation.",
    "edit": "You improve instructions for an AI image editor. Rewrite the user's instruction as one clear sentence of 15 to 30 words saying exactly what to change and what must stay the same. Keep the user's meaning. Reply with the improved instruction only, in English, with no quotes and no explanation.",
}

FALLBACK_TAGS = "#aivideo #aiart #shortfilm"
_QUOTES = "\"'“”"


async def chat(
    model: str,
    messages: list[dict],
    *,
    temperature: float,
    timeout: float,
    keep_alive: int | str = 0,
    schema: dict | None = None,
    tools: list[dict] | None = None,
    placement: bool = True,
) -> dict:
    """One request to the local Ollama model. Returns its reply message.

    keep_alive 0 unloads the model straight away, so the graphics card's
    memory is free for the image and video models.
    """
    options: dict[str, Any] = {"temperature": temperature}
    if placement:
        options.update(await ollama_placement())
    body: dict[str, Any] = {
        "model": model,
        "stream": False,
        "keep_alive": keep_alive,
        "options": options,
        "messages": messages,
    }
    if schema:
        body["format"] = schema
    if tools:
        body["tools"] = tools
    res = await http().post(f"{OLLAMA_URL}/api/chat", json=body, timeout=timeout)
    if res.status_code != 200:
        raise RuntimeError(f"Ollama returned {res.status_code}")
    return res.json().get("message") or {}


def _describe(err: Exception) -> str:
    if isinstance(err, httpx.TimeoutException):
        return "the language model took too long to answer"
    return str(err) or err.__class__.__name__


def _normalize_tags(line: str) -> str:
    """Maps the tags small models invent onto the four the voice step understands."""
    replacements = [
        (r"\[(narrator|dialogue)\]", ""),
        (r"\b(man|husband|boy ?friend|father)\s*:", "He:"),
        (r"\b(woman|wife|girl ?friend|mother)\s*:", "She:"),
        (r"\b(boy|girl|kid|baby|daughter|son)\s*:", "Child:"),
        (r"\b(they|both|together|voice ?over)\s*:", ""),
    ]
    for pattern, replacement in replacements:
        line = re.sub(pattern, replacement, line, flags=re.IGNORECASE)
    return line.strip()


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


async def plan_story(data: dict[str, Any]) -> dict:
    """Turns one idea into a title, a look, a main character and a list of scenes."""
    idea = data["idea"].strip()[:4000] if isinstance(data.get("idea"), str) else ""
    if not idea:
        raise RequestError("Describe your idea first.")
    try:
        count = round(float(data.get("count")))
    except (TypeError, ValueError):
        count = 0
    count = min(MAX_SCENES, max(MIN_SCENES, count or 4))
    try:
        duration = float(data.get("duration")) or 5
    except (TypeError, ValueError):
        duration = 5
    words = narration_words(duration)
    # "English (US)" -> "English"
    language = re.sub(r" \(.*\)$", "", VOICES.get(voice_id(data.get("voiceId")) or "", "English"))

    model = await language_model()
    if model is None:
        raise RequestError(
            "Ollama is not running, so scenes cannot be written automatically. Write them by hand.", 503
        )

    async def ask(system: str, user: str, schema: dict, last: bool) -> dict:
        # Stay loaded between steps; unload after the last one. Scene writing
        # is long, so it stays on the graphics card even while something renders.
        message = await chat(
            model,
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.6,
            timeout=180,
            keep_alive=0 if last else "2m",
            schema=schema,
            placement=False,
        )
        try:
            answer = json.loads(message.get("content") or "{}")
        except ValueError:
            answer = {}
        return answer if isinstance(answer, dict) else {}

    try:
        outline = await ask(OUTLINE_SYSTEM, f"Idea: {idea}\n\nWrite exactly {count} beats.", OUTLINE_SCHEMA, False)
        beats = _strings(outline.get("beats"))[:count]
        if len(beats) < MIN_SCENES:
            raise RuntimeError("The model returned too few scenes.")
        character = outline["character"].strip() if isinstance(outline.get("character"), str) else ""
        style = outline["style"].strip() if isinstance(outline.get("style"), str) else ""

        system = SCENES_SYSTEM.replace("WORDS", str(words)).replace("LANGUAGE", language)
        numbered = [f"{i + 1}. {beat}" for i, beat in enumerate(beats)]
        scenes: list[dict] = []
        for start in range(0, len(beats), BATCH):
            # Alternating by position keeps the mix even; left to itself the model writes dialogue everywhere.
            chunk = [
                f"{beat} {'[narrator]' if (start + i) % 2 == 0 else '[dialogue]'}"
                for i, beat in enumerate(numbered[start : start + BATCH])
            ]
            answer = await ask(
                system,
                "\n\n".join([
                    f"Main character: {character or 'none'}",
                    "Full outline, for context:\n" + "\n".join(numbered),
                    f"Write exactly {len(chunk)} scenes, one for each of these beats:\n" + "\n".join(chunk),
                ]),
                SCENES_SCHEMA,
                start + BATCH >= len(beats),
            )
            written = answer.get("scenes") if isinstance(answer.get("scenes"), list) else []
            # Keep one scene per beat even if the model returns too few or too many.
            for i in range(len(chunk)):
                item = written[i] if i < len(written) and isinstance(written[i], dict) else {}
                visual = item["visual"].strip() if isinstance(item.get("visual"), str) else ""
                scenes.append({
                    "visual": visual or beats[start + i],
                    "narration": _normalize_tags(item["narration"]) if isinstance(item.get("narration"), str) else "",
                    "showsCharacter": item.get("showsCharacter") is not False,
                })
    except Exception as err:  # noqa: BLE001
        raise RequestError(f"Could not write scenes: {_describe(err)}", 502) from None

    return {
        "title": outline["title"].strip() if isinstance(outline.get("title"), str) else "",
        "style": style,
        "character": character,
        "scenes": [scene["visual"] for scene in scenes],
        "narrations": [scene["narration"] for scene in scenes],
        "characterScenes": [scene["showsCharacter"] for scene in scenes],
    }


async def improve_prompt(data: dict[str, Any]) -> str:
    """Rewrites a short prompt into a more detailed one."""
    prompt = data["prompt"].strip()[:2000] if isinstance(data.get("prompt"), str) else ""
    if not prompt:
        raise RequestError("Write a prompt first.")
    system = IMPROVE_SYSTEM.get(data.get("mode") if isinstance(data.get("mode"), str) else "image", IMPROVE_SYSTEM["image"])
    model = await language_model()
    if model is None:
        raise RequestError("Ollama is not running, so prompts cannot be improved.", 503)
    try:
        message = await chat(
            model,
            [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.7,
            timeout=90,
        )
        improved = re.sub(r"\s+", " ", (message.get("content") or "").strip().strip(_QUOTES))[:2000]
        if not improved:
            raise RuntimeError("The model returned nothing.")
    except Exception as err:  # noqa: BLE001
        raise RequestError(f"Could not improve the prompt: {_describe(err)}", 502) from None
    return improved


async def write_caption(about: str, platform_id: str) -> str:
    """A caption with hashtags for a video; falls back to the description when no model answers."""
    fallback = "\n\n".join(part for part in (about[:150], FALLBACK_TAGS) if part)
    model = await language_model()
    if model is None or not about:
        return fallback
    hint = PLATFORMS[platform_id]["captionHint"]
    system = (
        f"You write social media captions for short AI-made videos. Write {hint}, in the same language as the "
        "description. Then, on a new line, 5 to 8 relevant hashtags. Do not claim the video is real footage. "
        "Reply with the caption and hashtags only, no quotes, no explanation."
    )
    try:
        message = await chat(
            model,
            [{"role": "system", "content": system}, {"role": "user", "content": f"The video: {about}"}],
            temperature=0.8,
            timeout=60,
        )
    except Exception:  # noqa: BLE001 - a caption is a nicety; the video is still prepared
        return fallback
    return (message.get("content") or "").strip().strip(_QUOTES)[:600] or fallback
