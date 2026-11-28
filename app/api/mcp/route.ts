import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { bearerKey, verifyKey } from "@/lib/mcp/auth";
import { callsInLastMinute, isOverLimit, writeAudit } from "@/lib/mcp/audit";
import { handleMessage, type RpcResponse } from "@/lib/mcp/protocol";
import { MCP_TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const unauthorized = () =>
  NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="zernflow-mcp"' } }
  );

export async function POST(request: NextRequest) {
  if (process.env.MCP_ENABLED === "false") {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "MCP is disabled" } },
      { status: 503 }
    );
  }

  const key = bearerKey(request.headers.get("authorization"));
  if (!key) return unauthorized();

  const supabase = await createServiceClient();
  const verified = await verifyKey(supabase, key);
  if (!verified) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const messages = Array.isArray(body) ? body : [body];
  const callsTools = messages.some((m) => (m as { method?: string })?.method === "tools/call");
  if (callsTools && isOverLimit(await callsInLastMinute(supabase, verified.keyId))) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32002, message: "Rate limit: 60 calls per minute" } },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }

  const ctx = { ...verified, supabase };
  const responses: RpcResponse[] = [];
  for (const msg of messages) {
    const res = await handleMessage(msg, {
      tools: MCP_TOOLS,
      ctx,
      onToolCall: (info) => writeAudit(supabase, verified, info),
    });
    if (res) responses.push(res);
  }

  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

// Stateless server: no SSE stream and no sessions to close.
const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
