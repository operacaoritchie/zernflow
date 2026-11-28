import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseScopes, type Scope } from "./scopes";

export interface VerifiedKey {
  keyId: string;
  workspaceId: string;
  scopes: Scope[];
}

export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Extracts "zf_..." from "Authorization: Bearer zf_...". */
export function bearerKey(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(zf_[A-Za-z0-9]+)\s*$/.exec(header);
  return m ? m[1] : null;
}

export interface KeyRow {
  id: string;
  workspace_id: string;
  scopes: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Pure check so it can be unit-tested without a database. */
export function evaluateKeyRow(row: KeyRow | null, now = new Date()): VerifiedKey | null {
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return null;
  return { keyId: row.id, workspaceId: row.workspace_id, scopes: parseScopes(row.scopes) };
}

export async function verifyKey(supabase: SupabaseClient<Database>, key: string): Promise<VerifiedKey | null> {
  const keyHash = hashKey(key);
  const { data } = await supabase
    .from("api_keys")
    .select("id, workspace_id, scopes, expires_at, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  const verified = evaluateKeyRow(data as KeyRow | null);
  if (verified) {
    // Fire and forget: last use is informational.
    void supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", verified.keyId)
      .then(() => {});
  }
  return verified;
}
