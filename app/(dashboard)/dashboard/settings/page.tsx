import { getWorkspace } from "@/lib/workspace";
import { SettingsView } from "./settings-view";
import { parseSendingSettings } from "@/lib/workspace-settings";

export default async function SettingsPage() {
  const { workspace, role } = await getWorkspace();

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
      canEditSending={role === "owner" || role === "admin"}
      canManageKeys={role === "owner" || role === "admin"}
    />
  );
}
