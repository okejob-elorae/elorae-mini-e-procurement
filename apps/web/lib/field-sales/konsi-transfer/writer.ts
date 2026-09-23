import { InventoryValueMissingError, moveMainStock, moveStoreStock, type Prisma } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { generateDocNumber } from "@/lib/docNumber";
import { KonsiTransferReservationMismatchError } from "../errors";

type TxClient = Prisma.TransactionClient;

export type IssueKonsiTransferLine = {
  id: string;
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
};

/**
 * Moves konsi stock out of the main warehouse and into a store's virtual warehouse, inside the
 * caller's transaction. Runs at delivery-shipment COMPLETION (one call per completed shipment,
 * one transfer per shipment), never at approve — approve only reserves. Each line's `qty` is the
 * DELIVERED quantity for that shipment, not the order-line quantity, so the reservation approve
 * created is consumed PARTIALLY: a short or refused delivery never lands units at the store, and
 * a second shipment against the same line draws down the same reservation further.
 *
 * qtyOnHand and reservedQty must decrement TOGETHER. The reservation approve created already
 * covers this line's qty, so decrementing one without the other would leave stock reserved
 * against nothing, forever. The quantity goes through moveMainStock, pinned to the row id
 * resolved below; the reservedQty decrement follows immediately after on that same id, as a plain
 * atomic update outside the mover — it writes no ledger entry, because a reservation resolving is
 * not a stock movement. A future edit must not separate the two writes or let anything run
 * between them.
 */
