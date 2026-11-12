// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { getCamera, type Aspect } from "../catalog";
import { readFile } from "../store";
import type { Generation } from "../types";
import type { Provider } from "./types";

const QUEUE = "https://queue.fal.run/";

const IMAGE_SIZE: Record<Aspect, string> = {
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

function headers(): HeadersInit {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  };
}

/** fal accepts data URIs for image inputs, so local uploads need no public URL. */
function refAsDataUri(gen: Generation): string | undefined {
  if (!gen.refImage) return undefined;
  const name = gen.refImage.slice(gen.refImage.lastIndexOf("/") + 1);
  const data = readFile(name);
  if (!data) return undefined;
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return `data:${MIME[ext] ?? "image/jpeg"};base64,${data.toString("base64")}`;
}

/**
 * Input fields differ per fal model. These cover the two models in the
 * catalog; check a model's schema on fal.ai before adding another.
 */
function buildInput(gen: Generation): Record<string, unknown> {
  if (gen.kind === "image") {
    return { prompt: gen.prompt, image_size: IMAGE_SIZE[gen.aspect], num_images: 1 };
  }
  const camera = getCamera(gen.cameraId).prompt;
  return {
    prompt: [gen.prompt, camera].filter(Boolean).join(". "),
    image_url: refAsDataUri(gen),
    duration: String(gen.duration),
  };
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `${res.status} ${body.slice(0, 300)}`.trim();
}

export const falProvider: Provider = {
  async submit(gen, model) {
    const res = await fetch(QUEUE + model.endpoint, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(buildInput(gen)),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const data = (await res.json()) as { status_url?: string; response_url?: string };
    if (!data.status_url?.startsWith(QUEUE) || !data.response_url?.startsWith(QUEUE)) {
      throw new Error("Unexpected queue response.");
    }
    return { statusUrl: data.status_url, responseUrl: data.response_url };
  },

  async check(gen) {
    const statusRes = await fetch(gen.job.statusUrl, { headers: headers() });
    if (!statusRes.ok) throw new Error(await errorText(statusRes));
    const { status } = (await statusRes.json()) as { status: string };

    if (status !== "COMPLETED") {
      // fal reports no percentage; show an estimate that never reaches 100%.
      const elapsed = (Date.now() - gen.createdAt) / 1000;
      const expected = gen.kind === "image" ? 10 : 120;
      return { status: "running", progress: 1 - Math.exp(-elapsed / expected) };
    }

    const res = await fetch(gen.job.responseUrl, { headers: headers() });
    if (!res.ok) return { status: "failed", error: await errorText(res) };
    const data = (await res.json()) as {
      video?: { url?: string };
      images?: { url?: string }[];
    };
    const url = gen.kind === "video" ? data.video?.url : data.images?.[0]?.url;
    if (!url) return { status: "failed", error: "Model returned no output." };
    return { status: "done", outputUrl: url, outputType: gen.kind };
  },
};
