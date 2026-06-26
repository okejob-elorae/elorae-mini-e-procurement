import { describe, expect, it } from "vitest";
import {
  buildReconciliationReport,
  classifyReconciliationDelta,
  reconciliationTolerance,
} from "./sales-reconciliation";

describe("reconciliationTolerance", () => {
  it("uses at least 2 units", () => {
    expect(reconciliationTolerance(10, 10)).toBe(2);
  });

  it("uses 5% of larger qty when above 2", () => {
    expect(reconciliationTolerance(100, 90)).toBe(5);
  });
});

describe("classifyReconciliationDelta", () => {
  it("classifies within tolerance as IN_SYNC", () => {
    expect(classifyReconciliationDelta(100, 98)).toBe("IN_SYNC");
    expect(classifyReconciliationDelta(10, 12)).toBe("IN_SYNC");
  });

  it("classifies excel higher", () => {
    expect(classifyReconciliationDelta(100, 90)).toBe("EXCEL_HIGHER");
  });

  it("classifies jubelio higher", () => {
    expect(classifyReconciliationDelta(90, 100)).toBe("JUBELIO_HIGHER");
  });
});

describe("buildReconciliationReport", () => {
  it("aggregates per itemId and computes totals", () => {
    const report = buildReconciliationReport({
      channel: "SHOPEE",
      periodMonth: 5,
      periodYear: 2026,
      excelRows: [
        {
          parentSku: "27000020",
          productName: "Dress",
          netQuantity: 30,
          itemId: "item-1",
          resolutionStatus: "MAPPED",
        },
        {
          parentSku: "27000020",
          productName: "Dress",
          netQuantity: 20,
          itemId: "item-1",
          resolutionStatus: "MAPPED",
        },
        {
          parentSku: "UNKNOWN",
          productName: "Mystery",
          netQuantity: 5,
          itemId: null,
          resolutionStatus: "UNMAPPED",
        },
      ],
      jubelioLines: [
        {
          itemId: "item-1",
          parentSku: "27000020",
          productName: "Dress",
          qty: 48,
        },
        {
          itemId: null,
          parentSku: null,
          productName: "Other",
          qty: 3,
        },
      ],
      unmappedSkus: ["UNKNOWN-SKU"],
    });

    expect(report.excelTotal).toBe(55);
    expect(report.jubelioTotal).toBe(51);
    expect(report.delta).toBe(4);
    expect(report.unmappedSkus).toEqual(["UNKNOWN-SKU"]);

    const mapped = report.items.find((r) => r.itemId === "item-1");
    expect(mapped?.excelQty).toBe(50);
    expect(mapped?.jubelioQty).toBe(48);
    expect(mapped?.status).toBe("IN_SYNC");

    const unmapped = report.items.find((r) => r.parentSku === "UNKNOWN");
    expect(unmapped?.excelQty).toBe(5);
    expect(unmapped?.status).toBe("EXCEL_HIGHER");
  });
});
