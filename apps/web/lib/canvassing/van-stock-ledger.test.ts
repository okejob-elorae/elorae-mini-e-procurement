import { describe, expect, it } from "vitest";
import { ledgerTypeForDelta } from "@elorae/db";

describe("van stock ledger typing", () => {
  it("types a van load into the van as IN", () => {
    expect(ledgerTypeForDelta(30)).toBe("IN");
  });

  it("types an on-the-spot sale out of the van as OUT", () => {
    expect(ledgerTypeForDelta(-2)).toBe("OUT");
  });

  it("types emptying the van at reconcile as OUT", () => {
    expect(ledgerTypeForDelta(-28)).toBe("OUT");
  });
});
