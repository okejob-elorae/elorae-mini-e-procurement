import type { Prisma } from "../generated/prisma/client";

export type StockLocation =
  | { type: "MAIN" }
  | { type: "STORE"; storeId: string }
  | { type: "VAN"; userId: string };

export type StockLedgerEntryType = "OPENING" | "IN" | "OUT" | "ADJUSTMENT";

export type AppendStockLedgerInput = {
  location: StockLocation;
  itemId: string;
  variantSku: string | null | undefined;
  type: StockLedgerEntryType;
  qty: number;
  balanceQty: number;
  unitCost?: number | null;
  totalCost?: number | null;
  balanceValue?: number | null;
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
};

/**
 * The ledger stores exactly one spelling of "no variant": the empty string. The balance tables
 * disagree with each other on this (InventoryValue and VanStock allow null, StoreStock does not)
 * and are deliberately left alone, so the normalisation happens here and nowhere else.
 */
export function normaliseVariantKey(variantSku: string | null | undefined): string {
  return variantSku ?? "";
}

export function resolveLocationKey(location: StockLocation): {
  locationType: "MAIN" | "STORE" | "VAN";
  locationId: string;
} {
  switch (location.type) {
    case "MAIN":
      return { locationType: "MAIN", locationId: "" };
    case "STORE":
      return { locationType: "STORE", locationId: location.storeId };
    case "VAN":
      return { locationType: "VAN", locationId: location.userId };
  }
}

/**
 * Appends one movement row. Always called inside the caller's transaction, never best-effort:
 * if this throws, the balance write that produced it rolls back with it.
 *
 * `balanceQty` is supplied by the caller because only the caller knows the post-write balance
 * atomically — it comes from the return value of the update that moved the balance, never from
 * a separate read, which would race the concurrent webhook workers across processes.
 */
export async function appendStockLedger(
  tx: Prisma.TransactionClient,
  input: AppendStockLedgerInput,
): Promise<void> {
  const { locationType, locationId } = resolveLocationKey(input.location);

  await tx.stockLedgerEntry.create({
    data: {
      locationType,
      locationId,
      itemId: input.itemId,
      variantSku: normaliseVariantKey(input.variantSku),
      type: input.type,
      qty: input.qty,
      balanceQty: input.balanceQty,
      unitCost: input.unitCost ?? null,
      totalCost: input.totalCost ?? null,
      balanceValue: input.balanceValue ?? null,
      refType: input.refType,
      refId: input.refId,
      refDocNumber: input.refDocNumber ?? "",
      createdById: input.createdById ?? null,
    },
  });
}
