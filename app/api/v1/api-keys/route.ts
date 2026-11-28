import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseScopes } from "@/lib/mcp/scopes";
import crypto from "crypto";

function generateApiKey(): string {
  return `zf_${crypto.randomBytes(24).toString("hex")}`; // 48 hex chars = 192 bits of entropy
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, scopes, expires_at, revoked_at, last_used_at, created_at")
    .eq("workspace_id", membership.workspace_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  // Only admins and owners can create API keys
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name } = body;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const scopes = parseScopes(body.scopes);
  let expiresAt: string | null = null;
  if (body.expires_at) {
    const d = new Date(body.expires_at);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "expires_at must be a future date" }, { status: 400 });
    }
    expiresAt = d.toISOString();
  }

  const fullKey = generateApiKey();
  const keyHash = crypto.createHash("sha256").update(fullKey).digest("hex");
  const keyPrefix = fullKey.slice(0, 10) + "..."; // "zf_abc123..."

  // Writes go through the service role after the owner/admin check above:
  // members can read keys under RLS but cannot create or change them directly.
  const admin = await createServiceClient();
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      workspace_id: membership.workspace_id,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_by: user.id,
      scopes,
      expires_at: expiresAt,
    })
    .select("id, name, key_prefix, scopes, expires_at, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return the full key ONCE. After this, only the prefix is available.
  return NextResponse.json({ ...data, key: fullKey }, { status: 201 });
}
