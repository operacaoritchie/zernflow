"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, XCircle, Loader2, UserPlus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { cancelEnrollment, enrollContact, searchContactsForEnrollment } from "@/lib/actions/sequences";
import { useT, useFormatter } from "@/lib/i18n/provider";
import type { Formatter } from "@/lib/i18n/translator";
import type { SequenceEnrollmentStatus } from "@/lib/types/database";

interface Enrollment {
  id: string;
  contactName: string;
  currentStepIndex: number;
  status: SequenceEnrollmentStatus;
  enrolledAt: string;
  reason: string | null;
  nextStepAt: string | null;
}

const statusClasses: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused_window: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelled: "bg-muted text-muted-foreground",
  exited: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function formatDate(dateStr: string, format: Formatter) {
  return format.date(dateStr, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type FoundContact = {
  id: string;
  name: string | null;
  channels: Array<{ channelId: string; platform: string; username: string | null }>;
};

export function EnrollmentList({
  sequenceId,
  sequenceActive,
  enrollments: initial,
}: {
  sequenceId: string;
  sequenceActive: boolean;
  enrollments: Enrollment[];
}) {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState(initial);
  const t = useT("sequences");
  const format = useFormatter();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundContact[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCancel(enrollmentId: string) {
    setCancelling(enrollmentId);
    const result = await cancelEnrollment(enrollmentId);
    if (!result.error) {
      setEnrollments((prev) =>
        prev.map((e) => (e.id === enrollmentId ? { ...e, status: "cancelled" as const } : e))
      );
    }
    setCancelling(null);
  }

  async function handleSearch() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setMessage(null);
    const result = await searchContactsForEnrollment(query);
    setFound(result.contacts);
    setSearching(false);
  }

  async function handleEnroll(contactId: string, channelId: string) {
    setEnrolling(`${contactId}:${channelId}`);
    setMessage(null);
    const result = await enrollContact(sequenceId, contactId, channelId);
    setEnrolling(null);
    if ("error" in result && result.error) {
      setMessage(result.error);
      return;
    }
    setFound(null);
    setQuery("");
    setMessage(t("enrolledOk"));
    router.refresh();
  }

  return (
    <div className="px-4 py-4 sm:px-8 sm:py-6">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-lg font-semibold">{t("enrollments")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("enrollmentsHint")}</p>

        {/* Manual enrollment */}
        <div className="mt-4 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            {t("enrollContact")}
          </div>
          {!sequenceActive ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("enrollNeedsActive")}</p>
          ) : (
            <>
              <div className="mt-2 flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder={t("enrollSearchPlaceholder")}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || query.trim().length < 2}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>
              </div>
              {found && found.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">{t("enrollNoResults")}</p>
              )}
              {found && found.length > 0 && (
                <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {found.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{c.name || "—"}</span>
                      {c.channels.map((ch) => (
                        <button
                          key={ch.channelId}
                          onClick={() => handleEnroll(c.id, ch.channelId)}
                          disabled={enrolling !== null}
                          className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                        >
                          {enrolling === `${c.id}:${ch.channelId}` && <Loader2 className="h-3 w-3 animate-spin" />}
                          {t("enrollVia", { platform: ch.platform, username: ch.username ? `@${ch.username}` : "" })}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
        </div>

        {enrollments.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border p-4 text-center sm:p-8">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">{t("noEnrollments")}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{t("noEnrollmentsHint")}</p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border rounded-lg border border-border">
            {enrollments.map((enrollment) => {
              const isCancelling = cancelling === enrollment.id;
              const canCancel = enrollment.status === "active" || enrollment.status === "paused_window";

              return (
                <div key={enrollment.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{enrollment.contactName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("stepN", { n: enrollment.currentStepIndex + 1 })}
                      <span className="mx-1.5">-</span>
                      {t("enrolledAt", { date: formatDate(enrollment.enrolledAt, format) })}
                      {enrollment.status === "active" && enrollment.nextStepAt && (
                        <>
                          <span className="mx-1.5">-</span>
                          {t("nextAt", { date: formatDate(enrollment.nextStepAt, format) })}
                        </>
                      )}
                    </p>
                    {enrollment.reason && enrollment.status !== "active" && (
                      <p className="truncate text-xs text-muted-foreground">
                        {(() => {
                          const key = `exitReasons.${enrollment.reason.split(":")[0]}`;
                          const label = t(key);
                          return label.endsWith(key) ? enrollment.reason : label;
                        })()}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      statusClasses[enrollment.status] ?? "bg-muted text-muted-foreground"
                    )}
                  >
                    {t(`enrollment.${enrollment.status}`)}
                  </span>
                  {canCancel && (
                    <button
                      onClick={() => handleCancel(enrollment.id)}
                      disabled={isCancelling}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title={t("cancelEnrollment")}
                    >
                      {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
