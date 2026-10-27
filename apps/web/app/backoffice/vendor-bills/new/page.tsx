import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { NewVendorBillClient } from "./NewVendorBillClient";

export default async function NewVendorBillPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.VENDOR_BILLS_MANAGE)) redirect("/backoffice/vendor-bills");

  return <NewVendorBillClient userId={session.user.id} />;
}
