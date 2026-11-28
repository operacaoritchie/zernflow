import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { ToolCallInfo } from "./types";

export const RATE_LIMIT_PER_MINUTE = 60;

/** Short, log-safe view of tool arguments: long strings and big structures are cut. */
export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args).slice(0, 20)) {
    if (typeof v === "string") out[k] = v.length > 120 ? `${v.slice(0, 120)}…(${v.length})` : v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = `[array:${v.length}]`;
    else out[k] = "[object]";
  }
  return out;
}

export function isOverLimit(callsLastMinute: number, limit = RATE_LIMIT_PER_MINUTE): boolean {
  return callsLastMinute >= limit;
}

/** Counts this key's tool calls in the last 60 seconds, from the audit log itself. */
export async function callsInLastMinute(supabase: SupabaseClient<Database>, keyId: string): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("mcp_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", keyId)
    .gte("created_at", since);
  return count ?? 0;
}

export async function writeAudit(
  supabase: SupabaseClient<Database>,
  ctx: { workspaceId: string; keyId: string },
  info: ToolCallInfo
): Promise<void> {
  await supabase.from("mcp_audit_log").insert({
    workspace_id: ctx.workspaceId,
    api_key_id: ctx.keyId,
    tool: info.tool,
    args_summary: summarizeArgs(info.args),
    ok: info.ok,
    error: info.error ?? null,
    duration_ms: info.durationMs,
  });
}
