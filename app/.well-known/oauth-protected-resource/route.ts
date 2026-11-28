import { NextRequest, NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** Tells MCP clients which server handles login for /api/mcp (RFC 9728). */
export function GET(request: NextRequest) {
  return NextResponse.json(
    protectedResourceMetadata(request.nextUrl.origin, process.env.NEXT_PUBLIC_SUPABASE_URL!),
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  );
}
