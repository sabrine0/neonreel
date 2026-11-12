import { NextResponse } from "next/server";
import { redoScene, storyView } from "@/lib/stories";

/** Remakes one scene of a finished story, then the video is joined again. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await ctx.params;
  const result = redoScene(id, Number(index));
  if (result === "missing") return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (result === "busy") {
    return NextResponse.json({ error: "Wait until the story has finished rendering." }, { status: 409 });
  }
  return NextResponse.json(storyView(id));
}
