import { describe, expect, it } from "vitest";
import type { CommissionEvent, RecapRow } from "./compute";
import {
  detailKey,
  formatSignedRupiah,
  ratesByDetail,
  recapMonthOptions,
  shiftYearMonth,
  storeLabel,
  sumRecapRows,
} from "./recap-display";

function event(overrides: Partial<CommissionEvent>): CommissionEvent {
  return {
    yearMonth: "2026-10",
    kind: "EARNED",
    sellThroughId: "st1",
    storeId: "s1",
    salesmanId: "u1",
    categoryId: "c1",
    pieces: 1,
    ratePerPiece: 1000,
    amount: 1000,
    ...overrides,
  };
}

function row(overrides: Partial<RecapRow>): RecapRow {
  return { salesmanId: "u1", storeIds: [], pieces: 0, earned: 0, reversed: 0, net: 0, noRatePieces: 0, ...overrides };
}

describe("shiftYearMonth", () => {
  it("moves within a year", () => {
    expect(shiftYearMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftYearMonth("2026-10", -3)).toBe("2026-07");
  });

  it("crosses year boundaries both ways", () => {
    expect(shiftYearMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftYearMonth("2026-03", -15)).toBe("2024-12");
  });

  it("returns the same month for a zero shift", () => {
    expect(shiftYearMonth("2026-10", 0)).toBe("2026-10");
  });
});

describe("recapMonthOptions", () => {
  it("lists the run ending at the current month, newest first", () => {
    expect(recapMonthOptions("2026-02", "2026-01", 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
  });

  it("adds a selected month outside the run in chronological place", () => {
    expect(recapMonthOptions("2026-02", "2024-05", 2)).toEqual(["2026-02", "2026-01", "2024-05"]);
  });

  it("adds a future selected month at the top", () => {
    expect(recapMonthOptions("2026-02", "2026-04", 2)).toEqual(["2026-04", "2026-02", "2026-01"]);
  });
});

describe("ratesByDetail", () => {
  it("collects distinct rates ascending per SPG × category", () => {
    const rates = ratesByDetail([
      event({ ratePerPiece: 1500 }),
      event({ kind: "REVERSED", ratePerPiece: 1000, pieces: -2, amount: -2000 }),
      event({ ratePerPiece: 1500 }),
      event({ salesmanId: "u2", ratePerPiece: 700 }),
    ]);
    expect(rates.get(detailKey("u1", "c1"))).toEqual({ rates: [1000, 1500], unrated: false });
    expect(rates.get(detailKey("u2", "c1"))).toEqual({ rates: [700], unrated: false });
  });

  it("marks a row whose events earned without a rate, uncategorised included", () => {
    const rates = ratesByDetail([event({ categoryId: null, ratePerPiece: null, amount: 0 })]);
    expect(rates.get(detailKey("u1", null))).toEqual({ rates: [], unrated: true });
  });

  it("keeps a null category apart from a real one", () => {
    expect(detailKey("u1", null)).not.toBe(detailKey("u1", "c1"));
  });
});

describe("sumRecapRows", () => {
  it("sums signed figures without flooring", () => {
    expect(
      sumRecapRows([
        row({ pieces: 3, earned: 3000, reversed: 0, net: 3000 }),
        row({ salesmanId: "u2", pieces: -2, earned: 0, reversed: -2000, net: -2000 }),
      ]),
    ).toEqual({ pieces: 1, earned: 3000, reversed: -2000, net: 1000 });
  });

  it("is all zeros for no rows", () => {
    expect(sumRecapRows([])).toEqual({ pieces: 0, earned: 0, reversed: 0, net: 0 });
  });
});

describe("formatSignedRupiah", () => {
  it("groups whole rupiah the id-ID way", () => {
    expect(formatSignedRupiah(1234567)).toBe("Rp 1.234.567");
    expect(formatSignedRupiah(0)).toBe("Rp 0");
  });

  it("puts the minus ahead of the currency", () => {
    expect(formatSignedRupiah(-2000)).toBe("-Rp 2.000");
  });
});

describe("storeLabel", () => {
  it("joins names in name order and falls back to the id", () => {
    expect(storeLabel(["s2", "s1", "s9"], { s1: "Toko B", s2: "Toko A" })).toBe("s9, Toko A, Toko B");
  });
});
