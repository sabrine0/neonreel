// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { VoiceStudio } from "@/components/VoiceStudio";
import { useStatus } from "@/lib/status";

export function VoicePage() {
  const status = useStatus();
  if (!status) return null;
  return <VoiceStudio ready={status.voice} />;
}
