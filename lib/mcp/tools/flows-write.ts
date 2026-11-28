import { prepareGraph, validateFlow, type FlowReport } from "@/lib/flow-validate";
import { arrArg, dbOf, str, uuid, writeTool, type Db } from "./helpers";
import { conflictsWithPublished, loadValidateContext } from "./flow-check";
import type { McpContext } from "../types";

const MAX_BYTES = 500_000;

/** Prepares, validates and reports a graph. Structural problems throw: the draft is not saved. */
async function checkGraph(ctx: McpContext, rawNodes: unknown[], rawEdges: unknown[], excludeFlowId?: string) {
  const db = dbOf(ctx);
  const { nodes, edges } = prepareGraph(rawNodes, rawEdges);
  if (JSON.stringify({ nodes, edges }).length > MAX_BYTES) throw new Error("The flow is too large (limit 500 KB)");
  const report: FlowReport = validateFlow(nodes, edges, await loadValidateContext(db, ctx.workspaceId));
  if (report.structural) {
    const first = report.errors.filter((e) => e.structural).slice(0, 5).map((e) => e.message);
    throw new Error(`The flow was not saved because its structure is broken: ${first.join("; ")}`);
  }
  const conflicts = await conflictsWithPublished(db, ctx.workspaceId, nodes, excludeFlowId);
  return { nodes, edges, report, conflicts };
}

const result = (flow: { id: string; name: string; status: string; updated_at: string }, c: Awaited<ReturnType<typeof checkGraph>>) => ({
  id: flow.id,
  name: flow.name,
  status: flow.status,
  updated_at: flow.updated_at,
  editor_path: `/dashboard/flows/${flow.id}`,
  valid: c.report.valid,
  errors: c.report.errors,
  warnings: c.report.warnings,
  keyword_conflicts: c.conflicts,
  next: c.report.valid
    ? "Run flow_simulate, then publish from the editor (publishing by MCP arrives in the next phase)."
    : "Fix the errors and save again with flow_update.",
});

async function ownFlow(db: Db, workspaceId: string, id: string) {
  const { data, error } = await db.from("flows").select("id, name, description, status, nodes, edges, viewport, updated_at").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Flow not found in this workspace");
  return data as { id: string; name: string; description: string | null; status: string; nodes: unknown; edges: unknown; viewport: unknown; updated_at: string };
}

const nodesProp = {
  type: "array",
  items: { type: "object" },
  description:
    "Nodes: { id, type, data, position? }. Positions are laid out for you when missing. Read flow_node_catalog for each type's data and outputs.",
};
const edgesProp = {
  type: "array",
  items: { type: "object" },
  description: "Edges: { source, target, sourceHandle? }. Outputs: condition true/false, setCustomField invalid, smartDelay timeout, abSplit the path name. Ids are generated when missing.",
};

