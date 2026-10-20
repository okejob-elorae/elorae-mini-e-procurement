import type { Prisma } from "@elorae/db";
import { settlementComponentKeys } from "./approve-writer";

export type ApprovedOwningSettlement = { id: string; docNo: string };

/**
 * The `APPROVED` store settlement this payment is a component of, or `null` when it belongs to
 * none — read with the caller's transaction client, so `voidPayment` decides inside the same
 * SERIALIZABLE transaction that flips the payment.
 *
 * A payment is a component exactly when its `idempotencyKey` is in a settlement's
 * `settlementComponentKeys` — the set `approveSettlement` posts under and `rejectSettlement` counts
 * — so this never infers ownership from method, amount or reference. A payment with no key
 * (recorded from the payment sheet without one) is no settlement's component.
 *
 * Candidates are the `APPROVED` settlements of the payment's OWN store, on the `[storeId, status]`
 * index. That is sound because a component always posts against its settlement's store:
 * `recordPayment` is called with `settlement.storeId`, and a retur draw posts on the retur's store,
 * which `submitSettlement` refuses to differ (`RETUR_WRONG_STORE`). Not narrowed further on
 * purpose: inverting a key back to a settlement id would be a second spelling of the builders,
 * which is the drift the shared key set exists to prevent.
 *
 * Only `APPROVED` blocks a void. A `PENDING` settlement's posted component (a half-run approval)
 * stays voidable: the resume then refuses `COMPONENT_VOIDED`, so void-each-then-reject is the safe
 * exit `rejectSettlement`'s `COMPONENTS_POSTED` names. A `REJECTED` settlement's leftover posted
 * components are orphans whose remedy IS a void.
 */
export async function findApprovedSettlementOwningPayment(
  tx: Prisma.TransactionClient,
  payment: { storeId: string; idempotencyKey: string | null },
): Promise<ApprovedOwningSettlement | null> {
  const key = payment.idempotencyKey;
  if (key === null) return null;

  const candidates = await tx.storeSettlement.findMany({
    where: { storeId: payment.storeId, status: "APPROVED" },
    select: {
      id: true,
      docNo: true,
      deductions: { select: { id: true, type: true, fieldReturnId: true } },
    },
  });
  for (const settlement of candidates) {
    if (settlementComponentKeys(settlement).includes(key)) {
      return { id: settlement.id, docNo: settlement.docNo };
    }
  }
  return null;
}
