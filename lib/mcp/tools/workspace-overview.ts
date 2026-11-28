import { parseSendingSettings } from "@/lib/workspace-settings";
import type { McpTool } from "../types";

async function count(
  q: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

export const workspaceOverview: McpTool = {
  name: "workspace_overview",
  description:
    "Overview of the ZernFlow workspace: connected channels, contact and flow counts, and the sending rules in force.",
  scope: "read",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    title: "Workspace overview",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async run(_args, { supabase, workspaceId }) {
    const [workspace, channels, contacts, flowsTotal, flowsPublished] = await Promise.all([
      supabase.from("workspaces").select("id, name, settings").eq("id", workspaceId).single(),
      supabase
        .from("channels")
        .select("id, platform, username, display_name, is_active")
        .eq("workspace_id", workspaceId)
        .order("created_at"),
      count(supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)),
      count(supabase.from("flows").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)),
      count(
        supabase
          .from("flows")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("status", "published")
      ),
    ]);

    if (workspace.error) throw new Error(workspace.error.message);
    if (channels.error) throw new Error(channels.error.message);

    const sending = parseSendingSettings(workspace.data?.settings);
    return {
      workspace: { id: workspace.data.id, name: workspace.data.name },
      channels: channels.data ?? [],
      counts: { contacts, flows: flowsTotal, flows_published: flowsPublished },
      sending_rules: {
        bulk_sending_enabled: sending.bulkSendingEnabled,
        quiet_hours: sending.quietHours,
        confirm_threshold: sending.confirmThreshold,
        require_whatsapp_consent: sending.requireWhatsAppConsent,
      },
    };
  },
};
