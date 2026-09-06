import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAmplop } from "@/lib/finance/collections/amplop-queries";
import { listOffsettableReturns } from "@/lib/finance/ar/retur-offset-queries";
import { getStore } from "@/lib/stores/queries";
import { SettlementForm } from "./SettlementForm";

export const dynamic = "force-dynamic";

export default async function StoreSettlementPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_SUBMIT)) redirect("/pwa");

  const store = await getStore(storeId);
  if (!store) notFound();

  /**
   * `amplop.stores` is scoped to THIS user (collector or order salesman) — a store with no
   * outstanding receivable assigned to this user simply has no matching card, and the form
   * below renders that as "no selectable invoices at this store" rather than a dead end.
   * `listOffsettableReturns` is store-wide by design (matches `getStoreAvailableCreditMap`'s own
   * reasoning in `amplop-queries.ts`): two salesmen serving the same store see the same retur
   * credit, and the writer nets each submission's claim against every OTHER pending settlement
   * regardless of who raised it.
   */
  const [amplop, offsettable] = await Promise.all([
    listAmplop(session.user.id),
    listOffsettableReturns({ storeId }),
  ]);
  const storeCard = amplop.stores.find((s) => s.storeId === storeId);

  return (
    <SettlementForm
      storeId={storeId}
      storeName={store.name}
      invoices={(storeCard?.rows ?? []).map((row) => ({
        receivableId: row.receivableId,
        docNo: row.docNo,
        dueDateIso: row.dueDate.toISOString(),
        outstandingAmount: row.outstandingAmount,
        daysOverdue: row.daysOverdue,
        pendingSubmittedAmount: row.pendingSubmittedAmount,
      }))}
      offsettableReturns={offsettable.rows.map((r) => ({
        fieldReturnId: r.id,
        docNo: r.docNo,
        remainingValue: r.remainingValue,
      }))}
    />
  );
}
