import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAmplop } from "@/lib/finance/collections/amplop-queries";
import { listAllOffsettableReturns, getPendingReturClaimsMap } from "@/lib/finance/ar/retur-offset-queries";
import { getPendingSettlementInvoiceClaimsMap } from "@/lib/finance/ar/queries";
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
   * `listAllOffsettableReturns` is store-wide by design (matches `getStoreAvailableCreditMap`'s
   * own reasoning in `amplop-queries.ts`) and unpaged, unlike the backoffice-facing
   * `listOffsettableReturns` — a store with more than one page of credit must not lose the rest
   * from a counter-side picker. Two salesmen serving the same store see the same retur credit,
   * and the writer nets each submission's claim against every OTHER pending settlement
   * regardless of who raised it.
   */
  const [amplop, offsettable] = await Promise.all([
    listAmplop(session.user.id),
    listAllOffsettableReturns(storeId),
  ]);
  const storeCard = amplop.stores.find((s) => s.storeId === storeId);

  /**
   * Neither `row.outstandingAmount` nor `r.remainingValue` above is the headroom
   * `submitSettlement` will actually honor — the writer additionally nets every OTHER PENDING
   * settlement's own claim on the same receivable/retur before refusing with
   * `INVOICE_OVERCLAIMED`/`RETUR_OVERCLAIMED`. Both maps are computed here, at the props layer,
   * so the form can show and default from the SAME reduced headroom the writer enforces instead
   * of one that looks valid and only fails at the counter.
   */
  const [invoiceClaims, returClaims] = await Promise.all([
    getPendingSettlementInvoiceClaimsMap((storeCard?.rows ?? []).map((row) => row.receivableId)),
    getPendingReturClaimsMap(offsettable.map((r) => r.id)),
  ]);

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
        reservedAmount: invoiceClaims.get(row.receivableId) ?? 0,
      }))}
      offsettableReturns={offsettable.map((r) => ({
        fieldReturnId: r.id,
        docNo: r.docNo,
        remainingValue: r.remainingValue,
        reservedAmount: returClaims.get(r.id) ?? 0,
      }))}
    />
  );
}
