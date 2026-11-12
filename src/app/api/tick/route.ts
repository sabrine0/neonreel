import { NextResponse } from "next/server";
import { tick } from "@/lib/stories";

export const dynamic = "force-dynamic";

/** One step of background work. Called by the server's own timer (lib/ticker.ts). */
export async function POST() {
  try {
    await tick();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Background step failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
