import { runSerializable } from "@/lib/db/tx-retry";
import { FieldReturnError } from "./errors";
import { auditReason } from "./audit-reason";

/**
 * Retires a retur nobody will ever receive — a sack that never shipped, a duplicate raise.
 *
 * Only from PENDING_WAREHOUSE_RECEIVING, for both origins, because that is the one state in which
 * nothing has moved: a FIELD retur touches no stock until approval and an ADMIN retur first moves
 * `StoreStock` at receipt, so there is nothing to reverse here and this writes no stock and no
 * ledger entry. A received retur has goods sitting in the warehouse; it is settled through
 * resolutions and approval, never cancelled. The status flip is a CAS `updateMany` on
 * PENDING_WAREHOUSE_RECEIVING, so a retur received (or cancelled) between the read and the write
 * refuses `INVALID_STATE` instead of reporting a cancel that did not happen — every refusal throws,
 * since `runSerializable` commits on a normal return.
 *
 * `FieldReturn` has no `cancelledById`/`cancelledAt`/`cancelReason` columns, so the actor, the time
 * and the required reason live on a `FIELD_RETURN_CANCEL` `AuditLog` row written in this
 * transaction — the precedent `cancelStoreTransfer` set for the same gap, rather than a migration.
 *
 * A CANCELLED retur stops holding anything up: `RETUR_IN_FLIGHT` (sell-through creation) keys on
 * the three open statuses only, so cancelling is also the remedy for an abandoned retur blocking a
 * konsi report, and any later in-flight check must ignore CANCELLED the same way.
 */
export async function cancelFieldReturn(input: {
  returnId: string;
  cancelledById: string;
  reason: string;
}): Promise<{ ok: true; storeId: string }> {
  const reason = auditReason(input.reason);

  return runSerializable(async (tx) => {
    const ret = await tx.fieldReturn.findUnique({
      where: { id: input.returnId },
      select: { id: true, docNo: true, storeId: true, origin: true },
    });
    if (!ret) throw new FieldReturnError("NOT_FOUND");

    const claimed = await tx.fieldReturn.updateMany({
      where: { id: ret.id, status: "PENDING_WAREHOUSE_RECEIVING" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== 1) throw new FieldReturnError("INVALID_STATE");

    await tx.auditLog.create({
      data: {
        userId: input.cancelledById,
        action: "FIELD_RETURN_CANCEL",
        entityType: "FieldReturn",
        entityId: ret.id,
        reason,
        metadata: { docNo: ret.docNo, origin: ret.origin },
      },
    });

    return { ok: true as const, storeId: ret.storeId };
  });
}
