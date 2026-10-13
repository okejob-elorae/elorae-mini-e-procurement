import type { Prisma } from "@elorae/db";
import { computePaymentDueDate } from "./payment-terms";

export type PaymentDueDb = Pick<Prisma.TransactionClient, "purchaseOrder" | "gRN">;

/**
 * Rebuilds a PO's payment due date from its own terms and its earliest GRN
 * that was not owner-declined. A PO without terms keeps its hand-entered date.
 * Idempotent: every writer that changes the terms or the PO's receipts calls
 * it inside its own transaction.
 */
export async function recomputePaymentDueDate(db: PaymentDueDb, poId: string): Promise<void> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    select: { paymentTermsDays: true },
  });
  if (!po || po.paymentTermsDays == null) return;

  const firstGrn = await db.gRN.findFirst({
    where: { poId, ownerDeclinedAt: null },
    orderBy: [{ grnDate: "asc" }, { id: "asc" }],
    select: { grnDate: true },
  });

  await db.purchaseOrder.update({
    where: { id: poId },
    data: { paymentDueDate: computePaymentDueDate(firstGrn?.grnDate ?? null, po.paymentTermsDays) },
  });
}
