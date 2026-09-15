import { describe, expect, it } from "vitest";
import { ledgerTypeForDelta } from "./stock-balance";

describe("ledgerTypeForDelta", () => {
  it("types a positive delta as IN", () => {
    expect(ledgerTypeForDelta(5)).toBe("IN");
  });

  it("types a negative delta as OUT", () => {
    expect(ledgerTypeForDelta(-5)).toBe("OUT");
  });

  it("types a zero delta as ADJUSTMENT", () => {
    expect(ledgerTypeForDelta(0)).toBe("ADJUSTMENT");
  });
});
