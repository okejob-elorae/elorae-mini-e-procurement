import type { Prisma } from "../generated/prisma/client";
import { appendStockLedger, normaliseVariantKey, type StockLedgerEntryType } from "./stock-ledger";

type Tx = Prisma.TransactionClient;

type MoveCommon = {
  itemId: string;
  variantSku: string | null | undefined;
  qtyDelta: number;
  unitCost?: number | null;
  /*
   * Cost moves in the SAME update as quantity. Callers that previously recomputed a weighted
   * average and issued their own follow-up update pass the result here instead, so a balance
   * table is never written outside a mover and the write guard needs no extra exceptions.
   * Omit both to move quantity without touching cost.
   */
  avgCost?: number | null;
  totalValue?: number | null;
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
};

export type MoveMainStockInput = MoveCommon;
export type MoveStoreStockInput = MoveCommon & { storeId: string };
export type MoveVanStockInput = MoveCommon & { userId: string };

export function ledgerTypeForDelta(qtyDelta: number): StockLedgerEntryType {
  if (qtyDelta > 0) return "IN";
  if (qtyDelta < 0) return "OUT";
  return "ADJUSTMENT";
}

/**
 * Moves main-warehouse stock and records the movement, in one call, inside the caller's
 * transaction.
 *
 * The balance for the ledger row comes from the atomic update's own return value. Reading it
 * back separately would race the concurrent webhook workers, which is exactly the class of bug
 * the atomic increment rule exists to prevent.
 *
 * InventoryValue keys variantless rows as null OR "", both legitimately, so the row lookup stays
 * OR-tolerant. The ledger normalises to "" on the way out; the balance table is left alone.
 */
export async function moveMainStock(tx: Tx, input: MoveMainStockInput): Promise<{ balanceQty: number }> {
  const existing = input.variantSku
    ? await tx.inventoryValue.findFirst({
        where: { itemId: input.itemId, variantSku: input.variantSku },
        select: { id: true },
      })
    : await tx.inventoryValue.findFirst({
        where: { itemId: input.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        select: { id: true },
      });

  if (!existing) {
    throw new Error(
      `moveMainStock: no InventoryValue row for item ${input.itemId} variant ${normaliseVariantKey(input.variantSku)}`,
    );
  }

  const updated = await tx.inventoryValue.update({
    where: { id: existing.id },
    data: {
      qtyOnHand: { increment: input.qtyDelta },
      lastUpdated: new Date(),
      ...(input.avgCost == null ? {} : { avgCost: input.avgCost }),
      ...(input.totalValue == null ? {} : { totalValue: input.totalValue }),
    },
    select: { qtyOnHand: true },
  });

  const balanceQty = Number(updated.qtyOnHand);

  await appendStockLedger(tx, {
    location: { type: "MAIN" },
    itemId: input.itemId,
    variantSku: input.variantSku,
    type: ledgerTypeForDelta(input.qtyDelta),
    qty: input.qtyDelta,
    balanceQty,
    unitCost: input.unitCost,
    refType: input.refType,
    refId: input.refId,
    refDocNumber: input.refDocNumber,
    createdById: input.createdById,
  });

  return { balanceQty };
}

/**
 * StoreStock.variantSku is non-nullable, so the key normalises on write. A store balance may go
 * negative on purpose — a stocktake is the correction path — so there is no floor guard here.
 */
export async function moveStoreStock(tx: Tx, input: MoveStoreStockInput): Promise<{ balanceQty: number }> {
  const variantSku = normaliseVariantKey(input.variantSku);
  const key = {
    storeId_itemId_variantSku: { storeId: input.storeId, itemId: input.itemId, variantSku },
  };

  const updated = await tx.storeStock.upsert({
    where: key,
    create: {
      storeId: input.storeId,
      itemId: input.itemId,
      variantSku,
      qty: input.qtyDelta,
      avgCost: 0,
    },
    update: {
      qty: { increment: input.qtyDelta },
      ...(input.avgCost == null ? {} : { avgCost: input.avgCost }),
    },
    select: { qty: true },
  });

  const balanceQty = Number(updated.qty);

  await appendStockLedger(tx, {
    location: { type: "STORE", storeId: input.storeId },
    itemId: input.itemId,
    variantSku,
    type: ledgerTypeForDelta(input.qtyDelta),
    qty: input.qtyDelta,
    balanceQty,
    unitCost: input.unitCost,
    refType: input.refType,
    refId: input.refId,
    refDocNumber: input.refDocNumber,
    createdById: input.createdById,
  });

  return { balanceQty };
}

/**
 * VanStock.variantSku is nullable, and its writers insert "". The upsert key must therefore match
 * what the existing writers use — the normalised empty string — or a second row forks alongside.
 */
export async function moveVanStock(tx: Tx, input: MoveVanStockInput): Promise<{ balanceQty: number }> {
  const variantSku = normaliseVariantKey(input.variantSku);
  const key = {
    userId_itemId_variantSku: { userId: input.userId, itemId: input.itemId, variantSku },
  };

  const updated = await tx.vanStock.upsert({
    where: key,
    create: {
      userId: input.userId,
      itemId: input.itemId,
      variantSku,
      qty: input.qtyDelta,
      avgCost: 0,
    },
    update: {
      qty: { increment: input.qtyDelta },
      ...(input.avgCost == null ? {} : { avgCost: input.avgCost }),
    },
    select: { qty: true },
  });

  const balanceQty = Number(updated.qty);

  await appendStockLedger(tx, {
    location: { type: "VAN", userId: input.userId },
    itemId: input.itemId,
    variantSku,
    type: ledgerTypeForDelta(input.qtyDelta),
    qty: input.qtyDelta,
    balanceQty,
    unitCost: input.unitCost,
    refType: input.refType,
    refId: input.refId,
    refDocNumber: input.refDocNumber,
    createdById: input.createdById,
  });

  return { balanceQty };
}
