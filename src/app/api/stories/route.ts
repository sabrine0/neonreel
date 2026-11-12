import { NextResponse } from "next/server";
import { RequestError } from "@/lib/generations";
import { createStory, listStoriesWithAdvance, storyView, type CreateStoryInput } from "@/lib/stories";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ stories: await listStoriesWithAdvance() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CreateStoryInput | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const story = await createStory(body);
    return NextResponse.json(storyView(story.id), { status: 201 });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
