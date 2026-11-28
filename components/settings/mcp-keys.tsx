"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, Loader2, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { SCOPES, type Scope } from "@/lib/mcp/scopes";
import type { LoginSettings } from "@/lib/mcp/login-settings";
import { McpLoginPanel, type LoginUsageView } from "./mcp-login";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

const inputCls =
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const EXPIRY_DAYS = { never: null, d30: 30, d90: 90 } as const;
type ExpiryChoice = keyof typeof EXPIRY_DAYS;

/** Settings → MCP access: create, list and revoke scoped API keys. */
export function McpKeysSection({
  canManage,
  login,
  loginUsage,
}: {
  canManage: boolean;
  login: LoginSettings;
  loginUsage: LoginUsageView[];
}) {
  const t = useT("settings");
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [expiry, setExpiry] = useState<ExpiryChoice>("never");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/api-keys");
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: ApiKeyRow[] };
      setKeys(body.data);
    } catch {
      setError(t("mcp.loadFailed"));
      setKeys([]);
    }
  }, [t]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  function toggleScope(scope: Scope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function create() {
    if (!name.trim() || scopes.length === 0) return;
    setBusy(true);
    setError(null);
    const days = EXPIRY_DAYS[expiry];
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { key: string };
      setCreated(body.key);
      setCopied(false);
      setName("");
      await load();
    } catch {
      setError(t("mcp.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(t("mcp.revokeConfirm"))) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError(t("mcp.revokeFailed"));
    }
  }

  async function copyKey() {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    setCopied(true);
  }

  function status(k: ApiKeyRow): string | null {
    if (k.revoked_at) return t("mcp.statusRevoked");
    if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) return t("mcp.statusExpired");
    return null;
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("mcp.title")}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("mcp.hint")}</p>

      <div className="mt-3">
        <span className="text-xs font-medium text-muted-foreground">{t("mcp.serverUrl")}</span>
        <code className="mt-1 block break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs">
          {origin}/api/mcp
        </code>
      </div>

      <McpLoginPanel initial={login} usage={loginUsage} canManage={canManage} />

      <h3 className="mt-6 text-sm font-semibold">{t("mcp.keysTitle")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("mcp.keysHint")}</p>

      {!canManage ? (
        <p className="mt-4 text-xs text-muted-foreground">{t("mcp.adminsOnly")}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="mcp-key-name">
              {t("mcp.nameLabel")}
            </label>
            <input
              id="mcp-key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("mcp.namePlaceholder")}
              className={inputCls}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">{t("mcp.scopesLabel")}</legend>
            <div className="mt-2 space-y-2">
              {SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    <span className="block text-sm font-medium">{t(`mcp.scope.${scope}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`mcp.scopeHint.${scope}`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="text-sm font-medium" htmlFor="mcp-key-expiry">
              {t("mcp.expiresLabel")}
            </label>
            <select
              id="mcp-key-expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
              className={inputCls}
            >
              {(Object.keys(EXPIRY_DAYS) as ExpiryChoice[]).map((c) => (
                <option key={c} value={c}>
                  {t(`mcp.expires.${c}`)}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={create}
            disabled={busy || !name.trim() || scopes.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? t("mcp.creating") : t("mcp.create")}
          </button>
        </div>
      )}

      {created && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-semibold">{t("mcp.createdTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("mcp.createdHint")}</p>
          <code className="mt-2 block break-all rounded border border-border bg-background px-3 py-2 text-xs">
            {created}
          </code>
          <div className="mt-2 flex gap-2">
            <button
              onClick={copyKey}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("mcp.copied") : t("mcp.copy")}
            </button>
            <button
              onClick={() => setCreated(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              {t("mcp.dismiss")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5">
        <h3 className="text-xs font-semibold text-muted-foreground">{t("mcp.listTitle")}</h3>
        {keys === null ? (
          <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : keys.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("mcp.empty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {keys.map((k) => {
              const st = status(k);
              return (
                <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-medium ${st ? "text-muted-foreground line-through" : ""}`}>
                      {k.name} <span className="font-mono text-xs text-muted-foreground">{k.key_prefix}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {k.scopes.map((s) => t(`mcp.scope.${s}`)).join(" · ")}
                      {" — "}
                      {k.last_used_at
                        ? t("mcp.lastUsed", { when: new Date(k.last_used_at).toLocaleString() })
                        : t("mcp.neverUsed")}
                      {k.expires_at && !st
                        ? ` — ${t("mcp.expiresOn", { date: new Date(k.expires_at).toLocaleDateString() })}`
                        : ""}
                    </p>
                  </div>
                  {st ? (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">{st}</span>
                  ) : (
                    canManage && (
                      <button
                        onClick={() => revoke(k.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-600/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("mcp.revoke")}
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
