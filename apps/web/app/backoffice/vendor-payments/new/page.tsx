import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { NewVendorPaymentClient } from "./NewVendorPaymentClient";

export default async function NewVendorPaymentPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SUPPLIER_PAYMENTS_CREATE)) redirect("/backoffice/vendor-payments");

  return <NewVendorPaymentClient userId={session.user.id} />;
}
