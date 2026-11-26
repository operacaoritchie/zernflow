import { describe, expect, it } from "vitest";
import {
  buildExport,
  contactPhone,
  isLead,
  normalizePhoneBR,
  selectContacts,
  type ExportContact,
} from "./contacts-export";

function contact(p: Partial<ExportContact> & { id: string }): ExportContact {
  return {
    display_name: null,
    email: null,
    is_subscribed: true,
    created_at: "2026-11-20T10:00:00Z",
    last_interaction_at: null,
    tags: [],
    channels: [],
    fields: [],
    ...p,
  };
}

const ig = (sender: string, username: string | null = null) => ({
  platform: "instagram",
  sender_id: sender,
  username,
});

const ana = contact({
  id: "1",
  display_name: "Ana Paula Souza 🌸",
  tags: ["lead-vaga"],
  channels: [ig("17841400000000001", "anapaula")],
  fields: [
    { slug: "telefone_vaga", type: "phone", value: "(85) 99837-2658" },
    { slug: "nome_vaga", type: "text", value: "Ana" },
    { slug: "cpf", type: "cpf", value: "52998224725" },
  ],
});
const beto = contact({ id: "2", display_name: "Beto", channels: [ig("17841400000000002")] });
const caio = contact({
  id: "3",
  display_name: "Caio",
  email: " Caio@Mail.com ",
  channels: [{ platform: "whatsapp", sender_id: "5585", username: null }],
});
const dani = contact({
  id: "4",
  display_name: "=HYPERLINK(\"x\")",
  channels: [ig("17841400000000004")],
  fields: [{ slug: "telefone", type: "phone", value: "Oi" }],
});
const all = [ana, beto, caio, dani];

describe("normalizePhoneBR", () => {
  it("adds 55 to national numbers and strips punctuation", () => {
    expect(normalizePhoneBR("(85) 99837-2658")).toBe("5585998372658");
    expect(normalizePhoneBR("+55 85 99837-2658")).toBe("5585998372658");
  });
  it("rejects non-phones", () => {
    expect(normalizePhoneBR("Oi")).toBeNull();
    expect(normalizePhoneBR("")).toBeNull();
  });
});

describe("leads", () => {
  it("counts the tag, a valid phone or a valid e-mail", () => {
    expect(isLead(ana)).toBe(true);
    expect(isLead(caio)).toBe(true);
    expect(isLead(beto)).toBe(false);
    expect(isLead(dani)).toBe(false); // "Oi" is not a phone
    expect(contactPhone(dani)).toBeNull();
  });
  it("respects a custom lead tag", () => {
    const eva = contact({ id: "5", tags: ["comprou"] });
    expect(isLead(eva, "comprou")).toBe(true);
  });
});

describe("selectContacts", () => {
  it("filters by preset, tag and search", () => {
    const base = { format: "full" as const };
    expect(selectContacts(all, { ...base, preset: "all" })).toHaveLength(4);
    expect(selectContacts(all, { ...base, preset: "instagram" }).map((c) => c.id)).toEqual(["1", "2", "4"]);
    expect(selectContacts(all, { ...base, preset: "leads" }).map((c) => c.id)).toEqual(["1", "3"]);
    expect(selectContacts(all, { ...base, preset: "all", tag: "lead-vaga" }).map((c) => c.id)).toEqual(["1"]);
    expect(selectContacts(all, { ...base, preset: "all", search: "anapaula" }).map((c) => c.id)).toEqual(["1"]);
  });
});

describe("buildExport", () => {
  const now = new Date("2026-11-26T12:00:00Z");

  it("ig_audience: one Instagram ID per line, no header, no personal data", () => {
    const f = buildExport(all, { format: "ig_audience", preset: "all" }, now);
    expect(f.body).toBe("17841400000000001\r\n17841400000000002\r\n17841400000000004\r\n");
    expect(f.count).toBe(3);
    expect(f.filename).toBe("publico-instagram-2026-11-26.csv");
  });

  it("meta_customers: Meta headers, phone with 55, lowercase e-mail, clean names", () => {
    const f = buildExport(all, { format: "meta_customers", preset: "all" }, now);
    const lines = f.body.trim().split("\r\n");
    expect(lines[0]).toBe("email,phone,fn,ln,country");
    expect(lines).toContain(",5585998372658,Ana,Paula Souza,BR");
    expect(lines).toContain("caio@mail.com,,Caio,,BR");
    expect(f.count).toBe(2);
  });

  it("full: BOM, semicolons, CPF only on request, formula injection neutralised", () => {
    const f = buildExport(all, { format: "full", preset: "all" }, now);
    expect(f.body.startsWith("﻿nome;usuario_instagram;instagram_id")).toBe(true);
    expect(f.body).not.toContain("cpf");
    expect(f.body).toContain("@anapaula");
    expect(f.body).toContain("nome_vaga");
    expect(f.body).toContain("\"'=HYPERLINK(\"\"x\"\")\"");

    const withCpf = buildExport(all, { format: "full", preset: "leads", includeCpf: true }, now);
    expect(withCpf.body).toContain(";cpf;");
    expect(withCpf.body).toContain("52998224725");
    expect(withCpf.filename).toBe("contatos-leads-2026-11-26.csv");
  });
});
