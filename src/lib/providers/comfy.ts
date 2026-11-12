import {
  CHARACTER_MODEL_ID,
  CUTOUT_MODEL_ID,
  EDIT_MODEL_ID,
  EXTEND_MODEL_ID,
  SMOOTH_MODEL_ID,
  UPSCALE_MODEL_ID,
  getCamera,
  getModel,
  type Aspect,
} from "../catalog";
import { appendClip, lastFrame } from "../clip";
import { filePath, readFile, removeFile, saveFile } from "../store";
import type { Generation } from "../types";
import type { Provider } from "./types";

/**
 * Local GPU generation through a ComfyUI server (the same one ArtCraft's
 * "Local GPU" provider uses). Model files are expected in ComfyUI/models.
 */
export const COMFY_URL = (process.env.COMFY_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");

const FLUX_CHECKPOINT = "flux1-schnell-fp8.safetensors";
const WAN_MODEL = "wan2.2_ti2v_5B_fp16.safetensors";
const WAN_TEXT_ENCODER = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
const WAN_VAE = "wan2.2_vae.safetensors";
const WAN_FAST_LORA = "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors";
const WAN_FAST_MODEL_ID = "wan22-fast-local";
const WAN_FPS = 24;

const KONTEXT_MODEL = "flux1-dev-kontext_fp8_scaled.safetensors";
const KONTEXT_CLIP_L = "clip_l.safetensors";
const KONTEXT_T5 = "t5xxl_fp8_e4m3fn_scaled.safetensors";
const KONTEXT_VAE = "ae.safetensors";
const WAN_NEGATIVE =
  "blurry, low quality, jpeg artifacts, static frame, watermark, subtitles, text, deformed, extra limbs, overexposed";

/** About one megapixel, sides a multiple of 16 as FLUX expects. */
const FLUX_SIZE: Record<Aspect, [number, number]> = {
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "1:1": [1024, 1024],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
};

/** 720p-class sizes, sides a multiple of 32 as the Wan 2.2 5B VAE expects. */
const WAN_SIZE: Record<Aspect, [number, number]> = {
  "16:9": [1280, 704],
  "9:16": [704, 1280],
  "1:1": [960, 960],
  "4:3": [1088, 832],
  "3:4": [832, 1088],
};

/** A just-submitted job may not be listed yet; only call it lost after this. */
const LOST_JOB_GRACE_MS = 60 * 1000;

/** True while ComfyUI still has the job waiting or running. */
async function isQueued(promptId: string): Promise<boolean> {
  const res = await fetch(`${COMFY_URL}/queue`);
  if (!res.ok) throw new Error(`ComfyUI queue returned ${res.status}`);
  const queue = (await res.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
  // Each queue item is [number, prompt_id, ...].
  return [...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some(
    (item) => item[1] === promptId,
  );
}

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function seed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

function fluxWorkflow(gen: Generation): Workflow {
  const [width, height] = FLUX_SIZE[gen.aspect];
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: FLUX_CHECKPOINT } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: gen.prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
    "4": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: seed(),
        steps: 4,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "framewright", images: ["6", 0] } },
  };
}

/**
 * Redraws the character in `reference` into the scene described by the prompt.
 * The reference is fed as a latent the model attends to, not as the canvas,
 * so the output can have a different framing and aspect ratio.
 */
function kontextWorkflow(gen: Generation, reference: string, keepFrame: boolean): Workflow {
  const [width, height] = FLUX_SIZE[gen.aspect];
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: KONTEXT_MODEL, weight_dtype: "default" } },
    "2": {
      class_type: "DualCLIPLoader",
      inputs: { clip_name1: KONTEXT_CLIP_L, clip_name2: KONTEXT_T5, type: "flux", device: "default" },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: KONTEXT_VAE } },
    "4": { class_type: "LoadImage", inputs: { image: reference } },
    "5": { class_type: "FluxKontextImageScale", inputs: { image: ["4", 0] } },
    "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["3", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: gen.prompt, clip: ["2", 0] } },
    "8": { class_type: "ReferenceLatent", inputs: { conditioning: ["7", 0], latent: ["6", 0] } },
    "9": { class_type: "FluxGuidance", inputs: { conditioning: ["8", 0], guidance: 2.5 } },
    "10": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["7", 0] } },
    "11": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "12": {
      class_type: "KSampler",
      inputs: {
        seed: seed(),
        steps: 20,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["1", 0],
        positive: ["9", 0],
        negative: ["10", 0],
        // Editing starts from the picture's own latent, so size and framing are
        // kept. A new scene starts from an empty canvas of the requested shape.
        latent_image: [keepFrame ? "6" : "11", 0],
      },
    },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["3", 0] } },
    "14": { class_type: "SaveImage", inputs: { filename_prefix: "framewright", images: ["13", 0] } },
  };
}

