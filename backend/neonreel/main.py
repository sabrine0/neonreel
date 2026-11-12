# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""The web server: the API under /api and the built interface for everything else.

Run it with:  python -m uvicorn neonreel.main:app --app-dir backend --port 4000
"""

import asyncio
import contextlib
import logging
import re
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from . import agent, availability, generations, net, stories, writer
from .catalog import PLATFORMS, voice_id
from .clip import fit_clip
from .config import FRONTEND
from .errors import RequestError
from .render import narrate, voice_available
from .store import file_name, file_path, get_generation, read_file, update_generation

log = logging.getLogger("neonreel")

#: How often finished jobs are collected and stories moved forward, with no browser open.
TICK_SECONDS = 5
MAX_VOICE_CHARS = 3000
MCP_PROTOCOL = "2025-03-26"

_FILE_TYPES = {
    "svg": "image/svg+xml",
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "mp4": "video/mp4",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
}
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


async def _ticker() -> None:
    while True:
        await asyncio.sleep(TICK_SECONDS)
        try:
            await stories.tick()
        except Exception:  # noqa: BLE001 - one bad step must not stop the timer
            log.exception("Background step failed")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_ticker())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    await net.close()


app = FastAPI(title="Neonreel", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(RequestError)
async def _request_error(request: Request, err: RequestError) -> JSONResponse:
    return JSONResponse({"error": err.message}, status_code=err.status)


async def _body(request: Request) -> dict[str, Any]:
    """The request's JSON object. Anything else is refused."""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 - malformed JSON of any kind
        data = None
    if not isinstance(data, dict):
        raise RequestError("Invalid request body.")
    return data


def _origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


# --- Status ------------------------------------------------------------------

@app.get("/api/status")
async def get_status() -> dict:
    return await availability.status()


# --- Pictures and clips ------------------------------------------------------

@app.get("/api/generations")
async def list_generations() -> dict:
    return await generations.list_with_refresh()


@app.post("/api/generations", status_code=201)
async def create_generation(request: Request) -> dict:
    gen = await generations.create_generation(await _body(request))
    return generations.public_view(gen)


@app.patch("/api/generations/{gen_id}")
async def favourite_generation(gen_id: str, request: Request) -> dict:
    """Stars or unstars one result."""
    data = await _body(request)
    if not isinstance(data.get("favorite"), bool):
        raise RequestError("Expected { favorite: true | false }.")
    if get_generation(gen_id) is None:
        raise RequestError("Not found.", 404)
    update_generation(gen_id, {"favorite": True if data["favorite"] else None})
    return generations.public_view(get_generation(gen_id) or {})


@app.delete("/api/generations/{gen_id}", status_code=204)
async def delete_generation(gen_id: str) -> Response:
    if not generations.remove_generation(gen_id):
        raise RequestError("Not found.", 404)
    return Response(status_code=204)


# --- Media files -------------------------------------------------------------

@app.get("/api/files/{name}")
async def get_file(name: str, request: Request) -> Response:
    data = read_file(name)
    if data is None:
        return Response("Not found", status_code=404)
    headers = {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
        # SVGs are generated here, but never let one run script if opened directly.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
    }
    media_type = _FILE_TYPES.get(name.rsplit(".", 1)[-1], "application/octet-stream")

    # Byte ranges let the browser seek within videos.
    match = _RANGE.match(request.headers.get("range", ""))
    if match and (match.group(1) or match.group(2)):
        size = len(data)
        first, last = match.group(1), match.group(2)
        start = int(first) if first else max(0, size - int(last))
        end = min(int(last), size - 1) if first and last else size - 1
        if start >= size or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(data[start : end + 1], status_code=206, media_type=media_type, headers=headers)
    return Response(data, media_type=media_type, headers=headers)


# --- Stories -----------------------------------------------------------------

@app.get("/api/stories")
async def list_stories() -> dict:
    return {"stories": await stories.list_stories_with_advance()}


@app.post("/api/stories", status_code=201)
async def create_story(request: Request) -> dict:
    story = await stories.create_story(await _body(request))
    return stories.story_view(story["id"]) or {}


@app.post("/api/stories/plan")
async def plan_story(request: Request) -> dict:
    return await writer.plan_story(await _body(request))


@app.post("/api/stories/{story_id}")
async def resume_story(story_id: str) -> dict:
    """Resumes a failed story."""
    if not await stories.resume_story(story_id):
        raise RequestError("Not found.", 404)
    return stories.story_view(story_id) or {}


@app.delete("/api/stories/{story_id}", status_code=204)
async def delete_story(story_id: str) -> Response:
    if not stories.remove_story(story_id):
        raise RequestError("Not found.", 404)
    return Response(status_code=204)


@app.post("/api/stories/{story_id}/scenes/{index}")
async def redo_scene(story_id: str, index: str) -> dict:
    """Remakes one scene of a finished story, then the video is joined again."""
    result = stories.redo_scene(story_id, int(index)) if index.isdigit() else "missing"
    if result == "missing":
        raise RequestError("Not found.", 404)
    if result == "busy":
        raise RequestError("Wait until the story has finished rendering.", 409)
    return stories.story_view(story_id) or {}


# --- Writing, voice, sharing -------------------------------------------------

@app.post("/api/prompt")
async def improve_prompt(request: Request) -> dict:
    return {"prompt": await writer.improve_prompt(await _body(request))}


