import { describe, expect, it } from "vitest";
import { ledgerTypeForDelta } from "./stock-balance";

describe("reservation consume ledger typing", () => {
  it("types a consume out of main as OUT", () => {
    expect(ledgerTypeForDelta(-6)).toBe("OUT");
  });

  it("types a partial consume out of main as OUT", () => {
    expect(ledgerTypeForDelta(-1)).toBe("OUT");
  });
});
