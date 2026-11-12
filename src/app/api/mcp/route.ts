import { NextResponse } from "next/server";
import { AGENT_TOOLS, runTool } from "@/lib/agent";

export const dynamic = "force-dynamic";

/**
 * A Model Context Protocol server (Streamable HTTP, JSON responses), so AI apps
 * such as Claude can create pictures, clips and stories here.
 * Connect with:  claude mcp add --transport http neonreel http://localhost:4000/api/mcp
 */
const DEFAULT_PROTOCOL = "2025-03-26";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function handle(message: RpcRequest, origin: string): Promise<object | undefined> {
  const { id, method, params } = message;
  // Notifications carry no id and get no reply.
  if (id === undefined || id === null) return undefined;
  const result = (value: object) => ({ jsonrpc: "2.0", id, result: value });

  switch (method) {
    case "initialize":
      return result({
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "neonreel", version: "1.0.0" },
        instructions:
          "Neonreel generates pictures, video clips and narrated story videos on this computer. Creation tools start a job and return an id; use get_status to see when it is done.",
      });
    case "ping":
      return result({});
    case "tools/list":
      return result({ tools: AGENT_TOOLS });
    case "tools/call": {
      const outcome = await runTool(String(params?.name ?? ""), params?.arguments, origin);
      return result({ content: [{ type: "text", text: outcome.text }], isError: Boolean(outcome.isError) });
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export async function POST(req: Request) {
  // Only programs on this computer may drive the studio: a web page elsewhere must not.
  const from = req.headers.get("origin");
  const origin = new URL(req.url).origin;
  if (from && from !== origin) return new Response("Forbidden", { status: 403 });

  const body = (await req.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((message) => handle(message, origin)))).filter(Boolean);
    return replies.length ? NextResponse.json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handle(body, origin);
  return reply ? NextResponse.json(reply) : new Response(null, { status: 202 });
}

/** This server never pushes messages, so there is no stream to open. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
