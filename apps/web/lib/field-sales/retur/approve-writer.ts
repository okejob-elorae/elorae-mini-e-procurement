import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { FieldReturnError } from "./errors";
import { allDiscrepantLinesSettled, creditedQtyForLine } from "./variance";
import { effectiveUnitPrice, round2 } from "./pricing-rules";
import { resolveLinePrice } from "./pricing";

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
        storeId: true,
        lines: {
          select: {
            id: true,
            itemId: true,
            variantSku: true,
            qty: true,
            receivedQty: true,
            sellableQty: true,
            rejectedQty: true,
            priceSource: true,
            priceDeliveryLineId: true,
            unitPrice: true,
            resolutions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true, type: true },
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
              /* Same null-for-variantless normalisation as the RejectedGoodsLedger create
                 below — a fresh row must land in the shape the OR-tolerant lookup above (and
                 every other writer) expects, not fork a "" row alongside a null one. */
              variantSku: line.variantSku || null,
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
         * table passes null, and FieldReturnLine.variantSku defaults to "". Writing "" would
         * not fork getAvailableRejectQtyByItem's running balance (it sums by itemId alone and
         * ignores variantSku entirely) — but it would fork the rejected-goods recap, which
         * groups by variantSku, into a separate "" bucket alongside the null one.
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

    /*
     * Value each line at the price the store was actually billed. This never blocks the
     * physical approval above: an ambiguous or unpriceable line simply carries no lineValue,
     * and the header's totalValue is null rather than a partial sum whenever any line is
     * unpriced — a partial total is a number that looks complete and would be mistaken for
     * the retur's real value downstream.
     */
    let total = 0;
    let allPriced = true;

    for (const line of ret.lines) {
      const latest = line.resolutions[0] ?? null;
      const creditedQty = creditedQtyForLine({
        qty: line.qty,
        receivedQty: line.receivedQty,
        latestResolutionType: latest?.type ?? null,
      });

      /*
       * Resolve the per-unit price: an admin's existing choice wins, otherwise auto-resolve.
       * `preserveAdminChoice` marks a line where an admin already picked MANUAL or DELIVERY
       * and that choice failed to resolve (a manual price that was never actually set, or a
       * priceDeliveryLineId that is dangling / whose lineTotal has since gone null). That is
       * a recorded admin decision, not an absence of one — wiping priceSource/
       * priceDeliveryLineId/priceNote here would destroy the only trace it existed, on a
       * terminal APPROVED retur with no UI path back to re-enter it. Only the auto-resolve
       * path (no priceSource chosen at all) is allowed to null them, because there nothing
       * was ever chosen.
       */
      let unitPrice: number | null = null;
      let priceSource: "DELIVERY" | "MANUAL" | null = null;
      let priceDeliveryLineId: string | null = null;
      let preserveAdminChoice = false;

      if (line.priceSource === "MANUAL") {
        /*
         * The `unitPrice !== null` check is explicit on purpose, not `if (line.unitPrice)` — a
         * Prisma Decimal is an object and therefore truthy even at zero, so a truthy check
         * would silently treat a genuine 0 price the same as "never set" and discard it via
         * preserveAdminChoice below. setLinePriceAction already refuses to WRITE a manual price
         * <= 0, so a null unitPrice on a MANUAL-sourced line is unreachable through that action
         * today — this branch only defends against a row written by hand-run SQL against a
         * priceSource of MANUAL with no unitPrice.
         */
        if (line.unitPrice !== null) {
          unitPrice = line.unitPrice.toNumber();
          priceSource = "MANUAL";
        } else {
          preserveAdminChoice = true;
        }
      } else if (line.priceSource === "DELIVERY") {
        const dl = line.priceDeliveryLineId
          ? await tx.fieldSalesDeliveryLine.findUnique({
              where: { id: line.priceDeliveryLineId },
              select: { qty: true, lineTotal: true },
            })
          : null;
        const resolved = dl && dl.lineTotal !== null ? effectiveUnitPrice(dl.lineTotal.toNumber(), dl.qty) : null;
        if (resolved !== null) {
          unitPrice = resolved;
          priceSource = "DELIVERY";
          priceDeliveryLineId = line.priceDeliveryLineId;
        } else {
          preserveAdminChoice = true;
        }
      } else {
        const resolved = await resolveLinePrice(tx, {
          storeId: ret.storeId,
          itemId: line.itemId,
          variantSku: line.variantSku,
        });
        if (resolved.kind === "AUTO") {
          unitPrice = resolved.price;
          priceSource = "DELIVERY";
          priceDeliveryLineId = resolved.candidate.deliveryLineId;
        }
        /* AMBIGUOUS and UNPRICEABLE both leave the line unpriced — an admin decides later. */
      }

      const lineValue = creditedQty !== null && unitPrice !== null ? round2(creditedQty * unitPrice) : null;
      if (lineValue === null) allPriced = false;
      else total += lineValue;

      /*
       * creditedQty (and lineValue) are units/money facts derived independently of whose price
       * choice won, and must be stamped every time — including when preserveAdminChoice holds.
       * Only priceSource/priceDeliveryLineId are conditional: those are the admin's recorded
       * provenance choice, and wiping them here on a dangling/never-set choice would destroy
       * the only trace it existed, on a terminal APPROVED retur with no UI path back to
       * re-enter it. (priceNote is never part of this update at all, by any path — it is
       * already implicitly preserved.)
       */
      await tx.fieldReturnLine.update({
        where: { id: line.id },
        data: {
          creditedQty,
          unitPrice: unitPrice === null ? null : round2(unitPrice),
          lineValue,
          ...(preserveAdminChoice ? {} : { priceSource, priceDeliveryLineId }),
        },
      });

      /*
       * SALESMAN_BEARS records what the salesman owes; WRITE_OFF records the company's
       * expense. Both are the missing units at the same per-unit price. ACCEPT_SURPLUS and
       * INVESTIGATE get no amount — nobody owes anything for a surplus, and an investigation
       * settles nothing.
       */
      if (latest && (latest.type === "SALESMAN_BEARS" || latest.type === "WRITE_OFF") && unitPrice !== null) {
        const missing = line.qty - (line.receivedQty ?? 0);
        await tx.fieldReturnResolution.update({
          where: { id: latest.id },
          data: { amount: round2(missing * unitPrice) },
        });
      }
    }

    await tx.fieldReturn.update({
      where: { id: ret.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: input.approvedById,
        /* Every addend is already round2'd, but summing several 2dp values can still leave
           sub-cent float residue (the header total is the one authoritative figure here, unlike
           each line's own already-rounded lineValue) — round once more at the end. */
        totalValue: allPriced ? round2(total) : null,
        valuationStatus: allPriced ? "VALUED" : "PENDING",
      },
    });

    return { ok: true as const };
  });
}
