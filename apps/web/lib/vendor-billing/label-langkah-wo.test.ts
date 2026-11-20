import { describe, expect, it } from "vitest";
import { labelLangkahWoDoc, namaLangkahWo } from "./label-langkah-wo";

describe("namaLangkahWo", () => {
  it("prefers service type over stepName and sequence", () => {
    expect(namaLangkahWo({ sequence: 2, serviceTypeName: "Jahit/CMT", stepName: "Old" })).toBe("Jahit/CMT");
    expect(namaLangkahWo({ sequence: 2, stepName: "Sablon" })).toBe("Sablon");
    expect(namaLangkahWo({ sequence: 3 })).toBe("3");
  });

  it("trims and skips blanks", () => {
    expect(namaLangkahWo({ sequence: 1, serviceTypeName: "  ", stepName: " Bordir " })).toBe("Bordir");
  });
});

describe("labelLangkahWoDoc", () => {
  it("joins WO number, sequence, and resolved name", () => {
    expect(
      labelLangkahWoDoc({
        woDocNumber: "WO/2026/001",
        sequence: 2,
        serviceTypeName: "Jahit/CMT",
      }),
    ).toBe("WO/2026/001 · 2 · Jahit/CMT");
  });
});
