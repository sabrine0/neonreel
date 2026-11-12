import { Assistant } from "@/components/Assistant";
import { ollamaModels } from "@/lib/availability";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  return <Assistant ready={(await ollamaModels()).length > 0} />;
}
