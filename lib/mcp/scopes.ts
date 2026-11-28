/** API key scopes. read < write < act, but each is granted on its own. */
export const SCOPES = ["read", "write", "act"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/** Keeps only valid, unique scopes. Empty/invalid input falls back to read only. */
export function parseScopes(raw: unknown): Scope[] {
  const list = Array.isArray(raw) ? raw.filter(isScope) : [];
  const unique = Array.from(new Set(list));
  return unique.length > 0 ? unique : ["read"];
}

export function hasScope(granted: readonly Scope[], needed: Scope): boolean {
  return granted.includes(needed);
}

/** What a signed-in (OAuth) user may do through MCP, from their workspace role. */
export function scopesForRole(role: string | null | undefined): Scope[] {
  return role === "owner" || role === "admin" ? ["read", "write", "act"] : ["read"];
}
