# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""Keyless stand-in for a real model.

Lets the whole pipeline (queue, polling, credits, library) work end to end
without a graphics card. Images are procedural SVGs; "videos" are a still
frame the browser animates with the chosen camera preset.
"""

from ..catalog import ASPECT_SIZE
from ..config import now_ms
from ..store import save_file

IMAGE_MS = 2500
VIDEO_MS = 6000
_MASK = 0xFFFFFFFF


def _hash(text: str) -> int:
    h = 2166136261
    for char in text:
        h = ((h ^ (ord(char) & 0xFFFF)) * 16777619) & _MASK
    return h


def _render_svg(gen: dict) -> str:
    """Deterministic abstract landscape derived from the prompt."""
    w, h = ASPECT_SIZE[gen["aspect"]]
    seed = _hash(gen["prompt"] or gen["id"])

    def rnd() -> float:
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & _MASK
        return seed / 4294967296

    hue = int(rnd() * 360)
    hue2 = (hue + 40 + int(rnd() * 80)) % 360
    horizon = h * (0.5 + rnd() * 0.2)
    sun_x = w * (0.2 + rnd() * 0.6)
    sun_r = min(w, h) * (0.08 + rnd() * 0.1)

    ridges = []
    for layer in range(3):
        base = horizon + layer * h * 0.09
        points = [f"0,{h}"]
        steps = 10
        for i in range(steps + 1):
            y = base - rnd() * h * (0.16 - layer * 0.04)
            points.append(f"{w / steps * i:.0f},{y:.0f}")
        points.append(f"{w},{h}")
        ridges.append(f'<polygon points="{" ".join(points)}" fill="hsl({hue2} 35% {22 - layer * 7}%)"/>')

    sun_y = horizon - sun_r
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl({hue} 60% 16%)"/>
<stop offset="0.65" stop-color="hsl({hue2} 70% 52%)"/>
<stop offset="1" stop-color="hsl({hue2} 80% 72%)"/>
</linearGradient>
<radialGradient id="sun"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="{w}" height="{h}" fill="url(#sky)"/>
<circle cx="{sun_x:.0f}" cy="{sun_y:.0f}" r="{sun_r * 2.4:.0f}" fill="url(#sun)"/>
<circle cx="{sun_x:.0f}" cy="{sun_y:.0f}" r="{sun_r:.0f}" fill="#fff" fill-opacity="0.9"/>
{"".join(ridges)}
<text x="{w - 16}" y="{h - 16}" text-anchor="end" font-family="monospace" font-size="{round(h / 45)}" fill="#fff" fill-opacity="0.45">DEMO RENDER</text>
</svg>"""


async def submit(gen: dict, model: dict) -> dict:
    return {}


async def check(gen: dict, model: dict) -> dict:
    needed = IMAGE_MS if gen["kind"] == "image" else VIDEO_MS
    elapsed = now_ms() - gen["createdAt"]
    if elapsed < needed:
        return {"status": "running", "progress": elapsed / needed}
    if gen["kind"] == "image":
        return {"status": "done", "outputUrl": save_file(f"{gen['id']}.svg", _render_svg(gen)), "outputType": "image"}
    return {
        "status": "done",
        "outputUrl": gen.get("refImage") or save_file(f"{gen['id']}.svg", _render_svg(gen)),
        "outputType": "motion",
    }
