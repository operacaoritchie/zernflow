import { describe, expect, it } from "vitest";
import { bearerKey, evaluateKeyRow, hashKey } from "./auth";
import { isOverLimit, summarizeArgs } from "./audit";
import { handleMessage } from "./protocol";
import { hasScope, parseScopes } from "./scopes";
import type { McpContext, McpTool } from "./types";

const tool = (name: string, scope: McpTool["scope"], run: McpTool["run"] = async () => ({ ok: true })): McpTool => ({
  name,
  description: name,
  scope,
  inputSchema: { type: "object", properties: {} },
  annotations: { title: name, readOnlyHint: scope === "read", destructiveHint: false, openWorldHint: false },
  run,
});

const ctx = (scopes: McpContext["scopes"]): McpContext =>
  ({ workspaceId: "w1", keyId: "k1", userId: null, scopes, supabase: {} as McpContext["supabase"] });

describe("scopes", () => {
  it("falls back to read for empty or invalid input", () => {
    expect(parseScopes(undefined)).toEqual(["read"]);
    expect(parseScopes(["admin"])).toEqual(["read"]);
  });
  it("keeps valid scopes once", () => {
    expect(parseScopes(["write", "read", "write"])).toEqual(["write", "read"]);
  });
  it("does not imply scopes from each other", () => {
    expect(hasScope(["act"], "read")).toBe(false);
  });
});

describe("key verification", () => {
  it("extracts only zf_ bearer keys", () => {
    expect(bearerKey("Bearer zf_abc123")).toBe("zf_abc123");
    expect(bearerKey("Bearer sk_abc")).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });
  it("hashes with sha256 hex", () => {
    expect(hashKey("zf_a")).toMatch(/^[0-9a-f]{64}$/);
  });
  const row = { id: "k", workspace_id: "w", scopes: ["read"], expires_at: null, revoked_at: null };
  it("accepts a live key", () => {
    expect(evaluateKeyRow(row)).toEqual({ keyId: "k", userId: null, workspaceId: "w", scopes: ["read"] });
  });
  it("rejects revoked, expired and unknown keys", () => {
    expect(evaluateKeyRow({ ...row, revoked_at: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(evaluateKeyRow({ ...row, expires_at: "2026-11-01T00:00:00Z" }, new Date("2026-11-28"))).toBeNull();
    expect(evaluateKeyRow(null)).toBeNull();
  });
});

describe("audit helpers", () => {
  it("cuts long strings and collapses structures", () => {
    const s = summarizeArgs({ a: "x".repeat(300), b: [1, 2], c: { d: 1 }, e: 5 });
    expect((s.a as string).length).toBeLessThan(140);
    expect(s.b).toBe("[array:2]");
    expect(s.c).toBe("[object]");
    expect(s.e).toBe(5);
  });
  it("limits at 60 calls per minute", () => {
    expect(isOverLimit(59)).toBe(false);
    expect(isOverLimit(60)).toBe(true);
  });
});

describe("MCP protocol", () => {
  const tools = [tool("r", "read"), tool("w", "write")];
  const call = (name: string, scopes: McpContext["scopes"], extra: Partial<Parameters<typeof handleMessage>[1]> = {}) =>
    handleMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } },
      { tools, ctx: ctx(scopes), ...extra }
    );

  it("answers initialize with a supported version", async () => {
    const res = await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      { tools, ctx: ctx(["read"]) }
    );
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe("2025-03-26");
  });
  it("returns nothing for notifications", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, { tools, ctx: ctx(["read"]) })).toBeNull();
  });
  it("lists only tools the key can call", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { tools, ctx: ctx(["read"]) });
    expect((res?.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["r"]);
  });
  it("blocks a tool outside the key's scopes and audits it", async () => {
    const seen: string[] = [];
    const res = await call("w", ["read"], { onToolCall: (i) => void seen.push(`${i.tool}:${i.ok}`) });
    expect((res?.result as { isError?: boolean }).isError).toBe(true);
    expect(seen).toEqual(["w:false"]);
  });
  it("runs an allowed tool and audits it", async () => {
    const seen: string[] = [];
    const res = await call("r", ["read"], { onToolCall: (i) => void seen.push(`${i.tool}:${i.ok}`) });
    expect((res?.result as { isError?: boolean }).isError).toBeUndefined();
    expect(seen).toEqual(["r:true"]);
  });
  it("turns a thrown error into a tool error", async () => {
    const res = await handleMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "boom" } },
      { tools: [tool("boom", "read", async () => { throw new Error("db down"); })], ctx: ctx(["read"]) }
    );
    expect((res?.result as { isError?: boolean }).isError).toBe(true);
  });
  it("rejects unknown tools and methods", async () => {
    expect((await call("nope", ["read"]))?.error?.code).toBe(-32602);
    expect((await handleMessage({ jsonrpc: "2.0", id: 4, method: "x/y" }, { tools, ctx: ctx(["read"]) }))?.error?.code).toBe(-32601);
  });
  it("does not let an audit failure change the answer", async () => {
    const res = await call("r", ["read"], { onToolCall: () => { throw new Error("audit down"); } });
    expect(res?.error).toBeUndefined();
  });
});
