import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scopesForRole, type Scope } from "./scopes";

export interface VerifiedUser {
  keyId: null;
  userId: string;
  workspaceId: string;
  scopes: Scope[];
}

/** Public URL of the MCP endpoint for a given request origin. */
export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

/** Where the OAuth server lives: the Supabase Auth issuer of this project. */
export function authorizationServerUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

/** RFC 9728 protected-resource metadata, so an MCP client can find the login server. */
export function protectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [authorizationServerUrl(supabaseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: "ZernFlow",
  };
}

/** Value of the WWW-Authenticate header that points clients at the metadata. */
export function wwwAuthenticate(origin: string): string {
  return `Bearer realm="zernflow-mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`;
}

/**
 * Validates a Supabase-issued OAuth access token with the Auth server and maps
 * the user to their workspace and role. Returns null when the token is not valid
 * or the user belongs to no workspace.
 */
export async function verifyAccessToken(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<VerifiedUser | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  return {
    keyId: null,
    userId: data.user.id,
    workspaceId: membership.workspace_id,
    scopes: scopesForRole(membership.role),
  };
}
