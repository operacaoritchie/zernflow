/**
 * The builder and the engine store action nodes in two different shapes:
 *
 * - Builder (palette drop):  { type: "action", data: { actionType: "smartDelay", ... } }
 * - Engine / templates:      { type: "smartDelay", data: { ... } }
 *
 * The engine only dispatched on `node.type`, so every action node created in the
 * builder (Smart Delay, Set Custom Field, Add Tag, ...) was silently skipped at
 * runtime. The builder only opened a config panel for `type: "action"`, so nodes
 * in the engine shape showed "no panel". These helpers convert between the two
 * so both sides accept either shape.
 */

export const ACTION_NODE_TYPES = [
  "addTag",
  "removeTag",
  "setCustomField",
  "httpRequest",
  "goToFlow",
  "humanTakeover",
  "subscribe",
  "unsubscribe",
  "abSplit",
  "smartDelay",
  "enrollSequence",
] as const;

export type ActionNodeType = (typeof ACTION_NODE_TYPES)[number];

export function isActionNodeType(type: unknown): type is ActionNodeType {
  return typeof type === "string" && (ACTION_NODE_TYPES as readonly string[]).includes(type);
}

interface NodeLike {
  type?: string;
  data?: unknown;
}

function dataOf(node: NodeLike): Record<string, unknown> {
  return node.data && typeof node.data === "object"
    ? (node.data as Record<string, unknown>)
    : {};
}

/** Builder shape → engine shape. Nodes already in engine shape are returned as-is. */
export function toEngineNode<T extends NodeLike>(node: T): T {
  if (node.type !== "action") return node;

  const data = dataOf(node);
  const actionType = data.actionType;
  if (!isActionNodeType(actionType)) return node;

  const nextData: Record<string, unknown> = { ...data };
  // executeTag reads data.action; builder tag nodes only carry actionType.
  if ((actionType === "addTag" || actionType === "removeTag") && !nextData.action) {
    nextData.action = actionType === "addTag" ? "add" : "remove";
  }

  return { ...node, type: actionType, data: nextData } as T;
}

/** Engine shape → builder shape, so the config panel opens. */
export function toEditorNode<T extends NodeLike>(node: T): T {
  if (!isActionNodeType(node.type)) return node;

  const data = dataOf(node);
  return { ...node, type: "action", data: { ...data, actionType: node.type } } as T;
}

export function toEngineNodes<T extends NodeLike>(nodes: T[]): T[] {
  return nodes.map(toEngineNode);
}

export function toEditorNodes<T extends NodeLike>(nodes: T[]): T[] {
  return nodes.map(toEditorNode);
}
