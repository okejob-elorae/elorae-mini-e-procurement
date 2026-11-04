import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianPengumumanKantor } from "@/lib/pengumuman/queries";
import { RincianPengumumanClient } from "./RincianPengumumanClient";

export const dynamic = "force-dynamic";

/** Rincian pengumuman + laporan baca: siapa sudah membaca, siapa sudah mengonfirmasi, siapa belum. */
export default async function RincianPengumumanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const rincian = await rincianPengumumanKantor(id);
  if (!rincian) notFound();

  return (
    <RincianPengumumanClient
      rincian={rincian}
      canManage={hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)}
    />
  );
}
