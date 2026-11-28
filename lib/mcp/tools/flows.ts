import { labelMap, nodeLabel, type RawNode } from "../flow-summary";
import { dbOf, groupCount, isoDate, limitArg, must, offsetArg, page, paging, readTool, str, uuid, bool } from "./helpers";

/** What the flow editor can build. Kept in sync by hand with lib/flow-engine/types.ts. */
const NODE_CATALOG = [
  { type: "trigger", what: "Starts the flow", data: "triggerType, keywords[{value, matchType: exact|contains|startsWith}], payload" },
  { type: "sendMessage", what: "Sends text, image, buttons, quick replies or a carousel", data: "messages[{text, imageUrl, quickReplies, buttons, carousel}]" },
  { type: "condition", what: "Branches on a field or variable", data: "conditions[{field, operator: equals|not_equals|contains|exists|gt|lt|is_phone, value}], logic: and|or", outputs: "true / false" },
  { type: "delay", what: "Waits a fixed time", data: "duration, unit: seconds|minutes|hours|days" },
  { type: "smartDelay", what: "Waits for the contact's reply, with a timeout", data: "timeout, timeoutUnit: minutes|hours|days", outputs: "reply / sem resposta (timeout)" },
  { type: "setCustomField", what: "Saves a value, validated by the field type", data: "fieldSlug, value, saveAsWhatsAppOptIn", outputs: "ok / inválido" },
  { type: "addTag", what: "Adds a tag", data: "action: add, tagName" },
  { type: "removeTag", what: "Removes a tag", data: "action: remove, tagName" },
  { type: "httpRequest", what: "Calls an external URL", data: "method, url, headers, body, responseVariable" },
  { type: "goToFlow", what: "Jumps to another flow", data: "flowId, returnAfter" },
  { type: "subscribe", what: "Subscribes or unsubscribes the contact", data: "action: subscribe|unsubscribe" },
  { type: "humanTakeover", what: "Hands the conversation to a person", data: "message" },
  { type: "commentReply", what: "Public reply to a comment", data: "text" },
  { type: "privateReply", what: "DM to someone who commented", data: "text, imageUrl" },
  { type: "abSplit", what: "Random split between paths", data: "paths[{name, weight}]" },
  { type: "aiResponse", what: "Generates a reply with AI", data: "model, systemPrompt, temperature, maxTokens, contextMessages, sendDirectly" },
  { type: "enrollSequence", what: "Enrolls the contact in a sequence", data: "sequenceId" },
  { type: "sendWhatsAppTemplate", what: "Sends an approved WhatsApp template to a phone", data: "channelId, phone, templateName, templateLanguage, params[]" },
];

const TRIGGER_TYPES = [
  { type: "keyword", what: "Direct message with a keyword" },
  { type: "postback", what: "Button payload" },
  { type: "quick_reply", what: "Quick reply payload" },
  { type: "welcome", what: "First message from a new contact" },
  { type: "default", what: "Any message no other flow matched" },
  { type: "comment_keyword", what: "Comment with a keyword on a post" },
  { type: "live_comment", what: "Comment during an Instagram live" },
];

async function ownFlow(db: ReturnType<typeof dbOf>, workspaceId: string, flowId: string) {
  const res = await db
    .from("flows")
    .select("id, name, description, status, version, published_at, created_at, updated_at, nodes, edges")
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("Flow not found in this workspace");
  return res.data as {
    id: string; name: string; description: string | null; status: string; version: number;
    published_at: string | null; created_at: string; updated_at: string; nodes: unknown; edges: unknown;
  };
}

export const flowsList = readTool({
  name: "flows_list",
  title: "List flows",
  description: "Lists the workspace's flows with status, version and size. Filter by status (draft, published, archived).",
  properties: {
    status: { type: "string", enum: ["draft", "published", "archived"] },
    ...paging,
  },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const limit = limitArg(args);
    const offset = offsetArg(args);
    let q = db
      .from("flows")
      .select("id, name, description, status, version, published_at, updated_at, nodes")
      .eq("workspace_id", ctx.workspaceId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit);
    const status = str(args, "status", 20);
    if (status) q = q.eq("status", status);
    const rows = must(await q, "flows") as Array<Record<string, unknown> & { nodes: unknown }>;
    const shaped = rows.map(({ nodes, ...f }) => ({ ...f, node_count: Array.isArray(nodes) ? nodes.length : 0 }));
    return page(shaped, limit, offset);
  },
});

