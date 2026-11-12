import { NextResponse } from "next/server";
import { OLLAMA_URL, ollamaModels } from "@/lib/availability";
import { getVoice, narrationWords } from "@/lib/catalog";
import { MAX_SCENES, MIN_SCENES } from "@/lib/stories";

export const dynamic = "force-dynamic";

/** Scenes written per request in step two; small local models lose the plot beyond this. */
const BATCH = 5;

/**
 * Step one: the whole plot as one short line per scene. Planning every beat
 * before writing any scene is what keeps a long story from stalling halfway
 * and repeating itself.
 */
const OUTLINE_SYSTEM = `You plan short films. Split the user's idea into a numbered list of story beats, one per scene.

Rules:
- Each beat is one plain sentence saying what happens in that scene.
- Follow the idea's order of events. Beat 1 is the beginning of the idea. The LAST beat is the final event of the idea.
- Every event the idea mentions must appear, including births, deaths and the ending.
- Spread the events evenly. Do not spend most beats on the beginning.
- Every beat is a different moment. Never repeat a beat. If there are more beats than events, add small moments between events (a journey, a quiet look, a change of place).

Also give:
- "title": at most 6 words.
- "style": one short phrase naming a visual style shared by all scenes, such as "cinematic 35mm film, warm golden light".
- "character": the full visual description of the main character in 15 to 30 words (what it is, age, hair, clothing, colours). If the story is about a couple, describe both people together in up to 40 words. Empty string if there is no main character.
Write in English.`;

const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    style: { type: "string" },
    character: { type: "string" },
    beats: { type: "array", items: { type: "string" } },
  },
  required: ["title", "style", "character", "beats"],
};

/** Step two: turn a few beats at a time into what is seen and what is heard. */
const SCENES_SYSTEM = `You write scenes for an AI video generator. You get a story outline and a few numbered beats from it. Write one scene for each beat you are given, in the same order.

Each scene has three parts.

"visual" (always in English):
- One sentence of 20 to 40 words describing what is visible: who, where, what they are doing, the light.
- Each scene is drawn on its own, so describe each person fully every time (age, hair, clothing), using the same words as the character description.
- No dialogue, no on-screen text, no camera directions, no scene numbers.

"narration":
- What is heard over the scene: either a narrator line that tells the story, or a short exchange between the characters.
- Write dialogue with speaker tags, exactly like this: He: I will find a cure. She: I believe you.
- The only tags allowed are He: She: Child: and Narrator: (never use names as tags). In a dialogue scene both people speak, one short sentence each.
- Each beat you are given ends with [narrator] or [dialogue]. Follow it: [narrator] means one narrator line with no tag, [dialogue] means a tagged exchange.
- Count the words. Hard limit of WORDS spoken words for the whole scene. In a dialogue scene that is the total for both speakers, so each person says only 3 to 5 words.
- Written in LANGUAGE.

"showsCharacter": true if the main character or couple is visible in the scene, false if they are not (a scene of only a place, or only other people).`;

const SCENES_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          visual: { type: "string" },
          narration: { type: "string" },
          showsCharacter: { type: "boolean" },
        },
        required: ["visual", "narration", "showsCharacter"],
      },
    },
  },
  required: ["scenes"],
};

interface Scene {
  visual: string;
  narration: string;
  showsCharacter: boolean;
}

/** One JSON-schema-constrained chat request to the local Ollama model. */
async function ask<T>(
  model: string,
  system: string,
  user: string,
  schema: object,
  last: boolean,
): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      stream: false,
      // Stay loaded between steps; unload after the last one so the GPU
      // memory is free for the image and video models.
      keep_alive: last ? 0 : "2m",
      format: schema,
      options: { temperature: 0.6 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return JSON.parse(data.message?.content ?? "{}") as T;
}

