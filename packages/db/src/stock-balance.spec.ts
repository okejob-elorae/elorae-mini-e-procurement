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

import { deltaForSet } from "./stock-balance";

describe("deltaForSet", () => {
  it("returns the signed difference when a count is higher", () => {
    expect(deltaForSet(3, 10)).toBe(7);
  });

  it("returns a negative difference when a count is lower", () => {
    expect(deltaForSet(10, 3)).toBe(-7);
  });

  it("returns zero when the count matches", () => {
    expect(deltaForSet(5, 5)).toBe(0);
  });
});
