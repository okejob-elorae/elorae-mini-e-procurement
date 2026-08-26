import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getReceivable, listReceivables } from "@/lib/finance/ar/queries";
import { isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
import { ReceivableDetailClient } from "./ReceivableDetailClient";
import type { AllocationCandidate } from "./RecordPaymentSheet";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * `listReceivables` takes a single `status`, so a store's full set of allocation candidates
 * (OUTSTANDING + PARTIAL) needs two calls merged rather than one. Each call is already scoped to
 * this one store, so it stays well clear of the "unpaginated fetch of the whole book" the payment
 * sheet must never do — `pageSize` is just a generous ceiling on one store's own open invoices,
 * not a page cursor. See task-14-report.md for the tradeoff against widening `listReceivables`
 * itself with a multi-status filter.
 */
const CANDIDATE_PAGE_SIZE = 500;

async function loadAllocationCandidates(storeId: string): Promise<AllocationCandidate[]> {
  const [outstanding, partial] = await Promise.all([
    listReceivables({ storeId, status: "OUTSTANDING", pageSize: CANDIDATE_PAGE_SIZE }),
    listReceivables({ storeId, status: "PARTIAL", pageSize: CANDIDATE_PAGE_SIZE }),
  ]);
  return [...outstanding.rows, ...partial.rows]
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((r) => ({ id: r.id, docNo: r.docNo, dueDate: r.dueDate, outstandingAmount: r.outstandingAmount }));
}

export default async function ReceivableDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.RECEIVABLES_VIEW)) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const receivable = await getReceivable(id);
  if (!receivable) notFound();

  const canManagePayments = hasPermission(permissions, PERMISSIONS.PAYMENTS_MANAGE);

  /*
   * Every backfilled receivable has no journal by construction, so "no journal exists" is never
   * the gate — only an actual JOURNAL_PENDING notification for this delivery makes the retry
   * button render at all. Resolved here, server-side, and passed down as a plain boolean: the
   * client never gets to decide this for itself.
   */
  const [revenueRetryable, cogsRetryable, allocationCandidates] = await Promise.all([
    isArJournalRetryable("field_delivery_revenue", receivable.deliveryId),
    isArJournalRetryable("field_delivery_cogs", receivable.deliveryId),
    canManagePayments ? loadAllocationCandidates(receivable.storeId) : Promise.resolve<AllocationCandidate[]>([]),
  ]);

  return (
    <ReceivableDetailClient
      receivable={receivable}
      canManagePayments={canManagePayments}
      journalRetryable={revenueRetryable || cogsRetryable}
      allocationCandidates={allocationCandidates}
    />
  );
}
