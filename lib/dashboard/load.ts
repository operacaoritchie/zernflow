import type { SupabaseClient } from "@supabase/supabase-js";
import { labelMap } from "../mcp/flow-summary";
import {
  between, buildFunnel, dailySeries, delta, groupOrigins, isRealNewContact, leadTimes, mergeFeed,
  orderedFieldSlugs, percent, periodWindow, windowStats,
  type DashPeriod, type DayPoint, type Delta, type FeedItem, type FunnelStage, type OriginRow, type WindowStats,
} from "./metrics";

type Db = SupabaseClient;
const DAY = 86_400_000;

export interface WaitingItem {
  contactId: string;
  name: string | null;
  flow: string;
  stage: string | null;
  since: string;
}

export interface FlowFunnel {
  flowId: string;
  name: string;
  entrants: number;
  stages: Array<FunnelStage & { invalidAttempts: number; invalidPeople: number }>;
}

export interface DashboardData {
  period: DashPeriod;
  from: string;
  to: string;
  results: {
    leads: { value: number; previous: number; delta: Delta };
    conversion: { rate: number | null; previousRate: number | null; leads: number; entrants: number };
    people: { value: number; previous: number; delta: Delta; importedIgnored: number };
  };
  act: { waitingTotal: number; waiting: WaitingItem[]; windows: WindowStats };
  funnels: FlowFunnel[];
  origins: OriginRow[];
  health: {
    messagesFailed: number;
    previousMessagesFailed: number;
    invalidAttempts: number;
    invalidPeople: number;
    broadcastBlocked: number;
    broadcastFailed: number;
    blockedReasons: Array<{ reason: string; count: number }>;
    inactiveChannels: number;
    optOuts: number;
  };
  trend: DayPoint[];
  feed: FeedItem[];
  loadErrors: string[];
}

/** One query result as rows; a failed query becomes [] and is reported, never thrown. */
function rowsOf<T>(res: { data: unknown; error: { message: string } | null }, label: string, errors: string[]): T[] {
  if (res.error) {
    errors.push(`${label}: ${res.error.message}`);
    return [];
  }
  return (res.data ?? []) as T[];
}

function countOf(res: { count: number | null; error: { message: string } | null }, label: string, errors: string[]): number {
  if (res.error) {
    errors.push(`${label}: ${res.error.message}`);
    return 0;
  }
  return res.count ?? 0;
}

interface ContactRow {
  id: string;
  display_name: string | null;
  created_at: string;
  last_interaction_at: string | null;
  opt_out_at: string | null;
}
interface FieldDef {
  id: string;
  slug: string;
  name: string;
  type: string;
}
interface SessionRow {
  contact_id: string;
  flow_id: string;
  status: string;
  created_at: string;
}
interface FlowRow {
  id: string;
  name: string;
  status: string;
  nodes: unknown;
  edges: unknown;
}

