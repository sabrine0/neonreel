import type { ModelDef } from "../catalog";
import { comfyProvider } from "./comfy";
import { falProvider } from "./fal";
import { ffmpegProvider } from "./ffmpeg";
import { mockProvider } from "./mock";
import type { Provider } from "./types";

const PROVIDERS: Record<ModelDef["provider"], Provider> = {
  mock: mockProvider,
  comfy: comfyProvider,
  fal: falProvider,
  ffmpeg: ffmpegProvider,
};

export function providerFor(model: ModelDef): Provider {
  return PROVIDERS[model.provider];
}
