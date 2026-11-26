/**
 * Supported interface languages.
 *
 * To add a language:
 *   1. Add its code here (BCP-47) and its native name in LOCALE_NAMES.
 *   2. Copy lib/i18n/messages/en.json to lib/i18n/messages/<code>.json and translate it.
 *   3. Register the file in lib/i18n/messages/index.ts.
 * The i18n test fails if any key from en.json is missing in the new file.
 */
export const LOCALES = ["en", "pt-BR", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Map any language tag ("pt", "pt-PT", "es-MX", "ja-JP") to the closest
 * supported locale, or null when there is no reasonable match.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return null;
  const exact = LOCALES.find((l) => l.toLowerCase() === normalized);
  if (exact) return exact;
  const base = normalized.split("-")[0];
  return LOCALES.find((l) => l.toLowerCase().split("-")[0] === base) ?? null;
}

/** Pick the best locale from an Accept-Language header. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag, q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((t) => t.tag && t.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return null;
}
