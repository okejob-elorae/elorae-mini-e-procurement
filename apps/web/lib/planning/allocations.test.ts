import { describe, expect, it } from "vitest";
import {
  buildWoPayloadFromCmtRow,
  stageNameFromAllocation,
  validateCmtAllocations,
  validateMonthlyColorAllocations,
} from "./allocations";

describe("validateMonthlyColorAllocations", () => {
  it("passes when sum equals monthly target", () => {
    const result = validateMonthlyColorAllocations(5000, [
      { allocatedQty: 2000 },
      { allocatedQty: 1500 },
      { allocatedQty: 1500 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.sum).toBe(5000);
    expect(result.delta).toBe(0);
    expect(result.message).toBeUndefined();
  });

  it("fails when sum differs from monthly target", () => {
    const result = validateMonthlyColorAllocations(5000, [
      { allocatedQty: 2000 },
      { allocatedQty: 1500 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.sum).toBe(3500);
    expect(result.delta).toBe(-1500);
    expect(result.message).toContain("5000");
  });
});

describe("validateCmtAllocations", () => {
  it("passes when vendor split equals color qty", () => {
    const result = validateCmtAllocations(1000, [
      { allocatedQty: 600 },
      { allocatedQty: 400 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.sum).toBe(1000);
  });

  it("fails when vendor split exceeds color qty", () => {
    const result = validateCmtAllocations(1000, [{ allocatedQty: 1100 }]);
    expect(result.valid).toBe(false);
    expect(result.delta).toBe(100);
  });
});

describe("stageNameFromAllocation", () => {
  it("builds a stable stage label", () => {
    expect(stageNameFromAllocation("JEANS-01", 3, "FG-JEANS-BLU", "Vendor A")).toBe(
      "JEANS-01 · M03 · FG-JEANS-BLU · Vendor A"
    );
  });
});

describe("buildWoPayloadFromCmtRow", () => {
  it("maps CMT row to SKU-mode WO payload with month-end target date", () => {
    const payload = buildWoPayloadFromCmtRow(
      { itemId: "item-1", code: "JEANS-01" },
      {
        month: 3,
        variantSku: "FG-JEANS-BLU",
        supplierId: "sup-1",
        allocatedQty: 500,
      },
      2026
    );

    expect(payload).toEqual({
      finishedGoodId: "item-1",
      vendorId: "sup-1",
      plannedQty: 500,
      variantSku: "FG-JEANS-BLU",
      outputMode: "SKU",
      targetDate: expect.any(Date),
    });
    expect(payload.targetDate.getUTCFullYear()).toBe(2026);
    expect(payload.targetDate.getUTCMonth()).toBe(2);
    expect(payload.targetDate.getUTCDate()).toBe(31);
  });

  it("throws when category has no linked item", () => {
    expect(() =>
      buildWoPayloadFromCmtRow(
        { itemId: null, code: "JEANS-01" },
        {
          month: 1,
          variantSku: "FG-JEANS-BLU",
          supplierId: "sup-1",
          allocatedQty: 100,
        },
        2026
      )
    ).toThrow("finished good");
  });
});
