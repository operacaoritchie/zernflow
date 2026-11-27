"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Radio,
  Pause,
  Play,
  Users,
  FlaskConical,
  AtSign,
  MessageCircle,
  Plus,
  Clock,
  CheckCircle2,
  Send,
  Loader2,
  XCircle,
  FileEdit,
  Calendar,
  Filter,
  ChevronDown,
  ArrowLeft,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  SegmentBuilder,
  createEmptyFilter,
  type SegmentFilter,
} from "@/components/segment-builder";
import type { Database, BroadcastStatus, Json } from "@/lib/types/database";
import { useT, useFormatter } from "@/lib/i18n/provider";
import type { Formatter, Translator } from "@/lib/i18n/translator";
import { SendWhatsAppTemplatePanel } from "@/components/flow-builder/panels/SendWhatsAppTemplatePanel";

type Broadcast = Database["public"]["Tables"]["broadcasts"]["Row"];

const statusConfig: Record<
  BroadcastStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  draft: {
    label: "Draft",
    icon: FileEdit,
    className: "bg-muted text-muted-foreground",
  },
  scheduled: {
    label: "Scheduled",
    icon: Clock,
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  sending: {
    label: "Sending",
    icon: Loader2,
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  paused: {
    label: "Paused",
    icon: Pause,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
};

function formatDate(dateStr: string | null, t: Translator, format: Formatter): string {
  if (!dateStr) return t("notScheduled");
  return format.date(dateStr, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface BroadcastChannel {
  id: string;
  platform: string;
  display_name: string | null;
  username: string | null;
  is_active: boolean;
}

export function BroadcastsView({
  broadcasts,
  workspaceId,
  channels,
  canSend,
}: {
  broadcasts: Broadcast[];
  workspaceId: string;
  channels: BroadcastChannel[];
  canSend: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const t = useT("broadcasts");
  const tc = useT("common");
  const format = useFormatter();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [items, setItems] = useState(broadcasts);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>(
    createEmptyFilter()
  );
  const [showSegmentFilter, setShowSegmentFilter] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Broadcast | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteFromList(b: Broadcast) {
    setDeleteError(null);
    const res = await fetch(`/api/v1/broadcasts/${b.id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.id !== b.id));
      return;
    }
    const data = await res.json().catch(() => ({}));
    setDeleteError(
      data.error === "cancel_first" ? t("errors.cancel_first") : t("errors.delete_failed")
    );
  }

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("broadcasts")
        .insert({
          workspace_id: workspaceId,
          name: newName.trim(),
          status: "draft",
          message_content: {},
          channel_id: channels[0]?.id ?? null,
          segment_filter: showSegmentFilter
            ? (segmentFilter as unknown as Json)
            : null,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setItems((prev) => [data, ...prev]);
        setNewName("");
        setShowCreate(false);
        setSelectedId(data.id);
      }
    } catch (err) {
      console.error("Failed to create broadcast:", err);
    } finally {
      setCreating(false);
    }
  }

  const selectedBroadcast = selectedId
    ? items.find((b) => b.id === selectedId) ?? null
    : null;

  if (selectedBroadcast) {
    return (
      <BroadcastDetail
        broadcast={selectedBroadcast}
        channels={channels}
        canSend={canSend}
        onBack={() => setSelectedId(null)}
        onUpdate={(updated) => {
          setItems((prev) =>
            prev.map((b) => (b.id === updated.id ? updated : b))
          );
        }}
        onDeleted={(id) => {
          setItems((prev) => prev.filter((b) => b.id !== id));
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("create")}
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="mt-4 rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder={t("namePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !showSegmentFilter) handleCreate();
                  if (e.key === "Escape") setShowCreate(false);
                }}
                autoFocus
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {creating ? tc("creating") : tc("create")}
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                  setShowSegmentFilter(false);
                  setSegmentFilter(createEmptyFilter());
                }}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                {tc("cancel")}
              </button>
            </div>

            {/* Targeting section */}
            <div>
              <button
                type="button"
                onClick={() => setShowSegmentFilter(!showSegmentFilter)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  showSegmentFilter
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                {t("target")}
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showSegmentFilter && "rotate-180"
                  )}
                />
              </button>

              {showSegmentFilter && (
                <div className="mt-3">
                  <SegmentBuilder
                    value={segmentFilter}
                    onChange={setSegmentFilter}
                    workspaceId={workspaceId}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Broadcast list */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Radio className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((broadcast) => {
              const status = statusConfig[broadcast.status];
              const StatusIcon = status.icon;
              const total = broadcast.total_recipients;

              const deletable =
                canSend && broadcast.status !== "sending" && broadcast.status !== "paused";

              return (
                <div key={broadcast.id} className="flex items-center pr-2 transition-colors hover:bg-accent/50 sm:pr-4">
                <button
                  onClick={() => setSelectedId(broadcast.id)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-3 px-4 py-3 text-left sm:px-8 sm:py-4 md:flex-row md:items-center md:gap-6"
                >
                  {/* Status + Name */}
                  <div className="min-w-0 w-full flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="truncate text-sm font-medium">
                        {broadcast.name}
                      </h3>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          status.className
                        )}
                      >
                        <StatusIcon
                          className={cn(
                            "h-3 w-3",
                            broadcast.status === "sending" && "animate-spin"
                          )}
                        />
                        {t(`status.${broadcast.status}`)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {broadcast.scheduled_for
                          ? formatDate(broadcast.scheduled_for, t, format)
                          : t("notScheduled")}
                      </span>
                      <span>
                        {t("createdAt", { date: formatDate(broadcast.created_at, t, format) })}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 md:gap-6">
                    <div className="text-center">
                      <p className="text-lg font-semibold">{total}</p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("recipients")}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-green-600">
                        {broadcast.sent}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("sent")}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-blue-600">
                        {broadcast.delivered}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("delivered")}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-red-600">
                        {broadcast.failed}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("failed")}
                      </p>
                    </div>
                  </div>
                </button>
                {deletable && (
                  <button
                    onClick={() => setDeleteTarget(broadcast)}
                    aria-label={t("deleteTitle")}
                    title={t("deleteTitle")}
                    className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                </div>
              );
            })}
          </div>
        )}
        {deleteError && (
          <p className="px-4 py-3 text-sm text-red-600 sm:px-8">{deleteError}</p>
        )}
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title={t("deleteTitle")}
        message={t("deleteMessage", { name: deleteTarget?.name ?? "" })}
        confirmLabel={tc("delete")}
        destructive
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) deleteFromList(target);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

type Preview = {
  problem: string | null;
  kind?: "freeform" | "template";
  total: number;
  eligible: number;
  skipped?: number;
  skippedByReason: Record<string, number>;
  confirmThreshold?: number;
  quietHours?: { start: string; end: string; timeZone: string } | null;
};

type RecipientRow = {
  id: string;
  name: string | null;
  status: string;
  reason: string | null;
  error: string | null;
};

const recipientStatusClass: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  sending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  sent: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  delivered: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  read: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  skipped: "bg-muted text-muted-foreground",
};

function channelLabel(c: BroadcastChannel) {
  const name = c.display_name || c.username || c.platform;
  const platform = c.platform === "whatsapp" ? "WhatsApp" : c.platform === "instagram" ? "Instagram" : c.platform;
  return `${platform} · ${name}`;
}

function BroadcastDetail({
  broadcast,
  channels,
  canSend,
  onBack,
  onUpdate,
  onDeleted,
}: {
  broadcast: Broadcast;
  channels: BroadcastChannel[];
  canSend: boolean;
  onBack: () => void;
  onUpdate: (updated: Broadcast) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useT("broadcasts");
  const tc = useT("common");
  const format = useFormatter();

  const messageContent = broadcast.message_content as { text?: string } | null;
  const [messageText, setMessageText] = useState(messageContent?.text || "");
  const [channelId, setChannelId] = useState(broadcast.channel_id ?? channels[0]?.id ?? "");
  const [template, setTemplate] = useState<Record<string, unknown>>(
    (broadcast.template as Record<string, unknown> | null) ?? {}
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [testTarget, setTestTarget] = useState("");
  const [testing, setTesting] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [recipientFilter, setRecipientFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDraft = broadcast.status === "draft" || broadcast.status === "scheduled";
  const isRunning = broadcast.status === "sending" || broadcast.status === "paused";
  const status = statusConfig[broadcast.status];
  const StatusIcon = status.icon;
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const isWhatsApp = channel?.platform === "whatsapp";

  const reasonLabel = (r: string | null | undefined) => (r ? t(`reasons.${r}`) : "");
  const errorLabel = (code: string, extra?: Record<string, unknown>) => {
    const key = `errors.${code}`;
    const label = t(key, extra as Record<string, string | number> | undefined);
    return label.endsWith(key) ? code : label;
  };

  // Draft changes invalidate the last preview.
  useEffect(() => {
    setPreview(null);
    setConfirmText("");
  }, [channelId, messageText, template]);

  async function saveDraft(): Promise<Broadcast | null> {
    const supabase = createClient();
    const tpl =
      isWhatsApp && template.templateName
        ? {
            templateName: template.templateName,
            templateLanguage: template.templateLanguage,
            params: template.params ?? [],
            templateBody: template.templateBody ?? "",
          }
        : null;
    const { data, error: err } = await supabase
      .from("broadcasts")
      .update({
        channel_id: channelId || null,
        message_content: { text: messageText.trim() } as unknown as Json,
        template: tpl as unknown as Json,
      })
      .eq("id", broadcast.id)
      .select()
      .single();
    if (err) {
      setError(err.message || t("saveFailed"));
      return null;
    }
    if (data) onUpdate(data);
    return data;
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const saved = await saveDraft();
    if (saved) setSuccess(tc("saved"));
    setBusy(false);
  }

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setSuccess(null);
    try {
      if (!(await saveDraft())) return;
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/preview`);
      const data = (await res.json()) as Preview & { error?: string };
      if (!res.ok) throw new Error(data.error || t("sendFailed"));
      setPreview(data);
      if (data.problem) setError(errorLabel(data.problem));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function handleTest() {
    if (!testTarget.trim()) return;
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      if (!(await saveDraft())) return;
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: testTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.reason ? ` — ${reasonLabel(data.reason)}` : data.detail ? ` — ${data.detail}` : "";
        throw new Error(`${errorLabel(data.error)}${detail}`);
      }
      setSuccess(t("testSent", { name: data.contact || testTarget }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setTesting(false);
    }
  }

  const needsConfirm = !!preview && preview.eligible > (preview.confirmThreshold ?? 50);
  const confirmOk = !needsConfirm || Number(confirmText) === preview?.eligible;

  async function handleSend(schedule: boolean) {
    if (!preview || preview.problem || preview.eligible === 0 || !confirmOk) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmCount: preview.eligible,
          scheduleAt: schedule && scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errorLabel(data.error, data));
      if (data.status === "scheduled") {
        setSuccess(t("scheduledFor", { date: formatDate(data.scheduledFor, t, format), count: data.eligible }));
        onUpdate({ ...broadcast, status: "scheduled", scheduled_for: data.scheduledFor });
      } else {
        setSuccess(t("sendingTo", { count: data.totalRecipients }));
        onUpdate({ ...broadcast, status: "sending", total_recipients: data.totalRecipients });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const canDelete = canSend && !isRunning;

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(errorLabel(data.error ?? "delete_failed"));
        return;
      }
      onDeleted(broadcast.id);
    } finally {
      setBusy(false);
    }
  }

  async function control(action: "pause" | "resume" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errorLabel(data.error));
      onUpdate(data as Broadcast);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const loadRecipients = useCallback(async () => {
    const qs = recipientFilter ? `?status=${recipientFilter}` : "";
    const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/recipients${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    setRecipients(data.recipients ?? []);
    if (data.broadcast) onUpdate(data.broadcast as Broadcast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast.id, recipientFilter]);

  useEffect(() => {
    if (isDraft) return;
    loadRecipients();
    if (broadcast.status !== "sending") return;
    const timer = setInterval(loadRecipients, 10000);
    return () => clearInterval(timer);
  }, [isDraft, broadcast.status, loadRecipients]);

  const stats = [
    { label: t("recipients"), value: broadcast.total_recipients, cls: "" },
    { label: t("sent"), value: broadcast.sent, cls: "text-green-600" },
    { label: t("delivered"), value: broadcast.delivered, cls: "text-blue-600" },
    { label: t("read"), value: broadcast.read, cls: "text-indigo-600" },
    { label: t("failed"), value: broadcast.failed, cls: "text-red-600" },
    { label: t("skipped"), value: broadcast.skipped, cls: "text-muted-foreground" },
  ];

  const inputCls =
    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-xl font-bold sm:text-2xl">{broadcast.name}</h1>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  status.className
                )}
              >
                <StatusIcon className={cn("h-3.5 w-3.5", broadcast.status === "sending" && "animate-spin")} />
                {t(`status.${broadcast.status}`)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {broadcast.status === "scheduled" && broadcast.scheduled_for
                ? t("scheduledShort", { date: formatDate(broadcast.scheduled_for, t, format) })
                : t("createdAt", { date: formatDate(broadcast.created_at, t, format) })}
            </p>
          </div>
          {canSend && isRunning && (
            <div className="flex items-center gap-2">
              {broadcast.status === "sending" ? (
                <button
                  onClick={() => control("pause")}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <Pause className="h-4 w-4" />
                  {t("pause")}
                </button>
              ) : (
                <button
                  onClick={() => control("resume")}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {t("resume")}
                </button>
              )}
              <button
                onClick={() => control("cancel")}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-900/20"
              >
                <XCircle className="h-4 w-4" />
                {t("cancelSend")}
              </button>
            </div>
          )}
          {canSend && broadcast.status === "scheduled" && (
            <button
              onClick={() => control("cancel")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-900/20"
            >
              <XCircle className="h-4 w-4" />
              {t("cancelSchedule")}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              title={t("deleteTitle")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:border-red-900 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{tc("delete")}</span>
            </button>
          )}
          <ConfirmDialog
            open={confirmDelete}
            title={t("deleteTitle")}
            message={t("deleteMessage", { name: broadcast.name })}
            confirmLabel={tc("delete")}
            destructive
            onConfirm={() => {
              setConfirmDelete(false);
              handleDelete();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {!isDraft && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {stats.map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
                  <p className={cn("text-xl font-bold", s.cls)}>{s.value}</p>
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Channel */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("channel")}</label>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noChannels")}</p>
            ) : (
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={!isDraft}
                className={inputCls}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {channelLabel(c)}
                  </option>
                ))}
              </select>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              {isWhatsApp ? (
                <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AtSign className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              {isWhatsApp ? t("whatsappRule") : t("instagramRule")}
            </p>
          </div>

          {/* Content: text (Instagram) or template (WhatsApp) */}
          {isWhatsApp ? (
            <div className={cn("rounded-lg border border-border bg-card p-4", !isDraft && "pointer-events-none opacity-70")}>
              <SendWhatsAppTemplatePanel
                audience
                data={{ ...template, channelId }}
                onChange={(next) => setTemplate(next)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("message")}</label>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                disabled={!isDraft}
                placeholder={t("messagePlaceholder")}
                rows={6}
                className={cn(inputCls, "px-4 py-3")}
              />
              <p className="text-xs text-muted-foreground">{t("variablesHint")}</p>
            </div>
          )}

          {broadcast.segment_filter && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="h-4 w-4 text-muted-foreground" />
                {t("segmentApplied")}
              </div>
              <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(broadcast.segment_filter, null, 2)}
              </pre>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          {isDraft && canSend && (
            <>
              {/* 1. Audience preview */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    {t("audienceTitle")}
                  </div>
                  <button
                    onClick={handleCheck}
                    disabled={checking || !channelId}
                    className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    {checking && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t("checkAudience")}
                  </button>
                </div>
                {preview && !preview.problem && (
                  <div className="space-y-2 text-sm">
                    <p>
                      {t("audienceSummary", { eligible: preview.eligible, total: preview.total })}
                    </p>
                    {Object.keys(preview.skippedByReason).length > 0 && (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {Object.entries(preview.skippedByReason)
                          .sort((a, b) => b[1] - a[1])
                          .map(([reason, n]) => (
                            <li key={reason}>
                              {n} · {reasonLabel(reason)}
                            </li>
                          ))}
                      </ul>
                    )}
                    {preview.quietHours && (
                      <p className="text-xs text-muted-foreground">
                        {t("quietHoursNote", { start: preview.quietHours.start, end: preview.quietHours.end })}
                      </p>
                    )}
                  </div>
                )}
                {!preview && <p className="text-xs text-muted-foreground">{t("audienceHint")}</p>}
              </div>

              {/* 2. Test */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FlaskConical className="h-4 w-4 text-muted-foreground" />
                  {t("testTitle")}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={testTarget}
                    onChange={(e) => setTestTarget(e.target.value)}
                    placeholder={isWhatsApp ? t("testPlaceholderPhone") : t("testPlaceholderUser")}
                    className={inputCls}
                  />
                  <button
                    onClick={handleTest}
                    disabled={testing || !testTarget.trim() || !channelId}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t("sendTest")}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{isWhatsApp ? t("testHintPhone") : t("testHintUser")}</p>
              </div>

              {/* 3. Send */}
              {preview && !preview.problem && preview.eligible > 0 && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  {needsConfirm && (
                    <div>
                      <label className="text-sm font-medium">
                        {t("confirmLabel", { count: preview.eligible })}
                      </label>
                      <input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        placeholder={String(preview.eligible)}
                        className={cn(inputCls, "mt-1.5 max-w-[160px]")}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-3">
                    <button
                      onClick={() => handleSend(false)}
                      disabled={busy || !confirmOk}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {t("sendToCount", { count: preview.eligible })}
                    </button>
                    <div className="flex items-end gap-2">
                      <input
                        type="datetime-local"
                        value={scheduleAt}
                        onChange={(e) => setScheduleAt(e.target.value)}
                        className={cn(inputCls, "w-auto")}
                      />
                      <button
                        onClick={() => handleSend(true)}
                        disabled={busy || !confirmOk || !scheduleAt}
                        className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm hover:bg-accent disabled:opacity-50"
                      >
                        <Calendar className="h-4 w-4" />
                        {t("schedule")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <button
                  onClick={handleSave}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                >
                  {t("saveDraft")}
                </button>
              </div>
            </>
          )}

          {isDraft && !canSend && <p className="text-sm text-muted-foreground">{t("onlyAdmins")}</p>}

          {/* Recipients */}
          {!isDraft && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("recipientsTitle")}</h2>
                <select
                  value={recipientFilter}
                  onChange={(e) => setRecipientFilter(e.target.value)}
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                >
                  <option value="">{t("allStatuses")}</option>
                  {["pending", "sent", "delivered", "read", "failed", "skipped"].map((s) => (
                    <option key={s} value={s}>
                      {t(`recipientStatus.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {recipients.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t("noRecipients")}</p>
                ) : (
                  recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{r.name || "—"}</p>
                        {(r.reason || r.error) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {r.reason ? reasonLabel(r.reason) : r.error}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          recipientStatusClass[r.status] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {t(`recipientStatus.${r.status}`)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
