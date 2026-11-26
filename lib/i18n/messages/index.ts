import type { Locale } from "../config";
import type { MessageTree } from "../translator";
import en from "./en.json";
import ptBR from "./pt-BR.json";
import es from "./es.json";

const MESSAGES: Record<Locale, MessageTree> = {
  en,
  "pt-BR": ptBR,
  es,
};

export function getMessages(locale: Locale): MessageTree {
  return MESSAGES[locale] ?? MESSAGES.en;
}
