"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  MessageCircle,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  X,
  TrendingUp,
  Send,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/lib/types/database";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { useT, useFormatter } from "@/lib/i18n/provider";
import { rich } from "@/lib/i18n/rich";
import type { Formatter, Translator } from "@/lib/i18n/translator";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
type CommentLog = Database["public"]["Tables"]["comment_logs"]["Row"];

interface TriggerWithFlow {
  id: string;
  flow_id: string;
  channel_id: string | null;
  type: string;
  config: Json;
  priority: number;
  is_active: boolean;
  created_at: string;
  flows: { id: string; name: string; status: string } | null;
}

interface TriggerConfig {
  keywords: Array<{
    value: string;
    matchType?: "exact" | "contains" | "startsWith";
  }>;
  postIds?: string[];
  replyText?: string;
}

export function GrowthView({
  workspaceId,
  channels,
  triggers: initialTriggers,
  flows,
  stats,
  recentLogs,
}: {
  workspaceId: string;
  channels: Channel[];
  triggers: TriggerWithFlow[];
  flows: Array<{ id: string; name: string }>;
  stats: {
    totalComments: number;
    matchedComments: number;
    dmsSent: number;
  };
  recentLogs: CommentLog[];
}) {
  const [triggers, setTriggers] = useState(initialTriggers);
  const t = useT("growth");
  const tb = useT("builder");
  const tc = useT("common");
  const format = useFormatter();
  const [showCreate, setShowCreate] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const createFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((showCreate || editingId) && createFormRef.current) {
      createFormRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showCreate, editingId]);

  // New rule form state
  const [form, setForm] = useState({
    channelId: channels[0]?.id || "",
    flowId: flows[0]?.id || "",
    keywords: "",
    matchType: "contains" as "exact" | "contains" | "startsWith",
    replyText: "",
    postIds: "",
  });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const conversionRate =
    stats.totalComments > 0
      ? ((stats.dmsSent / stats.totalComments) * 100).toFixed(1)
      : "0.0";

  async function handleToggle(trigger: TriggerWithFlow) {
    setTogglingId(trigger.id);
    const supabase = createClient();

    const { error } = await supabase
      .from("triggers")
      .update({ is_active: !trigger.is_active })
      .eq("id", trigger.id);

    if (!error) {
      setTriggers((prev) =>
        prev.map((t) =>
          t.id === trigger.id ? { ...t, is_active: !t.is_active } : t
        )
      );
    }
    setTogglingId(null);
  }

  async function handleDelete(triggerId: string) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(triggerId);
    const supabase = createClient();

    const { error } = await supabase
      .from("triggers")
      .delete()
      .eq("id", triggerId);

    if (!error) {
      setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
    }
    setDeletingId(null);
  }

  async function handleCreate() {
    if (!form.channelId || !form.flowId || !form.keywords.trim() || creating) {
      return;
    }

    setCreating(true);
    const supabase = createClient();

    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((value) => ({ value, matchType: form.matchType }));

    const config: TriggerConfig = {
      keywords,
      ...(form.replyText.trim() ? { replyText: form.replyText.trim() } : {}),
      ...(form.postIds.trim()
        ? {
            postIds: form.postIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          }
        : {}),
    };

    try {
      const { data, error } = await supabase
        .from("triggers")
        .insert({
          flow_id: form.flowId,
          channel_id: form.channelId,
          type: "comment_keyword" as const,
          config: config as unknown as Json,
          is_active: true,
          priority: 10,
        })
        .select("*, flows(id, name, status)")
        .single();

      if (error) throw error;

      if (data) {
        setTriggers((prev) => [
          data as unknown as TriggerWithFlow,
          ...prev,
        ]);
        setShowCreate(false);
        setForm({
          channelId: channels[0]?.id || "",
          flowId: flows[0]?.id || "",
          keywords: "",
          matchType: "contains",
          replyText: "",
          postIds: "",
        });
      }
    } catch (err) {
      console.error("Failed to create comment rule:", err);
    } finally {
      setCreating(false);
    }
  }

  function handleStartEdit(trigger: TriggerWithFlow) {
    const config = trigger.config as unknown as TriggerConfig;
    setEditingId(trigger.id);
    setShowCreate(false);
    setForm({
      channelId: trigger.channel_id || channels[0]?.id || "",
      flowId: trigger.flow_id,
      keywords: (config.keywords || []).map((k) => k.value).join(", "),
      matchType: config.keywords?.[0]?.matchType || "contains",
      replyText: config.replyText || "",
      postIds: (config.postIds || []).join(", "),
    });
  }

  async function handleSaveEdit() {
    if (!editingId || !form.channelId || !form.flowId || !form.keywords.trim() || saving) {
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((value) => ({ value, matchType: form.matchType }));

    const config: TriggerConfig = {
      keywords,
      ...(form.replyText.trim() ? { replyText: form.replyText.trim() } : {}),
      ...(form.postIds.trim()
        ? {
            postIds: form.postIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          }
        : {}),
    };

    try {
      const { data, error } = await supabase
        .from("triggers")
        .update({
          flow_id: form.flowId,
          channel_id: form.channelId,
          config: config as unknown as Json,
        })
        .eq("id", editingId)
        .select("*, flows(id, name, status)")
        .single();

      if (error) throw error;

      if (data) {
        setTriggers((prev) =>
          prev.map((t) =>
            t.id === editingId ? (data as unknown as TriggerWithFlow) : t
          )
        );
        setEditingId(null);
        setForm({
          channelId: channels[0]?.id || "",
          flowId: flows[0]?.id || "",
          keywords: "",
          matchType: "contains",
          replyText: "",
          postIds: "",
        });
      }
    } catch (err) {
      console.error("Failed to update comment rule:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleCancelForm() {
    setShowCreate(false);
    setEditingId(null);
    setForm({
      channelId: channels[0]?.id || "",
      flowId: flows[0]?.id || "",
      keywords: "",
      matchType: "contains",
      replyText: "",
      postIds: "",
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <button
            onClick={() => { setEditingId(null); setShowCreate(true); }}
            disabled={channels.length === 0 || flows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t("newRule")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-8">
        {/* Stats cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("statProcessed")}
            value={stats.totalComments}
            icon={<Eye className="h-4 w-4" />}
            sublabel={t("last30")}
          />
          <StatCard
            label={t("statMatched")}
            value={stats.matchedComments}
            icon={<MessageCircle className="h-4 w-4" />}
            sublabel={t("last30")}
          />
          <StatCard
            label={t("statDms")}
            value={stats.dmsSent}
            icon={<Send className="h-4 w-4" />}
            sublabel={t("last30")}
          />
          <StatCard
            label={t("statConversion")}
            value={`${conversionRate}%`}
            icon={<TrendingUp className="h-4 w-4" />}
            sublabel={t("commentsToDms")}
          />
        </div>

        {/* Create / Edit form */}
        {(showCreate || editingId) && (
          <div ref={createFormRef} className="mt-6 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                {editingId ? t("editRule") : t("createRuleTitle")}
              </h2>
              <button
                onClick={handleCancelForm}
                className="rounded-md p-1 text-muted-foreground/60 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* Channel */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("channel")}
                </label>
                <select
                  value={form.channelId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, channelId: e.target.value }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.display_name || ch.username || ch.late_account_id} (
                      {PLATFORM_LABELS[ch.platform]})
                    </option>
                  ))}
                </select>
              </div>

              {/* Flow */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("responseFlow")}
                </label>
                <select
                  value={form.flowId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, flowId: e.target.value }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Keywords */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("keywords")}
                </label>
                <input
                  type="text"
                  value={form.keywords}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, keywords: e.target.value }))
                  }
                  placeholder={t("keywordsPlaceholder")}
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Match Type */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("matchType")}
                </label>
                <select
                  value={form.matchType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      matchType: e.target.value as
                        | "exact"
                        | "contains"
                        | "startsWith",
                    }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="contains">{tb("match.contains")}</option>
                  <option value="exact">{tb("match.exact")}</option>
                  <option value="startsWith">{tb("match.startsWith")}</option>
                </select>
              </div>

              {/* Public reply text (optional) */}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("publicReply")}
                </label>
                <input
                  type="text"
                  value={form.replyText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, replyText: e.target.value }))
                  }
                  placeholder={t("publicReplyPlaceholder")}
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  {t("publicReplyHint")}
                </p>
              </div>

              {/* Post IDs (optional) */}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("postIds")}
                </label>
                <input
                  type="text"
                  value={form.postIds}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, postIds: e.target.value }))
                  }
                  placeholder={t("postIdsPlaceholder")}
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  {t("postIdsHint")}
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={handleCancelForm}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                {tc("cancel")}
              </button>
              {editingId ? (
                <button
                  onClick={handleSaveEdit}
                  disabled={
                    !form.keywords.trim() || !form.channelId || !form.flowId || saving
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? tc("saving") : t("saveChanges")}
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={
                    !form.keywords.trim() || !form.channelId || !form.flowId || creating
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? tc("creating") : t("createRule")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {channels.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-input p-4 sm:p-8 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 text-lg font-semibold text-foreground">
              {t("needChannel")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("needChannelHint")}
            </p>
            <a
              href="/dashboard/channels"
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t("goChannels")}
            </a>
          </div>
        )}

        {flows.length === 0 && channels.length > 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-input p-4 sm:p-8 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 text-lg font-semibold text-foreground">
              {t("needFlow")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("needFlowHint")}
            </p>
            <Link
              href="/dashboard/flows"
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t("goFlows")}
            </Link>
          </div>
        )}

        {/* Active rules */}
        {triggers.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-foreground">
              {t("activeRules")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("activeRulesHint")}
            </p>

            <div className="mt-4 space-y-3">
              {triggers.map((trigger) => {
                const config = trigger.config as unknown as TriggerConfig;
                const channel = channels.find(
                  (c) => c.id === trigger.channel_id
                );
                return (
                  <div
                    key={trigger.id}
                    className={cn(
                      "rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm",
                      trigger.is_active
                        ? "border-border"
                        : "border-border/60 opacity-60"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                              trigger.is_active
                                ? "bg-green-100 text-green-700"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                trigger.is_active
                                  ? "bg-green-500"
                                  : "bg-muted-foreground"
                              )}
                            />
                            {trigger.is_active ? tc("active") : tc("paused")}
                          </span>

                          {channel && (
                            <span className="text-xs text-muted-foreground">
                              {channel.display_name ||
                                channel.username ||
                                PLATFORM_LABELS[channel.platform]}
                            </span>
                          )}

                          {!trigger.channel_id && (
                            <span className="text-xs text-muted-foreground">
                              {t("allChannels")}
                            </span>
                          )}
                        </div>

                        {/* Keywords */}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {config.keywords?.map((kw, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                            >
                              {kw.matchType === "exact" && "= "}
                              {kw.matchType === "startsWith" && "^ "}
                              {kw.value}
                            </span>
                          ))}
                        </div>

                        {/* Flow name */}
                        <p className="mt-2 text-xs text-muted-foreground">
                          {rich(t("flowLabel"), {
                            name: (
                              <span className="font-medium text-foreground">
                                {trigger.flows?.name || tc("unknown")}
                              </span>
                            ),
                          })}
                        </p>

                        {/* Reply text preview */}
                        {config.replyText && (
                          <p className="mt-1 text-xs text-muted-foreground/60">
                            {t("publicReplyPreview", { text: config.replyText })}
                          </p>
                        )}

                        {/* Post IDs */}
                        {config.postIds?.length ? (
                          <p className="mt-1 text-xs text-muted-foreground/60">
                            {t("limitedTo", { count: config.postIds.length })}
                          </p>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="ml-4 flex items-center gap-1">
                        <button
                          onClick={() => handleStartEdit(trigger)}
                          className="rounded-lg p-2 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                          title={t("editRuleTitle")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggle(trigger)}
                          disabled={togglingId === trigger.id}
                          className={cn(
                            "rounded-lg p-2 transition-colors",
                            trigger.is_active
                              ? "text-green-600 hover:bg-green-50"
                              : "text-muted-foreground/60 hover:bg-muted"
                          )}
                          title={
                            trigger.is_active ? t("pauseRule") : t("activateRule")
                          }
                        >
                          {trigger.is_active ? (
                            <Power className="h-4 w-4" />
                          ) : (
                            <PowerOff className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(trigger.id)}
                          disabled={deletingId === trigger.id}
                          className="rounded-lg p-2 text-muted-foreground/60 transition-colors hover:bg-red-50 hover:text-red-600"
                          title={t("deleteRule")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent activity log */}
        {recentLogs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-foreground">
              {t("recent")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("recentHint")}
            </p>

            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      {t("author")}
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      {t("comment")}
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      {t("matched")}
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      {t("dm")}
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      {t("time")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">
                          {log.author_name || log.author_username || tc("unknown")}
                        </p>
                        {log.author_username && (
                          <p className="text-xs text-muted-foreground/60">
                            @{log.author_username}
                          </p>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-sm text-foreground">
                        {log.comment_text}
                      </td>
                      <td className="px-4 py-3">
                        {log.matched_trigger_id ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                            {tb("yes")}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {tb("no")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.dm_sent ? (
                          <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                            {t("sent")}
                          </span>
                        ) : log.error ? (
                          <span
                            className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700"
                            title={log.error}
                          >
                            {tc("error")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">
                            --
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground/60">
                        {formatRelativeTime(log.created_at, t, format)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sublabel,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  sublabel: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="text-muted-foreground/60">{icon}</div>
      </div>
      <p className="mt-2 text-3xl font-bold text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        {sublabel}
      </p>
    </div>
  );
}

function formatRelativeTime(dateStr: string, t: Translator, format: Formatter): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return t("justNow");
  if (diffMin < 60) return format.relative(-diffMin, "minute");

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return format.relative(-diffHour, "hour");

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return format.relative(-diffDay, "day");

  return format.date(dateStr, {
    month: "short",
    day: "numeric",
  });
}
