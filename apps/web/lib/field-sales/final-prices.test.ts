import { describe, it, expect } from "vitest";
import { checkFinalPrices, MAX_LINE_AMOUNT } from "./final-prices";

const lines = [
  { id: "a", requestedUnitPrice: 30000, qty: 1 },
  { id: "b", requestedUnitPrice: null, qty: 1 },
];

describe("checkFinalPrices", () => {
  it("accepts exactly one entry per appealed line", () => {
    expect(checkFinalPrices(lines, [{ lineId: "a", finalUnitPrice: 28000 }])).toEqual({ ok: true });
  });

  it("accepts an omitted payload when no line is appealed", () => {
    expect(checkFinalPrices([{ id: "b", requestedUnitPrice: null, qty: 1 }], undefined)).toEqual({ ok: true });
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
    { finalUnitPrice: 10_000_000_000_000, label: "past-the-column" },
  ])("refuses a $label price", ({ finalUnitPrice }) => {
    expect(checkFinalPrices(lines, [{ lineId: "a", finalUnitPrice }])).toEqual({
      ok: false,
      code: "BAD_PRICE",
      lineId: "a",
    });
  });

  it("accepts a price at exactly the column's maximum", () => {
    expect(checkFinalPrices(lines, [{ lineId: "a", finalUnitPrice: MAX_LINE_AMOUNT }])).toEqual({ ok: true });
  });

  it("refuses a price whose line total would overflow the column", () => {
    const bulk = [{ id: "a", requestedUnitPrice: 30000, qty: 1000 }];
    expect(checkFinalPrices(bulk, [{ lineId: "a", finalUnitPrice: 10_000_000_001 }])).toEqual({
      ok: false,
      code: "BAD_PRICE",
      lineId: "a",
    });
  });
});
