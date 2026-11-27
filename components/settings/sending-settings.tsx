"use client";

import { useState } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { updateSendingSettings } from "@/lib/actions/sending-settings";
import type { SendingSettings } from "@/lib/workspace-settings";

const inputCls =
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Settings → Sending: rules for broadcasts and sequences. */
export function SendingSettingsSection({
  initial,
  canEdit,
}: {
  initial: SendingSettings;
  canEdit: boolean;
}) {
  const t = useT("settings");
  const [s, setS] = useState<SendingSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const quiet = s.quietHours;

  async function save() {
    setSaving(true);
    setMessage(null);
    const result = await updateSendingSettings(s);
    setSaving(false);
    if ("error" in result && result.error) setMessage({ ok: false, text: result.error });
    else setMessage({ ok: true, text: t("saved") });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("sending.title")}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("sending.hint")}</p>

      <fieldset disabled={!canEdit} className="mt-4 space-y-5 disabled:opacity-70">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.bulkSendingEnabled}
            onChange={(e) => setS({ ...s, bulkSendingEnabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            <span className="block text-sm font-medium">{t("sending.bulkEnabled")}</span>
            <span className="block text-xs text-muted-foreground">{t("sending.bulkEnabledHint")}</span>
          </span>
        </label>

        <div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!quiet}
              onChange={(e) =>
                setS({
                  ...s,
                  quietHours: e.target.checked ? { start: "08:00", end: "20:00", timeZone: "America/Fortaleza" } : null,
                })
              }
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <span className="block text-sm font-medium">{t("sending.quietHours")}</span>
              <span className="block text-xs text-muted-foreground">{t("sending.quietHoursHint")}</span>
            </span>
          </label>
          {quiet && (
            <div className="mt-3 grid grid-cols-2 gap-3 pl-7 sm:grid-cols-3">
              <div>
                <span className="text-xs font-medium text-muted-foreground">{t("sending.from")}</span>
                <input
                  type="time"
                  value={quiet.start}
                  onChange={(e) => setS({ ...s, quietHours: { ...quiet, start: e.target.value } })}
                  className={inputCls}
                />
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground">{t("sending.to")}</span>
                <input
                  type="time"
                  value={quiet.end}
                  onChange={(e) => setS({ ...s, quietHours: { ...quiet, end: e.target.value } })}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-xs font-medium text-muted-foreground">{t("sending.timeZone")}</span>
                <input
                  type="text"
                  value={quiet.timeZone}
                  onChange={(e) => setS({ ...s, quietHours: { ...quiet, timeZone: e.target.value } })}
                  className={inputCls}
                />
              </div>
            </div>
          )}
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={s.requireWhatsAppConsent}
            onChange={(e) => setS({ ...s, requireWhatsAppConsent: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            <span className="block text-sm font-medium">{t("sending.requireConsent")}</span>
            <span className="block text-xs text-muted-foreground">{t("sending.requireConsentHint")}</span>
          </span>
        </label>

        <div>
          <span className="text-sm font-medium">{t("sending.confirmThreshold")}</span>
          <input
            type="number"
            min={1}
            value={s.confirmThreshold}
            onChange={(e) => setS({ ...s, confirmThreshold: Math.max(1, Number(e.target.value) || 1) })}
            className={`${inputCls} max-w-[140px]`}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("sending.confirmThresholdHint")}</p>
        </div>

        <div>
          <span className="text-sm font-medium">{t("sending.optOutReply")}</span>
          <textarea
            value={s.optOutReply}
            onChange={(e) => setS({ ...s, optOutReply: e.target.value })}
            rows={2}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("sending.optOutReplyHint")}</p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("sending.save")}
            </button>
            {message && (
              <span className={`inline-flex items-center gap-1.5 text-xs ${message.ok ? "text-success" : "text-destructive"}`}>
                {message.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {message.text}
              </span>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}
