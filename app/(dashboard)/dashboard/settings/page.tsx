import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { SettingsView } from "./settings-view";
import { parseSendingSettings } from "@/lib/workspace-settings";
import { parseLoginSettings, summarizeLoginUsage } from "@/lib/mcp/login-settings";
import type { LoginUsageView } from "@/components/settings/mcp-login";

/** Who connected through "sign in with your account" in the last 30 days, with their e-mail. */
async function loadLoginUsage(workspaceId: string): Promise<LoginUsageView[]> {
  const service = await createServiceClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await service
    .from("mcp_audit_log")
    .select("user_id, created_at, ok")
    .eq("workspace_id", workspaceId)
    .not("user_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  const usage = summarizeLoginUsage(data ?? []).slice(0, 20);
  return Promise.all(
    usage.map(async (u) => {
      const { data: user } = await service.auth.admin.getUserById(u.userId);
      return { ...u, email: user?.user?.email ?? null };
    })
  );
}

export default async function SettingsPage() {
  const { workspace, role } = await getWorkspace();
  const canManage = role === "owner" || role === "admin";

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey: !!workspace.late_api_key_encrypted,
        hasAiKey: !!workspace.ai_api_key,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
      }}
      sending={parseSendingSettings(workspace.settings)}
      canEditSending={canManage}
      canManageKeys={canManage}
      mcpLogin={parseLoginSettings(workspace.settings)}
      mcpLoginUsage={canManage ? await loadLoginUsage(workspace.id) : []}
    />
  );
}
