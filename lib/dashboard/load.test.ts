import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDashboard } from "./load";

type Row = Record<string, unknown>;

/** A tiny in-memory PostgREST: applies eq / neq / in / gte / lt / not-is-null, ignores the rest. */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let head = false;
      let max = Infinity;
      const q = {
        select(_cols: string, opts?: { head?: boolean }) { if (opts?.head) head = true; return q; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
        neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return q; },
        in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
        gte(c: string, v: string) { filters.push((r) => typeof r[c] === "string" && (r[c] as string) >= v); return q; },
        lt(c: string, v: string) { filters.push((r) => typeof r[c] === "string" && (r[c] as string) < v); return q; },
        not(c: string, _op: string, v: unknown) { filters.push((r) => r[c] !== v); return q; },
        order() { return q; },
        limit(n: number) { max = n; return q; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, max);
          return Promise.resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const NOW = new Date("2026-11-28T15:00:00Z");
const W = "ws1";

const nodes = [
  { id: "t", type: "trigger" },
  { id: "w1", type: "smartDelay", data: { label: "Espera o nome" } },
  { id: "n", type: "setCustomField", data: { fieldSlug: "nome_vaga" } },
  { id: "w2", type: "smartDelay", data: { label: "Espera o telefone" } },
  { id: "p", type: "setCustomField", data: { fieldSlug: "telefone_vaga" } },
];
const edges = [
  { source: "t", target: "w1" }, { source: "w1", target: "n" }, { source: "n", target: "w2" }, { source: "w2", target: "p" },
];

const tables = (): Record<string, Row[]> => ({
  contacts: [
    { id: "c1", workspace_id: W, display_name: "Ana", created_at: "2026-11-28T10:00:00Z", last_interaction_at: "2026-11-28T10:00:00Z", opt_out_at: null },
    { id: "c2", workspace_id: W, display_name: "Bia", created_at: "2026-11-27T10:00:00Z", last_interaction_at: "2026-11-27T10:00:00Z", opt_out_at: null },
    { id: "c3", workspace_id: W, display_name: "Caio", created_at: "2026-11-26T10:00:00Z", last_interaction_at: "2026-11-26T10:00:00Z", opt_out_at: null },
    { id: "c4", workspace_id: W, display_name: "Dani", created_at: "2026-11-26T10:00:00Z", last_interaction_at: "2026-11-26T10:00:00Z", opt_out_at: null },
    { id: "imp", workspace_id: W, display_name: "Importado", created_at: "2026-11-26T11:00:00Z", last_interaction_at: "2026-10-01T11:00:00Z", opt_out_at: null },
    { id: "old", workspace_id: W, display_name: "Antigo", created_at: "2026-11-18T10:00:00Z", last_interaction_at: "2026-11-18T10:00:00Z", opt_out_at: null },
  ],
  custom_field_definitions: [
    { id: "f-nome", workspace_id: W, slug: "nome_vaga", name: "Nome (vaga)", type: "text" },
    { id: "f-tel", workspace_id: W, slug: "telefone_vaga", name: "Telefone (vaga)", type: "phone" },
  ],
  flows: [{ id: "fl1", workspace_id: W, name: "CURSO", status: "published", nodes, edges }],
  flow_sessions: [
    { contact_id: "c1", flow_id: "fl1", status: "completed", created_at: "2026-11-28T10:00:00Z" },
    { contact_id: "c2", flow_id: "fl1", status: "completed", created_at: "2026-11-27T10:00:00Z" },
    { contact_id: "c3", flow_id: "fl1", status: "active", waiting_for_input: true, current_node_id: "w2", created_at: "2026-11-26T10:00:00Z", updated_at: "2026-11-26T12:00:00Z" },
    { contact_id: "c4", flow_id: "fl1", status: "active", waiting_for_input: true, current_node_id: "w1", created_at: "2026-11-26T10:00:00Z", updated_at: "2026-11-27T12:00:00Z" },
    { contact_id: "old", flow_id: "fl1", status: "completed", created_at: "2026-11-18T10:00:00Z" },
  ],
  contact_custom_fields: [
    { contact_id: "c1", field_id: "f-nome", value: "Ana", updated_at: "2026-11-28T10:05:00Z" },
    { contact_id: "c1", field_id: "f-tel", value: "11999990000", updated_at: "2026-11-28T10:06:00Z" },
    { contact_id: "c2", field_id: "f-nome", value: "Bia", updated_at: "2026-11-27T10:05:00Z" },
    { contact_id: "c3", field_id: "f-nome", value: "Caio", updated_at: "2026-11-26T10:05:00Z" },
    { contact_id: "old", field_id: "f-tel", value: "11888880000", updated_at: "2026-11-18T10:05:00Z" },
  ],
  conversations: [
    { workspace_id: W, platform: "instagram", last_inbound_at: "2026-11-28T14:00:00Z" },
    { workspace_id: W, platform: "instagram", last_inbound_at: "2026-11-27T20:00:00Z" },
  ],
  analytics_events: [
    { workspace_id: W, event_type: "comment_matched", contact_id: "c1", created_at: "2026-11-28T09:00:00Z", metadata: { postId: "p1", isLive: true, dmSent: true } },
    { workspace_id: W, event_type: "comment_matched", contact_id: "c2", created_at: "2026-11-27T09:00:00Z", metadata: { postId: "p1", isLive: true, dmSent: true } },
    { workspace_id: W, event_type: "field_invalid", flow_id: "fl1", contact_id: "c3", created_at: "2026-11-26T12:00:00Z", metadata: { fieldSlug: "telefone_vaga" } },
    { workspace_id: W, event_type: "message_failed", contact_id: "c4", created_at: "2026-11-27T13:00:00Z", metadata: null },
  ],
  broadcasts: [], channels: [{ workspace_id: W, is_active: true }, { workspace_id: W, is_active: false }],
});

describe("loadDashboard", () => {
  it("computes results, funnel, waiting list and health from rows", async () => {
    const d = await loadDashboard(fakeDb(tables()), W, "7d", "Entraram", NOW);
    expect(d.loadErrors).toEqual([]);

    // 1 lead in the window (Ana); the previous 7 days had 1 (old)
    expect(d.results.leads.value).toBe(1);
    expect(d.results.leads.previous).toBe(1);
    // real new people in the window: Ana, Bia, Caio, Dani; the imported one is left out
    expect(d.results.people.value).toBe(4);
    expect(d.results.people.importedIgnored).toBe(1);
    // 4 people entered the flow in the window, 1 became a lead
    expect(d.results.conversion).toEqual({ rate: 25, previousRate: 100, leads: 1, entrants: 4 });

    const f = d.funnels[0];
    expect(f.name).toBe("CURSO");
    expect(f.stages.map((s) => [s.label, s.reached])).toEqual([["Entraram", 4], ["Nome (vaga)", 3], ["Telefone (vaga)", 1]]);
    expect(f.stages[1].waiting).toBe(1); // Caio gave the name and waits for the phone
    expect(f.stages[0].waiting).toBe(1); // Dani waits right after entering
    expect(f.stages[2].invalidAttempts).toBe(1);

    // longest waiting first, with the label the editor gave the node
    expect(d.act.waitingTotal).toBe(2);
    expect(d.act.waiting.map((w) => [w.name, w.stage])).toEqual([["Caio", "Espera o telefone"], ["Dani", "Espera o nome"]]);
    expect(d.act.windows).toEqual({ open: 2, closingSoon: 1, byPlatform: { instagram: 2 } });

    expect(d.origins).toEqual([{ postId: "p1", isLive: true, comments: 2, dms: 2, leads: 1 }]);
    expect(d.health.messagesFailed).toBe(1);
    expect(d.health.invalidAttempts).toBe(1);
    expect(d.health.inactiveChannels).toBe(1);
    expect(d.trend.length).toBe(7);
    expect(d.feed[0].kind).toBe("lead");
  });

  it("reports a failed query instead of throwing", async () => {
    const db = fakeDb(tables());
    const broken = {
      from(t: string) {
        const q = db.from(t) as unknown as { then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => unknown };
        if (t !== "channels") return q;
        return { ...q, select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) };
      },
    } as unknown as SupabaseClient;
    const d = await loadDashboard(broken, W, "today", "Entraram", NOW);
    expect(d.loadErrors.length).toBe(1);
    expect(d.health.inactiveChannels).toBe(0);
  });
});
