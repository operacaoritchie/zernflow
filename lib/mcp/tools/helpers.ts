import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpContext, McpTool } from "../types";

/**
 * Read tools use an untyped client on purpose: they build many dynamic
 * selects, and every query still filters by the key's workspace (or by ids
 * already proven to belong to it).
 */
export type Db = SupabaseClient;
export const dbOf = (ctx: McpContext): Db => ctx.supabase as unknown as Db;

export type Args = Record<string, unknown>;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PAGE = 50;

export function str(args: Args, key: string, max = 200): string | undefined {
  const v = args[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export function bool(args: Args, key: string): boolean | undefined {
  return typeof args[key] === "boolean" ? (args[key] as boolean) : undefined;
}

export function int(args: Args, key: string, def: number, min: number, max: number): number {
  const v = args[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}

export function uuid(args: Args, key: string): string {
  const v = str(args, key, 64);
  if (!v || !UUID_RE.test(v)) throw new Error(`${key} must be a valid id (uuid)`);
  return v;
}

export function optUuid(args: Args, key: string): string | undefined {
  return args[key] === undefined || args[key] === null || args[key] === "" ? undefined : uuid(args, key);
}

export function isoDate(args: Args, key: string): string | undefined {
  const v = str(args, key, 40);
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`${key} must be an ISO date, e.g. 2026-11-28 or 2026-11-28T09:00:00-03:00`);
  return d.toISOString();
}

export const limitArg = (args: Args, def = 20) => int(args, "limit", def, 1, MAX_PAGE);
export const offsetArg = (args: Args) => int(args, "offset", 0, 0, 100_000);

/** Removes characters that carry meaning inside a PostgREST filter expression. */
export function safeLike(text: string): string {
  return text.replace(/[,()%*\\"']/g, " ").replace(/\s+/g, " ").trim();
}

export function page<T>(rows: T[], limit: number, offset: number) {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, has_more: hasMore, next_offset: hasMore ? offset + limit : null };
}

export function groupCount<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) ?? "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

interface ReadToolDef {
  name: string;
  title: string;
  description: string;
  properties?: Record<string, unknown>;
  required?: string[];
  run(args: Args, ctx: McpContext): Promise<unknown>;
}

export function readTool(def: ReadToolDef): McpTool {
  return {
    name: def.name,
    description: def.description,
    scope: "read",
    inputSchema: {
      type: "object",
      properties: def.properties ?? {},
      ...(def.required?.length ? { required: def.required } : {}),
      additionalProperties: false,
    },
    annotations: { title: def.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: def.run,
  };
}

export const paging = {
  limit: { type: "integer", minimum: 1, maximum: MAX_PAGE, description: "Items per page (default 20, max 50)." },
  offset: { type: "integer", minimum: 0, description: "Items to skip (use next_offset from the previous page)." },
};

interface WriteToolDef extends ReadToolDef {
  idempotent?: boolean;
}

/** A tool that changes data but never talks to a lead (scope "write"). */
export function writeTool(def: WriteToolDef): McpTool {
  return {
    name: def.name,
    description: def.description,
    scope: "write",
    inputSchema: {
      type: "object",
      properties: def.properties ?? {},
      ...(def.required?.length ? { required: def.required } : {}),
      additionalProperties: false,
    },
    annotations: { title: def.title, readOnlyHint: false, destructiveHint: false, idempotentHint: def.idempotent ?? false, openWorldHint: false },
    run: def.run,
  };
}

export function strList(args: Args, key: string, maxItems = 50, maxLen = 80): string[] {
  const v = args[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`${key} must be a list of strings`);
  if (v.length > maxItems) throw new Error(`${key} can have at most ${maxItems} items`);
  return v.map((x) => {
    if (typeof x !== "string" || !x.trim()) throw new Error(`${key} must contain only non-empty strings`);
    return x.trim().slice(0, maxLen);
  });
}

export function arrArg(args: Args, key: string, max: number): unknown[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error(`${key} must be a list`);
  if (v.length > max) throw new Error(`${key} can have at most ${max} items`);
  return v;
}

export function objArg(args: Args, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${key} must be an object`);
  return v as Record<string, unknown>;
}
