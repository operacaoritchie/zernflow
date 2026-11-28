import { maskText } from "../mask";
import { dbOf, isoDate, limitArg, must, offsetArg, optUuid, page, paging, readTool, str, uuid, bool } from "./helpers";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export const conversationsList = readTool({
  name: "conversations_list",
  title: "List conversations",
  description:
    "Inbox conversations, most recent first, with the last message preview, unread count and whether automation is paused. Filter by status, unread, platform or contact.",
  properties: {
    status: { type: "string", enum: ["open", "closed", "snoozed"], description: "Conversation status." },
    unread_only: { type: "boolean" },
    platform: { type: "string", description: "instagram, whatsapp, facebook, telegram…" },
    contact_id: { type: "string", description: "Only this contact (uuid)." },
    automation_paused: { type: "boolean", description: "Only conversations a person took over." },
    since: { type: "string", description: "ISO date/time; last message at or after." },
    ...paging,
  },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const limit = limitArg(args);
    const offset = offsetArg(args);
    let q = db
      .from("conversations")
      .select(
        "id, platform, status, assigned_to, last_message_at, last_inbound_at, last_message_preview, unread_count, is_automation_paused, contacts(id, display_name)",
        { count: "exact" }
      )
      .eq("workspace_id", ctx.workspaceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit);
    const status = str(args, "status", 20);
    if (status) q = q.eq("status", status);
    if (bool(args, "unread_only")) q = q.gt("unread_count", 0);
    const platform = str(args, "platform", 20);
    if (platform) q = q.eq("platform", platform);
    const contactId = optUuid(args, "contact_id");
    if (contactId) q = q.eq("contact_id", contactId);
    const paused = bool(args, "automation_paused");
    if (paused !== undefined) q = q.eq("is_automation_paused", paused);
    const since = isoDate(args, "since");
    if (since) q = q.gte("last_message_at", since);

    const res = await q;
    if (res.error) throw new Error(`conversations: ${res.error.message}`);
    const now = Date.now();
    const rows = (res.data ?? []) as unknown as Array<Record<string, unknown> & {
      contacts: Rel<{ id: string; display_name: string | null }>; last_inbound_at: string | null;
    }>;
    const items = rows.map(({ contacts, ...c }) => ({
      ...c,
      last_message_preview: maskText(c.last_message_preview as string | null),
      contact: one(contacts),
      window_24h_open: c.last_inbound_at ? now - new Date(c.last_inbound_at).getTime() < 24 * 3600 * 1000 : false,
    }));
    return { ...page(items, limit, offset), total: res.count ?? null };
  },
});

export const conversationMessages = readTool({
  name: "conversation_messages",
  title: "Read a conversation's messages",
  description:
    "Messages of one conversation (newest first) with direction, text, status and which flow node sent them. Message text is returned as written by the contact.",
  properties: { conversation_id: { type: "string", description: "Conversation id (uuid)." }, ...paging },
  required: ["conversation_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const id = uuid(args, "conversation_id");
    const own = must(
      await db.from("conversations").select("id, contact_id, platform, status").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle(),
      "conversation"
    ) as unknown as { id: string; contact_id: string; platform: string; status: string } | never[];
    if (Array.isArray(own)) throw new Error("Conversation not found in this workspace");

    const limit = limitArg(args, 30);
    const offset = offsetArg(args);
    const rows = must(
      await db
        .from("messages")
        .select("id, direction, text, status, created_at, sent_by_flow_id, sent_by_node_id, sent_by_user_id, quick_reply_payload, postback_payload, attachments")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit),
      "messages"
    ) as Array<Record<string, unknown> & { attachments: unknown }>;
    const items = rows.map(({ attachments, ...m }) => ({
      ...m,
      text: maskText(m.text as string | null),
      attachment_count: Array.isArray(attachments) ? attachments.length : 0,
    }));
    return { conversation: own, ...page(items, limit, offset) };
  },
});
