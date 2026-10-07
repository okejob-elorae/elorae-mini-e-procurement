import { moveStoreStock, type AdminNotification } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { FieldReturnError } from "./errors";
import { auditReason } from "./audit-reason";
import { assertCountShape, type ReceiveCount } from "./receive-writer";
import { notifySalesmanOfMismatch, type SalesmanMismatchNoticeInput } from "./mismatch-notice";
import { allDiscrepantLinesSettled, isSettled, lineVariance } from "./variance";

type CorrectableStatus = "PENDING_APPROVAL" | "MISMATCH_PENDING_RESOLUTION";

type LineCounts = { receivedQty: number | null; sellableQty: number | null; rejectedQty: number | null };

/**
 * Replaces a mistyped warehouse count on a retur that has been received but not yet approved.
 * Takes the same full payload as `receiveFieldReturn` — every line exactly once, the same shape and
 * split rules, zero valid on every line — plus a required reason, recorded in a
 * `FIELD_RETURN_RECEIPT_CORRECT` `AuditLog` row inside this transaction with every line's counts
 * before and after. `receivedAt`/`receivedById` keep the original receipt; the audit row names who
 * corrected it.
 *
 * Resolutions are append-only, so a line whose `receivedQty` changes and that already carries one
 * gets an `INVESTIGATE` resolution appended (qty = the new variance, note naming old → new and the
 * reason). That retires whatever settled the OLD count — a SALESMAN_BEARS or WRITE_OFF left as the
 * latest resolution would otherwise be billed by approval against a shortfall nobody decided on.
 * INVESTIGATE settles nothing, so the line must be resolved again unless its new variance is zero.
 *
 * An ADMIN-origin retur at a KONSI store already took `receivedQty` out of `StoreStock` at receipt,
 * so the correction moves the store row by the DELTA only (`-(new - old)`); approval then applies
 * `creditedQty - receivedQty` against the corrected figure, which keeps the life-time decrement at
 * exactly `creditedQty`. A FIELD retur has moved no store stock before approval and moves none here.
 */
