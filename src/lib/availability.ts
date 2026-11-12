// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { MODELS, type Kind, type ModelDef } from "./catalog";
import { COMFY_URL, comfyAvailable, comfyBusy } from "./providers/comfy";

export type Availability = Record<ModelDef["provider"], boolean>;

export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");

/** Which generation backends can be used right now. */
export async function getAvailability(): Promise<Availability> {
  return {
    mock: true,
    fal: Boolean(process.env.FAL_KEY),
    comfy: await comfyAvailable(),
    // Checked when a tool runs; FFmpeg is already required for stories.
    ffmpeg: true,
  };
}

/** Ids of local models whose files have not been downloaded into ComfyUI. */
export async function missingModelIds(available: Availability): Promise<string[]> {
  if (!available.comfy) return [];
  const folders = new Map<string, Promise<string[]>>();
  const list = (folder: string) => {
    if (!folders.has(folder)) {
      folders.set(
        folder,
        fetch(`${COMFY_URL}/models/${folder}`, { signal: AbortSignal.timeout(3000) })
          .then((res) => (res.ok ? (res.json() as Promise<string[]>) : []))
          .catch(() => []),
      );
    }
    return folders.get(folder)!;
  };

  const missing: string[] = [];
  for (const model of MODELS) {
    if (model.provider !== "comfy" || !model.file) continue;
    if (!(await list(model.file.folder)).includes(model.file.name)) missing.push(model.id);
  }
  return missing;
}

/** Models of a kind that produce real media files and can be used right now. */
export function realModels(kind: Kind, available: Availability, missing: string[]): ModelDef[] {
  return MODELS.filter(
    (m) =>
      m.kind === kind &&
      m.provider !== "mock" &&
      !m.internal &&
      available[m.provider] &&
      !missing.includes(m.id),
  );
}

/**
 * Extra Ollama options for a request made right now. While pictures or video
 * are rendering, the graphics card is full: loading the language model onto it
 * as well can freeze the render, so it runs on the processor instead (slower).
 */
export async function ollamaPlacement(): Promise<{ num_gpu?: number }> {
  return (await comfyBusy()) ? { num_gpu: 0 } : {};
}

/** Names of the models the local Ollama server has, or [] when it is not running. */
export async function ollamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
