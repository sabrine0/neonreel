// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { NextResponse } from "next/server";
import { publicView, removeGeneration } from "@/lib/generations";
import { getGeneration, updateGeneration } from "@/lib/store";

/** Stars or unstars one result. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { favorite?: unknown } | null;
  if (typeof body?.favorite !== "boolean") {
    return NextResponse.json({ error: "Expected { favorite: true | false }." }, { status: 400 });
  }
  if (!getGeneration(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  updateGeneration(id, { favorite: body.favorite || undefined });
  const updated = getGeneration(id);
  return NextResponse.json(updated ? publicView(updated) : null);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!removeGeneration(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