@app.post("/api/voice", status_code=201)
async def speak(request: Request) -> dict:
    """Turns text into a spoken MP3 with the local voice engine."""
    data = await _body(request)
    text = data["text"].strip()[:MAX_VOICE_CHARS] if isinstance(data.get("text"), str) else ""
    voice = voice_id(data.get("voiceId"))
    if not text:
        raise RequestError("Type something to say first.")
    if voice is None:
        raise RequestError("Choose a voice.")
    if not voice_available():
        raise RequestError("The voice engine is not installed (.tts folder is missing).", 503)
    name = f"{uuid.uuid4()}.mp3"
    try:
        await narrate(text, voice, file_path(name))
    except Exception as err:  # noqa: BLE001
        raise RequestError(str(err) or "The voice could not be made.", 502) from None
    return {"url": f"/api/files/{name}", "text": text, "voiceId": voice}


@app.post("/api/share", status_code=201)
async def share(request: Request) -> dict:
    """Makes a copy of a finished video in the shape a platform wants, plus a caption for it."""
    data = await _body(request)
    platform_id = data.get("platform") if isinstance(data.get("platform"), str) else ""
    platform = PLATFORMS.get(platform_id)
    if platform is None:
        raise RequestError("Choose where to share it.")
    source = file_name(data["file"]) if isinstance(data.get("file"), str) else ""
    if not source.endswith(".mp4") or read_file(source) is None:
        raise RequestError("That video is not available.", 404)
    about = data["about"].strip()[:1500] if isinstance(data.get("about"), str) else ""

    name = f"{uuid.uuid4()}-{platform_id}.mp4"
    try:
        caption, _ = await asyncio.gather(
            writer.write_caption(about, platform_id),
            fit_clip(file_path(source), file_path(name), platform["width"], platform["height"]),
        )
    except Exception as err:  # noqa: BLE001
        raise RequestError(f"The video could not be prepared: {err}", 502) from None
    return {"url": f"/api/files/{name}", "caption": caption, "uploadUrl": platform["uploadUrl"]}


# --- Assistant and outside AI apps -------------------------------------------

@app.post("/api/assistant")
async def assistant(request: Request) -> dict:
    return await agent.assistant_reply(await _body(request), _origin(request))


async def _mcp_reply(message: Any, origin: str) -> dict | None:
    if not isinstance(message, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
    msg_id, method = message.get("id"), message.get("method")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}
    # Notifications carry no id and get no reply.
    if msg_id is None:
        return None

    def result(value: dict) -> dict:
        return {"jsonrpc": "2.0", "id": msg_id, "result": value}

    if method == "initialize":
        version = params.get("protocolVersion")
        return result({
            "protocolVersion": version if isinstance(version, str) else MCP_PROTOCOL,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "neonreel", "version": "1.0.0"},
            "instructions": "Neonreel generates pictures, video clips and narrated story videos on this computer. "
            "Creation tools start a job and return an id; use get_status to see when it is done.",
        })
    if method == "ping":
        return result({})
    if method == "tools/list":
        return result({"tools": agent.TOOLS})
    if method == "tools/call":
        outcome = await agent.run_tool(str(params.get("name") or ""), params.get("arguments"), origin)
        return result({"content": [{"type": "text", "text": outcome["text"]}], "isError": bool(outcome.get("isError"))})
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


@app.post("/api/mcp")
async def mcp(request: Request) -> Response:
    """A Model Context Protocol server (Streamable HTTP, JSON responses).

    Lets AI apps create pictures, clips and stories here. Connect an MCP client
    to http://localhost:4000/api/mcp
    """
    origin = _origin(request)
    # Only programs on this computer may drive the studio: a web page elsewhere must not.
    sender = request.headers.get("origin")
    if sender and sender.rstrip("/") != origin:
        return Response("Forbidden", status_code=403)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = None
    if not isinstance(body, (dict, list)) or not body:
        return JSONResponse(
            {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status_code=400
        )
    if isinstance(body, list):
        replies = [r for r in [await _mcp_reply(message, origin) for message in body] if r is not None]
        return JSONResponse(replies) if replies else Response(status_code=202)
    reply = await _mcp_reply(body, origin)
    return JSONResponse(reply) if reply is not None else Response(status_code=202)


@app.get("/api/mcp")
async def mcp_stream() -> Response:
    """This server never pushes messages, so there is no stream to open."""
    return Response("Method Not Allowed", status_code=405, headers={"Allow": "POST"})


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def unknown_api(rest: str) -> JSONResponse:
    return JSONResponse({"error": "Not found."}, status_code=404)


# --- The interface -----------------------------------------------------------

_NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>Neonreel</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#07080f;color:#fff;font:16px system-ui">
<div style="max-width:32rem;padding:2rem;line-height:1.6"><h1 style="font-size:1.5rem">Neonreel is running, but its interface is not built yet.</h1>
<p>Run <code>npm install</code> and <code>npm run build</code> in the <code>frontend</code> folder, then reload this page.</p></div>"""


@app.get("/{path:path}")
async def interface(path: str) -> Response:
    """Serves the built interface. Unknown paths get the app shell, which does its own routing."""
    index = FRONTEND / "index.html"
    if not index.exists():
        return HTMLResponse(_NOT_BUILT, status_code=503)
    target = (FRONTEND / path).resolve()
    if path and target.is_file() and target.is_relative_to(FRONTEND.resolve()):
        # Built files carry a hash in their name, so they never change.
        cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})
    if path.startswith(("assets/", "_next/")):
        # A missing built file must not be answered with the page: the browser would try to run it.
        return Response("Not found", status_code=404)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
