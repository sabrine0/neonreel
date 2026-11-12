# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Joining scene clips into one video, with voice, subtitles, fades and music."""

import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .catalog import split_dialogue
from .clip import duration_of, ffmpeg, probe, run
from .config import ROOT

_TTS_VENV_PYTHON = ROOT / ".tts" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
_TTS_SCRIPT = ROOT / "tools" / "tts.py"
_TTS_MODEL = ROOT / ".tts" / "models" / "kokoro-v1.0.onnx"

#: Pause before a line starts, so speech does not land exactly on the cut.
LEAD_IN_SECONDS = 0.15
#: Pause between two speakers in the same scene.
PART_GAP_SECONDS = 0.2
#: Lines that overrun their scene are sped up, at most this much, then cut.
MAX_TEMPO = 1.4
#: How long a subtitle stays after its line has been spoken.
SUBTITLE_LINGER_SECONDS = 0.4
SUBTITLE_FILE = "subtitles.ass"
#: Length of the fade to and from black at each cut.
FADE_SECONDS = 0.3
#: Music level under a voice, and on its own.
MUSIC_UNDER_VOICE = 0.16
MUSIC_ALONE = 0.55


def _tts_python() -> str | None:
    """The Python that has the Kokoro voice engine: its own .tts environment, or this one."""
    if _TTS_VENV_PYTHON.exists():
        return str(_TTS_VENV_PYTHON)
    if importlib.util.find_spec("kokoro_onnx") is not None:
        return sys.executable
    return None


def voice_available() -> bool:
    """True when the local text-to-speech engine (Kokoro) and its model files are installed."""
    return _TTS_MODEL.exists() and _tts_python() is not None


async def _speak(lines: list[dict], voice: str, work: Path) -> None:
    """Speaks each line into its own WAV file with the local Kokoro engine.

    Runs as a separate process, so the model's memory is released when it is done.
    """
    python = _tts_python()
    if python is None:
        raise RuntimeError("The voice engine is not installed.")
    job = work / "tts-job.json"
    job.write_text(json.dumps({"voice": voice, "speed": 1, "lines": lines}), encoding="utf-8")
    try:
        await run([python, str(_TTS_SCRIPT), str(job)], timeout=10 * 60)
    except subprocess.CalledProcessError as err:
        last = ((err.stderr or "").strip().splitlines() or [""])[-1]
        raise RuntimeError(f"Text-to-speech failed. {last[:300]}") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError("Text-to-speech took too long.") from None


async def _merge_parts(files: list[Path], out: Path, encode: list[str]) -> None:
    """Puts several speakers' audio back to back with a short breath between."""
    padded = [f"[{i}:a]apad=pad_dur={PART_GAP_SECONDS}[p{i}]" for i in range(len(files))]
    labels = "".join(f"[p{i}]" for i in range(len(files)))
    inputs = [arg for file in files for arg in ("-i", str(file))]
    await ffmpeg([
        *inputs,
        "-filter_complex", f"{';'.join(padded)};{labels}concat=n={len(files)}:v=0:a=1[out]",
        "-map", "[out]",
        *encode,
        str(out),
    ])


async def narrate(text: str, voice: str, out: Path) -> None:
    """Speaks a text into one MP3.

    Speaker tags (He:, She:, Child:, Narrator:) switch voices, as they do in stories.
    """
    parts = split_dialogue(text, voice)
    if not parts:
        raise RuntimeError("There is nothing to say.")
    work = Path(tempfile.mkdtemp(prefix="neonreel-"))
    try:
        jobs = [
            {"text": part["text"], "voice": part["voiceId"], "out": str(work / f"part-{i}.wav")}
            for i, part in enumerate(parts)
        ]
        await _speak(jobs, voice, work)
        encode = ["-c:a", "libmp3lame", "-q:a", "3"]
        if len(jobs) == 1:
            await ffmpeg(["-i", jobs[0]["out"], *encode, str(out)])
        else:
            await _merge_parts([Path(job["out"]) for job in jobs], out, encode)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _ass_time(seconds: float) -> str:
    total = max(0, int(seconds * 100 + 0.5))
    return f"{total // 360000}:{total // 6000 % 60:02d}:{total // 100 % 60:02d}.{total % 100:02d}"


