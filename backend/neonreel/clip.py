# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""FFmpeg helpers and small jobs on a single clip."""

import asyncio
import re
import subprocess
from pathlib import Path

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_ENCODE = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-an"]


async def run(args: list[str], cwd: Path | None = None, timeout: float | None = None) -> str:
    """Runs a program off the event loop and returns what it printed. Raises CalledProcessError on failure."""
    result = await asyncio.to_thread(
        subprocess.run,
        args,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=True,
        creationflags=_NO_WINDOW,
    )
    return result.stdout


async def ffmpeg(args: list[str], cwd: Path | None = None) -> None:
    try:
        await run(["ffmpeg", "-y", "-v", "error", *args], cwd=cwd)
    except FileNotFoundError:
        raise RuntimeError("FFmpeg was not found on PATH.") from None
    except subprocess.CalledProcessError as err:
        raise RuntimeError(f"FFmpeg failed. {(err.stderr or '').strip()[:300]}") from None


async def probe(file: str | Path, entries: str, stream: str | None = None) -> str:
    select = ["-select_streams", stream] if stream else []
    try:
        out = await run(
            ["ffprobe", "-v", "error", *select, "-show_entries", entries, "-of", "csv=p=0", str(file)]
        )
    except FileNotFoundError:
        raise RuntimeError("FFmpeg was not found on PATH.") from None
    except subprocess.CalledProcessError:
        raise RuntimeError("That clip could not be read.") from None
    return out.strip()


async def duration_of(file: str | Path) -> float:
    try:
        seconds = float(await probe(file, "format=duration"))
    except ValueError:
        seconds = 0
    if seconds <= 0:
        raise RuntimeError(f"Could not read duration of {file}")
    return seconds


async def shape_of(file: str | Path) -> tuple[int, int, str]:
    """Width, height and frame rate (as FFmpeg writes it, for example "24/1")."""
    parts = (await probe(file, "stream=width,height,r_frame_rate", "v:0")).split(",")
    if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit() or not re.fullmatch(r"\d+/\d+", parts[2]):
        raise RuntimeError("That clip could not be read.")
    return int(parts[0]), int(parts[1]), parts[2]


async def last_frame(clip: Path, out: Path) -> None:
    """Saves the final frame of a clip as a picture."""
    # Reads only the last second and keeps overwriting, so the last frame wins.
    await ffmpeg(["-sseof", "-1", "-i", str(clip), "-update", "1", "-frames:v", "1000", str(out)])


async def append_clip(first: Path, following: Path, out: Path) -> None:
    """Joins `following` onto the end of `first`.

    `following` starts on the last frame of `first`, so its first frame is
    dropped; it is resized to match if needed.
    """
    width, height, fps = await shape_of(first)
    graph = (
        f"[0:v]fps={fps},setsar=1[a];"
        f"[1:v]scale={width}:{height},fps={fps},setsar=1,trim=start_frame=1,setpts=PTS-STARTPTS[b];"
        "[a][b]concat=n=2:v=1:a=0[v]"
    )
    await ffmpeg(["-i", str(first), "-i", str(following), "-filter_complex", graph, "-map", "[v]", *_ENCODE, str(out)])


async def fit_clip(clip: Path, out: Path, width: int, height: int) -> None:
    """Fits a video into a frame of another shape without cutting anything off.

    The whole picture is centred over a blurred, enlarged copy of itself. Sound is kept.
    """
    own_width, own_height, _ = await shape_of(clip)
    size = f"{width}:{height}"
    if abs(own_width / own_height - width / height) < 0.02:
        graph = f"[0:v]scale={size},setsar=1[v]"
    else:
        graph = (
            "[0:v]split[a][b];"
            f"[a]scale={size}:force_original_aspect_ratio=increase,crop={size},boxblur=24:2,eq=brightness=-0.12[bg];"
            f"[b]scale={size}:force_original_aspect_ratio=decrease[fg];"
            "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]"
        )
    await ffmpeg([
        "-i", str(clip),
        "-filter_complex", graph,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        str(out),
    ])


async def reverse_clip(clip: Path, out: Path) -> None:
    await ffmpeg(["-i", str(clip), "-vf", "reverse", *_ENCODE, str(out)])


async def loop_clip(clip: Path, out: Path) -> None:
    """Forward then backward, so the clip repeats with no jump."""
    # The backward half skips its first frame, which would repeat the turning point.
    graph = "[0:v]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0[v]"
    await ffmpeg(["-i", str(clip), "-filter_complex", graph, "-map", "[v]", *_ENCODE, str(out)])


async def slow_clip(clip: Path, out: Path) -> None:
    """Half speed."""
    await ffmpeg(["-i", str(clip), "-vf", "setpts=2*PTS", *_ENCODE, str(out)])
