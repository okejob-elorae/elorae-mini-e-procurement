import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { VendorPaymentsClosedPage } from "./VendorPaymentsClosedPage";

/** No form any more: vendor payments closed on 2026-11-01, new payments go through Supplier payments → Pay. */
export default async function NewVendorPaymentPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW)) redirect("/backoffice");

  return <VendorPaymentsClosedPage canPay={hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE)} />;
}
