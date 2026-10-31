import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilPanduan, fotoPanduanTerbaru } from "@/lib/salesman/checklist-queries";
import { daftarArea } from "@/lib/stores/areas";
import { PanduanForm } from "../PanduanForm";

export const dynamic = "force-dynamic";

/** Ubah panduan + foto hasil display terbaru yang dikirim salesman untuknya. */
export default async function UbahPanduanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const [p, area, foto] = await Promise.all([ambilPanduan(id), daftarArea(), fotoPanduanTerbaru(id)]);
  if (!p) notFound();
  return (
    <PanduanForm
      awal={p}
      // Area nonaktif tetap ditawarkan bila panduan ini masih menunjuknya.
      area={area.filter((a) => a.isActive || a.id === p.groupId).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
      foto={foto}
      bolehKelola={hasPermission(perms, PERMISSIONS.STORES_MANAGE)}
    />
  );
}
