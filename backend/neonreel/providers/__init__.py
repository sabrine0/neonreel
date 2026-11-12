# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""One module per backend that can make a picture or a clip.

Each provider module has two coroutines:

    submit(gen, model) -> dict     Starts the job. The returned handles are
                                   stored on the generation as "job".
    check(gen, model) -> dict      Polls the job. Returns one of
                                   {"status": "running", "progress": 0..1}
                                   {"status": "done", "outputUrl": ..., "outputType": ...}
                                   {"status": "failed", "error": ...}

To add a backend, write a module with those two and register it below.
"""

from types import ModuleType

from . import comfy, fal, ffmpeg, mock

_PROVIDERS: dict[str, ModuleType] = {"mock": mock, "comfy": comfy, "fal": fal, "ffmpeg": ffmpeg}


def provider_for(model: dict) -> ModuleType:
    return _PROVIDERS[model["provider"]]
