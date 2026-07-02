import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { StoreForm } from "../StoreForm";

export default async function NewStorePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_MANAGE)) redirect("/backoffice/stores");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">New store</h1>
      <StoreForm mode="create" initial={{
        code: "",
        name: "",
        address: "",
        phone: null,
        contactName: null,
        termsType: "PUTUS",
        paymentTempo: 0,
        marginPercent: null,
        lat: null,
        lng: null,
        isActive: true,
      }} />
    </div>
  );
}
