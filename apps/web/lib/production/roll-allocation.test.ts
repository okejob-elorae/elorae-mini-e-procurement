import { describe, expect, it } from "vitest";
import { rollShortfalls, rollsForItem, withRollItemIds } from "./roll-allocation";

describe("roll allocation per material (#437)", () => {
  const entries = [
    { itemId: "fabX", rollRef: "R1", qty: 30 },
    { itemId: "fabY", rollRef: "R2", qty: 10 },
    { rollRef: "R3", qty: 5 },
  ];

  it("gives a legacy entry without itemId to the WO's consumption material", () => {
    expect(withRollItemIds(entries, "fabX").map((e) => e.itemId)).toEqual(["fabX", "fabY", "fabX"]);
    expect(withRollItemIds(entries, null).map((e) => e.rollRef)).toEqual(["R1", "R2"]);
  });

  it("selects one material's rolls", () => {
    expect(rollsForItem(entries, "fabX", "fabX").map((e) => e.rollRef)).toEqual(["R1", "R3"]);
    expect(rollsForItem(entries, "fabY", "fabX").map((e) => e.rollRef)).toEqual(["R2"]);
    expect(rollsForItem(entries, "acc1", "fabX")).toEqual([]);
  });

  it("reports materials whose allocated rolls fall short, ignoring materials without rolls", () => {
    expect(
      rollShortfalls(
        [
          { itemId: "fabX", qty: 30 },
          { itemId: "fabY", qty: 12 },
          { itemId: "acc1", qty: 100 },
        ],
        withRollItemIds(entries, "fabX"),
      ),
    ).toEqual([{ itemId: "fabY", required: 12, allocated: 10 }]);
  });
});
