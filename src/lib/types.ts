import type { Aspect, Kind } from "./catalog";

export type GenStatus = "running" | "done" | "failed";

/** "motion" = a still frame animated in the browser with a camera preset. */
export type OutputType = "image" | "video" | "motion";

export interface Generation {
  id: string;
  kind: Kind;
  modelId: string;
  prompt: string;
  aspect: Aspect;
  duration: number;
  cameraId: string;
  /** App-relative URL of the uploaded reference frame, if any. */
  refImage?: string;
  status: GenStatus;
  progress: number;
  outputUrl?: string;
  outputType?: OutputType;
  error?: string;
  cost: number;
  createdAt: number;
  /** When the job reached done or failed. */
  finishedAt?: number;
  /** Provider-specific job handles (request ids, polling URLs). */
  job: Record<string, string>;
  /** Set when this generation is one scene of a story. */
  storyId?: string;
  /** Starred by the user, to find it again in the library. */
  favorite?: boolean;
}

export interface StoryScene {
  prompt: string;
  /** Line spoken over this scene; empty for none. */
  narration?: string;
  /** False when the main character is not in this scene (drawn without the reference). */
  withCharacter?: boolean;
  cameraId: string;
  imageGenId?: string;
  videoGenId?: string;
}

/** "joining" = all clips are rendered and FFmpeg is concatenating them. */
export type StoryStatus = "running" | "joining" | "done" | "failed";

export interface Story {
  id: string;
  title: string;
  /** Visual style phrase appended to every scene prompt. */
  style: string;
  aspect: Aspect;
  /** Seconds per scene. */
  duration: number;
  imageModelId: string;
  videoModelId: string;
  /** Narration voice; unset for a silent story. */
  voiceId?: string;
  /** Burn the scene lines into the picture as subtitles. */
  subtitles?: boolean;
  /** Fade between scenes instead of cutting. */
  fade?: boolean;
  /** App-relative URL of the uploaded background music, if any. */
  musicFile?: string;
  /** Main character description. Set only when scenes are drawn from one reference. */
  character?: string;
  /** Generation holding the character reference picture. */
  characterGenId?: string;
  /** App-relative URL of a reference picture the user supplied instead. */
  characterFile?: string;
  scenes: StoryScene[];
  status: StoryStatus;
  outputUrl?: string;
  error?: string;
  createdAt: number;
  joinStartedAt?: number;
}

export type SceneStage = "image" | "video" | "done" | "failed";

export interface SceneView {
  prompt: string;
  narration?: string;
  /** False when the main character is not in this scene. */
  withCharacter: boolean;
  cameraId: string;
  stage: SceneStage;
  imageUrl?: string;
  videoUrl?: string;
}

/** A story as sent to the browser, with scene state resolved. */
export interface StoryView {
  id: string;
  title: string;
  aspect: Aspect;
  duration: number;
  status: StoryStatus;
  /** True when the story has a narration voice. */
  voiced: boolean;
  /** True when the lines are burned in as subtitles. */
  subtitled: boolean;
  /** True when scenes fade to black between each other. */
  faded: boolean;
  /** True when the story has background music. */
  scored: boolean;
  /** Settings the story was made with, so it can be loaded back into the editor. */
  style: string;
  character?: string;
  voiceId?: string;
  videoModelId: string;
  progress: number;
  /** Rough seconds until the story is finished, while it is rendering. */
  etaSeconds?: number;
  /** The character reference picture, when the story uses one. */
  characterUrl?: string;
  /** True when every scene is drawn from one character reference. */
  consistent: boolean;
  outputUrl?: string;
  error?: string;
  createdAt: number;
  scenes: SceneView[];
}

export interface GenerationList {
  credits: number;
  generations: Generation[];
}
