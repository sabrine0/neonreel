# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Speaks narration lines with Kokoro and writes one WAV per line.

Usage: python tts.py <job.json>
job.json: {"voice": "af_heart", "speed": 1.0, "lines": [{"text": "...", "out": "C:/path/a.wav"}]}
A line may carry its own "voice", which overrides the job's.

Called by src/lib/render.ts. Loads the model once for the whole batch.
"""

import json
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

MODELS = Path(__file__).resolve().parent.parent / ".tts" / "models"

# Kokoro voice ids start with a language letter.
LANGUAGES = {"a": "en-us", "b": "en-gb", "f": "fr-fr", "e": "es", "i": "it", "p": "pt-br"}


def main() -> None:
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    for line in job["lines"]:
        voice = line.get("voice") or job["voice"]
        samples, rate = kokoro.create(
            line["text"],
            voice=voice,
            speed=float(job.get("speed", 1.0)),
            lang=LANGUAGES.get(voice[0], "en-us"),
        )
        sf.write(line["out"], samples, rate)


if __name__ == "__main__":
    main()
