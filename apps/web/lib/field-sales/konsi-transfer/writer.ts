import { InventoryValueMissingError, type Prisma } from "@elorae/db";
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
};

/**
 * Moves konsi stock out of the main warehouse and into a store's virtual warehouse, inside the
 * caller's transaction.
 *
 * This touches InventoryValue directly rather than going through a packages/db helper, following
 * loadVan. The reason is a single invariant: qtyOnHand and reservedQty must decrement TOGETHER.
 * reserveKonsiFieldSalesOrder has already reserved these exact quantities earlier in this same
 * transaction, so decrementing one without the other would leave stock reserved against nothing,
 * forever. Splitting that across two modules is how it would eventually drift apart.
 */
export async function issueKonsiTransfer(
  tx: TxClient,
  input: {
    order: { id: string; storeId: string; lines: IssueKonsiTransferLine[] };
    transferredById: string;
  },
): Promise<{ transferId: string; docNo: string }> {
  const docNo = await generateDocNumber("KONSITRF", tx);
  const lineData: Array<{ orderLineId: string; itemId: string; variantSku: string; productName: string; qty: number; unitCost: number }> = [];

  for (const l of input.order.lines) {
    /*
     * OR-tolerant: a variantless InventoryValue row keys on null, not "". A strict ""-keyed
     * lookup misses the real row and forks a phantom one — that has already happened once on
     * the canvassing reconcile path.
     */
    const isVariantless = l.variantSku === "";
    const select = { id: true, qtyOnHand: true, reservedQty: true, avgCost: true } as const;
    const main = isVariantless
      ? await tx.inventoryValue.findFirst({ where: { itemId: l.itemId, OR: [{ variantSku: null }, { variantSku: "" }] }, select })
      : await tx.inventoryValue.findFirst({ where: { itemId: l.itemId, variantSku: l.variantSku }, select });
    if (!main) throw new InventoryValueMissingError(l.itemId, l.variantSku);

    const prevQty = main.qtyOnHand.toNumber();
    const avgCost = main.avgCost.toNumber();
    const newQty = prevQty - l.qty;

    // qtyOnHand and reservedQty decrement TOGETHER in this one write — see the module doc above.
    await tx.inventoryValue.update({
      where: { id: main.id },
      data: {
        qtyOnHand: newQty,
        reservedQty: main.reservedQty.toNumber() - l.qty,
        totalValue: newQty * avgCost,
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

    /* StoreStock keys on "" for variantless, never null — the composite unique must be DB-enforced. */
    const storeKey = { storeId_itemId_variantSku: { storeId: input.order.storeId, itemId: l.itemId, variantSku: l.variantSku } };
    const existing = await tx.storeStock.findUnique({ where: storeKey, select: { qty: true, avgCost: true } });
    const prevStoreQty = existing ? existing.qty.toNumber() : 0;
    const prevStoreAvg = existing ? existing.avgCost.toNumber() : 0;
    /*
     * A negative StoreStock qty (e.g. a konsi retur that credited back more than the store's
     * ledger held — see approve-writer.ts) represents units that are not physically there.
     * Blending this transfer's incoming cost against those units with weightedAvgCost would use
     * a negative weight on the existing side and inflate the blended average well past the true
     * cost. Clamped to 0 for the BLEND only: you cannot meaningfully average a cost against units
     * that are not there, so the incoming cost simply becomes the new average. The actual qty
     * written below still uses the real (possibly negative) prevStoreQty — this guard is about
     * the cost blend, not the quantity.
     */
    const blendQty = Math.max(prevStoreQty, 0);
    await tx.storeStock.upsert({
      where: storeKey,
      create: { storeId: input.order.storeId, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty, avgCost },
      update: { qty: prevStoreQty + l.qty, avgCost: weightedAvgCost(blendQty, prevStoreAvg, l.qty, avgCost) },
    });

    /*
     * The reservation reserveKonsiFieldSalesOrder created earlier in this same transaction is
     * now resolved — flip it to CONSUMED rather than leaving it RESERVED against nothing.
     *
     * Guarded, not fire-and-forget: this only catches a reservation that is NOT sitting in
     * RESERVED state on this fieldSalesLineId — i.e. already CONSUMED or RELEASED, or missing
     * outright — where this updateMany would silently match 0 rows while qtyOnHand and
     * reservedQty above had already been decremented unconditionally. It does NOT catch
     * reserveKonsiFieldSalesOrder's silent-skip branch (an existing reservation on the same
     * fieldSalesLineId short-circuits without incrementing reservedQty): that branch leaves the
     * existing row RESERVED, so this updateMany still matches exactly 1 and the guard passes,
     * even though reservedQty was never incremented for it and this transfer decrements it
     * unconditionally regardless. The current approve() guards (status !== PENDING_APPROVAL
     * rejects re-entry) mean neither case is observed today, but the match count is checked
     * rather than discarded so the reachable half of this drift is caught the moment it stops
     * being theoretical.
     */
    const resolved = await tx.stockReservation.updateMany({
      where: { fieldSalesLineId: l.id, state: "RESERVED" },
      data: { state: "CONSUMED", consumedQty: l.qty, resolvedAt: new Date() },
    });
    if (resolved.count !== 1) throw new KonsiTransferReservationMismatchError(l.id, resolved.count);

    lineData.push({ orderLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, productName: l.productName, qty: l.qty, unitCost: avgCost });
  }

  const transfer = await tx.konsiTransfer.create({
    data: {
      docNo,
      orderId: input.order.id,
      storeId: input.order.storeId,
      transferredById: input.transferredById,
      lines: { create: lineData },
    },
    select: { id: true },
  });

  return { transferId: transfer.id, docNo };
}
