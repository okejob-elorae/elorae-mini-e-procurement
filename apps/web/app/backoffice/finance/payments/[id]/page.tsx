import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getPayment } from "@/lib/finance/ar/queries";
import { findArJournalPendingFlags, isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
import { PaymentDetailClient } from "./PaymentDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PaymentDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.PAYMENTS_MANAGE)) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment) notFound();

  /**
   * Both kinds are resolved here, server-side, and passed down as plain values — a client
   * component cannot read the flags itself. The receipt gate is read as the latest flag rather
   * than `isArJournalRetryable`'s boolean because its REASON decides what renders: a
   * `RECEIVABLE_OUTSIDE_LEDGER` refusal is permanent by design and gets a note, not a retry.
   * The same flag lookup backs `isArJournalRetryable`, so "flagged" means the same thing here as
   * at the action's entry gate. The void-reversal gate only ever renders when the payment is
   * VOIDED, but is still resolved unconditionally so the client never has to guess at the
   * server's own invariant.
   */
  const [receiptFlags, voidRetryable] = await Promise.all([
    findArJournalPendingFlags("ar_payment", [payment.id]),
    isArJournalRetryable("ar_payment_void", payment.id),
  ]);
  const receiptFlag = receiptFlags.get(payment.id);

  return (
    <PaymentDetailClient
      payment={payment}
      receiptJournalRetryable={receiptFlag !== undefined}
      receiptJournalFlagReason={receiptFlag?.reason ?? null}
      voidJournalRetryable={voidRetryable}
    />
  );
}
