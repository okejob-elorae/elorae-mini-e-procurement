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
  const hasLivePayment = bill.allocations.some((a) => !a.payment.voidedAt);
  const canVoid = bill.status !== "VOID" && !hasLivePayment && hasPermission(perms, PERMISSIONS.VENDOR_BILLS_MANAGE);

  return <VendorBillDetailClient bill={bill} canVoid={canVoid} userId={session.user.id} />;
}
