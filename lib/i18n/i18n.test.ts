import { describe, expect, it } from "vitest";
import { LOCALES, localeFromAcceptLanguage, matchLocale } from "./config";
import { getMessages } from "./messages";
import { createTranslator, type MessageTree } from "./translator";

function flatten(tree: MessageTree, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const isPlural = typeof value === "object" && value !== null && "other" in value;
    if (typeof value === "object" && value !== null && !isPlural) {
      Object.assign(out, flatten(value as MessageTree, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

function placeholders(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
}

const en = flatten(getMessages("en"));

describe("translations", () => {
  for (const locale of LOCALES.filter((l) => l !== "en")) {
    const other = flatten(getMessages(locale));

    it(`${locale} has every key from en`, () => {
      const missing = Object.keys(en).filter((k) => !(k in other));
      expect(missing).toEqual([]);
    });

    it(`${locale} has no keys that en lacks`, () => {
      const extra = Object.keys(other).filter((k) => !(k in en));
      expect(extra).toEqual([]);
    });

    it(`${locale} keeps the same {placeholders} as en`, () => {
      const mismatched = Object.keys(en).filter(
        (k) => k in other && placeholders(en[k]).join() !== placeholders(other[k]).join()
      );
      expect(mismatched).toEqual([]);
    });
  }
});

describe("translator", () => {
  const t = createTranslator("pt-BR", getMessages("pt-BR"), getMessages("en"));

  it("interpolates values", () => {
    expect(t("flows.updated", { date: "1 jan" })).toBe("Atualizado em 1 jan");
  });

  it("picks plural forms", () => {
    expect(t("flows.nodeCount", { count: 1 })).toBe("1 nó");
    expect(t("flows.nodeCount", { count: 3 })).toBe("3 nós");
  });

  it("falls back to the key when missing", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});

describe("locale detection", () => {
  it("matches language variants", () => {
    expect(matchLocale("pt")).toBe("pt-BR");
    expect(matchLocale("pt-PT")).toBe("pt-BR");
    expect(matchLocale("es-MX")).toBe("es");
    expect(matchLocale("fr")).toBeNull();
  });

  it("reads Accept-Language by quality", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7")).toBe("es");
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9")).toBe("pt-BR");
    expect(localeFromAcceptLanguage("de")).toBeNull();
  });
});
