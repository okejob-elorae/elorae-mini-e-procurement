import { describe, expect, it } from "vitest";
import { STOCK_ADJUSTMENT_SOURCES, isStockAdjustmentSource } from "./stock-adjustment-source";

describe("stock adjustment source registry", () => {
  it("has no duplicate members", () => {
    expect(new Set(STOCK_ADJUSTMENT_SOURCES).size).toBe(STOCK_ADJUSTMENT_SOURCES.length);
  });

  /*
   * Goods back in Gudang Utama after a door refusal or a whole-shipment cancel (owner answers
   * P16/P24/P40) carry their own sources, never the outbound ones: a reader that averages
   * KONSI_TRANSFER (the konsi unit cost) must not see a returned line as another shipment.
   */
  it("registers the two return sources apart from the outbound ones", () => {
    expect(isStockAdjustmentSource("KONSI_TRANSFER_RETURN")).toBe(true);
    expect(isStockAdjustmentSource("FIELD_SALES_CONSUME_RETURN")).toBe(true);
    expect(isStockAdjustmentSource("KONSI_TRANSFER")).toBe(true);
    expect(isStockAdjustmentSource("FIELD_SALES_CONSUME")).toBe(true);
  });

  it("rejects an unknown value and a non-string", () => {
    expect(isStockAdjustmentSource("KONSI_RETURN")).toBe(false);
    expect(isStockAdjustmentSource(undefined)).toBe(false);
  });
});
