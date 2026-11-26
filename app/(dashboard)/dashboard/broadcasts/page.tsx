import { getWorkspace } from "@/lib/workspace";
import { BroadcastsView } from "./broadcasts-view";

export default async function BroadcastsPage() {
  const { workspace, supabase, role } = await getWorkspace();

  const [{ data: broadcasts }, { data: channels }] = await Promise.all([
    supabase
      .from("broadcasts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("channels")
      .select("id, platform, display_name, username, is_active")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
  ]);

  return (
    <BroadcastsView
      broadcasts={broadcasts ?? []}
      workspaceId={workspace.id}
      channels={(channels ?? []).filter((c) => c.platform === "instagram" || c.platform === "whatsapp" || c.platform === "facebook")}
      canSend={role === "owner" || role === "admin"}
    />
  );
}
