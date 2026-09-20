import { describe, expect, it } from "vitest";
import { STOCK_LEDGER_REF_TYPES, isStockLedgerRefType } from "./stock-ledger-ref";

describe("stock ledger ref registry", () => {
  it("has no duplicate members", () => {
    expect(new Set(STOCK_LEDGER_REF_TYPES).size).toBe(STOCK_LEDGER_REF_TYPES.length);
  });

  it("accepts a member", () => {
    expect(isStockLedgerRefType("KonsiTransfer")).toBe(true);
  });

  it("rejects a StockMovement refType, which is a different vocabulary", () => {
    expect(isStockLedgerRefType("ADJUSTMENT")).toBe(false);
    expect(isStockLedgerRefType("OPNAME")).toBe(false);
    expect(isStockLedgerRefType("RECON")).toBe(false);
  });

  it("rejects the fixture-only value", () => {
    expect(isStockLedgerRefType("TEST")).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isStockLedgerRefType(undefined)).toBe(false);
  });
});
