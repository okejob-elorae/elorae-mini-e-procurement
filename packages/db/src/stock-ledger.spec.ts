import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../generated/prisma/client";
import { appendStockLedger, normaliseVariantKey, resolveLocationKey } from "./stock-ledger";

describe("normaliseVariantKey", () => {
  it("maps null and undefined to the empty string", () => {
    expect(normaliseVariantKey(null)).toBe("");
    expect(normaliseVariantKey(undefined)).toBe("");
  });

  it("leaves a real sku untouched", () => {
    expect(normaliseVariantKey("SKU-RED-L")).toBe("SKU-RED-L");
  });

  it("leaves an already-empty string as the empty string", () => {
    expect(normaliseVariantKey("")).toBe("");
  });
});

describe("resolveLocationKey", () => {
  it("gives MAIN an empty location id", () => {
    expect(resolveLocationKey({ type: "MAIN" })).toEqual({ locationType: "MAIN", locationId: "" });
  });

  it("keys a store on its store id", () => {
    expect(resolveLocationKey({ type: "STORE", storeId: "store_1" })).toEqual({
      locationType: "STORE",
      locationId: "store_1",
    });
  });

  it("keys a van on the canvasser's user id", () => {
    expect(resolveLocationKey({ type: "VAN", userId: "user_1" })).toEqual({
      locationType: "VAN",
      locationId: "user_1",
    });
  });
});

describe("appendStockLedger occurredAt", () => {
  const base = {
    location: { type: "MAIN" } as const,
    itemId: "item_1",
    variantSku: null,
    type: "IN" as const,
    qty: 5,
    balanceQty: 5,
    refType: "GRN",
    refId: "grn_1",
  };
  const fakeTx = () => {
    const create = vi.fn().mockResolvedValue({});
    return { tx: { stockLedgerEntry: { create } } as unknown as Prisma.TransactionClient, create };
  };

  it("stamps createdAt with a historical movement time", async () => {
    const { tx, create } = fakeTx();
    const at = new Date("2024-08-07T00:00:00Z");
    await appendStockLedger(tx, { ...base, occurredAt: at });
    expect(create.mock.calls[0][0].data.createdAt).toBe(at);
  });

  it("leaves createdAt to the database default when omitted", async () => {
    const { tx, create } = fakeTx();
    await appendStockLedger(tx, base);
    expect(create.mock.calls[0][0].data).not.toHaveProperty("createdAt");
  });
});
