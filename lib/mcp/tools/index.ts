import type { McpTool } from "../types";
import { workspaceOverview } from "./workspace-overview";
import { FLOW_TOOLS } from "./flows";
import { CONTACT_TOOLS } from "./contacts";
import { CATALOG_TOOLS } from "./catalog";
import { conversationsList, conversationMessages } from "./inbox";
import { BROADCAST_TOOLS } from "./broadcasts";
import { SEQUENCE_TOOLS } from "./sequences";
import { TEMPLATE_TOOLS } from "./templates";
import { ACTIVITY_TOOLS } from "./activity";
import { FLOW_CHECK_TOOLS } from "./flow-check";
import { FLOW_WRITE_TOOLS } from "./flows-write";
import { CONTACT_WRITE_TOOLS } from "./contacts-write";
import { CATALOG_WRITE_TOOLS } from "./catalog-write";
import { DRAFT_TOOLS } from "./drafts-write";

export const MCP_TOOLS: McpTool[] = [
  workspaceOverview,
  ...FLOW_TOOLS,
  ...CONTACT_TOOLS,
  ...CATALOG_TOOLS,
  conversationsList,
  conversationMessages,
  ...BROADCAST_TOOLS,
  ...SEQUENCE_TOOLS,
  ...TEMPLATE_TOOLS,
  ...ACTIVITY_TOOLS,
  ...FLOW_CHECK_TOOLS,
  // scope "write": changes data, never messages a lead
  ...FLOW_WRITE_TOOLS,
  ...CONTACT_WRITE_TOOLS,
  ...CATALOG_WRITE_TOOLS,
  ...DRAFT_TOOLS,
];
