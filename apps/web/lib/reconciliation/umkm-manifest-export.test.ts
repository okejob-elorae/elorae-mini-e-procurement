import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { manifestToXlsxBuffer } from "./umkm-manifest-export";
import type { ManifestResult } from "./umkm-opening-stock";

function minimalManifest(): ManifestResult {
  return {
    cutoff: new Date("2026-04-30T00:00:00.000Z"),
    excelMaxTgl: new Date("2025-12-17T00:00:00.000Z"),
    salesMaxDate: new Date("2026-04-30T00:00:00.000Z"),
    rows: [
      {
        parentKode: "24000001T",
        erpVariantSku: "24000001T-S",
        size: "S",
        namaBarang: "TANK TOP",
        excelSizeQty: 136,
        excelParentQty: 412,
        excelLatestTgl: "2025-06-21",
        excelLineCount: 1,
        itemId: "item1",
        parentItemSku: "240000-G107",
        itemName: "Test Item",
        jubelioItemId: 1908,
        jubelioItemCode: "24000001T-CRM-S",
        mappedVia: "jubelio_size_variant",
        salesAllocatedQty: 57,
        fakeBuyCreditQty: 5,
        otherDeductionQty: 3,
        netSalesDeductionQty: 52,
        salesParentTotal: 172,
        salesShopeeQty: 122,
        salesTiktokQty: 50,
        shopeeOrderCount: 2,
        tiktokOrderCount: 1,
        salesEarliestDate: "2025-06-23",
        salesLatestDate: "2026-02-22",
        currentQty: 0,
        impliedOnHand: 79,
        delta: 79,
        status: "OK",
      },
    ],
    salesOrders: [
      {
        parentKode: "24000001T",
        channel: "SHOPEE",
        orderId: "250623AVHFUPYJ",
        orderDate: "2025-06-23",
        netQuantity: 1,
        productName: "Tank Top",
      },
    ],
    variantMap: [
      {
        parentKode: "24000001T",
        erpVariantSku: "24000001T-S",
        size: "S",
        jubelioItemCode: "24000001T-CRM-S",
        jubelioItemId: 1908,
        parentItemSku: "240000-G107",
        itemName: "Test Item",
      },
    ],
    fakeBuyCredits: [
      {
        sourceFile: "FAKE BUY.xlsx",
        sourceSheet: "Sheet1",
        deductionType: "fake_buy",
        parentKode: "24000001T",
        erpVariantSku: "24000001T-S",
        size: "S",
        qty: 1,
        orderId: "250623AVHFUPYJ",
        referenceId: "250623AVHFUPYJ",
        channel: "SHOPEE",
        tanggal: "2025-06-23",
        matchedInSalesHistory: true,
      },
    ],
    otherDeductions: [],
    otherSourcesSkipped: [],
    otherSourcesSummary: {
      fakeBuyLineCount: 1,
      deductionLineCount: 0,
      skippedLineCount: 0,
      duplicateCount: 0,
      byDeductionType: { fake_buy: 1 },
      bySourceFile: { "FAKE BUY.xlsx": 1 },
    },
    summary: {
      totalVariantRows: 1,
      totalParentSkus: 1,
      mapped: 1,
      unmapped: 0,
      withSales: 1,
      negativeImplied: 0,
      applyable: 1,
    },
  };
}

describe("manifestToXlsxBuffer", () => {
  it("writes workbook with phase-2 sheets", () => {
    const buffer = manifestToXlsxBuffer(minimalManifest());
    const workbook = XLSX.read(buffer, { type: "buffer" });

    expect(workbook.SheetNames).toEqual([
      "Summary",
      "Manifest",
      "SalesOrders",
      "FakeBuyCredits",
      "OtherDeductions",
      "OtherSourcesSkipped",
      "VariantMap",
    ]);

    const manifest = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets.Manifest,
    );
    expect(manifest[0].shopeeOrderCount).toBe(2);
    expect(manifest[0].fakeBuyCreditQty).toBe(5);
    expect(manifest[0].otherDeductionQty).toBe(3);
    expect(manifest[0].shopeeOrderIds).toBeUndefined();
    expect(manifest[0].tiktokOrderIds).toBeUndefined();

    const fakeBuy = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets.FakeBuyCredits,
    );
    expect(fakeBuy[0].matchedInSalesHistory).toBe(true);

    const orders = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets.SalesOrders,
    );
    expect(orders[0].orderId).toBe("250623AVHFUPYJ");
  });
});
