// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { NextResponse } from "next/server";
import { AGENT_TOOLS, runTool } from "@/lib/agent";
import { OLLAMA_URL, ollamaModels, ollamaPlacement } from "@/lib/availability";

export const dynamic = "force-dynamic";

const SYSTEM = `You are the assistant inside Neonreel, an app that makes pictures, short video clips and narrated story videos on the user's own computer.
- When the user wants something made, call a tool.
- Tool prompts must ALWAYS be written in English with added visual detail. If the user writes in another language, translate their idea to English for the tool.
- Only use an image_id that a tool gave you in this conversation. Never make one up.
- A picture must exist before it can be animated: to animate a new idea, call create_image first and tell the user to ask for the animation when the picture is ready, or call create_video with only a prompt.
- Tools only start the work. After calling one, say in one or two short sentences what was started and how long it takes. Never invent links or ids.
- For questions, answer in at most three short sentences.
- Reply in the user's language, in plain text: no Markdown, no asterisks, no lists.`;

const MAX_ROUNDS = 4;
const MAX_MESSAGES = 20;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
}

/** One chat turn: the local language model answers and may start work through tools. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
  const history = (Array.isArray(body?.messages) ? body.messages : [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        Boolean(m.content.trim()),
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (history.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  }

  const model = process.env.OLLAMA_MODEL ?? (await ollamaModels())[0];
  if (!model) {
    return NextResponse.json({ error: "The assistant needs Ollama running on this computer." }, { status: 503 });
  }

  const origin = new URL(req.url).origin;
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }, ...history];
  const generationIds: string[] = [];
  let storyId: string | undefined;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(240_000),
        body: JSON.stringify({
          model,
          stream: false,
          // Unload straight away so the GPU memory is free for image and video models.
          keep_alive: 0,
          options: { temperature: 0.4, ...(await ollamaPlacement()) },
          messages,
          tools: AGENT_TOOLS.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          })),
        }),
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      const reply = ((await res.json()) as { message?: ChatMessage }).message;
      if (!reply) throw new Error("The model returned nothing.");

      const calls = reply.tool_calls ?? [];
      if (calls.length === 0) {
        return NextResponse.json({ reply: reply.content.trim(), generationIds, storyId });
      }
      messages.push(reply);
      for (const call of calls) {
        const outcome = await runTool(call.function.name, call.function.arguments, origin);
        generationIds.push(...(outcome.generationIds ?? []));
        storyId = outcome.storyId ?? storyId;
        messages.push({ role: "tool", content: outcome.isError ? `Error: ${outcome.text}` : outcome.text });
      }
    }
    return NextResponse.json({ reply: "I started that for you.", generationIds, storyId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The assistant could not answer: ${message}` }, { status: 502 });
  }
}
