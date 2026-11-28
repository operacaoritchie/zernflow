import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./tools";
import { summarizeArgs } from "./audit";
import { fakeDb } from "./test-db";
import type { McpContext } from "./types";

const W = "w1";
const OTHER = "w2";
const F1 = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444444";
const B1 = "55555555-5555-4555-8555-555555555555";
const S1 = "66666666-6666-4666-8666-666666666666";
const STAMP = "2026-11-28T10:00:00.000Z";

const ctx = (db: unknown, over: Partial<McpContext> = {}) =>
  ({ workspaceId: W, keyId: null, userId: "u1", scopes: ["read", "write"], supabase: db, ...over }) as unknown as McpContext;
const run = (name: string, args: Record<string, unknown>, db: unknown, over: Partial<McpContext> = {}) => {
  const t = MCP_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} is not registered`);
  return t.run(args, ctx(db, over)) as Promise<Record<string, unknown>>;
};
const rejects = async (p: Promise<unknown>, text?: RegExp) => {
  let msg = "";
  try { await p; } catch (e) { msg = (e as Error).message; }
  expect(msg.length).toBeGreaterThan(0);
  if (text) expect(msg).toMatch(text);
};

const trigger = { id: "t", type: "trigger", data: { triggerType: "keyword", keywords: [{ value: "CURSO" }] } };
const msg = { id: "m", type: "sendMessage", data: { messages: [{ text: "Oi!" }] } };

describe("registry after phase 2", () => {
  it("adds 2 read tools and 9 write tools, none of which reaches a lead", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names.length).toBe(29);
    expect(new Set(names).size).toBe(29);
    const writes = MCP_TOOLS.filter((t) => t.scope === "write").map((t) => t.name).sort();
    expect(writes).toEqual(["broadcast_save_draft", "contact_note_add", "contact_update", "field_create", "flow_clone", "flow_create", "flow_update", "sequence_save_draft", "tag_create"]);
    for (const t of MCP_TOOLS.filter((x) => x.scope === "write")) {
      expect(t.annotations.readOnlyHint).toBe(false);
      expect(t.annotations.destructiveHint).toBe(false);
    }
    expect(names).toContain("flow_validate");
    expect(names).toContain("flow_simulate");
    for (const n of names) expect(/send|publish|schedule|delete/.test(n)).toBe(false);
    for (const n of ["flow_validate", "flow_simulate"]) expect(MCP_TOOLS.find((t) => t.name === n)!.scope).toBe("read");
  });
});

describe("audit log arguments", () => {
  it("masks personal data in text and keeps structures short", () => {
    const out = summarizeArgs({ content: "ligar para ana@x.com ou 11 98888-7766", nodes: [1, 2, 3], cpf: "123.456.789-09" });
    const s = JSON.stringify(out);
    expect(s).not.toContain("ana@x.com");
    expect(s).not.toContain("98888");
    expect(s).not.toContain("123.456.789");
    expect(out.nodes).toBe("[array:3]");
  });
});

describe("flow tools", () => {
  it("flow_create saves a draft, lays out nodes and reports problems", async () => {
    const db = fakeDb({});
    const r = await run("flow_create", { name: "Captura", nodes: [trigger, msg], edges: [{ source: "t", target: "m" }] }, db);
    const row = db.tables.flows[0] as { status: string; workspace_id: string; nodes: Array<{ position: unknown }>; edges: Array<{ id: string }> };
    expect(row.status).toBe("draft");
    expect(row.workspace_id).toBe(W);
    expect(row.nodes[1].position).toEqual({ x: 320, y: 0 });
    expect(row.edges[0].id).toBe("e_t_out_m");
    expect(r.valid).toBe(true);
    expect(r.editor_path).toBe(`/dashboard/flows/${r.id}`);
  });
  it("flow_create refuses a broken structure and saves nothing", async () => {
    const db = fakeDb({});
    await rejects(run("flow_create", { name: "X", nodes: [trigger], edges: [{ source: "t", target: "ghost" }] }, db), /not saved/);
    expect((db.tables.flows ?? []).length).toBe(0);
  });
  it("flow_create saves a flow with fixable problems and reports them", async () => {
    const db = fakeDb({});
    const r = await run("flow_create", { name: "Sem ligação", nodes: [trigger, msg], edges: [] }, db);
    expect(r.valid).toBe(false);
    expect((r.errors as Array<{ code: string }>).map((e) => e.code)).toContain("trigger_no_next");
    expect(db.tables.flows.length).toBe(1);
  });
  it("flow_update edits a draft only when nobody changed it meanwhile", async () => {
    const mk = (status: string) => fakeDb({ flows: [{ id: F1, workspace_id: W, name: "A", status, nodes: [trigger, msg], edges: [{ source: "t", target: "m" }], updated_at: STAMP }] });
    const ok = mk("draft");
    const r = await run("flow_update", { flow_id: F1, expected_updated_at: STAMP, name: "B" }, ok);
    expect(r.name).toBe("B");
    await rejects(run("flow_update", { flow_id: F1, expected_updated_at: "2026-11-27T10:00:00.000Z", name: "B" }, mk("draft")), /changed since/);
    await rejects(run("flow_update", { flow_id: F1, expected_updated_at: STAMP, name: "B" }, mk("published")), /Only drafts/);
  });
  it("flow_update never touches a flow of another workspace", async () => {
    const db = fakeDb({ flows: [{ id: F1, workspace_id: OTHER, name: "A", status: "draft", nodes: [], edges: [], updated_at: STAMP }] });
    await rejects(run("flow_update", { flow_id: F1, expected_updated_at: STAMP, name: "B" }, db), /not found/);
  });
  it("flow_clone makes a draft copy and leaves the original alone", async () => {
    const db = fakeDb({ flows: [{ id: F1, workspace_id: W, name: "A", status: "published", nodes: [trigger, msg], edges: [{ source: "t", target: "m" }], updated_at: STAMP }] });
    const r = await run("flow_clone", { flow_id: F1 }, db);
    expect(r.status).toBe("draft");
    expect(r.name).toBe("A (copy)");
    expect((db.tables.flows[0] as { status: string }).status).toBe("published");
  });
  it("flow_validate and flow_simulate work on candidate graphs without saving", async () => {
    const db = fakeDb({});
    const v = await run("flow_validate", { nodes: [trigger, msg], edges: [{ source: "t", target: "m" }] }, db);
    expect(v.valid).toBe(true);
    const s = await run("flow_simulate", { nodes: [trigger, msg], edges: [{ source: "t", target: "m" }], message: "quero o curso" }, db);
    expect(JSON.stringify(s)).toContain("Oi!");
    expect(db.writes.length).toBe(0);
  });
});

describe("contact tools", () => {
  const base = () =>
    fakeDb({
      contacts: [{ id: C1, workspace_id: W }, { id: C2, workspace_id: OTHER }],
      tags: [{ id: "t1", workspace_id: W, name: "Lead" }],
      custom_field_definitions: [
        { id: "f1", workspace_id: W, slug: "telefone", type: "phone", name: "Telefone" },
        { id: "f2", workspace_id: W, slug: "cidade", type: "text", name: "Cidade" },
      ],
      contact_tags: [],
      contact_custom_fields: [],
      conversations: [{ id: V1, workspace_id: W }, { id: "other-conv", workspace_id: OTHER }],
    });
  it("contact_update stores validated values and masks them in the answer", async () => {
    const db = base();
    const r = await run("contact_update", { contact_id: C1, set_fields: { telefone: "(11) 98888-7766", cidade: "Recife" }, add_tags: ["lead"] }, db);
    const stored = db.tables.contact_custom_fields as Array<{ field_id: string; value: string }>;
    expect(stored.find((x) => x.field_id === "f1")!.value).toBe("11988887766");
    expect((db.tables.contact_tags as unknown[]).length).toBe(1);
    expect(JSON.stringify(r)).not.toContain("11988887766");
    expect(JSON.stringify(r)).toContain("7766");
  });
  it("contact_update changes nothing when one value is invalid", async () => {
    const db = base();
    await rejects(run("contact_update", { contact_id: C1, set_fields: { cidade: "Recife", telefone: "123" }, add_tags: ["lead"] }, db), /telefone/);
    expect(db.writes.length).toBe(0);
  });
  it("contact_update does not duplicate a tag and asks for tag_create when the tag is missing", async () => {
    const db = base();
    await run("contact_update", { contact_id: C1, add_tags: ["Lead"] }, db);
    await run("contact_update", { contact_id: C1, add_tags: ["Lead"] }, db);
    expect((db.tables.contact_tags as unknown[]).length).toBe(1);
    await rejects(run("contact_update", { contact_id: C1, add_tags: ["Nova"] }, db), /tag_create/);
    await rejects(run("contact_update", { contact_id: C1, set_fields: { nao_existe: "x" } }, db), /field_create/);
  });
  it("contact_update removes only the named tag of this contact", async () => {
    const db = base();
    (db.tables.tags as Array<Record<string, unknown>>).push({ id: "t2", workspace_id: W, name: "Cliente" });
    (db.tables.contact_tags as Array<Record<string, unknown>>).push({ contact_id: C1, tag_id: "t1" }, { contact_id: C1, tag_id: "t2" }, { contact_id: C2, tag_id: "t1" });
    await run("contact_update", { contact_id: C1, remove_tags: ["lead"] }, db);
    expect(db.tables.contact_tags).toEqual([{ contact_id: C1, tag_id: "t2" }, { contact_id: C2, tag_id: "t1" }]);
  });
  it("contact_update overwrites an existing field value instead of adding a second", async () => {
    const db = base();
    await run("contact_update", { contact_id: C1, set_fields: { cidade: "Recife" } }, db);
    await run("contact_update", { contact_id: C1, set_fields: { cidade: "Olinda" } }, db);
    const rows = db.tables.contact_custom_fields as Array<{ value: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe("Olinda");
  });
  it("contact_update refuses contacts of another workspace", async () => {
    await rejects(run("contact_update", { contact_id: C2, add_tags: ["lead"] }, base()), /not found/);
  });
  it("contact_note_add records the note for the signed-in user", async () => {
    const db = base();
    await run("contact_note_add", { conversation_id: V1, content: "Pediu retorno amanhã" }, db);
    expect(db.tables.conversation_notes[0]).toMatchObject({ conversation_id: V1, workspace_id: W, user_id: "u1", content: "Pediu retorno amanhã" });
    await rejects(run("contact_note_add", { conversation_id: V1, content: "x" }, base(), { userId: null }), /signed-in/);
    await rejects(run("contact_note_add", { conversation_id: "77777777-7777-4777-8777-777777777777", content: "x" }, base()), /not found/);
  });
});

describe("tag and field tools", () => {
  it("tag_create is idempotent and checks the colour", async () => {
    const db = fakeDb({ tags: [{ id: "t1", workspace_id: W, name: "Lead" }] });
    const same = await run("tag_create", { name: "lead" }, db);
    expect(same.created).toBe(false);
    expect(db.tables.tags.length).toBe(1);
    const fresh = await run("tag_create", { name: "Novo", color: "#22aa44" }, db);
    expect(fresh.created).toBe(true);
    await rejects(run("tag_create", { name: "Cor", color: "verde" }, db), /color/);
  });
  it("field_create derives the slug and checks the type", async () => {
    const db = fakeDb({ custom_field_definitions: [{ id: "f1", workspace_id: W, slug: "cidade", type: "text", name: "Cidade" }] });
    const r = await run("field_create", { name: "Data de Nascimento", type: "date" }, db);
    expect(r.slug).toBe("data_de_nascimento");
    await rejects(run("field_create", { name: "X", type: "banana" }, db), /type/);
    const again = await run("field_create", { name: "Cidade", type: "text" }, db);
    expect(again.created).toBe(false);
    await rejects(run("field_create", { name: "Cidade", type: "number" }, db), /already exists/);
  });
});

describe("draft tools", () => {
  it("broadcast_save_draft never schedules or sends", async () => {
    const db = fakeDb({});
    const r = await run("broadcast_save_draft", { name: "Black", message_text: "Oi {{first_name}}", segment_filter: { combinator: "and", groups: [{ combinator: "and", rules: [{ field: "has_tag", operator: "is", value: "Lead" }] }] } }, db);
    expect(db.tables.broadcasts[0]).toMatchObject({ workspace_id: W, status: "draft", scheduled_for: null, message_content: { text: "Oi {{first_name}}" } });
    expect(r.status).toBe("draft");
    await rejects(run("broadcast_save_draft", { name: "Y", message_text: "x", segment_filter: { combinator: "and", groups: [{ combinator: "and", rules: [{ field: "senha", operator: "is", value: "1" }] }] } }, db), /segment/);
  });
  it("broadcast_save_draft edits drafts only", async () => {
    const db = fakeDb({ broadcasts: [{ id: B1, workspace_id: W, name: "A", status: "sent", message_content: {}, segment_filter: null }] });
    await rejects(run("broadcast_save_draft", { broadcast_id: B1, name: "B", message_text: "x" }, db), /draft/);
  });
  it("sequence_save_draft saves steps as a draft and reports what blocks activation", async () => {
    const db = fakeDb({});
    const ok = await run("sequence_save_draft", { name: "Boas-vindas", steps: [{ type: "message", content: "Oi" }, { type: "delay", delayMinutes: 60 }, { type: "message", content: "Voltei" }] }, db);
    expect(db.tables.sequences[0]).toMatchObject({ workspace_id: W, status: "draft" });
    expect(ok.problems).toEqual([]);
    const bad = await run("sequence_save_draft", { name: "Ruim", steps: [{ type: "delay", delayMinutes: 0 }] }, db);
    expect((bad.problems as string[]).length).toBeGreaterThan(0);
    await rejects(run("sequence_save_draft", { name: "Z", steps: [{ type: "sms" }] }, db), /step/);
  });
  it("sequence_save_draft will not edit a live sequence", async () => {
    const db = fakeDb({ sequences: [{ id: S1, workspace_id: W, name: "A", status: "active", steps: [] }] });
    await rejects(run("sequence_save_draft", { sequence_id: S1, name: "A", steps: [{ type: "message", content: "x" }] }, db), /draft/);
  });
});
