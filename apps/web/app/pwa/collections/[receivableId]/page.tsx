import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getReceivableCollectionAccess } from "@/lib/finance/collections/queries";
import { NotAssignedCard } from "./NotAssignedCard";
import { SubmitCollectionSheet } from "./SubmitCollectionSheet";

export const dynamic = "force-dynamic";

export default async function CollectionDetailPage({ params }: { params: Promise<{ receivableId: string }> }) {
  const { receivableId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_COLLECT)) redirect("/pwa");

  /**
   * Ownership is checked before anything is read out of the receivable. A missing id is a 404; an
   * id that exists but is assigned elsewhere gets a card with a way back to the queue and no
   * receivable data at all. Never resolve the URL param without this ownership check.
   */
  const access = await getReceivableCollectionAccess(receivableId, session.user.id);
  if (access.status === "missing") notFound();
  if (access.status === "not_assigned") return <NotAssignedCard />;
  const receivable = access.receivable;

  return (
    <SubmitCollectionSheet
      receivableId={receivable.receivableId}
      storeName={receivable.storeName}
      docNo={receivable.docNo}
      outstandingAmount={receivable.outstandingAmount}
      dueDateIso={receivable.dueDate.toISOString()}
      pendingSubmittedAmount={receivable.pendingSubmittedAmount}
      pendingSettlementClaimAmount={receivable.pendingSettlementClaimAmount}
    />
  );
}
