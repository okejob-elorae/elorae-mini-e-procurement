import { prisma } from "@elorae/db";
import type { POStatus } from "@elorae/db";
import { parsePaymentTermsDays } from "./payment-terms";
import { recomputePaymentDueDate } from "./payment-due";

export type SetPaymentTermsCode = "NOT_FOUND" | "CANCELLED" | "PAID" | "INVALID";
export type SetPaymentTermsResult = { ok: true } | { ok: false; code: SetPaymentTermsCode };

function describeTerms(days: number | null): string {
  return days == null ? "none" : `${days} days`;
}

/**
 * Corrects a PO's payment terms on any status but CANCELLED — CLOSED included,
 * which the PO edit form refuses — and rebuilds the due date from them. A paid
 * PO is refused: its due date is history.
 */
export async function setPurchaseOrderPaymentTerms(
  poId: string,
  paymentTermsDays: number | null,
  actorId: string
): Promise<SetPaymentTermsResult> {
  const parsed = parsePaymentTermsDays(paymentTermsDays);
  if (!parsed.ok) return { ok: false, code: "INVALID" };

  return prisma.$transaction(async (tx) => {
    /**
     * A locking read, not findUnique: it waits out a GRN writer holding this PO row and opens no
     * REPEATABLE READ snapshot, so the recompute below sees every receipt committed before it.
     */
    const rows = await tx.$queryRaw<
      Array<{ status: POStatus; paidAt: Date | null; paymentTermsDays: number | null }>
    >`
      SELECT \`status\`, \`paidAt\`, \`paymentTermsDays\` FROM \`PurchaseOrder\` WHERE \`id\` = ${poId} FOR UPDATE
    `;
    const po = rows[0];
    if (!po) return { ok: false, code: "NOT_FOUND" } as const;
    if (po.status === "CANCELLED") return { ok: false, code: "CANCELLED" } as const;
    if (po.paidAt != null) return { ok: false, code: "PAID" } as const;

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { paymentTermsDays: parsed.value },
    });
    await recomputePaymentDueDate(tx, poId);
    await tx.pOStatusHistory.create({
      data: {
        poId,
        status: po.status,
        changedById: actorId,
        notes: `Payment terms: ${po.paymentTermsDays ?? "none"} → ${describeTerms(parsed.value)}`,
      },
    });
    return { ok: true } as const;
  });
}
