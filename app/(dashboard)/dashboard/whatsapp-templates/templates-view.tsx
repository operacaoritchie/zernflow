"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Plus, RefreshCw, X, AlertTriangle, Braces } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";

interface ChannelOption {
  id: string;
  label: string;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  reason: string | null;
  body: string;
  header: string | null;
  footer: string | null;
  paramCount: number;
}

const LANGUAGES = ["pt_BR", "en_US", "en", "es", "es_MX", "es_AR"] as const;
const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const KNOWN_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "IN_APPEAL",
  "PAUSED",
  "DISABLED",
  "PENDING_DELETION",
];

const statusClasses: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  IN_APPEAL: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  DISABLED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  PAUSED: "bg-muted text-muted-foreground",
  PENDING_DELETION: "bg-muted text-muted-foreground",
};

function placeholders(text: string): string[] {
  return [...new Set(text.match(/\{\{\s*\w+\s*\}\}/g) ?? [])];
}

function nextPlaceholder(text: string): string {
  const used = (text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));
  return `{{${(used.length ? Math.max(...used) : 0) + 1}}}`;
}

function fillExamples(text: string, examples: string[]): string {
  const list = placeholders(text);
  return list.reduce((acc, ph, i) => acc.split(ph).join(examples[i] || ph), text);
}

