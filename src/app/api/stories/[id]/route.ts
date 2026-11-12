import { NextResponse } from "next/server";
import { RequestError } from "@/lib/generations";
import { removeStory, resumeStory, storyView } from "@/lib/stories";

/** Resumes a failed story. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    if (!(await resumeStory(id))) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json(storyView(id));
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!removeStory(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
