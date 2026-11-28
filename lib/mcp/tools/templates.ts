import { listTemplates, ZernioApiError } from "@/lib/whatsapp-templates";
import { dbOf, optUuid, readTool, str } from "./helpers";

export const whatsappTemplatesList = readTool({
  name: "whatsapp_templates_list",
  title: "List WhatsApp templates",
  description:
    "Message templates of a WhatsApp channel as approved (or not) by Meta, read live through Zernio: name, language, category, status, rejection reason and body.",
  properties: {
    channel_id: { type: "string", description: "WhatsApp channel id (uuid). Defaults to the oldest active one." },
    status: { type: "string", enum: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"], description: "Only this status." },
  },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const { data: ws } = await db.from("workspaces").select("late_api_key_encrypted").eq("id", ctx.workspaceId).single();
    const apiKey = (ws as { late_api_key_encrypted: string | null } | null)?.late_api_key_encrypted;
    if (!apiKey) throw new Error("This workspace has no Zernio key configured");

    let q = db
      .from("channels")
      .select("id, display_name, late_account_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("platform", "whatsapp")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    const channelId = optUuid(args, "channel_id");
    if (channelId) q = q.eq("id", channelId);
    const { data: chans, error } = await q.limit(1);
    if (error) throw new Error(error.message);
    const channel = (chans as Array<{ id: string; display_name: string | null; late_account_id: string }> | null)?.[0];
    if (!channel) throw new Error("No active WhatsApp channel in this workspace");

    try {
      const templates = await listTemplates(apiKey, channel.late_account_id, { status: str(args, "status", 20) });
      return { channel: { id: channel.id, name: channel.display_name }, templates };
    } catch (err) {
      if (err instanceof ZernioApiError) throw new Error(`Zernio: ${err.message}`);
      throw err;
    }
  },
});

export const TEMPLATE_TOOLS = [whatsappTemplatesList];