export const flowCreate = writeTool({
  name: "flow_create",
  title: "Create a draft flow",
  description:
    "Creates a flow as a DRAFT (it never runs until someone publishes it). The graph is checked: a broken structure is refused, any other problem is saved and reported so you can fix it with flow_update. Returns the id and where to open it in the editor.",
  properties: {
    name: { type: "string", description: "Flow name (up to 120 characters)." },
    description: { type: "string" },
    nodes: nodesProp,
    edges: edgesProp,
  },
  required: ["name"],
  async run(args, ctx) {
    const name = str(args, "name", 120);
    if (!name) throw new Error("name is required");
    const c = await checkGraph(ctx, arrArg(args, "nodes", 300) ?? [], arrArg(args, "edges", 600) ?? []);
    const { data, error } = await dbOf(ctx)
      .from("flows")
      .insert({ workspace_id: ctx.workspaceId, name, description: str(args, "description", 500) ?? null, status: "draft", nodes: c.nodes, edges: c.edges })
      .select("id, name, status, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return result(data as { id: string; name: string; status: string; updated_at: string }, c);
  },
});

export const flowClone = writeTool({
  name: "flow_clone",
  title: "Clone a flow as a draft",
  description: "Copies a flow (draft or published) into a new DRAFT, leaving the original untouched. Triggers are not copied: they are created when the clone is published.",
  properties: {
    flow_id: { type: "string", description: "Flow to copy (uuid)." },
    name: { type: "string", description: "Name of the copy (default: original name + ' (copy)')." },
  },
  required: ["flow_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const source = await ownFlow(db, ctx.workspaceId, uuid(args, "flow_id"));
    const name = str(args, "name", 120) ?? `${source.name} (copy)`.slice(0, 120);
    const { data, error } = await db
      .from("flows")
      .insert({ workspace_id: ctx.workspaceId, name, description: source.description, status: "draft", nodes: source.nodes, edges: source.edges, viewport: source.viewport, version: 1 })
      .select("id, name, status, updated_at")
      .single();
    if (error) throw new Error(error.message);
    const c = await checkGraph(ctx, Array.isArray(source.nodes) ? source.nodes : [], Array.isArray(source.edges) ? source.edges : [], (data as { id: string }).id);
    return result(data as { id: string; name: string; status: string; updated_at: string }, c);
  },
});

export const flowUpdate = writeTool({
  name: "flow_update",
  title: "Edit a draft flow",
  description:
    "Edits a DRAFT flow. Published flows cannot be edited here (that changes live behavior at once). You must pass expected_updated_at from flow_get: if someone edited the flow in the editor since, the call fails instead of overwriting their work. nodes/edges, when given, replace the whole graph.",
  properties: {
    flow_id: { type: "string", description: "Draft flow id (uuid)." },
    expected_updated_at: { type: "string", description: "The flow's updated_at as returned by flow_get." },
    name: { type: "string" },
    description: { type: "string" },
    nodes: nodesProp,
    edges: edgesProp,
  },
  required: ["flow_id", "expected_updated_at"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const id = uuid(args, "flow_id");
    const expected = str(args, "expected_updated_at", 64);
    if (!expected || Number.isNaN(new Date(expected).getTime())) throw new Error("expected_updated_at must be the updated_at returned by flow_get");
    const flow = await ownFlow(db, ctx.workspaceId, id);
    if (flow.status !== "draft") throw new Error(`This flow is ${flow.status}. Only drafts can be edited by MCP, because editing a published flow changes what people receive right away.`);

    const nodesIn = arrArg(args, "nodes", 300) ?? (Array.isArray(flow.nodes) ? flow.nodes : []);
    const edgesIn = arrArg(args, "edges", 600) ?? (Array.isArray(flow.edges) ? flow.edges : []);
    const c = await checkGraph(ctx, nodesIn, edgesIn, id);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const name = str(args, "name", 120);
    if (name) update.name = name;
    if (args.description !== undefined) update.description = str(args, "description", 500) ?? null;
    if (args.nodes !== undefined || args.edges !== undefined) {
      update.nodes = c.nodes;
      update.edges = c.edges;
    }

    if (new Date(flow.updated_at).getTime() !== new Date(expected).getTime()) {
      throw new Error("The flow changed since you read it (someone edited it, or it was published). Run flow_get again and redo the edit on top of the current version.");
    }
    // The stored timestamp is part of the filter, so an edit made between the check above and this write is not overwritten.
    const { data, error } = await db
      .from("flows")
      .update(update)
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "draft")
      .eq("updated_at", flow.updated_at)
      .select("id, name, status, updated_at");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; name: string; status: string; updated_at: string }>;
    if (rows.length === 0) {
      throw new Error("The flow changed since you read it (someone edited it, or it was published). Run flow_get again and redo the edit on top of the current version.");
    }
    return result(rows[0], c);
  },
});

export const FLOW_WRITE_TOOLS = [flowCreate, flowClone, flowUpdate];
