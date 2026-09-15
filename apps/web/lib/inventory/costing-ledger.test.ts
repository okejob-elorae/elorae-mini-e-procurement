import { describe, expect, it } from "vitest";
import { ledgerTypeForDelta } from "@elorae/db";

describe("receipt path ledger typing", () => {
  it("types a goods receipt as IN", () => {
    expect(ledgerTypeForDelta(100)).toBe("IN");
  });

  it("types a vendor return as OUT", () => {
    expect(ledgerTypeForDelta(-100)).toBe("OUT");
  });
});
