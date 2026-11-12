// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { LOOP_MODEL_ID, REVERSE_MODEL_ID, SLOW_MODEL_ID } from "../catalog";
import { loopClip, reverseClip, slowClip } from "../clip";
import { filePath } from "../store";
import type { Provider } from "./types";

const TOOLS: Record<string, (clip: string, out: string) => Promise<void>> = {
  [LOOP_MODEL_ID]: loopClip,
  [REVERSE_MODEL_ID]: reverseClip,
  [SLOW_MODEL_ID]: slowClip,
};

/**
 * Clip tools that need no graphics card. A short clip takes a second or two,
 * so the work is done while the job is submitted and is finished on first poll.
 */
export const ffmpegProvider: Provider = {
  async submit(gen) {
    const tool = TOOLS[gen.modelId];
    const clip = gen.refImage?.slice(gen.refImage.lastIndexOf("/") + 1);
    if (!tool || !clip) throw new Error("The clip to work on is missing.");
    const file = `${gen.id}.mp4`;
    await tool(filePath(clip), filePath(file));
    return { file };
  },

  async check(gen) {
    return { status: "done", outputUrl: `/api/files/${gen.job.file}`, outputType: "video" };
  },
};
