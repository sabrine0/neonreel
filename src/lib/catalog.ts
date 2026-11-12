// Neonreel - made by sabrine0 (https://github.com/sabrine0)
export type Kind = "image" | "video";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export const ASPECT_SIZE: Record<Aspect, [number, number]> = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "1:1": [1024, 1024],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
};

export interface ModelDef {
  id: string;
  name: string;
  kind: Kind;
  provider: "mock" | "fal" | "comfy" | "ffmpeg";
  blurb: string;
  /** Credits per image, or per second of video. */
  cost: number;
  /** Provider endpoint id (fal models only). */
  endpoint?: string;
  requiresImage?: boolean;
  durations?: number[];
  /** A model file that must exist in the ComfyUI models folder (comfy only). */
  file?: { folder: string; name: string };
  /** Used by features (Story mode) but not offered in the Create picker. */
  internal?: boolean;
  /** A tool applied to an existing result (upscale, cut out, smooth) rather than a prompt. */
  tool?: {
    label: string;
    about: string;
    /** The result is this many times as long as the clip it was made from. */
    factor?: number;
    /** The result is this many seconds longer than the clip it was made from. */
    adds?: number;
    /** Can be applied again to its own result. */
    repeatable?: boolean;
  };
  /** Rough render seconds per second of video, for time estimates. */
  speed?: number;
}

/** Image-editing model that redraws one reference character into new scenes. */
export const CHARACTER_MODEL_ID = "kontext-local";

/** The same editing model, offered in Create to change a picture you supply. */
export const EDIT_MODEL_ID = "kontext-edit-local";

export const UPSCALE_MODEL_ID = "upscale-local";
export const CUTOUT_MODEL_ID = "cutout-local";
export const SMOOTH_MODEL_ID = "smooth-local";
export const EXTEND_MODEL_ID = "extend-local";
export const REVERSE_MODEL_ID = "reverse-local";
export const LOOP_MODEL_ID = "loop-local";
export const SLOW_MODEL_ID = "slow-local";

/**
 * To add a model: append an entry here. For a new backend, implement
 * `Provider` in src/lib/providers and register it in providers/index.ts.
 */
