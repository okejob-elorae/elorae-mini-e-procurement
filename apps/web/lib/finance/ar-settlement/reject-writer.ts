import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { SettlementError } from "./errors";

/**
 * `AuditLog.reason` is a bare `String?` in the Prisma schema — no `@db.Text` — which is MySQL
 * `VARCHAR(191)`. `StoreSettlement.rejectReason` is `@db.Text` and has no such ceiling on its
 * own, but the action layer persists this same reason into an `AuditLog` row after this writer
 * returns, so 191 is the real ceiling regardless of which column is checked first. Enforcing it
 * here means the action never has to re-validate the length itself. See `approve-writer.ts`'s
 * identical comment for the override reason, which shares the same constraint for the same
 * reason.
 */
const MAX_REASON_LENGTH = 191;

export type RejectSettlementInput = {
  settlementId: string;
  rejectedById: string;
  reason: string;
};

export type RejectSettlementResult = { ok: true };

/**
 * Guarded exactly like `notifyCollectorOfOverdue` in `lib/finance/ar/overdue-sweep.ts` —
 * `sendNotificationToUsers` carries no VITEST guard of its own, and this writer's specs share
 * the `:3308` dev bed with real data and the real `FIREBASE_ADMIN_*` credentials
 * `vitest.config.ts` loads from `apps/web/.env`. Without this a test run would write a real
 * `NotificationQueue` row and attempt a real FCM push.
 */
async function notifySalesmanOfRejection(
  salesman: { id: string; fcmToken: string | null },
  payload: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  if (process.env.VITEST) return;
  await sendNotificationToUsers([salesman], { type: "SETTLEMENT_REJECTED", ...payload });
}

/**
 * Rejects a submitted store settlement: CAS-flips `PENDING -> REJECTED` and tells the salesman
 * why, surfaced on the existing `/pwa/notifications` bell.
 *
 * Posts no journal and moves no money ITSELF, and reverses nothing either — there is no
 * compensating path here for a `Payment` that already exists. The usual case is that none does: a
 * settlement that never reached approval never posted a component. But `approveSettlement` is a
 * resumable sequence rather than one transaction, so a run that posts a component and then throws
 * leaves the document `PENDING` with a real `Payment` behind it, and rejecting it from there
 * strands that payment attached to a `REJECTED` document. The finance approval screen surfaces
 * exactly this case (`componentsTitleOrphaned` in `app/backoffice/finance/pelunasan/[id]`) and
 * tells an admin to void the payments by hand; nothing here does it for them.
 *
 * A second call against a settlement that is no longer `PENDING` (already `REJECTED`, or since
 * `APPROVED`) throws `NOT_PENDING`, the same shape as `rejectCollection`
 * (`lib/finance/collections/reject-writer.ts`) — there is no crash-recovery concern to make this
 * idempotent for: the whole state change is one serializable transaction, so a crash mid-flight
 * leaves nothing partially applied. Only the notification runs after the transaction commits, and
 * it is deliberately best-effort — wrapped so a delivery failure never turns an already-successful
 * rejection into a thrown error, matching every other push notification in this codebase (none of
 * which replay themselves on retry either).
 */
export async function rejectSettlement(input: RejectSettlementInput): Promise<RejectSettlementResult> {
  const reason = input.reason.trim();
  /*
   * Same visible-content check as `approveSettlement`'s override reason, `rejectCollection` and
   * `voidPayment`: a reason made only of zero-width/format characters (Unicode `Cf`, e.g. U+200B)
   * or U+2800 BRAILLE PATTERN BLANK survives `.trim()` unchanged and would otherwise persist as a
   * reject reason that renders blank.
   */
  const hasVisibleContent = /[^\s\p{Cf}⠀]/u.test(reason);
  if (!hasVisibleContent) throw new SettlementError("MISSING_REASON", "A reject reason is required");
  if (reason.length > MAX_REASON_LENGTH) throw new SettlementError("INPUT_TOO_LARGE");

  const settlement = await runSerializable(async (tx) => {
    const row = await tx.storeSettlement.findUnique({
      where: { id: input.settlementId },
      select: { id: true, docNo: true, status: true, salesmanId: true, storeId: true },
    });
    if (!row) throw new SettlementError("SETTLEMENT_NOT_FOUND");
    if (row.status !== "PENDING") throw new SettlementError("NOT_PENDING");

    const flipped = await tx.storeSettlement.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: "REJECTED",
        rejectReason: reason,
        reviewedById: input.rejectedById,
        reviewedAt: new Date(),
      },
    });
    /*
     * Zero rows matched means a concurrent call already moved this settlement off PENDING between
     * the read above and this CAS — refuse rather than report success for a status flip that
     * never happened.
     */
    if (flipped.count === 0) throw new SettlementError("NOT_PENDING");

    /**
     * Written here, not in the action, so it can never go missing. A process death between this
     * transaction committing and the action's own `auditLog.create` would otherwise leave the
     * rejection with no audit row and no way back to writing one: a retry against this settlement
     * throws `NOT_PENDING` (there is no replay branch for reject — see the docstring above), so
     * nothing past this transaction ever gets a second chance to create it. The CAS above
     * guarantees this line runs at most once per rejection.
     */
    await tx.auditLog.create({
      data: {
        userId: input.rejectedById,
        action: "SETTLEMENT_REJECT",
        entityType: "StoreSettlement",
        entityId: row.id,
        reason,
      },
    });

    return row;
  });

  const salesman = await prisma.user.findUnique({
    where: { id: settlement.salesmanId },
    select: { id: true, fcmToken: true },
  });
  if (salesman) {
    try {
      await notifySalesmanOfRejection(salesman, {
        title: "Pelunasan ditolak",
        body: `Pelunasan ${settlement.docNo} ditolak: ${reason}`,
        data: { settlementId: settlement.id, docNo: settlement.docNo, storeId: settlement.storeId },
      });
    } catch (e) {
      /*
       * Best-effort, mirroring `postArJournalSafely`'s own notification catch: the rejection
       * already committed, so a delivery failure here must never surface as a thrown error and
       * undo a state change that already happened.
       */
      console.error(`[rejectSettlement] notification delivery failed for settlement ${settlement.id}`, e);
    }
  }

  return { ok: true };
}