/** Maps the tags small models invent onto the four the voice step understands. */
function normalizeTags(line: string): string {
  return line
    .replace(/\[(narrator|dialogue)\]/gi, "")
    .replace(/\b(man|husband|boy ?friend|father)\s*:/gi, "He:")
    .replace(/\b(woman|wife|girl ?friend|mother)\s*:/gi, "She:")
    .replace(/\b(boy|girl|kid|baby|daughter|son)\s*:/gi, "Child:")
    .replace(/\b(they|both|together|voice ?over)\s*:/gi, "")
    .trim();
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
    : [];
}

/** Turns an idea into a scene list using the local Ollama model, in two steps. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    idea?: unknown;
    count?: unknown;
    duration?: unknown;
    voiceId?: unknown;
  } | null;
  const idea = typeof body?.idea === "string" ? body.idea.trim().slice(0, 4000) : "";
  if (!idea) return NextResponse.json({ error: "Describe your idea first." }, { status: 400 });
  const count = Math.min(MAX_SCENES, Math.max(MIN_SCENES, Math.round(Number(body?.count)) || 4));

  const words = narrationWords(Number(body?.duration) || 5);
  // "English (US)" -> "English"
  const voice = getVoice(typeof body?.voiceId === "string" ? body.voiceId : undefined);
  const language = (voice?.language ?? "English").replace(/ \(.*\)$/, "");

  const model = process.env.OLLAMA_MODEL ?? (await ollamaModels())[0];
  if (!model) {
    return NextResponse.json(
      { error: "Ollama is not running, so scenes cannot be written automatically. Write them by hand." },
      { status: 503 },
    );
  }

  try {
    const outline = await ask<{ title?: unknown; style?: unknown; character?: unknown; beats?: unknown }>(
      model,
      OUTLINE_SYSTEM,
      `Idea: ${idea}\n\nWrite exactly ${count} beats.`,
      OUTLINE_SCHEMA,
      false,
    );
    const beats = strings(outline.beats).slice(0, count);
    if (beats.length < MIN_SCENES) throw new Error("The model returned too few scenes.");
    const character = typeof outline.character === "string" ? outline.character.trim() : "";
    const style = typeof outline.style === "string" ? outline.style.trim() : "";

    const system = SCENES_SYSTEM.replace("WORDS", String(words)).replace("LANGUAGE", language);
    const numbered = beats.map((beat, i) => `${i + 1}. ${beat}`);
    const scenes: Scene[] = [];
    for (let start = 0; start < beats.length; start += BATCH) {
      // Alternating by position keeps the mix even; left to itself the model writes dialogue everywhere.
      const chunk = numbered
        .slice(start, start + BATCH)
        .map((beat, i) => `${beat} ${(start + i) % 2 === 0 ? "[narrator]" : "[dialogue]"}`);
      const answer = await ask<{ scenes?: unknown }>(
        model,
        system,
        [
          `Main character: ${character || "none"}`,
          `Full outline, for context:\n${numbered.join("\n")}`,
          `Write exactly ${chunk.length} scenes, one for each of these beats:\n${chunk.join("\n")}`,
        ].join("\n\n"),
        SCENES_SCHEMA,
        start + BATCH >= beats.length,
      );
      const written = Array.isArray(answer.scenes) ? answer.scenes : [];
      // Keep one scene per beat even if the model returns too few or too many.
      chunk.forEach((_, i) => {
        const item = (written[i] ?? {}) as Partial<Record<keyof Scene, unknown>>;
        const visual = typeof item.visual === "string" ? item.visual.trim() : "";
        scenes.push({
          visual: visual || beats[start + i],
          narration: typeof item.narration === "string" ? normalizeTags(item.narration) : "",
          showsCharacter: item.showsCharacter !== false,
        });
      });
    }

    return NextResponse.json({
      title: typeof outline.title === "string" ? outline.title.trim() : "",
      style,
      character,
      scenes: scenes.map((scene) => scene.visual),
      narrations: scenes.map((scene) => scene.narration),
      characterScenes: scenes.map((scene) => scene.showsCharacter),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not write scenes: ${message}` }, { status: 502 });
  }
}
