import { describe, expect, it } from "vitest";
import { buildItemLines, filterOpnameLines, summarizeLines } from "./opname-detail-utils";

describe("opname-detail-utils", () => {
  it("summarizes counted, pending, and variance lines", () => {
    const lines = buildItemLines([
      {
        id: "1",
        itemName: "A",
        variantSku: "SKU-A",
        snapshotQty: 10,
        countedQty: 12,
        variance: 2,
      },
      {
        id: "2",
        itemName: "B",
        variantSku: "SKU-B",
        snapshotQty: 5,
        countedQty: 5,
        variance: 0,
      },
      {
        id: "3",
        itemName: "C",
        variantSku: "SKU-C",
        snapshotQty: 1,
        countedQty: null,
        variance: null,
      },
    ]);

    expect(summarizeLines(lines)).toEqual({
      totalLines: 3,
      countedLines: 2,
      pendingLines: 1,
      varianceLines: 1,
      matchLines: 1,
    });
  });

  it("filters variance lines only", () => {
    const lines = buildItemLines([
      {
        id: "1",
        itemName: "A",
        snapshotQty: 1,
        countedQty: 2,
        variance: 1,
      },
      {
        id: "2",
        itemName: "B",
        snapshotQty: 1,
        countedQty: 1,
        variance: 0,
      },
    ]);

    expect(filterOpnameLines(lines, "variance")).toHaveLength(1);
    expect(filterOpnameLines(lines, "variance")[0]?.id).toBe("1");
  });
});
