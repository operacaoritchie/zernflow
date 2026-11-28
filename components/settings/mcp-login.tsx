"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, LogIn } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { updateMcpLoginSettings } from "@/lib/actions/mcp-login";
import type { LoginSettings } from "@/lib/mcp/login-settings";
import { SCOPES, type Scope } from "@/lib/mcp/scopes";

export interface LoginUsageView {
  userId: string;
  email: string | null;
  calls: number;
  failed: number;
  lastUsedAt: string;
}

/** Settings → MCP: the connection you make by signing in with your own account. */
export function McpLoginPanel({
  initial,
  usage,
  canManage,
}: {
  initial: LoginSettings;
  usage: LoginUsageView[];
  canManage: boolean;
}) {
  const t = useT("settings");
  const [s, setS] = useState<LoginSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = s.enabled !== initial.enabled || s.scopes.join() !== initial.scopes.join();

  function toggleScope(scope: Scope) {
    if (scope === "read") return;
    setS((prev) => ({
      ...prev,
      scopes: SCOPES.filter((x) => x === "read" || (x === scope ? !prev.scopes.includes(x) : prev.scopes.includes(x))),
    }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const result = await updateMcpLoginSettings(s);
    setSaving(false);
    if ("error" in result && result.error) setMessage({ ok: false, text: result.error });
    else setMessage({ ok: true, text: t("mcp.login.saved") });
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <LogIn className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t("mcp.login.title")}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("mcp.login.hint")}</p>

      {!canManage ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("mcp.adminsOnly")}</p>
      ) : (
        <>
          <label className="mt-4 flex items-start gap-3">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => setS({ ...s, enabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <span className="block text-sm font-medium">{t("mcp.login.enabled")}</span>
              <span className="block text-xs text-muted-foreground">{t("mcp.login.enabledHint")}</span>
            </span>
          </label>

          <fieldset disabled={!s.enabled} className="mt-4 disabled:opacity-60">
            <legend className="text-sm font-medium">{t("mcp.login.scopesLabel")}</legend>
            <div className="mt-2 space-y-2">
              {SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={s.scopes.includes(scope)}
                    disabled={scope === "read"}
                    onChange={() => toggleScope(scope)}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    <span className="block text-sm font-medium">{t(`mcp.scope.${scope}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`mcp.scopeHint.${scope}`)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("mcp.login.roleNote")}</p>
          </fieldset>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("mcp.login.save")}
            </button>
            {message && (
              <span className={`inline-flex items-center gap-1 text-xs ${message.ok ? "text-green-600" : "text-red-600"}`}>
                {message.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {message.text}
              </span>
            )}
          </div>
        </>
      )}

      <div className="mt-5">
        <h4 className="text-xs font-semibold text-muted-foreground">{t("mcp.login.usageTitle")}</h4>
        {usage.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("mcp.login.usageEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {usage.map((u) => (
              <li key={u.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <p className="min-w-0 truncate text-sm font-medium">{u.email ?? u.userId.slice(0, 8)}</p>
                <p className="shrink-0 text-xs text-muted-foreground">
                  {t("mcp.login.usageRow", { calls: u.calls, when: new Date(u.lastUsedAt).toLocaleString() })}
                  {u.failed > 0 ? ` · ${t("mcp.login.usageFailed", { failed: u.failed })}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t("mcp.login.disconnectNote")}</p>
      </div>
    </div>
  );
}