/** Enlarges 4x with Real-ESRGAN, then halves the result: a clean 2x. */
function upscaleWorkflow(source: string): Workflow {
  return {
    "1": { class_type: "LoadImage", inputs: { image: source } },
    "2": { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x4plus.safetensors" } },
    "3": { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["2", 0], image: ["1", 0] } },
    "4": { class_type: "ImageScaleBy", inputs: { image: ["3", 0], upscale_method: "area", scale_by: 0.5 } },
    "5": { class_type: "SaveImage", inputs: { filename_prefix: "framewright", images: ["4", 0] } },
  };
}

/** Finds the subject with BiRefNet and saves the picture with everything else transparent. */
function cutoutWorkflow(source: string): Workflow {
  return {
    "1": { class_type: "LoadImage", inputs: { image: source } },
    "2": { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: "birefnet.safetensors" } },
    "3": { class_type: "RemoveBackground", inputs: { bg_removal_model: ["2", 0], image: ["1", 0] } },
    // JoinImageWithAlpha treats its mask as "what to hide", so the subject mask is inverted first.
    "4": { class_type: "InvertMask", inputs: { mask: ["3", 0] } },
    "5": { class_type: "JoinImageWithAlpha", inputs: { image: ["1", 0], alpha: ["4", 0] } },
    "6": { class_type: "SaveImage", inputs: { filename_prefix: "framewright", images: ["5", 0] } },
  };
}

/** Adds an in-between frame after every frame with FILM: 24 to 48 frames a second. */
function smoothWorkflow(source: string): Workflow {
  return {
    "1": { class_type: "LoadVideo", inputs: { file: source } },
    "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },
    "3": { class_type: "FrameInterpolationModelLoader", inputs: { model_name: "film_net_fp16.safetensors" } },
    "4": { class_type: "FrameInterpolate", inputs: { interp_model: ["3", 0], images: ["2", 0], multiplier: 2 } },
    "5": { class_type: "CreateVideo", inputs: { images: ["4", 0], fps: WAN_FPS * 2 } },
    "6": {
      class_type: "SaveVideo",
      inputs: { video: ["5", 0], filename_prefix: "framewright", format: "auto", "format.codec": "auto" },
    },
  };
}

function wanWorkflow(gen: Generation, startImage: string | undefined, fast: boolean): Workflow {
  const [width, height] = WAN_SIZE[gen.aspect];
  const prompt = [gen.prompt, getCamera(gen.cameraId).prompt].filter(Boolean).join(". ");
  const latent: Record<string, unknown> = {
    vae: ["3", 0],
    width,
    height,
    // Wan needs 4n+1 frames.
    length: gen.duration * WAN_FPS + 1,
    batch_size: 1,
  };
  const workflow: Workflow = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: WAN_MODEL, weight_dtype: "default" } },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: WAN_TEXT_ENCODER, type: "wan", device: "default" },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: WAN_VAE } },
    "4": { class_type: "ModelSamplingSD3", inputs: { shift: 8, model: [fast ? "13" : "1", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: WAN_NEGATIVE, clip: ["2", 0] } },
    "7": { class_type: "Wan22ImageToVideoLatent", inputs: latent },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: seed(),
        // The distilled LoRA needs no guidance, so each step also costs half as much.
        steps: fast ? 4 : 20,
        cfg: fast ? 1 : 5,
        sampler_name: "uni_pc",
        scheduler: "simple",
        denoise: 1,
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "CreateVideo", inputs: { images: ["9", 0], fps: WAN_FPS } },
    "11": {
      class_type: "SaveVideo",
      // "auto" writes H.264 in an MP4 container. Nested options use dotted keys.
      inputs: {
        video: ["10", 0],
        filename_prefix: "framewright",
        format: "auto",
        "format.codec": "auto",
      },
    },
  };
  if (fast) {
    workflow["13"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["1", 0], lora_name: WAN_FAST_LORA, strength_model: 1 },
    };
  }
  if (startImage) {
    workflow["12"] = { class_type: "LoadImage", inputs: { image: startImage } };
    latent.start_image = ["12", 0];
  }
  return workflow;
}