export const MODELS: ModelDef[] = [
  {
    id: "flux-schnell-local",
    name: "FLUX.1 schnell (local GPU)",
    kind: "image",
    provider: "comfy",
    blurb: "Text-to-image on this computer's graphics card.",
    cost: 0,
  },
  {
    id: CHARACTER_MODEL_ID,
    name: "FLUX Kontext (local GPU)",
    kind: "image",
    provider: "comfy",
    blurb: "Redraws a reference character into a new scene.",
    cost: 0,
    requiresImage: true,
    internal: true,
    file: { folder: "diffusion_models", name: "flux1-dev-kontext_fp8_scaled.safetensors" },
  },
  {
    id: EDIT_MODEL_ID,
    name: "FLUX Kontext Edit (local GPU)",
    kind: "image",
    provider: "comfy",
    blurb: "Changes a picture you give it. Describe the edit: make it night, add snow.",
    cost: 0,
    requiresImage: true,
    file: { folder: "diffusion_models", name: "flux1-dev-kontext_fp8_scaled.safetensors" },
  },
  {
    id: UPSCALE_MODEL_ID,
    name: "Upscale 2x (local GPU)",
    kind: "image",
    provider: "comfy",
    blurb: "Doubles a picture's size and sharpens it.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: { label: "Upscale 2x", about: "Make this picture twice as large and sharper" },
    file: { folder: "upscale_models", name: "RealESRGAN_x4plus.safetensors" },
  },
  {
    id: CUTOUT_MODEL_ID,
    name: "Remove background (local GPU)",
    kind: "image",
    provider: "comfy",
    blurb: "Cuts the subject out onto a transparent background.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: { label: "Remove background", about: "Cut the subject out onto a transparent background" },
    file: { folder: "background_removal", name: "birefnet.safetensors" },
  },
  {
    id: SMOOTH_MODEL_ID,
    name: "Smooth motion (local GPU)",
    kind: "video",
    provider: "comfy",
    blurb: "Doubles a clip's frame rate for smoother motion.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: { label: "Smooth motion", about: "Double this clip's frame rate, from 24 to 48 frames a second" },
    file: { folder: "frame_interpolation", name: "film_net_fp16.safetensors" },
  },
  {
    id: EXTEND_MODEL_ID,
    name: "Extend clip (local GPU)",
    kind: "video",
    provider: "comfy",
    blurb: "Continues a clip from its last frame.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: {
      label: "Extend +5s",
      about: "Continue this clip for 5 more seconds from its last frame. About 2 minutes.",
      adds: 5,
      repeatable: true,
    },
    file: { folder: "loras", name: "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors" },
    speed: 20,
  },
  {
    id: LOOP_MODEL_ID,
    name: "Loop",
    kind: "video",
    provider: "ffmpeg",
    blurb: "Plays a clip forward then backward, so it repeats with no jump.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: { label: "Loop", about: "Play forward then backward, so the clip repeats with no jump", factor: 2 },
  },
  {
    id: REVERSE_MODEL_ID,
    name: "Reverse",
    kind: "video",
    provider: "ffmpeg",
    blurb: "Plays a clip backward.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: { label: "Reverse", about: "Play this clip backward" },
  },
  {
    id: SLOW_MODEL_ID,
    name: "Slow motion",
    kind: "video",
    provider: "ffmpeg",
    blurb: "Plays a clip at half speed.",
    cost: 0,
    requiresImage: true,
    internal: true,
    tool: {
      label: "Slow motion",
      about: "Play this clip at half speed. Use Smooth motion first for the best result.",
      factor: 2,
    },
  },
  {
    id: "wan22-fast-local",
    name: "Wan 2.2 5B Fast (local GPU)",
    kind: "video",
    provider: "comfy",
    blurb: "Quick video on this computer's graphics card. About 100 seconds per 5-second clip.",
    cost: 0,
    durations: [3, 5],
    file: { folder: "loras", name: "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors" },
    speed: 20,
  },
  {
    id: "wan22-local",
    name: "Wan 2.2 5B High quality (local GPU)",
    kind: "video",
    provider: "comfy",
    blurb: "Most detail, on this computer's graphics card. About 8 minutes per 5-second clip.",
    cost: 0,
    durations: [3, 5],
    speed: 100,
  },
  {
    id: "demo-image",
    name: "Sketch (demo)",
    kind: "image",
    provider: "mock",
    blurb: "Instant placeholder picture, for trying the app without a graphics card.",
    cost: 1,
  },
  {
    id: "demo-video",
    name: "Animatic (demo)",
    kind: "video",
    provider: "mock",
    blurb: "Previews the camera move on your picture. Not a real video.",
    cost: 2,
    durations: [3, 5, 8],
  },
  {
    id: "flux-dev",
    name: "FLUX.1 dev",
    kind: "image",
    provider: "fal",
    endpoint: "fal-ai/flux/dev",
    blurb: "High quality text-to-image.",
    cost: 4,
  },
  {
    id: "kling-i2v",
    name: "Kling 2.1 Standard",
    kind: "video",
    provider: "fal",
    endpoint: "fal-ai/kling-video/v2.1/standard/image-to-video",
    blurb: "Image-to-video. Needs a reference frame.",
    cost: 8,
    requiresImage: true,
    durations: [5, 10],
  },
];

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export function costOf(model: ModelDef, duration: number): number {
  return model.kind === "video" ? model.cost * duration : model.cost;
}

export interface CameraPreset {
  id: string;
  name: string;
  description: string;
  /** Appended to the prompt sent to real video models. */
  prompt: string;
  /** CSS transforms used by the in-browser preview. */
  from: string;
  to: string;
  easing: string;
  /** Named keyframes overriding from/to (for non-linear moves). */
  animation?: string;
}

