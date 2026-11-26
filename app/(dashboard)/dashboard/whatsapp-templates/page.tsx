import { getWorkspace } from "@/lib/workspace";
import { WhatsAppTemplatesView } from "./templates-view";

export default async function WhatsAppTemplatesPage() {
  const { workspace, supabase } = await getWorkspace();

  const { data: channels } = await supabase
    .from("channels")
    .select("id, display_name, username")
    .eq("workspace_id", workspace.id)
    .eq("platform", "whatsapp")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <WhatsAppTemplatesView
      channels={(channels ?? []).map((c) => ({
        id: c.id,
        label: c.display_name || c.username || "WhatsApp",
      }))}
      hasApiKey={!!workspace.late_api_key_encrypted}
    />
  );
}
