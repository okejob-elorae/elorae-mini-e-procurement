import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getReceivableForCollection } from "@/lib/finance/collections/queries";
import { SubmitCollectionSheet } from "./SubmitCollectionSheet";

export const dynamic = "force-dynamic";

export default async function CollectionDetailPage({ params }: { params: Promise<{ receivableId: string }> }) {
  const { receivableId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_COLLECT)) redirect("/pwa");

  /**
   * `getReceivableForCollection` returns `null` both when the receivable doesn't exist AND
   * when it isn't assigned to this collector — a collector can never even read a receivable
   * that isn't theirs, and this route can't distinguish "not yours" from "doesn't exist"
   * (same shape as a 404, not a 403). Never resolve the URL param without this ownership check.
   */
  const receivable = await getReceivableForCollection(receivableId, session.user.id);
  if (!receivable) notFound();

  return (
    <SubmitCollectionSheet
      receivableId={receivable.receivableId}
      storeName={receivable.storeName}
      docNo={receivable.docNo}
      outstandingAmount={receivable.outstandingAmount}
      dueDateIso={receivable.dueDate.toISOString()}
      pendingSubmittedAmount={receivable.pendingSubmittedAmount}
    />
  );
}
