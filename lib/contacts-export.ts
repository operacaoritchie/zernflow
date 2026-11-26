import { isPhone } from "@/lib/flow-engine/phone";

/**
 * Bulk contact export: turns contacts (with their channels, tags and custom
 * field values) into the three files the Contacts screen offers:
 *
 * - "full": spreadsheet for Excel (semicolon separated, UTF-8 BOM).
 * - "ig_audience": one Instagram-scoped user ID per line, to paste into
 *   Meta Ads Manager > Custom Audience > Customer list > "Instagram Scoped User ID".
 * - "meta_customers": Meta customer-list CSV (email, phone, fn, ln, country).
 *
 * Everything here is pure so it can be unit tested; the route does the I/O.
 */

export type ExportFormat = "full" | "ig_audience" | "meta_customers";
export type ExportPreset = "all" | "instagram" | "leads";

export const EXPORT_FORMATS: ExportFormat[] = ["full", "ig_audience", "meta_customers"];
export const EXPORT_PRESETS: ExportPreset[] = ["all", "instagram", "leads"];
export const DEFAULT_LEAD_TAG = "lead-vaga";

export interface ExportContact {
  id: string;
  display_name: string | null;
  email: string | null;
  is_subscribed: boolean;
  created_at: string;
  last_interaction_at: string | null;
  tags: string[];
  channels: { platform: string; sender_id: string; username: string | null }[];
  /** Custom field values keyed by slug, with the field type. */
  fields: { slug: string; type: string; value: string }[];
}

export interface ExportOptions {
  format: ExportFormat;
  preset: ExportPreset;
  /** Only contacts with this tag name (in addition to the preset). */
  tag?: string | null;
  /** Case-insensitive match on name, e-mail or @username. */
  search?: string | null;
  leadTag?: string;
  includeCpf?: boolean;
}

/** Phone slugs checked first, in this order, before any other phone field. */
const PREFERRED_PHONE_SLUGS = ["telefone_vaga", "telefone", "phone", "whatsapp"];