export async function correctFieldReturnReceipt(input: {
  returnId: string;
  correctedById: string;
  reason: string;
  counts: ReceiveCount[];
}): Promise<{ ok: true; status: CorrectableStatus }> {
  for (const c of input.counts) assertCountShape(c);
  const reason = auditReason(input.reason);

  let notification: AdminNotification | null = null;
  let salesmanNotice: (SalesmanMismatchNoticeInput & { raisedById: string }) | null = null;

  const result = await runSerializable(async (tx) => {
    /* Retry re-runs this whole callback; reset so a rolled-back attempt's notice never fans out. */
    notification = null;
    salesmanNotice = null;
    const ret = await tx.fieldReturn.findUnique({
      where: { id: input.returnId },
      select: {
        id: true,
        docNo: true,
        storeId: true,
        status: true,
        origin: true,
        raisedById: true,
        store: { select: { termsType: true } },
        lines: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            qty: true,
            itemId: true,
            variantSku: true,
            receivedQty: true,
            sellableQty: true,
            rejectedQty: true,
            resolutions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });
    if (!ret) throw new FieldReturnError("NOT_FOUND");
    if (ret.status !== "MISMATCH_PENDING_RESOLUTION" && ret.status !== "PENDING_APPROVAL") {
      throw new FieldReturnError("INVALID_STATE");
    }
    const fromStatus: CorrectableStatus = ret.status;

    const byLineId = new Map(input.counts.map((c) => [c.lineId, c]));
    if (byLineId.size !== input.counts.length) throw new FieldReturnError("DUPLICATE_LINE");
    for (const lineId of byLineId.keys()) {
      if (!ret.lines.some((l) => l.id === lineId)) throw new FieldReturnError("UNKNOWN_LINE");
    }
    for (const l of ret.lines) {
      if (!byLineId.has(l.id)) throw new FieldReturnError("MISSING_LINE");
    }

    const auditLines: { lineId: string; before: LineCounts; after: LineCounts }[] = [];
    for (const l of ret.lines) {
      const c = byLineId.get(l.id)!;
      auditLines.push({
        lineId: l.id,
        before: { receivedQty: l.receivedQty, sellableQty: l.sellableQty, rejectedQty: l.rejectedQty },
        after: { receivedQty: c.receivedQty, sellableQty: c.sellableQty, rejectedQty: c.rejectedQty },
      });
      await tx.fieldReturnLine.update({
        where: { id: l.id },
        data: { receivedQty: c.receivedQty, sellableQty: c.sellableQty, rejectedQty: c.rejectedQty },
      });

      const latest = l.resolutions[0];
      if (c.receivedQty !== l.receivedQty && latest) {
        /*
         * Stamped strictly after the line's latest resolution rather than left to the column
         * default — "latest" is read as createdAt desc, and a tie within one millisecond would
         * fall to the id tie-break, which could keep the stale settling resolution on top.
         */
        const createdAt = new Date(Math.max(Date.now(), latest.createdAt.getTime() + 1));
        await tx.fieldReturnResolution.create({
          data: {
            lineId: l.id,
            type: "INVESTIGATE",
            qty: Math.abs(lineVariance(l.qty, c.receivedQty)),
            note: `Koreksi penerimaan: diterima ${l.receivedQty ?? 0} → ${c.receivedQty}. ${reason}`,
            createdById: input.correctedById,
            createdAt,
          },
        });
      }
    }

    if (ret.origin === "ADMIN" && ret.store.termsType === "KONSI") {
      for (const l of ret.lines) {
        const c = byLineId.get(l.id)!;
        const delta = c.receivedQty - (l.receivedQty ?? 0);
        if (delta === 0) continue;

        /* Same rule as receipt: a drifted or negative StoreStock row never refuses a correction. */
        await moveStoreStock(tx, {
          storeId: ret.storeId,
          itemId: l.itemId,
          variantSku: l.variantSku,
          qtyDelta: -delta,
          refType: "FieldReturn" satisfies StockLedgerRefType,
          refId: ret.id,
          refDocNumber: ret.docNo,
          createdById: input.correctedById,
        });
      }
    }

    const after = await tx.fieldReturnLine.findMany({
      where: { returnId: ret.id },
      select: {
        qty: true,
        receivedQty: true,
        resolutions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { type: true },
        },
      },
    });
    const status: CorrectableStatus = allDiscrepantLinesSettled(after)
      ? "PENDING_APPROVAL"
      : "MISMATCH_PENDING_RESOLUTION";

    /*
     * Written only when it changes: `FieldReturn` has no `updatedAt`, so a same-value CAS would
     * match a row it does not change, and whether that counts as affected depends on the driver.
     */
    if (status !== fromStatus) {
      const flipped = await tx.fieldReturn.updateMany({
        where: { id: ret.id, status: fromStatus },
        data: { status },
      });
      if (flipped.count !== 1) throw new FieldReturnError("INVALID_STATE");
    }

    await tx.auditLog.create({
      data: {
        userId: input.correctedById,
        action: "FIELD_RETURN_RECEIPT_CORRECT",
        entityType: "FieldReturn",
        entityId: ret.id,
        reason,
        metadata: { docNo: ret.docNo, fromStatus, toStatus: status, lines: auditLines },
      },
    });

    /*
     * Only a retur the correction newly pushes back into resolution announces itself — one that was
     * already MISMATCH was announced at receipt. The count is the lines that now need a decision,
     * not every discrepant line: a short line whose count did not change keeps its settling
     * resolution.
     */
    if (fromStatus === "PENDING_APPROVAL" && status === "MISMATCH_PENDING_RESOLUTION") {
      const mismatchedLineCount = after.filter(
        (l) => lineVariance(l.qty, l.receivedQty) !== 0 && !isSettled(l.resolutions[0]?.type ?? null),
      ).length;
      notification = await tx.adminNotification.create({
        data: {
          category: "FIELD_RETURN_MISMATCH",
          severity: "WARNING",
          title: `Retur ${ret.docNo} has a count mismatch`,
          message: `${mismatchedLineCount} line${mismatchedLineCount === 1 ? "" : "s"} on retur ${ret.docNo} disagree with the warehouse count and need resolution.`,
          metadata: { returnId: ret.id, docNo: ret.docNo, storeId: ret.storeId, mismatchedLineCount },
        },
      });
      /* An ADMIN-origin retur was raised from the backoffice, so no salesman is waiting on it. */
      if (ret.origin === "FIELD") {
        salesmanNotice = {
          raisedById: ret.raisedById,
          returnId: ret.id,
          docNo: ret.docNo,
          storeId: ret.storeId,
          mismatchedLineCount,
        };
      }
    }

    return { ok: true as const, status };
  });

  /* Outside the transaction and never awaited, for the reasons `receiveFieldReturn` gives. */
  if (notification) void fanOutAdminNotification(notification);
  if (salesmanNotice) {
    void notifySalesmanOfMismatch(salesmanNotice).catch((err) =>
      console.error("[field-retur] salesman mismatch notice failed", err),
    );
  }
  return result;
}
