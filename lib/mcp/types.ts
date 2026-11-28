import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Scope } from "./scopes";

export interface McpContext {
  workspaceId: string;
  keyId: string;
  scopes: Scope[];
  /** Service-role client: RLS does not apply, so every query MUST filter by workspaceId. */
  supabase: SupabaseClient<Database>;
}

export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  /** Scope the key needs to call this tool. */
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations: McpToolAnnotations;
  run(args: Record<string, unknown>, ctx: McpContext): Promise<unknown>;
}

export interface ToolCallInfo {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  durationMs: number;
}
