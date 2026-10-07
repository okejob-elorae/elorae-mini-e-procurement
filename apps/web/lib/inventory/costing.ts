/**
 * Stock-moving cost helpers, called only from inside server actions and lib writers. Deliberately
 * NOT a "use server" module: that directive would make every export here a network-callable action
 * that moves stock with no permission check. It also imports nothing from `@/lib/auth` — this file
 * sits on the stock movers' import chain, and next-auth cannot load under vitest, so a value import
 * here breaks every DB spec that reaches it. Gated reads live in `app/actions/inventory.ts`.
 */
import { Decimal } from 'decimal.js';
import { prisma, moveMainStock } from '@elorae/db';

export interface CostCalculationResult {
  previousQty: Decimal;
  previousAvgCost: Decimal;
  previousTotalValue: Decimal;
  incomingQty: Decimal;
  incomingUnitCost: Decimal;
  incomingTotalValue: Decimal;
  newQty: Decimal;
  newAvgCost: Decimal;
  newTotalValue: Decimal;
}

export type StockRef = {
  refType: string;
  refId: string;
  refDocNumber?: string;
  createdById?: string | null;
};

/*
 * InventoryValue keys a variantless row as null OR "" — apps/web/lib/items/mutations.ts creates
 * ERP items with null, while some writers use "". A strict findUnique on the normalized ""
 * spelling misses a real null row, so this mirrors moveMainStock's own OR-tolerant lookup
 * exactly (same orderBy tie-break), and the resolved row's id is passed back to moveMainStock as
 * `inventoryValueId` so the write is guaranteed to land on the same row this read found.
 *
 * Exported so every on-hand-stock pre-check in apps/web reuses this exact lookup instead of a
 * hand-rolled spelling of it. The whole point is the tie-break, not just the OR: callers pass the
 * resolved id straight back into moveMainStock as inventoryValueId, so two callers reading the
 * same null/"" bucket must land on the same row or they interleave two independent balances under
 * one ledger key. Current callers: grn.ts's declineGRNByOwner insufficient-stock guard,
 * inventory.ts (getInventoryValue), vendor-returns.ts (vendor return valuation, create and
 * update), opname-snapshot.ts, opname-approve.ts,
 * canvassing/writer.ts, canvassing/reconcile-writer.ts,
 * field-sales/retur/approve-writer.ts, field-sales/konsi-push-writer.ts,
 * field-sales/writer.ts (konsi approve added lines), konsi-sell-through/writer.ts (a line's
 * unitCost fallback when the store row has no average), and
 * reverseMovingAverage / calculateMovingAverage / reverseInventoryValue below. reconciliation-runner.ts's MATCH_JUBELIO path uses packages/db's locking copy,
 * lockMainInventoryValueRow, instead, because it must lock the row before reading it; and
 * konsi-transfer/writer.ts uses packages/db's resolveReservedInventory, because it draws down a
 * reservation and must act on the row that reservation was made against.
 *
 * packages/db cannot import this (it sits above apps/web), so it carries its own copies — and
 * there are FOUR, not two. moveMainStock and setMainStock in stock-balance.ts, the return-accept
 * restore in sales-return-writer.ts, and lockMainInventoryValueRow in stock-row-lock.ts (the raw
 * `SELECT … FOR UPDATE` behind applyJubelioStockAdjustment, MATCH_JUBELIO, moveMainStock's
 * first-receipt re-read and the superseded-item retirement) all restate this shape, tie-break
 * included. Change this helper, change all four.
 *
 * Two further packages/db lookups are deliberately a DIFFERENT shape and must not be
 * "harmonised" onto this one: reservation-writer.ts's findReservationInventory prefers an exact
 * "" row and only falls back to null, because a bare OR can decrement the sibling row and orphan
 * reservedQty on an item carrying both spellings; and item-price-writer.ts reads avgCost only,
 * item-level with no variant input at all, so it pins no row and needs no tie-break.
 */
export async function findExistingInventoryValueRow(
  prismaClient: any,
  itemId: string,
  variantSku: string | null | undefined
) {
  return variantSku
    ? prismaClient.inventoryValue.findFirst({
        where: { itemId, variantSku },
      })
    : prismaClient.inventoryValue.findFirst({
        where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
      });
}

