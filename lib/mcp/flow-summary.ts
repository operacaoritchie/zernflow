/** Human-readable view of flow nodes, so answers say "waiting for the name" and not "node_17". */

export interface RawNode {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function nodeLabel(node: RawNode): string {
  const d = (node.data ?? {}) as Record<string, unknown>;
  // The editor lets people name a node; action nodes created there nest the real type.
  const type = node.type === "action" && typeof d.actionType === "string" ? d.actionType : node.type ?? "unknown";
  if (typeof d.label === "string" && d.label.trim()) return cut(d.label.trim());

  switch (type) {
    case "trigger": {
      const kws = Array.isArray(d.keywords) ? (d.keywords as Array<{ value?: string }>).map((k) => k.value).filter(Boolean) : [];
      return `Gatilho ${String(d.triggerType ?? "")}${kws.length ? `: ${kws.join(", ")}` : ""}`.trim();
    }
    case "sendMessage": {
      const first = Array.isArray(d.messages) ? (d.messages as Array<{ text?: string }>)[0]?.text : undefined;
      return first ? `Mensagem: ${cut(first)}` : "Mensagem";
    }
    case "setCustomField":
      return `Salvar campo ${String(d.fieldSlug ?? "")}`.trim();
    case "addTag":
      return `Adicionar etiqueta ${String(d.tagName ?? "")}`.trim();
    case "removeTag":
      return `Remover etiqueta ${String(d.tagName ?? "")}`.trim();
    case "smartDelay":
      return "Espera a resposta";
    case "delay":
      return `Espera ${String(d.duration ?? "")} ${String(d.unit ?? "")}`.trim();
    case "sendWhatsAppTemplate":
      return `Template WhatsApp ${String(d.templateName ?? "")}`.trim();
    default:
      return type;
  }
}

/** node id → label, for a flow's raw nodes JSON. */
export function labelMap(nodes: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(nodes)) return map;
  for (const n of nodes as RawNode[]) {
    if (n && typeof n.id === "string") map.set(n.id, nodeLabel(n));
  }
  return map;
}