export async function loadDashboard(
  supabase: SupabaseClient,
  workspaceId: string,
  period: DashPeriod,
  entryLabel: string,
  now = new Date()
): Promise<DashboardData> {
  const db: Db = supabase;
  const errors: string[] = [];
  const w = periodWindow(period, now);
  const trendDays = Math.max(7, w.days);
  const nowIso = now.toISOString();
  const since24h = new Date(now.getTime() - DAY).toISOString();
  const contactsFrom = new Date(Math.min(w.prevFrom.getTime(), now.getTime() - (trendDays + 1) * DAY)).toISOString();

  // ── Round 1: everything that does not depend on something else ──────────────
  const [
    contactsRes, defsRes, flowsRes, sessionsRes, waitingRes, convsRes, commentsRes,
    failedNow, failedPrev, invalidRes, feedEventsRes, broadcastsRes, channelsRes,
  ] = await Promise.all([
    db.from("contacts").select("id, display_name, created_at, last_interaction_at, opt_out_at")
      .eq("workspace_id", workspaceId).gte("created_at", contactsFrom).order("created_at", { ascending: false }).limit(5000),
    db.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", workspaceId),
    db.from("flows").select("id, name, status, nodes, edges").eq("workspace_id", workspaceId),
    db.from("flow_sessions").select("contact_id, flow_id, status, created_at").gte("created_at", w.prevFrom.toISOString()).limit(10000),
    db.from("flow_sessions").select("contact_id, flow_id, current_node_id, updated_at")
      .eq("status", "active").eq("waiting_for_input", true).order("updated_at", { ascending: true }).limit(500),
    db.from("conversations").select("platform, last_inbound_at").eq("workspace_id", workspaceId).gte("last_inbound_at", since24h).limit(5000),
    db.from("analytics_events").select("contact_id, metadata").eq("workspace_id", workspaceId).eq("event_type", "comment_matched")
      .gte("created_at", w.from.toISOString()).limit(5000),
    db.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("event_type", "message_failed")
      .gte("created_at", w.from.toISOString()),
    db.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("event_type", "message_failed")
      .gte("created_at", w.prevFrom.toISOString()).lt("created_at", w.prevTo.toISOString()),
    db.from("analytics_events").select("flow_id, contact_id, metadata").eq("workspace_id", workspaceId).eq("event_type", "field_invalid")
      .gte("created_at", w.from.toISOString()).limit(2000),
    db.from("analytics_events").select("event_type, contact_id, created_at").eq("workspace_id", workspaceId)
      .in("event_type", ["message_failed", "broadcast_failed", "field_invalid"]).order("created_at", { ascending: false }).limit(15),
    db.from("broadcasts").select("id, skipped, failed").eq("workspace_id", workspaceId).gte("created_at", w.from.toISOString()).limit(200),
    db.from("channels").select("is_active").eq("workspace_id", workspaceId),
  ]);

  const contacts = rowsOf<ContactRow>(contactsRes, "contacts", errors);
  const defs = rowsOf<FieldDef>(defsRes, "fields", errors);
  const flows = rowsOf<FlowRow>(flowsRes, "flows", errors);
  const sessions = rowsOf<SessionRow>(sessionsRes, "sessions", errors);
  const waitingRows = rowsOf<{ contact_id: string; flow_id: string; current_node_id: string | null; updated_at: string }>(waitingRes, "waiting", errors);
  const convs = rowsOf<{ platform: string; last_inbound_at: string | null }>(convsRes, "conversations", errors);
  const comments = rowsOf<{ contact_id: string | null; metadata: Record<string, unknown> | null }>(commentsRes, "comments", errors);
  const invalid = rowsOf<{ flow_id: string | null; contact_id: string | null; metadata: Record<string, unknown> | null }>(invalidRes, "invalid", errors);
  const feedEvents = rowsOf<{ event_type: string; contact_id: string | null; created_at: string }>(feedEventsRes, "feed", errors);
  const broadcasts = rowsOf<{ id: string; skipped: number; failed: number }>(broadcastsRes, "broadcasts", errors);
  const channels = rowsOf<{ is_active: boolean }>(channelsRes, "channels", errors);

  // ── Round 2: values of phone fields (leads) and of the fields each funnel asks ─
  const phoneIds = defs.filter((d) => d.type === "phone").map((d) => d.id);
  const defBySlug = new Map(defs.map((d) => [d.slug, d]));
  const flowStages = flows.filter((f) => f.status === "published").map((f) => ({
    flow: f,
    fields: orderedFieldSlugs(f.nodes, f.edges).map((s) => defBySlug.get(s)).filter((d): d is FieldDef => !!d),
  }));
  const stageFieldIds = Array.from(new Set(flowStages.flatMap((s) => s.fields.map((d) => d.id))));
  const broadcastIds = broadcasts.map((b) => b.id);

  const [leadValuesRes, stageValuesRes, skipRes] = await Promise.all([
    phoneIds.length
      ? db.from("contact_custom_fields").select("contact_id, updated_at").in("field_id", phoneIds).neq("value", "").limit(10000)
      : Promise.resolve({ data: [], error: null }),
    stageFieldIds.length
      ? db.from("contact_custom_fields").select("contact_id, field_id").in("field_id", stageFieldIds).neq("value", "").limit(10000)
      : Promise.resolve({ data: [], error: null }),
    broadcastIds.length
      ? db.from("broadcast_recipients").select("skip_reason").in("broadcast_id", broadcastIds).not("skip_reason", "is", null).limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const leadRows = rowsOf<{ contact_id: string; updated_at: string }>(leadValuesRes, "leads", errors);
  const stageValues = rowsOf<{ contact_id: string; field_id: string }>(stageValuesRes, "stage values", errors);
  const skipRows = rowsOf<{ skip_reason: string }>(skipRes, "skips", errors);

  // ── Results ──────────────────────────────────────────────────────────────────
  const leadAt = leadTimes(leadRows);
  const leadIds = new Set(leadAt.keys());
  const leadsNow = Array.from(leadAt.values()).filter((t) => between(t, w.from, w.to)).length;
  const leadsPrev = Array.from(leadAt.values()).filter((t) => between(t, w.prevFrom, w.prevTo)).length;

  const realPeople = contacts.filter(isRealNewContact);
  const peopleNow = realPeople.filter((c) => between(c.created_at, w.from, w.to)).length;
  const peoplePrev = realPeople.filter((c) => between(c.created_at, w.prevFrom, w.prevTo)).length;
  const importedIgnored = contacts.filter((c) => !isRealNewContact(c) && between(c.created_at, w.from, w.to)).length;

  const entrantsOf = (from: Date, to: Date, flowId?: string) =>
    new Set(sessions.filter((s) => (!flowId || s.flow_id === flowId) && between(s.created_at, from, to)).map((s) => s.contact_id));
  const entrantsNow = entrantsOf(w.from, w.to);
  const entrantsPrev = entrantsOf(w.prevFrom, w.prevTo);
  const converted = (set: Set<string>) => Array.from(set).filter((id) => leadIds.has(id)).length;

  // ── Funnels ──────────────────────────────────────────────────────────────────
  const valuesByField = new Map<string, Set<string>>();
  for (const v of stageValues) {
    const set = valuesByField.get(v.field_id) ?? new Set<string>();
    set.add(v.contact_id);
    valuesByField.set(v.field_id, set);
  }

  const funnels: FlowFunnel[] = flowStages
    .map(({ flow, fields }) => {
      const entrants = entrantsOf(w.from, w.to, flow.id);
      const active = new Set(
        sessions.filter((s) => s.flow_id === flow.id && s.status === "active" && between(s.created_at, w.from, w.to)).map((s) => s.contact_id)
      );
      const stages = buildFunnel({
        entrants,
        activeEntrants: active,
        entryLabel,
        stages: fields.map((d) => ({ label: d.name, contactsWithValue: valuesByField.get(d.id) ?? new Set<string>() })),
      });
      const withInvalid = stages.map((s, i) => {
        if (i === 0) return { ...s, invalidAttempts: 0, invalidPeople: 0 };
        const slug = fields[i - 1].slug;
        const mine = invalid.filter((e) => e.flow_id === flow.id && e.metadata?.fieldSlug === slug);
        return { ...s, invalidAttempts: mine.length, invalidPeople: new Set(mine.map((e) => e.contact_id).filter(Boolean)).size };
      });
      return { flowId: flow.id, name: flow.name, entrants: entrants.size, stages: withInvalid };
    })
    .filter((f) => f.entrants > 0)
    .sort((a, b) => b.entrants - a.entrants)
    .slice(0, 3);

  // ── Act now ──────────────────────────────────────────────────────────────────
  const flowById = new Map(flows.map((f) => [f.id, { name: f.name, labels: labelMap(f.nodes) }]));
  const waitingKnown = waitingRows.filter((r) => flowById.has(r.flow_id));

  // Names for the waiting list and the feed
  const known = new Map(contacts.map((c) => [c.id, c.display_name]));
  const recentLeads = Array.from(leadAt.entries()).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 15);
  const wanted = new Set<string>([
    ...waitingKnown.slice(0, 8).map((r) => r.contact_id),
    ...recentLeads.map(([id]) => id),
    ...feedEvents.map((e) => e.contact_id).filter((id): id is string => !!id),
  ]);
  const missing = Array.from(wanted).filter((id) => !known.has(id)).slice(0, 80);
  if (missing.length) {
    const namesRes = await db.from("contacts").select("id, display_name").eq("workspace_id", workspaceId).in("id", missing);
    for (const r of rowsOf<{ id: string; display_name: string | null }>(namesRes, "names", errors)) known.set(r.id, r.display_name);
  }

  const waiting: WaitingItem[] = waitingKnown.slice(0, 8).map((r) => {
    const f = flowById.get(r.flow_id)!;
    return {
      contactId: r.contact_id,
      name: known.get(r.contact_id) ?? null,
      flow: f.name,
      stage: r.current_node_id ? f.labels.get(r.current_node_id) ?? null : null,
      since: r.updated_at,
    };
  });

  // ── Origin, health, trend, feed ──────────────────────────────────────────────
  const reasons = new Map<string, number>();
  for (const r of skipRows) reasons.set(r.skip_reason, (reasons.get(r.skip_reason) ?? 0) + 1);

  const trend = dailySeries(
    Array.from(leadAt.values()),
    realPeople.map((c) => c.created_at),
    now,
    trendDays
  );

  const feed = mergeFeed(
    [
      ...recentLeads.map(([id, at]): FeedItem => ({ kind: "lead", at, contactName: known.get(id) ?? null })),
      ...realPeople.slice(0, 15).map((c): FeedItem => ({ kind: "new_person", at: c.created_at, contactName: c.display_name })),
      ...feedEvents.map((e): FeedItem => ({
        kind: e.event_type === "field_invalid" ? "field_invalid" : e.event_type === "broadcast_failed" ? "broadcast_failed" : "message_failed",
        at: e.created_at,
        contactName: e.contact_id ? known.get(e.contact_id) ?? null : null,
      })),
    ],
    15
  );

  return {
    period,
    from: w.from.toISOString(),
    to: nowIso,
    results: {
      leads: { value: leadsNow, previous: leadsPrev, delta: delta(leadsNow, leadsPrev) },
      conversion: {
        rate: percent(converted(entrantsNow), entrantsNow.size),
        previousRate: percent(converted(entrantsPrev), entrantsPrev.size),
        leads: converted(entrantsNow),
        entrants: entrantsNow.size,
      },
      people: { value: peopleNow, previous: peoplePrev, delta: delta(peopleNow, peoplePrev), importedIgnored },
    },
    act: { waitingTotal: waitingKnown.length, waiting, windows: windowStats(convs, now) },
    funnels,
    origins: groupOrigins(comments, leadIds),
    health: {
      messagesFailed: countOf(failedNow, "failed", errors),
      previousMessagesFailed: countOf(failedPrev, "failed prev", errors),
      invalidAttempts: invalid.length,
      invalidPeople: new Set(invalid.map((e) => e.contact_id).filter(Boolean)).size,
      broadcastBlocked: broadcasts.reduce((n, b) => n + (b.skipped ?? 0), 0),
      broadcastFailed: broadcasts.reduce((n, b) => n + (b.failed ?? 0), 0),
      blockedReasons: Array.from(reasons.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 3),
      inactiveChannels: channels.filter((c) => !c.is_active).length,
      optOuts: contacts.filter((c) => between(c.opt_out_at, w.from, w.to)).length,
    },
    trend,
    feed,
    loadErrors: errors,
  };
}
