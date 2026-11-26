import { describe, expect, it } from "vitest";
import { isPhone } from "./phone";

describe("isPhone", () => {
  it("accepts Brazilian numbers with DDD in common formats", () => {
    for (const t of ["85998372658", "85 99837-2658", "(85) 99837-2658", "+55 85 99837-2658", "5585998372658", "11 4916-8182"]) {
      expect(isPhone(t), t).toBe(true);
    }
  });

  it("rejects replies that are not a phone number", () => {
    for (const t of ["Oi", "ok", "", "   ", "99837-2658", "meu zap é 85998372658", "123456789012345"]) {
      expect(isPhone(t), t).toBe(false);
    }
  });
});
