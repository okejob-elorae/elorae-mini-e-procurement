import type { Prisma } from "@elorae/db";
import { settlementComponentKeys } from "./approve-writer";

export type LiveOwningSettlement = { id: string; docNo: string; status: "PENDING" | "APPROVED" };

/**
 * The `PENDING` or `APPROVED` store settlement this payment is a component of, or `null` when it
 * belongs to none — read with the caller's transaction client, so `voidPayment` decides inside the
 * same SERIALIZABLE transaction that flips the payment.
 *
 * A payment is a component exactly when its `idempotencyKey` is in a settlement's
 * `settlementComponentKeys` — the set `approveSettlement` posts under and `rejectSettlement` counts
 * — so this never infers ownership from method, amount or reference. A payment with no key
 * (recorded from the payment sheet without one) is no settlement's component.
 *
 * Candidates are every live settlement of the payment's OWN store, on the `[storeId, status]`
 * index. That is sound because a component always posts against its settlement's store:
 * `recordPayment` is called with `settlement.storeId`, and a retur draw posts on the retur's store,
 * which `submitSettlement` refuses to differ (`RETUR_WRONG_STORE`). Not narrowed further on
 * purpose: inverting a key back to a settlement id would be a second spelling of the builders,
 * which is the drift the shared key set exists to prevent.
 *
 * `REJECTED` is not a candidate. A rejected document cannot gain components behind the reject
 * guard, and its leftover posted ones are orphans whose remedy IS a void; it is also terminal, so
 * a void that reads it cannot race the document back to live.
 */
export async function findLiveSettlementOwningPayment(
  tx: Prisma.TransactionClient,
  payment: { storeId: string; idempotencyKey: string | null },
): Promise<LiveOwningSettlement | null> {
  const key = payment.idempotencyKey;
  if (key === null) return null;

  const candidates = await tx.storeSettlement.findMany({
    where: { storeId: payment.storeId, status: { in: ["PENDING", "APPROVED"] } },
    select: {
      id: true,
      docNo: true,
      status: true,
      deductions: { select: { id: true, type: true, fieldReturnId: true } },
    },
  });
  for (const settlement of candidates) {
    /* Narrows the type only — the `where` above already excludes every other status. */
    if (settlement.status !== "PENDING" && settlement.status !== "APPROVED") continue;
    if (settlementComponentKeys(settlement).includes(key)) {
      return { id: settlement.id, docNo: settlement.docNo, status: settlement.status };
    }
  }
  return null;
}
