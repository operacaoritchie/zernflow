"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";

interface Channel {
  id: string;
  platform: string;
  display_name: string | null;
  username: string | null;
  is_active: boolean;
}

interface Template {
  id: string;
  name: string;
  language: string;
  body: string;
  header: string | null;
  paramCount: number;
}

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelCls = "mb-1.5 block text-xs font-semibold text-foreground";

export function SendWhatsAppTemplatePanel({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const t = useT("builder");
  const channelId = (data.channelId as string) || "";
  const templateName = (data.templateName as string) || "";
  const templateLanguage = (data.templateLanguage as string) || "";
  const phone = (data.phone as string) ?? "";
  const params = useMemo(() => (Array.isArray(data.params) ? (data.params as string[]) : []), [data.params]);

  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/channels")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Channel[]) => {
        if (cancelled) return;
        const whatsapp = (Array.isArray(list) ? list : []).filter(
          (c) => c.platform === "whatsapp" && c.is_active
        );
        setChannels(whatsapp);
        if (!channelId && whatsapp.length === 1) onChange({ ...data, channelId: whatsapp[0].id });
      })
      .catch(() => !cancelled && setChannels([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoadingTemplates(true);
    setTemplatesError(null);
    fetch(`/api/v1/whatsapp/templates?channelId=${channelId}&status=APPROVED`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || t("wa.loadFailed"));
        return json.templates as Template[];
      })
      .then((list) => !cancelled && setTemplates(list))
      .catch((err) => !cancelled && setTemplatesError(err instanceof Error ? err.message : t("wa.loadFailed")))
      .finally(() => !cancelled && setLoadingTemplates(false));
    return () => {
      cancelled = true;
    };
  }, [channelId, reloadKey, t]);

  const selectedKey = templateName ? `${templateName}::${templateLanguage}` : "";
  const selected = templates?.find((tpl) => `${tpl.name}::${tpl.language}` === selectedKey);
  const paramCount = selected?.paramCount ?? params.length;

  function selectTemplate(key: string) {
    const tpl = templates?.find((x) => `${x.name}::${x.language}` === key);
    if (!tpl) {
      onChange({ ...data, templateName: "", templateLanguage: "", params: [], templateBody: "" });
      return;
    }
    onChange({
      ...data,
      templateName: tpl.name,
      templateLanguage: tpl.language,
      templateBody: [tpl.header, tpl.body].filter(Boolean).join("\n"),
      params: Array.from({ length: tpl.paramCount }, (_, i) => params[i] ?? ""),
    });
  }

  function setParam(index: number, value: string) {
    const next = Array.from({ length: paramCount }, (_, i) => params[i] ?? "");
    next[index] = value;
    onChange({ ...data, params: next });
  }

  if (channels !== null && channels.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("wa.noChannel")}</p>
        <Link href="/dashboard/channels" className="text-primary underline">
          {t("wa.goChannels")}
        </Link>
      </div>
    );
  }

  const preview = (data.templateBody as string) || "";

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{t("wa.description")}</p>

      {channels && channels.length > 1 && (
        <div>
          <label className={labelCls}>{t("wa.number")}</label>
          <select
            value={channelId}
            onChange={(e) =>
              onChange({ ...data, channelId: e.target.value, templateName: "", templateLanguage: "", params: [] })
            }
            className={inputCls}
          >
            <option value="">{t("wa.selectNumber")}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.username || "WhatsApp"}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">{t("wa.template")}</label>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={t("wa.reload")}
            title={t("wa.reload")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingTemplates && "animate-spin")} />
          </button>
        </div>
        {loadingTemplates && !templates ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("wa.loading")}
          </div>
        ) : (
          <select value={selectedKey} onChange={(e) => selectTemplate(e.target.value)} className={inputCls}>
            <option value="">{t("wa.selectTemplate")}</option>
            {selectedKey && !selected && (
              <option value={selectedKey}>
                {templateName} ({templateLanguage})
              </option>
            )}
            {(templates ?? []).map((tpl) => (
              <option key={tpl.id} value={`${tpl.name}::${tpl.language}`}>
                {tpl.name} ({tpl.language})
              </option>
            ))}
          </select>
        )}
        {templatesError && <p className="mt-1.5 text-xs text-destructive">{templatesError}</p>}
        {templates && templates.length === 0 && !templatesError && (
          <p className="mt-1.5 text-xs text-muted-foreground">{t("wa.noApproved")}</p>
        )}
        <Link href="/dashboard/whatsapp-templates" className="mt-1.5 inline-block text-[11px] text-primary underline">
          {t("wa.manage")}
        </Link>
      </div>

      {preview && (
        <div className="rounded-lg bg-[#e5ddd5] p-2.5 dark:bg-[#0b141a]">
          <p className="whitespace-pre-wrap rounded-md bg-white p-2.5 text-xs shadow-sm dark:bg-[#202c33] dark:text-gray-100">
            {preview}
          </p>
        </div>
      )}

      <div>
        <label className={labelCls}>{t("wa.phone")}</label>
        <input
          type="text"
          value={phone}
          onChange={(e) => onChange({ ...data, phone: e.target.value })}
          placeholder="{{telefone_vaga}}"
          className={inputCls}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">{t("wa.phoneHint")}</p>
      </div>

      {paramCount > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">{t("wa.variables")}</p>
          {Array.from({ length: paramCount }, (_, i) => (
            <div key={i}>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{`{{${i + 1}}}`}</label>
              <input
                type="text"
                value={params[i] ?? ""}
                onChange={(e) => setParam(i, e.target.value)}
                placeholder={i === 0 ? "{{contact_name}}" : ""}
                className={inputCls}
              />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">{t("wa.variablesHint")}</p>
        </div>
      )}

      <p className="rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">{t("wa.statusHint")}</p>
    </div>
  );
}
