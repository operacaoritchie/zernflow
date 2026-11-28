"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/lib/i18n/server";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";
import { parseLoginSettings, serializeLoginSettings, type LoginSettings } from "@/lib/mcp/login-settings";

/** Owner/admin only. Takes effect on the very next MCP call (scopes are re-read per request). */
export async function updateMcpLoginSettings(next: LoginSettings) {
  const t = await getT("errors");
  const { workspace, role } = await getWorkspace();
  if (role !== "owner" && role !== "admin") return { error: t("noPermission") };

  // Same pattern as sending settings: the role check is the guard, the write uses the service role.
  const service = await createServiceClient();
  const { data: current } = await service.from("workspaces").select("settings").eq("id", workspace.id).single();
  const stored = serializeLoginSettings(current?.settings, next);
  const { error } = await service
    .from("workspaces")
    .update({ settings: stored as unknown as Json })
    .eq("id", workspace.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings");
  return { ok: true, settings: parseLoginSettings(stored) };
}
