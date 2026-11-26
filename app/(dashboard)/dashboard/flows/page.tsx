import { getWorkspace } from "@/lib/workspace";
import Link from "next/link";
import { GitBranch, Sparkles, Plug } from "lucide-react";
import { CreateFlowButton } from "@/components/create-flow-button";
import { ImportFlowButton, ExportFlowButton, DeleteFlowButton } from "@/components/flow-actions";
import type { FlowStatus } from "@/lib/types/database";
import { getT, getFormatter } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/translator";

const statusConfig: Record<FlowStatus, { classes: string }> = {
  draft: {
    classes:
      "bg-muted text-muted-foreground",
  },
  published: {
    classes:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  archived: {
    classes:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

function formatDate(dateString: string, format: Formatter) {
  return format.date(dateString, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function FlowsPage() {
  const { workspace, supabase } = await getWorkspace();
  const t = await getT("flows");
  const format = await getFormatter();

  const [{ data: flows }, { count: channelCount }] = await Promise.all([
    supabase
      .from("flows")
      .select("id, name, description, status, updated_at, version, nodes, edges")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("channels")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <ImportFlowButton />
            <Link
              href="/dashboard/flows/templates"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {t("templates")}
            </Link>
            <CreateFlowButton />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
      {(channelCount ?? 0) === 0 && (
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-dashed border-border bg-card p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{t("connectTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("connectBody")}
            </p>
          </div>
          <Link
            href="/dashboard/channels"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("connect")}
          </Link>
        </div>
      )}

      {!flows || flows.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border p-12 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("emptyBody")}
          </p>
          <div className="mt-4">
            <CreateFlowButton />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => {
            const statusKey = (flow.status as FlowStatus) in statusConfig ? (flow.status as FlowStatus) : "draft";
            const status = statusConfig[statusKey];
            const nodeCount = Array.isArray(flow.nodes) ? flow.nodes.length : 0;

            return (
              <Link
                key={flow.id}
                href={`/dashboard/flows/${flow.id}`}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium group-hover:text-primary transition-colors">
                          {flow.name}
                        </h3>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${status.classes}`}
                        >
                          {t(`status.${statusKey}`)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("nodeCount", { count: nodeCount })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <ExportFlowButton flow={flow} />
                    <DeleteFlowButton flow={flow} />
                  </div>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {t("updated", { date: formatDate(flow.updated_at, format) })}
                </p>
              </Link>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
