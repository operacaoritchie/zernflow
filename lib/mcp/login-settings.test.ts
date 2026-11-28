import { describe, expect, it } from "vitest";
import {
  effectiveLoginScopes,
  parseLoginSettings,
  serializeLoginSettings,
  summarizeLoginUsage,
} from "./login-settings";

describe("login settings", () => {
  it("defaults to enabled and read only when nothing is stored", () => {
    expect(parseLoginSettings(null)).toEqual({ enabled: true, scopes: ["read"] });
    expect(parseLoginSettings({ mcp_login: "x" })).toEqual({ enabled: true, scopes: ["read"] });
  });
  it("always keeps read and drops invalid scopes", () => {
    expect(parseLoginSettings({ mcp_login: { enabled: true, scopes: ["write", "bogus"] } }).scopes).toEqual(["read", "write"]);
    expect(parseLoginSettings({ mcp_login: { scopes: [] } }).scopes).toEqual(["read"]);
  });
  it("respects an explicit off switch", () => {
    expect(parseLoginSettings({ mcp_login: { enabled: false } }).enabled).toBe(false);
  });
  it("serializes without touching other settings", () => {
    const out = serializeLoginSettings({ confirm_threshold: 50 }, { enabled: false, scopes: ["act", "read"] });
    expect(out).toEqual({ confirm_threshold: 50, mcp_login: { enabled: false, scopes: ["read", "act"] } });
  });
  it("caps role scopes by the workspace setting", () => {
    const readOnly = { enabled: true, scopes: ["read" as const] };
    expect(effectiveLoginScopes("owner", readOnly)).toEqual(["read"]);
    expect(effectiveLoginScopes("owner", { enabled: true, scopes: ["read", "write"] })).toEqual(["read", "write"]);
    expect(effectiveLoginScopes("agent", { enabled: true, scopes: ["read", "write", "act"] })).toEqual(["read"]);
  });
});

describe("login usage", () => {
  it("groups by user, counts failures, newest first", () => {
    const rows = [
      { user_id: "a", created_at: "2026-11-28T10:00:00Z", ok: true },
      { user_id: "b", created_at: "2026-11-28T12:00:00Z", ok: false },
      { user_id: "a", created_at: "2026-11-28T11:00:00Z", ok: true },
      { user_id: null, created_at: "2026-11-28T13:00:00Z", ok: true },
    ];
    expect(summarizeLoginUsage(rows)).toEqual([
      { userId: "b", calls: 1, failed: 1, lastUsedAt: "2026-11-28T12:00:00Z" },
      { userId: "a", calls: 2, failed: 0, lastUsedAt: "2026-11-28T11:00:00Z" },
    ]);
  });
});