export async function issueKonsiTransfer(
  tx: TxClient,
  input: {
    order: { id: string; storeId: string; lines: IssueKonsiTransferLine[] };
    shipmentId: string;
    transferredById: string;
  },
): Promise<{ transferId: string; docNo: string }> {
  const docNo = await generateDocNumber("KONSITRF", tx);

  const transfer = await tx.konsiTransfer.create({
    data: {
      docNo,
      orderId: input.order.id,
      storeId: input.order.storeId,
      shipmentId: input.shipmentId,
      transferredById: input.transferredById,
    },
    select: { id: true },
  });

  const lineData: Array<{ transferId: string; orderLineId: string; itemId: string; variantSku: string; productName: string; qty: number; unitCost: number }> = [];

  for (const l of input.order.lines) {
    /**
     * Partial consume of the reservation approve created, folded into one guarded statement so a
     * concurrent completion cannot pass a stale read — the same idiom
     * `consumeFieldSalesOrderPartial` uses. It runs BEFORE any balance write for this line, so an
     * over-draw, or a reservation that is not RESERVED at all (a konsi order approved before
     * stock moved at completion, whose reservation was consumed at approve), refuses with nothing
     * moved. `StockReservation` is not a balance table, so this raw statement needs no entry in
     * the stock-balance guard.
     */
    const reserved = await tx.$executeRaw`
      UPDATE StockReservation
      SET consumedQty = consumedQty + ${l.qty}
      WHERE fieldSalesLineId = ${l.id} AND state = 'RESERVED' AND consumedQty + ${l.qty} <= qty
    `;
    if (reserved === 0) throw new KonsiTransferReservationMismatchError(l.id, 0);

    /*
     * findExistingInventoryValueRow is THE spelling of this lookup: OR-tolerant, because a
     * variantless InventoryValue row keys on null OR "" and a strict ""-keyed lookup misses the
     * real row and forks a phantom one — that has already happened once on the canvassing
     * reconcile path. Its orderBy id asc tie-break is load-bearing rather than cosmetic: the
     * resolved id is pinned into moveMainStock below AND into the reservedQty decrement after it,
     * so without it two paths reading the same null/"" bucket can pin different rows and
     * interleave two independent balances under one ledger key.
     */
    const main = await findExistingInventoryValueRow(tx, l.itemId, l.variantSku);
    if (!main) throw new InventoryValueMissingError(l.itemId, l.variantSku);

    const prevQty = main.qtyOnHand.toNumber();
    const avgCost = main.avgCost.toNumber();
    const newQty = prevQty - l.qty;

    /*
     * qtyOnHand and reservedQty decrement TOGETHER — see the module doc above. moveMainStock
     * only moves qtyOnHand (and records the ledger entry for it); reservedQty is not a stock
     * movement and gets no ledger entry, so it stays a separate atomic decrement immediately
     * after, pinned to the same row moveMainStock just wrote.
     */
    await moveMainStock(tx, {
      itemId: l.itemId,
      variantSku: l.variantSku,
      qtyDelta: -l.qty,
      totalValue: newQty * avgCost,
      totalCost: -l.qty * avgCost,
      balanceValue: newQty * avgCost,
      inventoryValueId: main.id,
      refType: "KonsiTransfer" satisfies StockLedgerRefType,
      refId: transfer.id,
      refDocNumber: docNo,
      createdById: input.transferredById,
    });

    await tx.inventoryValue.update({
      where: { id: main.id },
      data: {
        reservedQty: { decrement: l.qty },
        lastUpdated: new Date(),
      },
    });

    await tx.stockAdjustment.create({
      data: {
        docNumber: await generateDocNumber("ADJ", tx),
        itemId: l.itemId,
        type: "NEGATIVE",
        qtyChange: -l.qty,
        reason: `Konsi transfer ${docNo}`,
        prevQty,
        newQty,
        prevAvgCost: avgCost,
        newAvgCost: avgCost,
        createdById: input.transferredById,
        source: "KONSI_TRANSFER",
      },
    });

    /*
     * StoreStock keys on "" for variantless, never null — the composite unique must be DB-enforced.
     * moveStoreStock applies whatever avgCost it is handed; it does not compute the blend itself,
     * so the weighted-average read + blend stays here exactly as before.
     */
    const storeKey = { storeId_itemId_variantSku: { storeId: input.order.storeId, itemId: l.itemId, variantSku: l.variantSku } };
    const existingStoreStock = await tx.storeStock.findUnique({ where: storeKey, select: { qty: true, avgCost: true } });
    const prevStoreQty = existingStoreStock ? existingStoreStock.qty.toNumber() : 0;
    const prevStoreAvg = existingStoreStock ? existingStoreStock.avgCost.toNumber() : 0;
    /*
     * A negative StoreStock qty (e.g. a konsi retur that credited back more than the store's
     * ledger held — see approve-writer.ts) represents units that are not physically there.
     * Blending this transfer's incoming cost against those units with weightedAvgCost would use
     * a negative weight on the existing side and inflate the blended average well past the true
     * cost. Clamped to 0 for the BLEND only: you cannot meaningfully average a cost against units
     * that are not there, so the incoming cost simply becomes the new average. The actual qty
     * moved below still uses the real (possibly negative) prevStoreQty — this guard is about
     * the cost blend, not the quantity.
     */
    const blendQty = Math.max(prevStoreQty, 0);
    const nextStoreAvgCost = existingStoreStock ? weightedAvgCost(blendQty, prevStoreAvg, l.qty, avgCost) : avgCost;

    await moveStoreStock(tx, {
      storeId: input.order.storeId,
      itemId: l.itemId,
      variantSku: l.variantSku,
      qtyDelta: l.qty,
      avgCost: nextStoreAvgCost,
      refType: "KonsiTransfer" satisfies StockLedgerRefType,
      refId: transfer.id,
      refDocNumber: docNo,
      createdById: input.transferredById,
    });

    /* Only the draw that exhausts the reservation resolves it; an earlier partial draw leaves it
       RESERVED for the next shipment or for a close-remainder release. */
    const reservation = await tx.stockReservation.findUniqueOrThrow({
      where: { fieldSalesLineId: l.id },
      select: { qty: true, consumedQty: true },
    });
    if (Number(reservation.consumedQty) >= Number(reservation.qty)) {
      await tx.stockReservation.updateMany({
        where: { fieldSalesLineId: l.id, state: "RESERVED" },
        data: { state: "CONSUMED", resolvedAt: new Date() },
      });
    }

    lineData.push({
      transferId: transfer.id,
      orderLineId: l.id,
      itemId: l.itemId,
      variantSku: l.variantSku,
      productName: l.productName,
      qty: l.qty,
      unitCost: avgCost,
    });
  }

  await tx.konsiTransferLine.createMany({ data: lineData });

  return { transferId: transfer.id, docNo };
}