/** Name of the stored reference file (a picture, or the clip a tool works on). */
function referenceName(gen: Generation): string | undefined {
  return gen.refImage?.slice(gen.refImage.lastIndexOf("/") + 1);
}

/** Seconds of new video the Extend tool adds. */
const EXTEND_SECONDS = getModel(EXTEND_MODEL_ID)?.tool?.adds ?? 5;

/** Extensions being joined to their source clip right now, so two polls never write one file. */
const joining = new Set<string>();

/** Copies the reference frame into ComfyUI's input folder; returns its name there. */
async function uploadReference(gen: Generation): Promise<string | undefined> {
  const name = referenceName(gen);
  return name ? upload(name) : undefined;
}

/** Copies a stored file into ComfyUI's input folder; returns its name there. */
async function upload(name: string): Promise<string | undefined> {
  const data = readFile(name);
  if (!data) return undefined;
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(data)]), name);
  form.append("overwrite", "true");
  const res = await fetch(`${COMFY_URL}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Reference upload failed (${res.status})`);
  const body = (await res.json()) as { name: string; subfolder?: string };
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

export async function comfyAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

interface OutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, Record<string, unknown>>;
}

function findOutput(entry: HistoryEntry): OutputFile | undefined {
  const files: OutputFile[] = [];
  for (const node of Object.values(entry.outputs ?? {})) {
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (typeof item === "object" && item !== null && typeof item.filename === "string") {
          files.push(item as OutputFile);
        }
      }
    }
  }
  // Loader nodes also report the file they read (type "input") as a preview.
  // The result is the file a save node wrote.
  return files.find((file) => file.type === "output") ?? files.find((file) => file.type !== "input");
}

function errorFrom(entry: HistoryEntry): string {
  const failure = entry.status?.messages?.find(([kind]) => kind === "execution_error");
  const message = failure?.[1]?.exception_message;
  return typeof message === "string" ? message.trim().slice(0, 300) : "ComfyUI reported an error.";
}

