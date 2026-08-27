import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listCollectionQueue } from "@/lib/finance/collections/queries";
import { CollectionsQueueList } from "./CollectionsQueueList";

export const dynamic = "force-dynamic";

export default async function CollectionsQueuePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_COLLECT)) redirect("/pwa");

  const rows = await listCollectionQueue(session.user.id);

  return (
    <CollectionsQueueList
      rows={rows.map((r) => ({
        receivableId: r.receivableId,
        storeName: r.storeName,
        docNo: r.docNo,
        outstandingAmount: r.outstandingAmount,
        dueDateIso: r.dueDate.toISOString(),
        daysOverdue: r.daysOverdue,
        pendingSubmittedAmount: r.pendingSubmittedAmount,
      }))}
    />
  );
}
