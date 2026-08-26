import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getPayment } from "@/lib/finance/ar/queries";
import { isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
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
   * Both kinds are resolved here, server-side, and passed down as plain booleans — a client
   * component cannot call `isArJournalRetryable` itself. The receipt-journal gate matters
   * regardless of status; the void-reversal gate only ever renders when the payment is VOIDED,
   * but is still resolved unconditionally so the client never has to guess at the server's own
   * invariant.
   */
  const [receiptRetryable, voidRetryable] = await Promise.all([
    isArJournalRetryable("ar_payment", payment.id),
    isArJournalRetryable("ar_payment_void", payment.id),
  ]);

  return (
    <PaymentDetailClient
      payment={payment}
      receiptJournalRetryable={receiptRetryable}
      voidJournalRetryable={voidRetryable}
    />
  );
}
