import { describe, expect, it } from "vitest";
import { bookedPayable } from "./supplier-payable";

describe("bookedPayable", () => {
  it("returns the credited amount for a single receipt", () => {
    expect(bookedPayable([{ debit: 0, credit: 500_000 }])).toBe(500_000);
  });

  it("sums two partial receipts", () => {
    expect(
      bookedPayable([
        { debit: 0, credit: 300_000 },
        { debit: 0, credit: 200_000 },
      ]),
    ).toBe(500_000);
  });

  it("nets out a reversed receipt", () => {
    /* The debit line is the GRN reversal — direction alone decides its sign. */
    expect(
      bookedPayable([
        { debit: 0, credit: 500_000 },
        { debit: 500_000, credit: 0 },
      ]),
    ).toBe(0);
  });

  it("returns zero when nothing was ever booked", () => {
    expect(bookedPayable([])).toBe(0);
  });

  it("rounds to cents", () => {
    const payable = bookedPayable([
      { debit: 0, credit: 0.1 },
      { debit: 0, credit: 0.2 },
    ]);
    expect(payable).toBe(0.3);
  });

  it("can go negative if reversals exceed receipts, which the caller must treat as nothing to pay", () => {
    expect(
      bookedPayable([
        { debit: 0, credit: 100_000 },
        { debit: 150_000, credit: 0 },
      ]),
    ).toBe(-50_000);
  });

  it("rounds per-line before summing, not sum-then-round", () => {
    /*
     * Three lines of 0.015 each:
     * Per-line rounding: toCents(0.015) = round(1.5) = 2 cents per line
     * → 2 + 2 + 2 = 6 cents = 0.06
     * Sum-then-round would give: (0.015 + 0.015 + 0.015) * 100 = 4.5
     * → round(4.5) = 5 cents = 0.05 (Math.round is half-up)
     * This case discriminates the two strategies.
     */
    const payable = bookedPayable([
      { debit: 0, credit: 0.015 },
      { debit: 0, credit: 0.015 },
      { debit: 0, credit: 0.015 },
    ]);
    expect(payable).toBe(0.06);
  });
});
