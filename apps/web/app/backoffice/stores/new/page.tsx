import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarArea } from "@/lib/stores/areas";
import { StoreForm } from "../StoreForm";

export default async function NewStorePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_MANAGE)) redirect("/backoffice/stores");

  const [areas, salesmen] = await Promise.all([daftarArea(), daftarSalesman()]);

  return (
    <div className="max-w-3xl">
      <StoreForm mode="create" areas={areas} salesmen={salesmen} initial={{
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
        checkinRadiusMeters: null,
        isPkp: false,
        groupId: null,
        salesmanId: null,
        isActive: true,
      }} />
    </div>
  );
}
