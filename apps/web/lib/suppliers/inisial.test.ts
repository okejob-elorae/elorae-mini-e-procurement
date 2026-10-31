import { describe, expect, it } from "vitest";
import { inisialPemasok } from "./inisial";

describe("inisialPemasok", () => {
  it("skips the business form and takes two initials", () => {
    expect(inisialPemasok("PT Kain Indah")).toBe("KI");
    expect(inisialPemasok("CV. Lainnya")).toBe("LA");
    expect(inisialPemasok("UD KHARISMA")).toBe("KH");
    expect(inisialPemasok("Penjahit Pak Budi")).toBe("PP");
  });

  it("one word gives its first two letters", () => {
    expect(inisialPemasok("JOHAN")).toBe("JO");
    expect(inisialPemasok("wellwish")).toBe("WE");
  });

  it("ignores punctuation and empty names", () => {
    expect(inisialPemasok("  (Aksesoris) Jaya  ")).toBe("AJ");
    expect(inisialPemasok("")).toBe("?");
    expect(inisialPemasok(null)).toBe("?");
  });
});
