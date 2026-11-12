import { Studio } from "@/components/Studio";
import { getAvailability, missingModelIds, ollamaModels } from "@/lib/availability";
import { getCamera } from "@/lib/catalog";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ kind?: string; camera?: string }>;
}

export default async function CreatePage({ searchParams }: Props) {
  const params = await searchParams;
  const available = await getAvailability();
  return (
    <Studio
      available={available}
      missing={await missingModelIds(available)}
      improveReady={(await ollamaModels()).length > 0}
      initialKind={params.kind === "video" ? "video" : "image"}
      initialCamera={getCamera(params.camera).id}
    />
  );
}
