import { NextResponse } from "next/server";
import { OLLAMA_URL, ollamaModels, ollamaPlacement } from "@/lib/availability";

export const dynamic = "force-dynamic";

const SYSTEM: Record<string, string> = {
  image:
    "You improve prompts for an AI image generator. Rewrite the user's prompt as one vivid sentence of 30 to 50 words covering the subject, the setting, the lighting and the visual style. Keep the user's meaning and every detail they gave. Do not add text, logos, brand names or real people's names. Reply with the improved prompt only, in English, with no quotes and no explanation.",
  video:
    "You improve prompts for an AI video generator that animates a still picture. Rewrite the user's prompt as one sentence of 25 to 40 words describing what moves and how: the subject's action, motion in the background, and the mood. Keep the user's meaning. Do not mention camera moves, text or logos. Reply with the improved prompt only, in English, with no quotes and no explanation.",
  edit:
    "You improve instructions for an AI image editor. Rewrite the user's instruction as one clear sentence of 15 to 30 words saying exactly what to change and what must stay the same. Keep the user's meaning. Reply with the improved instruction only, in English, with no quotes and no explanation.",
};

/** Rewrites a short prompt into a more detailed one using the local Ollama model. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { prompt?: unknown; mode?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  if (!prompt) return NextResponse.json({ error: "Write a prompt first." }, { status: 400 });
  const system = SYSTEM[typeof body?.mode === "string" ? body.mode : "image"] ?? SYSTEM.image;

  const model = process.env.OLLAMA_MODEL ?? (await ollamaModels())[0];
  if (!model) {
    return NextResponse.json({ error: "Ollama is not running, so prompts cannot be improved." }, { status: 503 });
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model,
        stream: false,
        // Unload straight away so the GPU memory is free for image and video models.
        keep_alive: 0,
        options: { temperature: 0.7, ...(await ollamaPlacement()) },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const improved = (data.message?.content ?? "")
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 2000);
    if (!improved) throw new Error("The model returned nothing.");
    return NextResponse.json({ prompt: improved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not improve the prompt: ${message}` }, { status: 502 });
  }
}
