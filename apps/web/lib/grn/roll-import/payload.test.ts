import { describe, expect, it } from "vitest";
import { buildRollPayload } from "./payload";

describe("buildRollPayload", () => {
  it("uses imported refs and notes, falling back to a numbered ref", () => {
    expect(
      buildRollPayload(
        "FAB-01",
        [
          { length: 10, ref: "S-9", notes: "sobek" },
          { length: 5, ref: null, notes: null },
        ],
        [],
      ),
    ).toEqual([
      { rollRef: "S-9", length: 10, notes: "sobek" },
      { rollRef: "FAB-01-2", length: 5 },
    ]);
  });

  it("numbers manual lengths from the sku", () => {
    expect(buildRollPayload("FAB-01", undefined, [3, 4])).toEqual([
      { rollRef: "FAB-01-1", length: 3 },
      { rollRef: "FAB-01-2", length: 4 },
    ]);
  });

  it("falls back to ROLL for an empty sku", () => {
    expect(buildRollPayload("", undefined, [3])).toEqual([{ rollRef: "ROLL-1", length: 3 }]);
  });
});
