import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { FieldReturnError } from "./errors";
import { allDiscrepantLinesSettled } from "./variance";

/**
 * The point where goods a store sent back physically re-enter sellable stock. Runs inside
 * one serializable transaction: load the retur with its lines and each line's latest
 * resolution, refuse unless every discrepant line is settled, restore sellable units to the
 * main warehouse, route rejected units to the rejected-goods ledger, then stamp APPROVED.
 */
export async function approveFieldReturn(input: {
  returnId: string;
  approvedById: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const ret = await tx.fieldReturn.findUnique({
      where: { id: input.returnId },
      select: {
        id: true,
        docNo: true,
        status: true,
        receivedAt: true,
        lines: {
          select: {
            id: true,
            itemId: true,
            variantSku: true,
            qty: true,
            receivedQty: true,
            sellableQty: true,
            rejectedQty: true,
            resolutions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { type: true },
            },
          },
        },
      },
    });
    if (!ret) throw new FieldReturnError("NOT_FOUND");
    if (ret.status !== "PENDING_APPROVAL") throw new FieldReturnError("INVALID_STATE");

    /*
     * Every line whose claimed qty differs from what was actually received must carry a
     * SETTLING resolution as its latest one — shared allDiscrepantLinesSettled, the exact
     * same rule resolveFieldReturnLine itself recomputes on every write. In the normal flow
     * the retur's own status already tracks this, so this check is defense-in-depth against
     * a status that has drifted out of sync with its lines rather than something the UI can
     * normally trigger.
     */
    if (!allDiscrepantLinesSettled(ret.lines)) throw new FieldReturnError("UNRESOLVED_LINES");

    /*
     * receivedAt is stamped by receiveFieldReturn in the same transaction that moves the
     * retur out of PENDING_WAREHOUSE_RECEIVING, so it is guaranteed non-null by the time the
     * retur can reach PENDING_APPROVAL. The fallback only guards the nullable column type.
     */
    const receivedAt = ret.receivedAt ?? new Date();

    for (const line of ret.lines) {
      const sellableQty = line.sellableQty ?? 0;
      const rejectedQty = line.rejectedQty ?? 0;

      if (sellableQty > 0) {
        /*
         * Variantless main rows use variantSku: null, not "" — a strict ""-keyed lookup
         * misses the real row and forks a phantom one. Same OR-tolerant lookup as
         * reconcile-writer.ts / loadVan.
         */
        const isVariantless = (line.variantSku ?? "") === "";
        const main = isVariantless
          ? await tx.inventoryValue.findFirst({
              where: { itemId: line.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
              select: { id: true, qtyOnHand: true, avgCost: true },
            })
          : await tx.inventoryValue.findFirst({
              where: { itemId: line.itemId, variantSku: line.variantSku },
              select: { id: true, qtyOnHand: true, avgCost: true },
            });

        const prevQty = main ? main.qtyOnHand.toNumber() : 0;
        const avgCost = main ? main.avgCost.toNumber() : 0;
        const newQty = prevQty + sellableQty;

        /*
         * Restored stock comes back at the CURRENT average cost, unchanged (controller
         * ruling): a retur carries no cost information at all, and blending it in at zero
         * would silently destroy the average cost of everything already in stock. Where no
         * inventory row exists yet, the restored stock lands at avgCost: 0, which is
         * consistent with how this database already records cost for a brand-new row.
         */
        const newAvgCost = avgCost;

        if (main) {
          await tx.inventoryValue.update({
            where: { id: main.id },
            data: {
              qtyOnHand: newQty,
              avgCost: newAvgCost,
              totalValue: newQty * newAvgCost,
              lastUpdated: new Date(),
            },
          });
        } else {
          await tx.inventoryValue.create({
            data: {
              itemId: line.itemId,
              variantSku: line.variantSku ?? "",
              qtyOnHand: newQty,
              reservedQty: 0,
              avgCost: newAvgCost,
              totalValue: newQty * newAvgCost,
            },
          });
        }

        await tx.stockAdjustment.create({
          data: {
            docNumber: await generateDocNumber("ADJ", tx),
            itemId: line.itemId,
            type: "POSITIVE",
            qtyChange: sellableQty,
            reason: `Field retur ${ret.docNo} restore`,
            prevQty,
            newQty,
            prevAvgCost: avgCost,
            newAvgCost,
            createdById: input.approvedById,
            source: "FIELD_RETURN",
          },
        });
      }

      if (rejectedQty > 0) {
        /*
         * variantSku is normalised to null here, not "" — every existing writer of this
         * table passes null, FieldReturnLine.variantSku defaults to "", and writing ""
         * would fork the running balance that getAvailableRejectQtyByItem sums and the
         * rejected-goods recap groups by.
         */
        await tx.rejectedGoodsLedger.create({
          data: {
            itemId: line.itemId,
            variantSku: line.variantSku || null,
            qty: rejectedQty,
            refType: "FIELD_RETURN",
            refId: ret.id,
            refDocNumber: ret.docNo,
            receivedAt,
          },
        });
      }
    }

    await tx.fieldReturn.update({
      where: { id: ret.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById },
    });

    return { ok: true as const };
  });
}
