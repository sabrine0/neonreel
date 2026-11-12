// Neonreel - made by sabrine0 (https://github.com/sabrine0)
/** Runs once when the server starts: begin the background timer that keeps jobs and stories moving. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTicker } = await import("./lib/ticker");
  startTicker();
}
