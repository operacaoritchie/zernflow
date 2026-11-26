import { describe, expect, it } from "vitest";
import { isCpf, validateFieldValue } from "./field-validation";

describe("isCpf", () => {
  it("accepts valid CPFs with or without punctuation", () => {
    expect(isCpf("529.982.247-25")).toBe(true);
    expect(isCpf("52998224725")).toBe(true);
  });

  it("rejects wrong check digits, repeated digits and non-numbers", () => {
    expect(isCpf("529.982.247-26")).toBe(false);
    expect(isCpf("111.111.111-11")).toBe(false);
    expect(isCpf("1234567890")).toBe(false);
    expect(isCpf("Oi")).toBe(false);
    expect(isCpf("")).toBe(false);
  });
});

describe("validateFieldValue", () => {
  it("stores phones as digits only and rejects non-phones", () => {
    expect(validateFieldValue("phone", "(85) 99837-2658")).toEqual({ ok: true, value: "85998372658" });
    expect(validateFieldValue("phone", "Oi")).toEqual({ ok: false, reason: "invalid" });
  });

  it("stores CPFs as digits only", () => {
    expect(validateFieldValue("cpf", "529.982.247-25")).toEqual({ ok: true, value: "52998224725" });
    expect(validateFieldValue("cpf", "123")).toEqual({ ok: false, reason: "invalid" });
  });

  it("lower-cases valid e-mails and rejects malformed ones", () => {
    expect(validateFieldValue("email", " Ana@Exemplo.com ")).toEqual({ ok: true, value: "ana@exemplo.com" });
    expect(validateFieldValue("email", "ana@exemplo")).toEqual({ ok: false, reason: "invalid" });
  });

  it("checks numbers and urls", () => {
    expect(validateFieldValue("number", "12,5")).toEqual({ ok: true, value: "12.5" });
    expect(validateFieldValue("number", "doze")).toEqual({ ok: false, reason: "invalid" });
    expect(validateFieldValue("url", "https://exemplo.com")).toEqual({ ok: true, value: "https://exemplo.com" });
    expect(validateFieldValue("url", "exemplo")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps text fields as before and only treats an empty value as missing on checked types", () => {
    expect(validateFieldValue("text", "Oi")).toEqual({ ok: true, value: "Oi" });
    expect(validateFieldValue(undefined, "qualquer")).toEqual({ ok: true, value: "qualquer" });
    expect(validateFieldValue("text", "")).toEqual({ ok: true, value: "" });
    expect(validateFieldValue("phone", "   ")).toEqual({ ok: false, reason: "empty" });
  });
});
