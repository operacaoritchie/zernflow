import { startOfBrazilDay } from "../mcp/period";

/**
 * Pure rules behind the Início panel: periods, what counts as a real new
 * person, funnel stages, origins and the 24h window. No database access here,
 * so every rule is unit-tested.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BR_OFFSET_MS = -3 * HOUR;

// ── Period ───────────────────────────────────────────────────────────────────

export const DASH_PERIODS = ["today", "7d", "30d"] as const;
export type DashPeriod = (typeof DASH_PERIODS)[number];

export function parsePeriod(value: unknown): DashPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return (DASH_PERIODS as readonly string[]).includes(v as string) ? (v as DashPeriod) : "7d";
}

export interface PeriodWindow {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  days: number;
}

/** Brazilian calendar days. The previous period has the same length and ends where this one starts. */
export function periodWindow(period: DashPeriod, now: Date): PeriodWindow {
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const from = new Date(startOfBrazilDay(now).getTime() - (days - 1) * DAY);
  const length = now.getTime() - from.getTime();
  return { from, to: now, prevFrom: new Date(from.getTime() - length), prevTo: from, days };
}

/** [from, to) */
export function between(iso: string | null | undefined, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

export function dayKey(iso: string): string {
  return new Date(new Date(iso).getTime() + BR_OFFSET_MS).toISOString().slice(0, 10);
}

// ── People and leads ─────────────────────────────────────────────────────────

/**
 * Contacts synced from old conversations are created "now" but their last
 * interaction is in the past. Someone who really just arrived interacted at
 * (or after) the moment they were created.
 */
export function isRealNewContact(c: { created_at: string; last_interaction_at: string | null }): boolean {
  if (!c.last_interaction_at) return true;
  return new Date(c.last_interaction_at).getTime() >= new Date(c.created_at).getTime() - MIN;
}

/** Earliest time each contact had a phone saved: when they became a lead. */
export function leadTimes(rows: Array<{ contact_id: string; updated_at: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const cur = out.get(r.contact_id);
    if (!cur || r.updated_at < cur) out.set(r.contact_id, r.updated_at);
  }
  return out;
}

export interface Delta {
  pct: number | null;
  direction: "up" | "down" | "flat";
}

export function delta(current: number, previous: number): Delta {
  if (current === previous) return { pct: previous === 0 ? null : 0, direction: "flat" };
  if (previous === 0) return { pct: null, direction: "up" };
  return { pct: Math.round(((current - previous) / previous) * 100), direction: current > previous ? "up" : "down" };
}

export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

// ── Series ───────────────────────────────────────────────────────────────────

export interface DayPoint {
  day: string;
  leads: number;
  people: number;
}

/** The last `days` Brazilian days ending today, with the count of each series per day. */
export function dailySeries(leadIso: string[], peopleIso: string[], now: Date, days: number): DayPoint[] {
  const today = startOfBrazilDay(now).getTime();
  const points: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(new Date(today - i * DAY).toISOString());
    const p = { day, leads: 0, people: 0 };
    points.push(p);
    index.set(day, p);
  }
  for (const iso of leadIso) {
    const p = index.get(dayKey(iso));
    if (p) p.leads++;
  }
  for (const iso of peopleIso) {
    const p = index.get(dayKey(iso));
    if (p) p.people++;
  }
  return points;
}

// ── Funnel ───────────────────────────────────────────────────────────────────

export interface FunnelStage {
  label: string;
  reached: number;
  /** Share of the people who entered, null when nobody entered. */
  pctOfEntrants: number | null;
  /** Still in the flow and waiting at this stage. */
  waiting: number;
  /** Left after this stage without going on and without waiting. */
  dropped: number;
}

/**
 * Stage 0 is "entered the flow"; every other stage is a field the flow asks
 * for, reached when the person has a value saved for it.
 */
export function buildFunnel(input: {
  entrants: Set<string>;
  activeEntrants: Set<string>;
  stages: Array<{ label: string; contactsWithValue: Set<string> }>;
  entryLabel: string;
}): FunnelStage[] {
  const { entrants, activeEntrants, stages, entryLabel } = input;
  const reachedSets: Array<Set<string>> = [entrants];
  for (const s of stages) reachedSets.push(new Set([...s.contactsWithValue].filter((id) => entrants.has(id))));

  const lastStage = (id: string) => {
    let last = 0;
    for (let i = 1; i < reachedSets.length; i++) if (reachedSets[i].has(id)) last = i;
    return last;
  };
  const waiting = new Array<number>(reachedSets.length).fill(0);
  for (const id of activeEntrants) if (entrants.has(id)) waiting[lastStage(id)]++;

  const labels = [entryLabel, ...stages.map((s) => s.label)];
  return reachedSets.map((set, i) => {
    const next = reachedSets[i + 1];
    return {
      label: labels[i],
      reached: set.size,
      pctOfEntrants: percent(set.size, entrants.size),
      waiting: waiting[i],
      dropped: next ? Math.max(0, set.size - next.size - waiting[i]) : 0,
    };
  });
}

