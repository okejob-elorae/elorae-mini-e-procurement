import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { saranWaktuForm } from "@/lib/pengumuman/aturan";
import { FormPengumuman } from "../FormPengumuman";

export const dynamic = "force-dynamic";

export default async function PengumumanBaruPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");
  // Mengumumkan ke tim lapangan = keputusan kantor; yang hanya boleh melihat kembali ke daftar.
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) redirect("/backoffice/pengumuman");

  return (
    <FormPengumuman
      awal={{
        id: null,
        title: "",
        body: "",
        audience: "SEMUA",
        pinned: false,
        requireAck: false,
        publishedAt: "",
        expiresAt: "",
        terbitTeks: null,
        jumlahKonfirmasi: 0,
        saran: saranWaktuForm(new Date()),
      }}
    />
  );
}
