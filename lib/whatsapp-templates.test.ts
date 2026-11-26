import { describe, expect, it } from "vitest";
import {
  countPlaceholders,
  normalizeTemplateName,
  normalizeWhatsAppPhone,
} from "./whatsapp-templates";

describe("normalizeWhatsAppPhone", () => {
  it("adds Brazil's country code to numbers typed with DDD only", () => {
    expect(normalizeWhatsAppPhone("(85) 99837-2658")).toBe("5585998372658");
    expect(normalizeWhatsAppPhone("85 9837-2658")).toBe("558598372658");
  });

  it("keeps numbers that already have a country code", () => {
    expect(normalizeWhatsAppPhone("+55 85 99837-2658")).toBe("5585998372658");
    expect(normalizeWhatsAppPhone("+1 310 555 1234")).toBe("13105551234");
    expect(normalizeWhatsAppPhone("0055 85 99837 2658")).toBe("5585998372658");
  });

  it("rejects text that is not a phone", () => {
    expect(normalizeWhatsAppPhone("oi")).toBeNull();
    expect(normalizeWhatsAppPhone("12345")).toBeNull();
    expect(normalizeWhatsAppPhone("")).toBeNull();
    expect(normalizeWhatsAppPhone(undefined)).toBeNull();
  });
});

describe("countPlaceholders", () => {
  it("counts distinct numbered and named variables", () => {
    expect(countPlaceholders("Oi {{1}}, sua vaga {{2}} está reservada")).toBe(2);
    expect(countPlaceholders("{{1}} e de novo {{1}}")).toBe(1);
    expect(countPlaceholders("Olá {{nome}}")).toBe(1);
    expect(countPlaceholders("sem variáveis")).toBe(0);
    expect(countPlaceholders(null)).toBe(0);
  });
});

describe("normalizeTemplateName", () => {
  it("follows Meta's naming rule", () => {
    expect(normalizeTemplateName("Convite Vaga Curso")).toBe("convite_vaga_curso");
    expect(normalizeTemplateName("Promoção de Férias!")).toBe("promocao_de_ferias");
    expect(normalizeTemplateName("2024 lançamento")).toBe("lancamento");
  });
});
