// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { StoryStudio } from "@/components/StoryStudio";
import { getAvailability, missingModelIds, ollamaModels, realModels } from "@/lib/availability";
import { CHARACTER_MODEL_ID } from "@/lib/catalog";
import { voiceAvailable } from "@/lib/render";

export const dynamic = "force-dynamic";

/** Hosted video models are not timed here; assume a typical queue-plus-render. */
const HOSTED_SPEED = 28;

export default async function StoryPage() {
  const [available, models] = await Promise.all([getAvailability(), ollamaModels()]);
  const missing = await missingModelIds(available);
  const imageModel = realModels("image", available, missing)[0];
  const videoModels = realModels("video", available, missing);

  return (
    <StoryStudio
      ready={Boolean(imageModel && videoModels.length > 0)}
      plannerReady={models.length > 0}
      voiceReady={voiceAvailable()}
      characterReady={available.comfy && !missing.includes(CHARACTER_MODEL_ID)}
      imageModelName={imageModel?.name}
      videoModels={videoModels.map((m) => ({
        id: m.id,
        name: m.name,
        durations: m.durations ?? [5],
        speed: m.provider === "comfy" ? (m.speed ?? 100) : HOSTED_SPEED,
      }))}
    />
  );
}
