import { VoiceStudio } from "@/components/VoiceStudio";
import { voiceAvailable } from "@/lib/render";

export const dynamic = "force-dynamic";

export default function VoicePage() {
  return <VoiceStudio ready={voiceAvailable()} />;
}
