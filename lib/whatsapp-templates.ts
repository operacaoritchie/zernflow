/**
 * WhatsApp message templates through the Zernio API.
 *
 * Meta only lets a business start a WhatsApp conversation (or write after the
 * 24-hour window closes) with a template it has approved. Templates are
 * created and read live from Meta through Zernio:
 *   - POST /v1/whatsapp/templates      submit a template for review
 *   - GET  /v1/whatsapp/templates      list templates with Meta's status
 *   - POST /v1/inbox/conversations     open a conversation with a template
 *
 * Plain fetch is used (not the SDK) so these calls do not depend on which
 * SDK version ships the WhatsApp helpers.
 */

const ZERNIO_API = "https://zernio.com/api/v1";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

/** Meta's review verdict, forwarded verbatim by Zernio. Only APPROVED can be sent. */
export type TemplateStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "IN_APPEAL"
  | "PAUSED"
  | "DISABLED"
  | "PENDING_DELETION"
  | string;

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  /** Meta's explanation on rejection ("NONE" or empty when approved) */
  reason: string | null;
  /** Body text with {{1}}, {{2}} placeholders */
  body: string;
  /** Text header, if the template has one */
  header: string | null;
  footer: string | null;
  /** Total placeholders, in send order: header first, then body */
  paramCount: number;
}

export class ZernioApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

async function zernioFetch(apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${ZERNIO_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const obj = (json ?? {}) as Record<string, unknown>;
    const nested = obj.error as Record<string, unknown> | string | undefined;
    const message =
      (typeof nested === "string" ? nested : (nested?.message as string)) ||
      (obj.message as string) ||
      text.slice(0, 300) ||
      `Zernio API error ${res.status}`;
    throw new ZernioApiError(message, res.status);
  }
  return json;
}

/** Count distinct {{n}} / {{name}} placeholders in a text. */
export function countPlaceholders(text: string | null | undefined): number {
  if (!text) return 0;
  return new Set(text.match(/\{\{\s*[\w]+\s*\}\}/g) ?? []).size;
}

type RawComponent = {
  type?: string;
  format?: string;
  text?: string;
};

function parseTemplate(raw: Record<string, unknown>): WhatsAppTemplate {
  const components = (Array.isArray(raw.components) ? raw.components : []) as RawComponent[];
  const find = (type: string) =>
    components.find((c) => (c.type ?? "").toLowerCase() === type);
  const header = find("header");
  const headerText =
    header && (!header.format || header.format.toUpperCase() === "TEXT") ? header.text ?? null : null;
  const body = find("body")?.text ?? "";
  const reason =
    (raw.rejected_reason as string) ??
    (raw.rejectedReason as string) ??
    (raw.reason as string) ??
    null;
  return {
    id: String(raw.id ?? raw._id ?? `${raw.name}:${raw.language}`),
    name: String(raw.name ?? ""),
    language: String(raw.language ?? ""),
    category: String(raw.category ?? ""),
    status: String(raw.status ?? "PENDING").toUpperCase(),
    reason: reason && reason !== "NONE" ? reason : null,
    body,
    header: headerText,
    footer: find("footer")?.text ?? null,
    paramCount: countPlaceholders(headerText) + countPlaceholders(body),
  };
}

function extractList(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const obj = (json ?? {}) as Record<string, unknown>;
  for (const key of ["templates", "data", "items"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
    if (value && typeof value === "object") {
      const inner = extractList(value);
      if (inner.length) return inner;
    }
  }
  return [];
}

export async function listTemplates(
  apiKey: string,
  accountId: string,
  filters?: { status?: string }
): Promise<WhatsAppTemplate[]> {
  const params = new URLSearchParams({ accountId });
  if (filters?.status) params.set("status", filters.status);
  const json = await zernioFetch(apiKey, `/whatsapp/templates?${params}`);
  return extractList(json)
    .map(parseTemplate)
    .filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
}

export interface CreateTemplateInput {
  accountId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  /** One example value per {{n}} in the body, in order (required by Meta) */
  bodyExamples: string[];
  header?: string;
  headerExamples?: string[];
  footer?: string;
}

/** Meta's naming rule: lowercase letters, digits and underscores, starting with a letter. */
export function normalizeTemplateName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 512);
}

export async function createTemplate(apiKey: string, input: CreateTemplateInput) {
  const components: Record<string, unknown>[] = [];
  if (input.header?.trim()) {
    const header: Record<string, unknown> = {
      type: "header",
      format: "TEXT",
      text: input.header.trim(),
    };
    if (input.headerExamples?.length) header.example = { header_text: input.headerExamples };
    components.push(header);
  }
  const body: Record<string, unknown> = { type: "body", text: input.body.trim() };
  if (input.bodyExamples.length) body.example = { body_text: [input.bodyExamples] };
  components.push(body);
  if (input.footer?.trim()) components.push({ type: "footer", text: input.footer.trim() });

  const json = (await zernioFetch(apiKey, "/whatsapp/templates", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      name: normalizeTemplateName(input.name),
      category: input.category,
      language: input.language,
      components,
    }),
  })) as Record<string, unknown> | null;
  const raw = (json?.template ?? json?.data ?? json ?? {}) as Record<string, unknown>;
  return parseTemplate({ ...raw, components: raw.components ?? components });
}

/**
 * Digits-only phone with country code, as WhatsApp expects. Numbers typed
 * without "+" and without a country code (10 or 11 digits: Brazilian DDD +
 * number) get 55.
 */
export function normalizeWhatsAppPhone(
  phone: string | null | undefined,
  defaultCountryCode = "55"
): string | null {
  if (!phone) return null;
  // "+…" or "00…" means the country code is already there.
  const hasCountryCode = /^\s*(\+|00)/.test(phone);
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!hasCountryCode && (digits.length === 10 || digits.length === 11)) {
    digits = defaultCountryCode + digits;
  }
  // E.164 allows 8 to 15 digits; without an explicit country code only full
  // Brazilian numbers (12 or 13 digits after adding 55) are accepted.
  if (digits.length > 15 || digits.length < (hasCountryCode ? 8 : 12)) return null;
  return digits;
}

export interface SendTemplateInput {
  accountId: string;
  phone: string;
  templateName: string;
  templateLanguage: string;
  templateParams: string[];
}

/** Open (or continue) a WhatsApp conversation with an approved template. */
export async function sendTemplate(apiKey: string, input: SendTemplateInput) {
  const json = (await zernioFetch(apiKey, "/inbox/conversations", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      participantId: input.phone,
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      templateParams: input.templateParams,
    }),
  })) as Record<string, unknown> | null;
  const data = (json?.data ?? json ?? {}) as Record<string, unknown>;
  return { conversationId: (data.conversationId as string) ?? null };
}