export const flowGet = readTool({
  name: "flow_get",
  title: "Get a flow",
  description:
    "One flow: status, triggers, and its nodes in a readable summary (id, type, label). Set full=true for the raw nodes and edges.",
  properties: {
    flow_id: { type: "string", description: "Flow id (uuid)." },
    full: { type: "boolean", description: "Include raw nodes and edges (large)." },
  },
  required: ["flow_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const flow = await ownFlow(db, ctx.workspaceId, uuid(args, "flow_id"));
    const triggers = must(
      await db.from("triggers").select("id, type, config, channel_id, priority, is_active").eq("flow_id", flow.id),
      "triggers"
    );
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as RawNode[]) : [];
    const edges = Array.isArray(flow.edges) ? (flow.edges as unknown[]) : [];
    const { nodes: rawNodes, edges: rawEdges, ...meta } = flow;
    return {
      ...meta,
      triggers,
      node_count: nodes.length,
      edge_count: edges.length,
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: nodeLabel(n) })),
      ...(bool(args, "full") ? { raw_nodes: rawNodes, raw_edges: rawEdges } : {}),
    };
  },
});

export const flowNodeCatalog = readTool({
  name: "flow_node_catalog",
  title: "Node and trigger catalog",
  description:
    "Every node type and trigger type the flow editor supports, with the data each one takes and its outputs. Read this before writing or editing a flow.",
  async run() {
    return {
      node_types: NODE_CATALOG,
      trigger_types: TRIGGER_TYPES,
      notes: [
        "Edges connect node ids; some nodes have named outputs (sourceHandle), e.g. setCustomField 'invalid' and smartDelay 'timeout'.",
        "Editing the nodes of a published flow changes live behavior at once; triggers only change on Publish.",
      ],
    };
  },
});

export const flowAnalytics = readTool({
  name: "flow_analytics",
  title: "Flow analytics and where people stopped",
  description:
    "For one flow: starts, completions, messages, per-node executions, sessions by status, and where active sessions are waiting (by node).",
  properties: {
    flow_id: { type: "string", description: "Flow id (uuid)." },
    from: { type: "string", description: "ISO date/time, inclusive." },
    to: { type: "string", description: "ISO date/time, inclusive." },
  },
  required: ["flow_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const flow = await ownFlow(db, ctx.workspaceId, uuid(args, "flow_id"));
    const from = isoDate(args, "from");
    const to = isoDate(args, "to");
    const labels = labelMap(flow.nodes);

    const countEvents = async (eventType: string) => {
      let q = db
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId)
        .eq("flow_id", flow.id)
        .eq("event_type", eventType);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    let nodeQ = db
      .from("analytics_events")
      .select("metadata")
      .eq("workspace_id", ctx.workspaceId)
      .eq("flow_id", flow.id)
      .eq("event_type", "node_executed")
      .limit(5000);
    if (from) nodeQ = nodeQ.gte("created_at", from);
    if (to) nodeQ = nodeQ.lte("created_at", to);

    const [starts, completions, sent, failed, nodeEvents, sessionRows] = await Promise.all([
      countEvents("flow_started"),
      countEvents("flow_completed"),
      countEvents("message_sent"),
      countEvents("message_failed"),
      nodeQ,
      db
        .from("flow_sessions")
        .select("status, current_node_id, waiting_for_input, waiting_until")
        .eq("flow_id", flow.id)
        .limit(5000),
    ]);

    const perNode: Record<string, { label: string; executions: number }> = {};
    for (const e of (must(nodeEvents, "node events") as Array<{ metadata: { nodeId?: string } | null }>)) {
      const id = e.metadata?.nodeId;
      if (!id) continue;
      perNode[id] ??= { label: labels.get(id) ?? id, executions: 0 };
      perNode[id].executions++;
    }

    const sessions = must(sessionRows, "sessions") as Array<{
      status: string; current_node_id: string | null; waiting_for_input: boolean; waiting_until: string | null;
    }>;
    const active = sessions.filter((s) => s.status === "active");
    const stuck = groupCount(active, (s) => s.current_node_id ?? "unknown");

    return {
      flow: { id: flow.id, name: flow.name, status: flow.status },
      period: { from: from ?? null, to: to ?? null },
      summary: {
        starts,
        completions,
        drop_off_percent: starts ? Math.round((1 - completions / starts) * 100) : 0,
        messages_sent: sent,
        messages_failed: failed,
      },
      sessions_by_status: groupCount(sessions, (s) => s.status),
      active_sessions_waiting_at: Object.entries(stuck)
        .map(([nodeId, count]) => ({ node_id: nodeId, label: labels.get(nodeId) ?? nodeId, count }))
        .sort((a, b) => b.count - a.count),
      active_waiting_for_input: active.filter((s) => s.waiting_for_input).length,
      node_executions: perNode,
      truncated: sessions.length >= 5000 || (nodeEvents.data?.length ?? 0) >= 5000,
    };
  },
});

export const FLOW_TOOLS = [flowsList, flowGet, flowNodeCatalog, flowAnalytics];
