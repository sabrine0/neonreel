// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useSearchParams } from "react-router-dom";
import { Studio } from "@/components/Studio";
import { getCamera } from "@/lib/catalog";
import { useStatus } from "@/lib/status";

export function CreatePage() {
  const [params] = useSearchParams();
  const status = useStatus();
  // Studio picks its default model when it mounts, so it waits for the answer.
  if (!status) return null;
  return (
    <Studio
      available={status.available}
      missing={status.missing}
      improveReady={status.ollama}
      initialKind={params.get("kind") === "video" ? "video" : "image"}
      initialCamera={getCamera(params.get("camera") ?? undefined).id}
    />
  );
}
