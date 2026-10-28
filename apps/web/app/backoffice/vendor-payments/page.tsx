import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { VendorPaymentsClient } from "./VendorPaymentsClient";

export default async function VendorPaymentsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW)) redirect("/backoffice");

  return <VendorPaymentsClient canCreate={hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE)} />;
}