export function WhatsAppTemplatesView({
  channels,
  hasApiKey,
}: {
  channels: ChannelOption[];
  hasApiKey: boolean;
}) {
  const t = useT("waTemplates");
  const tc = useT("common");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/whatsapp/templates?channelId=${channelId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("loadFailed"));
      setTemplates(data.templates ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [channelId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const statusLabel = (status: string) =>
    KNOWN_STATUSES.includes(status) ? t(`status.${status}`) : status;

  if (!hasApiKey || channels.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header t={t} />
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">{t("needWhatsApp")}</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{t("needWhatsAppHint")}</p>
          <Link
            href="/dashboard/channels"
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("goChannels")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header t={t}>
        <div className="flex items-center gap-3">
          {channels.length > 1 && (
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label={t("number")}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("refresh")}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("new")}
          </button>
        </div>
      </Header>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            {t("explainer")}
          </div>

          {showForm && (
            <TemplateForm
              channelId={channelId}
              onCancel={() => setShowForm(false)}
              onCreated={(tpl) => {
                setShowForm(false);
                setTemplates((prev) => [tpl, ...prev.filter((p) => p.id !== tpl.id)]);
              }}
            />
          )}

          {loadError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          {loading && templates.length === 0 ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 && !loadError ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">{t("empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("emptyHint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{tpl.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {tpl.language}
                    </span>
                    {tpl.category && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {CATEGORIES.includes(tpl.category as (typeof CATEGORIES)[number])
                          ? t(`category.${tpl.category}`)
                          : tpl.category}
                      </span>
                    )}
                    <span
                      className={cn(
                        "ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        statusClasses[tpl.status] ?? "bg-muted text-muted-foreground"
                      )}
                    >
                      {statusLabel(tpl.status)}
                    </span>
                  </div>
                  {tpl.header && <p className="mt-3 text-sm font-semibold">{tpl.header}</p>}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{tpl.body}</p>
                  {tpl.footer && <p className="mt-2 text-xs text-muted-foreground">{tpl.footer}</p>}
                  {tpl.paramCount > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("variablesCount", { count: tpl.paramCount })}
                    </p>
                  )}
                  {tpl.reason && (tpl.status === "REJECTED" || tpl.status === "PAUSED" || tpl.status === "DISABLED") && (
                    <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
                      {t("reason", { reason: tpl.reason })}
                    </p>
                  )}
                  {tpl.status === "PENDING" && (
                    <p className="mt-3 text-xs text-muted-foreground">{t("pendingHint")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="sr-only">{tc("loading")}</span>
    </div>
  );
}

function Header({
  t,
  children,
}: {
  t: ReturnType<typeof useT>;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function TemplateForm({
  channelId,
  onCancel,
  onCreated,
}: {
  channelId: string;
  onCancel: () => void;
  onCreated: (tpl: Template) => void;
}) {
  const t = useT("waTemplates");
  const tc = useT("common");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("MARKETING");
  const [language, setLanguage] = useState<string>("pt_BR");
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [headerExamples, setHeaderExamples] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyVars = useMemo(() => placeholders(body), [body]);
  const headerVars = useMemo(() => placeholders(header), [header]);
  const normalizedName = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "");

  function insertVariable() {
    const ph = nextPlaceholder(body);
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + ph);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + ph + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + ph.length, start + ph.length);
    });
  }

  const missingExamples =
    bodyVars.some((_, i) => !bodyExamples[i]?.trim()) ||
    headerVars.some((_, i) => !headerExamples[i]?.trim());
  const canSubmit = !!normalizedName && !!body.trim() && !missingExamples && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          name: normalizedName,
          category,
          language,
          header,
          body,
          footer,
          bodyExamples: bodyVars.map((_, i) => bodyExamples[i] ?? ""),
          headerExamples: headerVars.map((_, i) => headerExamples[i] ?? ""),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const known = ["invalid_name", "invalid_body", "invalid_header", "invalid_footer", "examples_required"];
        throw new Error(known.includes(data.error) ? t(`errors.${data.error}`) : data.error || t("createFailed"));
      }
      onCreated(data.template);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "text-xs font-medium text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("formTitle")}</h2>
        <button onClick={onCancel} aria-label={tc("close")} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t("name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="convite_vaga_curso" className={inputCls} />
            {normalizedName && normalizedName !== name && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("nameSavedAs", { name: normalizedName })}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t("categoryLabel")}</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])} className={inputCls}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`category.${c}`)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">{t(`categoryHint.${category}`)}</p>
            </div>
            <div>
              <label className={labelCls}>{t("language")}</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`languages.${l}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>{t("header")}</label>
            <input value={header} maxLength={60} onChange={(e) => setHeader(e.target.value)} className={inputCls} />
          </div>
          {headerVars.map((ph, i) => (
            <div key={`h${ph}`}>
              <label className={labelCls}>{t("exampleFor", { var: ph })}</label>
              <input
                value={headerExamples[i] ?? ""}
                onChange={(e) => {
                  const next = [...headerExamples];
                  next[i] = e.target.value;
                  setHeaderExamples(next);
                }}
                className={inputCls}
              />
            </div>
          ))}

          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>{t("body")}</label>
              <button
                type="button"
                onClick={insertVariable}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              >
                <Braces className="h-3 w-3" />
                {t("addVariable")}
              </button>
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              maxLength={1024}
              rows={6}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("bodyPlaceholder")}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("bodyHint")}</p>
          </div>

          {bodyVars.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("examplesHint")}</p>
              {bodyVars.map((ph, i) => (
                <div key={`b${ph}`}>
                  <label className={labelCls}>{t("exampleFor", { var: ph })}</label>
                  <input
                    value={bodyExamples[i] ?? ""}
                    onChange={(e) => {
                      const next = [...bodyExamples];
                      next[i] = e.target.value;
                      setBodyExamples(next);
                    }}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className={labelCls}>{t("footer")}</label>
            <input value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <p className={labelCls}>{t("preview")}</p>
          <div className="mt-1.5 rounded-xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
            <div className="rounded-lg bg-white p-3 text-sm shadow-sm dark:bg-[#202c33] dark:text-gray-100">
              {header && <p className="mb-1 font-semibold">{fillExamples(header, headerExamples)}</p>}
              <p className="whitespace-pre-wrap">{body ? fillExamples(body, bodyExamples) : t("previewEmpty")}</p>
              {footer && <p className="mt-1 text-xs text-gray-500">{footer}</p>}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          {tc("cancel")}
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? t("submitting") : t("submit")}
        </button>
      </div>
    </div>
  );
}
