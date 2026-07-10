import { describe, expect, it } from "vitest";
import {
  partitionSalesHistoryImportRows,
  salesHistoryRowKey,
} from "./import-skip-partition";

describe("partitionSalesHistoryImportRows", () => {
  const rows = [
    { orderId: "A1", variantSku: "SKU-1", productName: "One" },
    { orderId: "A1", variantSku: "SKU-1", productName: "One dup" },
    { orderId: "A2", variantSku: "SKU-2", productName: "Two" },
    { orderId: "A3", variantSku: "SKU-3", productName: "Three" },
  ];

  it("skips duplicate rows within the same batch", () => {
    const { toInsert, skipped } = partitionSalesHistoryImportRows(
      "SHOPEE",
      rows,
      new Set(),
    );
    expect(toInsert).toHaveLength(3);
    expect(skipped).toEqual([
      {
        orderId: "A1",
        variantSku: "SKU-1",
        productName: "One dup",
        reason: "DUPLICATE_IN_BATCH",
      },
    ]);
  });

  it("skips rows that already exist in the database", () => {
    const existing = new Set([
      salesHistoryRowKey("SHOPEE", "A1", "SKU-1"),
    ]);
    const { toInsert, skipped } = partitionSalesHistoryImportRows(
      "SHOPEE",
      [rows[0]!],
      existing,
    );
    expect(toInsert).toHaveLength(0);
    expect(skipped[0]?.reason).toBe("ALREADY_EXISTS");
  });
});
