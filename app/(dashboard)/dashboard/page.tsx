import { getWorkspace } from "@/lib/workspace";
import { getT } from "@/lib/i18n/server";
import { loadDashboard } from "@/lib/dashboard/load";
import { parsePeriod } from "@/lib/dashboard/metrics";
import { DashboardHome } from "./dashboard-home";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const { period: rawPeriod } = await searchParams;
  const period = parsePeriod(rawPeriod);
  const { workspace, supabase } = await getWorkspace();
  const t = await getT("home");
  const data = await loadDashboard(supabase, workspace.id, period, t("funnel.entered"));
  if (data.loadErrors.length > 0) console.error("[dashboard] partial load:", data.loadErrors);
  return <DashboardHome data={data} />;
}
