import type { McpTool } from "../types";
import { workspaceOverview } from "./workspace-overview";

/** Phase 0 ships a single tool; Phases 1-3 add the rest. */
export const MCP_TOOLS: McpTool[] = [workspaceOverview];
