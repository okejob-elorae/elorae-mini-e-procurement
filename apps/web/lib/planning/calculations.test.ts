import { describe, expect, it } from "vitest";
import { buildActualsLookup, getVariantActualFromLookup } from "./calculations";

describe("buildActualsLookup variant actuals", () => {
  it("parses skuBreakdown JSON into monthlyByVariant", () => {
    const lookup = buildActualsLookup(
      [
        {
          finishedGoodId: "fg-1",
          qtyAccepted: 100,
          receivedAt: new Date("2026-03-15T10:00:00.000Z"),
          skuBreakdown: [
            { variantSku: "SKU-BLU", qty: 60 },
            { variantSku: "SKU-RED", qty: 40 },
          ],
        },
      ],
      2026
    );

    expect(getVariantActualFromLookup(lookup, "fg-1", "SKU-BLU", 3)).toBe(60);
    expect(getVariantActualFromLookup(lookup, "fg-1", "SKU-RED", 3)).toBe(40);
    expect(lookup.yearlyByItem.get("fg-1")).toBe(100);
    expect(lookup.monthlyByItem.get("fg-1")?.get(3)).toBe(100);
  });

  it("falls back to qtyAccepted when skuBreakdown is absent", () => {
    const lookup = buildActualsLookup(
      [
        {
          finishedGoodId: "fg-2",
          qtyAccepted: 250,
          receivedAt: new Date("2026-01-20T12:00:00.000Z"),
        },
      ],
      2026
    );

    expect(lookup.yearlyByItem.get("fg-2")).toBe(250);
    expect(lookup.monthlyByItem.get("fg-2")?.get(1)).toBe(250);
    expect(lookup.monthlyByVariant.size).toBe(0);
  });

  it("parses skuBreakdown stored as JSON string", () => {
    const lookup = buildActualsLookup(
      [
        {
          finishedGoodId: "fg-3",
          qtyAccepted: 50,
          receivedAt: new Date("2026-06-01T00:00:00.000Z"),
          skuBreakdown: JSON.stringify([{ variantSku: "SKU-X", qty: 50 }]),
        },
      ],
      2026
    );

    expect(getVariantActualFromLookup(lookup, "fg-3", "SKU-X", 6)).toBe(50);
  });
});
