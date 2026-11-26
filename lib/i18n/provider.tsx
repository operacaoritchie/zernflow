"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import {
  createFormatter,
  createTranslator,
  type MessageTree,
  type Translator,
} from "./translator";

interface I18nContextValue {
  locale: Locale;
  messages: MessageTree;
  fallback: MessageTree;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  fallback,
  children,
}: I18nContextValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, messages, fallback }), [locale, messages, fallback]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT/useLocale must be used inside <I18nProvider>");
  return ctx;
}

/** Translator for Client Components. Pass a namespace to shorten keys. */
export function useT(namespace?: string): Translator {
  const { locale, messages, fallback } = useI18n();
  return useMemo(
    () => createTranslator(locale, messages, fallback, namespace),
    [locale, messages, fallback, namespace]
  );
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useFormatter() {
  const locale = useLocale();
  return useMemo(() => createFormatter(locale), [locale]);
}
