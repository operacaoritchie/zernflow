import type { Locale } from "./config";

/**
 * A message is either a plain string with optional {placeholders}, or a set of
 * plural forms keyed by Intl.PluralRules categories ("zero" is used for an
 * exact 0 when present).
 */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule | "zero", string>> & {
  other: string;
};
export type MessageValue = string | PluralMessage | MessageTree;
export interface MessageTree {
  [key: string]: MessageValue;
}

export type TranslationValues = Record<string, string | number | null | undefined>;

export type Translator = (key: string, values?: TranslationValues) => string;

function lookup(tree: MessageTree | undefined, path: string): MessageValue | undefined {
  if (!tree) return undefined;
  let node: MessageValue | undefined = tree;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as MessageTree)[part];
  }
  return node;
}

function isPlural(value: MessageValue): value is PluralMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PluralMessage).other === "string"
  );
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = values[name];
    return v === undefined || v === null ? match : String(v);
  });
}

function resolve(
  locale: Locale,
  value: MessageValue | undefined,
  values?: TranslationValues
): string | undefined {
  if (typeof value === "string") return interpolate(value, values);
  if (value && isPlural(value)) {
    const count = Number(values?.count ?? 0);
    const form =
      count === 0 && value.zero !== undefined
        ? "zero"
        : new Intl.PluralRules(locale).select(count);
    const template = value[form] ?? value.other;
    const formatted = new Intl.NumberFormat(locale).format(count);
    return interpolate(template, { ...values, count: formatted });
  }
  return undefined;
}

/**
 * Create a translator bound to a locale. Missing keys fall back to the
 * fallback messages (English), then to the key itself so a gap is visible
 * instead of crashing the page.
 */
export function createTranslator(
  locale: Locale,
  messages: MessageTree,
  fallback?: MessageTree,
  namespace?: string
): Translator {
  return (key, values) => {
    const path = namespace ? `${namespace}.${key}` : key;
    return (
      resolve(locale, lookup(messages, path), values) ??
      resolve("en", lookup(fallback, path), values) ??
      path
    );
  };
}

/** Locale-aware formatting helpers built on Intl. */
export function createFormatter(locale: Locale) {
  const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));
  return {
    date(d: Date | string | number, options?: Intl.DateTimeFormatOptions) {
      return toDate(d).toLocaleDateString(locale, options);
    },
    time(d: Date | string | number, options?: Intl.DateTimeFormatOptions) {
      return toDate(d).toLocaleTimeString(locale, options);
    },
    dateTime(d: Date | string | number, options?: Intl.DateTimeFormatOptions) {
      return toDate(d).toLocaleString(locale, options);
    },
    number(n: number, options?: Intl.NumberFormatOptions) {
      return new Intl.NumberFormat(locale, options).format(n);
    },
    relative(value: number, unit: Intl.RelativeTimeFormatUnit) {
      return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
    },
  };
}

export type Formatter = ReturnType<typeof createFormatter>;
