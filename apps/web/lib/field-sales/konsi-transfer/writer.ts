import { InventoryValueMissingError, moveMainStock, moveStoreStock, resolveReservedInventory, type Prisma } from "@elorae/db";
import type { StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { generateDocNumber } from "@/lib/docNumber";
import { KonsiTransferReservationMismatchError } from "../errors";

type TxClient = Prisma.TransactionClient;

export type IssueKonsiTransferLine = {
  id: string;
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  /**
   * Only on an old-order arrival (`oldOrderArrival`): the APPROVED main-warehouse StockOpname that
   * counted this item AFTER the order was approved. That count already left these pcs out of
   * `qtyOnHand`, so the line adds them to the store and releases the reservation WITHOUT cutting
   * main stock a second time. A shipment completion never passes it.
   */
  mainCountedByOpnameId?: string | null;
};

/**
 * Moves konsi stock out of the main warehouse and into a store's virtual warehouse, inside the
 * caller's transaction. Runs at delivery-shipment COMPLETION (one call per completed shipment,
 * one transfer per shipment), never at approve — approve only reserves. Each line's `qty` is the
 * DELIVERED quantity for that shipment, not the order-line quantity, so the reservation approve
 * created is consumed PARTIALLY: a short or refused delivery never lands units at the store, and
 * a second shipment against the same line draws down the same reservation further.
 *
 * The second caller is an OLD-ORDER ARRIVAL (`oldOrderArrival`, no shipment): a konsi order
 * approved before the per-shipment flow reached production, whose reservation is still RESERVED,
 * confirmed at the store by its SPG or holding salesman (`konfirmasiSampaiPesananLama`). Same
 * transfer, same reservation draw-down, same store stock and ledger, so stok titipan, pencocokan
 * and the consignment move journal (`CONSIGNMENT_TRANSFER`, one per transfer) all see it — with one
 * difference per line: a line whose item the main warehouse already re-counted after approve
 * (`mainCountedByOpnameId`) keeps main `qtyOnHand` as the count left it and only releases the
 * reservation, and its journal credits the opname variance account instead of warehouse inventory.
 *
 * qtyOnHand and reservedQty must decrement TOGETHER. The reservation approve created already
 * covers this line's qty, so decrementing one without the other would leave stock reserved
 * against nothing, forever. The quantity goes through moveMainStock, pinned to the row the line's
 * reservation was made against; the reservedQty decrement follows immediately after on that same id, as a plain
 * atomic update outside the mover — it writes no ledger entry, because a reservation resolving is
 * not a stock movement. A future edit must not separate the two writes or let anything run
 * between them.
 */
export async function issueKonsiTransfer(
  tx: TxClient,
  input: {
    order: { id: string; storeId: string; lines: IssueKonsiTransferLine[] };
    /** The completed delivery shipment; null only for an old-order arrival. */
    shipmentId: string | null;
    transferredById: string;
    /** An old-order arrival confirmed at the store (no shipment). */
    oldOrderArrival?: boolean;
  },
): Promise<{ transferId: string; docNo: string }> {
  const oldOrderArrival = input.oldOrderArrival === true;
  /*
   * Exactly one of the two: a shipment completion always names its shipment, an arrival never has
   * one. Refused before anything is written — a shipment transfer without its shipment would be
   * invisible to the SPG receipt list, and an arrival tied to a shipment would be received twice.
   */
  if (oldOrderArrival === (input.shipmentId !== null && input.shipmentId !== "")) {
    throw new Error("issueKonsiTransfer: a transfer is either a shipment's or an old-order arrival, never both or neither");
  }
  const docNo = await generateDocNumber("KONSITRF", tx);

  const transfer = await tx.konsiTransfer.create({
    data: {
      docNo,
      orderId: input.order.id,
      storeId: input.order.storeId,
      shipmentId: oldOrderArrival ? null : input.shipmentId,
      oldOrderArrival,
      transferredById: input.transferredById,
    },
    select: { id: true },
  });

  const lineData: Array<{
    transferId: string;
    orderLineId: string;
    itemId: string;
    variantSku: string;
    productName: string;
    qty: number;
    unitCost: number;
    mainCountedByOpnameId: string | null;
  }> = [];

  for (const l of input.order.lines) {
    /**
     * The caller filters to delivered lines today; a zero draw would pass the guard below as a
     * no-op and a negative one would move stock INTO main, so neither is left to the caller.
     */
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new KonsiTransferReservationMismatchError(l.id, 0);
    /* Only an arrival may skip the main cut; a shipment always moves its pcs out of main. */
    const mainCountedByOpnameId = oldOrderArrival && l.mainCountedByOpnameId ? l.mainCountedByOpnameId : null;
    if (!oldOrderArrival && l.mainCountedByOpnameId) throw new Error("issueKonsiTransfer: only an old-order arrival may skip the main-stock cut");

    /**
     * Partial consume of the reservation approve created, folded into one guarded statement so a
     * concurrent completion cannot pass a stale read — the same idiom
     * `consumeFieldSalesOrderPartial` uses, filtered to the konsi reservation source as that one
     * is to its own. It runs BEFORE any balance write for this line, so an
     * over-draw, or a reservation that is not RESERVED at all (a konsi order approved before
     * stock moved at completion, whose reservation was consumed at approve), refuses with nothing
     * moved. `StockReservation` is not a balance table, so this raw statement needs no entry in
     * the stock-balance guard.
     */
    const reserved = await tx.$executeRaw`
      UPDATE StockReservation
      SET consumedQty = consumedQty + ${l.qty}
      WHERE fieldSalesLineId = ${l.id} AND source = 'FIELD_SALES_KONSI' AND state = 'RESERVED' AND consumedQty + ${l.qty} <= qty
    `;
    if (reserved === 0) throw new KonsiTransferReservationMismatchError(l.id, 0);

    /**
     * The row approve reserved against, which is where this line's reservedQty sits. It is pinned
     * into moveMainStock below AND into the reservedQty decrement after it. Resolving it through
     * the reservation rather than a fresh item lookup keeps the draw-down on that row even when the
     * item carries both variantless spellings, or gained one after approve; a fresh lookup could
     * pick the sibling, driving its qtyOnHand down and stranding reservedQty on the reserved row.
     * A reservation made before the pin was stored falls back to the reserve's own lookup.
     */
    const pin = await tx.stockReservation.findUniqueOrThrow({
      where: { fieldSalesLineId: l.id },
      select: { inventoryValueId: true },
    });
    const main = await resolveReservedInventory(tx, {
      itemId: l.itemId,
      variantSku: l.variantSku,
      inventoryValueId: pin.inventoryValueId,
    });
    if (!main) throw new InventoryValueMissingError(l.itemId, l.variantSku);

    const prevQty = main.qtyOnHand.toNumber();
    const avgCost = main.avgCost.toNumber();
    const newQty = prevQty - l.qty;

    if (mainCountedByOpnameId === null) {
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
    }

    /*
     * An arrival whose item the warehouse already re-counted reaches here WITHOUT a qtyOnHand
     * write: the count set qtyOnHand without these pcs and never touched reservedQty, so the
     * reservation is all that is left to resolve — a release, written exactly as the normal path's
     * decrement is, on the reserved row. Never a second qtyOnHand cut.
     */
    await tx.inventoryValue.update({
      where: { id: main.id },
      data: {
        reservedQty: { decrement: l.qty },
        lastUpdated: new Date(),
      },
    });

    if (mainCountedByOpnameId === null) {
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
          source: "KONSI_TRANSFER" satisfies StockAdjustmentSource,
        },
      });
    }

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
      mainCountedByOpnameId,
    });
  }

  await tx.konsiTransferLine.createMany({ data: lineData });

  return { transferId: transfer.id, docNo };
}
