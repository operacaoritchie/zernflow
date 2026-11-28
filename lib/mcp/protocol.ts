import { hasScope } from "./scopes";
import type { McpContext, McpTool, ToolCallInfo } from "./types";

/**
 * Minimal stateless MCP server over Streamable HTTP (JSON responses only).
 * Handles initialize, ping, tools/list and tools/call, which is all a
 * tools-only server needs. No sessions: every request stands alone.
 */

export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "zernflow", version: "0.1.0" };

type Id = string | number | null;
interface RpcRequest {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}
export interface RpcResponse {
  jsonrpc: "2.0";
  id: Id;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const rpcError = (id: Id, code: number, message: string): RpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

function isRequest(msg: unknown): msg is RpcRequest {
  return (
    !!msg &&
    typeof msg === "object" &&
    (msg as RpcRequest).jsonrpc === "2.0" &&
    typeof (msg as RpcRequest).method === "string"
  );
}

function textResult(value: unknown, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

export interface HandleOptions {
  tools: McpTool[];
  ctx: McpContext;
  /** Called after every tools/call (audit log). Must not throw. */
  onToolCall?: (info: ToolCallInfo) => void | Promise<void>;
}

/** Returns the response, or null when the message is a notification. */
export async function handleMessage(msg: unknown, opts: HandleOptions): Promise<RpcResponse | null> {
  if (!isRequest(msg)) return rpcError(null, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  const id: Id = msg.id ?? null;

  if (isNotification) return null; // e.g. notifications/initialized

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      const protocolVersion = (SUPPORTED_PROTOCOLS as readonly unknown[]).includes(asked)
        ? (asked as string)
        : SUPPORTED_PROTOCOLS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list": {
      const visible = opts.tools.filter((t) => hasScope(opts.ctx.scopes, t.scope));
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: visible.map((t) => ({
            name: t.name,
            title: t.annotations.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        },
      };
    }
    case "tools/call": {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = typeof name === "string" ? opts.tools.find((t) => t.name === name) : undefined;
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return rpcError(id, -32602, "arguments must be an object");
      }

      const started = Date.now();
      let result: ReturnType<typeof textResult>;
      let ok = true;
      let error: string | undefined;

      if (!hasScope(opts.ctx.scopes, tool.scope)) {
        ok = false;
        error = `This key does not have the "${tool.scope}" scope.`;
        result = textResult(error, true);
      } else {
        try {
          result = textResult(await tool.run(args, opts.ctx));
        } catch (e) {
          ok = false;
          error = e instanceof Error ? e.message : "Tool failed";
          result = textResult(error, true);
        }
      }

      try {
        await opts.onToolCall?.({ tool: tool.name, args, ok, error, durationMs: Date.now() - started });
      } catch {
        // Audit failures never change the tool's answer.
      }
      return { jsonrpc: "2.0", id, result };
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}
