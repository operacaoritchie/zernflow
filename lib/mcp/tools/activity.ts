import { dbOf, groupCount, isoDate, limitArg, must, offsetArg, optUuid, page, paging, readTool, str } from "./helpers";

export const activityLog = readTool({
  name: "activity_log",
  title: "Recent automation activity",
  description:
    "Recent analytics events (flow started/completed, message sent/failed, node executed…), newest first, plus a count by event type. Filter by flow, contact, type or date.",
  properties: {
    flow_id: { type: "string", description: "Only this flow (uuid)." },
    contact_id: { type: "string", description: "Only this contact (uuid)." },
    event_type: { type: "string", description: "e.g. flow_started, flow_completed, message_sent, message_failed." },
    from: { type: "string", description: "ISO date/time, inclusive." },
    to: { type: "string", description: "ISO date/time, inclusive." },
    ...paging,
  },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const limit = limitArg(args);
    const offset = offsetArg(args);
    let q = db
      .from("analytics_events")
      .select("id, flow_id, contact_id, event_type, metadata, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);
    const flowId = optUuid(args, "flow_id");
    if (flowId) q = q.eq("flow_id", flowId);
    const contactId = optUuid(args, "contact_id");
    if (contactId) q = q.eq("contact_id", contactId);
    const type = str(args, "event_type", 60);
    if (type) q = q.eq("event_type", type);
    const from = isoDate(args, "from");
    if (from) q = q.gte("created_at", from);
    const to = isoDate(args, "to");
    if (to) q = q.lte("created_at", to);
    const rows = must(await q, "events") as Array<{ event_type: string }>;
    return { ...page(rows, limit, offset), by_type_on_page: groupCount(rows.slice(0, limit), (r) => r.event_type) };
  },
});

export const ACTIVITY_TOOLS = [activityLog];
