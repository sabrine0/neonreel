// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { Assistant } from "@/components/Assistant";
import { useStatus } from "@/lib/status";

export function AssistantPage() {
  const status = useStatus();
  if (!status) return null;
  return <Assistant ready={status.ollama} />;
}
