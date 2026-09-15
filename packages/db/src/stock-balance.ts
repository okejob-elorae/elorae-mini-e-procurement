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
   * table is written only through a mover. The one exception is reservation-writer.ts, which
   * decrements qtyOnHand and reservedQty in a single statement (once as a raw guarded UPDATE)
   * and so calls appendStockLedger directly — the movers do not touch reservedQty, and giving
   * them a parameter that moves no stock would blur the qtyOnHand-is-a-movement rule the ledger
   * rests on. Omit both to move quantity without touching cost.
   */
  avgCost?: number | null;
  totalValue?: number | null;
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
};

export type MoveMainStockInput = MoveCommon & {
  /*
   * When no InventoryValue row exists yet, create one at this delta instead of throwing. The
   * movement is the row's opening balance, so the ledger entry carries balanceQty === qtyDelta.
   * Only the paths that legitimately receive stock for a not-yet-stocked item set this.
   */
  createIfMissing?: boolean;
  /*
   * When the caller already resolved the exact row itself — under the same OR-tolerant null/""
   * rule this mover uses below — pass its id here to skip the lookup entirely and update that row
   * directly. This guarantees the write lands on the row the caller read, rather than this mover
   * re-resolving independently and potentially landing on a different row in the same null/""
   * bucket (an item can legitimately have both a null and a "" row).
   */
  inventoryValueId?: string;
};
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
  if (input.inventoryValueId) {
    // The caller resolved this row itself and is trusting us to write to exactly that row — but
    // appendStockLedger below records input.itemId/input.variantSku, not whatever the row we'd
    // blindly update actually belongs to. updateMany's own itemId filter is the ownership check:
    // an id resolved for a different item matches zero rows here instead of silently moving the
    // wrong balance under a ledger entry that lies about which item moved.
    const result = await tx.inventoryValue.updateMany({
      where: { id: input.inventoryValueId, itemId: input.itemId },
      data: {
        qtyOnHand: { increment: input.qtyDelta },
        lastUpdated: new Date(),
        ...(input.avgCost == null ? {} : { avgCost: input.avgCost }),
        ...(input.totalValue == null ? {} : { totalValue: input.totalValue }),
      },
    });

    if (result.count !== 1) {
      throw new Error(
        `moveMainStock: inventoryValueId ${input.inventoryValueId} does not belong to item ${input.itemId}`,
      );
    }

    // updateMany returns only a count, never the row. Re-reading it here is safe for the same
    // reason the reservation-writer read-back is: the row is already locked by the update that
    // just succeeded above, inside this same transaction.
    const reread = await tx.inventoryValue.findUniqueOrThrow({
      where: { id: input.inventoryValueId },
      select: { qtyOnHand: true },
    });
    const balanceQty = Number(reread.qtyOnHand);

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

  const existing = input.variantSku
    ? await tx.inventoryValue.findFirst({
        where: { itemId: input.itemId, variantSku: input.variantSku },
        select: { id: true },
      })
    : await tx.inventoryValue.findFirst({
        where: { itemId: input.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
        select: { id: true },
      });

  if (!existing) {
    if (!input.createIfMissing) {
      throw new Error(
        `moveMainStock: no InventoryValue row for item ${input.itemId} variant ${normaliseVariantKey(input.variantSku)}`,
      );
    }

    await tx.inventoryValue.create({
      data: {
        itemId: input.itemId,
        variantSku: input.variantSku || null,
        qtyOnHand: input.qtyDelta,
        reservedQty: 0,
        avgCost: input.avgCost ?? 0,
        totalValue: input.totalValue ?? 0,
      },
    });

    await appendStockLedger(tx, {
      location: { type: "MAIN" },
      itemId: input.itemId,
      variantSku: input.variantSku,
      type: ledgerTypeForDelta(input.qtyDelta),
      qty: input.qtyDelta,
      balanceQty: input.qtyDelta,
      unitCost: input.unitCost,
      refType: input.refType,
      refId: input.refId,
      refDocNumber: input.refDocNumber,
      createdById: input.createdById,
    });

    return { balanceQty: input.qtyDelta };
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
      avgCost: input.avgCost ?? 0,
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
      avgCost: input.avgCost ?? 0,
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

type SetCommon = {
  itemId: string;
  variantSku: string | null | undefined;
  nextQty: number;
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
};

export type SetMainStockInput = SetCommon;
export type SetStoreStockInput = SetCommon & { storeId: string };

export function deltaForSet(previousQty: number, nextQty: number): number {
  return nextQty - previousQty;
}

/**
 * Sets an absolute main-warehouse quantity, as a physical count does, and records the difference
 * as one ADJUSTMENT entry.
 *
 * Reading before writing is safe here in a way it is not for the delta movers: a count is
 * authoritative by definition, so the last writer legitimately wins and there is no concurrent
 * increment semantics to preserve. A set that changes nothing writes no ledger entry at all.
 */
export async function setMainStock(
  tx: Tx,
  input: SetMainStockInput,
): Promise<{ balanceQty: number; changed: boolean }> {
  const existing = input.variantSku
    ? await tx.inventoryValue.findFirst({
        where: { itemId: input.itemId, variantSku: input.variantSku },
        select: { id: true, qtyOnHand: true },
      })
    : await tx.inventoryValue.findFirst({
        where: { itemId: input.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
        select: { id: true, qtyOnHand: true },
      });

  if (!existing) {
    throw new Error(
      `setMainStock: no InventoryValue row for item ${input.itemId} variant ${normaliseVariantKey(input.variantSku)}`,
    );
  }

  const previousQty = Number(existing.qtyOnHand);
  const delta = deltaForSet(previousQty, input.nextQty);

  if (delta === 0) return { balanceQty: previousQty, changed: false };

  await tx.inventoryValue.update({
    where: { id: existing.id },
    data: { qtyOnHand: input.nextQty, lastUpdated: new Date() },
  });

  await appendStockLedger(tx, {
    location: { type: "MAIN" },
    itemId: input.itemId,
    variantSku: input.variantSku,
    type: "ADJUSTMENT",
    qty: delta,
    balanceQty: input.nextQty,
    refType: input.refType,
    refId: input.refId,
    refDocNumber: input.refDocNumber,
    createdById: input.createdById,
  });

  return { balanceQty: input.nextQty, changed: true };
}

/**
 * The store counterpart, used by the store stocktake approval, which sets the counted figure
 * rather than adjusting by a delta. A stocktake-created row lands at avgCost 0 by existing
 * convention; this does not change that.
 */
export async function setStoreStock(
  tx: Tx,
  input: SetStoreStockInput,
): Promise<{ balanceQty: number; changed: boolean }> {
  const variantSku = normaliseVariantKey(input.variantSku);
  const key = {
    storeId_itemId_variantSku: { storeId: input.storeId, itemId: input.itemId, variantSku },
  };

  const existing = await tx.storeStock.findUnique({ where: key, select: { qty: true } });
  const previousQty = existing ? Number(existing.qty) : 0;
  const delta = deltaForSet(previousQty, input.nextQty);

  if (delta === 0) return { balanceQty: previousQty, changed: false };

  await tx.storeStock.upsert({
    where: key,
    create: {
      storeId: input.storeId,
      itemId: input.itemId,
      variantSku,
      qty: input.nextQty,
      avgCost: 0,
    },
    update: { qty: input.nextQty },
  });

  await appendStockLedger(tx, {
    location: { type: "STORE", storeId: input.storeId },
    itemId: input.itemId,
    variantSku,
    type: "ADJUSTMENT",
    qty: delta,
    balanceQty: input.nextQty,
    refType: input.refType,
    refId: input.refId,
    refDocNumber: input.refDocNumber,
    createdById: input.createdById,
  });

  return { balanceQty: input.nextQty, changed: true };
}
