import { describe, expect, it } from "vitest";
import { deltaForSet, ledgerTypeForDelta } from "@elorae/db";

describe("store stock ledger typing", () => {
  it("types a retur decrement out of a store as OUT", () => {
    expect(ledgerTypeForDelta(-4)).toBe("OUT");
  });

  it("types a konsi transfer into a store as IN", () => {
    expect(ledgerTypeForDelta(12)).toBe("IN");
  });

  it("types an approved stocktake shortfall as a negative adjustment", () => {
    expect(deltaForSet(20, 17)).toBe(-3);
  });

  it("types an approved stocktake surplus as a positive adjustment", () => {
    expect(deltaForSet(17, 20)).toBe(3);
  });
});
