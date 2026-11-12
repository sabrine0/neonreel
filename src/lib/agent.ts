import { ASPECTS, CAMERAS, STYLES, VOICES, getModel } from "./catalog";
import { createGeneration, fileName, RequestError } from "./generations";
import { getGeneration, getStory, listGenerations, listStories } from "./store";
import { createStory, MAX_SCENES, MIN_SCENES, type CreateStoryInput } from "./stories";

/**
 * What an AI can do in Neonreel. The same tools serve the built-in assistant
 * (src/app/api/assistant) and outside AI apps over MCP (src/app/api/mcp).
 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** Results started by this call, for the assistant page to show. */
  generationIds?: string[];
  storyId?: string;
}

const STYLE_IDS = STYLES.filter((s) => s.prompt).map((s) => s.id);
const FAST_VIDEO_MODEL_ID = "wan22-fast-local";
const IMAGE_MODEL_ID = "flux-schnell-local";

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "create_image",
    description:
      "Start generating one or more pictures from a text description. Takes about 30 seconds each. Returns the ids to check with get_status.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What the picture shows, in English, in detail." },
        aspect: { type: "string", enum: ASPECTS, description: "Shape of the picture. Default 16:9." },
        style: { type: "string", enum: STYLE_IDS, description: "Optional look." },
        count: { type: "integer", minimum: 1, maximum: 4, description: "How many versions. Default 1." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "create_video",
    description:
      "Start generating a short video clip. Give image_id to animate a finished picture from the library (best quality), or only a prompt to make a clip from text. Takes about 2 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What moves and how, in English." },
        image_id: { type: "string", description: "Id of a finished picture to animate." },
        camera: { type: "string", enum: CAMERAS.map((c) => c.id), description: "Camera move. Default static." },
        duration: { type: "integer", enum: [3, 5], description: "Seconds. Default 5." },
        aspect: { type: "string", enum: ASPECTS, description: "Used only without image_id. Default 16:9." },
      },
    },
  },
  {
    name: "create_story",
    description:
      "Write and start rendering a narrated multi-scene story video from one idea. Writing takes up to a few minutes, rendering about 2.5 minutes per scene. Returns the story id.",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "The story idea: who, where, what happens, how it ends." },
        scenes: {
          type: "integer",
          minimum: MIN_SCENES,
          maximum: MAX_SCENES,
          description: "Number of 5-second scenes. Default 4.",
        },
        voice: { type: "string", enum: VOICES.map((v) => v.id), description: "Narrator voice. Default af_heart." },
        aspect: { type: "string", enum: ASPECTS, description: "Default 16:9. Use 9:16 for phones." },
        subtitles: { type: "boolean", description: "Burn the lines into the picture. Default true." },
      },
      required: ["idea"],
    },
  },
  {
    name: "list_library",
    description: "List the most recent pictures, clips and stories with their ids, status and links.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 30, description: "Default 10." } },
    },
  },
  {
    name: "get_status",
    description: "Check one picture, clip or story by id: running with progress, done with its link, or failed.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

type Args = Record<string, unknown>;

function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function describe(origin: string, id: string): string | undefined {
  const gen = getGeneration(id);
  if (gen) {
    const state =
      gen.status === "done"
        ? `done: ${origin}${gen.outputUrl}`
        : gen.status === "failed"
          ? `failed: ${gen.error ?? "unknown error"}`
          : `running, ${Math.round(gen.progress * 100)}%`;
    return `${gen.kind} ${gen.id} | ${state} | ${gen.prompt.slice(0, 80)}`;
  }
  const story = getStory(id);
  if (story) {
    const state =
      story.status === "done"
        ? `done: ${origin}${story.outputUrl}`
        : story.status === "failed"
          ? `failed: ${story.error ?? "unknown error"}`
          : `rendering ${story.scenes.length} scenes, watch it at ${origin}/story`;
    return `story ${story.id} | ${state} | ${story.title}`;
  }
  return undefined;
}

/**
 * The local model for a kind of result. ComfyUI is not asked whether it is up:
 * while it renders (or the language model holds the graphics card) it can take
 * many seconds to answer, and submitting the job reports a real outage anyway.
 */
function usableModel(kind: "image" | "video") {
  const model = getModel(kind === "image" ? IMAGE_MODEL_ID : FAST_VIDEO_MODEL_ID);
  if (!model) throw new RequestError("No local model is set up.");
  return model;
}

const RUNNERS: Record<string, (args: Args, origin: string) => Promise<ToolResult>> = {
  async create_image(args) {
    const prompt = str(args.prompt);
    if (!prompt) throw new RequestError("A prompt is needed.");
    const style = STYLES.find((s) => s.id === args.style)?.prompt;
    const model = usableModel("image");
    const count = Math.min(4, Math.max(1, Math.round(Number(args.count)) || 1));
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const gen = await createGeneration({
        modelId: model.id,
        prompt: style ? `${prompt}, ${style}` : prompt,
        aspect: args.aspect,
      });
      ids.push(gen.id);
    }
    return {
      text: `Started ${count} picture${count === 1 ? "" : "s"} (about 30 seconds each). Ids: ${ids.join(", ")}`,
      generationIds: ids,
    };
  },

  async create_video(args) {
    const prompt = str(args.prompt);
    const imageId = str(args.image_id, 80);
    const source = imageId ? getGeneration(imageId) : undefined;
    if (imageId && (source?.kind !== "image" || source.status !== "done" || !source.outputUrl)) {
      throw new RequestError("image_id must be the id of a finished picture.");
    }
    if (!prompt && !source) throw new RequestError("Give a prompt, an image_id, or both.");
    const model = usableModel("video");
    const gen = await createGeneration(
      {
        modelId: model.id,
        prompt,
        aspect: source?.aspect ?? args.aspect,
        duration: args.duration ?? 5,
        cameraId: args.camera,
      },
      source?.outputUrl ? { refFile: fileName(source.outputUrl) } : {},
    );
    const wait = Math.round((gen.duration * (getModel(gen.modelId)?.speed ?? 100)) / 60);
    return { text: `Started a ${gen.duration}-second clip (about ${wait} minutes). Id: ${gen.id}`, generationIds: [gen.id] };
  },

  async create_story(args, origin) {
    const idea = str(args.idea, 4000);
    if (!idea) throw new RequestError("A story idea is needed.");
    const voiceId = VOICES.find((v) => v.id === args.voice)?.id ?? "af_heart";
    const count = Math.min(MAX_SCENES, Math.max(MIN_SCENES, Math.round(Number(args.scenes)) || 4));

    // The planner route holds the scene-writing prompts; reuse it as it is.
    const res = await fetch(`${origin}/api/stories/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, count, duration: 5, voiceId }),
    });
    const plan = (await res.json().catch(() => null)) as (CreateStoryInput & { error?: string }) | null;
    if (!res.ok || !plan) throw new RequestError(plan?.error ?? "The scenes could not be written.");

    const story = await createStory({
      ...plan,
      voiceId,
      subtitles: args.subtitles !== false,
      aspect: args.aspect,
      duration: 5,
      videoModelId: FAST_VIDEO_MODEL_ID,
    });
    return {
      text: `Started the story "${story.title}" with ${story.scenes.length} scenes (about ${Math.round(story.scenes.length * 2.5)} minutes). Id: ${story.id}. Watch it at ${origin}/story`,
      storyId: story.id,
    };
  },

  async list_library(args, origin) {
    const limit = Math.min(30, Math.max(1, Math.round(Number(args.limit)) || 10));
    const stories = listStories().slice(0, 5).map((s) => describe(origin, s.id));
    const items = listGenerations()
      .filter((g) => !g.storyId)
      .slice(0, limit)
      .map((g) => describe(origin, g.id));
    const lines = [...stories, ...items].filter(Boolean);
    return { text: lines.length ? lines.join("\n") : "The library is empty." };
  },

  async get_status(args, origin) {
    const line = describe(origin, str(args.id, 80));
    return line ? { text: line } : { text: "Nothing has that id.", isError: true };
  },
};

/** Runs one tool. Problems come back as an error result, never as a throw. */
export async function runTool(name: string, args: unknown, origin: string): Promise<ToolResult> {
  const runner = RUNNERS[name];
  if (!runner) return { text: `Unknown tool: ${name}`, isError: true };
  try {
    return await runner(typeof args === "object" && args !== null ? (args as Args) : {}, origin);
  } catch (err) {
    if (err instanceof RequestError) {
      console.warn(`Tool ${name} refused:`, err.message, JSON.stringify(args));
      return { text: err.message, isError: true };
    }
    console.error(`Tool ${name} failed:`, err);
    return { text: err instanceof Error ? err.message : "The tool failed.", isError: true };
  }
}
