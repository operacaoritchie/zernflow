import { isActionNodeType, toEngineNode } from "./flow-engine/normalize-nodes";

/**
 * Checks a flow graph before it is saved or published. Pure: references to
 * tags, fields, sequences, flows and channels are checked only when the caller
 * passes what exists in the workspace (see ValidateContext).
 *
 * "structural" issues would break the editor or the engine (not an array, edge
 * to a node that does not exist, unknown node type). A draft with such an
 * issue is refused; every other issue is reported and the draft is still saved.
 */

export interface FlowIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  structural?: boolean;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidateContext {
  /** Tag names that exist (lower-case). */
  tagNames?: Set<string>;
  /** Custom field slug → type. */
  fieldTypes?: Map<string, string>;
  sequenceIds?: Set<string>;
  flowIds?: Set<string>;
  channelIds?: Set<string>;
}

export interface FlowReport {
  /** No errors (warnings allowed). */
  valid: boolean;
  /** Something that must not be saved at all. */
  structural: boolean;
  errors: FlowIssue[];
  warnings: FlowIssue[];
}

export const NODE_TYPES = [
  "trigger", "sendMessage", "condition", "delay", "addTag", "removeTag", "setCustomField", "httpRequest",
  "goToFlow", "subscribe", "unsubscribe", "humanTakeover", "commentReply", "privateReply", "abSplit",
  "smartDelay", "aiResponse", "enrollSequence", "sendWhatsAppTemplate",
] as const;

export const TRIGGER_TYPES = ["keyword", "postback", "quick_reply", "welcome", "default", "comment_keyword", "live_comment"] as const;
const DELAY_UNITS = ["seconds", "minutes", "hours", "days"];
const WAIT_UNITS = ["minutes", "hours", "days"];
const CONDITION_OPS = ["equals", "not_equals", "contains", "exists", "gt", "lt", "is_phone"];
const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"];
const OUTCOME_HANDLES: Record<string, string[]> = { setCustomField: ["invalid"], smartDelay: ["timeout"] };

export const MAX_NODES = 300;
export const MAX_EDGES = 600;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function typeOf(node: Obj): string {
  const n = toEngineNode(node as { type?: string; data?: unknown });
  return typeof n.type === "string" ? n.type : "";
}

function dataOf(node: Obj): Obj {
  const n = toEngineNode(node as { type?: string; data?: unknown });
  return isObj(n.data) ? n.data : {};
}

/** Handles an edge may leave this node by, beyond the default (no handle) one. */
function validHandles(type: string, data: Obj): Set<string> {
  if (type === "condition") return new Set(["true", "false"]);
  if (type === "abSplit") {
    const paths = Array.isArray(data.paths) ? data.paths : [];
    return new Set(paths.map((p) => str((p as Obj)?.name)).filter(Boolean));
  }
  return new Set(OUTCOME_HANDLES[type] ?? []);
}