export async function calculateMovingAverage(
  itemId: string,
  incomingQty: Decimal,
  incomingCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;

  // Get current inventory state
  const current = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals
  const newTotalQty = previousQty.plus(incomingQty);
  const incomingTotalValue = incomingQty.mul(incomingCost);
  const newTotalValue = previousTotalValue.plus(incomingTotalValue);

  // Calculate new average cost
  // Formula: (PreviousTotalValue + IncomingTotalValue) / (PreviousQty + IncomingQty)
  let newAvgCost: Decimal;
  if (newTotalQty.gt(0)) {
    newAvgCost = newTotalValue.div(newTotalQty);
  } else {
    newAvgCost = new Decimal(0);
  }

  // createIfMissing only fires when the OR-tolerant read above found no row at all (a genuine
  // never-before-stocked item, matching the upsert this replaced). When it did find a row,
  // inventoryValueId pins the write to that exact row instead of letting moveMainStock
  // re-resolve independently and potentially land on a sibling null/"" row.
  // totalCost/balanceValue are incomingTotalValue and newTotalValue, computed above and passed
  // straight into the ledger mover below.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: incomingQty.toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    totalCost: incomingTotalValue.toNumber(),
    balanceValue: newTotalValue.toNumber(),
    createIfMissing: true,
    inventoryValueId: current?.id,
    ...ref,
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty,
    incomingUnitCost: incomingCost,
    incomingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}

/**
 * Reverse inventory value for returns/negative adjustments.
 * Outgoing value is at current avg cost; throws if insufficient stock.
 */
export async function reverseInventoryValue(
  itemId: string,
  outgoingQty: Decimal,
  outgoingUnitCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<{ newQty: Decimal; newAvgCost: Decimal; newTotalValue: Decimal }> {
  const prismaClient = tx || prisma;

  const current = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);

  if (!current) throw new Error('No inventory record found');

  const currentQty = new Decimal(current.qtyOnHand.toString());
  const currentAvgCost = new Decimal(current.avgCost.toString());

  if (currentQty.lt(outgoingQty)) {
    throw new Error('Insufficient stock');
  }

  const newQty = currentQty.minus(outgoingQty);
  const outgoingValue = outgoingQty.mul(currentAvgCost);
  const newTotalValue = new Decimal(current.totalValue.toString()).minus(outgoingValue);

  const newAvgCost = newQty.gt(0)
    ? newTotalValue.div(newQty)
    : new Decimal(0);

  // The `if (!current) throw` above already guards the missing-row case (now correctly — the
  // OR-tolerant read finds the row regardless of null/"" spelling, so it fires only when neither
  // spelling exists), so this never legitimately creates a row — no createIfMissing.
  // inventoryValueId pins the write to the exact row `current` was just read from.
  // totalCost is outgoingValue, computed above; balanceValue is the new total — both passed
  // straight into the ledger mover below.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: outgoingQty.neg().toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    totalCost: outgoingValue.toNumber(),
    balanceValue: newTotalValue.toNumber(),
    inventoryValueId: current.id,
    ...ref,
  });

  return { newQty, newAvgCost, newTotalValue };
}

// Reverse calculation for returns (negative quantity) - uses passed cost
export async function reverseMovingAverage(
  itemId: string,
  outgoingQty: Decimal,
  outgoingCost: Decimal,
  tx: any,
  variantSku: string | null | undefined,
  ref: StockRef
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;

  // Get current inventory state
  const current = await findExistingInventoryValueRow(prismaClient, itemId, variantSku);

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals (subtracting)
  const newTotalQty = previousQty.minus(outgoingQty);
  const outgoingTotalValue = outgoingQty.mul(outgoingCost);
  const newTotalValue = previousTotalValue.minus(outgoingTotalValue);

  // Average cost remains the same for outgoing (FIFO-like behavior)
  const newAvgCost = previousAvgCost;

  // The OR-tolerant read above resolves the real row regardless of whether it was created with
  // variantSku null or "" — inventoryValueId pins moveMainStock's write to that same row. A
  // genuinely missing row (neither spelling exists) still reaches moveMainStock's own lookup
  // with no createIfMissing set, so it still throws — that part is unchanged.
  // totalCost is outgoingTotalValue negated below, matching the negated qtyDelta.
  await moveMainStock(prismaClient, {
    itemId,
    variantSku,
    qtyDelta: outgoingQty.neg().toNumber(),
    avgCost: newAvgCost.toNumber(),
    totalValue: newTotalValue.toNumber(),
    totalCost: outgoingTotalValue.neg().toNumber(),
    balanceValue: newTotalValue.toNumber(),
    inventoryValueId: current?.id,
    ...ref,
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty: outgoingQty,
    incomingUnitCost: outgoingCost,
    incomingTotalValue: outgoingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}
