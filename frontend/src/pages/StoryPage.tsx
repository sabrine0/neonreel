// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { StoryStudio } from "@/components/StoryStudio";
import { useStatus } from "@/lib/status";

export function StoryPage() {
  const status = useStatus();
  if (!status) return null;
  return (
    <StoryStudio
      ready={status.storyReady}
      plannerReady={status.ollama}
      voiceReady={status.voice}
      characterReady={status.characterReady}
      imageModelName={status.imageModelName}
      videoModels={status.videoModels}
    />
  );
}