export const CAMERAS: CameraPreset[] = [
  {
    id: "static",
    name: "Locked off",
    description: "Tripod shot, no movement.",
    prompt: "static camera, locked-off tripod shot",
    from: "scale(1.04)",
    to: "scale(1.04)",
    easing: "linear",
  },
  {
    id: "dolly-in",
    name: "Dolly in",
    description: "Camera pushes steadily toward the subject.",
    prompt: "camera slowly dollies in toward the subject",
    from: "scale(1.04)",
    to: "scale(1.45)",
    easing: "ease-in-out",
  },
  {
    id: "dolly-out",
    name: "Dolly out",
    description: "Camera pulls back to reveal the scene.",
    prompt: "camera slowly dollies out, revealing the wider scene",
    from: "scale(1.45)",
    to: "scale(1.04)",
    easing: "ease-in-out",
  },
  {
    id: "pan-left",
    name: "Pan left",
    description: "Camera rotates left across the scene.",
    prompt: "smooth camera pan to the left",
    from: "scale(1.3) translateX(-8%)",
    to: "scale(1.3) translateX(8%)",
    easing: "ease-in-out",
  },
  {
    id: "pan-right",
    name: "Pan right",
    description: "Camera rotates right across the scene.",
    prompt: "smooth camera pan to the right",
    from: "scale(1.3) translateX(8%)",
    to: "scale(1.3) translateX(-8%)",
    easing: "ease-in-out",
  },
  {
    id: "tilt-up",
    name: "Tilt up",
    description: "Camera tilts from the ground toward the sky.",
    prompt: "camera tilts upward",
    from: "scale(1.3) translateY(-8%)",
    to: "scale(1.3) translateY(8%)",
    easing: "ease-in-out",
  },
  {
    id: "tilt-down",
    name: "Tilt down",
    description: "Camera tilts from the sky toward the ground.",
    prompt: "camera tilts downward",
    from: "scale(1.3) translateY(8%)",
    to: "scale(1.3) translateY(-8%)",
    easing: "ease-in-out",
  },
  {
    id: "crane-up",
    name: "Crane up",
    description: "Camera rises and widens, like a jib shot.",
    prompt: "crane shot rising up and away from the subject",
    from: "scale(1.5) translateY(-9%)",
    to: "scale(1.2) translateY(7%)",
    easing: "ease-in-out",
  },
  {
    id: "crash-zoom",
    name: "Crash zoom",
    description: "Sudden, aggressive zoom onto the subject.",
    prompt: "fast crash zoom into the subject",
    from: "scale(1.04)",
    to: "scale(2.1)",
    easing: "cubic-bezier(0.75, 0, 0.15, 1)",
  },
  {
    id: "orbit",
    name: "Orbit",
    description: "Camera arcs around the subject.",
    prompt: "camera orbits in an arc around the subject",
    from: "perspective(900px) scale(1.45) rotateY(-14deg) translateX(-5%)",
    to: "perspective(900px) scale(1.45) rotateY(14deg) translateX(5%)",
    easing: "ease-in-out",
  },
  {
    id: "dutch-roll",
    name: "Dutch roll",
    description: "Camera rolls on its axis for an uneasy feel.",
    prompt: "camera rolls slowly on its axis, dutch angle",
    from: "scale(1.5) rotate(-7deg)",
    to: "scale(1.5) rotate(7deg)",
    easing: "ease-in-out",
  },
  {
    id: "handheld",
    name: "Handheld",
    description: "Organic shake, documentary style.",
    prompt: "handheld camera with natural subtle shake",
    from: "scale(1.2)",
    to: "scale(1.2)",
    easing: "ease-in-out",
    animation: "cam-handheld",
  },
];

export function getCamera(id: string | undefined): CameraPreset {
  return CAMERAS.find((c) => c.id === id) ?? CAMERAS[0];
}

export interface StylePreset {
  id: string;
  name: string;
  /** Added to the end of the prompt. Empty for no style. */
  prompt: string;
}

export const STYLES: StylePreset[] = [
  { id: "none", name: "No style", prompt: "" },
  { id: "cinematic", name: "Cinematic", prompt: "cinematic 35mm film still, shallow depth of field, dramatic natural light" },
  { id: "photo", name: "Photo", prompt: "realistic photograph, sharp focus, natural colours, 50mm lens" },
  { id: "anime", name: "Anime", prompt: "anime style, clean line art, soft cel shading, detailed painted background" },
  { id: "3d", name: "3D animation", prompt: "3D animated film style, soft global illumination, expressive rounded shapes" },
  { id: "neon", name: "Neon noir", prompt: "neon noir, wet streets, cyan and magenta glow, deep shadows, light haze" },
  { id: "watercolor", name: "Watercolour", prompt: "delicate watercolour painting, visible paper texture, soft bleeding edges" },
  { id: "oil", name: "Oil painting", prompt: "classical oil painting, visible brush strokes, rich warm palette" },
  { id: "comic", name: "Comic book", prompt: "comic book illustration, bold ink outlines, halftone shading, vivid flat colours" },
  { id: "pixel", name: "Pixel art", prompt: "detailed pixel art, limited colour palette, crisp pixels" },
  { id: "clay", name: "Claymation", prompt: "stop-motion claymation, handmade clay figures, miniature set, soft studio light" },
  { id: "vintage", name: "Vintage film", prompt: "1970s film photograph, faded colours, heavy grain, soft halation" },
];

/** One-click changes offered when editing a picture. */
export const EDIT_IDEAS = [
  "Make it night, with warm lights glowing",
  "Add falling snow",
  "Make it rain, with wet reflections",
  "Change the light to golden hour",
  "Turn it into an anime drawing",
  "Turn it into a black and white photograph",
];

