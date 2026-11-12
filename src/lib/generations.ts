// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { randomUUID } from "node:crypto";
import { ASPECTS, costOf, getCamera, getModel, type Aspect } from "./catalog";
import { providerFor } from "./providers";
import {
  addCredits,
  deleteGeneration,
  getCredits,
  getGeneration,
  insertGeneration,
  listGenerations,
  readFile,
  removeFile,
  saveFile,
  updateGeneration,
} from "./store";
import type { Generation, GenerationList } from "./types";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface CreateInput {
  modelId?: unknown;
  prompt?: unknown;
  aspect?: unknown;
  duration?: unknown;
  cameraId?: unknown;
  refImage?: unknown;
  /** Id of a finished result to work on (tools such as upscale). */
  sourceId?: unknown;
}

/** Options only server code may set (never taken from a request body). */
export interface InternalOptions {
  /** Name of an already stored file to use as the reference frame. */
  refFile?: string;
  storyId?: string;
}

export async function createGeneration(
  input: CreateInput,
  internal: InternalOptions = {},
): Promise<Generation> {
  const model = typeof input.modelId === "string" ? getModel(input.modelId) : undefined;
  if (!model) throw new RequestError("Unknown model.");

  // A tool works on one of the user's own finished results, named by id.
  const source = typeof input.sourceId === "string" ? getGeneration(input.sourceId) : undefined;
  if (typeof input.sourceId === "string") {
    if (!source || source.status !== "done" || !source.outputUrl?.startsWith("/api/files/")) {
      throw new RequestError("That result is not available to work on.");
    }
    if (source.kind !== model.kind) {
      throw new RequestError(`${model.name} works on ${model.kind}s only.`);
    }
    if (model.kind === "video" && !source.outputUrl.endsWith(".mp4")) {
      throw new RequestError(`${model.name} needs a real video clip.`);
    }
    internal = { ...internal, refFile: fileName(source.outputUrl) };
    input = { ...input, prompt: source.prompt, aspect: source.aspect, cameraId: source.cameraId };
  }
  if (model.provider === "fal" && !process.env.FAL_KEY) {
    throw new RequestError("This model needs FAL_KEY set in .env.local.");
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 2000) : "";
  const aspect = ASPECTS.includes(input.aspect as Aspect) ? (input.aspect as Aspect) : "16:9";
  const cameraId = getCamera(typeof input.cameraId === "string" ? input.cameraId : undefined).id;

  let duration = 0;
  if (model.kind === "video") {
    const allowed = model.durations ?? [5];
    duration = allowed.includes(Number(input.duration)) ? Number(input.duration) : allowed[0];
    if (source) {
      duration = Math.round(source.duration * (model.tool?.factor ?? 1) + (model.tool?.adds ?? 0));
    }
  }

  const id = randomUUID();
  let upload: { ext: string; data: Buffer } | undefined;
  if (typeof input.refImage === "string" && input.refImage) {
    const match = DATA_URL.exec(input.refImage);
    if (!match) throw new RequestError("Reference image must be a JPEG, PNG or WebP.");
    const data = Buffer.from(match[2], "base64");
    if (data.length > MAX_UPLOAD_BYTES) throw new RequestError("Reference image is too large.");
    upload = { ext: match[1] === "jpeg" ? "jpg" : match[1], data };
  } else if (internal.refFile) {
    const data = readFile(internal.refFile);
    if (!data) throw new RequestError("Reference frame is missing.");
    upload = { ext: internal.refFile.slice(internal.refFile.lastIndexOf(".") + 1), data };
  }

  if (model.requiresImage && !upload) {
    throw new RequestError(`${model.name} needs a reference image.`);
  }
  if (!prompt && !upload) throw new RequestError("Write a prompt first.");

  const cost = costOf(model, duration);
  if (getCredits() < cost) throw new RequestError("Not enough credits.", 402);

  const gen: Generation = {
    id,
    kind: model.kind,
    modelId: model.id,
    prompt,
    aspect,
    duration,
    cameraId,
    refImage: upload ? saveFile(`${id}-ref.${upload.ext}`, upload.data) : undefined,
    status: "running",
    progress: 0,
    cost,
    createdAt: Date.now(),
    job: {},
    storyId: internal.storyId,
  };

  try {
    gen.job = await providerFor(model).submit(gen, model);
  } catch (err) {
    if (gen.refImage) removeFile(fileName(gen.refImage));
    throw new RequestError(`Provider rejected the job: ${messageOf(err)}`, 502);
  }

  addCredits(-cost);
  insertGeneration(gen);
  return gen;
}

/** Polls the provider for one running job and persists the outcome. */
async function refresh(gen: Generation): Promise<void> {
  const model = getModel(gen.modelId);
  if (!model) {
    settle(gen.id, { status: "failed", error: "Model no longer exists." });
    return;
  }
  try {
    const result = await providerFor(model).check(gen, model);
    if (result.status === "running") {
      updateGeneration(gen.id, { progress: Math.min(0.99, result.progress) });
    } else {
      settle(gen.id, result.status === "done" ? { ...result, progress: 1 } : result);
    }
  } catch (err) {
    // Transient polling errors (network blips) are retried on the next poll.
    console.error(`Polling ${gen.id} failed:`, messageOf(err));
  }
}

/** Applies a terminal state once, refunding credits on failure. */
function settle(id: string, patch: Partial<Generation>): void {
  const current = getGeneration(id);
  if (!current || current.status !== "running") return;
  updateGeneration(id, { ...patch, finishedAt: Date.now() });
  if (patch.status === "failed") addCredits(current.cost);
}

/**
 * Gives a failed job a second look: marks it running and polls the provider
 * again. Returns true if the provider still has it (running or finished).
 */
export async function reviveGeneration(id: string): Promise<boolean> {
  const gen = getGeneration(id);
  if (!gen) return false;
  if (gen.status !== "failed") return true;
  // Failing refunded the cost, so take it again while the job is live.
  addCredits(-gen.cost);
  updateGeneration(id, { status: "running", error: undefined, finishedAt: undefined });
  const revived = getGeneration(id);
  if (revived) await refresh(revived);
  return getGeneration(id)?.status !== "failed";
}

/** Polls every running job once. */
export async function refreshRunning(): Promise<void> {
  const running = listGenerations().filter((g) => g.status === "running");
  await Promise.all(running.map(refresh));
}

export async function listWithRefresh(): Promise<GenerationList> {
  await refreshRunning();
  return { credits: getCredits(), generations: listGenerations().map(publicView) };
}

export function removeGeneration(id: string): boolean {
  const gen = getGeneration(id);
  if (!gen) return false;
  for (const url of [gen.refImage, gen.outputUrl]) {
    if (url?.startsWith("/api/files/")) removeFile(fileName(url));
  }
  return deleteGeneration(id);
}

/** Strips provider job handles before sending a generation to the browser. */
export function publicView(gen: Generation): Generation {
  return { ...gen, job: {} };
}

export function fileName(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
