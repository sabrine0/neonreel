import { randomUUID } from "node:crypto";
import { getAvailability, missingModelIds, realModels } from "./availability";
import {
  ASPECTS,
  CAMERAS,
  CHARACTER_MODEL_ID,
  getModel,
  getVoice,
  type Aspect,
} from "./catalog";
import {
  createGeneration,
  fileName,
  refreshRunning,
  RequestError,
  reviveGeneration,
} from "./generations";
import { joinClips, voiceAvailable } from "./render";
import {
  deleteStory,
  filePath,
  getGeneration,
  getStory,
  insertStory,
  listStories,
  removeFile,
  saveFile,
  updateGeneration,
  updateStory,
} from "./store";
import type { Generation, SceneView, Story, StoryView } from "./types";

export const MIN_SCENES = 2;
export const MAX_SCENES = 20;
const MAX_SCENE_CHARS = 600;
const JOIN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const PICTURE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MUSIC_DATA_URL = /^data:audio\/(mpeg|mp3|wav|x-wav|wave|mp4|x-m4a|aac|ogg);base64,([A-Za-z0-9+/=]+)$/;
const MUSIC_EXT: Record<string, string> = {
  mpeg: "mp3",
  mp3: "mp3",
  wav: "wav",
  "x-wav": "wav",
  wave: "wav",
  mp4: "m4a",
  "x-m4a": "m4a",
  aac: "m4a",
  ogg: "ogg",
};

/** Camera moves cycled through when the story's camera is "auto". */
const AUTO_CAMERAS = ["dolly-in", "pan-right", "orbit", "crane-up", "tilt-up", "dolly-out"];

