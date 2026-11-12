const TICK_MS = 5000;

type TickerHost = typeof globalThis & { __neonreelTicker?: ReturnType<typeof setInterval> };

/**
 * Starts the server's background timer. It does no work itself: every few
 * seconds it calls this server's own /api/tick route. Going through a route
 * means the work always runs the current code, including after a hot reload
 * in development, where a timer holding function references would keep
 * running the old version.
 */
export function startTicker(): void {
  const host = globalThis as TickerHost;
  if (host.__neonreelTicker) clearInterval(host.__neonreelTicker);
  const url = `http://127.0.0.1:${process.env.PORT ?? 4000}/api/tick`;
  host.__neonreelTicker = setInterval(() => {
    // A failed call only means the server is busy or restarting; the next one retries.
    fetch(url, { method: "POST", signal: AbortSignal.timeout(60_000) }).catch(() => {});
  }, TICK_MS);
  host.__neonreelTicker.unref?.();
}
