/**
 * Personal data leaves MCP masked by default (LGPD). The full value is only
 * returned by contact_get, one contact at a time, and that call is audited.
 */

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : "…";
}

export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.indexOf("@");
  if (at < 1) return "…";
  return `${value[0]}***${value.slice(at)}`;
}

export function maskCpf(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 2 ? `…${digits.slice(-2)}` : "…";
}

/** Masks a custom-field value by its declared type (phone / cpf / email). */
export function maskFieldValue(type: string | null | undefined, slug: string, value: string | null): string | null {
  if (value === null || value === undefined) return null;
  const t = (type ?? "").toLowerCase();
  const s = slug.toLowerCase();
  if (t === "phone" || s === "telefone" || s.startsWith("telefone_")) return maskPhone(value);
  if (t === "cpf" || s === "cpf") return maskCpf(value);
  if (t === "email" || s === "email") return maskEmail(value);
  return value;
}

/** Scrubs e-mails, CPFs and phone-like numbers out of free text (message bodies, error strings). */
export function maskText(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m) ?? "…")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) => maskCpf(m) ?? "…")
    .replace(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, (m) => maskPhone(m) ?? "…");
}
