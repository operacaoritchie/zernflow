import { labelMap } from "../flow-summary";
import { maskEmail, maskFieldValue } from "../mask";
import { isPeriod, periodRange, PERIODS } from "../period";
import { dbOf, type Db, isoDate, limitArg, must, offsetArg, page, paging, readTool, safeLike, str, uuid, bool } from "./helpers";

interface SessionRow {
  contact_id: string;
  flow_id: string;
  status: string;
  current_node_id: string | null;
  waiting_for_input: boolean;
  waiting_until: string | null;
  updated_at: string;
}

/** The latest flow session of each contact (active ones first), with where it stopped. */
async function progressFor(db: Db, workspaceId: string, contactIds: string[]) {
  const out = new Map<string, unknown>();
  if (contactIds.length === 0) return out;
  const sessions = must(
    await db
      .from("flow_sessions")
      .select("contact_id, flow_id, status, current_node_id, waiting_for_input, waiting_until, updated_at")
      .in("contact_id", contactIds)
      .order("updated_at", { ascending: false })
      .limit(1000),
    "sessions"
  ) as SessionRow[];

  const flowIds = Array.from(new Set(sessions.map((s) => s.flow_id)));
  const flows = flowIds.length
    ? (must(await db.from("flows").select("id, name, nodes").eq("workspace_id", workspaceId).in("id", flowIds), "flows") as Array<{
        id: string; name: string; nodes: unknown;
      }>)
    : [];
  const flowById = new Map(flows.map((f) => [f.id, { name: f.name, labels: labelMap(f.nodes) }]));

  for (const id of contactIds) {
    const mine = sessions.filter((s) => s.contact_id === id && flowById.has(s.flow_id));
    const pick = mine.find((s) => s.status === "active") ?? mine[0];
    if (!pick) continue;
    const f = flowById.get(pick.flow_id)!;
    out.set(id, {
      flow: f.name,
      flow_id: pick.flow_id,
      status: pick.status,
      stopped_at: pick.current_node_id ? f.labels.get(pick.current_node_id) ?? pick.current_node_id : null,
      waiting_for_reply: pick.waiting_for_input,
      waiting_until: pick.waiting_until,
      updated_at: pick.updated_at,
    });
  }
  return out;
}

