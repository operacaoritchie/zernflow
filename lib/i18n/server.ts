import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./config";
import { getMessages } from "./messages";
import { createFormatter, createTranslator } from "./translator";

/**
 * Resolve the interface language for the current request:
 * the NEXT_LOCALE cookie (kept in sync with the user's saved preference by
 * the middleware), then the browser's Accept-Language, then English.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get("accept-language")) ?? DEFAULT_LOCALE;
});

/** Translator for Server Components, Server Actions and route handlers. */
export async function getT(namespace?: string) {
  const locale = await getLocale();
  return createTranslator(locale, getMessages(locale), getMessages(DEFAULT_LOCALE), namespace);
}

export async function getFormatter() {
  return createFormatter(await getLocale());
}
