import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { saranWaktuForm } from "@/lib/pengumuman/aturan";
import { rincianPengumumanKantor } from "@/lib/pengumuman/queries";
import { FormPengumuman } from "../../FormPengumuman";

export const dynamic = "force-dynamic";

export default async function UbahPengumumanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) redirect(`/backoffice/pengumuman/${encodeURIComponent(id)}`);
  const r = await rincianPengumumanKantor(id);
  if (!r) notFound();
  // Yang diarsipkan dipulihkan dulu dari halaman rinciannya — penulis juga menolak mengubahnya.
  if (r.keadaan === "DIARSIPKAN") redirect(`/backoffice/pengumuman/${r.id}`);

  return (
    <FormPengumuman
      awal={{
        id: r.id,
        title: r.title,
        body: r.body,
        audience: r.audience,
        pinned: r.pinned,
        requireAck: r.requireAck,
        publishedAt: r.isian.sudahTerbit ? "" : r.isian.publishedAt,
        expiresAt: r.isian.expiresAt,
        terbitTeks: r.isian.sudahTerbit ? r.terbit : null,
        jumlahKonfirmasi: r.laporan.dikonfirmasi,
        saran: saranWaktuForm(new Date()),
      }}
    />
  );
}
