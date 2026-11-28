import { SCOPES, scopesForRole, type Scope } from "./scopes";

/**
 * Who may connect through "sign in with your account" (OAuth), and with what.
 * Stored in workspaces.settings.mcp_login. The effective permission is always
 * the member's role limit AND this workspace limit, whichever is smaller.
 */
export interface LoginSettings {
  enabled: boolean;
  scopes: Scope[];
}

export const DEFAULT_LOGIN_SETTINGS: LoginSettings = { enabled: true, scopes: ["read"] };

/** Read is always part of the list: a connection that cannot read is just "off". */
function cleanScopes(raw: unknown): Scope[] {
  const list = Array.isArray(raw) ? raw : [];
  return SCOPES.filter((s) => s === "read" || list.includes(s));
}

export function parseLoginSettings(raw: unknown): LoginSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const m = (s.mcp_login && typeof s.mcp_login === "object" ? s.mcp_login : {}) as Record<string, unknown>;
  return {
    enabled: typeof m.enabled === "boolean" ? m.enabled : DEFAULT_LOGIN_SETTINGS.enabled,
    scopes: Array.isArray(m.scopes) ? cleanScopes(m.scopes) : [...DEFAULT_LOGIN_SETTINGS.scopes],
  };
}

export function serializeLoginSettings(current: unknown, next: LoginSettings): Record<string, unknown> {
  const base = (current && typeof current === "object" ? current : {}) as Record<string, unknown>;
  return { ...base, mcp_login: { enabled: !!next.enabled, scopes: cleanScopes(next.scopes) } };
}

/** Scopes a signed-in member actually gets: their role's limit, capped by the workspace setting. */
export function effectiveLoginScopes(role: string | null | undefined, login: LoginSettings): Scope[] {
  return scopesForRole(role).filter((s) => login.scopes.includes(s));
}

export interface LoginUsageRow {
  user_id: string | null;
  created_at: string;
  ok: boolean;
}

export interface LoginUsage {
  userId: string;
  calls: number;
  failed: number;
  lastUsedAt: string;
}

/** Calls per signed-in user from the audit log, most recent first. */
export function summarizeLoginUsage(rows: LoginUsageRow[]): LoginUsage[] {
  const by = new Map<string, LoginUsage>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const cur = by.get(r.user_id) ?? { userId: r.user_id, calls: 0, failed: 0, lastUsedAt: r.created_at };
    cur.calls++;
    if (!r.ok) cur.failed++;
    if (r.created_at > cur.lastUsedAt) cur.lastUsedAt = r.created_at;
    by.set(r.user_id, cur);
  }
  return Array.from(by.values()).sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
}
