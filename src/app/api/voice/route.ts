// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getVoice } from "@/lib/catalog";
import { narrate, voiceAvailable } from "@/lib/render";
import { filePath } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_CHARS = 3000;

/** Turns text into a spoken MP3 with the local voice engine. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: unknown; voiceId?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_CHARS) : "";
  const voice = getVoice(typeof body?.voiceId === "string" ? body.voiceId : undefined);
  if (!text) return NextResponse.json({ error: "Type something to say first." }, { status: 400 });
  if (!voice) return NextResponse.json({ error: "Choose a voice." }, { status: 400 });
  if (!voiceAvailable()) {
    return NextResponse.json({ error: "The voice engine is not installed (.tts folder is missing)." }, { status: 503 });
  }

  const name = `${randomUUID()}.mp3`;
  try {
    await narrate(text, voice.id, filePath(name));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ url: `/api/files/${name}`, text, voiceId: voice.id }, { status: 201 });
}
