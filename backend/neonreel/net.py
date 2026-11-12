# Neonreel - made by sabrine0 (https://github.com/sabrine0)
"""One shared HTTP client for talking to ComfyUI, Ollama and hosted models."""

import httpx

_client: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        # Each call sets its own time limit; this default only covers the ones that forget.
        _client = httpx.AsyncClient(timeout=30, follow_redirects=True)
    return _client


async def close() -> None:
    if _client is not None and not _client.is_closed:
        await _client.aclose()
