import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVendorPaymentDetail } from "@/lib/vendor-billing/payment-queries";
import { VendorPaymentDetailClient } from "./VendorPaymentDetailClient";

export default async function VendorPaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const payment = await getVendorPaymentDetail(id);
  if (!payment) notFound();
  const canVoid = !payment.voidedAt && hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE);

  return <VendorPaymentDetailClient payment={payment} canVoid={canVoid} userId={session.user.id} />;
}