/** Digits only, with Brazil's 55 added to 10/11-digit national numbers. */
export function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw || !isPhone(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function contactPhone(c: ExportContact): string | null {
  const phones = c.fields.filter((f) => f.type === "phone");
  const ordered = [
    ...PREFERRED_PHONE_SLUGS.flatMap((s) => phones.filter((f) => f.slug === s)),
    ...phones.filter((f) => !PREFERRED_PHONE_SLUGS.includes(f.slug)),
  ];
  for (const f of ordered) {
    const n = normalizePhoneBR(f.value);
    if (n) return n;
  }
  return null;
}

export function contactEmail(c: ExportContact): string | null {
  const direct = normalizeEmail(c.email);
  if (direct) return direct;
  for (const f of c.fields.filter((f) => f.type === "email")) {
    const n = normalizeEmail(f.value);
    if (n) return n;
  }
  return null;
}

export function contactCpf(c: ExportContact): string | null {
  const f = c.fields.find((f) => f.type === "cpf" && f.value.replace(/\D/g, "").length === 11);
  return f ? f.value.replace(/\D/g, "") : null;
}

export function instagramChannel(c: ExportContact) {
  return c.channels.find((ch) => ch.platform === "instagram" && ch.sender_id) ?? null;
}

/** Lead = has the lead tag, or has a valid phone or e-mail. */
export function isLead(c: ExportContact, leadTag = DEFAULT_LEAD_TAG): boolean {
  return c.tags.includes(leadTag) || contactPhone(c) !== null || contactEmail(c) !== null;
}

export function selectContacts(contacts: ExportContact[], opts: ExportOptions): ExportContact[] {
  const q = opts.search?.trim().toLowerCase();
  return contacts.filter((c) => {
    if (opts.preset === "instagram" && !instagramChannel(c)) return false;
    if (opts.preset === "leads" && !isLead(c, opts.leadTag)) return false;
    if (opts.tag && !c.tags.includes(opts.tag)) return false;
    if (q) {
      const hay = [
        c.display_name ?? "",
        c.email ?? "",
        ...c.channels.map((ch) => ch.username ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // The file formats themselves need specific identifiers.
    if (opts.format === "ig_audience" && !instagramChannel(c)) return false;
    if (opts.format === "meta_customers" && !contactPhone(c) && !contactEmail(c)) return false;
    return true;
  });
}

function csvCell(value: string | null | undefined, sep: string): string {
  let v = value ?? "";
  // Neutralise spreadsheet formulas (CSV injection) from user-typed values.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (v.includes(sep) || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function toCsv(rows: (string | null)[][], sep: string): string {
  return rows.map((r) => r.map((v) => csvCell(v, sep)).join(sep)).join("\r\n") + "\r\n";
}

function splitName(name: string | null): { fn: string; ln: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  // Instagram display names often carry emoji or "@handles"; keep letters only.
  const clean = (s: string) => s.replace(/[^\p{L}\p{M}'-]/gu, "");
  const words = parts.map(clean).filter(Boolean);
  return { fn: words[0] ?? "", ln: words.slice(1).join(" ") };
}

const BOM = "﻿";

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
  count: number;
}

export function buildExport(
  contacts: ExportContact[],
  opts: ExportOptions,
  now = new Date()
): ExportFile {
  const rows = selectContacts(contacts, opts);
  const stamp = now.toISOString().slice(0, 10);
  const suffix = opts.preset === "all" ? "" : `-${opts.preset}`;

  if (opts.format === "ig_audience") {
    const ids = [...new Set(rows.map((c) => instagramChannel(c)!.sender_id))];
    return {
      filename: `publico-instagram${suffix}-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: ids.length ? ids.join("\r\n") + "\r\n" : "",
      count: ids.length,
    };
  }

  if (opts.format === "meta_customers") {
    const data = rows.map((c) => {
      const { fn, ln } = splitName(c.display_name);
      return [contactEmail(c), contactPhone(c), fn, ln, "BR"];
    });
    return {
      filename: `lista-clientes-meta${suffix}-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: toCsv([["email", "phone", "fn", "ln", "country"], ...data], ","),
      count: data.length,
    };
  }

  // Full spreadsheet. Custom fields not already shown get their own column.
  const shown = new Set(["telefone", "telefone_vaga", "email", "cpf"]);
  const extraSlugs = [
    ...new Set(rows.flatMap((c) => c.fields.map((f) => f.slug)).filter((s) => !shown.has(s))),
  ].sort();

  const header = [
    "nome",
    "usuario_instagram",
    "instagram_id",
    "canais",
    "telefone",
    "email",
    ...(opts.includeCpf ? ["cpf"] : []),
    "etiquetas",
    "lead",
    "inscrito",
    "criado_em",
    "ultima_interacao",
    ...extraSlugs,
  ];

  const data = rows.map((c) => {
    const ig = instagramChannel(c);
    const fieldBySlug = new Map(c.fields.map((f) => [f.slug, f.value]));
    return [
      c.display_name,
      ig?.username ? `@${ig.username.replace(/^@/, "")}` : "",
      ig?.sender_id ?? "",
      [...new Set(c.channels.map((ch) => ch.platform))].join(", "),
      contactPhone(c),
      contactEmail(c),
      ...(opts.includeCpf ? [contactCpf(c)] : []),
      c.tags.join(", "),
      isLead(c, opts.leadTag) ? "sim" : "não",
      c.is_subscribed ? "sim" : "não",
      c.created_at.slice(0, 10),
      c.last_interaction_at?.slice(0, 10) ?? "",
      ...extraSlugs.map((s) => fieldBySlug.get(s) ?? ""),
    ];
  });

  return {
    filename: `contatos${suffix}-${stamp}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: BOM + toCsv([header, ...data], ";"),
    count: data.length,
  };
}