export const contactsSearch = readTool({
  name: "contacts_search",
  title: "Search contacts",
  description:
    "Finds contacts by text, tag, channel or date, and shows for each one the tags, channels, masked phone/e-mail/CPF and where their latest flow stopped. " +
    "Use period=today to answer 'how many leads came in today and where each one stopped'. Phone, e-mail and CPF are masked; contact_get returns one contact in full.",
  properties: {
    text: { type: "string", description: "Part of the name or e-mail." },
    tag: { type: "string", description: "Tag name (exact, not case-sensitive)." },
    platform: { type: "string", enum: ["instagram", "whatsapp", "facebook", "telegram", "twitter", "bluesky", "reddit"], description: "Only contacts who talked on this platform." },
    period: { type: "string", enum: [...PERIODS], description: "When the contact was created, in Brazil time (today, yesterday, last_7_days, last_30_days)." },
    created_from: { type: "string", description: "ISO date/time; created at or after. Overrides period." },
    created_to: { type: "string", description: "ISO date/time; created before." },
    interacted_from: { type: "string", description: "ISO date/time; last interaction at or after." },
    subscribed: { type: "boolean", description: "Filter by subscription state." },
    ...paging,
  },
  async run(args, ctx) {
    const db = dbOf(ctx);
    const limit = limitArg(args);
    const offset = offsetArg(args);

    let tagId: string | null = null;
    const tagName = str(args, "tag", 80);
    if (tagName) {
      const tags = must(
        await db.from("tags").select("id").eq("workspace_id", ctx.workspaceId).ilike("name", safeLike(tagName)).limit(1),
        "tags"
      ) as Array<{ id: string }>;
      if (tags.length === 0) return { items: [], has_more: false, next_offset: null, total: 0, note: `No tag named "${tagName}".` };
      tagId = tags[0].id;
    }

    let channelIds: string[] | null = null;
    const platform = str(args, "platform", 20);
    if (platform) {
      const chans = must(
        await db.from("channels").select("id").eq("workspace_id", ctx.workspaceId).eq("platform", platform),
        "channels"
      ) as Array<{ id: string }>;
      if (chans.length === 0) return { items: [], has_more: false, next_offset: null, total: 0, note: `No ${platform} channel.` };
      channelIds = chans.map((c) => c.id);
    }

    const select =
      "id, display_name, email, is_subscribed, last_interaction_at, created_at, opt_in_whatsapp_at, opt_out_at" +
      (tagId ? ", contact_tags!inner(tag_id)" : "") +
      (channelIds ? ", contact_channels!inner(channel_id)" : "");

    let q = db
      .from("contacts")
      .select(select, { count: "exact" })
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);

    if (tagId) q = q.eq("contact_tags.tag_id", tagId);
    if (channelIds) q = q.in("contact_channels.channel_id", channelIds);

    const periodArg = str(args, "period", 20);
    if (periodArg && !isPeriod(periodArg)) throw new Error(`period must be one of: ${PERIODS.join(", ")}`);
    const range = periodArg && isPeriod(periodArg) ? periodRange(periodArg) : null;
    const createdFrom = isoDate(args, "created_from") ?? range?.from;
    const createdTo = isoDate(args, "created_to") ?? (isoDate(args, "created_from") ? undefined : range?.to ?? undefined);
    if (createdFrom) q = q.gte("created_at", createdFrom);
    if (createdTo) q = q.lt("created_at", createdTo);
    const interacted = isoDate(args, "interacted_from");
    if (interacted) q = q.gte("last_interaction_at", interacted);
    const subscribed = bool(args, "subscribed");
    if (subscribed !== undefined) q = q.eq("is_subscribed", subscribed);
    const text = str(args, "text", 80);
    if (text) {
      const t = safeLike(text);
      if (t) q = q.or(`display_name.ilike.%${t}%,email.ilike.%${t}%`);
    }

    const res = await q;
    if (res.error) throw new Error(`contacts: ${res.error.message}`);
    const rows = (res.data ?? []) as unknown as Array<{
      id: string; display_name: string | null; email: string | null; is_subscribed: boolean;
      last_interaction_at: string | null; created_at: string; opt_in_whatsapp_at: string | null; opt_out_at: string | null;
    }>;
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    const pageRows = unique.slice(0, limit);
    const ids = pageRows.map((r) => r.id);

    const [tagRows, fieldRows, chanRows, progress] = await Promise.all([
      ids.length ? db.from("contact_tags").select("contact_id, tags(name)").in("contact_id", ids) : { data: [], error: null },
      ids.length
        ? db.from("contact_custom_fields").select("contact_id, value, custom_field_definitions(slug, type)").in("contact_id", ids)
        : { data: [], error: null },
      ids.length
        ? db.from("contact_channels").select("contact_id, platform_username, channels(platform)").in("contact_id", ids)
        : { data: [], error: null },
      progressFor(db, ctx.workspaceId, ids),
    ]);

    type Rel<T> = T | T[] | null;
    const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);
    const tagsBy = new Map<string, string[]>();
    for (const r of (must(tagRows as never, "tags") as unknown as Array<{ contact_id: string; tags: Rel<{ name: string }> }>)) {
      const name = one(r.tags)?.name;
      if (name) tagsBy.set(r.contact_id, [...(tagsBy.get(r.contact_id) ?? []), name]);
    }
    const fieldsBy = new Map<string, Record<string, string | null>>();
    for (const r of (must(fieldRows as never, "fields") as unknown as Array<{
      contact_id: string; value: string; custom_field_definitions: Rel<{ slug: string; type: string }>;
    }>)) {
      const def = one(r.custom_field_definitions);
      if (!def) continue;
      const cur = fieldsBy.get(r.contact_id) ?? {};
      cur[def.slug] = maskFieldValue(def.type, def.slug, r.value);
      fieldsBy.set(r.contact_id, cur);
    }
    const chansBy = new Map<string, Array<{ platform: string | null; username: string | null }>>();
    for (const r of (must(chanRows as never, "channels") as unknown as Array<{
      contact_id: string; platform_username: string | null; channels: Rel<{ platform: string }>;
    }>)) {
      chansBy.set(r.contact_id, [
        ...(chansBy.get(r.contact_id) ?? []),
        { platform: one(r.channels)?.platform ?? null, username: r.platform_username },
      ]);
    }

    const items = pageRows.map((c) => ({
      id: c.id,
      name: c.display_name,
      email: maskEmail(c.email),
      subscribed: c.is_subscribed,
      created_at: c.created_at,
      last_interaction_at: c.last_interaction_at,
      whatsapp_opt_in: !!c.opt_in_whatsapp_at,
      opted_out: !!c.opt_out_at,
      channels: chansBy.get(c.id) ?? [],
      tags: tagsBy.get(c.id) ?? [],
      fields: fieldsBy.get(c.id) ?? {},
      latest_flow: progress.get(c.id) ?? null,
    }));

    return { ...page(items, limit, offset), total: res.count ?? null };
  },
});

