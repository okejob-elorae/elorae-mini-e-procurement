import { describe, expect, it } from "vitest";
import { rollNeedsFromPlan, rollShortfalls, rollsForItem, withRollColors, withRollItemIds, type RollEntry } from "./roll-allocation";

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

describe("roll sections per finished-good colour (#410)", () => {
  const needs = rollNeedsFromPlan([
    {
      itemId: "fabBlack",
      itemName: "PARACHUTE BLACK",
      plannedQty: 90,
      byColor: [{ colorId: "black", colorName: "Hitam", plannedQty: 90 }],
    },
    {
      itemId: "thread",
      itemName: "Benang",
      plannedQty: 200,
      byColor: [
        { colorId: "black", colorName: "Hitam", plannedQty: 120 },
        { colorId: "grey", colorName: "Abu", plannedQty: 80 },
      ],
    },
    { itemId: "label", itemName: "Label", plannedQty: 100 },
  ]);

  it("makes one section per colour share, or one per line without a mix", () => {
    expect(needs.map((n) => [n.itemId, n.colorId, n.qty])).toEqual([
      ["fabBlack", "black", 90],
      ["thread", "black", 120],
      ["thread", "grey", 80],
      ["label", undefined, 100],
    ]);
  });

  it("checks rolls per colour, and per material when no colour is asked", () => {
    const entries = [
      { itemId: "thread", colorId: "black", rollRef: "T1", qty: 120 },
      { itemId: "thread", colorId: "grey", rollRef: "T2", qty: 50 },
    ];
    expect(rollShortfalls(needs, entries)).toEqual([{ itemId: "thread", colorId: "grey", required: 80, allocated: 50 }]);
    expect(rollShortfalls([{ itemId: "thread", qty: 170 }], entries)).toEqual([]);
  });

  it("gives a roll saved without a colour its material's first colour section", () => {
    const out = withRollColors<RollEntry & { itemId: string }>([{ itemId: "thread", rollRef: "T9", qty: 5 }, { itemId: "label", rollRef: "L1", qty: 1 }], needs);
    expect(out.map((e) => e.colorId)).toEqual(["black", undefined]);
  });
});
