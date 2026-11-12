import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { OLLAMA_URL, ollamaModels, ollamaPlacement } from "@/lib/availability";
import { fitClip } from "@/lib/clip";
import { getPlatform, type Platform } from "@/lib/share";
import { filePath, readFile } from "@/lib/store";

export const dynamic = "force-dynamic";

const FALLBACK_TAGS = "#aivideo #aiart #shortfilm";

/** Writes a caption with hashtags using the local language model; falls back to the description. */
async function writeCaption(about: string, platform: Platform): Promise<string> {
  const fallback = [about.slice(0, 150), FALLBACK_TAGS].filter(Boolean).join("\n\n");
  const model = process.env.OLLAMA_MODEL ?? (await ollamaModels())[0];
  if (!model || !about) return fallback;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        options: { temperature: 0.8, ...(await ollamaPlacement()) },
        messages: [
          {
            role: "system",
            content: `You write social media captions for short AI-made videos. Write ${platform.captionHint}, in the same language as the description. Then, on a new line, 5 to 8 relevant hashtags. Do not claim the video is real footage. Reply with the caption and hashtags only, no quotes, no explanation.`,
          },
          { role: "user", content: `The video: ${about}` },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { message?: { content?: string } };
    const caption = (data.message?.content ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 600);
    return caption || fallback;
  } catch {
    return fallback;
  }
}

/** Makes a copy of a finished video in the shape a platform wants, plus a caption for it. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    file?: unknown;
    platform?: unknown;
    about?: unknown;
  } | null;
  const platform = getPlatform(body?.platform);
  if (!platform) return NextResponse.json({ error: "Choose where to share it." }, { status: 400 });

  const file = typeof body?.file === "string" ? body.file.slice(body.file.lastIndexOf("/") + 1) : "";
  if (!file.endsWith(".mp4") || !readFile(file)) {
    return NextResponse.json({ error: "That video is not available." }, { status: 404 });
  }
  const about = typeof body?.about === "string" ? body.about.trim().slice(0, 1500) : "";

  const name = `${randomUUID()}-${platform.id}.mp4`;
  try {
    const [caption] = await Promise.all([
      writeCaption(about, platform),
      fitClip(filePath(file), filePath(name), platform.width, platform.height),
    ]);
    return NextResponse.json({ url: `/api/files/${name}`, caption, uploadUrl: platform.uploadUrl }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The video could not be prepared: ${message}` }, { status: 502 });
  }
}
