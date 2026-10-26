import { describe, expect, it } from "vitest";
import { toCsv, UTF8_BOM } from "./csv";

describe("toCsv", () => {
  it("starts with the UTF-8 BOM and ends with a newline", () => {
    const out = toCsv(["A"], [{ A: "x" }]);
    expect(out.startsWith(UTF8_BOM)).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("prefixes text cells that open as formulas, for every trigger", () => {
    for (const trigger of ["=", "+", "-", "@", "\t", "\r"]) {
      const out = toCsv(["A"], [{ A: `${trigger}SUM(1)` }]);
      expect(out).toContain(`"'${trigger}SUM(1)"`);
    }
  });

  it("leaves numbers, including negatives, untouched", () => {
    const out = toCsv(["A", "B"], [{ A: -5, B: 12 }]);
    expect(out).toContain(`"-5","12"`);
  });

  it("writes null and missing cells as empty and doubles embedded quotes", () => {
    const out = toCsv(["A", "B", "C"], [{ A: null, B: `say "hi"` }]);
    expect(out).toContain(`"","say ""hi""",""`);
  });

  it("leaves ordinary text alone", () => {
    expect(toCsv(["A"], [{ A: "Toko Maju" }])).toContain(`"Toko Maju"`);
  });
});
