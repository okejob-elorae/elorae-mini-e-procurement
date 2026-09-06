import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAmplop } from "@/lib/finance/collections/amplop-queries";
import type { TaxInvoiceStatusValue } from "@/lib/tax-invoices/status-display";
import { AmplopList } from "./AmplopList";

export const dynamic = "force-dynamic";

export default async function AmplopDigitalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_AMPLOP)) redirect("/pwa");

  const amplop = await listAmplop(session.user.id);

  return (
    <AmplopList
      stores={amplop.stores.map((store) => ({
        storeId: store.storeId,
        storeName: store.storeName,
        totalOutstanding: store.totalOutstanding,
        totalOverdue: store.totalOverdue,
        availableCredit: store.availableCredit,
        rows: store.rows.map((row) => ({
          receivableId: row.receivableId,
          docNo: row.docNo,
          dueDateIso: row.dueDate.toISOString(),
          outstandingAmount: row.outstandingAmount,
          daysOverdue: row.daysOverdue,
          taxInvoiceStatus: row.taxInvoiceStatus as TaxInvoiceStatusValue | null,
          pendingSubmittedAmount: row.pendingSubmittedAmount,
        })),
      }))}
      totalOutstanding={amplop.totalOutstanding}
      totalOverdue={amplop.totalOverdue}
    />
  );
}
