import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getReceivable, listAllocationCandidatesForStore, type AllocationCandidate } from "@/lib/finance/ar/queries";
import { isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
import { listCollectorCandidates } from "@/lib/finance/collections/queries";
import { ReceivableDetailClient } from "./ReceivableDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

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
  const canManageCollections = hasPermission(permissions, PERMISSIONS.COLLECTIONS_MANAGE);

  /**
   * Every backfilled receivable has no journal by construction, so "no journal exists" is never
   * the gate — only an actual JOURNAL_PENDING notification for this delivery makes the retry
   * button render at all. Resolved here, server-side, and passed down as a plain boolean: the
   * client never gets to decide this for itself.
   *
   * `field_delivery_revenue`/`field_delivery_cogs` are delivery-backed journal kinds only — a
   * SELL_THROUGH-sourced receivable has no delivery to retry a journal against, so it never gets a
   * journal-pending alert on this path.
   */
  const deliveryId = receivable.source.kind === "DELIVERY" ? receivable.source.deliveryId : null;
  const [revenueRetryable, cogsRetryable, allocationCandidates, collectorCandidates] = await Promise.all([
    deliveryId ? isArJournalRetryable("field_delivery_revenue", deliveryId) : Promise.resolve(false),
    deliveryId ? isArJournalRetryable("field_delivery_cogs", deliveryId) : Promise.resolve(false),
    canManagePayments ? listAllocationCandidatesForStore(receivable.storeId) : Promise.resolve<AllocationCandidate[]>([]),
    canManageCollections ? listCollectorCandidates() : Promise.resolve<{ id: string; name: string }[]>([]),
  ]);

  return (
    <ReceivableDetailClient
      receivable={receivable}
      canManagePayments={canManagePayments}
      canManageCollections={canManageCollections}
      journalRetryable={revenueRetryable || cogsRetryable}
      allocationCandidates={allocationCandidates}
      collectorCandidates={collectorCandidates}
    />
  );
}
