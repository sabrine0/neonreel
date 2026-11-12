import { NextResponse } from "next/server";
import {
  createGeneration,
  listWithRefresh,
  publicView,
  RequestError,
  type CreateInput,
} from "@/lib/generations";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listWithRefresh());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CreateInput | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const gen = await createGeneration(body);
    return NextResponse.json(publicView(gen), { status: 201 });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
