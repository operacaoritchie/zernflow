import { isPhone } from "@/lib/flow-engine/phone";

/** Custom field types. `phone` and `cpf` were added in 00020. */
export type CustomFieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "email"
  | "phone"
  | "cpf";

export type FieldValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "invalid" };

/** True for a valid Brazilian CPF (11 digits, both check digits correct). */
export function isCpf(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!/^[\d\s.-]+$/.test(trimmed)) return false;
  const d = trimmed.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Checks a value against its field type and returns the value to store.
 * Phone and CPF are stored as digits only, e-mail trimmed and lower-cased.
 * Types without a meaningful check (text, boolean, date) accept any
 * value unchanged, empty included, so existing text fields behave as before.
 */
export function validateFieldValue(
  type: string | null | undefined,
  raw: string | null | undefined,
): FieldValidation {
  const value = (raw ?? "").trim();
  const checked = type === "phone" || type === "cpf" || type === "email" || type === "number" || type === "url";
  // Unchecked types keep the old behaviour, empty value included.
  if (!checked) return { ok: true, value: raw ?? "" };
  if (!value) return { ok: false, reason: "empty" };

  switch (type) {
    case "phone":
      return isPhone(value)
        ? { ok: true, value: value.replace(/\D/g, "") }
        : { ok: false, reason: "invalid" };
    case "cpf":
      return isCpf(value)
        ? { ok: true, value: value.replace(/\D/g, "") }
        : { ok: false, reason: "invalid" };
    case "email":
      return EMAIL_RE.test(value)
        ? { ok: true, value: value.toLowerCase() }
        : { ok: false, reason: "invalid" };
    case "number": {
      const n = Number(value.replace(",", "."));
      return Number.isFinite(n) ? { ok: true, value: String(n) } : { ok: false, reason: "invalid" };
    }
    case "url":
      try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:"
          ? { ok: true, value }
          : { ok: false, reason: "invalid" };
      } catch {
        return { ok: false, reason: "invalid" };
      }
    default:
      return { ok: true, value: raw ?? "" };
  }
}