export const contactGet = readTool({
  name: "contact_get",
  title: "Get one contact in full",
  description:
    "One contact with every field. This is the only tool that returns phone, e-mail and CPF in full; each call is logged. " +
    "Also returns tags, channels, conversations with the 24h window, flow sessions and sequence enrollments.",
  properties: { contact_id: { type: "string", description: "Contact id (uuid)." } },
  required: ["contact_id"],
  async run(args, ctx) {
    const db = dbOf(ctx);
    const id = uuid(args, "contact_id");
    const contact = must(
      await db
        .from("contacts")
        .select("id, display_name, email, avatar_url, is_subscribed, last_interaction_at, created_at, opt_in_whatsapp_at, opt_in_source, opt_out_at, opt_out_reason")
        .eq("id", id)
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle(),
      "contact"
    ) as Record<string, unknown> | never[];
    if (Array.isArray(contact)) throw new Error("Contact not found in this workspace");

    const [tags, fields, chans, convs, enrollments, progress] = await Promise.all([
      db.from("contact_tags").select("tags(name)").eq("contact_id", id),
      db.from("contact_custom_fields").select("value, updated_at, custom_field_definitions(name, slug, type)").eq("contact_id", id),
      db.from("contact_channels").select("platform_sender_id, platform_username, channels(platform, display_name)").eq("contact_id", id),
      db
        .from("conversations")
        .select("id, platform, status, last_message_at, last_inbound_at, unread_count, is_automation_paused")
        .eq("workspace_id", ctx.workspaceId)
        .eq("contact_id", id)
        .order("last_message_at", { ascending: false })
        .limit(10),
      db
        .from("sequence_enrollments")
        .select("status, current_step_index, enrolled_at, next_step_at, exit_reason, sequences(name)")
        .eq("contact_id", id)
        .order("enrolled_at", { ascending: false })
        .limit(10),
      progressFor(db, ctx.workspaceId, [id]),
    ]);

    type Rel<T> = T | T[] | null;
    const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);
    const now = Date.now();

    return {
      contact,
      tags: (must(tags as never, "tags") as unknown as Array<{ tags: Rel<{ name: string }> }>).map((t) => one(t.tags)?.name).filter(Boolean),
      fields: (must(fields as never, "fields") as unknown as Array<{
        value: string; updated_at: string; custom_field_definitions: Rel<{ name: string; slug: string; type: string }>;
      }>).map((f) => ({ ...one(f.custom_field_definitions), value: f.value, updated_at: f.updated_at })),
      channels: (must(chans as never, "channels") as unknown as Array<{
        platform_sender_id: string; platform_username: string | null; channels: Rel<{ platform: string; display_name: string | null }>;
      }>).map((c) => ({ sender_id: c.platform_sender_id, username: c.platform_username, ...one(c.channels) })),
      conversations: (must(convs as never, "conversations") as unknown as Array<Record<string, unknown> & { last_inbound_at: string | null }>).map((c) => ({
        ...c,
        window_24h_open: c.last_inbound_at ? now - new Date(c.last_inbound_at).getTime() < 24 * 3600 * 1000 : false,
      })),
      sequences: (must(enrollments as never, "enrollments") as unknown as Array<Record<string, unknown> & { sequences: Rel<{ name: string }> }>).map(
        ({ sequences, ...e }) => ({ ...e, sequence: one(sequences)?.name ?? null })
      ),
      latest_flow: progress.get(id) ?? null,
    };
  },
});

export const CONTACT_TOOLS = [contactsSearch, contactGet];
