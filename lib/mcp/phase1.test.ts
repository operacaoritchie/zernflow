import { describe, expect, it } from "vitest";
import { maskCpf, maskEmail, maskFieldValue, maskPhone, maskText } from "./mask";
import { periodRange, startOfBrazilDay } from "./period";
import { labelMap, nodeLabel } from "./flow-summary";
import { int, isoDate, page, safeLike, uuid, groupCount } from "./tools/helpers";
import { MCP_TOOLS } from "./tools";

describe("masking", () => {
  it("masks phone, email and cpf", () => {
    expect(maskPhone("+55 (11) 98888-7766")).toBe("…7766");
    expect(maskEmail("maria@exemplo.com")).toBe("m***@exemplo.com");
    expect(maskCpf("123.456.789-09")).toBe("…09");
    expect(maskPhone(null)).toBeNull();
  });
  it("masks fields by type or slug", () => {
    expect(maskFieldValue("phone", "x", "11988887766")).toBe("…7766");
    expect(maskFieldValue("text", "cpf", "12345678909")).toBe("…09");
    expect(maskFieldValue("text", "cidade", "Recife")).toBe("Recife");
  });
  it("scrubs free text", () => {
    const out = maskText("meu email é ana@x.com, cpf 123.456.789-09 e tel (11) 98888-7766")!;
    expect(out).not.toContain("ana@x.com");
    expect(out).not.toContain("123.456.789");
    expect(out).not.toContain("98888");
  });
});

describe("period (Brazil, UTC-3)", () => {
  it("today starts at 03:00 UTC", () => {
    expect(startOfBrazilDay(new Date("2026-11-28T01:00:00Z")).toISOString()).toBe("2026-11-27T03:00:00.000Z");
    expect(startOfBrazilDay(new Date("2026-11-28T15:00:00Z")).toISOString()).toBe("2026-11-28T03:00:00.000Z");
  });
  it("yesterday is a closed range", () => {
    const r = periodRange("yesterday", new Date("2026-11-28T15:00:00Z"));
    expect(r.from).toBe("2026-11-27T03:00:00.000Z");
    expect(r.to).toBe("2026-11-28T03:00:00.000Z");
  });
  it("last_7_days includes today", () => {
    expect(periodRange("last_7_days", new Date("2026-11-28T15:00:00Z")).from).toBe("2026-11-22T03:00:00.000Z");
  });
});

describe("flow summary", () => {
  it("labels nodes readably", () => {
    expect(nodeLabel({ id: "a", type: "sendMessage", data: { messages: [{ text: "Qual seu nome?" }] } })).toBe("Mensagem: Qual seu nome?");
    expect(nodeLabel({ id: "b", type: "smartDelay", data: {} })).toBe("Espera a resposta");
    expect(nodeLabel({ id: "c", type: "x", data: { label: "Pedir CPF" } })).toBe("Pedir CPF");
    expect(labelMap([{ id: "a", type: "addTag", data: { tagName: "lead" } }]).get("a")).toBe("Adicionar etiqueta lead");
    expect(labelMap(null).size).toBe(0);
  });
});

describe("argument helpers", () => {
  it("validates uuid and dates", () => {
    expect(() => uuid({ id: "x" }, "id")).toThrow();
    expect(uuid({ id: "6f9619ff-8b86-d011-b42d-00c04fc964ff" }, "id")).toBeTruthy();
    expect(() => isoDate({ d: "lixo" }, "d")).toThrow();
    expect(isoDate({ d: "2026-11-28" }, "d")).toMatch(/^2026-11-28/);
  });
  it("clamps ints", () => {
    expect(int({ limit: 999 }, "limit", 20, 1, 50)).toBe(50);
    expect(int({}, "limit", 20, 1, 50)).toBe(20);
    expect(int({ limit: -4 }, "limit", 20, 1, 50)).toBe(1);
  });
  it("strips filter metacharacters", () => {
    expect(safeLike("a,b(c)%d")).toBe("a b c d");
  });
  it("paginates", () => {
    expect(page([1, 2, 3], 2, 0)).toEqual({ items: [1, 2], has_more: true, next_offset: 2 });
    expect(page([1], 2, 4)).toEqual({ items: [1], has_more: false, next_offset: null });
    expect(groupCount(["a", "b", "a"], (x) => x)).toEqual({ a: 2, b: 1 });
  });
});

describe("tool registry", () => {
  it("has unique names and only read tools", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(18);
    for (const t of MCP_TOOLS) {
      expect(t.scope).toBe("read");
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
  it("includes the tools the acceptance question needs", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    for (const n of ["contacts_search", "contact_get", "flow_analytics", "flows_list", "flow_get", "tags_list", "fields_list"]) {
      expect(names).toContain(n);
    }
  });
});
