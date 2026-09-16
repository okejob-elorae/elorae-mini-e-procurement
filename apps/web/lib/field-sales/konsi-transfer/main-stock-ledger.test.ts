import { describe, expect, it } from "vitest";
import { ledgerTypeForDelta } from "@elorae/db";

describe("field sales main stock ledger typing", () => {
  it("types a konsi transfer out of main as OUT", () => {
    expect(ledgerTypeForDelta(-12)).toBe("OUT");
  });

  it("types a field retur restore into main as IN", () => {
    expect(ledgerTypeForDelta(12)).toBe("IN");
  });
});
