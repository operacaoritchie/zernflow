import { keywordConflicts, triggerKeywords, validateFlow, type ValidateContext } from "@/lib/flow-validate";
import { simulateFlow } from "@/lib/flow-engine/simulator";
import { arrArg, dbOf, must, objArg, optUuid, readTool, str, type Db } from "./helpers";
import type { McpContext } from "../types";

/** What exists in the workspace, so the validator can check names and ids the flow refers to. */
export async function loadValidateContext(db: Db, workspaceId: string): Promise<ValidateContext> {
  const [tags, fields, seqs, flows, chans] = await Promise.all([
    db.from("tags").select("name").eq("workspace_id", workspaceId).limit(2000),
    db.from("custom_field_definitions").select("slug, type").eq("workspace_id", workspaceId).limit(500),
    db.from("sequences").select("id").eq("workspace_id", workspaceId).limit(500),
    db.from("flows").select("id").eq("workspace_id", workspaceId).limit(1000),
    db.from("channels").select("id").eq("workspace_id", workspaceId).limit(200),
  ]);
  return {
    tagNames: new Set((must(tags, "tags") as Array<{ name: string }>).map((t) => t.name.toLowerCase())),
    fieldTypes: new Map((must(fields, "fields") as Array<{ slug: string; type: string }>).map((f) => [f.slug, f.type])),
    sequenceIds: new Set((must(seqs, "sequences") as Array<{ id: string }>).map((s) => s.id)),
    flowIds: new Set((must(flows, "flows") as Array<{ id: string }>).map((f) => f.id)),
    channelIds: new Set((must(chans, "channels") as Array<{ id: string }>).map((c) => c.id)),
  };
}

/** Keywords of the other published flows that this graph would also answer. */
export async function conflictsWithPublished(db: Db, workspaceId: string, nodes: unknown, excludeFlowId?: string) {
  const mine = triggerKeywords(nodes);
  if (mine.length === 0) return [];
  let q = db.from("flows").select("id, name, nodes").eq("workspace_id", workspaceId).eq("status", "published");
  if (excludeFlowId) q = q.neq("id", excludeFlowId);
  const others = (must(await q, "flows") as Array<{ name: string; nodes: unknown }>).flatMap((f) =>
    triggerKeywords(f.nodes).map((k) => ({ flowName: f.name, ...k }))
  );
  return keywordConflicts(mine, others);
}

/** A flow given either by id (stored) or inline (nodes + edges) for a "what if" check. */
async function graphFrom(args: Record<string, unknown>, ctx: McpContext): Promise<{ nodes: unknown; edges: unknown; flowId?: string; name?: string }> {
  const db = dbOf(ctx);
  const flowId = optUuid(args, "flow_id");
  if (flowId) {
    const { data, error } = await db.from("flows").select("id, name, nodes, edges").eq("id", flowId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Flow not found in this workspace");
    return { nodes: data.nodes, edges: data.edges, flowId, name: data.name };
  }
  const nodes = arrArg(args, "nodes", 300);
  const edges = arrArg(args, "edges", 600);
  if (!nodes || !edges) throw new Error("Give flow_id, or both nodes and edges");
  return { nodes, edges };
}

const graphProps = {
  flow_id: { type: "string", description: "A saved flow (uuid). Alternatively pass nodes and edges." },
  nodes: { type: "array", items: { type: "object" }, description: "Candidate nodes, checked without saving." },
  edges: { type: "array", items: { type: "object" }, description: "Candidate edges." },
};

export const flowValidate = readTool({
  name: "flow_validate",
  title: "Validate a flow",
  description:
    "Checks a flow (saved, or candidate nodes and edges) before saving or publishing: node types and data, outputs, loops without a wait, unreachable nodes, tags/fields/sequences/flows/channels that do not exist, and keywords another published flow already answers. Errors must be fixed before publishing; warnings are advice.",
  properties: graphProps,
  async run(args, ctx) {
    const db = dbOf(ctx);
    const g = await graphFrom(args, ctx);
    const vctx = await loadValidateContext(db, ctx.workspaceId);
    const report = validateFlow(g.nodes, g.edges, vctx);
    const conflicts = await conflictsWithPublished(db, ctx.workspaceId, g.nodes, g.flowId);
    return { flow: g.flowId ? { id: g.flowId, name: g.name } : "candidate", ...report, keyword_conflicts: conflicts };
  },
});

export const flowSimulate = readTool({
  name: "flow_simulate",
  title: "Simulate a flow",
  description:
    "Dry run: walks the flow with an example incoming message, step by step, without sending or saving anything. It stops where the flow waits for a reply or a delay. Use it after flow_validate.",
  properties: {
    ...graphProps,
    message: { type: "string", description: "The message the contact sends (it must match the trigger's keywords)." },
    contact: {
      type: "object",
      description: "Optional example contact.",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        custom_fields: { type: "object", additionalProperties: { type: "string" } },
        is_subscribed: { type: "boolean" },
      },
    },
  },
  required: ["message"],
  async run(args, ctx) {
    const g = await graphFrom(args, ctx);
    const message = str(args, "message", 1000);
    if (!message) throw new Error("message is required");
    const c = objArg(args, "contact");
    const result = simulateFlow(g.nodes as never, g.edges as never, {
      incomingMessage: message,
      mockContact: c
        ? {
            tags: Array.isArray(c.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === "string") : undefined,
            customFields: c.custom_fields && typeof c.custom_fields === "object" ? (c.custom_fields as Record<string, string>) : undefined,
            isSubscribed: typeof c.is_subscribed === "boolean" ? c.is_subscribed : undefined,
          }
        : undefined,
    });
    return { flow: g.flowId ? { id: g.flowId, name: g.name } : "candidate", ...result, step_count: result.steps.length, note: "A dry run: nothing was sent or saved. Waits (delays, replies) end the run." };
  },
});

export const FLOW_CHECK_TOOLS = [flowValidate, flowSimulate];