// ── Origin (posts and lives) ─────────────────────────────────────────────────

export interface OriginRow {
  postId: string;
  isLive: boolean;
  comments: number;
  dms: number;
  leads: number;
}

export function groupOrigins(
  events: Array<{ contact_id: string | null; metadata: Record<string, unknown> | null }>,
  leadIds: Set<string>,
  limit = 5
): OriginRow[] {
  const by = new Map<string, OriginRow & { people: Set<string> }>();
  for (const e of events) {
    const postId = typeof e.metadata?.postId === "string" ? e.metadata.postId : null;
    if (!postId) continue;
    const row = by.get(postId) ?? { postId, isLive: false, comments: 0, dms: 0, leads: 0, people: new Set<string>() };
    row.comments++;
    if (e.metadata?.dmSent === true) row.dms++;
    if (e.metadata?.isLive === true) row.isLive = true;
    if (e.contact_id && leadIds.has(e.contact_id) && !row.people.has(e.contact_id)) {
      row.people.add(e.contact_id);
      row.leads++;
    }
    by.set(postId, row);
  }
  return Array.from(by.values())
    .map(({ people: _people, ...r }) => r)
    .sort((a, b) => b.leads - a.leads || b.comments - a.comments)
    .slice(0, limit);
}

// ── 24h window (Instagram, WhatsApp, Messenger) ──────────────────────────────

export interface WindowStats {
  open: number;
  closingSoon: number;
  byPlatform: Record<string, number>;
}

export function windowStats(
  conversations: Array<{ platform: string; last_inbound_at: string | null }>,
  now: Date,
  closingWithinHours = 6
): WindowStats {
  const openAfter = now.getTime() - DAY;
  const closingBefore = now.getTime() - (24 - closingWithinHours) * HOUR;
  const out: WindowStats = { open: 0, closingSoon: 0, byPlatform: {} };
  for (const c of conversations) {
    if (!c.last_inbound_at) continue;
    const t = new Date(c.last_inbound_at).getTime();
    if (t <= openAfter) continue;
    out.open++;
    out.byPlatform[c.platform] = (out.byPlatform[c.platform] ?? 0) + 1;
    if (t <= closingBefore) out.closingSoon++;
  }
  return out;
}

// ── Business feed ────────────────────────────────────────────────────────────

export type FeedKind = "lead" | "new_person" | "message_failed" | "field_invalid" | "broadcast_failed";

export interface FeedItem {
  kind: FeedKind;
  at: string;
  contactName: string | null;
}

export function mergeFeed(items: FeedItem[], limit = 15): FeedItem[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

// ── Flow stages ──────────────────────────────────────────────────────────────

interface RawNode {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}
interface RawEdge {
  source: string;
  target: string;
}

function nodeKind(n: RawNode): string {
  const d = n.data ?? {};
  return n.type === "action" && typeof d.actionType === "string" ? d.actionType : n.type ?? "";
}

/**
 * Slugs of the fields a flow asks for ("setCustomField" nodes), in the order a
 * person meets them: breadth-first from the trigger along the edges. Each slug once.
 */
export function orderedFieldSlugs(nodes: unknown, edges: unknown): string[] {
  const ns = Array.isArray(nodes) ? (nodes as RawNode[]) : [];
  const es = Array.isArray(edges) ? (edges as RawEdge[]) : [];
  const byId = new Map(ns.map((n) => [n.id, n]));
  const next = new Map<string, string[]>();
  for (const e of es) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);

  const queue = ns.filter((n) => nodeKind(n) === "trigger").map((n) => n.id);
  const seen = new Set<string>(queue);
  const slugs: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const n = byId.get(id);
    if (n && nodeKind(n) === "setCustomField") {
      const slug = n.data?.fieldSlug;
      if (typeof slug === "string" && slug && !slugs.includes(slug)) slugs.push(slug);
    }
    for (const t of next.get(id) ?? []) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return slugs;
}
