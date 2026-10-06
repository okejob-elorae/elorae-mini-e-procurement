import { describe, it, expect } from "vitest";
import { checkFinalPrices } from "./final-prices";

const lines = [
  { id: "a", requestedUnitPrice: 30000 },
  { id: "b", requestedUnitPrice: null },
];

describe("checkFinalPrices", () => {
  it("accepts exactly one entry per appealed line", () => {
    expect(checkFinalPrices(lines, [{ lineId: "a", finalUnitPrice: 28000 }])).toEqual({ ok: true });
  });

  it("accepts an omitted payload when no line is appealed", () => {
    expect(checkFinalPrices([{ id: "b", requestedUnitPrice: null }], undefined)).toEqual({ ok: true });
  });

  it("refuses an omitted payload when a line is appealed", () => {
    expect(checkFinalPrices(lines, undefined)).toEqual({ ok: false, code: "MISSING_FINAL_PRICE", lineId: "a" });
  });

  it("refuses an entry naming no line on the order", () => {
    expect(
      checkFinalPrices(lines, [
        { lineId: "a", finalUnitPrice: 28000 },
        { lineId: "zzz", finalUnitPrice: 1 },
      ]),
    ).toEqual({ ok: false, code: "UNKNOWN_LINE", lineId: "zzz" });
  });

  it("refuses an entry for a line that was not appealed", () => {
    expect(
      checkFinalPrices(lines, [
        { lineId: "a", finalUnitPrice: 28000 },
        { lineId: "b", finalUnitPrice: 1 },
      ]),
    ).toEqual({ ok: false, code: "NOT_APPEALED", lineId: "b" });
  });

  it("refuses two entries for the same line", () => {
    expect(
      checkFinalPrices(lines, [
        { lineId: "a", finalUnitPrice: 28000 },
        { lineId: "a", finalUnitPrice: 27000 },
      ]),
    ).toEqual({ ok: false, code: "DUPLICATE_LINE", lineId: "a" });
  });

  it.each([
    { finalUnitPrice: -1, label: "negative" },
    { finalUnitPrice: Number.NaN, label: "NaN" },
    { finalUnitPrice: Number.POSITIVE_INFINITY, label: "Infinity" },
  ])("refuses a $label price", ({ finalUnitPrice }) => {
    expect(checkFinalPrices(lines, [{ lineId: "a", finalUnitPrice }])).toEqual({
      ok: false,
      code: "BAD_PRICE",
      lineId: "a",
    });
  });
});
