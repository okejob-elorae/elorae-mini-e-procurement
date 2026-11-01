import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVendorBillDetail } from "@/lib/vendor-billing/queries";
import { VendorBillDetailClient } from "./VendorBillDetailClient";

export default async function VendorBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.VENDOR_BILLS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const bill = await getVendorBillDetail(id);
  if (!bill) notFound();
  // As `voidVendorBill` refuses: a live old vendor payment, or old CMT this bill booked that Supplier
  // payments already paid past what voiding it would leave. Paid through Supplier payments alone does not.
  const canManage = hasPermission(perms, PERMISSIONS.VENDOR_BILLS_MANAGE);
  const hasLiveVendorPayment = bill.allocations.some((a) => !a.payment.voidedAt);
  const voidBlockedSteps = bill.status !== "VOID" && !hasLiveVendorPayment && canManage ? bill.voidBlockedSteps : [];
  const canVoid = bill.status !== "VOID" && !hasLiveVendorPayment && bill.voidBlockedSteps.length === 0 && canManage;
  const canPay = (bill.status === "UNPAID" || bill.status === "PARTIAL") && hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE);

  return <VendorBillDetailClient bill={bill} canVoid={canVoid} canPay={canPay} voidBlockedSteps={voidBlockedSteps} userId={session.user.id} />;
}
