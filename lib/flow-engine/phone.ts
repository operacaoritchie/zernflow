/**
 * True when the text looks like a phone number: 10 to 13 digits once spaces,
 * dashes, dots, parentheses and a leading "+" are removed. Covers Brazilian
 * numbers with DDD ("85 99837-2658", "(85) 99837-2658", "+55 85 99837-2658")
 * and rejects replies like "oi" or "ok" that a flow waiting for a phone would
 * otherwise save as the number.
 */
export function isPhone(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