export const comfyProvider: Provider = {
  async submit(gen) {
    let workflow: Workflow;
    try {
      // Extending starts a new clip from the last frame of the old one.
      let reference: string | undefined;
      if (gen.modelId === EXTEND_MODEL_ID) {
        const clip = referenceName(gen);
        if (!clip) throw new Error("The clip to extend is missing.");
        const frame = `${gen.id}-last.png`;
        await lastFrame(filePath(clip), filePath(frame));
        reference = await upload(frame);
        removeFile(frame);
        if (!reference) throw new Error("The last frame of the clip could not be read.");
      } else {
        reference = await uploadReference(gen);
      }
      const tool =
        gen.modelId === UPSCALE_MODEL_ID
          ? upscaleWorkflow
          : gen.modelId === CUTOUT_MODEL_ID
            ? cutoutWorkflow
            : gen.modelId === SMOOTH_MODEL_ID
              ? smoothWorkflow
              : undefined;
      if (tool) {
        if (!reference) throw new Error("The picture or clip to work on is missing.");
        workflow = tool(reference);
      } else if (gen.modelId === EXTEND_MODEL_ID) {
        workflow = wanWorkflow({ ...gen, duration: EXTEND_SECONDS }, reference, true);
      } else if (gen.kind === "video") {
        workflow = wanWorkflow(gen, reference, gen.modelId === WAN_FAST_MODEL_ID);
      } else if (gen.modelId === CHARACTER_MODEL_ID || gen.modelId === EDIT_MODEL_ID) {
        if (!reference) throw new Error("The reference picture is missing.");
        workflow = kontextWorkflow(gen, reference, gen.modelId === EDIT_MODEL_ID);
      } else {
        workflow = fluxWorkflow(gen);
      }
    } catch (err) {
      throw new Error(describeConnection(err));
    }

    let res: Response;
    try {
      res = await fetch(`${COMFY_URL}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: "framewright" }),
      });
    } catch (err) {
      throw new Error(describeConnection(err));
    }
    const body = (await res.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: { message?: string };
      node_errors?: Record<string, { errors?: { details?: string; message?: string }[] }>;
    };
    if (!res.ok || !body.prompt_id) {
      const node = Object.values(body.node_errors ?? {})[0]?.errors?.[0];
      const detail = [node?.message, node?.details].filter(Boolean).join(": ");
      throw new Error(detail || body.error?.message || `ComfyUI returned ${res.status}`);
    }
    return { promptId: body.prompt_id };
  },

  async check(gen) {
    const id = gen.job.promptId;
    const res = await fetch(`${COMFY_URL}/history/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`ComfyUI history returned ${res.status}`);
    let entry = ((await res.json()) as Record<string, HistoryEntry>)[id];
    const elapsed = Date.now() - gen.createdAt;

    if (!entry && elapsed > LOST_JOB_GRACE_MS && !(await isQueued(id))) {
      // Not in the queue either. It may have finished between the two questions,
      // so look at the history once more before calling it lost.
      const again = await fetch(`${COMFY_URL}/history/${encodeURIComponent(id)}`);
      if (!again.ok) throw new Error(`ComfyUI history returned ${again.status}`);
      entry = ((await again.json()) as Record<string, HistoryEntry>)[id];
      if (!entry) return { status: "failed", error: "ComfyUI lost this job (was it restarted?)." };
    }

    if (!entry) {
      // No history yet: the job is still queued or running.
      // ComfyUI reports no percentage over HTTP; estimate, never reaching 100%.
      const speed = getModel(gen.modelId)?.speed ?? 100;
      const seconds = gen.modelId === EXTEND_MODEL_ID ? EXTEND_SECONDS : gen.duration;
      const expected = gen.kind === "image" ? 40_000 : seconds * speed * 600;
      return { status: "running", progress: 1 - Math.exp(-elapsed / expected) };
    }

    if (entry.status?.status_str === "error") {
      return { status: "failed", error: errorFrom(entry) };
    }
    const file = findOutput(entry);
    if (!file) return { status: "failed", error: "ComfyUI finished without an output file." };

    const query = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder ?? "",
      type: file.type ?? "output",
    });
    const media = await fetch(`${COMFY_URL}/view?${query}`);
    if (!media.ok) throw new Error(`Could not fetch the result (${media.status})`);
    const data = Buffer.from(await media.arrayBuffer());

    if (gen.modelId === EXTEND_MODEL_ID) {
      // The new part is joined onto the end of the clip it continues.
      const clip = referenceName(gen);
      if (!clip) return { status: "failed", error: "The clip to extend is missing." };
      if (joining.has(gen.id)) return { status: "running", progress: 0.99 };
      joining.add(gen.id);
      const part = `${gen.id}-part.mp4`;
      try {
        saveFile(part, data);
        await appendClip(filePath(clip), filePath(part), filePath(`${gen.id}.mp4`));
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      } finally {
        removeFile(part);
        joining.delete(gen.id);
      }
      return { status: "done", outputUrl: `/api/files/${gen.id}.mp4`, outputType: "video" };
    }

    const ext = gen.kind === "image" ? "png" : "mp4";
    const url = saveFile(`${gen.id}.${ext}`, data);
    return { status: "done", outputUrl: url, outputType: gen.kind };
  },
};

function describeConnection(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("fetch failed")
    ? `ComfyUI is not reachable at ${COMFY_URL}. Start it, then try again.`
    : message;
}
