import { getWorkspace } from "@/lib/workspace";
import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { CreateSequenceButton } from "@/components/sequences/create-sequence-button";
import type { SequenceStatus, Json } from "@/lib/types/database";
import { getT, getFormatter } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/translator";

const statusConfig: Record<SequenceStatus, { label: string; classes: string }> = {
  draft: {
    label: "Draft",
    classes: "bg-muted text-muted-foreground",
  },
  active: {
    label: "Active",
    classes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  paused: {
    label: "Paused",
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
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

export default async function SequencesPage() {
  const { workspace, supabase } = await getWorkspace();
  const t = await getT("sequences");
  const format = await getFormatter();

  const { data: sequences } = await supabase
    .from("sequences")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  // Get enrollment counts per sequence
  const sequenceIds = (sequences ?? []).map((s) => s.id);
  let enrollmentCounts: Record<string, number> = {};

  if (sequenceIds.length > 0) {
    const { data: counts } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id")
      .in("sequence_id", sequenceIds)
      .eq("status", "active");

    if (counts) {
      enrollmentCounts = counts.reduce<Record<string, number>>((acc, row) => {
        acc[row.sequence_id] = (acc[row.sequence_id] || 0) + 1;
        return acc;
      }, {});
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <CreateSequenceButton />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
      {!sequences || sequences.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border p-12 text-center">
          <ListOrdered className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("emptyBody")}
          </p>
          <div className="mt-4">
            <CreateSequenceButton />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sequences.map((sequence) => {
            const statusKey = (sequence.status as SequenceStatus) in statusConfig ? (sequence.status as SequenceStatus) : "draft";
            const status = statusConfig[statusKey];
            const steps = Array.isArray(sequence.steps)
              ? sequence.steps
              : [];
            const stepCount = steps.length;
            const enrolled = enrollmentCounts[sequence.id] || 0;

            return (
              <Link
                key={sequence.id}
                href={`/dashboard/sequences/${sequence.id}`}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <ListOrdered className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium group-hover:text-primary transition-colors">
                        {sequence.name}
                      </h3>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${status.classes}`}
                      >
                        {t(`status.${statusKey}`)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("stepCount", { count: stepCount })}
                      {enrolled > 0 && (
                        <span className="ml-2">
                          {t("enrolledCount", { count: enrolled })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {sequence.description && (
                  <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
                    {sequence.description}
                  </p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  {t("updated", { date: formatDate(sequence.updated_at, format) })}
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