/** Starting points for the "Surprise me" button. */
export const PROMPT_IDEAS: Record<Kind, string[]> = {
  image: [
    "A lighthouse on a basalt cliff at dusk, waves in long exposure, a single lit window",
    "A tiny tea shop built inside a giant hollow tree, lanterns glowing, light rain",
    "An astronaut tending a greenhouse on Mars, red dust storm outside the glass",
    "A red fox asleep on a stack of old books in a sunlit library",
    "A floating night market on a river, paper lanterns, steam rising from food stalls",
    "An old fisherman mending a net at dawn, mist over a still harbour",
    "A glass city under the sea, whales passing between the towers",
    "A girl and her robot sharing an umbrella at a bus stop in the rain",
  ],
  video: [
    "Waves crash against the rocks as fog rolls in from the sea",
    "Snow falls gently while lantern light flickers in the window",
    "The wind moves through tall grass as clouds drift across the sky",
    "Steam rises from a cup while rain runs down the window behind it",
    "Fireflies rise slowly from the field as the last light fades",
    "Her hair moves in the breeze as she turns toward the camera and smiles",
  ],
};

export interface VoiceDef {
  /** Kokoro voice id. */
  id: string;
  name: string;
  language: string;
}

export const VOICES: VoiceDef[] = [
  { id: "af_heart", name: "Heart (female)", language: "English (US)" },
  { id: "af_bella", name: "Bella (female)", language: "English (US)" },
  { id: "am_michael", name: "Michael (male)", language: "English (US)" },
  { id: "am_fenrir", name: "Fenrir (male)", language: "English (US)" },
  { id: "bf_emma", name: "Emma (female)", language: "English (UK)" },
  { id: "bm_george", name: "George (male)", language: "English (UK)" },
  { id: "ff_siwis", name: "Siwis (female)", language: "French" },
  { id: "ef_dora", name: "Dora (female)", language: "Spanish" },
  { id: "em_alex", name: "Alex (male)", language: "Spanish" },
  { id: "if_sara", name: "Sara (female)", language: "Italian" },
  { id: "im_nicola", name: "Nicola (male)", language: "Italian" },
  { id: "pf_dora", name: "Dora (female)", language: "Portuguese" },
  { id: "pm_alex", name: "Alex (male)", language: "Portuguese" },
];

export function getVoice(id: string | undefined): VoiceDef | undefined {
  return VOICES.find((v) => v.id === id);
}

/** How many narration words fit comfortably in a scene of this length. */
export function narrationWords(duration: number): number {
  return Math.max(4, Math.floor(duration * 2.2));
}

/** Voices for spoken parts, per narration language. First one that differs from the narrator is used. */
const CAST: Record<string, { he: string[]; she: string[]; child: string[] }> = {
  "English (US)": { he: ["am_michael", "am_fenrir"], she: ["af_bella", "af_heart"], child: ["af_sky"] },
  "English (UK)": { he: ["bm_george", "bm_daniel"], she: ["bf_emma", "bf_lily"], child: ["bf_alice"] },
  French: { he: ["ff_siwis"], she: ["ff_siwis"], child: ["ff_siwis"] },
  Spanish: { he: ["em_alex"], she: ["ef_dora"], child: ["ef_dora"] },
  Italian: { he: ["im_nicola"], she: ["if_sara"], child: ["if_sara"] },
  Portuguese: { he: ["pm_alex"], she: ["pf_dora"], child: ["pf_dora"] },
};

const SPEAKER_TAG = /\b(narrator|he|she|child)\s*:\s*/gi;

export interface SpokenPart {
  voiceId: string;
  text: string;
}

/**
 * Splits a narration line into parts by speaker tag, so a scene can hold
 * dialogue: "He: Stay with me. She: Always." Untagged text is the narrator.
 */
export function splitDialogue(line: string, narratorVoiceId: string): SpokenPart[] {
  const cast = CAST[getVoice(narratorVoiceId)?.language ?? ""] ?? CAST["English (US)"];
  const voiceFor = (speaker: string): string => {
    if (speaker === "narrator") return narratorVoiceId;
    const options = cast[speaker as "he" | "she" | "child"];
    return options.find((id) => id !== narratorVoiceId) ?? options[0];
  };

  const parts: SpokenPart[] = [];
  let speaker = "narrator";
  let cursor = 0;
  const push = (end: number) => {
    const text = line.slice(cursor, end).trim();
    if (text) parts.push({ voiceId: voiceFor(speaker), text });
  };
  for (const match of line.matchAll(SPEAKER_TAG)) {
    push(match.index);
    speaker = match[1].toLowerCase();
    cursor = match.index + match[0].length;
  }
  push(line.length);
  return parts;
}

/** Number of words actually spoken in a narration line (speaker tags excluded). */
export function spokenWords(line: string): number {
  const text = line.replace(SPEAKER_TAG, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}
