import { getWorkspace } from "@/lib/workspace";
import { TopNav } from "@/components/top-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user, supabase } = await getWorkspace();

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, slug)")
    .eq("user_id", user.id);

  const workspaces = (memberships ?? [])
    .map((m) => ({
      ...(m.workspaces as { id: string; name: string; slug: string }),
      role: m.role,
    }))
    .filter((w) => w.id);

  return (
    <div className="flex h-dvh flex-col">
      {/* Only id and name cross to the browser: the full row carries the Zernio key. */}
      <TopNav
        workspace={{ id: workspace.id, name: workspace.name }}
        user={{ id: user.id, email: user.email }}
        workspaces={workspaces}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