export interface CreateStoryInput {
  title?: unknown;
  style?: unknown;
  scenes?: unknown;
  /** Narration lines, parallel to `scenes`. */
  narrations?: unknown;
  /** Parallel to `scenes`: false for a scene the main character is not in. */
  characterScenes?: unknown;
  voiceId?: unknown;
  subtitles?: unknown;
  fade?: unknown;
  /** Background music as an audio data URL. */
  music?: unknown;
  videoModelId?: unknown;
  /** Main character description; when set, scenes are drawn from one reference. */
  character?: unknown;
  /** The user's own reference picture (a person, a product) as an image data URL. */
  characterImage?: unknown;
  aspect?: unknown;
  duration?: unknown;
  cameraId?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function withStyle(prompt: string, style: string): string {
  return style ? `${prompt}. ${style}` : prompt;
}

/** Draws the main character alone, as the reference every scene is built from. */
function createCharacterReference(story: Story): Promise<Generation> {
  const prompt =
    `${story.character}, full body, standing, centered, ` +
    "plain light grey studio background, even soft lighting";
  return createGeneration(
    { modelId: story.imageModelId, prompt: withStyle(prompt, story.style), aspect: "1:1" },
    { storyId: story.id },
  );
}

/**
 * Submits the still for every scene that lacks one. With a character
 * reference, stills wait until it is drawn and are then derived from it.
 */
async function submitStills(story: Story): Promise<void> {
  const missing = story.scenes.filter((scene) => !scene.imageGenId);
  if (missing.length === 0) return;

  let reference: string | undefined;
  if (story.characterFile) {
    reference = fileName(story.characterFile);
  } else if (story.characterGenId) {
    const drawn = getGeneration(story.characterGenId);
    if (!drawn || drawn.status === "failed") {
      throw new Error(`The character reference failed. ${drawn?.error ?? ""}`.trim());
    }
    if (drawn.status !== "done") return;
    reference = await localOutput(drawn);
  }

  for (const scene of missing) {
    const image =
      reference && scene.withCharacter !== false
      ? await createGeneration(
          {
            modelId: CHARACTER_MODEL_ID,
            prompt: withStyle(
              `Place the exact same character or characters from the reference image into a new scene: ${scene.prompt}. ` +
                "Keep their faces, hair, design, colours, proportions and clothing identical to the reference. " +
                "Change the pose, the background and the lighting to fit the scene",
              story.style,
            ),
            aspect: story.aspect,
          },
          { refFile: reference, storyId: story.id },
        )
      : await createGeneration(
          { modelId: story.imageModelId, prompt: withStyle(scene.prompt, story.style), aspect: story.aspect },
          { storyId: story.id },
        );
    scene.imageGenId = image.id;
  }
  updateStory(story.id, { scenes: story.scenes });
}

export async function createStory(input: CreateStoryInput): Promise<Story> {
  const narrationInput = Array.isArray(input.narrations) ? input.narrations : [];
  const characterInput = Array.isArray(input.characterScenes) ? input.characterScenes : [];
  const drafted = Array.isArray(input.scenes)
    ? input.scenes
        .map((s, i) => ({
          prompt: text(s, MAX_SCENE_CHARS),
          narration: text(narrationInput[i], 300),
          withCharacter: characterInput[i] !== false,
        }))
        .filter((scene) => scene.prompt)
    : [];
  const prompts = drafted.map((scene) => scene.prompt);
  if (prompts.length < MIN_SCENES || prompts.length > MAX_SCENES) {
    throw new RequestError(`A story needs ${MIN_SCENES} to ${MAX_SCENES} scenes.`);
  }

  const available = await getAvailability();
  const missing = await missingModelIds(available);
  const imageModel = realModels("image", available, missing)[0];
  const videoModels = realModels("video", available, missing);
  const videoModel = videoModels.find((m) => m.id === input.videoModelId) ?? videoModels[0];
  if (!imageModel || !videoModel) {
    throw new RequestError("Story mode needs a real image and video model. Start ComfyUI first.");
  }

  const aspect = ASPECTS.includes(input.aspect as Aspect) ? (input.aspect as Aspect) : "16:9";
  const durations = videoModel.durations ?? [5];
  const duration = durations.includes(Number(input.duration)) ? Number(input.duration) : durations[0];
  const fixedCamera = CAMERAS.find((c) => c.id === input.cameraId)?.id;
  const style = text(input.style, 200);

  const voice = getVoice(typeof input.voiceId === "string" ? input.voiceId : undefined);
  const narrated = Boolean(voice) && drafted.some((scene) => scene.narration);
  if (narrated && !voiceAvailable()) {
    throw new RequestError("The voice engine is not installed (.tts folder is missing).");
  }
  const subtitles = input.subtitles === true && drafted.some((scene) => scene.narration);
  // The lines are kept whenever something will use them: a voice, subtitles, or both.
  const keepLines = narrated || subtitles;

  const character = text(input.character, 400);
  let ownPicture: { ext: string; data: Buffer } | undefined;
  if (typeof input.characterImage === "string" && input.characterImage) {
    const match = PICTURE_DATA_URL.exec(input.characterImage);
    if (!match) throw new RequestError("The character picture must be a JPEG, PNG or WebP.");
    const data = Buffer.from(match[2], "base64");
    if (data.length > MAX_PICTURE_BYTES) throw new RequestError("The character picture is too large.");
    ownPicture = { ext: match[1] === "jpeg" ? "jpg" : match[1], data };
  }
  if ((character || ownPicture) && (!available.comfy || missing.includes(CHARACTER_MODEL_ID))) {
    throw new RequestError("Consistent characters need the FLUX Kontext model, which is not installed.");
  }

  const id = randomUUID();
  let musicFile: string | undefined;
  if (typeof input.music === "string" && input.music) {
    const match = MUSIC_DATA_URL.exec(input.music);
    if (!match) throw new RequestError("The music must be an MP3, WAV, M4A or OGG file.");
    const data = Buffer.from(match[2], "base64");
    if (data.length > MAX_MUSIC_BYTES) throw new RequestError("The music file is larger than 20 MB.");
    musicFile = saveFile(`${id}-music.${MUSIC_EXT[match[1]]}`, data);
  }

  const story: Story = {
    id,
    title: text(input.title, 120) || prompts[0].slice(0, 60),
    style,
    aspect,
    duration,
    imageModelId: imageModel.id,
    videoModelId: videoModel.id,
    voiceId: narrated ? voice?.id : undefined,
    subtitles: subtitles || undefined,
    fade: input.fade === true || undefined,
    musicFile,
    characterFile: ownPicture ? saveFile(`${id}-character.${ownPicture.ext}`, ownPicture.data) : undefined,
    character: character || undefined,
    scenes: drafted.map(({ prompt, narration, withCharacter }, i) => ({
      prompt,
      narration: keepLines ? narration : undefined,
      withCharacter: withCharacter ? undefined : false,
      cameraId: fixedCamera ?? AUTO_CAMERAS[i % AUTO_CAMERAS.length],
    })),
    status: "running",
    createdAt: Date.now(),
  };

  // With the user's own picture there is nothing to draw: it is the reference.
  if (story.character && !story.characterFile) {
    story.characterGenId = (await createCharacterReference(story)).id;
  }
  insertStory(story);

  // Queue the stills up front where possible: the backend then renders all of
  // them before any video, so it swaps between models as little as possible.
  await submitStills(story);
  return story;
}

/** Makes sure a finished generation's output is a local file; returns its name. */
async function localOutput(gen: Generation): Promise<string> {
  const url = gen.outputUrl ?? "";
  if (url.startsWith("/api/files/")) return fileName(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download a scene result (${res.status})`);
  const type = res.headers.get("content-type") ?? "";
  const ext = gen.kind === "video" ? "mp4" : type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const local = saveFile(`${gen.id}.${ext}`, Buffer.from(await res.arrayBuffer()));
  updateGeneration(gen.id, { outputUrl: local });
  return fileName(local);
}

function fail(story: Story, error: string): void {
  updateStory(story.id, { status: "failed", error });
}

/** Stories being advanced right now, so overlapping polls do not double-submit. */
const busy = new Set<string>();

/** Moves one story forward: submits scene videos as stills finish, then joins. */
async function advance(story: Story): Promise<void> {
  if (busy.has(story.id)) return;
  busy.add(story.id);
  try {
    if (story.status === "joining") {
      // A join normally takes seconds; restart one orphaned by a server restart.
      if (Date.now() - (story.joinStartedAt ?? 0) > JOIN_TIMEOUT_MS) await join(story);
      return;
    }

    await submitStills(story);

    let finished = true;
    for (const [i, scene] of story.scenes.entries()) {
      if (!scene.imageGenId) {
        // Still waiting for the character reference.
        finished = false;
        continue;
      }
      const image = getGeneration(scene.imageGenId);
      if (!image || image.status === "failed") {
        return fail(story, `Scene ${i + 1} image failed. ${image?.error ?? ""}`.trim());
      }
      if (image.status !== "done") {
        finished = false;
        continue;
      }

      if (!scene.videoGenId) {
        const video = await createGeneration(
          {
            modelId: story.videoModelId,
            prompt: withStyle(scene.prompt, story.style),
            aspect: story.aspect,
            duration: story.duration,
            cameraId: scene.cameraId,
          },
          { refFile: await localOutput(image), storyId: story.id },
        );
        scene.videoGenId = video.id;
        updateStory(story.id, { scenes: story.scenes });
        finished = false;
        continue;
      }

      const video = getGeneration(scene.videoGenId);
      if (!video || video.status === "failed") {
        return fail(story, `Scene ${i + 1} video failed. ${video?.error ?? ""}`.trim());
      }
      if (video.status !== "done") finished = false;
    }

    if (finished) await join(story);
  } catch (err) {
    fail(story, err instanceof Error ? err.message : String(err));
  } finally {
    busy.delete(story.id);
  }
}

/** Joins the scene clips (and narration, if any) into one MP4 in the background. */
async function join(story: Story): Promise<void> {
  const clips: string[] = [];
  for (const scene of story.scenes) {
    const video = scene.videoGenId ? getGeneration(scene.videoGenId) : undefined;
    if (!video) return fail(story, "A scene clip was deleted before the story was joined.");
    clips.push(filePath(await localOutput(video)));
  }

  updateStory(story.id, { status: "joining", joinStartedAt: Date.now() });

  const outName = `${story.id}-story.mp4`;
  const options = {
    lines: story.scenes.map((scene) => scene.narration ?? ""),
    voiceId: story.voiceId,
    subtitles: story.subtitles,
    fade: story.fade,
    music: story.musicFile ? filePath(fileName(story.musicFile)) : undefined,
  };

  // Not awaited: speech and encoding can take a while, and polls must stay fast.
  void joinClips(clips, filePath(outName), options).then(
    () => updateStory(story.id, { status: "done", outputUrl: `/api/files/${outName}` }),
    (err: unknown) =>
      updateStory(story.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }),
  );
}

/** Per-clip render time used until two clips of this story have been timed. */
function defaultClipMs(story: Story): number {
  return story.duration * (getModel(story.videoModelId)?.speed ?? 100) * 1000;
}

/** Remaining render time, from how long this story's finished clips took. */
function estimateEta(story: Story): number | undefined {
  if (story.status !== "running") return undefined;
  const stamps: number[] = [];
  let done = 0;
  for (const scene of story.scenes) {
    const video = scene.videoGenId ? getGeneration(scene.videoGenId) : undefined;
    if (video?.status !== "done") continue;
    done += 1;
    if (video.finishedAt) stamps.push(video.finishedAt);
  }
  stamps.sort((a, b) => a - b);
  const perClip =
    stamps.length >= 2
      ? (stamps[stamps.length - 1] - stamps[0]) / (stamps.length - 1)
      : defaultClipMs(story);
  const sinceLast = stamps.length > 0 ? Date.now() - stamps[stamps.length - 1] : 0;
  const remaining = (story.scenes.length - done) * perClip - Math.min(sinceLast, perClip * 0.9);
  return Math.max(60, Math.round(remaining / 1000));
}

function view(story: Story): StoryView {
  let steps = 0;
  const scenes: SceneView[] = story.scenes.map((scene) => {
    const image = scene.imageGenId ? getGeneration(scene.imageGenId) : undefined;
    const video = scene.videoGenId ? getGeneration(scene.videoGenId) : undefined;
    const imageDone = image?.status === "done";
    const videoDone = video?.status === "done";
    steps += Number(imageDone) + Number(videoDone);
    return {
      prompt: scene.prompt,
      narration: scene.narration,
      withCharacter: scene.withCharacter !== false,
      cameraId: scene.cameraId,
      stage:
        image?.status === "failed" || video?.status === "failed"
          ? "failed"
          : videoDone
            ? "done"
            : imageDone
              ? "video"
              : "image",
      imageUrl: imageDone ? image.outputUrl : undefined,
      videoUrl: videoDone ? video.outputUrl : undefined,
    };
  });

  const reference = story.characterGenId ? getGeneration(story.characterGenId) : undefined;

  return {
    id: story.id,
    title: story.title,
    characterUrl: story.characterFile ?? (reference?.status === "done" ? reference.outputUrl : undefined),
    consistent: Boolean(story.characterGenId || story.characterFile),
    aspect: story.aspect,
    duration: story.duration,
    status: story.status,
    voiced: Boolean(story.voiceId),
    subtitled: Boolean(story.subtitles),
    faded: Boolean(story.fade),
    scored: Boolean(story.musicFile),
    style: story.style,
    character: story.character,
    voiceId: story.voiceId,
    videoModelId: story.videoModelId,
    progress: story.status === "done" ? 1 : steps / (story.scenes.length * 2 + 1),
    etaSeconds: estimateEta(story),
    outputUrl: story.outputUrl,
    error: story.error,
    createdAt: story.createdAt,
    scenes,
  };
}

export async function listStoriesWithAdvance(): Promise<StoryView[]> {
  const active = listStories().filter((s) => s.status === "running" || s.status === "joining");
  if (active.length > 0) {
    await refreshRunning();
    await Promise.all(active.map(advance));
  }
  return listStories().map(view);
}

export function storyView(id: string): StoryView | undefined {
  const story = getStory(id);
  return story ? view(story) : undefined;
}

/**
 * Restarts a failed story from where it stopped. Finished scenes are kept;
 * jobs the backend still has are picked up again, the rest are resubmitted.
 */
export async function resumeStory(id: string): Promise<boolean> {
  const story = getStory(id);
  if (!story) return false;
  if (story.status !== "failed") return true;

  if (story.characterGenId && !(await reviveGeneration(story.characterGenId))) {
    story.characterGenId = (await createCharacterReference(story)).id;
  }
  // Dead jobs are cleared; the next advance submits fresh ones.
  for (const scene of story.scenes) {
    if (scene.imageGenId && !(await reviveGeneration(scene.imageGenId))) {
      scene.imageGenId = undefined;
      scene.videoGenId = undefined;
    } else if (scene.videoGenId && !(await reviveGeneration(scene.videoGenId))) {
      scene.videoGenId = undefined;
    }
  }

  updateStory(id, {
    characterGenId: story.characterGenId,
    scenes: story.scenes,
    status: "running",
    error: undefined,
  });
  return true;
}

/**
 * Remakes one scene of a finished story: a new still, a new clip, then the
 * video is joined again. The other scenes are reused as they are.
 */
export function redoScene(id: string, index: number): "ok" | "missing" | "busy" {
  const story = getStory(id);
  const scene = story?.scenes[index];
  if (!story || !scene) return "missing";
  if (story.status !== "done" && story.status !== "failed") return "busy";

  scene.imageGenId = undefined;
  scene.videoGenId = undefined;
  if (story.outputUrl) removeFile(fileName(story.outputUrl));
  updateStory(id, {
    scenes: story.scenes,
    status: "running",
    outputUrl: undefined,
    error: undefined,
    joinStartedAt: undefined,
  });
  return "ok";
}

/** Deletes the story and its joined video. Scene clips stay in the library. */
export function removeStory(id: string): boolean {
  const story = getStory(id);
  if (!story) return false;
  if (story.outputUrl) removeFile(fileName(story.outputUrl));
  if (story.musicFile) removeFile(fileName(story.musicFile));
  if (story.characterFile) removeFile(fileName(story.characterFile));
  return deleteStory(id);
}

let ticking = false;

/**
 * Collects finished jobs and advances every active story, once. Called every
 * few seconds by the server's own timer (see ticker.ts) through /api/tick, so
 * rendering continues with no browser open.
 */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    // Single images and clips are collected here too, not only story scenes,
    // so a result is saved even if the page that asked for it was closed.
    await refreshRunning();
    const active = listStories().filter((s) => s.status === "running" || s.status === "joining");
    if (active.length > 0) await Promise.all(active.map(advance));
  } finally {
    ticking = false;
  }
}
