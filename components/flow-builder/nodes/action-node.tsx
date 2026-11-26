"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Tag,
  FileText,
  Globe,
  ArrowRightLeft,
  UserCheck,
  Bell,
  Shuffle,
  Hourglass,
  Cog,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/types/database";
import { useT } from "@/lib/i18n/provider";
import type { Translator } from "@/lib/i18n/translator";
import { NodeAnalyticsBadge } from "../node-analytics-badge";

export interface ActionNodeProps {
  label?: string;
  actionType?: NodeType;
  tagName?: string;
  action?: "add" | "remove";
  fieldSlug?: string;
  value?: string;
  method?: string;
  url?: string;
  flowId?: string;
  message?: string;
  paths?: Array<{ name: string; weight: number }>;
  timeout?: number;
  timeoutUnit?: string;
  templateName?: string;
  phone?: string;
}

const actionConfig: Record<
  string,
  { icon: typeof Cog; label: string; color: string }
> = {
  addTag: {
    icon: Tag,
    label: "Add Tag",
    color: "bg-gray-500",
  },
  removeTag: {
    icon: Tag,
    label: "Remove Tag",
    color: "bg-gray-500",
  },
  setCustomField: {
    icon: FileText,
    label: "Set Field",
    color: "bg-gray-500",
  },
  httpRequest: {
    icon: Globe,
    label: "HTTP Request",
    color: "bg-gray-500",
  },
  goToFlow: {
    icon: ArrowRightLeft,
    label: "Go To Flow",
    color: "bg-gray-500",
  },
  humanTakeover: {
    icon: UserCheck,
    label: "Human Takeover",
    color: "bg-gray-500",
  },
  subscribe: {
    icon: Bell,
    label: "Subscribe",
    color: "bg-gray-500",
  },
  unsubscribe: {
    icon: Bell,
    label: "Unsubscribe",
    color: "bg-gray-500",
  },
  commentReply: {
    icon: Cog,
    label: "Comment Reply",
    color: "bg-gray-500",
  },
  privateReply: {
    icon: Cog,
    label: "Private Reply",
    color: "bg-gray-500",
  },
  abSplit: {
    icon: Shuffle,
    label: "A/B Split",
    color: "bg-gray-500",
  },
  smartDelay: {
    icon: Hourglass,
    label: "Smart Delay",
    color: "bg-gray-500",
  },
  sendWhatsAppTemplate: {
    icon: MessageCircle,
    label: "WhatsApp Template",
    color: "bg-green-600",
  },
};

function getSummary(nodeData: ActionNodeProps, t: Translator): string | null {
  const type = nodeData.actionType;
  if (!type) return null;

  switch (type) {
    case "addTag":
      return nodeData.tagName ? t("summary.addTag", { tag: nodeData.tagName }) : null;
    case "removeTag":
      return nodeData.tagName ? t("summary.removeTag", { tag: nodeData.tagName }) : null;
    case "setCustomField":
      return nodeData.fieldSlug
        ? `${nodeData.fieldSlug} = ${nodeData.value || "..."}`
        : null;
    case "httpRequest":
      return nodeData.url
        ? `${nodeData.method || "GET"} ${nodeData.url}`
        : null;
    case "goToFlow":
      return nodeData.flowId ? t("summary.flow", { id: nodeData.flowId.slice(0, 8) }) : null;
    case "humanTakeover":
      return nodeData.message || t("summary.handOff");
    case "subscribe":
      return t("summary.subscribe");
    case "unsubscribe":
      return t("summary.unsubscribe");
    case "abSplit":
      if (nodeData.paths && nodeData.paths.length > 0) {
        return nodeData.paths.map((p) => `${p.name}: ${p.weight}%`).join(", ");
      }
      return null;
    case "sendWhatsAppTemplate":
      return nodeData.templateName
        ? t("summary.waTemplate", { template: nodeData.templateName, phone: nodeData.phone || "?" })
        : null;
    case "smartDelay":
      return nodeData.timeout
        ? t("summary.waitUpTo", { value: nodeData.timeout, unit: t(`units.${nodeData.timeoutUnit || "minutes"}`) })
        : null;
    default:
      return null;
  }
}

export function ActionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ActionNodeProps;
  const t = useT("builder");
  const actionType = nodeData.actionType || "addTag";
  const config = actionConfig[actionType] || {
    icon: Cog,
    label: "action",
    color: "bg-gray-500",
  };
  const Icon = config.icon;
  const typeLabel = t(`nodeTypes.${actionConfig[actionType] ? actionType : "action"}`);
  const label = nodeData.label || typeLabel;
  const summary = getSummary(nodeData, t);

  const isAbSplit = actionType === "abSplit";
  // Extra output for an outcome: an invalid value on Set Field, no reply in
  // time on a wait. The engine follows it only on that outcome.
  const outcomeHandle =
    actionType === "setCustomField" ? "invalid" : actionType === "smartDelay" ? "timeout" : null;
  const paths = isAbSplit ? nodeData.paths || [] : [];

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-gray-400 shadow-md" : "border-border"
      )}
    >
      <NodeAnalyticsBadge nodeId={id} />
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-gray-400 !bg-white"
      />
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-lg px-3 py-2 text-white",
          config.color
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">{typeLabel}</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{label}</p>
        {summary ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground italic">{t("notConfigured")}</p>
        )}
      </div>
      {isAbSplit && paths.length > 0 ? (
        <>
          {paths.map((path, i) => (
            <Handle
              key={path.name}
              type="source"
              position={Position.Bottom}
              id={`split-${i}`}
              style={{ left: `${((i + 1) / (paths.length + 1)) * 100}%` }}
              className="!h-3 !w-3 !border-2 !border-gray-400 !bg-white"
            />
          ))}
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-gray-400 !bg-white"
        />
      )}
      {outcomeHandle && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={outcomeHandle}
            className="!h-3 !w-3 !border-2 !border-amber-500 !bg-white"
          />
          <span className="pointer-events-none absolute -right-1 top-1/2 translate-x-full -translate-y-1/2 pl-2 text-[10px] font-medium text-amber-600">
            {t(`handles.${outcomeHandle}`)}
          </span>
        </>
      )}
    </div>
  );
}