export function validateFlow(rawNodes: unknown, rawEdges: unknown, ctx: ValidateContext = {}): FlowReport {
  const issues: FlowIssue[] = [];
  const add = (level: FlowIssue["level"], code: string, message: string, extra: Partial<FlowIssue> = {}) =>
    issues.push({ level, code, message, ...extra });
  const finish = (): FlowReport => {
    const errors = issues.filter((i) => i.level === "error");
    return {
      valid: errors.length === 0,
      structural: issues.some((i) => i.structural),
      errors,
      warnings: issues.filter((i) => i.level === "warning"),
    };
  };

  if (!Array.isArray(rawNodes)) {
    add("error", "nodes_not_array", "nodes must be an array", { structural: true });
    return finish();
  }
  if (!Array.isArray(rawEdges)) {
    add("error", "edges_not_array", "edges must be an array", { structural: true });
    return finish();
  }
  if (rawNodes.length > MAX_NODES) add("error", "too_many_nodes", `A flow can have at most ${MAX_NODES} nodes`, { structural: true });
  if (rawEdges.length > MAX_EDGES) add("error", "too_many_edges", `A flow can have at most ${MAX_EDGES} edges`, { structural: true });

  // ── Nodes ────────────────────────────────────────────────────────────────────
  const nodes = new Map<string, Obj>();
  for (const raw of rawNodes) {
    if (!isObj(raw) || !str(raw.id)) {
      add("error", "node_no_id", "Every node needs a string id", { structural: true });
      continue;
    }
    const id = str(raw.id);
    if (nodes.has(id)) {
      add("error", "duplicate_node_id", `Node id "${id}" is used twice`, { structural: true, nodeId: id });
      continue;
    }
    nodes.set(id, raw);
    const type = typeOf(raw);
    if (!(NODE_TYPES as readonly string[]).includes(type)) {
      add("error", "unknown_node_type", `Node "${id}" has unknown type "${type || String(raw.type)}"`, { structural: true, nodeId: id });
    }
    if (raw.type !== "action" && !isActionNodeType(raw.type) && raw.data !== undefined && !isObj(raw.data)) {
      add("error", "node_data_not_object", `Node "${id}": data must be an object`, { structural: true, nodeId: id });
    }
    const pos = raw.position;
    if (!isObj(pos) || typeof pos.x !== "number" || typeof pos.y !== "number") {
      add("warning", "no_position", `Node "${id}" has no position; the editor will stack it at the origin`, { nodeId: id });
    }
  }

  // ── Edges ────────────────────────────────────────────────────────────────────
  const out = new Map<string, Array<{ target: string; handle: string | null }>>();
  const incoming = new Map<string, number>();
  for (const raw of rawEdges) {
    if (!isObj(raw)) {
      add("error", "edge_not_object", "Every edge must be an object", { structural: true });
      continue;
    }
    const source = str(raw.source);
    const target = str(raw.target);
    const edgeId = str(raw.id) || `${source}->${target}`;
    if (!nodes.has(source) || !nodes.has(target)) {
      add("error", "edge_missing_node", `Edge ${edgeId} points to a node that does not exist (${!nodes.has(source) ? source : target})`, { structural: true, edgeId });
      continue;
    }
    const handle = str(raw.sourceHandle) || null;
    const srcNode = nodes.get(source)!;
    const type = typeOf(srcNode);
    if (handle && !validHandles(type, dataOf(srcNode)).has(handle)) {
      add("error", "invalid_handle", `Edge ${edgeId}: "${type}" has no output "${handle}"`, { edgeId, nodeId: source });
    }
    out.set(source, [...(out.get(source) ?? []), { target, handle }]);
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  // ── Triggers ─────────────────────────────────────────────────────────────────
  const triggerIds = Array.from(nodes.entries()).filter(([, n]) => typeOf(n) === "trigger").map(([id]) => id);
  if (triggerIds.length === 0) add("error", "no_trigger", "The flow has no trigger node, so nothing will ever start it");
  let hasCommentTrigger = false;
  for (const id of triggerIds) {
    const d = dataOf(nodes.get(id)!);
    const tt = str(d.triggerType) || "keyword";
    if (!(TRIGGER_TYPES as readonly string[]).includes(tt)) {
      add("error", "invalid_trigger_type", `Trigger "${id}": unknown triggerType "${tt}"`, { nodeId: id });
      continue;
    }
    if (tt === "comment_keyword" || tt === "live_comment") hasCommentTrigger = true;
    if (tt === "keyword" || tt === "comment_keyword") {
      const kws = Array.isArray(d.keywords) ? d.keywords : [];
      if (kws.length === 0) add("warning", "trigger_no_keywords", `Trigger "${id}" has no keywords: it matches every message`, { nodeId: id });
      for (const k of kws) {
        const value = typeof k === "string" ? k : str((k as Obj)?.value);
        if (!value) add("error", "empty_keyword", `Trigger "${id}" has an empty keyword`, { nodeId: id });
      }
    }
    if ((tt === "postback" || tt === "quick_reply") && !str(d.payload)) {
      add("error", "trigger_no_payload", `Trigger "${id}" (${tt}) needs a payload`, { nodeId: id });
    }
    if ((incoming.get(id) ?? 0) > 0) add("warning", "trigger_has_incoming", `Trigger "${id}" has incoming edges; nothing should lead back to a trigger`, { nodeId: id });
    if (!(out.get(id)?.length)) add("error", "trigger_no_next", `Trigger "${id}" is not connected to anything`, { nodeId: id });
  }

  // ── Node rules ───────────────────────────────────────────────────────────────
  for (const [id, raw] of nodes) {
    const type = typeOf(raw);
    const d = dataOf(raw);
    const here = { nodeId: id };
    switch (type) {
      case "sendMessage": {
        const msgs = Array.isArray(d.messages) ? (d.messages as Obj[]) : [];
        if (msgs.length === 0 || !msgs.some((m) => str(m?.text) || str(m?.imageUrl) || isObj(m?.carousel))) {
          add("error", "message_empty", `Message node "${id}" has nothing to send`, here);
        }
        msgs.forEach((m) => {
          const qr = Array.isArray(m?.quickReplies) ? (m.quickReplies as Obj[]) : [];
          const bt = Array.isArray(m?.buttons) ? (m.buttons as Obj[]) : [];
          if (qr.length > 13) add("warning", "too_many_quick_replies", `Node "${id}": more than 13 quick replies`, here);
          if (bt.length > 3) add("warning", "too_many_buttons", `Node "${id}": more than 3 buttons`, here);
          if (qr.some((q) => str(q?.title).length > 20)) add("warning", "quick_reply_title_long", `Node "${id}": a quick reply title is longer than 20 characters`, here);
          if (bt.some((b) => str(b?.title).length > 20)) add("warning", "button_title_long", `Node "${id}": a button title is longer than 20 characters`, here);
          for (const b of bt) {
            if (b?.type === "url" && !/^https?:\/\//i.test(str(b?.url))) add("error", "button_bad_url", `Node "${id}": a url button needs an http(s) address`, here);
          }
        });
        break;
      }
      case "condition": {
        const cs = Array.isArray(d.conditions) ? (d.conditions as Obj[]) : [];
        if (cs.length === 0) add("error", "condition_empty", `Condition "${id}" has no rules`, here);
        for (const c of cs) {
          if (!str(c?.field)) add("error", "condition_no_field", `Condition "${id}" has a rule without a field`, here);
          if (!CONDITION_OPS.includes(str(c?.operator))) add("error", "condition_bad_operator", `Condition "${id}": unknown operator "${str(c?.operator)}"`, here);
        }
        const handles = (out.get(id) ?? []).map((e) => e.handle);
        if (!handles.includes("true") || !handles.includes("false")) {
          add("warning", "condition_missing_branch", `Condition "${id}" does not have both a true and a false path`, here);
        }
        break;
      }
      case "delay":
        if (!(Number(d.duration) > 0) || !DELAY_UNITS.includes(str(d.unit))) add("error", "delay_invalid", `Delay "${id}" needs a duration above 0 and a unit (${DELAY_UNITS.join(", ")})`, here);
        break;
      case "smartDelay":
        if (!(Number(d.timeout) > 0) || !WAIT_UNITS.includes(str(d.timeoutUnit))) add("error", "smart_delay_invalid", `Smart delay "${id}" needs a timeout above 0 and a unit (${WAIT_UNITS.join(", ")})`, here);
        break;
      case "addTag":
      case "removeTag": {
        const name = str(d.tagName);
        if (!name) add("error", "tag_no_name", `Tag node "${id}" has no tagName`, here);
        else if (ctx.tagNames && !ctx.tagNames.has(name.toLowerCase())) {
          add(type === "addTag" ? "warning" : "error", "tag_not_found", `Tag "${name}" (node "${id}") does not exist yet in this workspace`, here);
        }
        break;
      }
      case "setCustomField": {
        const slug = str(d.fieldSlug);
        if (!slug) add("error", "field_no_slug", `Set-field node "${id}" has no fieldSlug`, here);
        else if (ctx.fieldTypes && !ctx.fieldTypes.has(slug)) add("error", "field_not_found", `Field "${slug}" (node "${id}") does not exist; create it first`, here);
        if (d.value === undefined || d.value === null) add("warning", "field_no_value", `Set-field node "${id}" has no value (use "{{message}}" to save the contact's reply)`, here);
        break;
      }
      case "httpRequest":
        if (!/^https?:\/\//i.test(str(d.url))) add("error", "http_bad_url", `HTTP node "${id}" needs an http(s) url`, here);
        if (!HTTP_METHODS.includes(str(d.method) || "GET")) add("error", "http_bad_method", `HTTP node "${id}": method must be ${HTTP_METHODS.join(", ")}`, here);
        break;
      case "goToFlow":
        if (!str(d.flowId)) add("error", "goto_no_flow", `Go-to-flow node "${id}" has no flowId`, here);
        else if (ctx.flowIds && !ctx.flowIds.has(str(d.flowId))) add("error", "goto_flow_not_found", `Go-to-flow node "${id}" points to a flow that does not exist`, here);
        break;
      case "enrollSequence":
        if (!str(d.sequenceId)) add("error", "sequence_no_id", `Enroll node "${id}" has no sequenceId`, here);
        else if (ctx.sequenceIds && !ctx.sequenceIds.has(str(d.sequenceId))) add("error", "sequence_not_found", `Enroll node "${id}" points to a sequence that does not exist`, here);
        break;
      case "sendWhatsAppTemplate":
        for (const k of ["channelId", "phone", "templateName", "templateLanguage"]) {
          if (!str(d[k])) add("error", "template_incomplete", `WhatsApp template node "${id}" needs ${k}`, here);
        }
        if (str(d.channelId) && ctx.channelIds && !ctx.channelIds.has(str(d.channelId))) add("error", "channel_not_found", `Template node "${id}" uses a channel that does not exist`, here);
        break;
      case "abSplit": {
        const paths = Array.isArray(d.paths) ? (d.paths as Obj[]) : [];
        const names = paths.map((p) => str(p?.name));
        if (paths.length < 2) add("error", "split_few_paths", `Split "${id}" needs at least 2 paths`, here);
        if (names.some((n) => !n) || new Set(names).size !== names.length) add("error", "split_bad_names", `Split "${id}": path names must be filled and different`, here);
        if (paths.some((p) => !(Number(p?.weight) > 0))) add("error", "split_bad_weight", `Split "${id}": every path needs a weight above 0`, here);
        break;
      }
      case "commentReply":
      case "privateReply":
        if (!str(d.text)) add("error", "reply_empty", `Node "${id}" has no text`, here);
        if (!hasCommentTrigger) add("warning", "reply_without_comment_trigger", `Node "${id}" replies to a comment, but no trigger starts from comments`, here);
        break;
      case "aiResponse":
        if (!str(d.model) || !str(d.systemPrompt)) add("warning", "ai_incomplete", `AI node "${id}" has no model or system prompt`, here);
        break;
      default:
        break;
    }
  }

  // ── Graph: reachability and loops ────────────────────────────────────────────
  const reachable = new Set<string>();
  const stack = [...triggerIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of out.get(id) ?? []) stack.push(e.target);
  }
  if (triggerIds.length > 0) {
    for (const id of nodes.keys()) {
      if (!reachable.has(id) && !triggerIds.includes(id)) add("warning", "orphan_node", `Node "${id}" cannot be reached from a trigger`, { nodeId: id });
    }
  }

  const color = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const reported = new Set<string>();
  const dfs = (id: string) => {
    color.set(id, 1);
    path.push(id);
    for (const e of out.get(id) ?? []) {
      const c = color.get(e.target) ?? 0;
      if (c === 1) {
        const cycle = path.slice(path.indexOf(e.target));
        const waits = cycle.some((n) => ["delay", "smartDelay"].includes(typeOf(nodes.get(n)!)));
        const key = [...cycle].sort().join(",");
        if (!waits && !reported.has(key)) {
          reported.add(key);
          add("error", "loop_without_wait", `Loop without a wait: ${cycle.join(" → ")} → ${e.target}. It would run until the engine stops it`, { nodeId: e.target });
        }
      } else if (c === 0) dfs(e.target);
    }
    path.pop();
    color.set(id, 2);
  };
  for (const id of triggerIds) if ((color.get(id) ?? 0) === 0) dfs(id);

  return finish();
}

/** Keywords (lower-case) a flow's trigger nodes listen for, by trigger type. */
export function triggerKeywords(rawNodes: unknown): Array<{ triggerType: string; keyword: string }> {
  if (!Array.isArray(rawNodes)) return [];
  const out: Array<{ triggerType: string; keyword: string }> = [];
  for (const raw of rawNodes) {
    if (!isObj(raw) || typeOf(raw) !== "trigger") continue;
    const d = dataOf(raw);
    const tt = str(d.triggerType) || "keyword";
    const kws = Array.isArray(d.keywords) ? d.keywords : [];
    for (const k of kws) {
      const value = (typeof k === "string" ? k : str((k as Obj)?.value)).toLowerCase();
      if (value) out.push({ triggerType: tt, keyword: value });
    }
  }
  return out;
}

/** Keywords this flow shares with other flows, which would answer the same message. */
export function keywordConflicts(
  mine: Array<{ triggerType: string; keyword: string }>,
  others: Array<{ flowName: string; triggerType: string; keyword: string }>
): Array<{ flowName: string; triggerType: string; keyword: string }> {
  return others.filter((o) => mine.some((m) => m.keyword === o.keyword && m.triggerType === o.triggerType));
}

// ── Building ─────────────────────────────────────────────────────────────────

/**
 * Fills what the editor needs and an agent should not have to invent: node
 * `data`, positions laid out left to right by distance from the trigger, and
 * edge ids. Input is not mutated.
 */
export function prepareGraph(rawNodes: unknown[], rawEdges: unknown[]): { nodes: Obj[]; edges: Obj[] } {
  const edgesIn = rawEdges.filter(isObj);
  const nodesIn = rawNodes.filter(isObj);

  const depth = new Map<string, number>();
  const queue = nodesIn.filter((n) => typeOf(n) === "trigger").map((n) => str(n.id));
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edgesIn) {
      if (str(e.source) === id && !depth.has(str(e.target))) {
        depth.set(str(e.target), (depth.get(id) ?? 0) + 1);
        queue.push(str(e.target));
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const perColumn = new Map<number, number>();

  const nodes = nodesIn.map((n) => {
    const id = str(n.id);
    const col = depth.get(id) ?? maxDepth + 1;
    const row = perColumn.get(col) ?? 0;
    perColumn.set(col, row + 1);
    const pos = n.position as Obj | undefined;
    const hasPos = isObj(pos) && typeof pos.x === "number" && typeof pos.y === "number";
    return { ...n, data: isObj(n.data) ? n.data : {}, position: hasPos ? pos : { x: col * 320, y: row * 180 } };
  });

  const used = new Set<string>();
  const edges = edgesIn.map((e) => {
    const base = str(e.id) || `e_${str(e.source)}_${str(e.sourceHandle) || "out"}_${str(e.target)}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    return { ...e, id };
  });
  return { nodes, edges };
}
