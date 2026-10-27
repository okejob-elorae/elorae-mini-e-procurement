import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { VendorBillsClient } from "./VendorBillsClient";

export default async function VendorBillsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.VENDOR_BILLS_VIEW)) redirect("/backoffice");

  return <VendorBillsClient canManage={hasPermission(perms, PERMISSIONS.VENDOR_BILLS_MANAGE)} />;
}
