import { describe, expect, it } from "vitest";
import { ledgerTypeForDelta } from "./stock-balance";

describe("reservation consume ledger typing", () => {
  it("types a consume out of main as OUT", () => {
    expect(ledgerTypeForDelta(-6)).toBe("OUT");
  });

  it("types a partial consume out of main as OUT", () => {
    expect(ledgerTypeForDelta(-1)).toBe("OUT");
  });

  /*
   * A delivery line can legitimately carry qty 0, which reaches the append as -0. The consume
   * paths derive the entry type from that signed delta rather than hardcoding OUT, so a line
   * that moves nothing is typed as an adjustment the way the movers type it.
   */
  it("types a zero-qty consume line as ADJUSTMENT, not OUT", () => {
    expect(ledgerTypeForDelta(-0)).toBe("ADJUSTMENT");
  });
});
