/**
 * Resolves a broadcast's segment filter into contact ids. Shared by the send
 * route, the preview route and the scheduled-broadcast cron.
 *
 * Unlike before, unsubscribed contacts are kept in the result: the send
 * policy skips them with the reason "unsubscribed", so the audience preview
 * shows how many were left out and why.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Platform } from "@/lib/types/database";

export interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

export interface SegmentGroup {
  combinator: "and" | "or";
  rules: SegmentRule[];
}

export interface SegmentFilter {
  combinator: "and" | "or";
  groups: SegmentGroup[];
}

const MAX_CONTACTS = 10000;
const PAGE = 1000;

async function allContactIds(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; from < MAX_CONTACTS; from += PAGE) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`could not load contacts: ${error.message}`);
    ids.push(...(data ?? []).map((c) => c.id));
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

export function hasSegmentRules(filter: unknown): boolean {
  const f = filter as SegmentFilter | null;
  return !!f?.groups?.some((g) => (g.rules ?? []).length > 0);
}

export async function resolveSegmentContacts(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  rawFilter: unknown
): Promise<string[]> {
  const all = await allContactIds(supabase, workspaceId);
  const filter = rawFilter as SegmentFilter | null;
  if (!filter || !hasSegmentRules(filter) || all.length === 0) return all;

  const allIds = new Set(all);
  const groupResults: Set<string>[] = [];

  for (const group of filter.groups) {
    if (!group.rules?.length) continue;
    const ruleResults: Set<string>[] = [];
    for (const rule of group.rules) {
      ruleResults.push(await evaluateRule(supabase, workspaceId, rule, allIds));
    }
    groupResults.push(group.combinator === "or" ? unionSets(ruleResults) : intersectSets(ruleResults));
  }

  const final = filter.combinator === "or" ? unionSets(groupResults) : intersectSets(groupResults);
  return Array.from(final);
}

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 300) out.push(...(await fn(ids.slice(i, i + 300))));
  return out;
}

async function evaluateRule(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  rule: SegmentRule,
  allContactIds: Set<string>
): Promise<Set<string>> {
  const contactIds = Array.from(allContactIds);

  switch (rule.field) {
    case "has_tag":
    case "missing_tag": {
      const { data: tag } = await supabase
        .from("tags")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", rule.value)
        .maybeSingle();

      if (!tag) return rule.field === "missing_tag" ? new Set(contactIds) : new Set();

      const tagged = await inChunks(contactIds, async (chunk) => {
        const { data } = await supabase
          .from("contact_tags")
          .select("contact_id")
          .eq("tag_id", tag.id)
          .in("contact_id", chunk);
        return (data ?? []).map((t) => t.contact_id);
      });
      const taggedSet = new Set(tagged);
      return rule.field === "has_tag"
        ? taggedSet
        : new Set(contactIds.filter((id) => !taggedSet.has(id)));
    }

    case "platform": {
      const { data: channels } = await supabase
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("platform", rule.value as Platform);

      if (!channels?.length) {
        return rule.operator === "not_equals" ? new Set(contactIds) : new Set();
      }

      const channelIds = channels.map((c) => c.id);
      const linked = await inChunks(contactIds, async (chunk) => {
        const { data } = await supabase
          .from("contact_channels")
          .select("contact_id")
          .in("channel_id", channelIds)
          .in("contact_id", chunk);
        return (data ?? []).map((l) => l.contact_id);
      });
      const linkedSet = new Set(linked);
      if (rule.operator === "not_equals") {
        return new Set(contactIds.filter((id) => !linkedSet.has(id)));
      }
      return linkedSet;
    }

    case "is_subscribed": {
      const wanted = rule.value !== "false";
      const rows = await inChunks(contactIds, async (chunk) => {
        const { data } = await supabase
          .from("contacts")
          .select("id")
          .eq("is_subscribed", wanted)
          .in("id", chunk);
        return (data ?? []).map((c) => c.id);
      });
      return new Set(rows);
    }

    case "last_interaction": {
      const parsed = new Date(rule.value);
      if (Number.isNaN(parsed.getTime())) return new Set(contactIds);
      const date = parsed.toISOString();
      const rows = await inChunks(contactIds, async (chunk) => {
        let query = supabase.from("contacts").select("id").in("id", chunk);
        query = rule.operator === "before" ? query.lt("last_interaction_at", date) : query.gt("last_interaction_at", date);
        const { data } = await query;
        return (data ?? []).map((c) => c.id);
      });
      return new Set(rows);
    }

    case "custom_field": {
      // rule.value format: "field_slug:actual_value"
      const [slug, ...rest] = rule.value.split(":");
      const fieldValue = rest.join(":");

      const { data: fieldDef } = await supabase
        .from("custom_field_definitions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("slug", slug)
        .maybeSingle();

      if (!fieldDef) return new Set();

      const rows = await inChunks(contactIds, async (chunk) => {
        let cfQuery = supabase
          .from("contact_custom_fields")
          .select("contact_id")
          .eq("field_id", fieldDef.id)
          .in("contact_id", chunk);

        switch (rule.operator) {
          case "equals":
            cfQuery = cfQuery.eq("value", fieldValue);
            break;
          case "not_equals":
            cfQuery = cfQuery.neq("value", fieldValue);
            break;
          case "contains":
            cfQuery = cfQuery.ilike("value", `%${fieldValue}%`);
            break;
          case "gt":
            cfQuery = cfQuery.gt("value", fieldValue);
            break;
          case "lt":
            cfQuery = cfQuery.lt("value", fieldValue);
            break;
        }
        const { data } = await cfQuery;
        return (data ?? []).map((c) => c.contact_id);
      });
      return new Set(rows);
    }

    default:
      return new Set(contactIds);
  }
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  const result = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    for (const item of result) {
      if (!sets[i].has(item)) result.delete(item);
    }
  }
  return result;
}

function unionSets(sets: Set<string>[]): Set<string> {
  const result = new Set<string>();
  for (const s of sets) for (const item of s) result.add(item);
  return result;
}
