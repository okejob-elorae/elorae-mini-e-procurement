import type { AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { FieldReturnError } from "./errors";

type ReceiveCount = { lineId: string; receivedQty: number; sellableQty: number; rejectedQty: number };

/**
 * Shape and split validation run before the transaction — they need no read, and running
 * them inside the transaction would only hold a serializable lock for work that never
 * touches the database.
 */
function assertCountShape(c: ReceiveCount): void {
  for (const n of [c.receivedQty, c.sellableQty, c.rejectedQty]) {
    /* Zero is a valid count on every field, including all-zero — the lost-sack case. */
    if (!Number.isInteger(n) || n < 0) throw new FieldReturnError("BAD_QTY");
  }
  if (c.sellableQty + c.rejectedQty !== c.receivedQty) throw new FieldReturnError("SPLIT_MISMATCH");
}

export async function receiveFieldReturn(input: {
  returnId: string;
  receivedById: string;
  counts: ReceiveCount[];
}): Promise<{ ok: true; status: "PENDING_APPROVAL" | "MISMATCH_PENDING_RESOLUTION" }> {
  for (const c of input.counts) assertCountShape(c);

  let notification: AdminNotification | null = null;

  const result = await runSerializable(async (tx) => {
    const ret = await tx.fieldReturn.findUnique({
      where: { id: input.returnId },
      select: {
        id: true,
        docNo: true,
        storeId: true,
        status: true,
        origin: true,
        store: { select: { termsType: true } },
        lines: { select: { id: true, qty: true, itemId: true, variantSku: true } },
      },
    });
    if (!ret) throw new FieldReturnError("NOT_FOUND");
    if (ret.status !== "PENDING_WAREHOUSE_RECEIVING") throw new FieldReturnError("INVALID_STATE");

    const byLineId = new Map(input.counts.map((c) => [c.lineId, c]));
    if (byLineId.size !== input.counts.length) throw new FieldReturnError("DUPLICATE_LINE");
    for (const lineId of byLineId.keys()) {
      if (!ret.lines.some((l) => l.id === lineId)) throw new FieldReturnError("UNKNOWN_LINE");
    }
    for (const l of ret.lines) {
      if (!byLineId.has(l.id)) throw new FieldReturnError("MISSING_LINE");
    }

    let mismatchedLineCount = 0;
    for (const l of ret.lines) {
      const c = byLineId.get(l.id)!;
      if (c.receivedQty !== l.qty) mismatchedLineCount += 1;
      await tx.fieldReturnLine.update({
        where: { id: l.id },
        data: { receivedQty: c.receivedQty, sellableQty: c.sellableQty, rejectedQty: c.rejectedQty },
      });
    }

    /*
     * ADMIN-origin only: decrement StoreStock at RECEIPT by the units the warehouse actually
     * has in hand (receivedQty), not the admin's raised (claimed) qty — the admin's figure is
     * not what arrived, and using it would move stock the warehouse never received. FIELD
     * keeps its stock at the store's ledger until approve, unchanged by this feature.
     *
     * approveFieldReturn then applies only the DELTA (creditedQty - receivedQty) on approval,
     * so the total decrement over the return's life is still exactly creditedQty, whatever the
     * origin — never a full decrement here plus a second full decrement there. Gated on KONSI
     * the same way approveFieldReturn's own decrement is: StoreStock only means anything for a
     * consignment store.
     */
    if (ret.origin === "ADMIN" && ret.store.termsType === "KONSI") {
      for (const l of ret.lines) {
        const c = byLineId.get(l.id)!;
        if (c.receivedQty === 0) continue;

        const variantSku = l.variantSku ?? "";
        const storeKey = {
          storeId_itemId_variantSku: { storeId: ret.storeId, itemId: l.itemId, variantSku },
        };
        const existingStock = await tx.storeStock.findUnique({ where: storeKey, select: { qty: true } });
        const prevStoreQty = existingStock ? existingStock.qty.toNumber() : 0;

        /* A drifted or negative StoreStock row must never refuse a return — bookkeeping does
           not get to veto physical reality. */
        await tx.storeStock.upsert({
          where: storeKey,
          create: { storeId: ret.storeId, itemId: l.itemId, variantSku, qty: -c.receivedQty, avgCost: 0 },
          update: { qty: prevStoreQty - c.receivedQty },
        });
      }
    }

    const status: "MISMATCH_PENDING_RESOLUTION" | "PENDING_APPROVAL" =
      mismatchedLineCount > 0 ? "MISMATCH_PENDING_RESOLUTION" : "PENDING_APPROVAL";
    await tx.fieldReturn.update({
      where: { id: ret.id },
      data: { status, receivedAt: new Date(), receivedById: input.receivedById },
    });

    if (status === "MISMATCH_PENDING_RESOLUTION") {
      notification = await tx.adminNotification.create({
        data: {
          category: "FIELD_RETURN_MISMATCH",
          severity: "WARNING",
          title: `Retur ${ret.docNo} has a count mismatch`,
          message: `${mismatchedLineCount} line${mismatchedLineCount === 1 ? "" : "s"} on retur ${ret.docNo} disagree with the warehouse count and need resolution.`,
          metadata: { returnId: ret.id, docNo: ret.docNo, storeId: ret.storeId, mismatchedLineCount },
        },
      });
    }

    return { ok: true as const, status };
  });

  /**
   * Outside the transaction on purpose — `fanOutAdminNotification` performs FCM network calls
   * and must never run inside one — and not awaited, because the warehouse operator who just
   * submitted the count should not wait on a bell ping for the document that already committed.
   * The seam swallows its own failures, so there is no outcome here for this function to report.
   */
  if (notification) void fanOutAdminNotification(notification);
  return result;
}