def _cue_text(parts: list[dict]) -> str:
    """Subtitle text for one scene: dialogue gets one dashed line per speaker."""

    def clean(text: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[{}\\]", "", text)).strip()

    if len(parts) > 1:
        return "\\N".join(f"- {clean(part['text'])}" for part in parts)
    return clean(parts[0]["text"])


def _write_subtitles(file: Path, cues: list[dict], width: int, height: int) -> None:
    """Writes an ASS subtitle file sized to the video, bottom centre, white on a soft outline."""
    size = int(height * 0.05 + 0.5)
    margin = int(height * 0.06 + 0.5)
    side = int(width * 0.08 + 0.5)
    outline = max(2, int(size / 14 + 0.5))
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,Arial,{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline},1,2,{side},{side},{margin},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    lines += [
        f"Dialogue: 0,{_ass_time(cue['start'])},{_ass_time(cue['end'])},Default,,0,0,0,,{cue['text']}" for cue in cues
    ]
    file.write_text("\n".join([*lines, ""]), encoding="utf-8")


async def join_clips(
    clips: list[Path],
    out: Path,
    *,
    lines: list[str] | None = None,
    voice: str | None = None,
    subtitles: bool = False,
    fade: bool = False,
    music: Path | None = None,
) -> None:
    """Concatenates clips into one MP4.

    lines      one line per clip (may hold dialogue tags); empty string for none
    voice      speak the lines with this narrator voice; None for a silent video
    subtitles  burn the lines into the picture
    fade       fade each scene in from black and out to black instead of cutting
    music      an audio file played under the whole video, looped if it is shorter

    Each scene's line is placed at the start of its own clip, so voice and
    picture stay in step.
    """
    work = Path(tempfile.mkdtemp(prefix="neonreel-"))
    try:
        listing = work / "clips.txt"
        listing.write_text(
            "\n".join("file '{}'".format(str(clip).replace("\\", "/").replace("'", "'\\''")) for clip in clips),
            encoding="utf-8",
        )
        video = ["-f", "concat", "-safe", "0", "-i", str(listing)]
        # Re-encode so clips from different runs always join cleanly.
        encode = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"]

        # A line can hold several speakers; each part is spoken in its own voice.
        lines = lines or []
        parts = [split_dialogue(lines[i] if i < len(lines) else "", voice or "") for i in range(len(clips))]
        has_lines = any(parts)
        voiced = bool(voice) and has_lines
        captioned = subtitles and has_lines
        if music is not None and not music.exists():
            music = None

        if not voiced and not captioned and not fade and music is None:
            await ffmpeg([*video, *encode, "-an", str(out)])
            return

        lengths = [await duration_of(clip) for clip in clips]
        total = sum(lengths)

        # One speech file per scene: its parts back to back with a short breath between.
        speech: list[Path | None] = [None] * len(clips)
        if voiced:
            jobs = [
                [
                    {"text": part["text"], "voice": part["voiceId"], "out": str(work / f"line-{i}-{j}.wav")}
                    for j, part in enumerate(scene)
                ]
                for i, scene in enumerate(parts)
            ]
            await _speak([job for scene in jobs for job in scene], voice or "", work)
            for i, scene in enumerate(jobs):
                if not scene:
                    continue
                merged = work / f"line-{i}.wav"
                if len(scene) == 1:
                    Path(scene[0]["out"]).rename(merged)
                else:
                    await _merge_parts([Path(job["out"]) for job in scene], merged, [])
                speech[i] = merged

        # Picture: one joined stream, or every clip on its own input so each can fade.
        inputs: list[str] = [arg for clip in clips for arg in ("-i", str(clip))] if fade else list(video)
        filters: list[str] = []
        picture = "0:v"
        if fade:
            for i, length in enumerate(lengths):
                fade_out = max(0.0, length - FADE_SECONDS)
                filters.append(
                    f"[{i}:v]fade=t=in:st=0:d={FADE_SECONDS},fade=t=out:st={fade_out:.3f}:d={FADE_SECONDS},setsar=1[v{i}]"
                )
            filters.append(f"{''.join(f'[v{i}]' for i in range(len(clips)))}concat=n={len(clips)}:v=1:a=0[vcat]")
            picture = "[vcat]"
        # Index the next added input will have.
        next_input = len(clips) if fade else 1

        # Build one audio segment per clip, exactly as long as the clip, and time the subtitles.
        cues: list[dict] = []
        offset = 0.0
        for i, length in enumerate(lengths):
            index = next_input
            file = speech[i]
            spoken_for = length - LEAD_IN_SECONDS - 0.1

            if file is not None:
                room = max(0.5, length - LEAD_IN_SECONDS - 0.1)
                raw = await duration_of(file)
                tempo = min(MAX_TEMPO, max(1.0, raw / room))
                spoken_for = min(room, raw / tempo)
                inputs += ["-i", str(file)]
                next_input += 1
                filters.append(
                    f"[{index}:a]aresample=48000,atempo={tempo:.3f},"
                    f"adelay={int(LEAD_IN_SECONDS * 1000 + 0.5)},apad,"
                    f"atrim=0:{length:.3f},asetpts=N/SR/TB[a{i}]"
                )
            elif voiced:
                inputs += ["-f", "lavfi", "-t", f"{length:.3f}", "-i", "anullsrc=r=48000:cl=mono"]
                next_input += 1
                filters.append(f"[{index}:a]asetpts=N/SR/TB[a{i}]")

            if captioned and parts[i]:
                start = offset + LEAD_IN_SECONDS
                # Spoken lines stay a moment after the voice; silent ones fill the scene.
                end = (
                    min(offset + length - 0.05, start + spoken_for + SUBTITLE_LINGER_SECONDS)
                    if file is not None
                    else offset + length - 0.1
                )
                cues.append({"start": start, "end": end, "text": _cue_text(parts[i])})
            offset += length

        if captioned:
            width, height = (int(v) for v in (await probe(clips[0], "stream=width,height", "v:0")).split(",")[:2])
            _write_subtitles(work / SUBTITLE_FILE, cues, width, height)
            # Referenced by bare name with the work folder as the current folder: Windows
            # paths (drive colon, backslashes) cannot be escaped reliably inside a filter.
            filters.append(f"[{picture.strip('[]')}]subtitles={SUBTITLE_FILE}[vout]")
            picture = "[vout]"

        sound: str | None = None
        if voiced:
            filters.append(
                f"{''.join(f'[a{i}]' for i in range(len(clips)))}concat=n={len(clips)}:v=0:a=1,"
                "aformat=channel_layouts=stereo[voice]"
            )
            sound = "[voice]"
        if music is not None:
            # Looped to cover the video, cut to its length, faded in and out.
            inputs += ["-stream_loop", "-1", "-i", str(music)]
            level = MUSIC_UNDER_VOICE if voiced else MUSIC_ALONE
            fade_out = max(0.0, total - 2)
            filters.append(
                f"[{next_input}:a]aresample=48000,aformat=channel_layouts=stereo,volume={level},"
                f"atrim=0:{total:.3f},afade=t=in:d=1,afade=t=out:st={fade_out:.3f}:d=2,asetpts=N/SR/TB[music]"
            )
            next_input += 1
            if sound:
                filters.append(f"{sound}[music]amix=inputs=2:duration=first:normalize=0[mixed]")
                sound = "[mixed]"
            else:
                sound = "[music]"

        await ffmpeg(
            [
                *inputs,
                *(["-filter_complex", ";".join(filters)] if filters else []),
                "-map", picture,
                *(["-map", sound, "-c:a", "aac", "-b:a", "192k"] if sound else ["-an"]),
                *encode,
                str(out),
            ],
            cwd=work,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
