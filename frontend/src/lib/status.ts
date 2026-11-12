// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useEffect, useState } from "react";
import type { ModelDef } from "./catalog";

/** Which generation backends can be used right now. */
export type Availability = Record<ModelDef["provider"], boolean>;

/** A usable video model. `speed` = render seconds per video second. */
export interface StatusVideoModel {
  id: string;
  name: string;
  durations: number[];
  speed: number;
}

/** The answer of `GET /api/status`: what is installed and running right now. */
export interface Status {
  available: Availability;
  /** Ids of local models whose files are not downloaded. */
  missing: string[];
  /** A local language model is available. */
  ollama: boolean;
  /** The local text-to-speech engine is installed. */
  voice: boolean;
  /** The image-editing model for consistent characters is installed. */
  characterReady: boolean;
  /** A real image and video backend are both available. */
  storyReady: boolean;
  imageModelName?: string;
  /** Usable video models, fastest first. */
  videoModels: StatusVideoModel[];
}

/** Used when the server cannot be asked: nothing but the built-in demo models. */
export const NOTHING_AVAILABLE: Status = {
  available: { mock: true, fal: false, comfy: false, ffmpeg: false },
  missing: [],
  ollama: false,
  voice: false,
  characterReady: false,
  storyReady: false,
  imageModelName: undefined,
  videoModels: [],
};

/** Fills in anything the server left out, so the pages never read `undefined`. */
function normalize(body: Partial<Status> | null): Status {
  if (!body || typeof body !== "object") return NOTHING_AVAILABLE;
  return {
    available: { ...NOTHING_AVAILABLE.available, ...body.available },
    missing: Array.isArray(body.missing) ? body.missing : [],
    ollama: Boolean(body.ollama),
    voice: Boolean(body.voice),
    characterReady: Boolean(body.characterReady),
    storyReady: Boolean(body.storyReady),
    imageModelName: body.imageModelName ?? undefined,
    videoModels: Array.isArray(body.videoModels) ? body.videoModels : [],
  };
}

/**
 * Asks the server once, when the page mounts, what is installed. Returns
 * `undefined` until the answer arrives; a failed request counts as "nothing
 * is available" so the page still renders.
 */
export function useStatus(): Status | undefined {
  const [status, setStatus] = useState<Status>();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Partial<Status>>) : null))
      .catch(() => null)
      .then((body) => {
        if (!cancelled) setStatus(normalize(body));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
