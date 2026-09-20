import { describe, expect, it } from "vitest";
import { STOCK_LEDGER_REF_TYPES, isStockLedgerRefType } from "./stock-ledger-ref";

describe("stock ledger ref registry", () => {
  it("has no duplicate members", () => {
    expect(new Set(STOCK_LEDGER_REF_TYPES).size).toBe(STOCK_LEDGER_REF_TYPES.length);
  });

  it("accepts a member", () => {
    expect(isStockLedgerRefType("KonsiTransfer")).toBe(true);
  });

  /*
   * These three happen not to overlap, which proves nothing about the vocabularies as a
   * whole — see the test below. Non-membership is never evidence that a value belongs to
   * some other table.
   */
  it("rejects the StockMovement spellings that happen not to overlap", () => {
    expect(isStockLedgerRefType("ADJUSTMENT")).toBe(false);
    expect(isStockLedgerRefType("OPNAME")).toBe(false);
    expect(isStockLedgerRefType("RECON")).toBe(false);
  });

  /*
   * The overlap IS the point. "GRN" is a member of this registry AND a StockMovement.refType
   * written a few lines from the ledger append in the same writer, so membership can never be
   * used to tell one table's values from the other's. A resolver pointed at the wrong table
   * half-resolves: every value falls back to the raw string except the colliding ones, which
   * renders as a missing locale key rather than as the vocabulary mix-up it actually is.
   */
  it("accepts a spelling the StockMovement vocabulary also uses, because the two overlap", () => {
    expect(isStockLedgerRefType("GRN")).toBe(true);
  });

  it("rejects the fixture-only value", () => {
    expect(isStockLedgerRefType("TEST")).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isStockLedgerRefType(undefined)).toBe(false);
  });
});
