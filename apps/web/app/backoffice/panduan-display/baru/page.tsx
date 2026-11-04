import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarArea } from "@/lib/stores/areas";
import { PanduanForm } from "../PanduanForm";

export const dynamic = "force-dynamic";

export default async function PanduanBaruPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) redirect("/backoffice/panduan-display");
  const area = await daftarArea();
  return (
    <PanduanForm
      awal={null}
      area={area.filter((a) => a.isActive).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
      foto={[]}
      bolehKelola
    />
  );
}
